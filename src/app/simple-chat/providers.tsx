'use client';

import { ThemeProvider } from '@/components/simple-chat/theme-script';
import type { ReactNode } from 'react';

export { useTheme } from '@/components/simple-chat/theme-script';

export function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
