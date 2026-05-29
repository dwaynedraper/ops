'use server';

/**
 * Contact page (was `/tracking` pre-F3 / D-046) server actions — the
 * contact cycle.
 *
 * The app drives the prospect's lifecycle stage; the rep never edits it
 * directly. Logging a touch advances qualified → contacting. Marking a
 * reply advances → responded. Closing out an exhausted cycle moves the
 * prospect to dormant. Every action is owner-checked: a partner can only
 * touch their own prospects (a super_admin can touch anyone's — D-019).
 */

import { revalidatePath } from 'next/cache';
import { sql, sqlOne } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import { loadOwnedProspect } from '@/lib/prospect-access';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Record a sent touch. Snapshots the filled message into prospect_contacts
 * so a later script edit can't rewrite history, and advances a qualified
 * prospect into the contacting stage.
 */
export async function logContact(input: {
  prospectId: string;
  stepKey: string;
  filledSubject: string;
  filledBody: string;
}): Promise<ActionResult> {
  const loaded = await loadOwnedProspect(input.prospectId);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const userId = loaded.userId;

  const script = await sqlOne<{ id: string; channel: string }>`
    SELECT id, channel FROM contact_scripts
    WHERE workflow_key = ${loaded.prospect.workflowKey}
      AND stage_key = ${input.stepKey} AND active = true`;
  if (!script) return { ok: false, error: 'That contact step is no longer active.' };

  const body = input.filledBody.trim();
  if (!body) return { ok: false, error: 'The message is empty — fill it in before sending.' };

  try {
    await sql`
      INSERT INTO prospect_contacts
        (prospect_id, created_by, step_key, channel, script_id,
         filled_subject, filled_body)
      VALUES
        (${input.prospectId}, ${userId}, ${input.stepKey}, ${script.channel},
         ${script.id}, ${input.filledSubject.trim() || null}, ${body})`;

    // App-driven stage: the first logged touch starts the contact cycle.
    if (loaded.prospect.stage === 'qualified') {
      await sql`UPDATE prospects SET stage = 'contacting' WHERE id = ${input.prospectId}`;
    }

    revalidatePath('/contact');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not log the contact.'),
    };
  }
}

/**
 * Mark that the agent replied to a logged touch. Advances the prospect to
 * the responded stage — the rep takes it to the client page from there.
 */
export async function markResponded(input: {
  prospectId: string;
  contactId: string;
}): Promise<ActionResult> {
  const loaded = await loadOwnedProspect(input.prospectId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  try {
    await sql`
      UPDATE prospect_contacts
      SET response_received = true, responded_at = now()
      WHERE id = ${input.contactId} AND prospect_id = ${input.prospectId}`;

    await sql`
      UPDATE prospects SET stage = 'responded'
      WHERE id = ${input.prospectId} AND stage IN ('qualified', 'contacting')`;

    revalidatePath('/contact');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not record the reply.'),
    };
  }
}

/**
 * Close out a prospect whose contact cycle ran its course with no reply.
 * Moves it to dormant so it leaves the active contact board.
 */
export async function closeOut(input: { prospectId: string }): Promise<ActionResult> {
  const loaded = await loadOwnedProspect(input.prospectId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  try {
    await sql`
      UPDATE prospects SET stage = 'dormant'
      WHERE id = ${input.prospectId} AND stage = 'contacting'`;

    revalidatePath('/contact');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not close out the prospect.'),
    };
  }
}
