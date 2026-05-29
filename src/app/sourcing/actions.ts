'use server';

/**
 * Sourcing page server actions.
 *
 * `upsertSourcingRow` is a single endpoint that handles both create
 * (no `id` sent) and per-cell update (`id` present + a patch of which
 * fields changed). The server always re-fetches the workflow's
 * rank_factors and recomputes the 0–10 score itself — a tampered or
 * stale client can't write a bogus rank. The lifecycle stage tracks
 * `sourcing_status` while the prospect is still in an early stage
 * (researching / qualified / passed); later stages don't reverse from
 * a Sourcing edit (D-024 / D-028).
 *
 * `deleteSourcingRow` is intentionally not provided in v1. A row the
 * rep wants out of the active triage gets `sourcing_status = 'reject'`,
 * which moves the lifecycle stage to `passed` — the row stays in the
 * archive but drops off the active list. Hard delete can be added
 * later if it's actually needed.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import { loadOwnedProspect } from '@/lib/prospect-access';
import {
  scoreProspect,
  classifyBand,
  DEFAULT_BANDS,
  type RankFactor,
  type RankInputs,
  type RankBands,
  type ScoreBand,
  type ProspectStage,
} from '@/lib/prospects';
import {
  needsOverride,
  stageForSourcingStatus,
  type SourcingStatus,
  type SourcingRow,
} from '@/lib/sourcing';

const OVERRIDE_MIN_CHARS = 20;

/* ── Input + result ────────────────────────────────────────────────── */

export interface UpsertSourcingRowInput {
  /** Omit for create. Required for update. */
  id?: string;
  /** Required for create; ignored for update (workflow can't change). */
  workflowKey?: string;
  // ── First-class column patches. `undefined` = "don't change."
  contactName?: string;
  orgName?: string | null;
  marketArea?: string | null;
  sidesCount?: number | null;
  grossVolume?: number | null;
  sourceUrl?: string | null;
  sourcingStatus?: SourcingStatus;
  sourcingNote?: string | null;
  /** Patch into `prospects.rank_inputs`. Keys not included keep their
   * existing value. */
  rankInputPatches?: Record<string, boolean | number>;
  /** D-057: when the client has already seen the duplicate warning
   * and the rep clicked "Continue anyway", set this to true so the
   * server skips the duplicate check and proceeds with the create.
   * Ignored on update (only create runs the check). */
  acknowledgeDuplicates?: boolean;
}

/** D-057: a peer prospect already owned by the same rep whose name
 * matches the one being added. The client renders a small list of
 * these so the rep can either back out or continue with the create. */
export interface DuplicateProspect {
  id: string;
  contactName: string;
  workflowKey: string;
  workflowName: string;
  stage: ProspectStage;
  sourcingStatus: SourcingStatus;
}

export interface UpsertSourcingRowResult {
  ok: boolean;
  error?: string;
  /** The full row state after the upsert, so the client can update
   * its local cache without a re-fetch. */
  row?: SourcingRow;
  /** Set when D-057 found duplicates and the input didn't carry an
   * `acknowledgeDuplicates: true` flag. `ok` is false in this case
   * but `error` is null — the warning isn't a failure, just a
   * "confirm before we create." */
  duplicates?: DuplicateProspect[];
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function trimOrNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function clampInt(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}

function clampMoney(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v < 0) return null;
  // Two-decimal precision; the DB column is NUMERIC(14, 2).
  return Math.round(v * 100) / 100;
}

const SOURCING_STATUSES: SourcingStatus[] = ['undecided', 'pursue', 'qualify', 'reject'];
function isSourcingStatus(v: unknown): v is SourcingStatus {
  return typeof v === 'string' && (SOURCING_STATUSES as readonly string[]).includes(v);
}

/** Server-side projection of a duplicate prospect (D-057). */
interface DuplicateRow {
  id: string;
  contact_name: string;
  workflow_key: string;
  workflow_name: string;
  stage: ProspectStage;
  sourcing_status: SourcingStatus;
}

/* ── Load rank-factor config for a workflow ───────────────────────── */

interface FactorRow {
  key: string;
  label: string;
  help_text: string | null;
  kind: 'bool' | 'number';
  weight: string;
  max_input: string | null;
  is_gate: boolean;
  sort_order: number;
}

async function loadWorkflowFactors(workflowKey: string): Promise<RankFactor[]> {
  const rows = await sql<FactorRow>`
    SELECT key, label, help_text, kind, weight, max_input, is_gate, sort_order
    FROM rank_factors
    WHERE workflow_key = ${workflowKey} AND active = true
    ORDER BY sort_order, label`;
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    helpText: r.help_text,
    kind: r.kind,
    weight: Number(r.weight),
    maxInput: r.max_input === null ? null : Number(r.max_input),
    isGate: r.is_gate,
    sortOrder: r.sort_order,
  }));
}

