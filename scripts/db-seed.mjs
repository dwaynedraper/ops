#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Sharp Sighted Ops — package + addon catalog seed.
 *
 *   npm run db:seed                # upsert all packages and addons
 *   npm run db:seed -- --dry-run   # print what would change, don't write
 *   npm run db:seed -- --reset     # wipe packages/addons first (destructive)
 *
 * Idempotent: every row upserts by slug. Re-run safely after a price
 * change or an addon addition.
 *
 * The seed values are derived from the master spreadsheet at
 * /projects/sharp/docs/sharp-sighted-pricing-master-v2.xlsx — the
 * cost-plus inputs (time_hours, lp_rate, hard_cost, default_margin)
 * are taken from the package sheets there. Retail prices (base_price)
 * are taken from the published wall card and may differ from what the
 * cost-plus methodology produces. That's intentional: see decision
 * log entry D-007 in BUILD-PLAN.md.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const envPath = join(rootDir, '.env.local');

// ─── .env.local loader ────────────────────────────────────────────────
function loadEnvLocal() {
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

// ─── CLI args ─────────────────────────────────────────────────────────
const dryRun = process.argv.includes('--dry-run');
const reset = process.argv.includes('--reset');

// ─── Pricing constants — mirror src/lib/pricing.ts ─────────────────────
const LP_RATE_STANDARD = 50;
const LP_RATE_SAGA     = 75;
const MARGIN_DEFAULT   = 0.30;
const ROUND_UP_STEP    = 100;

function methodologyPrice({ timeHours, lpRate, hardCost, margin }) {
  const timeCost = timeHours * lpRate;
  const costBasis = timeCost + hardCost;
  const working = costBasis * (1 + margin);
  return Math.ceil(working / ROUND_UP_STEP) * ROUND_UP_STEP;
}

// ─── PACKAGE catalog ──────────────────────────────────────────────────
// Cost-plus inputs from the spreadsheet; base_price from the wall card.
const PACKAGES = [
  {
    slug: 'the-verse',
    name: 'The Verse',
    branch: 'portraits',
    description:
      '2-hour session · 1 location · 1 wardrobe · 10 hand-edited images · 5 framed letter prints · 7-day delivery.',
    time_hours: 6,
    lp_rate: LP_RATE_STANDARD,
    hard_cost: 450,
    default_margin: MARGIN_DEFAULT,
    base_price: 900,
    sort_order: 10,
  },
  {
    slug: 'the-story',
    name: 'The Story',
    branch: 'portraits',
    description:
      '6 hours · unlimited locations + wardrobe · 25 hand-edited images · 6 framed letters + 1 framed 13×19 · 14-day delivery.',
    time_hours: 13,
    lp_rate: LP_RATE_STANDARD,
    hard_cost: 610,
    default_margin: MARGIN_DEFAULT,
    base_price: 1700,
    sort_order: 20,
  },
  {
    slug: 'the-saga',
    name: 'The Saga',
    branch: 'portraits',
    description:
      '2 days · with team · creative direction · ~50 hand-edited finals + documentary video · 2 museum prints + Heirloom Book · Fine Art Collection · 45-day delivery.',
    time_hours: 60,
    lp_rate: LP_RATE_SAGA,
    hard_cost: 2610,
    default_margin: MARGIN_DEFAULT,
    base_price: 8000,
    sort_order: 30,
  },
  {
    slug: 'corp-single',
    name: 'The Single Executive',
    branch: 'corporate',
    description:
      'One executive · on-site mobile studio · 1–3 polished finals with full retouch · files for LinkedIn, web, print · 5-business-day delivery.',
    time_hours: 5.5,
    lp_rate: LP_RATE_STANDARD,
    hard_cost: 90,
    default_margin: MARGIN_DEFAULT,
    base_price: 670,
    sort_order: 40,
  },
  {
    slug: 'corp-team-day',
    name: 'The Team Day',
    branch: 'corporate',
    description:
      '$600 setup + per-person headshots · up to 15 people · one visit · cohesive lighting · files named, sized, and ready · 3–5 day delivery.',
    time_hours: 18,
    lp_rate: LP_RATE_STANDARD,
    hard_cost: 260,
    default_margin: MARGIN_DEFAULT,
    // base_price is the setup-only fee. Per-person headshots are
    // priced via the corp-team-day-per-person addon below.
    base_price: 600,
    sort_order: 50,
  },
  {
    slug: 'essentials',
    name: 'The Essentials Package',
    branch: 'realestate',
    description:
      'Story-driven stills · MLS-optimized · aerial · floor plan · 20-second vertical reel · white-glove MLS delivery · 24-hour turnaround.',
    time_hours: 3.35,
    lp_rate: LP_RATE_STANDARD,
    hard_cost: 135,
    default_margin: MARGIN_DEFAULT,
    base_price: 400,
    sort_order: 60,
  },
  {
    slug: 'visibility-retainer',
    name: 'The Visibility Retainer',
    branch: 'realestate',
    description:
      'Quarterly retainer · one 1–2 hour session · 12 branded short-form clips · 12 co-posts via Studio · monthly calls · 15% off Essentials · priority scheduling. 6-month minimum.',
    time_hours: 23.75,
    lp_rate: LP_RATE_STANDARD,
    hard_cost: 260,
    default_margin: MARGIN_DEFAULT,
    base_price: 1500,
    sort_order: 70,
  },
];

// ─── ADDON catalog ────────────────────────────────────────────────────
// Pulled from the basic-pricing wall card. Cost-plus inputs are
// estimates for v1 and will be refined in Day 9-10 validation.
//
// package_slug = null + branch set → universal within that branch
// package_slug set                  → tied to that specific package
const ADDONS = [
  // ─── Portraits — universal within the branch
  {
    slug: 'extra-digital',
    name: 'Extra digital from non-selects',
    package_slug: null,
    branch: 'portraits',
    description: 'Additional hand-edited digital pulled from the non-select pool.',
    time_hours: 0.25,
    hard_cost: 0,
    base_price: 75,
    unit_label: 'each',
    sort_order: 110,
  },
  {
    slug: 'gift-collection',
    name: 'Gift Collection · 20 prints in presentation box',
    package_slug: null,
    branch: 'portraits',
    description:
      'Twenty 8.5×11 portrait prints on archival paper, glassine sleeves, presentation box. The most-gifted upgrade.',
    time_hours: 2,
    hard_cost: 80,
    base_price: 300,
    unit_label: null,
    sort_order: 120,
  },
  {
    slug: 'fine-art-collection',
    name: 'Fine Art Collection · 20 prints in archival portfolio',
    package_slug: null,
    branch: 'portraits',
    description:
      'Twenty 8.5×11 archival prints, glassine sleeves, archival portfolio box. The fine-art presentation tier.',
    time_hours: 2.5,
    hard_cost: 175,
    base_price: 800,
    unit_label: null,
    sort_order: 130,
  },
  {
    slug: 'heirloom-book',
    name: 'Heirloom Book',
    package_slug: null,
    branch: 'portraits',
    description:
      'Cloth-bound, foil-stamped lay-flat book with 25-40 images. Designed for the family bookshelf, not the coffee table.',
    time_hours: 5,
    hard_cost: 320,
    base_price: 1200,
    unit_label: null,
    sort_order: 140,
  },

  // ─── Story-specific
  {
    slug: 'story-exhibition-upgrade',
    name: 'Exhibition print upgrade · museum-tier wall set',
    package_slug: 'the-story',
    branch: null,
    description:
      'Upgrades the Story print package to museum-grade fine art prints with archival framing. Replaces the standard Story wall set.',
    time_hours: 3,
    hard_cost: 1700,
    base_price: 1500,
    unit_label: null,
    sort_order: 210,
  },

  // ─── Saga-specific
  {
    slug: 'saga-additional-day',
    name: 'Additional production day or expanded video',
    package_slug: 'the-saga',
    branch: null,
    description:
      'A third production day or an expanded documentary video deliverable beyond the standard Saga scope.',
    time_hours: 10,
    hard_cost: 200,
    base_price: 2500,
    unit_label: null,
    sort_order: 220,
  },

  // ─── Corporate Single
  {
    slug: 'single-featured-upgrade',
    name: 'Featured Executive upgrade',
    package_slug: 'corp-single',
    branch: null,
    description:
      'Adds a 20-minute environmental editorial sit + wardrobe change. Delivers 3–5 editorial images alongside the standard headshot.',
    time_hours: 1.5,
    hard_cost: 30,
    base_price: 225,
    unit_label: null,
    sort_order: 230,
  },

  // ─── Corporate Team Day
  {
    slug: 'corp-team-day-per-person',
    name: 'Team headshot · per person',
    package_slug: 'corp-team-day',
    branch: null,
    description:
      'Per-person headshot on a Team Day shoot. Midpoint of the $70–$90 range. Multiplied by headcount on the calculator.',
    time_hours: 0.5,
    hard_cost: 5,
    base_price: 80,
    unit_label: 'per person',
    sort_order: 240,
  },
  {
    slug: 'corp-team-day-featured-principal',
    name: 'Featured upgrade for a principal',
    package_slug: 'corp-team-day',
    branch: null,
    description:
      'Featured Executive treatment for 1–2 principals on a Team Day. Midpoint of the $250–$350 range.',
    time_hours: 1,
    hard_cost: 20,
    base_price: 300,
    unit_label: 'per principal',
    sort_order: 250,
  },

  // ─── Real Estate
  {
    slug: 'essentials-cinematic-walkthrough',
    name: 'Cinematic walkthrough with agent voiceover',
    package_slug: 'essentials',
    branch: null,
    description:
      'Gimbal-stabilized walkthrough video with agent voiceover, color-graded and music-bedded. Adds the longer-form cinematic deliverable on top of the Essentials reel.',
    time_hours: 3,
    hard_cost: 90,
    base_price: 500,
    unit_label: null,
    sort_order: 260,
  },
  {
    slug: 'retainer-additional-clips',
    name: 'Additional 12 clips per quarter',
    package_slug: 'visibility-retainer',
    branch: null,
    description:
      'A second batch of 12 branded short-form clips in the same quarter, edited from the existing session footage.',
    time_hours: 4,
    hard_cost: 120,
    base_price: 700,
    unit_label: null,
    sort_order: 270,
  },
];

// ─── DB ───────────────────────────────────────────────────────────────
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('✗ DATABASE_URL is not set. Add it to .env.local and try again.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

(async () => {
  console.log('\n  Sharp Sighted Ops · catalog seed\n');
  console.log(`  Target  : ${maskUrl(connectionString)}`);
  console.log(`  Mode    : ${dryRun ? 'DRY-RUN' : reset ? 'RESET + SEED' : 'UPSERT'}`);
  console.log(`  Counts  : ${PACKAGES.length} packages · ${ADDONS.length} addons\n`);

  try {
    await client.connect();

    if (reset && !dryRun) {
      console.log('  ⚠  --reset specified: TRUNCATE addons, packages (CASCADE).');
      await client.query('TRUNCATE addons, packages RESTART IDENTITY CASCADE;');
    }

    if (dryRun) {
      printMethodologyReport();
      return;
    }

    // ─── Upsert packages ────────────────────────────────────────────
    const pkgIdBySlug = new Map();
    for (const p of PACKAGES) {
      const { rows } = await client.query(
        `INSERT INTO packages
           (slug, name, branch, description, time_hours, lp_rate,
            hard_cost, default_margin, base_price, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (slug) DO UPDATE SET
           name           = EXCLUDED.name,
           branch         = EXCLUDED.branch,
           description    = EXCLUDED.description,
           time_hours     = EXCLUDED.time_hours,
           lp_rate        = EXCLUDED.lp_rate,
           hard_cost      = EXCLUDED.hard_cost,
           default_margin = EXCLUDED.default_margin,
           base_price     = EXCLUDED.base_price,
           sort_order     = EXCLUDED.sort_order
         RETURNING id, slug;`,
        [
          p.slug, p.name, p.branch, p.description,
          p.time_hours, p.lp_rate, p.hard_cost, p.default_margin,
          p.base_price, p.sort_order,
        ],
      );
      pkgIdBySlug.set(rows[0].slug, rows[0].id);
    }
    console.log(`  ✓ ${PACKAGES.length} packages upserted.`);

    // ─── Upsert addons ──────────────────────────────────────────────
    for (const a of ADDONS) {
      const pkgId = a.package_slug ? pkgIdBySlug.get(a.package_slug) : null;
      if (a.package_slug && !pkgId) {
        throw new Error(`Addon ${a.slug} references unknown package_slug=${a.package_slug}`);
      }
      await client.query(
        `INSERT INTO addons
           (slug, name, package_id, branch, description, time_hours,
            hard_cost, base_price, unit_label, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (slug) DO UPDATE SET
           name        = EXCLUDED.name,
           package_id  = EXCLUDED.package_id,
           branch      = EXCLUDED.branch,
           description = EXCLUDED.description,
           time_hours  = EXCLUDED.time_hours,
           hard_cost   = EXCLUDED.hard_cost,
           base_price  = EXCLUDED.base_price,
           unit_label  = EXCLUDED.unit_label,
           sort_order  = EXCLUDED.sort_order;`,
        [
          a.slug, a.name, pkgId, a.branch, a.description,
          a.time_hours, a.hard_cost, a.base_price, a.unit_label, a.sort_order,
        ],
      );
    }
    console.log(`  ✓ ${ADDONS.length} addons upserted.\n`);

    printMethodologyReport();
  } catch (err) {
    console.error('\n  ✗ Seed failed:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();

// ─── Reporting ────────────────────────────────────────────────────────
function printMethodologyReport() {
  console.log('  PACKAGE METHODOLOGY vs RETAIL\n');
  console.log(
    `  ${pad('Slug', 24)} ${pad('Math', 8)} ${pad('Retail', 8)} ${pad('Spread', 9)}  Note`,
  );
  console.log('  ' + '─'.repeat(76));
  for (const p of PACKAGES) {
    const math = methodologyPrice({
      timeHours: p.time_hours,
      lpRate: p.lp_rate,
      hardCost: p.hard_cost,
      margin: p.default_margin,
    });
    const spread = p.base_price - math;
    const note =
      spread === 0 ? 'matched'
      : spread < 0 ? 'under math (funnel-priced)'
      : 'above math (market-supported)';
    console.log(
      `  ${pad(p.slug, 24)} ${pad('$' + fmt(math), 8)} ${pad('$' + fmt(p.base_price), 8)} ${pad((spread >= 0 ? '+' : '') + '$' + fmt(spread), 9)}  ${note}`,
    );
  }
  console.log('');
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
function fmt(n) {
  return Number(n).toLocaleString('en-US');
}
function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(unparseable URL)';
  }
}
