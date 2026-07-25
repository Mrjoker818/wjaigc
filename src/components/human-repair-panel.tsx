"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Scan, ShieldCheck, Sparkles, UserRoundCheck, X } from "lucide-react";
import { toast } from "sonner";

interface HumanBox { x: number; y: number; width: number; height: number; }
interface HumanTargetView {
  id: string; type: string; qualityScore: number;
  recommendedMode: "light" | "standard" | "deep" | "no_repair";
  issues: string[]; box?: HumanBox;
}
interface HumanAnalysisView {
  targets: HumanTargetView[]; scores: Record<string, number>; detector?: string;
  persons?: Array<{ id: string; box: HumanBox }>;
}
interface HumanCandidateView {
  id: string; targetId: string; imageUrl: string; provider: string;
  validation: { total: number; preservation: number; passed: boolean };
}
interface ModelOption { id: string; name?: string; displayName?: string; providerId: string; }
interface Props {
  isMonochrome?: boolean; onClose: () => void;
  onAddImage?: (url: string, meta?: { modelName?: string; apiProvider?: string }) => void;
  initialImageUrl?: string;
}

const TARGET_LABELS: Record<string, string> = {
  face: "人脸", left_hand: "左手", right_hand: "右手", body: "身体",
  feet: "脚部", hair: "头发", clothes: "服装", interaction: "人与物交互",
};

function scoreColor(score: number) {
  if (score >= 85) return { border: "border-emerald-500", text: "text-emerald-400", bg: "bg-emerald-900/30" };
  if (score >= 70) return { border: "border-amber-500", text: "text-amber-400", bg: "bg-amber-900/30" };
  return { border: "border-red-500", text: "text-red-400", bg: "bg-red-900/30" };
}

function HumanCanvasViewer({
  imageUrl, targets, selectedTargetIds, onToggleTarget, isMonochrome,
}: {
  imageUrl: string; targets: HumanTargetView[]; selectedTargetIds: string[];
  onToggleTarget: (id: string) => void; isMonochrome: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number; natW: number; natH: number } | null>(null);

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setImgSize({ w: img.offsetWidth, h: img.offsetHeight, natW: img.naturalWidth, natH: img.naturalHeight });
  }

  const scaleX = imgSize ? imgSize.w / imgSize.natW : 1;
  const scaleY = imgSize ? imgSize.h / imgSize.natH : 1;

  function getBoxStyle(box: HumanBox) {
    return {
      left: box.x * scaleX, top: box.y * scaleY,
      width: box.width * scaleX, height: box.height * scaleY,
    };
  }

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-lg" style={{ maxHeight: 320 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="" onLoad={handleLoad} className="w-full object-contain" style={{ maxHeight: 320 }} />
      {imgSize && targets.map(target => {
        if (!target.box) return null;
        const col = scoreColor(target.qualityScore);
        const isSelected = selectedTargetIds.includes(target.id);
        const box = getBoxStyle(target.box);
        return (
          <button
            key={target.id}
            onClick={() => onToggleTarget(target.id)}
            className={"absolute rounded border-2 transition-all hover:opacity-100 " + (isSelected ? col.border + " opacity-90" : "border-white/40 opacity-40")}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            title={TARGET_LABELS[target.type] + " " + target.qualityScore}
          >
            {isSelected && (
              <span className={"absolute -top-5 left-0 rounded px-1 py-0.5 text-[10px] font-medium whitespace-nowrap " + col.bg + " " + col.text}>
                {TARGET_LABELS[target.type]} {target.qualityScore}
              </span>
            )}
          </button>
        );
      })}
      {!imgSize && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-white/50" />
        </div>
      )}
    </div>
  );
}

