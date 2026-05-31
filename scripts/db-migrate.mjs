#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Sharp Sighted Ops — schema migrator.
 *
 *   npm run db:migrate              # apply schema to the TESTING db (.env.local)
 *   npm run db:migrate:prod         # apply schema to PRODUCTION (.env.production) — confirms
 *   npm run db:check                # list tables on testing, don't apply
 *   npm run db:check:prod           # list tables on prod, don't apply
 *   npm run db:migrate:fresh        # DROP catalog/quote tables then re-apply (testing)
 *
 * Target selection is deterministic: the npm script you run picks the
 * database via its env file, and that file is authoritative over any
 * exported DATABASE_URL (see scripts/db-env.mjs). Writes to prod, and any
 * --fresh run, require a typed confirmation. The schema is idempotent
 * (every CREATE has IF NOT EXISTS), so re-running is safe.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { resolveDatabaseEnv, printTarget, confirmIfNeeded } from './db-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const schemaPath = join(rootDir, 'src', 'lib', 'db', 'schema.sql');

const argv = process.argv.slice(2);
const prod = argv.includes('--prod');
const check = argv.includes('--check');
const freshCatalog = argv.includes('--fresh-catalog');
const freshCrm = argv.includes('--fresh-crm');
const autoYes = argv.includes('--yes') || argv.includes('-y');

const resolved = resolveDatabaseEnv({ rootDir, prod, argv });
if (!resolved.ok) {
  console.error(`\n  ✗ ${resolved.error}\n`);
  process.exit(1);
}

// Catalog + quote tables, in FK-safe drop order. The --fresh-catalog
// flag drops these before re-applying the schema, so a structural
// change to packages (e.g. the cost-line refactor) lands cleanly.
// It does NOT touch the auth tables (users, accounts, sessions,
// verification_token) or ops_profiles — sign-in data is preserved.
const CATALOG_TABLES = [
  'quote_events',
  'quote_lines',
  'quotes',
  'addons',
  'package_cost_lines',
  'packages',
  'pricing_globals',
  'corporate_pricing',
];

// CRM / pipeline tables, in FK-safe drop order. The --fresh-crm flag
// drops these (and the quotes.prospect_id column) before re-applying the
// schema, so the Phase D multi-workflow restructure lands cleanly. Auth
// and catalog tables are untouched.
const CRM_TABLES = [
  'prospect_stage_events',
  'prospect_notes',
  'prospect_contacts',
  'prospects',
  'contact_scripts',
  'rank_factors',
  'rank_config',
  'handoff_links',
  'workflows',
];

const mode = check
  ? 'CHECK (read-only)'
  : [freshCatalog && 'FRESH-CATALOG', freshCrm && 'FRESH-CRM', 'APPLY'].filter(Boolean).join(' + ');

printTarget({
  title: 'Sharp Sighted Ops · DB migrator',
  resolved,
  schemaPath,
  mode,
});

const client = new pg.Client({
  connectionString: resolved.connectionString,
  ssl: resolved.connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

(async () => {
  const destructive = (freshCatalog || freshCrm) && !check;
  const okToProceed = await confirmIfNeeded({ resolved, check, destructive, autoYes });
  if (!okToProceed) {
    process.exitCode = 1;
    return;
  }

  try {
    await client.connect();

    if (freshCatalog && !check) {
      console.log('  ⚠  --fresh-catalog: dropping catalog + quote tables first.');
      console.log('     Auth tables (users, sessions, ops_profiles, …) are untouched.');
      for (const t of CATALOG_TABLES) {
        await client.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
      }
      console.log(`     Dropped: ${CATALOG_TABLES.join(', ')}\n`);
    }

    if (freshCrm && !check) {
      console.log('  ⚠  --fresh-crm: dropping CRM / pipeline tables first.');
      console.log('     Auth and catalog tables are untouched.');
      for (const t of CRM_TABLES) {
        await client.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
      }
      // The quotes.prospect_id FK is dropped with `prospects`; drop the
      // column too so the schema re-adds it with a fresh FK.
      await client.query('ALTER TABLE IF EXISTS quotes DROP COLUMN IF EXISTS prospect_id;');
      console.log(`     Dropped: ${CRM_TABLES.join(', ')} (+ quotes.prospect_id)\n`);
    }

    if (check) {
      const { rows } = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);
      if (rows.length === 0) {
        console.log('  (no public tables yet — run without --check to apply)');
      } else {
        console.log('  Existing public tables:');
        for (const r of rows) console.log(`    · ${r.table_name}`);
      }
      console.log('');
      return;
    }

    const sql = readFileSync(schemaPath, 'utf8');
    const start = Date.now();
    await client.query(sql);
    const elapsed = Date.now() - start;

    const { rows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log(`  ✓ Schema applied in ${elapsed} ms.\n`);
    console.log('  Tables now present:');
    for (const r of rows) console.log(`    · ${r.table_name}`);
    console.log('');
  } catch (err) {
    console.error('  ✗ Migration failed:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
