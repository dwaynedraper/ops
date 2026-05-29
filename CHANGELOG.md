# Changelog

All notable changes to Sharp Sighted Ops. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), but
entries are grouped by sprint/day rather than semantic version since
this is an internal app on a 30-day cadence.

The build plan lives in `BUILD-PLAN.md`. The local-dev quickstart
lives in `README.md`. This file is the time-ordered receipt.

---

## [Unreleased]

### Phase R — Reports (shipped 2026-05-28)
Admin-only `/reports` route, a nightly snapshot table populated by a
new cron at midnight CT, and six dashboard cards designed around the
three recurring decisions Dean has to make ("Is my pipeline healthy?",
"Which workflow do I push?", "Which rep deserves my time?").
Specification in `REPORTS-PLAN.md`. Decisions D-068 → D-074. **R6
deferred per D-074.**

#### Added
- **Schema** — new `daily_metric_snapshot` table on
  `(snapshot_date, rep_id, workflow_key, stage)` PK with three indexes
  (date, rep+date, workflow+date). Additive, idempotent.
- **Rollup** — `src/lib/reports/rollup.ts` splits into a pure
  `buildSnapshotRows` assembler (11 unit tests) and a `computeSnapshot`
  orchestrator that runs five Postgres queries against
  `prospect_stage_events`, `prospects`, `prospect_contacts`, `quotes`,
  and a cycle-time CTE.
- **Upsert** — `src/lib/reports/upsert.ts` wraps a transactional
  DELETE-then-INSERT keyed by `snapshot_date` (6 unit tests, including
  the guardrail against mixed-date batches).
- **Cron** — `/api/cron/snapshot` mirrors the digest route's
  `CRON_SECRET` gate, computes the CT-anchored "yesterday" window,
  runs the rollup, upserts, and surfaces partial failures as
  non-2xx (10 integration tests). New `vercel.json` cron entry
  `0 5 * * *` (05:00 UTC = midnight CT).
- **Query layer** — `src/lib/reports/query.ts` exports
  `loadReportsData(range)` returning six card-shaped slices, plus a
  `resolveRange` helper for the four range presets (7d / 30d / 90d
  / YTD).
- **Page** — `src/app/reports/page.tsx`, `super_admin`-gated via
  `auth()` (`notFound()` for non-admin). Date range picker in the
  header is pure server-rendered Next links (no client state).
- **Cards** — six server components in `src/app/reports/cards/`:
  PipelineVelocityCard (hero, pure-SVG sparkline), FunnelCard
  (six-stage waterfall), WorkflowRoiCard (sorted by $/close),
  RepLeaderboardCard (with Active Partner badge), ScoreValidationCard
  (closed-vs-rejected histogram across five score buckets),
  StalePipelineCard (live query, links into `/qualify/[id]`).
- **Sidebar** — Reports link added at the top of `ADMIN_LINKS` (gated
  to `super_admin`).

#### Deferred (per D-074)
- **R6 · Email digest extension** — the "Yesterday's snapshot" block
  on Dean's morning digest email. R1–R5 + R7 ship without it; R6
  rolls forward to a follow-up phase. The snapshot table is the
  source it would read from, so no foundation work is wasted.

#### Verification
- 27 new tests (rollup: 11, upsert: 6, snapshot cron route: 10).
- Repo-wide `vitest run` — 176 / 176 tests passing.
- `tsc --noEmit` clean.
- `eslint src/app/reports src/lib/reports src/app/api/cron/snapshot` clean.

### Planned next (after Phase R)
- Phase D recommended additions still open: duplicate check on
  Qualify, cross-sell linked prospects, mobile pass (PHASE-D-PLAN §9).
- Tutorials for the four workflows beyond real-estate (corporate,
  story portraits, saga, 10%) as their sources of names and the
  motions firm up.
- Per-rep `/reports/me` view (the deferred D-068 follow-up). Snapshot
  schema already supports it.

### Removed from the plan
- Send-to-client flow (emailing the quote PDF from inside ops) —
  discarded as a miscommunication. Earlier docs and CHANGELOG
  entries that reference it stay as historical record.

### Setup needed for this release
- **Run `npm run db:migrate`** — applies the Phase R schema (new
  `daily_metric_snapshot` table + three indexes). Additive and
  idempotent; safe to re-run. Plus the still-active Phase E P2 migration
  (`sides_count`, `gross_volume`, `source_url`, `sourcing_note`,
  `sourcing_status` on `prospects`, plus the `sourcing_status`
  index) and the P4.5 idempotent reweighting + branded_email
  deactivation. Conditional updates won't clobber any
  `/rank-factors` customizations.
- Re-running `npm run db:seed` is optional. The schema migration
  handles the live DB; the seed picks up the new help_text and
  the dropped `branded_email` factor for fresh installs.
- All earlier setup steps still apply: `CRON_SECRET`,
  `rep_invites` / `prospect_stage_events` migrations from the
  prior release.

---

## V2 — 2026-05-28

The polish-and-fit pass. Every surface V1 had exercised in real use,
tightened. Fourteen phases (F0 → F13) covering: testing-DB stand-up,
sidebar restructure, Sourcing polish + revisions, Tracking → Contact
rename, workflow color palette, Contact page rebuild, Qualify polish,
Clients re-think + cross-workflow Qualify list, duplicate-check,
tutorial block enhancements + content (real-estate revised, Corp HS
drafted), limited mobile pass on Dashboard + Clients, and the
`/today` → Dashboard merge.

Decisions D-035 → D-067 (D-052 intentionally skipped) recorded in
**BUILD-PLAN.md §10**. Full per-phase detail below.

### Setup needed for this release
- Run `npm run db:migrate` against your DATABASE_URL. The migration
  is **idempotent** end-to-end — every UPDATE is guarded by the V1
  default value, so manual edits via `/rank-factors` / `/scripts`
  / hand-SQL are preserved. The three blocks that run:
  - **F4 / D-053** — `workflows.accent` colors update from V1
    defaults to the new palette (gold / violet / cyan / red /
    fuchsia).
  - **F5 / D-047 + D-048** — real-estate first-touch paragraph
    rewrites; standardized "Regards, … • Sharp Sighted {Branch} …"
    signature applies across every script.
  - All earlier V1 migrations still apply.
- For local dev, the F0 doc walkthrough in README sets up a separate
  Neon project so V2 work doesn't touch prod data.
- Re-seeding (`npm run db:seed`) is optional. The migrations above
  handle live rows; the seed picks up the same values for fresh
  installs.

### Verified
- `tsc --noEmit` and `eslint src` clean on the final pass.
- Decision log D-035 → D-067 added to BUILD-PLAN §10.
- Ready to merge `v2` → `main`.

### F0 — Testing DB setup (docs only)
- README gains a "Testing database (V2 onward)" section. One-time
  Dean task: create a second Neon project, swap `DATABASE_URL` in
  `.env.local` to it, run `npm run db:migrate`. No code changes.
  (D-064.)

### F1 — Sidebar restructure + sticky app-shell

- `src/components/Sidebar.tsx` rebuilt into four sections with
  section headers + top-border separators: **Dashboard** (single
  link), **TOOLS** (Quote Calculator, Tutorials), **SALES**
  (Sourcing, Qualify, Contact, Client List), **PRICING & ADMIN**
  (super-admin only). (D-066.)
- Label renames: `Calculator` → **Quote Calculator**, `Clients` →
  **Client List**. URLs unchanged; pure display-text edits.
- The "Contact" sidebar label pointed at `/tracking` until F3
  landed the route-folder rename; href now reads `/contact`.
- Active-route matching now handles nested routes: `/qualify`
  highlights for both `/qualify` and `/qualify/[id]`, same for
  `/tutorials`.
- Sidebar is now `position: sticky; top: 0; height: 100vh` via the
  new `.app-shell-aside` class. The page scrolls normally (so the
  footer follows the content), but the aside stays pinned at the
  top of the viewport — wordmark up top, scrollable nav in the
  middle, theme toggle + sign-out pinned at the bottom — no matter
  how tall the page is. (D-067.) `align-self: start` on the aside
  prevents CSS Grid's default `stretch` from defeating sticky
  positioning. The first attempt used `height: 100vh; overflow:
  hidden` on `.app-shell` to lock the whole shell to the viewport,
  but the inner main+footer column wasn't height-constrained, so
  the page scrolled anyway and the toggle/sign-out dropped below
  the fold. Sticky-aside also avoids the trap where shell-level
  `overflow: hidden` silently disables `position: sticky` for
  every nested side panel (calculator summary, qualify score,
  tracking list). On mobile (≤768px), the aside reverts to
  `position: static` and the layout stacks (full mobile pass lands
  in F11).

### F2 — Sourcing polish (D-035 → D-041)

The polish-and-fit pass on `/sourcing`. Six concrete moves:

- **D-035 — Newest-first default sort.** Added `createdAt` (ISO
  string) to `SourcingRow` and surfaced `created_at::text` in the
  page query + the `upsertSourcingRow` action. Default sort is now
  `createdAt` desc — a freshly-added prospect lands on top
  regardless of how the rep had the table sorted before, including
  after the rep toggles to a different column and back. Replaces
  the previous fallback that sorted by `id` (UUID lexicographic).
- **D-036 — Sort indicators on every header.** `SortHeader` always
  renders a glyph: ↑/↓ on the active column, ↕ at 40% opacity on
  inactive sortable columns. Reads "this is clickable to sort" at
  a glance.
- **D-038 — Status column fit.** Bumped the `sourcingStatus`
  column from 150 → 200px and trimmed the `SourcingStatusToggle`
  button padding + letter-spacing slightly. Pursue / — / Reject all
  fit cleanly in the always-visible toggle, never clipped under any
  state. The wider column also makes room for the override panel
  below the row to align cleanly to the right.
- **D-037 + D-039 — Always-interactive controls + row-body
  navigation.** Major behavior shift on `TableRow`:
  - Status toggle + bool rank-input checkboxes are now ALWAYS
    interactive (display mode + edit mode). Clicking either commits
    immediately via `upsertSourcingRow` with a minimal patch — no
    draft, no Save button needed.
  - When clicking a status button would create an override case
    (the rep's call disagrees with the band), the row drops an
    inline panel below itself with the `OverrideExpansion` + a
    Cancel / "Save with reason" pair. The toggle visually reflects
    the rep's pending choice (`visibleStatus = pendingStatus ?? row.sourcingStatus`)
    so they see what they're about to commit to.
  - Row body click → `useRouter().push('/qualify/${row.id}')`. The
    interactive controls (status cell, bool cell, action buttons,
    edit-mode inputs) call `e.stopPropagation()` so they don't
    trigger navigation. Cursor is `pointer` only when the row is
    navigable (not in edit mode, no override pending, no other row
    active). Tooltip on the row reads "Open in Qualify."
  - Pencil click → unlocks edit mode for only the FIRST-CLASS
    non-control cells (name, agency, market, gross_volume,
    source_url) plus integer rank inputs (typing into them on every
    keystroke would spam the server). Commit only includes those
    fields — status + bool values committed already.
  - The `StatusPill` component is now unused and removed.
- **D-040 — Custom CSS tooltips.** Attribute-driven, CSS-only,
  zero-JS hover labels via `data-tooltip="…"` on any element.
  Instant on hover — no delay — because reps are clicking rapidly
  and a tooltip that hesitates is worse than none. Position
  defaults to above; `data-tooltip-pos="below"` for top-of-viewport
  elements. Pseudo-element rendered as `::after` with `pointer-events:
  none` so it doesn't interfere with clicks. Wired onto: pencil,
  Save, Cancel, the three status toggle buttons, the score cell,
  and the row body.
- **D-041 — Sourcing help boxes.** Added `mode: 'qualify' |
  'sourcing'` to `HelpBox` + `getHelpEntry`. Authored a new
  registry of sourcing-time content for the real-estate workflow
  (`gross_volume`, `source_url`, `has_target_listing`,
  `annual_volume`, `pro_website`, `uses_video`) — six entries
  pitched at batch triage instead of deep-read qualify. Voice:
  "you've got 50 names, spend 30 seconds, defer the deep stuff to
  Qualify." Wired the trigger into `FormField` (per-field on the
  add-prospect form), `QualifierField` (per-qualifier on the
  add-prospect form), and `TableHeader` (per-column). The native
  `title=` attributes on the headers come off (they were slow and
  the help modal replaces them). Missing entries render no
  trigger, so columns without authored content stay clean.

### F2 — Sourcing revisions after first walk-through (F2.8)

Dean walked the table in dev and called out four things that
needed to change:

- **F2.8.1 — Row interaction model reversed (supersedes D-039).**
  The row body now opens edit mode on click (which is what reps
  expect from a spreadsheet-style triage surface). A new
  **leftmost column** holds a per-row **Qualify selection**
  button — a small terracotta-accented `→` that navigates to
  `/qualify/[id]`. The Name cell is the second navigation
  exception: clicking it also opens `/qualify/[id]` (the name is
  the prospect's identity, so it reads as a link). The pencil
  comes out of `ActionsCell` entirely — the row body click is the
  edit trigger now; in display mode that column is empty, in edit
  mode it holds Save + Cancel.
  - `QUALIFY_COL_WIDTH = 56` added to the grid template; column
    order is now `[Qualify] [Score] […workflow cols] [Actions]`.
  - `TableHeader` renders "Qualify / selection" as the leftmost
    columnheader.
  - New `QualifyButtonCell` component; new `onNavigate` prop on
    `RowCell` so the Name cell can fire navigation without
    bubbling up through the row's activate-edit handler.
  - `RowCell` gains a `column.isPrimary` branch — the name is
    rendered as a dotted-underline accent link, not an editable
    input. Name editing happens on Qualify going forward.
- **F2.8.2 — Tooltip restyled.** The original tooltip read as a
  small button hovering below the row (surface-3 background,
  strong border, box-shadow). Lightened to a flat cursor-hint:
  no shadow, no border, smaller font + padding, `surface-tool-2`
  background. Row-body tooltip now reads "Click to edit"; the
  Qualify button + Name cell read "Open in Qualify."
- **F2.8.3 — `annual_volume` sourcing help rewritten.** My
  first-draft sourcing entry treated `annual_volume` as a dollar
  figure (`$34M → 34`), which contradicts the field — it's the
  COUNT of listings closed per year in the $500K–$2M band. New
  three-section entry covers the rapid read (10/yr / 20+ / 30+
  scoring bands), estimating the in-band fraction from RealTrends
  + Zillow Past Sales, and when to defer to Qualify.
- **F2.8.4 — "Where to start" onboarding strip.** New inline
  card between the workflow tabs and the add-prospect form, with
  a prominent `Open the guide →` HelpBox trigger. Authored a
  three-section guide (get the list / fill each row / keep
  moving) including a RealTrends example URL and the "30 seconds
  per row" cadence guidance. Per-workflow content; renders
  nothing when a workflow lacks a `start` entry (only
  `real_estate` ships in V2). New `WhereToStart` component
  imports `getHelpEntry` directly to gate visibility.

### F3 — Tracking → Contact rename (D-046)

App-wide rename of the contact-cycle surface from `/tracking` to
`/contact`. Pure URL + folder + label sweep; no behavior or schema
changes. Same shape as the V1 `/research` → `/qualify` rename.

- **Folder rename** via `git mv`:
  - `src/app/tracking/` → `src/app/contact/`
  - `src/app/contact/TrackingClient.tsx` → `src/app/contact/ContactClient.tsx`
- **In-folder renames** (page-internal only):
  - `TrackingPage` → `ContactPage` (default export)
  - `TrackingClient` → `ContactClient` (exported component)
  - `TrackingWorkflow` → `ContactWorkflow` (local interface)
  - Page eyebrow + `metadata.title` "Tracking" → "Contact"
  - `callbackUrl=/tracking` → `callbackUrl=/contact`
  - All three `revalidatePath('/tracking')` → `'/contact'`
  - Header comment on `actions.ts` updated; "tracking board"
    phrasings inside comments now read "contact board."
- **External URL references** swept:
  - `Sidebar.tsx` — `href: '/contact'`. The placeholder comment
    about "route stays /tracking until F3" comes out.
  - `src/app/page.tsx` — three Dashboard Links (`Open Tracking →`
    button + two row Links to follow-up cards) now point at
    `/contact` and read "Open Contact →".
  - `src/lib/digest-email.ts` — both `${base}/tracking` URL
    constructions now `${base}/contact`.
  - `src/app/today/page.tsx` — four refs (Section action hrefs +
    DigestRow hrefs) + two `"Open Tracking →"` button labels +
    the "the composer is in Tracking" hint copy all flipped to
    Contact.
  - `src/lib/tutorials-content.ts` — the real-estate Step 3
    walkthrough rewritten to say `/contact` and "the Contact
    page" instead of `/tracking` / "the Tracking page."
- **Out of scope (intentional):** the supporting library at
  `src/lib/tracking.ts` keeps its filename, and the in-lib types
  `TrackingCard`, `TrackingStatus` (plus `statusRank`'s signature)
  stay as-is. Every consumer still imports from `@/lib/tracking`.
  The V2-PLAN F3 wording is "folder rename" + URL sweep — a
  lib-side rename can land as a small follow-up if the naming
  mismatch starts to bite. Three new comment headers (page.tsx,
  ContactClient.tsx, actions.ts) explicitly flag this so a future
  reader doesn't trip over the asymmetry.
- **Doc sweep:** the F1 note about "Contact label points at
  /tracking until F3" updated to reflect that F3 has landed.
  Historical V1 entries (Phase B, etc.) keep their original
  `/tracking` references — they describe what shipped at the
  time and shouldn't be rewritten.
- **Verified:** `tsc --noEmit` + `eslint src` clean. Every
  `/tracking` left in `src/` is either a `@/lib/tracking` import
  (correct) or a "was `/tracking` pre-F3" comment header.

### F4 — Workflow color palette (D-053)

Five new workflow accent hex values. Pure data change — every UI
surface already reads `workflow.accent` from the DB, so the colors
update everywhere as soon as the rows do.

The new palette:

- **RE Media** — `#c9922a` (brand gold, the Sharp pillar's Media accent)
- **Corp HS** — `#8b5cf6` (violet)
- **Story Portraits** — `#38bdf8` (brand cyan, the Photos pillar)
- **The Saga** — `#dc2626` (dramatic red)
- **The 10% Rule** — `#ec4899` (fuchsia)

Changes:

- **`scripts/db-seed.mjs`** — `accent` values on the five
  workflow seed entries updated to the D-053 hex codes. Fresh
  installs (`npm run db:seed`) pick these up.
- **`src/lib/db/schema.sql`** — new idempotent migration block
  at the bottom. Each `UPDATE workflows SET accent = …` is
  guarded by `WHERE workflow_key = … AND accent = '<V1 default>'`,
  so a super-admin who's already customized an accent (via
  hand-SQL or a future accent editor on `/rates`) keeps their
  edit. The V1 defaults the migration looks for:
  `#64748b` (RE), `#0ea5e9` (Corp), `#c25f3e` (Story),
  `#a0462a` (Saga), `#10b981` (10%).
- **Note on the Saga × workflow-row conflict:** dramatic red
  collides with the rejected-state styling for table rows.
  F7's REJECTED badge + 55% opacity treatment (D-055) is the
  disambiguation; the seed comment flags it inline.

No code changes anywhere else — every consumer (workflow tabs on
Sourcing, Qualify pickers, Contact column heads, Clients rows,
Dashboard panels) reads `workflow.accent` from the workflows
table and renders whatever's there.

### F5 — Contact page rebuild (D-047, D-048, D-049, D-050, D-051)

Four decisions land together in this phase. Each is independent but
all touch `/contact` so they ride one commit.

- **D-047 — Email first-touch wording overhaul.** The real-estate
  first-touch sales-pitch paragraph swaps "I shoot real estate
  media in the 121 corridor — …" for **"Sharp Sighted Media shoots
  real estate media in the 121 corridor, from Allen to Southlake.
  The base package delivers stills, aerial, floor plan, twilight,
  and a vertical reel, all delivered within 24 hours. One shoot,
  five deliverables, MLS-ready."** Brand-agnostic phrasing —
  reps send the message, not Dean. Update lands in
  `scripts/db-seed.mjs` and as an idempotent `REPLACE()` in
  `src/lib/db/schema.sql`.
- **D-048 — Standardized signature.** Every script across every
  workflow now closes with:

  ```
  Regards,
  {{rep_name}} • Sharp Sighted Branch
  https://sharpsighted.branch

  Stay Sharp. Stay Seen. Stay Human.
  ```

  The tagline is now the absolute last line. Branch per workflow:
  real_estate → **Media** (sharpsighted.media), corporate +
  story_portraits + saga → **Photos** (sharpsighted.photos),
  ten_percent → **Studio** (sharpsighted.studio). Update covers
  all 17 seed scripts and a per-workflow `REPLACE()` migration
  block in schema.sql so live rows pick it up without a re-seed.
  Migrations preserve manual edits — REPLACE only acts on the V1
  closing pattern.
- **D-049 — Navigable cycle-step tabs + inactive-step badges.**
  Every cycle pill (First touch / Follow-up 1 / Follow-up 2 /
  Final touch) is now a real button. Clicking an inactive step
  shows:
  - **Past step:** the message *as it actually went out* (filled
    placeholders), plus a green "Already sent · {date}" badge.
    Required surfacing `filled_subject` + `filled_body` from
    `prospect_contacts` through the `ContactLog` interface and
    the page query — they live in the DB but weren't passed to
    the client until now.
  - **Future step:** the *template* body, plus a yellow
    "Send {prevStepLabel} first" badge.
  - **Current step:** the live composer (original behavior).

  A "← Back to {nextStepLabel}" link returns to the live view.
  The Log-contact action only renders on the current step — past
  + future are read-only.
- **D-050 — "Commit now" on the 20s undo toast.** `UndoProvider`
  gains a `commitNow(id)` callback that cancels the wait timer
  and fires the action immediately. The toast renders a
  `Commit now` btn-primary alongside the existing Undo. Lifecycle
  moves still get the safety window by default, but the rep is
  never blocked when they're sure. Sharp-eyed implementation
  detail: `commitNow` reuses the existing `commit(id)` path so
  the success/failure handling, route refresh, and resolved
  promise outcome all stay identical to the timer-driven path.
- **D-051 — Card list redesign: workflow-color body + urgency
  dot on the left.** The contact card list moves to:
  - A new **left-side urgency dot** (`9px`, with a soft glow on
    `now`/`overdue`). Color reflects how urgent the card is:
    - **Green** (`now`): reply waiting (replied), first touch
      ready, or follow-up due within the last 24h.
    - **Yellow** (`soon`): due within the next 24h.
    - **Red** (`overdue`): more than 24h past due.
    - **Faint** (`idle`): waiting > 1 day, or cycle done.
  - The **workflow accent** colors the card body — a 4px
    left-stripe + a `10%`-tinted background. Active card uses
    `1A` tint (~10%), idle uses `0D` tint (~5%), border picks
    up the accent on active.
  - Status meta label + score read at the same level as before.
  - Urgency computed server-side in `computeCycle` — new
    `CycleUrgency` type (`'now' | 'soon' | 'overdue' | 'idle'`),
    surfaced via `CycleState.urgency` and `TrackingCard.urgency`.

### F6 — Qualify polish (D-042, D-043, D-044, D-045)

Four decisions, all on `/qualify`. Two of them (D-045 + D-044)
also tighten the server contract that `/sourcing` shares.

- **D-042 — One-click Qualify at score ≥ 7.** New prominent
  primary button on the live score panel of `QualifyForm`,
  visible whenever every entry gate is clear AND the score is
  ≥ 7 AND the rep hasn't already set `status='qualify'`.
  Clicking commits `sourcing_status='qualify'` which advances
  the lifecycle stage to `qualified`. The existing
  three-button toggle stays for explicit Pursue / Undecided /
  Reject choices. Required a small refactor of `onSave` to
  accept an optional `overrideStatus` argument so the shortcut
  saves the right value without waiting for the local status
  state to settle.
- **D-043 — Qualify list filtering.** The "Your prospects"
  list at the bottom of `/qualify` now:
  - Hides `sourcing_status='qualify'` (already in the
    pipeline) and `sourcing_status='reject'` (Sourcing said
    no) by default. Default view shows pursue + undecided.
  - Adds a "Pursued only" checkbox toggle that narrows the
    remaining set to `pursue` alone.
  - Surfaces a "· N hidden" count next to the section
    eyebrow so the rep sees what the filter is suppressing.
  - Required surfacing `sourcing_status` on
    `ProspectListItem` and the page query.
- **D-044 — Direct-entry default = `pursue`.** `QualifyClient`
  passes `initialSourcingStatus="pursue"` (was `"undecided"`)
  to the create-mode `QualifyForm`. A rep adding a prospect
  straight on Qualify is here BECAUSE they want to qualify,
  so the row appears in the default Qualify list right away.
  The status toggle still lets them change it.
- **D-045 — Skip override-with-reason when empty.** The
  override rule (status disagrees with band → ≥20-char reason
  required) carves out an exception: when no qualifier inputs
  are filled at all, `band='reject'` (score 0) isn't
  meaningful and no reason is required. The rule re-engages
  the moment any qualifier is set.
  - Consolidated `needsOverride` into `src/lib/sourcing.ts`
    as the single source of truth — previously duplicated in
    `QualifyForm`, `SourcingClient`, and `sourcing/actions.ts`.
    New signature takes an optional `{ rankInputs, factorKeys
    }` to enable the D-045 carve-out.
  - QualifyForm passes its full input set + every factor key.
  - SourcingClient passes the row's `rankInputs` + every
    factor key at all four call sites (AddProspectForm,
    pendingReasonOk, handleStatusChange, override-panel
    render).
  - The server's `validateOverride` in
    `sourcing/actions.ts` gains `rankInputs` + `factors`
    parameters and applies the same rule. The two
    `needsOverride` call sites that decide whether to keep
    the override note (createRow + updateRow) also pass the
    options.
  - Net effect: same override gate behavior on real cases,
    but a fresh direct-entry row no longer demands a reason
    before the rep has touched a single qualifier.

### F7 — Clients re-think (D-054, D-055, D-056)

The master Clients list grows three deliberate cues.

- **D-054 — Workflow color on every row.** Each `Link` card
  picks up a 4px left-stripe in the workflow accent + a 5%
  tinted background (same dialect as the F5 Contact card list
  so the two surfaces read as a family). The existing
  workflow-name pill stays, but the body color now does the
  primary identity work — a Story Portraits row and a Saga
  row read distinct at a glance.
- **D-055 — Rejected + dormant fade + corner badge.** Rows
  where `stage='rejected'` render at 55% opacity with a small
  red "Rejected" corner badge (top-right). Rows where
  `stage='dormant'` get the same fade with a muted "Dormant"
  badge. The workflow accent stays visible through the fade
  so a rejected Saga still reads as a Saga, not as a generic
  inactive row.
- **D-056 — "Show inactive" toggle.** Above the list, between
  the search box and the count: a "Show inactive" checkbox.
  - Default **off** — rows where `stage='rejected'` or
    `stage='dormant'` are filtered out so the working list
    stays focused on live prospects.
  - When the rep picks an explicit stage from the dropdown
    (`rejected` or `dormant`), the toggle is bypassed so they
    can target those stages directly without flipping the
    box first.
  - When off and inactive rows exist, the label reads
    "Show inactive (N hidden)" so the rep sees what's being
    suppressed.

Row click still navigates to `/prospects/[id]` — that part
didn't change.

#### F7-b — Cross-workflow Qualify list (inline addition)

After walking the rest of F7, Dean called out the
scroll-pick-scroll thrash on `/qualify`: switching workflows to
find a recently-qualified prospect meant tab, scroll, click,
tab, scroll, click. The "Your prospects" list at the bottom of
`/qualify` now shows EVERY workflow's prospects, with the
currently-selected workflow's rows floated to the top. The
within-group order keeps the server's `ORDER BY created_at
DESC` (Array#filter is stable).

- Section heading reads "Your prospects · {currentWorkflow}
  first · N hidden" instead of "Your {currentWorkflow}
  prospects."
- New `renderProspectRow` helper carries the row chrome so the
  same component renders both groups identically. Each row gets
  the F5/F7 dialect — 4px workflow-accent left-stripe + 5%
  tinted background — so cross-workflow rows read at a glance.
  A small workflow-name pill sits next to the stage badge as a
  redundant cue.
- Band classification uses the prospect's OWN workflow's bands
  (each workflow can tune `qualified_min` independently), not
  the currently-selected workflow's.
- "Other workflows" eyebrow with a faint top-border sits
  between the two groups when both have rows.
- D-043 filter (hide qualify + reject; "Pursued only" narrows)
  applies across all workflows now. Hidden-count reads cross-
  workflow.

### F8 — Duplicate-check on add-prospect (D-057)

The server holds the create when it spots a name match within the
rep's own prospects. The client surfaces a non-blocking warning;
the rep either backs out or re-submits with an explicit ack flag.
Owner-scoped — the check only sees the rep's own prospects, never
another rep's (preserves D-019 visibility).

Server (`sourcing/actions.ts`)
- `UpsertSourcingRowInput` gains `acknowledgeDuplicates?: boolean`.
- `UpsertSourcingRowResult` gains `duplicates?: DuplicateProspect[]`.
- New exported `DuplicateProspect` shape:
  `{ id, contactName, workflowKey, workflowName, stage, sourcingStatus }`.
- `createRow` runs a `SELECT … WHERE owner_id = $userId AND
  lower(contact_name) = lower($name) LIMIT 5` ONLY when
  `acknowledgeDuplicates !== true`. If matches exist, returns
  `{ ok: false, duplicates: […] }` (no `error` — the warning is
  not a failure). Otherwise the create proceeds normally.
- `updateRow` is untouched — duplicates only matter on insert.

Client — shared `DuplicateWarning` component
- New `src/components/DuplicateWarning.tsx` carries the panel
  shape so Sourcing and Qualify render identically. List of
  matched prospects (workflow name + stage + an `open →` link to
  `/qualify/[id]`), plus Cancel / "Continue anyway" buttons. Soft
  warn-styled background + dashed border so the panel reads as
  "your call," not as a hard error.

Sourcing wire-up
- `handleSave` in SourcingClient now returns the full
  `UpsertSourcingRowResult` so AddProspectForm can inspect
  `.duplicates`.
- `AddProspectForm` gains `pendingDuplicates` state, a
  `submitAdd(acknowledgeDuplicates)` helper, and Continue /
  Cancel handlers that re-submit or dismiss. Panel renders
  inline under the Add button.
- TableRow's `onSave` prop return type updated to match (no
  behavior change there — update never hits the duplicate path).

Qualify wire-up
- `QualifyForm.onSave` gains a second arg
  `acknowledgeDuplicates = false`. On a duplicates result, sets
  `pendingDuplicates` and pauses; doesn't push the error into
  the regular error slot. Continue re-submits with `true`;
  Cancel clears the panel.
- Panel renders under the Save button row.
- Edit mode (`prospectId != null`) never sees the panel because
  the server only runs the check in `createRow`.

### F9 — Tutorial block enhancements (D-058)

Two additions to the shared block renderer. Authors get more
expressive content without writing JSX; every existing
`HelpBlockList` consumer (HelpBox modals + the tutorial detail
page at `/tutorials/[slug]`) picks them up for free.

- **New `heading` block type.** Adds
  `{ kind: 'heading'; text: string; level?: 2 | 3 }` to the
  HelpBlock union. Level 2 is the default and renders as a small
  Playfair `h3`; level 3 reads as a sub-beat (`h4`, smaller).
  Authors use this to break long sections into named beats
  without introducing a new top-level `HelpSection`.
- **Inline markdown in paragraph + list + steps + callout text.**
  Tiny no-library parser recognizes two patterns and emits a
  React fragment:
  - `**bold**` → `<strong>bold</strong>`
  - `[label](url)` → external link with the dotted-accent
    underline style we use elsewhere
  Anything else passes through unchanged. The parser walks the
  input left-to-right; no nesting, no regex-backtracking
  pitfalls. Applied at render-time in `HelpBox.tsx`, so the
  registry can stay in plain TypeScript string literals.

Heading text is rendered literally — inline markdown is paragraph-
level only. Keep heading text short.

### F10 — Tutorial content + Corp HS draft (D-059, D-060)

Both decisions land together in `src/lib/tutorials-content.ts`.
The shared `HelpBlock` renderer (F9) means heading sub-beats, bold
phrases, and inline links all render correctly with no additional
client-side work.

D-059 — Real-estate walkthrough revised
- Each step ("Source," "Qualify," "Contact," "Send the email")
  now breaks into named sub-beats with `kind: 'heading'` blocks
  — "Working a row, top to bottom," "The 20-second window,"
  "When your call disagrees with the math," etc. Reads more like
  a manual, less like a wall of text.
- Bold pulled onto every action verb or noun the rep needs to
  spot at a glance — toggles, buttons, status names, the
  threshold numbers.
- Inline links to `/sourcing`, `/qualify`, `/contact`, `/clients`,
  `/calculator`, `/rank-factors`, `/scripts`, and the RealTrends
  ranking. Renders as dotted-accent underline (F9 styling).
- Updated to match the V2 surface: F2.8.1's row-click-to-edit
  replaces the old "✎ pencil" copy; F2.8.4's tab tooltip and
  D-049's navigable cycle tabs are called out; F5's "Commit
  now" undo button gets a mention; D-051's urgency-dot legend
  lands in Step 3; D-042's one-click Qualify button gets its own
  paragraph.
- Lingering "Tracking" references on Step 4 + "What happens
  next" now read "Contact."

D-060 — Corp HS walkthrough drafted from scratch
- Six sections mirroring real-estate's structure (overview →
  source → qualify → contact → email → next).
- Source angle is non-RealTrends: **LinkedIn searches**, the
  Dallas Business Journal's growing-companies coverage,
  walking-radius, referrals from real-estate clients. Plus a
  note that the rep should source in small batches (5 firms at
  a time, not 50) — the qualifier work is heavier than
  real-estate.
- Qualify covers the seven Corporate factors verbatim — gates
  (`has_team_to_shoot`, `weak_team_photos`), headcount (max 40,
  weighted 3), `professional_services`, `recent_growth`,
  `brand_refresh`, `in_service_area`, `decision_maker_known`.
- Contact-cycle section walks the four Corporate scripts in
  order (First touch / Follow-up 1 / Follow-up 2 / Final touch)
  with their hooks.
- Pricing note pins the Team Day base + per-person rate so the
  rep knows the numbers before the discovery call.
- Branch attribution reads **Sharp Sighted Photos** throughout
  (corporate headshots are portrait work, not media work).
- Closes by explicitly flagging Story Portraits, Saga, and 10%
  walkthroughs as **post-V2 backlog** so reps don't expect them
  in this release.

Registry update
- `TUTORIALS` now exports both. `tutorialIndexFor` returns
  ready-card for `real_estate` + `corporate`, coming-soon for
  `story_portraits` / `saga` / `ten_percent`.

### F11 — Mobile pass (D-061)

Limited mobile pass on **Dashboard + Clients only**. Other
surfaces (Sourcing, Qualify, Contact, the admin tools) stay
desktop-optimized by design — a rep doing real work belongs at
a keyboard. The goal here is the phone glance: *"do I need to
open a laptop today?"*

Approach: three opt-in CSS classes in `globals.css`, applied
to the two surfaces. Inline styles stay; the classes layer the
responsive behavior on top.

- **`.list-row-responsive`** — used on Dashboard's follow-up
  list rows and Clients' row cards. Below 600px, the trailing
  badge column wraps to a second line, padded under the
  name+metadata so the visual hierarchy stays intact.
- **`.list-row-trail`** — marks the trailing column on those
  rows. Mobile CSS gives it `flex-basis: 100%`, drops it
  underneath the main column, and pads it to line up with the
  name column. The Clients row trail wraps three sub-elements
  (workflow pill + stage badge + date) so they fall together.
- **`.filter-bar-responsive`** — used on Clients' filter row.
  Below 600px the select + search input stretch to full
  width, and inter-control gap tightens.

Plus a tighter `.app-shell-main` padding at narrow widths
(`1rem 0.85rem` instead of `1.5rem`), and a 44px min-height
floor on buttons inside the mobile-aware regions.

The Dashboard's pipeline-by-workflow section already used
`grid-template-columns: repeat(auto-fit, minmax(110px, 1fr))`
so the stage tiles wrap cleanly without further work.

Out of scope (intentional)
- /sourcing — batch entry needs a wide table; a phone is the
  wrong tool for it.
- /qualify — the deep-work surface needs the side-by-side
  layout to hold the live score panel next to the form.
- /contact — the cycle composer needs the desktop layout to
  keep the copyable subject + body legible.
- /tutorials, /rates, /packages, /scripts, etc. — admin tools
  + read-heavy content. Not worth the mobile work in V2.

### F12 — Dashboard + /today merge (D-062, D-063)

The last big phase. The standalone `/today` route folds into the
Dashboard at `/`, and the route itself goes away. The digest
computation in `lib/digest.ts` didn't change — it still powers
both the page (now `/`) and the morning email cron, so the page
and the email always agree (D-062's intent).

Dashboard rewrite
- `src/app/page.tsx` now runs `computeDigest(user.id, now)` and
  the per-rep `digest_email` opt-in alongside the existing
  pipeline-by-workflow queries — single `Promise.all`.
- The old "Welcome back / Follow-ups due" two-block layout is
  replaced by the digest's structured panels:
  - **Replies waiting on you** — green tag, links to
    `/prospects/[id]` per item.
  - **Follow-ups due today** — Due/Ready tag in warn/accent,
    links to `/contact`, action link "Open Contact →" in the
    section header.
  - **Ready to close out** — faint "No reply" tag, links to
    `/contact`.
  - **All clear** card with a "Qualify new prospects" CTA when
    every queue is empty.
  - **In motion** ambient line — "N prospects mid-cycle, the
    next comes due in M days."
- The **pipeline-by-workflow** section is preserved — it's
  unique to the Dashboard and gives the cross-workflow funnel
  view the old `/today` page didn't have.
- The morning brief greeting at the top reads "Good morning,
  {firstName}" with a day eyebrow ("Tuesday, May 27") instead
  of "Welcome back."
- Email opt-in (`DigestOptIn`) renders at the bottom.

File reorganization
- `src/app/today/page.tsx` + `DigestOptIn.tsx` + `actions.ts` —
  deleted (git rm).
- `src/components/DigestOptIn.tsx` — the toggle, moved out of
  the route so the Dashboard can import it.
- `src/lib/digest-actions.ts` — `setDigestOptIn` server action,
  moved out with a `revalidatePath('/')` instead of
  `'/today'`.

URL + label sweep
- `src/lib/digest-email.ts` — every `${base}/today` link in the
  morning email points at `${base}/` now; the "Open Today"
  button labels read "Open Dashboard."
- `src/app/api/cron/digest/route.ts` — comment header refreshed.
- `src/lib/db/schema.sql` — `ops_profiles.digest_email` comment
  flagged with the F12 fold-in.
- `src/lib/digest.ts` — header comment refreshed.

Cron unchanged
- The cron path at `/api/cron/digest` reads prospects + scripts
  + contacts server-side and emails via Resend. It never
  touched the page route, so removing `/today` doesn't break
  it. Vercel Cron entry in `vercel.json` keeps working as-is.

### Pricing & Admin gating — verified, not changed
- Sidebar already gates the admin section to `super_admin` via
  `role === 'super_admin'` filtering. Every admin route
  (`/rates`, `/packages`, `/corporate`, `/rank-factors`,
  `/scripts`, `/team`) re-checks the role server-side per the V1
  launch audit. Both layers hold.

### F13 — Verify + finalize
- `tsc --noEmit` + `eslint src` clean on the full repo.
- BUILD-PLAN.md §10 gains compact entries for **D-035 →
  D-067** (D-052 skipped). V2-PLAN.md remains the canonical
  detail; the §10 entries link back to it.
- This CHANGELOG's V2 section promoted from "in progress" to
  a dated release header ("V2 — 2026-05-28"), with the
  "Setup needed for this release" + "Verified" panels at the
  top so a fresh reader sees the migration-walk + release
  status before the per-phase detail.
- v2.1 backlog: print packages (D-065) — the first thing
  after V2 merges.
- Post-v2.1 backlog (out of V2 entirely): Story Portraits /
  Saga / 10% tutorial walkthroughs; help-box content for the
  four non-real-estate workflows; cross-sell linked
  prospects; lib-side `tracking.ts` → `contact.ts` rename to
  match the F3 route rename.

### Walk this in dev — phase by phase

Accumulated walk-through items per phase. Most rely only on
running `npm run db:migrate` once; the rest are pure UI or
content reviews.

- F0: ✓ done. Second Neon project (`ep-divine-rain-aqktp4bn`) is
  up, schema migrated, `.env.local` swapped. Production stays on
  the prod project via Vercel env vars.
- F1: walk the sidebar in dev — confirm the section layout, the
  sticky bottom controls, and the scroll behavior when the nav is
  taller than the viewport.
- F2: walk Sourcing in dev — verify
  (a) newly-added rows land on top,
  (b) headers show ↕ / ↑ / ↓,
  (c) clicking a status toggle on a normal row commits without a
      save step, and an override case opens the inline panel,
  (d) clicking a bool checkbox commits immediately,
  (e) clicking the row body (not on a control) navigates to
      `/qualify/[id]`,
  (f) the pencil unlocks edit mode for the other cells and Save
      commits cleanly,
  (g) hovering the pencil / status buttons / row shows the custom
      tooltip instantly,
  (h) header HelpBox triggers open the sourcing-mode modals, and
      the field-level triggers on the add-prospect form match.
  Revise any of the six new help entries in `src/lib/help-content.ts`
  (`sourcingRealEstate`) — first draft Claude, your voice will
  refine.
- F3: walk Contact in dev — visit `/contact`, confirm the page H1
  reads "Contact," the sidebar highlights "Contact" when you're
  on it, follow-up Links from Dashboard + Today both land on
  `/contact`, and the digest email URLs read `…/contact`.
- F4: run `npm run db:migrate` against the testing DB to pick up
  the new workflow accent values (the migration is idempotent
  and only updates rows whose `accent` still matches the V1
  default — any manual edit you've made is preserved). When
  V2 merges, the same migration runs against prod via the next
  deploy. Walk the workflow tabs on Sourcing / Qualify / Contact
  to confirm the new palette reads right.
- F12: no migration. Pull up `/` — the brief reads as the old
  `/today` brief did (greeting, replies, follow-ups due,
  close-outs, all-clear), with the pipeline-by-workflow section
  underneath. Confirm the opt-in toggle still saves. If the
  next morning email arrives, the "Open Dashboard" link should
  land on `/` instead of the dead `/today`.
- F11: no migration — pure CSS + small wrapping. Pull up
  `/` and `/clients` on a phone (or a narrow browser window).
  Confirm rows stack cleanly, the filter bar on Clients
  doesn't crowd, and buttons feel large enough to tap.
- F10: no migration — content-only. Walk both tutorials at
  `/tutorials/real_estate` and `/tutorials/corporate`. The
  real-estate one should read familiar but with more breathing
  room (headings, bold). The Corp HS one is brand new — give
  it a Dean-revise pass before reps see it.
- F9: no migration. Pure renderer change. Confirm an existing
  HelpBox modal still reads the same (paragraphs that don't
  contain `**` or `[...](...)` are unchanged). Once F10 lands
  revised content using the new vocabulary, the heading + bold
  + link affordances will start showing up across `/tutorials`
  and on the per-field help modals.
- F8: no migration needed — pure code change. Walk it by adding
  a prospect whose name matches one you already own (on
  `/sourcing` and on `/qualify`); confirm the warning panel
  surfaces inline with the matched rows + workflow + stage and
  that Cancel dismisses while Continue anyway commits. Confirm
  the check doesn't fire for another rep's prospect with the
  same name (owner-scoped).
- F7: no migration needed — pure UI. Walk `/clients`: each row
  now wears its workflow accent (4px left-stripe + tinted
  body); rejected/dormant rows render at 55% opacity with a
  corner badge; the "Show inactive" checkbox at the top of
  the filter row toggles their visibility. Confirm a rejected
  row STILL reads as its workflow (not a generic gray row),
  and confirm "Show inactive" reports the hidden count
  honestly.
- F6: no migration needed — pure code change. Walk `/qualify`:
  - On the create form, hit Save without filling any
    qualifier and confirm no reason is demanded (D-045).
  - Confirm a brand-new direct-entry row lands in the default
    list (status now defaults to pursue — D-044).
  - Score a row to ≥ 7 and confirm the prominent "Qualify
    this prospect" button appears on the score panel (D-042).
  - Toggle "Pursued only" and confirm the list narrows;
    confirm hidden-count badge reads honestly.
  - Also walk `/sourcing`: status toggles on rows with no
    qualifiers filled should no longer trigger the override
    panel.
- F5: same `npm run db:migrate` picks up the email overhaul
  (D-047) + standardized signature (D-048) on every script row
  whose body still matches the V1 closing pattern. Then walk
  `/contact`: confirm the live composer reads with the new
  signature, the cycle pills are navigable (click an inactive
  step to view past as-sent or future template), an undo toast
  shows the **Commit now** button next to Undo, and the card
  list shows the urgency dot on the left + workflow-accent body.
  Vitest's tracking suite can't run in my sandbox right now
  (rolldown native binding loader bug); please run
  `npm test src/lib/tracking.test.ts` locally to confirm the
  new `urgency` field doesn't break expectations — if a test
  pinned the literal shape of `CycleState`, it'll need a small
  update for the added field.

---

## 2026-05-26 — V1 Sourcing close

The Sourcing redesign that wraps V1 on master. After this lands, V2
moves to a branch so live users aren't broken mid-stride.

### The mental model fix (D-034)

Sourcing was conflated with Qualify in two ways: a positive toggle on
Sourcing was named "Qualify" *and* auto-promoted the prospect to
`stage = qualified`. Dean called this out — Sourcing is triage, not
qualification. The promotion path now runs:

- **Sourcing toggle** is `Pursue / Undecided / Reject`. Pursue records
  that this prospect is worth qualifying. Stage stays `researching`.
  Reject moves stage to `rejected`.
- **The Qualify page is the only way to set `stage = qualified`.**
  Its toggle is `Qualify / Undecided / Reject`. Same `sourcing_status`
  column; Sourcing writes `pursue`, Qualify writes `qualify`, both
  write `reject`.

### Lifecycle stage rename: `passed` → `rejected`

Same ambiguity as the Sourcing-status rename. Idempotent migration
in `schema.sql` finds the auto-named CHECK by introspecting
`pg_constraint`, drops it, UPDATEs existing rows, re-adds the CHECK.
`STAGE_LABEL`, `STAGE_NEXT`, the `ClientPageView` button copy, every
`'passed'` literal across the codebase — all swept.

### Sourcing UI redesign

- **Add-prospect form at the top.** Form-style, not inline. Name +
  Agency are required (asterisks); everything else optional. State
  lives in the form until Add fires; the foot-gun where typing one
  letter created a prospect is gone.
- **No draft row in the table.** The table is read-only by default;
  edits go through row-level edit mode.
- **Row-level edit.** A pencil per row unlocks every cell in that row
  at once. Save with the green check, or by clicking off the row.
  Cancel with the ✕ button reverts. The active row gets a soft
  background tint + gutter above and below to soften accidental
  click-offs.
- **Sortable columns.** Click any header → sort by it. Click again
  to reverse direction. Sortable: Score, Name, Agency, Market, Sides,
  Gross Volume, every hard-qualifier column, and Status. Default sort
  is created-order, newest first.
- **Filter bar** above the table — All / Undecided / Pursued /
  Qualified / Rejected, with live counts.
- **Per-status pill** when the row is locked, three-state toggle when
  the row is active.

### Files

- `src/app/sourcing/SourcingClient.tsx` — full rewrite around the
  new structure. Drops `DraftRow`, `LockableCell`, the cell-level
  lock state, and the per-cell autosave guard. Adds
  `AddProspectForm`, `FilterBar`, `SourcingTable`, `TableRow`,
  `RowCell` (display vs. edit by `isActive`), `ActionsCell`
  (pencil/check/cancel), `SortHeader`. Live-score helper for the
  form mirrors `scoreProspect` so the badge updates as the rep
  types in qualifiers.
- `src/app/sourcing/actions.ts` — `needsOverride` rewritten to
  treat `pursue` and `qualify` together as "positive." The same
  rule fires from either page.
- `src/lib/sourcing.ts` — `SourcingStatus` gains `pursue`;
  `stageForSourcingStatus` no longer auto-promotes `pursue` to
  `qualified` (returns `researching`).
- `src/lib/prospects.ts` — `ProspectStage` `'passed'` → `'rejected'`;
  `STAGE_LABEL` + `STAGE_NEXT` updated.
- `src/lib/prospects.test.ts` — rejected-stage assertions updated.
- `src/lib/db/schema.sql` — adds two idempotent migration blocks:
  one to extend the `sourcing_status` CHECK with `'pursue'`, one to
  rename `stage = 'passed'` rows to `'rejected'` and swap the CHECK.
- `src/app/qualify/QualifyForm.tsx` — `STATUS_LABEL` and `needsOverride`
  follow the same `isPositive` logic so Qualify's override-with-reason
  rule mirrors Sourcing's. Score-panel hint text no longer references
  the removed `recommendedStatus` helper.
- `src/app/qualify/QualifyClient.tsx`, `clients/ClientListView.tsx`,
  `prospects/[id]/ClientPageView.tsx` — `passed` keys renamed to
  `rejected`, label + button copy updated.
- `src/lib/tutorials-content.ts` — real-estate walkthrough updated
  to reflect the Pursue/Qualify split.

### Verified
- `tsc --noEmit` clean.
- `eslint src` clean.

### Still on Dean
- Run `npm run db:migrate` to apply the two new migration blocks
  (CHECK extension + stage rename + row update).
- Manually walk: add a prospect via the form, sort/filter the table,
  edit a row via pencil, save via check, try to Pursue a low-score
  to see the override expansion.

---

## 2026-05-26 — Draft-row glitch + Pass → Reject

Two follow-ups Dean caught in real use.

### Fixed
- **The "16 H prospects" glitch.** `DraftRow.submit` didn't guard
  against concurrent in-flight saves. If a rep typed in the draft
  row, blurred, then immediately interacted with another cell while
  the first save was still over the network (~600ms), the next
  blur called submit again — `setDraft(emptyDraft())` only runs
  after the server response, so the second submit saw the same
  draft and created a duplicate. Added a ref-backed guard: if a
  draft create is already in flight, the next blur is a no-op.
  (`SourcingClient.tsx` — DraftRow.)

### Changed
- **Sourcing status `'pass'` renamed to `'reject'`.** "Pass" was
  ambiguous (could read as "this one passed the bar"); "Reject"
  has only one meaning. Updated everywhere — `SourcingStatus`
  type, the three-state toggle on Sourcing and Qualify, the
  override-with-reason copy, server-side validation
  (`sourcing/actions.ts`), the override "you picked X" message,
  the tutorial copy.
  - Schema migration in `schema.sql` is idempotent: drops the
    old CHECK that allows `'pass'`, UPDATEs existing rows
    `'pass' → 'reject'`, and re-adds the CHECK with the new
    value. Only runs when the old CHECK is still present.
  - **The lifecycle stage `'passed'` is unchanged** — it has the
    same ambiguity, but renaming it is a bigger sweep touching
    many UI strings, `STAGE_LABEL`, `STAGE_NEXT`, and historical
    DB rows. Surface as a follow-up if it bothers in use.

### Verified
- `tsc --noEmit` and `eslint src` clean.

### Still on Dean
- Run `npm run db:migrate` to pick up the `'pass'` → `'reject'`
  row migration and the new CHECK.

---

## 2026-05-26 — P8: Qualify unification (one surface, two modes)

Post-launch refinement caught after Phase E shipped. Phase E's P4.6
delivered two visibly different qualifying pages (`/qualify` for
new agents and `/qualify/[id]` for existing ones) — Dean called
out the misalignment: qualifying is conceptually one job
("carrying the prospect's info from sourcing to qualify"), not
two. This entry unifies them.

### Added
- `src/app/qualify/QualifyForm.tsx` — the shared form. Create
  mode (`prospectId === null`): editable identity, workflow
  picker rendered by the wrapper, no breadcrumb. Edit mode
  (`prospectId` set): read-only identity card with link to the
  full record, breadcrumb back to `/sourcing`. Both modes show
  the same gates, scoring factors, status chooser, override-
  with-reason expansion, live score panel, and save button.
  Both save through `upsertSourcingRow`. After a successful
  create the form pushes to `/qualify/[new-id]` so the rep
  stays on Qualify with the new record loaded.

### Changed
- `src/app/qualify/QualifyClient.tsx` — slimmed to just the
  create-mode wrapper (workflow picker + `QualifyForm` + the
  recent-prospects list). The recent-prospects list now links
  to `/qualify/[id]` instead of `/prospects/[id]`, so clicking
  a recent name resumes qualifying instead of jumping to the
  mini-CRM.
- `src/app/qualify/[id]/page.tsx` — now renders `QualifyForm`
  directly. The breadcrumb + h1 chrome stays in the server page.

### Removed
- `src/app/qualify/[id]/QualifyDetailClient.tsx` — subsumed by
  `QualifyForm`.
- `src/app/qualify/actions.ts` — `createProspect` is no longer
  used; `upsertSourcingRow` handles create and update in one
  path.

### Decision
- **D-033** added to BUILD-PLAN §10 — locks in the unified
  intent.

### Verified
- `tsc --noEmit` and `eslint src` clean.

---

## 2026-05-26 — Phase E complete: Sourcing + Qualify restructure

The sales pipeline gained a list-intake surface and the qualifying
flow got rebuilt around it. `/research` is now `/qualify` — the deep
work on one prospect. A new `/sourcing` page sits in front for rapid
spreadsheet-style intake from public rankings like RealTrends. Each
sourcing row IS a prospect from row one; clicking it opens
`/qualify/[id]`, a new dedicated per-agent qualifying page. Real-estate
scoring math was reshaped (gates contribute, listings runs piecewise,
`branded_email` dropped, baseline anchored at the gates). Help modals
landed on every qualifying field. A new `/tutorials` section onboards
reps with end-to-end walkthroughs. Wednesday launch deferred to ship
the whole batch as a unit; all phases now verified clean with
`tsc --noEmit` and `eslint src`.

Full detail in `SOURCING-PLAN.md`; decisions logged as D-023 through
D-032 in BUILD-PLAN §10.

### Added — P1 (docs + recovery file)
- **SOURCING-PLAN.md** — the full Phase E plan + decision capture.
  Recoverable across sessions; a future Claude can pick this up cold.
- **BUILD-PLAN.md** — Phase E summary added to §5; decision-log entries
  D-023 through D-031 added to §10 (naming, lifecycle, schema,
  workflow scope, column principles, three-state toggle, content
  authorship, deferred bulk paste, launch slip).
- **CHANGELOG.md** — this entry.

### Added — P2 (schema)
- `prospects` gains five sourcing columns (`sides_count`, `gross_volume`,
  `source_url`, `sourcing_note`, `sourcing_status`) + an index on
  `sourcing_status`. Migration is idempotent and additive; Dean applied
  it locally with `npm run db:migrate`.
- `SOURCING-PLAN.md` §5 finalized the real-estate column set after
  inventorying the existing `/research` fields and the `rank_factors`
  seed. Dean signed off; smaller 1- and 2-point items stay on Qualify
  per D-027.

### Changed — P3 (rename `/research` → `/qualify`)
- `src/app/prospects/page.tsx` → `src/app/qualify/page.tsx` (Option B —
  per-prospect detail page at `/prospects/[id]` stays put).
- `ResearchClient.tsx` → `QualifyClient.tsx` (component renamed too).
- `prospects/actions.ts` → `qualify/actions.ts` (revalidate path updated).
- Sidebar nav: "Research" link → "Qualify."
- CSS classes: `.research-layout` / `.research-score` →
  `.qualify-layout` / `.qualify-score`.
- Forward-looking copy across the app updated — Dashboard empty state,
  Today CTA, Tracking + Client + Rank Factors empty/help text. The
  `Researched {date}` line on the prospect detail page is now
  `Added {date}` (stage-agnostic).
- Historical references in CHANGELOG and BUILD-PLAN preserved.
  BUILD-PLAN gained a heads-up note; LAUNCH-AUDIT and PHASE-D-PLAN
  flag the rename inline.
- `tsc --noEmit` and `eslint src` clean after the rename.

### Added — P4 (`/sourcing` route + spreadsheet UI)
- `src/lib/sourcing.ts` — types, the three-state `SourcingStatus`,
  the per-workflow `buildColumnConfig`, `stageForSourcingStatus`
  helper, and the pure check for the "partial score" indicator.
- `src/app/sourcing/actions.ts` — `upsertSourcingRow` server action
  (create + per-cell update in one path). Re-fetches the workflow's
  rank_factors and recomputes the 0–10 score server-side every save
  (D-028). Status toggles update lifecycle stage only when the
  prospect is in `researching` / `qualified` / `passed` — later
  stages don't reverse from a Sourcing edit (D-024).
- `src/app/sourcing/page.tsx` — server component. Loads every active
  workflow with its scoring config + the rep's existing rows
  (owner-scoped, D-019), builds the column config per workflow, and
  hands it to the interactive client.
- `src/app/sourcing/SourcingClient.tsx` — the spreadsheet itself.
  CSS-Grid table with the workflow's column set: identity columns,
  workflow-specific intake (real-estate gets `sides`/`gross volume`),
  the hard qualifiers (gates + ≥3pt scoring factors from
  `rank_factors`), the Source URL, the three-state Qualify / Pass /
  Undecided toggle, and the one-line note. Every cell autosaves on
  blur with optimistic UI; the score badge re-renders from the
  server's `rank_score` so the pre-score is always math-correct.
  An empty draft row at the bottom materializes a prospect on first
  cell save (only commits once a name is typed). The row's `→` link
  opens `/prospects/[id]` for the deep work.
- Sidebar nav gained the Sourcing item, positioned before Qualify so
  the order matches the flow: Source → Qualify → Track.

### Changed — P4.5 (scoring math overhaul + column trim)
Per Dean's review of P4, applied D-032 and trimmed two Sourcing columns:

- **Scoring math (D-032).**
  - Gates contribute to the 0–10 score. `has_target_listing` and
    `has_photo_need` carry weight 1 each (still gated by
    `gatesPassed()`; entry blocked if either is false).
  - `annual_volume` runs on a piecewise curve in
    `lib/prospects.ts` (`PIECEWISE_CURVES`): 0→0, 10→2.0, 30→3.0,
    capped at 3.
  - `branded_email` dropped as redundant with `pro_website`. The
    `schema.sql` migration sets `active=false` idempotently.
  - `active_social` weight 2 → 1.
  - All scoring call sites (`QualifyClient`, `qualify/actions.ts`,
    `sourcing/actions.ts`) stopped filtering out gate factors.
  - `src/lib/prospects.test.ts` rewritten against the new model.
- **Seed updated** in `scripts/db-seed.mjs` — re-running `db:seed`
  is optional (the SQL migration handles the live DB), but it picks
  up the new help_text and weights for fresh installs.
- **Sourcing columns trimmed.** Dropped `Sides` (listings is a
  close-enough proxy via the `annual_volume` qualifier) and `Note`
  (repurposed as the override-reason inline expansion in the next
  pass). Schema columns (`sides_count`, `sourcing_note`) retained
  in case either is reinstated.

### Added — P4.6 (Sourcing UX surgery + /qualify/[id])

- **`/qualify/[id]` — new dedicated per-agent qualifying page.**
  Server component owner-checks (D-019) and pre-fills every rank
  input from whatever the rep already entered on Sourcing. The
  interactive client (`QualifyDetailClient`) renders the entry
  gates and scoring factors with a live score panel; saving routes
  through the same `upsertSourcingRow` server action Sourcing uses,
  so the two surfaces stay in sync. Identity edits link out to
  the existing `/prospects/[id]` mini-CRM.
- **Lock-after-blur on every text / number / URL cell in Sourcing.**
  `LockableCell` wraps the input. Saved cells display as text with
  a tiny `✎` pencil top-right to re-enter edit mode; clicking the
  locked area (anywhere except the pencil) opens the row's
  `/qualify/[id]`. Empty cells and draft rows stay in edit mode.
  Boolean rank-inputs (gates) and the Status toggle stay
  always-interactive — checkboxes are their own lock state.
- **Dropped the `→` open column.** Locked cells are the click
  target now; clicking the locked area of any text/number/url cell
  in a saved row navigates to `/qualify/[id]`.
- **Override-with-reason inline expansion.** When the rep clicks a
  status that disagrees with the pre-score band's recommendation
  (Qualified band → recommends Qualify; Below the bar →
  recommends Pass; Borderline → no recommendation), an expansion
  drops below the row with a textarea for the reason. ≥20 chars
  required; Save commits status + reason together; Cancel reverts.
  Server-side `upsertSourcingRow` enforces the same rule so the
  invariant holds even if the client is bypassed.
- **Server validates the override rule.** `validateOverride`
  checks every patch that touches `sourcingStatus`. Reasons are
  cleared automatically when the status no longer constitutes an
  override (so an old override note doesn't linger as ambient
  metadata).

### Added — P5 (help modals on /qualify)

- **`HelpBox` component** (`src/components/HelpBox.tsx`). Renders a
  small italic "Where do I find this?" trigger next to a qualifying
  field. Click opens a two-pane modal: left rail with the section
  ToC, right pane with the active section's content. Sections can
  optionally hold tabs for multi-angle topics (e.g. "via Zillow" /
  "via Realtor.com" / "via MLS" for the listings-count field).
  Escape closes; backdrop click closes; rendered content includes
  paragraphs, lists, ordered steps, callouts, and external links.
- **Help content registry** (`src/lib/help-content.ts`). v1 covers
  every real-estate factor — both gates (target listing, photo
  need) and all five scoring factors (annual_volume,
  weak_current_photos, active_social, pro_website, uses_video).
  Keyed by `{workflow_key}.{factor_key}`; absent keys make the
  trigger render nothing, so the qualify pages naturally grow help
  coverage as content lands. Other workflows ship without help
  content for now.
- **Wired into both qualify surfaces.** `QualifyClient` (the entry
  form at `/qualify`) and `QualifyDetailClient` (the per-prospect
  page at `/qualify/[id]`) both render a `HelpBox` next to each
  factor's existing inline help text. Each row component
  (`GateToggle`, `BoolFactor`, `NumberFactor` on the entry form;
  `BoolRow`, `NumberRow` on the detail page) takes a `workflowKey`
  prop so the help lookup is per-workflow.

### Added — P6 (/tutorials section)

- **`/tutorials` route** — new nav item between Today and the admin
  section. Index page shows one card per active workflow; ready
  workflows show the title, subtitle, read time, and a "Read
  walkthrough →" button. Workflows without content yet show a
  faded "Coming soon" card.
- **`/tutorials/[slug]`** — per-workflow walkthrough. Long-form
  article layout: section headers, prose paragraphs, ordered
  steps, callouts. Reuses the `HelpBlockList` renderer from
  HelpBox so the prose styling matches the help modals.
- **`src/lib/tutorials-content.ts`** — v1 content for real-estate.
  Six sections walk the full motion: overview, source from
  RealTrends, qualify deeply, work the contact cycle, send the
  email, what happens next. Drafted by Claude; Dean revises.
  Other workflows ship without tutorials for now and land on the
  index as "Coming soon."

### Verified (P7)
- `tsc --noEmit` clean across the ops codebase.
- `eslint src` clean.
- No stale references to `/research` in code (a single doc comment
  in `qualify/page.tsx` notes the rename for future readers).
- No `Research`-as-page-name UI strings remain anywhere.
- Sourcing → Qualify navigation verified: every `/sourcing` row's
  locked cell area links to `/qualify/[id]`; `/qualify/[id]`
  carries a breadcrumb back to `/sourcing`.
- Override-with-reason rule verified both client-side (UI gates
  Save until ≥20 chars) and server-side (`validateOverride` in
  `sourcing/actions.ts` rejects bad patches; reasons clear when
  status no longer constitutes an override).
- Help triggers render only when content exists for the workflow
  + factor combination — verified `getHelpEntry` returns null and
  `HelpBox` early-returns for missing keys.

### Still on Dean (config, not code)
- Run `npm run db:migrate` to pick up the P4.5 reweighting +
  `branded_email` deactivation.
- Run a real `next build` and `vitest` locally — sandbox can't
  do either (arm64 SWC + rolldown bindings).
- Walk the full flow end-to-end: source from a RealTrends row →
  qualify deeply → run a contact cycle on tracking → close the
  loop. The override-with-reason flow is worth a deliberate test.

---

## 2026-05-22 — Pre-launch audit + fixes

A full pre-launch review of the app — every route, server action, the
auth layer, the schema, and the PDF/email/cron code. Findings and the
go/no-go verdict are written up in `LAUNCH-AUDIT.md`. This entry covers
the audit itself plus the fix batch that followed.

### Added
- **20-second undo on every prospect lifecycle move.** A new generic
  `UndoProvider` (`src/components/UndoProvider.tsx`, mounted in the root
  layout) defers a server action behind a 20-second window with a
  live-countdown toast; pressing Undo discards it and nothing ever runs.
  Wired into Tracking (log contact, mark replied, close out) and the
  client-page stage advances. `runWithUndo` is generic — future call
  sites, including send-to-client, can opt in.

### Fixed
- **M1 — digest cron fails closed.** `/api/cron/digest` returns 503 when
  `CRON_SECRET` is unset rather than running unauthenticated.
- **M2 — quote PDF / detail page no longer 500s on a malformed id.**
  `loadQuoteForUser` validates the id as a UUID (new `isUuid` in
  `db.ts`) and returns a clean 404; same guard added to `/prospects/[id]`.
- **M3 — quote-PDF header rule** now renders behind the title, so the
  italic-Q descender is no longer crossed by the grey divider line.
- **S1 — prospect tab-title leak.** `generateMetadata` on
  `/prospects/[id]` is owner-scoped — a contact's name no longer shows
  in the browser tab for a rep who doesn't own the prospect.
- **S2 — dashboard** redirects logged-out users to `/signin` instead of
  rendering a blank shell.
- **S3 — Tracking** no longer silently swaps in a different prospect
  when the selected one leaves the board; it shows an explicit prompt.
- **S4 — client-page** action handlers are wrapped so a thrown error
  can't freeze the buttons.
- **S5 — digest cron** returns a non-2xx when any send fails, so a
  partially-failed run surfaces in Vercel Cron.
- **P1 — server actions** no longer return raw Postgres text to the
  client; the real error is logged server-side and a plain-English
  message is returned (`src/lib/action-error.ts`).
- **P2 — unsaved-changes guard.** The prospect details form and the
  notes draft warn before a tab close / reload with unsaved edits
  (`src/components/useUnsavedGuard.ts`).
- **P3 — proxy** public-path matching tightened to a segment boundary —
  `/signin-anything` is no longer treated as public.

### Not changed (deliberate — see LAUNCH-AUDIT.md)
- **P4** (database TLS `rejectUnauthorized: false`) — an infra decision;
  hardening it needs the Neon CA cert, not a blind code change.
- **P5** (stage-event actor attribution) — a no-op until prospect
  reassignment exists; revisit then.
- **P6** (array-index React keys; zero-headshot Team Day) — cosmetic;
  left as-is.

---

## 2026-05-22 — Invite-only rep management, stage events, digest email

Reps now onboard through an invite-and-approve flow, every stage change
is logged, and the morning digest can land in a rep's inbox.

### Added
- Invite-only onboarding. `rep_invites` table; `/team` is now the rep
  roster — invite a rep (name, email, role), and they're emailed a
  branded invite. No more editing `ALLOWED_EMAILS` by hand.
- A four-state access lifecycle on `ops_profiles.status` — invited,
  active, suspended, disabled. A rep is never deleted; off-boarding
  sets `disabled` and every prospect, contact, and quote stays
  attributable. The roster activates, suspends, and disables.
- `/awaiting` — the gate page a signed-in but non-active rep sees
  (awaiting activation / suspended / disabled), with a sign-out.
- `prospect_stage_events` — an append-only log of every lifecycle stage
  change, written by a database trigger so nothing can be missed.
- `/api/cron/digest` + a Vercel cron entry — emails the `/today` brief
  each morning to reps who opted in. The opt-in toggle lives on `/today`
  (`ops_profiles.digest_email`, off by default).
- `src/lib/`: `rep-access.ts` (the sign-in gate), `mailer.ts` (Resend
  wrapper), `invite-email.ts`, `digest.ts` (shared digest computation),
  `digest-email.ts`.

### Changed
- `auth.ts` — sign-in is invite-driven (`canSignIn`); first sign-in
  against an invite creates an `invited` profile; the session now
  carries `status`.
- `proxy.ts` — a non-active session is bounced to `/awaiting`;
  `/api/cron` is public (it gates on `CRON_SECRET`).
- `/team` split in two: the roster at `/team`, the supervisor report at
  `/team/activity`.
- The supervisor report's old first-touch proxy is replaced by a real
  metric — **Advanced**, a count of forward stage transitions from
  `prospect_stage_events` (research → tracking → signed).
- `email-allowlist.ts` trimmed to just the bootstrap admin.

### Verified
- `tsc --noEmit` and `eslint` clean across `src`.

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
