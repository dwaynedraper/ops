/**
 * Rep pulse — a live, last-30-days performance snapshot for the dashboard
 * (Phase 4 of CLIENTS-AND-JOBS-PLAN.md). Distinct from /reports, which
 * reads the nightly snapshot table: this is a small live query so the card
 * is current even before the cron has run, and needs no snapshot history.
 *
 * Super-admin only (the dashboard gates it). Three numbers per rep over the
 * window: prospects signed (by closer), jobs booked (by owner), and revenue
 * from jobs marked paid (by owner). The pure ranker is unit-tested; the DB
 * loader sits on top.
 */

import { sql } from '@/lib/db';

export const PULSE_WINDOW_DAYS = 30;

export interface RepPulseRow {
  repId: string;
  repName: string;
  /** Prospects whose stage entered 'signed' in the window (by closer). */
  signed: number;
  /** Jobs created in the window (by owner). */
  booked: number;
  /** Sum of value_price on jobs marked paid in the window (by owner). */
  revenue: number;
}

/**
 * Rank reps for the pulse: revenue first (money closed), signings as the
 * tiebreak, then bookings. Pure + deterministic. Reps with zero activity
 * across all three are dropped — the card shows who actually moved.
 */
export function rankRepPulse(rows: RepPulseRow[]): RepPulseRow[] {
  return rows
    .filter((r) => r.revenue > 0 || r.signed > 0 || r.booked > 0)
    .sort((a, b) => b.revenue - a.revenue || b.signed - a.signed || b.booked - a.booked);
}

interface CountRow {
  rep_id: string;
  n: number;
}
interface RevenueRow {
  rep_id: string;
  revenue: string;
}
interface NameRow {
  id: string;
  name: string | null;
}

/**
 * Compute the rep pulse over the trailing `days` window as of `now`.
 * Returns every rep with activity, ranked. The caller (dashboard) takes
 * the top N for display.
 */
export async function computeRepPulse(
  now: Date = new Date(),
  days: number = PULSE_WINDOW_DAYS,
): Promise<RepPulseRow[]> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();

  const [signedRows, bookedRows, revenueRows] = await Promise.all([
    // Signed in-window, attributed to whoever closed it (fallback owner).
    sql<CountRow>`
      SELECT COALESCE(p.signed_by_id, p.owner_id) AS rep_id, COUNT(*)::int AS n
      FROM prospect_stage_events e
      JOIN prospects p ON p.id = e.prospect_id
      WHERE e.to_stage = 'signed' AND e.created_at >= ${since}
      GROUP BY COALESCE(p.signed_by_id, p.owner_id)`,
    sql<CountRow>`
      SELECT owner_id AS rep_id, COUNT(*)::int AS n
      FROM jobs
      WHERE created_at >= ${since}
      GROUP BY owner_id`,
    sql<RevenueRow>`
      SELECT owner_id AS rep_id, COALESCE(SUM(value_price), 0) AS revenue
      FROM jobs
      WHERE payment_status = 'paid' AND value_price IS NOT NULL AND updated_at >= ${since}
      GROUP BY owner_id`,
  ]);

  const byRep = new Map<string, RepPulseRow>();
  const ensure = (id: string): RepPulseRow => {
    let r = byRep.get(id);
    if (!r) {
      r = { repId: id, repName: 'Unknown', signed: 0, booked: 0, revenue: 0 };
      byRep.set(id, r);
    }
    return r;
  };
  for (const r of signedRows) ensure(r.rep_id).signed = r.n;
  for (const r of bookedRows) ensure(r.rep_id).booked = r.n;
  for (const r of revenueRows) ensure(r.rep_id).revenue = Number(r.revenue);

  const ids = [...byRep.keys()];
  if (ids.length === 0) return [];

  const names = await sql<NameRow>`
    SELECT u.id, COALESCE(NULLIF(pr.display_name, ''), u.name, u.email) AS name
    FROM users u
    LEFT JOIN ops_profiles pr ON pr.user_id = u.id
    WHERE u.id = ANY(${ids})`;
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  for (const r of byRep.values()) r.repName = nameById.get(r.repId) ?? 'Unknown';

  return rankRepPulse([...byRep.values()]);
}
