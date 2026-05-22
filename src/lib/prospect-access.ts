/**
 * Prospect access check — shared by every server action that mutates a
 * prospect (tracking, the client page).
 *
 * Not a 'use server' module: it exports a plain async helper, imported by
 * the action files. Visibility rule (D-019): a partner may act only on
 * the prospects they own; a super_admin may act on anyone's.
 */

import { auth } from '@/auth';
import { sqlOne } from '@/lib/db';
import type { ProspectStage } from '@/lib/prospects';

export interface OwnedProspect {
  id: string;
  ownerId: string;
  stage: ProspectStage;
}

export type ProspectAccess =
  | { prospect: OwnedProspect; userId: string }
  | { error: string };

/**
 * Load a prospect and confirm the signed-in user may act on it. Returns
 * the prospect plus the acting user's id, or an `error` to hand straight
 * back to the caller.
 */
export async function loadOwnedProspect(prospectId: string): Promise<ProspectAccess> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Your session has expired — sign in again.' };

  const row = await sqlOne<{ owner_id: string; stage: ProspectStage }>`
    SELECT owner_id, stage FROM prospects WHERE id = ${prospectId}`;
  if (!row) return { error: 'That prospect is no longer in the pipeline.' };

  const isAdmin = session.user?.role === 'super_admin';
  if (row.owner_id !== userId && !isAdmin) {
    return { error: "That prospect isn't yours to work." };
  }

  return {
    prospect: { id: prospectId, ownerId: row.owner_id, stage: row.stage },
    userId,
  };
}
