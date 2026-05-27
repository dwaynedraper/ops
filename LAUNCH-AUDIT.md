# Sharp Sighted Ops — Launch Audit

> Pre-launch review of the `ops` internal sales CRM. Target go-live: **Wednesday**.
> Reviewed: every route, server action, the auth layer, the schema, the PDF/email/cron
> code, plus a full `tsc` + `eslint` pass. This document is a **map of the work**, not
> the work itself — nothing was changed. We get aligned here, then dial in the fixes.

---

## The verdict

**Not ready to ship as-is — but close.** The architecture is sound and the security
fundamentals are right. There is **one real security hole**, **two crash/verification
items**, and a handful of polish items. None of it is deep or scary. If the three
must-fix items below are handled, this is launch-ready.

Plain-English summary: the foundation is solid. The gaps are at the edges — a cron
door that's unlocked if you forget a setting, an error page that 500s instead of
404s, and a PDF font question that can only be answered on the real server.

**Gate to launch:** fix M1, M2, M3 below. Everything else can ship Wednesday and be
cleaned up after, *if* you decide so.

---

## Update — fix batch applied (2026-05-22)

Everything actionable in this audit has been worked.

**Resolved in code** — M1, M2, M3, S1, S2, S3, S4, S5, P1, P2, P3. Verified with a
clean `tsc` + `eslint`. The CHANGELOG entry "Pre-launch audit + fixes" has the
per-item detail.

**Also added** — a generic 20-second undo on every prospect lifecycle move (log
contact, mark replied, close out, and stage advances). The action is held behind an
undo toast and only commits if it isn't undone.

**Deliberately not changed** — P4 (database TLS) is an infrastructure call that needs
the Neon CA cert, not a blind code edit; P5 (stage-event attribution) is a no-op
until prospect reassignment exists; P6 is cosmetic. All three are safe to ship as-is.

**Still on you** — the config checklist further down: re-run the migration, confirm
the env vars (`CRON_SECRET` is now mandatory — M1 makes the route return 503 without
it), verify the Resend domain, run a real `next build` + `vitest` locally, and
download one real quote PDF from the deployed preview to confirm M3 and the fonts.

---

## Must-fix before Wednesday

### M1 — The morning-digest cron is unlocked if `CRON_SECRET` is missing  ·  SECURITY

**Where:** `src/app/api/cron/digest/route.ts`, lines 36–43
**What:** The secret check is wrapped in `if (secret) { ... }`. If `CRON_SECRET` is
not set in the Vercel environment, the entire check is skipped — anyone who finds
the URL `/api/cron/digest` can trigger a full digest email to every opted-in rep.
The route is intentionally public (it carries no login session), so this check is
its *only* lock.
**Why it matters:** It "fails open." A forgotten environment variable silently
removes the lock instead of sealing the door. That's the wrong direction for a
security gate.
**Fix:** Fail closed — if `CRON_SECRET` is unset, return a 503 and do nothing.
Then the only way the route runs is with the correct secret. (Pair this with the
config checklist below: `CRON_SECRET` must actually be set.)

### M2 — The quote-PDF link 500s on a malformed quote ID

**Where:** `src/app/quotes/[id]/pdf/route.ts` (+ `src/lib/quotes.ts`)
**What:** The `id` from the URL goes straight into a query against a Postgres `UUID`
column. Any non-UUID value (e.g. someone hand-edits the URL, or a stale/broken link)
makes Postgres throw, and the route has no try/catch — so it returns an ugly
unhandled **500 server error** instead of a clean "not found."
**Why it matters:** It's not a security hole (see "What's solid" — cross-rep access
is properly blocked). It's a reliability and polish problem: a broken link should
look intentional, not like the app fell over. On a client-facing income tool, a
raw 500 reads as "this thing is fragile."
**Fix:** Validate the `id` as a UUID at the top of the route; return a 404 if it
isn't one. (Or wrap the body in try/catch.)

### M3 — The quote PDF's brand fonts may not survive deployment  ·  MUST VERIFY

