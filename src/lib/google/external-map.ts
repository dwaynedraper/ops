/**
 * Pure mapping of a Google Calendar event → a read-only Ops calendar item
 * (Phase 6C-2). External events are *context* — Dean's whole life, shown so
 * he can plan work around it — never edited from Ops. No network here; the
 * fetch lives in read-calendars.ts. Tested hard.
 *
 * Google's events.list with singleEvents=true expands recurrence for us, so
 * each item is already a concrete instance. An event is either all-day
 * (start.date) or timed (start.dateTime); we normalize both to a civil date
 * + optional clock in the viewer's zone.
 */

export interface GoogleEventStart {
  date?: string; // 'YYYY-MM-DD' — all-day
  dateTime?: string; // RFC3339 — timed
  timeZone?: string;
}
export interface GoogleEventRaw {
  id: string;
  status?: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary?: string;
  start?: GoogleEventStart;
  end?: GoogleEventStart;
  transparency?: string; // 'transparent' = free/not-busy
  extendedProperties?: { private?: Record<string, string> };
}

export interface ExternalItem {
  id: string;
  title: string;
  /** Civil 'YYYY-MM-DD' in the viewer's zone. */
  date: string;
  /** 'HH:MM' 24h, or null for an all-day event. */
  startClock: string | null;
  durationMin: number;
  /** The source calendar's display color + name, for the UI. */
  calendarColor: string | null;
  calendarName: string | null;
  /** 'transparent' events (marked free) read even more muted. */
  busy: boolean;
}

/** Format an absolute instant to civil date + 'HH:MM' in a zone. Pure. */
export function instantToZoned(iso: string, zone: string): { date: string; clock: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = g('hour') === '24' ? '00' : g('hour');
  return { date: `${g('year')}-${g('month')}-${g('day')}`, clock: `${hour}:${g('minute')}` };
}

/** Minutes between two RFC3339 instants, floored at 0. */
function diffMinutes(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(0, Math.round(ms / 60_000));
}

/**
 * Map one Google event to an ExternalItem, or null if it shouldn't show
 * (cancelled, no start, or one of our own Ops-origin events — those already
 * render from the local table, so we'd double up).
 */
export function mapGoogleEvent(
  ev: GoogleEventRaw,
  zone: string,
  calendar: { color: string | null; name: string | null; isOpsCalendar: boolean },
): ExternalItem | null {
  if (ev.status === 'cancelled') return null;
  if (!ev.start) return null;
  // Skip our own events on the Sharp Sighted calendar — they're already
  // shown from calendar_blocks. The tag is written by event-map.ts.
  if (calendar.isOpsCalendar || ev.extendedProperties?.private?.opsBlock === 'true') return null;

  const title = ev.summary?.trim() || '(busy)';
  const busy = ev.transparency !== 'transparent';

  // All-day: start.date present, no time.
  if (ev.start.date) {
    return {
      id: ev.id,
      title,
      date: ev.start.date,
      startClock: null,
      durationMin: 0,
      calendarColor: calendar.color,
      calendarName: calendar.name,
      busy,
    };
  }

  // Timed.
  if (ev.start.dateTime) {
    const { date, clock } = instantToZoned(ev.start.dateTime, zone);
    const duration =
      ev.end?.dateTime ? diffMinutes(ev.start.dateTime, ev.end.dateTime) : 60;
    return {
      id: ev.id,
      title,
      date,
      startClock: clock,
      durationMin: duration,
      calendarColor: calendar.color,
      calendarName: calendar.name,
      busy,
    };
  }

  return null;
}
