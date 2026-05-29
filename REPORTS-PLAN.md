# Phase R — Reports

> **Status: PLANNED (2026-05-28).** Specification only — no code yet.
> Decision log entries D-068 through D-074 captured below; will be
> mirrored into BUILD-PLAN §10 when R0.5 lands the CHANGELOG stub.
>
> Covers: admin-only analytics inside Ops — a `/reports` route, a
> nightly snapshot table populated by a new cron job, and six
> dashboard cards designed around three decisions Dean actually has
> to make ("Is my pipeline healthy?", "Which workflow do I push?",
> "Which rep deserves my time?"). Pipeline Velocity is the hero.

---

## 1. The shift

Today, Ops captures every event a sales motion produces — sourcing
intakes, stage transitions, contact attempts, quote accepts — but
none of it is summarized anywhere a human can see a trend. Dean has
to guess at which workflow is converting, which rep is producing,
and whether the rank-factor rubric is earning its keep.

Phase R closes that gap. A nightly rollup writes one summary row per
`(date × rep × workflow × stage)` tuple into a new
`daily_metric_snapshot` table. A new `/reports` page in Ops reads
from the snapshot table (never the live event tables) so charts
render instantly across any date range. Six cards answer the three
recurring decisions. The build is intentionally analytics-on-top —
no event-capture changes anywhere in the app.

The architecture is deliberately small. No Looker, no Mixpanel, no
PostHog, no Segment, no third-party data egress. Postgres, the
existing Vercel cron, the existing Resend digest infra. Everything
in the stack Dean already pays for and operates.

---

## 2. The new shape

**Nightly:** a snapshot cron at 05:00 UTC (00:00 CT) computes
yesterday's rollups and upserts them into
`daily_metric_snapshot`. Idempotent — re-running for yesterday
overwrites cleanly. Runs in the same `/api/cron/*` shape as the
existing digest cron, with the same `CRON_SECRET` gate.

**On-demand:** `/reports` reads from the snapshot table for the
chosen date range (default: last 30 days). Six cards render. None
of them query the live `prospect_stage_events` or
`prospect_contacts` tables — those stay untouched, snapshot is the
only consumer.

**The six cards (top to bottom):**

| # | Card | Question it answers |
| --- | --- | --- |
| 1 | **Pipeline Velocity** (hero) | "Is my pipeline healthy?" |
| 2 | Funnel | "Where is my motion leaking?" |
| 3 | Workflow ROI | "Which workflow do I push?" |
| 4 | Rep Leaderboard | "Which reps are producing?" |
| 5 | Score Validation | "Is my rubric earning its keep?" |
| 6 | Stale Pipeline | "What am I sitting on?" |

Cards 1, 5, and 6 are computed at view time from the snapshot.
Cards 2, 3, 4 read aggregates directly off the snapshot rows for
the date range.

---

## 3. Confirmed decisions

These come from the kickoff conversation (2026-05-28). None are
revisable without a follow-up decision log entry.

### 3.1 Audience scope — admin only · D-068

`/reports` is gated to admin users only — same pattern as `/team`
and `/rates`. Reps do not see analytics in v1. A per-rep "your
numbers" view is interesting and the snapshot schema supports it,
but it is explicitly out of scope for Phase R. Slot it as a
follow-up phase if Dean wants it after a few weeks of admin
usage.

**Rationale.** Dean is the only admin and the only person making
the three decisions the cards answer. Adding rep-scoped auth doubles
the route surface for a feature that isn't yet validated. Ship
admin first; observe what's useful; rep view later if it's earned.

### 3.2 Pipeline Velocity is the hero · D-069

Pipeline Velocity sits at the top of the page, full width, big
number, sparkline trend. The other five cards stack below in a
two-column grid on desktop, single-column on mobile.

**Pipeline Velocity formula:**

```
velocity_per_day =
    (active_qualified_prospects × workflow_close_rate × workflow_avg_value)
    ÷ workflow_avg_cycle_days
```

Summed across all workflows. The result is "expected dollars per
day from current pipeline." It's a leading number — it moves before
revenue moves — and it's the single best 5-second daily check-in.

### 3.3 Cardinality — (date × rep × workflow × stage) · D-070

The snapshot row grain is one row per
`(snapshot_date, rep_id, workflow_key, stage)`. This is the
finest grain that powers every card without storing per-prospect
detail.

