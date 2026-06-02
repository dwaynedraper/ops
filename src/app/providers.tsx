'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { UndoProvider } from '@/components/UndoProvider';

type ThemePref = 'system' | 'dark' | 'light';
type Resolved = 'dark' | 'light';

const STORAGE_KEY = 'ss_ops_theme';

/* ─────────────────────────────────────────────────────────────────────
 * Theme store — system-default, three-state, live auto-toggle.
 *
 * The `dark` / `light` class on <html> is the single source of truth for
 * styling and is always RESOLVED (never 'system'). The user's PREFERENCE
 * — system | dark | light — lives in localStorage. When the preference is
 * 'system' we resolve via prefers-color-scheme and re-resolve live when the
 * OS flips (day/night auto-toggle), so the site follows the system without
 * a reload.
 *
 * Default is 'system'. A saved 'dark'/'light' from before this change is
 * respected (it just reads as a pinned preference). The inline no-FOUC
 * script in layout.tsx applies the resolved class before first paint using
 * the same rule, so there's no flash.
 *
 * Canonical pattern across Sharp Sighted (mirrors rework-sharpsightedstudio).
 * ───────────────────────────────────────────────────────────────────── */

const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    /* privacy mode */
  }
  return 'system';
}

function systemResolved(): Resolved {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolve(pref: ThemePref): Resolved {
  return pref === 'system' ? systemResolved() : pref;
}

/** Apply the resolved class to <html>. */
function applyResolved(r: Resolved): void {
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(r);
}

let mediaWired = false;
/** Wire the OS day/night listener once, on the client. While the preference
 * is 'system', an OS flip re-resolves the class and notifies React. */
function ensureMediaListener(): void {
  if (mediaWired || typeof window === 'undefined') return;
  mediaWired = true;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    if (readPref() === 'system') {
      applyResolved(systemResolved());
      for (const l of listeners) l();
    }
  });
}

function subscribe(onStoreChange: () => void): () => void {
  ensureMediaListener();
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

/** Client snapshot — the live PREFERENCE (what the toggle reflects). */
function getSnapshot(): ThemePref {
  return readPref();
}

/** Server snapshot + hydration value. layout.tsx's no-FOUC script may have
 * already changed the <html> class, but the preference default is 'system'. */
function getServerSnapshot(): ThemePref {
  return 'system';
}

/** Set the preference: persist it, resolve + apply the class, notify. */
function setPref(next: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* class still applies */
  }
  applyResolved(resolve(next));
  for (const listener of listeners) listener();
}

export function Providers({ children }: { children: ReactNode }) {
  return <UndoProvider>{children}</UndoProvider>;
}

export interface ThemeCtx {
  /** The preference: system | dark | light. */
  theme: ThemePref;
  /** The resolved appearance right now: dark | light. */
  resolved: Resolved;
  /** Set the preference directly (the three-way control). */
  setTheme: (pref: ThemePref) => void;
  /** Cycle System → Light → Dark → System (for a single tappable button). */
  cycle: () => void;
}

const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };

export function useTheme(): ThemeCtx {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    theme,
    resolved: typeof window === 'undefined' ? 'dark' : resolve(theme),
    setTheme: setPref,
    cycle: () => setPref(NEXT[theme]),
  };
}
