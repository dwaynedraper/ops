/**
 * Calendar loaders (Phase 6A) — owner-scoped reads of calendar_blocks plus
 * the read-only job shoots that share the surface (§4A). Not a 'use server'
 * module; plain async helpers the page imports. The absolute start_at is
 * converted to civil 'YYYY-MM-DD' + 'HH:MM' in the viewer's zone here, so
 * the pure layout helpers in lib/calendar.ts never touch timezones.
 */

import { sql } from '@/lib/db';
import type { BlockType, BlockStatus } from '@/lib/calendar';

export interface CalendarItem {
  id: string;
  kind: 'block' | 'shoot';
  title: string;
  blockType: BlockType | null; // null for shoots
  /** Civil date 'YYYY-MM-DD' in the viewer's zone. */
  date: string;
  /** 'HH:MM' 24h, or null for an untimed all-day shoot. */
  startClock: string | null;
  durationMin: number;
  status: BlockStatus | null;
  notes: string | null;
  jobId: string | null;
  clientName: string | null; // for shoots
}

interface BlockRow {
  id: string;
  title: string;
  block_type: BlockType;
  notes: string | null;
  duration_min: number;
  status: BlockStatus;
  job_id: string | null;
  d: string; // civil date in zone
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
  const [blockRows, shootRows] = await Promise.all([
    sql<BlockRow>`
      SELECT id, title, block_type, notes, duration_min, status, job_id,
             to_char(start_at AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS d,
             to_char(start_at AT TIME ZONE ${zone}, 'HH24:MI')    AS t
      FROM calendar_blocks
      WHERE owner_id = ${ownerId}
        AND status <> 'canceled'
        AND (start_at AT TIME ZONE ${zone})::date BETWEEN ${fromDate}::date AND ${toDate}::date
      ORDER BY start_at`,
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

  const blocks: CalendarItem[] = blockRows.map((b) => ({
    id: b.id,
    kind: 'block',
    title: b.title,
    blockType: b.block_type,
    date: b.d,
    startClock: b.t,
    durationMin: b.duration_min,
    status: b.status,
    notes: b.notes,
    jobId: b.job_id,
    clientName: null,
  }));

  const shoots: CalendarItem[] = shootRows.map((s) => ({
    id: s.id,
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
  }));

  return [...blocks, ...shoots];
}