Worst-case rowcount: ~5 reps × 5 workflows × 8 stages × 365 days =
~73K rows/year. Trivial for Neon's free tier and indexable for
sub-millisecond date-range scans.

Per-prospect, per-contact event detail stays in
`prospect_stage_events` and `prospect_contacts` — the snapshot
references aggregates of those rows, never duplicates them.

### 3.4 Separate cron, runs before the digest · D-071

The snapshot is a new cron at 05:00 UTC (midnight CT) — not a
chained handler off the existing digest cron at 13:00 UTC.

**Rationale.** Running the snapshot when the day ends gives the
cleanest "yesterday is closed" semantics. By the time the digest
cron fires at 8 AM CT, yesterday's snapshot has been live for 8
hours. If the snapshot fails, alerting fires hours before the
digest tries to use it. Chaining was considered and rejected:
combining two responsibilities in one handler makes failure modes
muddier.

### 3.5 No third-party analytics · D-072

Explicitly out of scope: Mixpanel, PostHog, Segment, Plausible,
Google Analytics, any external dashboarding tool. Everything lives
in the Ops Postgres and the Ops UI. Dean owns the data, the
queries, the visualization, and the access list. Zero data egress.

**Rationale.** Phase R is meant to answer three decisions, not
build a BI department. A third-party tool would lock in a learning
curve, monthly cost, and a privacy footprint for a feature that
needs to be a 5-second daily check, not a slice-and-dice
exploration. Reconsider if usage outgrows the snapshot model.

### 3.6 Vanity metrics explicitly cut · D-073

Out of scope, intentionally: email opens, click counts, page
views, time-on-site, A/B test arms, prospect view duration. These
are vanity numbers that don't predict closes and are expensive to
capture without third-party SDKs. The leading indicators that
*do* predict closes — reply rate, time-to-second-touch,
score-to-close correlation — are all computable from existing
captured events.

### 3.7 Optional digest extension — R6, deferrable · D-074

A "yesterday's snapshot" three-card block can be appended to the
existing 6am Resend digest email. This is **R6** in the plan
order and is the only phase that's explicitly deferrable without
blocking. R1–R5 ship as a unit; R6 ships when it does or rolls
into a later phase if R1–R5 take longer than expected.

---

## 4. The plan, in order

Phase R follows the same shape as Phase E and Phase F before it:
docs first, then the schema migration, then the rollup, then the
UI, then tests and verification.

### R0 — Docs + recovery file

- `ops/REPORTS-PLAN.md` (this file) — every decision, every
  schema column, every card spec, every test slug. Recoverable
  across sessions.
- `ops/BUILD-PLAN.md` — Phase R added to §5, decision-log
  entries D-068 through D-074 added to §10.
- `ops/CHANGELOG.md` — Phase R placeholder so per-step shipping
  notes have a home as deliverables land.

### R1 — Schema migration

- Add `daily_metric_snapshot` to `src/lib/db/schema.sql`
  (see §5 below for the exact column list and indexes).
- Additive only. Idempotent. Safe to re-run.
- Run `npm run db:migrate`.
- No seed needed — the snapshot populates from real data on first
  cron run.

### R2 — Rollup function

- `src/lib/reports/rollup.ts` — a pure function `computeSnapshot(date,
  sql)` that returns the rows to upsert. Reads from
  `prospect_stage_events`, `prospects`, `prospect_contacts`,
  `quotes` for the given date.
- `src/lib/reports/upsert.ts` — wraps the function in a single
  transaction that DELETEs the target date's rows and INSERTs the
  new batch. (DELETE-then-INSERT is cleaner than ON CONFLICT for
  a multi-column key when the row count is bounded.)
- Tests in `src/lib/reports/rollup.test.ts` — see §8.

### R3 — Snapshot cron route

- New route `src/app/api/cron/snapshot/route.ts` — same shape as
  the existing digest route: `CRON_SECRET` gate, fail-closed,
  surfaces partial failures as non-2xx so Vercel Cron flags them.
- Adds an entry to `vercel.json` crons:
  `{ "path": "/api/cron/snapshot", "schedule": "0 5 * * *" }`.
- The route computes yesterday's date (in CT to keep the rollup
  aligned with the business day), calls the rollup, upserts, and
  returns counts.
