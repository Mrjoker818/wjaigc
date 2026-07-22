"use client";

import { useCallback, useState } from "react";
import { Loader2, RefreshCw, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";

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

export function PromptOptimizer({ isMonochrome, currentPrompt, onApply, onClose }: PromptOptimizerProps) {
  const [prompt, setPrompt] = useState(currentPrompt);
  const [mode, setMode] = useState<OptimizeMode>("enhance");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [result, setResult] = useState("");

  const panelBg = isMonochrome ? "bg-white border-gray-200" : "bg-[#1e1e1e] border-[#3d3d3d]";
  const textColor = isMonochrome ? "text-gray-800" : "text-white";
  const subText = isMonochrome ? "text-gray-500" : "text-white/50";
  const inputBg = isMonochrome ? "bg-gray-50 border-gray-200 text-gray-800" : "bg-[#2a2a2a] border-[#404040] text-white";
  const goldBtn = isMonochrome
    ? "bg-amber-500 text-white hover:bg-amber-600"
    : "bg-[#d4af37] text-black hover:bg-[#e5c158]";

  const handleOptimize = useCallback(async () => {
    if (!prompt.trim()) return toast.error("请输入要优化的提示词");
    setIsOptimizing(true);
    setResult("");
    try {
      const res = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), mode }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "优化失败");
      setResult(data.optimized);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "优化失败");
    } finally {
      setIsOptimizing(false);
    }
  }, [prompt, mode]);

  const handleApply = useCallback(() => {
    if (!result) return;
    onApply(result);
    toast.success("已应用到输入框");
    onClose();
  }, [result, onApply, onClose]);

  return (
    <div className={"fixed inset-0 z-[200] flex items-center justify-center p-4 " + (isMonochrome ? "bg-black/20" : "bg-black/60")}>
      <div className={"w-full max-w-lg rounded-xl border shadow-2xl " + panelBg}>
        {/* Header */}
        <div className={"flex items-center justify-between border-b px-5 py-4 " + (isMonochrome ? "border-gray-200" : "border-[#3d3d3d]")}>
          <div className="flex items-center gap-2">
            <Wand2 size={18} className={isMonochrome ? "text-amber-500" : "text-[#d4af37]"} />
            <h3 className={"text-sm font-semibold " + textColor}>提示词优化器</h3>
          </div>
          <button onClick={onClose} className={"rounded p-1 hover:opacity-70 " + subText}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Mode Selector */}
          <div className="flex gap-2">
            {MODE_CONFIG.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={"flex-1 rounded-lg border px-3 py-2 text-left text-xs transition-all " + (
                  mode === m.key
                    ? (isMonochrome ? "border-amber-500 bg-amber-50 text-amber-800" : "border-[#d4af37] bg-[#d4af37]/10 text-[#d4af37]")
                    : (isMonochrome ? "border-gray-200 text-gray-600 hover:border-gray-300" : "border-[#404040] text-white/60 hover:border-[#505050]")
                )}
              >
                <div className="font-medium">{m.label}</div>
                <div className={subText}>{m.desc}</div>
              </button>
            ))}
          </div>

          {/* Input */}
          <div>
            <label className={"mb-1 block text-xs " + subText}>原始提示词</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入要优化的提示词…"
              className={"min-h-20 w-full rounded-lg border px-3 py-2 text-sm " + inputBg}
            />
          </div>

          {/* Optimize Button */}
          <button
            onClick={() => void handleOptimize()}
            disabled={isOptimizing || !prompt.trim()}
            className={"flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40 " + goldBtn}
          >
            {isOptimizing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {isOptimizing ? "优化中…" : "开始优化"}
          </button>

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div>
                <label className={"mb-1 block text-xs " + subText}>优化结果</label>
                <div className={"max-h-40 overflow-y-auto rounded-lg border p-3 text-sm leading-relaxed " + inputBg}>
                  {result}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleOptimize()}
                  disabled={isOptimizing}
                  className={"flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm " + (isMonochrome ? "border-gray-200 text-gray-600" : "border-[#404040] text-white/60")}
                >
                  <RefreshCw size={13} />重新优化
                </button>
                <button
                  onClick={handleApply}
                  className={"flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold " + goldBtn}
                >
                  <Sparkles size={13} />应用结果
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
