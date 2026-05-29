/**
 * Phase R · The nightly snapshot rollup.
 *
 * Two functions:
 *
 *   `buildSnapshotRows(date, input)` — pure. Takes the five query
 *     results from §3.1 below, joins them into one row per
 *     (date × rep × workflow × stage), and returns the array.
 *     Easy to unit-test against fixtures.
 *
 *   `computeSnapshot(dayStartUtc, dayEndUtc)` — orchestrator. Runs the
 *     five SQL queries with the provided window, calls the pure
 *     function, and returns the assembled rows. Called by the
 *     `/api/cron/snapshot` route once a night.
 *
 * Date semantics: `dayStartUtc` is inclusive, `dayEndUtc` is
 * exclusive. The cron route passes "yesterday 00:00 CT → today
 * 00:00 CT" both converted to UTC (D-071). The `snapshot_date` saved
 * on every row is the calendar date of `dayStartUtc` in the same CT
 * timezone — i.e. the day the snapshot is *for*, not the day it ran.
 */

import { sql } from '@/lib/db';
import {
  ALL_STAGES,
  type CycleQueryRow,
  type ContactQueryRow,
  type RevenueQueryRow,
  type SnapshotInput,
  type SnapshotRow,
  type StateQueryRow,
  type TransitionQueryRow,
} from './types';

// ───────────────────────────────────────────────────────────────────────
// Pure assembly — easy to test against fixtures.
// ───────────────────────────────────────────────────────────────────────

interface RowKey {
  repId: string;
  workflowKey: string;
  stage: string;
}

function keyOf(k: RowKey): string {
  return `${k.repId}|${k.workflowKey}|${k.stage}`;
}

function emptyRow(date: string, k: RowKey): SnapshotRow {
  return {
    snapshotDate: date,
    repId: k.repId,
    workflowKey: k.workflowKey,
    stage: k.stage,
    prospectsInStage: 0,
    enteredStageToday: 0,
    exitedStageToday: 0,
    contactsSentToday: 0,
    responsesToday: 0,
    sumRankScore: 0,
    revenueClosedToday: 0,
    quotesAcceptedToday: 0,
    avgCycleDaysIntoStage: null,
  };
}

/**
 * Join the five query inputs into one row per (rep × workflow × stage).
 *
 * The output row set is the union of:
 *   - every (rep, workflow, stage) with non-zero end-of-day prospects
 *   - every (rep, workflow, stage) touched by a transition today
 *   - every (rep, workflow, stage) with contact activity today
 *   - every (rep, workflow) with revenue today (one row per stage we
 *     attribute revenue to — always `client`)
 *
 * Stages with zero activity AND zero state are dropped. The snapshot
 * row count is bounded by the number of (rep, workflow) pairs the
 * studio actively uses, multiplied by ~3-4 active stages per pair.
 */
