import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config for Sharp Sighted Ops.
 *
 * The suite is mostly pure-function unit tests (pricing, scoring,
 * contact-cycle, digest partitioning). Component tests live alongside
 * as `*.test.tsx` and run under jsdom. Per-file env directives at the
 * top of a test file override the default when needed.
 *
 * `@/` path alias mirrors `tsconfig.json` so test imports use the
 * same shape as the app code.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // `.test.tsx` files mount React components — switch to jsdom for those.
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
  },
});
