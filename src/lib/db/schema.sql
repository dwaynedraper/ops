-- ────────────────────────────────────────────────────────────────────
-- Sharp Sighted Ops — Postgres schema
--
-- Apply once against the database pointed at by DATABASE_URL:
--
--   npm run db:migrate
--
-- ... or directly with psql if you have it locally:
--
--   psql "$DATABASE_URL" -f src/lib/db/schema.sql
--
-- Idempotent: every CREATE uses IF NOT EXISTS. Safe to re-run.
--
-- Two layers in this file:
--
--   1. Auth.js v5 Postgres adapter tables (users, accounts, sessions,
--      verification_token). Column names use the camelCase quoting the
--      adapter requires — DO NOT change them.
--   2. Ops application tables (ops_profiles, packages, addons, quotes,
--      quote_lines, quote_events). These are ours; standard snake_case.
-- ────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ════════════════════════════════════════════════════════════════════
-- LAYER 1 — Auth.js v5 Postgres adapter
-- ════════════════════════════════════════════════════════════════════

-- ─── users ─────────────────────────────────────────────────────────
-- Auth.js owns these columns. Ops-specific user fields live in
-- ops_profiles below (1:1 join on user_id) so we never touch what the
-- adapter manages.
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT,
  email           TEXT UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image           TEXT
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

-- ─── accounts ──────────────────────────────────────────────────────
-- Required by the adapter even when we only use the Email provider.
-- Stays empty in practice for email-only flows.
CREATE TABLE IF NOT EXISTS accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  provider            TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          BIGINT,
  id_token            TEXT,
  scope               TEXT,
  session_state       TEXT,
  token_type          TEXT,
  UNIQUE (provider, "providerAccountId")
);

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts("userId");

-- ─── sessions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionToken" TEXT NOT NULL UNIQUE,
  "userId"       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions("userId");
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires);

-- ─── verification_token ────────────────────────────────────────────
-- Stores magic-link tokens until the user clicks them.
CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ════════════════════════════════════════════════════════════════════
-- LAYER 2 — Ops application
-- ════════════════════════════════════════════════════════════════════

-- ─── ops_profiles ──────────────────────────────────────────────────
-- One row per real user. Carries role, display name, and access state.
-- Created by the auth createUser event the first time an invited rep
-- signs in (see auth.ts + rep_invites below).
--
-- `status` is the access lifecycle:
--   invited   — signed in against an invite, awaiting activation. The
--               rep can authenticate but is gated out of the app until
--               an admin activates them (I-9 / paperwork pause).
--   active    — cleared to work.
--   suspended — access paused, reversible. The record is kept.
--   disabled  — off-boarded. Access ends; the record is kept forever.
-- A rep is NEVER deleted — prospects, contacts, and quotes must stay
-- attributable for pay and dispute records.
--
-- `digest_email` is the per-rep opt-in for the morning Dashboard
-- digest (was /today before V2 F12 / D-063 folded that route in).
CREATE TABLE IF NOT EXISTS ops_profiles (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'partner'
                  CHECK (role IN ('super_admin', 'partner')),
  display_name TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('invited', 'active', 'suspended', 'disabled')),
  digest_email BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_profiles_role_idx ON ops_profiles(role);
-- ops_profiles_status_idx is created after the status-column migration
-- near the foot of this file — on an existing database the column does
-- not exist yet at this point.

-- ─── rep_invites ───────────────────────────────────────────────────
-- The invite roster — the front of the invite-only onboarding flow. An
-- admin adds a row here; that email may then request a sign-in link. On
-- first sign-in the createUser event reads the matching invite, creates
-- the ops_profile (status 'invited', role from here), and stamps
-- accepted_at. The row is kept after acceptance as the invite record.
CREATE TABLE IF NOT EXISTS rep_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,          -- normalized lowercase
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'partner'
                CHECK (role IN ('super_admin', 'partner')),
  invited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS rep_invites_email_idx ON rep_invites(email);

