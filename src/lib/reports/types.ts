/**
 * Shared types for Phase R reporting.
 *
 * The split: `SnapshotRow` matches the `daily_metric_snapshot` table
 * exactly (one row per date × rep × workflow × stage). The
 * `*QueryRow` types are the shapes each individual lookup query
 * returns from Postgres — small, denormalized, joined into a final
 * `SnapshotRow` by `buildSnapshotRows`.
 *
 * Everything here is server-only — these shapes shouldn't be imported
 * into client components. The Reports page passes pre-aggregated
 * card-shaped data down to its cards, not these row shapes.
 */

/** The eight prospect lifecycle stages from `prospects.stage` CHECK. */
export const ALL_STAGES = [
  'researching',
  'qualified',
  'contacting',
  'responded',
  'call_booked',
  'signed',
  'client',
  'rejected',
  'dormant',
] as const;

export type ProspectStage = (typeof ALL_STAGES)[number];

/**
 * A single row in `daily_metric_snapshot`. Matches the schema column
 * names 1:1 (camelCased) so the upsert serializer doesn't need a
 * translation layer.
 */
export interface SnapshotRow {
  snapshotDate: string; // ISO date 'YYYY-MM-DD' — Postgres DATE
  repId: string;
  workflowKey: string;
  stage: ProspectStage | string;

  prospectsInStage: number;
  enteredStageToday: number;
  exitedStageToday: number;

  contactsSentToday: number;
  responsesToday: number;

  sumRankScore: number;

  revenueClosedToday: number;
  quotesAcceptedToday: number;

  avgCycleDaysIntoStage: number | null;
}

// ─── The query-result row shapes ──────────────────────────────────────

/** End-of-day prospects-in-stage state per (rep × workflow × stage). */
export interface StateQueryRow {
  rep_id: string;
  workflow_key: string;
  stage: string;
  prospects_in_stage: number;
  sum_rank_score: number;
}

/** Same-day transitions, one row per stage that gained / lost entries. */
export interface TransitionQueryRow {
  rep_id: string;
  workflow_key: string;
  stage: string; // The destination stage for `entered`; source for `exited`
  count: number;
}

/** Same-day contact activity per (rep × workflow × stage). */
export interface ContactQueryRow {
  rep_id: string;
  workflow_key: string;
  stage: string;
  contacts_sent_today: number;
  responses_today: number;
}

/** Same-day accepted-quote revenue per (rep × workflow). */
export interface RevenueQueryRow {
  rep_id: string;
  workflow_key: string;
  revenue_closed_today: number;
  quotes_accepted_today: number;
}

/**
 * Average cycle days into each (workflow × to_stage) for today's
 * transitions. Workflow-level — the value is the same across every rep
 * in that workflow/stage tuple, but we copy it onto every row at
 * assembly time for query simplicity downstream.
 */
export interface CycleQueryRow {
  workflow_key: string;
  to_stage: string;
  avg_days: number;
}

// ─── A bundle of the five query results — the input to buildSnapshotRows ─

export interface SnapshotInput {
  state: StateQueryRow[];
  entered: TransitionQueryRow[];
  exited: TransitionQueryRow[];
  contacts: ContactQueryRow[];
  revenue: RevenueQueryRow[];
  cycle: CycleQueryRow[];
}