- Documented in `README.md` alongside the digest cron.

### R4 — `/reports` route + auth

- `src/app/reports/` — admin-only. Server component loads the
  snapshot rows for the active date range; client component
  renders the six cards.
- Auth pattern: same admin gate as `/team`. If a non-admin loads
  `/reports`, redirect to `/dashboard`.
- Default date range: last 30 days. Date picker in the page
  header lets Dean switch to 7 / 30 / 90 / YTD / custom.
- A nav link in the sidebar — under the admin section, alongside
  `/team` and `/rates`.

### R5 — The six cards

Each card is its own component in `src/components/reports/`:

- `PipelineVelocityCard.tsx` — hero. Big number, 30-day sparkline,
  trend arrow vs. prior period.
- `FunnelCard.tsx` — Sourced → Qualified → Contacting →
  Responded → Signed → Client waterfall. Conversion % at each
  step. Arrow vs. prior period.
- `WorkflowRoiCard.tsx` — table sorted by expected $/close per
  workflow. Columns: workflow, avg deal value, close rate, cycle
  days, expected $/close.
- `RepLeaderboardCard.tsx` — table per rep, last 30 days:
  sourced, replied, closed, reply rate, close rate. Active Partner
  badge driven by the existing rolling-6-month rule.
- `ScoreValidationCard.tsx` — histogram. Score buckets on the
  x-axis (0–2, 2–4, 4–6, 6–8, 8–10); two series per bucket: %
  closed vs. % rejected. Tells Dean if the rubric is calibrated.
- `StalePipelineCard.tsx` — list of prospects in contact stage
  with no activity ≥14 days. Per rep. Each row clickable through
  to `/qualify/[id]`.

### R6 — Email digest extension (deferrable)

- Update `src/lib/digest.ts` and `src/lib/digest-email.ts` to
  append a "Yesterday's snapshot" block when Dean is the
  recipient. Three lines: pipeline velocity, this week's funnel
  reply rate, top mover/laggard.
- The block reads from `daily_metric_snapshot`. If the snapshot
  hasn't run for yesterday, the block degrades gracefully (just
  doesn't render).
- This phase is **deferrable** — R5 ships without R6 if the build
  runs long.

### R7 — Verify + finalize CHANGELOG

- `tsc --noEmit` clean.
- `eslint src` clean.
- `vitest run` — all of §8's tests green.
- Manual run of the snapshot cron via `?secret=` against the
  testing DB. Verify rows land in `daily_metric_snapshot`. Diff
  the row count against direct queries on `prospect_stage_events`.
- Manual walk of `/reports` with at least three days of snapshot
  data in the testing DB.
- Promote the Phase R placeholder in `CHANGELOG.md` to a real
  entry with Added / Fixed / Not changed sections filled in.
- Promote Phase R in `BUILD-PLAN.md` §5 to "complete" with the
  date.

---

## 5. Schema — the `daily_metric_snapshot` table

```sql
-- ────────────────────────────────────────────────────────────────
-- daily_metric_snapshot — Phase R
--
-- One row per (snapshot_date, rep_id, workflow_key, stage). Written
-- nightly by /api/cron/snapshot. Source of truth for /reports.
-- Never read by any other surface.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_metric_snapshot (
  snapshot_date   DATE   NOT NULL,
  rep_id          UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_key    TEXT   NOT NULL REFERENCES workflows(workflow_key) ON DELETE CASCADE,
  stage           TEXT   NOT NULL,

  -- Counters (end-of-day state for "stage" + same-day activity)
  prospects_in_stage     INTEGER NOT NULL DEFAULT 0,
  entered_stage_today    INTEGER NOT NULL DEFAULT 0,
  exited_stage_today     INTEGER NOT NULL DEFAULT 0,

  -- Activity (only meaningful for some stages; safe defaults elsewhere)
  contacts_sent_today    INTEGER NOT NULL DEFAULT 0,
  responses_today        INTEGER NOT NULL DEFAULT 0,

  -- Score distribution (sum + count → avg deferred to query)
  sum_rank_score         NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Revenue (only populated for the 'client' stage; accepted quotes total)
  revenue_closed_today   NUMERIC(12,2) NOT NULL DEFAULT 0,
  quotes_accepted_today  INTEGER NOT NULL DEFAULT 0,

  -- Cycle-time helpers (in days; null when no transitions happened)
  avg_cycle_days_into_stage NUMERIC(6,2),

  -- Audit
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (snapshot_date, rep_id, workflow_key, stage)
);

CREATE INDEX IF NOT EXISTS daily_metric_snapshot_date_idx
  ON daily_metric_snapshot(snapshot_date);
CREATE INDEX IF NOT EXISTS daily_metric_snapshot_rep_idx
  ON daily_metric_snapshot(rep_id, snapshot_date);
CREATE INDEX IF NOT EXISTS daily_metric_snapshot_workflow_idx
  ON daily_metric_snapshot(workflow_key, snapshot_date);
```