-- ─── pricing_globals ───────────────────────────────────────────────
-- The Globals sheet from the master spreadsheet — hourly rates and
-- default margins, as editable key/value rows. A package_cost_lines
-- row resolves its rate_role against this table. Editing a global and
-- publishing changes every package's *computed* working price; each
-- package's base_price still only moves when that package itself is
-- republished from its worksheet.
CREATE TABLE IF NOT EXISTS pricing_globals (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  value       NUMERIC(12,4) NOT NULL,
  unit        TEXT,            -- 'usd_per_hour' | 'ratio' — display hint
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── packages ──────────────────────────────────────────────────────
-- Verse, Story, Saga, Single, Team Day, Essentials, Visibility Retainer.
-- The cost-plus inputs live in package_cost_lines (one row per worksheet
-- line). This table holds identity, the editable margin, and base_price
-- — the PUBLISHED price the calculator and sales partners read. The
-- worksheet recomputes a working price live as an admin edits; the
-- base_price column only changes when the admin hits Publish. That
-- separation is the whole point: partners never see an in-progress
-- price experiment.
CREATE TABLE IF NOT EXISTS packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  branch          TEXT NOT NULL
                    CHECK (branch IN ('portraits', 'corporate', 'realestate')),
  description     TEXT,

  -- Editable margin (worksheet input). 0.30 standard, 0.20 specialty.
  default_margin  NUMERIC(4,3)  NOT NULL DEFAULT 0.30,

  -- PUBLISHED price — what the calculator shows. Set on Publish from
  -- the worksheet's computed website price. Never moves on its own.
  base_price      NUMERIC(10,2) NOT NULL DEFAULT 0,

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 100,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS packages_branch_idx ON packages(branch);
CREATE INDEX IF NOT EXISTS packages_active_idx ON packages(is_active);

-- ─── package_cost_lines ────────────────────────────────────────────
-- One row per worksheet line item — the spreadsheet's per-package rows,
-- normalized. A 'time' line has hours + rate_role (resolved against
-- pricing_globals); a 'hard' line has a flat dollar amount. The
-- package's cost basis = SUM(time: hours × resolved rate)
--                      + SUM(hard: amount).
CREATE TABLE IF NOT EXISTS package_cost_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id  UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('time', 'hard')),
  category    TEXT NOT NULL,

  -- time lines: hours + rate_role set, amount NULL
  hours       NUMERIC(8,2),
  rate_role   TEXT CHECK (rate_role IN ('lp', 'lp_saga', 'second_shooter', 'pa', 'xm')),

  -- hard lines: amount set, hours + rate_role NULL
  amount      NUMERIC(12,2),

  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A row is well-formed as exactly one of the two kinds.
  CHECK (
    (kind = 'time' AND hours IS NOT NULL AND rate_role IS NOT NULL AND amount IS NULL)
    OR
    (kind = 'hard' AND amount IS NOT NULL AND hours IS NULL AND rate_role IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS package_cost_lines_package_idx
  ON package_cost_lines(package_id, sort_order);

-- ─── addons ────────────────────────────────────────────────────────
-- Gift Collection, Featured upgrade, Cinematic walkthrough, etc.
-- An addon with package_id IS NULL is "universal" within its branch.
-- An addon with branch IS NULL is universal across all branches.
CREATE TABLE IF NOT EXISTS addons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  package_id      UUID REFERENCES packages(id) ON DELETE CASCADE,
  branch          TEXT CHECK (branch IN ('portraits', 'corporate', 'realestate')),
  description     TEXT,

  -- Cost-plus inputs
  time_hours      NUMERIC(6,2)  NOT NULL DEFAULT 0,
  hard_cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
  margin_override NUMERIC(4,3),                          -- if NULL, inherit package margin

  -- Final price + unit semantics
  base_price      NUMERIC(10,2) NOT NULL,
  unit_label      TEXT,                                   -- "per person", "per clip", etc.

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 100,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS addons_package_id_idx ON addons(package_id);
CREATE INDEX IF NOT EXISTS addons_branch_idx    ON addons(branch);
CREATE INDEX IF NOT EXISTS addons_active_idx    ON addons(is_active);

-- ─── corporate_pricing ─────────────────────────────────────────────
-- Corporate headshots price on a parametric formula, NOT the cost-line
-- worksheet (see D-013). This key/value table holds the editable inputs;
-- the calculator's Corporate branch resolves them in src/lib/pricing.ts.
--
--   Single Executive  = single_standard_price | single_featured_price
--   Team Day total    = base (promo or standard)
--                     + standard_count × per_person × (1 − volume disc)
--                     + featured_count × featured_per_person × (1 − disc)
--
-- The volume discount is evaluated per rate type against THAT type's own
-- headcount: 15 standard headshots discounts the standard rate only; the
-- featured rate is discounted only if 15+ people also take featured.
CREATE TABLE IF NOT EXISTS corporate_pricing (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  value       NUMERIC(12,4) NOT NULL,
  unit        TEXT,            -- 'usd' | 'usd_per_person' | 'ratio' | 'count'
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── quotes ────────────────────────────────────────────────────────
-- One row per quote built in the calculator. Totals are denormalized
-- (sums of quote_lines below); we re-compute and persist them every
-- time the quote is saved. package_snapshot captures the package state
-- at the moment of the quote so a later catalog change can't rewrite
-- history.
CREATE TABLE IF NOT EXISTS quotes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number      INTEGER GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Client info
  client_name       TEXT,
  client_email      TEXT,
  client_phone      TEXT,
  project_name      TEXT,
  target_date       DATE,
  client_notes      TEXT,

  -- Pipeline
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'archived')),

  -- Chosen package + snapshot
  package_id        UUID REFERENCES packages(id) ON DELETE SET NULL,
  package_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Totals (computed from quote_lines on save)
  subtotal_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal_cost     NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_price       NUMERIC(10,2) NOT NULL DEFAULT 0,   -- after round-up
  total_cost        NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_margin      NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Internal notes (admin only)
  internal_notes    TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS quotes_created_by_idx ON quotes(created_by);
CREATE INDEX IF NOT EXISTS quotes_status_idx     ON quotes(status);
CREATE INDEX IF NOT EXISTS quotes_created_at_idx ON quotes(created_at DESC);

-- ─── quote_lines ───────────────────────────────────────────────────
-- One row per line on a quote: the chosen package itself, each selected
-- addon, plus any custom line items. Pricing fields are snapshots — they
-- don't update if the catalog changes after save.
CREATE TABLE IF NOT EXISTS quote_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

  kind         TEXT NOT NULL CHECK (kind IN ('package', 'addon', 'custom')),
  ref_id       UUID,                       -- packages.id, addons.id, or NULL
  label        TEXT NOT NULL,              -- snapshot of name at quote time
  description  TEXT,

  qty          NUMERIC(8,2) NOT NULL DEFAULT 1,
  unit_label   TEXT,

  -- Snapshot pricing — frozen on save
  unit_price   NUMERIC(10,2) NOT NULL,
  unit_cost    NUMERIC(10,2) NOT NULL DEFAULT 0,
  line_total   NUMERIC(10,2) NOT NULL,

  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_lines_quote_id_idx ON quote_lines(quote_id);

-- ─── quote_events ──────────────────────────────────────────────────
-- Audit log. Every state change appends a row. Read by the quote
-- detail page to render the timeline.
CREATE TABLE IF NOT EXISTS quote_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id   UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL
              CHECK (kind IN ('created', 'updated', 'sent', 'accepted', 'declined', 'archived', 'note')),
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_events_quote_id_idx ON quote_events(quote_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════
-- LAYER 3 — CRM / multi-workflow sales pipeline (Phase B → D)
--
-- Ops runs several sales motions — one per offering. Each is a
-- `workflow`: Real Estate Media, Corporate Headshots, Story Portraits,
-- The Saga, and The 10% Rule. A workflow owns its own entry gate,
-- scoring factors, contact scripts, handoff links, and vocabulary; all
-- five run on the same Research → Tracking → Client machinery. See
-- PHASE-D-PLAN.md and decisions D-015 through D-027.
--
-- A `prospect` is ONE row, belonging to one workflow, that moves through
-- lifecycle stages — the research page and the client page are the same
-- record at different stages. Reps see only the prospects they own; a
-- super_admin sees all.
-- ════════════════════════════════════════════════════════════════════

-- ─── workflows ─────────────────────────────────────────────────────
-- One row per sales motion. `branch` defaults the client-page calculator
-- (NULL for the 10% workflow — contributed work, no quote). contact_noun
-- and org_noun drive the UI labels so each workflow reads natively.
CREATE TABLE IF NOT EXISTS workflows (
  workflow_key TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  branch       TEXT CHECK (branch IN ('portraits', 'realestate', 'corporate')),
  contact_noun TEXT NOT NULL DEFAULT 'Contact',
  org_noun     TEXT,
  accent       TEXT NOT NULL DEFAULT '#94a3b8',
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflows_active_idx ON workflows(active, sort_order);

-- ─── rank_factors ──────────────────────────────────────────────────
-- Editable scoring config, scoped per workflow (D-017). Each factor
-- contributes points toward a prospect's 0-10 rank:
--   bool   factor → `weight` if the answer is true, else 0
--   number factor → weight × min(value, max_input) / max_input
-- The rank is raw points ÷ Σ weights × 10. A factor with is_gate = true
-- is an entry-gate question — every gate factor must answer true for the
-- prospect to enter the pipeline. Super-admin editable.
CREATE TABLE IF NOT EXISTS rank_factors (
  workflow_key TEXT NOT NULL REFERENCES workflows(workflow_key) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  help_text    TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('bool', 'number')),
  weight       NUMERIC(6,2) NOT NULL DEFAULT 1,
  -- number factors only: the input value that earns full weight
  max_input    NUMERIC(12,2),
  -- gate factors must answer true to enter the pipeline; a gate is bool
  is_gate      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_key, key),
  CHECK (
    (kind = 'number' AND max_input IS NOT NULL AND max_input > 0)
    OR (kind = 'bool' AND max_input IS NULL)
  ),
  CHECK (NOT is_gate OR kind = 'bool')
);

CREATE INDEX IF NOT EXISTS rank_factors_workflow_idx
  ON rank_factors(workflow_key, active, sort_order);

-- ─── rank_config ───────────────────────────────────────────────────
-- Rank thresholds, as editable key/value rows scoped per workflow (D-017):
--   qualified_min          — score at/above this is "qualified"
--   borderline_min         — score at/above this is "borderline";
--                            below it the research page says "don't message"
--   qualified_target_count — once a rep has this many qualified
--                            prospects, prompt them to start contacting
CREATE TABLE IF NOT EXISTS rank_config (
  workflow_key TEXT NOT NULL REFERENCES workflows(workflow_key) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  value        NUMERIC(10,2) NOT NULL,
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_key, key)
);

