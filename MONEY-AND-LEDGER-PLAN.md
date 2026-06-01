# Money, the Ledger & the Call Stage — Implementation Plan

> Phase 5 of the Ops CRM arc. Where Phases 1–4 built who (Clients), the
> work (Jobs), the day (Command Center), and the team view, this phase
> makes **money a first-class, dated, glanceable thing** — and turns Ops
> into the categorized ledger that feeds Wave without re-keying.
>
> Reference for: the build itself, future AI agents working this codebase,
> and Dean's own record-keeping discipline. Same conventions as
> `CLIENTS-AND-JOBS-PLAN.md` — additive idempotent migrations, raw
> `sql`/`sqlOne`, owner-scoped server actions, pure-core + thin-loader
> libs with unit tests, a `CHANGELOG.md` entry per phase.
>
> **Scope discipline (Dean, verbatim intent):** Ops does NOT do image
> delivery, payment *processing*, or client email. It RECORDS money
> events (received / expected / spent) with dates and categories, shows
> them so they can be *felt* at a glance, and exports a clean file for
> Wave. Wave remains the books of record; Ops is the operational ledger
> that feeds it.

---

## 0. What we verified before writing (2026-05-31)

- **Wave CSV import = three columns only: `Date`, `Description`,
  `Amount`.** Negatives via minus sign or brackets. Wave imports
  transactions for a single account at a time; category/account is
  assigned inside Wave on review (or via its rules), not required in the
  CSV. So our exporter's job is dead simple: emit Date / Description /
  Amount, one file, with a description rich enough that Wave's rules can
  auto-categorize. We carry a `wave_category` internally for our own
  grouping and to build a descriptive Description, not because the CSV
  needs a column for it. (Source: Wave Help Center, "Upload a bank or
  credit card statement in .csv format.")
- **2026 IRS business mileage rate = 72.5¢/mile** (up from 70¢ in 2025).
  Confirms mileage rate must be an editable, year-dated setting — never a
  hardcoded constant. (Source: IRS Newsroom, "IRS sets 2026 business
  standard mileage rate at 72.5 cents per mile.")

---

## 1. The keystone: payments become dated rows

Today a job has a single `payment_status` flag (unpaid / deposit_paid /
paid). That can't answer "when did the last payment land" or "what's the
expected date of the balance" — the two questions Dean asked for by name.

**The move:** introduce `job_payments` — one row per money event on a job,
each with an amount, a status (expected vs received), and the dates that
matter. `payment_status` stays as a fast denormalized cache, recomputed
from the rows (so the board's color dots and existing queries keep
working), but the rows are now the truth.

This single change yields, all at once:

- **Dates:** "Last in: May 24 · Next expected: Jun 7."
- **Collected vs expected split:** sum received vs sum still-expected.
- **The Wave export:** received payments are income rows.
- **Per-job paid ring:** received ÷ total, as a fill.

### 1.1 `job_payments` (additive, idempotent)

```sql
-- ─── job_payments ──────────────────────────────────────────────────
-- One money event on a job. An 'expected' row is a scheduled/awaited
-- payment (deposit due, balance due); marking it received stamps
-- received_on and flips status. The job's denormalized payment_status
-- is recomputed from these rows by the action layer.
CREATE TABLE IF NOT EXISTS job_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'payment'
                  CHECK (kind IN ('deposit', 'balance', 'payment', 'refund')),
  amount        NUMERIC(10,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'expected'
                  CHECK (status IN ('expected', 'received')),
  -- The two dates Dean asked for, by name:
  due_on        DATE,         -- when we EXPECT it (for 'expected' rows)
  received_on   DATE,         -- when it actually landed (for 'received' rows)
  method        TEXT,         -- 'check','zelle','card','cash', freeform
  note          TEXT,
  -- Wave bookkeeping: the income account this maps to. Optional; defaults
  -- resolved from the job's workflow/branch at export time.
  wave_category TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_payments_job_idx ON job_payments(job_id, due_on);
CREATE INDEX IF NOT EXISTS job_payments_status_idx ON job_payments(status, received_on);
CREATE INDEX IF NOT EXISTS job_payments_received_idx ON job_payments(received_on);
```

Trigger `job_payments_updated_at` reuses `trg_set_updated_at`.

### 1.2 Recompute `payment_status` from the rows

A pure helper `derivePaymentStatus(payments, jobValue)` in `lib/money.ts`:
- no received rows → `unpaid`
- received ≥ job value (or all expected rows received) → `paid`
- some received, some outstanding → `deposit_paid`

Every payment mutation recomputes and writes `jobs.payment_status` in the
same transaction, so the Phase-2/3/4 board dots, dashboard money lens, and
rep-pulse revenue keep working unchanged — they read the cache; the cache
now tells the truth about partials.

### 1.3 What "mark paid" becomes

The existing one-click **Paid** on the board still works — it just creates
a single `received` payment row for the full remaining amount, dated today,
instead of only flipping a flag. The job page gains the richer control:
add an expected payment (amount + due date), mark an expected one received
(stamps `received_on`), record an ad-hoc payment. No processing — Dean
types what landed and when.

---

## 2. The ledger: expenses + mileage

Both are dated, categorized money-out events that ride the same export
pipe as payments. Each can optionally attach to a job — which unlocks true
per-job profitability.

### 2.1 `expenses`

```sql
CREATE TABLE IF NOT EXISTS expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,   -- optional link
  spent_on      DATE NOT NULL,
  vendor        TEXT,
  amount        NUMERIC(10,2) NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general',  -- maps to a Wave expense account
  billable      BOOLEAN NOT NULL DEFAULT FALSE,   -- rebillable to the client?
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_owner_idx ON expenses(owner_id, spent_on);
CREATE INDEX IF NOT EXISTS expenses_job_idx ON expenses(job_id);
```

### 2.2 `mileage_logs`

```sql
CREATE TABLE IF NOT EXISTS mileage_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,
  drove_on      DATE NOT NULL,
  purpose       TEXT,                              -- "Scout 123 Oak", "Frisco shoot"
  miles         NUMERIC(8,1) NOT NULL,
  -- Rate snapshotted at entry so a year-end rate change never rewrites
  -- past deductions. Seeded from the editable setting below.
  rate_per_mile NUMERIC(6,3) NOT NULL,
  -- Computed + stored: miles * rate_per_mile, rounded to cents.
  amount        NUMERIC(10,2) NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mileage_owner_idx ON mileage_logs(owner_id, drove_on);
CREATE INDEX IF NOT EXISTS mileage_job_idx ON mileage_logs(job_id);
```

### 2.3 The editable mileage rate + categories

A small key/value `ledger_settings` table (or reuse `pricing_globals`
pattern) holds `mileage_rate_per_mile` (seed `0.725` for 2026, dated) and
the category → Wave-account mapping. Super-admin edits it on a settings
page. The rate is *snapshotted* onto each mileage row at entry, so editing
the rate next year is correct going forward and never rewrites history.

---

## 3. The "feel it at a glance" UI

Design rule for this whole phase: **the picture lands before the numbers
do.** Color and fill encode state so Dean reads cash health pre-cognitively.

### 3.1 The token language (reuses existing `globals.css` vars)

| State | Treatment | Why |
| --- | --- | --- |
| **Collected** (received) | `--good`, **solid fill** | Money that's here. Confident, done. |
| **Expected** (awaited) | `--good`, **ghosted** — outline only, ~12% fill | "Same thing, not arrived." Read without words. |
| **Out** (expenses/mileage) | calm tone (`--text-mid`/slate or cyan), **down-arrow ↓** | Outflow ≠ alarm. Deliberately not red. |
| **Overdue** (expected, past due_on) | `--warn` → `--bad` as it ages | Red is reserved for *late*, not for *spent*. |

The discipline: **red means "a deadline passed," never "money left."** An
expense is normal business; an overdue balance is the thing that should
catch the eye.

### 3.2 The cash strip (top of Dashboard, super-admin)

A single horizontal strip, legible in under a second:

```
  COLLECTED            OUTSTANDING           OUT (this month)
  $4,250  ████████     $900  ▢▢▢▢            $310 ↓
  ──────────────────────────────────────────────────────
  Last in: May 24 (Sarah Chen, $450)  ·  Next expected: Jun 7 ($450)
```

- Collected = bold filled bar; Outstanding = ghosted bar in the same green;
  Out = muted with a down-arrow.
- The **heartbeat line** underneath is the literal sentence Dean asked for:
  last received (date + who + amount) · next expected (date + amount).
- Net-collected (collected − out) optional as a quiet trailing figure.

This sits above "This week" on the dashboard for the admin — money is the
first thing the eye hits, then the day's work.

### 3.3 Per-job paid ring

On the Jobs board card and the job header: a small SVG ring that fills
`received ÷ total`. A half-paid job *looks* half-full — Dean sees payment
progress across the whole board without reading a number. Pure SVG (the
codebase already hand-rolls SVG sparklines in `/reports`), no dependency.

### 3.4 Money on the job page

A "Payments" card: the schedule as dated rows (received ones solid with
their `received_on`, expected ones ghosted with their `due_on`), an "add
payment" / "mark received" control, and the ring. Expenses + mileage linked
to this job listed below with a running **job profitability** line:
`value − expenses − mileage = net`.

---

## 4. The Books page (`/books`, super-admin) — the Wave handoff

One screen that *is* the monthly close. Month picker (defaults to last
closed month). Three sections:

1. **Income** — received `job_payments` in the window, each a row:
   date · client/job · amount · method.
2. **Expenses** — `expenses` in the window: date · vendor · category ·
   amount · billable flag.
3. **Mileage** — `mileage_logs` in the window: date · purpose · miles ·
   rate · amount. (Mileage is a deduction Dean records in Wave as an
   expense or tracks for Schedule C — exported as its own clearly-labelled
   file so his accountant/Wave handles it correctly.)

**Export buttons** produce Wave-ready CSVs — `Date, Description, Amount`:

- *Income CSV:* Amount positive. Description = `"{client} — {job title} ({method})"`
  so Wave's rules can auto-categorize by keyword.
- *Expenses CSV:* Amount negative (minus sign). Description =
  `"{vendor} — {category}"`.
- *Mileage CSV:* separate file, Amount negative, Description =
  `"Mileage {drove_on}: {miles}mi @ {rate} — {purpose}"`.

Server route mirrors the existing `/quotes/[id]/pdf` route pattern
(server-built file, streamed download). A pure `toWaveCsv(rows)` builder
in `lib/wave-export.ts`, unit-tested for escaping (commas/quotes in
descriptions), negative formatting, and date format. **Before building the
exporter, re-confirm Wave's template** against a fresh download from the
account — the three-column shape is stable but column *order/header text*
should be matched exactly to skip the mapping step on import.

A "copy summary" affordance too: monthly totals (income, expense, mileage,
net) as plain text for quick reference.

---

## 5. The call stage (`call_booked`) + email-only reps

**The operating model (now, not deferred):** reps communicate with
prospects by **email only — never phone.** A rep's outreach ends by sending
the prospect a **Sprout Studio scheduling link**; the prospect self-books a
call, which lands on *Dean's* calendar. Dean takes every call while the
business is new. The rep never makes or books a call — they send the link
and stop. `call_booked` records "the prospect scheduled a call (via
Sprout)," and **Dean** sets it, because Dean is who sees the booking come
through. This keeps brand voice on the phone as Dean's, gives reps a
simple teachable job (research → qualify → email the link), and routes
every booked call onto Dean's dashboard instead of his memory.

### 5.1 Lifecycle insert

Add `call_booked` to the prospect `stage` CHECK, positioned between
`responded` and `signed`:

```
researching → qualified → contacting → responded → call_booked → signed → client
                                                    (+ rejected, dormant)
```

Idempotent CHECK swap (the schema already has the precedent — the
`passed → rejected` rename block). `STAGE_LABEL`, `STAGE_NEXT`,
`STAGE_TONE`/colors, and the funnel order get the new stage. `STAGE_NEXT`:
`responded → [call_booked, signed, rejected, dormant]` (signed stays
reachable directly, for the simple deals), `call_booked → [signed,
rejected, dormant]`.

**Who moves what.** The rep's last outreach step is the Sprout link, sent
as email through the existing Contact cycle — a contact script carries the
`{{booking_link}}` (resolved from `handoff_links`, the mechanism already in
place). The rep moves a prospect to `responded` when it writes back; from
there the booking is the prospect's action and `call_booked` is **Dean's
mark** when the Sprout booking lands. So the dashboard "Calls booked" list
is Dean's queue of scheduled calls, populated by Dean (or by him glancing
at Sprout), never by a rep claiming a call happened.

