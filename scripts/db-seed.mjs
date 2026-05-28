#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Sharp Sighted Ops — catalog + config seed.
 *
 * Seeds the pricing catalog (globals, packages, cost lines, addons,
 * corporate formula) and the CRM config (rank factors, rank thresholds,
 * contact scripts). All upserts are idempotent.
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
    description: '2-hour session · 1 location · 1 wardrobe · 8 hand-edited images · 5 framed letter prints · 7-day delivery.',
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
    description: '6 hours · unlimited locations + wardrobe · 16 hand-edited images · 6 framed letters + 1 framed 13×19 · 14-day delivery.',
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
    description: '2 days · with team · creative direction · 35 hand-edited finals + documentary video · 2 museum prints + Heirloom Book · Fine Art Collection · 45-day delivery.',
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
  // NOTE: Corporate headshots (Single Executive, Team Day) are NOT in
  // the worksheet model — they price on a parametric formula. See the
  // CORPORATE_PRICING block below and decision D-013.
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
  // Corporate add-ons (Featured upgrade, per-person, Featured-for-principal)
  // are absorbed into the corporate formula — see CORPORATE_PRICING.
  { slug: 'essentials-cinematic-walkthrough', name: 'Cinematic walkthrough with agent voiceover', package_slug: 'essentials', branch: null,
    description: 'Gimbal-stabilized walkthrough video with agent voiceover, color-graded and music-bedded.',
    time_hours: 3, hard_cost: 90, margin_override: null, base_price: 500, unit_label: null, sort_order: 260 },
  { slug: 'retainer-additional-clips', name: 'Additional 12 clips per quarter', package_slug: 'visibility-retainer', branch: null,
    description: 'A second batch of 12 branded short-form clips in the same quarter, from existing session footage.',
    time_hours: 4, hard_cost: 120, margin_override: null, base_price: 700, unit_label: null, sort_order: 270 },
];

// ═══════════════════════════════════════════════════════════════════════
// CORPORATE PRICING — parametric formula config (D-013)
// Corporate headshots do not use the cost-line worksheet. These are the
// editable inputs; the formula lives in src/lib/pricing.ts.
//
// Single Executive prices are fixed by Dean ($670 / $920). The Team Day
// per-person rates below ($80 standard, $300 featured) are placeholders
// carried over from the wall card — Dean to confirm/edit on the
// /corporate config page.
// ═══════════════════════════════════════════════════════════════════════
const CORPORATE_PRICING = [
  { key: 'single_standard_price',        label: 'Single Executive — standard',     value: 670,  unit: 'usd',            notes: 'One executive, standard headshot deliverable.',           sort_order: 10 },
  { key: 'single_featured_price',        label: 'Single Executive — featured',     value: 920,  unit: 'usd',            notes: 'One executive, Featured editorial deliverable.',          sort_order: 20 },
  { key: 'team_base_price',              label: 'Team Day — base',                 value: 600,  unit: 'usd',            notes: 'Team Day setup/base fee, standard.',                      sort_order: 30 },
  { key: 'team_base_promo_price',        label: 'Team Day — base (first-time/promo)', value: 300, unit: 'usd',          notes: 'Half-off base for new customers; promo toggle.',          sort_order: 40 },
  { key: 'team_per_person_rate',         label: 'Team Day — per person (standard)', value: 80,   unit: 'usd_per_person', notes: 'PLACEHOLDER from wall card — confirm.',                   sort_order: 50 },
  { key: 'team_featured_per_person_rate',label: 'Team Day — per person (featured)', value: 300,  unit: 'usd_per_person', notes: 'PLACEHOLDER from wall card — confirm.',                   sort_order: 60 },
  { key: 'volume_tier1_min',             label: 'Volume tier 1 — min headcount',   value: 15,   unit: 'count',          notes: 'At/above this count, tier-1 discount applies.',           sort_order: 70 },
  { key: 'volume_tier1_discount',        label: 'Volume tier 1 — discount',        value: 0.05, unit: 'ratio',          notes: '5% off the per-person rate at 15+.',                      sort_order: 80 },
  { key: 'volume_tier2_min',             label: 'Volume tier 2 — min headcount',   value: 30,   unit: 'count',          notes: 'At/above this count, tier-2 discount applies.',           sort_order: 90 },
  { key: 'volume_tier2_discount',        label: 'Volume tier 2 — discount',        value: 0.15, unit: 'ratio',          notes: '15% off the per-person rate at 30+.',                     sort_order: 100 },
];