-- ─── contact_scripts ───────────────────────────────────────────────
-- Editable outreach templates per workflow (D-018), one per contact-
-- cycle stage. The tracking page parses {{placeholder}} slots from the
-- subject/body, renders an input per human slot, resolves config slots
-- (handoff links) automatically, and produces a copy-paste message. A
-- step is "due for follow-up" `followup_after_days` after it was sent
-- with no response (0 = no follow-up — the cycle ends there).
CREATE TABLE IF NOT EXISTS contact_scripts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key        TEXT NOT NULL REFERENCES workflows(workflow_key) ON DELETE CASCADE,
  stage_key           TEXT NOT NULL,
  label               TEXT NOT NULL,
  channel             TEXT NOT NULL DEFAULT 'email'
                        CHECK (channel IN ('email', 'dm', 'call')),
  step_order          INTEGER NOT NULL DEFAULT 100,
  followup_after_days INTEGER NOT NULL DEFAULT 3,
  subject             TEXT,
  body                TEXT NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_key, stage_key)
);

CREATE INDEX IF NOT EXISTS contact_scripts_workflow_idx
  ON contact_scripts(workflow_key, active, step_order);

-- ─── handoff_links ─────────────────────────────────────────────────
-- Per-workflow Sprout Studio / handoff URLs (PHASE-D-PLAN §8). A script
-- references a link by placeholder — {{link_key}} — and the tracking
-- composer resolves it automatically from this table. Editing a URL
-- here updates every script that uses it; no script edit needed.
CREATE TABLE IF NOT EXISTS handoff_links (
  workflow_key TEXT NOT NULL REFERENCES workflows(workflow_key) ON DELETE CASCADE,
  link_key     TEXT NOT NULL,
  label        TEXT NOT NULL,
  url          TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_key, link_key)
);

-- ─── prospects ─────────────────────────────────────────────────────
-- One row per researched prospect, belonging to one workflow — the same
-- record from first research through signed client. `owner_id` is the
-- rep who researched it; `signed_by_id` is who closed it. `rank_inputs`
-- holds every factor answer (entry-gate answers included) as JSONB keyed
-- by rank_factors.key within this prospect's workflow; `rank_score`
-- caches the computed 0-10 rank. Identity is generic — the workflow's
-- contact_noun / org_noun supply the UI labels.
CREATE TABLE IF NOT EXISTS prospects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key  TEXT NOT NULL REFERENCES workflows(workflow_key) ON DELETE RESTRICT,
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  signed_by_id  UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Identity
  contact_name  TEXT NOT NULL,
  org_name      TEXT,
  email         TEXT,
  phone         TEXT,
  website_url   TEXT,
  social_url    TEXT,
  market_area   TEXT,

  -- Scoring
  rank_inputs   JSONB NOT NULL DEFAULT '{}'::jsonb,
  rank_score    NUMERIC(4,1) NOT NULL DEFAULT 0,

  -- Lifecycle
  stage         TEXT NOT NULL DEFAULT 'researching'
                  CHECK (stage IN (
                    'researching', 'qualified', 'contacting',
                    'responded', 'signed', 'client',
                    'rejected', 'dormant'
                  )),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prospects_owner_idx ON prospects(owner_id);
CREATE INDEX IF NOT EXISTS prospects_stage_idx ON prospects(stage);
CREATE INDEX IF NOT EXISTS prospects_workflow_idx ON prospects(workflow_key);

-- A quote can attach to a prospect (the client-page inline calculator).
-- Added by ALTER because `quotes` is defined in Layer 2, above prospects.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quotes_prospect_id_idx ON quotes(prospect_id);

-- ─── prospect_contacts ─────────────────────────────────────────────
-- The outreach log — one row per touch sent. `filled_body` snapshots the
-- message that actually went out, so editing the script template later
-- can't rewrite history. The follow-up engine reads the latest row per
-- prospect (D-020).
CREATE TABLE IF NOT EXISTS prospect_contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id       UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  step_key          TEXT NOT NULL,
  channel           TEXT NOT NULL DEFAULT 'email',
  script_id         UUID REFERENCES contact_scripts(id) ON DELETE SET NULL,
  filled_subject    TEXT,
  filled_body       TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_received BOOLEAN NOT NULL DEFAULT FALSE,
  responded_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prospect_contacts_prospect_idx
  ON prospect_contacts(prospect_id, sent_at DESC);

