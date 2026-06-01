/**
 * Cash aggregation (Phase 5B of MONEY-AND-LEDGER-PLAN.md) — the numbers
 * behind the dashboard cash strip. Pure core + thin DB loader, same shape
 * as command-center.ts.
 *
 * The strip answers, at a glance: how much have I COLLECTED this month, how
 * much is OUTSTANDING (scheduled but not in), and — once the ledger lands
 * in 5C — how much went OUT. Plus the heartbeat: last money in, next
 * money expected. The "feel" rule lives in the UI; this just supplies
 * honest numbers and dates.
 */

import { sql } from '@/lib/db';

export interface CashStrip {
  /** Received in the current month window (refunds subtract). */
  collectedThisMonth: number;
  /** All still-expected payments across open jobs (not month-bound). */
  outstanding: number;
  /** Out this month — expenses + mileage. Zero until Phase 5C lands. */
  outThisMonth: number;
  /** Heartbeat: the most recent received payment. */
  lastIn: { date: string; label: string; amount: number } | null;
  /** Heartbeat: the soonest upcoming expected payment. */
  nextExpected: { date: string; label: string; amount: number } | null;
  /** True when there's no money activity at all to show. */
  empty: boolean;
}

/** First-of-month 'YYYY-MM-DD' in UTC for the given clock. */
function monthStart(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

interface SumRow {
  total: string | null;
}
interface HeartbeatRow {
  amount: string;
  on_date: string;
  client_name: string | null;
  title: string | null;
}

/**
 * Build the cash strip for the whole business as of `now`. Super-admin
 * surface — it sums across every job, not one owner's. (The dashboard
 * gates it to super_admin.)
 */
export async function computeCashStrip(now: Date = new Date()): Promise<CashStrip> {
  const mStart = monthStart(now);
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  const [collectedRows, outstandingRows, outRows, lastInRows, nextRows] = await Promise.all([
    // Collected this month: received rows dated this month, refunds subtract.
    sql<SumRow>`
      SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 0) AS total
      FROM job_payments
      WHERE status = 'received' AND received_on >= ${mStart}::date`,
    // Outstanding: everything still expected, across non-cancelled jobs.
    sql<SumRow>`
      SELECT COALESCE(SUM(p.amount), 0) AS total
      FROM job_payments p
      JOIN jobs j ON j.id = p.job_id
      WHERE p.status = 'expected' AND j.stage <> 'cancelled'`,
    // Out this month: expenses + mileage dated this month (Phase 5C).
    sql<SumRow>`
      SELECT (
        COALESCE((SELECT SUM(amount) FROM expenses WHERE spent_on >= ${mStart}::date), 0) +
        COALESCE((SELECT SUM(amount) FROM mileage_logs WHERE drove_on >= ${mStart}::date), 0)
      ) AS total`,
    // Last money in — most recent received row, with who it was.
    sql<HeartbeatRow>`
      SELECT p.amount, p.received_on::text AS on_date,
             c.display_name AS client_name, j.title
      FROM job_payments p
      JOIN jobs j ON j.id = p.job_id
      LEFT JOIN clients c ON c.id = j.client_id
      WHERE p.status = 'received' AND p.received_on IS NOT NULL
      ORDER BY p.received_on DESC, p.created_at DESC
      LIMIT 1`,
    // Next money expected — soonest upcoming due date (today or later).
    sql<HeartbeatRow>`
      SELECT p.amount, p.due_on::text AS on_date,
             c.display_name AS client_name, j.title
      FROM job_payments p
      JOIN jobs j ON j.id = p.job_id
      LEFT JOIN clients c ON c.id = j.client_id
      WHERE p.status = 'expected' AND p.due_on IS NOT NULL
        AND p.due_on >= ${today}::date AND j.stage <> 'cancelled'
      ORDER BY p.due_on ASC
      LIMIT 1`,
  ]);

  const collectedThisMonth = Number(collectedRows[0]?.total ?? 0);
  const outstanding = Number(outstandingRows[0]?.total ?? 0);
  const outThisMonth = Number(outRows[0]?.total ?? 0);

  const label = (r: HeartbeatRow): string =>
    [r.client_name, r.title].filter(Boolean).join(' · ') || 'A job';

  const lastIn = lastInRows[0]
    ? { date: lastInRows[0].on_date, label: label(lastInRows[0]), amount: Number(lastInRows[0].amount) }
    : null;
  const nextExpected = nextRows[0]
    ? { date: nextRows[0].on_date, label: label(nextRows[0]), amount: Number(nextRows[0].amount) }
    : null;

  return {
    collectedThisMonth,
    outstanding,
    outThisMonth,
    lastIn,
    nextExpected,
    empty:
      collectedThisMonth === 0 &&
      outstanding === 0 &&
      outThisMonth === 0 &&
      !lastIn &&
      !nextExpected,
  };
}
