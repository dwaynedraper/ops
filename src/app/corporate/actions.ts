'use server';

/**
 * Corporate formula editor server action.
 *
 * `publishCorporate` commits the corporate_pricing parameter table — the
 * inputs to the parametric corporate-headshots formula (D-013). Super-
 * admin only; edits are a local draft until this runs (D-012).
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

export interface CorporateResult {
  ok: boolean;
  error?: string;
}

export async function publishCorporate(
  updates: { key: string; value: number }[],
): Promise<CorporateResult> {
  const session = await auth();
  if (session?.user?.role !== 'super_admin') {
    return { ok: false, error: 'Only a super-admin can change corporate pricing.' };
  }

  for (const u of updates) {
    if (typeof u.value !== 'number' || !Number.isFinite(u.value) || u.value < 0) {
      return { ok: false, error: `“${u.key}” needs a number of 0 or more.` };
    }
  }

  try {
    for (const u of updates) {
      await sql`UPDATE corporate_pricing SET value = ${u.value} WHERE key = ${u.key}`;
    }
    revalidatePath('/corporate');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not publish corporate pricing.',
    };
  }
}
