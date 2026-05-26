'use server';

/**
 * Client page server actions.
 *
 * The client page is a prospect's home record: editable details, a notes
 * timeline, and the lifecycle stage. Every action is owner-checked via
 * loadOwnedProspect (a partner only touches their own; a super_admin any).
 * Stage moves are validated against STAGE_NEXT so the pipeline can't jump
 * to an arbitrary stage.
 */

import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import { loadOwnedProspect } from '@/lib/prospect-access';
import { STAGE_NEXT, type ProspectStage } from '@/lib/prospects';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Trim a free-text field; empty becomes NULL. */
function orNull(s: string): string | null {
  const t = s.trim();
  return t.length > 0 ? t : null;
}

/** Update the prospect's identity / contact details. */
export async function updateProspectDetails(input: {
  prospectId: string;
  contactName: string;
  orgName: string;
  email: string;
  phone: string;
  websiteUrl: string;
  socialUrl: string;
  marketArea: string;
}): Promise<ActionResult> {
  const loaded = await loadOwnedProspect(input.prospectId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const contactName = input.contactName.trim();
  if (!contactName) return { ok: false, error: 'The prospect needs a name.' };

  try {
    await sql`
      UPDATE prospects SET
        contact_name = ${contactName},
        org_name     = ${orNull(input.orgName)},
        email        = ${orNull(input.email)},
        phone        = ${orNull(input.phone)},
        website_url  = ${orNull(input.websiteUrl)},
        social_url   = ${orNull(input.socialUrl)},
        market_area  = ${orNull(input.marketArea)}
      WHERE id = ${input.prospectId}`;

    revalidatePath(`/prospects/${input.prospectId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not save the details.'),
    };
  }
}

/** Add a note. A pinned note is an evergreen fact; the rest is a timeline. */
export async function addNote(input: {
  prospectId: string;
  body: string;
  pinned: boolean;
}): Promise<ActionResult> {
  const loaded = await loadOwnedProspect(input.prospectId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const body = input.body.trim();
  if (!body) return { ok: false, error: 'Write something first.' };

  try {
    await sql`
      INSERT INTO prospect_notes (prospect_id, author_id, body, pinned)
      VALUES (${input.prospectId}, ${loaded.userId}, ${body}, ${input.pinned})`;

    revalidatePath(`/prospects/${input.prospectId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not add the note.'),
    };
  }
}

/** Pin or unpin a note. */
export async function setNotePinned(input: {
  prospectId: string;
  noteId: string;
  pinned: boolean;
}): Promise<ActionResult> {
  const loaded = await loadOwnedProspect(input.prospectId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  try {
    await sql`
      UPDATE prospect_notes SET pinned = ${input.pinned}
      WHERE id = ${input.noteId} AND prospect_id = ${input.prospectId}`;

    revalidatePath(`/prospects/${input.prospectId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not update the note.'),
    };
  }
}

/**
 * Move the prospect to a new lifecycle stage. The move must be allowed
 * from the current stage (STAGE_NEXT); signing also stamps signed_by_id.
 */
export async function advanceStage(input: {
  prospectId: string;
  nextStage: ProspectStage;
}): Promise<ActionResult> {
  const loaded = await loadOwnedProspect(input.prospectId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const allowed = STAGE_NEXT[loaded.prospect.stage] ?? [];
  if (!allowed.includes(input.nextStage)) {
    return { ok: false, error: 'That stage move isn’t allowed from here.' };
  }

  try {
    if (input.nextStage === 'signed') {
      await sql`
        UPDATE prospects SET stage = ${input.nextStage}, signed_by_id = ${loaded.userId}
        WHERE id = ${input.prospectId}`;
    } else {
      await sql`
        UPDATE prospects SET stage = ${input.nextStage}
        WHERE id = ${input.prospectId}`;
    }

    revalidatePath(`/prospects/${input.prospectId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not update the stage.'),
    };
  }
}
