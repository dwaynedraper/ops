/**
 * Recurrence (Phase 6B · CALENDAR-AND-SYNC-PLAN.md). Pure core: build an
 * RRULE from the editor's friendly choices, parse one back, and expand a
 * recurring master into the concrete occurrence dates inside a window.
 *
 * Scope is deliberately the subset the editor emits — FREQ=DAILY|WEEKLY,
 * INTERVAL, BYDAY (weekly), and a COUNT or UNTIL end — stored as the same
 * RFC-5545 RRULE grammar Google Calendar uses, so Phase 6C sync is a
 * pass-through. We do NOT attempt full RFC-5545 (BYMONTHDAY, BYSETPOS,
 * etc.); an unrecognized rule simply yields the master's own date only,
 * never a crash. All date math is civil ('YYYY-MM-DD'), reusing the
 * timezone-safe helpers in lib/calendar.
 */

import { addDays, weekdayIndex } from '@/lib/calendar';

export type Freq = 'none' | 'daily' | 'weekly';

/** RFC-5545 weekday codes, Sun-indexed to match weekdayIndex (0=SU). */
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface Recurrence {
  freq: Freq;
  /** Every N days/weeks. 1 = every, 2 = every other, … */
  interval: number;
  /** Weekly only: weekday indices 0(Sun)–6(Sat). Empty → the master's day. */
  byDay: number[];
  /** End: after `count` occurrences, or on/before `until` (civil date), or
   * neither (open-ended). count wins if both somehow set. */
  count: number | null;
  until: string | null;
}

export const NO_RECURRENCE: Recurrence = {
  freq: 'none',
  interval: 1,
  byDay: [],
  count: null,
  until: null,
};

/** Build an RRULE string, or null for a one-off. Mirrors Google's grammar. */
export function toRRule(r: Recurrence): string | null {
  if (r.freq === 'none') return null;
  const parts: string[] = [`FREQ=${r.freq.toUpperCase()}`];
  const interval = Math.max(1, Math.floor(r.interval) || 1);
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (r.freq === 'weekly' && r.byDay.length > 0) {
    const days = [...new Set(r.byDay)].sort((a, b) => a - b).map((d) => RRULE_DAYS[d]);
    parts.push(`BYDAY=${days.join(',')}`);
  }
  if (r.count && r.count > 0) {
    parts.push(`COUNT=${Math.floor(r.count)}`);
  } else if (r.until) {
    parts.push(`UNTIL=${r.until.replace(/-/g, '')}`); // RFC date form YYYYMMDD
  }
  return parts.join(';');
}

/** Parse an RRULE back into the editor shape. Unknown/empty → NO_RECURRENCE. */
export function fromRRule(rrule: string | null | undefined): Recurrence {
  if (!rrule) return { ...NO_RECURRENCE };
  const map = new Map<string, string>();
  for (const seg of rrule.split(';')) {
    const [k, v] = seg.split('=');
    if (k && v) map.set(k.toUpperCase().trim(), v.trim());
  }
  const freqRaw = (map.get('FREQ') ?? '').toUpperCase();
  const freq: Freq = freqRaw === 'DAILY' ? 'daily' : freqRaw === 'WEEKLY' ? 'weekly' : 'none';
  if (freq === 'none') return { ...NO_RECURRENCE };

  const interval = Math.max(1, parseInt(map.get('INTERVAL') ?? '1', 10) || 1);
  const byDay = (map.get('BYDAY') ?? '')
    .split(',')
    .map((d) => RRULE_DAYS.indexOf(d.trim() as (typeof RRULE_DAYS)[number]))
    .filter((i) => i >= 0);
  const count = map.has('COUNT') ? Math.max(1, parseInt(map.get('COUNT') as string, 10) || 1) : null;
  let until: string | null = null;
  const u = map.get('UNTIL');
  if (u) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(u);
    if (m) until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return { freq, interval, byDay, count, until: count ? null : until };
}

/**
 * Expand a recurring master into the occurrence dates that fall within
 * [windowStart, windowEnd] (inclusive, civil dates). `startDate` is the
 * master's own first occurrence. `skips` are EXDATEs to omit. A non-
 * recurring master yields just its own date (if in window).
 *
 * Bounded + safe: never emits before startDate, respects COUNT/UNTIL, and
 * hard-caps iterations so a malformed rule can't loop forever.
 */
export function expandOccurrences(
  startDate: string,
  rrule: string | null | undefined,
  windowStart: string,
  windowEnd: string,
  skips: Set<string> = new Set(),
): string[] {
  const r = fromRRule(rrule);

  // One-off (or unrecognized): the master's own date, if in window + not skipped.
  if (r.freq === 'none') {
    return startDate >= windowStart && startDate <= windowEnd && !skips.has(startDate)
      ? [startDate]
      : [];
  }

  const out: string[] = [];
  const HARD_CAP = 1000; // safety; far beyond any sane window
  let emitted = 0; // counts toward COUNT (every generated occurrence, even pre-window)
  let iters = 0;

  if (r.freq === 'daily') {
    let cur = startDate;
    while (iters++ < HARD_CAP) {
      if (r.count && emitted >= r.count) break;
      if (r.until && cur > r.until) break;
      if (cur > windowEnd) break;
      if (cur >= windowStart && cur >= startDate && !skips.has(cur)) out.push(cur);
      emitted += 1;
      cur = addDays(cur, Math.max(1, r.interval));
    }
    return out;
  }

  // weekly: walk week-by-week from the start's week; within each active week
  // emit the selected weekdays (default: the master's own weekday).
  const days = r.byDay.length > 0 ? [...new Set(r.byDay)].sort((a, b) => a - b) : [weekdayIndex(startDate)];
  const startW = addDays(startDate, -weekdayIndex(startDate)); // Sunday of start week
  let weekSunday = startW;
  while (iters++ < HARD_CAP) {
    if (weekSunday > windowEnd) break;
    let weekOver = false;
    for (const d of days) {
      const occ = addDays(weekSunday, d);
      if (occ < startDate) continue; // never before the master's first date
      if (r.count && emitted >= r.count) { weekOver = true; break; }
      if (r.until && occ > r.until) { weekOver = true; break; }
      emitted += 1;
      if (occ >= windowStart && occ <= windowEnd && !skips.has(occ)) out.push(occ);
    }
    if (weekOver) break;
    if (r.count && emitted >= r.count) break;
    weekSunday = addDays(weekSunday, 7 * Math.max(1, r.interval));
  }
  return out.filter((d) => d <= windowEnd).sort();
}

/** A short human summary for the editor + chips: "Every Tue", "Every 2 weeks". */
export function recurrenceSummary(r: Recurrence): string {
  if (r.freq === 'none') return 'Does not repeat';
  const every = r.interval > 1 ? `Every ${r.interval} ` : 'Every ';
  if (r.freq === 'daily') return r.interval > 1 ? `${every}days` : 'Every day';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayList = r.byDay.length > 0 ? [...r.byDay].sort((a, b) => a - b).map((d) => names[d]).join(', ') : '';
  const base = r.interval > 1 ? `${every}weeks` : 'Every week';
  const tail = dayList ? ` on ${dayList}` : '';
  const end = r.count ? `, ${r.count}×` : r.until ? `, until ${r.until}` : '';
  return `${base}${tail}${end}`;
}
