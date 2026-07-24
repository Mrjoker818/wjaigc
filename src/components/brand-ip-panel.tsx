'use client';

import { useState, useRef, useCallback, useEffect, type PointerEvent } from 'react';
import { X, Settings, Sparkles, Square, GripVertical } from 'lucide-react';

/* ================================================================
   品牌 IP 设计工场 — 参考原型还原的黑金三栏工作台
   ================================================================ */

interface BrandIpPanelProps {
  onClose: () => void;
  onAddImages?: (urls: string[], meta?: Record<string, unknown>) => void;
}

/* ── Types ──────────────────────────────────────────────────────── */
type BrandIpStage = 'brand-goal' | 'strategy' | 'role-direction' | 'visual-system' | 'asset-generation';

interface BrandIpBrief {
  brandName?: string;
  objective?: string;
  audience?: string;
  industry?: string;
  workflowPath?: number;
  carriers?: number[];
  smartMode?: boolean;
}

interface BrandIpDirection {
  id: string;
  name: string;
  concept: string;
  scores: { brandRole: number; ownability: number; feasibility: number };
  status: 'draft' | 'confirmed' | 'archived';
}

interface BrandIpImmutableCore { id: string; label: string; value: string; }
interface BrandIpControlledVariable { id: string; label: string; value: string; risk?: 'low' | 'medium' | 'high'; }

interface BrandIpProject {
  id: string;
  name: string;
  currentStage: BrandIpStage;
  brief: BrandIpBrief;
  directions: BrandIpDirection[];
  confirmedDirectionId?: string | null;
  immutableCore: BrandIpImmutableCore[];
  controlledVariables: BrandIpControlledVariable[];
}
interface BrandIpAsset {
  id: string;
  imageUrl: string;
  prompt: string;
  model: string;
  assetType: string;
  version: number;
  createdAt: string;
}
interface DisplayDirection {
  id: string;
  name: string;
  tone: 'warm' | 'blue' | 'violet';
  tag: string;
  score: number;
  description: string;
  traits: string[];
}

/* ── Constants ──────────────────────────────────────────────────── */
const STAGES = [
  { num: '01', name: '品牌目标', title: 'IP策略一页纸', desc: '先锁定IP在品牌中的任务，再进入造型设计。', items: ['品牌角色与第一用途', '受众任务与使用场景', '竞争区隔与首发范围', '成功指标与设计边界'] },
  { num: '02', name: '角色方向', title: '角色系统', desc: '让角色脱去服饰与装饰后，仍然能够被识别。', items: ['角色命题与原型母体', '人格与功能动词', '轮廓、比例、体块与重心', '情绪、动作与角色关系'] },
  { num: '03', name: '视觉系统', title: '视觉规范', desc: '把单张好看的角色图变成可持续使用的视觉资产。', items: ['标准版 / 单色版 / 小尺寸版', '色彩、材质与线条系统', '三视图、表情与动作', 'AI生成提示词与禁止项'] },
  { num: '04', name: '应用延展', title: '商业应用矩阵', desc: '针对真实载体设置尺寸、裁切、工艺与验收规则。', items: ['头像与社媒内容', '包装与活动主视觉', '周边公仔与数字内容', '空间装置与渠道适配'] },
  { num: '05', name: '交付治理', title: '治理与交付', desc: '明确哪些不能改、哪些可以变，以及如何交接和验收。', items: ['不可变核心与受控变量', '权利风险与待核验项', '版本、审批与授权边界', '生产包、上线KPI与复盘'] },
];

const PATHS = [
  { icon: '✦', label: '从零创建' },
  { icon: '↗', label: '已有形象升级' },
  { icon: '◉', label: '系列角色' },
  { icon: '◇', label: '周边 / 包装' },
  { icon: '∞', label: '联名 / 授权' },
];

const CARRIERS = [
  { icon: '◉', label: '社媒头像' },
  { icon: '☺', label: '表情包' },
  { icon: '▣', label: '产品包装' },
  { icon: '✦', label: '活动KV' },
  { icon: '◐', label: '周边公仔' },
  { icon: '◌', label: '空间装置' },
];

const VIEW_TABS = ['标准', '单色', '小尺寸'];

const STAGE_INDEX: Record<BrandIpStage, number> = {
  'brand-goal': 0,
  strategy: 0,
  'role-direction': 1,
  'visual-system': 2,
  'asset-generation': 3,
};

function toDisplayDirection(direction: BrandIpDirection, index: number): DisplayDirection {
  const score = Math.round((direction.scores.brandRole + direction.scores.ownability + direction.scores.feasibility) / 3);
  return {
    id: direction.id,
    name: direction.name,
    tone: index % 3 === 0 ? 'warm' : index % 3 === 1 ? 'blue' : 'violet',
    tag: index === 0 ? '推荐方向' : index === 1 ? '区隔方向' : '商业方向',
    score,
    description: direction.concept,
    traits: [`品牌角色 ${direction.scores.brandRole}`, `可拥有性 ${direction.scores.ownability}`, `可落地性 ${direction.scores.feasibility}`],
  };
}

