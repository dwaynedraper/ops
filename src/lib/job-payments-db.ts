/**
 * Server-side payment helpers shared by the job-page actions and the board
 * quick-toggle. NOT a 'use server' module — plain async helpers imported by
 * the action files (same shape as lib/prospect-access.ts).
 *
 * The one rule everything funnels through: after any change to a job's
 * payment rows, recompute jobs.payment_status from those rows so the
 * denormalized cache the rest of the app reads (board dots, dashboard money
 * lens, rep-pulse revenue) stays truthful. derivePaymentStatus is the pure
 * core in lib/money.ts; this is the DB side.
 */

import type { PoolClient } from 'pg';
import { getPool, sql } from '@/lib/db';
import { derivePaymentStatus, type PaymentRow } from '@/lib/money';

interface PaymentDbRow {
  id: string;
  kind: PaymentRow['kind'];
  amount: string;
  status: PaymentRow['status'];
  due_on: string | null;
  received_on: string | null;
  method: string | null;
  note: string | null;
}

const isoDate = (d: string | null): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

function toPaymentRow(r: PaymentDbRow): PaymentRow {
  return {
    id: r.id,
    kind: r.kind,
    amount: Number(r.amount),
    status: r.status,
    dueOn: isoDate(r.due_on),
    receivedOn: isoDate(r.received_on),
    method: r.method,
    note: r.note,
  };
}

/** Load a job's payment rows (newest activity first), coerced. */
export async function loadJobPayments(jobId: string): Promise<PaymentRow[]> {
  const rows = await sql<PaymentDbRow>`
    SELECT id, kind, amount, status, due_on, received_on, method, note
    FROM job_payments
    WHERE job_id = ${jobId}
    ORDER BY COALESCE(received_on, due_on) DESC NULLS LAST, created_at DESC`;
  return rows.map(toPaymentRow);
}

/**
 * Recompute and persist jobs.payment_status from the job's current payment
 * rows. Runs inside the caller's transaction when a PoolClient is passed
 * (so the row write and cache update commit together), otherwise as three
 * standalone statements. Returns the derived status.
 */
export async function recomputePaymentStatus(
  jobId: string,
  dbc?: PoolClient,
): Promise<'unpaid' | 'deposit_paid' | 'paid'> {
  let rowsRaw: PaymentDbRow[];
  let valuePrice: string | null;

  if (dbc) {
    rowsRaw = (
      await dbc.query<PaymentDbRow>(
        `SELECT id, kind, amount, status, due_on, received_on, method, note
         FROM job_payments WHERE job_id = $1`,
        [jobId],
      )
    ).rows;
    valuePrice =
      (await dbc.query<{ value_price: string | null }>(`SELECT value_price FROM jobs WHERE id = $1`, [jobId]))
        .rows[0]?.value_price ?? null;
  } else {
    rowsRaw = await sql<PaymentDbRow>`
      SELECT id, kind, amount, status, due_on, received_on, method, note
      FROM job_payments WHERE job_id = ${jobId}`;
    const v = await sql<{ value_price: string | null }>`
      SELECT value_price FROM jobs WHERE id = ${jobId}`;
    valuePrice = v[0]?.value_price ?? null;
  }

  const jobValue = valuePrice == null ? null : Number(valuePrice);
  const status = derivePaymentStatus(rowsRaw.map(toPaymentRow), jobValue);

  if (dbc) {
    await dbc.query(`UPDATE jobs SET payment_status = $1 WHERE id = $2`, [status, jobId]);
  } else {
    await sql`UPDATE jobs SET payment_status = ${status} WHERE id = ${jobId}`;
  }
  return status;
}

/**
 * Mark a job paid-in-full from the board: collapse to fully-received by
 * adding a single received row for whatever value isn't yet collected,
 * dated today. If there's no headline value and nothing recorded, records
 * nothing and leaves the job unpaid (the board only offers this on jobs
 * with a value). Transactional with the status recompute.
 */
export async function markJobPaidInFull(jobId: string, userId: string): Promise<void> {
  const pool = getPool();
  const dbc = await pool.connect();
  try {
    await dbc.query('BEGIN');
    const { rows: jobRows } = await dbc.query<{ value_price: string | null }>(
      `SELECT value_price FROM jobs WHERE id = $1`,
      [jobId],
    );
    const value = jobRows[0]?.value_price == null ? null : Number(jobRows[0].value_price);
    const { rows: recvRows } = await dbc.query<{ received: string | null }>(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 0) AS received
       FROM job_payments WHERE job_id = $1 AND status = 'received'`,
      [jobId],
    );
    const received = Number(recvRows[0]?.received ?? 0);
    const remaining = value != null ? Math.round((value - received) * 100) / 100 : 0;

    if (remaining > 0) {
      await dbc.query(
        `INSERT INTO job_payments (job_id, kind, amount, status, received_on, created_by)
         VALUES ($1, 'payment', $2, 'received', CURRENT_DATE, $3)`,
        [jobId, remaining, userId],
      );
    }
    // Also flip any still-expected rows to received today, so "paid" is clean.
    await dbc.query(
      `UPDATE job_payments
       SET status = 'received', received_on = COALESCE(received_on, CURRENT_DATE)
       WHERE job_id = $1 AND status = 'expected'`,
      [jobId],
    );
    await recomputePaymentStatus(jobId, dbc);
    await dbc.query('COMMIT');
  } catch (err) {
    await dbc.query('ROLLBACK');
    throw err;
  } finally {
    dbc.release();
  }
}

/** Revert a job to unpaid from the board: drop its payment rows. */
export async function markJobUnpaid(jobId: string): Promise<void> {
  const pool = getPool();
  const dbc = await pool.connect();
  try {
    await dbc.query('BEGIN');
    await dbc.query(`DELETE FROM job_payments WHERE job_id = $1`, [jobId]);
    await recomputePaymentStatus(jobId, dbc);
    await dbc.query('COMMIT');
  } catch (err) {
    await dbc.query('ROLLBACK');
    throw err;
  } finally {
    dbc.release();
  }
}
