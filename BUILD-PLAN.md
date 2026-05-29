# Sharp Sighted Ops — Master Build Plan

> The single source of truth for what we're building, why, and in what
> order. Updated as work progresses. See `CHANGELOG.md` for the
> dated history. README.md is the local-dev quickstart; this is the
> full operating reference.

**Last updated:** 2026-05-28 · V2 (F0 → F13) shipped on master. **Phase R shipped on branch v2-1** — admin-only `/reports` route, nightly snapshot table, six dashboard cards (Pipeline Velocity as the hero). 176 / 176 tests passing repo-wide. R6 (email digest extension) deferred per D-074. Decisions D-068 → D-074 in §10; full spec in `REPORTS-PLAN.md`. Open: Phase D §9 follow-ups (duplicate-check on Qualify ✓ landed in F8, cross-sell, mobile pass — Dashboard + Clients done in F11), tutorials for the four non-real-estate workflows (Corp HS drafted in F10), per-rep `/reports/me` view (D-068 follow-up). **Send-to-client flow discarded** as a miscommunication. Decision log includes D-034 (Sourcing decides "worth qualifying," not "qualified"). See `REPORTS-PLAN.md`, `V2-PLAN.md`, `SOURCING-PLAN.md`, and `LAUNCH-AUDIT.md` for phase context.

> **Heads-up for readers — `/research` is now `/qualify`.** Renamed in
> Phase E (D-023). Historical references to "Research" or `/research`
> throughout this doc and `CHANGELOG.md` describe what was built at the
> time and are preserved as-is. Forward-looking references use the new
> name.

---

## Table of contents

