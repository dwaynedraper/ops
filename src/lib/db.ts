import { Pool, type PoolClient, type QueryResultRow } from 'pg';

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
    // Headroom over the worst-case render burst: the prospect/jobs pages
    // await a ~5-way Promise.all, and getCatalog used to add 5 more. Even
    // with getCatalog now down to a single client (see withClient), 15
    // keeps us clear of the acquire-timeout cliff if two heavy renders
    // overlap. The Neon pooler multiplexes these server-side.
    max: 15,
    // Aggressive idle close — keeps us ahead of Neon's server-side
    // idle timeout so we never hand a client a dead connection from
    // the pool. (Neon free-tier auto-suspends after ~5 min.)
    idleTimeoutMillis: 10_000,
    // Bound the acquire/connect wait so a momentary contention spike
    // fails fast and hands off to the retry layer (runQuery) instead of
    // stalling a render for 10s. The retry's backoff is what actually
    // rides out a transient blip.
    connectionTimeoutMillis: 6_000,
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
/**
 * A failure that happened BEFORE the statement could run — the pool
 * couldn't hand out a client in time, or the socket died on the way up.
 * Because the query never reached Postgres, retrying it is safe even for
 * writes (no risk of double-applying). Query-execution errors (constraint
 * violations, bad SQL, etc.) are NOT transient and must surface as-is.
 */
export function isTransientConnError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes('timeout exceeded when trying to connect') || // pool acquire timeout
    m.includes('connection terminated') ||
    m.includes('connection terminated unexpectedly') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('connection refused') ||
    m.includes('econnrefused') ||
    m.includes('terminating connection due to administrator command') // Neon scale-to-zero
  );
}

const RETRY_BACKOFF_MS = [300, 900];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a query with bounded retries on transient connection failures only.
 * Each retry waits out a short backoff, which is exactly the window a
 * contention spike or a Neon reconnection needs to clear. Non-transient
 * errors throw on the first attempt.
 */
async function runQuery<T extends QueryResultRow>(
  text: string,
  values: unknown[],
): Promise<T[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      const result = await getPool().query<T>(text, values);
      return result.rows;
    } catch (err) {
      lastErr = err;
      if (!isTransientConnError(err) || attempt === RETRY_BACKOFF_MS.length) throw err;
      await sleep(RETRY_BACKOFF_MS[attempt]);
    }
  }
  throw lastErr;
}

export async function sql<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}${strings[i + 1] ?? ''}`;
  }
  return runQuery<T>(text, values as unknown[]);
}

/**
 * Borrow ONE pooled client for a unit of work, guaranteed released.
 *
 * Use this when a single logical read needs several statements (e.g. the
 * catalog's five tables): running them on one checked-out client keeps the
 * whole operation to a SINGLE pool slot instead of grabbing one per query.
 * That's what stops a fan-out read from eating the pool during a render.
 * For transactions, BEGIN/COMMIT on the client as usual.
 */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
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
