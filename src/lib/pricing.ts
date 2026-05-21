/**
 * Sharp Sighted Ops — cost-plus pricing methodology.
 *
 * Source of truth: /projects/sharp/docs/pricing-methodology.md and the
 * master pricing spreadsheet. This file ports the calculation rules into
 * code. When the spreadsheet methodology changes, change it here too.
 *
 * The rules in plain English:
 *
 *   1. Time cost   = hours × hourly rate (LP rate, or Saga premium)
 *   2. Hard cost   = print costs, frame costs, outsourced edit fees, etc.
 *   3. Cost basis  = time cost + hard cost
 *   4. Working price = cost basis × (1 + margin)
 *   5. Display price = ceil(working price / $100) × $100   (round up to nearest $100)
 *
 * Margins:
 *   - 30% default
 *   - 20% Photo Lessons override
 *
 * Rates:
 *   - $50/hr standard LP rate
 *   - $75/hr Saga premium
 *
 * The display price is what shows in the calculator. The "working price"
 * is what the methodology produces *before* round-up — useful for the
 * margin breakdown that admins see.
 */

// ─── Constants ─────────────────────────────────────────────────────────
export const LP_RATE_STANDARD = 50;     // $/hr
export const LP_RATE_SAGA     = 75;     // $/hr — Saga premium

export const MARGIN_DEFAULT       = 0.30;
export const MARGIN_PHOTO_LESSONS = 0.20;

export const ROUND_UP_STEP = 100;       // dollars

// ─── Types ─────────────────────────────────────────────────────────────
export interface PricingInputs {
  /** Hours of labor (LP time). */
  timeHours: number;
  /** $/hr. Defaults to LP_RATE_STANDARD. Use LP_RATE_SAGA for Saga. */
  lpRate?: number;
  /** Hard out-of-pocket cost (prints, frames, outsourced edit). */
  hardCost: number;
  /** Margin as a decimal (0.30 = 30%). Defaults to MARGIN_DEFAULT. */
  margin?: number;
}

export interface PricingBreakdown {
  timeCost: number;
  hardCost: number;
  costBasis: number;
  marginAmount: number;
  workingPrice: number;   // before round-up
  displayPrice: number;   // after round-up — what the customer sees
  margin: number;         // decimal used
  lpRate: number;         // $/hr used
}

// ─── Helpers ───────────────────────────────────────────────────────────
function roundUpTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.ceil(value / step) * step;
}

/**
 * Run the cost-plus methodology and return the full breakdown. Callers
 * pick which fields to surface — the calculator shows `displayPrice`;
 * the admin view also shows `costBasis` and `marginAmount`.
 */
export function priceFromCostBasis(inputs: PricingInputs): PricingBreakdown {
  const lpRate = inputs.lpRate ?? LP_RATE_STANDARD;
  const margin = inputs.margin ?? MARGIN_DEFAULT;
  const timeCost = roundCents(inputs.timeHours * lpRate);
  const hardCost = roundCents(inputs.hardCost);
  const costBasis = roundCents(timeCost + hardCost);
  const workingPrice = roundCents(costBasis * (1 + margin));
  const marginAmount = roundCents(workingPrice - costBasis);
  const displayPrice = roundUpTo(workingPrice, ROUND_UP_STEP);

  return {
    timeCost,
    hardCost,
    costBasis,
    marginAmount,
    workingPrice,
    displayPrice,
    margin,
    lpRate,
  };
}

/**
 * "Bonus profit" framing — used by the admin Simple View. Because LP
 * rate is Dean's wage (not pure cost), the working margin above isn't
 * really profit — it's wage + bonus. This decomposition makes that
 * explicit.
 *
 *   wage   = timeCost  (Dean got paid for his time)
 *   bonus  = displayPrice - costBasis - hardCostPassThrough
 *          = the rounded margin
 *   keep   = wage + bonus
 *
 * Hard cost passes through (we paid for it; it's not income).
 */
export interface AdminProfitView {
  wage: number;
  bonus: number;
  keep: number;
  hardCost: number;
  displayPrice: number;
}

