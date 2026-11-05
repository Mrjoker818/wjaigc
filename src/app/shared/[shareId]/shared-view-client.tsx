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
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/simple-chat/share/${shareId}`, { signal: controller.signal })
      .then(async r => {
        const data = await r.json();
        if (!active) return;
        if (!r.ok) throw new Error(data.error || "加载失败");
        setTitle(data.title || "分享对话");
        setMessages(data.messages || []);
        setViewCount(data.viewCount || 0);
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [shareId]);

  if (loading) {
    return (
      <div role="status" aria-busy="true" className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background px-4 text-foreground">
        <Loader2 size={32} aria-hidden="true" className="animate-spin text-primary motion-reduce:animate-none" />
        <p className="text-sm">正在加载分享…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-dvh w-full flex-col overflow-y-auto overscroll-contain bg-background p-4 text-foreground">
        <div role="alert" className="m-auto flex w-full max-w-xl flex-col items-center gap-3 py-6 text-center [overflow-wrap:anywhere]">
          <p className="max-w-full text-lg">{error}</p>
          <p className="text-sm text-muted-foreground">该分享链接可能已被撤销或过期</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh w-full overflow-y-auto overscroll-contain bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur [@media(max-height:480px)]:static">
        <div className="mx-auto flex max-w-3xl min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <h1 className="text-base font-semibold leading-relaxed">{title}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">来自无界AI的分享 · {viewCount} 次查看</p>
          </div>
          <div className="shrink-0 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
            无界AI
          </div>
        </div>
      </header>

      <main className="!mx-auto !h-auto !w-full max-w-3xl !overflow-visible !px-4 !py-6">
        {messages.length === 0 && <p role="status" className="py-8 text-center text-sm text-muted-foreground">该分享暂无对话内容</p>}
        <div className="flex min-w-0 flex-col gap-6">
          {messages.map(msg => (
            <div key={msg.id} className={msg.role === "user" ? "flex min-w-0 justify-end" : "flex min-w-0 justify-start"}>
              <div className={`min-w-0 max-w-[85%] [overflow-wrap:anywhere] ${
                msg.role === "user"
                  ? "rounded-xl rounded-br-sm bg-muted px-4 py-2.5"
                  : "w-full !max-w-full"
              }`}>
                {msg.role === "assistant" && (
                  <div className="mb-2 text-xs text-muted-foreground">AI 助手</div>
                )}
                {msg.images && msg.images.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {msg.images.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt={`分享参考图 ${i + 1}`} className="max-h-48 max-w-full rounded-lg object-contain" />
                    ))}
                  </div>
                )}
                {msg.role === "assistant" ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <div className="whitespace-pre-wrap text-base leading-relaxed sm:text-sm">{msg.content}</div>
                )}
                {msg.generatedImages && msg.generatedImages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {msg.generatedImages.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt={`AI 生成图片 ${i + 1}`} className="max-h-64 max-w-full rounded-lg object-contain" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground">
        此对话由无界AI生成 · 仅供查看
      </footer>
    </div>
  );
}
