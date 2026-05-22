# Changelog

All notable changes to Sharp Sighted Ops. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), but
entries are grouped by sprint/day rather than semantic version since
this is an internal app on a 30-day cadence.

The build plan lives in `BUILD-PLAN.md`. The local-dev quickstart
lives in `README.md`. This file is the time-ordered receipt.

---

## [Unreleased]

### Planned next
- Send-to-client flow (email the quote PDF) + final polish
- Optional emailed version of the `/today` digest (opt-in per rep)
- Phase D recommended additions still open: duplicate check on
  Research, cross-sell linked prospects, mobile pass (PHASE-D-PLAN §9)
- Supervisor report: a stage-event log would let `/team` count true
  stage transitions (e.g. research → tracking) rather than the
  first-touch proxy it uses today

---

## 2026-05-22 — Morning digest, supervisor report, brand fonts in the PDF

Three follow-ups after Phase D: the two dead nav items become real
pages, and the quote PDF finally renders in the brand typefaces.

### Added
- `/today` — the morning digest, per rep. A scannable brief built on
  the contact-cycle machinery: replies waiting on you, follow-ups due,
  cycles ready to close, and an ambient line for what's still
  mid-window. Owner-scoped. Replaces the dead `/today` nav stub.
- `/team` — the supervisor report, super_admin only. One card per rep:
  windowed activity (prospects added, started contacting, touches
  logged, replies earned, notes written) over a 7 / 14 / 30-day window,
  plus a current pipeline snapshot. Each card leads with a plain-English
  sentence. Replaces the dead `/team` nav stub.
- `src/fonts/` — Playfair Display + Montserrat `.ttf` files (SIL Open
  Font License), committed to the repo.
- `splitPlaceholders` tests in `tracking.test.ts` (carried from D6).

### Changed
- `QuotePdf.tsx` registers the brand faces via `Font.register` —
  Playfair Display (display/serif, incl. italic) and Montserrat
  (body, 400/700). The built-in Helvetica / Times fallback is retired;
  the PDF now matches the web properties. Closes the parity gap flagged
  in BUILD-PLAN §8 / PHASE-D-PLAN §12.
- `next.config.ts` — `outputFileTracingIncludes` forces `src/fonts`
  into the `/quotes/[id]/pdf` route's serverless bundle (Next's tracer
  can't follow the runtime `process.cwd()` font path).

### Notes
- The `/team` "started contacting" metric uses each prospect's first
  logged touch as the research → tracking signal — the schema has no
  stage-transition log. A small `prospect_stage_events` table would
  make literal transition counts possible; noted for later.
- Windowed metrics rest on real timestamps (`created_at`, `sent_at`,
  `responded_at`); the pipeline snapshot is current, not windowed.

### Verified
- `tsc --noEmit` and `eslint` clean across `src`.

---

## 2026-05-21 — Phase D complete · the multi-workflow pipeline

The single real-estate pipeline becomes five tuned workflows — Real
Estate Media, Corporate Headshots, Story Portraits, The Saga, and The
10% Rule — each with its own entry gate, scoring factors, contact
scripts, handoff links, and vocabulary, all on the shared Research →
Tracking → Client → Dashboard machinery. Full plan in `PHASE-D-PLAN.md`;
decision D-022.

### Added
- `workflows` table — the spine: `workflow_key`, display `name`,
  `branch` (for the client-page calculator default), `contact_noun` /
  `org_noun` vocabulary, `accent`, `active`, `sort_order`.
- `handoff_links` table — per-workflow Sprout / booking links keyed by
  `(workflow_key, link_key)`, referenced from scripts by placeholder.
- `/clients` — the Client List: workflow group-toggle chips, stage
  filter, name/org search; owner-scoped (a rep sees their own,
  super_admin sees all). New "Clients" sidebar item.
- The 10% Rule workflow — contribution, not sales: the §7.1/§7.2 fit
  check is the gate, factors are fit-and-priority signals, and the
  client page suppresses the quote calculator (no dollar figure).
- `splitPlaceholders` in `src/lib/tracking.ts` — splits a script's
  `{{tokens}}` into *human* placeholders (the rep fills) and *config*
  placeholders (a `{{link_key}}` that resolves automatically from
  `handoff_links`). Unit-tested.

