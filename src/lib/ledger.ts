/**
 * Ledger domain — expenses + mileage (Phase 5C of MONEY-AND-LEDGER-PLAN.md).
 * Pure core: types, the expense category list, and the mileage math. No DB,
 * no server imports.
 */

export type ExpenseCategory =
  | 'gear'
  | 'software'
  | 'travel'
  | 'props_wardrobe'
  | 'prints_products'
  | 'marketing'
  | 'fees'
  | 'general';

/** Category → human label. Also the order shown in the picker. The label
 * doubles as the Wave Description keyword so Wave's rules can auto-sort. */
export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  gear: 'Gear & equipment',
  software: 'Software & subscriptions',
  travel: 'Travel & lodging',
  props_wardrobe: 'Props & wardrobe',
  prints_products: 'Prints & products',
  marketing: 'Marketing & ads',
  fees: 'Fees & licenses',
  general: 'General',
};

export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[];

export function isExpenseCategory(s: string): s is ExpenseCategory {
  return (EXPENSE_CATEGORIES as string[]).includes(s);
}

/** Dollar value of a mileage entry: miles × rate, rounded to cents.
 * Pure + deterministic — the same numbers the server stores. */
export function mileageAmount(miles: number, ratePerMile: number): number {
  if (!Number.isFinite(miles) || !Number.isFinite(ratePerMile)) return 0;
  if (miles <= 0 || ratePerMile <= 0) return 0;
  return Math.round(miles * ratePerMile * 100) / 100;
}

export interface ExpenseItem {
  id: string;
  spentOn: string;            // 'YYYY-MM-DD'
  vendor: string | null;
  amount: number;
  category: ExpenseCategory;
  billable: boolean;
  note: string | null;
  jobId: string | null;
  jobLabel: string | null;    // client · title, when linked
}

export interface MileageItem {
  id: string;
  droveOn: string;            // 'YYYY-MM-DD'
  purpose: string | null;
  miles: number;
  ratePerMile: number;
  amount: number;
  note: string | null;
  jobId: string | null;
  jobLabel: string | null;
}

/** Per-job profitability: value collected/owed minus costs against it. */
export interface JobProfit {
  value: number | null;
  expenses: number;
  mileage: number;
  /** value − expenses − mileage (null value treated as 0 for the math,
   * but surfaced separately so the UI can say "no value set"). */
  net: number;
}

export function jobProfit(value: number | null, expenses: number, mileage: number): JobProfit {
  const base = value ?? 0;
  return {
    value,
    expenses: round2(expenses),
    mileage: round2(mileage),
    net: round2(base - expenses - mileage),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
