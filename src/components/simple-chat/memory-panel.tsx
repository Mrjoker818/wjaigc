"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export interface MemoryItem {
  id: string;
  content: string;
  category: "style" | "preference" | "background" | "other";
  createdAt: number;
}

const CATEGORY_LABELS: Record<MemoryItem["category"], string> = {
  style: "写作风格",
  preference: "偏好设置",
  background: "背景信息",
  other: "其他",
};

const CATEGORY_COLORS: Record<MemoryItem["category"], string> = {
  style: "bg-violet-500/10 text-foreground border-violet-500/20",
  preference: "bg-sky-500/10 text-foreground border-sky-500/20",
  background: "bg-emerald-500/10 text-foreground border-emerald-500/20",
  other: "bg-zinc-500/10 text-foreground border-zinc-500/20",
};

interface MemoryPanelProps {
  memories: MemoryItem[];
  onClose: () => void;
  onAdd: (content: string, category: MemoryItem["category"]) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  isLoading?: boolean;
  isPending?: boolean;
}

export function MemoryPanel({ memories, onClose, onAdd, onDelete, isLoading, isPending }: MemoryPanelProps) {
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState<MemoryItem["category"]>("style");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const actionInFlight = useRef(false);
  const pending = busy || isPending || isLoading;

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const handleAdd = async (): Promise<void> => {
    const content = newContent.trim();
    if (!content || pending || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onAdd(content, newCategory);
      if (active.current) {
        setNewContent(value => value.trim() === content ? "" : value);
        toast.success("已添加到记忆");
      }
    } catch {
      if (active.current) setError("尚未确认添加成功，请刷新页面核对，避免重复添加。");
    } finally {
      actionInFlight.current = false;
      if (active.current) setBusy(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (pending || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onDelete(id);
      if (active.current) toast.success("已删除");
    } catch {
      if (active.current) setError("尚未确认删除成功，请刷新页面核对后再试。");
    } finally {
      actionInFlight.current = false;
      if (active.current) setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog" aria-label="AI 记忆" aria-modal="true"
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <Brain size={17} className="text-primary" />
            <h2 className="text-sm font-semibold">AI 记忆</h2>
            <span className="basis-full text-xs text-muted-foreground sm:basis-auto">跨对话记住你的偏好</span>
          </div>
          <button onClick={onClose} aria-label="关闭记忆面板" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : memories.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              暂无记忆。添加写作风格、品牌背景等信息，AI 会在后续对话中自动应用。
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map(m => (
                <div key={m.id} className="group flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3">
                  <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${CATEGORY_COLORS[m.category]}`}>
                    {CATEGORY_LABELS[m.category]}
                  </span>
                  <p className="min-w-0 flex-1 break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{m.content}</p>
                  <button
                    onClick={() => { void handleDelete(m.id); }} disabled={!!pending} aria-label="删除记忆"
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-muted-foreground opacity-100 transition-opacity hover:bg-red-500/10 hover:text-destructive [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 disabled:cursor-wait disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-4">
          <div className="mb-2 grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
            {(Object.keys(CATEGORY_LABELS) as MemoryItem["category"][]).map(cat => (
              <button
                key={cat}
                onClick={() => setNewCategory(cat)}
                aria-pressed={newCategory === cat} disabled={!!pending}
                className={`min-h-11 min-w-11 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-wait ${
                  newCategory === cat ? CATEGORY_COLORS[cat] : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
          {error && <p role="alert" className="mb-2 text-sm text-destructive [.theme-monochrome_&]:text-[color-mix(in_srgb,var(--destructive)_75%,black)]">{error}</p>}
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <input
              aria-label="记忆内容"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAdd(); } }}
              placeholder="例如：我偏好简洁有力的短句风格..."
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-base outline-none placeholder:text-foreground/75 focus:border-primary/50"
            />
            <button
              onClick={handleAdd}
              disabled={!newContent.trim() || !!pending}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 [.theme-monochrome_&]:bg-[color-mix(in_srgb,var(--primary)_80%,black)] disabled:opacity-40"
            >
              <Plus size={14} />
              添加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
