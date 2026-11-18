import type { Metadata } from 'next';
import { Providers } from '../simple-chat/providers';

/** Chat lives at /chat; /simple-chat keeps working for older links. */
export const metadata: Metadata = {
  title: '智能对话 - 无界AI',
  description: 'AI 智能对话助手',
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