**Where:** `src/components/QuotePdf.tsx` + `next.config.ts`, lines 13–15
**What:** The quote PDF loads the Playfair Display + Montserrat fonts from a file
path resolved at runtime. `next.config.ts` has a setting (`outputFileTracingIncludes`)
meant to force those four `.ttf` files into the deployed serverless bundle. The
font files are confirmed present in `src/fonts/`. The open question is whether the
config key actually matches the route — if it doesn't, the fonts won't ship, and
**every PDF download will 500 in production while working perfectly on your laptop.**
**Why it matters:** This is the classic "works on my machine" trap. It cannot be
verified in this environment — only a real deployment can answer it.
**Fix / action:** Before launch, deploy to a Vercel preview and **download an actual
quote PDF from the deployed URL.** If it renders with the brand fonts, M3 is closed.
If it errors or falls back to a default font, the config key needs correcting.

---

## Should-fix (soon — not necessarily Wednesday)

### S1 — A prospect's name leaks across reps via the browser tab title

**Where:** `src/app/prospects/[id]/page.tsx`, lines 84–86
**What:** The page body correctly shows a 404 when a rep opens a prospect that
isn't theirs. But the separate query that sets the **browser tab title** does *not*
do that ownership check — so the prospect's contact name briefly appears in the tab
even on a 404'd page.
**Why it matters:** It's a small leak — it only exposes a name, and only to someone
who already knows a valid prospect's long random ID (not guessable). But it
contradicts the visibility rule (reps see only their own prospects), and the fix
is one line.
**Fix:** Add the same owner check to the title query that the page body already has.

### S2 — The dashboard shows a blank shell instead of redirecting logged-out users

**Where:** `src/app/page.tsx`, lines 101–111
**What:** Every other page redirects a logged-out visitor to `/signin`. The
dashboard instead renders an empty page frame. In practice the route-gating layer
(`proxy.ts`) catches logged-out users first, so this never shows today — but it's
the one inconsistent page and a broken-looking fallback if the gate is ever missed.
**Fix:** Make it `redirect('/signin')` like the others.

### S3 — Tracking can leave you pointed at the wrong prospect after an action

**Where:** `src/app/tracking/TrackingClient.tsx`
**What:** After you log a touch or mark a reply, that prospect can drop off the
visible list. The composer panel then silently falls back to the *first* prospect
in the list — so the next thing you do could land on a different prospect than you
think.
**Why it matters:** On a sales tool, acting on the wrong prospect is a real, if
occasional, mistake. Worth tightening.
**Fix:** After an action, explicitly clear or re-resolve the selected prospect
rather than letting it fall through.

### S4 — Client-page buttons can freeze if a server action throws

**Where:** `src/app/prospects/[id]/ClientPageView.tsx` (`onStage`, `onSave`, `onAdd`)
**What:** These handlers call the server and then re-enable their buttons. They
assume the server always *returns* an error rather than *throwing* one. The server
actions are written to catch their own errors, so this is unlikely — but a
network drop or framework-level error would throw, and then the buttons stay
disabled and the page looks frozen until reload.
**Fix:** Wrap each handler's server call in try/catch so the button always
re-enables.

### S5 — A half-failed digest run still reports success

**Where:** `src/app/api/cron/digest/route.ts`, lines 81–89
**What:** If the digest fails to send to some reps, the failures are collected but
the route still returns HTTP 200 ("success"). Vercel Cron sees 200 and never alerts
you — so a digest that failed for half the team would pass silently.
**Fix:** Return a non-200 status when there are any failures, so Cron surfaces it.

---

## Polish & known gaps (fine to ship; clean up after)

- **P1 — Raw database errors shown to users.** Every server action, on failure,
  returns the raw Postgres error text to the screen. For an internal tool this is
  low-risk, but it's unpolished and leaks schema detail. Consider a generic message.
- **P2 — Unsaved edits can be lost.** The prospect details form and the notes box
  have no "you have unsaved changes" warning — navigating away drops them silently.
  The pricing editors (`DraftGuard`) have a warning, but it doesn't catch the
  browser Back button or in-app navigation.
