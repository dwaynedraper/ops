# Sharp Sighted Ops — Master Build Plan

> The single source of truth for what we're building, why, and in what
> order. Updated as work progresses. See `CHANGELOG.md` for the
> dated history. README.md is the local-dev quickstart; this is the
> full operating reference.

**Last updated:** 2026-05-19 · Week 1 complete · Week 2 starting (Day 8).

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

**Admin (Dean).** Sees costs, margins, internal notes, the full
methodology breakdown. Can manage the package catalog and the partner
roster. There is exactly one admin at launch.

**Partner (Kelsey-shaped role).** Sees client-facing prices only — no
costs, no margins, no internal notes. Builds quotes for their own
prospects. Cannot edit the catalog. Bootstrap-allowlisted by email; an
admin promotes someone to admin manually if ever needed.

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
the bootstrap admin (the first email in `ALLOWED_EMAILS`) becomes
`role='admin'`; everyone else starts as `role='partner'`. Promotion to
admin is a manual SQL update for v1; an admin UI lands post-MVP if it's
ever needed.

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
`createUser` event upserts `ops_profiles` row with `role='admin'` for
the bootstrap email, `role='partner'` for everyone else.

**Files added.** `src/auth.ts`, `src/proxy.ts`,
`src/lib/email-allowlist.ts`, `src/lib/magic-link-email.ts`,
`src/app/api/auth/[...nextauth]/route.ts`, `src/app/signin/page.tsx`,
`src/app/signin/verify-request/page.tsx`,
`src/app/signin/error/page.tsx`.

**Verified.** End-to-end magic-link sign-in works locally. Dashboard
recognizes the bootstrap admin and renders the admin sidebar section.

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

#### Day 9-10 — Seed catalog

Run the seed against the live Neon DB. Walk through every package and
addon by hand, comparing the computed display price to the spreadsheet.
Adjust margin overrides or hard-cost inputs until every number matches.
Build the read-only `/packages` admin page so the catalog can be eyeballed
in the browser.

#### Day 11-13 — Calculator UI

The headline module. New route `/calculator`:

- Branch picker (Portraits / Corporate / Real Estate) at top
- Package cards for the chosen branch, click to select
- Addon checklist (only addons valid for the chosen package + branch)
- Live total panel, sticky on desktop, showing:
  - For admin: cost basis, margin, working price, display price
  - For partner: display price only
- Quote summary panel ready for the "Save quote" mechanic in Week 3

`src/lib/pricing.ts` does the math; the UI is a presentation layer.

#### Day 14 — Role-aware view + polish

Wire `session.user.role` into the calculator surface. Partner view
strips cost / margin / internal notes from every panel. Add the
"What you see" eyebrow on the admin view making it clear they're
looking at the privileged breakdown.

**End-of-week milestone.** Dean can quote any package + add-on combo
in 30 seconds and trust the number.

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
| `ALLOWED_EMAILS`    | `dean@sharpsightedstudio.com,...`                                                      | First entry is the bootstrap admin.                         |

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
v1; promotion is a manual `UPDATE ops_profiles SET role='admin' WHERE
user_id=...;`. If that becomes more than rare, build the UI.

**Open question — sales partner onboarding flow.** The "teach by
doing" thesis says the new partner's first quote should be a *guided*
quote — annotated, with copy explaining each decision. Not in MVP, but
queued for post-MVP §9 below. The shape is fuzzy until a real partner
walks through v1.

---

## 9. Post-MVP roadmap

The MVP gets the calculator and quote library shipped in 30 days. The
following modules are designed but not built yet:

**Prospect Tracker.** The Prospect Playbook as software. Zillow source
→ contact info → outreach template → discovery scheduled → discovery
completed → quote sent → close. Each stage has its own check-the-box
state and follow-up timer. Pipeline view shows everything in one glance.

**Daily Queue.** "What do I do first today?" The ADHD operational need
you keep mentioning. Tasks ranked by impact, day-shape aware (W/Th
shoot days, Fri-Tue W-2 day-job mornings blocked), with Pomodoro-style
timers. Pulls from the prospect tracker's "next action" field and from
any manual entries you add.

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

---

*Stay Sharp. Stay Seen. Stay Human.*
