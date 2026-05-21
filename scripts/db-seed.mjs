#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Sharp Sighted Ops — pricing worksheet seed.
 *
 *   npm run db:seed                # upsert globals, packages, cost lines, addons
 *   npm run db:seed -- --dry-run   # print the computed prices, write nothing
 *   npm run db:seed -- --reset     # wipe catalog tables first (destructive)
 *
 * Idempotent for globals/packages/addons (upsert by key/slug). Cost
 * lines are replaced wholesale per package on each run — they have no
 * natural key, so the seed deletes a package's lines and re-inserts.
 *
 * Source of truth: /projects/sharp/docs/sharp-sighted-pricing-master-v2.xlsx.
 * The cost-line breakdown below mirrors each package sheet there. Each
 * package's published base_price is COMPUTED from its cost lines + the
 * globals (not hand-typed), so the seed and the worksheet page produce
 * identical numbers.
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

const dryRun = process.argv.includes('--dry-run');
const reset = process.argv.includes('--reset');

// ─── Pricing math — mirrors src/lib/pricing.ts ────────────────────────
const ROUND_UP_STEP = 100;
const RATE_ROLE_GLOBAL = {
  lp: 'lp_rate',
  lp_saga: 'lp_saga_rate',
  second_shooter: 'second_shooter_rate',
  pa: 'pa_rate',
  xm: 'xm_rate',
};

function computeFromLines(lines, globals, margin) {
  let timeCost = 0;
  let hardCost = 0;
  let hours = 0;
  for (const ln of lines) {
    if (ln.kind === 'time') {
      const rate = globals[RATE_ROLE_GLOBAL[ln.rate_role]];
      if (rate === undefined) throw new Error(`missing global for role ${ln.rate_role}`);
      timeCost += ln.hours * rate;
      hours += ln.hours;
    } else {
      hardCost += ln.amount;
    }
  }
  const basis = timeCost + hardCost;
  const working = basis * (1 + margin);
  const website = Math.ceil(working / ROUND_UP_STEP) * ROUND_UP_STEP;
  return { timeCost, hardCost, basis, working, website, hours };
}

// ═══════════════════════════════════════════════════════════════════════
// GLOBALS — the master spreadsheet's Globals sheet
// ═══════════════════════════════════════════════════════════════════════
const GLOBALS = [
  { key: 'lp_rate',             label: 'LP Hourly Rate',            value: 50,     unit: 'usd_per_hour', notes: 'Lead Photographer standard rate',                       sort_order: 10 },
  { key: 'lp_saga_rate',        label: 'LP Saga Premium Rate',      value: 75,     unit: 'usd_per_hour', notes: 'Lead Photographer Saga premium rate',                   sort_order: 20 },
  { key: 'second_shooter_rate', label: 'Second Shooter Rate',       value: 30,     unit: 'usd_per_hour', notes: 'Second shooter / video collaborator rate',              sort_order: 30 },
  { key: 'pa_rate',             label: 'Production Assistant Rate', value: 20,     unit: 'usd_per_hour', notes: 'Production assistant (future use)',                     sort_order: 40 },
  { key: 'xm_rate',             label: 'External Marketer Rate',    value: 20,     unit: 'usd_per_hour', notes: 'External marketer (future use)',                        sort_order: 50 },
  { key: 'margin_default',      label: 'Default Profit Margin',     value: 0.30,   unit: 'ratio',        notes: 'Portrait / corporate / media default margin',          sort_order: 60 },
  { key: 'margin_spec',         label: 'Specialty Profit Margin',   value: 0.20,   unit: 'ratio',        notes: 'Photo Lessons and specialty offerings',                 sort_order: 70 },
  { key: 'commission_rate',     label: 'Partner Sales Commission',  value: 0.15,   unit: 'ratio',        notes: '1099 partner sales commission off gross',               sort_order: 80 },
  { key: 'tax_setaside',        label: 'Tax Set-Aside',             value: 0.25,   unit: 'ratio',        notes: 'Reserve of net profit for federal income + SE tax',     sort_order: 90 },
  { key: 'sales_tax_tx',        label: 'Texas Sales Tax',           value: 0.0825, unit: 'ratio',        notes: 'State + DFW local; tangible goods only',                sort_order: 100 },
];

