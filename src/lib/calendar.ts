/**
 * Calendar domain — the pure core (Phase 6A of CALENDAR-AND-SYNC-PLAN.md).
 * No DB, no server imports; safe in client bundles and unit-tested hard.
 *
 * The accessibility north star (§0): a block has a concrete when. These
 * helpers exist to make the *when* easy to place and easy to read — the
 * day/week slot math and the dashboard 8-day glance grid.
 *
 * Date handling: layout works in CIVIL dates ('YYYY-MM-DD') and minutes-
 * since-midnight, never raw Date offsets, so the wall-calendar grid is
 * immune to timezone/DST drift. The server converts a block's absolute
 * start_at into the viewer's zone once, at load, and hands these helpers
 * civil values.
 */

export type BlockType = 'record' | 'edit' | 'post' | 'admin' | 'ten_percent' | 'other';
export type BlockStatus = 'planned' | 'done' | 'skipped' | 'canceled';

export const BLOCK_TYPE_LABEL: Record<BlockType, string> = {
  record: 'Record',
  edit: 'Edit',
  post: 'Post',
  admin: 'Admin',
  ten_percent: 'The 10%',
  other: 'Other',
};

/** Stable accent per type so the *kind* of work reads pre-cognitively,
 * the same dialect as workflow accents elsewhere. CSS vars where they fit;
 * literal hexes for the couple without a natural token. */
export const BLOCK_TYPE_COLOR: Record<BlockType, string> = {
  record: '#dc2626', // red — camera rolling
  edit: '#8b5cf6', // violet — post-production
  post: '#38bdf8', // brand cyan — publish / Seen
  admin: '#c9922a', // brand gold — desk work
  ten_percent: '#ec4899', // fuchsia — matches the 10% workflow accent
  other: '#94a3b8', // slate
};

export const BLOCK_TYPES = Object.keys(BLOCK_TYPE_LABEL) as BlockType[];

export function isBlockType(s: string): s is BlockType {
  return (BLOCK_TYPES as string[]).includes(s);
}

// ─── Civil-date helpers (no timezone math; 'YYYY-MM-DD' in, out) ──────

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Parse 'YYYY-MM-DD' to its UTC-noon Date (noon avoids any DST edge). */
function civilToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
/** Date → 'YYYY-MM-DD' (UTC fields, matching civilToDate). */
function dateToCivil(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** Civil date + n days → civil date. */
export function addDays(iso: string, n: number): string {
  const d = civilToDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return dateToCivil(d);
}
/** 0 (Sun) … 6 (Sat) for a civil date. */
export function weekdayIndex(iso: string): number {
  return civilToDate(iso).getUTCDay();
}
export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT[weekdayIndex(iso)];
}
export function weekdayLong(iso: string): string {
  return WEEKDAY_LONG[weekdayIndex(iso)];
}
/** Day-of-month number, e.g. 24. */
export function dayNum(iso: string): number {
  return civilToDate(iso).getUTCDate();
}

/** The Sunday on or before a civil date — the start of its calendar week. */
export function weekStart(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

/** The 7 civil dates Sun…Sat for the week containing `iso`. */
export function weekDays(iso: string): string[] {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// ─── The dashboard 8-day glance grid (§3.2) ───────────────────────────

export interface GlanceCell {
  /** 'YYYY-MM-DD' for any cell that maps to a real date (always, here). */
  date: string;
  weekdayShort: string;
  dayNum: number;
  /** In the today..+7 window? Out-of-window cells render dimmed. */
  inWindow: boolean;
  isToday: boolean;
}

/**
 * Build the 8-day glance: today + the next 7, laid out in true wall-calendar
 * weekday columns (Sun…Sat), spanning exactly two rows (2 × 7 = 14 cells).
 * Days before today in the first row are real dates but `inWindow=false`
 * (rendered dimmed) so every in-window day sits under the weekday column
 * you'd expect on a wall calendar.
 *
 * Example, today = Wed 2026-08-19:
 *   row 1: Sun16 Mon17 Tue18 [Wed19] Thu20 Fri21 Sat22   (16–18 out of window)
 *   row 2: Sun23 Mon24 Tue25 Wed26  · · ·                (26 is the +7th day; 27–29 out)
 * Exactly 8 cells (19→26) are inWindow.
 *
 * Pure: same `today` always yields the same grid.
 */
export function glanceGrid(today: string): GlanceCell[][] {
  const windowDates = new Set(Array.from({ length: 8 }, (_, i) => addDays(today, i)));
  const lastDay = addDays(today, 7);

  // Grid starts on the Sunday of today's week and runs 14 days (2 rows). The
  // window (today..+7) always fits inside those two weeks: today sits in row
  // 1, and +7 days lands at most on the same weekday in row 2.
  const gridStart = weekStart(today);
  const cells: GlanceCell[] = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(gridStart, i);
    return {
      date,
      weekdayShort: weekdayShort(date),
      dayNum: dayNum(date),
      inWindow: windowDates.has(date),
      isToday: date === today,
    };
  });

  // Safety: the window must be fully contained in the 14-cell grid. (It is,
  // for every weekday — proven by the test suite — but assert intent.)
  void lastDay;

  return [cells.slice(0, 7), cells.slice(7, 14)];
}

// ─── Day/week time-column layout ──────────────────────────────────────

/** Minutes since local midnight for a 'HH:MM' clock string. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** 'HH:MM' (24h) → a friendly '2:00pm'. */
export function clockLabel(hhmm: string): string {
  const min = minutesOfDay(hhmm);
  let h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

/** End clock for a start 'HH:MM' + duration minutes, as 'HH:MM' (clamped to
 * 23:59 so a block never visually spills past the day in the column view). */
export function endClock(startHHMM: string, durationMin: number): string {
  const end = Math.min(minutesOfDay(startHHMM) + durationMin, 24 * 60 - 1);
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

/** A block positioned in a day column: top offset + height in px, given a
 * pixels-per-hour scale and the day's start hour. Pure layout math. */
export function blockBox(
  startMinOfDay: number,
  durationMin: number,
  pxPerHour: number,
  dayStartHour = 0,
): { top: number; height: number } {
  const top = ((startMinOfDay - dayStartHour * 60) / 60) * pxPerHour;
  const height = Math.max((durationMin / 60) * pxPerHour, 18); // min legible height
  return { top, height };
}
