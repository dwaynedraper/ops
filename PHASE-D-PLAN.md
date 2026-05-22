# Phase D — Multi-Workflow Pipeline

> The plan for the next build of Sharp Sighted Ops. **Decisions settled
> (§10) — ready to execute.** On kickoff this graduates into BUILD-PLAN §5
> and its decision log (as D-022 onward).
>
> Covers: a research workflow per offering, the Client List, the Sprout
> Studio handoff, recommended additions, and the build sequence.

---

## 1. The shift

Ops was built as **one pipeline** — researching real estate agents, scoring
them, working a contact cycle, signing them. Every part of it quietly
assumes that: the rank factors talk about listings, the entry gate asks
about a target listing, the scripts are in Sharp Sighted Media's voice, and
a prospect is an "agent" with an "agency".

But Sharp Sighted serves several very different buyers. A company booking a
Team Day is not an agent. A founder at a legacy milestone is not a real
estate lead. A cause receiving contributed work is not a buyer at all.

**Phase D turns the single pipeline into a multi-workflow pipeline** —
**five** workflows, each with its own entry gate, scoring factors, contact
scripts, and vocabulary, all running on the same Research → Tracking →
Client → Dashboard machinery already built. The engine doesn't change. What
plugs into it becomes per-workflow.

---

## 2. The five workflows

| Workflow | The prospect is… | Entry gate (both true) | Sells |
| --- | --- | --- | --- |
| **Real Estate Media** *(exists)* | A producing agent in the 121 corridor | A live target listing · a visible photo need | Essentials, Visibility Retainer |
| **Corporate Headshots** | A company or firm (contact: HR, office manager, a partner) | A team large enough to matter · weak / dated / mismatched current photos | Single Executive, Team Day |
| **Story Portraits** | An individual with a public profile — founder, exec, creator, author | A public-facing personal brand · weak, generic, or DIY current photos | Verse, Story, print collections |
| **The Saga** | A founder at a milestone — the legacy build | A real milestone or legacy reason · budget capacity for an $8k+ engagement | Saga |
| **The 10% Rule** | A cause, organization, or recipient of contributed work | On the §7.1 cause list · non-polarizing per §7.2 | — (contributed) |

Each workflow's **scoring factors** are genuinely different:

**Corporate Headshots** — headcount in a workable band (≈8–40), a
professional-services firm (law, finance, agency, medical, consulting),
visible inconsistency in current team photos, recent hiring or growth, a
brand refresh or new website underway, inside the service area.

**Story Portraits** — an active public presence (speaking, publishing, a
real personal site), a concrete reason now (new book, new role, rebrand,
the speaking circuit), generic or outdated current images, a demonstrated
willingness to invest in being seen.

**The Saga** — a founder whose life and work have merged, a milestone year,
a story big enough to need it, budget capacity, and — often — an existing
relationship (a past Story client, or a referral). Saga is *by inquiry
only* (CLAUDE.md §4), so its workflow leans toward nurturing a warm
relationship rather than cold outreach: fewer scripts, more judgment.

### How the 10% Rule workflow differs

The 10% workflow uses the same machinery, tuned for *contribution* rather
than sales:

- The prospect is a cause, organization, or recipient — not a buyer.
- The entry gate is the §7.1/§7.2 fit check: the cause is on Dean's
  supported list, and it's non-polarizing.
- The scoring factors become **fit-and-priority signals** — a clear need,
  a story worth telling, the capacity to deliver it well — used to choose
  which 10% opportunities to take, since 10% capacity is finite.
- There is **no quote and no dollar figure**. On the client page, the
  embedded calculator is suppressed for a 10% prospect.
- Scripts are written as an offer to contribute, not a pitch.

It earns its place: the 10% Rule is central to the brand (CLAUDE.md §7) and
"10% Tracking" was already on the post-MVP roadmap — the multi-workflow
architecture absorbs it almost for free.

---

## 3. Schema changes

A `workflows` table becomes the spine. Config tables get scoped to it; the
prospect record gets generalized; a `handoff_links` table is added for §8.

