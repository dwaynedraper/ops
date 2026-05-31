# Clients, Jobs & the Command Center — Implementation Plan

> The post-sale half of Ops. Today the app is an acquisition machine: it
> finds, scores, contacts, and closes strangers, then goes dark the moment
> a prospect becomes a `client`. This plan adds durable **Clients**, a
> post-sale **Job** lifecycle, **roles** (the several people on one job),
> a returning-client on-ramp that skips the cold funnel, and a daily
> **Command Center** dashboard that runs Dean's whole day from one screen.
>
> Build philosophy (per the discovery interview): **evolve in place,
> phased.** Every phase ships something usable. Nothing already built gets
> thrown away. All migrations are additive and idempotent, matching the
> `schema.sql` discipline.

---

## 1. The problem, precisely

The lifecycle in `lib/prospects.ts` runs:

```
researching → qualified → contacting → responded → signed → client
                                                    (+ rejected, dormant)
```

`client` is terminal — `STAGE_NEXT['client'] = []`. There is nothing after
the close. And the only doors *in* are Sourcing and Qualify, both of which
score a stranger against an entry gate. So:

1. **A returning client has no door.** Re-entering them means running a
   paying customer back through a cold-lead gate. Absurd.
2. **No post-sale tracking.** No booking, shoot date, delivery, payment,
   or review-ask. The work you actually get paid for is invisible.
3. **No durable identity.** A `prospect` is *one opportunity*. A repeat
   client becomes a second, disconnected row — no history, no lifetime
   value, a blank cold-call card.
4. **The dashboard is acquisition-only.** It shows outreach follow-ups and
   the prospect funnel. It does not show today's shoots, deliveries due,
   money owed, prints to hand off, or rep performance.

This plan fixes all four without disturbing the acquisition engine.

---

## 2. The model — Clients above Jobs above Quotes

The key move: stop conflating *the person* with *the deal*. A `prospect`
keeps being the deal-in-the-cold-funnel. We add a durable person/business
that owns many engagements over time.

```
            ┌─────────────┐
            │   clients   │   durable identity (person OR business)
            └──────┬──────┘   the cold-call card lives here
                   │ 1—many
            ┌──────┴──────┐
            │    jobs     │   one engagement; post-sale lifecycle
            └──────┬──────┘   shoot date · payment · delivery · review
        ┌──────────┼───────────┐
   ┌────┴────┐ ┌───┴────┐  ┌───┴─────┐
   │job_roles│ │ quotes │  │job_notes│
   └─────────┘ └────────┘  └─────────┘
   the several   reuses the   per-engagement
   people on     existing     log
   one job       calculator
```

`prospects` sits *beside* this, untouched, with one new escape hatch: when
a prospect is won, it converts into a Client + first Job.

### 2.1 New tables (additive, idempotent — drop into `schema.sql`)

```sql
-- ─── clients ───────────────────────────────────────────────────────
-- Durable identity. A person OR a business. Owns every job over time.
-- This is the record a returning client maps back to, and the home of
-- the cold-call card. Never deleted — archived (matches the rep rule).
CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL DEFAULT 'person'
                    CHECK (kind IN ('person', 'org')),
  display_name    TEXT NOT NULL,                  -- "Sarah Chen" / "Acme Title Co."
  email           TEXT,
  phone           TEXT,
  market_area     TEXT,
  -- For the cold-call card: how you know them, who referred them.
  relationship    TEXT,
  referral_source TEXT,
  -- A person can belong to a business (optional self-reference).
  parent_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  -- Soft branch affinity (portraits/realestate/corporate) for filtering.
  branch_affinity TEXT
                    CHECK (branch_affinity IN ('portraits','realestate','corporate')),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  origin_prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clients_owner_idx  ON clients(owner_id);
CREATE INDEX IF NOT EXISTS clients_name_idx   ON clients(lower(display_name));
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients(status);

-- ─── client_notes ──────────────────────────────────────────────────
-- Mirrors prospect_notes. `pinned` = evergreen facts that float to the
-- top of the cold-call card (kept to business-context relationship notes
-- per Dean's preference: "met at the Frisco chamber mixer", "opening a
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

-- ─── jobs ──────────────────────────────────────────────────────────
-- One engagement. Born when a client books (fresh, or converted from a
-- won prospect). Reuses workflow_key for branch + vocabulary. The whole
-- post-sale lifecycle lives in `stage`.
CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  workflow_key    TEXT REFERENCES workflows(workflow_key) ON DELETE SET NULL,
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title           TEXT,                            -- "Fall family session" / "123 Oak St"

  stage           TEXT NOT NULL DEFAULT 'booked'
                    CHECK (stage IN (
                      'booked','prep','shoot','cull','edit',
                      'deliver','followup','review','complete','cancelled'
                    )),

  -- Scheduling (your Wed/Thu shoot days)
  shoot_date      DATE,
  location        TEXT,

  -- Money. value_price defaults from the accepted quote; override allowed.
  value_price     NUMERIC(10,2),
  payment_status  TEXT NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','deposit_paid','paid')),
  deposit_due     DATE,
  balance_due     DATE,

  -- Delivery + review-ask (drive the dashboard "due" lists)
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
-- itself; this table holds the *additional* parties, each pointing at a
-- durable client (so the homeowner you meet today is on file forever).
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

-- Quotes attach to a job, exactly like the existing prospect_id link.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS quotes_job_id_idx ON quotes(job_id);
```

