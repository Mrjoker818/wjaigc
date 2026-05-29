import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '无界AI',
    template: '%s | 无界AI',
  },
  description:
    '无界AI - 智能图片生成工具，基于无限画布的AI创作平台',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full w-full overflow-hidden theme-gold">
      <body className="antialiased h-full w-full m-0 p-0 overflow-hidden">
        {children}
      </body>
    </html>
  );
}
