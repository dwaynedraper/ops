'use server';

/**
 * Ledger actions (Phase 5C) — log/delete expenses and mileage. Owner-scoped:
 * the signed-in user owns what they create; a super_admin can act on any row
 * (consistent with D-019). Mileage snapshots the current rate from
 * ledger_settings at entry, so a later rate change never rewrites history.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import { isExpenseCategory, mileageAmount } from '@/lib/ledger';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function orNull(s: string | undefined | null): string | null {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
}

async function requireUser(): Promise<{ userId: string; isAdmin: boolean } | { error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: 'Your session has expired — sign in again.' };
  return { userId, isAdmin: session.user?.role === 'super_admin' };
}

/** The current mileage rate, from ledger_settings (falls back to 0.725). */
export async function currentMileageRate(): Promise<number> {
  const row = await sqlOne<{ value: string }>`
    SELECT value FROM ledger_settings WHERE key = 'mileage_rate_per_mile'`;
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0.725;
}

export async function addExpense(input: {
  spentOn: string;
  vendor: string;
  amount: string;
  category: string;
  billable: boolean;
  note: string;
  jobId?: string | null;
}): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }
  if (!orNull(input.spentOn)) return { ok: false, error: 'Pick the date it was spent.' };
  const category = isExpenseCategory(input.category) ? input.category : 'general';

  try {
    await sql`
      INSERT INTO expenses (owner_id, job_id, spent_on, vendor, amount, category, billable, note)
      VALUES (${who.userId}, ${input.jobId ?? null}, ${input.spentOn}, ${orNull(input.vendor)},
              ${amount}, ${category}, ${input.billable}, ${orNull(input.note)})`;
    revalidatePath('/ledger');
    revalidatePath('/');
    if (input.jobId) revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not log the expense.') };
  }
}

export async function addMileage(input: {
  droveOn: string;
  purpose: string;
  miles: string;
  note: string;
  jobId?: string | null;
}): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };

  const miles = Number(input.miles);
  if (!Number.isFinite(miles) || miles <= 0) {
    return { ok: false, error: 'Enter miles greater than zero.' };
  }
  if (!orNull(input.droveOn)) return { ok: false, error: 'Pick the date you drove.' };

  const rate = await currentMileageRate();
  const amount = mileageAmount(miles, rate);

  try {
    await sql`
      INSERT INTO mileage_logs (owner_id, job_id, drove_on, purpose, miles, rate_per_mile, amount, note)
      VALUES (${who.userId}, ${input.jobId ?? null}, ${input.droveOn}, ${orNull(input.purpose)},
              ${miles}, ${rate}, ${amount}, ${orNull(input.note)})`;
    revalidatePath('/ledger');
    revalidatePath('/');
    if (input.jobId) revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not log the miles.') };
  }
}

export async function deleteExpense(input: { id: string }): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };
  try {
    if (who.isAdmin) {
      await sql`DELETE FROM expenses WHERE id = ${input.id}`;
    } else {
      await sql`DELETE FROM expenses WHERE id = ${input.id} AND owner_id = ${who.userId}`;
    }
    revalidatePath('/ledger');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not delete the expense.') };
  }
}

export async function deleteMileage(input: { id: string }): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };
  try {
    if (who.isAdmin) {
      await sql`DELETE FROM mileage_logs WHERE id = ${input.id}`;
    } else {
      await sql`DELETE FROM mileage_logs WHERE id = ${input.id} AND owner_id = ${who.userId}`;
    }
    revalidatePath('/ledger');
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not delete the mileage entry.') };
  }
}

/** Update the mileage rate (super-admin). Existing rows keep their snapshot. */
export async function setMileageRate(input: { rate: string }): Promise<ActionResult> {
  const who = await requireUser();
  if ('error' in who) return { ok: false, error: who.error };
  if (!who.isAdmin) return { ok: false, error: 'Only an admin can change the rate.' };

  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 5) {
    return { ok: false, error: 'Enter a sensible per-mile rate (e.g. 0.725).' };
  }
  try {
    await sql`
      UPDATE ledger_settings SET value = ${rate} WHERE key = 'mileage_rate_per_mile'`;
    revalidatePath('/ledger');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not update the rate.') };
  }
}