**New — `workflows`**
`workflow_key` (PK · `real_estate` | `corporate` | `story_portraits` |
`saga` | `ten_percent`), `name`, `branch` (`realestate` | `corporate` |
`portraits` | null — so the client-page calculator can default correctly;
null for 10%), `contact_noun` (`Agent` | `Contact` | `Executive`),
`org_noun` (`Agency` | `Company` | `Organization` | null), `accent` (a color
for Client-List group chips), `active`, `sort_order`.

**Scoped to a workflow**
- `rank_factors` — gains `workflow_key`; primary key becomes
  `(workflow_key, key)`.
- `rank_config` (thresholds) — gains `workflow_key`.
- `contact_scripts` — gains `workflow_key`; uniqueness becomes
  `(workflow_key, stage_key)`.
- `prospects` — gains `workflow_key`.

**New — `handoff_links`** *(see §8)*
`(workflow_key, link_key)` PK, `label`, `url`. Per-workflow Sprout / handoff
links, referenced from scripts by placeholder.

**The entry gate, generalized**
The two hard-coded booleans (`has_target_listing`, `has_photo_need`) are
replaced by an `is_gate` flag on `rank_factors`: a gate is a yes/no factor
marked as a gate. A workflow's gate is its set of `is_gate` factors — all
must be true to enter. Per-workflow, editable, no schema change per gate.

**Prospect identity, generalized**
`agent_name` → `contact_name`, `agency` → `org_name`. The UI labels them per
the workflow's `contact_noun` / `org_noun`.

**Migration — clean rebuild (Decision 2: test data only).**
A `--fresh-crm` migrate flag drops and recreates the six CRM tables
(`prospects`, `rank_factors`, `rank_config`, `contact_scripts`,
`prospect_contacts`, `prospect_notes`) plus the two new tables, then the
seed loads all five workflows with their default factors, scripts, and
links. No careful data migration needed — fast and clean. (Catalog, quotes,
and auth tables are untouched.)

---

## 4. The Research page, per workflow

A **workflow picker** at the top — a segmented control across the five.
Picking one reshapes the page: the entry gate shows that workflow's gate
factors, the scoring section shows its factors, the identity fields use its
vocabulary, and `createProspect` stamps the chosen `workflow_key`. The
owner's prospect list at the bottom gains a workflow badge per row.

---

## 5. The editors, per workflow

The CRM-config editors gain a **workflow selector** at the top:

- **Rank Factors** (`/rank-factors`) — pick a workflow, edit *its* factors
  and thresholds. A new "Gate" toggle marks a factor as an entry gate.
- **Scripts** (`/scripts`) — pick a workflow, edit *its* scripts **and its
  handoff links** (§8) — scripts and the links they reference, in one
  place.

Publish actions scope every write by `workflow_key`. Draft-until-Publish
(D-012) is unchanged.

---

## 6. The Client List

A new page — **`/clients`, "Clients"** — the master view that's missing
today.

- **Group toggles.** A chip per workflow. Click a chip to show only that
  group; toggle a chip off to hide it. Multiple can be on at once.
- **Stage filter** — Researching → … → Client, plus Passed / Dormant.
- **Search** by name or organization.
- **Columns:** name, organization, workflow, stage, score, last activity.
- Each row links to the client page (`/prospects/[id]`).
- **Owner-scoped (Decision 4)** — a rep sees their own; a super-admin sees
  all.

New sidebar item: **Clients**.

---

## 7. Tracking + Dashboard, per workflow

- **Tracking** — a workflow badge per prospect and a workflow filter. Each
  prospect's contact cycle is computed against *its workflow's* scripts.
- **Dashboard** — pipeline counts and the follow-up queue group by
  workflow; the qualified-target banner reads each workflow's own target.

---

## 8. The Sprout Studio handoff — links, not webhooks

**No webhook (Decision 5).** This is the right call: a webhook to Sprout
adds an external dependency and a feasibility unknown for no real gain when
the rep is already crafting the email by hand with the link in front of
them. Skipped cleanly.

Instead — **handoff links as config-backed placeholders:**

