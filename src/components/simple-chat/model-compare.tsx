"use client";

import { useCallback, useState } from "react";
import { Copy, Loader2, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";

interface ModelResult {
  modelId: string;
  providerId: string;
  modelName: string;
  content: string;
  isLoading: boolean;
  error?: string;
}

interface ModelCompareProps {
  isMonochrome: boolean;
  prompt: string;
  models: Array<{ id: string; providerId: string; name?: string; displayName?: string }>;
  onClose: () => void;
}

export function ModelCompare({ isMonochrome, prompt, models, onClose }: ModelCompareProps) {
  const [comparePrompt, setComparePrompt] = useState(prompt);
  const [selectedModels, setSelectedModels] = useState<string[]>(models.slice(0, 2).map((m) => `${m.providerId}::${m.id}`));
  const [results, setResults] = useState<ModelResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const panelBg = isMonochrome ? "bg-white border-gray-200" : "bg-[#1e1e1e] border-[#3d3d3d]";
  const textColor = isMonochrome ? "text-gray-800" : "text-white";
  const subText = isMonochrome ? "text-gray-500" : "text-white/50";
  const inputBg = isMonochrome ? "bg-gray-50 border-gray-200 text-gray-800" : "bg-[#2a2a2a] border-[#404040] text-white";
  const goldBtn = isMonochrome
    ? "bg-amber-500 text-white hover:bg-amber-600"
    : "bg-[#d4af37] text-black hover:bg-[#e5c158]";
  const borderCls = isMonochrome ? "border-gray-200" : "border-[#3d3d3d]";

  const toggleModel = useCallback((key: string) => {
    setSelectedModels((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : prev.length < 3 ? [...prev, key] : prev
    );
  }, []);

  const runCompare = useCallback(async () => {
    if (!comparePrompt.trim()) return toast.error("请输入对比问题");
    if (selectedModels.length < 2) return toast.error("请至少选择 2 个模型");

    setIsRunning(true);
    const initialResults: ModelResult[] = selectedModels.map((key) => {
      const [providerId, modelId] = key.split("::");
      const modelInfo = models.find((m) => m.id === modelId);
      return {
        modelId,
        providerId,
        modelName: modelInfo?.displayName || modelInfo?.name || modelId,
        content: "",
        isLoading: true,
      };
    });
    setResults(initialResults);

    // 并行请求所有模型
    await Promise.allSettled(
      initialResults.map(async (result, idx) => {
        try {
          const res = await fetch("/api/simple-chat/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: comparePrompt,
              history: [],
              model: result.modelId,
              providerId: result.providerId,
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const content = data.content || data.text || data.message || "无返回内容";
          setResults((prev) =>
            prev.map((r, i) => (i === idx ? { ...r, content, isLoading: false } : r))
          );
        } catch (err) {
          setResults((prev) =>
            prev.map((r, i) =>
              i === idx ? { ...r, error: err instanceof Error ? err.message : "请求失败", isLoading: false } : r
            )
          );
        }
      })
    );
    setIsRunning(false);
  }, [comparePrompt, selectedModels, models]);

  const copyResult = useCallback((content: string, modelName: string) => {
    navigator.clipboard.writeText(content).then(() => toast.success(`已复制 ${modelName} 的回答`));
  }, []);

  return (
    <div className={"fixed inset-0 z-[200] flex items-center justify-center p-4 " + (isMonochrome ? "bg-black/20" : "bg-black/60")}>
      <div className={"flex h-full max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border shadow-2xl " + panelBg}>
        {/* Header */}
        <div className={"flex shrink-0 items-center justify-between border-b px-5 py-4 " + borderCls}>
          <h3 className={"text-sm font-semibold " + textColor}>多模型对比</h3>
          <button onClick={onClose} className={"rounded p-1 hover:opacity-70 " + subText}>
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
          {/* Model Selection */}
          <div>
            <label className={"mb-2 block text-xs " + subText}>选择对比模型（最多 3 个）</label>
            <div className="flex flex-wrap gap-2">
              {models.map((m) => {
                const key = `${m.providerId}::${m.id}`;
                const isSelected = selectedModels.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleModel(key)}
                    className={"rounded-full border px-3 py-1 text-xs transition-all " + (
                      isSelected
                        ? (isMonochrome ? "border-amber-500 bg-amber-50 text-amber-800" : "border-[#d4af37] bg-[#d4af37]/10 text-[#d4af37]")
                        : (isMonochrome ? "border-gray-200 text-gray-500 hover:border-gray-300" : "border-[#404040] text-white/40 hover:border-[#505050]")
                    )}
                  >
                    {m.displayName || m.name || m.id}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={comparePrompt}
              onChange={(e) => setComparePrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !isRunning) void runCompare(); }}
              placeholder="输入要对比的问题…"
              className={"flex-1 rounded-lg border px-3 py-2 text-sm " + inputBg}
            />
            <button
              onClick={() => void runCompare()}
              disabled={isRunning || !comparePrompt.trim() || selectedModels.length < 2}
              className={"flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 " + goldBtn}
            >
              {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              对比
            </button>
          </div>

          {/* Results Grid */}
          {results.length > 0 && (
            <div className={"grid flex-1 gap-3 overflow-y-auto " + (results.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
              {results.map((result, idx) => (
                <div key={idx} className={"flex flex-col rounded-lg border " + borderCls}>
                  <div className={"flex items-center justify-between border-b px-3 py-2 " + borderCls}>
                    <span className={"text-xs font-medium " + (isMonochrome ? "text-amber-600" : "text-[#d4af37]")}>
                      {result.modelName}
                    </span>
                    {result.content && !result.isLoading && (
                      <button
                        onClick={() => copyResult(result.content, result.modelName)}
                        className={"rounded p-1 hover:opacity-70 " + subText}
                        title="复制回答"
                      >
                        <Copy size={12} />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto p-3">
                    {result.isLoading ? (
                      <div className={"flex items-center gap-2 text-xs " + subText}>
                        <Loader2 size={12} className="animate-spin" />
                        生成中…
                      </div>
                    ) : result.error ? (
                      <div className="text-xs text-red-500">{result.error}</div>
                    ) : (
                      <div className={"whitespace-pre-wrap text-xs leading-relaxed " + textColor}>
                        {result.content}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.length === 0 && (
            <div className={"flex flex-1 items-center justify-center text-sm " + subText}>
              选择模型并输入问题后点击&quot;对比&quot;
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
