'use client';

import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  function applyTheme(t: Theme): void {
    const root = document.documentElement;
    if (t === 'dark') {
      root.classList.add('dark');
    } else if (t === 'light') {
      root.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) root.classList.add('dark');
      else root.classList.remove('dark');
    }
  }

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored) {
      setTheme(stored);
      applyTheme(stored);
    } else {
      applyTheme('system');
    }
  }, []);

  const cycleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
    localStorage.setItem('theme', next);
    applyTheme(next);
  };

  if (!mounted) {
    return <div className="w-8 h-8" />;
  }

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title={`当前: ${theme === 'light' ? '亮色' : theme === 'dark' ? '暗色' : '跟随系统'}`}
    >
      {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
      <span>{theme === 'light' ? '亮色模式' : theme === 'dark' ? '暗色模式' : '跟随系统'}</span>
    </button>
  );
}
