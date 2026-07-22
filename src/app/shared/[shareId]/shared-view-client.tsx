"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { MarkdownRenderer } from "@/components/simple-chat/markdown-renderer";

interface SharedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  generatedImages?: string[];
  timestamp?: number;
}

export default function SharedViewClient({ shareId }: { shareId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [viewCount, setViewCount] = useState(0);

  useEffect(() => {
    fetch(`/api/simple-chat/share/${shareId}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "加载失败");
        setTitle(data.title || "分享对话");
        setMessages(data.messages || []);
        setViewCount(data.viewCount || 0);
      })
      .catch(err => setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [shareId]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-[#171717] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-amber-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-[#171717] flex flex-col items-center justify-center gap-3 text-white">
        <p className="text-lg">{error}</p>
        <p className="text-sm text-zinc-500">该分享链接可能已被撤销或过期</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#171717] text-white">
      <header className="sticky top-0 z-10 border-b border-[#3b3b3b] bg-[#171717]/95 backdrop-blur px-4 py-3">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">{title}</h1>
            <p className="text-xs text-zinc-500 mt-0.5">来自无界AI的分享 · {viewCount} 次查看</p>
          </div>
          <div className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full px-3 py-1">
            无界AI
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex flex-col gap-6">
          {messages.map(msg => (
            <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] ${
                msg.role === "user"
                  ? "bg-[#2f2f2f] rounded-xl rounded-br-sm px-4 py-2.5"
                  : "w-full"
              }`}>
                {msg.role === "assistant" && (
                  <div className="text-xs text-zinc-500 mb-2">AI 助手</div>
                )}
                {msg.images && msg.images.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {msg.images.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt="" className="max-h-48 rounded-lg" />
                    ))}
                  </div>
                )}
                {msg.role === "assistant" ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                )}
                {msg.generatedImages && msg.generatedImages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {msg.generatedImages.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt="" className="max-h-64 rounded-lg" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-[#3b3b3b] px-4 py-6 text-center text-xs text-zinc-500">
        此对话由无界AI生成 · 仅供查看
      </footer>
    </div>
  );
}
