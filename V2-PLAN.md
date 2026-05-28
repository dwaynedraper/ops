# V2 — Sharp Sighted Ops

> The plan for V2 on the `v2` branch. **Decisions settled (§3) — ready
> to execute.** Master stays on V1 for live reps; V2 merges in when it's
> done.
>
> Covers: Sourcing polish, the Tracking → Contact rename, the Contact
> rebuild, the app-wide workflow color palette, Qualify polish, the
> Clients re-think, duplicate-check, tutorial visual variety + Corp HS
> content, the limited mobile pass, the Dashboard merge with /today,
> and the testing-DB setup. Print packages move to **v2.1**.

---

## 1. The shift

V1 settled the spine of the system: prospects flow Sourcing → Qualify
→ Contact (renamed from Tracking) → Clients, with a clear lifecycle
and clean data layer. V2 is the **polish-and-fit pass** — every
surface Dean has actually worked in real use, tightened.

The headline moves:

- **Contact is the new Tracking.** App-wide rename. The surface gets
  workflow-color cards, urgency dots, navigable cycle-step tabs, an
  editable email template overhaul, and a "Commit now" out for the
  20s undo.
- **Workflow colors land app-wide.** Gold / Violet / Cyan / Red /
  Fuchsia for RE Media / Corp HS / Story Portraits / Saga / 10% —
  same on Sourcing pills, Qualify accents, Contact cards, Clients
  rows, Dashboard panels.
- **Clients becomes the working master list** with a "Show inactive"
  toggle. Rejected + dormant hidden by default; the toggle reveals
  them with a fade + REJECTED badge.
- **/today merges into Dashboard.** Single morning-look-at surface;
  cron + email digest keep working.
- **Mobile-only for Dashboard + Clients.** Just enough to answer "do
  I need to open a laptop today?" Other surfaces stay desktop.
- **Testing DB.** Second Neon project so we stop testing into prod.

---

## 2. The new shape (mental model carry-over from V1)

The data layer is unchanged from V1. Lifecycle stages, `sourcing_status`
enum, scoring math, owner-scoping, ranking config — all still apply.
V2 is UI + content + small polish.

Sourcing decides "worth qualifying" (D-034). Qualify is the only path
to `stage = qualified`. Contact is the contact cycle. Clients is the
master list. Dashboard is the daily start-here.

---

## 3. Confirmed decisions

Captured in chronological order of decision. Each gets a decision-log
entry in `BUILD-PLAN.md §10` on phase kickoff.

### Sourcing

- **D-035.** Add-prospect to the table sorts to **top** by default.
  Required: load `prospects.created_at` into the `SourcingRow` shape
  so the "newest first" sort is real, not UUID-string-random.
- **D-036.** Every sortable column header shows a subtle ↕ icon
  when it's not the active sort. The active column shows ↑/↓.
- **D-037.** Hard-qualifier checkmarks + status toggle are
  **interactive at all times** on Sourcing rows. Clicking commits
  immediately. The pencil unlocks the other cells for in-place edit.
- **D-038.** Status column widens (or toggle compacts) so
  Pursue/Reject isn't clipped in the active row.
- **D-039.** Row body click → `/qualify/[id]`. Pencil click → edit
  in place. Checkboxes + status toggle → commit, no navigation.
- **D-040.** Custom CSS tooltips on every clickable area, instant on
  hover. ("Move {agent_name} to Qualify" / "Edit row" / etc.)
- **D-041.** Sourcing gets help boxes — per-field on the add-prospect
  form and per-header on the table, with **batch-sourcing-oriented**
  content (different angle from the qualify-time help we shipped in
  V1).

### Qualify

- **D-042.** One-click **Qualify** button on the score panel, visible
  when score ≥ 7 (even in Borderline band). Fast path; the existing
  three-button toggle remains for explicit choices.
- **D-043.** Qualify list filtering:
  - **Default:** pursue + undecided (rejected + qualified both hidden).
  - **"Pursued only" toggle:** narrows further to pursue only.
