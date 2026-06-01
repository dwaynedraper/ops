/**
 * Books — the monthly close (Phase 5D of MONEY-AND-LEDGER-PLAN.md).
 *
 * Pulls a month's money events (income / expenses / mileage) for the Books
 * page and the Wave-export download routes. Super-admin only — it's the
 * whole-business close (the page and routes gate it). Each section maps to
 * Wave rows: income positive, expenses + mileage negative.
 */

import { sql } from '@/lib/db';
import type { WaveRow } from '@/lib/wave-export';

export interface BooksMonth {
  /** 'YYYY-MM'. */
  month: string;
  label: string; // "May 2026"
  start: string; // 'YYYY-MM-01'
  endExclusive: string; // first of next month
}

export interface IncomeLine {
  date: string;
  client: string | null;
  jobTitle: string | null;
  method: string | null;
  amount: number;
}
export interface ExpenseLine {
  date: string;
  vendor: string | null;
  category: string;
  amount: number;
  billable: boolean;
}
export interface MileageLine {
  date: string;
  purpose: string | null;
  miles: number;
  rate: number;
  amount: number;
}

export interface BooksData {
  month: BooksMonth;
  income: IncomeLine[];
  expenses: ExpenseLine[];
  mileage: MileageLine[];
  totals: { income: number; expenses: number; mileage: number; net: number };
}

/** Resolve a 'YYYY-MM' (or default: current month) into a window. */
export function resolveMonth(monthKey: string | null, now: Date = new Date()): BooksMonth {
  let y: number;
  let m: number; // 1-based
  const parsed = monthKey && /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (parsed) {
    y = Number(parsed[1]);
    m = Number(parsed[2]);
  } else {
    y = now.getUTCFullYear();
    m = now.getUTCMonth() + 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m)}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const endExclusive = `${ny}-${pad(nm)}-01`;
  const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${start}T00:00:00Z`),
  );
  return { month: `${y}-${pad(m)}`, label, start, endExclusive };
}

/** Shift a 'YYYY-MM' by ±n months, for the prev/next pickers. */
export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const idx = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

interface IncomeRow {
  received_on: string;
  client_name: string | null;
  title: string | null;
  method: string | null;
  amount: string;
  kind: string;
}
interface ExpenseRow {
  spent_on: string;
  vendor: string | null;
  category: string;
  amount: string;
  billable: boolean;
}
interface MileageRow {
  drove_on: string;
  purpose: string | null;
  miles: string;
  rate_per_mile: string;
  amount: string;
}

/** Load a month's books. The whole business — no owner filter (super-admin). */
export async function loadBooks(month: BooksMonth): Promise<BooksData> {
  const [incomeRows, expenseRows, mileageRows] = await Promise.all([
    sql<IncomeRow>`
      SELECT p.received_on::text, p.method, p.amount, p.kind,
             c.display_name AS client_name, j.title
      FROM job_payments p
      JOIN jobs j ON j.id = p.job_id
      LEFT JOIN clients c ON c.id = j.client_id
      WHERE p.status = 'received'
        AND p.received_on >= ${month.start}::date
        AND p.received_on <  ${month.endExclusive}::date
      ORDER BY p.received_on, p.created_at`,
    sql<ExpenseRow>`
      SELECT spent_on::text, vendor, category, amount, billable
      FROM expenses
      WHERE spent_on >= ${month.start}::date AND spent_on < ${month.endExclusive}::date
      ORDER BY spent_on, created_at`,
    sql<MileageRow>`
      SELECT drove_on::text, purpose, miles, rate_per_mile, amount
      FROM mileage_logs
      WHERE drove_on >= ${month.start}::date AND drove_on < ${month.endExclusive}::date
      ORDER BY drove_on, created_at`,
  ]);

  const income: IncomeLine[] = incomeRows.map((r) => ({
    date: r.received_on,
    client: r.client_name,
    jobTitle: r.title,
    method: r.method,
    // A refund is money out — flip its sign for the books.
    amount: r.kind === 'refund' ? -Number(r.amount) : Number(r.amount),
  }));
  const expenses: ExpenseLine[] = expenseRows.map((r) => ({
    date: r.spent_on,
    vendor: r.vendor,
    category: r.category,
    amount: Number(r.amount),
    billable: r.billable,
  }));
  const mileage: MileageLine[] = mileageRows.map((r) => ({
    date: r.drove_on,
    purpose: r.purpose,
    miles: Number(r.miles),
    rate: Number(r.rate_per_mile),
    amount: Number(r.amount),
  }));

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const incomeTotal = round2(income.reduce((s, r) => s + r.amount, 0));
  const expenseTotal = round2(expenses.reduce((s, r) => s + r.amount, 0));
  const mileageTotal = round2(mileage.reduce((s, r) => s + r.amount, 0));

  return {
    month,
    income,
    expenses,
    mileage,
    totals: {
      income: incomeTotal,
      expenses: expenseTotal,
      mileage: mileageTotal,
      net: round2(incomeTotal - expenseTotal - mileageTotal),
    },
  };
}

// ─── Wave-row builders (income +, expenses/mileage −) ─────────────────

export function incomeToWave(income: IncomeLine[]): WaveRow[] {
  return income.map((r) => ({
    date: r.date,
    description: [r.client, r.jobTitle].filter(Boolean).join(' - ') + (r.method ? ` (${r.method})` : '') || 'Payment',
    amount: r.amount,
  }));
}
export function expensesToWave(expenses: ExpenseLine[]): WaveRow[] {
  return expenses.map((r) => ({
    date: r.date,
    description: [r.vendor, r.category].filter(Boolean).join(' - ') || 'Expense',
    amount: -Math.abs(r.amount),
  }));
}
export function mileageToWave(mileage: MileageLine[]): WaveRow[] {
  return mileage.map((r) => ({
    date: r.date,
    description: `Mileage ${r.miles}mi @ ${r.rate}${r.purpose ? ` - ${r.purpose}` : ''}`,
    amount: -Math.abs(r.amount),
  }));
}
