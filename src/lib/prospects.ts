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
  | 'signed'
  | 'client'
  | 'passed'
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
  sortOrder: number;
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

/** Points one raw answer earns for its factor. */
function earnedFor(factor: RankFactor, raw: boolean | number | undefined): number {
  if (factor.kind === 'bool') {
    return raw === true ? factor.weight : 0;
  }
  const max = factor.maxInput ?? 0;
  if (max <= 0) return 0;
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
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
 *   reject     → 'passed'       logged so it isn't re-researched
 */
export function stageForBand(band: ScoreBand): ProspectStage {
  if (band === 'qualified') return 'qualified';
  if (band === 'borderline') return 'researching';
  return 'passed';
}

// ─── Lifecycle stage display + transitions ────────────────────────────

/** Human label for each lifecycle stage. */
export const STAGE_LABEL: Record<ProspectStage, string> = {
  researching: 'Researching',
  qualified: 'Qualified',
  contacting: 'Contacting',
  responded: 'Responded',
  signed: 'Signed',
  client: 'Client',
  passed: 'Passed',
  dormant: 'Dormant',
};

/**
 * Stage moves a rep can make by hand from the client page. The contact
 * cycle (qualified → contacting → responded) is driven by the tracking
 * page, so those steps are deliberately absent here — this map covers the
 * decisions a person makes: qualifying, signing, passing, reopening.
 */
export const STAGE_NEXT: Record<ProspectStage, ProspectStage[]> = {
  researching: ['qualified', 'passed'],
  qualified: ['passed', 'dormant'],
  contacting: ['dormant'],
  responded: ['signed', 'passed', 'dormant'],
  signed: ['client'],
  client: [],
  passed: ['qualified'],
  dormant: ['qualified'],
};

// ─── Research page input / result shapes ──────────────────────────────

export interface CreateProspectInput {
  agentName: string;
  agency: string;
  email: string;
  phone: string;
  websiteUrl: string;
  socialUrl: string;
  marketArea: string;
  hasTargetListing: boolean;
  hasPhotoNeed: boolean;
  rankInputs: RankInputs;
}

export interface CreateProspectResult {
  ok: boolean;
  id?: string;
  agentName?: string;
  score?: number;
  band?: ScoreBand;
  stage?: ProspectStage;
  error?: string;
}

/** A prospect row as the research page list renders it. */
export interface ProspectListItem {
  id: string;
  agentName: string;
  agency: string | null;
  marketArea: string | null;
  rankScore: number;
  stage: ProspectStage;
  /** Pre-formatted for display (the list is server-rendered). */
  createdAt: string;
}