- **D-044.** Direct entry on Qualify quietly defaults to
  `sourcing_status = 'pursue'`. A rep adding a prospect straight on
  Qualify expects to see it in the list right away.
- **D-045.** Override-with-reason **skips** when no qualifiers have
  been filled in. A fresh direct-entry has band='reject' (score 0)
  but that band isn't meaningful — no override required. The rule
  re-engages the moment any qualifier is set.

### Contact (renamed from Tracking)

- **D-046.** App-wide rename: `Tracking` → `Contact`. Route folder,
  every URL reference, nav label, action revalidations, doc sweep.
  Same shape as the V1 `/research` → `/qualify` rename.
- **D-047.** Email template wording overhaul. New first-touch body:
  > Sharp Sighted Media shoots real estate media in the 121 corridor,
  > from Allen to Southlake. The base package delivers stills, aerial,
  > floor plan, twilight, and a vertical reel, all delivered within
  > 24 hours. One shoot, five deliverables, MLS-ready.
- **D-048.** Standardized signature block on every script:
  ```
  Regards,
  {rep_name} • Sharp Sighted {branch}
  https://{branch_web_address}
  
  Stay Sharp. Stay Seen. Stay Human.
  ```
  Tagline is always the last line. (Closer: Regards. If a better word
  surfaces in revision, update once.)
- **D-049.** Cycle-step tabs are all **navigable** — First touch /
  Follow-up 1 / Follow-up 2 / Final touch. Clicking an inactive step
  shows the script as it was sent, plus a colored badge explaining
  why the step isn't live ("Send Follow-up 1 first." / "Already sent
  Apr 14.").
- **D-050.** 20s undo gets a **"Commit now"** button on the toast.
  Lifecycle moves still get the safety window, but the rep is never
  blocked from forward progress.
- **D-051.** Contact card list per workflow:
  - Card body uses the workflow color (D-053).
  - Status dot moves to the **left** of the card.
  - Dot color = urgency:
    - **Green** — needs action now (reply waiting, first touch ready,
      follow-up due today).
    - **Yellow** — due within 24 hours.
    - **Red** — more than 24 hours overdue.

### Workflow colors — app-wide palette

- **D-053.** The five workflow accent hex values, applied everywhere
  a workflow is named or distinguished:
  - **RE Media** — `#c9922a` (existing brand gold, the Sharp pillar's
    Media accent)
  - **Corp HS** — `#8b5cf6` (violet)
  - **Story Portraits** — `#38bdf8` (brand cyan, the Photos pillar)
  - **The Saga** — `#dc2626` (dramatic red)
  - **The 10% Rule** — `#ec4899` (fuchsia / hot pink)

  Updates: `workflows.accent` seed values; any in-code constants;
  workflow pills on Sourcing / Qualify; Contact cards; Clients rows;
  Dashboard panels.

### Clients

- **D-054.** Cards on `/clients` use the workflow color (D-053).
- **D-055.** Rejected prospects render at ~55% opacity with a small
  red **REJECTED** badge in the corner. Workflow color stays visible
  so the prospect's identity reads correctly (a rejected Saga isn't
  indistinguishable from a rejected RE).
- **D-056.** "Show inactive" checkbox above the list. **Default
  off** — rejected + dormant are hidden. Toggle on reveals both
  (faded, with badges).

### Duplicate-check

- **D-057.** Duplicate-check fires on add-prospect-form save. Match
  on `contact_name` (case-insensitive). Within the rep's own
  prospects only — preserves the owner-scoped visibility rule
  (D-019). If matches exist, show a non-blocking warning with the
  existing prospects' workflow + stage + a "Continue anyway" /
  "Cancel" choice. Common names can false-positive; the rep decides.

### Tutorials + help content

