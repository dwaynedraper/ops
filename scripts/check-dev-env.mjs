#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * predev guard — runs automatically before `npm run dev`.
 *
 * The dev server (Next.js) lets an exported DATABASE_URL override
 * .env.local, silently. That's how localhost ends up talking to prod. This
 * guard makes that impossible to do by accident:
 *
 *   • No exported DATABASE_URL  → silent, dev proceeds on .env.local.
 *   • Exported, non-prod        → warn (which host), proceed.
 *   • Exported, PROD            → block, unless ALLOW_PROD_DEV=1.
 *
 * Never prints secrets. Exit 0 lets dev run; exit 1 stops it.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readEnvFile, hostOf, endpointId } from './db-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const exported = process.env.DATABASE_URL;
if (!exported) {
  // The normal, safe path: dev will read .env.local.
  process.exit(0);
}

const host = hostOf(exported);
const epId = endpointId(host);
const prodEpId = endpointId(hostOf(readEnvFile(join(rootDir, '.env.production'))?.DATABASE_URL || ''));
const localEpId = endpointId(hostOf(readEnvFile(join(rootDir, '.env.local'))?.DATABASE_URL || ''));
const isProd = !!prodEpId && epId === prodEpId;

console.log('');
console.log('  ┌─ dev env check ─────────────────────────────────────────');
console.log(`  │  DATABASE_URL is EXPORTED in this shell (host ${host}).`);
console.log('  │  Next.js dev will use THIS, not .env.local.');

if (isProd) {
  console.log('  │');
  console.log('  │  ⛔ That is your PRODUCTION database. Running the dev app');
  console.log('  │     against prod is almost never what you want.');
  console.log('  │');
  console.log('  │  Fix: run  unset DATABASE_URL  (or open a new terminal),');
  console.log('  │       then `npm run dev` again — it will use .env.local.');
  console.log('  │  Override (only if you truly mean it):  ALLOW_PROD_DEV=1 npm run dev');
  console.log('  └─────────────────────────────────────────────────────────');
  console.log('');
  if (process.env.ALLOW_PROD_DEV === '1') {
    console.log('  ALLOW_PROD_DEV=1 set — proceeding against prod. Be careful.\n');
    process.exit(0);
  }
  process.exit(1);
}

if (localEpId && epId === localEpId) {
  console.log('  │  (This matches .env.local, so no harm — just noting it.)');
} else {
  console.log('  │  Unrecognised target — double-check it is what you intend.');
}
console.log('  └─────────────────────────────────────────────────────────');
console.log('');
process.exit(0);