- `handoff_links` holds, per workflow, a set of links — each a `key`, a
  `label`, and a `url` (e.g. `story_portraits` → `booking_link` → the
  connection-call booking URL).
- Scripts reference a link by placeholder — `{{booking_link}}`.
- Placeholders now come in two kinds. **Human** ones (`{{first_name}}`,
  `{{intro}}`) the rep fills at compose time. **Config** ones
  (`{{booking_link}}`) resolve automatically from `handoff_links` — the rep
  never types them or sees an input for them; the composed message simply
  carries the live URL.
- Edit a link once in the links editor and every script that uses it is
  instantly current. **Changing a Sprout URL never means touching a
  script** — exactly the "turns into a variable in the email" model.

Editing lives in the Scripts editor's **Handoff links** panel (§5). The
same links will power the send-to-client flow when that's built.

---

## 9. Recommended additions

Beyond the core, worth putting on the table (the 10% Rule has graduated
into the core — §2):

1. **Per-workflow vocabulary** *(in scope for D)* — the `contact_noun` /
   `org_noun` labels. The difference between each workflow feeling native
   and feeling like the real-estate tool with a hat on.
2. **Daily follow-up digest** *(recommended)* — a scheduled morning email
   per rep: "3 follow-ups due, 1 new prospect qualified." D-020 left the
   door open; the platform supports scheduled tasks. The biggest "faster
   day" win available.
3. **Duplicate / "already in the pipeline" check** *(in scope for D)* — on
   Research, warn if the org, email, or domain already exists in any
   workflow, and show it.
4. **Cross-sell — linked prospects** *(late Phase D / v1.1)* — let a
   prospect spawn a linked prospect in another workflow (a Corporate
   client's CEO is a natural Story Portraits or Saga prospect).
5. **Mobile pass** *(polish)* — reps work in the field; still outstanding.
6. **Dead-nav cleanup** *(housekeeping)* — `/today` and `/team` point at
   routes that don't exist; remove or build them.

---

## 10. Decisions settled

- **D-1 · Five workflows** — Real Estate Media, Corporate Headshots, Story
  Portraits, The Saga, The 10% Rule. Story Portraits and The Saga are
  separate workflows (different buyer, different sell).
- **D-2 · Clean rebuild** — the CRM tables hold only test data, so D1 drops
  and recreates them and re-seeds. No careful data migration.
- **D-3 · The 10% Rule is a full workflow** — tuned for contribution (§2).
- **D-4 · Client List is owner-scoped** — a rep sees their own; super-admin
  sees all.
- **D-5 · No Sprout webhook** — Tier-1 handoff links only (§8).
- **D-6 · Workflow display names** — as listed in D-1.

These graduate into BUILD-PLAN's decision log (D-022…) at kickoff.

---

## 11. Build sequence

| Step | What | Depends on |
| --- | --- | --- |
| **D1** | Schema + `workflows` foundation: `workflows` + `handoff_links` tables, workflow_key scoping, `is_gate`, identity rename; clean rebuild + reseed all five workflows with default factors, scripts, links | — |
| **D2** | Multi-workflow Research page (picker, adaptive gate / factors / labels) | D1 |
| **D3** | Multi-workflow editors — Rank Factors + Scripts; Scripts editor also edits handoff links | D1 |
| **D4** | The Client List page | D1 |
| **D5** | Multi-workflow Tracking + Dashboard (badges, filters, per-workflow scripts + targets) | D1 |
| **D6** | Config-backed link placeholders — resolution wired into the contact-cycle composer | D1, D3 |

D1 is the gate — everything depends on it. D2–D5 can then move in any
order. The recommended additions slot in once D1 lands.

---

## 12. Parked — PDF fonts

Tracked so it isn't lost: the quote PDF renders in @react-pdf's built-in
Helvetica / Times faces. Registering the brand faces — Playfair Display +
Montserrat — via `Font.register` in `QuotePdf.tsx` (the swap point is
marked) is a polish task for Phase D, pending the `.ttf` font files.

---

*Stay Sharp. Stay Seen. Stay Human.*
