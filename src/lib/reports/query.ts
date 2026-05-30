/**
 * Phase R · Read-side queries for /reports.
 *
 * One entry point — `loadReportsData(range)` — returns six card-shaped
 * data structures, one per card. The Reports page passes each card its
 * own slice; cards do not query anything themselves.
 *
 * Range model: every query takes a `[startDate, endDate]` window
 * inclusive on both ends. The default range is the trailing 30 days
 * ending yesterday (the latest snapshot date).
 *
 * Where the data comes from:
 *   • Cards 1–5 read from `daily_metric_snapshot` exclusively.
 *   • Card 6 (Stale Pipeline) reads live from `prospects` +
 *     `prospect_contacts` — it shows current overdue prospects, not a
 *     historical snapshot.
 */

import { sql } from '@/lib/db';
import { ALL_STAGES, type ProspectStage } from './types';

export type DateRangeKey = '7' | '30' | '90' | 'ytd';

export interface DateRange {
  /** Inclusive start date, 'YYYY-MM-DD' (CT calendar). */
  start: string;
  /** Inclusive end date, 'YYYY-MM-DD' (CT calendar). */
  end: string;
  /** The selected preset, surfaced to the UI for the active state. */
  key: DateRangeKey;
  /** Human label for the page header. */
  label: string;
}

/** Resolve a UI range key into concrete dates anchored on "today CT". */
export function resolveRange(key: DateRangeKey, now: Date = new Date()): DateRange {
  const todayCt = todayInCt(now);
  // The latest *closed* day with a snapshot is yesterday CT.
  const end = addDaysCt(todayCt, -1);
  let start: string;
  let label: string;

  switch (key) {
    case '7':
      start = addDaysCt(end, -6);
      label = 'Last 7 days';
      break;
    case '30':
      start = addDaysCt(end, -29);
      label = 'Last 30 days';
      break;
    case '90':
      start = addDaysCt(end, -89);
      label = 'Last 90 days';
      break;
    case 'ytd': {
      const [y] = end.split('-');
      start = `${y}-01-01`;
      label = 'Year to date';
      break;
    }
  }
  return { start, end, key, label };
}

