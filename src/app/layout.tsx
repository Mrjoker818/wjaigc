import './globals.css';
import { OperationAuditClient } from '@/components/operation-audit-client';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <OperationAuditClient />
        {children}
      </body>
    </html>
  );
}
