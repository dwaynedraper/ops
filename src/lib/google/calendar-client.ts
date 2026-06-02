/**
 * Thin Google Calendar REST client (Phase 6C). Network plumbing only — the
 * shape translation (event-map) and auth (auth) are separate, pure-tested
 * modules. Every entry point returns null / no-ops when sync is unconfigured,
 * so a caller can always call without guarding.
 *
 * No SDK — direct fetch against the documented v3 REST endpoints, so there's
 * no dependency to install or keep current.
 */

import { getAccessToken, calendarSyncConfigured, readCreds } from './auth';
import type { GoogleEventBody } from './event-map';

const API = 'https://www.googleapis.com/calendar/v3';
const SHARP_CALENDAR_SUMMARY = 'Sharp Sighted';

async function authedFetch(path: string, init: RequestInit & { token: string }): Promise<Response> {
  const { token, ...rest } = init;
  return fetch(`${API}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(rest.headers ?? {}),
    },
  });
}

interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
}

/**
 * Find the dedicated "Sharp Sighted" calendar, or create it. Returns its id,
 * or null if sync isn't configured. An explicit GOOGLE_CALENDAR_ID wins
 * (lets Dean point at an existing calendar).
 */
export async function findOrCreateCalendar(): Promise<string | null> {
  if (!calendarSyncConfigured()) return null;
  const explicit = process.env.GOOGLE_CALENDAR_ID;
  if (explicit) return explicit;

  const token = await getAccessToken();
  if (!token) return null;

  const listRes = await authedFetch('/users/me/calendarList', { method: 'GET', token });
  if (listRes.ok) {
    const data = (await listRes.json()) as { items?: CalendarListEntry[] };
    const found = (data.items ?? []).find((c) => c.summary === SHARP_CALENDAR_SUMMARY);
    if (found) return found.id;
  }

  // Not found — create it.
  const creds = readCreds();
  const createRes = await authedFetch('/calendars', {
    method: 'POST',
    token,
    body: JSON.stringify({
      summary: SHARP_CALENDAR_SUMMARY,
      description: 'Sharp Sighted Ops — content blocks & shoots. Managed by Ops.',
      timeZone: 'America/Chicago',
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Could not create the Sharp Sighted calendar (${createRes.status}): ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { id: string };
  void creds;
  return created.id;
}

export interface UpsertResult {
  eventId: string;
  etag: string;
}

/** Insert a new event; returns its id + etag. */
export async function insertEvent(calendarId: string, body: GoogleEventBody): Promise<UpsertResult> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sync not configured.');
  const res = await authedFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google insert failed (${res.status}): ${await res.text()}`);
  const ev = (await res.json()) as { id: string; etag: string };
  return { eventId: ev.id, etag: ev.etag };
}

/** Patch an existing event (PATCH = partial update of the fields we send). */
export async function patchEvent(
  calendarId: string,
  eventId: string,
  body: GoogleEventBody,
): Promise<UpsertResult> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sync not configured.');
  const res = await authedFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', token, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`Google patch failed (${res.status}): ${await res.text()}`);
  const ev = (await res.json()) as { id: string; etag: string };
  return { eventId: ev.id, etag: ev.etag };
}

/** Delete an event. A 404/410 (already gone) is treated as success. */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sync not configured.');
  const res = await authedFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', token },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google delete failed (${res.status}): ${await res.text()}`);
  }
}
