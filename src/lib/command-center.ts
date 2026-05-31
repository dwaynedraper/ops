/**
 * The Command Center — the job-side "what needs me today" engine.
 *
 * Phase 3 of CLIENTS-AND-JOBS-PLAN.md. The prospect side already has its
 * brief (lib/digest.ts — replies, follow-ups, close-outs). This module is
 * the *job* side: shoots coming up, deliveries due, balances owed, prints
 * to hand off, reviews to ask for. The Dashboard composes both; the cron
 * email carries a summary of both, so screen and inbox always agree.
 *
 * The pure core (evaluateJob, buildCommandSections) takes plain objects
 * and is unit-tested with no database — same discipline as lib/jobs.ts and
 * lib/prospects.ts. `computeCommandCenter` is the thin DB loader on top.
 *
 * Priority model (per the discovery interview — two signals dominate):
 *   • TIME-SENSITIVE / OVERDUE  — highest weight. A shoot almost here, a
 *     delivery past due, a balance past due, a deposit due.
 *   • GOING COLD                — a live job nobody has touched in a while.
 */

import { sql } from '@/lib/db';
import { isJobClosed, type JobStage, type PaymentStatus } from '@/lib/jobs';

// ─── Tunables (become admin-editable in Phase 4) ──────────────────────
export const SHOOT_SOON_DAYS = 2; // a shoot this close needs prep now
export const THIS_WEEK_DAYS = 7; // the "this week" shoot window
export const STALLED_DAYS = 14; // a live job untouched this long is cold
export const REVIEW_RIPE_DAYS = 3; // days after delivery a review-ask is ripe

// ─── Signal kinds, highest priority first ─────────────────────────────
export type JobSignalKind =
  | 'delivery_overdue'
  | 'shoot_today'
  | 'balance_overdue'
  | 'delivery_due_today'
  | 'shoot_soon'
  | 'deposit_due'
  | 'stalled'
  | 'review_ready';

export interface JobSignal {
  kind: JobSignalKind;
  /** Higher sorts first. Deadlines beat staleness beat housekeeping. */
  score: number;
  /** A plain, scannable reason. */
  label: string;
  /** Which dashboard section this signal drives. */
  section: 'needs_now' | 'money' | 'deliver';
}

/** The fields the engine reasons over. Display fields ride along so the
 * loader's joins (client name, workflow accent) reach the rows. */
export interface EvalJob {
  id: string;
  clientName: string | null;
  title: string | null;
  stage: JobStage;
  workflowName: string | null;
  workflowAccent: string | null;
  /** 'YYYY-MM-DD' or null. */
  shootDate: string | null;
  deliveryDue: string | null;
  balanceDue: string | null;
  depositDue: string | null;
  paymentStatus: PaymentStatus;
  valuePrice: number | null;
  /** ISO timestamp or null. */
  deliveredAt: string | null;
  reviewRequestedAt: string | null;
  /** ISO timestamp — last time the job changed. */
  updatedAt: string;
}

// ─── Date helpers — day granularity, UTC to match DATE columns ────────

/** Whole days from `now` to a 'YYYY-MM-DD' date. Negative = in the past.
 * Null date → null. */
