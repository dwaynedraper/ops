/**
 * Job domain types + pure helpers — the post-sale lifecycle core.
 *
 * No database, no server imports (mirrors lib/prospects.ts + lib/clients.ts)
 * so it's safe in client bundles. The owner-scoped loader lives in
 * lib/job-access.ts; the server actions under app/jobs + app/clients/[id].
 * See CLIENTS-AND-JOBS-PLAN.md.
 */

export type JobStage =
  | 'booked'
  | 'prep'
  | 'shoot'
  | 'cull'
  | 'edit'
  | 'deliver'
  | 'followup'
  | 'review'
  | 'complete'
  | 'cancelled';

export type PaymentStatus = 'unpaid' | 'deposit_paid' | 'paid';

export type JobRole = 'billing' | 'subject' | 'gallery_recipient' | 'other';

/** Human label for each lifecycle stage. */
export const JOB_STAGE_LABEL: Record<JobStage, string> = {
  booked: 'Booked',
  prep: 'Prep',
  shoot: 'Shoot',
  cull: 'Cull',
  edit: 'Edit',
  deliver: 'Deliver',
  followup: 'Follow-up',
  review: 'Review ask',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

/** The forward lifecycle, in order — drives the stage rail. `complete`
 * and `cancelled` are terminal and sit outside the rail. */
export const JOB_STAGE_FLOW: JobStage[] = [
  'booked',
  'prep',
  'shoot',
  'cull',
  'edit',
  'deliver',
  'followup',
  'review',
];

/**
 * Stage moves allowed from each stage. The rep can always step forward to
 * the next stage, jump to `complete` from the back half, or `cancel` from
 * any live stage. Reopening a completed/cancelled job returns it to
 * `booked` so the history (job_stage_events) records the reopen.
 */
export const JOB_STAGE_NEXT: Record<JobStage, JobStage[]> = {
  booked: ['prep', 'cancelled'],
  prep: ['shoot', 'cancelled'],
  shoot: ['cull', 'cancelled'],
  cull: ['edit', 'cancelled'],
  edit: ['deliver', 'cancelled'],
  deliver: ['followup', 'complete', 'cancelled'],
  followup: ['review', 'complete', 'cancelled'],
  review: ['complete', 'cancelled'],
  complete: ['booked'],
  cancelled: ['booked'],
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  deposit_paid: 'Deposit paid',
  paid: 'Paid in full',
};

export const JOB_ROLE_LABEL: Record<JobRole, string> = {
  billing: 'Billing / payer',
  subject: 'Subject',
  gallery_recipient: 'Gallery recipient',
  other: 'Other',
};

/** Short, plain description of what each role is *for* — shown in the UI. */
export const JOB_ROLE_HINT: Record<JobRole, string> = {
  billing: 'Who gets the invoice when it isn’t the main contact.',
  subject: 'Who or what is in front of the lens.',
  gallery_recipient: 'Who gets to view, choose, and download.',
  other: 'Scheduler, decision-maker, referrer — labelled.',
};

/** True once a job has reached a terminal stage. */
export function isJobClosed(stage: JobStage): boolean {
  return stage === 'complete' || stage === 'cancelled';
}

/**
 * The current step's position for the rail, 1-based, or 0 for a terminal
 * stage. `shoot` → 3 of 8, etc.
 */
export function jobStageIndex(stage: JobStage): number {
  const i = JOB_STAGE_FLOW.indexOf(stage);
  return i < 0 ? 0 : i + 1;
}

/** Label for the button that advances to a given stage. */
export function jobStageActionLabel(stage: JobStage): string {
  switch (stage) {
    case 'complete':
      return 'Mark complete';
    case 'cancelled':
      return 'Cancel job';
    case 'booked':
      return 'Reopen (back to Booked)';
    default:
      return `Move to ${JOB_STAGE_LABEL[stage]}`;
  }
}

/**
 * A job is "needs scheduling" when it's booked/prep with no shoot date —
 * a small signal the dashboard surfaces in Phase 3.
 */
export function needsShootDate(stage: JobStage, shootDate: string | null): boolean {
  return !shootDate && (stage === 'booked' || stage === 'prep');
}

/** A job row as the board / history list renders it (server pre-formats). */
export interface JobListItem {
  id: string;
  clientId: string;
  clientName: string | null;
  title: string | null;
  stage: JobStage;
  workflowKey: string | null;
  workflowName: string | null;
  workflowAccent: string | null;
  shootDateLabel: string | null;
  valuePrice: number | null;
  paymentStatus: PaymentStatus;
  updatedAtLabel: string;
}
