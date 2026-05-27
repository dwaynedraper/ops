# Phase E — Sourcing + Qualify Restructure

> The plan for the next build of Sharp Sighted Ops. **Decisions settled
> (§3) — ready to execute.** On kickoff this graduates into BUILD-PLAN §5
> and its decision log (as D-023 onward).
>
> Covers: a new Sourcing surface in front of Research (renamed Qualify),
> contextual help modals on Qualify, a new Tutorials section in the
> dashboard, and the order in which all of it gets built.

---

## 1. The shift

Today, a rep finds a candidate (often by browsing a public ranking like
RealTrends), then sits down at `/research`, types one agent's details
top to bottom, scores them, and either qualifies them or drops them.
Reasonable for one agent at a time. Painful for triaging a list of
fifty.

Phase E adds the **list-intake surface that's been missing** — a
spreadsheet-style page where a rep can drop ten or fifty names from a
public source in a single sitting, fill in the hard qualifiers per row,
flag each as Qualify / Pass / Undecided, and click any name through to
the deep per-agent page. The per-agent page is renamed from "Research"
to "Qualify" to reflect what it actually is: the deep work on a single
prospect, not the wide intake.

Alongside that, two adjacent gaps get closed:

- **Contextual help on Qualify.** Each field on the qualifying page gets
  an optional "Where do I find this?" link that opens a modal with a
  left-rail ToC, right content pane, and optional tabs. Reps stop
  needing to know the answer in advance — the answer is one click away.
- **A Tutorials section.** A new dashboard area with one tutorial per
  workflow, walking a new rep through the full motion: Sourcing →
  Qualify → Tracking → Email. Broad-overview content, onboarding-grade,
  so a partner can get oriented without a packet.

The Wednesday launch slips to make room for this. New target: when it's
done.

---

## 2. The new shape

**Old flow (today):**
`/research` (one agent at a time) → `/tracking` → `/clients`

**New flow (after Phase E):**
`/sourcing` (rapid list intake, many rows) → `/qualify` (the deep work
on one prospect, formerly `/research`) → `/tracking` → `/clients`

Both `/sourcing` and `/qualify` are per-workflow, matching the existing
per-workflow `/research` architecture. Each workflow gets its own
sourcing table with its own column set (real-estate has sides/volume/
market; corporate-headshots will get firm-size/department/role when its
sourcing source is identified). At launch only the real-estate workflow
will have a populated column set; the others can be added as sources
emerge.

---

## 3. Confirmed decisions

These come straight from the kickoff conversation (2026-05-25 / -26).
None of these are revisable without a follow-up decision log entry.

### 3.1 Naming · D-023

The new surface is **Sourcing**. The existing `/research` page is
renamed to **Qualify**. The naming maps to what the rep is actually
doing at each step — sourcing names, then qualifying individuals.

### 3.2 Lifecycle integration · D-024

A sourcing-table row **IS** a prospect record from row one. Lifecycle
stage is `researching` until promoted. Clicking the name opens the
existing per-prospect page (now `/qualify`). No new pre-prospect stage,
no separate `leads` table — one entity, one source of truth.

### 3.3 Schema · D-025

Additive only. The existing `prospects` table almost certainly covers
most of what sourcing needs; Phase 2 audits what's there and adds any
missing columns (likely `sides_count`, `gross_volume`, `market_city`,
`source_url`) via an idempotent migration. No destructive changes.

### 3.4 Workflow scope · D-026

Per-workflow tables. Mirrors the existing `/research` architecture —
each workflow already owns its own routes and config. Real-estate ships
populated at launch; other workflows will get column sets as their
sources are identified.

### 3.5 Sourcing column set principles · D-027

The sourcing table carries **hard qualifiers + intake fields only** —
the high-point qualifier items and the data that's available during
sourcing (from a RealTrends row or equivalent). Smaller 1- and 2-point
supporting items live on the qualify page where they belong.

For the real-estate workflow specifically (subject to Phase 2 audit):