**Why this shape:**

- **Composite PK enforces idempotency.** A re-run for the same
  date safely overwrites because the rollup deletes-then-inserts
  by `snapshot_date`.
- **Stage-grained.** Every card except Workflow ROI is computable
  by summing rows across the right slice. Workflow ROI rolls up
  the `client` stage's revenue + the workflow's cycle-time avg.
- **Entered/exited counters** powering the funnel are stage-pair
  agnostic in storage — the funnel card reads
  `entered_stage_today` by destination stage and stitches the
  waterfall.
- **`avg_cycle_days_into_stage`** is precomputed per-row so the
  velocity formula doesn't recompute it at view time.

---

## 6. Rollup logic

The rollup function runs once per nightly invocation and computes
one batch of rows for `target_date = yesterday (CT)`. Pseudocode:

```ts
async function computeSnapshot(targetDate: Date, sql: Sql) {
  // 1. Stage state at end of day per (rep × workflow × stage)
  //    Read prospects.stage + prospects.owner_id + prospects.workflow_key
  //    where updated_at < end_of_day(targetDate).
  // 2. Transitions into/out of each stage during the day
  //    Read prospect_stage_events created_at within the day.
  //    Group by (actor_id, prospect.workflow_key, to_stage / from_stage).
  // 3. Contact activity per (rep × workflow)
  //    Read prospect_contacts sent_at within the day, plus
  //    response_received true with responded_at within the day.
  // 4. Score sum / count per (rep × workflow × stage)
  //    Sum prospects.rank_score for end-of-day state.
  // 5. Revenue per (rep × workflow) for clients closing today
  //    Read quotes.status='accepted', quotes.updated_at within the
  //    day, join prospect.workflow_key + owner_id.
  // 6. Cycle-day averages per (workflow, to_stage)
  //    For each transition today, compute now - prior stage event
  //    timestamp. Average per workflow + destination stage.
  //
  // Stitch into rows keyed by (target_date, rep_id, workflow_key, stage),
  // return as an array for the upsert step.
}
```

The upsert wraps:

```ts
await sql.begin(async (tx) => {
  await tx`DELETE FROM daily_metric_snapshot WHERE snapshot_date = ${targetDate}`;
  await tx`INSERT INTO daily_metric_snapshot (...) VALUES ${tx(rows)}`;
});
```

DELETE-then-INSERT is cleaner than `ON CONFLICT (snapshot_date,
rep_id, workflow_key, stage) DO UPDATE SET ...` because the rollup
naturally regenerates the entire day's rows. Either works; the
DELETE approach keeps the code simpler and there's no concurrent
writer risk (only the cron writes this table).

---

## 7. The `/reports` page — layout

