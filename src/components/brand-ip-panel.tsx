'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Sparkles, X, ChevronRight, Loader2, AlertCircle, Check, Plus,
  Crown, Target, Eye, Palette, Download, RefreshCw, Wand2,
  Settings, FileDown, Package, Shield, Layers, Image as ImageIcon,
  Send, RotateCcw, Lock, ChevronLeft,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BrandIpBrief {
  brandName: string;
  industry: string;
  targetAudience: string;
  coreValues: string;
  brandPersonality: string;
  vision: string;
  marketContext: string;
}

interface BrandIpDirection {
  id: string;
  name: string;
  description: string;
  scores: { differentiation: number; memorability: number; extensibility: number; feasibility: number };
}

interface BrandIpImmutableCore {
  id: string;
  category: string;
  description: string;
}

interface BrandIpControlledVariable {
  id: string;
  category: string;
  description: string;
  guidance: string;
}

interface BrandIpStrategy {
  immutableCore: BrandIpImmutableCore[];
  controlledVariables: BrandIpControlledVariable[];
  positioning: string;
  toneOfVoice: string;
  narrative: string;
}

interface BrandIpAsset {
  id: string;
  type: string;
  prompt: string;
  imageUrl: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
}

interface BrandIpProject {
  id: string;
  name: string;
  stage: string;
  brief: BrandIpBrief;
  directions: BrandIpDirection[];
  confirmedDirectionId: string | null;
  strategy: BrandIpStrategy | null;
  immutableCore: BrandIpImmutableCore[];
  controlledVariables: BrandIpControlledVariable[];
  assets: BrandIpAsset[];
}

interface BrandIpPanelProps {
  isMonochrome: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[], meta?: { modelName?: string; apiProvider?: string }) => void;
}

// ─── SSE Helper ──────────────────────────────────────────────────────────────

async function readSseStream(
  response: Response,
  onDelta: (text: string) => void,
  onResult: (data: unknown) => void,
  onError: (msg: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) { onError('流式响应不可读'); return; }
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    if (signal?.aborted) { reader.cancel(); return; }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const lines = part.split('\n');
      let eventType = '';
      let dataStr = '';
      for (const line of lines) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      if (!eventType) continue;
      try {
        const parsed = dataStr ? JSON.parse(dataStr) : {};
        if (eventType === 'delta') onDelta(parsed.text ?? '');
        else if (eventType === 'result') onResult(parsed);
        else if (eventType === 'error') onError(parsed.message ?? '未知错误');
      } catch { /* skip malformed */ }
    }
  }
}

// ─── Stages ──────────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'brand-goal',      label: '品牌目标', icon: Target,    short: '目标' },
  { key: 'role-direction',  label: '角色方向', icon: Crown,     short: '方向' },
  { key: 'visual-system',   label: '视觉系统', icon: Palette,   short: '视觉' },
  { key: 'application',     label: '应用延展', icon: Package,   short: '应用' },
  { key: 'governance',      label: '交付治理', icon: Shield,    short: '治理' },
];

function stageIndex(stage: string): number {
  return Math.max(0, STAGES.findIndex(s => s.key === stage));
}

// ─── Workflow Paths ──────────────────────────────────────────────────────────

const WORKFLOW_PATHS = [
  { key: 'new',          label: '从零创建',   desc: '品牌没有IP形象' },
  { key: 'upgrade',      label: '已有形象升级', desc: '已有角色但需优化' },
  { key: 'series',       label: '系列角色',   desc: '需要主角与多个配角' },
  { key: 'merchandise',  label: '周边/包装',   desc: '已有角色，需要生产应用' },
  { key: 'collab',       label: '联名/授权',   desc: '跨品牌合作或IP授权' },
];

const CARRIERS = [
  { key: 'social_avatar', label: '社交头像' },
  { key: 'packaging',     label: '包装设计' },
  { key: 'event_kv',      label: '活动主视觉' },
  { key: 'merchandise',   label: '周边商品' },
  { key: 'animation',     label: '动画内容' },
  { key: 'space',         label: '空间设计' },
];

