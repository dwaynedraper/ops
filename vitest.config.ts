import { defineConfig } from 'vitest/config';

/**
 * Vitest config for Sharp Sighted Ops.
 *
 * The suite is pure-function unit tests (the pricing, scoring, and
 * contact-cycle logic in src/lib) — no DOM, no database. Test files are
 * co-located as `*.test.ts` and excluded from the Next build via
 * tsconfig.json so they never reach production.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
