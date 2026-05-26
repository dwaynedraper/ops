'use server';

/**
 * Rates editor server action.
 *
 * `publishGlobals` commits the pricing_globals rate table. Super-admin
 * only — pricing config is locked to the top role (D-014). Edits live in
 * the page's local draft until this runs (D-012).
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { actionError } from '@/lib/action-error';

export interface RatesResult {
  ok: boolean;
  error?: string;
}

export async function publishGlobals(
  updates: { key: string; value: number }[],
): Promise<RatesResult> {
  const session = await auth();
  if (session?.user?.role !== 'super_admin') {
    return { ok: false, error: 'Only a super-admin can change pricing rates.' };
  }

  for (const u of updates) {
    if (typeof u.value !== 'number' || !Number.isFinite(u.value) || u.value < 0) {
      return { ok: false, error: `“${u.key}” needs a number of 0 or more.` };
    }
  }

  try {
    for (const u of updates) {
      await sql`UPDATE pricing_globals SET value = ${u.value} WHERE key = ${u.key}`;
    }
    revalidatePath('/rates');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not publish the rates.'),
    };
  }
}
