'use server';

/**
 * Client page server actions — edit the durable record, run the notes
 * timeline, archive/restore. Every action is owner-checked through
 * loadOwnedClient (D-019), mirroring the prospect client-page actions.
 */

import { revalidatePath } from 'next/cache';
import { sql, sqlOne } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import { loadOwnedClient } from '@/lib/client-access';
import type { ClientKind, ClientBranch } from '@/lib/clients';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function orNull(s: string | undefined | null): string | null {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
}

export async function updateClientDetails(input: {
  clientId: string;
  kind: ClientKind;
  displayName: string;
  email: string;
  phone: string;
  marketArea: string;
  relationship: string;
  referralSource: string;
  branchAffinity: ClientBranch | '';
}): Promise<ActionResult> {
  const loaded = await loadOwnedClient(input.clientId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: 'The client needs a name.' };
  const kind: ClientKind = input.kind === 'org' ? 'org' : 'person';
  const branch = input.branchAffinity ? input.branchAffinity : null;

  try {
    await sql`
      UPDATE clients SET
        kind            = ${kind},
        display_name    = ${displayName},
        email           = ${orNull(input.email)},
        phone           = ${orNull(input.phone)},
        market_area     = ${orNull(input.marketArea)},
        relationship    = ${orNull(input.relationship)},
        referral_source = ${orNull(input.referralSource)},
        branch_affinity = ${branch}
      WHERE id = ${input.clientId}`;

    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not save the details.') };
  }
}

/** Add a note. A pinned note is an evergreen fact; the rest is a timeline. */
export async function addClientNote(input: {
  clientId: string;
  body: string;
  pinned: boolean;
}): Promise<ActionResult> {
  const loaded = await loadOwnedClient(input.clientId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const body = input.body.trim();
  if (!body) return { ok: false, error: 'Write something first.' };

  try {
    await sql`
      INSERT INTO client_notes (client_id, author_id, body, pinned)
      VALUES (${input.clientId}, ${loaded.userId}, ${body}, ${input.pinned})`;

    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not add the note.') };
  }
}

export async function setClientNotePinned(input: {
  clientId: string;
  noteId: string;
  pinned: boolean;
}): Promise<ActionResult> {
  const loaded = await loadOwnedClient(input.clientId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  try {
    await sql`
      UPDATE client_notes SET pinned = ${input.pinned}
      WHERE id = ${input.noteId} AND client_id = ${input.clientId}`;

    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not update the note.') };
  }
}

/** Archive (or restore) a client. Never deleted — kept forever (D-019). */
export async function setClientArchived(input: {
  clientId: string;
  archived: boolean;
}): Promise<ActionResult> {
  const loaded = await loadOwnedClient(input.clientId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  try {
    await sql`
      UPDATE clients SET status = ${input.archived ? 'archived' : 'active'}
      WHERE id = ${input.clientId}`;

    revalidatePath(`/clients/${input.clientId}`);
    revalidatePath('/clients');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not update the client.') };
  }
}

/**
 * Create a new job for a client and hand back its id (the caller routes to
 * /jobs/[id]). The returning-client → booking shortcut — no funnel. The
 * job's workflow defaults from the client's branch affinity when set, so
 * the embedded calculator opens on the right branch.
 */
export async function createJobForClient(input: {
  clientId: string;
  title?: string;
}): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const loaded = await loadOwnedClient(input.clientId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  try {
    // Pick the client's most natural workflow from its branch affinity:
    // the lowest sort_order active workflow on that branch. Null is fine —
    // the job page lets the rep set vocabulary/branch via the calculator.
    const branch = await sqlOne<{ branch_affinity: string | null }>`
      SELECT branch_affinity FROM clients WHERE id = ${input.clientId}`;
    const wf = branch?.branch_affinity
      ? await sqlOne<{ workflow_key: string }>`
          SELECT workflow_key FROM workflows
          WHERE active = true AND branch = ${branch.branch_affinity}
          ORDER BY sort_order LIMIT 1`
      : null;

    const title = (input.title ?? '').trim() || null;
    const created = await sqlOne<{ id: string }>`
      INSERT INTO jobs (client_id, workflow_key, owner_id, title, stage)
      VALUES (${input.clientId}, ${wf?.workflow_key ?? null}, ${loaded.userId}, ${title}, 'booked')
      RETURNING id`;
    if (!created) return { ok: false, error: 'Could not create the job.' };

    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true, jobId: created.id };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not create the job.') };
  }
}