- **P3 — `proxy.ts` public-path matching is loose.** A path like `/signin-anything`
  would be treated as public. No such route exists today, so it's harmless — but
  it's a latent trap if routes are added later.
- **P4 — Database TLS skips certificate validation** (`rejectUnauthorized: false`
  in `db.ts` and the migrator). This is the common Neon setup, but it technically
  allows a man-in-the-middle. Low priority; note it.
- **P5 — Stage-history attribution.** The stage-change log records *that* a move
  happened but not *who* did it; the supervisor report attributes moves to the
  prospect's current owner. Correct today (no reassignment feature exists). If you
  ever add prospect reassignment, revisit this.
- **P6 — Minor:** a Team Day quote with zero headshots can be saved (base fee only —
  may be intentional); read-only lists use array-index React keys (harmless while
  they're never reordered).

---

## Config / setup checklist (not code — your launch tasks)

These are environment and deployment steps, separate from the code fixes:

1. **Re-run `npm run db:migrate`** — confirm it now succeeds (the column-ordering
   bug was fixed; the migration is idempotent and safe to re-run).
2. **Set all required environment variables in Vercel:** `DATABASE_URL`,
   `AUTH_SECRET`, `AUTH_URL`, `AUTH_RESEND_KEY`, `EMAIL_FROM`, `ALLOWED_EMAILS`
   (first entry = the bootstrap super-admin — confirm it's your email), and
   **`CRON_SECRET`** (mandatory — see M1).
3. **Verify the Resend sending domain** is verified in the Resend dashboard, or
   no invite or digest emails will send.
4. **Run a real `next build` and the test suite (`vitest`) locally** — this
   environment can't (architecture mismatch), so a clean build must be confirmed
   on your machine before deploying.
5. **Download a real quote PDF from the deployed preview** — this closes M3.

---

## What's solid (so you can sleep)

The fundamentals are genuinely well-built. Verified clean:

- **SQL injection:** none. Every query is parameterized.
- **Auth:** invite-only, and it *fails closed* — an unknown or off-boarded email
  can't get in, and a missing profile defaults to "gated." Two independent gates:
  the sign-in callback and the route proxy.
- **Admin pages:** every super-admin-only page (team, rates, scripts, rank-factors,
  packages, supervisor report) re-checks the role **on the server** — it does not
  just hide the menu link.
- **Server actions:** prices are always re-fetched and recomputed on the server —
  a tampered client can't write a bogus total. Ownership is checked on every
  prospect action. Multi-step writes use proper database transactions with rollback.
- **Quote PDF access:** a rep cannot pull another rep's PDF (cross-access blocked).
- **Email templates:** all user-supplied text is HTML-escaped — no injection.
- **Empty states:** comprehensive — every list handles "nothing here yet" cleanly.
- **`tsc` + `eslint`:** both pass with zero errors.

---

## Separate question: features not yet built

Not bugs — decisions. These were known gaps from the build plan. Flagging so you
decide if any are launch-required:

- **Send-to-client flow** — quotes can be generated as a PDF, but there's no
  in-app "email this quote to the client" button. If you're sending quotes
  manually for now, that's fine — just confirm it's intentional for launch.
- **Duplicate-check on Qualify** — nothing stops two reps qualifying the same
  prospect. (Note: Research was renamed to Qualify in Phase E / D-023.)
- **Cross-sell / linked prospects** and a **mobile layout pass** — both deferred.

---

## Suggested order of work

1. **M1** (cron lock) — small, security, do first.
2. **M2** (PDF 404) — small, isolated.
3. **S1, S2, S4** — all one-to-few-line fixes, quick batch.
4. **S3, S5** — slightly more involved but contained.
5. Deploy to a preview → **M3 verification** (real PDF download) + config checklist.
6. Polish items (P1–P6) — after launch unless one bothers you.

Once you've read this and we're aligned, point me at the list and I'll do the
actual fixes — that's a couple of focused passes, not a rebuild.

---

_Stay Sharp. Stay Seen. Stay Human._
