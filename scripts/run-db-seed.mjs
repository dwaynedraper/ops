#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Guard-railed launcher for the catalog seeder.
 *
 *   npm run db:seed            # seed the TESTING db (.env.local)
 *   npm run db:seed:dry        # print the price report, write nothing (testing)
 *   npm run db:seed:prod       # seed PRODUCTION (.env.production) — confirms
 *   npm run db:seed:prod:dry   # dry-run against prod
 *
 * This wraps the existing scripts/db-seed.mjs without modifying it: it
 * resolves the target deterministically from the right env file (file
 * authoritative over an exported DATABASE_URL), prints the target, asks
 * for a typed confirmation on prod writes, then hands off. db-seed.mjs
 * reads the now-pinned DATABASE_URL and runs.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveDatabaseEnv, printTarget, confirmIfNeeded } from './db-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const argv = process.argv.slice(2);
const prod = argv.includes('--prod');
const dryRun = argv.includes('--dry-run');
const autoYes = argv.includes('--yes') || argv.includes('-y');

const resolved = resolveDatabaseEnv({ rootDir, prod, argv });
if (!resolved.ok) {
  console.error(`\n  ✗ ${resolved.error}\n`);
  process.exit(1);
}

printTarget({
  title: 'Sharp Sighted Ops · catalog seeder',
  resolved,
  mode: dryRun ? 'DRY-RUN (no writes)' : 'SEED (upsert)',
});

// Seeding is upserts, not drops — `destructive: false`. A prod write still
// confirms because resolved.isProd is true; a dry-run never writes.
const okToProceed = await confirmIfNeeded({
  resolved,
  check: dryRun,
  destructive: false,
  autoYes,
});
if (!okToProceed) {
  process.exit(1);
}

// db-seed.mjs reads its flags from process.argv and DATABASE_URL from the
// environment. resolveDatabaseEnv already pinned process.env.DATABASE_URL
// to the confirmed target; make sure --dry-run is visible to it.
if (dryRun && !process.argv.includes('--dry-run')) {
  process.argv.push('--dry-run');
}

await import('./db-seed.mjs');
