'use server';

/**
 * Rank-factor editor server action.
 *
 * `publishRankConfig` commits the research scoring config — the
 * `rank_factors` (what's scored, and how heavily) and `rank_config` (the
 * qualified / borderline / target thresholds). Super-admin only (D-014);
 * a local draft until this runs (D-012).
 *
 * Factors are upserted by `key`, never deleted — a key may already be
 * referenced in a prospect's `rank_inputs` JSONB. Retiring a factor is
 * done with its `active` flag (the research page reads active-only).
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { getPool } from '@/lib/db';
import type { RankFactorKind } from '@/lib/prospects';

export interface RankFactorInput {
  /** Empty for a factor added in this draft — the server assigns a key. */
  key: string;
  label: string;
  helpText: string;
  kind: RankFactorKind;
  weight: number;
  maxInput: number | null;
  active: boolean;
}

export interface RankThresholdsInput {
  qualifiedMin: number;
  borderlineMin: number;
  targetCount: number;
}

export interface PublishRankResult {
  ok: boolean;
  error?: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function publishRankConfig(input: {
  factors: RankFactorInput[];
  thresholds: RankThresholdsInput;
}): Promise<PublishRankResult> {
  const session = await auth();
  if (session?.user?.role !== 'super_admin') {
    return { ok: false, error: 'Only a super-admin can change scoring config.' };
  }

  if (input.factors.length === 0) {
    return { ok: false, error: 'Keep at least one rank factor.' };
  }

  // Validate + resolve keys.
  const used = new Set<string>();
  const resolved: {
    key: string;
    label: string;
    helpText: string | null;
    kind: RankFactorKind;
    weight: number;
    maxInput: number | null;
    sortOrder: number;
    active: boolean;
  }[] = [];
  let order = 10;

  for (const f of input.factors) {
    const label = f.label.trim();
    if (!label) return { ok: false, error: 'Every rank factor needs a label.' };
    if (f.kind !== 'bool' && f.kind !== 'number') {
      return { ok: false, error: `“${label}” has an invalid kind.` };
    }
    if (!Number.isFinite(f.weight) || f.weight < 0) {
      return { ok: false, error: `“${label}” needs a weight of 0 or more.` };
    }

    let maxInput: number | null = null;
    if (f.kind === 'number') {
      if (f.maxInput == null || !Number.isFinite(f.maxInput) || f.maxInput <= 0) {
        return {
          ok: false,
          error: `“${label}” is a number factor — it needs a “full credit at” value above 0.`,
        };
      }
      maxInput = f.maxInput;
    }

    let key = f.key.trim();
    if (!key) {
      const base = slugify(label) || 'factor';
      key = base;
      let n = 2;
      while (used.has(key)) key = `${base}_${n++}`;
    }
    if (used.has(key)) return { ok: false, error: `Duplicate factor key “${key}”.` };
    used.add(key);

    resolved.push({
      key,
      label,
      helpText: f.helpText.trim() || null,
      kind: f.kind,
      weight: f.weight,
      maxInput,
      sortOrder: order,
      active: f.active,
    });
    order += 10;
  }

  const t = input.thresholds;
  for (const [name, v] of [
    ['Qualified threshold', t.qualifiedMin],
    ['Borderline threshold', t.borderlineMin],
    ['Qualified target', t.targetCount],
  ] as const) {
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, error: `${name} needs a number of 0 or more.` };
    }
  }
  if (t.borderlineMin > t.qualifiedMin) {
    return { ok: false, error: 'The borderline threshold can’t be above the qualified threshold.' };
  }

  const pool = getPool();
  const dbc = await pool.connect();
  try {
    await dbc.query('BEGIN');

    for (const f of resolved) {
      await dbc.query(
        `INSERT INTO rank_factors
           (key, label, help_text, kind, weight, max_input, sort_order, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (key) DO UPDATE SET
           label=EXCLUDED.label, help_text=EXCLUDED.help_text, kind=EXCLUDED.kind,
           weight=EXCLUDED.weight, max_input=EXCLUDED.max_input,
           sort_order=EXCLUDED.sort_order, active=EXCLUDED.active`,
        [f.key, f.label, f.helpText, f.kind, f.weight, f.maxInput, f.sortOrder, f.active],
      );
    }

    for (const [key, value] of [
      ['qualified_min', t.qualifiedMin],
      ['borderline_min', t.borderlineMin],
      ['qualified_target_count', t.targetCount],
    ] as const) {
      await dbc.query(`UPDATE rank_config SET value = $1 WHERE key = $2`, [value, key]);
    }

    await dbc.query('COMMIT');
    revalidatePath('/rank-factors');
    return { ok: true };
  } catch (err) {
    await dbc.query('ROLLBACK');
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not publish the scoring config.',
    };
  } finally {
    dbc.release();
  }
}
