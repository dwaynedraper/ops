/**
 * Prospect scoring + shared types — the pure core of the research page.
 *
 * No database, no server imports. This module is pulled into the client
 * bundle (the research page scores live as the rep fills the form) AND
 * re-run on the server (createProspect recomputes the score it persists,
 * never trusting the client). Keeping it pure is what lets both sides
 * share one implementation and always agree.
 *
 * The scoring model mirrors schema.sql · rank_factors:
 *   bool   factor → `weight` points when the answer is true, else 0
 *   number factor → weight × min(value, maxInput) / maxInput
 *   rank          = Σ earned ÷ Σ weight × 10   (0–10, one decimal)
 */

// ─── Lifecycle + factor types ─────────────────────────────────────────

export type ProspectStage =
  | 'researching'
  | 'qualified'
  | 'contacting'
  | 'responded'
  | 'call_booked'
  | 'signed'
  | 'client'
  | 'rejected'
  | 'dormant';

export type RankFactorKind = 'bool' | 'number';

export interface RankFactor {
  key: string;
  label: string;
  helpText: string | null;
  kind: RankFactorKind;
  weight: number;
  /** number factors only: the input value that earns full weight. */
  maxInput: number | null;
  /** A gate factor must answer true for the prospect to enter the pipeline. */
  isGate: boolean;
  sortOrder: number;
}

/** A sales workflow — one per offering. See PHASE-D-PLAN.md. */
export interface Workflow {
  key: string;
  name: string;
  /** Calculator default branch; null for the 10% workflow (no quote). */
  branch: 'portraits' | 'realestate' | 'corporate' | null;
  /** UI label for the prospect — "Agent", "Contact", "Executive". */
  contactNoun: string;
  /** UI label for the organization; null when the prospect is an individual. */
  orgNoun: string | null;
  /** Hex accent for the workflow's chips and badges. */
  accent: string;
}

/** Per-factor answers, keyed by RankFactor.key. */
export type RankInputs = Record<string, boolean | number>;

/** Rank thresholds, resolved from rank_config. */
export interface RankBands {
  qualifiedMin: number;
  borderlineMin: number;
  targetCount: number;
}

export type ScoreBand = 'qualified' | 'borderline' | 'reject';

export interface FactorScore {
  key: string;
  weight: number;
  /** Points earned, 0..weight. */
  earned: number;
}

export interface ScoreResult {
  /** 0–10, rounded to one decimal (matches prospects.rank_score). */
  score: number;
  totalWeight: number;
  earnedPoints: number;
  factors: FactorScore[];
}

/** Fallback bands — used only if a rank_config row is missing. */
export const DEFAULT_BANDS: RankBands = {
  qualifiedMin: 8,
  borderlineMin: 6,
  targetCount: 10,
};

// ─── Scoring ──────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Piecewise curves, keyed by rank-factor key. If a number factor's key
 * has an entry here, the curve replaces the default linear `value /
 * maxInput * weight` math. Edits to weight in /rank-factors don't
 * affect the curve shape — to rev a shape, edit the function below and
 * record a decision log entry.
 *
 * D-032 (real-estate annual_volume):
 *   value ≤ 0  → 0
 *   value = 10 → 2.0  (roughly one listing per month is "worthwhile")
 *   value = 30 → 3.0  (full credit; high-volume agent)
 *   value > 30 → 3.0  (capped)
 */
const PIECEWISE_CURVES: Record<string, (value: number) => number> = {
  annual_volume: (value) => {
    if (value <= 0) return 0;
    if (value <= 10) return (value / 10) * 2;
    if (value <= 30) return 2 + (value - 10) / 20;
    return 3;
  },
};

/** Points one raw answer earns for its factor. Gates count toward the
 * score, same as any other factor (D-032); they're called "gates"
 * because `gatesPassed` blocks entry until they're all true, not
 * because they're scored differently. */
function earnedFor(factor: RankFactor, raw: boolean | number | undefined): number {
  if (factor.kind === 'bool') {
    return raw === true ? factor.weight : 0;
  }
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  const curve = PIECEWISE_CURVES[factor.key];
  if (curve) {
    return Math.max(0, curve(value));
  }
  const max = factor.maxInput ?? 0;
  if (max <= 0) return 0;
  const clamped = Math.min(Math.max(value, 0), max);
  return factor.weight * (clamped / max);
}