### Changed
- `rank_factors`, `rank_config`, `contact_scripts`, and `prospects` are
  all scoped by `workflow_key`. The hard-coded entry-gate booleans
  (`has_target_listing`, `has_photo_need`) are retired for an `is_gate`
  flag on `rank_factors` — a gate is now any per-workflow yes/no factor.
- Prospect identity generalized: `agent_name` → `contact_name`,
  `agency` → `org_name`; the UI labels them per the workflow's nouns.
- Research, Rank Factors, and Scripts editors gained a workflow picker;
  publishes are scoped by `workflow_key`. The Scripts editor also edits
  that workflow's handoff links.
- Tracking and the Dashboard are multi-workflow — a workflow badge and
  filter per prospect, each contact cycle computed against its own
  workflow's scripts, pipeline + target counts grouped by workflow.
- The contact composer resolves config placeholders automatically: a
  `{{booking_link}}` carries the live URL with no input shown — change
  a link once in the Scripts editor and every script using it is
  current (no Sprout webhook — D-5, links only).
- `db:migrate:fresh-crm` drops and recreates the CRM tables; the seed
  loads all five workflows with default factors, scripts, and links.

### Verified
- `tsc --noEmit` and `eslint` clean across `src`. `splitPlaceholders` /
  `fillTemplate` resolution checked against compiled output (vitest
  can't run in the sandbox — arm64 native-binding mismatch).

---

## 2026-05-21 — Quote PDF export + the quote detail page

A saved quote can now be reviewed and turned into a client-facing PDF.

### Added
- `/quotes/[id]` — the quote detail page: client info, line items,
  total, status, and the audit timeline, laid out for a final review
  before the PDF is made. super_admin also sees cost basis + margin.
  Read-only.
- `GET /quotes/[id]/pdf` — renders the quote to a PDF on demand with
  `@react-pdf/renderer` (no storage — built fresh per request) and
  streams it as a download. The detail page's “Create the PDF” button
  is the manual trigger.
- `src/components/QuotePdf.tsx` — the PDF document: a brand-styled
  proposal, prices only (never costs or margins), tagline footer.
- `src/lib/quotes.ts` — `loadQuoteForUser`, the owner / super_admin
  access-checked read path shared by the page and the PDF route.

### Changed
- The calculator's save confirmation now links to the new quote's
  detail page; the client page's quote-history rows link there too.
- The dead `/quotes` sidebar item is removed — quotes are reached from
  the calculator and the client page (no standalone quote list in v1).

### Notes
- The PDF uses `@react-pdf`'s built-in Helvetica / Times faces. The
  brand faces (Playfair, Montserrat) need font files registered — a
  parity gap flagged in BUILD-PLAN §8; a clean swap point is left in
  `QuotePdf.tsx`.

### Verified
- `tsc --noEmit` and `eslint` clean across `src`.

---

## 2026-05-21 — Phase C complete · rank-factor + script editors

The last two super-admin editors ship — Phase C is done. Every pricing
and CRM config surface (rates, package worksheets, the corporate
formula, rank factors, contact scripts) is now editable inside ops,
draft-until-Publish. Editing via the seed script or SQL is retired as
the routine path.

### Added
- `/rank-factors` — the research scoring config: edit each rank factor
  (label, help, kind, weight, full-credit value, active), add factors,
  and set the qualified / borderline / target thresholds. Live
  active-weight readout. RankFactorsClient + actions.
- `/scripts` — the contact-script editor: edit each script (label,
  channel, follow-up interval, subject, body, active), add scripts,
  with detected `{{placeholders}}` surfaced per script. List order is
  cycle order. ScriptsClient + actions.
- Both upsert by key / stage_key — retiring a factor or script uses its
  `active` flag, never a delete, so a key referenced in saved data is
  never orphaned. Sidebar gains Rank Factors + Scripts.

### Verified
- `tsc --noEmit` and `eslint` clean across `src`.

---

## 2026-05-21 — Test suite · contact-cycle + scoring unit tests

### Added
- Vitest as the unit-test runner (matching the `ripped` project) —
  `vitest.config.ts`, plus `test:unit` / `test:unit:watch` scripts.
- `src/lib/tracking.test.ts` — contact-cycle progression: every
  `computeCycle` trigger checked against a synthetic `now` (ready,
  waiting, the day-3 follow-up boundary, overdue, per-step intervals,
  cycle_done) plus `nextScript` ordering.
- `src/lib/prospects.test.ts` — `scoreProspect` 0–10 rank, band
  classification boundaries, `stageForBand`, and the `STAGE_NEXT` map.

### Changed
- `tsconfig.json` excludes `**/*.test.ts` and `vitest.config.ts` from
  the Next build typecheck — vitest type-checks them itself.

### To run
- `npm install` (picks up vitest), then `npm run test:unit`.

---

## 2026-05-21 — Phase C · pricing editors (Rates, Corporate, worksheet)

The three pricing-config screens are now editable inside ops, each
draft-until-Publish (D-012) — editing the seed script or raw SQL is no
longer the only way to move a price. The rank-factor and script editors
are still to come.

### Added
- `src/components/DraftGuard.tsx` — the reusable draft-until-Publish
  safety net: a `beforeunload` guard for tab close, plus a capture-phase
  interceptor on in-app link navigation that raises a Stay / Reset /
  Publish modal. Used by all three pricing editors.
- `/rates` — the `pricing_globals` rate table as an editable form
  (hourly rates and margins), super-admin gated. RatesClient + actions.
- `/corporate` — the `corporate_pricing` parametric formula, grouped
  Single Executive / Team Day / Volume, with a live preview that
  re-prices example teams from the real `pricing.ts` functions.
  CorporateClient + actions.
- `/packages` + `/packages/[slug]` — the per-package cost worksheet:
  editable time and hard-cost lines, rate-role dropdowns, add/remove
  rows, an editable margin, and a live Working / Website price
  recompute. Publish recomputes `base_price` from the lines and
  replaces `package_cost_lines` wholesale in one transaction.

### Verified
- `tsc --noEmit` and `eslint` clean across `src`.

---

## 2026-05-21 — Catalog seed · portrait deliverable counts corrected

### Fixed
- `scripts/db-seed.mjs` — the Verse / Story / Saga package descriptions
  carried the wrong hand-edited photo counts (10 / 25 / ~50). Corrected
  to the approved deliverable spec: **8 / 16 / 35**. Re-run
  `npm run db:seed` to push the corrected descriptions to the database.

### Note
- The same counts were wrong across the marketing collateral in
  `/projects/sharp/Guides` (wall card, print pricing, the Verse and
  Story master sheets, the 90-day plan, the sales brief) and were
  corrected there too — those files live outside the ops repo. The
  pricing master spreadsheet still shows 10 for the Verse; owner to
  correct. PDF exports of the Guides collateral need re-rendering.

---

## 2026-05-21 — Phase B complete · Research, Tracking, Client, Dashboard

The CRM pipeline is now a working surface end to end: research and score
an agent, work the contact cycle, land on their client page to quote and
sign, and see the day's work on the dashboard. Phase B is done.

### Added
- `src/lib/prospects.ts` — prospect scoring core: a 0–10 rank from the
  editable `rank_factors` (bool + number factors), band classification,
  lifecycle-stage labels, and the manual stage-transition map. Pure —
  shared by client and server.
- `src/lib/tracking.ts` — contact-cycle core: `{{placeholder}}` parsing
  and fill, next-script resolution, and the ready / due / waiting /
  replied / cycle_done status from contact history + `followup_after_days`.
  Pure.
- `src/lib/prospect-access.ts` — `loadOwnedProspect`, the shared owner /
  super_admin access check used by every prospect-mutating action (D-019).
- **Research** (`/prospects`) — agent entry, the two-gate entry check,
  live 0–10 scoring from config, owner-scoped prospect list. Server
  route + `createProspect` action + client component.
- **Tracking** (`/tracking`) — the contact-cycle board sorted by urgency;
  per-prospect script composer (placeholder fill, live preview, copy),
  contact history, and app-driven stage moves (`logContact`,
  `markResponded`, `closeOut`). New sidebar item.
- **Client page** (`/prospects/[id]`) — a prospect's mini-CRM: editable
  details, pinned facts + notes timeline, the embedded calculator, quote
  history, and stage actions (`advanceStage`, `signed_by` stamping).
- **Dashboard** (`/`) — rebuilt from the placeholder: follow-ups due
  (computed on read from the contact cycle), the qualified banner, and
  pipeline counts by stage. Owner-scoped.

### Changed
- `saveQuote` takes an optional `prospectId`; `CalculatorClient` takes
  optional `prospectId` / `initialClient` / `onSaved` props so it can be
  embedded on the client page. Backward-compatible — the standalone
  `/calculator` is unchanged. See D-021.
- The Research page is named "Research" consistently — sidebar, page
  header, and every cross-reference (previously a mix of "Prospects"
  and "Research").
- `tracking/actions.ts` refactored onto the shared `loadOwnedProspect`.

### Fixed
- `providers.tsx` — theme provider rewritten on `useSyncExternalStore`
  instead of `useState` + a setState-in-effect, clearing the
  `react-hooks/set-state-in-effect` lint error. `not-found.tsx` —
  unescaped apostrophes escaped.
- `globals.css` — `.app-shell-main` now uses `overflow-x: clip` rather
  than `hidden`, which had silently disabled `position: sticky` for the
  Research and Calculator side panels and the Tracking board.

### Decided
- D-021 — the client page embeds the real calculator; quotes link to a
  prospect via `quotes.prospect_id`.

### Verified
- `tsc --noEmit` and `eslint` clean across `src`; `next build` clean.

---

## 2026-05-21 — Phase B · CRM data layer

Schema and seed for the sales pipeline. Additive — every CREATE is
`IF NOT EXISTS` and the new tables sit alongside the existing catalog,
so `npm run db:migrate` stacks them onto the seeded database with
nothing destructive.

### Added
- `src/lib/db/schema.sql` LAYER 3 — CRM tables: `prospects` (one row
  per agent, lifecycle stage, JSONB rank inputs + cached score, owner
  and signed-by), `rank_factors` + `rank_config` (editable scoring and
  thresholds), `contact_scripts` (editable outreach templates per
  contact stage), `prospect_contacts` (the outreach log, snapshotting
  each sent message), `prospect_notes` (pinned facts + timestamped
  timeline). `quotes` gains a nullable `prospect_id`. `updated_at`
  triggers added for the four mutable new tables.
- `scripts/db-seed.mjs` — seeds 6 rank factors (default weights sum to
  10), 3 rank thresholds (qualified ≥ 8, borderline ≥ 6, target 10),
  and 4 contact scripts (first touch → two follow-ups → final) in Sharp
  Sighted Media voice. Idempotent upserts; counts and a CRM block added
  to the seed report.

### To run
- `npm run db:migrate` then `npm run db:seed` — creates the CRM tables
  and loads the default config. Existing pricing data is untouched.

---

## 2026-05-21 — Phase A · Pricing calculator UI

The first working module. `/calculator` turns the pricing engine into a
surface: pick a branch, pick a package, layer add-ons, watch the total
settle; or run the corporate parametric formula. Save persists the
quote.

### Added
- `src/lib/catalog.ts` — `getCatalog()`, the single read path for the
  pricing system. Returns published packages (with cost basis computed
  live from worksheet cost lines for the admin profit view), applicable
  add-ons, the corporate formula config, and the resolved rate table.
  Also defines the shared quote input types.
- `src/app/calculator/page.tsx` — server route; gates on the session,
  loads the catalog, renders the client component.
- `src/app/calculator/CalculatorClient.tsx` — the interactive surface.
  Branch picker, package cards, add-on checklist, corporate panel
  (Single Executive / Team Day with the first-time promo toggle), a
  client-info block, and a sticky summary that re-prices live. The
  super-admin summary also shows cost basis + margin on package quotes.
- `src/app/calculator/actions.ts` — `saveQuote` server action. The
  client sends a *selection* (package + add-ons, or corporate inputs),
  never prices; the action re-fetches the catalog, recomputes every
  number, and writes the quote, its lines, and a `created` event in one
  transaction.
- `globals.css` — `.calc-layout` / `.calc-summary` for the builder +
  sticky-summary two-column layout.

### Notes
- Pricing math is imported from `src/lib/pricing.ts` on both sides, so
  the live preview and the server-persisted total agree to the cent.
- The quote library (`/quotes` list + detail) is still to come; a saved
  quote currently confirms inline with its quote number.

---

## 2026-05-21 — Week 2 · Reframe: ops is a pipeline + light CRM

Dean re-scoped ops mid-build. It is a sales pipeline plus a light CRM —
research real estate agents, score them, work them through a contact
cycle, sign them, keep a light client record — with pricing as one tool
inside a client page. Not a Jira/Monday clone.

### Decided
- D-015 — ops is a sales pipeline + light CRM, not a calculator with
  extra pages. Build order: calculator (Phase A) → CRM pipeline
  (Phase B) → super-admin editors (Phase C).
- D-016 — one `prospects` record with lifecycle stages; the research
  page and the client page are the same row at different stages.
- D-017 — rank scoring is editable config (`rank_factors` + JSONB
  answers). Bands: 8–10 qualified, 6–7 borderline, ≤5 don't message.
- D-018 — contact scripts are editable config (`contact_scripts`).
- D-019 — owner-scoped prospect visibility; super_admin sees all.
- D-020 — follow-ups computed on read; no scheduler in v1.

### Changed
- `BUILD-PLAN.md` — §5 gains a reframe block (Phases A/B/C) that
  supersedes the day-numbered Week 3–4 plan; §9 marks the Prospect
  Tracker / Daily Queue promoted into the MVP; §10 adds D-015–D-020.

---

## 2026-05-19 — Week 2, Day 10 (cont.) · Corporate formula + super_admin role

Two product decisions from Dean reshaped the catalog before the seed
was ever run.

### Added
- `corporate_pricing` table — key/value config for the corporate
  headshots formula (Single Executive prices, Team Day base + promo,
  per-person rates, volume tiers). Editable by super-admin.
- `src/lib/pricing.ts` — corporate formula: `computeTeamDay()`,
  `singleExecPrice()`, `volumeDiscount()`, `corporatePricingFromRows()`,
  and the `CorporatePricing` / `TeamDayInputs` / `TeamDayResult` types.
  Verified: 12 std = $1,560; 12 std promo = $1,260; 15 std = $1,740
  (5%); 30 std = $2,640 (15%); 15 std + 2 featured = $2,340 (standard
  discounted, featured not — per the per-rate-type rule).

### Changed
- Corporate headshots removed from the cost-line worksheet. `corp-single`
  and `corp-team-day` are no longer `packages` rows; the three corporate
  add-ons are absorbed into the formula and dropped. Catalog is now
  **5 worksheet packages + 8 addons + the corporate formula**.
- `src/lib/db/schema.sql` — `ops_profiles` role CHECK is now
  `super_admin | partner`; added `corporate_pricing` table + its
  `updated_at` trigger; added an idempotent `DO` block that renames any
  existing `admin` row to `super_admin` and swaps the CHECK constraint.
- `src/auth.ts` — session type and `createUser` event use `super_admin`.
- `src/components/Sidebar.tsx` — role type `super_admin | partner`; the
  admin nav section (now "Pricing & Admin") lists Rates, Packages,
  Corporate, Team — all super-admin-gated.
- `scripts/db-seed.mjs` — seeds the 10-row corporate_pricing config;
  drops the 2 corporate packages and 3 corporate addons; the report now
  previews the corporate formula.
- `scripts/db-migrate.mjs` — `corporate_pricing` added to the
  `--fresh-catalog` drop list.

### Decided
- D-013 — corporate headshots run on a parametric formula, not the
  worksheet. Single Executive $670 / $920; Team Day base + per-person +
  per-person-featured with per-rate-type volume discounts. Resolves
  D-010 (the setup + per-person intent is realized here).
- D-014 — top role renamed `admin` → `super_admin`; pricing config is
  super-admin-only.

### Noted (not built)
- V2.0 quote-override-request feature recorded in BUILD-PLAN §9 — a
  partner-initiated price-override form routed to Dean's phones + email.
  Explicitly the last build step.

---

## 2026-05-19 — Week 2, Day 10 · Pricing worksheet data layer

The pricing model moved from flat per-package inputs to an editable
cost-line worksheet. Driven by a product decision: the spreadsheet's
cost-plus *formulas* should live in ops, so a price change flows to
the calculator and every partner's next quote with no re-seed and no
stale-quote window. See decisions D-011 and D-012 in BUILD-PLAN.md.

### Changed
- `src/lib/db/schema.sql` — `packages` lost its flat `time_hours` /
  `lp_rate` / `hard_cost` columns; cost now derives from cost lines.
  Two tables added: `pricing_globals` (editable rate table) and
  `package_cost_lines` (one row per worksheet line — time or hard,
  time lines carry an hours value + a rate_role). New `updated_at`
  trigger on `pricing_globals`.
- `scripts/db-migrate.mjs` — added `--fresh-catalog` flag: drops the
  catalog + quote tables (all empty) before re-applying the schema so
  the structural change lands cleanly. Auth tables untouched.
- `scripts/db-seed.mjs` — rewritten. Seeds 10 pricing globals, 7
  packages with their full cost-line worksheets (mirroring the master
  spreadsheet's package sheets), and 11 addons. Each package's
  `base_price` is now COMPUTED from its cost lines, not hand-typed.
- `src/lib/pricing.ts` — added `priceFromCostLines()`, `resolveRate()`,
  and the `CostLine` / `PricingGlobals` / `WorksheetResult` types.
  Handles mixed rate roles (Saga: LP hours at $75 + 2S hours at $30).
- `package.json` — added `db:migrate:fresh` script.

### Verified
- All 7 packages compute exactly to target: Verse $900, Story $1,700,
  Saga $8,500, Single $500, Team Day $1,600, Essentials $400,
  Retainer $1,900. Math checked standalone before commit.

### Decided
- D-011 — pricing worksheet (cost lines + globals) editable in ops;
  flat package columns removed; supersedes the flat-input half of
  D-007.
- D-012 — worksheet edits are draft until Publish; leaving a dirty
  page raises a Stay / Reset / Publish modal.

### Open before the calculator
- `corp-team-day` computes $1,600 (full 12-person day from the
  spreadsheet) but the customer-facing model is $600 setup +
  per-person (D-010). Needs one product decision when the calculator
  is built: accept $1,600 flat, or treat the Team Day worksheet as a
  reference-only full-day estimate.

---

## 2026-05-19 — Week 2, Day 9 · Catalog reconciled to current spreadsheet

### Changed
- `scripts/db-seed.mjs` — five package/addon corrections after a
  side-by-side audit with the master spreadsheet:
  - **Verse** — time_hours 6 → 5.5, hard_cost $450 → $415. Now lands
    cleanly on methodology (working $897 → published $900).
  - **Saga** — base_price $8,000 → $8,500. Methodology pull-up.
  - **Single Executive** — base_price $670 → $500. Intentional
    market-positioning at the low-mid of the DFW high-end range while
    the portfolio is being built; planned to raise on social proof.
  - **Visibility Retainer** — base_price $1,500/qtr → $1,900/qtr.
    Methodology pull-up from funnel pricing.
  - **Story Exhibition upgrade** — base_price +$1,500 → +$2,200 to
    match the spreadsheet's $3,900 Exhibition total.

### Decided
- D-009 — admin editor for packages/addons lands in Week 4 polish,
  not earlier. Hand-typed seed updates are tolerable for the 2-3
  price changes likely in Weeks 2-3.
- D-010 — Team Day stays as setup ($600) + per-person ($80) addon,
  not the flat $1,600 the spreadsheet shows for a 12-person snapshot.
  Customer-facing math from CLAUDE.md §4 wins over the spreadsheet
  here because it scales with headcount.

### Architecture note
- Confirmed for the record: the master spreadsheet is **not**
  auto-synced to ops. The seed script is a one-way hand-bridge.
  After D-009 lands in Week 4, ops becomes the source of truth and
  the spreadsheet retires as authoritative.

### Heads-up
- The basic-pricing wall card PDF (in `/projects/sharp/Guides/`)
  now drifts from the ops catalog on three numbers: Saga ($8,000 →
  $8,500), Single ($670 → $500), Retainer ($1,500 → $1,900). Worth
  refreshing the wall card the next time it's printed for Discovery
  Hour.

---

## 2026-05-19 — Week 2, Day 8 · Catalog seed

### Added
- `scripts/db-seed.mjs` — idempotent upsert of the package + addon
  catalog. Pulls cost-plus inputs from the master spreadsheet and
  retail prices from the basic-pricing wall card. Prints a
  methodology-vs-retail spread report after every run so divergences
  stay visible. Supports `--dry-run` (no writes) and `--reset`
  (TRUNCATE first; destructive).
- Two npm scripts: `db:seed` (apply) and `db:seed:dry` (report only).

### Decided
- D-007 — store retail price separately from methodology output.
  Cost-plus inputs are alongside `base_price` so the admin view can
  surface the strategic spread (Verse −$100, Corp Single +$170,
  Retainer −$400, etc.). Methodology is informational discipline; the
  retail number is what gets quoted.
- D-008 — Story Exhibition modeled as an addon (`story-exhibition-upgrade`),
  not a second package. Wall card already presents it that way.

### Catalog seeded
- **7 packages:** Verse, Story, Saga, Single Executive, Team Day,
  Essentials, Visibility Retainer.
- **11 addons:** Extra digital, Gift Collection, Fine Art Collection,
  Heirloom Book (portraits-universal), Exhibition upgrade (Story),
  Additional production day (Saga), Featured upgrade (Single),
  Per-person headshot + Featured-for-principal (Team Day), Cinematic
  walkthrough (Essentials), Additional 12 clips (Retainer).

---

## 2026-05-19 — Week 1, Days 6-7 · Vercel deploy + DNS

### Added
- `vercel.json` — pins framework to Next.js and region to `iad1`
  (us-east-1) to co-locate the Vercel functions with Neon for ~5ms
  query latency.

### Verified
- Production deploy live at `https://ops.sharpsighted.studio`.
- Vercel auto-provisioned Let's Encrypt SSL after the CNAME on Namecheap
  pointed at `cname.vercel-dns.com`.
- Production env vars set: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`,
  `AUTH_TRUST_HOST`, `AUTH_RESEND_KEY`, `EMAIL_FROM`, `ALLOWED_EMAILS`.
- Magic-link sign-in works end-to-end on the production domain.
  Bootstrap admin lands on the dashboard with the admin sidebar
  section visible.

### Milestone
- **Week 1 complete.** All four phases (scaffold, DB, auth, deploy)
  shipped on schedule across two calendar days. Ops is a real running
  surface; Week 2 builds the first module (pricing calculator) on top
  of it.

---

## 2026-05-19 — Initial documentation pass

### Added
- `BUILD-PLAN.md` — master build plan covering mission, architecture,
  brand alignment, the full 30-day plan, deployment, operating
  principles, risks, post-MVP roadmap, and a decision log.
- `CHANGELOG.md` — this file.

### Changed
- `README.md` — listed all six env vars (was three), removed stale
  "auth lands in Day 3" line, checked off Day 1-5 in the build-order
  table, added a "Useful scripts" subsection surfacing `db:migrate`
  and `db:check`, fixed proxy.ts rename attribution (Next.js 16, not
  Auth.js v5).

---

## 2026-05-19 — Week 1, Days 4-5 · Auth.js v5 + Resend magic links

### Added
- `src/auth.ts` — NextAuth v5 config with PostgresAdapter and a Resend
  Email provider using a custom branded `sendVerificationRequest`.
  `signIn` callback rejects emails not on `ALLOWED_EMAILS`. `createUser`
  event inserts `ops_profiles` row with `role='admin'` for the bootstrap
  email, `'partner'` for everyone else. `signIn` event touches
  `last_seen_at`.
- `src/proxy.ts` — Next.js 16 middleware-successor. Redirects
  unauthenticated requests to `/signin?callbackUrl=<path>`. Public
  allowlist: `/signin/*`, `/api/auth/*`, static assets.
- `src/lib/email-allowlist.ts` — parses `ALLOWED_EMAILS`, identifies
  bootstrap admin (first entry).
- `src/lib/magic-link-email.ts` — table-layout HTML email body with
  Playfair italic headline, terracotta button, cyan tagline footer.
  Plain-text fallback included.
- `src/app/api/auth/[...nextauth]/route.ts` — re-exports Auth.js
  handlers.
- `src/app/signin/page.tsx` — branded sign-in form. Server action calls
  `signIn('resend', ...)`. Inline error banners keyed to Auth.js error
  codes.
- `src/app/signin/verify-request/page.tsx` — "check your inbox"
  confirmation.
- `src/app/signin/error/page.tsx` — branded error states.

### Changed
- `src/components/Sidebar.tsx` — wired the Sign-out button to
  `next-auth/react`'s client `signOut`.
- `src/app/page.tsx` — now session-aware. Reads role + display name
  via `auth()`, passes role into Sidebar.

### Fixed
- `src/proxy.ts` — removed `runtime: 'nodejs'` from the route config.
  Next.js 16 forbids route segment config in proxy files; proxy always
  runs on Node by definition.
- `src/app/layout.tsx` — added `data-scroll-behavior="smooth"` on the
  `<html>` element to suppress Next.js's smooth-scroll route-transition
  warning.

### Verified
- End-to-end magic-link sign-in works locally. Bootstrap admin lands
  on the dashboard with admin sidebar visible. Sign-out returns to
  `/signin`.

---

## 2026-05-19 — Week 1, Days 2-3 · Neon Postgres + schema

### Added
- `src/lib/db.ts` — pg pool wrapper with lazy init, global cache for
  HMR, and a tagged-template `sql` helper.
- `src/lib/db/schema.sql` — full Postgres schema covering Auth.js
  adapter tables (`users`, `accounts`, `sessions`, `verification_token`)
  and ops application tables (`ops_profiles`, `packages`, `addons`,
  `quotes`, `quote_lines`, `quote_events`) with `updated_at` triggers.
  Idempotent — every CREATE has `IF NOT EXISTS`.
- `scripts/db-migrate.mjs` — Node migration runner. Reads `.env.local`,
  masks the password in the log line, applies the schema, lists the
  resulting tables. No `psql` install required.
- `src/lib/pricing.ts` — cost-plus methodology in code.
  `priceFromCostBasis()` runs the full ladder (time cost → hard cost →
  cost basis → margin → working price → round up to nearest $100).
  `adminProfitView()` decomposes into wage + bonus + keep matching the
  spreadsheet Simple View framing.

### Changed
- `package.json` — added `db:migrate` and `db:check` scripts. Added
  `@auth/pg-adapter` dependency.
- `.env.example` — documented Neon connection-string discipline:
  use `sslmode=verify-full`, not `sslmode=require`. Annotated the
  Resend variables with sandbox vs verified-domain guidance.

### Verified
- `npm run db:migrate` applies schema to Neon successfully. All ten
  tables present.

---

## 2026-05-19 — Week 1, Day 1 · Scaffold

### Added
- `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`,
  `eslint.config.mjs`, `.gitignore`, `.env.example`, `README.md`,
  `CLAUDE.md` — Next.js 16 + Tailwind v4 + TypeScript project setup.
- `src/app/layout.tsx` — root layout. Playfair Display + Montserrat
  via `next/font`. No-FOUC theme script. Robots disallowed (internal
  app).
- `src/app/page.tsx` — dashboard placeholder with stat tiles, build
  status checklist, and module-card teasers.
- `src/app/globals.css` — full design-token system in the ops dialect.
  8px corner radius, steel/slate working surfaces, terracotta reserved
  for primary actions, dense 2-3rem section padding.
- `src/app/providers.tsx` — theme context (`ss_ops_theme` key,
  namespaced so it doesn't collide with the public studio if both are
  open in the same browser).
- `src/app/not-found.tsx` — branded 404.
- `src/components/Sidebar.tsx` — persistent app-shell sidebar with
  Dashboard, Calculator, Quotes, Prospects, Today nav items, plus an
  admin-gated section for Packages and Team.
- `src/components/Footer.tsx` — tagline footer with cyan Playfair
  italic "Stay Sharp. Stay Seen. Stay Human." wordmark.

---

*Stay Sharp. Stay Seen. Stay Human.*