-- ─── prospect_notes ────────────────────────────────────────────────
-- The CRM notes timeline. `pinned` rows are the evergreen facts (a
-- favorite whiskey, a daughter's birthday) and sort to the top of the
-- client page; the rest is a timestamped log.
CREATE TABLE IF NOT EXISTS prospect_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prospect_notes_prospect_idx
  ON prospect_notes(prospect_id, pinned DESC, created_at DESC);

-- ─── prospect_stage_events ─────────────────────────────────────────
-- An append-only log of every lifecycle stage change. Written by the
-- trigger below — never by application code — so no stage move can be
-- missed. The supervisor report (/team/activity) reads this to count
-- real transitions (e.g. research → tracking) over a window; without
-- it, only the current stage is knowable. `from_stage` is NULL for the
-- creation event. `actor_id` is reserved for future use — the trigger
-- has no actor; the report attributes by the prospect's owner.
CREATE TABLE IF NOT EXISTS prospect_stage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prospect_stage_events_prospect_idx
  ON prospect_stage_events(prospect_id, created_at);
CREATE INDEX IF NOT EXISTS prospect_stage_events_created_idx
  ON prospect_stage_events(created_at);

-- The logger: one row on prospect creation, one on every stage change.
CREATE OR REPLACE FUNCTION trg_log_prospect_stage_event()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO prospect_stage_events (prospect_id, from_stage, to_stage)
      VALUES (NEW.id, NULL, NEW.stage);
  ELSIF (TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage) THEN
    INSERT INTO prospect_stage_events (prospect_id, from_stage, to_stage)
      VALUES (NEW.id, OLD.stage, NEW.stage);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────
-- daily_metric_snapshot — Phase R (D-070)
--
-- One row per (snapshot_date, rep_id, workflow_key, stage). Written
-- nightly by /api/cron/snapshot from the live event tables above. The
-- /reports surface is the only consumer — every dashboard card reads
-- from this table, never from prospect_stage_events / prospect_contacts
-- / quotes directly. Re-runs for the same date are safe: the rollup
-- DELETEs the day's rows in a transaction and re-INSERTs.
--
-- Per-prospect detail stays in the live tables; this is strictly an
-- aggregate, capped at ~5 reps × 5 workflows × 8 stages × 365 days ≈
-- 73K rows/year. Trivial for Neon's free tier.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_metric_snapshot (
  snapshot_date   DATE   NOT NULL,
  rep_id          UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_key    TEXT   NOT NULL REFERENCES workflows(workflow_key) ON DELETE CASCADE,
  stage           TEXT   NOT NULL,

  -- End-of-day state + same-day transitions
  prospects_in_stage      INTEGER NOT NULL DEFAULT 0,
  entered_stage_today     INTEGER NOT NULL DEFAULT 0,
  exited_stage_today      INTEGER NOT NULL DEFAULT 0,

  -- Activity (only meaningful for some stages; safe defaults elsewhere)
  contacts_sent_today     INTEGER NOT NULL DEFAULT 0,
  responses_today         INTEGER NOT NULL DEFAULT 0,

  -- Score distribution (sum + count → avg deferred to query time)
  sum_rank_score          NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Revenue (only populated for prospects whose 'client' stage was
  -- reached today; sums accepted quotes' total_price)
  revenue_closed_today    NUMERIC(12,2) NOT NULL DEFAULT 0,
  quotes_accepted_today   INTEGER NOT NULL DEFAULT 0,

  -- Cycle-time helper (in days; NULL when no transitions happened)
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

-- ────────────────────────────────────────────────────────────────────
-- updated_at trigger — single function, reused by every table that has
-- an updated_at column. Cleaner than defining one trigger per table.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'packages_updated_at') THEN
    CREATE TRIGGER packages_updated_at BEFORE UPDATE ON packages
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'addons_updated_at') THEN
    CREATE TRIGGER addons_updated_at BEFORE UPDATE ON addons
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'quotes_updated_at') THEN
    CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON quotes
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pricing_globals_updated_at') THEN
    CREATE TRIGGER pricing_globals_updated_at BEFORE UPDATE ON pricing_globals
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'corporate_pricing_updated_at') THEN
    CREATE TRIGGER corporate_pricing_updated_at BEFORE UPDATE ON corporate_pricing
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'prospects_updated_at') THEN
    CREATE TRIGGER prospects_updated_at BEFORE UPDATE ON prospects
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'prospects_stage_event') THEN
    CREATE TRIGGER prospects_stage_event
      AFTER INSERT OR UPDATE OF stage ON prospects
      FOR EACH ROW EXECUTE FUNCTION trg_log_prospect_stage_event();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rank_factors_updated_at') THEN
    CREATE TRIGGER rank_factors_updated_at BEFORE UPDATE ON rank_factors
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rank_config_updated_at') THEN
    CREATE TRIGGER rank_config_updated_at BEFORE UPDATE ON rank_config
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contact_scripts_updated_at') THEN
    CREATE TRIGGER contact_scripts_updated_at BEFORE UPDATE ON contact_scripts
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workflows_updated_at') THEN
    CREATE TRIGGER workflows_updated_at BEFORE UPDATE ON workflows
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'handoff_links_updated_at') THEN
    CREATE TRIGGER handoff_links_updated_at BEFORE UPDATE ON handoff_links
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Role rename: 'admin' → 'super_admin'. Idempotent — safe on a fresh
-- database (the ops_profiles CHECK above already names super_admin, so
-- this is a no-op) and on an existing one (migrates the row data and
-- swaps the CHECK constraint). Runs on every db:migrate.
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ops_profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%role%'
      AND pg_get_constraintdef(oid) NOT LIKE '%super_admin%'
  ) THEN
    -- Drop the old CHECK first so the data migration isn't rejected by it.
    ALTER TABLE ops_profiles DROP CONSTRAINT ops_profiles_role_check;
    UPDATE ops_profiles SET role = 'super_admin' WHERE role = 'admin';
    ALTER TABLE ops_profiles ADD CONSTRAINT ops_profiles_role_check
      CHECK (role IN ('super_admin', 'partner'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- ops_profiles access state: the old `active` boolean becomes the
-- four-state `status` lifecycle (invited / active / suspended /
-- disabled), and the per-rep `digest_email` opt-in is added. Idempotent
-- — a no-op on a fresh database (the CREATE above already has both),
-- a one-time migration on an existing one. Runs on every db:migrate.
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ops_profiles' AND column_name = 'status'
  ) THEN
    ALTER TABLE ops_profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('invited', 'active', 'suspended', 'disabled'));
    -- Carry the old boolean across: active rows stay active, the rest
    -- become disabled (kept, but with access ended).
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ops_profiles' AND column_name = 'active'
    ) THEN
      UPDATE ops_profiles
        SET status = CASE WHEN active THEN 'active' ELSE 'disabled' END;
      ALTER TABLE ops_profiles DROP COLUMN active;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ops_profiles' AND column_name = 'digest_email'
  ) THEN
    ALTER TABLE ops_profiles
      ADD COLUMN digest_email BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  DROP INDEX IF EXISTS ops_profiles_active_idx;
END $$;

-- Safe now — `status` exists whether the table was freshly created or
-- migrated by the block above.
CREATE INDEX IF NOT EXISTS ops_profiles_status_idx ON ops_profiles(status);

