'use server';

/**
 * Calendar block actions (Phase 6A) — create / edit / delete / set-status,
 * owner-scoped. A block is built from a civil date + 'HH:MM' clock + an IANA
 * zone; Postgres composes the absolute start_at so DST stays honest. On
 * create/change we fire an immediate confirmation email — the "it's real
 * now" receipt that makes the block concrete (§6). Recurrence (rrule) is
 * accepted now but the editor UI for it lands in 6B.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql, sqlOne, isUuid } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import { sendEmail, emailConfigured } from '@/lib/mailer';
import { isBlockType, clockLabel, endClock, type BlockStatus } from '@/lib/calendar';
import { syncBlockUpsert, syncBlockDelete } from '@/lib/google/sync-out';

export interface ActionResult {
  ok: boolean;
  id?: string;
  error?: string;
}

function orNull(s: string | undefined | null): string | null {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
}

async function requireUser(): Promise<{ userId: string; email: string | null; name: string } | { error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Your session has expired — sign in again.' };
  return {
    userId,
    email: session.user?.email ?? null,
    name: (session.user?.displayName ?? session.user?.name ?? session.user?.email ?? '').toString(),
  };
}

/** Friendly "Tue, Aug 24" from a civil 'YYYY-MM-DD'. */
function niceDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

async function confirmEmail(
  to: string | null,
  name: string,
  verb: string,
  title: string,
  date: string,
  startClock: string,
  durationMin: number,
): Promise<void> {
  if (!to || !emailConfigured()) return;
  const when = `${niceDate(date)}, ${clockLabel(startClock)}–${clockLabel(endClock(startClock, durationMin))}`;
  const first = name.split(/[\s@]/)[0] || 'there';
  try {
    await sendEmail({
      to,
      subject: `${verb}: ${title} — ${when}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1a1917;">
        <p>${first}, your time block is set.</p>
        <p style="font-size:18px;font-weight:bold;">${title}</p>
        <p style="font-size:16px;color:#c25f3e;"><strong>${when}</strong></p>
        <p style="color:#7a746c;font-size:13px;">It's on your Ops calendar. Stay Sharp. Stay Seen. Stay Human.</p>
      </div>`,
      text: `${first}, your time block is set.\n\n${title}\n${when}\n\nOn your Ops calendar.\nStay Sharp. Stay Seen. Stay Human.`,
    });
  } catch {
    // A failed confirmation email must never fail the save — the block is
    // already committed. (Same best-effort posture as the digest cron.)
  }
}

export async function createBlock(input: {
  title: string;
  blockType: string;
  date: string; // 'YYYY-MM-DD'
  startClock: string; // 'HH:MM'
  durationMin: number;
  notes?: string;
  jobId?: string | null;
  reminderMin?: number;
  timeZone?: string;
  rrule?: string | null;
}): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Give the block a title.' };
  if (!input.date || !input.startClock) return { ok: false, error: 'Pick a date and a start time.' };
  const blockType = isBlockType(input.blockType) ? input.blockType : 'other';
  const duration = Math.max(1, Math.floor(input.durationMin || 60));
  const zone = input.timeZone || 'America/Chicago';
  const reminder = Math.max(0, Math.floor(input.reminderMin ?? 30));
  const jobId = input.jobId && isUuid(input.jobId) ? input.jobId : null;
  const rrule = orNull(input.rrule);

  try {
    // Compose the absolute instant from civil date + clock in the zone.
    const row = await sqlOne<{ id: string }>`
      INSERT INTO calendar_blocks
        (owner_id, title, block_type, notes, start_at, duration_min, time_zone, job_id, reminder_min, rrule)
      VALUES (
        ${who.userId}, ${title}, ${blockType}, ${orNull(input.notes)},
        (${`${input.date} ${input.startClock}`}::timestamp AT TIME ZONE ${zone}),
        ${duration}, ${zone}, ${jobId}, ${reminder}, ${rrule}
      )
      RETURNING id`;

    await confirmEmail(who.email, who.name, 'Booked', title, input.date, input.startClock, duration);
    if (row?.id) await syncBlockUpsert(row.id); // best-effort → Google; never throws
    revalidatePath('/calendar');
    revalidatePath('/');
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not create the block.') };
  }
}