// ═══════════════════════════════════════════════════════════════════════
// CRM CONFIG — five workflows, each with its own entry gate, scoring
// factors, contact scripts, and handoff links (Phase D · D-022). Seeded
// so the pipeline works before its editors do; retunable on the
// rank-factor and script editor pages.
// ═══════════════════════════════════════════════════════════════════════

// Default Sprout handoff URL — a placeholder. Dean sets the real
// per-workflow links on the handoff-links editor.
const BOOKING_URL = 'https://sharpsightedphotos.sproutstudio.com/book/connection-call-booking';

// Factor builders. A gate factor (is_gate, weight 0) must answer true to
// enter the pipeline and does not score. Scoring weights sum to 10 per
// workflow, so a maxed-out prospect lands a clean 10.
// D-032: gates can carry a weight too. They're still gates (gatesPassed
// blocks entry until they're all true), but if their weight is > 0 they
// also add to the 0–10 score. Defaults to 0 to preserve the original
// behavior for workflows that haven't been reweighted yet.
const gate = (key, label, help_text, sort_order, weight = 0) =>
  ({ key, label, help_text, kind: 'bool', weight, max_input: null, is_gate: true, sort_order });
const boolF = (key, label, help_text, weight, sort_order) =>
  ({ key, label, help_text, kind: 'bool', weight, max_input: null, is_gate: false, sort_order });
const numF = (key, label, help_text, weight, max_input, sort_order) =>
  ({ key, label, help_text, kind: 'number', weight, max_input, is_gate: false, sort_order });

const thresholds = (qualified, borderline, target) => [
  { key: 'qualified_min',          label: 'Qualified — minimum score',  value: qualified,  notes: 'Score at/above this is a highly-qualified candidate.' },
  { key: 'borderline_min',         label: 'Borderline — minimum score', value: borderline, notes: 'At/above this is a judgment call; below it, do not message.' },
  { key: 'qualified_target_count', label: 'Qualified target count',     value: target,     notes: 'Once a rep has this many qualified prospects, prompt the contact cycle.' },
];

const BOOKING_LINK = { link_key: 'booking_link', label: 'Connection-call booking', url: BOOKING_URL, sort_order: 10 };