const ASSET_TYPES = [
  { key: 'logo',      label: 'Logo' },
  { key: 'mascot',    label: '吉祥物' },
  { key: 'poster',    label: '海报' },
  { key: 'packaging', label: '包装' },
  { key: 'social',    label: '社交图' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function BrandIpPanel({ isMonochrome, onClose, onAddImages }: BrandIpPanelProps) {
  const [project, setProject] = useState<BrandIpProject | null>(null);
  const [projects, setProjects] = useState<BrandIpProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [briefDraft, setBriefDraft] = useState<BrandIpBrief>({
    brandName: '', industry: '', targetAudience: '', coreValues: '', brandPersonality: '', vision: '', marketContext: '',
  });
  const [workflowPath, setWorkflowPath] = useState('new');
  const [selectedCarriers, setSelectedCarriers] = useState<string[]>(['social_avatar']);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeStage, setActiveStage] = useState(0);

  // Strategy streaming
  const [strategyStreaming, setStrategyStreaming] = useState(false);
  const [strategyStreamText, setStrategyStreamText] = useState('');
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const strategyAbortRef = useRef<AbortController | null>(null);

  // Generation
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [assetPrompt, setAssetPrompt] = useState('');
  const [assetType, setAssetType] = useState('logo');

  // Position
  const [pos, setPos] = useState({ x: 30, y: 20 });
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Load projects ──────────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/brand-ip/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects ?? []);
      }
    } catch { /* ignore */ }
    setLoadingProjects(false);
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // ── Drag handlers ──────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select, [data-no-drag]')) return;
    setDragging(true);
    dragOffsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }, [pos]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPos({ x: e.clientX - dragOffsetRef.current.x, y: e.clientY - dragOffsetRef.current.y });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  // ── Create project ─────────────────────────────────────────────────────
  const handleCreateProject = useCallback(async () => {
    if (!briefDraft.brandName.trim()) return;
    try {
      const res = await fetch('/api/brand-ip/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: briefDraft.brandName, brief: briefDraft }),
      });
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
        setBriefDraft({ brandName: '', industry: '', targetAudience: '', coreValues: '', brandPersonality: '', vision: '', marketContext: '' });
        setActiveStage(0);
      }
    } catch { /* ignore */ }
  }, [briefDraft]);

  // ── Select project ─────────────────────────────────────────────────────
  const handleSelectProject = useCallback(async (projId: string) => {
    try {
      const res = await fetch(`/api/brand-ip/projects?projectId=${projId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
        if (data.project?.brief) setBriefDraft(data.project.brief);
        setActiveStage(stageIndex(data.project?.stage ?? 'brand-goal'));
      }
    } catch { /* ignore */ }
  }, []);

  // ── Run strategy analysis (SSE) ────────────────────────────────────────
  const handleRunStrategy = useCallback(async () => {
    if (!project) return;
    setStrategyStreaming(true);
    setStrategyStreamText('');
    setStrategyError(null);
    const ac = new AbortController();
    strategyAbortRef.current = ac;
    try {
      const res = await fetch('/api/brand-ip/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStrategyError(err.error || `HTTP ${res.status}`);
        setStrategyStreaming(false);
        return;
      }
      await readSseStream(
        res,
        (text) => setStrategyStreamText(prev => prev + text),
        (data) => {
          const s = data as BrandIpStrategy;
          if (s?.immutableCore) {
            setProject(prev => prev ? {
              ...prev,
              strategy: s,
              immutableCore: s.immutableCore,
              controlledVariables: s.controlledVariables,
              stage: 'role-direction',
            } : prev);
            setActiveStage(1);
          }
        },
        (msg) => setStrategyError(msg),
        ac.signal,
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setStrategyError(e.message);
      }
    } finally {
      setStrategyStreaming(false);
      strategyAbortRef.current = null;
    }
  }, [project]);

  // ── Confirm direction ──────────────────────────────────────────────────
  const handleConfirmDirection = useCallback(async (dirId: string) => {
    if (!project) return;
    try {
      const res = await fetch('/api/brand-ip/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, confirmedDirectionId: dirId }),
      });
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
        setActiveStage(2);
      }
    } catch { /* ignore */ }
  }, [project]);

  // ── Generate assets ────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!project || !assetPrompt.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/brand-ip/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, prompt: assetPrompt, assetType }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setGenError(err.error || `HTTP ${res.status}`);
      } else {
        const data = await res.json();
        if (data.taskId) {
          pollTask(data.taskId);
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error) setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  }, [project, assetPrompt, assetType]);

  // ── Poll task ──────────────────────────────────────────────────────────
  const pollTask = useCallback(async (taskId: string) => {
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/brand-ip/tasks?taskId=${taskId}`);
        if (!res.ok) break;
        const data = await res.json();
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          if (project) {
            const assetRes = await fetch(`/api/brand-ip/assets?projectId=${project.id}`);
            if (assetRes.ok) {
              const assetData = await assetRes.json();
              setProject(prev => prev ? { ...prev, assets: assetData.assets ?? [] } : prev);
            }
          }
          break;
        }
      } catch { /* continue */ }
    }
  }, [project]);

  // ── Add asset to canvas ────────────────────────────────────────────────
  const handleAddToCanvas = useCallback((url: string) => {
    onAddImages?.([url], { modelName: 'brand-ip', apiProvider: 'server' });
  }, [onAddImages]);

  // ── Theme ──────────────────────────────────────────────────────────────
  const dark = !isMonochrome;
  const c = {
    bg: dark ? 'bg-[#0a0a0a]' : 'bg-white',
    panel: dark ? 'bg-[#141414]' : 'bg-gray-50',
    card: dark ? 'bg-[#1a1a1a]' : 'bg-white',
    border: dark ? 'border-[#d4af37]/15' : 'border-gray-200',
    borderActive: dark ? 'border-[#d4af37]/40' : 'border-gray-400',
    text: dark ? 'text-white' : 'text-gray-800',
    sub: dark ? 'text-white/50' : 'text-gray-400',
    sub2: dark ? 'text-white/70' : 'text-gray-500',
    input: dark ? 'bg-[#0a0a0a] border-[#d4af37]/15 text-white' : 'bg-white border-gray-200 text-gray-800',
    gold: dark ? 'text-[#d4af37]' : 'text-gray-700',
    goldBg: dark ? 'bg-[#d4af37] text-black' : 'bg-gray-800 text-white',
    goldBgHover: dark ? 'hover:bg-[#e0b850]' : 'hover:bg-gray-700',
    goldBorder: dark ? 'border-[#d4af37]/30' : 'border-gray-300',
    goldChip: dark ? 'bg-[#d4af37]/8 text-[#d4af37] border-[#d4af37]/20' : 'bg-gray-100 text-gray-600 border-gray-200',
    hover: dark ? 'hover:bg-white/5' : 'hover:bg-gray-100',
    activeChip: dark ? 'bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/30' : 'bg-gray-800 text-white border-gray-700',
  };

  const currentStage = project?.stage ?? 'brand-goal';

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div
      ref={panelRef}
      data-floating-panel="brand-ip"
      data-popup
      className={`fixed z-[201] ${c.bg} ${c.border} border rounded-2xl shadow-2xl flex flex-col overflow-hidden bi-panel`}
      style={{ left: pos.x, top: pos.y, width: 'min(1280px, 96vw)', height: 'min(860px, 92vh)' }}
      onMouseDown={handleDragStart}
    >
      {/* ═══ Header ═══ */}
      <div className={`flex items-center justify-between px-5 py-3 border-b ${c.border} cursor-move shrink-0`}>
        <div className="flex items-center gap-2.5">
          <div className={`flex items-center justify-center h-8 w-8 rounded-lg ${dark ? 'bg-[#d4af37]/10' : 'bg-gray-100'}`}>
            <Sparkles className={`h-4.5 w-4.5 ${c.gold}`} />
          </div>
          <div>
            <span className={`font-bold text-base ${c.text}`}>品牌 IP 设计工场</span>
            {project && (
              <span className={`text-xs ${c.sub} ml-2`}>/ {project.name}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {project && (
            <>
              <button
                onClick={() => setShowAdvanced(s => !s)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${c.goldChip} border transition-colors ${c.hover}`}
                data-no-drag
              >
                <Settings className="h-3.5 w-3.5" /> 高级设置
              </button>
              <button
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${c.goldChip} border transition-colors ${c.hover}`}
                data-no-drag
              >
                <FileDown className="h-3.5 w-3.5" /> 导出
              </button>
            </>
          )}
          <button onClick={onClose} className={`p-1.5 rounded-lg ${c.hover} ${c.sub} transition-colors`} data-no-drag>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ═══ Stage Navigation ═══ */}
      {project && (
        <div className={`flex items-center gap-0.5 px-5 py-2 border-b ${c.border} shrink-0 overflow-x-auto`} data-no-drag>
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            const active = i === activeStage;
            const done = i < activeStage;
            return (
              <div key={s.key} className="flex items-center shrink-0">
                <button
                  onClick={() => i <= activeStage && setActiveStage(i)}
                  disabled={i > activeStage}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    active
                      ? (dark ? 'bg-[#d4af37] text-black' : 'bg-gray-800 text-white')
                      : done
                        ? c.gold
                        : c.sub
                  } ${i <= activeStage ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                </button>
                {i < STAGES.length - 1 && (
                  <ChevronRight className={`h-3 w-3 ${c.sub} mx-0.5`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ Body ═══ */}
      <div className="flex-1 overflow-hidden" data-no-drag>

        {/* ─── No Project: Create / Select ─── */}
        {!project && (
          <div className="h-full overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-5">
              {/* Create */}
              <div className={`rounded-xl border ${c.border} p-5`}>
                <h3 className={`text-sm font-semibold ${c.text} mb-4 flex items-center gap-2`}>
                  <Plus className={`h-4 w-4 ${c.gold}`} /> 新建品牌 IP 项目
                </h3>

                {/* Workflow path */}
                <div className="mb-4">
                  <label className={`text-xs ${c.sub} mb-2 block`}>工作路径</label>
                  <div className="grid grid-cols-3 gap-2">
                    {WORKFLOW_PATHS.map(p => (
                      <button
                        key={p.key}
                        onClick={() => setWorkflowPath(p.key)}
                        className={`text-left rounded-lg border p-2.5 transition-all ${
                          workflowPath === p.key ? c.activeChip : `${c.border} ${c.hover}`
                        }`}
                      >
                        <div className={`text-xs font-medium ${workflowPath === p.key ? c.gold : c.text}`}>{p.label}</div>
                        <div className={`text-[10px] ${c.sub} mt-0.5`}>{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Basic inputs */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <input
                    className={`${c.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 ${dark ? 'focus:ring-[#d4af37]/30' : 'focus:ring-gray-300'}`}
                    placeholder="品牌/项目名称 *"
                    value={briefDraft.brandName}
                    onChange={e => setBriefDraft(d => ({ ...d, brandName: e.target.value }))}
                  />
                  <input
                    className={`${c.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 ${dark ? 'focus:ring-[#d4af37]/30' : 'focus:ring-gray-300'}`}
                    placeholder="希望IP完成什么目标"
                    value={briefDraft.vision}
                    onChange={e => setBriefDraft(d => ({ ...d, vision: e.target.value }))}
                  />
                  <input
                    className={`${c.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 ${dark ? 'focus:ring-[#d4af37]/30' : 'focus:ring-gray-300'}`}
                    placeholder="目标受众"
                    value={briefDraft.targetAudience}
                    onChange={e => setBriefDraft(d => ({ ...d, targetAudience: e.target.value }))}
                  />
                  <input
                    className={`${c.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 ${dark ? 'focus:ring-[#d4af37]/30' : 'focus:ring-gray-300'}`}
                    placeholder="所属行业"
                    value={briefDraft.industry}
                    onChange={e => setBriefDraft(d => ({ ...d, industry: e.target.value }))}
                  />
                </div>

                {/* Carriers */}
                <div className="mb-3">
                  <label className={`text-xs ${c.sub} mb-2 block`}>首发载体</label>
                  <div className="flex flex-wrap gap-1.5">
                    {CARRIERS.map(carrier => {
                      const sel = selectedCarriers.includes(carrier.key);
                      return (
                        <button
                          key={carrier.key}
                          onClick={() => setSelectedCarriers(prev => sel ? prev.filter(c => c !== carrier.key) : [...prev, carrier.key])}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                            sel ? c.activeChip : `${c.border} ${c.sub2} ${c.hover}`
                          }`}
                        >
                          {carrier.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Collapsible advanced brief */}
                <details className={`mb-3 rounded-lg border ${c.border}`}>
                  <summary className={`px-3 py-2 text-xs ${c.sub2} cursor-pointer select-none`}>补充品牌信息（可选）</summary>
                  <div className="p-3 pt-0 space-y-2">
                    <input
                      className={`${c.input} border rounded-lg px-3 py-2 text-sm outline-none w-full`}
                      placeholder="核心价值观"
                      value={briefDraft.coreValues}
                      onChange={e => setBriefDraft(d => ({ ...d, coreValues: e.target.value }))}
                    />
                    <input
                      className={`${c.input} border rounded-lg px-3 py-2 text-sm outline-none w-full`}
                      placeholder="品牌个性"
                      value={briefDraft.brandPersonality}
                      onChange={e => setBriefDraft(d => ({ ...d, brandPersonality: e.target.value }))}
                    />
                    <textarea
                      className={`${c.input} border rounded-lg px-3 py-2 text-sm outline-none w-full resize-none`}
                      rows={2}
                      placeholder="市场背景与竞争环境"
                      value={briefDraft.marketContext}
                      onChange={e => setBriefDraft(d => ({ ...d, marketContext: e.target.value }))}
                    />
                  </div>
                </details>

                <button
                  onClick={handleCreateProject}
                  disabled={!briefDraft.brandName.trim()}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${c.goldBg} ${c.goldBgHover}`}
                >
                  <Plus className="h-4 w-4" /> 创建项目并开始
                </button>
              </div>

              {/* Existing projects */}
              {loadingProjects ? (
                <div className={`flex items-center justify-center py-6 ${c.sub}`}>
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : projects.length > 0 ? (
                <div>
                  <h3 className={`text-sm font-semibold ${c.text} mb-2 flex items-center gap-2`}>
                    <Layers className={`h-4 w-4 ${c.gold}`} /> 已有项目
                  </h3>
                  <div className="space-y-2">
                    {projects.map(p => (
                      <button
                        key={p.id}
                        onClick={() => handleSelectProject(p.id)}
                        className={`w-full flex items-center justify-between rounded-lg border ${c.border} ${c.hover} px-3 py-2.5 transition-colors text-left`}
                      >
                        <div>
                          <div className={`text-sm font-medium ${c.text}`}>{p.name}</div>
                          <div className={`text-xs ${c.sub}`}>{STAGES.find(s => s.key === p.stage)?.label ?? p.stage}</div>
                        </div>
                        <ChevronRight className={`h-4 w-4 ${c.sub}`} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ─── 3-Column Workspace ─── */}
        {project && (
          <div className="h-full flex">

            {/* ═══ Left Column: Brief Panel ═══ */}
            <div className={`w-[300px] shrink-0 border-r ${c.border} overflow-y-auto p-4 space-y-3`}>

              {/* Stage 0: Brand Goal Input */}
              {activeStage === 0 && (
                <>
                  <div className={`text-xs font-semibold ${c.gold} uppercase tracking-wide`}>品牌目标</div>
                  <div className={`rounded-lg border ${c.border} p-3 space-y-2`}>
                    <div className="text-xs">
                      <span className={c.sub}>品牌名称</span>
                      <p className={`${c.text} font-medium mt-0.5`}>{project.brief.brandName}</p>
                    </div>
                    <div className="text-xs">
                      <span className={c.sub}>目标</span>
                      <p className={`${c.text} font-medium mt-0.5`}>{project.brief.vision || '—'}</p>
                    </div>
                    <div className="text-xs">
                      <span className={c.sub}>受众</span>
                      <p className={`${c.text} font-medium mt-0.5`}>{project.brief.targetAudience || '—'}</p>
                    </div>
                    <div className="text-xs">
                      <span className={c.sub}>行业</span>
                      <p className={`${c.text} font-medium mt-0.5`}>{project.brief.industry || '—'}</p>
                    </div>
                    {project.brief.coreValues && (
                      <div className="text-xs">
                        <span className={c.sub}>核心价值观</span>
                        <p className={`${c.text} font-medium mt-0.5`}>{project.brief.coreValues}</p>
                      </div>
                    )}
                    {project.brief.brandPersonality && (
                      <div className="text-xs">
                        <span className={c.sub}>品牌个性</span>
                        <p className={`${c.text} font-medium mt-0.5`}>{project.brief.brandPersonality}</p>
                      </div>
                    )}
                  </div>

                  {/* Carriers */}
                  <div>
                    <div className={`text-xs ${c.sub} mb-1.5`}>首发载体</div>
                    <div className="flex flex-wrap gap-1">
                      {selectedCarriers.map(k => {
                        const carrier = CARRIERS.find(c => c.key === k);
                        return carrier ? (
                          <span key={k} className={`px-2 py-0.5 rounded-full text-[10px] ${c.goldChip} border`}>{carrier.label}</span>
                        ) : null;
                      })}
                    </div>
                  </div>

                  {/* Launch strategy */}
                  <button
                    onClick={handleRunStrategy}
                    disabled={strategyStreaming}
                    className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${c.goldBg} ${c.goldBgHover}`}
                  >
                    {strategyStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {strategyStreaming ? 'AI 分析中...' : '启动品牌策略分析'}
                  </button>
                </>
              )}

              {/* Stage 1+: Brief summary */}
              {activeStage >= 1 && (
                <>
                  <div className={`text-xs font-semibold ${c.gold} uppercase tracking-wide`}>项目摘要</div>
                  <div className={`rounded-lg border ${c.border} p-3`}>
                    <div className={`text-sm font-medium ${c.text}`}>{project.brief.brandName}</div>
                    <div className={`text-xs ${c.sub} mt-1`}>{project.brief.industry || '—'}</div>
                  </div>
                  {project.strategy?.positioning && (
                    <div className={`rounded-lg border ${c.border} p-3`}>
                      <div className={`text-[10px] ${c.sub} uppercase tracking-wide mb-1`}>品牌定位</div>
                      <p className={`text-xs ${c.text} leading-relaxed`}>{project.strategy.positioning}</p>
                    </div>
                  )}
                  {project.confirmedDirectionId && (
                    <div className={`rounded-lg border ${c.borderActive} p-3`}>
                      <div className="flex items-center gap-1.5">
                        <Check className={`h-3.5 w-3.5 ${c.gold}`} />
                        <span className={`text-xs font-medium ${c.gold}`}>已确认方向</span>
                      </div>
                      <p className={`text-xs ${c.text} mt-1`}>
                        {project.directions.find(d => d.id === project.confirmedDirectionId)?.name ?? '—'}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Immutable core (stage 2+) */}
              {activeStage >= 2 && project.immutableCore.length > 0 && (
                <div>
                  <div className={`text-xs font-semibold ${c.gold} uppercase tracking-wide flex items-center gap-1.5`}>
                    <Lock className="h-3 w-3" /> 不可变核心
                  </div>
                  <div className="space-y-1.5 mt-1.5">
                    {project.immutableCore.map(item => (
                      <div key={item.id} className={`rounded-lg border ${c.border} p-2`}>
                        <div className={`text-xs font-medium ${c.text}`}>{item.category}</div>
                        <div className={`text-[11px] ${c.sub} mt-0.5`}>{item.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Controlled variables (stage 2+) */}
              {activeStage >= 2 && project.controlledVariables.length > 0 && (
                <div>
                  <div className={`text-xs font-semibold ${c.sub} uppercase tracking-wide`}>可控变量</div>
                  <div className="space-y-1.5 mt-1.5">
                    {project.controlledVariables.map(v => (
                      <div key={v.id} className={`rounded-lg border ${c.border} p-2`}>
                        <div className={`text-xs font-medium ${c.text}`}>{v.category}</div>
                        <div className={`text-[11px] ${c.sub} mt-0.5`}>{v.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ═══ Center Column: Strategy / Direction / Results ═══ */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Stage 0: Strategy streaming */}
              {activeStage === 0 && (
                <div className="space-y-3">
                  <div className={`text-sm font-semibold ${c.text} flex items-center gap-2`}>
                    <Sparkles className={`h-4 w-4 ${c.gold}`} /> 品牌策略分析
                  </div>
                  <p className={`text-xs ${c.sub} leading-relaxed`}>
                    系统将分析品牌角色、可拥有性和可落地性三大关卡，生成3个结构差异明显的角色方向。请在左侧填写品牌目标后点击"启动品牌策略分析"。
                  </p>

                  {/* Brand gates */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { title: '品牌角色', desc: 'IP服务的业务目标', icon: Target },
                      { title: '可拥有性', desc: '名称、结构、素材风险', icon: Shield },
                      { title: '可落地性', desc: '载体、预算、供应链', icon: Package },
                    ].map(gate => {
                      const Icon = gate.icon;
                      return (
                        <div key={gate.title} className={`rounded-lg border ${c.border} p-3`}>
                          <Icon className={`h-4 w-4 ${c.gold} mb-1.5`} />
                          <div className={`text-xs font-medium ${c.text}`}>{gate.title}</div>
                          <div className={`text-[10px] ${c.sub} mt-0.5`}>{gate.desc}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Strategy streaming result */}
                  {strategyStreaming && (
                    <div className={`rounded-lg border ${c.border} p-4`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Loader2 className={`h-4 w-4 animate-spin ${c.gold}`} />
                        <span className={`text-sm font-medium ${c.text}`}>AI 策略分析中</span>
                      </div>
                      <div className={`text-sm ${c.sub2} whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed`}>
                        {strategyStreamText || '等待模型响应...'}
                      </div>
                    </div>
                  )}

                  {strategyError && (
                    <div className={`flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3`}>
                      <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <span className="text-sm text-red-500">{strategyError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Stage 1: Direction selection */}
              {activeStage === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className={`text-sm font-semibold ${c.text} flex items-center gap-2`}>
                      <Crown className={`h-4 w-4 ${c.gold}`} /> 角色方向
                    </h3>
                    <button
                      onClick={handleRunStrategy}
                      disabled={strategyStreaming}
                      className={`flex items-center gap-1 text-xs ${c.gold} ${c.hover} px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40`}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> 重新分析
                    </button>
                  </div>
                  <p className={`text-xs ${c.sub}`}>请选择一个角色方向并确认，确认后系统将锁定不可变核心。</p>

                  {/* Strategy summary */}
                  {project.strategy && (
                    <div className={`rounded-lg border ${c.border} p-3 space-y-2`}>
                      {project.strategy.positioning && (
                        <div>
                          <span className={`text-[10px] ${c.sub} uppercase`}>定位</span>
                          <p className={`text-xs ${c.text}`}>{project.strategy.positioning}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {project.strategy.toneOfVoice && (
                          <div>
                            <span className={`text-[10px] ${c.sub} uppercase`}>语调</span>
                            <p className={`text-xs ${c.text}`}>{project.strategy.toneOfVoice}</p>
                          </div>
                        )}
                        {project.strategy.narrative && (
                          <div>
                            <span className={`text-[10px] ${c.sub} uppercase`}>叙事</span>
                            <p className={`text-xs ${c.text}`}>{project.strategy.narrative}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Direction cards */}
                  <div className="space-y-2.5">
                    {(project.directions.length > 0 ? project.directions : [
                      { id: 'dir-1', name: '方向 A', description: '基于品牌策略自动生成的角色方向', scores: { differentiation: 8, memorability: 7, extensibility: 9, feasibility: 8 } },
                      { id: 'dir-2', name: '方向 B', description: '替代角色方向', scores: { differentiation: 9, memorability: 8, extensibility: 7, feasibility: 7 } },
                      { id: 'dir-3', name: '方向 C', description: '创意方向', scores: { differentiation: 9, memorability: 9, extensibility: 8, feasibility: 6 } },
                    ]).map(dir => {
                      const selected = project.confirmedDirectionId === dir.id;
                      return (
                        <button
                          key={dir.id}
                          onClick={() => handleConfirmDirection(dir.id)}
                          className={`w-full text-left rounded-xl border p-4 transition-all ${
                            selected ? c.borderActive + (dark ? ' bg-[#d4af37]/5' : ' bg-gray-50') : `${c.border} ${c.hover}`
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <span className={`text-sm font-semibold ${c.text}`}>{dir.name}</span>
                              {selected && (
                                <span className={`ml-2 inline-flex items-center gap-0.5 text-[10px] ${c.gold}`}>
                                  <Check className="h-3 w-3" /> 已确认
                                </span>
                              )}
                            </div>
                          </div>
                          <p className={`text-xs ${c.sub2} mb-3`}>{dir.description}</p>
                          <div className="grid grid-cols-4 gap-2">
                            {Object.entries(dir.scores).map(([k, v]) => (
                              <div key={k}>
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className={`text-[10px] ${c.sub}`}>{k}</span>
                                  <span className={`text-[10px] font-medium ${c.gold}`}>{v}</span>
                                </div>
                                <div className={`h-1 rounded-full ${dark ? 'bg-white/10' : 'bg-gray-200'}`}>
                                  <div
                                    className="h-1 rounded-full"
                                    style={{ width: `${v * 10}%`, background: dark ? '#d4af37' : '#374151' }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Stage 2: Visual System */}
              {activeStage === 2 && (
                <div className="space-y-3">
                  <h3 className={`text-sm font-semibold ${c.text} flex items-center gap-2`}>
                    <Palette className={`h-4 w-4 ${c.gold}`} /> 视觉系统
                  </h3>
                  <p className={`text-xs ${c.sub} leading-relaxed`}>
                    已锁定不可变核心。基于品牌策略和已确认方向，生成标准角色图、单色图、小尺寸图和应用验证。
                  </p>

                  {/* Immutable core display */}
                  {project.immutableCore.length > 0 && (
                    <div className={`rounded-lg border ${c.borderActive} p-3`}>
                      <div className={`text-xs font-semibold ${c.gold} flex items-center gap-1.5 mb-2`}>
                        <Lock className="h-3 w-3" /> 锁定的不可变核心
                      </div>
                      <div className="space-y-1">
                        {project.immutableCore.map(item => (
                          <div key={item.id} className="flex items-start gap-2">
                            <div className={`h-1.5 w-1.5 rounded-full ${dark ? 'bg-[#d4af37]' : 'bg-gray-600'} mt-1.5 shrink-0`} />
                            <div>
                              <span className={`text-xs font-medium ${c.text}`}>{item.category}</span>
                              <span className={`text-xs ${c.sub} ml-1.5`}>{item.description}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Controlled variables */}
                  {project.controlledVariables.length > 0 && (
                    <div className={`rounded-lg border ${c.border} p-3`}>
                      <div className={`text-xs font-semibold ${c.sub} uppercase tracking-wide mb-2`}>可控变量（可在规则内变化）</div>
                      <div className="grid grid-cols-2 gap-2">
                        {project.controlledVariables.map(v => (
                          <div key={v.id} className={`rounded-lg ${c.card} border ${c.border} p-2`}>
                            <div className={`text-xs font-medium ${c.text}`}>{v.category}</div>
                            <div className={`text-[11px] ${c.sub} mt-0.5`}>{v.description}</div>
                            {v.guidance && <div className={`text-[10px] ${c.gold} mt-1`}>{v.guidance}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Generation controls */}
                  <div className={`rounded-lg border ${c.border} p-3`}>
                    <div className="flex items-center gap-2 mb-3">
                      <Wand2 className={`h-4 w-4 ${c.gold}`} />
                      <span className={`text-sm font-medium ${c.text}`}>生成品牌资产</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {ASSET_TYPES.map(type => (
                        <button
                          key={type.key}
                          onClick={() => setAssetType(type.key)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                            assetType === type.key ? c.activeChip : `${c.border} ${c.sub2} ${c.hover}`
                          }`}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className={`${c.input} border rounded-lg px-3 py-2 text-sm outline-none w-full resize-none focus:ring-1 ${dark ? 'focus:ring-[#d4af37]/30' : 'focus:ring-gray-300'}`}
                      rows={3}
                      placeholder="描述要生成的品牌资产..."
                      value={assetPrompt}
                      onChange={e => setAssetPrompt(e.target.value)}
                    />
                    <button
                      onClick={handleGenerate}
                      disabled={generating || !assetPrompt.trim()}
                      className={`mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${c.goldBg} ${c.goldBgHover}`}
                    >
                      {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {generating ? '生成中...' : '生成资产'}
                    </button>
                  </div>

                  {genError && (
                    <div className={`flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3`}>
                      <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <span className="text-sm text-red-500">{genError}</span>
                    </div>
                  )}

                  {/* Proceed to application */}
                  {project.assets.length > 0 && (
                    <button
                      onClick={() => setActiveStage(3)}
                      className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border ${c.borderActive} ${c.gold} ${c.hover} transition-colors`}
                    >
                      进入应用延展 <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Stage 3: Application */}
              {activeStage === 3 && (
                <div className="space-y-3">
                  <h3 className={`text-sm font-semibold ${c.text} flex items-center gap-2`}>
                    <Package className={`h-4 w-4 ${c.gold}`} /> 应用延展
                  </h3>
                  <p className={`text-xs ${c.sub} leading-relaxed`}>
                    基于批准的标准角色，生成包装、社交头像、活动主视觉、周边等应用矩阵。
                  </p>

                  {/* Application grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {CARRIERS.map(carrier => {
                      const assets = project.assets.filter(a => a.type === carrier.key);
                      return (
                        <div key={carrier.key} className={`rounded-lg border ${c.border} p-3`}>
                          <div className={`text-xs font-medium ${c.text} mb-1`}>{carrier.label}</div>
                          {assets.length > 0 ? (
                            <div className="text-[10px] text-green-500">{assets.length} 个资产</div>
                          ) : (
                            <div className={`text-[10px] ${c.sub}`}>未生成</div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Quick generate */}
                  <div className={`rounded-lg border ${c.border} p-3`}>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {ASSET_TYPES.map(type => (
                        <button
                          key={type.key}
                          onClick={() => setAssetType(type.key)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                            assetType === type.key ? c.activeChip : `${c.border} ${c.sub2} ${c.hover}`
                          }`}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className={`${c.input} border rounded-lg px-3 py-2 text-sm outline-none w-full resize-none focus:ring-1 ${dark ? 'focus:ring-[#d4af37]/30' : 'focus:ring-gray-300'}`}
                      rows={2}
                      placeholder="描述应用场景..."
                      value={assetPrompt}
                      onChange={e => setAssetPrompt(e.target.value)}
                    />
                    <button
                      onClick={handleGenerate}
                      disabled={generating || !assetPrompt.trim()}
                      className={`mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${c.goldBg} ${c.goldBgHover}`}
                    >
                      {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {generating ? '生成中...' : '生成应用'}
                    </button>
                  </div>

                  {genError && (
                    <div className={`flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3`}>
                      <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <span className="text-sm text-red-500">{genError}</span>
                    </div>
                  )}

                  <button
                    onClick={() => setActiveStage(4)}
                    className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border ${c.borderActive} ${c.gold} ${c.hover} transition-colors`}
                  >
                    进入交付治理 <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Stage 4: Governance */}
              {activeStage === 4 && (
                <div className="space-y-3">
                  <h3 className={`text-sm font-semibold ${c.text} flex items-center gap-2`}>
                    <Shield className={`h-4 w-4 ${c.gold}`} /> 交付治理
                  </h3>
                  <p className={`text-xs ${c.sub} leading-relaxed`}>
                    权利风险登记、版本管理、导出交付包。所有权利风险使用"待核验"表述，不提供法律结论。
                  </p>

                  {/* Risk register */}
                  <div className={`rounded-lg border ${c.border} p-3`}>
                    <div className={`text-xs font-semibold ${c.text} mb-2`}>权利风险登记</div>
                    <div className="space-y-1.5">
                      {[
                        { risk: '角色名称可能与在先商标近似', status: '待核验', owner: '品牌法务' },
                        { risk: 'AI生成素材的版权归属', status: '待核验', owner: '品牌负责人' },
                        { risk: '文化元素使用合规性', status: '待核验', owner: '品牌法务' },
                      ].map((r, i) => (
                        <div key={i} className={`flex items-center justify-between rounded-lg ${c.card} border ${c.border} px-2.5 py-1.5`}>
                          <div>
                            <div className={`text-xs ${c.text}`}>{r.risk}</div>
                            <div className={`text-[10px] ${c.sub}`}>责任人: {r.owner}</div>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] border ${c.goldChip}`}>{r.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Version info */}
                  <div className={`rounded-lg border ${c.border} p-3`}>
                    <div className={`text-xs font-semibold ${c.text} mb-2`}>版本记录</div>
                    <div className="space-y-1">
                      {project.assets.map((asset, i) => (
                        <div key={asset.id} className={`flex items-center justify-between text-xs`}>
                          <span className={c.sub2}>v{(project.assets.length - i).toString().padStart(3, '0')} · {asset.type}</span>
                          <span className={c.sub}>{new Date(asset.createdAt).toLocaleDateString()}</span>
                        </div>
                      ))}
                      {project.assets.length === 0 && (
                        <div className={`text-xs ${c.sub}`}>暂无版本记录</div>
                      )}
                    </div>
                  </div>

                  {/* Export */}
                  <div className="grid grid-cols-2 gap-2">
                    <button className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border ${c.border} ${c.hover} ${c.text} transition-colors`}>
                      <FileDown className="h-4 w-4" /> 导出 Markdown
                    </button>
                    <button className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border ${c.border} ${c.hover} ${c.text} transition-colors`}>
                      <Package className="h-4 w-4" /> 导出 ZIP
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ═══ Right Column: Preview / Assets ═══ */}
            <div className={`w-[340px] shrink-0 border-l ${c.border} overflow-y-auto p-4 space-y-3`}>

              {/* Current direction */}
              {project.confirmedDirectionId && (
                <div className={`rounded-lg border ${c.borderActive} p-3`}>
                  <div className={`text-[10px] ${c.sub} uppercase tracking-wide mb-1`}>当前方向</div>
                  <div className={`text-sm font-semibold ${c.gold}`}>
                    {project.directions.find(d => d.id === project.confirmedDirectionId)?.name ?? '—'}
                  </div>
                  <p className={`text-xs ${c.sub2} mt-1`}>
                    {project.directions.find(d => d.id === project.confirmedDirectionId)?.description ?? ''}
                  </p>
                </div>
              )}

              {/* Asset grid */}
              <div>
                <div className={`text-xs font-semibold ${c.gold} uppercase tracking-wide mb-2 flex items-center gap-1.5`}>
                  <ImageIcon className="h-3.5 w-3.5" /> 资产预览
                </div>
                {project.assets.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {project.assets.map(asset => (
                      <div key={asset.id} className={`rounded-lg border ${c.border} overflow-hidden group`}>
                        {asset.status === 'completed' && asset.imageUrl ? (
                          <div className="relative">
                            <img src={asset.imageUrl} alt={asset.type} className="w-full aspect-square object-cover" />
                            <button
                              onClick={() => handleAddToCanvas(asset.imageUrl)}
                              className={`absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${dark ? 'bg-black/60' : 'bg-white/60'}`}
                            >
                              <span className={`text-xs font-medium ${c.gold}`}>添加到画布</span>
                            </button>
                          </div>
                        ) : (
                          <div className="w-full aspect-square flex items-center justify-center">
                            {asset.status === 'pending' ? (
                              <Loader2 className={`h-6 w-6 animate-spin ${c.sub}`} />
                            ) : (
                              <AlertCircle className="h-6 w-6 text-red-500" />
                            )}
                          </div>
                        )}
                        <div className="p-1.5">
                          <div className={`text-[10px] font-medium ${c.text}`}>{asset.type}</div>
                          {asset.status === 'completed' && (
                            <button
                              onClick={() => handleAddToCanvas(asset.imageUrl)}
                              className={`text-[10px] ${c.gold} ${c.hover} mt-0.5`}
                            >
                              + 画布
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-lg border ${c.border} border-dashed p-8 text-center`}>
                    <ImageIcon className={`h-8 w-8 ${c.sub} mx-auto mb-2`} />
                    <p className={`text-xs ${c.sub}`}>暂无资产</p>
                    <p className={`text-[10px] ${c.sub} mt-1`}>在视觉系统阶段生成</p>
                  </div>
                )}
              </div>

              {/* Validation checklist */}
              {activeStage >= 2 && (
                <div>
                  <div className={`text-xs font-semibold ${c.sub} uppercase tracking-wide mb-2`}>质量检查</div>
                  <div className="space-y-1">
                    {[
                      { label: '三秒识别', checked: project.assets.length > 0 },
                      { label: '去装饰仍可识别', checked: false },
                      { label: '单色结构成立', checked: false },
                      { label: '32px小尺寸可识别', checked: false },
                      { label: '多视角结构一致', checked: false },
                    ].map(item => (
                      <div key={item.label} className="flex items-center gap-2">
                        <div className={`h-4 w-4 rounded border flex items-center justify-center ${
                          item.checked
                            ? (dark ? 'bg-[#d4af37] border-[#d4af37]' : 'bg-gray-800 border-gray-800')
                            : c.border
                        }`}>
                          {item.checked && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <span className={`text-xs ${item.checked ? c.text : c.sub}`}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══ Advanced Settings Drawer ═══ */}
      {showAdvanced && project && (
        <div className={`absolute right-0 top-0 bottom-0 w-80 ${c.panel} border-l ${c.border} z-10 p-4 space-y-3 overflow-y-auto`} data-no-drag>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-sm font-semibold ${c.text} flex items-center gap-2`}>
              <Settings className={`h-4 w-4 ${c.gold}`} /> 高级设置
            </span>
            <button onClick={() => setShowAdvanced(false)} className={`p-1 rounded-lg ${c.hover} ${c.sub}`}>
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className={`text-xs ${c.sub} block mb-1`}>IP主角色定位</label>
              <select className={`${c.input} border rounded-lg px-3 py-2 text-sm w-full outline-none`}>
                <option>长期代言人</option>
                <option>活动使者</option>
                <option>系列主角</option>
                <option>辅助角色</option>
              </select>
            </div>
            <div>
              <label className={`text-xs ${c.sub} block mb-1`}>角色数量</label>
              <select className={`${c.input} border rounded-lg px-3 py-2 text-sm w-full outline-none`}>
                <option>1 个</option>
                <option>2 个</option>
                <option>3 个</option>
              </select>
            </div>
            <div>
              <label className={`text-xs ${c.sub} block mb-1`}>视觉气质</label>
              <select className={`${c.input} border rounded-lg px-3 py-2 text-sm w-full outline-none`}>
                <option>温暖亲和</option>
                <option>科技前卫</option>
                <option>潮酷年轻</option>
                <option>传统典雅</option>
              </select>
            </div>
            <div>
              <label className={`text-xs ${c.sub} block mb-1`}>生产限制</label>
              <textarea
                className={`${c.input} border rounded-lg px-3 py-2 text-sm w-full outline-none resize-none`}
                rows={2}
                placeholder="如：需支持PVC公仔生产"
              />
            </div>
            <div>
              <label className={`text-xs ${c.sub} block mb-1`}>禁止项</label>
              <textarea
                className={`${c.input} border rounded-lg px-3 py-2 text-sm w-full outline-none resize-none`}
                rows={2}
                placeholder="如：不得模仿具体艺术家"
              />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className={`text-xs ${c.text}`}>自动生成权利风险表</span>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className={`text-xs ${c.text}`}>同步生成应用矩阵</span>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className={`text-xs ${c.text}`}>优先结构识别</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
