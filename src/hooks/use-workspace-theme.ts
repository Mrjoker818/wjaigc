'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

export type WorkspaceThemePreference = 'dark' | 'light' | 'system';

function systemIsDark(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true : window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function subscribeSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

interface WorkspaceTheme {
  themePreference: WorkspaceThemePreference;
  setThemePreference: (preference: WorkspaceThemePreference) => void;
  themeStyle: 'gold' | 'monochrome';
  toggleTheme: () => void;
}

export function useWorkspaceTheme(): WorkspaceTheme {
  // Keep the existing session default and storage contracts. A preference and
  // its resolved style are distinct: system may resolve to either style.
  const [themePreference, setThemePreference] = useState<WorkspaceThemePreference>('dark');
  const prefersDark = useSyncExternalStore(subscribeSystemTheme, systemIsDark, () => true);
  const isDark = themePreference === 'dark' || (themePreference === 'system' && prefersDark);
  const toggleTheme = useCallback((): void => {
    setThemePreference(previous => {
      const wasDark = previous === 'dark' || (previous === 'system' && prefersDark);
      return wasDark ? 'light' : 'dark';
    });
  }, [prefersDark]);
  return { themePreference, setThemePreference, themeStyle: isDark ? 'gold' : 'monochrome', toggleTheme };
}
