'use server';

/**
 * Research page server action.
 *
 * `createProspect` persists a researched agent. The client sends the
 * rep's answers; the server re-fetches the rank factors and recomputes
 * the 0–10 score itself — a tampered or stale client can't write a bogus
 * rank, the same discipline the calculator's saveQuote uses for prices.
 *
 * The entry gate (a current target listing AND a visible photo need) is
 * enforced here too: fail it and nothing is written (D-017).
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql, sqlOne } from '@/lib/db';
import {
  scoreProspect,
  classifyBand,
  stageForBand,
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
  sort_order: number;
}
interface ConfigRow {
  key: string;
  value: string;
}

/** Trim a free-text field; empty becomes NULL so the column stays clean. */
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

  const agentName = input.agentName.trim();
  if (!agentName) return { ok: false, error: 'Give the agent a name first.' };

  // Entry gate — both must be true to enter the pipeline (D-017).
  if (!input.hasTargetListing || !input.hasPhotoNeed) {
    return {
      ok: false,
      error:
        "This agent doesn't clear the entry gate yet — it needs both a current target listing and a visible photo need.",
    };
  }

  // Re-fetch the scoring config and recompute the score server-side.
  const [factorRows, configRows] = await Promise.all([
    sql<FactorRow>`
      SELECT key, label, help_text, kind, weight, max_input, sort_order
      FROM rank_factors
      WHERE active = true
      ORDER BY sort_order, label`,
    sql<ConfigRow>`SELECT key, value FROM rank_config`,
  ]);

  const factors: RankFactor[] = factorRows.map((r) => ({
    key: r.key,
    label: r.label,
    helpText: r.help_text,
    kind: r.kind,
    weight: Number(r.weight),
    maxInput: r.max_input === null ? null : Number(r.max_input),
    sortOrder: r.sort_order,
  }));

  // Keep only answers for factors that actually exist; coerce by kind.
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

  const cfg = new Map(configRows.map((r) => [r.key, Number(r.value)]));
  const bands: RankBands = {
    qualifiedMin: cfg.get('qualified_min') ?? DEFAULT_BANDS.qualifiedMin,
    borderlineMin: cfg.get('borderline_min') ?? DEFAULT_BANDS.borderlineMin,
    targetCount: cfg.get('qualified_target_count') ?? DEFAULT_BANDS.targetCount,
  };

  const { score } = scoreProspect(factors, clean);
  const band = classifyBand(score, bands);
  const stage = stageForBand(band);

  try {
    const row = await sqlOne<{ id: string }>`
      INSERT INTO prospects
        (owner_id, agent_name, agency, email, phone, website_url, social_url,
         market_area, has_target_listing, has_photo_need, rank_inputs,
         rank_score, stage)
      VALUES
        (${userId}, ${agentName}, ${orNull(input.agency)}, ${orNull(input.email)},
         ${orNull(input.phone)}, ${orNull(input.websiteUrl)}, ${orNull(input.socialUrl)},
         ${orNull(input.marketArea)}, ${input.hasTargetListing}, ${input.hasPhotoNeed},
         ${JSON.stringify(clean)}, ${score}, ${stage})
      RETURNING id`;

    if (!row) return { ok: false, error: 'Could not save the prospect.' };

    revalidatePath('/prospects');
    return { ok: true, id: row.id, agentName, score, band, stage };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not save the prospect.',
    };
  }
}
