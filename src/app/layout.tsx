import './globals.css';
import { OperationAuditClient } from '@/components/operation-audit-client';
import { GlobalErrorMonitor } from '@/components/global-error-monitor';

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
        {children}
      </body>
    </html>
  );
}
