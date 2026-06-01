# The Calendar & Google Sync — Implementation Plan

> Phase 6 of the Ops arc. A real calendar inside Ops for the work that
> isn't a Job — record, edit, post, and anything else that needs to be a
> **fixed hour, not a someday** — two-way synced with the business Google
> Calendar in Dean's Workspace.
>
> Reference for: the build, future AI agents, and Dean's own use. Same
> conventions as the prior plans (additive idempotent migrations, raw
> `sql`/`sqlOne`, owner-scoped server actions, pure-core + thin-loader libs
> with Vitest, a `CHANGELOG.md` entry per sub-phase).

---

## 0. The north star — this is accessibility, not a feature

Dean is autistic. The value of this calendar is **not** "scheduling." It is
the conversion of *"I'll do that at some point"* into *"2:00–3:00pm Tuesday,
fixed."* The someday-pile is the thing that fails him; a concrete, visible,
unmissable block is the thing that works. Every design decision in this
phase is made through that lens. Concretely, that means:

- **No ambiguous states.** A block has a real start time and a real
  duration. There is no "sometime today" bucket. If it's on the calendar,
  it has a when.
- **The when is the loudest thing on screen.** Time and duration read first;
  everything else is secondary.
- **It chases him.** A block is not passive — it pings (email now, §6) so
  nothing relies on him remembering to look.
- **Low-friction to place, hard to leave vague.** Creating a block defaults
  to a concrete hour; you can adjust, but you can't easily make it fuzzy.
- **Calm, uncluttered surface.** One clear view at a time, his choice of
  day or week. No competing noise. (Matches the dashboard "keep it calm"
  intent from the original interview.)

This section is the acceptance test for the whole phase: if a change makes
the *when* less concrete or less visible, it's wrong, regardless of how
"featureful" it is.

---

## 1. What this is (corrected scope)

- **Not an import.** Dean has no existing content calendar to pull from.
  We are *creating* the calendar in Ops.
- **Authored in Ops, mirrored to Google.** Blocks are created/edited/
  deleted from **either** Ops or Google Calendar; the two stay in lockstep
  (§5).
- **For non-Job work.** Jobs already have their own lifecycle + shoot dates.
  This calendar holds content production (record / edit / post), admin time,
  10% work, anything that should be a hard hour. **Job bookings also appear
  on it** (§4) so one surface shows the whole week.
- **Target:** a **dedicated "Sharp Sighted" calendar** in Dean's existing
  Google Workspace — a single color-coded business layer, separable from
  personal events.
- **Connection:** a **Google Cloud service account with domain-wide
  delegation** — set-and-forget, no expiring token to babysit (§5.1).
- **Sequencing:** **calendar-in-Ops first, Google sync second.** Dean feels
  the accessibility win in days and steers the sync design having lived in
  the calendar.

---

## 2. Data model

### 2.1 `calendar_blocks` (Phase 6A — additive, idempotent)

```sql
-- ─── calendar_blocks ───────────────────────────────────────────────
-- A fixed time block. The spine of the in-Ops calendar. Most blocks are
-- authored here; a block that originated in (or is mirrored to) Google
-- carries the sync columns (added in 6C, below) so the two stay matched.
CREATE TABLE IF NOT EXISTS calendar_blocks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  title         TEXT NOT NULL,                 -- "LinkedIn post", "Record Reel"
  block_type    TEXT NOT NULL DEFAULT 'other'
                  CHECK (block_type IN ('record','edit','post','admin','ten_percent','other')),
  notes         TEXT,

  -- The concrete when. start_at is a timestamptz; we also store the
  -- IANA zone so a block reads at its intended wall-clock time regardless
  -- of where it's viewed (Dean is CT; this keeps DST honest).
  start_at      TIMESTAMPTZ NOT NULL,
  duration_min  INTEGER NOT NULL DEFAULT 60 CHECK (duration_min > 0),
  time_zone     TEXT NOT NULL DEFAULT 'America/Chicago',

  -- Recurrence (6B). Stored as an RFC-5545 RRULE string — the same grammar
  -- Google uses, so sync is a pass-through, not a translation. NULL = a
  -- one-off. Exceptions/edited-instances handled in 6B detail.
  rrule         TEXT,

  -- Optional link to a job, when a block is "prep for / edit of" a shoot.
  job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,

  -- Lifecycle of the block itself (not the content): planned → done, or
  -- skipped. Lets the calendar show "did I actually do it."
  status        TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','done','skipped','canceled')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendar_blocks_owner_start_idx
  ON calendar_blocks(owner_id, start_at);
CREATE INDEX IF NOT EXISTS calendar_blocks_job_idx ON calendar_blocks(job_id);
```

