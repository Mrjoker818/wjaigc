"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, History, Loader2, RefreshCw, Wand2, X } from "lucide-react";
import { toast } from "sonner";

interface CanvasVersion {
  id: number;
  content: string;
  timestamp: number;
  note?: string;
}

export interface CanvasAiEditSnapshot {
  instruction: string;
  currentContent: string;
  selectedText: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface CanvasAiEditRequest extends CanvasAiEditSnapshot {
  idempotencyKey: string;
  modelId: string;
  providerId: string;
  projectId: string;
  taskId: string;
}

interface CanvasEditorProps {
  content: string;
  onClose: () => void;
  onSave?: (content: string) => void;
  onPrepareAiEdit?: (snapshot: CanvasAiEditSnapshot) => CanvasAiEditRequest | null;
  onAiEdit?: (request: CanvasAiEditRequest) => Promise<string>;
}

export function CanvasEditor({
  content: initialContent,
  onClose,
  onSave,
  onPrepareAiEdit,
  onAiEdit,
}: CanvasEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [versions, setVersions] = useState<CanvasVersion[]>([
    { id: 1, content: initialContent, timestamp: Date.now(), note: "初始版本" },
  ]);
  const [showHistory, setShowHistory] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [isAiEditing, setIsAiEditing] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 });
  const [failedEdit, setFailedEdit] = useState<{
    request: CanvasAiEditRequest;
    message: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const versionIdRef = useRef(2);

  // 捕获选中文本
  const handleSelect = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    setSelectedText(sel);
    setSelectionRange({ start: ta.selectionStart, end: ta.selectionEnd });
  };

  const saveVersion = (newContent: string, note?: string) => {
    setVersions(prev => [...prev, { id: versionIdRef.current++, content: newContent, timestamp: Date.now(), note }]);
  };

  const runAiEdit = async (request: CanvasAiEditRequest) => {
    if (!onAiEdit) return;
    setIsAiEditing(true);
    setFailedEdit(null);
    try {
      const result = await onAiEdit(request);
      saveVersion(result, request.selectedText
        ? `AI修改选中: ${request.instruction.slice(0, 20)}`
        : `AI编辑: ${request.instruction.slice(0, 20)}`);
      setContent(result);
      setAiInstruction("");
      setFailedEdit(null);
      toast.success("AI 修改完成");
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI 编辑失败";
      setFailedEdit({ request, message });
      toast.error(message);
    } finally {
      setIsAiEditing(false);
    }
  };

  const handleAiEdit = async () => {
    const instruction = aiInstruction.trim();
    if (!instruction || !onAiEdit || !onPrepareAiEdit) return;
    const request = onPrepareAiEdit({
      instruction,
      currentContent: content,
      selectedText,
      selectionStart: selectionRange.start,
      selectionEnd: selectionRange.end,
    });
    if (!request) {
      toast.error("当前对话模型不可用，请重新选择后再试");
      return;
    }
    await runAiEdit(request);
  };

  const retryAiEdit = async () => {
    if (!failedEdit || isAiEditing) return;
    await runAiEdit(failedEdit.request);
  };

  const handleExport = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `文案-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已导出 Markdown 文件");
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    toast.success("已复制全部内容");
  };

  const restoreVersion = (v: CanvasVersion) => {
    saveVersion(content, "恢复前备份");
    setContent(v.content);
    setShowHistory(false);
    toast.success("已恢复到历史版本");
  };

  const wordCount = content.length;

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <PenIcon />
          <span className="text-sm font-semibold">写作画布</span>
          <span className="text-xs text-muted-foreground">{wordCount} 字</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <History size={14} />
            版本 ({versions.length})
          </button>
          <button onClick={handleCopy} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="复制全部">
            <Copy size={15} />
          </button>
          <button onClick={handleExport} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="导出 Markdown">
            <Download size={15} />
          </button>
          {onSave && (
            <button
              onClick={() => { onSave(content); toast.success("已保存"); }}
              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
            >
              <Check size={13} />
              保存
            </button>
          )}
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 编辑器主体 */}
        <div className="flex flex-1 flex-col">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onSelect={handleSelect}
            className="flex-1 resize-none bg-transparent p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50"
            placeholder="在这里编辑文案..."
          />

          {/* AI 协同编辑栏 */}
          {onAiEdit && onPrepareAiEdit && (
            <div className="border-t border-border p-3">
              {selectedText && (
                <div className="mb-2 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
                  已选中 {selectedText.length} 字：{selectedText.slice(0, 40)}{selectedText.length > 40 ? "..." : ""}
                </div>
              )}
              {failedEdit && (
                <div
                  role="alert"
                  className="mb-2 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
                >
                  <span className="text-xs text-destructive">{failedEdit.message}</span>
                  <button
                    type="button"
                    onClick={() => void retryAiEdit()}
                    disabled={isAiEditing}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RefreshCw size={14} />
                    重试修改
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={aiInstruction}
                  onChange={e => setAiInstruction(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleAiEdit(); } }}
                  placeholder={selectedText ? "告诉 AI 如何修改选中部分..." : "告诉 AI 如何修改全文..."}
                  className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-primary/50"
                  disabled={isAiEditing}
                />
                <button
                  onClick={() => void handleAiEdit()}
                  disabled={isAiEditing || !aiInstruction.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  {isAiEditing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  AI 修改
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 版本历史侧栏 */}
        {showHistory && (
          <div className="w-56 overflow-y-auto border-l border-border bg-muted/30 p-2">
            <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">版本历史</div>
            {[...versions].reverse().map(v => (
              <button
                key={v.id}
                onClick={() => restoreVersion(v)}
                className="mb-1 w-full rounded-lg border border-transparent px-2.5 py-2 text-left hover:border-border hover:bg-background"
              >
                <div className="text-xs font-medium">{v.note || `版本 ${v.id}`}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {new Date(v.timestamp).toLocaleTimeString()}
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{v.content.slice(0, 60)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}
