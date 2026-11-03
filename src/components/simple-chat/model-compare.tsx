"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Check, Copy, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { consumeSimpleChatJsonStream } from "@/lib/simple-chat-sse";

interface ModelResult { modelId: string; providerId: string; modelName: string; content: string; isLoading: boolean; error?: string }
interface CompareModel { id: string; providerId: string; providerName?: string; name?: string; displayName?: string }
interface ModelCompareProps { isMonochrome: boolean; prompt: string; models: CompareModel[]; onClose: () => void }
function modelLabel(model: CompareModel): string {
  return (model.displayName || model.name || model.id) + " (" + (model.providerName || model.providerId) + ")";
}

export function ModelCompare({ isMonochrome, prompt, models, onClose }: ModelCompareProps): ReactElement {
  const [comparePrompt, setComparePrompt] = useState(prompt);
  const [selectedModels, setSelectedModels] = useState<string[]>(models.slice(0, 2).map((m) => m.providerId + "::" + m.id));
  const [results, setResults] = useState<ModelResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const panelBg = isMonochrome ? "bg-white border-gray-200" : "bg-[#1e1e1e] border-[#3d3d3d]";
  const textColor = isMonochrome ? "text-gray-800" : "text-white";
  const subText = isMonochrome ? "text-gray-600" : "text-white/75";
  const inputBg = isMonochrome ? "bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-600" : "bg-[#2a2a2a] border-[#404040] text-white placeholder:text-white/75";
  const goldBtn = isMonochrome ? "bg-amber-500 text-gray-950 hover:bg-amber-600" : "bg-[#d4af37] text-black hover:bg-[#e5c158]";
  const borderCls = isMonochrome ? "border-gray-200" : "border-[#3d3d3d]";

  const toggleModel = useCallback((key: string): void => {
    if (inFlight.current) return;
    setSelectedModels((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : prev.length < 3 ? [...prev, key] : prev);
  }, []);

  const runCompare = useCallback(async (): Promise<void> => {
    if (inFlight.current || !mounted.current) return;
    if (!comparePrompt.trim()) { toast.error("请输入对比问题"); return; }
    if (selectedModels.length < 2) { toast.error("请至少选择 2 个模型"); return; }
    const initialResults: ModelResult[] = selectedModels.map((key) => {
      const [providerId, modelId] = key.split("::");
      const modelInfo = models.find((m) => m.id === modelId && m.providerId === providerId);
      return { modelId, providerId, modelName: modelInfo ? modelLabel(modelInfo) : modelId + " (" + providerId + ")", content: "", isLoading: true };
    });
    inFlight.current = true;
    setIsRunning(true);
    setResults(initialResults);
    try {
      await Promise.allSettled(initialResults.map(async (result, idx): Promise<void> => {
        try {
          const res = await fetch("/api/simple-chat/chat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [{ role: "user", content: comparePrompt }], model: result.modelId, providerId: result.providerId }),
          });
          if (!res.ok) {
            const raw = await res.text().catch(() => "");
            let detail = raw;
            try { const value: unknown = JSON.parse(raw); if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).error === "string") detail = (value as { error: string }).error; } catch { /* Keep the non-JSON error, bounded below. */ }
            throw new Error("HTTP " + res.status + (detail ? ": " + detail.slice(0, 200) : ""));
          }
          if (!res.body || !res.headers.get("content-type")?.includes("text/event-stream")) throw new Error("模型返回的响应格式异常，请核对服务后重试。");
          let content = "";
          let completed = false;
          await consumeSimpleChatJsonStream(res.body, {
            isActive: () => mounted.current && !completed,
            onEvent(value): void {
              if (!mounted.current || completed) return;
              if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型返回的事件格式异常。");
              const event = value as Record<string, unknown>;
              if (event.type === "error") throw new Error(typeof event.error === "string" && event.error ? event.error : "模型请求失败");
              if (event.type === "done") { completed = true; return; }
              if (event.type === "text") {
                if (typeof event.content !== "string") throw new Error("模型返回的文本格式异常。");
                content += event.content;
                setResults((prev) => prev.map((r, i) => i === idx ? { ...r, content } : r));
              }
            },
          });
          if (!mounted.current) return;
          if (!completed || !content.trim()) throw new Error(completed ? "模型未返回有效文本，请重试。" : "响应未完整结束，请核对服务后重试。");
          setResults((prev) => prev.map((r, i) => i === idx ? { ...r, content, isLoading: false } : r));
        } catch (err) {
          if (mounted.current) setResults((prev) => prev.map((r, i) => i === idx ? { ...r, error: err instanceof Error ? err.message : "请求失败", isLoading: false } : r));
        }
      }));
    } finally {
      inFlight.current = false;
      if (mounted.current) setIsRunning(false);
    }
  }, [comparePrompt, selectedModels, models]);

  const copyResult = useCallback((content: string, modelName: string): void => {
    void navigator.clipboard.writeText(content).then(() => { if (mounted.current) toast.success("已复制 " + modelName + " 的回答"); }).catch(() => { if (mounted.current) toast.error("复制失败，请检查浏览器剪贴板权限。"); });
  }, []);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}
        style={{ animation: "none" }} className={"flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl " + panelBg + " " + textColor}>
        <div className={"flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 sm:px-5 " + borderCls}>
          <DialogTitle className={"text-sm font-semibold " + textColor}>多模型对比</DialogTitle>
          <button onClick={onClose} aria-label="关闭多模型对比" className={"inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:opacity-70 " + subText}><X size={16} /></button>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3 sm:p-5">
          <div className="shrink-0">
            <p className={"mb-2 text-xs " + subText}>选择对比模型（最多 3 个）</p>
            <div className="flex min-w-0 flex-wrap gap-2">
              {models.map((m) => {
                const key = m.providerId + "::" + m.id, isSelected = selectedModels.includes(key);
                return <button key={key} onClick={() => toggleModel(key)} aria-pressed={isSelected} disabled={isRunning || (!isSelected && selectedModels.length >= 3)}
                  className={"inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 break-words rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed " + (isSelected
                    ? (isMonochrome ? "border-amber-500 bg-amber-50 text-amber-800" : "border-[#d4af37] bg-[#d4af37]/10 text-[#d4af37]")
                    : (isMonochrome ? "border-gray-200 text-gray-600 hover:border-gray-300" : "border-[#404040] text-white/75 hover:border-[#505050]"))}>
                  <span className="min-w-0 break-words">{modelLabel(m)}</span>{isSelected && <Check size={14} aria-hidden="true" className="shrink-0" />}
                </button>;
              })}
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 gap-2">
            <input type="text" aria-label="对比问题" value={comparePrompt} onChange={(e) => setComparePrompt(e.target.value)} disabled={isRunning}
              onKeyDown={(e) => { if (e.key === "Enter" && !isRunning) void runCompare(); }} placeholder="输入要对比的问题…"
              className={"min-h-11 min-w-0 flex-1 rounded-lg border px-3 py-2 text-base " + inputBg} />
            <button onClick={() => void runCompare()} disabled={isRunning || !comparePrompt.trim() || selectedModels.length < 2}
              className={"flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 " + goldBtn}>{isRunning ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}对比</button>
          </div>
          {isRunning && <p className={"shrink-0 text-xs " + subText}>关闭仅退出查看，不会撤回已发请求。</p>}
          {results.length > 0 && <div className={"grid min-w-0 shrink-0 gap-3 " + (results.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3")}>
            {results.map((result, idx) => <div key={idx} className={"flex min-w-0 flex-col rounded-lg border " + borderCls}>
              <div className={"flex min-w-0 items-center justify-between gap-2 border-b px-3 py-2 " + borderCls}>
                <span className={"min-w-0 break-words text-sm font-medium " + (isMonochrome ? "text-amber-800" : "text-[#d4af37]")}>{result.modelName}</span>
                {result.content && !result.isLoading && !result.error && <button onClick={() => copyResult(result.content, result.modelName)} className={"inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:opacity-70 " + subText} title="复制回答"><Copy size={14} /></button>}
              </div>
              <div className="max-h-[50dvh] min-w-0 overflow-y-auto p-3">
                {result.isLoading ? <div className={"flex items-center gap-2 text-sm " + subText}><Loader2 size={14} className="animate-spin" />生成中…</div>
                  : result.error ? <div role="alert" className={"break-words text-sm " + (isMonochrome ? "text-red-700" : "text-red-300")}>{result.error}</div>
                    : <div className={"whitespace-pre-wrap break-words text-base leading-relaxed " + textColor}>{result.content}</div>}
              </div>
            </div>)}
          </div>}
          {results.length === 0 && <div className={"flex min-h-16 flex-1 items-center justify-center text-sm " + subText}>{models.length < 2 ? "至少需要 2 个已配置的模型才能对比" : '选择模型并输入问题后点击“对比”'}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