/** Coerce a patched rank-input value into the right type for its
 * factor, then merge into the existing inputs. Unknown keys are
 * dropped; the server's view of the workflow's factors is the truth. */
function mergeRankInputs(
  existing: RankInputs,
  patches: Record<string, boolean | number> | undefined,
  factors: RankFactor[],
): RankInputs {
  const out: RankInputs = { ...existing };
  if (!patches) return out;
  const factorByKey = new Map(factors.map((f) => [f.key, f]));
  for (const [k, raw] of Object.entries(patches)) {
    const f = factorByKey.get(k);
    if (!f) continue; // Drop unknown keys server-side.
    if (f.kind === 'bool') {
      out[k] = raw === true;
    } else {
      const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      out[k] = Math.max(0, Math.floor(n));
    }
  }
  return out;
}

/** Return the keys of factors that count as "hard qualifiers" for
 * the Sourcing badge — gates + scoring factors weighted ≥ 3.
 * Matches `buildColumnConfig`. */
function hardQualifierKeys(factors: RankFactor[]): string[] {
  return factors.filter((f) => f.isGate || f.weight >= 3).map((f) => f.key);
}

/** Load the band thresholds for one workflow. */
async function loadWorkflowBands(workflowKey: string): Promise<RankBands> {
  const rows = await sql<{ key: string; value: string }>`
    SELECT key, value FROM rank_config WHERE workflow_key = ${workflowKey}`;
  const cfg = new Map(rows.map((r) => [r.key, Number(r.value)]));
  return {
    qualifiedMin: cfg.get('qualified_min') ?? DEFAULT_BANDS.qualifiedMin,
    borderlineMin: cfg.get('borderline_min') ?? DEFAULT_BANDS.borderlineMin,
    targetCount: cfg.get('qualified_target_count') ?? DEFAULT_BANDS.targetCount,
  };
}

/** Validate the override-with-reason rule. Returns an error message if
 * the input is invalid (status disagrees with band but no/short reason);
 * returns null if the input is OK or no validation needed.
 *
 * Only triggers when the caller is actively patching sourcingStatus —
 * if the rep is just editing rank inputs without touching status, the
 * existing status carries forward even if the new score has shifted
 * the band. Status changes are the trigger for the reason rule. */
function validateOverride(
  patchedStatus: SourcingStatus | undefined,
  band: ScoreBand,
  reasonInput: string | null | undefined,
  rankInputs: RankInputs,
  factors: RankFactor[],
): string | null {
  if (patchedStatus === undefined) return null;
  // D-045: skip the rule when no qualifier inputs are filled (band='reject'
  // on a fresh row is meaningless until the rep starts scoring).
  if (
    !needsOverride(patchedStatus, band, {
      rankInputs,
      factorKeys: factors.map((f) => f.key),
    })
  ) {
    return null;
  }
  const trimmed = (reasonInput ?? '').trim();
  if (trimmed.length < OVERRIDE_MIN_CHARS) {
    return `Your call disagrees with the pre-score band. Add a reason of at least ${OVERRIDE_MIN_CHARS} characters.`;
  }
  return null;
}

/* ── upsertSourcingRow ────────────────────────────────────────────── */

export async function upsertSourcingRow(
  input: UpsertSourcingRowInput,
): Promise<UpsertSourcingRowResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Your session has expired — sign in again.' };

  try {
    if (input.id) {
      return await updateRow(input);
    }
    return await createRow(input, userId);
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not save that prospect.'),
    };
  }
}

/* ── createRow ────────────────────────────────────────────────────── */

interface ExistingRow {
  id: string;
  workflow_key: string;
  contact_name: string;
  org_name: string | null;
  market_area: string | null;
  sides_count: number | null;
  gross_volume: string | null;
  source_url: string | null;
  sourcing_status: SourcingStatus;
  sourcing_note: string | null;
  rank_inputs: RankInputs;
  rank_score: string;
  stage: ProspectStage;
  created_at: string;
}

