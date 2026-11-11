"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { Check, Loader2, RefreshCw, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface PromptOptimizerProps {
  isMonochrome: boolean;
  currentPrompt: string;
  onApply: (optimized: string) => void;
  onClose: () => void;
}
type OptimizeMode = "enhance" | "expand" | "simplify";
const MODE_CONFIG: { key: OptimizeMode; label: string; desc: string }[] = [
  { key: "enhance", label: "增强", desc: "增加细节、光影、材质描述" },
  { key: "expand", label: "扩展", desc: "丰富场景、构图、氛围" },
  { key: "simplify", label: "精简", desc: "去除冗余，保留核心关键词" },
];

export function PromptOptimizer({ isMonochrome, currentPrompt, onApply, onClose }: PromptOptimizerProps): ReactElement {
  const [prompt, setPrompt] = useState(currentPrompt);
  const [mode, setMode] = useState<OptimizeMode>("enhance");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const promptId = useId();
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const panelBg = isMonochrome ? "bg-white border-gray-200" : "bg-[#1e1e1e] border-[#3d3d3d]";
  const textColor = isMonochrome ? "text-gray-800" : "text-white";
  const subText = isMonochrome ? "text-gray-600" : "text-white/75";
  const inputBg = isMonochrome ? "bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-600" : "bg-[#2a2a2a] border-[#404040] text-white placeholder:text-white/75";
  const goldBtn = isMonochrome ? "bg-amber-500 text-gray-950 hover:bg-amber-600" : "bg-[#d4af37] text-black hover:bg-[#e5c158]";

  const handleOptimize = useCallback(async (): Promise<void> => {
    if (inFlight.current || !mounted.current) return;
    if (!prompt.trim()) { toast.error("请输入要优化的提示词"); return; }
    inFlight.current = true;
    setIsOptimizing(true);
    setResult("");
    setError("");
    try {
      const res = await fetch("/api/optimize-prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), mode }),
      });
      const value: unknown = await res.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("优化返回结果无效，请重试。");
      const data = value as Record<string, unknown>;
      if (!res.ok || data.success !== true || typeof data.optimized !== "string" || !data.optimized.trim()) {
        throw new Error(typeof data.error === "string" && data.error ? data.error : "优化返回结果无效，请重试。");
      }
      if (mounted.current) setResult(data.optimized);
    } catch (err) {
      if (mounted.current) {
        const message = err instanceof SyntaxError ? "优化返回格式异常，请核对服务后重试。" : err instanceof Error ? err.message : "优化失败";
        setError(message);
        toast.error(message);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setIsOptimizing(false);
    }
  }, [prompt, mode]);

  const handleApply = useCallback((): void => {
    if (!result || isOptimizing) return;
    onApply(result);
    toast.success("已应用到输入框");
    onClose();
  }, [result, isOptimizing, onApply, onClose]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}
        style={{ animation: "none" }} className={"flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg " + panelBg + " " + textColor}>
        <div className={"flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 sm:px-5 " + (isMonochrome ? "border-gray-200" : "border-[#3d3d3d]")}>
          <div className="flex min-w-0 items-center gap-2">
            <Wand2 size={18} className={"shrink-0 " + (isMonochrome ? "text-amber-700" : "text-[#d4af37]")} />
            <DialogTitle className={"text-sm font-semibold " + textColor}>提示词优化器</DialogTitle>
          </div>
          <button onClick={onClose} aria-label="关闭提示词优化器" className={"inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:opacity-70 " + subText}><X size={16} /></button>
        </div>
        <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODE_CONFIG.map((m) => (
              <button key={m.key} onClick={() => {
                if (m.key !== mode) { setMode(m.key); setResult(""); }
              }} aria-pressed={mode === m.key} disabled={isOptimizing}
                className={"min-h-11 min-w-0 break-words rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-wait " + (mode === m.key
                  ? (isMonochrome ? "border-amber-500 bg-amber-50 text-amber-800" : "border-[#d4af37] bg-[#d4af37]/10 text-[#d4af37]")
                  : (isMonochrome ? "border-gray-200 text-gray-600 hover:border-gray-300" : "border-[#404040] text-white/75 hover:border-[#505050]"))}>
                <div className="flex items-center gap-2 font-medium">{m.label}{mode === m.key && <Check size={14} aria-hidden="true" />}</div>
                <div className={"mt-1 text-xs leading-relaxed " + subText}>{m.desc}</div>
              </button>
            ))}
          </div>
          <div>
            <label htmlFor={promptId} className={"mb-1 block text-xs " + subText}>原始提示词</label>
            <textarea id={promptId} value={prompt} onChange={(e) => { setPrompt(e.target.value); setResult(""); }} disabled={isOptimizing} placeholder="输入要优化的提示词…"
              className={"min-h-24 w-full resize-y rounded-lg border px-3 py-2 text-base " + inputBg} />
          </div>
          {error && <div role="alert" className={"break-words rounded-lg border p-3 text-sm " + (isMonochrome ? "border-red-200 bg-red-50 text-red-700" : "border-red-400/30 bg-red-400/5 text-red-300")}>{error}</div>}
          <button onClick={() => void handleOptimize()} disabled={isOptimizing || !prompt.trim()}
            className={"flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40 " + goldBtn}>
            {isOptimizing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}{isOptimizing ? "优化中…" : "开始优化"}
          </button>
          {isOptimizing && <p className={"text-xs " + subText}>关闭仅退出查看，不会撤回已发请求。</p>}
          {result && (
            <div className="space-y-3">
              <div>
                <p className={"mb-1 text-xs " + subText}>优化结果</p>
                <div role="region" aria-label="优化结果" tabIndex={0} className={"max-h-40 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-lg border p-3 text-base leading-relaxed " + inputBg}>{result}</div>
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                <button onClick={() => void handleOptimize()} disabled={isOptimizing} className={"flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-2 text-sm " + (isMonochrome ? "border-gray-200 text-gray-600" : "border-[#404040] text-white/75")}><RefreshCw size={13} />重新优化</button>
                <button onClick={handleApply} disabled={isOptimizing} className={"flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold " + goldBtn}><Sparkles size={13} />应用结果</button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