### 5.2 What it drives

- **A dashboard surface for Dean:** "Calls booked" — the prospects waiting
  on a call with him, with whatever scheduling note the rep left. These are
  *his* to action, distinct from the rep outreach feed.
- **Optional scheduled-at field:** a nullable `call_at TIMESTAMPTZ` on the
  prospect so a booked call can show its time and sort the list.
- **The rep's channel is email, full stop.** The Sprout scheduling link is
  the rep's closing move, delivered as an email through the Contact cycle
  (a script step carrying `{{booking_link}}`). Reps never phone a prospect
  and never mark a call booked. The booking is the prospect's self-service
  action in Sprout; `call_booked` is Dean's mark when it lands. We surface
  the link prominently in the Contact composer so the rep always sends it
  the same way, in-voice.

### 5.3 Why a stage, not just a note

It makes booked calls **countable and visible**: they show on the
dashboard, flow into the funnel/reports, and become the raw material for
the future cue-card content (every call generates the objections the
master sheets will answer). It also means nothing depends on Dean
remembering — the system holds the handoff.

### 5.4 The Sprout link, said the same way every time

So reps deliver the booking link consistently and in-voice, the plan adds a
`booking_link` row to each workflow's `handoff_links` (Dean's Sprout
scheduling URL) and ensures the final outreach script reads, in brand
voice, something like: *"I'll send you straight to Dean's calendar — pick a
time that works and he'll call you himself: {{booking_link}}."* This is a
seed/script edit, not new machinery — the Contact composer already resolves
`{{link_key}}` placeholders from `handoff_links`.