Plus two triggers reusing the existing helpers: `jobs_updated_at` →
`trg_set_updated_at()`, and `jobs_stage_event` → a `trg_log_job_stage_event()`
copy of the prospect logger. Both wrapped in the same `IF NOT EXISTS pg_trigger`
guard pattern already in `schema.sql`.

### 2.2 Why this shape

- **Durable identity** = the cold-call card and lifetime value come for
  free, because every job and note hangs off one `clients` row.
- **Roles point at clients, not loose text** = the title company, the
  homeowner, the office admin all become real records. Meet a homeowner on
  a listing today; if they book a portrait in 2027, they're already on file.
- **Jobs reuse `workflow_key`** = branch color, vocabulary, and the
  per-branch quote calculator all work with zero new config.
- **`origin_prospect_id`** keeps the paper trail from cold lead → client
  for the rep-attribution and reporting you already care about.

---

## 3. The roles model (the lesson, made concrete)

Every job has **one required primary contact** = `jobs.client_id`. That's
all you fill in for a solo portrait. Everyone else is optional, added only
when they differ:

| Role | What it answers | Typical use |
| --- | --- | --- |
| **Primary contact** (`client_id`) | Who do I deal with? | Always. The agent; the person. |
| **Billing / payer** | Who gets the invoice? | Title co., brokerage, the business. |
| **Subject(s)** | Who/what is in front of the lens? | The execs; the property. |
| **Gallery recipient** | Who gets to view/choose/download? | The homeowner on a listing. |
| **Other** (free label) | Anyone else worth keeping | Scheduler, decision-maker, referrer. |

UI: the job page shows the primary contact prominently and a quiet
"+ add role" that only expands when you need it. No friction on simple jobs;
full coverage on the complex ones you described.

---

## 4. The returning-client door

Three entry points, none of which touch the cold funnel:

1. **Dashboard + Clients roster:** a persistent **"+ Add / returning
   client"** button.
2. **Client search-first:** the add flow opens with a typeahead over
   existing clients — so a phone call becomes "type the name, there they
   are" before you ever create a duplicate.
3. **"+ New Job" on a client page:** for someone already on file, one
   button drops you straight into a new Job at `booked`, with the quote
   calculator one click away.

A new server action `createClient()` (mirrors `createProspect`, minus the
scoring/gate) and `createJobForClient()` (mirrors `createQuoteForProspect`'s
thin-handoff pattern). Both owner-scoped (D-019).

---

## 5. The conversion bridge (cold prospect → client)

Hook into the existing `advanceStage()` in `prospects/[id]/actions.ts`
(stamps `signed_by_id` on the way through `signed`). When a prospect
reaches `client`, surface a one-click **"Set up the job"** that:

1. Creates a `clients` row from the prospect's identity (name, org, email,
   phone, market area), stamping `origin_prospect_id`.
2. Copies the prospect's pinned notes into `client_notes`.
3. Creates the first `jobs` row (`booked`), carrying any accepted quote via
   `quotes.job_id`.

Semi-automatic by design — you stay in control, and the prospect record
remains intact for rep attribution. (Default; see §9 if you'd rather it be
fully automatic.)

---

## 6. The Command Center dashboard

Redesign `/` top-down by urgency. The existing morning digest (replies,
follow-ups, close-outs) folds into section 2; the pipeline funnel drops
lower.

1. **Today / This week** — jobs by `shoot_date` in the window, with prep
   status. Anchored on your Wed/Thu rhythm.
2. **Needs you now** — the prioritized "do this next" feed (§7). The
   centerpiece.
