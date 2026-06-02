/**
 * Pure block ↔ Google-event mapping (Phase 6C). No network, no secrets —
 * just the shape translation, which is where sync bugs actually hide.
 * Unit-tested hard. Verified against the Calendar API v3 events resource
 * (2026): start/end carry { dateTime, timeZone }; recurrence is an array of
 * 'RRULE:'-prefixed strings; a timed event needs both ends.
 */

export interface BlockForGoogle {
  title: string;
  notes: string | null;
  /** Civil 'YYYY-MM-DD' in the block's own zone. */
  date: string;
  /** 'HH:MM' 24h in the block's own zone. */
  startClock: string;
  durationMin: number;
  timeZone: string;
  /** Stored RRULE WITHOUT the 'RRULE:' prefix, or null for a one-off. */
  rrule: string | null;
}

export interface GoogleEventBody {
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  recurrence?: string[];
  /** Tags the event as ours, so inbound sync can tell Ops-origin events
   * apart from ones a human added straight into Google. */
  extendedProperties: { private: { opsBlock: 'true' } };
}

/** 'YYYY-MM-DD' + 'HH:MM' + minutes → ['startLocal','endLocal'] as naive
 * local datetime strings (no zone suffix — Google reads the timeZone field).
 * End rolls into following days if duration crosses midnight. */
export function localStartEnd(
  date: string,
  startClock: string,
  durationMin: number,
): { start: string; end: string } {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = startClock.split(':').map(Number);
  const startMins = h * 60 + mi;
  const endTotal = startMins + Math.max(1, durationMin);
  // Build local 'YYYY-MM-DDTHH:MM:SS' strings via UTC math on a date-only
  // anchor (no zone involved — these are wall-clock local times).
  const base = Date.UTC(y, mo - 1, d);
  const fmt = (totalMins: number): string => {
    const dt = new Date(base + totalMins * 60_000);
    return (
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}` +
      `T${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}:00`
    );
  };
  return { start: fmt(startMins), end: fmt(endTotal) };
}

/** Build the Google event body for a block. */
export function blockToGoogleEvent(b: BlockForGoogle): GoogleEventBody {
  const { start, end } = localStartEnd(b.date, b.startClock, b.durationMin);
  const body: GoogleEventBody = {
    summary: b.title,
    start: { dateTime: start, timeZone: b.timeZone },
    end: { dateTime: end, timeZone: b.timeZone },
    extendedProperties: { private: { opsBlock: 'true' } },
  };
  if (b.notes && b.notes.trim()) body.description = b.notes.trim();
  if (b.rrule) body.recurrence = [`RRULE:${b.rrule}`];
  return body;
}

/** Extract the bare RRULE (no prefix) from a Google recurrence array, or
 * null. Google may include EXDATE/RDATE lines too — we take the first RRULE
 * only (the subset Ops models; EXDATEs map to our skips table in 6C-2). */
export function rruleFromGoogle(recurrence: string[] | undefined | null): string | null {
  if (!recurrence) return null;
  for (const line of recurrence) {
    const m = /^RRULE:(.+)$/i.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}
