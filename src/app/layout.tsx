import './globals.css';
import type { Viewport } from 'next';
import { OperationAuditClient } from '@/components/operation-audit-client';
import { GlobalErrorMonitor } from '@/components/global-error-monitor';
import { AppErrorBoundary } from '@/components/app-error-boundary';

export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  themeColor: '#0d1117',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <OperationAuditClient />
        <GlobalErrorMonitor />
        <AppErrorBoundary>
          {children}
        </AppErrorBoundary>
      </body>
    </html>
  );
}
