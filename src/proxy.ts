import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/auth';

/**
 * Route-gating middleware. Next.js 16 renamed `middleware.ts` to
 * `proxy.ts` — same execution model, same matcher API, same edge
 * runtime constraints.
 *
 * Policy: every route requires a signed-in session UNLESS the path
 * matches the public allowlist below. The auth API itself, the signin
 * pages, static assets, and the Next.js internals are public; everything
 * else redirects to /signin with a `callbackUrl` so the user lands back
 * where they were trying to go.
 *
 * A second gate: a signed-in rep whose status isn't 'active' (invited,
 * suspended, or disabled) is bounced to /awaiting. status rides on the
 * session (the auth.ts session callback), so this needs no DB query.
 *
 * The auth() helper returns the session if one exists, or null. It
 * reads the session cookie and validates against the sessions table
 * via the adapter.
 */

const PUBLIC_PREFIXES = [
  '/signin',
  '/api/auth',
  '/api/cron', // cron routes carry no session; they gate on CRON_SECRET
  '/_next',
  '/favicon',
  '/robots.txt',
];

function isPublic(pathname: string): boolean {
  // Exact match, or a sub-path under the prefix. We deliberately do NOT
  // do a bare startsWith(prefix) — that would make '/signin-anything'
  // public too. Match on a segment boundary only.
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const session = req.auth as { user?: { status?: string } } | null;

  if (!session) {
    const callbackUrl = pathname + search;
    const signinUrl = new URL('/signin', req.url);
    if (callbackUrl !== '/') signinUrl.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(signinUrl);
  }

  // Status gate. A non-active rep (invited / suspended / disabled) only
  // ever sees /awaiting; an active rep never does.
  const status = session.user?.status;
  if (status && status !== 'active' && pathname !== '/awaiting') {
    return NextResponse.redirect(new URL('/awaiting', req.url));
  }
  if (status === 'active' && pathname === '/awaiting') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
});

/**
 * Run the proxy on every request except true static assets. Auth.js
 * needs to see the request even for API routes so that signOut and
 * session-touch flows work end-to-end.
 *
 * Next.js 16 renamed middleware.ts → proxy.ts and made the runtime
 * implicit: proxy always runs on Node. We do NOT declare `runtime` here;
 * doing so throws "Route segment config is not allowed in Proxy file."
 * `pg` works because proxy is Node by definition.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico)).*)',
  ],
};
