'use client';

import NextImage from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Scan, ShieldCheck, Sparkles, UserRoundCheck, X } from 'lucide-react';
import { toast } from 'sonner';

interface HumanTargetView {
  id: string;
  type: string;
  qualityScore: number;
  recommendedMode: 'light' | 'standard' | 'deep' | 'no_repair';
  issues: string[];
}

interface HumanAnalysisView {
  targets: HumanTargetView[];
  scores: Record<string, number>;
}

interface HumanCandidateView {
  id: string;
  targetId: string;
  imageUrl: string;
  provider: string;
  validation: { total: number; preservation: number; passed: boolean };
}

interface Props {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImage?: (url: string, meta?: { modelName?: string; apiProvider?: string }) => void;
  initialImageUrl?: string;
}

const TARGET_LABELS: Record<string, string> = {
  face: '人脸', left_hand: '左手', right_hand: '右手', body: '身体', feet: '脚部', hair: '头发', clothes: '服装', interaction: '人与物交互',
};

export default function HumanRepairPanel({ isMonochrome = false, onClose, onAddImage, initialImageUrl = '' }: Props) {
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [analysis, setAnalysis] = useState<HumanAnalysisView | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [isProfessional, setIsProfessional] = useState(false);
  const [candidateCount, setCandidateCount] = useState(2);
  const [strength, setStrength] = useState(0.7);
  const [model, setModel] = useState('');
  const [manualMaskImage, setManualMaskImage] = useState('');
  const [batchUrls, setBatchUrls] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [candidates, setCandidates] = useState<HumanCandidateView[]>([]);

  const panelClass = isMonochrome ? 'bg-white border-gray-200 text-gray-800' : 'bg-[#171717] border-[#3b3b3b] text-white';
  const subduedClass = isMonochrome ? 'text-gray-500' : 'text-zinc-400';
  const inputClass = isMonochrome ? 'bg-gray-50 border-gray-200' : 'bg-[#242424] border-[#424242]';

  const recommendedIds = useMemo(
    () => analysis?.targets.filter(target => target.recommendedMode !== 'no_repair').map(target => target.id) || [],
    [analysis],
  );

  const analyze = useCallback(async (url = imageUrl) => {
    if (!url) return;
    setIsBusy(true);
    try {
      const response = await fetch('/api/human/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: url, imageUrl: url }),
      });
      const data = await response.json() as { analysis?: HumanAnalysisView; targets?: HumanTargetView[]; error?: string };
      if (!response.ok) throw new Error(data.error || '人物检测失败');
      const nextAnalysis = data.analysis || { targets: data.targets || [], scores: {} };
      setAnalysis(nextAnalysis);
      setSelectedTargetIds(nextAnalysis.targets.filter(target => target.recommendedMode !== 'no_repair').map(target => target.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '人物检测失败');
    } finally {
      setIsBusy(false);
    }
  }, [imageUrl]);

  useEffect(() => {
    if (initialImageUrl) void analyze(initialImageUrl);
  }, [analyze, initialImageUrl]);

  const waitForTask = useCallback(async (taskId: string): Promise<HumanCandidateView[]> => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const response = await fetch(`/api/human/task/${taskId}`);
      const data = await response.json() as { task?: { status: string; candidates: HumanCandidateView[]; error?: string }; error?: string };
      if (!response.ok) throw new Error(data.error || '读取人物精修任务失败');
      if (data.task?.status === 'completed') return data.task.candidates;
      if (data.task?.status === 'failed') throw new Error(data.task.error || '人物精修失败');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('人物精修超时，请稍后在任务中心查看结果');
  }, []);

  const repairOne = useCallback(async (url: string, targetIds: string[]) => {
    const response = await fetch('/api/human/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageId: url,
        imageUrl: url,
        targetIds,
        candidateCount: isProfessional ? candidateCount : 1,
        model: model || undefined,
        mode: model ? 'auto' : 'mock',
        manualMaskImage: isProfessional && manualMaskImage ? manualMaskImage : undefined,
        options: { strength, lockIdentity: true, lockHair: true, lockClothes: true, lockPose: true, lockBackground: true, protectTextLogoProduct: true },
      }),
    });
    const data = await response.json() as { taskId?: string; error?: string };
    if (!response.ok || !data.taskId) throw new Error(data.error || '人物精修任务创建失败');
    return waitForTask(data.taskId);
  }, [candidateCount, isProfessional, manualMaskImage, model, strength, waitForTask]);

  const handleRepair = useCallback(async () => {
    if (!imageUrl) return toast.error('请先选择图片');
    setIsBusy(true);
    try {
      const results = await repairOne(imageUrl, isProfessional ? selectedTargetIds : recommendedIds);
      setCandidates(results);
      toast.success(`人物精修完成，已生成 ${results.length} 个候选结果`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '人物精修失败');
    } finally {
      setIsBusy(false);
    }
  }, [imageUrl, isProfessional, recommendedIds, repairOne, selectedTargetIds]);

  const handleBatch = useCallback(async () => {
    const urls = batchUrls.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) return toast.error('请输入至少一个图片 URL');
    setIsBusy(true);
    try {
      const allCandidates: HumanCandidateView[] = [];
      for (const url of urls) {
        const results = await repairOne(url, []);
        allCandidates.push(...results);
      }
      setCandidates(allCandidates);
      toast.success(`批量人物修复完成：${urls.length} 张图片`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批量人物修复失败');
    } finally {
      setIsBusy(false);
    }
  }, [batchUrls, repairOne]);

  const selectCandidate = useCallback(async (candidate: HumanCandidateView) => {
    const taskId = candidate.id.split('-').slice(0, 6).join('-');
    try {
      const response = await fetch('/api/human/select', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, candidateId: candidate.id }),
      });
      const data = await response.json() as { candidate?: HumanCandidateView; error?: string };
      if (!response.ok || !data.candidate) throw new Error(data.error || '保存版本失败');
      onAddImage?.(data.candidate.imageUrl, { modelName: 'human-repair', apiProvider: candidate.provider });
      toast.success('已将人物精修结果作为新版本添加到画布');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存版本失败');
    }
  }, [onAddImage]);

  return (
    <div className={`fixed inset-y-8 right-8 z-[80] w-[440px] max-w-[calc(100vw-2rem)] overflow-y-auto border shadow-2xl ${panelClass}`} data-modal="human-repair">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-inherit px-4 py-3 backdrop-blur bg-inherit">
        <div className="flex items-center gap-2"><UserRoundCheck size={18} /><div><div className="text-sm font-semibold">人物精修大师 Ultimate</div><div className={`text-xs ${subduedClass}`}>局部修复 · 原图保护 · 候选版本</div></div></div>
        <button aria-label="关闭人物精修大师" onClick={onClose} className="p-1.5"><X size={18} /></button>
      </div>
      <div className="space-y-4 p-4">
        <input value={imageUrl} onChange={event => setImageUrl(event.target.value)} placeholder="图片 URL" className={`w-full rounded-md border px-3 py-2 text-sm ${inputClass}`} />
        <div className="flex gap-2">
          <button onClick={() => void analyze()} disabled={isBusy || !imageUrl} className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm"><Scan size={15} />检测人物</button>
          <button onClick={() => setIsProfessional(value => !value)} className={`rounded-md px-3 py-2 text-sm ${isProfessional ? 'bg-amber-500 text-black' : 'border'}`}>{isProfessional ? '专业修复' : '一键修复'}</button>
        </div>
        {analysis && <div className={`rounded-md border p-3 text-xs ${inputClass}`}><div className="mb-2 flex items-center justify-between"><span>质量评分 {analysis.scores.overall ?? '--'}</span><span className={subduedClass}>{analysis.targets.length} 个区域</span></div><div className="grid grid-cols-2 gap-2">{analysis.targets.map(target => <label key={target.id} className="flex items-center gap-2"><input type="checkbox" checked={selectedTargetIds.includes(target.id)} onChange={() => setSelectedTargetIds(ids => ids.includes(target.id) ? ids.filter(id => id !== target.id) : [...ids, target.id])} /><span>{TARGET_LABELS[target.type] || target.type} {target.qualityScore}</span></label>)}</div></div>}
        {isProfessional && <div className="space-y-3 rounded-md border p-3"><label className="block text-xs">候选数量 <input type="number" min="1" max="4" value={candidateCount} onChange={event => setCandidateCount(Math.max(1, Math.min(4, Number(event.target.value) || 1)))} className={`ml-2 w-12 rounded border px-1 ${inputClass}`} /></label><label className="block text-xs">修复强度 <input type="range" min="0.2" max="1" step="0.05" value={strength} onChange={event => setStrength(Number(event.target.value))} className="ml-2 align-middle" /> {strength.toFixed(2)}</label><input value={model} onChange={event => setModel(event.target.value)} placeholder="已配置的 GPT Image 编辑模型（留空使用 Mock）" className={`w-full rounded border px-2 py-1.5 text-xs ${inputClass}`} /><textarea value={manualMaskImage} onChange={event => setManualMaskImage(event.target.value)} placeholder="可选：手动蒙版 data URL 或已上传蒙版 URL" className={`min-h-16 w-full rounded border px-2 py-1.5 text-xs ${inputClass}`} /></div>}
        <div className={`flex items-start gap-2 rounded-md p-3 text-xs ${isMonochrome ? 'bg-green-50 text-green-800' : 'bg-emerald-950/50 text-emerald-200'}`}><ShieldCheck size={16} className="shrink-0" />仅修复蒙版范围；身份、发型、服装、姿态、背景、文字、Logo 与产品默认锁定，原图不会被覆盖。</div>
        <button onClick={() => void handleRepair()} disabled={isBusy || !imageUrl} className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-black disabled:opacity-50">{isBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{isProfessional ? '生成专业修复候选' : '一键修复异常区域'}</button>
        <details><summary className="cursor-pointer text-xs">批量检测与人脸/手部修复</summary><textarea value={batchUrls} onChange={event => setBatchUrls(event.target.value)} placeholder="每行一个图片 URL" className={`mt-2 min-h-20 w-full rounded border px-2 py-1.5 text-xs ${inputClass}`} /><button onClick={() => void handleBatch()} disabled={isBusy} className="mt-2 rounded-md border px-3 py-1.5 text-xs">开始批量修复</button></details>
        {candidates.length > 0 && <div className="space-y-2"><div className="text-sm font-medium">候选结果</div>{candidates.map(candidate => <button key={candidate.id} onClick={() => void selectCandidate(candidate)} disabled={!candidate.validation.passed} className={`flex w-full items-center gap-3 rounded-md border p-2 text-left disabled:opacity-40 ${inputClass}`}><NextImage unoptimized src={candidate.imageUrl} alt="人物精修候选" width={56} height={56} className="h-14 w-14 object-cover" /><span className="flex-1 text-xs">{TARGET_LABELS[candidate.targetId.replace(/_01$/, '')] || candidate.targetId}<br />评分 {candidate.validation.total} · 保护 {candidate.validation.preservation}</span>{candidate.validation.passed && <Check size={16} className="text-emerald-500" />}</button>)}</div>}
      </div>
    </div>
  );
}
