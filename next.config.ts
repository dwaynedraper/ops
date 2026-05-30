import type { NextConfig } from 'next';

/**
 * Baseline security headers for ops. This is an internal admin tool
 * with magic-link auth, so clickjacking and referrer leakage matter
 * more than they would for a marketing site.
 *
 * What each header does:
 *   • X-Frame-Options: DENY     — blocks any framing (clickjacking).
 *   • Referrer-Policy           — never send the path to third parties.
 *   • X-Content-Type-Options    — stops MIME-sniffing attacks.
 *   • Permissions-Policy        — explicit deny for sensors we don't use.
 *   • Strict-Transport-Security — force HTTPS for the next year. Safe
 *                                 because the prod domain is HTTPS-only.
 *
 * No Content-Security-Policy yet — would block Plausible + Vercel
 * Speed Insights without an explicit allowlist, and the cost/benefit
 * for an invite-only admin tool isn't there yet.
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
];

const nextConfig: NextConfig = {
  // ops is an internal app — no public image hosts needed yet.
  // Add remotePatterns here when we start storing client/quote photos.
  images: {
    remotePatterns: [],
  },

  // The quote PDF registers brand fonts from src/fonts at runtime
  // (QuotePdf.tsx). Force the .ttf files into that route's serverless
  // bundle — Next's tracer can't follow the process.cwd() path.
  outputFileTracingIncludes: {
    '/quotes/[id]/pdf': ['./src/fonts/**/*'],
  },

  // Apply baseline security headers to every route.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