| Column | Why |
| --- | --- |
| Contact name | Intake — usually the only field RealTrends gives. |
| Agency / org | Intake. |
| Market (city) | Intake — drives territory fit. |
| Sides per year | Intake (often present on the source list). |
| Gross volume | Intake (often present on the source list). |
| Listings per year | Hard qualifier — primary fit signal. |
| Target listing photo need | Hard qualifier — primary fit signal. |
| Source URL | Intake — where the row came from. |
| Status | Qualify / Pass / Undecided (manual, three-state). |
| Pre-score badge | Calculated from filled hard qualifiers; advisory only. |
| Notes | One-line free text. |

**Explicitly NOT on the sourcing table** (Dean's call): *"current listing
photos are weak"* and similar observation-driven fields. These require
the rep to actually look at the agent's listings — that's research work,
not intake work. They live on the qualify page.

The final column set per workflow is locked in Phase 2 after the audit.

### 3.6 Qualify / Pass toggle · D-028

**Three-state manual toggle (Qualify / Pass / Undecided) with a
calculated pre-score badge as a hint.** The rep decides; the system
advises. Auto-determining the toggle was considered and rejected: the
sourcing data is too thin for an automated rule to be useful (the most
predictive qualifier — *photo need* — can't be filled from a public
list), and override fatigue is a known anti-pattern.

The pre-score is a calculated signal (Strong / Maybe / Weak, or a
number) derived from whichever hard qualifiers are filled in so far.
Same intuition lift as a Salesforce-style lead score; none of the
auto-disqualify risk.

### 3.7 Content authorship · D-029

For help modals and tutorials: **Claude drafts v1, Dean revises.**
Drafts are based on what's already inferable from the schema, the
existing pages, and the brand bible. Dean's edit pass is much faster
than authoring from scratch on a blank page.

### 3.8 Bulk paste · D-030

**Deferred to v2.** The v1 sourcing table is one-row-at-a-time entry
only. Dean wants reps to add prospects intentionally — selecting them
one by one — rather than dumping a clipboard. A future clipboard-paste
feature can land later without changing the data model.

### 3.9 Launch date · D-031

**Wednesday launch slips. New date: when it's done.** Phase E ships as
a unit; partial slices weren't worth the disruption.

---

## 4. The plan, in order

### Phase 1 — Docs + recovery file (in progress)

- `ops/SOURCING-PLAN.md` (this file) — captures every decision so
  the work is recoverable across sessions.
- `ops/BUILD-PLAN.md` — Phase E added to §5, decision-log entries
  D-023 through D-031 added to §10.
- `ops/CHANGELOG.md` — Phase E placeholder added so the in-flight
  history of the restructure has a home.

### Phase 2 — Schema audit + column-set proposal

- Inventory every field on every existing `/research` page (per
  workflow), every column on `prospects`, every entry in `rank_factors`.
- Cross-reference against the §3.5 sourcing column principles.
- Write the **finalized** sourcing column set per workflow into §5 of
  this file. Real-estate ships populated; other workflows may ship with
  intake-only columns and grow over time.
- Write a migration adding any missing columns. Additive only;
  idempotent; safe to re-run.
- Run `npm run db:migrate`.
- Dean signs off on the proposed column set before Phase 4 starts.

### Phase 3 — Rename `/research` → `/qualify`

- Folder rename: `src/app/research/` → `src/app/qualify/`.
- Update every route reference: nav links, internal `<Link>` hrefs,
  `redirect()` calls, server actions, tests.
- Update every doc mention: `BUILD-PLAN.md`, `CHANGELOG.md`, `README.md`,
  `PHASE-D-PLAN.md`, `CLAUDE.md`, `LAUNCH-AUDIT.md`.
- Single commit so the rename reads cleanly in git history.
- `tsc --noEmit` + `eslint src` clean.

### Phase 4 — Build `/sourcing` (the headline feature)

- Per-workflow route — same shape as `/qualify` (formerly `/research`).
- Spreadsheet-style data grid component.
- Typed cells per column — text, number, currency, URL, dropdown, the
  three-state toggle.
- Debounced autosave on cell blur — every keystroke gets buffered, then
  saved when the cell loses focus.
- Optimistic UI — the row updates locally before the server confirms.
- Pre-score badge — calculated client-side from the filled hard
  qualifiers, displayed next to the status toggle.
- New-row affordance — an empty row at the bottom that materializes
  into a prospect record on first keystroke.
- Delete-row affordance — soft delete (lifecycle → `passed` with a
  reason of "removed during sourcing"). Reps can't truly destroy
  records.
- Row click — navigates to `/qualify/[workflow]/[prospect-id]`.
- Empty state — "No prospects sourced yet. Type a name to start."
- Bulk paste — explicitly not in v1.

### Phase 5 — Help modals on `/qualify`

- A reusable `<HelpBox>` component (`src/components/HelpBox.tsx`):
  - Trigger: text link like "Where do I find this?"
  - Modal layout: header + close, left-rail ToC, right content pane.
  - Optional tabs inside a section for multi-angle topics.
  - Content type: structured TS objects keyed by topic — no MDX overhead.
- Per-field help on `/qualify` — every entry-gate field and every
  scoring field gets a help link. Per-workflow content (the answers to
  "where do I find listings per year" differ for real-estate vs.
  corporate).
- v1 content authored by Claude, revised by Dean.

### Phase 6 — `/tutorials` section

- New `/tutorials` route + nav item.
- Index page listing tutorials per workflow.
- Each tutorial: long-form structured content walking the full motion —
  Sourcing → Qualify → Tracking → Email — with screenshots optional.
- Content type: structured TS objects (same approach as help modals),
  so a future move to MDX is a copy-paste away if Dean wants it.
- v1 content authored by Claude, revised by Dean.

### Phase 7 — Verify + finalize CHANGELOG

- `tsc --noEmit` clean.
- `eslint src` clean.
- Manual walk through the full new flow: source a prospect, qualify
  them, advance through tracking, drop into clients.
- Promote the Phase E placeholder in `CHANGELOG.md` to a real entry
  with the Added / Fixed / Not changed sections filled in.
- Promote Phase E in `BUILD-PLAN.md` to "complete" with the date.

---

## 5. Schema additions (proposed — finalized in Phase 2)

Subject to the Phase 2 audit. Most of these may already exist on the
`prospects` row in some form; the audit confirms which.

```sql
-- prospects table — sourcing-relevant columns
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS sides_count integer;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS gross_volume numeric(14, 2);
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS market_city text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS source_url text;

-- sourcing status — three-state toggle
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS
  sourcing_status text CHECK (sourcing_status IN ('qualify','pass','undecided'))
  DEFAULT 'undecided';
```

The pre-score is **not stored** — it's a derived value calculated on
read from the filled hard qualifiers. Storing it would introduce drift
the moment scoring config changed.

---

## 6. Open items

Three things parked for a later pass; none block Phase E shipping.

1. **Detail page for the 10% archive on the public studio.** Out of
   scope for ops; tracked in the public studio backlog.
2. **A `/qualify` page redesign.** The page is being renamed in Phase
   3; the help modals get added in Phase 5. A larger redesign (layout,
   field grouping) isn't planned for Phase E but may surface as a
   follow-up.
3. **Bulk paste on `/sourcing`.** Explicitly v2 per D-030. Revisit if
   reps end up wanting it after using v1 in the wild.

---

## 7. Decision log entries (for BUILD-PLAN §10)

To be added on Phase E kickoff:

- **D-023** · Sourcing + Qualify naming (Phase E)
- **D-024** · Sourcing row IS a prospect, no new lifecycle stage
- **D-025** · Schema is additive only; no new tables
- **D-026** · Sourcing tables are per-workflow
- **D-027** · Sourcing carries hard qualifiers + intake fields only
- **D-028** · Three-state manual toggle + advisory pre-score badge
- **D-029** · Help / tutorial content drafted by Claude, revised by Dean
- **D-030** · Bulk paste deferred to v2 — intentional one-row entry
- **D-031** · Wednesday launch slips to ship Phase E

---

*Stay Sharp. Stay Seen. Stay Human.*