1. [Mission](#1-mission)
2. [Audience](#2-audience)
3. [Architecture](#3-architecture)
4. [Brand alignment](#4-brand-alignment)
5. [The 30-day plan](#5-the-30-day-plan)
6. [Deployment](#6-deployment)
7. [Operating principles](#7-operating-principles)
8. [Risks and open questions](#8-risks-and-open-questions)
9. [Post-MVP roadmap](#9-post-mvp-roadmap)
10. [Decision log](#10-decision-log)

---

## 1. Mission

Sharp Sighted Ops replaces the PDF packets and master spreadsheet that
currently live on Dean's desk with a working application. The thesis is
"teach by doing" — sales partners (and Dean) onboard by *using* the
tools, not by reading a packet. The tool you reach for to learn the
business is the same tool you reach for to run the business.

Specifically, ops collapses three artifacts into one surface:

- The **master pricing spreadsheet** becomes the **calculator**.
- The **Sales Partner Playbook** becomes the **interactive flow** that
  walks a new partner through their first quote, their first prospect,
  their first close.
- The **prospect playbook** becomes the **pipeline tracker** (post-MVP).

The MVP is the calculator and quote library. Everything else gets built
on the same foundation once those two prove themselves in real use.

---

## 2. Audience

Two roles, both internal:

**Super-admin (Dean).** Sees costs, margins, internal notes, the full
methodology breakdown. Owns all pricing config — the Rates page, the
package worksheets, the corporate formula. Manages the partner roster.
There is one super-admin at launch (`dean@sharpsightedstudio.com`); a
super-admin can elevate another person to super-admin.

**Partner (Kelsey-shaped role).** Sees client-facing prices only — no
costs, no margins, no internal notes, no pricing config. Builds quotes
for their own prospects. Bootstrap-allowlisted by email.

There is no public-user role. Robots are explicitly disallowed in
`metadata` in `src/app/layout.tsx`. Anyone hitting any route without a
session gets redirected to `/signin`, and the sign-in flow rejects any
email not on `ALLOWED_EMAILS`.

---

## 3. Architecture

### 3.1 Stack

| Layer        | Choice                                              | Why                                                                |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------ |
| Framework    | Next.js 16 (App Router, TypeScript, Turbopack)      | Same stack as `/studio`. Patterns transfer cleanly.                |
| Styling      | Tailwind v4 (`@import "tailwindcss"`)               | Same as `/studio`. Custom tokens via `@theme inline`.              |
| Type         | Playfair Display + Montserrat (via `next/font`)     | Brand discipline — every Sharp Sighted property uses these.        |
| Auth         | Auth.js v5 with Email provider                      | Magic-link sign-in. No passwords to support. v5 is the current API. |
| Email        | Resend                                              | Modern API, generous free tier, easy domain verification.          |
| Database     | Postgres on Neon (us-east-1)                        | Auth.js needs database sessions for Email; Neon's free tier is fine. |
| PDF          | `@react-pdf/renderer`                               | Vercel-friendly, no Puppeteer/serverless-binary headaches.         |
| Region       | Vercel `iad1` + Neon `us-east-1`                    | Co-located. ~5ms query latency vs ~80ms cross-region.              |
| DNS          | Namecheap                                           | Where `sharpsighted.studio` is registered.                         |
| Hosting      | Vercel                                              | Auto SSL, preview deploys, Node-runtime middleware support.        |

### 3.2 File layout

```
ops/
├── BUILD-PLAN.md            ← you are here
├── CHANGELOG.md             dated history of meaningful changes
├── README.md                local-dev quickstart, env vars, build-order glance
├── CLAUDE.md                pointer back to README + brand bible
├── package.json             scripts: dev, build, lint, db:migrate, db:check
├── vercel.json              framework + region pin
├── next.config.ts           image patterns (empty for v1 — internal app)
├── tsconfig.json            strict TS, @/* alias to src/
├── eslint.config.mjs        next/core-web-vitals + TS
├── postcss.config.mjs       Tailwind v4
├── .env.example             annotated template — never commit .env.local
├── .gitignore               standard Next.js + .env* + .vercel
├── scripts/
│   └── db-migrate.mjs       no-psql migration runner
└── src/
    ├── app/
    │   ├── layout.tsx       root layout — fonts, theme provider, robots
    │   ├── page.tsx         dashboard (session-aware)
    │   ├── globals.css      design tokens — ops dialect (denser than studio)
    │   ├── providers.tsx    theme context (ss_ops_theme key)
    │   ├── not-found.tsx    branded 404
    │   ├── signin/
    │   │   ├── page.tsx                  branded sign-in form
    │   │   ├── verify-request/page.tsx   check-your-email confirmation
    │   │   └── error/page.tsx            branded error states
    │   └── api/auth/[...nextauth]/route.ts
    ├── auth.ts              NextAuth config — adapter, provider, callbacks, events
    ├── proxy.ts             Next.js 16 middleware — route gating
    ├── components/
    │   ├── Sidebar.tsx      app-shell sidebar (role-aware)
    │   └── Footer.tsx       tagline footer with cyan wordmark
    └── lib/
        ├── db.ts                  pg pool + sql tagged-template helper
        ├── db/schema.sql          full Postgres schema (idempotent)
        ├── email-allowlist.ts     ALLOWED_EMAILS parser + bootstrap-admin check
        ├── magic-link-email.ts    branded HTML email body
        └── pricing.ts             cost-plus methodology (pure functions)
```

### 3.3 Why a separate Next.js project (not a route group in /studio)

The public `sharpsighted.studio` site has its own audience (creatives,
the journal, the 10% archive). Ops has a totally different audience
(Dean, sales partners). Different release cadence, different auth
model, different design density, different data shape. Sharing a
codebase would couple the two — every studio public release would risk
a partner-facing regression. Two repos, two deploys, one brand DNA.

Each Sharp Sighted property gets its own folder under `/projects/sharp/`:

```
sharp/
  landing/    →  sharpsightedstudio.com
  photos/     →  sharpsighted.photos
  media/      →  sharpsighted.media
  studio/     →  sharpsighted.studio
  ops/        →  ops.sharpsighted.studio   ← this project
```

### 3.4 Database model

Two layers in `src/lib/db/schema.sql`:

**Layer 1 — Auth.js adapter tables** (the Postgres adapter requires
these column names and casing; we don't touch them):

- `users` — name, email, emailVerified, image
- `accounts` — OAuth account links (unused with Email-only but required)
- `sessions` — session tokens, expirations
- `verification_token` — magic-link tokens awaiting click

**Layer 2 — Ops application tables** (snake_case, our territory):

- `ops_profiles` — 1:1 with `users`. Carries `role` (admin | partner),
  `display_name`, `active`, `invited_by`, `last_seen_at`. Created by
  the `createUser` event in `auth.ts` on first sign-in.
- `packages` — Verse, Story, Saga, Single, Team Day, Essentials,
  Visibility Retainer. Each carries cost-plus inputs (time_hours,
  lp_rate, hard_cost, default_margin) plus its rounded display price.
- `addons` — universal or package-specific. Same cost-plus structure
  plus `unit_label` (per-person, per-clip, etc.).
- `quotes` — header, client info, status, rolled-up totals,
  `package_snapshot` JSONB so historical quotes never get rewritten by
  a later catalog change.
- `quote_lines` — one row per package/addon/custom item on a quote,
  with snapshot pricing.
- `quote_events` — append-only audit log (created, updated, sent,
  accepted, declined, archived, note).

Every table with an `updated_at` column has a trigger that sets it
on update. `gen_random_uuid()` from `pgcrypto` is used for all primary
keys.

### 3.5 Auth model

Email magic-link via Resend. Database-backed sessions (required by the
Email provider — the link verification needs server-side state).
Access control happens in two places:

1. The **`signIn` callback** in `src/auth.ts` rejects any email not on
   `ALLOWED_EMAILS` and redirects them to `/signin/error?error=AccessDenied`.
2. The **`proxy.ts` middleware** redirects unauthenticated requests
   to `/signin?callbackUrl=<original-path>`, except for the public
   allowlist (`/signin/*`, `/api/auth/*`, static assets).

Roles are assigned on first sign-in by the `createUser` event:
the bootstrap email (the first in `ALLOWED_EMAILS`) becomes
`role='super_admin'`; everyone else starts as `role='partner'`.
Promotion to super-admin is a manual SQL update for v1; a roster UI
lands post-MVP if it's ever needed.

---

## 4. Brand alignment

### 4.1 Visual dialect

Ops is the fifth Sharp Sighted property. It carries the same brand DNA
as the public sites — Playfair Display + Montserrat, cyan on the
footer wordmark, "Stay Sharp. Stay Seen. Stay Human." closing every
artifact — but it's app-shaped:

- **8px corner radius** — between studio's 10px (editorial-soft) and
  the photos/media/landing 0px (editorial-hard). Reads as "tool."
- **Steel/slate working surfaces** — `--surface-tool`, `--surface-tool-2`.
  Backgrounds for forms, tables, calculators. Terracotta is reserved
  for *primary actions* and *live highlights*, not load-bearing surface
  color. (Studio's load-bearing terracotta is its own thing.)
- **Dense rhythm** — 2-3rem section padding default, vs studio's 6-8rem.
  Working tool, not a magazine. White space serves the eye scanning
  data, not editorial pose.
- **Cyan footer wordmark** — per brand discipline (CLAUDE.md §8). Same
  color, same italic Playfair Display rendering as every other site.

### 4.2 Voice in the app

Same voice as everywhere else (CLAUDE.md §6) — short, deliberate
sentences, periods doing real work, no corporate hedging. Specifics:

- Empty states never apologize. "No quotes yet — build one." not
  "It looks like you haven't created any quotes."
- Errors say what to actually do. "That email isn't on the roster"
  not "Authentication failed."
- Numbers in Playfair Display, italic where possible, in the `.money`
  class. Tabular figures (`font-feature-settings: tnum`).
- Tagline closes the footer. Always.

### 4.3 How ops fits among the four public properties

Ops doesn't appear on the umbrella router (`sharpsightedstudio.com`).
It doesn't show up in any public footer. Search engines are explicitly
told to ignore it. It's invisible to a prospect unless they're a
partner being onboarded.

The public studio at `sharpsighted.studio` continues exactly as
architected — journal, 10% archive, cross-network feed, series pages.
Ops is a sibling on a different subdomain, not a section.

---

## 5. The 30-day plan

### Week 1 — Foundation

#### Day 1 — Scaffold ✓ (2026-05-19)

Created `/projects/sharp/ops` as a Next.js 16 project. Ported design
tokens from `/studio` adapted to the ops dialect (denser, steel-toned).
Built the app shell (sidebar, footer, dashboard placeholder), branded
404, theme provider. README + AGENTS-style note. Verified the file
tree, package.json, and config render the dashboard locally.

**Files added.** `package.json`, `tsconfig.json`, `next.config.ts`,
`postcss.config.mjs`, `eslint.config.mjs`, `.gitignore`, `.env.example`,
`README.md`, `CLAUDE.md`, plus everything under `src/app/`,
`src/components/`, and the root `src/lib/pricing.ts`.

#### Day 2-3 — Postgres + schema ✓ (2026-05-19)

Stood up Neon Postgres (`sharp-ops` project, us-east-1). Wrote the full
schema (Auth.js adapter tables + ops application tables + triggers).
Built `scripts/db-migrate.mjs` so we don't need `psql` installed locally.
Applied the schema; verified all ten tables present.

**Files added.** `src/lib/db.ts`, `src/lib/db/schema.sql`,
`scripts/db-migrate.mjs`. `package.json` updated to add
`db:migrate` and `db:check` scripts.

**Note.** Switched the Neon connection string from `sslmode=require`
to `sslmode=verify-full` to preserve secure TLS behavior and silence
the pg deprecation warning.

#### Day 4-5 — Auth.js v5 + Resend magic links ✓ (2026-05-19)

Wrote `src/auth.ts` with the Postgres adapter and a Resend-backed
custom `sendVerificationRequest` that calls the Resend API directly
with a branded HTML email. Wrote `src/proxy.ts` (Next.js 16's
middleware successor) gating every non-public route. Built the branded
sign-in surface (`/signin`, `/signin/verify-request`, `/signin/error`).
`createUser` event upserts `ops_profiles` row with `role='super_admin'`
for the bootstrap email, `role='partner'` for everyone else.

**Files added.** `src/auth.ts`, `src/proxy.ts`,
`src/lib/email-allowlist.ts`, `src/lib/magic-link-email.ts`,
`src/app/api/auth/[...nextauth]/route.ts`, `src/app/signin/page.tsx`,
`src/app/signin/verify-request/page.tsx`,
`src/app/signin/error/page.tsx`.

**Verified.** End-to-end magic-link sign-in works locally. Dashboard
recognizes the bootstrap super-admin and renders the admin sidebar section.

#### Day 6-7 — Vercel deploy + DNS ✓ (2026-05-19)

Pushed the repo to GitHub via GitKraken. Imported in Vercel. Set
production env vars (see §6.2). First deploy on `*.vercel.app`, then
added `ops.sharpsighted.studio` as the custom domain. CNAME on
Namecheap pointed at `cname.vercel-dns.com`. Vercel auto-provisioned
SSL via Let's Encrypt. Set production `AUTH_URL` to the canonical
HTTPS URL, redeployed so magic links carry the right host. Ran the
60-second end-to-end sign-in test on production — magic link arrived,
clicked, dashboard rendered with admin sidebar.

**End-of-week milestone.** Dean can sign in at
`https://ops.sharpsighted.studio` and see the dashboard. ✓

---

**Week 1 retrospective.** Seven days planned, seven days shipped. The
auth surface, the schema, the design system, the deploy pipeline, and
the brand-consistent sign-in flow are all live in production. No
significant cuts; one minor schema-adjacent decision (D-005, switching
to `sslmode=verify-full`) and one minor framework-quirk fix (proxy.ts
forbids route segment config). Ops is now a real running surface
waiting for content — the calculator and quote library land in Weeks
2-4.

---

### Week 2 — Pricing engine

#### Day 8 — Data model + seed ✓ (2026-05-19)

Finalized the package and addon schemas from the master spreadsheet.
Wrote `scripts/db-seed.mjs` covering seven packages (Verse, Story,
Saga, Single Executive, Team Day, Essentials, Visibility Retainer)
and eleven addons (extra digital, Gift Collection, Fine Art Collection,
Heirloom Book, Exhibition upgrade, Saga additional day, Single
Featured upgrade, Team Day per-person, Team Day Featured-for-principal,
Cinematic walkthrough, Retainer additional clips). Each package row
carries spreadsheet cost-plus inputs alongside the wall-card retail
price; the seed report prints the methodology-vs-retail spread for
admin awareness. Idempotent — re-run safe on price changes.

**Files added.** `scripts/db-seed.mjs`. `package.json` updated with
`db:seed` and `db:seed:dry` scripts.

#### Day 9 — Catalog reconciled to current spreadsheet ✓ (2026-05-19)

Audited the seed against the current master spreadsheet; corrected
five divergences (Verse hours, Saga $8,500, Single $500, Retainer
$1,900, Story Exhibition +$2,200). See CHANGELOG and decisions
D-007/D-008.

#### Day 10-12 — Pricing worksheet + admin editor ◐ (in progress, started 2026-05-19)

Re-sequenced from the original plan. Dean asked for the spreadsheet's
cost-plus *worksheet* to be editable inside ops — not just the final
price — so pricing is fully integrated and a partner can never quote
a number stale relative to a pricing change. This absorbs the Week 4
admin-editor work (old D-009) and expands it.

**Day 10 — data layer (done 2026-05-19).** Schema restructured:
`pricing_globals` (the rate table) and `package_cost_lines` (one row
per worksheet line, time or hard) added; `packages` lost its flat
cost columns and now derives cost from its lines. `db-migrate.mjs`
got a `--fresh-catalog` flag for the structural transition.
`pricing.ts` extended with `priceFromCostLines()` — sums mixed-role
cost lines (LP at $75 + 2S at $30 on the same package) into a
breakdown. Seed rewritten to populate globals + packages + cost
lines; every package's `base_price` is now *computed* from its lines.

Then two product decisions reshaped the catalog (D-013, D-014):
corporate headshots left the worksheet for a parametric formula
(`corporate_pricing` table + `computeTeamDay()` in `pricing.ts`), and
the top role was renamed `admin` → `super_admin`. The catalog settled
at 5 worksheet packages + 8 addons + the corporate formula. All prices
verified.

**Day 11-12 — admin UI.** Three super-admin-only routes:
- `/rates` — the Globals sheet as an editable form (LP, Saga, 2S,
  PA, XM rates; default and specialty margins; commission, tax).
- `/packages/[slug]` — the per-package worksheet. Editable time and
  hard-cost line items, role dropdowns, live Working Price / Website
  Price recompute. Draft state until Publish (see D-012).
- `/corporate` — the corporate formula config (Single Executive
  prices, Team Day base/promo, per-person rates, volume tiers). Same
  draft-until-Publish gate.

### Reframe — pipeline + light CRM (2026-05-21)

Dean re-scoped ops mid-build (see D-015 through D-020). It is a sales
pipeline plus a light CRM, not a calculator with extra pages. The
day-numbered Week 3–4 plan below is **superseded** by three phases;
it stays for history.

**Phase A — Calculator** ✓ (complete 2026-05-21). Standalone
`/calculator`: branch → package → add-ons, or the corporate parametric
formula; live total; "Save quote" persists to `quotes` / `quote_lines`
/ `quote_events`. Server recomputes every number from a sent
*selection* — client prices are never trusted.

**Phase B — CRM pipeline** ✓ (complete 2026-05-21). Additive migration
(`prospects`, `rank_factors`, `contact_scripts`, `prospect_contacts`,
`prospect_notes`; `prospect_id` on `quotes`) + seed of default rank
factors and scripts — then the four pages, all shipped: Research (entry
gate + live 0–10 scoring), Tracking (contact cycle, script fill,
copy-paste output), Client page (mini CRM — details, embedded
calculator, pinned facts + notes timeline, signed-by, quote history),
Dashboard (follow-ups due, pipeline counts, qualified banner).
Owner-scoped visibility throughout. The full sales motion runs end to
end. See D-021 and the 2026-05-21 CHANGELOG entry.

**Phase C — Super-admin editors** ✓ (complete 2026-05-21). Pricing
worksheet / Rates / Corporate plus the rank-factor and script editors —
all draft-until-Publish (D-012), all on the shared `DraftGuard`
component (beforeunload + in-app nav interception + the
Stay/Reset/Publish modal). Every pricing and CRM config surface is now
editable in ops; seed/SQL editing is retired as the routine path.

Quote PDF export ✓ (complete 2026-05-21) — the `/quotes/[id]` detail
page plus an on-demand `@react-pdf/renderer` route. Send-to-client
(emailing the PDF) and final polish remain.

### Phase D — multi-workflow pipeline (2026-05-21)

The pipeline becomes multi-workflow — one tuned workflow per offering:
Real Estate Media, Corporate Headshots, Story Portraits, The Saga, and
The 10% Rule. Each owns its entry gate, scoring factors, contact
scripts, handoff links, and vocabulary, on the shared Research →
Tracking → Client machinery. Full detail in **PHASE-D-PLAN.md**; see
D-022.

Build order: **D1** schema → **D2** Research → **D3** editors → **D4**
Client List → **D5** Tracking + Dashboard → **D6** handoff links.

**Phase D complete ✓ (2026-05-21).** All six steps landed: the
five-workflow schema and seed (D1), the adaptive Research page (D2),
the per-workflow Rank Factor and Script/Links editors (D3), the new
`/clients` Client List (D4), multi-workflow Tracking + Dashboard (D5),
and config-backed handoff-link placeholders resolved in the contact
composer (D6). The build is green again.

**Post-D follow-ups (2026-05-22).** Three PHASE-D-PLAN §9 items shipped:
the `/today` morning digest (per-rep brief — replies waiting, follow-ups
due, cycles to close), the `/team` supervisor report (per-rep windowed
activity + pipeline snapshot, super_admin only), and the dead-nav
cleanup — `/today` and `/team` were nav stubs and now resolve. The §12
parked task is also done: the quote PDF now renders in the brand faces
(Playfair Display + Montserrat).

### Phase E — Sourcing + Qualify restructure ✓ complete (2026-05-26)

A new list-intake surface landed in front of the per-prospect page,
and the per-prospect page was renamed to match what it actually is.
The old one-agent-at-a-time `/research` workflow became the deep-work
**Qualify** page; a new spreadsheet-style **Sourcing** page sits in
front of it for rapid intake from public sources like RealTrends.
Each sourcing row IS a prospect from row one, with a manual
three-state Qualify / Pass / Undecided toggle and an advisory
pre-score badge. Both surfaces are per-workflow, mirroring the
existing architecture. Two adjacent gaps closed at the same time:
contextual help modals on Qualify (left-rail ToC, right pane,
optional tabs) and a new `/tutorials` section with one workflow
walkthrough per offering. Mid-phase, the real-estate scoring math
was reshaped (gates anchor the score; `annual_volume` runs piecewise;
`branded_email` dropped) — D-032.

Phases delivered:
**P1** docs + recovery plan ✓ · **P2** schema audit + migration ✓ ·
**P3** rename `/research` → `/qualify` ✓ · **P4** build `/sourcing` ✓ ·
**P4.5** real-estate scoring math overhaul + column trim ✓ ·
**P4.6** Sourcing UX surgery (lock-after-blur, override-with-reason)
+ `/qualify/[id]` ✓ · **P5** help modals on `/qualify` ✓ ·
**P6** `/tutorials` section ✓ · **P7** verify + finalize ✓.

Full detail in **SOURCING-PLAN.md**; see D-023 through D-032 below.

**Rep management + activity logging (2026-05-22).** Onboarding moved off
the `ALLOWED_EMAILS` env var to an invite-and-approve flow: `rep_invites`
+ a four-state `ops_profiles.status` lifecycle (invited → active →
suspended → disabled; reps are never deleted). `/team` is the roster;
the supervisor report moved to `/team/activity`. A `prospect_stage_events`
log (database trigger) now records every stage change, so the report
counts real transitions. The `/today` digest can be emailed each
morning via a Vercel cron + Resend (per-rep opt-in). Still open from §9:
duplicate-check on Qualify, cross-sell linked prospects, mobile pass.

---

#### Day 13-15 — Calculator UI

The headline module. New route `/calculator`:

- Branch picker (Portraits / Corporate / Real Estate) at top
- Package cards for the chosen branch, click to select
- Addon checklist (only addons valid for the chosen package + branch)
- Live total panel, sticky on desktop, showing:
  - For admin: cost basis, margin, working price, display price
  - For partner: display price only
- Quote summary panel ready for the "Save quote" mechanic in Week 3

Reads each package's published `base_price`. `src/lib/pricing.ts`
does the math; the UI is a presentation layer.

#### Day 16 — Role-aware view + polish

Wire `session.user.role` into the calculator surface. Partner view
strips cost / margin / internal notes from every panel.

**End-of-week milestone.** Dean can quote any package + add-on combo
in 30 seconds and trust the number — and adjust any price in ops
without touching code.

**Sequencing note.** This re-sequence pushes the calculator ~2 days
and Week 3 starts ~Day 17. The Week 4 admin-editor task is removed
(built here instead). Realistic landing: Day 30-32.

---

### Phase R — Reports (in flight, 2026-05-28)

Admin-only `/reports` route inside Ops, a `daily_metric_snapshot`
table populated by a new nightly cron, and six dashboard cards
designed around three recurring decisions ("Is my pipeline
healthy?", "Which workflow do I push?", "Which rep deserves my
time?"). Pipeline Velocity is the hero card.

Specification in **`REPORTS-PLAN.md`** — full schema, rollup math,
card-by-card design, test list. Decisions D-068 → D-074 in §10
below. Build sequence R0 → R7; R6 (digest extension) is the only
deferrable step.

The architecture is intentionally small: one new Postgres table,
one new cron route, one new admin-gated page. No third-party
analytics, no Looker/Mixpanel/PostHog, no data egress. Everything
runs in the existing Neon + Vercel + Resend stack.

**Status: R0–R5 + R7 shipped on branch v2-1 (2026-05-28). R6 (digest email extension) deferred per D-074 — rolls forward to a follow-up phase.**

---

### Week 3 — Quote persistence

#### Day 15-16 — Save / list

"Save quote" button on the calculator. Persists to `quotes` +
`quote_lines` with a `package_snapshot`. New route `/quotes` lists
recent quotes, filtered by status (default: draft + sent). Each row:
quote number, client name, package, total, status, created date.

#### Day 17-18 — Detail / edit / archive

`/quotes/[id]` page: full quote view, status pipeline (draft → sent →
accepted/declined/archived), audit-log timeline from `quote_events`.
Edit reopens the calculator pre-filled. "Duplicate" creates a new
draft from the existing quote. "Archive" soft-deletes.

#### Day 19-21 — Client info attachment

Form on quote detail to attach client info (name, email, phone, project
name, target date, free-form notes). Internal-only notes field on the
admin view. Search the quote list by client name and project.

**End-of-week milestone.** Every quote you build during the week is
findable next month. Duplicate-a-past-quote is a single click.

---

### Week 4 — PDF output + polish

#### Day 22-25 — PDF generation

`@react-pdf/renderer` produces a server-side PDF on demand. The
template mirrors the wall-card visual language — Playfair + Montserrat,
cyan accents on the title, sectioned breakdowns, tagline footer.
Output is partner-facing — only client-visible numbers, no costs or
margins. Triggered from the quote detail page; PDF is generated fresh
on each request (no storage).

#### Day 26-27 — Send-to-client flow

"Send to client" button on quote detail. Two paths:

1. Download the PDF and attach to your own email.
2. Email it from ops via Resend, with a short branded cover note.
   Sender is `quotes@sharpsighted.studio` (or the verified `EMAIL_FROM`
   domain). The client gets it as an email attachment; the quote moves
   from `draft` to `sent` in the pipeline; `sent_at` timestamps.

#### Day 28-30 — Polish, mobile, real-use shakedown, admin editor

Mobile responsive checks on the calculator and quote pages (sidebar
collapses to a top bar; tables become cards). Empty states, error
states, loading states. Run a real Discovery Hour with a real prospect
using ops, end-to-end. Fix whatever's awkward.

Also build the **admin editor** for packages and addons (`/packages`
admin route). Replaces the hand-typed `db-seed.mjs` updates with a
real editing surface. After this lands, the master spreadsheet
becomes a reference artifact instead of the authoritative source —
ops is where prices live and where they get changed.

**Day 30 milestone.** A Discovery Hour quoted, saved, exported,
emailed, and accepted using ops alone. The Pricing Master Spreadsheet
retires as a working tool.

---

## 6. Deployment

### 6.1 Service inventory

- **Vercel** — hosts the Next.js app.
- **Neon** — Postgres. Free tier, us-east-1 region.
- **Resend** — magic-link email transport. Free tier.
- **Namecheap** — DNS for `sharpsighted.studio`.
- **GitHub** — git remote (private repo).

### 6.2 Production env vars (Vercel)

| Key                 | Value                                                                                  | Notes                                                       |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`      | Neon pooled URL with `sslmode=verify-full`                                             | Same as local.                                              |
| `AUTH_SECRET`       | Output of `openssl rand -base64 32` (different from local)                             | Rotate this to force-revoke all sessions.                   |
| `AUTH_URL`          | `https://ops.sharpsighted.studio`                                                      | Production only. Preview deploys get the .vercel.app URL.   |
| `AUTH_TRUST_HOST`   | `true`                                                                                 | Required behind the Vercel proxy.                           |
| `AUTH_RESEND_KEY`   | `re_...` from resend.com                                                               | Same key works for dev and prod.                            |
| `EMAIL_FROM`        | `"Sharp Sighted Ops <no-reply@sharpsighted.studio>"`                                   | Once the sending domain is verified on Resend.              |
| `ALLOWED_EMAILS`    | `dean@sharpsightedstudio.com,...`                                                      | First entry is the bootstrap super-admin.                   |

### 6.3 DNS — adding the ops subdomain on Namecheap

The standard Namecheap CNAME flow. See §7 below for the full walkthrough.

### 6.4 First-deploy gotchas

- The first deploy will fail magic-link sign-in unless `AUTH_URL` is
  set to the deploy's actual URL. Easiest path: do the first deploy,
  add `AUTH_URL=https://ops.sharpsighted.studio` to Vercel env,
  redeploy.
- Resend sandbox sender (`onboarding@resend.dev`) only delivers to
  the registered account owner's email. Verify the sending domain
  before any partner is on the roster.

---

## 7. Operating principles

### 7.1 Commit cadence

One commit per logical change. A working feature = one commit.
Refactoring = a separate commit. Docs updates = a separate commit.
**No amending after push.** The history is a record; preserve it.

### 7.2 Commit message format

Subject line ≤ 72 chars, imperative mood when describing code
("Add calculator", "Fix sidebar role gating"), descriptive when
documenting state ("Week 1 — ops scaffold..."). A body explaining
the *why* and any non-obvious tradeoffs. Tagline at the end only for
milestone commits, not every commit.

### 7.3 Documentation hygiene

- **README.md** is the local-dev quickstart. Keep the build-order
  checklist current as days complete.
- **BUILD-PLAN.md** (this file) is the master plan. Update the day
  sections with "✓" + date when they're done; add notes when reality
  diverges from plan.
- **CHANGELOG.md** is the dated history of meaningful changes. Add
  an entry for every commit that ships a feature, fixes a bug, or
  changes the operating environment.
- **.env.example** stays a complete, annotated template. Anything
  new in production env vars goes in here first.

### 7.4 Decision log

Significant decisions — choosing one tool over another, designing a
schema column, deciding a flow — get an entry in §10 below. Cost: a
paragraph. Benefit: the question doesn't get re-asked in three months.

### 7.5 Schema changes

`src/lib/db/schema.sql` is idempotent. Every `CREATE` has `IF NOT
EXISTS`. New tables / columns: add to the file, run `npm run db:migrate`.
**Never edit existing columns destructively in this file**; add a
separate migration if a column needs a type change. (We don't have a
migration runner for that yet — when the time comes, we'll switch to
numbered migration files. For v1, the schema is additive-only.)

---

## 8. Risks and open questions

**Resend domain verification.** Until `sharpsighted.studio` is verified
as a sending domain, only the Resend account owner gets magic-link
emails. Onboarding a partner means doing the DNS records first.

**PDF rendering parity.** `@react-pdf/renderer` is React-component-based;
it doesn't render HTML/CSS faithfully. The wall-card aesthetic will need
to be re-implemented in its component dialect. Possible Week 4 day-slip.

**Vercel free-tier limits.** Function invocations, build minutes, and
bandwidth. For 1-5 users this is nowhere near a concern, but worth
monitoring once partners start being added.

**Role escalation.** No admin UI for promoting a partner to admin in
v1; promotion is a manual `UPDATE ops_profiles SET role='super_admin' WHERE
user_id=...;`. If that becomes more than rare, build the UI.

**Open question — sales partner onboarding flow.** The "teach by
doing" thesis says the new partner's first quote should be a *guided*
quote — annotated, with copy explaining each decision. Not in MVP, but
queued for post-MVP §9 below. The shape is fuzzy until a real partner
walks through v1.

---

## 9. Post-MVP roadmap

The MVP now ships the calculator, the CRM pipeline, and the quote
library in ~30 days (see the §5 reframe). The following modules are
designed but not built yet:

**Prospect Tracker + Daily Queue — promoted into the MVP (2026-05-21).**
What sat here as post-MVP is now Phase B of the build (see the §5
reframe and D-015 through D-020): the Research, Tracking, Client, and
Dashboard pages. The dashboard's follow-up queue — prospects due for
contact, computed on read — subsumes the Daily Queue's "what do I do
first today" need.

**Sales Partner Onboarding Flow.** A guided first-quote tutorial that
teaches by doing. Annotates the calculator at each step ("Verse is
two hours. That gets you ten finals and five framed letters. Watch the
total update as we go."), captures the partner's questions inline, and
reviewable by an admin afterward.

**10% Tracking.** Hours logged against contributed work (per CLAUDE.md
§7). Per-cause reporting. Tax-time export.

**Reporting.** Monthly close report: quotes built, sent, accepted,
revenue, days-since-last-quote-per-partner. Annual report: same, plus
year-over-year and per-package mix.

**Quote Override Request (V2.0 — explicitly the last build step).**
A sales partner mid-call with a client can request a price override
without leaving the quote. A small form: client name, original price,
requested price, reasoning, and a "previous customer" boolean. On
submit, the request is routed instantly to both of Dean's phone
numbers and his email — fast enough that he can often answer before
the client is off the phone with the partner. Dean's yes/no locks
the final quote. Any subsequent edit to the quote turns the override
flag back off, so an approved override can't silently ride along on a
changed quote.

Architecturally this is the *last* code to run in the quote pipeline:
the override is applied only after every other pricing rule has
resolved, so it's a clean final layer with nothing downstream of it.
That's why it sequences dead last — it can be bolted on after the
entire rest of the system is built without touching any of it.

These get sequenced after MVP based on which one is hurting most.

---

## 10. Decision log

### D-001 · Separate Next.js project, not a route group (2026-05-19)

**Decision.** Ops is its own folder, its own repo, its own Vercel
deploy — not a route group inside the `/studio` codebase.

**Rationale.** Coupling the two would mean every public-site release
risks a partner-tool regression and vice versa. Different audiences,
different cadences, different design density, different data shape.
Shared code burden > duplicated code benefit at this size.

**Status.** Active. Revisit only if the two codebases drift into
genuinely incompatible patterns and a shared utility layer would
prevent it. (Unlikely.)

### D-002 · Database sessions, not JWT (2026-05-19)

**Decision.** Use Auth.js v5's database session strategy backed by
the Postgres adapter, not JWT-encoded sessions.

**Rationale.** The Email provider requires server-side state to
verify the magic-link token. JWT sessions are *possible* with Email
but the docs strongly recommend database sessions for that combination.
Also, database sessions can be revoked instantly (delete the row);
JWTs can't be revoked until they expire.

**Trade-off.** Every authenticated request does a DB query. With
us-east-1 + iad1 co-location, that's ~5ms — fine.

### D-003 · Email allowlist as env var, not table (2026-05-19)

**Decision.** Access control is a comma-separated `ALLOWED_EMAILS`
env var, parsed and cached once per process.

**Rationale.** For 1-5 partners, an env var is simpler than a roster
table and an admin UI to manage it. Replace with `ops_invites` table
once partner count > 5 or a non-admin needs to invite.

### D-004 · Subdomain `ops.sharpsighted.studio` over alternates (2026-05-19)

**Decision.** Internal app lives at `ops.sharpsighted.studio`, not
`team`, `inside`, `crew`, or a different TLD.

**Rationale.** Short, signals "operations" without sounding corporate.
Subdomain isolation keeps auth/cookies/sessions separate from the
public studio site. "Ops" reads cleanly in conversation.

### D-005 · `sslmode=verify-full` over `sslmode=require` (2026-05-19)

**Decision.** All Postgres connection strings use `sslmode=verify-full`,
not Neon's default `sslmode=require`.

**Rationale.** Forward-compatible with `pg` v9, which will demote
`require` to weak TLS (no cert verification). `verify-full` preserves
the current secure behavior across the upgrade and silences the
deprecation warning at process start.

### D-006 · `package_snapshot` JSONB on quotes (2026-05-19)

**Decision.** `quotes.package_snapshot` is a JSONB column capturing
the package state (name, base_price, methodology inputs) at the moment
of the quote.

**Rationale.** Catalog changes (price raises, deprecated packages,
methodology tweaks) can't be allowed to rewrite history. Last quarter's
quote should always show what was actually quoted.

### D-007 · Retail price stored separately from methodology output (2026-05-19)

**Decision.** `packages.base_price` is the actual published retail
price, set manually. The cost-plus inputs (`time_hours`, `lp_rate`,
`hard_cost`, `default_margin`) are stored alongside, but the
calculator shows `base_price`, not the computed methodology output.

**Rationale.** Survey of the master spreadsheet shows retail prices
diverge from cost-plus math in both directions (Verse retails $100
under math; Corp Single retails $170 over math; Visibility Retainer
retails $400 under math). The divergences are strategic — funnel
pricing on entry packages, market-supported premiums on others.
Forcing the calculator to use methodology math would change published
prices, which would mean reprinting the wall card, brief, etc.

**Trade-off.** The admin view shows both numbers and the spread, so
the divergence stays visible — not hidden away in code. The
methodology number is informational discipline; the retail number is
what gets quoted.

### D-008 · Story Exhibition as an addon, not a second package (2026-05-19)

**Decision.** The Story Exhibition variant in the spreadsheet is
modeled as a single `story-exhibition-upgrade` addon attached to
`the-story`, raising the museum-grade print hard-cost by +$2,200
retail (Standard $1,700 → Exhibition $3,900).

**Rationale.** The wall card already presents Exhibition as a print
upgrade ("+ Gallery print upgrade · museum-tier wall set") rather
than a distinct package. Treating it as an addon keeps the catalog's
branch picker simple — one Story, one decision to upgrade — instead
of forcing the prospect to choose between two near-identical packages
at first glance.

### D-009 · Admin editor lands in Week 4 polish, not earlier (2026-05-19)

**Decision.** A `/packages` admin route with editable package/addon
fields lands in Week 4 polish (Day 28-30), not before the calculator.
Until then, price changes happen by editing `scripts/db-seed.mjs` and
re-running `npm run db:seed`.

**Rationale.** The MVP path is calculator → quotes → PDF → real
Discovery Hour use. Editing prices isn't on the critical path; price
changes will happen 2-3 times in the next two weeks at most, and a
five-minute code edit is acceptable for that frequency. Once the
calculator and quote library are shipped, the editor closes the loop
and lets the spreadsheet retire as authoritative.

**Trade-off.** Means the master spreadsheet stays as a second
authoritative-looking source for ~3 weeks. The seed script is
idempotent and easy to update, so drift is recoverable.

### D-011 · Pricing worksheet — cost lines + globals, editable in ops (2026-05-19)

**Decision.** Each package's cost-plus inputs are stored as
`package_cost_lines` (one row per worksheet line item — time or hard)
resolved against an editable `pricing_globals` rate table. The flat
`time_hours` / `lp_rate` / `hard_cost` columns on `packages` are
removed. Admins edit the worksheet inside ops; the spreadsheet
retires as authoritative once the admin UI ships.

**Rationale.** Dean asked for the spreadsheet's *formulas* — not just
the final price — to live in ops, so a price change flows through to
the calculator and to every sales partner's next quote immediately.
No window where a partner quotes a stale number because pricing moved
and the seed wasn't re-run. The cost-line model also handles mixed
rate roles cleanly (Saga bills LP hours at $75 and second-shooter
hours at $30 on the same package).

**Trade-off.** A one-time destructive schema change (`--fresh-catalog`).
Safe because the catalog tables were still empty — the seed had never
been run. After this, schema returns to additive-only.

**Supersedes.** The flat-input half of D-007. The "retail stored
separately from methodology" intent survives in spirit: `base_price`
is still a distinct published value, but it's now the *computed*
website price captured at Publish time, not a hand-typed override.

### D-012 · Worksheet edits are draft until Publish (2026-05-19)

**Decision.** Editing a package worksheet or the Rates page changes
local page state only. Nothing reaches the database — and therefore
nothing reaches the calculator or sales partners — until the admin
hits **Publish**. Attempting to leave a page with unpublished changes
raises a modal with three choices: **Stay** (keep editing), **Reset**
(discard the draft, revert to the DB state), **Publish** (commit,
then leave).

**Rationale.** Dean wants to see the impact of a pricing adjustment —
"how much difference would this make?" — without committing it. The
draft gate makes the worksheet a safe experimentation surface. The
DB always holds the published truth; the page holds the experiment.

**Trade-off.** Requires client-side navigation interception (a
`beforeunload` guard for tab-close plus an in-app nav guard). Modest
extra UI work; worth it for the "no surprise price changes" guarantee.

### D-010 · Team Day stays as setup + per-person, not flat (2026-05-19)

**Decision.** Team Day is modeled as a setup-only base package
(`base_price = $600`) plus a per-person headshot addon
(`$80/person`), even though the master spreadsheet now flat-prices a
12-person Team Day at $1,600.

**Rationale.** The customer-facing math from CLAUDE.md §4 and the
basic-pricing wall card is "$600 setup + $70-90 per person," which
gives the client transparent headcount-driven pricing. A 6-person
team and a 20-person team shouldn't pay the same. The spreadsheet's
flat $1,600 is a 12-person snapshot, not the pricing model itself.

**Trade-off.** The methodology-vs-retail report will show a confusing
spread on Team Day because the math number reflects "full 12-person
day" while `base_price` is setup-only. Worth a note in the seed
report so the spread isn't misread.

**Resolved by D-013.** Corporate headshots left the worksheet model
entirely. Team Day is now a parametric formula — base + per-person +
per-person featured, with volume discounts. The setup+per-person
intent of D-010 is fully realized there.

### D-013 · Corporate headshots run on a parametric formula (2026-05-19)

**Decision.** Corporate headshots (Single Executive, Team Day) are
removed from the cost-line worksheet entirely. They price on a small
parametric formula whose inputs live in a `corporate_pricing` key/value
table, edited on a dedicated `/corporate` page:

- **Single Executive** — flat: `$670` standard, `$920` featured.
- **Team Day** — `base + (standard_count × per_person × (1 − vol))
  + (featured_count × featured_per_person × (1 − vol))`, where `base`
  is `$600` or `$300` with the first-time/promo toggle.

The volume discount (5% at 15+, 15% at 30+) is evaluated **per rate
type against that type's own headcount** — 15 standard headshots
discount the standard rate; the featured rate is discounted only if
15+ people also take featured. The two are independent.

**Rationale.** Corporate's economics aren't a labor breakdown — they're
"a base plus a per-head rate." Forcing it through the cost-line
worksheet would be modeling the wrong thing. A dedicated formula is
simpler to reason about and matches how Dean actually quotes a team.
Corporate is also deliberately priced to market (low-mid of the DFW
high-end range) while the portfolio builds — a parametric model makes
a market-wide reprice a two-field edit.

**Consequences.** `corp-single` and `corp-team-day` are no longer
`packages` rows. The three corporate add-ons (Featured upgrade,
per-person, Featured-for-principal) are absorbed into the formula and
dropped from the addon catalog. Catalog is now 5 worksheet packages +
8 addons + the corporate formula. A corporate quote stores
`package_id = NULL` and its detail in `quotes.package_snapshot`.

**Single Executive correction.** The earlier $500 figure was a
mistake; standard is $670, featured $920.

### D-014 · Top role renamed `admin` → `super_admin` (2026-05-19)

**Decision.** The role set is `super_admin | partner`. All pricing
config — the Rates page, package worksheets, the corporate formula —
is super-admin-only. `dean@sharpsightedstudio.com` is the bootstrap
super-admin and can elevate others.

**Rationale.** Dean asked for pricing surfaces to be locked to a
clearly-named top role. Two roles is enough for the foreseeable team;
a middle "admin" tier had no described job, so it wasn't built.

**Migration.** `schema.sql` carries an idempotent `DO` block that
renames any existing `admin` row to `super_admin` and swaps the
`ops_profiles` role CHECK constraint. Safe on both fresh and existing
databases; runs on every `db:migrate`.

### D-015 · Ops is a sales pipeline + light CRM, not just a calculator (2026-05-21)

**Decision.** Ops's job is to run the whole sales motion: research real
estate agents, score them, work the qualified ones through a contact
cycle, sign them, and keep a light client record. Pricing is one tool
*inside* a client page, not the center of the app. Explicitly **not** a
Jira/Monday clone — no kanban builder, no custom fields, no automation
editor. Build order: finish the calculator (Phase A) → CRM pipeline
pages (Phase B) → super-admin editors (Phase C).

**Rationale.** The original scope under-described the app. Dean's actual
need is a tracker shaped to his specific business. The "teach by doing"
onboarding thesis only works if the pipeline the partners operate is
the product itself.

### D-016 · One prospect record, lifecycle stages (2026-05-21)

**Decision.** A prospect is a single `prospects` row that moves through
stages: `researching → qualified → contacting → responded → signed →
client` (plus `passed` / `dormant`). The research page and the client
page are the same record at different stages — no separate prospect vs.
client tables to keep in sync. Each row has an `owner_id` (the rep who
researched it) and a `signed_by_id` (who closed it).

**Rationale.** A prospect and a client are the same entity over time.
Splitting them invites divergence; a stage enum doesn't.

### D-017 · Rank scoring is editable config (2026-05-21)

**Decision.** The research page scores agents 0–10. The scoring fields
and weights live in a `rank_factors` config table, super-admin editable
in ops — the same philosophy as `pricing_globals`. Per-prospect answers
are stored as JSONB on the prospect so adding/retuning a factor never
orphans rows. Bands: **8–10 qualified, 6–7 borderline, ≤5 "Don't
message."** Thresholds are themselves config.

### D-018 · Contact scripts are editable config (2026-05-21)

**Decision.** Outreach scripts live in a `contact_scripts` table, one
per contact stage, with `{{placeholder}}` slots and a
`followup_after_days` interval. Super-admin edits them in ops; reps
always copy-paste the current version. No deploy needed to retune
wording.

### D-019 · Owner-scoped prospect visibility (2026-05-21)

**Decision.** A rep sees only the prospects they own; a super_admin sees
everyone's. Keeps each rep's dashboard and follow-up queue focused on
their own pipeline.

### D-020 · Follow-ups computed on read, no scheduler (2026-05-21)

**Decision.** "Needs follow-up" is computed at query time — the latest
`prospect_contacts` row has no response and is older than that step's
`followup_after_days`. No cron, no background job for v1. A scheduled
email-reminder task can be added later without changing the data model.

**Rationale.** The dashboard already runs a query on every load; folding
the follow-up logic into it is simpler and has no moving parts to break.

### D-021 · Client page embeds the calculator; quotes link to a prospect (2026-05-21)

**Decision.** The client page's "inline calculator" is the real
`/calculator` module embedded, not a link-out. `saveQuote` gained an
optional `prospectId`; a quote built on a client page writes
`quotes.prospect_id` and surfaces in that prospect's quote history.
`CalculatorClient` gained optional `prospectId` / `initialClient` /
`onSaved` props — all backward-compatible, so the standalone
`/calculator` is unchanged.

**Rationale.** One pricing implementation, one source of truth. A
link-out would need the same plumbing anyway; embedding keeps the rep on
the record they're working and the quote attaches itself.

### D-022 · The CRM pipeline is multi-workflow (2026-05-21)

**Decision.** Ops runs five sales workflows — Real Estate Media,
Corporate Headshots, Story Portraits, The Saga, The 10% Rule — each with
its own entry gate, scoring factors, contact scripts, handoff links, and
vocabulary, on shared Research → Tracking → Client machinery. The CRM
config tables and `prospects` are scoped by `workflow_key`; the entry
gate generalizes to an `is_gate` flag on rank factors; prospect identity
generalizes (`agent_name` → `contact_name`, `agency` → `org_name`).

**Rationale and the settled sub-decisions** — the workflow set, the
clean rebuild, the 10% workflow's contribution shape, the owner-scoped
Client List, no Sprout webhook (handoff links resolve as config-backed
`{{placeholders}}` instead), and the display names — are recorded in
PHASE-D-PLAN.md §10.

**Trade-off.** A one-time destructive restructure applied via
`--fresh-crm`; acceptable because the CRM tables held only test data.
The app build is intentionally red across the D1→D6 span.

### D-023 · Sourcing + Qualify naming (2026-05-26)

**Decision.** The new rapid list-intake surface is named **Sourcing**.
The existing `/research` page is renamed to **Qualify**.

**Rationale.** The naming maps to the activity a rep is actually doing
at each step — *sourcing* names from a list, then *qualifying* one
individual deeply. "Research" was overloaded — every CRM uses it for
both, and reps had to mentally translate.

**Trade-off.** Every doc, route, nav item, and `/research` reference
gets a one-time rename. Mechanical; tsc catches misses.

### D-024 · A sourcing row IS a prospect, no new lifecycle stage (2026-05-26)

**Decision.** Each row on the Sourcing table is a `prospects` record at
`lifecycle_stage = 'researching'` from row one. No new pre-prospect
stage; no separate `leads` table.

**Rationale.** One entity, one source of truth. Splitting leads from
prospects invites divergence and double bookkeeping. The lifecycle
already includes `researching` for exactly this state — partially-filled
records the rep is working on.

### D-025 · Phase E schema changes are additive only (2026-05-26)

**Decision.** Phase E adds columns (likely `sides_count`, `gross_volume`,
`market_city`, `source_url`, `sourcing_status`) to `prospects` via an
idempotent migration. No table drops, no column-type changes, no fresh
flag.

**Rationale.** The CRM tables now hold real data — destructive changes
aren't acceptable. The Phase E surface is additive to the existing
prospect model; new columns are enough.

### D-026 · Sourcing tables are per-workflow (2026-05-26)

**Decision.** `/sourcing` is a per-workflow route, mirroring `/qualify`
(and the existing `/research`). Each workflow has its own column set.
Real-estate ships populated at launch; other workflows get column sets
as their sources are identified.

**Rationale.** Different workflows have different intake fields. A
RealTrends row gives sides and volume; a corporate-headshots source
will give firm size and department. Forcing one shared column set
means most columns are blank for most workflows, which defeats the
"rapid intake" point.

### D-027 · Sourcing carries hard qualifiers + intake fields only (2026-05-26)

**Decision.** The Sourcing table holds the high-point hard qualifiers
plus the data that's available during sourcing (name, agency, market,
sides, volume, source URL). Smaller 1- and 2-point supporting items —
observations like "current listing photos are weak" — stay on the
Qualify page where they belong.

**Rationale.** The point of Sourcing is rapid triage from thin data.
Observation-driven fields require the rep to actually look at the
prospect's work; that's research, not intake. Mixing the two would
slow the table down and blur its purpose.

### D-028 · Three-state manual toggle + advisory pre-score (2026-05-26)

**Decision.** Each Sourcing row has a manual three-state toggle
(Qualify / Pass / Undecided) and a calculated **pre-score badge**
alongside it. The pre-score is derived on read from whichever hard
qualifiers are filled in; the toggle is the rep's call.

**Rationale.** Auto-determining the toggle was considered and rejected.
The most predictive qualifier — *photo need* — can't be filled in from
a public list, so an auto-rule would only fire on the easy cases and
stay silent in the middle (the noise-to-signal trap of auto-scoring).
Override fatigue is a known anti-pattern; once reps disagree with the
system a few times, they stop reading the badge. Salesforce / HubSpot
ship lead scoring exactly this way — score as hint, status as manual.

**Trade-off.** The rep clicks twice per row instead of once (toggle +
read the badge). Acceptable; the badge is a guide, not a gate.

### D-029 · Phase E content is Claude-drafted, Dean-revised (2026-05-26)

**Decision.** v1 content for the help modals and tutorial pages is
drafted by Claude based on the schema, the existing pages, and the
brand bible. Dean revises before launch.

**Rationale.** A blank-page edit pass takes longer than a revision
pass, and Claude has enough context to draft something useful. Dean's
voice gets imprinted in the revision step.

### D-030 · Bulk paste on Sourcing is deferred to v2 (2026-05-26)

**Decision.** v1 Sourcing is one-row-at-a-time entry only. No
clipboard-paste of a spreadsheet block.

**Rationale.** Dean wants reps to add prospects intentionally — one
selected name at a time — not by dumping a list. The intentionality is
part of the workflow's quality control. Clipboard paste can be added
later without changing the data model if reps end up needing it after
real use.

### D-031 · Wednesday launch slips for Phase E (2026-05-26)

**Decision.** The Wednesday 2026-05-27 launch defers. Phase E ships as
a unit; partial slices weren't worth the disruption. New target is
"when it's done."

**Rationale.** The Sourcing surface is meaningful enough that launching
the old `/research` flow alongside the new one would confuse partners
and leak technical debt forward. Better to slip a few days and ship
the restructure clean.

### D-034 · Sourcing decides "worth qualifying," not "qualified" (2026-05-26)

**Decision.** The Sourcing positive toggle (formerly "Qualify") is now
"Pursue." It records that the rep wants to take this prospect into the
qualifying phase, but **does not** promote the lifecycle stage to
`qualified`. The only path to `stage = qualified` is through the
Qualify page (`/qualify` form or `/qualify/[id]`), via its
`Qualify / Undecided / Reject` toggle. Reject means the same thing
from either side and moves stage to `rejected`.

**Rationale.** Dean caught a conflation: the Sourcing toggle was named
the same as the Qualify decision and produced the same lifecycle
outcome. That's two paths to the same destination, only one of which
involved any qualifying work. Splitting the two restores the mental
model — Sourcing is triage, Qualify is qualification.

**Schema.** The `sourcing_status` column now allows four values:
`undecided | pursue | qualify | reject`. Sourcing UI exposes
Pursue/Undecided/Reject; Qualify UI exposes Qualify/Undecided/Reject.
The same column carries both phases' calls. The override-with-reason
rule treats `pursue` and `qualify` as equivalently "positive" for
band-disagreement checks.

**Lifecycle stage `passed` renamed to `rejected`** in the same migration
batch — same ambiguity as the earlier `pass` → `reject` Sourcing
rename. The CHECK constraint is rebuilt; existing rows are migrated;
all UI labels swept. (Logged as part of this decision rather than a
separate D-entry — they're the same conceptual cleanup.)

### D-033 · Qualify is one surface, two modes (2026-05-26)

**Decision.** `/qualify` and `/qualify/[id]` render the same shared
`QualifyForm` component. **Create mode** (no `id`) is the entry form
for an agent the rep found through non-Sourcing research — identity
is editable, no breadcrumb. **Edit mode** (with `id`) is the deep
qualifying surface for an existing prospect — identity is read-only
with a link to the full record, breadcrumb back to `/sourcing`,
otherwise identical inputs. Both modes save through
`upsertSourcingRow`. After a successful create the form redirects
to `/qualify/[new-id]` so the rep stays on Qualify with the new
record loaded.

**Rationale.** Phase E's P4.6 shipped two visibly different pages
for what is conceptually one job — qualifying an in-progress
profile. Dean called this out (the misalignment after P6/P7): "My
intent for the qualifier was for this to be a stage that is
carrying the prospect's info from sourcing to qualify." The
unification makes Qualify feel like one surface that adapts to
whether a prospect is in the URL.

**Consequences.**
- The old `/qualify/[id]/QualifyDetailClient.tsx` and
  `/qualify/actions.ts` (with `createProspect`) are retired. One
  server action — `upsertSourcingRow` — handles create and update.
- The list of recent prospects on `/qualify` now links to
  `/qualify/[id]` (the deep work) rather than `/prospects/[id]`
  (the mini-CRM) — keeps the rep in the qualifying flow.
- D-024 stands. A Sourcing row IS a prospect from row one. "In-
  progress profile" describes the lifecycle stage (`researching`),
  not table membership.

### D-032 · Real-estate scoring math overhaul (2026-05-26)

**Decision.** Three changes to the real-estate workflow's rank scoring:

1. **Gates contribute to the score.** `has_target_listing` and
   `has_photo_need` each carry weight 1. They're still gates — entry
   blocked by `gatesPassed()` if either is false — but they now also
   add to the 0–10 number.
2. **`annual_volume` runs on a piecewise curve** instead of linear:
   0 listings → 0 pts, 10 listings → 2.0 pts (knee), 30 listings →
   3.0 pts (cap). Implemented as a small `PIECEWISE_CURVES` map in
   `lib/prospects.ts` keyed by factor key. Other workflows still
   default to linear.
3. **`branded_email` is dropped** as a redundant signal — anyone with
   `pro_website` almost certainly has a branded email. Deactivated in
   the DB via an idempotent `schema.sql` migration.

**Final weights (real_estate):**

| Factor | Weight | Notes |
| --- | --- | --- |
| `has_target_listing` (gate) | 1 | now contributes |
| `has_photo_need` (gate) | 1 | now contributes |
| `annual_volume` | 3 | piecewise 0→0, 10→2, 30→3 |
| `weak_current_photos` | 2 | unchanged |
| `active_social` | 1 | down from 2 |
| `pro_website` | 1 | unchanged |
| `uses_video` | 1 | unchanged |
| ~~`branded_email`~~ | ~~1~~ | dropped |
| **Total** | **10** | |

Spot-checks: gates only = 2.0; gates + 10 listings = 4.0; gates + 30
listings = 5.0; all factors maxed = 10.0.

**Rationale.** Dean's pipeline analysis — agents with 10-12 listings
a year (≈ one per month) are at a "growth phase where a retainer
gives them the boost." The old linear curve undersold that range
(10/24 × 3 = 1.25 pts). The new piecewise + anchored gates produce a
"4 baseline for an in-range agent, climbing toward 10 with the
supporting factors."

**Trade-off.** The piecewise curve is hardcoded for `annual_volume`
only. If another factor ever needs a curve we add a
`score_breakpoints` JSONB column to `rank_factors`; not worth the
schema overhead yet. The migration in `schema.sql` is conditional on
the old default values so a rep who's already used `/rank-factors` to
customize isn't clobbered.

### V2 batch (D-035 → D-067, 2026-05-28)

V2 was a polish-and-fit pass on the surfaces V1 had exercised in real
use. The decisions below carry the full reasoning in `V2-PLAN.md §3`
and the implementation detail in `CHANGELOG.md`'s V2 section. Logged
here as one-liners so the §10 record stays scannable.

D-052 intentionally skipped — the workflow-color decision condensed
into a single D-053 rather than splitting into two, but the numbering
stays aligned with the V2-PLAN list.

### D-035 · Sourcing add-prospect sorts to top by created_at (2026-05-28)

**Decision.** `SourcingRow` carries `createdAt` (ISO timestamp); the
default sort is `createdAt` desc. A newly-saved row lands on top
regardless of how the rep had the table sorted before — independent
of any other column toggle. Replaces V1's fallback that sorted by
`id` (UUID-lex order isn't time-based).

### D-036 · Sortable column header ↕ indicator (2026-05-28)

**Decision.** Every sortable Sourcing header renders a glyph: ↑/↓ on
the active column, ↕ at 40% opacity on inactive sortable columns. The
click-to-sort affordance reads at a glance.

### D-037 · Sourcing checkboxes + status always interactive (2026-05-28)

**Decision.** Hard-qualifier checkboxes and the Pursue/Undecided/Reject
toggle are interactive at all times on Sourcing rows — display mode
and edit mode both. Clicking commits immediately via `upsertSourcingRow`
with a minimal patch. Edit mode (now triggered by row body click, see
D-039 superseded by F2.8.1) only unlocks the other cells.

### D-038 · Status column widens to fit toggle (2026-05-28)

**Decision.** Sourcing's `sourcingStatus` column went 150 → 200px; the
status toggle's padding tightened. Pursue / — / Reject fit cleanly in
the always-visible toggle, never clipped under any state.

### D-039 · Row body navigation, superseded by F2.8.1 click-to-edit (2026-05-28)

**Decision.** Originally: Sourcing row body click → `/qualify/[id]`,
pencil → edit in place. Dean walked it and reversed: row body click
returns to edit-in-place (spreadsheet expectation); a new **leftmost
Qualify column** holds a `→` button per row that navigates to
`/qualify/[id]`; the Name cell is a second navigation exception
(dotted-underline accent link). The pencil comes out of the row.

**Rationale.** Click-to-edit-on-row matches the spreadsheet mental
model; the explicit Qualify button removes ambiguity about what
clicking the row actually does.

### D-040 · Custom CSS hover tooltips (2026-05-28)

**Decision.** Attribute-driven, CSS-only tooltips via `data-tooltip="…"`
on any element. Instant on hover (no fade/delay). Positions above by
default; `data-tooltip-pos="below"` for top-of-viewport elements.

**Restyle (F2.8.2).** Initial tooltip read as a small button (border +
shadow + surface-3 background). Lightened to a flat cursor-hint: no
shadow, no border, smaller font, `surface-tool-2` background.

### D-041 · Sourcing help boxes (batch-oriented content) (2026-05-28)

**Decision.** Sourcing gets help boxes on the add-prospect form (per
field) and on the table headers (per column), with batch-sourcing
content that's a different angle from V1's qualify-time help. HelpBox
gains a `mode: 'qualify' | 'sourcing'` parameter; the registry keys
sourcing-time entries as `sourcing.{workflow}.{factor}`.

**Plus F2.8.4 inline:** a "Where to start" strip between the workflow
tabs and the form, opening a three-step onboarding guide modal.

### D-042 · One-click Qualify button at score ≥ 7 (2026-05-28)

**Decision.** The score panel on `/qualify` shows a prominent "Qualify
this prospect" button whenever every gate is clear, score ≥ 7, and
the rep hasn't already set `status='qualify'`. Clicking commits
`sourcing_status='qualify'` (advances stage to `qualified`). The
three-button toggle stays for explicit choices.

### D-043 · Qualify list filter (default pursue + undecided; toggle pursue-only) (2026-05-28)

**Decision.** The "Your prospects" list on `/qualify` hides
`sourcing_status='qualify'` (already in pipeline) and `'reject'`
(Sourcing said no) by default. A "Pursued only" toggle narrows to
pursue alone. Hidden-count badge shows what's suppressed.

**F7-b inline:** the list became cross-workflow with the
currently-selected workflow's rows floated to the top — Dean called
out the scroll-pick-scroll thrash while walking F7.

### D-044 · Qualify direct-entry defaults to pursue (2026-05-28)

**Decision.** Direct entry on `/qualify` defaults `sourcing_status =
'pursue'` (was `'undecided'`). A rep adding a prospect straight on
Qualify is there because they want to qualify, so the row appears in
the default Qualify list immediately. Toggle still overrides.

### D-045 · Override-with-reason skips when no qualifiers filled (2026-05-28)

**Decision.** The override-with-reason rule (status disagrees with band
→ ≥20-char reason required) carves out an exception: when no qualifier
inputs are filled at all, `band='reject'` (score 0) isn't meaningful
and no reason is required. Re-engages the moment any qualifier is set.
`needsOverride` consolidated into `lib/sourcing.ts` as the single
source of truth — applied client + server.

### D-046 · Tracking → Contact app-wide rename (2026-05-28)

**Decision.** Folder `src/app/tracking/` → `src/app/contact/`;
`TrackingClient` → `ContactClient`; `TrackingWorkflow` →
`ContactWorkflow`; page H1 + `metadata.title` flip; every URL
reference (Sidebar, Dashboard, today digest, tutorials) updated.

**Out of scope (intentional).** `src/lib/tracking.ts` keeps its
filename, and in-lib types (`TrackingCard`, `TrackingStatus`) stay
as-is. The V2-PLAN wording was "folder rename + URL sweep"; a lib-side
rename can land as a small follow-up.

### D-047 · Email first-touch wording overhaul (2026-05-28)

**Decision.** The real-estate first-touch sales-pitch paragraph swaps
"I shoot real estate media in the 121 corridor — …" for **"Sharp
Sighted Media shoots real estate media in the 121 corridor, from
Allen to Southlake. The base package delivers stills, aerial, floor
plan, twilight, and a vertical reel, all delivered within 24 hours.
One shoot, five deliverables, MLS-ready."** Brand-agnostic phrasing
since reps send it.

### D-048 · Standard signature block on every script (2026-05-28)

**Decision.** Every script across every workflow closes with:

```
Regards,
{{rep_name}} • Sharp Sighted Branch
https://sharpsighted.branch

Stay Sharp. Stay Seen. Stay Human.
```

Tagline is the absolute last line. Branch per workflow: `real_estate`
→ Media, `corporate` / `story_portraits` / `saga` → Photos,
`ten_percent` → Studio. Updates land in `db-seed.mjs` and via an
idempotent `REPLACE()` migration in `schema.sql` (preserves manual
edits).

### D-049 · Cycle-step tabs all navigable with inactive-step badges (2026-05-28)

**Decision.** Contact's cycle pills (First touch / Follow-up 1 /
Follow-up 2 / Final touch) are real buttons. Clicking a past step
shows the message as it actually went out (filled placeholders) +
green "Already sent · {date}" badge. Clicking a future step shows the
template + yellow "Send {prevLabel} first" badge. The current step
keeps the live composer.

**Schema.** Required surfacing `filled_subject` + `filled_body` from
`prospect_contacts` through `ContactLog` and the page query — they
were in the DB but not in the client payload until now.

### D-050 · 20s undo gains "Commit now" button (2026-05-28)

**Decision.** `UndoProvider` gains a `commitNow(id)` callback that
cancels the wait timer and fires the action immediately, reusing the
existing commit path. Toast renders a btn-primary "Commit now" next to
Undo. Lifecycle moves still get the safety window by default; the rep
is never blocked when they're sure.

### D-051 · Contact card workflow-color + urgency dot (2026-05-28)

**Decision.** Contact card list redesigned:
- 4px workflow-accent left-stripe + 10%-tinted background.
- Left-side urgency dot:
  - **green** (`now`): reply waiting / first touch ready / due ≤ 24h
  - **yellow** (`soon`): waiting, due within next 24h
  - **red** (`overdue`): > 24h past due
  - **faint** (`idle`): waiting > 1 day / cycle done

Urgency is computed server-side in `computeCycle` via a new
`CycleUrgency` type. Surfaced via `CycleState.urgency` and
`TrackingCard.urgency`.

### D-053 · App-wide workflow color palette (2026-05-28)

**Decision.** Five workflow accent hex values, applied everywhere a
workflow is named or distinguished:

| Workflow | Hex | Note |
| --- | --- | --- |
| RE Media | `#c9922a` | brand gold — Sharp pillar's Media accent |
| Corp HS | `#8b5cf6` | violet |
| Story Portraits | `#38bdf8` | brand cyan — the Photos pillar (Seen) |
| The Saga | `#dc2626` | dramatic red |
| The 10% Rule | `#ec4899` | fuchsia |

Updates: `workflows.accent` seed values; idempotent
`schema.sql` migration block guarded by the V1 default hex on each
row (preserves manual edits). Every consumer reads
`workflow.accent` from the DB, so the colors propagate to every
surface automatically.

### D-054 · Clients cards use workflow color (2026-05-28)

**Decision.** Every row on `/clients` carries the workflow accent —
4px left-stripe + 5% tinted background. Same dialect as the Contact
card list so the surfaces read as a family.

### D-055 · Rejected = fade + REJECTED badge (workflow color preserved) (2026-05-28)

**Decision.** Rows where `stage='rejected'` render at 55% opacity with
a small red "Rejected" corner badge (top-right). `stage='dormant'` gets
the same fade with a muted "Dormant" badge. The workflow accent stays
visible through the fade so a rejected Saga still reads as a Saga, not
a generic inactive row.

### D-056 · "Show inactive" toggle on Clients (default off) (2026-05-28)

**Decision.** New checkbox in the `/clients` filter row. Default off —
`rejected` + `dormant` are filtered out so the working list stays
focused on live prospects. Bypassed when the rep picks `rejected` or
`dormant` explicitly from the stage dropdown. When off, the label
reads "Show inactive (N hidden)."

### D-057 · Duplicate-check on add-prospect, within owner only (2026-05-28)

**Decision.** On create, the server holds the upsert when it spots a
name match (`lower(contact_name)`) within the rep's own prospects
(owner-scoped, preserves D-019). Returns `{ ok: false, duplicates: […] }`
with the matched prospects' workflow + stage. The client surfaces a
non-blocking warning panel (`src/components/DuplicateWarning.tsx`,
shared by Sourcing and Qualify); the rep either backs out (Cancel) or
re-submits with `acknowledgeDuplicates: true` (Continue anyway).

### D-058 · Inline markdown + heading block type in HelpBlock (2026-05-28)

**Decision.** Two additions to the shared `HelpBlock` renderer:

1. **`{ kind: 'heading'; text: string; level?: 2 | 3 }`** — short
   Playfair h3/h4 inside a section's body. Authors use this to break
   long sections into named beats without a new `HelpSection`.
2. **Inline markdown** in paragraph / list / steps / callout text:
   `**bold**` → `<strong>`; `[label](url)` → external link with
   dotted-accent underline. Tiny no-library parser walks the input
   left-to-right.

Every existing `HelpBlockList` consumer (HelpBox modals + the
tutorial detail page) picks both up for free.

### D-059 · Real-estate tutorial revised with mixed blocks (2026-05-28)

**Decision.** The real-estate walkthrough at `/tutorials/real_estate`
revised with the F9 block variety — heading sub-beats inside each
step ("Working a row, top to bottom," "The 20-second window," etc.),
bold on action verbs + threshold numbers, inline links to every
ops route. Reads more like a manual, less like a wall of text. Also
updated to match the V2 surface (row-click-to-edit, navigable cycle
tabs, Commit-now button, urgency-dot legend, one-click Qualify).

### D-060 · Corp HS tutorial drafted; Story / Saga / 10% backlog (2026-05-28)

**Decision.** New `/tutorials/corporate` entry alongside real-estate.
Six sections mirroring real-estate's structure (overview → source →
qualify → contact → email → next). Source angle is non-RealTrends
(LinkedIn, Dallas Business Journal, walking-radius, referrals). Branch
attribution reads "Sharp Sighted Photos" throughout. Closes by
explicitly flagging Story Portraits, Saga, and 10% walkthroughs as
**post-V2 backlog**.

### D-061 · Mobile pass: Dashboard + Clients only (2026-05-28)

**Decision.** Responsive CSS on `/` (Dashboard) and `/clients` only.
Other surfaces stay desktop-optimized by design. Goal: a rep on their
phone can answer "do I need to open a laptop today?"; anything that
requires real work (Sourcing batch entry, Qualify deep work, Contact
cycle messaging) stays on the laptop.

**Implementation.** Three opt-in CSS utility classes
(`.list-row-responsive`, `.list-row-trail`,
`.filter-bar-responsive`) applied to the two surfaces. Plus tighter
`.app-shell-main` padding at narrow widths and a 44px min-height
floor on buttons inside the mobile-aware regions.

### D-062 · Dashboard work happens last (2026-05-28)

**Decision.** The Dashboard rebuild (F12) lands AFTER the source
surfaces (Sourcing, Qualify, Contact, Clients) have been redesigned.
Aggregates can only read right if the things being aggregated are
correct. No repetition with the source surfaces — the Dashboard's job
is the cross-surface overview.

### D-063 · `/today` merges into Dashboard as a panel (2026-05-28)

**Decision.** The standalone `/today` route is removed; its digest
panels (replies waiting, follow-ups due, close-outs, all-clear, in-
motion) fold into the Dashboard at `/`. The digest computation in
`lib/digest.ts` is unchanged — it still powers both the page and the
Resend morning-email cron at `/api/cron/digest`, so page + email
always agree. URL labels in the morning email flip from "Open Today" →
"Open Dashboard"; the schema's `ops_profiles.digest_email` comment is
updated to match.

### D-064 · Second Neon project for testing DB (2026-05-28)

**Decision.** Local development on the `v2` branch points at a second
Neon project, separate from production. Same migration scripts work
on both. Documented in `README.md` "Testing database (V2 onward)";
one-time Dean task per stand-up.

### D-065 · Print packages → v2.1 (2026-05-28)

**Decision.** Story Portraits and Saga print packages — Gift, Fine
Art, Heirloom, framed sets, museum editions — are deferred to **v2.1**,
landing as the first thing after V2 merges. They're calculator and
quote-builder work; the V2 scope is operational polish on what V1
already shipped.

### D-066 · Sidebar sectioned layout + display-label renames (2026-05-28)

**Decision.** Sidebar restructured into four sections separated by
section headers with top-border rules:

- **Dashboard** (single link, no header)
- **TOOLS** — Quote Calculator (renamed from Calculator), Tutorials
- **SALES** — Sourcing, Qualify, Contact, Client List (renamed from
  Clients)
- **PRICING & ADMIN** — super-admin only (Rates & Globals, Packages,
  Corporate, Rank Factors, Scripts, Team)

Renames are display labels only — URLs stay `/calculator` and
`/clients`; routes don't move.

### D-067 · Sidebar sticky positioning + internal scroll with pinned bottom controls (2026-05-28)

**Decision.** The sidebar uses `position: sticky; top: 0; height:
100vh; align-self: start` via a new `.app-shell-aside` class. The
page scrolls normally (so the footer follows content), but the aside
stays pinned at the top of the viewport — wordmark, scrollable nav,
and the theme toggle + sign-out at the bottom are always visible.

**Implementation note.** A first attempt used
`.app-shell { height: 100vh; overflow: hidden }` to lock the whole
shell. The inner main+footer column wasn't height-constrained, so the
page scrolled anyway and the toggle/sign-out dropped below the fold.
Sticky-aside also avoids the trap where shell-level `overflow: hidden`
silently disables `position: sticky` for every nested side panel
(calculator summary, qualify score, tracking list).

### D-068 · Reports `/reports` route is admin-only in v1 (2026-05-28)

**Decision.** The Phase R reports surface is gated to admin users
only — same pattern as `/team` and `/rates`. Reps do not see
analytics in v1.

**Rationale.** Dean is the only admin and the only person making
the three decisions the cards answer ("Is my pipeline healthy?",
"Which workflow do I push?", "Which rep deserves my time?"). Adding
rep-scoped auth doubles the route surface for a feature that isn't
yet validated. The snapshot schema already supports rep-scoping via
`rep_id`, so a future `/reports/me` view is one phase of work when
Dean wants it. Captured in REPORTS-PLAN.md §9.

### D-069 · Pipeline Velocity is the hero card (2026-05-28)

**Decision.** Pipeline Velocity sits at the top of `/reports` —
full width, big number, sparkline trend, vs.-prior-period arrow.
The other five cards stack below in a two-column grid.

**Formula.** `velocity_per_day = (active_qualified_prospects ×
workflow_close_rate × workflow_avg_value) ÷ workflow_avg_cycle_days`,
summed across all workflows. Expected dollars per day from the
current pipeline.

**Rationale.** It's the single best 5-second daily check-in
number — it's a leading indicator (moves before revenue moves) and
it survives every shift in mix or volume. The other five cards
answer specific questions; Pipeline Velocity is the "everything is
roughly OK / not OK" gauge.

### D-070 · Snapshot grain — `(date × rep × workflow × stage)` (2026-05-28)

**Decision.** The `daily_metric_snapshot` table stores one row per
`(snapshot_date, rep_id, workflow_key, stage)` tuple. This is the
finest grain that powers every Phase R card without storing
per-prospect detail in the snapshot itself.

**Capacity.** Worst case ~5 reps × 5 workflows × 8 stages × 365
days = ~73K rows/year. Trivial for Neon's free tier and indexable
for sub-millisecond date-range scans.

**Rationale.** Per-prospect detail stays in the live event tables
(`prospect_stage_events`, `prospect_contacts`); the snapshot is
strictly an aggregate. This keeps the snapshot row count bounded
even as the prospect table grows unbounded, and it leaves room to
add fields without restructuring the key.

### D-071 · Separate snapshot cron, runs at midnight CT (2026-05-28)

**Decision.** The snapshot rollup runs in a **new** cron route at
05:00 UTC (00:00 CT) — not chained off the existing 13:00 UTC
digest cron. New entry in `vercel.json`, same `CRON_SECRET` gate
as the digest route.

**Rationale.** Running the rollup at the end of the business day
gives the cleanest "yesterday is closed" semantics. By the time
the digest cron fires 8 hours later at 8 AM CT, yesterday's
snapshot has been live and any rollup failure has been
alert-surfaced. Chaining the two responsibilities into one handler
was considered and rejected because it muddies failure modes — a
failed rollup would silently break the digest's "yesterday" block.

### D-072 · No third-party analytics tooling (2026-05-28)

**Decision.** Explicitly out of scope: Mixpanel, PostHog, Segment,
Plausible, Google Analytics, any external dashboarding or BI tool.
Phase R lives entirely in Postgres + the Ops UI + the existing
Vercel + Resend stack.

**Rationale.** Phase R is meant to answer three recurring
decisions, not build a BI department. A third-party tool would
lock in a learning curve, monthly cost, and a privacy footprint
for a feature that needs to be a 5-second daily check-in, not a
slice-and-dice exploration. Reconsider only if usage outgrows the
snapshot model.

### D-073 · Vanity metrics explicitly cut (2026-05-28)

**Decision.** Out of scope for Phase R: email opens, click counts,
page views, time-on-site, A/B test arms, prospect view duration.

**Rationale.** Vanity numbers that don't predict closes, and they
can't be captured without a third-party SDK we've already ruled
out (D-072). The leading indicators that *do* predict closes —
reply rate, time-to-second-touch, score-to-close correlation — are
all computable from already-captured events
(`prospect_contacts`, `prospect_stage_events`, `prospects.rank_score`).

### D-074 · Digest email extension (R6) is the only deferrable Phase R step (2026-05-28)

**Decision.** R1–R5 (schema, rollup, cron, page, six cards) ship
as a unit. **R6** — appending a "Yesterday's snapshot" three-card
block to the existing 6am Resend digest for Dean — is explicitly
**deferrable**. If the R1–R5 build runs long, R6 rolls forward to
a later phase without blocking the rest of Phase R from shipping.

**Rationale.** The `/reports` page is the primary surface; the
email block is a convenience. The block can land any time after
the snapshot table is populated since it reads from the same
source.

---

*Stay Sharp. Stay Seen. Stay Human.*