Trigger `calendar_blocks_updated_at` reuses `trg_set_updated_at`.

**Why RRULE rather than a homegrown recurrence shape:** Google Calendar
*is* RRULE. Storing the same string means Phase 6C sync neither translates
nor loses fidelity — "every Tuesday" round-trips exactly. The Ops recurrence
UI (6B) is a friendly front-end that *emits* an RRULE; the storage and the
sync speak Google's native grammar.

### 2.2 Sync columns (added in Phase 6C, additive)

```sql
ALTER TABLE calendar_blocks
  ADD COLUMN IF NOT EXISTS google_event_id   TEXT,   -- the GCal event id
  ADD COLUMN IF NOT EXISTS google_etag       TEXT,   -- for conflict detection
  ADD COLUMN IF NOT EXISTS sync_state        TEXT NOT NULL DEFAULT 'local'
        CHECK (sync_state IN ('local','synced','pending','error')),
  ADD COLUMN IF NOT EXISTS last_synced_at    TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS calendar_blocks_gevent_idx
  ON calendar_blocks(google_event_id) WHERE google_event_id IS NOT NULL;

-- One row holding the account-level sync cursor + connection metadata.
CREATE TABLE IF NOT EXISTS calendar_sync_state (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  google_calendar_id TEXT,            -- the dedicated "Sharp Sighted" cal id
  sync_token      TEXT,               -- incremental-sync cursor
  channel_id      TEXT,               -- push-notification channel (watch)
  channel_expiry  TIMESTAMPTZ,
  last_full_sync  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 3. The views (Phase 6A) — day & week, toggleable

Two server-rendered views over `calendar_blocks`, a toggle between them, and
a date stepper (‹ Today ›). The accessibility rules from §0 drive the look:

- **Day view** — a single vertical time column for one date. Hour gridlines;
  each block a solid card sized to its real duration, the **time + title
  largest**, type as a quiet color stripe. This is the default — one clear
  day, nothing competing.
- **Week view** — seven day-columns, same block rendering, for the at-a-
  glance rhythm ("Tue I record, Thu I shoot"). The Wed/Thu shoot days can
  carry a subtle backdrop tint so the production spine is visible.
- **Block type → color** (reuses existing tokens): record / edit / post /
  admin / 10% / other each get a stable accent so the *kind* of work reads
  pre-cognitively, the same way workflow accents already work elsewhere.
- **"Now" line** on the day/week grid so the present moment is always
  located.
- **Create by clicking a time slot** — opens the block editor pre-filled to
  that hour, 60-min default. Drag-to-resize is a 6B nicety, not 6A.

A new `/calendar` route + `Sidebar` link (placed near the top — this is a
daily surface).

## 3.1 The block editor

A modal/panel that mirrors a Google event's powers (Dean's bar: "same powers,
different skin"):

- Title, type, date, **start time**, **duration** (default 60, adjustable),
  notes.
- **Recurrence** (6B): None / Daily / Weekly on … / Custom — emitting an
  RRULE. Same affordance shape as Google's "Does not repeat ▾".
- Optional **link to a Job**.
- Status (planned / done / skipped) so the calendar doubles as a "did I do
  it" record.

---

## 3.2 The dashboard 8-day glance (Phase 6A)

A slimmed-down strip on the **dashboard** — not the full calendar, a
remember-it-at-a-glance band. Per Dean's exact spec:

- **8 days total: today + the next 7.**
- **Laid out in true wall-calendar weekday columns** (Sun…Sat), so it
  reads like the block on a month wall calendar. Because 8 days can't sit
  in one Sun–Sat row, it **spans two rows** — the days *before* today in
  the first week render as empty cells, so every item lands under the
  weekday column you'd expect.
- *Example, today = Wed Aug 19:* row 1 = `[· · · Wed19 Thu20 Fri21 Sat22]`,
  row 2 = `[Sun23 Mon24 Tue25 Wed26 · · ·]`. Always 2 rows × 7 columns = 14
  cells; exactly 8 are "in window."
- **The day name is the loudest label** (Dean: "days are easier to remember
  short term than numbered dates"). Weekday header row across the top;
  inside each cell the weekday reads first, the date number is secondary,
  and blocks/shoots show as small type-colored chips.
- **Today's cell is unmistakably marked.** Empty/out-of-window cells are
  dimmed, not hidden, so the grid shape holds.
- Clicking a day deep-links into the full `/calendar` day view for that
  date.

This is its own pure function (`glanceGrid(today)` → 14 typed cells, §9)
and a small server component on the dashboard; it reuses the same block/job
data the full calendar loads. It is **read-mostly** — a glance, with a
click-through to act.

## 4. Job bookings flow onto the calendar (Phase 6A)

Per Dean: "if I book something, add it to my cal." When a Job gets a
`shoot_date`, it should appear on the calendar without re-entry. Two options;
the plan picks **A** for honesty and zero duplication:

- **A (chosen): render jobs as read-only calendar items.** The day/week
  views query `jobs` with a `shoot_date` in range alongside `calendar_blocks`
  and draw them as distinct (job-accent, camera-marked) cards that deep-link
  to the job. No copy, no drift — the job *is* the source. A shoot with no
  set time shows as an all-day band on its date until timed.
- B (rejected): materialize a `calendar_block` per shoot. Creates a sync/
  duplication problem the moment a shoot date changes.

When Google sync lands (6C), these job items also push to the Google
calendar as events (one-way: Ops → Google), so the phone shows shoots too.

---

## 5. Two-way Google sync (Phase 6C) — the hard part, isolated

The risk lives here, quarantined behind a working local calendar.

### 5.1 Connection — service account + domain-wide delegation

Verified against Google's current docs (2026):

1. **One-time admin setup** (documented as a runbook in `/docs`): create a
   service account in Google Cloud, enable the Calendar API, generate a key,
   then in **Admin console → Security → Access and data control → API
   controls → Manage Domain-Wide Delegation**, authorize the service
   account's **Client ID** for the scope
   `https://www.googleapis.com/auth/calendar`.
