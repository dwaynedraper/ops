'use server';

/**
 * Jobs board — master-view quick actions (Phase 4).
 *
 * Deliberately lighter than the strict stage rail on the job page: these
 * are the "flip the status from the master list" controls Dean asked for —
 * mark a job sent (deliverables handed off in Sprout), finished, or paid,
 * in one click, without walking the lifecycle step by step. They bypass
 * JOB_STAGE_NEXT on purpose, but stay owner-checked (D-019) and only ever
 * move to a small set of safe targets.
 *
 * This intentionally does NOT do image delivery, payment processing, or
 * client email — Sprout Studio owns those. It only records status so the
 * Jobs board is an accurate master view.
 */

import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import { loadOwnedJob } from '@/lib/job-access';
import { markJobPaidInFull, markJobUnpaid } from '@/lib/job-payments-db';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Master-view status the board toggles between. */
export type QuickStatus = 'sent' | 'finished' | 'reopen';

/**
 * Quick-set a job's lifecycle status from the board.
 *   sent     → stage 'deliver' (stamps delivered_at) — handed off
 *   finished → stage 'complete'
 *   reopen   → stage 'deliver' (a finished job re-opens still-delivered)
 */
export async function quickSetJobStatus(input: {
  jobId: string;
  status: QuickStatus;
}): Promise<ActionResult> {
  const loaded = await loadOwnedJob(input.jobId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  // A cancelled job is parked — reopen it from the job page, not the board.
  if (loaded.job.stage === 'cancelled' && input.status !== 'reopen') {
    return { ok: false, error: 'This job is cancelled — reopen it from its page first.' };
  }

  try {
    if (input.status === 'finished') {
      await sql`UPDATE jobs SET stage = 'complete' WHERE id = ${input.jobId}`;
    } else {
      // sent + reopen both land on 'deliver', stamping delivered_at once.
      await sql`
        UPDATE jobs
        SET stage = 'deliver', delivered_at = COALESCE(delivered_at, now())
        WHERE id = ${input.jobId}`;
    }
    revalidatePath('/jobs');
    revalidatePath(`/jobs/${input.jobId}`);
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not update the job.') };
  }
}

/**
 * Toggle paid from the board. "Mark paid" now writes a real dated received
 * row (today) for whatever value isn't yet collected — so the cash strip,
 * heartbeat dates, and Wave export all see it — then recomputes the status
 * cache. Un-paying drops the job's payment rows. The job page keeps the
 * richer scheduling control; this is the fast master-view flip. No
 * processing, just the record.
 */
export async function quickSetJobPaid(input: {
  jobId: string;
  paid: boolean;
}): Promise<ActionResult> {
  const loaded = await loadOwnedJob(input.jobId);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  try {
    if (input.paid) {
      await markJobPaidInFull(input.jobId, loaded.userId);
    } else {
      await markJobUnpaid(input.jobId);
    }
    revalidatePath('/jobs');
    revalidatePath(`/jobs/${input.jobId}`);
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, 'Could not update payment.') };
  }
}
