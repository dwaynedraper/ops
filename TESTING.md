# Testing — Sharp Sighted Ops

> 149 tests, 9 files, ~3.8s wall clock. `npm run test:unit` runs the
> whole suite; `npm run test:unit:watch` reruns on save.

The test pyramid below was built in one focused pass after V2 shipped.
The goal was Dean's: **fail fast, test well**. Complex workflows (the
Sourcing → Qualify → Contact → Client pipeline + the digest cron) should
break a unit test before they break a partner using the app.

---

## What's tested where

| Tier | File | What it covers |
| --- | --- | --- |
| 1 (pure logic) | `src/lib/prospects.test.ts` | Scoring (0–10), bands, gates, lifecycle moves (D-032). Pre-existed. |
| 1 (pure logic) | `src/lib/tracking.test.ts` | Contact-cycle progression: ready / due / waiting / replied / cycle_done. **F11 added** the D-051 urgency cases (now / soon / overdue / idle). |
| 1 (pure logic) | `src/lib/sourcing.test.ts` | `needsOverride` (D-028 + the D-045 "skip-when-empty" carve-out), `stageForSourcingStatus`, `hasAnyHardQualifierFilled`, `buildColumnConfig`, `EMPTY_SOURCING_ROW`. |
| 1 (pure logic) | `src/lib/inline-markdown.test.tsx` | D-058 inline-markdown parser — `**bold**`, `[label](url)`, mixed, edge cases (regex `lastIndex` doesn't leak, stand-alone `*` or `[` aren't markup). |
| 1 (pure logic) | `src/lib/help-content.test.ts` | `getHelpEntry` mode lookup (`qualify` default vs `sourcing`), missing-entry returns null, registry shape (every entry has title + sections). |
| 2 (pure-ish, mocks db) | `src/lib/digest.test.ts` | `computeDigest` partitioning — replies / dueNow / closeOuts / waiting / allClear / soonestWait — with synthetic prospects + contacts. |
| 3 (server actions) | `src/app/sourcing/actions.test.ts` | `upsertSourcingRow` create + update + override validation (D-028 + D-045) + D-057 duplicate-check with the ack flag. |
| 3 (server actions) | `src/app/contact/actions.test.ts` | `logContact` advances qualified → contacting on first touch (not on follow-up); `markResponded`; `closeOut`. |
| 3 (component) | `src/components/DuplicateWarning.test.tsx` | Renders the typed name + list items, switches singular/plural copy, wires Cancel/Continue callbacks, busy-state disables both buttons. |

Decision-log decisions covered by the suite: D-028, D-032, D-037,
D-038, D-041, D-042, D-043, D-044, **D-045**, D-046 (route rename
indirectly), D-049, D-051, **D-057**, D-058, plus the D-024 / D-034
status → stage mapping. Anything that touches lifecycle stage, scoring
math, or the override-with-reason rule has at least one assertion
pinning the contract.

---

## How to run

```
npm run test:unit          # one shot, exits with green/red
npm run test:unit:watch    # reruns on save (use this while editing)
npm run test:unit -- src/lib/digest.test.ts   # one file
```

`tsc --noEmit` and `eslint src` are unchanged — those catch type
drift and style violations independently. CI should run all three.

Test files are excluded from the Next build via `tsconfig.json` so
they never reach production.

---

## How the tiers map to risk

**Tier 1 — pure logic.** Functions in `src/lib/` that take an input
and return an output, no DB, no React, no clock. These are the
fastest tests in the suite (microseconds each) and the highest ROI:
the override carve-out, the urgency cycle math, the markdown parser,
and the column composition are silent contracts that the UI rests
on. If any of them drift, a Tier-1 test fails before anything else
does.

**Tier 2 — DB-mocked.** `computeDigest` queries the database via the
`sql` tagged template. The test mocks `@/lib/db` so each test can
pre-load synthetic rows and assert on the partitioning. The risk
here isn't SQL correctness (that needs a real DB) — it's the
in-memory partitioning + sort + soonestWait math that actually
shows up on the Dashboard every morning.

**Tier 3 — server actions + a proof-of-life component test.** The
server actions on `/sourcing` and `/contact` mix auth, ownership
checks, the override rule, the duplicate check, and lifecycle stage
moves. Tests mock `@/auth`, `@/lib/db`, and `@/lib/prospect-access`
so the action's own logic runs against real lib code. They catch
regressions in the call sequence (e.g. the duplicate check skipping
when `acknowledgeDuplicates: true`) and the result shape (`ok`,
`error`, `duplicates`, `row`).

The single component test on `DuplicateWarning` proves out the
React Testing Library setup: jsdom environment via the
`@vitest-environment` directive, `afterEach(cleanup)` registered in
the setup file, jest-dom matchers available everywhere. The pattern
extends to any future `.test.tsx` file under `src/`.

---

## Out of scope (intentional)

- **End-to-end / Playwright walks.** A full Source → Qualify → Contact
  → Client smoke walk would catch the few things unit tests can't
  (real DB migrations, Auth.js session shape, server-action wiring at
  the route level). It's a future addition; for V2 the unit pyramid
  is enough.
- **Real-DB integration tests.** The mocked-sql approach is fast and
  deterministic but won't catch SQL bugs. If a query stops matching
  the schema, only manual walking or a Playwright/Postgres
  integration test will notice. The testing Neon project from F0
  (`ep-divine-rain-aqktp4bn`) is the natural home for those.
- **Snapshot tests.** Brittle, low-signal. The component test asserts
  on roles + text content, which survives styling changes.

---

## Dependencies added

V2's polish + this test pass added these to `package.json`:

```
"devDependencies": {
  "@testing-library/dom": "^10.4.x",
  "@testing-library/jest-dom": "^6.9.x",
  "@testing-library/react": "^16.3.x",
  "@testing-library/user-event": "^14.6.x",
  "jsdom": "^29.1.x",
  "vitest": "^4.1.5"   // pre-existed
}
```

Plus `vitest.setup.ts` (registers jest-dom matchers + cleanup) and the
`environmentMatchGlobs` entry in `vitest.config.ts` that routes
`.test.tsx` files to jsdom.

---

## Adding a new test

1. **Pure function**: drop a `*.test.ts` next to the file you're
   covering. Vitest's `include` glob picks it up automatically.
2. **Server action**: use `vi.mock('@/lib/db', () => …)` and
   `vi.mock('@/auth', () => …)` at the top of the file, then
   `mockResolvedValueOnce` per query slot. Pattern lives in
   `src/app/sourcing/actions.test.ts`.
3. **React component**: name the file `*.test.tsx`. Add
   `// @vitest-environment jsdom` as the first line (defensive; the
   config already routes `.tsx` to jsdom). Import from
   `@testing-library/react`. The setup file already handles cleanup
   between tests.

---

*Stay Sharp. Stay Seen. Stay Human.*
