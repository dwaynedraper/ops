/**
 * Normalize a thrown error into a server-action result string.
 *
 * The real error — often raw Postgres / driver text — is logged to the
 * server (Vercel function logs) for debugging; the value handed back to
 * the client is the caller's own plain-English fallback. Internal tool or
 * not, schema and SQL detail shouldn't ride back to the browser.
 *
 *   } catch (err) {
 *     return { ok: false, error: actionError(err, 'Could not save the quote.') };
 *   }
 */
export function actionError(err: unknown, fallback: string): string {
  console.error('[ops] server action failed:', err);
  return fallback;
}
