"use client";

import { useState } from "react";
import { Check, Copy, Link2, Loader2, Share2, X } from "lucide-react";
import { toast } from "sonner";

interface ShareDialogProps {
  conversationId: string;
  conversationTitle: string;
  messages: Array<{ id: string; role: string; content: string; images?: string[]; timestamp?: number | string }>;
  onClose: () => void;
}

export function ShareDialog({ conversationId, conversationTitle, messages, onClose }: ShareDialogProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const createShare = async () => {
    setIsCreating(true);
    try {
      const res = await fetch("/api/simple-chat/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          title: conversationTitle,
          messages: messages.filter(m => m.role !== "system"),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建分享失败");
      const fullUrl = `${window.location.origin}${data.shareUrl}`;
      setShareUrl(fullUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建分享失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("链接已复制");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Share2 size={17} className="text-primary" />
            <span className="text-sm font-semibold">分享对话</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          {!shareUrl ? (
            <>
              <p className="mb-1 text-sm text-foreground">{conversationTitle}</p>
              <p className="mb-4 text-xs text-muted-foreground">
                将生成一个公开链接，任何人都可以通过链接查看此对话的 {messages.length} 条消息（只读）。
              </p>
              <button
                onClick={() => void createShare()}
                disabled={isCreating}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {isCreating ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                {isCreating ? "创建中..." : "创建分享链接"}
              </button>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">分享链接已创建，有效期 30 天：</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-xs"
                  onFocus={e => e.target.select()}
                />
                <button
                  onClick={() => void handleCopy()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                注意：任何获得链接的人都可以查看此对话内容，请避免分享敏感信息。
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