2. Ops holds the service-account key (env var, like `DATABASE_URL`) and
   **impersonates Dean's Workspace user** to act on the dedicated
   "Sharp Sighted" calendar. No OAuth button, no token that expires and
   needs reconnecting — set-and-forget, exactly the pick.
3. **Quota note (verified):** under domain-wide delegation the *service
   account* is charged the per-user quota and can be rate-limited. Mitigate
   with batched writes + exponential backoff, and never busy-poll (we use
   push channels + incremental sync, below, not polling).

### 5.2 The dedicated calendar

On first connect, Ops finds-or-creates a calendar named **"Sharp Sighted"**
in the Workspace and stores its id in `calendar_sync_state`. All Ops events
live there — a single color-coded layer Dean can show/hide in Google without
touching personal events.

### 5.3 Ops → Google (outbound)

Every create/edit/delete of a `calendar_block` enqueues a write to Google:
insert/patch/delete the matching event, store the returned `google_event_id`
+ `etag`, set `sync_state='synced'`. RRULE passes straight through. Failures
set `sync_state='error'` for a visible retry (no silent drops).

### 5.4 Google → Ops (inbound)

- **Incremental sync via sync tokens** (verified model): Ops stores a
  `sync_token`; each pull asks Google for "everything changed since," then
  stores the new token. A **410** response means the token expired → Ops
  does a **full re-sync** and resets the token (the documented fallback).
- **Push, not poll:** register a Calendar **watch channel** so Google
  notifies an Ops webhook on change; the webhook triggers an incremental
  sync. A nightly safety sync + channel-renewal cron backstops it (channels
  expire). This respects the quota note in §5.1.