function todayInCt(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDaysCt(date: string, days: number): string {
  // date is 'YYYY-MM-DD'. Naive day-arithmetic on the calendar string is
  // fine for our window math — DST shifts don't span single dates.
  const [y, m, d] = date.split('-').map(Number);
  const ts = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(ts);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ─── Card-shaped types — what the page hands each card ─────────────────

export interface PipelineVelocityData {
  /** Today's expected $/day from the current pipeline. */
  perDay: number;
  /** Trailing 30 days of perDay values for the sparkline. */
  sparkline: number[];
  /** Vs. prior period — `+0.12` means 12% better, `-0.04` means 4% worse. */
  pctChange: number;
}

export interface FunnelStageRow {
  stage: ProspectStage;
  /** Cumulative entries to this stage across the range. */
  entered: number;
  /** % of the prior stage's `entered` (null for the first stage). */
  conversionFromPrior: number | null;
}

export interface FunnelData {
  stages: FunnelStageRow[];
}

export interface WorkflowRoiRow {
  workflowKey: string;
  workflowName: string;
  workflowAccent: string;
  avgDealValue: number;
  closeRate: number; // 0–1
  avgCycleDays: number | null;
  /** avgDealValue × closeRate */
  expectedPerClose: number;
}

export interface WorkflowRoiData {
  rows: WorkflowRoiRow[];
}

export interface RepLeaderboardRow {
  repId: string;
  name: string;
  sourced: number;
  contacted: number;
  replied: number;
  closed: number;
  /** replied / contacted, 0–1. */
  replyRate: number;
  /** closed / replied, 0–1. (Reply-to-close is the meaningful slice.) */
  closeRate: number;
  activePartner: boolean;
}

export interface RepLeaderboardData {
  rows: RepLeaderboardRow[];
}

export interface ScoreValidationBucket {
  /** Label like '0–2' or '8–10' (inclusive on the lower end, exclusive
   *  upper except for the top bucket). */
  label: string;
  closedCount: number;
  rejectedCount: number;
}

export interface ScoreValidationData {
  buckets: ScoreValidationBucket[];
}

export interface StalePipelineRow {
  prospectId: string;
  prospectName: string;
  workflowKey: string;
  workflowAccent: string;
  repName: string;
  daysStale: number;
  lastTouchLabel: string;
}

export interface StalePipelineData {
  rows: StalePipelineRow[];
}

export interface ReportsData {
  range: DateRange;
  velocity: PipelineVelocityData;
  funnel: FunnelData;
  workflowRoi: WorkflowRoiData;
  repLeaderboard: RepLeaderboardData;
  scoreValidation: ScoreValidationData;
  stalePipeline: StalePipelineData;
}

// ─── The aggregate loader ──────────────────────────────────────────────

/**
 * Load every card's data in one call. The snapshot table is the source
 * for cards 1–5; card 6 reads live.
 *
 * Each loader runs in isolation via Promise.allSettled — if one card's
 * SQL throws (a missing column, an empty table on a fresh deploy,
 * whatever), it logs and renders empty defaults rather than taking
 * down the entire /reports page.
 */
export async function loadReportsData(range: DateRange): Promise<ReportsData> {
  const [
    velocity,
    funnel,
    workflowRoi,
    repLeaderboard,
    scoreValidation,
    stalePipeline,
  ] = await Promise.all([
    safe('velocity',       () => loadPipelineVelocity(range), { perDay: 0, sparkline: [], pctChange: 0 }),
    safe('funnel',         () => loadFunnel(range),           { stages: [] }),
    safe('workflowRoi',    () => loadWorkflowRoi(range),      { rows: [] }),
    safe('repLeaderboard', () => loadRepLeaderboard(range),   { rows: [] }),
    safe('scoreValidation',() => loadScoreValidation(range),  { buckets: [] }),
    safe('stalePipeline',  () => loadStalePipeline(),         { rows: [] }),
  ]);
  return {
    range,
    velocity,
    funnel,
    workflowRoi,
    repLeaderboard,
    scoreValidation,
    stalePipeline,
  };
}

/**
 * Try-catch wrapper for each card loader. Errors are logged so Vercel
 * function logs surface the actual failure, but the card renders with
 * an empty default rather than taking down the page.
 */
async function safe<T>(
  cardId: string,
  loader: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await loader();
  } catch (err) {
    console.error(`[reports] card "${cardId}" failed:`, err);
    return fallback;
  }
}

// ─── Per-card loaders ──────────────────────────────────────────────────

/**
 * Pipeline Velocity (D-069):
 *   velocity_per_day =
 *     Σ over workflow (
 *       active_qualified_prospects(w) ×
 *       close_rate(w) ×
 *       avg_deal_value(w)
 *     ) ÷ avg_cycle_days_to_close(w)
 *
 * For v1 we approximate using the latest snapshot date in the range:
 *   - `active_qualified_prospects(w)` = SUM(prospects_in_stage) WHERE
 *     stage IN ('qualified','contacting','responded','signed')
 *   - `close_rate(w)` = closes_in_range / qualified_in_range over the
 *     range window
 *   - `avg_deal_value(w)` = revenue_in_range / closes_in_range
 *   - `avg_cycle_days_to_close(w)` = avg avg_cycle_days_into_stage on
 *     the `client` stage rows in the range
 *
 * The sparkline is 30 trailing single-day velocity computations from
 * the snapshot data ending at `range.end`.
 */
async function loadPipelineVelocity(range: DateRange): Promise<PipelineVelocityData> {
  interface Row {
    workflow_key: string;
    active_prospects: number;
    close_rate: number;
    avg_deal_value: number;
    avg_cycle_days: number;
  }
  const rows = await sql<Row>`
    WITH range AS (
      SELECT * FROM daily_metric_snapshot
      WHERE snapshot_date >= ${range.start}::date
        AND snapshot_date <= ${range.end}::date
    ),
    latest AS (
      SELECT workflow_key,
             SUM(prospects_in_stage)::numeric AS active_prospects
      FROM range
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM range)
        AND stage IN ('qualified','contacting','responded','signed')
      GROUP BY workflow_key
    ),
    closes AS (
      SELECT workflow_key,
             SUM(quotes_accepted_today)::numeric AS closes_in_range,
             SUM(revenue_closed_today)::numeric AS revenue_in_range,
             AVG(NULLIF(avg_cycle_days_into_stage, 0))
               FILTER (WHERE stage = 'client') AS avg_cycle_days
      FROM range
      GROUP BY workflow_key
    ),
    quals AS (
      SELECT workflow_key,
             SUM(entered_stage_today)::numeric AS quals_in_range
      FROM range
      WHERE stage = 'qualified'
      GROUP BY workflow_key
    )
    SELECT
      COALESCE(l.workflow_key, c.workflow_key, q.workflow_key) AS workflow_key,
      COALESCE(l.active_prospects, 0)::int AS active_prospects,
      CASE WHEN COALESCE(q.quals_in_range, 0) > 0
           THEN c.closes_in_range / q.quals_in_range
           ELSE 0 END::numeric AS close_rate,
      CASE WHEN COALESCE(c.closes_in_range, 0) > 0
           THEN c.revenue_in_range / c.closes_in_range
           ELSE 0 END::numeric AS avg_deal_value,
      COALESCE(c.avg_cycle_days, 0)::numeric AS avg_cycle_days
    FROM latest l
    FULL OUTER JOIN closes c USING (workflow_key)
    FULL OUTER JOIN quals  q USING (workflow_key)
  `;

  const perDay = rows.reduce((sum, r) => {
    const cycle = Number(r.avg_cycle_days);
    if (!cycle) return sum;
    return sum + (Number(r.active_prospects) * Number(r.close_rate) * Number(r.avg_deal_value)) / cycle;
  }, 0);

  // Sparkline — for v1 we use daily realized revenue as the trend
  // line. Computing the full velocity formula per day is mathematically
  // dubious (close rate is a multi-day signal) and the SQL gets gnarly
  // (window function nested in an aggregate). Daily revenue is a
  // cleaner "is money flowing today?" signal and the hero number
  // (perDay) above still uses the proper formula across the range.
  interface SparkRow {
    snapshot_date: string;
    value: number;
  }
  const spark = await sql<SparkRow>`
    SELECT snapshot_date::text AS snapshot_date,
           COALESCE(SUM(revenue_closed_today), 0)::numeric AS value
    FROM daily_metric_snapshot
    WHERE snapshot_date >= ${range.start}::date
      AND snapshot_date <= ${range.end}::date
    GROUP BY snapshot_date
    ORDER BY snapshot_date
  `;

  // pctChange — current half vs prior half of the range.
  const sparkline = spark.map((s) => Number(s.value));
  const mid = Math.floor(sparkline.length / 2);
  const priorAvg = mean(sparkline.slice(0, mid));
  const currentAvg = mean(sparkline.slice(mid));
  const pctChange = priorAvg > 0 ? (currentAvg - priorAvg) / priorAvg : 0;

  return { perDay, sparkline, pctChange };
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Funnel — sum entered_stage_today per destination stage across the
 * range. Conversion % uses each stage's entered as the denominator for
 * the next stage's entered.
 *
 * We skip `rejected` and `dormant` — they're terminal off-ramps, not
 * funnel destinations.
 */
async function loadFunnel(range: DateRange): Promise<FunnelData> {
  interface Row {
    stage: ProspectStage;
    entered: number;
  }
  const rows = await sql<Row>`
    SELECT stage, COALESCE(SUM(entered_stage_today), 0)::int AS entered
    FROM daily_metric_snapshot
    WHERE snapshot_date >= ${range.start}::date
      AND snapshot_date <= ${range.end}::date
    GROUP BY stage
  `;
  const byStage = new Map(rows.map((r) => [r.stage, r.entered]));

  const FUNNEL_ORDER: ProspectStage[] = [
    'researching',
    'qualified',
    'contacting',
    'responded',
    'signed',
    'client',
  ];
  const stages: FunnelStageRow[] = [];
  let prior: number | null = null;
  for (const stage of FUNNEL_ORDER) {
    const entered = byStage.get(stage) ?? 0;
    const conversionFromPrior =
      prior !== null && prior > 0 ? entered / prior : null;
    stages.push({ stage, entered, conversionFromPrior });
    prior = entered;
  }
  return { stages };
}

/**
 * Workflow ROI — per workflow, the avg deal value, close rate, cycle
 * days, and expected $/close in the range.
 */
async function loadWorkflowRoi(range: DateRange): Promise<WorkflowRoiData> {
  interface Row {
    workflow_key: string;
    workflow_name: string;
    workflow_accent: string;
    revenue: number;
    closes: number;
    quals: number;
    cycle_days: number | null;
  }
  const rows = await sql<Row>`
    SELECT w.workflow_key,
           w.name        AS workflow_name,
           w.accent      AS workflow_accent,
           COALESCE(SUM(s.revenue_closed_today), 0)::numeric AS revenue,
           COALESCE(SUM(s.quotes_accepted_today), 0)::int    AS closes,
           COALESCE(SUM(CASE WHEN s.stage = 'qualified'
                             THEN s.entered_stage_today ELSE 0 END), 0)::int AS quals,
           AVG(NULLIF(s.avg_cycle_days_into_stage, 0))
             FILTER (WHERE s.stage = 'client')              AS cycle_days
    FROM workflows w
    LEFT JOIN daily_metric_snapshot s
      ON s.workflow_key = w.workflow_key
     AND s.snapshot_date >= ${range.start}::date
     AND s.snapshot_date <= ${range.end}::date
    WHERE w.active = true
    GROUP BY w.workflow_key, w.name, w.accent, w.sort_order
    ORDER BY w.sort_order, w.name
  `;
  const roi: WorkflowRoiRow[] = rows.map((r) => {
    const closes = Number(r.closes);
    const quals = Number(r.quals);
    const revenue = Number(r.revenue);
    const avgDealValue = closes > 0 ? revenue / closes : 0;
    const closeRate = quals > 0 ? closes / quals : 0;
    return {
      workflowKey: r.workflow_key,
      workflowName: r.workflow_name,
      workflowAccent: r.workflow_accent,
      avgDealValue,
      closeRate,
      avgCycleDays: r.cycle_days === null ? null : Number(r.cycle_days),
      expectedPerClose: avgDealValue * closeRate,
    };
  });
  // Sort by expected $/close, descending.
  roi.sort((a, b) => b.expectedPerClose - a.expectedPerClose);
  return { rows: roi };
}

/**
 * Rep Leaderboard — per rep: sourced, contacted, replied, closed in
 * the range. Active Partner badge driven by the rolling-6-month rule
 * (last closing within 180 days).
 */
async function loadRepLeaderboard(range: DateRange): Promise<RepLeaderboardData> {
  interface Row {
    rep_id: string;
    name: string;
    sourced: number;
    contacted: number;
    replied: number;
    closed: number;
    active_partner: boolean;
  }
  const rows = await sql<Row>`
    WITH range AS (
      SELECT * FROM daily_metric_snapshot
      WHERE snapshot_date >= ${range.start}::date
        AND snapshot_date <= ${range.end}::date
    ),
    last_close AS (
      SELECT rep_id, MAX(snapshot_date) AS last_close_date
      FROM daily_metric_snapshot
      WHERE quotes_accepted_today > 0
      GROUP BY rep_id
    )
    SELECT
      p.user_id::text                            AS rep_id,
      COALESCE(NULLIF(p.display_name, ''), u.name, u.email, 'Unnamed') AS name,
      COALESCE(SUM(CASE WHEN r.stage = 'researching'
                        THEN r.entered_stage_today ELSE 0 END), 0)::int AS sourced,
      COALESCE(SUM(r.contacts_sent_today), 0)::int                     AS contacted,
      COALESCE(SUM(r.responses_today), 0)::int                         AS replied,
      COALESCE(SUM(r.quotes_accepted_today), 0)::int                   AS closed,
      (lc.last_close_date IS NOT NULL
         AND lc.last_close_date >= (CURRENT_DATE - INTERVAL '180 days'))
                                                                       AS active_partner
    FROM ops_profiles p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN range r ON r.rep_id = p.user_id
    LEFT JOIN last_close lc ON lc.rep_id = p.user_id
    WHERE p.status = 'active'
    GROUP BY p.user_id, p.display_name, u.name, u.email, lc.last_close_date
    ORDER BY closed DESC, replied DESC, contacted DESC
  `;
  return {
    rows: rows.map((r) => {
      const contacted = Number(r.contacted);
      const replied = Number(r.replied);
      const closed = Number(r.closed);
      return {
        repId: r.rep_id,
        name: r.name,
        sourced: Number(r.sourced),
        contacted,
        replied,
        closed,
        replyRate: contacted > 0 ? replied / contacted : 0,
        closeRate: replied > 0 ? closed / replied : 0,
        activePartner: !!r.active_partner,
      };
    }),
  };
}

/**
 * Score Validation — bucket prospects by their rank_score at end-state
 * (client vs. rejected) over the range, using the snapshot's score sums
 * + counts. Five buckets: [0,2), [2,4), [4,6), [6,8), [8,10].
 *
 * For v1 we use the snapshot's sum_rank_score / prospects_in_stage for
 * the buckets. This is approximate (it averages within a stage) but
 * good enough to spot rubric calibration drift.
 *
 * A precise implementation would query `prospects.rank_score` directly
 * for prospects whose terminal stage was reached in the range. We can
 * upgrade to that if Dean wants finer-grained validation.
 */
async function loadScoreValidation(range: DateRange): Promise<ScoreValidationData> {
  interface Row {
    bucket_idx: number;
    closed_count: number;
    rejected_count: number;
  }
  // We grade per-row average score → bucket. CASE walls do the binning.
  const rows = await sql<Row>`
    WITH terminal AS (
      SELECT stage, prospects_in_stage, sum_rank_score
      FROM daily_metric_snapshot
      WHERE snapshot_date >= ${range.start}::date
        AND snapshot_date <= ${range.end}::date
        AND stage IN ('client', 'rejected')
        AND prospects_in_stage > 0
    ),
    bucketed AS (
      SELECT stage,
             prospects_in_stage,
             CASE
               WHEN (sum_rank_score / prospects_in_stage) < 2  THEN 0
               WHEN (sum_rank_score / prospects_in_stage) < 4  THEN 1
               WHEN (sum_rank_score / prospects_in_stage) < 6  THEN 2
               WHEN (sum_rank_score / prospects_in_stage) < 8  THEN 3
               ELSE 4
             END AS bucket_idx
      FROM terminal
    )
    SELECT bucket_idx,
           COALESCE(SUM(prospects_in_stage) FILTER (WHERE stage = 'client'),   0)::int AS closed_count,
           COALESCE(SUM(prospects_in_stage) FILTER (WHERE stage = 'rejected'), 0)::int AS rejected_count
    FROM bucketed
    GROUP BY bucket_idx
    ORDER BY bucket_idx
  `;
  const LABELS = ['0–2', '2–4', '4–6', '6–8', '8–10'];
  const buckets: ScoreValidationBucket[] = LABELS.map((label, i) => {
    const row = rows.find((r) => Number(r.bucket_idx) === i);
    return {
      label,
      closedCount: row ? Number(row.closed_count) : 0,
      rejectedCount: row ? Number(row.rejected_count) : 0,
    };
  });
  return { buckets };
}

/**
 * Stale Pipeline — live query against prospects + prospect_contacts.
 * A prospect is "stale" when it's in a mid-cycle stage (contacting or
 * responded) and the most recent contact_at is >=14 days ago.
 */
async function loadStalePipeline(): Promise<StalePipelineData> {
  interface Row {
    prospect_id: string;
    contact_name: string;
    workflow_key: string;
    workflow_accent: string;
    rep_name: string;
    last_touch_at: Date | null;
    days_stale: number;
  }
  const rows = await sql<Row>`
    WITH last_touch AS (
      SELECT prospect_id,
             MAX(GREATEST(sent_at, COALESCE(responded_at, sent_at))) AS last_touch_at
      FROM prospect_contacts
      GROUP BY prospect_id
    )
    SELECT p.id::text                AS prospect_id,
           p.contact_name             AS contact_name,
           p.workflow_key             AS workflow_key,
           w.accent                   AS workflow_accent,
           COALESCE(NULLIF(op.display_name, ''), u.name, u.email, 'Unnamed') AS rep_name,
           lt.last_touch_at,
           EXTRACT(DAY FROM (NOW() - lt.last_touch_at))::int AS days_stale
    FROM prospects p
    JOIN workflows w ON w.workflow_key = p.workflow_key
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN ops_profiles op ON op.user_id = p.owner_id
    LEFT JOIN last_touch lt ON lt.prospect_id = p.id
    WHERE p.stage IN ('contacting', 'responded')
      AND lt.last_touch_at IS NOT NULL
      AND lt.last_touch_at <= (NOW() - INTERVAL '14 days')
    ORDER BY days_stale DESC, rep_name, contact_name
    LIMIT 50
  `;
  const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  return {
    rows: rows.map((r) => ({
      prospectId: r.prospect_id,
      prospectName: r.contact_name,
      workflowKey: r.workflow_key,
      workflowAccent: r.workflow_accent,
      repName: r.rep_name,
      daysStale: Number(r.days_stale),
      lastTouchLabel: r.last_touch_at ? dateFmt.format(new Date(r.last_touch_at)) : '—',
    })),
  };
}

// Helper used by the page header.
export { ALL_STAGES };
