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
 * The auth() helper returns the session if one exists, or null. It
 * reads the session cookie and validates against the sessions table
 * via the adapter.
 */

const PUBLIC_PREFIXES = [
  '/signin',
  '/api/auth',
  '/_next',
  '/favicon',
  '/robots.txt',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p));
}

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  if (!req.auth) {
    const callbackUrl = pathname + search;
    const signinUrl = new URL('/signin', req.url);
    if (callbackUrl !== '/') signinUrl.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(signinUrl);
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