export async function updateBlock(input: {
  id: string;
  title: string;
  blockType: string;
  date: string;
  startClock: string;
  durationMin: number;
  notes?: string;
  reminderMin?: number;
  timeZone?: string;
  rrule?: string | null;
}): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };
  if (!isUuid(input.id)) return { ok: false, error: 'That block does not exist.' };

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Give the block a title.' };
  const blockType = isBlockType(input.blockType) ? input.blockType : 'other';
  const duration = Math.max(1, Math.floor(input.durationMin || 60));
  const zone = input.timeZone || 'America/Chicago';
  const reminder = Math.max(0, Math.floor(input.reminderMin ?? 30));
  const rrule = orNull(input.rrule);

  try {
    const res = await sql`
      UPDATE calendar_blocks SET
        title = ${title}, block_type = ${blockType}, notes = ${orNull(input.notes)},
        start_at = (${`${input.date} ${input.startClock}`}::timestamp AT TIME ZONE ${zone}),
        duration_min = ${duration}, time_zone = ${zone}, reminder_min = ${reminder},
        rrule = ${rrule}, reminder_sent_at = NULL
      WHERE id = ${input.id} AND owner_id = ${who.userId}`;
    void res;
    await confirmEmail(who.email, who.name, 'Updated', title, input.date, input.startClock, duration);
    await syncBlockUpsert(input.id); // best-effort → Google; never throws
    revalidatePath('/calendar');
    revalidatePath('/');
    return { ok: true, id: input.id };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not update the block.') };
  }
}

export async function setBlockStatus(input: { id: string; status: BlockStatus }): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };
  const valid: BlockStatus[] = ['planned', 'done', 'skipped', 'canceled'];
  if (!valid.includes(input.status)) return { ok: false, error: 'Unknown status.' };
  try {
    await sql`
      UPDATE calendar_blocks SET status = ${input.status}
      WHERE id = ${input.id} AND owner_id = ${who.userId}`;
    revalidatePath('/calendar');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not update the block.') };
  }
}

export async function deleteBlock(input: { id: string }): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };
  try {
    // Capture the Google twin id before the row goes, so we can delete it
    // upstream too. Owner-scoped so a rep can't read another's block.
    const twin = await sqlOne<{ google_event_id: string | null }>`
      SELECT google_event_id FROM calendar_blocks
      WHERE id = ${input.id} AND owner_id = ${who.userId}`;
    await sql`DELETE FROM calendar_blocks WHERE id = ${input.id} AND owner_id = ${who.userId}`;
    await syncBlockDelete(twin?.google_event_id ?? null); // best-effort; never throws
    revalidatePath('/calendar');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not delete the block.') };
  }
}

/**
 * Skip a single occurrence of a recurring series (an EXDATE) — "delete just
 * this one." The master + all other instances stay. Owner-checked via the
 * master's ownership. `occurrenceDate` is the civil 'YYYY-MM-DD' of the
 * instance being removed.
 */
export async function skipOccurrence(input: {
  masterId: string;
  occurrenceDate: string;
}): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };
  if (!isUuid(input.masterId)) return { ok: false, error: 'That block does not exist.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurrenceDate)) {
    return { ok: false, error: 'Bad occurrence date.' };
  }
  try {
    // Confirm the master is the rep's before writing a skip for it.
    const owned = await sqlOne<{ id: string }>`
      SELECT id FROM calendar_blocks WHERE id = ${input.masterId} AND owner_id = ${who.userId}`;
    if (!owned) return { ok: false, error: 'That block is not yours to edit.' };

    await sql`
      INSERT INTO calendar_block_skips (master_id, occurrence_date)
      VALUES (${input.masterId}, ${input.occurrenceDate})
      ON CONFLICT (master_id, occurrence_date) DO NOTHING`;
    revalidatePath('/calendar');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not skip that occurrence.') };
  }
}
