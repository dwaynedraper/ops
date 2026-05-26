'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { UndoProvider } from '@/components/UndoProvider';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'ss_ops_theme';

/* ─────────────────────────────────────────────────────────────────────
 * Theme store
 *
 * The `dark` / `light` class on <html> is the single source of truth.
 * An inline no-FOUC script in layout.tsx sets that class from
 * localStorage before first paint; this store reads it and toggles it.
 *
 * We use `useSyncExternalStore` rather than useState + useEffect so that:
 *   - React stays in step with the DOM class without a setState inside an
 *     effect (which triggers cascading renders — react-hooks/set-state-
 *     in-effect),
 *   - the server render and the hydration render agree (getServerSnapshot
 *     returns the same `dark` default layout.tsx puts on <html>).
 *
 * Namespaced `ss_ops_theme` so it doesn't collide with sharpsighted.studio
 * if both are open in the same browser.
 * ───────────────────────────────────────────────────────────────────── */

const listeners = new Set<() => void>();

/** Subscribe a React-provided callback; returns the unsubscribe fn. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** Client snapshot — read the live class off <html>. */
function getSnapshot(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

/**
 * Server snapshot — and the value React hydrates with. layout.tsx renders
 * <html className="… dark">, so this must be 'dark' to avoid a mismatch.
 */
function getServerSnapshot(): Theme {
  return 'dark';
}

/** Apply a theme: swap the <html> class, persist it, notify subscribers. */
function setTheme(next: Theme): void {
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // localStorage can throw in privacy modes — the class still applies.
  }
  for (const listener of listeners) listener();
}

/**
 * Provider slot. The theme store is module-level, so the only wrapper here
 * is the UndoProvider — it owns the app-wide "soft commit" undo toasts.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <UndoProvider>{children}</UndoProvider>;
}

export interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

/** Current theme + a toggle, kept in sync with the <html> class. */
export function useTheme(): ThemeCtx {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    theme,
    toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  };
}
