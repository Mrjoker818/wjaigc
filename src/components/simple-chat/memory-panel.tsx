"use client";

import { useState } from "react";
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
  style: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  preference: "bg-sky-500/10 text-sky-500 border-sky-500/20",
  background: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  other: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
};

interface MemoryPanelProps {
  memories: MemoryItem[];
  onClose: () => void;
  onAdd: (content: string, category: MemoryItem["category"]) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
}

export function MemoryPanel({ memories, onClose, onAdd, onDelete, isLoading }: MemoryPanelProps) {
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState<MemoryItem["category"]>("style");

  const handleAdd = () => {
    if (!newContent.trim()) return;
    onAdd(newContent.trim(), newCategory);
    setNewContent("");
    toast.success("已添加到记忆");
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Brain size={17} className="text-primary" />
            <span className="text-sm font-semibold">AI 记忆</span>
            <span className="text-xs text-muted-foreground">跨对话记住你的偏好</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4">
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
                  <p className="flex-1 text-sm leading-relaxed">{m.content}</p>
                  <button
                    onClick={() => { onDelete(m.id); toast.success("已删除"); }}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border p-4">
          <div className="mb-2 flex gap-1.5">
            {(Object.keys(CATEGORY_LABELS) as MemoryItem["category"][]).map(cat => (
              <button
                key={cat}
                onClick={() => setNewCategory(cat)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  newCategory === cat ? CATEGORY_COLORS[cat] : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              placeholder="例如：我偏好简洁有力的短句风格..."
              className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <button
              onClick={handleAdd}
              disabled={!newContent.trim()}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
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