export function buildSnapshotRows(
  snapshotDate: string,
  input: SnapshotInput,
): SnapshotRow[] {
  const map = new Map<string, SnapshotRow>();

  // Helper: get-or-create-and-return.
  const touch = (k: RowKey): SnapshotRow => {
    const key = keyOf(k);
    const existing = map.get(key);
    if (existing) return existing;
    const row = emptyRow(snapshotDate, k);
    map.set(key, row);
    return row;
  };

  // 1. End-of-day state — prospect count + score sum.
  for (const s of input.state) {
    const row = touch({
      repId: s.rep_id,
      workflowKey: s.workflow_key,
      stage: s.stage,
    });
    row.prospectsInStage = s.prospects_in_stage;
    row.sumRankScore = Number(s.sum_rank_score) || 0;
  }

  // 2. Transitions into a stage today.
  for (const t of input.entered) {
    const row = touch({
      repId: t.rep_id,
      workflowKey: t.workflow_key,
      stage: t.stage,
    });
    row.enteredStageToday = t.count;
  }

  // 3. Transitions out of a stage today.
  for (const t of input.exited) {
    const row = touch({
      repId: t.rep_id,
      workflowKey: t.workflow_key,
      stage: t.stage,
    });
    row.exitedStageToday = t.count;
  }

  // 4. Contact activity (sent + responses) today.
  for (const c of input.contacts) {
    const row = touch({
      repId: c.rep_id,
      workflowKey: c.workflow_key,
      stage: c.stage,
    });
    row.contactsSentToday = c.contacts_sent_today;
    row.responsesToday = c.responses_today;
  }

  // 5. Revenue from accepted quotes today. Attributed to the `client`
  //    stage since that's where the close lands the prospect.
  for (const r of input.revenue) {
    const row = touch({
      repId: r.rep_id,
      workflowKey: r.workflow_key,
      stage: 'client',
    });
    row.revenueClosedToday = Number(r.revenue_closed_today) || 0;
    row.quotesAcceptedToday = r.quotes_accepted_today;
  }

  // 6. Cycle-time avg per (workflow, to_stage). Workflow-level — copy
  //    onto every row matching that workflow/stage tuple, regardless of
  //    rep. We don't fabricate rows here; only annotate existing ones.
  const cycleByKey = new Map<string, number>();
  for (const c of input.cycle) {
    cycleByKey.set(`${c.workflow_key}|${c.to_stage}`, Number(c.avg_days));
  }
  for (const row of map.values()) {
    const avg = cycleByKey.get(`${row.workflowKey}|${row.stage}`);
    if (avg !== undefined && Number.isFinite(avg)) {
      row.avgCycleDaysIntoStage = avg;
    }
  }

  // Stable sort — by rep, then workflow, then the canonical stage order.
  // Makes the upsert deterministic and the integration tests readable.
  const stageRank = new Map<string, number>(
    ALL_STAGES.map((s, i) => [s as string, i]),
  );
  const out = Array.from(map.values());
  out.sort((a, b) => {
    if (a.repId !== b.repId) return a.repId.localeCompare(b.repId);
    if (a.workflowKey !== b.workflowKey)
      return a.workflowKey.localeCompare(b.workflowKey);
    return (
      (stageRank.get(a.stage) ?? 999) - (stageRank.get(b.stage) ?? 999)
    );
  });
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// Orchestrator — runs the five SQL queries, assembles, returns rows.
// ───────────────────────────────────────────────────────────────────────

/**
 * The snapshot date stored on every row, in CT. We compute the rollup
 * for the calendar day that *starts* at `dayStartUtc` in Central Time.
 * Postgres DATE columns are zone-naïve; we want every row's
 * `snapshot_date` to be the CT calendar date of the data, not the UTC
 * date of when the rollup ran.
 */
function snapshotDateLabel(dayStartUtc: Date): string {
  // dayStartUtc is "midnight CT in UTC" — formatting it back to CT
  // gives us the original civil date. We use `en-CA` because it
  // formats as YYYY-MM-DD by default, which matches Postgres DATE.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dayStartUtc);
}

export async function computeSnapshot(
  dayStartUtc: Date,
  dayEndUtc: Date,
): Promise<SnapshotRow[]> {
  const start = dayStartUtc.toISOString();
  const end = dayEndUtc.toISOString();

  const [state, entered, exited, contacts, revenue, cycle] = await Promise.all([
    // 1. End-of-day state per (rep × workflow × stage).
    //    We don't reconstruct historical state — we use prospects' current
    //    rows. The cron runs at end of day, so `now()` ≈ end of yesterday.
    //    For backfills this would need to project state, but Phase R is
    //    forward-only at launch.
    sql<StateQueryRow>`
      SELECT
        owner_id::text          AS rep_id,
        workflow_key            AS workflow_key,
        stage                   AS stage,
        COUNT(*)::int           AS prospects_in_stage,
        COALESCE(SUM(rank_score), 0)::numeric AS sum_rank_score
      FROM prospects
      WHERE updated_at < ${end}::timestamptz
      GROUP BY owner_id, workflow_key, stage
    `,

    // 2. Transitions INTO each stage today, grouped by destination stage.
    //    We attribute to the prospect's owner — the rep who'd see the
    //    movement on their dashboard.
    sql<TransitionQueryRow>`
      SELECT
        p.owner_id::text   AS rep_id,
        p.workflow_key     AS workflow_key,
        se.to_stage        AS stage,
        COUNT(*)::int      AS count
      FROM prospect_stage_events se
      JOIN prospects p ON p.id = se.prospect_id
      WHERE se.created_at >= ${start}::timestamptz
        AND se.created_at <  ${end}::timestamptz
      GROUP BY p.owner_id, p.workflow_key, se.to_stage
    `,

    // 3. Transitions OUT of each stage today, grouped by source stage.
    //    `from_stage IS NULL` is the synthetic INSERT row from the trigger
    //    — we skip those because there is no "exit" from a non-existent
    //    prior stage.
    sql<TransitionQueryRow>`
      SELECT
        p.owner_id::text   AS rep_id,
        p.workflow_key     AS workflow_key,
        se.from_stage      AS stage,
        COUNT(*)::int      AS count
      FROM prospect_stage_events se
      JOIN prospects p ON p.id = se.prospect_id
      WHERE se.created_at >= ${start}::timestamptz
        AND se.created_at <  ${end}::timestamptz
        AND se.from_stage IS NOT NULL
      GROUP BY p.owner_id, p.workflow_key, se.from_stage
    `,

    // 4. Contact activity today — sent and responses. Sends are bucketed
    //    by the prospect's *current* stage; responses likewise. (For
    //    snapshot purposes we want "where is the activity showing up?")
    sql<ContactQueryRow>`
      SELECT
        p.owner_id::text                 AS rep_id,
        p.workflow_key                   AS workflow_key,
        p.stage                          AS stage,
        COUNT(*) FILTER (
          WHERE pc.sent_at >= ${start}::timestamptz
            AND pc.sent_at <  ${end}::timestamptz
        )::int                           AS contacts_sent_today,
        COUNT(*) FILTER (
          WHERE pc.response_received
            AND pc.responded_at >= ${start}::timestamptz
            AND pc.responded_at <  ${end}::timestamptz
        )::int                           AS responses_today
      FROM prospect_contacts pc
      JOIN prospects p ON p.id = pc.prospect_id
      WHERE (pc.sent_at >= ${start}::timestamptz AND pc.sent_at < ${end}::timestamptz)
         OR (pc.response_received
             AND pc.responded_at >= ${start}::timestamptz
             AND pc.responded_at <  ${end}::timestamptz)
      GROUP BY p.owner_id, p.workflow_key, p.stage
    `,

    // 5. Revenue from accepted quotes whose status flipped today.
    //    `updated_at` is the proxy for "status changed today" since
    //    `quotes` has the `quotes_updated_at` BEFORE-UPDATE trigger.
    sql<RevenueQueryRow>`
      SELECT
        p.owner_id::text          AS rep_id,
        p.workflow_key            AS workflow_key,
        COALESCE(SUM(q.total_price), 0)::numeric AS revenue_closed_today,
        COUNT(*)::int             AS quotes_accepted_today
      FROM quotes q
      JOIN prospects p ON p.id = q.prospect_id
      WHERE q.status = 'accepted'
        AND q.updated_at >= ${start}::timestamptz
        AND q.updated_at <  ${end}::timestamptz
      GROUP BY p.owner_id, p.workflow_key
    `,

    // 6. Cycle-day avg per (workflow × to_stage) for today's transitions.
    //    For each transition today, days = (today's event ts) - (prior
    //    event ts for same prospect). Average per (workflow, destination
    //    stage). Workflow-level — same value across reps.
    sql<CycleQueryRow>`
      WITH today_transitions AS (
        SELECT
          se.id,
          se.prospect_id,
          se.to_stage,
          se.created_at,
          p.workflow_key
        FROM prospect_stage_events se
        JOIN prospects p ON p.id = se.prospect_id
        WHERE se.created_at >= ${start}::timestamptz
          AND se.created_at <  ${end}::timestamptz
          AND se.from_stage IS NOT NULL
      ),
      paired AS (
        SELECT
          t.workflow_key,
          t.to_stage,
          t.created_at AS transition_at,
          (
            SELECT MAX(prev.created_at)
            FROM prospect_stage_events prev
            WHERE prev.prospect_id = t.prospect_id
              AND prev.created_at < t.created_at
          ) AS prior_at
        FROM today_transitions t
      )
      SELECT
        workflow_key,
        to_stage,
        AVG(EXTRACT(EPOCH FROM (transition_at - prior_at)) / 86400.0)::numeric AS avg_days
      FROM paired
      WHERE prior_at IS NOT NULL
      GROUP BY workflow_key, to_stage
    `,
  ]);

  const date = snapshotDateLabel(dayStartUtc);
  return buildSnapshotRows(date, {
    state,
    entered,
    exited,
    contacts,
    revenue,
    cycle,
  });
}