```
┌────────────────────────────────────────────────────────────────┐
│ Reports                              [ 7d  30d  90d  YTD  ⌄ ] │ Header
├────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ PIPELINE VELOCITY                                          │ │
│ │ $4,230 /day            ▲ 12%  vs. last 30                  │ │
│ │ ──────────────·──·─·──·─·──── 30-day sparkline             │ │ Hero card
│ └────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────┐ ┌──────────────────────────┐  │
│ │ FUNNEL                       │ │ WORKFLOW ROI             │  │
│ │ Sourced  ───────────  223    │ │ Real Estate   $312/close │  │
│ │ Qualified───────────   94    │ │ Corp HS       $187/close │  │
│ │ Contacting────────     61    │ │ Story         $1,140     │  │
│ │ Responded ─────        24    │ └──────────────────────────┘  │ Row 1
│ │ Signed    ────         11    │ ┌──────────────────────────┐  │
│ │ Client    ───           7    │ │ REP LEADERBOARD          │  │
│ └──────────────────────────────┘ │ Mike   8 closes  31%     │  │
│ ┌──────────────────────────────┐ │ Sarah  5 closes  22%     │  │
│ │ SCORE VALIDATION             │ │ Carlos 3 closes  18%     │  │
│ │ (histogram, closed v reject) │ └──────────────────────────┘  │ Row 2
│ └──────────────────────────────┘                               │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ STALE PIPELINE                                             │ │
│ │ 14+ days no activity, by rep — clickable rows              │ │ Full width
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

Auth: same admin gate as `/team`. A `ReportsAccessGuard` server
helper redirects non-admin users to `/dashboard` before any query
runs.

Visual styling: same brand-cyan + Playfair display palette as the
rest of Ops. The sparkline uses pure SVG (no Recharts dependency
in v1 — keeps the bundle thin).

---

## 8. Tests

All tests live alongside the code in
`src/lib/reports/*.test.ts` and `src/components/reports/*.test.tsx`.

### Unit tests — rollup math

- `computeSnapshot returns one row per (rep × workflow × stage)`
  with a fixture stage-events set covering all six stages.
- `entered_stage_today and exited_stage_today balance` across the
  day — for every transition there is a matching enter and exit.
- `contacts_sent_today and responses_today match the input
  prospect_contacts rows` for a known fixture.
- `revenue_closed_today equals the sum of accepted quotes' total_price`
  for prospects whose `client` stage was reached on the target
  date.
- `avg_cycle_days_into_stage is null when no transitions
  happened` — guards against divide-by-zero in the view.
- `re-running the rollup for the same date overwrites cleanly` —
  DELETE-then-INSERT is verified to be idempotent.

### Unit tests — derived metrics

- `pipeline velocity formula handles empty pipeline gracefully`
  (returns 0, not NaN).
- `pipeline velocity formula correctly multiplies per-workflow
  factors` against a known fixture with two workflows.
- `funnel conversion %` returns 0 (not NaN) for stages with 0
  entering prospects.
- `score-validation histogram` correctly buckets a fixture of
  prospects spanning every band.

### Integration tests — cron route

- `unauthorized requests return 401` (no `CRON_SECRET`).
- `successful run returns 200 with row counts`.
- `partial failure (one workflow's rollup throws)` returns
  non-2xx and reports which workflow failed.

### Component tests — guarded by `*.test.tsx`

- `PipelineVelocityCard renders the number, sparkline, and trend
  arrow from props`.
- `FunnelCard renders all six stages with conversion %`.
- `StalePipelineCard renders empty state when no stale prospects`.
- `Reports page redirects non-admin users to /dashboard`.

---

## 9. Open questions / future

**Not blocking R0 sign-off, but worth deciding before R7 ships:**

- **Date range default — 30 days?** Sensible default. Configurable
  in v2 if Dean wants a different one.
- **Sparkline library or hand-rolled SVG?** Recommendation:
  hand-rolled SVG for v1 (no new dependency). Recharts if Dean
  ever wants interactive tooltips.
- **Export to CSV?** Not in v1. Trivial to add if Dean ever wants
  to drop reports data into Excel.
- **Per-rep view (the deferred D-068 follow-up)** — the snapshot
  table already supports it via `rep_id`. A future
  `/reports/me` route reading `WHERE rep_id = $session.user.id`
  is one phase of work (auth, page, three cards instead of six).

**Possible future cards if the brotherhood scales:**

- **Per-script reply rate** — `prospect_contacts.script_id`
  joined to `contact_scripts.name`. Tells Dean which scripts are
  pulling and which are landing flat.
- **Time-to-second-touch by rep** — the strongest behavioral
  predictor noted in the kickoff. Computable from
  `prospect_contacts` event sequencing.
- **Rep retention cohorts** — by Active Partner status month over
  month. Earned once there are 6+ months of data.

---

_Phase R aims for one focused build day: ~30 minutes for R1
(schema), ~1.5 hours for R2 (rollup + tests), ~30 minutes for R3
(cron), ~4 hours for R4–R5 (page + six cards), ~1 hour for R7
(verify + changelog). R6 (digest extension) is an optional 1–2
hour add-on._
