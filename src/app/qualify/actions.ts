'use server';

/**
 * Qualify page server action.
 *
 * `createProspect` persists a qualified prospect into one workflow. The
 * client sends the rep's answers and the chosen workflow; the server
 * re-fetches that workflow's rank factors and recomputes the 0–10 score
 * itself — a tampered or stale client can't write a bogus rank.
 *
 * The entry gate is the workflow's gate factors: every one must answer
 * true or nothing is written (D-017 / D-022).
 *
 * Renamed from /prospects/actions.ts in Phase E (D-023). Behavior
 * unchanged; only the file path and revalidate target moved.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import {
  scoreProspect,
  classifyBand,
  stageForBand,
  gatesPassed,
  DEFAULT_BANDS,
  type RankFactor,
  type RankBands,
  type RankInputs,
  type CreateProspectInput,
  type CreateProspectResult,
} from '@/lib/prospects';

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
interface ConfigRow {
  key: string;
  value: string;
}

function orNull(s: string): string | null {
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export async function createProspect(
  input: CreateProspectInput,
): Promise<CreateProspectResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Your session has expired — sign in again.' };

  const contactName = input.contactName.trim();
  if (!contactName) return { ok: false, error: 'Give the prospect a name first.' };

  const workflow = await sqlOne<{ name: string }>`
    SELECT name FROM workflows WHERE workflow_key = ${input.workflowKey} AND active = true`;
  if (!workflow) return { ok: false, error: 'That workflow is no longer available.' };

  // Re-fetch this workflow's scoring config and recompute server-side.
  const [factorRows, configRows] = await Promise.all([
    sql<FactorRow>`
      SELECT key, label, help_text, kind, weight, max_input, is_gate, sort_order
      FROM rank_factors
      WHERE workflow_key = ${input.workflowKey} AND active = true
      ORDER BY sort_order, label`,
    sql<ConfigRow>`
      SELECT key, value FROM rank_config WHERE workflow_key = ${input.workflowKey}`,
  ]);

  const factors: RankFactor[] = factorRows.map((r) => ({
    key: r.key,
    label: r.label,
    helpText: r.help_text,
    kind: r.kind,
    weight: Number(r.weight),
    maxInput: r.max_input === null ? null : Number(r.max_input),
    isGate: r.is_gate,
    sortOrder: r.sort_order,
  }));

  // Keep only answers for factors that exist; coerce by kind.
  const clean: RankInputs = {};
  for (const f of factors) {
    const raw = input.rankInputs[f.key];
    if (f.kind === 'bool') {
      clean[f.key] = raw === true;
    } else {
      const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      clean[f.key] = Math.max(0, n);
    }
  }

  // Entry gate — every gate factor must be true (D-017 / D-022).
  if (!gatesPassed(factors, clean)) {
    return {
      ok: false,
      error:
        "This prospect doesn't clear the entry gate yet — every gate question has to be a yes.",
    };
  }

  const cfg = new Map(configRows.map((r) => [r.key, Number(r.value)]));
  const bands: RankBands = {
    qualifiedMin: cfg.get('qualified_min') ?? DEFAULT_BANDS.qualifiedMin,
    borderlineMin: cfg.get('borderline_min') ?? DEFAULT_BANDS.borderlineMin,
    targetCount: cfg.get('qualified_target_count') ?? DEFAULT_BANDS.targetCount,
  };

  const scoringFactors = factors.filter((f) => !f.isGate);
  const { score } = scoreProspect(scoringFactors, clean);
  const band = classifyBand(score, bands);
  const stage = stageForBand(band);

  try {
    const row = await sqlOne<{ id: string }>`
      INSERT INTO prospects
        (workflow_key, owner_id, contact_name, org_name, email, phone,
         website_url, social_url, market_area, rank_inputs, rank_score, stage)
      VALUES
        (${input.workflowKey}, ${userId}, ${contactName}, ${orNull(input.orgName)},
         ${orNull(input.email)}, ${orNull(input.phone)}, ${orNull(input.websiteUrl)},
         ${orNull(input.socialUrl)}, ${orNull(input.marketArea)},
         ${JSON.stringify(clean)}, ${score}, ${stage})
      RETURNING id`;
    if (!row) return { ok: false, error: 'Could not save the prospect.' };

    revalidatePath('/qualify');
    return { ok: true, id: row.id, contactName, score, band, stage };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, 'Could not save the prospect.'),
    };
  }
}
