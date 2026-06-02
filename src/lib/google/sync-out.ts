/**
 * Outbound sync (Phase 6C-1) — push a block's create/update/delete to the
 * Sharp Sighted Google calendar. Called by the calendar actions AFTER the
 * local write commits.
 *
 * Best-effort by contract: if sync is unconfigured it's a silent no-op; if a
 * Google call fails it marks the block sync_state='error' and logs, but
 * NEVER throws back to the action — the local calendar is the source of
 * truth and must keep working whether or not Google is reachable.
 */

import { sql, sqlOne } from '@/lib/db';
import { calendarSyncConfigured } from './auth';
import { findOrCreateCalendar, insertEvent, patchEvent, deleteEvent } from './calendar-client';
import { blockToGoogleEvent, type BlockForGoogle } from './event-map';

/** Cache the resolved calendar id in the singleton state row. */
async function resolveCalendarId(): Promise<string | null> {
  const existing = await sqlOne<{ google_calendar_id: string | null }>`
    SELECT google_calendar_id FROM calendar_sync_state WHERE id = 1`;
  if (existing?.google_calendar_id) return existing.google_calendar_id;

  const calId = await findOrCreateCalendar();
  if (!calId) return null;
  await sql`
    INSERT INTO calendar_sync_state (id, google_calendar_id)
    VALUES (1, ${calId})
    ON CONFLICT (id) DO UPDATE SET google_calendar_id = EXCLUDED.google_calendar_id`;
  return calId;
}

interface BlockRow extends BlockForGoogle {
  google_event_id: string | null;
}

async function loadBlockForGoogle(blockId: string): Promise<BlockRow | null> {
  return sqlOne<BlockRow>`
    SELECT title, notes, rrule, time_zone AS "timeZone", duration_min AS "durationMin",
           google_event_id,
           to_char(start_at AT TIME ZONE time_zone, 'YYYY-MM-DD') AS date,
           to_char(start_at AT TIME ZONE time_zone, 'HH24:MI')    AS "startClock"
    FROM calendar_blocks WHERE id = ${blockId}`;
}

async function markError(blockId: string): Promise<void> {
  try {
    await sql`UPDATE calendar_blocks SET sync_state = 'error' WHERE id = ${blockId}`;
  } catch {
    /* swallow — error-marking must not itself throw */
  }
}

/**
 * Push a created/updated block to Google. Inserts if it has no Google twin
 * yet, patches if it does. Stores the event id + etag and flips sync_state
 * to 'synced'. No-op when unconfigured; never throws.
 */
export async function syncBlockUpsert(blockId: string): Promise<void> {
  if (!calendarSyncConfigured()) return;
  try {
    const calId = await resolveCalendarId();
    if (!calId) return;
    const b = await loadBlockForGoogle(blockId);
    if (!b) return;

    const body = blockToGoogleEvent(b);
    const result = b.google_event_id
      ? await patchEvent(calId, b.google_event_id, body)
      : await insertEvent(calId, body);

    await sql`
      UPDATE calendar_blocks
      SET google_event_id = ${result.eventId}, google_etag = ${result.etag},
          sync_state = 'synced', last_synced_at = now()
      WHERE id = ${blockId}`;
  } catch (err) {
    console.error('[ops] calendar sync-out (upsert) failed:', err);
    await markError(blockId);
  }
}

/**
 * Delete a block's Google twin. Called BEFORE the local row is deleted (so we
 * still have the google_event_id) — pass the id captured at that point.
 */
export async function syncBlockDelete(googleEventId: string | null): Promise<void> {
  if (!calendarSyncConfigured() || !googleEventId) return;
  try {
    const calId = await resolveCalendarId();
    if (!calId) return;
    await deleteEvent(calId, googleEventId);
  } catch (err) {
    console.error('[ops] calendar sync-out (delete) failed:', err);
    // Nothing to mark — the local row is on its way out regardless.
  }
}
