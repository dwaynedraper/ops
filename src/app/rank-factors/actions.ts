'use server';

/**
 * Rank-factor editor server action.
 *
 * `publishRankConfig` commits one workflow's research scoring config —
 * its `rank_factors` (gates and scoring) and `rank_config` thresholds.
 * Super-admin only (D-014); a local draft until this runs (D-012).
 *
 * Factors are upserted by (workflow_key, key), never deleted — a key may
 * be referenced in a prospect's `rank_inputs`. Retiring a factor uses its
 * `active` flag.
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
  isGate: boolean;
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

const THRESHOLD_META: Record<string, { label: string; notes: string }> = {
  qualified_min: {
    label: 'Qualified — minimum score',
    notes: 'Score at/above this is a highly-qualified candidate.',
  },
  borderline_min: {
    label: 'Borderline — minimum score',
    notes: 'At/above this is a judgment call; below it, do not message.',
  },
  qualified_target_count: {
    label: 'Qualified target count',
    notes: 'Once a rep has this many qualified prospects, prompt the contact cycle.',
  },
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function publishRankConfig(input: {
  workflowKey: string;
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

  const used = new Set<string>();
  const resolved: {
    key: string;
    label: string;
    helpText: string | null;
    kind: RankFactorKind;
    weight: number;
    maxInput: number | null;
    isGate: boolean;
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
    if (f.isGate && f.kind !== 'bool') {
      return { ok: false, error: `“${label}” is a gate — gate factors must be yes/no.` };
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
      isGate: f.isGate,
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

    const wf = await dbc.query<{ workflow_key: string }>(
      'SELECT workflow_key FROM workflows WHERE workflow_key = $1',
      [input.workflowKey],
    );
    if (wf.rows.length === 0) {
      await dbc.query('ROLLBACK');
      return { ok: false, error: 'That workflow no longer exists.' };
    }

    for (const f of resolved) {
      await dbc.query(
        `INSERT INTO rank_factors
           (workflow_key, key, label, help_text, kind, weight, max_input, is_gate, sort_order, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (workflow_key, key) DO UPDATE SET
           label=EXCLUDED.label, help_text=EXCLUDED.help_text, kind=EXCLUDED.kind,
           weight=EXCLUDED.weight, max_input=EXCLUDED.max_input, is_gate=EXCLUDED.is_gate,
           sort_order=EXCLUDED.sort_order, active=EXCLUDED.active`,
        [
          input.workflowKey, f.key, f.label, f.helpText, f.kind, f.weight,
          f.maxInput, f.isGate, f.sortOrder, f.active,
        ],
      );
    }

    for (const [key, value] of [
      ['qualified_min', t.qualifiedMin],
      ['borderline_min', t.borderlineMin],
      ['qualified_target_count', t.targetCount],
    ] as const) {
      const meta = THRESHOLD_META[key];
      await dbc.query(
        `INSERT INTO rank_config (workflow_key, key, label, value, notes)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workflow_key, key) DO UPDATE SET
           label=EXCLUDED.label, value=EXCLUDED.value, notes=EXCLUDED.notes`,
        [input.workflowKey, key, meta.label, value, meta.notes],
      );
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
