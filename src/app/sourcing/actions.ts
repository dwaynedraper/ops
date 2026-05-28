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
 * rep wants out of the active triage gets `sourcing_status = 'pass'`,
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
  type RankFactor,
  type RankInputs,
  type ProspectStage,
} from '@/lib/prospects';
import {
  stageForSourcingStatus,
  type SourcingStatus,
  type SourcingRow,
} from '@/lib/sourcing';

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
}

export interface UpsertSourcingRowResult {
  ok: boolean;
  error?: string;
  /** The full row state after the upsert, so the client can update
   * its local cache without a re-fetch. */
  row?: SourcingRow;
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

const SOURCING_STATUSES: SourcingStatus[] = ['qualify', 'pass', 'undecided'];
function isSourcingStatus(v: unknown): v is SourcingStatus {
  return typeof v === 'string' && (SOURCING_STATUSES as readonly string[]).includes(v);
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

  const factors = await loadWorkflowFactors(input.workflowKey);
  const rankInputs = mergeRankInputs({}, input.rankInputPatches, factors);
  // D-032: gates contribute to the score, same as any other factor.
  const { score } = scoreProspect(factors, rankInputs);

  const status = isSourcingStatus(input.sourcingStatus)
    ? input.sourcingStatus
    : 'undecided';
  const stage = stageForSourcingStatus(status, 'researching');

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
      ${status}, ${trimOrNull(input.sourcingNote)},
      ${JSON.stringify(rankInputs)}, ${score}, ${stage}
    )
    RETURNING id, workflow_key, contact_name, org_name, market_area,
              sides_count, gross_volume, source_url,
              sourcing_status, sourcing_note,
              rank_inputs, rank_score::text AS rank_score, stage`;
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
           rank_inputs, rank_score::text AS rank_score, stage
    FROM prospects WHERE id = ${prospect.id}`;
  if (!existing) return { ok: false, error: 'That prospect is no longer in the pipeline.' };

  const factors = await loadWorkflowFactors(existing.workflow_key);

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
  const newSourcingNote =
    input.sourcingNote !== undefined
      ? trimOrNull(input.sourcingNote)
      : existing.sourcing_note;

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
  const newRankInputs = mergeRankInputs(
    existing.rank_inputs ?? {},
    input.rankInputPatches,
    factors,
  );
  const scoringFactors = factors.filter((f) => !f.isGate);
  const { score: newScore } = scoreProspect(scoringFactors, newRankInputs);

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
              rank_inputs, rank_score::text AS rank_score, stage`;
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
  };
}
