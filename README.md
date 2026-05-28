# Sharp Sighted Ops · ops.sharpsighted.studio

The internal operating tool for Sharp Sighted Studio. Built for Dean and
the sales-partner network. Not a public-facing site.

> See `/projects/sharp/CLAUDE.md` for the brand bible and
> `/projects/sharp/docs/` for the source-of-truth PDFs that this app
> codifies (pricing-methodology.md, print-and-frame-reference.md, and
> the master spreadsheet).

## What this is

A first-class app, not a website. Login required. Each module replaces a
PDF or spreadsheet that used to live on Dean's desk:

- **Pricing Calculator** — the master pricing spreadsheet, baked in
- **Quote Library** — every quote ever built, searchable
- **Prospect Tracker** *(post-MVP)* — the Prospect Playbook as software
- **Daily Queue** *(post-MVP)* — what to work on first today, with timers

Sales partners onboard by *using* the tools, not by reading a packet.

## Stack

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack)
- **Styling:** Tailwind v4 (`@import "tailwindcss"`, `@theme inline`)
- **Type:** Playfair Display (serif) + Montserrat (sans), via `next/font`
- **Auth:** Auth.js v5 with email + magic-link via Resend
- **DB:** Postgres (Neon)
- **PDF:** `@react-pdf/renderer` for server-rendered branded quote PDFs

## Local development

```bash
npm install
cp .env.example .env.local   # then fill the six values below
npm run db:migrate           # applies schema to whatever DATABASE_URL points at
npm run dev
```

The six values you need in `.env.local`:

```
DATABASE_URL          Neon pooled URL with sslmode=verify-full
AUTH_SECRET           openssl rand -base64 32
AUTH_URL              http://localhost:3000   (production overrides this)
AUTH_TRUST_HOST       true
AUTH_RESEND_KEY       re_… from resend.com → API Keys
EMAIL_FROM            "Sharp Sighted Ops <onboarding@resend.dev>" for sandbox,
                      "Sharp Sighted Ops <no-reply@sharpsighted.studio>" once
                      the sending domain is verified on Resend
ALLOWED_EMAILS        comma-separated allowlist; first entry becomes the
                      bootstrap admin on first sign-in
```

The dev server runs at <http://localhost:3000>. Every route except
`/signin/*` and `/api/auth/*` redirects to `/signin` if no session
cookie is present — the proxy gates the whole app.

### Testing database (V2 onward)

Local dev points at a **separate Neon project from production** so the
v2 branch can be exercised without writing into prod data. (D-064.)

One-time setup:

1. In the Neon dashboard, create a second project — name it whatever
   makes sense (e.g. `sharp-ops-testing`). Free tier is fine.
2. Copy the **pooled** connection string from the new project.
3. In `.env.local`, replace the `DATABASE_URL` line with the new
   project's string. Keep the production string somewhere safe (Vercel
   project settings already has it). The append `?sslmode=verify-full`
   if it's not already there.
4. Apply the schema: `npm run db:migrate`. This runs against whatever
   `DATABASE_URL` is currently set to — i.e. the new testing project.
5. Seed it if you want sample data: `npm run db:seed`.

After that, `npm run dev` writes to the testing project. Production
on Vercel keeps using its own `DATABASE_URL` (set in Vercel env vars)
— it's never affected by local work.

To swap back to prod for a one-off read, point `DATABASE_URL` at the
prod string temporarily. To swap permanently, change the env var and
re-run the dev server.

> If you ever need a true production restore-point during V2, take a
> Neon snapshot or export `pg_dump` of the prod DB first. The
> migrations on the testing project don't touch prod.

### Useful scripts

```
npm run dev           Turbopack dev server
npm run build         Production build
npm run lint          ESLint
npm run db:migrate        Apply src/lib/db/schema.sql to DATABASE_URL (idempotent)
npm run db:migrate:fresh  Drop catalog + quote tables, then re-apply schema
                          (destructive to catalog; auth tables preserved)
npm run db:check          List the public tables currently in the DB (read-only)
npm run db:seed           Seed globals + packages + cost lines + addons
npm run db:seed:dry       Print the computed price report; write nothing
```

