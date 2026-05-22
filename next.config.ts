import type { NextConfig } from 'next';

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
};

export default nextConfig;