-- ────────────────────────────────────────────────────────────────────
-- Phase E — Sourcing columns on prospects (D-025, D-027).
--
-- Five new columns to support the rapid list-intake surface at
-- /sourcing: three intake fields scraped or pasted off a public source
-- (sides_count, gross_volume, source_url), the three-state triage
-- toggle (sourcing_status), and the one-line note (sourcing_note).
-- Additive only — safe on a fresh DB and on the existing one.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS sides_count    INTEGER,
  ADD COLUMN IF NOT EXISTS gross_volume   NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS source_url     TEXT,
  ADD COLUMN IF NOT EXISTS sourcing_note  TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prospects' AND column_name = 'sourcing_status'
  ) THEN
    ALTER TABLE prospects
      ADD COLUMN sourcing_status TEXT NOT NULL DEFAULT 'undecided'
        CHECK (sourcing_status IN ('qualify', 'reject', 'undecided'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Rename sourcing_status value 'pass' → 'reject'. The original value
-- was ambiguous ("could that mean 'passed the bar'?") — Dean called
-- it out in real use; 'reject' has only one meaning. Idempotent —
-- only runs if the CHECK still allows the old value.
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'prospects'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%''pass''%'
      AND pg_get_constraintdef(oid) LIKE '%sourcing_status%'
  ) THEN
    -- Drop the auto-named CHECK so the UPDATE doesn't violate it.
    ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_sourcing_status_check;
    UPDATE prospects SET sourcing_status = 'reject' WHERE sourcing_status = 'pass';
    ALTER TABLE prospects ADD CONSTRAINT prospects_sourcing_status_check
      CHECK (sourcing_status IN ('qualify', 'reject', 'undecided'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- V1 close: add 'pursue' to the sourcing_status enum.
--
-- Sourcing's positive toggle no longer auto-promotes to lifecycle
-- stage 'qualified' — it just records "this is worth qualifying" and
-- leaves stage='researching'. The Qualify (deep-work) page remains
-- the only path to stage='qualified', and uses sourcing_status='qualify'.
-- Both values live in the same column; Sourcing UI exposes pursue/
-- reject/undecided, Qualify UI exposes qualify/reject/undecided.
-- Idempotent — only runs when the CHECK doesn't yet allow 'pursue'.
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'prospects'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%sourcing_status%'
      AND pg_get_constraintdef(oid) NOT LIKE '%''pursue''%'
  ) THEN
    ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_sourcing_status_check;
    ALTER TABLE prospects ADD CONSTRAINT prospects_sourcing_status_check
      CHECK (sourcing_status IN ('undecided', 'pursue', 'qualify', 'reject'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- V1 close: lifecycle stage 'passed' → 'rejected'. The old name shared
-- the ambiguity that drove the sourcing_status 'pass' rename — "passed"
-- can read as "passed the bar." "Rejected" has only one meaning.
-- Idempotent — only runs when the old CHECK is still in place.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  stage_check_name TEXT;
BEGIN
  -- Find the CHECK constraint that mentions 'passed'. Postgres
  -- auto-names ours; this works regardless of the suffix Postgres
  -- chose. Returns NULL if the rename has already happened.
  SELECT conname INTO stage_check_name
  FROM pg_constraint
  WHERE conrelid = 'prospects'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%''passed''%'
    AND pg_get_constraintdef(oid) LIKE '%stage%';

  IF stage_check_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE prospects DROP CONSTRAINT %I', stage_check_name);
    UPDATE prospects SET stage = 'rejected' WHERE stage = 'passed';
    ALTER TABLE prospects ADD CONSTRAINT prospects_stage_check
      CHECK (stage IN (
        'researching', 'qualified', 'contacting',
        'responded', 'signed', 'client',
        'rejected', 'dormant'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS prospects_sourcing_status_idx
  ON prospects(sourcing_status);

-- ────────────────────────────────────────────────────────────────────
-- Phase E P4.5 — real_estate scoring math overhaul (D-032).
--
-- Each UPDATE is conditional on the original default value, so a rep
-- who's already customized a factor via /rank-factors won't have their
-- edit clobbered. Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Gates now contribute 1.0 each to the score (used to be 0 = pass/fail
  -- only). Entry is still gated by gatesPassed().
  UPDATE rank_factors SET weight = 1
    WHERE workflow_key = 'real_estate' AND key = 'has_target_listing' AND weight = 0;
  UPDATE rank_factors SET weight = 1
    WHERE workflow_key = 'real_estate' AND key = 'has_photo_need' AND weight = 0;

  -- annual_volume max_input lifted to 30 to match the piecewise curve's
  -- ceiling. The curve in lib/prospects.ts handles actual scoring; this
  -- value is only informational on the UI now.
  UPDATE rank_factors SET max_input = 30
    WHERE workflow_key = 'real_estate' AND key = 'annual_volume' AND max_input = 24;

  -- active_social weight halved (2 → 1) — supporting, not headline.
  UPDATE rank_factors SET weight = 1
    WHERE workflow_key = 'real_estate' AND key = 'active_social' AND weight = 2;

  -- branded_email dropped from the model — redundant with pro_website.
  UPDATE rank_factors SET active = false
    WHERE workflow_key = 'real_estate' AND key = 'branded_email' AND active = true;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- V2 F4 — workflow color palette (D-053).
--
-- Brings existing workflow rows up to the new accent palette: gold for
-- RE Media (Sharp pillar), violet for Corp HS, brand cyan for Story
-- Portraits (Seen / Photos pillar), dramatic red for The Saga, and
-- fuchsia for The 10% Rule (contribution, not sales).
--
-- Each UPDATE is conditional on the original V1 default, so any manual
-- accent edit a super-admin has already made (via hand-SQL, or any
-- future /rates accent editor) is preserved. Idempotent — safe to
-- re-run.
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- RE Media: steel → brand gold.
  UPDATE workflows SET accent = '#c9922a'
    WHERE workflow_key = 'real_estate' AND accent = '#64748b';

  -- Corporate Headshots: cyan → violet (frees brand cyan for portraits).
  UPDATE workflows SET accent = '#8b5cf6'
    WHERE workflow_key = 'corporate' AND accent = '#0ea5e9';

  -- Story Portraits: terracotta → brand cyan (the Seen pillar).
  UPDATE workflows SET accent = '#38bdf8'
    WHERE workflow_key = 'story_portraits' AND accent = '#c25f3e';

  -- The Saga: rust → dramatic red.
  UPDATE workflows SET accent = '#dc2626'
    WHERE workflow_key = 'saga' AND accent = '#a0462a';

  -- The 10% Rule: emerald → fuchsia.
  UPDATE workflows SET accent = '#ec4899'
    WHERE workflow_key = 'ten_percent' AND accent = '#10b981';
END $$;

-- ────────────────────────────────────────────────────────────────────
-- V2 F5 — email template overhaul (D-047, D-048).
--
-- Two changes, both delivered via idempotent REPLACE() so manual edits
-- a super-admin has made via /scripts are preserved:
--
-- 1. D-047: the real-estate first-touch sales-pitch paragraph swaps
--    "I shoot real estate media in the 121 corridor — …" for
--    "Sharp Sighted Media shoots real estate media in the 121
--    corridor, from Allen to Southlake. …". Brand-agnostic phrasing
--    since reps send it, not Dean.
--
-- 2. D-048: standardized signature block on every script. The V1
--    closing was tagline → rep_name • Sharp Sighted [Branch]
--    (followed by a bare-host URL on real-estate first-touch only).
--    The V2 closing is:
--
--      Regards,
--      {{rep_name}} • Sharp Sighted Branch
--      https://sharpsighted.branch
--
--      Stay Sharp. Stay Seen. Stay Human.
--
--    The tagline is now the final line. Branch is per-workflow:
--    real_estate → Media, corporate/story_portraits/saga → Photos,
--    ten_percent → Studio.
--
-- Each REPLACE() is idempotent: if a rep has edited the body so the
-- old pattern doesn't appear, nothing changes. Safe to re-run.
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- D-047 — real-estate first-touch paragraph.
  UPDATE contact_scripts
  SET body = REPLACE(
    body,
    'I shoot real estate media in the 121 corridor — stills, aerial, floor plan, twilight, and a vertical reel, all delivered within 24 hours. One shoot, five deliverables, MLS-ready.',
    'Sharp Sighted Media shoots real estate media in the 121 corridor, from Allen to Southlake. The base package delivers stills, aerial, floor plan, twilight, and a vertical reel, all delivered within 24 hours. One shoot, five deliverables, MLS-ready.'
  )
  WHERE workflow_key = 'real_estate' AND stage_key = 'first_touch';

  -- D-048 — standardize signatures. Order matters: replace the longest
  -- pattern (real-estate first-touch with the bare-host URL line)
  -- first so the shorter patterns don't claim its match.
  UPDATE contact_scripts
  SET body = REPLACE(
    body,
    E'Stay Sharp. Stay Seen. Stay Human.\n{{rep_name}} · Sharp Sighted Media\nsharpsighted.media',
    E'Regards,\n{{rep_name}} • Sharp Sighted Media\nhttps://sharpsighted.media\n\nStay Sharp. Stay Seen. Stay Human.'
  )
  WHERE workflow_key = 'real_estate';

  UPDATE contact_scripts
  SET body = REPLACE(
    body,
    E'Stay Sharp. Stay Seen. Stay Human.\n{{rep_name}} · Sharp Sighted Media',
    E'Regards,\n{{rep_name}} • Sharp Sighted Media\nhttps://sharpsighted.media\n\nStay Sharp. Stay Seen. Stay Human.'
  )
  WHERE workflow_key = 'real_estate';

  UPDATE contact_scripts
  SET body = REPLACE(
    body,
    E'Stay Sharp. Stay Seen. Stay Human.\n{{rep_name}} · Sharp Sighted Photos',
    E'Regards,\n{{rep_name}} • Sharp Sighted Photos\nhttps://sharpsighted.photos\n\nStay Sharp. Stay Seen. Stay Human.'
  )
  WHERE workflow_key = 'story_portraits';

  -- corporate + saga both used the bare "· Sharp Sighted" V1 closing
  -- and both move to "Sharp Sighted Photos" in V2.
  UPDATE contact_scripts
  SET body = REPLACE(
    body,
    E'Stay Sharp. Stay Seen. Stay Human.\n{{rep_name}} · Sharp Sighted',
    E'Regards,\n{{rep_name}} • Sharp Sighted Photos\nhttps://sharpsighted.photos\n\nStay Sharp. Stay Seen. Stay Human.'
  )
  WHERE workflow_key IN ('corporate', 'saga');

  -- ten_percent moves to Sharp Sighted Studio.
  UPDATE contact_scripts
  SET body = REPLACE(
    body,
    E'Stay Sharp. Stay Seen. Stay Human.\n{{rep_name}} · Sharp Sighted',
    E'Regards,\n{{rep_name}} • Sharp Sighted Studio\nhttps://sharpsighted.studio\n\nStay Sharp. Stay Seen. Stay Human.'
  )
  WHERE workflow_key = 'ten_percent';
END $$;

-- ════════════════════════════════════════════════════════════════════
-- LAYER 4 — Durable clients (Phase 1 · CLIENTS-AND-JOBS-PLAN.md)
--
-- The acquisition pipeline (prospects) wins strangers. Once one signs,
-- they become a durable `client` that persists across every future
-- engagement — so a returning client maps back to ONE clients row
-- instead of a fresh cold prospect, and the client page becomes the
-- cold-call card: who they are, the relationship, the pinned facts, the
-- history. Owner-scoped exactly like prospects (D-019).
--
-- Additive + idempotent, same discipline as the layers above. The `jobs`
-- post-sale lifecycle and the quotes.job_id link arrive in Phase 2.
-- ════════════════════════════════════════════════════════════════════

-- ─── clients ───────────────────────────────────────────────────────
-- Durable identity. A person OR a business. `origin_prospect_id` keeps
-- the paper trail from cold lead → client. Never deleted — archived,
-- matching the rep/prospect rule.
CREATE TABLE IF NOT EXISTS clients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT NOT NULL DEFAULT 'person'
                       CHECK (kind IN ('person', 'org')),
  display_name       TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  market_area        TEXT,
  -- For the cold-call card: how you know them, who referred them.
  relationship       TEXT,
  referral_source    TEXT,
  -- A person can belong to a business (optional self-reference).
  parent_client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  branch_affinity    TEXT
                       CHECK (branch_affinity IN ('portraits','realestate','corporate')),
  owner_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  origin_prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'archived')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_owner_idx  ON clients(owner_id);
CREATE INDEX IF NOT EXISTS clients_name_idx   ON clients(lower(display_name));
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients(status);
CREATE INDEX IF NOT EXISTS clients_origin_idx ON clients(origin_prospect_id);

-- ─── client_notes ──────────────────────────────────────────────────
-- Mirrors prospect_notes. `pinned` = evergreen facts that float to the
-- top of the cold-call card (kept to business-context relationship notes
-- per Dean's preference — "met at the Frisco chamber mixer", "opening a
-- second office", not deep-personal).
CREATE TABLE IF NOT EXISTS client_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_notes_idx
  ON client_notes(client_id, pinned DESC, created_at DESC);

-- updated_at trigger for clients (reuses trg_set_updated_at from Layer 3).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clients_updated_at') THEN
    CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- LAYER 5 — Jobs: the post-sale lifecycle (Phase 2 · CLIENTS-AND-JOBS-PLAN.md)
--
-- A `job` is ONE engagement hanging off a durable client — the work that
-- happens after the close, which the prospect pipeline never modeled.
-- It carries the full lifecycle (booked → … → complete), the shoot date
-- (the Wed/Thu rhythm), payment + delivery tracking, and the several
-- people on the job (job_roles). Quotes attach to a job via quotes.job_id.
--
-- Additive + idempotent, same discipline as every layer above.
-- ════════════════════════════════════════════════════════════════════

-- ─── jobs ──────────────────────────────────────────────────────────
-- Born when a client books — fresh, or converted from a won prospect.
-- Reuses workflow_key for branch + vocabulary. The primary contact is
-- client_id; additional parties live in job_roles.
CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  workflow_key    TEXT REFERENCES workflows(workflow_key) ON DELETE SET NULL,
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title           TEXT,

  stage           TEXT NOT NULL DEFAULT 'booked'
                    CHECK (stage IN (
                      'booked','prep','shoot','cull','edit',
                      'deliver','followup','review','complete','cancelled'
                    )),

  -- Scheduling (the Wed/Thu shoot rhythm).
  shoot_date      DATE,
  location        TEXT,

  -- Money. value_price defaults from the accepted quote; override allowed.
  value_price     NUMERIC(10,2),
  payment_status  TEXT NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','deposit_paid','paid')),
  deposit_due     DATE,
  balance_due     DATE,

  -- Delivery + review-ask (drive the dashboard "due" lists in Phase 3).
  delivery_due    DATE,
  delivered_at    TIMESTAMPTZ,
  review_requested_at TIMESTAMPTZ,

  origin_prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_client_idx ON jobs(client_id);
CREATE INDEX IF NOT EXISTS jobs_owner_idx  ON jobs(owner_id);
CREATE INDEX IF NOT EXISTS jobs_stage_idx  ON jobs(stage);
CREATE INDEX IF NOT EXISTS jobs_shoot_idx  ON jobs(shoot_date);

-- ─── job_roles ─────────────────────────────────────────────────────
-- The several people on one job. The PRIMARY contact is jobs.client_id
-- itself; this holds the *additional* parties, each a durable client (so
-- the homeowner you meet today is on file forever).
CREATE TABLE IF NOT EXISTS job_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  role        TEXT NOT NULL
                CHECK (role IN ('billing','subject','gallery_recipient','other')),
  role_label  TEXT,                                -- free text when role='other'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, client_id, role)
);

CREATE INDEX IF NOT EXISTS job_roles_job_idx ON job_roles(job_id);

-- ─── job_stage_events ──────────────────────────────────────────────
-- Append-only stage log, trigger-written, mirroring prospect_stage_events.
-- Feeds cycle-time reporting and the "stuck in stage" dashboard signal.
CREATE TABLE IF NOT EXISTS job_stage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_stage_events_job_idx
  ON job_stage_events(job_id, created_at);

-- A quote can attach to a job (the job-page inline calculator), exactly
-- like the prospect_id link from Layer 3.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS quotes_job_id_idx ON quotes(job_id);

-- The job stage logger: one row on creation, one on every stage change.
CREATE OR REPLACE FUNCTION trg_log_job_stage_event()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO job_stage_events (job_id, from_stage, to_stage)
      VALUES (NEW.id, NULL, NEW.stage);
  ELSIF (TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage) THEN
    INSERT INTO job_stage_events (job_id, from_stage, to_stage)
      VALUES (NEW.id, OLD.stage, NEW.stage);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'jobs_updated_at') THEN
    CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'jobs_stage_event') THEN
    CREATE TRIGGER jobs_stage_event
      AFTER INSERT OR UPDATE OF stage ON jobs
      FOR EACH ROW EXECUTE FUNCTION trg_log_job_stage_event();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- LAYER 6 — Money: dated payments (Phase 5A · MONEY-AND-LEDGER-PLAN.md)
--
-- `jobs.payment_status` (Layer 5) is a single flag — it can't say WHEN a
-- payment landed or WHEN the next is expected. `job_payments` makes each
-- money event its own dated row: an 'expected' row carries a due_on; marking
-- it 'received' stamps received_on. `jobs.payment_status` stays as a fast
-- denormalized cache, recomputed from these rows by the action layer
-- (lib/money.ts · derivePaymentStatus), so every existing query that reads
-- the flag keeps working — the flag now just tells the truth about partials.
--
-- This is the keystone for the dashboard cash strip, the per-job paid ring,
-- and the Wave export. Additive + idempotent, same discipline as Layers 1–5.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS job_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'payment'
                  CHECK (kind IN ('deposit', 'balance', 'payment', 'refund')),
  amount        NUMERIC(10,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'expected'
                  CHECK (status IN ('expected', 'received')),
  -- The two dates Dean asked for by name:
  due_on        DATE,         -- when we EXPECT it (for 'expected' rows)
  received_on   DATE,         -- when it actually landed (for 'received' rows)
  method        TEXT,         -- 'check','zelle','card','cash', freeform
  note          TEXT,
  -- Wave bookkeeping hint: the income account this maps to. Optional —
  -- the export resolves a default from the job's branch when null.
  wave_category TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A row is well-formed for its status: received rows carry a date.
  CHECK (status = 'expected' OR received_on IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS job_payments_job_idx      ON job_payments(job_id, due_on);
CREATE INDEX IF NOT EXISTS job_payments_status_idx   ON job_payments(status, received_on);
CREATE INDEX IF NOT EXISTS job_payments_received_idx ON job_payments(received_on);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'job_payments_updated_at') THEN
    CREATE TRIGGER job_payments_updated_at BEFORE UPDATE ON job_payments
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Backfill: every job already marked paid gets one received payment row
-- for its value, dated its last update — so the new dated-rows world
-- starts consistent with the old flag. Idempotent: only inserts when the
-- job has no payment rows yet. Jobs with a partial 'deposit_paid' flag but
-- no rows can't have their split reconstructed, so they seed a single
-- received row at value (Dean can split it by hand if needed); 'unpaid'
-- jobs seed nothing.
-- ────────────────────────────────────────────────────────────────────
INSERT INTO job_payments (job_id, kind, amount, status, received_on, note)
SELECT j.id, 'payment', j.value_price, 'received', j.updated_at::date,
       'Backfilled from payment_status'
FROM jobs j
WHERE j.payment_status IN ('paid', 'deposit_paid')
  AND j.value_price IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM job_payments p WHERE p.job_id = j.id);

-- ════════════════════════════════════════════════════════════════════
-- LAYER 7 — Ledger: expenses + mileage (Phase 5C · MONEY-AND-LEDGER-PLAN.md)
--
-- Money-out events, dated and categorized, that ride the same export pipe
-- as payments and (optionally) link to a job for true per-job profit
-- (value − expenses − mileage). The mileage rate is an editable setting,
-- snapshotted onto each mileage row at entry so a year-end rate change
-- never rewrites past deductions (2026 IRS business rate = 0.725).
--
-- Additive + idempotent, same discipline as Layers 1–6.
-- ════════════════════════════════════════════════════════════════════

-- ─── ledger_settings ───────────────────────────────────────────────
-- Editable key/value config for the ledger (super-admin). Seeded with the
-- current mileage rate; the seed only inserts when absent so an edited
-- value is never clobbered.
CREATE TABLE IF NOT EXISTS ledger_settings (
  key         TEXT PRIMARY KEY,
  value       NUMERIC(12,4) NOT NULL,
  label       TEXT NOT NULL,
  notes       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ledger_settings (key, value, label, notes)
VALUES ('mileage_rate_per_mile', 0.725, 'Mileage rate ($/mile)',
        'IRS business standard mileage rate. 2026 = 0.725. Update each year; '
        'existing mileage rows keep the rate they were logged at.')
ON CONFLICT (key) DO NOTHING;

-- ─── expenses ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  job_id      UUID REFERENCES jobs(id) ON DELETE SET NULL,   -- optional link
  spent_on    DATE NOT NULL,
  vendor      TEXT,
  amount      NUMERIC(10,2) NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',  -- maps to a Wave expense account
  billable    BOOLEAN NOT NULL DEFAULT FALSE,   -- rebillable to the client?
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expenses_owner_idx ON expenses(owner_id, spent_on);
CREATE INDEX IF NOT EXISTS expenses_job_idx   ON expenses(job_id);

-- ─── mileage_logs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mileage_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,
  drove_on      DATE NOT NULL,
  purpose       TEXT,
  miles         NUMERIC(8,1) NOT NULL,
  -- Rate snapshotted at entry, seeded from ledger_settings. Editing the
  -- setting next year never rewrites these rows.
  rate_per_mile NUMERIC(6,3) NOT NULL,
  amount        NUMERIC(10,2) NOT NULL,          -- miles * rate, at entry
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mileage_owner_idx ON mileage_logs(owner_id, drove_on);
CREATE INDEX IF NOT EXISTS mileage_job_idx   ON mileage_logs(job_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'expenses_updated_at') THEN
    CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON expenses
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_settings_updated_at') THEN
    CREATE TRIGGER ledger_settings_updated_at BEFORE UPDATE ON ledger_settings
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- LAYER 8 — The call stage (Phase 5E · MONEY-AND-LEDGER-PLAN.md §5)
--
-- Reps communicate by email only and close by sending a Sprout scheduling
-- link; the prospect self-books a call with Dean. `call_booked` records
-- that booking, set by Dean (who sees it land), sitting between 'responded'
-- and 'signed'. Adds the stage to the CHECK and a nullable `call_at` for
-- the scheduled time. Idempotent — the CHECK swap only runs while the old
-- constraint (without call_booked) is in place, mirroring the earlier
-- 'passed' → 'rejected' rename block.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS call_at TIMESTAMPTZ;

DO $$
DECLARE
  stage_check_name TEXT;
BEGIN
  SELECT conname INTO stage_check_name
  FROM pg_constraint
  WHERE conrelid = 'prospects'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%stage%'
    AND pg_get_constraintdef(oid) LIKE '%''signed''%'
    AND pg_get_constraintdef(oid) NOT LIKE '%call_booked%';

  IF stage_check_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE prospects DROP CONSTRAINT %I', stage_check_name);
    ALTER TABLE prospects ADD CONSTRAINT prospects_stage_check
      CHECK (stage IN (
        'researching', 'qualified', 'contacting',
        'responded', 'call_booked', 'signed', 'client',
        'rejected', 'dormant'
      ));
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- LAYER 9 — The calendar (Phase 6A · CALENDAR-AND-SYNC-PLAN.md)
--
-- A fixed time block — the spine of the in-Ops calendar, for the work that
-- isn't a Job (record / edit / post / admin / 10%). Accessibility, not a
-- feature: a block has a real start time and duration, never a "someday."
-- Recurrence is stored as an RFC-5545 RRULE — Google's native grammar — so
-- the Phase 6C two-way sync is a pass-through, not a translation. The sync
-- columns (google_event_id, etc.) arrive in 6C; this is the local-first
-- table. Additive + idempotent, same discipline as Layers 1–8.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS calendar_blocks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  title         TEXT NOT NULL,
  block_type    TEXT NOT NULL DEFAULT 'other'
                  CHECK (block_type IN ('record','edit','post','admin','ten_percent','other')),
  notes         TEXT,

  -- The concrete when. start_at is absolute; time_zone keeps wall-clock
  -- intent honest across DST (Dean is CT).
  start_at      TIMESTAMPTZ NOT NULL,
  duration_min  INTEGER NOT NULL DEFAULT 60 CHECK (duration_min > 0),
  time_zone     TEXT NOT NULL DEFAULT 'America/Chicago',

  -- RFC-5545 RRULE (6B). NULL = one-off. Stored as Google's grammar for
  -- loss-free sync.
  rrule         TEXT,

  -- Optional link to a job (e.g. "edit of" a shoot).
  job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,

  -- Lifecycle of the block itself — did the work happen.
  status        TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','done','skipped','canceled')),

  -- Lead time for the "it chases me" reminder, in minutes before start.
  reminder_min  INTEGER NOT NULL DEFAULT 30 CHECK (reminder_min >= 0),
  reminder_sent_at TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_blocks_owner_start_idx
  ON calendar_blocks(owner_id, start_at);
CREATE INDEX IF NOT EXISTS calendar_blocks_job_idx ON calendar_blocks(job_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'calendar_blocks_updated_at') THEN
    CREATE TRIGGER calendar_blocks_updated_at BEFORE UPDATE ON calendar_blocks
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- LAYER 10 — Recurrence + reminders (Phase 6B · CALENDAR-AND-SYNC-PLAN.md)
--
-- A recurring block is ONE master row in calendar_blocks carrying an RRULE
-- (Layer 9 already has the column). The calendar expands the master into
-- concrete instances for the viewed window at read time — no per-instance
-- rows. Two small side tables keep that model honest and round-trippable
-- to Google (which uses the same EXDATE + detached-event idea):
--
--   • calendar_block_skips     — an EXDATE: "this one occurrence is gone."
--       "Delete this occurrence" and the skip half of "edit this occurrence"
--       both write here. (Editing one occurrence = skip it on the master +
--       create a normal one-off block with the edits.)
--   • calendar_reminders_sent  — dedupe for the lead-time reminder cron, so
--       a recurring block's instances each get reminded exactly once.
--
-- Additive + idempotent, same discipline as Layers 1–9.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS calendar_block_skips (
  master_id       UUID NOT NULL REFERENCES calendar_blocks(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,            -- the civil date of the skipped instance
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (master_id, occurrence_date)
);

CREATE TABLE IF NOT EXISTS calendar_reminders_sent (
  block_id        UUID NOT NULL REFERENCES calendar_blocks(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,            -- which instance was reminded
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (block_id, occurrence_date)
);

-- ════════════════════════════════════════════════════════════════════
-- LAYER 11 — Google Calendar sync (Phase 6C · CALENDAR-AND-SYNC-PLAN.md §2.2)
--
-- Two-way sync to a dedicated "Sharp Sighted" Google calendar via a service
-- account with domain-wide delegation. Everything here is DORMANT until the
-- Google credentials are configured (see docs/google-calendar-setup.md) —
-- with no creds, calendarSyncConfigured() is false and every sync hook is a
-- silent no-op, so the calendar behaves exactly as in 6A/6B.
--
-- Sync columns on calendar_blocks track each block's Google twin; one
-- singleton calendar_sync_state row holds the account-level cursor.
-- Additive + idempotent, same discipline as Layers 1–10.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE calendar_blocks
  ADD COLUMN IF NOT EXISTS google_event_id TEXT,
  ADD COLUMN IF NOT EXISTS google_etag     TEXT,
  ADD COLUMN IF NOT EXISTS sync_state      TEXT NOT NULL DEFAULT 'local'
        CHECK (sync_state IN ('local','synced','pending','error')),
  ADD COLUMN IF NOT EXISTS last_synced_at  TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_blocks_gevent_idx
  ON calendar_blocks(google_event_id) WHERE google_event_id IS NOT NULL;

-- One row holding the account-level sync cursor + connection metadata.
CREATE TABLE IF NOT EXISTS calendar_sync_state (
  id                 INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  google_calendar_id TEXT,            -- the dedicated "Sharp Sighted" cal id
  sync_token         TEXT,            -- incremental-sync cursor (6C-2)
  channel_id         TEXT,            -- push-notification channel (6C-2)
  channel_expiry     TIMESTAMPTZ,
  last_full_sync     TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'calendar_sync_state_updated_at') THEN
    CREATE TRIGGER calendar_sync_state_updated_at BEFORE UPDATE ON calendar_sync_state
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END $$;
