/**
 * Money domain — dated payments on a job (Phase 5A of
 * MONEY-AND-LEDGER-PLAN.md). Pure core: no DB, no server imports, safe in
 * client bundles. The owner-scoped mutations live in app/jobs/[id]/actions
 * and app/jobs/actions; the loaders read these types.
 *
 * The keystone idea: a job's payment_status is a *derived cache*. The truth
 * is the set of dated payment rows. derivePaymentStatus is what every
 * mutation recomputes and writes back, so the board dots, dashboard money
 * lens, and rep-pulse revenue (all of which read the flag) stay correct —
 * and now reflect partials honestly.
 */

import type { PaymentStatus } from '@/lib/jobs';

export type PaymentKind = 'deposit' | 'balance' | 'payment' | 'refund';
export type PaymentRowStatus = 'expected' | 'received';

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  deposit: 'Deposit',
  balance: 'Balance',
  payment: 'Payment',
  refund: 'Refund',
};

export interface PaymentRow {
  id: string;
  kind: PaymentKind;
  /** Dollars. A refund is stored positive but counts negative to collected. */
  amount: number;
  status: PaymentRowStatus;
  /** 'YYYY-MM-DD' or null. */
  dueOn: string | null;
  receivedOn: string | null;
  method: string | null;
  note: string | null;
}

/** Net of received rows (refunds subtract). This is "collected" for a job. */
export function receivedTotal(rows: PaymentRow[]): number {
  return round2(
    rows
      .filter((r) => r.status === 'received')
      .reduce((s, r) => s + (r.kind === 'refund' ? -r.amount : r.amount), 0),
  );
}

/** Sum of still-expected rows. This is "outstanding" for a job. */
export function expectedTotal(rows: PaymentRow[]): number {
  return round2(
    rows.filter((r) => r.status === 'expected').reduce((s, r) => s + r.amount, 0),
  );
}

/**
 * Derive the denormalized jobs.payment_status from the payment rows + the
 * job's headline value. The rule, in plain terms:
 *   • nothing received            → unpaid
 *   • received covers the value   → paid   (value known and met)
 *   • everything expected is in   → paid   (no value set, nothing awaited)
 *   • some in, more to come       → deposit_paid
 */
export function derivePaymentStatus(
  rows: PaymentRow[],
  jobValue: number | null,
): PaymentStatus {
  const received = receivedTotal(rows);
  const expected = expectedTotal(rows);

  if (received <= 0) return 'unpaid';

  // If we know the headline value, "paid" means collected >= it.
  if (jobValue !== null && jobValue > 0) {
    return received + 0.005 >= jobValue ? 'paid' : 'deposit_paid';
  }

  // No value to compare against: paid once nothing is still expected.
  return expected <= 0 ? 'paid' : 'deposit_paid';
}

/** 0..1 fill for the paid ring: collected ÷ (job value, or total scheduled). */
export function paidFraction(rows: PaymentRow[], jobValue: number | null): number {
  const received = receivedTotal(rows);
  const denom =
    jobValue !== null && jobValue > 0 ? jobValue : received + expectedTotal(rows);
  if (denom <= 0) return received > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, received / denom));
}

/** The most recent received date across the rows, or null. */
export function lastReceivedOn(rows: PaymentRow[]): string | null {
  const dates = rows
    .filter((r) => r.status === 'received' && r.receivedOn)
    .map((r) => r.receivedOn as string)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** The soonest upcoming expected date across the rows, or null. */
export function nextExpectedOn(rows: PaymentRow[]): string | null {
  const dates = rows
    .filter((r) => r.status === 'expected' && r.dueOn)
    .map((r) => r.dueOn as string)
    .sort();
  return dates.length ? dates[0] : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