### A note on the Neon connection string

Neon hands you a URL ending in `?sslmode=require&channel_binding=require`.
Change the `sslmode` value to `verify-full` before pasting it into
`.env.local`. Current `pg` versions treat the two as identical (full TLS
verification), but `pg` v9 will demote `require` to mean "TLS without
cert verification." Using `verify-full` explicitly preserves the secure
behavior across the upgrade and silences the deprecation warning the
library prints at process start.

## Visual dialect

Cousin of `/studio` (Human pillar, terracotta-heavy) but app-shaped:

- **8px corner radius** (between studio's 10px and the editorial 0px of
  the photos/media sites). Reads as "tool," not "magazine."
- **Steel/slate working surfaces** — neutral backgrounds for forms,
  tables, calculators. Terracotta is reserved for *primary actions* and
  *live highlights*, not load-bearing surface color.
- **Dense rhythm** — 2rem section padding default, vs studio's 6rem.
  This is a working tool. White space serves the working tool's eye, not
  an editorial pose.
- **Cyan still owns the footer wordmark** — per brand discipline
  (CLAUDE.md §2).
- **Robots disallowed** — internal app; `robots: { index: false }` in
  metadata.

## 30-day MVP build order

```
Week 1 — Foundation
  [✓] Scaffold project, design tokens, shell                  (Day 1)
  [✓] Neon Postgres + schema                                  (Day 2-3)
  [✓] Auth.js v5 + Resend magic links (verified locally)      (Day 4-5)
  [✓] Vercel deploy + DNS · ops.sharpsighted.studio live      (Day 6-7)

Week 2 — Pricing engine
  [ ] Data model: packages, addons, methodology               (Day 8)
  [ ] Seed from current spreadsheet                           (Day 9-10)
  [ ] Calculator UI with live total                           (Day 11-13)
  [ ] Role-aware view (admin sees margins, partner doesn't)   (Day 14)

Week 3 — Quote persistence
  [ ] Save / list / detail / edit / archive                   (Day 15-18)
  [ ] Client info attachment                                  (Day 19-21)

Week 4 — PDF output + polish
  [ ] @react-pdf/renderer branded quote                       (Day 22-25)
  [—] Send-to-client flow                                     (discarded — see CHANGELOG)
  [ ] Polish, mobile, real Discovery Hour use                 (Day 28-30)
```

## Deployment

Vercel, with the apex pointed at `ops.sharpsighted.studio` via a CNAME
on Namecheap. Production env vars are managed in the Vercel dashboard;
`.env.example` is the canonical template.

## Why a separate project (not a route group inside /studio)

The public `sharpsighted.studio` site has its own audience (creatives,
the journal, the 10% archive). The ops tool has a totally different
audience (Dean, sales partners). Different release cadence, different
auth model, different design density, different data shape. Sharing a
codebase would couple the two — every studio public release would risk
a partner-facing regression. Two repos, two deploys, one brand DNA.

Each Sharp Sighted property gets its own folder:

```
sharp/
  landing/    →  sharpsightedstudio.com
  photos/     →  sharpsighted.photos
  media/      →  sharpsighted.media
  studio/     →  sharpsighted.studio
  ops/        →  ops.sharpsighted.studio  ← this project
```

## Note for Claude Code / Claude Agent SDK

This project follows the same Next.js 16 patterns as `/projects/sharp/studio/`.
A few specifics worth knowing before generating code:

- **`proxy.ts`, not `middleware.ts`.** Next.js 16 renamed the file. Proxy
  always runs on Node runtime (no `runtime: 'nodejs'` declaration — it
  errors with "Route segment config is not allowed in Proxy file").
- **Database sessions.** Auth.js v5 with the Email provider needs the
  Postgres adapter; sessions live in the `sessions` table, not a JWT.
- **`@/` alias.** Maps to `./src/` per `tsconfig.json`.
- **Train cutoffs lag here.** Check `node_modules/next/dist/docs/` and
  `node_modules/next-auth/` before assuming an API still exists.

---

*Stay Sharp. Stay Seen. Stay Human.*
