import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '简洁聊天 — 无界AI',
  description: '独立简洁聊天页面，支持 ChatGPT / Gemini / DeepSeek 对话与 AI 生图',
};

export default function SimpleChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