- **D-058.** Block-renderer gains **inline markdown** for paragraph
  blocks: `**bold**` and `[label](url)` parse to bold / hyperlink at
  render time. A new `heading` block type lands too. Existing
  `HelpBlockList` consumers (HelpBox modals, tutorial detail pages)
  pick up the new variety for free.
- **D-059.** Real-estate tutorial gets a revision pass against the
  new block types — replace wall-of-text paragraphs with mixed
  paragraphs / lists / steps / callouts / inline links / bold
  phrases. Tutorial pages should not feel intimidating.
- **D-060.** **Corp HS** tutorial drafted in V2. Story Portraits,
  Saga, and 10% backlog to **after** V2 ships.

### Mobile

- **D-061.** Limited mobile pass: responsive layouts for **Dashboard
  + Clients only**. Other surfaces stay desktop-optimized.
  Goal: a rep on their phone can answer "do I need to open a laptop
  today?" Anything that requires real work (Sourcing batch entry,
  Qualify deep work, Contact cycle messaging) stays on the laptop
  by design.

### Dashboard

- **D-062.** Dashboard work happens **last**. Source surfaces (V2's
  redesigned Sourcing / Qualify / Contact / Clients) must be correct
  before the aggregate view is built. No repetition with the source
  surfaces.
- **D-063.** **`/today` merges into Dashboard.** Becomes a panel
  inside `/`. The `/today` route is removed; nav drops the Today
  link. The Vercel cron + Resend morning-digest emails keep working
  unchanged (they use the digest data, not the page route).

### Sidebar + app-shell

- **D-066.** Sidebar gets a sectioned layout with titles:
  - **Dashboard** (top, no header, single link)
  - separator
  - **TOOLS** — Quote Calculator (renamed from Calculator),
    Tutorials
  - separator
  - **SALES** — Sourcing, Qualify, Contact, Client List (renamed
    from Clients)
  - separator
  - **PRICING & ADMIN** — super-admin only (Rates & Globals,
    Packages, Corporate, Rank Factors, Scripts, Team). Already
    gated client- and server-side; verified, not changed.

  Renames are **display labels only**. URLs stay `/calculator`
  and `/clients`. Routes don't move.

- **D-067.** Sidebar uses sticky positioning (or fixed) so it's
  independent of the page's scroll. If the sidebar's own content
  overflows on a small screen, scrolling happens **inside the
  sidebar.** The theme toggle + sign-out button are pinned to the
  bottom of the sidebar at all times — they never scroll out of
  view, even when the top nav list overflows.

### Infrastructure

- **D-064.** **Second Neon project** stands up as the testing DB.
  Local `.env.local` points at it; Vercel production stays on the
  prod project. Same migration scripts work on both. Documented in
  `README.md`.

### Scope

- **D-065.** Print packages (Story / Saga prints, framed sets,
  museum editions) **do not** ship in V2. They're calculator and
  quote-builder work. **v2.1, first thing after V2 merges.**

---

## 4. The plan, in order

Phases F0 → F12, in dependency order. Each phase ends with a clean
`tsc --noEmit` + `eslint src`, an entry in `CHANGELOG.md`, and a
review with Dean before the next phase starts.

### F0 — Testing DB setup

