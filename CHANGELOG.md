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
- Day 6-7 — Vercel deploy + DNS for `ops.sharpsighted.studio`
- Week 2 — Pricing engine (data model → seed → calculator UI → role-aware view)

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