const WORKFLOWS = [
  // ─── Real Estate Media ────────────────────────────────────────────
  {
    workflow_key: 'real_estate', name: 'Real Estate Media', branch: 'realestate',
    // D-053: brand gold — the Sharp pillar's Media accent.
    contact_noun: 'Agent', org_noun: 'Agency', accent: '#c9922a', sort_order: 10,
    factors: [
      // D-032 — gates now anchor the score; annual_volume runs on a
      // piecewise curve (lib/prospects.ts PIECEWISE_CURVES) so 10
      // listings = 2.0 and 30 listings = 3.0. Weight totals to 10.
      gate('has_target_listing', 'Has a current target listing', 'A live listing now in the $500K–$2M range — something worth shooting.', 1, 1),
      gate('has_photo_need',     'Has a visible photo need',     'Their current listing photos are weak or missing — a real gap to fill.', 2, 1),
      numF('annual_volume',       'Listings per year ($500K–$2M)',  'Homes the agent closes annually in the target price band. 10 listings ≈ 2.0 pts, 30 ≈ 3.0 (piecewise).', 3, 30, 10),
      boolF('weak_current_photos','Current listing photos are weak', 'A visible quality gap on their live listings — the clearest opportunity.', 2, 20),
      boolF('active_social',      'Active on social (last 30 days)', 'Posts regularly — a sign they value visibility and will value media.',   1, 30),
      boolF('pro_website',        'Has a real personal website',     'A proper site on their own domain — they invest in their brand.',         1, 40),
      boolF('uses_video',         'Already uses video in listings',  'Comfortable with video — an easier sell for reels and walkthroughs.',     1, 50),
      // branded_email dropped (D-032) — redundant with pro_website. The
      // schema.sql migration deactivates the existing row.
    ],
    thresholds: thresholds(8, 6, 10),
    links: [BOOKING_LINK],
    scripts: [
      {
        stage_key: 'first_touch', label: 'First touch', channel: 'email',
        step_order: 10, followup_after_days: 3,
        subject: '{{first_name}} — a quick note on your {{agency}} listings',
        body: `Hi {{first_name}},

{{intro}}

I shoot real estate media in the 121 corridor — stills, aerial, floor plan, twilight, and a vertical reel, all delivered within 24 hours. One shoot, five deliverables, MLS-ready.

If you have a listing coming up, I'd love to show you what that looks like on one of yours.

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted Media
sharpsighted.media`,
      },
      {
        stage_key: 'followup_1', label: 'Follow-up 1', channel: 'email',
        step_order: 20, followup_after_days: 4,
        subject: 'Re: your {{agency}} listings',
        body: `Hi {{first_name}},

Circling back — no pressure either way. {{intro}}

The Essentials package is $400 a property: stills, aerial, floor plan, twilight, and a vertical reel, turned around in 24 hours. For agents working the $500K–$2M range, it tends to pay for itself on the first listing.

Worth a look at one of yours?

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted Media`,
      },
      {
        stage_key: 'followup_2', label: 'Follow-up 2', channel: 'email',
        step_order: 30, followup_after_days: 5,
        subject: 'Re: your {{agency}} listings',
        body: `Hi {{first_name}},

Last note from me for now. {{intro}}

If marketing is a competitive advantage for you and not just a line item, I'd like to earn one listing and let the work speak for itself. 24-hour turnaround, every time.

Reach out whenever the timing is right.

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted Media`,
      },
      {
        stage_key: 'final', label: 'Final touch', channel: 'email',
        step_order: 40, followup_after_days: 0,
        subject: 'Closing the loop, {{first_name}}',
        body: `Hi {{first_name}},

I won't keep landing in your inbox — but I wanted to close the loop properly. {{intro}}

If real estate media ever moves up your list, sharpsighted.media has examples and pricing, and my line is always open.

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted Media`,
      },
    ],
  },

  // ─── Corporate Headshots ──────────────────────────────────────────
  {
    workflow_key: 'corporate', name: 'Corporate Headshots', branch: 'corporate',
    // D-053: violet.
    contact_noun: 'Contact', org_noun: 'Company', accent: '#8b5cf6', sort_order: 20,
    factors: [
      gate('has_team_to_shoot', 'Has a team that needs headshots', 'Enough people on staff — roughly 8 or more — to make a Team Day worth booking.', 1),
      gate('weak_team_photos',  'Current team photos are weak or mismatched', 'Headshots on the site and LinkedIn are dated, inconsistent, DIY, or missing.', 2),
      numF('headcount',             'Team size',                          'Headcount in the shootable band. Full credit at 40.',                       3, 40, 10),
      boolF('professional_services','A professional-services firm',        'Law, finance, agency, medical, consulting — image is part of the product.', 2, 20),
      boolF('recent_growth',        'Hiring or growing',                   'New faces need headshots, and a growing firm rebooks.',                     2, 30),
      boolF('brand_refresh',        'Brand refresh or new website underway','A redesign is the natural trigger for new team photos.',                    1, 40),
      boolF('in_service_area',      'In the 121 corridor / DFW',           'Inside the service area — no travel premium needed.',                       1, 50),
      boolF('decision_maker_known', 'A clear contact who can book it',     'You know who decides — HR, an office manager, a partner.',                  1, 60),
    ],
    thresholds: thresholds(8, 6, 8),
    links: [BOOKING_LINK],
    scripts: [
      {
        stage_key: 'first_touch', label: 'First touch', channel: 'email',
        step_order: 10, followup_after_days: 3,
        subject: '{{first_name}} — the headshots on the {{company}} site',
        body: `Hi {{first_name}},

{{intro}}

I do corporate headshots for firms across the 121 corridor — one on-site session, the whole team, consistent lighting and treatment so every face on your site and LinkedIn finally matches.

Most teams I shoot have headshots taken five different ways over five different years. One Team Day fixes that, and it photographs faster than people expect.

If a refresh is on your radar, here's where to start: {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted`,
      },
      {
        stage_key: 'followup_1', label: 'Follow-up 1', channel: 'email',
        step_order: 20, followup_after_days: 4,
        subject: 'Re: {{company}} headshots',
        body: `Hi {{first_name}},

Circling back — no pressure. {{intro}}

A Team Day is a $600 base plus a per-person rate, on-site, with same-day-clean turnaround. For a firm where the team's image is part of the pitch, it tends to earn its keep the first time a client looks you up.

Worth a short call? {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted`,
      },
      {
        stage_key: 'followup_2', label: 'Follow-up 2', channel: 'email',
        step_order: 30, followup_after_days: 5,
        subject: 'Re: {{company}} headshots',
        body: `Hi {{first_name}},

Last note from me for now. {{intro}}

If you're hiring, rebranding, or just tired of the mismatched grid, one session resets all of it — and new hires slot into the same look later.

Whenever the timing's right: {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted`,
      },
      {
        stage_key: 'final', label: 'Final touch', channel: 'email',
        step_order: 40, followup_after_days: 0,
        subject: 'Closing the loop, {{first_name}}',
        body: `Hi {{first_name}},

I won't keep landing in your inbox. {{intro}}

If team headshots ever move up the list at {{company}}, the door's here and my line is open: {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted`,
      },
    ],
  },

  // ─── Story Portraits ──────────────────────────────────────────────
  {
    workflow_key: 'story_portraits', name: 'Story Portraits', branch: 'portraits',
    // D-053: brand cyan — the Photos pillar (Seen).
    contact_noun: 'Contact', org_noun: null, accent: '#38bdf8', sort_order: 30,
    factors: [
      gate('public_facing_brand',  'Has a public-facing personal brand', 'A founder, exec, creator, author, or speaker — someone whose face is part of their work.', 1),
      gate('weak_personal_photos', 'Current personal photos are weak',   'Their portraits are outdated, DIY, or a generic studio headshot.', 2),
      boolF('concrete_reason',  'A concrete reason now',                  'A new book, a new role, a rebrand, the speaking circuit — a trigger, not "someday".', 3, 10),
      boolF('active_presence',  'An active public presence',              'Speaking, publishing, posting — they show up online and in rooms.',                    2, 20),
      boolF('invests_in_brand', 'Invests in their brand',                 'A real personal site or prior paid creative — they spend on being seen.',              2, 30),
      boolF('story_fits',       "A story that doesn't fit a backdrop",    'Their narrative needs a real location — the Sharp Sighted right-fit buyer.',           2, 40),
      boolF('budget_signal',    'Budget signal',                          'Their role or business suggests the means for a $900–$1,700+ session.',                1, 50),
    ],
    thresholds: thresholds(8, 6, 10),
    links: [BOOKING_LINK],
    scripts: [
      {
        stage_key: 'first_touch', label: 'First touch', channel: 'email',
        step_order: 10, followup_after_days: 3,
        subject: '{{first_name}} — a portrait that actually looks like you',
        body: `Hi {{first_name}},

{{intro}}

I make story portraits for founders and creators whose work is personal — sessions that happen where you actually are, not against a studio backdrop. A workshop, a rooftop, a stable at dawn. Wherever the real version of you shows up.

If your current photos feel like a stand-in for someone you're not anymore, that's exactly the gap I close.

A connection call is the place to start — no commitment: {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted Photos`,
      },
      {
        stage_key: 'followup_1', label: 'Follow-up 1', channel: 'email',
        step_order: 20, followup_after_days: 4,
        subject: 'Re: your portraits',
        body: `Hi {{first_name}},

Circling back. {{intro}}

The way it works: an hour of discovery first — your location, your timing, your story — then we shoot on your stage. You get hand-edited images and framed prints, delivered in person, not dropped at a door.

Want to talk it through? {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted Photos`,
      },
      {
        stage_key: 'followup_2', label: 'Follow-up 2', channel: 'email',
        step_order: 30, followup_after_days: 5,
        subject: 'Re: your portraits',
        body: `Hi {{first_name}},

Last note for now. {{intro}}

The portrait that follows you for the next five years should look like you — not a pleasant compromise. When you're ready for that, I'd love to make it.

Whenever the timing fits: {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted Photos`,
      },
      {
        stage_key: 'final', label: 'Final touch', channel: 'email',
        step_order: 40, followup_after_days: 0,
        subject: 'Closing the loop, {{first_name}}',
        body: `Hi {{first_name}},

I'll stop here — but I wanted to close the loop properly. {{intro}}

If the timing ever turns, the connection call is always open: {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted Photos`,
      },
    ],
  },

  // ─── The Saga ─────────────────────────────────────────────────────
  {
    workflow_key: 'saga', name: 'The Saga', branch: 'portraits',
    // D-053: dramatic red. Note: this collides with the workflow-row
    // rejected-state styling — F7's REJECTED badge + 55% opacity is the
    // disambiguation (D-055).
    contact_noun: 'Contact', org_noun: null, accent: '#dc2626', sort_order: 40,
    factors: [
      gate('milestone_reason', 'A milestone or legacy reason',    'An anniversary, an exit, a legacy year — a reason this chapter deserves more than a session.', 1),
      gate('budget_capacity',  'Budget capacity for $8k+',        'The means and the mindset for a two-day, $8,000+ engagement.', 2),
      boolF('merged_life_work',     'Life and work have merged',          'A founder whose identity and what they have built are inseparable.',     3, 10),
      boolF('existing_relationship','An existing relationship or referral','A past Story client or a strong referral — the Saga rarely sells cold.', 3, 20),
      boolF('story_scale',          'A story big enough',                 'Too vast for a single binding — a real arc, multiple chapters.',         2, 30),
      boolF('decision_authority',   'Decides on their own',               'No committee — they can say yes to a premium engagement themselves.',    1, 40),
      boolF('timing_window',        'A timing window',                    'The milestone has a date — there is a reason to move now.',              1, 50),
    ],
    thresholds: thresholds(8, 6, 5),
    links: [BOOKING_LINK],
    scripts: [
      {
        stage_key: 'first_touch', label: 'Opening', channel: 'email',
        step_order: 10, followup_after_days: 5,
        subject: '{{first_name}} — something bigger than a session',
        body: `Hi {{first_name}},

{{intro}}

There's a kind of project I take on rarely — a two-day engagement called the Saga. It's for the moment a person's life and work have fully merged: a milestone year, a legacy worth documenting properly. Not a photo session — a complete visual and film record, built to last as an object.

Given where you are right now, I think it's worth a conversation. No pitch — just a talk about whether this is the chapter for it.

If you're open to it: {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted`,
      },
      {
        stage_key: 'followup_1', label: 'Follow-up', channel: 'email',
        step_order: 20, followup_after_days: 7,
        subject: 'Re: the Saga',
        body: `Hi {{first_name}},

Following up gently. {{intro}}

The Saga isn't something to rush into — it's a real investment of two days and real money, and it should land on a milestone, not a whim. That's exactly why I'd rather we just talk first.

The door's here when you want it: {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted`,
      },
      {
        stage_key: 'final', label: 'Final touch', channel: 'email',
        step_order: 30, followup_after_days: 0,
        subject: 'Closing the loop, {{first_name}}',
        body: `Hi {{first_name}},

I'll leave it here for now. {{intro}}

A Saga keeps. When the milestone comes into view, I'd be honored to document it — reach out any time: {{booking_link}}

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted`,
      },
    ],
  },

  // ─── The 10% Rule ─────────────────────────────────────────────────
  // Contribution, not sales — the gate is the §7.1/§7.2 fit check, the
  // factors are fit-and-priority signals, and there is no quote.
  {
    workflow_key: 'ten_percent', name: 'The 10% Rule', branch: null,
    // D-053: fuchsia / hot pink — signals contribution, not sales.
    contact_noun: 'Contact', org_noun: 'Organization', accent: '#ec4899', sort_order: 50,
    factors: [
      gate('on_cause_list',  'On the supported-cause list (§7.1)', 'The cause fits a category Dean actively supports — see CLAUDE.md §7.1.', 1),
      gate('non_polarizing', 'Non-polarizing (§7.2)',              'Not a politically polarizing issue — the 10% engine is contribution, not activism.', 2),
      boolF('clear_need',          'A clear, concrete need',         'A specific thing photography or film can give them — not vague.',          3, 10),
      boolF('story_worth_telling', 'A story worth telling',          'Documenting this would move people and reflect the brand\'s heart.',        3, 20),
      boolF('capacity_to_deliver', 'Capacity to deliver it well',    'It fits the 10% time and resources available right now — capacity is finite.', 2, 30),
      boolF('lasting_artifact',    'Becomes a lasting artifact',     'The work becomes an heirloom-grade object, not just files.',                2, 40),
    ],
    thresholds: thresholds(8, 6, 3),
    links: [],
    scripts: [
      {
        stage_key: 'first_touch', label: 'The offer', channel: 'email',
        step_order: 10, followup_after_days: 5,
        subject: 'An offer for {{organization}}',
        body: `Hi {{first_name}},

{{intro}}

I run a photography and film studio in North Texas, and a standing part of how it works is the 10% Rule — I give a tenth of my time and craft to causes I believe in. The same work I'd charge for, done for free, for the right people and the right missions.

What {{organization}} does is one of those. If there's a story here that photographs or film could carry — for the people you serve, or for the work itself — I'd like to offer that, at no cost.

Could we talk about what would actually help?

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted`,
      },
      {
        stage_key: 'followup_1', label: 'Follow-up', channel: 'email',
        step_order: 20, followup_after_days: 0,
        subject: 'Re: an offer for {{organization}}',
        body: `Hi {{first_name}},

Just circling back once. {{intro}}

The offer stands with no strings — contributed photography or film for {{organization}}, on your timeline. If it's useful, I'd love to help; if the timing isn't right, no need to reply.

Stay Sharp. Stay Seen. Stay Human.
{{rep_name}} · Sharp Sighted`,
      },
    ],
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

const globalsMap = Object.fromEntries(GLOBALS.map((g) => [g.key, g.value]));

(async () => {
  console.log('\n  Sharp Sighted Ops · pricing worksheet seed\n');
  console.log(`  Target  : ${maskUrl(connectionString)}`);
  console.log(`  Mode    : ${dryRun ? 'DRY-RUN' : reset ? 'RESET + SEED' : 'UPSERT'}`);
  console.log(`  Counts  : ${GLOBALS.length} globals · ${PACKAGES.length} packages · ${ADDONS.length} addons · ${CORPORATE_PRICING.length} corporate params`);
  console.log(`            ${WORKFLOWS.length} workflows · CRM scoring, scripts, and handoff links\n`);

  try {
    await client.connect();

    if (dryRun) {
      printPriceReport();
      return;
    }

    if (reset) {
      console.log('  ⚠  --reset: TRUNCATE package_cost_lines, addons, packages, pricing_globals, corporate_pricing.');
      await client.query('TRUNCATE package_cost_lines, addons, packages, pricing_globals, corporate_pricing RESTART IDENTITY CASCADE;');
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

    // ─── corporate pricing ──────────────────────────────────────────
    for (const c of CORPORATE_PRICING) {
      await client.query(
        `INSERT INTO corporate_pricing (key, label, value, unit, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (key) DO UPDATE SET
           label=EXCLUDED.label, value=EXCLUDED.value, unit=EXCLUDED.unit,
           notes=EXCLUDED.notes, sort_order=EXCLUDED.sort_order;`,
        [c.key, c.label, c.value, c.unit, c.notes, c.sort_order],
      );
    }
    console.log(`  ✓ ${CORPORATE_PRICING.length} corporate pricing params upserted.`);

    // ─── CRM config: workflows + per-workflow factors/scripts/links ──
    let factorCount = 0;
    let scriptCount = 0;
    let linkCount = 0;
    for (const w of WORKFLOWS) {
      await client.query(
        `INSERT INTO workflows
           (workflow_key, name, branch, contact_noun, org_noun, accent, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (workflow_key) DO UPDATE SET
           name=EXCLUDED.name, branch=EXCLUDED.branch, contact_noun=EXCLUDED.contact_noun,
           org_noun=EXCLUDED.org_noun, accent=EXCLUDED.accent, sort_order=EXCLUDED.sort_order;`,
        [w.workflow_key, w.name, w.branch, w.contact_noun, w.org_noun, w.accent, w.sort_order],
      );
      for (const f of w.factors) {
        await client.query(
          `INSERT INTO rank_factors
             (workflow_key, key, label, help_text, kind, weight, max_input, is_gate, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (workflow_key, key) DO UPDATE SET
             label=EXCLUDED.label, help_text=EXCLUDED.help_text, kind=EXCLUDED.kind,
             weight=EXCLUDED.weight, max_input=EXCLUDED.max_input, is_gate=EXCLUDED.is_gate,
             sort_order=EXCLUDED.sort_order;`,
          [w.workflow_key, f.key, f.label, f.help_text, f.kind, f.weight, f.max_input, f.is_gate, f.sort_order],
        );
        factorCount++;
      }
      for (const r of w.thresholds) {
        await client.query(
          `INSERT INTO rank_config (workflow_key, key, label, value, notes)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (workflow_key, key) DO UPDATE SET
             label=EXCLUDED.label, value=EXCLUDED.value, notes=EXCLUDED.notes;`,
          [w.workflow_key, r.key, r.label, r.value, r.notes],
        );
      }
      for (const s of w.scripts) {
        await client.query(
          `INSERT INTO contact_scripts
             (workflow_key, stage_key, label, channel, step_order, followup_after_days, subject, body)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (workflow_key, stage_key) DO UPDATE SET
             label=EXCLUDED.label, channel=EXCLUDED.channel, step_order=EXCLUDED.step_order,
             followup_after_days=EXCLUDED.followup_after_days,
             subject=EXCLUDED.subject, body=EXCLUDED.body;`,
          [w.workflow_key, s.stage_key, s.label, s.channel, s.step_order, s.followup_after_days, s.subject, s.body],
        );
        scriptCount++;
      }
      for (const l of w.links) {
        await client.query(
          `INSERT INTO handoff_links (workflow_key, link_key, label, url, sort_order)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (workflow_key, link_key) DO UPDATE SET
             label=EXCLUDED.label, url=EXCLUDED.url, sort_order=EXCLUDED.sort_order;`,
          [w.workflow_key, l.link_key, l.label, l.url, l.sort_order],
        );
        linkCount++;
      }
    }
    console.log(
      `  ✓ ${WORKFLOWS.length} workflows · ${factorCount} factors · ${scriptCount} scripts · ${linkCount} links upserted.`,
    );

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

  // ─── Corporate formula preview ──────────────────────────────────────
  const c = Object.fromEntries(CORPORATE_PRICING.map((r) => [r.key, r.value]));
  const vDisc = (n) =>
    n >= c.volume_tier2_min ? c.volume_tier2_discount
    : n >= c.volume_tier1_min ? c.volume_tier1_discount
    : 0;
  const teamDay = (std, feat, promo) => {
    const base = promo ? c.team_base_promo_price : c.team_base_price;
    const s = std * c.team_per_person_rate * (1 - vDisc(std));
    const f = feat * c.team_featured_per_person_rate * (1 - vDisc(feat));
    return Math.round((base + s + f) * 100) / 100;
  };
  console.log('\n  CORPORATE — parametric formula (not the worksheet)\n');
  console.log(`    Single Executive · standard          $${fmt(c.single_standard_price)}`);
  console.log(`    Single Executive · featured          $${fmt(c.single_featured_price)}`);
  console.log(`    Team Day · 12 standard               $${fmt(teamDay(12, 0, false))}`);
  console.log(`    Team Day · 12 standard (first-time)  $${fmt(teamDay(12, 0, true))}`);
  console.log(`    Team Day · 15 standard (5% volume)   $${fmt(teamDay(15, 0, false))}`);
  console.log(`    Team Day · 30 standard (15% volume)  $${fmt(teamDay(30, 0, false))}`);
  console.log(`    Team Day · 15 std + 2 featured       $${fmt(teamDay(15, 2, false))}`);
  console.log('');
  console.log('  Team Day per-person rates ($80 / $300) are placeholders —');
  console.log('  set the real numbers on the /corporate config page.\n');

  // ─── CRM config preview ─────────────────────────────────────────────
  console.log('  CRM CONFIG — five workflows\n');
  for (const w of WORKFLOWS) {
    const gates = w.factors.filter((f) => f.is_gate).length;
    const scoring = w.factors.filter((f) => !f.is_gate);
    const sum = scoring.reduce((s, f) => s + f.weight, 0);
    console.log(
      `    ${pad(w.name, 22)} ${gates} gates · ${scoring.length} factors (Σ${sum}) · ${w.scripts.length} scripts · ${w.links.length} links`,
    );
  }
  console.log('');
}

function pad(s, w) { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }
function fmt(n) { return Number(n).toLocaleString('en-US'); }
function maskUrl(url) {
  try { const u = new URL(url); if (u.password) u.password = '***'; return u.toString(); }
  catch { return '(unparseable URL)'; }
}