// ═══════════════════════════════════════════════════════════════════════
// PACKAGES — each with its worksheet cost lines
// Cost lines mirror the package sheets in the master spreadsheet.
// base_price is COMPUTED from the lines, not hand-typed.
// ═══════════════════════════════════════════════════════════════════════
const t = (category, hours, rate_role) => ({ kind: 'time', category, hours, rate_role });
const h = (category, amount) => ({ kind: 'hard', category, amount });

const PACKAGES = [
  {
    slug: 'the-verse', name: 'The Verse', branch: 'portraits',
    description: '2-hour session · 1 location · 1 wardrobe · 10 hand-edited images · 5 framed letter prints · 7-day delivery.',
    default_margin: 0.30, sort_order: 10,
    lines: [
      t('Shooting', 2, 'lp'),
      t('Post-Production / Editing', 3, 'lp'),
      t('Delivery Prep', 0.5, 'lp'),
      h('COGS — prints, paper, packaging', 165),
      h('Outsourced Editing / Retouching', 200),
      h('Software Subscriptions', 50),
    ],
  },
  {
    slug: 'the-story', name: 'The Story', branch: 'portraits',
    description: '6 hours · unlimited locations + wardrobe · 25 hand-edited images · 6 framed letters + 1 framed 13×19 · 14-day delivery.',
    default_margin: 0.30, sort_order: 20,
    lines: [
      t('Discovery / Consultation', 1, 'lp'),
      t('Planning & Pre-Production', 2, 'lp'),
      t('Travel / Setup', 2, 'lp'),
      t('Shooting', 6, 'lp'),
      t('Post-Production / Editing', 1, 'lp'),
      t('Delivery Prep', 1, 'lp'),
      h('COGS — prints, paper, packaging', 300),
      h('Outsourced Editing / Retouching', 200),
      h('Software Subscriptions', 10),
      h('Transportation', 50),
      h('Meals / Incidentals', 50),
    ],
  },
  {
    slug: 'the-saga', name: 'The Saga', branch: 'portraits',
    description: '2 days · with team · creative direction · ~50 hand-edited finals + documentary video · 2 museum prints + Heirloom Book · Fine Art Collection · 45-day delivery.',
    default_margin: 0.30, sort_order: 30,
    lines: [
      t('Discovery / Consultation', 1, 'lp_saga'),
      t('Planning & Pre-Production', 6, 'lp_saga'),
      t('Travel / Setup', 6, 'lp_saga'),
      t('Shooting', 14, 'lp_saga'),
      t('Post-Production / Editing', 12, 'lp_saga'),
      t('Delivery Prep', 3, 'lp_saga'),
      t('Client Communication / Revisions', 4, 'lp_saga'),
      t('Second Shooter', 14, 'second_shooter'),
      h('COGS — museum prints, Heirloom Book, Fine Art Collection', 1700),
      h('Outsourced Editing / Retouching', 500),
      h('Software Subscriptions', 10),
      h('Transportation', 200),
      h('Meals / Incidentals', 200),
    ],
  },
  {
    slug: 'corp-single', name: 'The Single Executive', branch: 'corporate',
    description: 'One executive · on-site mobile studio · 1–3 polished finals with full retouch · files for LinkedIn, web, print · 5-business-day delivery.',
    default_margin: 0.30, sort_order: 40,
    lines: [
      t('Discovery / Consultation', 0.5, 'lp'),
      t('Planning & Pre-Production', 0.5, 'lp'),
      t('Travel / Setup', 2, 'lp'),
      t('Shooting', 1, 'lp'),
      t('Post-Production / Editing', 1, 'lp'),
      t('Delivery Prep', 0.5, 'lp'),
      h('COGS — prints, paper, packaging', 5),
      h('Outsourced Editing / Retouching', 50),
      h('Software Subscriptions', 10),
      h('Transportation', 25),
    ],
  },
  {
    slug: 'corp-team-day', name: 'The Team Day', branch: 'corporate',
    description: 'Team headshot day · up to 15 people · one visit · cohesive lighting · files named, sized, ready · 3–5 day delivery. NOTE: customer-facing model is $600 setup + per-person (see D-010); this worksheet models the full 12-person day from the spreadsheet.',
    default_margin: 0.30, sort_order: 50,
    lines: [
      t('Discovery / Consultation', 1, 'lp'),
      t('Planning & Pre-Production', 1, 'lp'),
      t('Travel / Setup', 2, 'lp'),
      t('Shooting', 4, 'lp'),
      t('Post-Production / Editing', 8, 'lp'),
      t('Delivery Prep', 1, 'lp'),
      t('Client Communication / Revisions', 1, 'lp'),
      h('COGS — prints, paper, packaging', 10),
      h('Outsourced Editing / Retouching', 200),
      h('Software Subscriptions', 20),
      h('Transportation', 30),
    ],
  },
  {
    slug: 'essentials', name: 'The Essentials Package', branch: 'realestate',
    description: 'Story-driven stills · MLS-optimized · aerial · floor plan · 20-second vertical reel · white-glove MLS delivery · 24-hour turnaround.',
    default_margin: 0.30, sort_order: 60,
    lines: [
      t('Discovery / Consultation', 0.1, 'lp'),
      t('Planning & Pre-Production', 0.25, 'lp'),
      t('Shooting', 2.5, 'lp'),
      t('Delivery Prep', 0.5, 'lp'),
      h('Outsourced Editing / Retouching', 120),
      h('Software Subscriptions', 15),
    ],
  },
  {
    slug: 'visibility-retainer', name: 'The Visibility Retainer', branch: 'realestate',
    description: 'Quarterly retainer · one 1–2 hour session · 12 branded short-form clips · 12 co-posts via Studio · monthly calls · 15% off Essentials · priority scheduling. 6-month minimum.',
    default_margin: 0.30, sort_order: 70,
    lines: [
      t('Discovery / Consultation', 0.75, 'lp'),
      t('Planning & Pre-Production', 2, 'lp'),
      t('Travel / Setup', 1, 'lp'),
      t('Shooting', 2, 'lp'),
      t('Post-Production / Editing', 12, 'lp'),
      t('Delivery Prep', 4, 'lp'),
      t('Client Communication / Revisions', 2, 'lp'),
      h('Outsourced Editing / Retouching', 200),
      h('Software Subscriptions', 30),
      h('Transportation', 30),
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════
// ADDONS — flat editable fields (no cost-line worksheet, per D-010 Q&A)
// Pulled from the basic-pricing wall card.
// ═══════════════════════════════════════════════════════════════════════
const ADDONS = [
  { slug: 'extra-digital', name: 'Extra digital from non-selects', package_slug: null, branch: 'portraits',
    description: 'Additional hand-edited digital pulled from the non-select pool.',
    time_hours: 0.25, hard_cost: 0, margin_override: null, base_price: 75, unit_label: 'each', sort_order: 110 },
  { slug: 'gift-collection', name: 'Gift Collection · 20 prints in presentation box', package_slug: null, branch: 'portraits',
    description: 'Twenty 8.5×11 portrait prints on archival paper, glassine sleeves, presentation box.',
    time_hours: 2, hard_cost: 80, margin_override: null, base_price: 300, unit_label: null, sort_order: 120 },
  { slug: 'fine-art-collection', name: 'Fine Art Collection · 20 prints in archival portfolio', package_slug: null, branch: 'portraits',
    description: 'Twenty 8.5×11 archival prints, glassine sleeves, archival portfolio box.',
    time_hours: 2.5, hard_cost: 175, margin_override: null, base_price: 800, unit_label: null, sort_order: 130 },
  { slug: 'heirloom-book', name: 'Heirloom Book', package_slug: null, branch: 'portraits',
    description: 'Cloth-bound, foil-stamped lay-flat book with 25-40 images.',
    time_hours: 5, hard_cost: 320, margin_override: null, base_price: 1200, unit_label: null, sort_order: 140 },
  { slug: 'story-exhibition-upgrade', name: 'Exhibition print upgrade · museum-tier wall set', package_slug: 'the-story', branch: null,
    description: 'Upgrades the Story print package to museum-grade fine art prints with archival framing. Standard $1,700 → Exhibition $3,900.',
    time_hours: 3, hard_cost: 1700, margin_override: null, base_price: 2200, unit_label: null, sort_order: 210 },
  { slug: 'saga-additional-day', name: 'Additional production day or expanded video', package_slug: 'the-saga', branch: null,
    description: 'A third production day or an expanded documentary video deliverable beyond the standard Saga scope.',
    time_hours: 10, hard_cost: 200, margin_override: null, base_price: 2500, unit_label: null, sort_order: 220 },
  { slug: 'single-featured-upgrade', name: 'Featured Executive upgrade', package_slug: 'corp-single', branch: null,
    description: 'Adds a 20-minute environmental editorial sit + wardrobe change. Delivers 3–5 editorial images.',
    time_hours: 1.5, hard_cost: 30, margin_override: null, base_price: 225, unit_label: null, sort_order: 230 },
  { slug: 'corp-team-day-per-person', name: 'Team headshot · per person', package_slug: 'corp-team-day', branch: null,
    description: 'Per-person headshot on a Team Day shoot. Midpoint of the $70–$90 range. Multiplied by headcount.',
    time_hours: 0.5, hard_cost: 5, margin_override: null, base_price: 80, unit_label: 'per person', sort_order: 240 },
  { slug: 'corp-team-day-featured-principal', name: 'Featured upgrade for a principal', package_slug: 'corp-team-day', branch: null,
    description: 'Featured Executive treatment for 1–2 principals on a Team Day. Midpoint of the $250–$350 range.',
    time_hours: 1, hard_cost: 20, margin_override: null, base_price: 300, unit_label: 'per principal', sort_order: 250 },
  { slug: 'essentials-cinematic-walkthrough', name: 'Cinematic walkthrough with agent voiceover', package_slug: 'essentials', branch: null,
    description: 'Gimbal-stabilized walkthrough video with agent voiceover, color-graded and music-bedded.',
    time_hours: 3, hard_cost: 90, margin_override: null, base_price: 500, unit_label: null, sort_order: 260 },
  { slug: 'retainer-additional-clips', name: 'Additional 12 clips per quarter', package_slug: 'visibility-retainer', branch: null,
    description: 'A second batch of 12 branded short-form clips in the same quarter, from existing session footage.',
    time_hours: 4, hard_cost: 120, margin_override: null, base_price: 700, unit_label: null, sort_order: 270 },
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

const globalsMap = Object.fromEntries(GLOBALS.map((g) => [g.key, g.value]));

(async () => {
  console.log('\n  Sharp Sighted Ops · pricing worksheet seed\n');
  console.log(`  Target  : ${maskUrl(connectionString)}`);
  console.log(`  Mode    : ${dryRun ? 'DRY-RUN' : reset ? 'RESET + SEED' : 'UPSERT'}`);
  console.log(`  Counts  : ${GLOBALS.length} globals · ${PACKAGES.length} packages · ${ADDONS.length} addons\n`);

  try {
    await client.connect();

    if (dryRun) {
      printPriceReport();
      return;
    }

    if (reset) {
      console.log('  ⚠  --reset: TRUNCATE package_cost_lines, addons, packages, pricing_globals.');
      await client.query('TRUNCATE package_cost_lines, addons, packages, pricing_globals RESTART IDENTITY CASCADE;');
    }

    // ─── globals ────────────────────────────────────────────────────
    for (const g of GLOBALS) {
      await client.query(
        `INSERT INTO pricing_globals (key, label, value, unit, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (key) DO UPDATE SET
           label=EXCLUDED.label, value=EXCLUDED.value, unit=EXCLUDED.unit,
           notes=EXCLUDED.notes, sort_order=EXCLUDED.sort_order;`,
        [g.key, g.label, g.value, g.unit, g.notes, g.sort_order],
      );
    }
    console.log(`  ✓ ${GLOBALS.length} pricing globals upserted.`);

    // ─── packages + cost lines ──────────────────────────────────────
    const pkgIdBySlug = new Map();
    for (const p of PACKAGES) {
      const { website } = computeFromLines(p.lines, globalsMap, p.default_margin);
      const { rows } = await client.query(
        `INSERT INTO packages (slug, name, branch, description, default_margin, base_price, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, branch=EXCLUDED.branch, description=EXCLUDED.description,
           default_margin=EXCLUDED.default_margin, base_price=EXCLUDED.base_price,
           sort_order=EXCLUDED.sort_order
         RETURNING id, slug;`,
        [p.slug, p.name, p.branch, p.description, p.default_margin, website, p.sort_order],
      );
      const pkgId = rows[0].id;
      pkgIdBySlug.set(p.slug, pkgId);

      // Cost lines have no natural key — replace wholesale per package.
      await client.query('DELETE FROM package_cost_lines WHERE package_id = $1', [pkgId]);
      let order = 10;
      for (const ln of p.lines) {
        await client.query(
          `INSERT INTO package_cost_lines
             (package_id, kind, category, hours, rate_role, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7);`,
          [
            pkgId, ln.kind, ln.category,
            ln.kind === 'time' ? ln.hours : null,
            ln.kind === 'time' ? ln.rate_role : null,
            ln.kind === 'hard' ? ln.amount : null,
            order,
          ],
        );
        order += 10;
      }
    }
    console.log(`  ✓ ${PACKAGES.length} packages + cost lines upserted.`);

    // ─── addons ─────────────────────────────────────────────────────
    for (const a of ADDONS) {
      const pkgId = a.package_slug ? pkgIdBySlug.get(a.package_slug) : null;
      if (a.package_slug && !pkgId) {
        throw new Error(`Addon ${a.slug} references unknown package_slug=${a.package_slug}`);
      }
      await client.query(
        `INSERT INTO addons
           (slug, name, package_id, branch, description, time_hours, hard_cost,
            margin_override, base_price, unit_label, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, package_id=EXCLUDED.package_id, branch=EXCLUDED.branch,
           description=EXCLUDED.description, time_hours=EXCLUDED.time_hours,
           hard_cost=EXCLUDED.hard_cost, margin_override=EXCLUDED.margin_override,
           base_price=EXCLUDED.base_price, unit_label=EXCLUDED.unit_label,
           sort_order=EXCLUDED.sort_order;`,
        [a.slug, a.name, pkgId, a.branch, a.description, a.time_hours, a.hard_cost,
         a.margin_override, a.base_price, a.unit_label, a.sort_order],
      );
    }
    console.log(`  ✓ ${ADDONS.length} addons upserted.\n`);

    printPriceReport();
  } catch (err) {
    console.error('\n  ✗ Seed failed:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();

// ─── Reporting ────────────────────────────────────────────────────────
function printPriceReport() {
  console.log('  COMPUTED PACKAGE PRICES (cost lines → globals → margin → round-up)\n');
  console.log(`  ${pad('Package', 24)} ${pad('Hrs', 6)} ${pad('TimeC$', 9)} ${pad('HardC$', 9)} ${pad('Working', 10)} ${pad('Website', 9)}`);
  console.log('  ' + '─'.repeat(74));
  for (const p of PACKAGES) {
    const r = computeFromLines(p.lines, globalsMap, p.default_margin);
    console.log(
      `  ${pad(p.slug, 24)} ${pad(r.hours, 6)} ${pad('$' + fmt(r.timeCost), 9)} ${pad('$' + fmt(r.hardCost), 9)} ${pad('$' + fmt(r.working), 10)} ${pad('$' + fmt(r.website), 9)}`,
    );
  }
  console.log('');
  console.log('  Note: corp-team-day computes the full 12-person day ($1,600).');
  console.log('  The customer-facing model is $600 setup + per-person (D-010) —');
  console.log('  resolve before the calculator. All other packages are final.\n');
}

function pad(s, w) { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }
function fmt(n) { return Number(n).toLocaleString('en-US'); }
function maskUrl(url) {
  try { const u = new URL(url); if (u.password) u.password = '***'; return u.toString(); }
  catch { return '(unparseable URL)'; }
}
