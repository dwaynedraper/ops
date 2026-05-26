/**
 * Quote data access — the read path for the quote detail page and the
 * PDF route.
 *
 * `loadQuoteForUser` loads a quote with its line items and audit events,
 * access-checked: the rep who created it, or a super_admin (D-019-style
 * owner scoping). Returns null when the quote is missing or off-limits —
 * callers render a 404.
 *
 * Numerics come back from `pg` as strings; everything is coerced here.
 */

import { auth } from '@/auth';
import { sql, sqlOne, isUuid } from '@/lib/db';

export interface QuoteLineRecord {
  kind: 'package' | 'addon' | 'custom';
  label: string;
  description: string | null;
  qty: number;
  unitLabel: string | null;
  unitPrice: number;
  lineTotal: number;
}

export interface QuoteEventRecord {
  kind: string;
  createdAtLabel: string;
}

export interface QuoteRecord {
  id: string;
  quoteNumber: number;
  status: string;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  projectName: string | null;
  targetDateLabel: string | null;
  clientNotes: string | null;
  totalPrice: number;
  totalCost: number;
  totalMargin: number;
  createdAtLabel: string;
  createdByName: string | null;
  prospectId: string | null;
}

export interface LoadedQuote {
  quote: QuoteRecord;
  lines: QuoteLineRecord[];
  events: QuoteEventRecord[];
  viewerRole: 'super_admin' | 'partner';
}

interface QuoteRow {
  id: string;
  quote_number: number;
  created_by: string;
  status: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  project_name: string | null;
  target_date: Date | null;
  client_notes: string | null;
  total_price: string;
  total_cost: string;
  total_margin: string;
  created_at: Date;
  created_by_name: string | null;
  prospect_id: string | null;
}
interface LineRow {
  kind: 'package' | 'addon' | 'custom';
  label: string;
  description: string | null;
  qty: string;
  unit_label: string | null;
  unit_price: string;
  line_total: string;
}
interface EventRow {
  kind: string;
  created_at: Date;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Load a quote for the signed-in user. Returns null if the quote does
 * not exist, or belongs to another rep and the viewer is not a
 * super_admin.
 */
export async function loadQuoteForUser(id: string): Promise<LoadedQuote | null> {
  // A malformed id (not a UUID — e.g. a hand-edited or stale URL) would
  // make Postgres throw on the `WHERE q.id = ...` clause below, surfacing
  // as an unhandled 500. Treat it as a clean not-found instead, so the
  // PDF route and the quote detail page both render their 404.
  if (!isUuid(id)) return null;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const viewerRole = session.user?.role === 'super_admin' ? 'super_admin' : 'partner';

  const row = await sqlOne<QuoteRow>`
    SELECT q.id, q.quote_number, q.created_by, q.status, q.client_name,
           q.client_email, q.client_phone, q.project_name, q.target_date,
           q.client_notes, q.total_price, q.total_cost, q.total_margin,
           q.created_at, q.prospect_id, u.name AS created_by_name
    FROM quotes q
    LEFT JOIN users u ON u.id = q.created_by
    WHERE q.id = ${id}`;
  if (!row) return null;
  if (row.created_by !== userId && viewerRole !== 'super_admin') return null;

  const [lineRows, eventRows] = await Promise.all([
    sql<LineRow>`
      SELECT kind, label, description, qty, unit_label, unit_price, line_total
      FROM quote_lines
      WHERE quote_id = ${id}
      ORDER BY sort_order`,
    sql<EventRow>`
      SELECT kind, created_at
      FROM quote_events
      WHERE quote_id = ${id}
      ORDER BY created_at`,
  ]);

  const quote: QuoteRecord = {
    id: row.id,
    quoteNumber: row.quote_number,
    status: row.status,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    projectName: row.project_name,
    targetDateLabel: row.target_date ? DATE_FMT.format(new Date(row.target_date)) : null,
    clientNotes: row.client_notes,
    totalPrice: Number(row.total_price),
    totalCost: Number(row.total_cost),
    totalMargin: Number(row.total_margin),
    createdAtLabel: DATE_FMT.format(new Date(row.created_at)),
    createdByName: row.created_by_name,
    prospectId: row.prospect_id,
  };

  const lines: QuoteLineRecord[] = lineRows.map((l) => ({
    kind: l.kind,
    label: l.label,
    description: l.description,
    qty: Number(l.qty),
    unitLabel: l.unit_label,
    unitPrice: Number(l.unit_price),
    lineTotal: Number(l.line_total),
  }));

  const events: QuoteEventRecord[] = eventRows.map((e) => ({
    kind: e.kind,
    createdAtLabel: DATE_FMT.format(new Date(e.created_at)),
  }));

  return { quote, lines, events, viewerRole };
}