### 5.5 Conflict rule (both sides edited)

`etag` is the detector. On an inbound change whose `etag` doesn't match what
Ops last stored AND Ops has a local pending edit: **last-write-wins by
`updated_at`, but never destructively** — the losing version is appended to
the block's notes ("Prior version, replaced by Google edit 2026-08-24") so
nothing is silently lost. Documented plainly so Dean knows the rule.

---

## 6. It chases him (Phase 6A email; 6C respects sync)

Per Dean: pinged immediately, email is fine for now.

- **On create / change of a block**, Ops sends an immediate confirmation
  email ("Booked: Record Reel — Tue Aug 24, 2:00–3:00pm") via the existing
  Resend mailer. This is the "it's real now" receipt.
- **A lead-time reminder** before each block (default 30 min, adjustable on
  the block) — sent by a small cron that sweeps upcoming blocks, mirroring
  the existing digest-cron pattern. This is the part that *chases*.
- Blocks also surface on the **dashboard** ("Today" already exists) — the
  calendar's day list folds into the morning brief so the day's fixed hours
  sit beside the rest of the command center.
- Future (backlog): SMS/push. Email first, by request.

---

## 7. Phasing

### Phase 6A — The calendar in Ops  ← **SHIPPED 2026-05-31**
*Feel:* content work becomes fixed hours today; the someday-pile is gone.
- [x] `calendar_blocks` + day/week views + block editor (type, start,
  duration, status, job link).
- [x] Job shoot-dates rendered read-only on the calendar (§4A).
- [x] **The dashboard 8-day glance** (§3.2) — today + 7, wall-calendar
  weekday columns, two rows, day-name-first. Pure `glanceGrid`, 13 tests.
- [x] Immediate confirmation email on create/change.
- [x] `/calendar` route + sidebar link.

### Phase 6B — Recurrence + polish
*Feel:* "every Tuesday I record" set once, and the grid feels native.
- RRULE recurrence UI (None / Daily / Weekly-on / Custom) + edited-instance
  + exception handling.
- Lead-time reminder cron (the chase).
- Drag-to-create / drag-to-resize; keyboard nav for accessibility.

### Phase 6C — Two-way Google sync
*Feel:* Ops and the phone are one calendar.
- Service-account connection + admin runbook in `/docs`.
- Find-or-create the "Sharp Sighted" calendar.
- Outbound writes; inbound incremental sync + 410 full-resync; watch
  channel webhook + renewal cron; the etag conflict rule.
- One-way push of Job shoots to Google.

---

## 8. Decisions baked in (say the word to change)

- **Dedicated "Sharp Sighted" Google calendar**, not the primary. (Chosen.)
- **Service account + domain-wide delegation**, not click-to-connect.
  (Chosen.) Admin setup is a one-time runbook; Ops needs the key as an env
  var + the impersonated user email.
- **Calendar ships before sync.** (Chosen.) 6A is usable with zero Google
  dependency.
- **RRULE is the recurrence storage** — Google's native grammar, for
  loss-free sync.
- **Jobs are rendered on the calendar, never copied** (§4A) — no duplication.
- **Conflict = last-write-wins by `updated_at`, non-destructive** (loser
  saved to notes). (§5.5)
- **Times carry an IANA zone** (default America/Chicago) so DST and any
  future travel stay honest.
- **Owner-scoped** like everything else; Dean as super_admin sees all.

---

## 9. Conventions honored

Additive idempotent migrations in `schema.sql` (Layer 9); raw `sql`/`sqlOne`;
server actions with owner checks + `actionError`; a pure core for the calendar
math (slot layout, RRULE expansion to concrete instances for a date window,
overlap) unit-tested in Vitest; SVG/CSS-grid views, no calendar dependency;
the Resend mailer reused for pings; a `CHANGELOG.md` entry + this doc updated
per sub-phase; `db:migrate` (testing) then `:prod` behind the Phase-4 guard
rails.

---

*Stay Sharp. Stay Seen. Stay Human.*
