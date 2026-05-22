'use server';

/**
 * Package worksheet editor server action.
 *
 * `publishWorksheet` commits a package's cost-line worksheet. Super-admin
 * only (D-014); edits are a local draft until this runs (D-012). On
 * publish the server recomputes the package's base_price from the lines
 * + the rate globals — the price is never trusted from the client — and
 * replaces the cost lines wholesale (they have no natural key) inside one
 * transaction.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { getPool, sql, sqlOne } from '@/lib/db';
import {
  priceFromCostLines,
  type CostLine,
  type RateRole,
  type PricingGlobals,
} from '@/lib/pricing';

export interface WorksheetLineInput {
  kind: 'time' | 'hard';
  category: string;
  hours: number;
  rateRole: RateRole | null;
  amount: number;
}

export interface PublishWorksheetResult {
  ok: boolean;
  error?: string;
  basePrice?: number;
}

export async function publishWorksheet(input: {
  slug: string;
  margin: number;
  lines: WorksheetLineInput[];
}): Promise<PublishWorksheetResult> {
  const session = await auth();
  if (session?.user?.role !== 'super_admin') {
    return { ok: false, error: 'Only a super-admin can change package pricing.' };
  }

  if (!Number.isFinite(input.margin) || input.margin < 0 || input.margin > 1) {
    return { ok: false, error: 'Margin must be between 0 and 1 — e.g. 0.30 for 30%.' };
  }
  if (input.lines.length === 0) {
    return { ok: false, error: 'A package worksheet needs at least one cost line.' };
  }
  for (const ln of input.lines) {
    if (!ln.category.trim()) {
      return { ok: false, error: 'Every cost line needs a label.' };
    }
    if (ln.kind === 'time') {
      if (!ln.rateRole) {
        return { ok: false, error: `“${ln.category}” needs a rate role.` };
      }
      if (!Number.isFinite(ln.hours) || ln.hours < 0) {
        return { ok: false, error: `“${ln.category}” needs an hours value of 0 or more.` };
      }
    } else if (!Number.isFinite(ln.amount) || ln.amount < 0) {
      return { ok: false, error: `“${ln.category}” needs an amount of 0 or more.` };
    }
  }

  const pkg = await sqlOne<{ id: string }>`SELECT id FROM packages WHERE slug = ${input.slug}`;
  if (!pkg) return { ok: false, error: 'That package is no longer in the catalog.' };

  // Resolve the rate table and recompute the published price server-side.
  const globalRows = await sql<{ key: string; value: string }>`
    SELECT key, value FROM pricing_globals`;
  const globals: PricingGlobals = {};
  for (const g of globalRows) globals[g.key] = Number(g.value);

  const costLines: CostLine[] = input.lines.map((l) =>
    l.kind === 'time'
      ? { kind: 'time', category: l.category.trim(), hours: l.hours, rateRole: l.rateRole }
      : { kind: 'hard', category: l.category.trim(), amount: l.amount },
  );

  let basePrice: number;
  try {
    basePrice = priceFromCostLines(costLines, globals, input.margin).displayPrice;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not compute the price.',
    };
  }

  const pool = getPool();
  const dbc = await pool.connect();
  try {
    await dbc.query('BEGIN');

    await dbc.query(
      `UPDATE packages SET default_margin = $1, base_price = $2 WHERE id = $3`,
      [input.margin, basePrice, pkg.id],
    );

    // Cost lines have no natural key — replace the whole set per package.
    await dbc.query(`DELETE FROM package_cost_lines WHERE package_id = $1`, [pkg.id]);
    let order = 10;
    for (const l of input.lines) {
      await dbc.query(
        `INSERT INTO package_cost_lines
           (package_id, kind, category, hours, rate_role, amount, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          pkg.id,
          l.kind,
          l.category.trim(),
          l.kind === 'time' ? l.hours : null,
          l.kind === 'time' ? l.rateRole : null,
          l.kind === 'hard' ? l.amount : null,
          order,
        ],
      );
      order += 10;
    }

    await dbc.query('COMMIT');
    revalidatePath(`/packages/${input.slug}`);
    revalidatePath('/packages');
    return { ok: true, basePrice };
  } catch (err) {
    await dbc.query('ROLLBACK');
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not publish the worksheet.',
    };
  } finally {
    dbc.release();
  }
}
