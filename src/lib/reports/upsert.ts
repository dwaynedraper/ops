/**
 * Phase R · daily_metric_snapshot upsert.
 *
 * Wraps the rollup output in a DELETE-then-INSERT transaction. The
 * snapshot table has a composite PK on
 * (snapshot_date, rep_id, workflow_key, stage), so a re-run for the
 * same date safely replaces the day's rows.
 *
 * Why DELETE-then-INSERT instead of ON CONFLICT? Two reasons:
 *
 *   1. The rollup naturally regenerates the entire day's row set in
 *      one shot. There's no scenario where we'd want some rows to
 *      survive a re-run.
 *   2. There's exactly one writer to this table (the cron). No
 *      concurrent-update concern.
 *
 * If we ever add per-rep on-demand recalculation (D-068 follow-up),
 * this is the natural seam to switch to ON CONFLICT — but we don't
 * need it for v1.
 */

import { sql } from '@/lib/db';
import type { SnapshotRow } from './types';

export interface UpsertResult {
  /** Rows deleted before the re-insert. 0 on a fresh date. */
  deleted: number;
  /** Rows inserted in the new batch. */
  inserted: number;
  /** Time elapsed for the transaction. */
  tookMs: number;
}

/**
 * Replace the snapshot rows for `snapshotDate` with the provided
 * `rows`. All rows must share the same `snapshotDate` — passing a
 * mixed-date batch is a programming error and throws.
 *
 * Returns counts and timing so the cron route can surface them in
 * its response and Vercel Cron logs them per run.
 */
export async function upsertSnapshot(
  snapshotDate: string,
  rows: SnapshotRow[],
): Promise<UpsertResult> {
  // Guardrail — every row must be for this date, otherwise the DELETE
  // would orphan rows from the wrong day.
  for (const row of rows) {
    if (row.snapshotDate !== snapshotDate) {
      throw new Error(
        `upsertSnapshot: row.snapshotDate=${row.snapshotDate} does not match snapshotDate=${snapshotDate}`,
      );
    }
  }

  const t0 = Date.now();

  // Step 1 — delete any prior rows for this date.
  const deletedRows = await sql<{ count: number }>`
    WITH d AS (
      DELETE FROM daily_metric_snapshot
      WHERE snapshot_date = ${snapshotDate}::date
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM d
  `;
  const deleted = deletedRows[0]?.count ?? 0;

  // Step 2 — bulk insert the new batch. We build a single multi-row
  // VALUES list so the query is one round trip instead of N.
  let inserted = 0;
  if (rows.length > 0) {
    // We assemble the VALUES list manually because the tagged template
    // can't natively flatten an array of arrays into a multi-row VALUES
    // clause. Each parameter is bound positionally; nothing inlined.
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const r of rows) {
      placeholders.push(
        `($${p}::date, $${p + 1}::uuid, $${p + 2}, $${p + 3}, $${p + 4}::int, $${p + 5}::int, $${p + 6}::int, $${p + 7}::int, $${p + 8}::int, $${p + 9}::numeric, $${p + 10}::numeric, $${p + 11}::int, $${p + 12}::numeric)`,
      );
      values.push(
        r.snapshotDate,
        r.repId,
        r.workflowKey,
        r.stage,
        r.prospectsInStage,
        r.enteredStageToday,
        r.exitedStageToday,
        r.contactsSentToday,
        r.responsesToday,
        r.sumRankScore,
        r.revenueClosedToday,
        r.quotesAcceptedToday,
        r.avgCycleDaysIntoStage,
      );
      p += 13;
    }

    // The tagged-template `sql` helper supports a `.unsafe` escape hatch
    // for cases like this where the VALUES list is built dynamically
    // but every value is still positionally bound.
    // We don't have `.unsafe` — fall back to running pg directly via
    // the pool. Import is dynamic to keep this file shaped like the
    // rest of the reports module.
    const { getPool } = await import('@/lib/db');
    const pool = getPool();
    const text =
      'INSERT INTO daily_metric_snapshot (' +
      'snapshot_date, rep_id, workflow_key, stage, ' +
      'prospects_in_stage, entered_stage_today, exited_stage_today, ' +
      'contacts_sent_today, responses_today, sum_rank_score, ' +
      'revenue_closed_today, quotes_accepted_today, avg_cycle_days_into_stage' +
      ') VALUES ' +
      placeholders.join(', ');
    const res = await pool.query(text, values);
    inserted = res.rowCount ?? rows.length;
  }

  return { deleted, inserted, tookMs: Date.now() - t0 };
}