---

## 6. Phasing

Each ships independently and leaves the app green.

### Phase 5A — Payments as dated rows  ← **SHIPPED 2026-05-31**
*Feel:* "Last in May 24, next expected Jun 7" becomes real; partials work.
- [x] `job_payments` + `derivePaymentStatus` + recompute-on-write.
- [x] Job-page Payments card (schedule, mark-received, ring, heartbeat).
- [x] Board "Paid" toggle writes a real received row.
- [x] Idempotent backfill of existing paid/deposit jobs.

### Phase 5B — The cash strip + per-job ring on the dashboard  ← **SHIPPED 2026-05-31**
*Feel:* month's money health legible at a glance, above the day's work.
- [x] `lib/cash.ts` aggregations (collected / outstanding / heartbeat dates).
- [x] Cash strip component (admin, collected solid / outstanding ghosted /
  out muted + heartbeat) + paid ring on board cards.

### Phase 5C — Expense + mileage ledger  ← **SHIPPED 2026-05-31**
*Feel:* every cost captured the moment it happens, on the phone, dated.
- [x] `expenses`, `mileage_logs`, `ledger_settings` (rate seeded 0.725).
- [x] Quick-add surfaces (fast "log expense / log miles", mobile-friendly).
- [x] Per-job profitability line; cash-strip "out this month" now live.