/* ── Component ──────────────────────────────────────────────────── */
export default function BrandIpPanel({ onClose, onAddImages }: BrandIpPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stage & project state
  const [activeStage, setActiveStage] = useState(0);
  const [project, setProject] = useState<BrandIpProject | null>(null);
  const [projects, setProjects] = useState<BrandIpProject[]>([]);
  const [showProjectList, setShowProjectList] = useState(false);

  // Brief form
  const [workflowPath, setWorkflowPath] = useState(0);
  const [brandName, setBrandName] = useState('');
  const [goal, setGoal] = useState('');
  const [audience, setAudience] = useState('');
  const [industry, setIndustry] = useState('');
  const [selectedCarriers, setSelectedCarriers] = useState<number[]>([0, 2]);
  const [smartMode, setSmartMode] = useState(true);

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [strategyText, setStrategyText] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  // Direction state
  const [directions, setDirections] = useState<BrandIpDirection[]>([]);
  const [selectedDirection, setSelectedDirection] = useState<string | null>(null);
  const [confirmedDirection, setConfirmedDirection] = useState(false);

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [viewTab, setViewTab] = useState(0);
  const [toast, setToast] = useState<{ show: boolean; msg: string }>({ show: false, msg: '' });

  // Advanced settings
  const [advRole, setAdvRole] = useState('长期代言人');
  const [advCount, setAdvCount] = useState('1');
  const [advVibe, setAdvVibe] = useState('温暖亲和');
  const [advConstraints, setAdvConstraints] = useState('后期需支持PVC公仔生产');
  const [advForbidden, setAdvForbidden] = useState('不得模仿具体艺术家');
  const [advAutoRisk, setAdvAutoRisk] = useState(true);
  const [advAutoApp, setAdvAutoApp] = useState(true);
  const [advStructFirst, setAdvStructFirst] = useState(false);

  // Assets state
  const [assets, setAssets] = useState<BrandIpAsset[]>([]);
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const [assetProgress, setAssetProgress] = useState(0);
  const [assetLabel, setAssetLabel] = useState('');
  const [assetTaskId, setAssetTaskId] = useState<string | null>(null);

  // Floating-window state
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const hasInitializedWindowPositionRef = useRef(false);
  const [windowPosition, setWindowPosition] = useState({ x: 0, y: 0 });

  /* ── Toast helper ──────────────────────────────────────────────── */
  const showToast = useCallback((msg: string) => {
    setToast({ show: true, msg });
    setTimeout(() => setToast({ show: false, msg: '' }), 2500);
  }, []);

  const loadAssets = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/brand-ip/assets?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) throw new Error('assets_load_failed');
    const data = await res.json() as { assets?: BrandIpAsset[] };
    setAssets(data.assets ?? []);
  }, []);

  const applyProject = useCallback(async (nextProject: BrandIpProject, shouldLoadAssets = true) => {
    setProject(nextProject);
    setBrandName(nextProject.brief.brandName ?? nextProject.name);
    setGoal(nextProject.brief.objective ?? '');
    setAudience(nextProject.brief.audience ?? '');
    setIndustry(nextProject.brief.industry ?? '');
    setWorkflowPath(nextProject.brief.workflowPath ?? 0);
    setSelectedCarriers(nextProject.brief.carriers ?? [0, 2]);
    setSmartMode(nextProject.brief.smartMode ?? true);
    setDirections(nextProject.directions ?? []);
    setSelectedDirection(nextProject.confirmedDirectionId ?? nextProject.directions?.[0]?.id ?? null);
    setConfirmedDirection(Boolean(nextProject.confirmedDirectionId));
    setActiveStage(STAGE_INDEX[nextProject.currentStage] ?? 0);
    setHasAnalyzed((nextProject.directions?.length ?? 0) > 0);
    if (shouldLoadAssets) {
      try {
        await loadAssets(nextProject.id);
      } catch {
        setAssets([]);
      }
    }
  }, [loadAssets]);

  const loadProject = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/brand-ip/projects?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) throw new Error('project_load_failed');
    const data = await res.json() as { project?: BrandIpProject };
    if (!data.project) throw new Error('project_missing');
    await applyProject(data.project);
  }, [applyProject]);

  const handleWindowPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth < 768) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, label, a, svg, [data-no-drag]')) return;
    const shell = shellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleWindowPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const shell = shellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const maxX = Math.max(16, window.innerWidth - rect.width - 16);
    const maxY = Math.max(16, window.innerHeight - rect.height - 16);
    setWindowPosition({
      x: Math.min(Math.max(16, event.clientX - dragRef.current.offsetX), maxX),
      y: Math.min(Math.max(16, event.clientY - dragRef.current.offsetY), maxY),
    });
  }, []);

  const handleWindowPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  /* ── Load projects on mount ────────────────────────────────────── */
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/brand-ip/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (window.innerWidth < 768 || hasInitializedWindowPositionRef.current) return;

    const frameId = window.requestAnimationFrame(() => {
      const shell = shellRef.current;
      if (!shell || hasInitializedWindowPositionRef.current) return;

      const rect = shell.getBoundingClientRect();
      const maxX = Math.max(16, window.innerWidth - rect.width - 16);
      const maxY = Math.max(16, window.innerHeight - rect.height - 16);
      setWindowPosition({
        x: Math.min(Math.max(16, (window.innerWidth - rect.width) / 2), maxX),
        y: Math.min(Math.max(16, (window.innerHeight - rect.height) / 2), maxY),
      });
      hasInitializedWindowPositionRef.current = true;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const keepWindowVisible = (): void => {
      if (window.innerWidth < 768) return;
      const shell = shellRef.current;
      if (!shell || !hasInitializedWindowPositionRef.current) return;

      const rect = shell.getBoundingClientRect();
      const maxX = Math.max(16, window.innerWidth - rect.width - 16);
      const maxY = Math.max(16, window.innerHeight - rect.height - 16);
      setWindowPosition(previous => ({
        x: Math.min(Math.max(16, previous.x), maxX),
        y: Math.min(Math.max(16, previous.y), maxY),
      }));
    };

    window.addEventListener('resize', keepWindowVisible);
    return () => window.removeEventListener('resize', keepWindowVisible);
  }, []);

  /* ── Create project & run strategy analysis ───────────────────── */
  const handleGenerate = useCallback(async () => {
    if (!brandName.trim()) {
      showToast('请输入品牌/项目名称');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setStrategyText('');
    setHasAnalyzed(false);

    try {
      // Create project if none
      let proj = project;
      if (!proj) {
        const createRes = await fetch('/api/brand-ip/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: brandName,
            brief: {
              brandName,
              objective: goal,
              audience,
              industry,
              workflowPath,
              carriers: selectedCarriers,
              smartMode,
            },
          }),
        });
        if (!createRes.ok) {
          showToast('项目创建失败');
          setIsAnalyzing(false);
          return;
        }
        const createData = await createRes.json();
        proj = createData.project as BrandIpProject;
        await applyProject(proj, false);
        setProjects(prev => [proj!, ...prev]);
      }

      // SSE strategy analysis
      const sseRes = await fetch('/api/brand-ip/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: proj!.id,
          brief: { brandName, goal, audience, industry, workflowPath, carriers: selectedCarriers, smartMode },
        }),
      });

      if (!sseRes.ok || !sseRes.body) {
        showToast('策略分析请求失败');
        setIsAnalyzing(false);
        return;
      }

      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let progress = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'status') {
                progress = 10;
                setAnalysisProgress(progress);
              } else if (evt.type === 'delta') {
                setStrategyText(prev => prev + (evt.content ?? ''));
                progress = Math.min(85, progress + 2);
                setAnalysisProgress(progress);
              } else if (evt.type === 'result') {
                const result = evt.result as {
                  summary?: string;
                  directions?: BrandIpDirection[];
                  immutableCore?: BrandIpImmutableCore[];
                  controlledVariables?: BrandIpControlledVariable[];
                } | undefined;
                if (result) {
                  const nextBrief: BrandIpBrief = {
                    brandName,
                    objective: goal,
                    audience,
                    industry,
                    workflowPath,
                    carriers: selectedCarriers,
                    smartMode,
                  };
                  setStrategyText(result.summary ?? '');
                  setDirections(result.directions ?? []);
                  setSelectedDirection(result.directions?.[0]?.id ?? null);
                  setProject(prev => prev ? {
                    ...prev,
                    brief: nextBrief,
                    directions: result.directions ?? [],
                    immutableCore: result.immutableCore ?? [],
                    controlledVariables: result.controlledVariables ?? [],
                    currentStage: 'role-direction',
                  } : prev);
                  const saveRes = await fetch('/api/brand-ip/projects', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      projectId: proj!.id,
                      brief: nextBrief,
                      directions: result.directions ?? [],
                      immutableCore: result.immutableCore ?? [],
                      controlledVariables: result.controlledVariables ?? [],
                    }),
                  });
                  if (saveRes.ok) {
                    const saved = await saveRes.json() as { project?: BrandIpProject };
                    if (saved.project) await applyProject(saved.project, false);
                  }
                }
                setAnalysisProgress(95);
              } else if (evt.type === 'error') {
                showToast(evt.message ?? '策略分析出错');
                setIsAnalyzing(false);
                return;
              } else if (evt.type === 'done') {
                setAnalysisProgress(100);
                setHasAnalyzed(true);
              }
            } catch { /* skip */ }
          }
        }
      }

      setIsAnalyzing(false);
      setHasAnalyzed(true);
      showToast('策略分析完成');
    } catch {
      showToast('网络错误，请重试');
      setIsAnalyzing(false);
    }
  }, [applyProject, brandName, goal, audience, industry, workflowPath, selectedCarriers, smartMode, project, showToast]);

  /* ── Confirm direction ─────────────────────────────────────────── */
  const handleConfirmDirection = useCallback(async () => {
    if (!selectedDirection || !project) return;
    try {
      const res = await fetch('/api/brand-ip/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          confirmedDirectionId: selectedDirection,
        }),
      });
      if (!res.ok) throw new Error('confirm_failed');
      const data = await res.json() as { project?: BrandIpProject };
      if (!data.project) throw new Error('project_missing');
      await applyProject(data.project, false);
      await loadProjects();
      showToast('方向已锁定，进入视觉系统阶段');
    } catch {
      showToast('确认失败，请重试');
    }
  }, [applyProject, loadProjects, project, selectedDirection, showToast]);

  /* ── Generate asset ────────────────────────────────────────────── */
  const handleGenerateAsset = useCallback(async () => {
    if (!project || !selectedDirection) {
      showToast('请先确认角色方向');
      return;
    }
    const direction = directions.find(item => item.id === selectedDirection);
    setGeneratingAsset(true);
    setAssetProgress(0);
    setAssetLabel('正在提交生成任务');
    try {
      const res = await fetch('/api/brand-ip/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          prompt: `${brandName} 品牌IP角色标准图，${direction?.name ?? ''}。${direction?.concept ?? ''}`,
          aspectRatio: '1:1',
        }),
      });
      const data = await res.json() as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) throw new Error(data.error ?? 'submit_failed');
      setAssetTaskId(data.taskId);
      showToast('生成任务已提交');

      for (let i = 0; i < 100; i += 1) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 3000));
        const taskRes = await fetch(`/api/brand-ip/tasks?taskId=${encodeURIComponent(data.taskId)}`);
        if (!taskRes.ok) throw new Error('task_load_failed');
        const taskData = await taskRes.json() as {
          task?: { status?: string; progress?: number; label?: string; error?: string };
        };
        const task = taskData.task;
        if (!task) throw new Error('task_missing');
        setAssetProgress(task.progress ?? 0);
        setAssetLabel(task.label ?? '正在生成资产');
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
          if (task.status === 'completed') {
            await loadAssets(project.id);
            showToast('资产生成完成');
          } else {
            showToast(task.error ?? (task.status === 'cancelled' ? '任务已取消' : '生成失败'));
          }
          break;
        }
      }
    } catch {
      showToast('生成失败，请稍后重试');
    } finally {
      setGeneratingAsset(false);
      setAssetTaskId(null);
    }
  }, [brandName, directions, loadAssets, project, selectedDirection, showToast]);

  const handleCancelAssetTask = useCallback(async () => {
    if (!assetTaskId) return;
    try {
      await fetch('/api/cancel-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: assetTaskId }),
      });
      setAssetLabel('正在取消任务');
    } catch {
      showToast('取消任务失败');
    }
  }, [assetTaskId, showToast]);

  /* ── Add asset to canvas ───────────────────────────────────────── */
  const handleAddToCanvas = useCallback((url: string) => {
    onAddImages?.([url], { modelName: 'brand-ip', apiProvider: 'server' });
  }, [onAddImages]);

  /* ── Display models ───────────────────────────────────────────── */
  const displayDirections = directions.map(toDisplayDirection);
  const selDir = displayDirections.find(direction => direction.id === selectedDirection) ?? displayDirections[0];
  const dirTone = selDir?.tone ?? 'warm';
  const gateItems = [
    ...((project?.immutableCore ?? []).map(item => ({
      id: `core-${item.id}`,
      icon: '◆',
      name: item.label,
      note: item.value,
      status: '已锁定',
      warning: false,
    }))),
    ...((project?.controlledVariables ?? []).map(item => ({
      id: `variable-${item.id}`,
      icon: '◌',
      name: item.label,
      note: item.value,
      status: item.risk === 'high' ? '需核验' : '可调整',
      warning: item.risk === 'high',
    }))),
  ];

  /* ═══ Render ════════════════════════════════════════════════════ */
  return (
    <div className="brand-ip-workspace fixed inset-0 z-[201]" data-popup data-floating-panel="brand-ip">
      <div
        ref={shellRef}
        className="bi-shell flex flex-col overflow-hidden"
        style={{
          left: `${windowPosition.x}px`,
          top: `${windowPosition.y}px`,
          background: 'radial-gradient(circle at 76% 8%, rgba(225,184,92,.06), transparent 28%), #090a0c',
        }}
      >

        {/* ═══ Topbar ═══ */}
        <div
          className="bi-topbar"
          onPointerDown={handleWindowPointerDown}
          onPointerMove={handleWindowPointerMove}
          onPointerUp={handleWindowPointerUp}
          onPointerCancel={handleWindowPointerUp}
        >
          <GripVertical className="bi-drag-handle" aria-hidden="true" />
          <div className="bi-brand-lockup">
            <div className="bi-brand-mark">无界</div>
            <div>
              <strong>品牌IP设计工场</strong>
              <span>PURPOSE-FIRST IP DESIGN</span>
            </div>
            <span className="bi-beta">BETA</span>
          </div>
          <div className="bi-topbar-center" style={{ fontSize: 12 }}>
            <span className="crumb">无界AI</span>
            <span className="slash">/</span>
            <span className="crumb">品牌工厂</span>
            <span className="slash">/</span>
            <span style={{ color: '#e0b85c' }}>品牌IP设计工场</span>
            {project && (
              <>
                <span className="slash">/</span>
                <span style={{ color: '#c6c7ca' }}>{project.name}</span>
              </>
            )}
          </div>
          <div className="bi-top-actions">
            <button className="bi-icon-button" onClick={() => setShowProjectList(s => !s)} title="项目列表">
              <Sparkles style={{ width: 15, height: 15 }} />
            </button>
            <button className="bi-icon-button" onClick={onClose} title="关闭">
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        {/* Project list dropdown */}
        {showProjectList && (
          <div
            className="absolute right-18 top-14 z-40 rounded-xl border p-2 min-w-[200px]"
            style={{ background: '#111216', borderColor: 'rgba(255,255,255,.08)' }}
            data-popup
          >
            {projects.length === 0 && (
              <div style={{ color: '#646770', fontSize: 11, padding: '8px 12px' }}>暂无项目</div>
            )}
            {projects.map(p => (
              <button
                key={p.id}
                className="w-full text-left rounded-lg px-3 py-2 hover:bg-white/5 transition-colors"
                onClick={() => {
                  setShowProjectList(false);
                  void loadProject(p.id).catch(() => showToast('项目加载失败'));
                }}
                style={{ fontSize: 11, color: project?.id === p.id ? '#e0b85c' : '#c6c7ca' }}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {/* ═══ Body (scrollable) ═══ */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto" data-popup>

          {/* ═══ Product area ═══ */}
          <div className="bi-product" style={{ padding: '20px 24px 36px', maxWidth: 1600, margin: '0 auto' }}>

            {/* Product header */}
            <div className="bi-product-header" style={{ marginBottom: 20 }}>
              <div>
                <div className="bi-eyebrow">
                  <span className="bi-live-dot" />
                  PURPOSE-FIRST IP DESIGN
                </div>
                <h1 style={{ fontSize: 24, margin: '8px 0 4px', letterSpacing: '-.04em' }}>品牌IP设计工场</h1>
                <p style={{ margin: 0, color: '#8f929a', fontSize: 12 }}>
                  先让IP承担明确的品牌任务，再生成角色；先锁定结构和不可变核心，再做画风、服装与应用。
                </p>
              </div>
              <div className="bi-header-actions">
                <button className="bi-secondary-button" onClick={() => setShowAdvanced(true)}>
                  <Settings style={{ width: 13, height: 13 }} /> 高级设置
                </button>
                <button className="bi-secondary-button" disabled title="导出将在资产交付包完成后开放">
                  <span>↓</span> 导出
                </button>
              </div>
            </div>

            {/* Stage navigation */}
            <div className="bi-stage-nav" style={{ marginBottom: 14 }}>
              {STAGES.map((s, i) => (
                <button
                  key={s.num}
                  className={`${i === activeStage ? 'active' : ''} ${i < activeStage ? 'done' : ''}`}
                  onClick={() => i <= activeStage && setActiveStage(i)}
                  style={{ opacity: i > activeStage ? 0.4 : 1, cursor: i > activeStage ? 'not-allowed' : 'pointer' }}
                >
                  <span className="bi-stage-number">{s.num}</span>
                  {s.name}
                </button>
              ))}
            </div>

            {/* ═══ Content grid (3 columns) ═══ */}
            <div className="bi-content-grid">

              {/* ─── Left: Input panel ─── */}
              <div className="bi-panel bi-input-panel" style={{ padding: 18 }}>
                {/* Heading */}
                <div className="bi-panel-heading">
                  <div>
                    <span className="bi-section-index">01</span>
                    <h2>品牌目标</h2>
                  </div>
                  <label className="bi-smart-toggle">
                    <input type="checkbox" checked={smartMode} onChange={e => setSmartMode(e.target.checked)} />
                    <i />
                    智能补全
                  </label>
                </div>

                {/* Path grid */}
                <div className="bi-field">
                  <label>工作路径</label>
                  <div className="bi-path-grid">
                    {PATHS.map((p, i) => (
                      <button
                        key={i}
                        className={workflowPath === i ? 'selected' : ''}
                        onClick={() => setWorkflowPath(i)}
                      >
                        <span>{p.icon}</span> {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Brand name */}
                <div className="bi-field">
                  <label>品牌 / 项目名称 <em>*</em></label>
                  <input
                    value={brandName}
                    onChange={e => setBrandName(e.target.value)}
                    placeholder="例如：中国劲酒年轻化品牌IP"
                  />
                </div>

                {/* Goal */}
                <div className="bi-field">
                  <label>希望IP完成什么 <em>*</em> <small>一句话即可</small></label>
                  <textarea
                    rows={2}
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    placeholder="例如：打造能连接年轻消费者并长期运营的品牌角色"
                  />
                </div>

                {/* Audience & Industry */}
                <div className="bi-setting-grid" style={{ marginBottom: 16 }}>
                  <div className="bi-field" style={{ margin: 0 }}>
                    <label>目标受众</label>
                    <input
                      value={audience}
                      onChange={e => setAudience(e.target.value)}
                      placeholder="25-40岁都市人群"
                    />
                  </div>
                  <div className="bi-field" style={{ margin: 0 }}>
                    <label>所属行业</label>
                    <input
                      value={industry}
                      onChange={e => setIndustry(e.target.value)}
                      placeholder="酒水/食品/科技"
                    />
                  </div>
                </div>

                {/* Carriers */}
                <div className="bi-field">
                  <label>首发载体 <small>可多选</small></label>
                  <div className="bi-chip-list">
                    {CARRIERS.map((c, i) => (
                      <button
                        key={i}
                        className={selectedCarriers.includes(i) ? 'selected' : ''}
                        onClick={() => setSelectedCarriers(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}
                      >
                        <span>{c.icon}</span> {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reference upload is unavailable until it is bound to the project asset API. */}
                <div className="bi-upload-box" aria-disabled="true">
                  <span className="bi-upload-icon">↑</span>
                  <div>
                    <strong>品牌资料导入</strong>
                    <small>该项目暂未接入资料存储，策略生成仅使用上方文字信息</small>
                  </div>
                </div>

                {/* Generate button */}
                <button
                  className="bi-primary-button"
                  disabled={isAnalyzing || !brandName.trim()}
                  onClick={handleGenerate}
                >
                  {isAnalyzing ? '分析中...' : '生成策略与方向'}
                </button>
                <p className="bi-generate-note">
                  系统将分析品牌角色、可拥有性、可落地性三大关卡，并生成3个角色方向
                </p>
              </div>

              {/* ─── Center: Result column ─── */}
              <div className="bi-result-column">

                {/* Insight card */}
                <div className="bi-panel bi-insight" style={{ padding: 18 }}>
                  <div className="bi-panel-heading compact">
                    <div>
                      <span className="bi-section-index">02</span>
                      <h2>策略摘要</h2>
                    </div>
                    <span className={`bi-status-pill ${hasAnalyzed ? 'success' : ''}`}>
                      {isAnalyzing ? '分析中' : hasAnalyzed ? '已完成' : '待生成'}
                    </span>
                  </div>

                  {isAnalyzing && (
                    <div className="bi-analysis-state">
                      <div className="bi-orb-loader"><span /></div>
                      <strong>正在分析品牌策略</strong>
                      <p>AI 正在解析品牌目标与三大关卡</p>
                      <div className="bi-progress-track">
                        <i style={{ width: `${analysisProgress}%` }} />
                      </div>
                      <small>{analysisProgress}%</small>
                    </div>
                  )}

                  {!isAnalyzing && !hasAnalyzed && (
                    <div className="bi-analysis-state">
                      <div className="bi-orb-loader" style={{ animation: 'none', opacity: 0.4 }}><span /></div>
                      <strong style={{ color: '#646770' }}>等待策略分析</strong>
                      <p>填写左侧品牌目标后点击"生成策略与方向"</p>
                    </div>
                  )}

                  {!isAnalyzing && hasAnalyzed && (
                    <>
                      {/* Summary card */}
                      <div className="bi-summary-card">
                        <div className="bi-summary-top">
                          <span>策略摘要</span>
                          <strong>AI 生成</strong>
                        </div>
                        <p style={{ color: '#a0a2a7', fontSize: 10, lineHeight: 1.7, margin: '10px 0 12px', whiteSpace: 'pre-wrap' }}>
                          {strategyText.slice(0, 500) || '策略分析完成。请查看下方角色方向并选择确认。'}
                          {strategyText.length > 500 ? '...' : ''}
                        </p>
                
                      </div>

                      <div className="bi-gate-grid">
                        {gateItems.length > 0 ? gateItems.map(item => (
                          <article key={item.id}>
                            <span className="bi-gate-icon" style={{ fontSize: 16 }}>{item.icon}</span>
                            <div>
                              <strong>{item.name}</strong>
                              <small>{item.note}</small>
                            </div>
                            <b className={item.warning ? 'warning' : ''}>{item.status}</b>
                          </article>
                        )) : (
                          <div className="bi-gate-empty">策略完成后将在这里显示不可变核心与受控变量。</div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Directions card */}
                <div className="bi-panel bi-directions" style={{ padding: 18 }}>
                  <div className="bi-panel-heading compact">
                    <div>
                      <span className="bi-section-index">03</span>
                      <h2>角色方向</h2>
                    </div>
                    <span className="bi-status-pill">{displayDirections.length} 个候选</span>
                  </div>

                  <div className="bi-direction-list">
                    {displayDirections.map(dir => (
                      <button
                        key={dir.id}
                        className={selectedDirection === dir.id ? 'selected' : ''}
                        onClick={() => !confirmedDirection && setSelectedDirection(dir.id)}
                        style={{ cursor: confirmedDirection ? 'default' : 'pointer' }}
                      >
                        {/* Mini character */}
                        <div className={`bi-mini-character ${dir.tone}`} style={{ height: 94 }}>
                          <div className="ear" />
                          <div className="ear right" />
                          <div className="face">
                            <i /><i />
                          </div>
                          <div className="body" />
                        </div>

                        {/* Copy */}
                        <div className="bi-direction-copy">
                          <div>
                            <span>{dir.tag}</span>
                            <strong>匹配 {dir.score}</strong>
                          </div>
                          <h3>{dir.name}</h3>
                          <p>{dir.description}</p>
                          <div className="bi-trait-row">
                            {dir.traits.map((t, ti) => (
                              <i key={ti}>{t}</i>
                            ))}
                          </div>
                        </div>

                        {/* Radio dot */}
                        <div className="bi-radio-dot" />
                      </button>
                    ))}
                  </div>

                  {/* Confirm button */}
                  {selectedDirection && !confirmedDirection && (
                    <button
                      className="bi-primary-button"
                      style={{ marginTop: 12, height: 36, fontSize: 11 }}
                      onClick={handleConfirmDirection}
                    >
                      确认方向并锁定不可变核心
                    </button>
                  )}
                  {confirmedDirection && (
                    <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(94,229,164,.06)', border: '1px solid rgba(94,229,164,.16)', color: '#5ee5a4', fontSize: 10 }}>
                      ✓ 方向已锁定：{displayDirections.find(direction => direction.id === selectedDirection)?.name}
                    </div>
                  )}
                </div>
              </div>

              {/* ─── Right: Preview column ─── */}
              <div className="bi-preview-column">

                {/* Preview panel */}
                <div className="bi-panel bi-preview-panel" style={{ overflow: 'hidden' }}>
                  <div className="bi-preview-head">
                    <span>角色预览</span>
                    <div>
                      {VIEW_TABS.map((t, i) => (
                        <button
                          key={i}
                          className={viewTab === i ? 'active' : ''}
                          onClick={() => setViewTab(i)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Character stage */}
                  <div className={`bi-character-stage ${dirTone}`} style={{ height: 262, position: 'relative', overflow: 'hidden' }}>
                    <div className="bi-grid-floor" />
                    {/* Hero character */}
                    <div className="bi-hero-character">
                      <div className="bi-hero-ear" />
                      <div className="bi-hero-ear right" />
                      <div className="bi-hero-head">
                        <div className="bi-eye" />
                        <div className="bi-eye right" />
                        <div className="bi-cheek" />
                        <div className="bi-cheek right" />
                        <div className="bi-mouth" />
                        <div className="bi-badge">★</div>
                      </div>
                      <div className="bi-hero-body" />
                      <div className="bi-arm" />
                      <div className="bi-arm right" />
                      <div className="bi-foot" />
                      <div className="bi-foot right" />
                    </div>
                    {/* Sparkles */}
                    <span className="bi-spark s1" style={{ fontSize: 14 }}>✦</span>
                    <span className="bi-spark s2">✦</span>
                    <span className="bi-spark s3">✦</span>

                    {/* Caption */}
                    <div className="bi-preview-caption">
                      <span>当前方向</span>
                      <strong>{selDir?.name ?? '未选择'}</strong>
                      <small>{confirmedDirection ? '已锁定' : '待确认'}</small>
                    </div>
                  </div>

                  {/* View actions */}
                  <div className="bi-view-actions">
                    <button
                      disabled={assets.length === 0}
                      onClick={() => {
                        const asset = assets[0];
                        if (asset) handleAddToCanvas(asset.imageUrl);
                      }}
                    >
                      发送到画布
                    </button>
                    <button disabled title="资产评价暂未接入项目持久化">收藏</button>
                    <button disabled title="资产评价暂未接入项目持久化">淘汰</button>
                  </div>
                </div>

                {/* Deliverable panel */}
                <div className="bi-panel bi-deliverable" style={{ padding: 15 }}>
                  <div className="bi-deliverable-head">
                    <div>
                      <span className="bi-section-index">{STAGES[activeStage].num}</span>
                      <h2>{STAGES[activeStage].title}</h2>
                    </div>
                    <span>{activeStage + 1} / 5</span>
                  </div>
                  <p>{STAGES[activeStage].desc}</p>
                  <ul>
                    {STAGES[activeStage].items.map((item, i) => (
                      <li key={i}>
                        <span>{String(i + 1).padStart(2, '0')}</span>
                        {item}
                        <b>{i < 2 ? '✓' : '○'}</b>
                      </li>
                    ))}
                  </ul>
                  {activeStage < 4 && (
                    <button
                      className="bi-next-stage"
                      onClick={() => setActiveStage(activeStage + 1)}
                    >
                      进入下一阶段 <span>→</span>
                    </button>
                  )}
                </div>

                {/* Asset generation (stage 2+) */}
                {activeStage >= 2 && (
                  <div className="bi-panel" style={{ padding: 15 }}>
                    <div className="bi-deliverable-head" style={{ marginBottom: 10 }}>
                      <div>
                        <span className="bi-section-index">04</span>
                        <h2>资产生成</h2>
                      </div>
                    </div>
                    {generatingAsset && (
                      <div className="bi-asset-progress">
                        <div>
                          <span>{assetLabel || '正在生成资产'}</span>
                          <strong>{assetProgress}%</strong>
                        </div>
                        <div className="bi-progress-track"><i style={{ width: `${assetProgress}%` }} /></div>
                        <button className="bi-secondary-button" onClick={handleCancelAssetTask}>取消生成</button>
                      </div>
                    )}
                    {assets.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                        {assets.slice(0, 4).map(a => (
                          <div
                            key={a.id}
                            style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}
                            onClick={() => handleAddToCanvas(a.imageUrl)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.imageUrl} alt={a.assetType} style={{ width: '100%', height: 80, objectFit: 'cover' }} />
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {['标准角色图', '单色版', '小尺寸', '表情包'].map(t => (
                        <button
                          key={t}
                          className="bi-secondary-button"
                          style={{ height: 32, fontSize: 10, justifyContent: 'center' }}
                          disabled={generatingAsset || !confirmedDirection}
                          onClick={handleGenerateAsset}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Risk note */}
                <div className="bi-risk-note">
                  <span>!</span>
                  <div>
                    <strong>风险提示</strong>
                    <p>系统输出的商标、版权和原创性判断均为"待核验"状态，不构成法律结论。请在商用前完成专业检索和法务审查。</p>
                  </div>
                </div>
              </div>

            </div>{/* /content-grid */}
          </div>{/* /product */}
        </div>{/* /scroll body */}

        {/* ═══ Advanced settings drawer ═══ */}
        {showAdvanced && (
          <div className="bi-modal-backdrop" onClick={() => setShowAdvanced(false)}>
            <div className="bi-advanced-drawer" onClick={e => e.stopPropagation()}>
              <div className="bi-drawer-head">
                <div>
                  <span>ADVANCED</span>
                  <h2>高级设置</h2>
                </div>
                <button onClick={() => setShowAdvanced(false)}>×</button>
              </div>
              <p className="bi-drawer-intro">
                高级参数用于控制角色定位、生产限制和风险策略。不填写时系统将使用推荐默认值，不会阻塞基础流程。
              </p>

              <div className="bi-setting-group">
                <label>IP 主角色定位</label>
                <select value={advRole} onChange={e => setAdvRole(e.target.value)}>
                  <option>长期代言人</option>
                  <option>活动限定角色</option>
                  <option>系列主角</option>
                  <option>联名角色</option>
                </select>
              </div>

              <div className="bi-setting-grid">
                <div className="bi-setting-group">
                  <label>角色数量</label>
                  <select value={advCount} onChange={e => setAdvCount(e.target.value)}>
                    <option value="1">1 个</option>
                    <option value="2">2 个</option>
                    <option value="3">3 个</option>
                  </select>
                </div>
                <div className="bi-setting-group">
                  <label>视觉气质</label>
                  <select value={advVibe} onChange={e => setAdvVibe(e.target.value)}>
                    <option>温暖亲和</option>
                    <option>活力运动</option>
                    <option>酷炫科技</option>
                    <option>典雅文艺</option>
                    <option>童趣可爱</option>
                  </select>
                </div>
              </div>

              <div className="bi-setting-group">
                <label>生产限制</label>
                <textarea
                  rows={2}
                  value={advConstraints}
                  onChange={e => setAdvConstraints(e.target.value)}
                  placeholder="例如：后期需支持PVC公仔生产"
                />
              </div>

              <div className="bi-setting-group">
                <label>禁止项</label>
                <textarea
                  rows={2}
                  value={advForbidden}
                  onChange={e => setAdvForbidden(e.target.value)}
                  placeholder="例如：不得模仿具体艺术家"
                />
              </div>

              <div className="bi-switch-list">
                <label>
                  <span>
                    <strong>自动生成权利风险表</strong>
                    <small>在交付治理阶段自动创建风险登记</small>
                  </span>
                  <input type="checkbox" checked={advAutoRisk} onChange={e => setAdvAutoRisk(e.target.checked)} />
                </label>
                <label>
                  <span>
                    <strong>同步生成应用矩阵</strong>
                    <small>角色确认后自动生成首发载体应用方案</small>
                  </span>
                  <input type="checkbox" checked={advAutoApp} onChange={e => setAdvAutoApp(e.target.checked)} />
                </label>
                <label>
                  <span>
                    <strong>优先结构识别</strong>
                    <small>生成前先分析已有角色的轮廓与比例</small>
                  </span>
                  <input type="checkbox" checked={advStructFirst} onChange={e => setAdvStructFirst(e.target.checked)} />
                </label>
              </div>

              <div className="bi-drawer-actions">
                <button onClick={() => setShowAdvanced(false)}>关闭</button>
                <button className="save" disabled title="高级参数尚未接入项目配置存储">保存设置</button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Toast ═══ */}
        {toast.show && (
          <div className="bi-toast">
            <span>✓</span>
            {toast.msg}
          </div>
        )}

      </div>{/* /shell */}
    </div>
  );
}