- Stand up a second Neon project (`sharp-ops-testing` or similar).
- Document the swap in `README.md` (local dev points at the testing
  project's DATABASE_URL; Vercel production stays untouched).
- Run `npm run db:migrate` against the new project so its schema
  matches prod.
- One-time only; doesn't touch the codebase.

### F1 — Sidebar restructure + app-shell sticky positioning

- Restructure `Sidebar.tsx` into the four-section layout from D-066
  (Dashboard / TOOLS / SALES / PRICING & ADMIN). Each non-Dashboard
  section gets a small uppercase title.
- Rename labels: Calculator → **Quote Calculator**, Clients →
  **Client List**. URLs unchanged.
- Pin the theme toggle + sign-out button to the bottom of the
  sidebar (D-067). Sidebar scrolls internally if the top section
  overflows; bottom controls stay static.
- Update `globals.css` `.app-shell` pattern so the sidebar is
  position-sticky (or fixed) with `height: 100vh`, independent of
  page scroll. Main content scrolls separately.
- Cosmetic-only change — no route moves, no schema, no server
  actions. Quick win; lands the new look before everything else
  touches nav references.

### F2 — Sourcing polish

- Add `created_at` to `SourcingRow` server-side; sort default by it
  (D-035).
- Sortable column ↕ indicator (D-036).
- Status column width / toggle compaction (D-038).
- Row body → `/qualify/[id]` link; checkboxes + toggle stay
  interactive in display mode (D-037, D-039).
- Custom CSS tooltip helper component; wire onto every clickable
  area (D-040).
- Help boxes wired into the add-prospect form and the column
  headers (D-041); new batch-oriented content in
  `src/lib/help-content.ts`.

### F3 — Tracking → Contact rename

- Folder rename: `src/app/tracking/` → `src/app/contact/`.
- Nav label, every URL reference, `revalidatePath` calls, doc
  sweep, schema column comments where relevant.
- Single commit.

### F4 — Workflow color palette (D-053)

- Updates the `workflows.accent` seed values to the five new hex
  codes.
- Idempotent schema migration that updates existing
  `workflows.accent` rows if they match the current defaults.
- Sweep any hardcoded hex values in the components (workflow pills,
  card borders, etc.).
- Done before F4 + F6 so the color is correct when those surfaces
  rebuild.

### F5 — Contact page rebuild

- Email template wording overhaul (D-047, D-048); update seed +
  re-seed instructions.
- Cycle-step tabs all navigable; inactive-step badges (D-049).
- 20s undo: "Commit now" button on the toast — update
  `UndoProvider` (D-050).
- Card list: workflow color body, status dot moved to left,
  urgency color logic (green ≤ now / yellow ≤ 24h / red overdue)
  (D-051). Reuses the existing "Needs follow-up" query from
  Phase B (D-020).

### F6 — Qualify polish

- One-click Qualify button on the score panel, visible at score
  ≥ 7 (D-042).
- Qualify list filter — hide rejected + qualified by default,
  "Pursued only" toggle (D-043).
- Direct-entry default: `sourcing_status = 'pursue'` (D-044).
- Skip override-with-reason when no qualifier inputs are filled
  (D-045). Apply on both client AND server (`needsOverride`
  helper).

### F7 — Clients re-think

- Workflow color on each row card (D-054).
- Rejected: fade + REJECTED badge (D-055).
- "Show inactive" checkbox — default hides rejected + dormant
  (D-056).
- Row click navigation (likely to `/prospects/[id]`, but confirm).

### F8 — Duplicate-check

- New `findOwnedDuplicates(name, ownerId)` server helper.
- Wire into `AddProspectForm` on Sourcing and the Qualify create
  flow.
- Warning UI — modal or inline panel — listing matched prospects
  with workflow + stage. "Continue anyway" / "Cancel" choice.
- Within owner only (D-057).

### F9 — Tutorial block enhancements (D-058)

- Add `heading` block type to `HelpBlock` union.
- Parse `**bold**` and `[label](url)` in paragraph text at render
  time (tiny inline markdown parser, no library).
- Update `HelpBlockList` (in `HelpBox.tsx`) to render the new
  variety.

### F10 — Tutorial content revisions + Corp HS (D-059, D-060)

- Real-estate walkthrough revised with the new block variety
  (mixed paragraphs, lists, steps, callouts, links, bold phrases).
- **Corp HS** walkthrough drafted from scratch.
- Story Portraits / Saga / 10% backlog for post-V2.

### F11 — Mobile pass (D-061)

- Responsive CSS on `/` (Dashboard) and `/clients`.
- Touch-friendly button sizes, vertical layout for stacked cards.
- Other surfaces stay desktop-optimized.

### F12 — Dashboard + /today merge (D-062, D-063)

- Build the Dashboard layout: aggregates from Contact, Qualify,
  Clients, and the morning-digest data.
- Fold `/today`'s content into a Dashboard panel.
- Remove the `/today` route + nav link.
- Verify the email-digest cron still fires (server-side reads,
  not the page).

### F13 — Verify + finalize CHANGELOG

- `tsc --noEmit` + `eslint src` clean.
- `npm run db:migrate` on the testing DB; sanity-check the schema
  changes (color palette migration).
- Manual walk through every surface end-to-end.
- Promote in-progress CHANGELOG entries to a finalized V2 release
  entry.
- Decision log D-035 → D-065 land in BUILD-PLAN §10.
- Ready to merge `v2` → `main`.

---

## 5. Schema changes

V2 is mostly additive UI work, but two real changes:

1. **`workflows.accent`** — update seed to D-053 hex values. Migration
   block updates existing rows only when they still match the V1
   defaults (don't clobber any manual edits).
2. **`prospects.created_at`** — already exists; just needs to be
   surfaced in the SourcingRow shape and the server query.

No new tables, no destructive changes.

---

## 6. v2.1 (queued)

- **Print packages.** Add the Story Portraits + Saga print-collection
  pricing into the calculator + quote builder. Standalone print
  packages (Gift, Fine Art, Heirloom) + add-on print upgrades.

---

## 7. Out of V2 (backlog for after v2.1)

- Story Portraits / Saga / 10% tutorial walkthroughs.
- Help-box content for the four non-real-estate workflows.
- Cross-sell linked prospects (an RE agent who also wants headshots).
- Anything that surfaces during V2 review that we decide to defer.

---

## 8. Decision log entries for `BUILD-PLAN.md §10`

Adds on V2 kickoff:

- **D-035** Sourcing add-prospect sorts to top by created_at
- **D-036** Sortable column header ↕ indicator
- **D-037** Sourcing checkboxes + status always interactive
- **D-038** Status column widens to fit toggle
- **D-039** Sourcing row body → `/qualify/[id]` (not in-place edit)
- **D-040** Custom CSS hover tooltips
- **D-041** Sourcing help boxes (batch-oriented content)
- **D-042** One-click Qualify button at score ≥ 7
- **D-043** Qualify list filter (default pursue + undecided; toggle pursue-only)
- **D-044** Qualify direct-entry defaults to `pursue`
- **D-045** Override-with-reason skips when no qualifiers filled
- **D-046** Tracking → Contact app-wide rename
- **D-047** Email first-touch wording overhaul
- **D-048** Standard signature block on every script
- **D-049** Cycle-step tabs all navigable with inactive-step badges
- **D-050** 20s undo gains "Commit now" button
- **D-051** Contact card workflow-color + urgency dot
- **D-053** App-wide workflow color palette
- **D-054** Clients cards use workflow color
- **D-055** Rejected = fade + REJECTED badge (workflow color preserved)
- **D-056** "Show inactive" toggle on Clients (default off)
- **D-057** Duplicate-check on add-prospect, within owner only
- **D-058** Inline markdown + heading block type in HelpBlock
- **D-059** Real-estate tutorial revised with mixed blocks
- **D-060** Corp HS tutorial drafted; Story / Saga / 10% backlog
- **D-061** Mobile pass: Dashboard + Clients only
- **D-062** Dashboard work happens last
- **D-063** `/today` merges into Dashboard as a panel
- **D-064** Second Neon project for testing DB
- **D-065** Print packages → v2.1
- **D-066** Sidebar sectioned layout (Dashboard / TOOLS / SALES / PRICING & ADMIN) + display-label renames (Calculator → Quote Calculator, Clients → Client List)
- **D-067** Sidebar sticky positioning + internal scroll with pinned bottom controls

(D-052 intentionally skipped — keeps numbering aligned across what
ended up being a single workflow-color decision rather than two.)

---

*Stay Sharp. Stay Seen. Stay Human.*
