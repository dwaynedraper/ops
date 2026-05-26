'use client';

import { useEffect } from 'react';

/**
 * Warn before the browser unloads — tab close, refresh, hard navigation —
 * while `dirty` is true, i.e. an editor holds unsaved changes.
 *
 * In-app <Link> navigation is intentionally NOT covered: catching it
 * reliably needs router instrumentation, and the browser-level prompt is
 * the launch-grade safety net for the genuinely destructive cases (closing
 * the tab, reloading). Pair it with a visible "unsaved" affordance in the
 * editor itself.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