export function adminProfitView(b: PricingBreakdown): AdminProfitView {
  const bonus = roundCents(b.displayPrice - b.costBasis);
  return {
    wage: b.timeCost,
    bonus,
    keep: roundCents(b.timeCost + bonus),
    hardCost: b.hardCost,
    displayPrice: b.displayPrice,
  };
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════════
// Worksheet model — cost lines + globals → price
//
// A package's price is computed from its worksheet rather than from flat
// inputs. The worksheet is a set of cost lines (time or hard) plus the
// global rate table. This section sums those into the PricingInputs the
// methodology above already consumes, so the two layers compose cleanly:
//
//   cost lines + globals  →  priceFromCostLines()  →  PricingBreakdown
// ═══════════════════════════════════════════════════════════════════════

/** Roles a time line can bill at. Each maps to a pricing_globals key. */
export type RateRole = 'lp' | 'lp_saga' | 'second_shooter' | 'pa' | 'xm';

/** rate_role → pricing_globals.key */
const RATE_ROLE_GLOBAL: Record<RateRole, string> = {
  lp: 'lp_rate',
  lp_saga: 'lp_saga_rate',
  second_shooter: 'second_shooter_rate',
  pa: 'pa_rate',
  xm: 'xm_rate',
};

export interface CostLine {
  kind: 'time' | 'hard';
  category: string;
  /** time lines only */
  hours?: number | null;
  /** time lines only */
  rateRole?: RateRole | null;
  /** hard lines only */
  amount?: number | null;
}

/** A resolved view of pricing_globals: key → numeric value. */
export type PricingGlobals = Record<string, number>;

export interface WorksheetResult extends PricingBreakdown {
  /** Sum of all time-line hours, regardless of role. */
  totalHours: number;
  /** Per-role hour subtotals, for the worksheet summary. */
  hoursByRole: Partial<Record<RateRole, number>>;
}

/**
 * Resolve a rate role against the globals table. Throws if the global
 * is missing — a missing rate is a seed/config bug, not something to
 * paper over with a zero.
 */
export function resolveRate(role: RateRole, globals: PricingGlobals): number {
  const key = RATE_ROLE_GLOBAL[role];
  const rate = globals[key];
  if (rate === undefined || rate === null) {
    throw new Error(`pricing_globals is missing "${key}" (for rate role "${role}").`);
  }
  return rate;
}

/**
 * Run the full worksheet computation: sum cost lines into a blended
 * time cost (roles can mix — LP at $75 and 2S at $30 on the same
 * package) and a hard cost, then apply margin and round-up.
 *
 * This is what the worksheet page calls on every keystroke to show the
 * live Working Price / Website Price, and what the seed calls to derive
 * each package's published base_price.
 *
 * It does NOT route through priceFromCostBasis() because that function
 * assumes a single hourly rate; the worksheet's time cost is already
 * fully resolved across mixed roles, so we compose the breakdown here.
 */
export function priceFromCostLines(
  lines: CostLine[],
  globals: PricingGlobals,
  margin: number,
): WorksheetResult {
  let timeCost = 0;
  let hardCost = 0;
  let totalHours = 0;
  const hoursByRole: Partial<Record<RateRole, number>> = {};

  for (const line of lines) {
    if (line.kind === 'time') {
      const hours = line.hours ?? 0;
      const role = line.rateRole;
      if (!role) {
        throw new Error(`Time line "${line.category}" has no rate role.`);
      }
      timeCost += hours * resolveRate(role, globals);
      totalHours += hours;
      hoursByRole[role] = (hoursByRole[role] ?? 0) + hours;
    } else {
      hardCost += line.amount ?? 0;
    }
  }

  const tc = roundCents(timeCost);
  const hc = roundCents(hardCost);
  const costBasis = roundCents(tc + hc);
  const workingPrice = roundCents(costBasis * (1 + margin));
  const marginAmount = roundCents(workingPrice - costBasis);
  const displayPrice = Math.ceil(workingPrice / ROUND_UP_STEP) * ROUND_UP_STEP;

  return {
    timeCost: tc,
    hardCost: hc,
    costBasis,
    marginAmount,
    workingPrice,
    displayPrice,
    margin,
    lpRate: 0, // not meaningful for a mixed-role worksheet
    totalHours,
    hoursByRole,
  };
}

// ─── Convenience: format ────────────────────────────────────────────────
export function fmtMoney(n: number, opts: { cents?: boolean } = {}): string {
  if (opts.cents) {
    return n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
