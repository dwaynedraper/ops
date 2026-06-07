/**
 * Catalog data access — the read side of the pricing system.
 *
 * `getCatalog()` is the single query path the calculator (and, later, the
 * client-page inline calculator) uses. It returns:
 *
 *   - packages   : the published catalog. `basePrice` is what the customer
 *                  sees; `costBasis` / `marginAmount` are computed live
 *                  from the worksheet cost lines for the admin profit view.
 *   - addons      : applicable add-ons with their published price + cost.
 *   - corporate   : the parametric corporate-headshots config (or null if
 *                   corporate_pricing isn't seeded / is incomplete).
 *   - globals     : the resolved rate table, key → number.
 *
 * Numerics come back from `pg` as strings; everything is coerced to Number
 * here so callers never have to think about it.
 */

import { withClient } from '@/lib/db';
import {
  priceFromCostLines,
  corporatePricingFromRows,
  type CostLine,
  type PricingGlobals,
  type CorporatePricing,
  type RateRole,
} from '@/lib/pricing';

export type Branch = 'portraits' | 'realestate' | 'corporate';

export interface CatalogPackage {
  id: string;
  slug: string;
  name: string;
  branch: Branch;
  description: string | null;
  /** Published price — what the calculator shows the customer. */
  basePrice: number;
  defaultMargin: number;
  /** Computed live from worksheet cost lines (admin profit view). */
  costBasis: number;
  marginAmount: number;
}

export interface CatalogAddon {
  id: string;
  slug: string;
  name: string;
  /** Set → addon is specific to that package. */
  packageId: string | null;
  /** With packageId null: branch null = universal; else scoped to branch. */
  branch: Branch | null;
  description: string | null;
  basePrice: number;
  unitLabel: string | null;
  costBasis: number;
}

export interface Catalog {
  packages: CatalogPackage[];
  addons: CatalogAddon[];
  corporate: CorporatePricing | null;
  globals: PricingGlobals;
}

// ─── Shared quote input types ──────────────────────────────────────────
// Defined here (not in the 'use server' actions file) so the client
// component can import them as types without pulling in server code.

export type QuoteSelection =
  | { kind: 'package'; packageId: string; addonQtys: Record<string, number> }
  | { kind: 'corp-single'; featured: boolean }
  | { kind: 'corp-team'; standardCount: number; featuredCount: number; promo: boolean };

export interface QuoteClientInfo {
  name: string;
  email: string;
  phone: string;
  project: string;
  targetDate: string;
  notes: string;
}

export interface SaveQuoteResult {
  ok: boolean;
  quoteNumber?: number;
  id?: string;
  error?: string;
}

// ─── Row shapes (pg returns NUMERIC as string) ─────────────────────────
interface PkgRow {
  id: string;
  slug: string;
  name: string;
  branch: Branch;
  description: string | null;
  base_price: string;
  default_margin: string;
}
interface LineRow {
  package_id: string;
  kind: 'time' | 'hard';
  category: string;
  hours: string | null;
  rate_role: RateRole | null;
  amount: string | null;
}
interface AddonRow {
  id: string;
  slug: string;
  name: string;
  package_id: string | null;
  branch: Branch | null;
  description: string | null;
  base_price: string;
  unit_label: string | null;
  time_hours: string;
  hard_cost: string;
}
interface KVRow {
  key: string;
  value: string;
}

export async function getCatalog(): Promise<Catalog> {
  // All five reads run on ONE pooled client (queued sequentially on that
  // single connection) so the catalog costs the pool one slot, not five.
  // This is the fix for the render-time pool exhaustion: the prospect/jobs
  // pages await getCatalog inside their own ~5-way Promise.all, and five
  // separate pool.query calls here used to push the burst past the pool max.
  const { pkgRows, lineRows, addonRows, globalRows, corpRows } = await withClient(
    async (c) => ({
      pkgRows: (
        await c.query<PkgRow>(
          `SELECT id, slug, name, branch, description, base_price, default_margin
           FROM packages
           WHERE is_active = true
           ORDER BY branch, sort_order, name`,
        )
      ).rows,
      lineRows: (
        await c.query<LineRow>(
          `SELECT package_id, kind, category, hours, rate_role, amount
           FROM package_cost_lines
           ORDER BY package_id, sort_order`,
        )
      ).rows,
      addonRows: (
        await c.query<AddonRow>(
          `SELECT id, slug, name, package_id, branch, description,
                  base_price, unit_label, time_hours, hard_cost
           FROM addons
           WHERE is_active = true
           ORDER BY sort_order, name`,
        )
      ).rows,
      globalRows: (await c.query<KVRow>(`SELECT key, value FROM pricing_globals`)).rows,
      corpRows: (await c.query<KVRow>(`SELECT key, value FROM corporate_pricing`)).rows,
    }),
  );

  const globals: PricingGlobals = {};
  for (const g of globalRows) globals[g.key] = Number(g.value);

  // Group cost lines by package so each package can be priced.
  const linesByPkg = new Map<string, CostLine[]>();
  for (const r of lineRows) {
    const list = linesByPkg.get(r.package_id) ?? [];
    list.push(
      r.kind === 'time'
        ? {
            kind: 'time',
            category: r.category,
            hours: Number(r.hours),
            rateRole: r.rate_role,
          }
        : { kind: 'hard', category: r.category, amount: Number(r.amount) },
    );
    linesByPkg.set(r.package_id, list);
  }

  const packages: CatalogPackage[] = pkgRows.map((p) => {
    const defaultMargin = Number(p.default_margin);
    const lines = linesByPkg.get(p.id) ?? [];
    let costBasis = 0;
    let marginAmount = 0;
    if (lines.length > 0) {
      const r = priceFromCostLines(lines, globals, defaultMargin);
      costBasis = r.costBasis;
      marginAmount = r.marginAmount;
    }
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      branch: p.branch,
      description: p.description,
      basePrice: Number(p.base_price),
      defaultMargin,
      costBasis,
      marginAmount,
    };
  });

  // Addon cost basis is the simple flat form: LP time + hard cost.
  const lpRate = globals['lp_rate'] ?? 0;
  const addons: CatalogAddon[] = addonRows.map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    packageId: a.package_id,
    branch: a.branch,
    description: a.description,
    basePrice: Number(a.base_price),
    unitLabel: a.unit_label,
    costBasis: Number(a.time_hours) * lpRate + Number(a.hard_cost),
  }));

  // Corporate config — null if not seeded or a key is missing.
  let corporate: CorporatePricing | null = null;
  if (corpRows.length > 0) {
    const rows: Record<string, number> = {};
    for (const c of corpRows) rows[c.key] = Number(c.value);
    try {
      corporate = corporatePricingFromRows(rows);
    } catch {
      corporate = null;
    }
  }

  return { packages, addons, corporate, globals };
}
