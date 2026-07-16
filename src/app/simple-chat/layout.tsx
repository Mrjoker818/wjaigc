import type { Metadata } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: '智能对话 - 无界AI',
  description: 'AI 智能对话助手',
};

export default function SimpleChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}