### Phase 5D — The Books page + Wave export  ← **SHIPPED 2026-05-31**
*Feel:* monthly close is "export, upload," not an evening of re-keying.
- [x] `/books` month view, three sections, totals (super-admin).
- [x] `lib/wave-export.ts` `toWaveCsv` + `/books/export` route (3 types).
- [x] Re-verified Wave format: Date/Desc/Amount, MM/DD/YYYY, `# & $ *`
  stripped, +in/−out.

### Phase 5E — The call stage  ← **SHIPPED 2026-05-31**
*Feel:* booked calls land on Dean's dashboard, not in his memory.
- [x] `call_booked` stage + `call_at`; labels/colors/transitions.
- [x] "Calls booked" dashboard surface for the admin (Dean's call queue).
- [x] `booking_link` already seeded across every workflow's scripts (real
  Sprout URL) — 5E adds the stage those self-booked calls land on. Reps
  email the link; Dean marks `call_booked`.

### Phase 5F — In-app tutorial refresh  ← **SHIPPED 2026-05-31 (last, by request)**
*Feel:* the in-app guidance matches the app that now exists.
- [x] Refreshed `lib/tutorials-content.ts` for the post–Clients/Jobs world:
  `/clients` roster vs `/pipeline`, the Jobs lifecycle, dated payments +
  cash strip, the ledger, the Books/Wave export, and the email-only /
  Sprout-link / Dean-takes-calls model.
- [x] Written against the finished surface area — one pass, no rewrites.

---

## 7. Decisions baked in (say the word to change)

- **Wave gets three-column CSVs** (Date/Description/Amount); category lives
  in our data + the Description string, not a CSV column. Re-verify the
  header text against a fresh Wave template before 5D ships.
- **Mileage rate is snapshotted per row**, seeded from an editable setting
  (0.725 for 2026); editing it never rewrites past entries.
- **Red = overdue only.** Expenses/outflow use a calm tone. Non-negotiable
  for the "feel" to work.
- **`payment_status` stays** as a recomputed cache so nothing downstream
  breaks; `job_payments` is the source of truth.
- **The cash strip is super-admin only** (it's whole-business money);
  per-job payment entry follows normal job ownership (D-019).
- **Expenses/mileage are owner-scoped** like everything else; Dean sees
  all as super-admin.
- **Email-only is the live model.** Reps communicate by email and close by
  sending the Sprout scheduling link; they never phone or mark a call
  booked. `call_booked` is Dean's mark when a prospect self-books; Dean
  takes every call while the business is new.
- **Tutorials are rewritten last** (Phase 5F), against the finished surface
  area, to avoid re-writes.

---

## 8. Conventions honored

Additive idempotent migrations in `schema.sql` (Layer 6); raw `sql`/`sqlOne`;
server actions with `loadOwnedJob`/owner checks + `actionError`; pure cores
(`derivePaymentStatus`, `toWaveCsv`, money aggregations) unit-tested in
Vitest; SVG hand-rolled (no chart dep); a `CHANGELOG.md` entry + this doc
updated per sub-phase; `npm run db:migrate` (testing) then `:prod` with the
Phase-4 guard rails.

---

*Stay Sharp. Stay Seen. Stay Human.*
