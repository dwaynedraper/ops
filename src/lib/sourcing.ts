/**
 * Sourcing — types, column configuration, and pure helpers.
 *
 * A sourcing row IS a prospect from row one (D-024). The Sourcing page
 * is a spreadsheet-style triage surface: a rep enters many candidates
 * fast, each row carrying the hard qualifiers + intake fields needed to
 * pre-score it and triage it Qualify/Pass/Undecided. Clicking the name
 * opens the deeper /prospects/[id] page.
 *
 * Column composition (D-027): identity (universal) + workflow-specific
 * intake (e.g. RealTrends sides/volume on real-estate) + hard
 * qualifiers (gates + scoring factors weighted ≥ 3) + universal
 * status/notes. Smaller 1–2 point supporting items live on Qualify.
 */

import type { RankFactor, ProspectStage } from './prospects';

/**
 * Sourcing's status enum holds the rep's "what should happen with this
 * prospect" decision. Four values:
 *
 *   undecided  — nothing decided yet (fresh row or borderline)
 *   pursue     — Sourcing said yes: this is worth qualifying. Stage
 *                stays `researching`; the prospect lands in the
 *                Qualify queue but is NOT yet qualified.
 *   qualify    — Qualify (the deep-work page) said yes: this prospect
 *                IS qualified. Stage advances to `qualified`. Only set
 *                from the Qualify page, never directly from Sourcing.
 *   reject     — either phase said no. Stage moves to `rejected`.
 *
 * Sourcing's toggle exposes Pursue / Reject / Undecided. The Qualify
 * page's toggle exposes Qualify / Reject / Undecided. Same enum, two
 * different UI surfaces, no foot-gun. */
export type SourcingStatus = 'undecided' | 'pursue' | 'qualify' | 'reject';

/** A row as the Sourcing page sends and stores it. Mirrors the shape
 * of `prospects` for the fields the page edits + the rank_inputs
 * subset relevant to sourcing's hard qualifiers. */
export interface SourcingRow {
  id: string;
  workflowKey: string;
  contactName: string;
  orgName: string | null;
  marketArea: string | null;
  sidesCount: number | null;
  grossVolume: number | null;
  sourceUrl: string | null;
  sourcingStatus: SourcingStatus;
  sourcingNote: string | null;
  /** Subset of `prospects.rank_inputs` keyed by rank-factor key.
   * Only the hard-qualifier keys are surfaced on Sourcing; the rest
   * stay zero / false here until they're filled in on Qualify. */
  rankInputs: Record<string, boolean | number>;
  /** Server-computed 0–10 score. Sourcing renders this as the
   * advisory pre-score badge. */
  rankScore: number;
  /** Lifecycle stage. A sourcing row at status='undecided' is in
   * `researching`; toggling sets `qualified` or `passed`. Later
   * stages (contacting → client) are reached on Qualify / Tracking
   * and don't reverse from a sourcing edit. */
  stage: ProspectStage;
  /** Whether the row currently has at least one hard qualifier
   * filled in. The badge tone depends on the band, but the partial
   * indicator on the badge reflects this. */
  hasPartialScore: boolean;
}

/** Empty row template — what an "add a new prospect" row looks like
 * before any cells have been touched. */
export const EMPTY_SOURCING_ROW: Omit<SourcingRow, 'id' | 'workflowKey'> = {
  contactName: '',
  orgName: null,
  marketArea: null,
  sidesCount: null,
  grossVolume: null,
  sourceUrl: null,
  sourcingStatus: 'undecided',
  sourcingNote: null,
  rankInputs: {},
  rankScore: 0,
  stage: 'researching',
  hasPartialScore: false,
};

export type SourcingColumnKind =
  | 'text'
  | 'integer'
  | 'currency'
  | 'url'
  | 'bool';

export interface SourcingColumn {
  /** The cell key. For rank-input columns this matches the rank
   * factor key; for first-class fields it matches the SourcingRow
   * property name. */
  key: string;
  label: string;
  kind: SourcingColumnKind;
  /** Source category — drives section grouping in the header.
   *
   *   intake     identity + RealTrends-style data scraped or pasted
   *   qualifier  hard qualifiers from rank_factors (gates + ≥3 pts)
   *   triage     the rep's call: status + notes
   */
  group: 'intake' | 'qualifier' | 'triage';
  /** True when this cell maps to a rank_inputs key rather than a
   * first-class prospects column. */
  isRankInput: boolean;
  /** True for the contact_name cell. */
  isPrimary: boolean;
  /** Pixel width hint for the grid column. */
  width: number;
  /** For number/integer columns, a "full credit at N" hint shown
   * inline. */
  maxInput?: number | null;
  /** Help blurb surfaced under the column header. */
  help?: string | null;
}

