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
-- `digest_email` is the per-rep opt-in for the morning /today digest.
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