export function daysUntil(date: string | null, now: Date): number | null {
  if (!date) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/** Whole days since an ISO timestamp (always ≥ 0 for past stamps). */
export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

// ─── The pure evaluator ───────────────────────────────────────────────

/** Stages where the shoot hasn't happened yet — prep still matters. */
const PRE_SHOOT: JobStage[] = ['booked', 'prep'];
/** Stages where delivery hasn't happened yet — a due date can be overdue. */
const PRE_DELIVERY: JobStage[] = ['booked', 'prep', 'shoot', 'cull', 'edit'];

/**
 * Every signal a single job is currently firing. Pure: same job + same
 * `now` always yields the same signals. A job can fire several (e.g. a
 * balance overdue AND a delivery due) — the dashboard takes the top one
 * for ranking and lists the rest as context.
 */
export function evaluateJob(job: EvalJob, now: Date): JobSignal[] {
  if (isJobClosed(job.stage)) return [];
  const out: JobSignal[] = [];

  const shootIn = daysUntil(job.shootDate, now);
  const deliverIn = daysUntil(job.deliveryDue, now);
  const balanceIn = daysUntil(job.balanceDue, now);
  const depositIn = daysUntil(job.depositDue, now);
  const idle = daysSince(job.updatedAt, now);
  const sinceDelivered = daysSince(job.deliveredAt, now);

  // Delivery overdue / due today — only while not yet delivered.
  if (deliverIn !== null && PRE_DELIVERY.includes(job.stage)) {
    if (deliverIn < 0) {
      out.push({
        kind: 'delivery_overdue',
        score: 120 + Math.min(-deliverIn, 30),
        label: `Delivery ${-deliverIn}d overdue`,
        section: 'needs_now',
      });
    } else if (deliverIn === 0) {
      out.push({
        kind: 'delivery_due_today',
        score: 95,
        label: 'Delivery due today',
        section: 'needs_now',
      });
    }
  }

  // Shoot today / soon — only while the shoot is still ahead.
  if (shootIn !== null && PRE_SHOOT.includes(job.stage)) {
    if (shootIn === 0) {
      out.push({ kind: 'shoot_today', score: 110, label: 'Shooting today', section: 'needs_now' });
    } else if (shootIn > 0 && shootIn <= SHOOT_SOON_DAYS) {
      out.push({
        kind: 'shoot_soon',
        score: 85,
        label: `Shoot in ${shootIn}d — prep it`,
        section: 'needs_now',
      });
    }
  }

  // Money — balance overdue, deposit due. Skipped once paid in full.
  if (job.paymentStatus !== 'paid') {
    if (balanceIn !== null && balanceIn <= 0) {
      out.push({
        kind: 'balance_overdue',
        score: 100 + (balanceIn < 0 ? Math.min(-balanceIn, 30) : 0),
        label: balanceIn < 0 ? `Balance ${-balanceIn}d overdue` : 'Balance due today',
        section: 'money',
      });
    }
    if (job.paymentStatus === 'unpaid' && depositIn !== null && depositIn <= 0) {
      out.push({
        kind: 'deposit_due',
        score: 70,
        label: depositIn < 0 ? `Deposit ${-depositIn}d overdue` : 'Deposit due today',
        section: 'money',
      });
    }
  }

  // Review-ask ripe — delivered a few days ago, not yet asked.
  if (
    !job.reviewRequestedAt &&
    sinceDelivered !== null &&
    sinceDelivered >= REVIEW_RIPE_DAYS &&
    (job.stage === 'deliver' || job.stage === 'followup' || job.stage === 'review')
  ) {
    out.push({
      kind: 'review_ready',
      score: 35,
      label: 'Ask for a review',
      section: 'deliver',
    });
  }

  // Going cold — a live job nobody has touched in a while, and it isn't
  // already flagged by a sharper deadline signal above.
  if (idle !== null && idle >= STALLED_DAYS && out.length === 0) {
    out.push({
      kind: 'stalled',
      score: 40 + Math.min(idle - STALLED_DAYS, 30),
      label: `Untouched ${idle}d`,
      section: 'needs_now',
    });
  }

  return out;
}

/** The single highest-priority signal for a job, or null if none. */
export function topSignal(signals: JobSignal[]): JobSignal | null {
  if (signals.length === 0) return null;
  return signals.reduce((best, s) => (s.score > best.score ? s : best));
}

// ─── Assembled sections (pure) ────────────────────────────────────────

export interface CommandRow {
  id: string;
  clientName: string | null;
  title: string | null;
  stage: JobStage;
  workflowName: string | null;
  workflowAccent: string | null;
  /** The driving reason (top signal's label), when in needs/deliver. */
  reason: string | null;
  /** Sort key — the top signal's score. */
  priority: number;
  shootDate: string | null;
  valuePrice: number | null;
  paymentStatus: PaymentStatus;
}

export interface CommandData {
  /** The prioritized "do this next" feed — overdue + urgent jobs. */
  needsNow: CommandRow[];
  /** Shoots inside the THIS_WEEK window, soonest first. */
  thisWeek: CommandRow[];
  /** Prints/galleries to hand off + reviews to ask for. */
  toDeliver: CommandRow[];
  /** Outstanding money: a total + the jobs behind it. */
  money: { outstanding: number; lines: CommandRow[] };
  /** Headline counts for the summary line + email. */
  counts: {
    needsNow: number;
    shootsThisWeek: number;
    toDeliver: number;
    outstanding: number;
  };
  allClear: boolean;
}

function rowFrom(job: EvalJob, reason: string | null, priority: number): CommandRow {
  return {
    id: job.id,
    clientName: job.clientName,
    title: job.title,
    stage: job.stage,
    workflowName: job.workflowName,
    workflowAccent: job.workflowAccent,
    reason,
    priority,
    shootDate: job.shootDate,
    valuePrice: job.valuePrice,
    paymentStatus: job.paymentStatus,
  };
}

/**
 * Bucket a set of jobs into the dashboard's sections. Pure — no DB, no
 * clock except the injected `now`. A job can appear in more than one
 * section (a different lens each), which is intended: the same shoot can be
 * "needs you now" and "this week," and an unpaid delivered job is both
 * "money" and (until asked) "to deliver."
 */
export function buildCommandSections(jobs: EvalJob[], now: Date): CommandData {
  const needsNow: CommandRow[] = [];
  const toDeliver: CommandRow[] = [];
  const moneyLines: CommandRow[] = [];
  const thisWeek: CommandRow[] = [];
  let outstanding = 0;

  for (const job of jobs) {
    if (isJobClosed(job.stage)) continue;
    const signals = evaluateJob(job, now);
    const top = topSignal(signals);

    const needsSignals = signals.filter((s) => s.section === 'needs_now');
    if (needsSignals.length > 0) {
      const t = topSignal(needsSignals)!;
      needsNow.push(rowFrom(job, t.label, t.score));
    }

    // Deliver lens: prints/gallery handoff (in 'deliver' stage) or a ripe
    // review-ask. One row, label favours the handoff.
    const reviewSig = signals.find((s) => s.kind === 'review_ready');
    if (job.stage === 'deliver') {
      toDeliver.push(rowFrom(job, 'Hand off prints / gallery', 60));
    } else if (reviewSig) {
      toDeliver.push(rowFrom(job, reviewSig.label, reviewSig.score));
    }

    // Money lens: anything with a value still owed.
    if (job.valuePrice !== null && job.paymentStatus !== 'paid') {
      const moneySig = signals.find((s) => s.section === 'money');
      const label =
        moneySig?.label ?? (job.paymentStatus === 'deposit_paid' ? 'Balance outstanding' : 'Unpaid');
      moneyLines.push(rowFrom(job, label, moneySig?.score ?? 50));
      // Only the unpaid full value is summed; a deposit-paid balance is an
      // unknown remainder, so we flag it without inventing a number.
      if (job.paymentStatus === 'unpaid') outstanding += job.valuePrice;
    }

    // This-week lens: shoots in the window, regardless of signals.
    const shootIn = daysUntil(job.shootDate, now);
    if (shootIn !== null && shootIn >= 0 && shootIn <= THIS_WEEK_DAYS) {
      thisWeek.push(rowFrom(job, top?.label ?? null, shootIn));
    }
  }

  needsNow.sort((a, b) => b.priority - a.priority);
  toDeliver.sort((a, b) => b.priority - a.priority);
  moneyLines.sort((a, b) => b.priority - a.priority);
  thisWeek.sort((a, b) => a.priority - b.priority); // soonest shoot first

  const counts = {
    needsNow: needsNow.length,
    shootsThisWeek: thisWeek.length,
    toDeliver: toDeliver.length,
    outstanding,
  };

  return {
    needsNow,
    thisWeek,
    toDeliver,
    money: { outstanding, lines: moneyLines },
    counts,
    allClear:
      needsNow.length === 0 &&
      thisWeek.length === 0 &&
      toDeliver.length === 0 &&
      moneyLines.length === 0,
  };
}

// ─── The DB loader ────────────────────────────────────────────────────

interface JobRow {
  id: string;
  client_name: string | null;
  title: string | null;
  stage: JobStage;
  workflow_name: string | null;
  accent: string | null;
  shoot_date: string | null;
  delivery_due: string | null;
  balance_due: string | null;
  deposit_due: string | null;
  payment_status: PaymentStatus;
  value_price: string | null;
  delivered_at: Date | null;
  review_requested_at: Date | null;
  updated_at: Date;
}

const isoDate = (d: string | Date | null): string | null => {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(`${d}T00:00:00Z`) : d;
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
};
const isoStamp = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

/**
 * One rep's Command Center as of `now`. Owner-scoped (D-019): only the
 * signed-in rep's jobs. A super_admin viewing their own dashboard sees
 * their own jobs here, same as the prospect digest.
 */
export async function computeCommandCenter(
  userId: string,
  now: Date = new Date(),
): Promise<CommandData> {
  const rows = await sql<JobRow>`
    SELECT j.id, j.title, j.stage, j.shoot_date, j.delivery_due, j.balance_due,
           j.deposit_due, j.payment_status, j.value_price, j.delivered_at,
           j.review_requested_at, j.updated_at,
           c.display_name AS client_name,
           w.name AS workflow_name, w.accent
    FROM jobs j
    LEFT JOIN clients c ON c.id = j.client_id
    LEFT JOIN workflows w ON w.workflow_key = j.workflow_key
    WHERE j.owner_id = ${userId}
      AND j.stage NOT IN ('complete', 'cancelled')`;

  const jobs: EvalJob[] = rows.map((r) => ({
    id: r.id,
    clientName: r.client_name,
    title: r.title,
    stage: r.stage,
    workflowName: r.workflow_name,
    workflowAccent: r.accent,
    shootDate: isoDate(r.shoot_date),
    deliveryDue: isoDate(r.delivery_due),
    balanceDue: isoDate(r.balance_due),
    depositDue: isoDate(r.deposit_due),
    paymentStatus: r.payment_status,
    valuePrice: r.value_price === null ? null : Number(r.value_price),
    deliveredAt: isoStamp(r.delivered_at),
    reviewRequestedAt: isoStamp(r.review_requested_at),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));

  return buildCommandSections(jobs, now);
}
