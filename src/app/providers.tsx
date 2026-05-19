'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = 'ss_ops_theme';

/**
 * Theme provider — mirrors the discipline of the other Sharp Sighted
 * properties (ss_theme on the public sites; namespaced to ops here so
 * it doesn't collide with sharpsighted.studio if both are open in the
 * same browser session).
 *
 * Initial theme is set by an inline no-FOUC script in layout.tsx; this
 * provider just keeps state in sync after hydration.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === 'light' || stored === 'dark') {
        setTheme(stored);
        document.documentElement.classList.remove('dark', 'light');
        document.documentElement.classList.add(stored);
      }
    } catch {
      // localStorage can throw in privacy modes — fail silently.
    }
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Safe default for components rendered before the provider mounts.
    return { theme: 'dark', toggle: () => {} };
  }
  return ctx;
}