async function createRow(
  input: UpsertSourcingRowInput,
  userId: string,
): Promise<UpsertSourcingRowResult> {
  if (!input.workflowKey) {
    return { ok: false, error: 'Pick a workflow before adding rows.' };
  }
  const contactName = trimOrNull(input.contactName);
  if (!contactName) {
    return { ok: false, error: 'Add a name before this row can be saved.' };
  }

  const workflow = await sqlOne<{ name: string }>`
    SELECT name FROM workflows
    WHERE workflow_key = ${input.workflowKey} AND active = true`;
  if (!workflow) {
    return { ok: false, error: 'That workflow is no longer available.' };
  }

  // D-057: duplicate-check. Match on lower(contact_name) within the
  // rep's own prospects. Owner-scoped — preserves the D-019
  // visibility rule (a rep never sees another rep's prospects, even
  // for collision-checking). The rep can override by re-submitting
  // with `acknowledgeDuplicates: true`.
  if (!input.acknowledgeDuplicates) {
    const duplicates = await sql<DuplicateRow>`
      SELECT p.id, p.contact_name, p.workflow_key, p.stage, p.sourcing_status,
             w.name AS workflow_name
      FROM prospects p
      JOIN workflows w ON w.workflow_key = p.workflow_key
      WHERE p.owner_id = ${userId}
        AND lower(p.contact_name) = lower(${contactName})
      ORDER BY p.created_at DESC
      LIMIT 5`;
    if (duplicates.length > 0) {
      return {
        ok: false,
        duplicates: duplicates.map((d) => ({
          id: d.id,
          contactName: d.contact_name,
          workflowKey: d.workflow_key,
          workflowName: d.workflow_name,
          stage: d.stage,
          sourcingStatus: d.sourcing_status,
        })),
      };
    }
  }

  const [factors, bands] = await Promise.all([
    loadWorkflowFactors(input.workflowKey),
    loadWorkflowBands(input.workflowKey),
  ]);
  const rankInputs = mergeRankInputs({}, input.rankInputPatches, factors);
  // D-032: gates contribute to the score, same as any other factor.
  const { score } = scoreProspect(factors, rankInputs);
  const band = classifyBand(score, bands);

  const status = isSourcingStatus(input.sourcingStatus)
    ? input.sourcingStatus
    : 'undecided';
  const stage = stageForSourcingStatus(status, 'researching');

  // P4.6 override rule (D-045-aware): if the caller is patching status
  // into a value that disagrees with the band AND any qualifier is
  // filled, require a ≥20-char reason.
  const overrideError = validateOverride(
    input.sourcingStatus,
    band,
    input.sourcingNote,
    rankInputs,
    factors,
  );
  if (overrideError) return { ok: false, error: overrideError };

  // Reason is meaningful only when overriding; clear it otherwise.
  const overrideOpts = { rankInputs, factorKeys: factors.map((f) => f.key) };
  const finalNote = needsOverride(status, band, overrideOpts)
    ? trimOrNull(input.sourcingNote)
    : null;

  const inserted = await sqlOne<ExistingRow>`
    INSERT INTO prospects (
      workflow_key, owner_id,
      contact_name, org_name, market_area,
      sides_count, gross_volume, source_url,
      sourcing_status, sourcing_note,
      rank_inputs, rank_score, stage
    )
    VALUES (
      ${input.workflowKey}, ${userId},
      ${contactName}, ${trimOrNull(input.orgName)}, ${trimOrNull(input.marketArea)},
      ${clampInt(input.sidesCount)}, ${clampMoney(input.grossVolume)},
      ${trimOrNull(input.sourceUrl)},
      ${status}, ${finalNote},
      ${JSON.stringify(rankInputs)}, ${score}, ${stage}
    )
    RETURNING id, workflow_key, contact_name, org_name, market_area,
              sides_count, gross_volume, source_url,
              sourcing_status, sourcing_note,
              rank_inputs, rank_score::text AS rank_score, stage,
              created_at::text AS created_at`;
  if (!inserted) return { ok: false, error: 'Could not save that prospect.' };

  revalidatePath('/sourcing');
  return { ok: true, row: rowFromExisting(inserted, factors) };
}

/* ── updateRow ────────────────────────────────────────────────────── */

