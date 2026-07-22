"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Search, X } from "lucide-react";

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
  onNavigate: (conversationId: string, messageId?: string) => void;
}

export function GlobalSearch({ conversations, onClose, onNavigate }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search size={17} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索所有对话内容..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {query.trim() && results.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">未找到匹配内容</div>
          )}
          {!query.trim() && (
            <div className="py-10 text-center text-sm text-muted-foreground">输入关键词搜索历史对话</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.messageId}-${i}`}
              onClick={() => { onNavigate(r.conversationId, r.messageId); onClose(); }}
              className="flex w-full items-start gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <MessageSquare size={15} className={`mt-0.5 shrink-0 ${r.role === "user" ? "text-primary" : "text-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">{r.conversationTitle}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.messagePreview}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
