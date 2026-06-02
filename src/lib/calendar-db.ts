/**
 * Calendar loaders (Phase 6A) — owner-scoped reads of calendar_blocks plus
 * the read-only job shoots that share the surface (§4A). Not a 'use server'
 * module; plain async helpers the page imports. The absolute start_at is
 * converted to civil 'YYYY-MM-DD' + 'HH:MM' in the viewer's zone here, so
 * the pure layout helpers in lib/calendar.ts never touch timezones.
 */

import { sql, sqlOne } from '@/lib/db';
import type { BlockType, BlockStatus } from '@/lib/calendar';
import { expandOccurrences } from '@/lib/recurrence';
import { readExternalEvents } from '@/lib/google/read-calendars';

export interface CalendarItem {
  /** For a recurring instance this is `${masterId}:${date}` so React keys
   * stay unique; `masterId` is the row to edit. A one-off has id === masterId. */
  id: string;
  masterId: string;
  /** block = Ops time block (editable); shoot = read-only job; external =
   * read-only event from one of the user's other Google calendars. */
  kind: 'block' | 'shoot' | 'external';
  title: string;
  blockType: BlockType | null; // null for shoots/external
  /** Civil date 'YYYY-MM-DD' in the viewer's zone. */
  date: string;
  /** 'HH:MM' 24h, or null for an untimed all-day item. */
  startClock: string | null;
  durationMin: number;
  status: BlockStatus | null;
  notes: string | null;
  jobId: string | null;
  clientName: string | null; // for shoots
  /** True when this came from a recurring master (drives the ↻ marker). */
  recurring: boolean;
  /** The master's RRULE (so the editor can pre-fill the recurrence control). */
  rrule: string | null;
  /** External-only: the source Google calendar's color + name. */
  externalColor?: string | null;
  externalCalendar?: string | null;
}

interface BlockRow {
  id: string;
  title: string;
  block_type: BlockType;
  notes: string | null;
  duration_min: number;
  status: BlockStatus;
  job_id: string | null;
  rrule: string | null;
  d: string; // master's civil start date in zone
  t: string; // HH:MM in zone
}
interface ShootRow {
  id: string;
  title: string | null;
  client_name: string | null;
  d: string;
}

/**
 * Load every calendar item between two civil dates (inclusive), for one
 * owner. `zone` is the IANA zone the civil date/time are computed in
 * (Postgres does the conversion, so DST is correct). Shoots are read-only
 * job items (§4A) — never copied.
 */
export async function loadCalendar(
  ownerId: string,
  fromDate: string,
  toDate: string,
  zone = 'America/Chicago',
): Promise<CalendarItem[]> {
  // Candidate blocks: any master whose own start is on/before the window end
  // (a recurring master that began earlier still recurs into view; a one-off
  // or non-recurring master is filtered to the window after expansion). The
  // upper bound keeps us from loading the whole future.
  const [blockRows, skipRows, shootRows] = await Promise.all([
    sql<BlockRow>`
      SELECT id, title, block_type, notes, duration_min, status, job_id, rrule,
             to_char(start_at AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS d,
             to_char(start_at AT TIME ZONE ${zone}, 'HH24:MI')    AS t
      FROM calendar_blocks
      WHERE owner_id = ${ownerId}
        AND status <> 'canceled'
        AND (start_at AT TIME ZONE ${zone})::date <= ${toDate}::date
        AND (
          rrule IS NOT NULL
          OR (start_at AT TIME ZONE ${zone})::date >= ${fromDate}::date
        )
      ORDER BY start_at`,
    sql<{ master_id: string; d: string }>`
      SELECT s.master_id, to_char(s.occurrence_date, 'YYYY-MM-DD') AS d
      FROM calendar_block_skips s
      JOIN calendar_blocks b ON b.id = s.master_id
      WHERE b.owner_id = ${ownerId}`,
    sql<ShootRow>`
      SELECT j.id, j.title, c.display_name AS client_name,
             to_char(j.shoot_date, 'YYYY-MM-DD') AS d
      FROM jobs j
      LEFT JOIN clients c ON c.id = j.client_id
      WHERE j.owner_id = ${ownerId}
        AND j.shoot_date IS NOT NULL
        AND j.stage NOT IN ('complete','cancelled')
        AND j.shoot_date BETWEEN ${fromDate}::date AND ${toDate}::date
      ORDER BY j.shoot_date`,
  ]);

  // Skips grouped per master.
  const skipsByMaster = new Map<string, Set<string>>();
  for (const s of skipRows) {
    const set = skipsByMaster.get(s.master_id) ?? new Set<string>();
    set.add(s.d);
    skipsByMaster.set(s.master_id, set);
  }

  // Expand each master into its in-window occurrences (one-offs yield one).
  const blocks: CalendarItem[] = [];
  for (const b of blockRows) {
    const occ = expandOccurrences(b.d, b.rrule, fromDate, toDate, skipsByMaster.get(b.id));
    const isRecurring = !!b.rrule;
    for (const date of occ) {
      blocks.push({
        id: isRecurring ? `${b.id}:${date}` : b.id,
        masterId: b.id,
        kind: 'block',
        title: b.title,
        blockType: b.block_type,
        date,
        startClock: b.t,
        durationMin: b.duration_min,
        status: b.status,
        notes: b.notes,
        jobId: b.job_id,
        clientName: null,
        recurring: isRecurring,
        rrule: b.rrule,
      });
    }
  }

  const shoots: CalendarItem[] = shootRows.map((s) => ({
    id: s.id,
    masterId: s.id,
    kind: 'shoot',
    title: s.title || `${s.client_name ?? 'Client'} — shoot`,
    blockType: null,
    date: s.d,
    startClock: null, // untimed → all-day band until a time is set
    durationMin: 0,
    status: null,
    notes: null,
    jobId: s.id,
    clientName: s.client_name,
    recurring: false,
    rrule: null,
  }));

  // External read-only context: every other Google calendar (Phase 6C-2).
  // Best-effort — returns [] when sync is unconfigured or on any failure, so
  // the calendar always renders. We skip our own "Sharp Sighted" calendar
  // (its events already come from `blocks`).
  let external: CalendarItem[] = [];
  try {
    const syncRow = await sqlOne<{ google_calendar_id: string | null }>`
      SELECT google_calendar_id FROM calendar_sync_state WHERE id = 1`;
    const ext = await readExternalEvents(fromDate, toDate, zone, syncRow?.google_calendar_id ?? null);
    external = ext.map((e) => ({
      id: `ext:${e.id}:${e.date}`,
      masterId: e.id,
      kind: 'external' as const,
      title: e.title,
      blockType: null,
      date: e.date,
      startClock: e.startClock,
      durationMin: e.durationMin,
      status: null,
      notes: null,
      jobId: null,
      clientName: null,
      recurring: false,
      rrule: null,
      externalColor: e.calendarColor,
      externalCalendar: e.calendarName,
    }));
  } catch {
    external = []; // never let external context break the calendar
  }

  return [...blocks, ...shoots, ...external];
}
