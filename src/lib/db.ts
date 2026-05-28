import { Pool, type QueryResultRow } from 'pg';

/**
 * Single Postgres pool, shared across all server code. Vercel's Node
 * runtime keeps the module instance alive between invocations on the
 * same lambda warm path, so a pool is preferable to one-off clients.
 *
 * For local dev set DATABASE_URL in .env.local. For prod Vercel injects
 * it via its environment.
 *
 * Pattern mirrored from /projects/sharp/studio/src/lib/db.ts. Kept
 * import-compatible so a future shared package extraction is easy.
 */

declare global {
  var __ss_ops_pg_pool__: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. See .env.example.');
  }
  const pool = new Pool({
    connectionString,
    // Neon, Vercel Postgres, and most managed providers require TLS.
    // Local Postgres without TLS will need to override this via the
    // URL (e.g. ?sslmode=disable).
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10,
    // Aggressive idle close — keeps us ahead of Neon's server-side
    // idle timeout so we never hand a client a dead connection from
    // the pool. (Neon free-tier auto-suspends after ~5 min.)
    idleTimeoutMillis: 10_000,
    // Bound the initial connection attempt so a cold-wake doesn't
    // hang forever; the next request gets a fresh attempt.
    connectionTimeoutMillis: 10_000,
    // TCP-level keepalive — helps catch socket deaths between Node
    // and Neon's pooler before the next query tries to use them.
    keepAlive: true,
  });
  // Without this listener, an error on an idle pooled client (e.g.
  // Neon scaling the compute to zero) crashes the Node process. With
  // it, the pool just removes the dead client and the next query
  // opens a fresh one.
  pool.on('error', (err) => {
    console.error('[ops] pg pool idle-client error:', err.message);
  });
  return pool;
}

/**
 * Lazily construct the pool on first use. Two reasons we don't eagerly
 * init at module evaluation time:
 *   1. `next build` collects page data without DATABASE_URL set,
 *      and eager init would fail the build for every route that even
 *      transitively imports this module.
 *   2. Edge runtimes don't expose pg; if a route is later moved to the
 *      Edge runtime we'd want a clean import-time error there rather
 *      than a silent module init.
 *
 * Caches on globalThis in dev so HMR doesn't leak connections.
 */
export function getPool(): Pool {
  if (global.__ss_ops_pg_pool__) return global.__ss_ops_pg_pool__;
  const p = createPool();
  if (process.env.NODE_ENV !== 'production') {
    global.__ss_ops_pg_pool__ = p;
  }
  return p;
}

/**
 * Tagged-template wrapper around `pool.query` for the common case.
 *
 *   const rows = await sql<QuoteRow>`SELECT * FROM quotes WHERE id = ${id}`;
 *
 * Uses positional placeholders ($1, $2, ...) under the hood — safe from
 * SQL injection because values are passed as parameters, not interpolated.
 */
export async function sql<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}${strings[i + 1] ?? ''}`;
  }
  const result = await getPool().query<T>(text, values as unknown[]);
  return result.rows;
}

/**
 * Like `sql` but returns the first row or null. Convenience for the
 * common single-record lookup.
 */
export async function sqlOne<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T | null> {
  const rows = await sql<T>(strings, ...values);
  return rows[0] ?? null;
}

/**
 * True when `s` is a canonical UUID. Use it to guard a value from a route
 * param before it reaches a `WHERE id = $1` against a UUID column —
 * Postgres throws on a malformed UUID, which would surface as an
 * unhandled 500 instead of a clean not-found.
 */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
