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

import type { RankFactor, ProspectStage, ScoreBand } from './prospects';

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
  /** ISO timestamp of `prospects.created_at`. Surfaced so the
   * Sourcing client can sort newest-first by default — newly-added
   * prospects land on top, instead of relying on the server's
   * pre-sort which UUID order alone wouldn't preserve once the
   * client re-sorts on any other column and then back. (D-035.) */
  createdAt: string;
}

/** Empty row template — what an "add a new prospect" row looks like
 * before any cells have been touched. `id`, `workflowKey`, and
 * `createdAt` are all server-assigned. */
export const EMPTY_SOURCING_ROW: Omit<SourcingRow, 'id' | 'workflowKey' | 'createdAt'> = {
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
  // Width sized to fit the three-button Pursue/—/Reject toggle without
  // clipping under any state. The toggle is interactive even in display
  // mode (D-037), so the column always has to fit the controls, not
  // just the pill. (D-038.)
  cols.push({
    key: 'sourcingStatus',
    label: 'Status',
    kind: 'text', // rendered as a custom three-state toggle, not an input
    group: 'triage',
    isRankInput: false,
    isPrimary: false,
    width: 200,
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

/** "Positive" sourcing decision — either Sourcing's `pursue` (worth
 * qualifying) or Qualify's `qualify` (this IS qualified). Both count
 * for the band-disagreement override rule. */
function isPositiveStatus(status: SourcingStatus): boolean {
  return status === 'pursue' || status === 'qualify';
}

/** Whether the rep's call disagrees with the pre-score band hard enough
 * to require a ≥20-char written reason (D-028).
 *
 * - band='qualified' + status='reject'             → override
 * - band='reject'    + status is positive          → override
 * - band='borderline' or status='undecided'         → no override
 *
 * D-045 — "skip when empty": if the row has no qualifier inputs filled
 * at all (every factor key is false/0/missing), band='reject' (score 0)
 * is meaningless and no override is required. Pass `options` with the
 * rank inputs + the factor keys to enable this carve-out; if `options`
 * is omitted, the bare rule applies. The carve-out re-engages the
 * moment any qualifier is set.
 *
 * Lives in lib/sourcing because both /sourcing and /qualify import it
 * (and the server validator on `upsertSourcingRow` does too) — one
 * source of truth for the rule. */
export function needsOverride(
  status: SourcingStatus,
  band: ScoreBand,
  options?: {
    rankInputs: Record<string, boolean | number>;
    factorKeys: string[];
  },
): boolean {
  if (status === 'undecided') return false;
  if (band === 'borderline') return false;

  // D-045 carve-out.
  if (options) {
    let any = false;
    for (const k of options.factorKeys) {
      const v = options.rankInputs[k];
      if (v === true || (typeof v === 'number' && v > 0)) {
        any = true;
        break;
      }
    }
    if (!any) return false;
  }

  if (band === 'qualified' && status === 'reject') return true;
  if (band === 'reject' && isPositiveStatus(status)) return true;
  return false;
}
