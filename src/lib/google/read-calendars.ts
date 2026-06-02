/**
 * Read ALL the user's Google calendars as read-only context (Phase 6C-2).
 * Pulls every calendar in calendarList, then each one's events in the window
 * (singleEvents=true → Google expands recurrence into concrete instances),
 * and maps them to ExternalItems for the calendar views + dashboard glance.
 *
 * Network plumbing only — the shape mapping is the pure, tested external-map
 * module. Gated: returns [] when sync is unconfigured, so callers never guard.
 * Best-effort: any failure logs and returns what it has (often []), never
 * throws — external context must not break the page.
 */

import { getAccessToken, calendarSyncConfigured } from './auth';
import { mapGoogleEvent, type ExternalItem, type GoogleEventRaw } from './external-map';

const API = 'https://www.googleapis.com/calendar/v3';

interface CalListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  selected?: boolean;
  deleted?: boolean;
  accessRole?: string;
}

/** Which calendar id is our own "Sharp Sighted" one, so we skip it wholesale
 * (its events already render from calendar_blocks). Passed in by the caller,
 * which reads it from calendar_sync_state. */
export async function readExternalEvents(
  fromDate: string,
  toDate: string,
  zone: string,
  opsCalendarId: string | null,
): Promise<ExternalItem[]> {
  if (!calendarSyncConfigured()) return [];
  try {
    const token = await getAccessToken();
    if (!token) return [];

    const headers = { Authorization: `Bearer ${token}` };

    // 1. List the calendars the user can see.
    const listRes = await fetch(`${API}/users/me/calendarList`, { headers });
    if (!listRes.ok) {
      console.error('[ops] external calendars: list failed', listRes.status);
      return [];
    }
    const list = (await listRes.json()) as { items?: CalListEntry[] };
    const calendars = (list.items ?? []).filter((c) => !c.deleted && c.selected !== false);

    // events.list wants RFC3339 timeMin/timeMax; widen by a day each side so
    // all-day and edge events aren't clipped, then the views filter by date.
    const timeMin = `${fromDate}T00:00:00Z`;
    const timeMax = `${toDate}T23:59:59Z`;

    const perCalendar = await Promise.all(
      calendars.map(async (cal) => {
        const isOps = !!opsCalendarId && cal.id === opsCalendarId;
        if (isOps) return [] as ExternalItem[]; // skip our own calendar entirely
        const params = new URLSearchParams({
          singleEvents: 'true', // expand recurrence into instances
          orderBy: 'startTime',
          timeMin,
          timeMax,
          maxResults: '250',
        });
        const evRes = await fetch(
          `${API}/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers },
        );
        if (!evRes.ok) {
          console.error('[ops] external events fetch failed for', cal.id, evRes.status);
          return [] as ExternalItem[];
        }
        const data = (await evRes.json()) as { items?: GoogleEventRaw[] };
        const meta = {
          color: cal.backgroundColor ?? null,
          name: cal.summaryOverride || cal.summary || null,
          isOpsCalendar: false,
        };
        const items: ExternalItem[] = [];
        for (const ev of data.items ?? []) {
          const mapped = mapGoogleEvent(ev, zone, meta);
          // Final window clamp on the civil date (timeMin/Max were widened).
          if (mapped && mapped.date >= fromDate && mapped.date <= toDate) items.push(mapped);
        }
        return items;
      }),
    );

    return perCalendar.flat();
  } catch (err) {
    console.error('[ops] external calendars read failed:', err);
    return [];
  }
}