/**
 * Score a prospect 0–10 against the active rank factors. Pure — the same
 * inputs always produce the same result on the client and the server.
 */
export function scoreProspect(factors: RankFactor[], inputs: RankInputs): ScoreResult {
  let totalWeight = 0;
  let earnedPoints = 0;
  const factorScores: FactorScore[] = [];
  for (const f of factors) {
    totalWeight += f.weight;
    const earned = earnedFor(f, inputs[f.key]);
    earnedPoints += earned;
    factorScores.push({ key: f.key, weight: f.weight, earned });
  }
  const score = totalWeight > 0 ? round1((earnedPoints / totalWeight) * 10) : 0;
  return { score, totalWeight, earnedPoints, factors: factorScores };
}

/**
 * The entry gate: every gate factor must be answered true. A prospect
 * can't enter the pipeline until all of its workflow's gates pass.
 */
export function gatesPassed(factors: RankFactor[], inputs: RankInputs): boolean {
  return factors.filter((f) => f.isGate).every((f) => inputs[f.key] === true);
}

/** Classify a 0–10 score into its band. */
export function classifyBand(score: number, bands: RankBands): ScoreBand {
  if (score >= bands.qualifiedMin) return 'qualified';
  if (score >= bands.borderlineMin) return 'borderline';
  return 'reject';
}

/**
 * The lifecycle stage a freshly-researched prospect enters at, by band:
 *   qualified  → 'qualified'    ready for the contact cycle
 *   borderline → 'researching'  a judgment call, parked for review
 *   reject     → 'rejected'     logged so it isn't re-researched
 */
export function stageForBand(band: ScoreBand): ProspectStage {
  if (band === 'qualified') return 'qualified';
  if (band === 'borderline') return 'researching';
  return 'rejected';
}

// ─── Lifecycle stage display + transitions ────────────────────────────

/** Human label for each lifecycle stage. */
export const STAGE_LABEL: Record<ProspectStage, string> = {
  researching: 'Researching',
  qualified: 'Qualified',
  contacting: 'Contacting',
  responded: 'Responded',
  call_booked: 'Call booked',
  signed: 'Signed',
  client: 'Client',
  rejected: 'Rejected',
  dormant: 'Dormant',
};

/**
 * Stage moves a rep can make by hand from the client page. The contact
 * cycle (qualified → contacting → responded) is driven by the tracking
 * page, so those steps are deliberately absent here — this map covers the
 * decisions a person makes: qualifying, booking a call, signing, rejecting,
 * reopening.
 *
 * `call_booked` (Phase 5E): when a prospect self-books a call via the Sprout
 * link, Dean moves them here. It's reachable from `responded`; `signed`
 * stays directly reachable too, for the simple deals that don't need a call.
 */
export const STAGE_NEXT: Record<ProspectStage, ProspectStage[]> = {
  researching: ['qualified', 'rejected'],
  qualified: ['rejected', 'dormant'],
  contacting: ['dormant'],
  responded: ['call_booked', 'signed', 'rejected', 'dormant'],
  call_booked: ['signed', 'rejected', 'dormant'],
  signed: ['client'],
  client: [],
  rejected: ['qualified'],
  dormant: ['qualified'],
};

// ─── Research page input / result shapes ──────────────────────────────

export interface CreateProspectInput {
  workflowKey: string;
  contactName: string;
  orgName: string;
  email: string;
  phone: string;
  websiteUrl: string;
  socialUrl: string;
  marketArea: string;
  /** Per-factor answers, gate factors included, keyed by factor key. */
  rankInputs: RankInputs;
}

export interface CreateProspectResult {
  ok: boolean;
  id?: string;
  contactName?: string;
  score?: number;
  band?: ScoreBand;
  stage?: ProspectStage;
  error?: string;
}

/** A prospect row as the research page list renders it. */
export interface ProspectListItem {
  id: string;
  workflowKey: string;
  contactName: string;
  orgName: string | null;
  marketArea: string | null;
  rankScore: number;
  stage: ProspectStage;
  /** Pre-formatted for display (the list is server-rendered). */
  createdAt: string;
  /** D-043: drives the Qualify list filter — default view hides
   * `qualified` and `reject`; the "Pursued only" toggle narrows to
   * `pursue` alone. Carries the same enum as `prospects.sourcing_status`. */
  sourcingStatus: 'undecided' | 'pursue' | 'qualify' | 'reject';
}
