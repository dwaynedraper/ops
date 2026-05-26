'use server';

/**
 * Calculator server actions.
 *
 * `saveQuote` persists a quote built in the calculator. The client sends
 * a *selection* (which package + add-ons, or which corporate product) —
 * never prices. The action re-fetches the catalog and recomputes every
 * number server-side, so a tampered or stale client can't write a bogus
 * total. One transaction writes the quote, its lines, and a 'created'
 * event.
 */

import { auth } from '@/auth';
import { getPool } from '@/lib/db';
import { actionError } from '@/lib/action-error';
import { getCatalog, type QuoteSelection, type QuoteClientInfo, type SaveQuoteResult } from '@/lib/catalog';
import { singleExecPrice, computeTeamDay } from '@/lib/pricing';

interface BuiltLine {
  kind: 'package' | 'addon' | 'custom';
  refId: string | null;
  label: string;
  description: string | null;
  qty: number;
  unitLabel: string | null;
  unitPrice: number;
  unitCost: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export async function saveQuote(
  selection: QuoteSelection,
  client: QuoteClientInfo,
  prospectId: string | null = null,
): Promise<SaveQuoteResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Your session has expired — sign in again.' };

  const catalog = await getCatalog();

  const lines: BuiltLine[] = [];
  let packageId: string | null = null;
  let snapshot: Record<string, unknown> = {};

  if (selection.kind === 'package') {
    const pkg = catalog.packages.find((p) => p.id === selection.packageId);
    if (!pkg) return { ok: false, error: 'That package is no longer in the catalog.' };
    packageId = pkg.id;
    snapshot = { slug: pkg.slug, name: pkg.name, branch: pkg.branch, basePrice: pkg.basePrice };
    lines.push({
      kind: 'package',
      refId: pkg.id,
      label: pkg.name,
      description: pkg.description,
      qty: 1,
      unitLabel: null,
      unitPrice: pkg.basePrice,
      unitCost: pkg.costBasis,
    });
    for (const [addonId, rawQty] of Object.entries(selection.addonQtys)) {
      const qty = Number(rawQty);
      if (!Number.isFinite(qty) || qty < 1) continue;
      const addon = catalog.addons.find((a) => a.id === addonId);
      if (!addon) continue;
      lines.push({
        kind: 'addon',
        refId: addon.id,
        label: addon.name,
        description: addon.description,
        qty,
        unitLabel: addon.unitLabel,
        unitPrice: addon.basePrice,
        unitCost: addon.costBasis,
      });
    }
  } else if (selection.kind === 'corp-single') {
    if (!catalog.corporate) return { ok: false, error: 'Corporate pricing is not configured yet.' };
    const price = singleExecPrice(selection.featured, catalog.corporate);
    snapshot = { branch: 'corporate', product: 'single', featured: selection.featured };
    lines.push({
      kind: 'custom',
      refId: null,
      label: selection.featured ? 'Single Executive — Featured' : 'Single Executive — Standard',
      description: 'Corporate headshot · one executive.',
      qty: 1,
      unitLabel: null,
      unitPrice: price,
      unitCost: 0,
    });
  } else {
    if (!catalog.corporate) return { ok: false, error: 'Corporate pricing is not configured yet.' };
    const std = Math.max(0, Math.floor(selection.standardCount));
    const feat = Math.max(0, Math.floor(selection.featuredCount));
    const r = computeTeamDay({ standardCount: std, featuredCount: feat, promo: selection.promo }, catalog.corporate);
    snapshot = { branch: 'corporate', product: 'team', standardCount: std, featuredCount: feat, promo: selection.promo, breakdown: r };
    lines.push({
      kind: 'custom',
      refId: null,
      label: selection.promo ? 'Team Day — base (first-time)' : 'Team Day — base',
      description: null,
      qty: 1,
      unitLabel: null,
      unitPrice: r.base,
      unitCost: 0,
    });
    if (std > 0) {
      lines.push({
        kind: 'custom',
        refId: null,
        label: 'Standard headshots',
        description: r.standardDiscount > 0 ? `${Math.round(r.standardDiscount * 100)}% volume discount applied` : null,
        qty: std,
        unitLabel: 'per person',
        unitPrice: cents(r.standardSubtotal / std),
        unitCost: 0,
      });
    }
    if (feat > 0) {
      lines.push({
        kind: 'custom',
        refId: null,
        label: 'Featured headshots',
        description: r.featuredDiscount > 0 ? `${Math.round(r.featuredDiscount * 100)}% volume discount applied` : null,
        qty: feat,
        unitLabel: 'per person',
        unitPrice: cents(r.featuredSubtotal / feat),
        unitCost: 0,
      });
    }
  }

  if (lines.length === 0) return { ok: false, error: 'Add something to the quote first.' };

  // Totals — summed from the server-built lines.
  let totalPrice = 0;
  let totalCost = 0;
  const lineTotals = lines.map((l) => {
    const lineTotal = cents(l.unitPrice * l.qty);
    totalPrice += lineTotal;
    totalCost += cents(l.unitCost * l.qty);
    return lineTotal;
  });
  totalPrice = cents(totalPrice);
  totalCost = cents(totalCost);
  const totalMargin = cents(totalPrice - totalCost);

  const pool = getPool();
  const dbc = await pool.connect();
  try {
    await dbc.query('BEGIN');

    const inserted = await dbc.query<{ id: string; quote_number: number }>(
      `INSERT INTO quotes
         (created_by, client_name, client_email, client_phone, project_name,
          target_date, client_notes, status, package_id, package_snapshot,
          subtotal_price, subtotal_cost, total_price, total_cost, total_margin,
          prospect_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, quote_number`,
      [
        userId,
        client.name.trim() || null,
        client.email.trim() || null,
        client.phone.trim() || null,
        client.project.trim() || null,
        client.targetDate || null,
        client.notes.trim() || null,
        packageId,
        JSON.stringify(snapshot),
        totalPrice,
        totalCost,
        totalPrice,
        totalCost,
        totalMargin,
        prospectId,
      ],
    );
    const quote = inserted.rows[0];

    let order = 10;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await dbc.query(
        `INSERT INTO quote_lines
           (quote_id, kind, ref_id, label, description, qty, unit_label,
            unit_price, unit_cost, line_total, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [quote.id, l.kind, l.refId, l.label, l.description, l.qty, l.unitLabel, l.unitPrice, l.unitCost, lineTotals[i], order],
      );
      order += 10;
    }

    await dbc.query(
      `INSERT INTO quote_events (quote_id, user_id, kind, payload)
       VALUES ($1,$2,'created',$3)`,
      [quote.id, userId, JSON.stringify({ totalPrice, lineCount: lines.length })],
    );

    await dbc.query('COMMIT');
    return { ok: true, quoteNumber: quote.quote_number, id: quote.id };
  } catch (err) {
    await dbc.query('ROLLBACK');
    return { ok: false, error: actionError(err, 'Could not save the quote.') };
  } finally {
    dbc.release();
  }
}
