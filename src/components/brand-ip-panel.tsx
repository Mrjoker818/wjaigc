'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, X, ChevronRight, Loader2, AlertCircle, Check, Plus, Crown, Target, Eye, Palette, Download, RefreshCw, Wand2 } from 'lucide-react';

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

// ─── Helper ──────────────────────────────────────────────────────────────────

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

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

// ─── Stage Badge ─────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'brand-goal', label: '品牌目标', icon: Target },
  { key: 'strategy', label: '品牌策略', icon: Sparkles },
  { key: 'role-direction', label: '角色方向', icon: Crown },
  { key: 'visual-system', label: '视觉系统', icon: Palette },
  { key: 'asset-generation', label: '资产生成', icon: Download },
];

function stageIndex(stage: string): number {
  return Math.max(0, STAGES.findIndex(s => s.key === stage));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BrandIpPanel({ isMonochrome, onClose, onAddImages }: BrandIpPanelProps) {
  const [project, setProject] = useState<BrandIpProject | null>(null);
  const [projects, setProjects] = useState<BrandIpProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [briefDraft, setBriefDraft] = useState<BrandIpBrief>({
    brandName: '', industry: '', targetAudience: '', coreValues: '', brandPersonality: '', vision: '', marketContext: '',
  });

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
  const [pos, setPos] = useState({ x: 60, y: 40 });
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
          // result event carries structured strategy
          const s = data as BrandIpStrategy;
          if (s?.immutableCore) {
            setProject(prev => prev ? {
              ...prev,
              strategy: s,
              immutableCore: s.immutableCore,
              controlledVariables: s.controlledVariables,
              stage: 'role-direction',
            } : prev);
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
        // Start polling for task completion
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
          // Reload assets
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

  // ── Theme classes ──────────────────────────────────────────────────────
  const t = isMonochrome ? {
    bg: 'bg-white', border: 'border-gray-200', text: 'text-gray-800', subText: 'text-gray-500',
    input: 'bg-gray-50 border-gray-200 text-gray-800', accent: 'text-gray-700', accentBg: 'bg-gray-700',
    hover: 'hover:bg-gray-100', card: 'bg-gray-50 border-gray-200', chip: 'bg-gray-100 text-gray-600',
  } : {
    bg: 'bg-[#1a1a1a]', border: 'border-[#d4af37]/30', text: 'text-white', subText: 'text-white/50',
    input: 'bg-[#0a0a0a] border-[#d4af37]/20 text-white', accent: 'text-[#d4af37]', accentBg: 'bg-[#d4af37] text-black',
    hover: 'hover:bg-white/5', card: 'bg-[#0f0f0f] border-[#d4af37]/15', chip: 'bg-[#d4af37]/10 text-[#d4af37]',
  };

  const currentStage = project?.stage ?? 'brand-goal';
  const sIdx = stageIndex(currentStage);

  return (
    <div
      ref={panelRef}
      data-floating-panel="brand-ip"
      className={`fixed z-[201] ${t.bg} ${t.border} border rounded-2xl shadow-2xl flex flex-col`}
      style={{ left: pos.x, top: pos.y, width: '880px', maxHeight: '88vh', minHeight: '400px' }}
      onMouseDown={handleDragStart}
    >
      {/* ── Header ── */}
      <div className={`flex items-center justify-between px-5 py-3 border-b ${t.border} cursor-move`}>
        <div className="flex items-center gap-2">
          <Sparkles className={`h-5 w-5 ${t.accent}`} />
          <span className={`font-bold text-base ${t.text}`}>品牌 IP 设计工场</span>
          {project && (
            <span className={`text-xs ${t.subText} ml-2`}>/ {project.name}</span>
          )}
        </div>
        <button onClick={onClose} className={`p-1 rounded-lg ${t.hover} ${t.subText} transition-colors`} data-no-drag>
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Stage indicator ── */}
      {project && (
        <div className={`flex items-center gap-1 px-5 py-2 border-b ${t.border} overflow-x-auto`}>
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            const active = i === sIdx;
            const done = i < sIdx;
            return (
              <div key={s.key} className="flex items-center shrink-0">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  active ? (isMonochrome ? 'bg-gray-800 text-white' : 'bg-[#d4af37] text-black')
                  : done ? (isMonochrome ? 'text-gray-600' : 'text-[#d4af37]/70')
                  : t.subText
                }`}>
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                </div>
                {i < STAGES.length - 1 && <ChevronRight className={`h-3 w-3 ${t.subText} mx-0.5`} />}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4" data-no-drag>

        {/* ═══ No project: project list + create ═══ */}
        {!project && (
          <div className="space-y-4">
            {/* Create new */}
            <div className={`rounded-xl border ${t.border} p-4`}>
              <h3 className={`text-sm font-semibold ${t.text} mb-3 flex items-center gap-2`}>
                <Plus className="h-4 w-4" /> 新建品牌 IP 项目
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={`${t.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#d4af37]/40`}
                  placeholder="品牌名称 *"
                  value={briefDraft.brandName}
                  onChange={e => setBriefDraft(d => ({ ...d, brandName: e.target.value }))}
                />
                <input
                  className={`${t.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#d4af37]/40`}
                  placeholder="所属行业"
                  value={briefDraft.industry}
                  onChange={e => setBriefDraft(d => ({ ...d, industry: e.target.value }))}
                />
                <input
                  className={`${t.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#d4af37]/40`}
                  placeholder="目标受众"
                  value={briefDraft.targetAudience}
                  onChange={e => setBriefDraft(d => ({ ...d, targetAudience: e.target.value }))}
                />
                <input
                  className={`${t.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#d4af37]/40`}
                  placeholder="核心价值观"
                  value={briefDraft.coreValues}
                  onChange={e => setBriefDraft(d => ({ ...d, coreValues: e.target.value }))}
                />
                <input
                  className={`${t.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#d4af37]/40`}
                  placeholder="品牌个性"
                  value={briefDraft.brandPersonality}
                  onChange={e => setBriefDraft(d => ({ ...d, brandPersonality: e.target.value }))}
                />
                <input
                  className={`${t.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#d4af37]/40`}
                  placeholder="品牌愿景"
                  value={briefDraft.vision}
                  onChange={e => setBriefDraft(d => ({ ...d, vision: e.target.value }))}
                />
              </div>
              <textarea
                className={`${t.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#d4af37]/40 w-full mt-3 resize-none`}
                rows={2}
                placeholder="市场背景与竞争环境"
                value={briefDraft.marketContext}
                onChange={e => setBriefDraft(d => ({ ...d, marketContext: e.target.value }))}
              />
              <button
                onClick={handleCreateProject}
                disabled={!briefDraft.brandName.trim()}
                className={`mt-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${isMonochrome ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-[#d4af37] text-black hover:bg-[#e0b850]'}`}
              >
                创建项目
              </button>
            </div>

            {/* Existing projects */}
            {loadingProjects ? (
              <div className={`flex items-center justify-center py-8 ${t.subText}`}>
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : projects.length > 0 ? (
              <div>
                <h3 className={`text-sm font-semibold ${t.text} mb-2`}>已有项目</h3>
                <div className="space-y-2">
                  {projects.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectProject(p.id)}
                      className={`w-full flex items-center justify-between rounded-lg border ${t.border} ${t.hover} px-3 py-2.5 transition-colors text-left`}
                    >
                      <div>
                        <div className={`text-sm font-medium ${t.text}`}>{p.name}</div>
                        <div className={`text-xs ${t.subText}`}>{STAGES.find(s => s.key === p.stage)?.label ?? p.stage}</div>
                      </div>
                      <ChevronRight className={`h-4 w-4 ${t.subText}`} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* ═══ Brand goal stage: show brief + strategy button ═══ */}
        {project && sIdx === 0 && (
          <div className="space-y-4">
            <div className={`rounded-xl border ${t.border} p-4`}>
              <h3 className={`text-sm font-semibold ${t.text} mb-3 flex items-center gap-2`}>
                <Target className="h-4 w-4" /> 品牌目标摘要
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className={t.subText}>品牌名称:</span> <span className={t.text}>{project.brief.brandName}</span></div>
                <div><span className={t.subText}>行业:</span> <span className={t.text}>{project.brief.industry}</span></div>
                <div><span className={t.subText}>受众:</span> <span className={t.text}>{project.brief.targetAudience}</span></div>
                <div><span className={t.subText}>核心价值观:</span> <span className={t.text}>{project.brief.coreValues}</span></div>
                <div><span className={t.subText}>个性:</span> <span className={t.text}>{project.brief.brandPersonality}</span></div>
                <div><span className={t.subText}>愿景:</span> <span className={t.text}>{project.brief.vision}</span></div>
              </div>
              {project.brief.marketContext && (
                <p className={`text-sm ${t.subText} mt-2`}>{project.brief.marketContext}</p>
              )}
            </div>
            <button
              onClick={handleRunStrategy}
              disabled={strategyStreaming}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${isMonochrome ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-[#d4af37] text-black hover:bg-[#e0b850]'}`}
            >
              {strategyStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {strategyStreaming ? '分析中...' : '启动品牌策略分析'}
            </button>
          </div>
        )}

        {/* ═══ Strategy streaming ═══ */}
        {strategyStreaming && (
          <div className={`mt-4 rounded-xl border ${t.border} p-4`}>
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className={`h-4 w-4 animate-spin ${t.accent}`} />
              <span className={`text-sm font-medium ${t.text}`}>AI 策略分析中</span>
            </div>
            <div className={`text-sm ${t.subText} whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed`}>
              {strategyStreamText || '等待模型响应...'}
            </div>
          </div>
        )}

        {strategyError && (
          <div className={`mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3`}>
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <span className="text-sm text-red-500">{strategyError}</span>
          </div>
        )}

        {/* ═══ Strategy result ═══ */}
        {project?.strategy && sIdx >= 1 && (
          <div className="space-y-4">
            {/* Positioning */}
            {project.strategy.positioning && (
              <div className={`rounded-xl border ${t.border} p-4`}>
                <h4 className={`text-xs font-semibold ${t.subText} uppercase tracking-wide mb-1`}>品牌定位</h4>
                <p className={`text-sm ${t.text}`}>{project.strategy.positioning}</p>
              </div>
            )}

            {/* Immutable core */}
            {project.immutableCore.length > 0 && (
              <div className={`rounded-xl border ${t.border} p-4`}>
                <h4 className={`text-xs font-semibold ${t.subText} uppercase tracking-wide mb-2`}>不可变核心</h4>
                <div className="space-y-1.5">
                  {project.immutableCore.map(c => (
                    <div key={c.id} className="flex items-start gap-2">
                      <div className={`h-1.5 w-1.5 rounded-full ${isMonochrome ? 'bg-gray-600' : 'bg-[#d4af37]'} mt-1.5 shrink-0`} />
                      <div>
                        <span className={`text-sm font-medium ${t.text}`}>{c.category}</span>
                        <span className={`text-sm ${t.subText} ml-2`}>{c.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Controlled variables */}
            {project.controlledVariables.length > 0 && (
              <div className={`rounded-xl border ${t.border} p-4`}>
                <h4 className={`text-xs font-semibold ${t.subText} uppercase tracking-wide mb-2`}>可控变量</h4>
                <div className="grid grid-cols-2 gap-2">
                  {project.controlledVariables.map(v => (
                    <div key={v.id} className={`rounded-lg ${t.card} border p-2.5`}>
                      <div className={`text-sm font-medium ${t.text}`}>{v.category}</div>
                      <div className={`text-xs ${t.subText} mt-0.5`}>{v.description}</div>
                      {v.guidance && <div className={`text-xs ${t.accent} mt-1`}>{v.guidance}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tone & narrative */}
            <div className="grid grid-cols-2 gap-3">
              {project.strategy.toneOfVoice && (
                <div className={`rounded-xl border ${t.border} p-3`}>
                  <h4 className={`text-xs font-semibold ${t.subText} uppercase tracking-wide mb-1`}>语调风格</h4>
                  <p className={`text-sm ${t.text}`}>{project.strategy.toneOfVoice}</p>
                </div>
              )}
              {project.strategy.narrative && (
                <div className={`rounded-xl border ${t.border} p-3`}>
                  <h4 className={`text-xs font-semibold ${t.subText} uppercase tracking-wide mb-1`}>叙事框架</h4>
                  <p className={`text-sm ${t.text}`}>{project.strategy.narrative}</p>
                </div>
              )}
            </div>

            {/* Re-run strategy */}
            <button
              onClick={handleRunStrategy}
              disabled={strategyStreaming}
              className={`flex items-center gap-2 text-xs ${t.accent} ${t.hover} px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40`}
            >
              <RefreshCw className="h-3.5 w-3.5" /> 重新分析策略
            </button>
          </div>
        )}

        {/* ═══ Role direction stage ═══ */}
        {project && sIdx === 2 && (
          <div className="space-y-3">
            <h3 className={`text-sm font-semibold ${t.text} flex items-center gap-2`}>
              <Crown className="h-4 w-4" /> 角色方向（请选择并确认一个）
            </h3>
            <div className="space-y-2">
              {(project.directions.length > 0 ? project.directions : [
                { id: 'dir-1', name: '方向 A', description: '基于品牌策略自动生成的角色方向', scores: { differentiation: 8, memorability: 7, extensibility: 9, feasibility: 8 } },
                { id: 'dir-2', name: '方向 B', description: '替代角色方向', scores: { differentiation: 9, memorability: 8, extensibility: 7, feasibility: 7 } },
              ]).map(dir => (
                <button
                  key={dir.id}
                  onClick={() => handleConfirmDirection(dir.id)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    project.confirmedDirectionId === dir.id
                      ? (isMonochrome ? 'border-gray-800 bg-gray-50' : 'border-[#d4af37] bg-[#d4af37]/5')
                      : `${t.border} ${t.hover}`
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${t.text}`}>{dir.name}</span>
                    {project.confirmedDirectionId === dir.id && <Check className={`h-4 w-4 ${t.accent}`} />}
                  </div>
                  <p className={`text-xs ${t.subText} mt-1`}>{dir.description}</p>
                  <div className="flex gap-3 mt-2">
                    {Object.entries(dir.scores).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-1">
                        <span className={`text-xs ${t.subText}`}>{k}</span>
                        <span className={`text-xs font-medium ${t.accent}`}>{v}/10</span>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Visual system stage ═══ */}
        {project && sIdx === 3 && (
          <div className="space-y-3">
            <h3 className={`text-sm font-semibold ${t.text} flex items-center gap-2`}>
              <Palette className="h-4 w-4" /> 视觉系统
            </h3>
            <div className={`rounded-xl border ${t.border} p-4`}>
              <p className={`text-sm ${t.subText}`}>
                已确认方向: <span className={t.text}>{project.directions.find(d => d.id === project.confirmedDirectionId)?.name ?? '未选择'}</span>
              </p>
              <p className={`text-xs ${t.subText} mt-2`}>
                视觉系统基于品牌策略和已确认的角色方向，包含色彩规范、字体规范、图形语言和构图原则。点击下方"生成品牌资产"开始创建视觉资产。
              </p>
            </div>
          </div>
        )}

        {/* ═══ Asset generation stage ═══ */}
        {project && sIdx >= 3 && (
          <div className="space-y-4">
            <div className={`rounded-xl border ${t.border} p-4`}>
              <h3 className={`text-sm font-semibold ${t.text} flex items-center gap-2 mb-3`}>
                <Download className="h-4 w-4" /> 资产生成
              </h3>
              {!project.confirmedDirectionId && (
                <div className={`flex items-center gap-2 text-xs ${t.subText} mb-3`}>
                  <AlertCircle className="h-3.5 w-3.5" /> 需先确认角色方向才能生成资产
                </div>
              )}
              <div className="flex gap-2 mb-3">
                {['logo', 'mascot', 'poster', 'packaging', 'social'].map(type => (
                  <button
                    key={type}
                    onClick={() => setAssetType(type)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      assetType === type
                        ? (isMonochrome ? 'bg-gray-800 text-white' : 'bg-[#d4af37] text-black')
                        : `${t.chip} ${t.hover}`
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <textarea
                className={`${t.input} border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#d4af37]/40 w-full resize-none`}
                rows={3}
                placeholder="描述要生成的品牌资产..."
                value={assetPrompt}
                onChange={e => setAssetPrompt(e.target.value)}
              />
              <button
                onClick={handleGenerate}
                disabled={generating || !assetPrompt.trim() || !project.confirmedDirectionId}
                className={`mt-2 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${isMonochrome ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-[#d4af37] text-black hover:bg-[#e0b850]'}`}
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {generating ? '生成中...' : '生成资产'}
              </button>
            </div>

            {genError && (
              <div className={`flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3`}>
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <span className="text-sm text-red-500">{genError}</span>
              </div>
            )}

            {/* Asset grid */}
            {project.assets.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {project.assets.map(asset => (
                  <div key={asset.id} className={`rounded-xl border ${t.border} overflow-hidden`}>
                    {asset.status === 'completed' && asset.imageUrl ? (
                      <img src={asset.imageUrl} alt={asset.type} className="w-full aspect-square object-cover" />
                    ) : (
                      <div className="w-full aspect-square flex items-center justify-center">
                        {asset.status === 'pending' ? (
                          <Loader2 className={`h-6 w-6 animate-spin ${t.subText}`} />
                        ) : (
                          <AlertCircle className="h-6 w-6 text-red-500" />
                        )}
                      </div>
                    )}
                    <div className="p-2">
                      <div className={`text-xs font-medium ${t.text}`}>{asset.type}</div>
                      {asset.status === 'completed' && asset.imageUrl && (
                        <button
                          onClick={() => handleAddToCanvas(asset.imageUrl)}
                          className={`text-xs ${t.accent} ${t.hover} mt-1`}
                        >
                          添加到画布
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
