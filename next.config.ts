import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ops is an internal app — no public image hosts needed yet.
  // Add remotePatterns here when we start storing client/quote photos.
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
