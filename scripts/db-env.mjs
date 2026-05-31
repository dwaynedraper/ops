/* eslint-disable no-console */
/**
 * Shared DB-env resolution + guard rails for the db:* scripts.
 *
 * Why this exists: the old flow was "export DATABASE_URL, swap it by hand,
 * run db:migrate." An exported variable sticks for the whole terminal and
 * silently overrides .env.local — so a one-off prod command quietly turned
 * every later migrate AND `npm run dev` into prod. This module makes the
 * target deterministic and loud:
 *
 *   • Which npm script you run picks the database (file is authoritative).
 *   • Every run prints the target host + where the value came from.
 *   • Writes to a prod target require a typed confirmation.
 *
 * No secrets are ever printed — only hosts and endpoint ids.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

/** Parse a dotenv-style file into a plain object. Does NOT mutate process.env. */
export function readEnvFile(path) {
  if (!existsSync(path)) return null;
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
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
    out[key] = value;
  }
  return out;
}

/** Host portion of a connection string, or '' if unparseable. */
export function hostOf(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    const m = /@([^/:?]+)/.exec(url);
    return m ? m[1] : '';
  }
}

/**
 * Neon endpoint id — the stable identity of a project's compute, ignoring
 * the pooler suffix so `…-pooler` and the direct host compare equal.
 * `ep-withered-meadow-aqrpxx16-pooler.c-8.…` → `ep-withered-meadow-aqrpxx16`.
 */
export function endpointId(host) {
  if (!host) return '';
  if (host === 'localhost' || host.startsWith('127.')) return 'localhost';
  return host.split('.')[0].replace(/-pooler$/, '');
}

export function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '(unparseable URL)';
  }
}

/**
 * Resolve which database a db:* script should talk to.
 *
 * File-authoritative: the chosen env file's DATABASE_URL wins over an
 * exported shell variable (the old silent-override footgun), and we warn
 * when they differ. `--use-env-url` opts back into the exported value for
 * CI / ad-hoc use. When no file exists at all, we fall back to the export.
 *
 * Sets process.env.DATABASE_URL to the resolved value so a script that
 * reads it later (or a wrapped launcher) sees the authoritative target.
 *
 * Returns: { ok, connectionString, source, host, endpointId, isProd,
 *            mismatch, error }
 */
export function resolveDatabaseEnv({ rootDir, prod, argv = [] }) {
  const fileName = prod ? '.env.production' : '.env.local';
  const fileEnv = readEnvFile(`${rootDir}/${fileName}`);
  const fileUrl = fileEnv?.DATABASE_URL || null;
  const exportedUrl = process.env.DATABASE_URL || null;
  const useEnvUrl = argv.includes('--use-env-url');

  let connectionString;
  let source;
  if (useEnvUrl && exportedUrl) {
    connectionString = exportedUrl;
    source = 'shell export (forced via --use-env-url)';
  } else if (fileUrl) {
    connectionString = fileUrl;
    source = fileName;
  } else if (exportedUrl) {
    connectionString = exportedUrl;
    source = `shell export (no ${fileName} found)`;
  } else {
    return {
      ok: false,
      error: `DATABASE_URL is not set. Add it to ${fileName} (or export it) and try again.`,
    };
  }

  // Carry any other keys from the file across without overriding, then pin
  // DATABASE_URL authoritatively for anything that reads it downstream.
  if (fileEnv) {
    for (const [k, v] of Object.entries(fileEnv)) {
      if (k !== 'DATABASE_URL' && !(k in process.env)) process.env[k] = v;
    }
  }
  process.env.DATABASE_URL = connectionString;

  const host = hostOf(connectionString);
  const epId = endpointId(host);

  // "Is this prod?" is data-driven: compare against .env.production's
  // endpoint id rather than guessing from the name.
  const prodFile = readEnvFile(`${rootDir}/.env.production`);
  const prodEpId = endpointId(hostOf(prodFile?.DATABASE_URL || ''));
  const isProd = !!prodEpId && epId === prodEpId;

  const mismatch =
    !useEnvUrl && fileUrl && exportedUrl && exportedUrl !== fileUrl
      ? { exportedHost: hostOf(exportedUrl), fileHost: host, fileName }
      : null;

  return { ok: true, connectionString, source, host, endpointId: epId, isProd, mismatch };
}

/** Print the standard target banner. `mode` is the script's action label. */
export function printTarget({ title, resolved, schemaPath, mode }) {
  console.log(`\n  ${title}\n`);
  console.log(`  Target  : ${maskUrl(resolved.connectionString)}`);
  console.log(`  Host    : ${resolved.host}${resolved.isProd ? '   ⟵ PRODUCTION' : ''}`);
  console.log(`  Source  : ${resolved.source}`);
  if (schemaPath) console.log(`  Schema  : ${schemaPath}`);
  if (mode) console.log(`  Mode    : ${mode}`);
  if (resolved.mismatch) {
    console.log('');
    console.log(
      `  ⚠  An exported DATABASE_URL (host ${resolved.mismatch.exportedHost}) is being`,
    );
    console.log(
      `     IGNORED in favour of ${resolved.mismatch.fileName} (host ${resolved.mismatch.fileHost}).`,
    );
    console.log('     Pass --use-env-url if you actually want the exported one.');
  }
  console.log('');
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Gate a write. Read-only (`check`) never prompts. A prod target, or any
 * destructive (drop-and-rebuild) run, requires a typed confirmation:
 *   • prod write       → type `prod`
 *   • destructive run  → type the endpoint id (forces you to read WHICH db)
 * `--yes` / `-y` skips the prompt (for automation). Non-interactive shells
 * without `--yes` abort rather than guess.
 *
 * Returns true to proceed, false to abort.
 */
export async function confirmIfNeeded({ resolved, check, destructive, autoYes }) {
  if (check) return true;
  if (!resolved.isProd && !destructive) return true;

  if (autoYes) {
    console.log('  (confirmation skipped via --yes)\n');
    return true;
  }

  if (!process.stdin.isTTY) {
    console.error('  ✗ Refusing to proceed against a protected target without a TTY.');
    console.error('    Re-run in an interactive terminal, or pass --yes if you are sure.\n');
    return false;
  }

  const phrase = destructive ? resolved.endpointId : 'prod';
  const what = destructive
    ? `DROP + rebuild tables on ${resolved.host}`
    : `write to PRODUCTION (${resolved.host})`;
  console.log(`  This will ${what}.`);
  const answer = await ask(`  Type "${phrase}" to continue (anything else aborts): `);
  if (answer !== phrase) {
    console.error('\n  ✗ Confirmation did not match — aborting. Nothing was changed.\n');
    return false;
  }
  console.log('');
  return true;
}
