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
-- Inserted by the auth signIn callback the first time someone signs in
-- (provided their email is on the ALLOWED_EMAILS list — see auth.ts).
CREATE TABLE IF NOT EXISTS ops_profiles (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'partner'
                  CHECK (role IN ('admin', 'partner')),
  display_name TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_profiles_role_idx ON ops_profiles(role);
CREATE INDEX IF NOT EXISTS ops_profiles_active_idx ON ops_profiles(active);

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
END $$;