function CandidateCompare({
  sourceUrl, candidate, isMonochrome, onSelect,
}: {
  sourceUrl: string; candidate: HumanCandidateView; isMonochrome: boolean; onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const col = scoreColor(candidate.validation.total);
  const inputClass = isMonochrome ? "bg-gray-50 border-gray-200" : "bg-[#242424] border-[#424242]";

  return (
    <div
      className={"rounded-lg border overflow-hidden " + (candidate.validation.passed ? col.border : "border-red-800/60") + " " + inputClass}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    >
      <div className="relative aspect-video bg-black/30">
        {hovered ? (
          <div className="flex h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sourceUrl} alt="原图" className="w-1/2 h-full object-contain border-r border-white/20" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={candidate.imageUrl} alt="修复" className="w-1/2 h-full object-contain" />
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] bg-black/60 text-white/80 px-2 rounded">修复前 / 修复后</div>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={candidate.imageUrl} alt="候选" className="w-full h-full object-contain" />
        )}
      </div>
      <div className="flex items-center justify-between px-2 py-1.5">
        <div className="text-xs">
          <span className={col.text + " font-medium"}>评分 {candidate.validation.total}</span>
          <span className="text-white/40 ml-2">保护 {candidate.validation.preservation}</span>
          {!candidate.validation.passed && <span className="ml-2 text-red-400">未通过保护校验</span>}
        </div>
        <button
          onClick={onSelect} disabled={!candidate.validation.passed}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs bg-amber-500 text-black font-medium disabled:opacity-40"
        >
          <Check size={12} />采用
        </button>
      </div>
    </div>
  );
}