/** Workflows that get the RealTrends-style sides/volume columns on
 * Sourcing. Real-estate is the only one for v1. Other workflows get
 * the universal columns + their own hard qualifiers. */
const SIDES_VOLUME_WORKFLOWS = new Set(['real_estate']);

/** Build the column set the Sourcing client renders for a given
 * workflow. Column order is deliberate: intake first (the data
 * already on the source list), then hard qualifiers (the rep's
 * fast yes/no/number reads), then triage. */
export function buildColumnConfig(
  workflowKey: string,
  rankFactors: RankFactor[],
): SourcingColumn[] {
  const cols: SourcingColumn[] = [];

  // ── Intake — identity ─────────────────────────────────────────────
  cols.push({
    key: 'contactName',
    label: 'Name',
    kind: 'text',
    group: 'intake',
    isRankInput: false,
    isPrimary: true,
    width: 180,
  });
  cols.push({
    key: 'orgName',
    label: 'Agency',
    kind: 'text',
    group: 'intake',
    isRankInput: false,
    isPrimary: false,
    width: 160,
  });
  cols.push({
    key: 'marketArea',
    label: 'Market',
    kind: 'text',
    group: 'intake',
    isRankInput: false,
    isPrimary: false,
    width: 140,
  });

  // ── Intake — workflow-specific scraped data ───────────────────────
  // Sides was dropped per Dean's review of P4 — listings (annual_volume
  // hard qualifier) is a close-enough proxy. The schema column
  // `prospects.sides_count` is retained in case Dean reverses, but it
  // isn't surfaced on the UI.
  if (SIDES_VOLUME_WORKFLOWS.has(workflowKey)) {
    cols.push({
      key: 'grossVolume',
      label: 'Gross volume',
      kind: 'currency',
      group: 'intake',
      isRankInput: false,
      isPrimary: false,
      width: 130,
      help: 'Total sales volume from the source list (not commission).',
    });
  }

  // ── Hard qualifiers — gates + scoring factors weighted ≥ 3 ────────
  // Sort by sort_order to match how rank_factors are presented elsewhere.
  const hardQualifiers = rankFactors
    .filter((f) => f.isGate || f.weight >= 3)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const f of hardQualifiers) {
    cols.push({
      key: f.key,
      label: f.label,
      kind: f.kind === 'bool' ? 'bool' : 'integer',
      group: 'qualifier',
      isRankInput: true,
      isPrimary: false,
      width: f.kind === 'bool' ? 80 : 110,
      maxInput: f.maxInput,
      help: f.helpText,
    });
  }

  // ── Intake — source URL (universal, but slots at the end of intake) ──
  cols.push({
    key: 'sourceUrl',
    label: 'Source',
    kind: 'url',
    group: 'intake',
    isRankInput: false,
    isPrimary: false,
    width: 110,
    help: 'Where this name came from — e.g. the RealTrends page.',
  });

  // ── Triage — status ──────────────────────────────────────────────
  cols.push({
    key: 'sourcingStatus',
    label: 'Status',
    kind: 'text', // rendered as a custom three-state toggle, not an input
    group: 'triage',
    isRankInput: false,
    isPrimary: false,
    width: 150,
  });

  // sourcing_note is intentionally NOT a default column anymore. It's
  // repurposed as the "override reason" — surfaced inline on a row
  // only when the rep's status disagrees with the pre-score band's
  // recommendation (≥20 chars required).

  return cols;
}

/** Map a sourcing status to the lifecycle stage it sets — but only
 * if the prospect is still in an early stage. Later stages
 * (contacting, responded, signed, client) don't reverse from a
 * sourcing toggle. */
export function stageForSourcingStatus(
  status: SourcingStatus,
  currentStage: ProspectStage,
): ProspectStage {
  const reversible: ProspectStage[] = ['researching', 'qualified', 'rejected'];
  if (!reversible.includes(currentStage)) return currentStage;

  switch (status) {
    case 'qualify':
      return 'qualified';
    case 'pursue':
      // Sourcing's "I want to qualify this" doesn't itself qualify.
      // The actual qualification happens on /qualify/[id].
      return 'researching';
    case 'reject':
      return 'rejected';
    case 'undecided':
      return 'researching';
  }
}

/** Has the rep filled in at least one hard qualifier?
 * Used by the badge "partial" indicator on a row. */
export function hasAnyHardQualifierFilled(
  rankInputs: Record<string, boolean | number>,
  hardQualifierKeys: string[],
): boolean {
  for (const k of hardQualifierKeys) {
    const v = rankInputs[k];
    if (v === true) return true;
    if (typeof v === 'number' && v > 0) return true;
  }
  return false;
}
