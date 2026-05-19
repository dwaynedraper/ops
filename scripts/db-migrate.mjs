#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Sharp Sighted Ops — schema migrator.
 *
 *   npm run db:migrate            # apply src/lib/db/schema.sql to DATABASE_URL
 *   npm run db:migrate -- --check # connect and list tables, don't apply
 *
 * Reads DATABASE_URL from .env.local first, then process.env. The
 * schema file is idempotent (every CREATE has IF NOT EXISTS), so this
 * is safe to run repeatedly.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const schemaPath = join(rootDir, 'src', 'lib', 'db', 'schema.sql');
const envPath = join(rootDir, '.env.local');

// ─── Tiny .env.local loader (avoids adding dotenv as a runtime dep) ───
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('✗ DATABASE_URL is not set. Add it to .env.local and try again.');
  process.exit(1);
}

const check = process.argv.includes('--check');

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

const banner = '\n  Sharp Sighted Ops · DB migrator\n';

(async () => {
  console.log(banner);
  console.log(`  Target  : ${maskUrl(connectionString)}`);
  console.log(`  Schema  : ${schemaPath}`);
  console.log(`  Mode    : ${check ? 'CHECK (read-only)' : 'APPLY'}\n`);

  try {
    await client.connect();

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

function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(unparseable URL)';
  }
}