export default function HumanRepairPanel({ isMonochrome = false, onClose, onAddImage, initialImageUrl = "" }: Props) {
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [analysis, setAnalysis] = useState<HumanAnalysisView | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"quick" | "pro" | "batch">("quick");
  const [candidateCount, setCandidateCount] = useState(2);
  const [strength, setStrength] = useState(0.7);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [batchUrls, setBatchUrls] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [candidates, setCandidates] = useState<HumanCandidateView[]>([]);
  const imageUrlRef = useRef(initialImageUrl);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisRequestRef = useRef(0);
  const repairRequestRef = useRef(0);

  const panelClass = isMonochrome ? "bg-white border-gray-200 text-gray-800" : "bg-[#171717] border-[#3b3b3b] text-white";
  const subduedClass = isMonochrome ? "text-gray-500" : "text-zinc-400";
  const inputClass = isMonochrome ? "bg-gray-50 border-gray-200 text-gray-800" : "bg-[#242424] border-[#424242] text-white";

  // 加载模型列表
  useEffect(() => {
    fetch("/api/models?type=image")
      .then(r => r.json())
      .then((data: { models?: ModelOption[] }) => { if (data.models) setModels(data.models); })
      .catch(() => {});
  }, []);

  // 设置默认模型
  useEffect(() => {
    const def = models.find(m => (m as ModelOption & { isDefault?: boolean }).isDefault);
    if (def && !selectedModel) {
      setSelectedModel(def.id);
      setSelectedProviderId(def.providerId);
    }
  }, [models, selectedModel]);

  const recommendedIds = analysis?.targets.filter(t => t.recommendedMode !== "no_repair").map(t => t.id) || [];

  const resetSourceState = useCallback((nextUrl: string) => {
    imageUrlRef.current = nextUrl;
    setImageUrl(nextUrl);
    setAnalysis(null);
    setSelectedTargetIds([]);
    setCandidates([]);
  }, []);

  const analyze = useCallback(async (sourceUrl?: string) => {
    const url = sourceUrl ?? imageUrlRef.current;
    if (!url) return;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++analysisRequestRef.current;
    analysisAbortRef.current = controller;
    setIsBusy(true);
    try {
      const r = await fetch("/api/human/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ imageId: url, imageUrl: url }),
      });
      const data = await r.json() as { analysis?: HumanAnalysisView; targets?: HumanTargetView[]; error?: string };
      if (!r.ok) throw new Error(data.error || "人物检测失败");
      if (requestId !== analysisRequestRef.current || imageUrlRef.current !== url) return;
      const next = data.analysis || { targets: data.targets || [], scores: {} };
      setAnalysis(next);
      setSelectedTargetIds(next.targets.filter(t => t.recommendedMode !== "no_repair").map(t => t.id));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestId === analysisRequestRef.current && imageUrlRef.current === url) {
        toast.error(error instanceof Error ? error.message : "人物检测失败");
      }
    } finally {
      if (requestId === analysisRequestRef.current) setIsBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!initialImageUrl) return;
    resetSourceState(initialImageUrl);
    void analyze(initialImageUrl);
  }, [analyze, initialImageUrl, resetSourceState]);

  useEffect(() => () => {
    analysisAbortRef.current?.abort();
    analysisRequestRef.current += 1;
    repairRequestRef.current += 1;
  }, []);

  const waitForTask = useCallback(async (taskId: string): Promise<HumanCandidateView[]> => {
    for (let i = 0; i < 120; i++) {
      const r = await fetch("/api/human/task/" + taskId);
      const d = await r.json() as { task?: { status: string; candidates: HumanCandidateView[]; error?: string }; error?: string };
      if (!r.ok) throw new Error(d.error || "读取任务失败");
      if (d.task?.status === "completed") return d.task.candidates;
      if (d.task?.status === "failed") throw new Error(d.task.error || "人物精修失败");
      await new Promise(res => setTimeout(res, 1000));
    }
    throw new Error("人物精修超时");
  }, []);

  const repairOne = useCallback(async (url: string, targetIds: string[]) => {
    const r = await fetch("/api/human/repair", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageId: url, imageUrl: url, targetIds,
        candidateCount: mode === "pro" ? candidateCount : 1,
        model: selectedModel,
        providerId: selectedProviderId,
        mode: "auto",
        options: { strength, lockIdentity: true, lockHair: true, lockClothes: true, lockPose: true, lockBackground: true, protectTextLogoProduct: true },
      }),
    });
    const d = await r.json() as { taskId?: string; error?: string };
    if (!r.ok || !d.taskId) throw new Error(d.error || "任务创建失败");
    return waitForTask(d.taskId);
  }, [candidateCount, mode, selectedModel, selectedProviderId, strength, waitForTask]);

  const handleRepair = useCallback(async () => {
    const sourceUrl = imageUrlRef.current;
    if (!sourceUrl) return toast.error("请先输入或选择图片");
    if (!selectedProviderId || !selectedModel) return toast.error("请选择已授权的图像编辑模型");
    const requestId = ++repairRequestRef.current;
    setIsBusy(true);
    try {
      const ids = mode === "pro" ? selectedTargetIds : recommendedIds;
      const results = await repairOne(sourceUrl, ids);
      if (requestId !== repairRequestRef.current || imageUrlRef.current !== sourceUrl) return;
      setCandidates(results);
      toast.success("人物精修完成，共生成 " + results.length + " 个候选结果");
    } catch (error) {
      if (requestId === repairRequestRef.current && imageUrlRef.current === sourceUrl) {
        toast.error(error instanceof Error ? error.message : "人物精修失败");
      }
    } finally {
      if (requestId === repairRequestRef.current) setIsBusy(false);
    }
  }, [mode, recommendedIds, repairOne, selectedModel, selectedProviderId, selectedTargetIds]);

  const handleBatch = useCallback(async () => {
    const urls = batchUrls.split('\n').map(s => s.replace(/\r$/, '').trim()).filter(Boolean);
    if (!urls.length) return toast.error("请输入至少一个图片 URL");
    if (!selectedProviderId || !selectedModel) return toast.error("请选择已授权的图像编辑模型");
    const requestId = ++repairRequestRef.current;
    setIsBusy(true);
    try {
      const all: HumanCandidateView[] = [];
      for (const url of urls) {
        all.push(...await repairOne(url, []));
        if (requestId !== repairRequestRef.current) return;
      }
      if (requestId !== repairRequestRef.current) return;
      setCandidates(all);
      toast.success("批量精修完成：" + urls.length + " 张");
    } catch (error) {
      if (requestId === repairRequestRef.current) toast.error(error instanceof Error ? error.message : "批量精修失败");
    } finally {
      if (requestId === repairRequestRef.current) setIsBusy(false);
    }
  }, [batchUrls, repairOne, selectedModel, selectedProviderId]);

  const selectCandidate = useCallback(async (candidate: HumanCandidateView) => {
    const taskId = candidate.id.split("-").slice(0, 6).join("-");
    try {
      const r = await fetch("/api/human/select", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, candidateId: candidate.id }),
      });
      const d = await r.json() as { candidate?: HumanCandidateView; error?: string };
      if (!r.ok || !d.candidate) throw new Error(d.error || "保存版本失败");
      onAddImage?.(d.candidate.imageUrl, { modelName: "human-repair-master", apiProvider: candidate.provider });
      toast.success("已将精修结果添加到画布");
    } catch (e) { toast.error(e instanceof Error ? e.message : "保存版本失败"); }
  }, [onAddImage]);

  const toggleTarget = useCallback((id: string) => {
    setSelectedTargetIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const hasLowScoreTargets = recommendedIds.length > 0;
  const overallScore = analysis?.scores.overall;
  const detectorBadge = analysis?.detector === "vision-adapter" ? (
    <span className="text-[10px] bg-emerald-900/40 text-emerald-400 border border-emerald-700/50 rounded px-1.5 py-0.5">Vision AI 检测</span>
  ) : analysis ? (
    <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 rounded px-1.5 py-0.5">基础区域检测</span>
  ) : null;

  return (
    <div
      className={"fixed left-1/2 top-1/2 z-[80] w-[500px] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border shadow-2xl " + panelClass}
      data-modal="human-repair"
    >
      {/* Header */}
      <div className={"sticky top-0 z-10 flex items-center justify-between border-b border-inherit px-4 py-3 backdrop-blur bg-inherit"}>
        <div className="flex items-center gap-2">
          <UserRoundCheck size={18} />
          <div>
            <div className="text-sm font-semibold">人物精修大师 Ultimate</div>
            <div className={"flex items-center gap-1.5 " + subduedClass}>
              <span className="text-xs">局部修复 · 蒙版外保护 · 多候选版本</span>
              {detectorBadge}
            </div>
          </div>
        </div>
        <button aria-label="关闭" onClick={onClose} className="p-1.5 rounded hover:opacity-70"><X size={18} /></button>
      </div>

      <div className="space-y-4 p-4">
        {/* Image Input */}
        <div className="flex gap-2">
          <input
            value={imageUrl}
            onChange={event => {
              analysisAbortRef.current?.abort();
              analysisRequestRef.current += 1;
              repairRequestRef.current += 1;
              resetSourceState(event.target.value);
            }}
            placeholder="粘贴图片 URL 开始检测…"
            className={"flex-1 rounded-md border px-3 py-2 text-sm " + inputClass}
          />
          <button
            onClick={() => void analyze()} disabled={isBusy || !imageUrl}
            className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm whitespace-nowrap disabled:opacity-40"
          >
            {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Scan size={14} />}
            检测人物
          </button>
        </div>

        {/* Canvas Viewer */}
        {imageUrl && analysis && (
          <HumanCanvasViewer
            imageUrl={imageUrl} targets={analysis.targets}
            selectedTargetIds={selectedTargetIds} onToggleTarget={toggleTarget}
            isMonochrome={isMonochrome}
          />
        )}

        {/* Quality Summary */}
        {analysis && (
          <div className={"rounded-lg border p-3 space-y-2 " + inputClass}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">整体质量</span>
                {overallScore !== undefined && (
                  <span className={"text-sm font-bold " + scoreColor(overallScore).text}>{overallScore}</span>
                )}
              </div>
              <span className={"text-xs " + subduedClass}>检测到 {analysis.targets.length} 个区域</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {analysis.targets.map(t => {
                const col = scoreColor(t.qualityScore);
                const isSelected = selectedTargetIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTarget(t.id)}
                    className={"flex items-center gap-2 rounded border px-2 py-1.5 text-left transition-all " + (isSelected ? col.border + " " + col.bg : "border-white/10 opacity-60")}
                  >
                    <div className={"w-2 h-2 rounded-full flex-shrink-0 " + (t.qualityScore >= 85 ? "bg-emerald-400" : t.qualityScore >= 70 ? "bg-amber-400" : "bg-red-400")} />
                    <span className="text-xs flex-1 min-w-0 truncate">{TARGET_LABELS[t.type] || t.type}</span>
                    <span className={"text-xs font-medium " + col.text}>{t.qualityScore}</span>
                  </button>
                );
              })}
            </div>
            {analysis.targets.some(t => t.issues?.length > 0) && (
              <div className={"text-xs " + subduedClass}>
                主要问题：{[...new Set(analysis.targets.flatMap(t => t.issues || []))].slice(0, 6).join(" · ")}
              </div>
            )}
          </div>
        )}

        {/* Mode Tabs */}
        <div className="flex rounded-lg border border-white/10 overflow-hidden text-sm">
          {(["quick", "pro", "batch"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={"flex-1 py-1.5 text-center transition-colors " + (mode === m ? "bg-amber-500 text-black font-medium" : subduedClass + " hover:opacity-80")}
            >
              {m === "quick" ? "一键修复" : m === "pro" ? "专业修复" : "批量修复"}
            </button>
          ))}
        </div>

        <div className={"rounded-lg border p-3 text-sm " + inputClass}>
          <label className={"block text-xs mb-1 " + subduedClass}>图像编辑模型</label>
          <select
            value={selectedModel ? selectedProviderId + "::" + selectedModel : ""}
            onChange={event => {
              const [providerId, model] = event.target.value.split("::");
              setSelectedProviderId(providerId || "");
              setSelectedModel(model || "");
            }}
            className={"w-full rounded border px-2 py-1.5 text-sm " + inputClass}
          >
            <option value="">请选择已授权模型</option>
            {models.map(model => (
              <option key={model.providerId + "::" + model.id} value={model.providerId + "::" + model.id}>
                {model.displayName || model.name || model.id}
              </option>
            ))}
          </select>
        </div>

        {/* Pro mode settings */}
        {mode === "pro" && (
          <div className={"space-y-3 rounded-lg border p-3 text-sm " + inputClass}>
            {/* Candidate Count */}
            <div className="flex items-center gap-3">
              <label className={"text-xs " + subduedClass}>候选数量</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map(n => (
                  <button key={n} onClick={() => setCandidateCount(n)}
                    className={"w-7 h-7 rounded text-xs font-medium " + (candidateCount === n ? "bg-amber-500 text-black" : "border border-white/20")}
                  >{n}</button>
                ))}
              </div>
            </div>
            {/* Strength */}
            <div className="flex items-center gap-3">
              <label className={"text-xs " + subduedClass}>修复强度</label>
              <input type="range" min="0.2" max="1" step="0.05" value={strength} onChange={e => setStrength(Number(e.target.value))} className="flex-1" />
              <span className="text-xs w-8 text-right">{strength.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Batch mode */}
        {mode === "batch" && (
          <div className="space-y-2">
            <textarea
              value={batchUrls} onChange={e => setBatchUrls(e.target.value)}
              placeholder="每行一个图片 URL（批量检测并修复）"
              className={"min-h-24 w-full rounded-lg border px-3 py-2 text-sm " + inputClass}
            />
          </div>
        )}

        {/* Pixel Protection Notice */}
        <div className={"flex items-start gap-2 rounded-lg p-2.5 text-xs " + (isMonochrome ? "bg-green-50 text-green-800" : "bg-emerald-950/40 text-emerald-200")}>
          <ShieldCheck size={14} className="shrink-0 mt-0.5" />
          <span>蒙版外像素保护已开启：修复后对蒙版外区域做 pixel diff 校验（变化率 ≤ 1% 方通过），身份 · 发型 · 服装 · 姿态 · 背景 · Logo 默认锁定。</span>
        </div>

        {/* Repair Button */}
        <button
          onClick={mode === "batch" ? () => void handleBatch() : () => void handleRepair()}
          disabled={isBusy || !selectedProviderId || !selectedModel || (!imageUrl && mode !== "batch")}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {mode === "quick" && (hasLowScoreTargets ? "一键修复 " + recommendedIds.length + " 个低质量区域" : "一键修复")}
          {mode === "pro" && "生成专业修复候选"}
          {mode === "batch" && "开始批量修复"}
        </button>

        {/* Candidates */}
        {candidates.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">修复候选结果</span>
              <span className={"text-xs " + subduedClass}>鼠标悬停查看修复前后对比</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {candidates.map(c => (
                <CandidateCompare
                  key={c.id} sourceUrl={imageUrl} candidate={c}
                  isMonochrome={isMonochrome} onSelect={() => void selectCandidate(c)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
