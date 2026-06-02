/**
 * Calendar reminders (Phase 6B · the "chase") — the lead-time nudge before a
 * block. A small cron sweeps blocks whose reminder window has opened and
 * emails the owner once per occurrence (deduped via calendar_reminders_sent).
 *
 * Recurrence-aware: a recurring master's next occurrence is expanded here so
 * each instance gets its own one-time reminder. Cadence-tolerant — it fires
 * any block whose start is within [now, now + reminder_min] and not yet
 * reminded, so the exact cron interval is only a precision knob, never a
 * correctness dependency.
 */

import { sql } from '@/lib/db';
import { expandOccurrences } from '@/lib/recurrence';

export interface DueReminder {
  blockId: string;
  occurrenceDate: string; // 'YYYY-MM-DD'
  ownerId: string;
  ownerEmail: string | null;
  ownerName: string;
  title: string;
  startClock: string; // 'HH:MM'
  durationMin: number;
  /** Absolute start, for the email body. */
  startsAtIso: string;
}

interface BlockRow {
  id: string;
  owner_id: string;
  owner_email: string | null;
  owner_name: string;
  title: string;
  duration_min: number;
  reminder_min: number;
  rrule: string | null;
  time_zone: string;
  start_date: string; // master civil start date in its own zone
  start_clock: string; // HH:MM in its own zone
}

/**
 * Find reminders due as of `now`. A block is due when an occurrence starts
 * within the next `reminder_min` minutes (and not in the past beyond a small
 * grace), and that occurrence hasn't already been reminded. Pure-ish: reads
 * the DB but the windowing is deterministic given `now`.
 */
export async function findDueReminders(now: Date = new Date()): Promise<DueReminder[]> {
  // Candidate masters: active, planned, with reminders on, whose series could
  // have an occurrence today or tomorrow (covers lead times up to a day).
  const rows = await sql<BlockRow>`
    SELECT b.id, b.owner_id, u.email AS owner_email,
           COALESCE(NULLIF(p.display_name,''), u.name, u.email, '') AS owner_name,
           b.title, b.duration_min, b.reminder_min, b.rrule, b.time_zone,
           to_char(b.start_at AT TIME ZONE b.time_zone, 'YYYY-MM-DD') AS start_date,
           to_char(b.start_at AT TIME ZONE b.time_zone, 'HH24:MI')    AS start_clock
    FROM calendar_blocks b
    JOIN users u ON u.id = b.owner_id
    LEFT JOIN ops_profiles p ON p.user_id = b.owner_id
    WHERE b.status = 'planned' AND b.reminder_min > 0`;

  const due: DueReminder[] = [];

  for (const b of rows) {
    // Which occurrence dates to consider: today + tomorrow in the block's zone.
    const todayCivil = new Intl.DateTimeFormat('en-CA', {
      timeZone: b.time_zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const tomorrowCivil = isoAddDay(todayCivil, 1);

    const occ = expandOccurrences(b.start_date, b.rrule, todayCivil, tomorrowCivil);
    for (const date of occ) {
      // The occurrence's absolute start = civil date+clock in the block's zone.
      const startsAt = zonedToInstant(date, b.start_clock, b.time_zone);
      if (!startsAt) continue;
      const leadMs = b.reminder_min * 60_000;
      const msUntil = startsAt.getTime() - now.getTime();
      // Due if it starts within the lead window and hasn't slipped >5 min past.
      if (msUntil <= leadMs && msUntil >= -5 * 60_000) {
        due.push({
          blockId: b.id,
          occurrenceDate: date,
          ownerId: b.owner_id,
          ownerEmail: b.owner_email,
          ownerName: b.owner_name,
          title: b.title,
          startClock: b.start_clock,
          durationMin: b.duration_min,
          startsAtIso: startsAt.toISOString(),
        });
      }
    }
  }

  if (due.length === 0) return [];

  // Drop any already reminded (dedupe on block_id + occurrence_date).
  const ids = due.map((d) => d.blockId);
  const sent = await sql<{ block_id: string; d: string }>`
    SELECT block_id, to_char(occurrence_date, 'YYYY-MM-DD') AS d
    FROM calendar_reminders_sent
    WHERE block_id = ANY(${ids})`;
  const sentKey = new Set(sent.map((s) => `${s.block_id}:${s.d}`));
  return due.filter((d) => !sentKey.has(`${d.blockId}:${d.occurrenceDate}`));
}

/** Mark a reminder sent so it never fires twice. */
export async function markReminderSent(blockId: string, occurrenceDate: string): Promise<void> {
  await sql`
    INSERT INTO calendar_reminders_sent (block_id, occurrence_date)
    VALUES (${blockId}, ${occurrenceDate})
    ON CONFLICT (block_id, occurrence_date) DO NOTHING`;
}

// ─── small date helpers (kept local; civil-string in/out) ─────────────

function isoAddDay(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Resolve a civil date + 'HH:MM' clock in an IANA zone to the absolute UTC
 * instant. Uses the zone's offset at that date (DST-correct) by formatting a
 * guess and measuring the skew. Returns null on malformed input. Exported
 * for unit tests — the offset trick is subtle enough to pin down.
 */
export function zonedToInstant(dateIso: string, clock: string, zone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  const c = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!m || !c) return null;
  const [, y, mo, d] = m.map(Number);
  const [, h, min] = c.map(Number);
  // Start from the naive UTC interpretation, then correct by the zone offset.
  const naiveUtc = Date.UTC(y, mo - 1, d, h, min);
  const asInZone = new Date(naiveUtc);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(asInZone);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'));
  const offset = shown - naiveUtc; // how far the zone is from UTC at this date
  return new Date(naiveUtc - offset);
}
