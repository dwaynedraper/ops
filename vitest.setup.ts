/**
 * Vitest setup — runs before every test file.
 *
 * Two jobs:
 *   1. Pull in `@testing-library/jest-dom/vitest` so component tests
 *      can use the extended matchers (`toBeInTheDocument`,
 *      `toHaveTextContent`, etc.).
 *   2. Register an `afterEach(cleanup)` so every component test
 *      starts with a fresh DOM — without this, `render()` calls
 *      stack on each other and `screen.getBy*` returns leftover
 *      elements from the previous test.
 *
 * Pure-lib tests under jsdom never call `render()`, so the cleanup
 * is a no-op for them.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
