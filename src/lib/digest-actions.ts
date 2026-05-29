'use server';

/**
 * Digest preference server action. F12 moved this out of
 * `/today/actions.ts` when `/today` merged into the Dashboard
 * (D-063). The action itself didn't change; only its location did.
 * The page-level `revalidatePath` now points at `/` instead of
 * `/today`.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { actionError } from '@/lib/action-error';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Turn the morning digest email on or off for the signed-in rep. */
export async function setDigestOptIn(enabled: boolean): Promise<ActionResult> {
  const session = await auth();
  const user = session?.user;
  if (!user) return { ok: false, error: 'Your session has expired — sign in again.' };

  try {
    await sql`
      UPDATE ops_profiles SET digest_email = ${enabled}
      WHERE user_id = ${user.id}`;
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not save your preference.'),
    };
  }
}