3. **Money** — unpaid balances, deposits due, accepted-but-unpaid; one
   "outstanding" total.
4. **To send / to deliver** — emails queued (follow-ups, review-asks) and
   **printed materials to hand off** (jobs in `deliver` with physical
   product). Directly from your interview note.
5. **Team pulse** *(super_admin)* — top-2 rep performance, pulled up from
   the `/reports` snapshot rollup onto the daily screen.
6. **Pipeline by workflow** — the existing funnel, retained.

"Reminders that chase me": the morning-email cron (`/api/cron/digest`)
extends to include the job-side items — shoots tomorrow, deliveries due,
balances due, review-asks ripe — so the email matches the screen, the way
`computeDigest` already guarantees today.

---

## 7. The "next action" engine

Extend `computeDigest()` into a single ranked feed over **both** prospects
and jobs. Per the interview, two signals dominate:

- **Time-sensitive / overdue (highest weight).** Shoot ≤ 2 days out and not
  in `prep`; `delivery_due` today or past; `balance_due` past; quote
  `validUntil` near; client waiting on a reply.
- **Going cold.** Active client with no touch in **21 days** (tunable);
  prospect past its follow-up window (the existing 3-day rule stays for
  active outreach).

Each item gets `priority = urgencyScore + stalenessScore` (a small,
readable ranker to start; weights become admin-tunable in Phase 4, like
`rank_factors`). The feed renders one top-down list — work it, don't
decide it.

---

## 8. Phasing

Each phase is independently shippable and reviewable.

### Phase 1 — Durable Clients + the returning-client door  ← **SHIPPED 2026-05-31**
*What you'll feel:* enter a returning client in ~20 seconds; pull up "who
is this" the instant the phone rings. **Closes the gap you opened with.**
- `clients` + `client_notes` tables + triggers.
- Clients roster (`/clients`) and client profile page (cold-call card v1:
  identity, relationship, pinned notes, history placeholder).
- `createClient()` + search-first add flow + "+ Add / returning client".
- Convert-on-close from the prospect page (Client only; Jobs in Phase 2).

### Phase 2 — Jobs, the lifecycle, roles, quoting cross-over  ← **SHIPPED 2026-05-31**
*What you'll feel:* every booking has a home; you see exactly where each
job sits; repeat business stops vanishing.
- [x] `jobs`, `job_roles`, `job_stage_events`, `quotes.job_id`.
- [x] "+ New Job" → booked → calculator (no funnel).
- [x] Job page: stage rail, shoot date, payment, delivery, roles editor.
- [x] **Job board** — every job by stage at a glance.
- [x] Cold-call card v2: full job history + lifetime $.

### Phase 3 — The Command Center dashboard + next-action engine  ← **SHIPPED 2026-05-31**
*What you'll feel:* one screen runs your day.
- [x] New `lib/command-center.ts` engine (prospects digest + jobs, merged feed).
- [x] Dashboard sections: This week · Needs you now · Money · To send & deliver · Pipeline.
- [x] Digest email + cron extended to chase job items (shoots, deliveries, money).

### Phase 4 — Team pulse + tuning + polish
*What you'll feel:* the full Machine.
- Top-2 rep performance on the dashboard.
- Admin-tunable next-action weights; review-ask automation; prints-to-
  deliver tracking; mobile pass.

---

## 9. Defaults I'll run with (say the word to change any)

These are decided so we keep moving — not re-opened as questions:

- **Naming.** Rename today's `/clients` (really "everyone in the pipeline")
  to **`/pipeline`**; the new durable roster takes **`/clients`**. The
  prospect `client` stage stays in the DB but reads as "Won → delivery" in
  the UI, to free the word.
- **Conversion** is one-click semi-automatic, not silent.
- **Job value** defaults from the accepted quote, manual override allowed.
- **Going-cold threshold:** 21 days for clients; existing 3-day window for
  active prospect outreach.
- **Visibility:** clients + jobs owner-scoped; super_admin sees all (D-019).
- **No deletes:** archive, never delete (matches the rep/prospect rule).

---

## 10. Conventions this plan honors

Additive idempotent migrations in `schema.sql`; raw `sql`/`sqlOne` data
access; server actions with owner checks + `actionError`; trigger-written
stage logs; the shared digest engine so screen and email never drift; a
`CHANGELOG.md` entry and decision-log IDs per phase; tests alongside
(`*.test.ts`) in the existing Vitest setup.

---

*Stay Sharp. Stay Seen. Stay Human.*
