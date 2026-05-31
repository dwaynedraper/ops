'use server';

/**
 * Job page server actions — scheduling, payment, delivery, the lifecycle
 * stage rail, and the roles editor. Every action is owner-checked through
 * loadOwnedJob (D-019). Stage moves validate against JOB_STAGE_NEXT so the
 * lifecycle can't jump arbitrarily; the trigger logs each move.
 */

import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import { loadOwnedJob } from '@/lib/job-access';
import { JOB_STAGE_NEXT, type JobStage, type PaymentStatus, type JobRole } from '@/lib/jobs';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function orNull(s: string | undefined | null): string | null {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
}

/** Scheduling + delivery + value + notes — the editable job details. */
export async function updateJobDetails(input: {
  jobId: string;
  title: string;
  shootDate: string;
  location: string;
  deliveryDue: string;
  valuePrice: string;
  notes: string;
}): Promise<ActionResult> {
  const loaded = await loadOwnedJob(input.jobId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  // Empty string → NULL; a parsed number for value (guard against junk).
  const rawValue = input.valuePrice.trim();
  const value = rawValue === '' ? null : Number(rawValue);
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    return { ok: false, error: 'Value has to be a positive number.' };
  }

  try {
    await sql`
      UPDATE jobs SET
        title        = ${orNull(input.title)},
        shoot_date   = ${orNull(input.shootDate)},
        location     = ${orNull(input.location)},
        delivery_due = ${orNull(input.deliveryDue)},
        value_price  = ${value},
        notes        = ${orNull(input.notes)}
      WHERE id = ${input.jobId}`;

    revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not save the job.') };
  }
}

/** Move the job to a new lifecycle stage (validated against JOB_STAGE_NEXT).
 * Reaching `deliver`→done stamps delivered_at; `review` stamps the ask. */
export async function advanceJobStage(input: {
  jobId: string;
  nextStage: JobStage;
}): Promise<ActionResult> {
  const loaded = await loadOwnedJob(input.jobId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const allowed = JOB_STAGE_NEXT[loaded.job.stage] ?? [];
  if (!allowed.includes(input.nextStage)) {
    return { ok: false, error: 'That stage move isn’t allowed from here.' };
  }

  try {
    if (input.nextStage === 'deliver') {
      await sql`
        UPDATE jobs SET stage = 'deliver', delivered_at = COALESCE(delivered_at, now())
        WHERE id = ${input.jobId}`;
    } else if (input.nextStage === 'review') {
      await sql`
        UPDATE jobs SET stage = 'review', review_requested_at = COALESCE(review_requested_at, now())
        WHERE id = ${input.jobId}`;
    } else {
      await sql`UPDATE jobs SET stage = ${input.nextStage} WHERE id = ${input.jobId}`;
    }

    revalidatePath(`/jobs/${input.jobId}`);
    revalidatePath('/jobs');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not update the stage.') };
  }
}

export async function setJobPayment(input: {
  jobId: string;
  paymentStatus: PaymentStatus;
}): Promise<ActionResult> {
  const loaded = await loadOwnedJob(input.jobId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const valid: PaymentStatus[] = ['unpaid', 'deposit_paid', 'paid'];
  if (!valid.includes(input.paymentStatus)) {
    return { ok: false, error: 'Unknown payment status.' };
  }

  try {
    await sql`
      UPDATE jobs SET payment_status = ${input.paymentStatus} WHERE id = ${input.jobId}`;
    revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not update payment.') };
  }
}

/** Attach an additional party (a durable client) to the job in a role. */
export async function addJobRole(input: {
  jobId: string;
  clientId: string;
  role: JobRole;
  roleLabel: string;
}): Promise<ActionResult> {
  const loaded = await loadOwnedJob(input.jobId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const valid: JobRole[] = ['billing', 'subject', 'gallery_recipient', 'other'];
  if (!valid.includes(input.role)) return { ok: false, error: 'Unknown role.' };

  try {
    // The referenced client must be visible to this rep (owner or admin) —
    // reuse the same gate so you can't attach someone else's record.
    const { loadOwnedClient } = await import('@/lib/client-access');
    const target = await loadOwnedClient(input.clientId);
    if ('error' in target) return { ok: false, error: target.error };

    await sql`
      INSERT INTO job_roles (job_id, client_id, role, role_label)
      VALUES (${input.jobId}, ${input.clientId}, ${input.role}, ${orNull(input.roleLabel)})
      ON CONFLICT (job_id, client_id, role) DO UPDATE SET role_label = EXCLUDED.role_label`;

    revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not add the role.') };
  }
}

export async function removeJobRole(input: {
  jobId: string;
  roleId: string;
}): Promise<ActionResult> {
  const loaded = await loadOwnedJob(input.jobId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  try {
    await sql`DELETE FROM job_roles WHERE id = ${input.roleId} AND job_id = ${input.jobId}`;
    revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not remove the role.') };
  }
}
