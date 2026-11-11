"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import { MessageSquare, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface SearchResult {
  conversationId: string;
  conversationTitle: string;
  messagePreview: string;
  messageId: string;
  role: "user" | "assistant";
}
interface GlobalSearchProps {
  conversations: Array<{ id: string; title: string; messages: Array<{ id: string; role: "user" | "assistant"; content: string }> }>;
  onClose: () => void;
  onNavigate: (conversationId: string, messageId: string) => void;
}

export function GlobalSearch({ conversations, onClose, onNavigate }: GlobalSearchProps): ReactElement {
  const [query, setQuery] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 1) return [];
    const out: SearchResult[] = [];
    for (const conv of conversations) {
      for (const msg of conv.messages) {
        if (msg.content.toLowerCase().includes(q)) {
          const idx = msg.content.toLowerCase().indexOf(q);
          const start = Math.max(0, idx - 30);
          const end = Math.min(msg.content.length, idx + q.length + 60);
          out.push({
            conversationId: conv.id,
            conversationTitle: conv.title,
            messagePreview: (start > 0 ? "..." : "") + msg.content.slice(start, end) + (end < msg.content.length ? "..." : ""),
            messageId: msg.id,
            role: msg.role,
          });
          if (out.length >= 50) return out;
        }
      }
    }
    return out;
  }, [query, conversations]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}
        style={{ animation: "none" }} className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-xl flex-col gap-0 overflow-hidden p-0 text-foreground sm:max-w-xl">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-2 sm:px-4">
          <DialogTitle className="sr-only">全局搜索</DialogTitle>
          <Search size={17} className="shrink-0 text-muted-foreground" />
          <input aria-label="搜索所有对话内容" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索所有对话内容..."
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground" />
          <button onClick={onClose} aria-label="关闭全局搜索" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><X size={16} /></button>
        </div>
        <div className="max-h-[60dvh] min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          {query.trim() && results.length === 0 && <div role="status" className="px-3 py-10 text-center text-sm text-muted-foreground">未找到匹配内容</div>}
          {!query.trim() && <div className="px-3 py-10 text-center text-sm text-muted-foreground">输入关键词搜索历史对话</div>}
          {results.map((r, i) => (
            <button key={r.messageId + "-" + i} onClick={() => { onNavigate(r.conversationId, r.messageId); onClose(); }}
              className="flex min-h-11 w-full min-w-0 items-start gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/50">
              <MessageSquare size={15} className={"mt-0.5 shrink-0 " + (r.role === "user" ? "text-primary" : "text-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">{r.conversationTitle}</div>
                <div className="mt-0.5 line-clamp-2 break-words text-sm text-muted-foreground">{r.messagePreview}</div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