async function updateRow(
  input: UpsertSourcingRowInput,
): Promise<UpsertSourcingRowResult> {
  const access = await loadOwnedProspect(input.id!);
  if ('error' in access) return { ok: false, error: access.error };
  const { prospect } = access;

  // Re-fetch the full current row so we can compute the new state and
  // run the score with the merged rank_inputs.
  const existing = await sqlOne<ExistingRow>`
    SELECT id, workflow_key, contact_name, org_name, market_area,
           sides_count, gross_volume, source_url,
           sourcing_status, sourcing_note,
           rank_inputs, rank_score::text AS rank_score, stage,
           created_at::text AS created_at
    FROM prospects WHERE id = ${prospect.id}`;
  if (!existing) return { ok: false, error: 'That prospect is no longer in the pipeline.' };

  const [factors, bands] = await Promise.all([
    loadWorkflowFactors(existing.workflow_key),
    loadWorkflowBands(existing.workflow_key),
  ]);

  // First-class column updates. `undefined` keeps the existing value.
  const newContactName =
    input.contactName !== undefined
      ? trimOrNull(input.contactName) ?? existing.contact_name
      : existing.contact_name;
  const newOrgName =
    input.orgName !== undefined ? trimOrNull(input.orgName) : existing.org_name;
  const newMarketArea =
    input.marketArea !== undefined ? trimOrNull(input.marketArea) : existing.market_area;
  const newSidesCount =
    input.sidesCount !== undefined ? clampInt(input.sidesCount) : existing.sides_count;
  const newGrossVolume =
    input.grossVolume !== undefined
      ? clampMoney(input.grossVolume)
      : existing.gross_volume === null
        ? null
        : Number(existing.gross_volume);
  const newSourceUrl =
    input.sourceUrl !== undefined ? trimOrNull(input.sourceUrl) : existing.source_url;

  // Sourcing status — drives the lifecycle stage update.
  let newSourcingStatus: SourcingStatus = existing.sourcing_status;
  if (input.sourcingStatus !== undefined) {
    if (!isSourcingStatus(input.sourcingStatus)) {
      return { ok: false, error: 'Unknown status.' };
    }
    newSourcingStatus = input.sourcingStatus;
  }
  const newStage =
    input.sourcingStatus !== undefined
      ? stageForSourcingStatus(newSourcingStatus, existing.stage)
      : existing.stage;

  // Rank inputs — merge patches into the existing JSONB, recompute score.
  // D-032: gates contribute to the score, same as any other factor.
  const newRankInputs = mergeRankInputs(
    existing.rank_inputs ?? {},
    input.rankInputPatches,
    factors,
  );
  const { score: newScore } = scoreProspect(factors, newRankInputs);
  const newBand = classifyBand(newScore, bands);

  // P4.6 override rule (D-045-aware): when status is being patched into
  // a value that disagrees with the new band AND any qualifier is filled,
  // require a ≥20-char reason. If the rep is only editing rank inputs
  // (status untouched), existing status carries forward even if the
  // band shifted.
  const overrideError = validateOverride(
    input.sourcingStatus,
    newBand,
    input.sourcingNote,
    newRankInputs,
    factors,
  );
  if (overrideError) return { ok: false, error: overrideError };

  // Note carries weight only when overriding. If the current state
  // doesn't constitute an override, drop the note. Otherwise honor the
  // input (if patched) or keep whatever's on the row.
  const isOverride = needsOverride(newSourcingStatus, newBand, {
    rankInputs: newRankInputs,
    factorKeys: factors.map((f) => f.key),
  });
  const newSourcingNote = !isOverride
    ? null
    : input.sourcingNote !== undefined
      ? trimOrNull(input.sourcingNote)
      : existing.sourcing_note;

  const updated = await sqlOne<ExistingRow>`
    UPDATE prospects SET
      contact_name = ${newContactName},
      org_name = ${newOrgName},
      market_area = ${newMarketArea},
      sides_count = ${newSidesCount},
      gross_volume = ${newGrossVolume},
      source_url = ${newSourceUrl},
      sourcing_status = ${newSourcingStatus},
      sourcing_note = ${newSourcingNote},
      rank_inputs = ${JSON.stringify(newRankInputs)},
      rank_score = ${newScore},
      stage = ${newStage}
    WHERE id = ${prospect.id}
    RETURNING id, workflow_key, contact_name, org_name, market_area,
              sides_count, gross_volume, source_url,
              sourcing_status, sourcing_note,
              rank_inputs, rank_score::text AS rank_score, stage,
              created_at::text AS created_at`;
  if (!updated) return { ok: false, error: 'Could not save that prospect.' };

  revalidatePath('/sourcing');
  revalidatePath(`/prospects/${prospect.id}`);
  return { ok: true, row: rowFromExisting(updated, factors) };
}

/* ── Row shape conversion ─────────────────────────────────────────── */

function rowFromExisting(r: ExistingRow, factors: RankFactor[]): SourcingRow {
  const rankInputs = r.rank_inputs ?? {};
  const hardKeys = hardQualifierKeys(factors);

  let hasPartial = false;
  for (const k of hardKeys) {
    const v = rankInputs[k];
    if (v === true || (typeof v === 'number' && v > 0)) {
      hasPartial = true;
      break;
    }
  }

  // Band is informational here — the client renders the score, not the
  // band, but we keep this hook open so future server work can return
  // the band without re-deriving it.
  classifyBand(Number(r.rank_score), {
    qualifiedMin: 8,
    borderlineMin: 6,
    targetCount: 10,
  });

  return {
    id: r.id,
    workflowKey: r.workflow_key,
    contactName: r.contact_name,
    orgName: r.org_name,
    marketArea: r.market_area,
    sidesCount: r.sides_count,
    grossVolume: r.gross_volume === null ? null : Number(r.gross_volume),
    sourceUrl: r.source_url,
    sourcingStatus: r.sourcing_status,
    sourcingNote: r.sourcing_note,
    rankInputs,
    rankScore: Number(r.rank_score),
    stage: r.stage,
    hasPartialScore: hasPartial,
    createdAt: r.created_at,
  };
}
