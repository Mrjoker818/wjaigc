'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Settings, ChevronRight, Upload, Sparkles } from 'lucide-react';

/* ================================================================
   品牌 IP 设计工场 — 参考原型还原的黑金三栏工作台
   ================================================================ */

interface BrandIpPanelProps {
  onClose: () => void;
  onAddImages?: (urls: string[], meta?: Record<string, unknown>) => void;
}

/* ── Types ──────────────────────────────────────────────────────── */
interface BrandIpProject {
  id: string;
  name: string;
  stage: string;
  brief?: Record<string, unknown>;
  confirmedDirectionId?: string | null;
  assets?: BrandIpAsset[];
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
interface Direction {
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

const GATES = [
  { icon: '◎', name: '品牌角色', status: '充分', ok: true, note: 'IP承担"年轻化陪伴者"角色' },
  { icon: '⬡', name: '可拥有性', status: '待核验', ok: false, note: '名称需做商标检索' },
  { icon: '◇', name: '可落地性', status: '充分', ok: true, note: '首发社媒+包装可执行' },
];

const MOCK_DIRECTIONS: Direction[] = [
  { id: 'd1', name: '陪伴型守护者', tone: 'warm', tag: '推荐方向', score: 92, description: '用"靠近、回应、守护"的行为建立亲和力，适合长期内容与会员运营。', traits: ['温暖', '可靠', '有回应'] },
  { id: 'd2', name: '好奇探索家', tone: 'blue', tag: '区隔方向', score: 88, description: '用观察、发现和收集的动作连接产品知识，适合内容科普与互动任务。', traits: ['敏锐', '乐观', '行动派'] },
  { id: 'd3', name: '灵感创造官', tone: 'violet', tag: '商业方向', score: 86, description: '以创作、组合、变形为核心动作，适合联名、文创与多形态商品延展。', traits: ['聪明', '灵活', '有巧思'] },
];

const VIEW_TABS = ['标准', '单色', '小尺寸'];

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
  const [directions] = useState<Direction[]>(MOCK_DIRECTIONS);
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

  /* ── Toast helper ──────────────────────────────────────────────── */
  const showToast = useCallback((msg: string) => {
    setToast({ show: true, msg });
    setTimeout(() => setToast({ show: false, msg: '' }), 2500);
  }, []);

  /* ── Load projects on mount ────────────────────────────────────── */
  useEffect(() => {
    void loadProjects();
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/brand-ip/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects ?? []);
      }
    } catch { /* ignore */ }
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
            stage: 'strategy',
            brief: { brandName, goal, audience, industry, workflowPath, carriers: selectedCarriers },
          }),
        });
        if (!createRes.ok) {
          showToast('项目创建失败');
          setIsAnalyzing(false);
          return;
        }
        const createData = await createRes.json();
        proj = createData.project;
        setProject(proj);
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
                setStrategyText(evt.content ?? '');
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
  }, [brandName, goal, audience, industry, workflowPath, selectedCarriers, smartMode, project, showToast]);

  /* ── Confirm direction ─────────────────────────────────────────── */
  const handleConfirmDirection = useCallback(async () => {
    if (!selectedDirection || !project) return;
    try {
      await fetch('/api/brand-ip/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          updates: { confirmedDirectionId: selectedDirection, stage: 'visual-system' },
        }),
      });
      setConfirmedDirection(true);
      setProject(prev => prev ? { ...prev, confirmedDirectionId: selectedDirection, stage: 'visual-system' } : prev);
      setActiveStage(2);
      showToast('方向已锁定，进入视觉系统阶段');
    } catch {
      showToast('确认失败，请重试');
    }
  }, [selectedDirection, project, showToast]);

  /* ── Generate asset ────────────────────────────────────────────── */
  const handleGenerateAsset = useCallback(async (assetType: string) => {
    if (!project) {
      showToast('请先创建项目');
      return;
    }
    if (!confirmedDirection) {
      showToast('请先确认角色方向');
      return;
    }
    setGeneratingAsset(true);
    try {
      const res = await fetch('/api/brand-ip/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          prompt: `${brandName} 品牌IP角色标准图，${directions.find(d => d.id === selectedDirection)?.name ?? ''}风格`,
          assetType,
        }),
      });
      if (!res.ok) {
        showToast('生成请求失败');
        setGeneratingAsset(false);
        return;
      }
      const data = await res.json();
      if (data.taskId) {
        showToast('生成任务已提交');
        // Poll for result
        for (let i = 0; i < 100; i++) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const taskRes = await fetch(`/api/brand-ip/tasks?taskId=${data.taskId}`);
            if (!taskRes.ok) break;
            const taskData = await taskRes.json();
            if (taskData.status === 'completed' || taskData.status === 'failed' || taskData.status === 'cancelled') {
              // Refresh assets
              const assetRes = await fetch(`/api/brand-ip/assets?projectId=${project.id}`);
              if (assetRes.ok) {
                const assetData = await assetRes.json();
                setAssets(assetData.assets ?? []);
                setProject(prev => prev ? { ...prev, assets: assetData.assets ?? [] } : prev);
              }
              if (taskData.status === 'completed') {
                showToast('资产生成完成');
              } else {
                showToast('生成未完成: ' + (taskData.status === 'failed' ? '失败' : '已取消'));
              }
              break;
            }
          } catch { /* continue */ }
        }
      }
    } catch {
      showToast('生成失败');
    }
    setGeneratingAsset(false);
  }, [project, confirmedDirection, brandName, directions, selectedDirection, showToast]);

  /* ── Add asset to canvas ───────────────────────────────────────── */
  const handleAddToCanvas = useCallback((url: string) => {
    onAddImages?.([url], { modelName: 'brand-ip', apiProvider: 'server' });
  }, [onAddImages]);

  /* ── Selected direction object ─────────────────────────────────── */
  const selDir = directions.find(d => d.id === selectedDirection) ?? directions[0];
  const dirTone = selDir?.tone ?? 'warm';

  /* ═══ Render ════════════════════════════════════════════════════ */
  return (
    <div
      className="brand-ip-workspace fixed inset-0 z-[201] flex flex-col"
      data-popup
      data-floating-panel="brand-ip"
      style={{ background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(12px)' }}
    >
      <div className="bi-shell flex flex-col h-full overflow-hidden" style={{ background: 'radial-gradient(circle at 76% 8%, rgba(225,184,92,.06), transparent 28%), #090a0c' }}>

        {/* ═══ Topbar ═══ */}
        <div className="bi-topbar" style={{ position: 'relative', zIndex: 30 }}>
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
                  setProject(p);
                  setBrandName(p.name);
                  setActiveStage(p.stage === 'strategy' ? 0 : p.stage === 'role-direction' ? 1 : p.stage === 'visual-system' ? 2 : p.stage === 'application' ? 3 : 4);
                  setShowProjectList(false);
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
                <button className="bi-secondary-button" onClick={() => showToast('导出功能开发中')}>
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

                {/* Upload */}
                <div className="bi-upload-box">
                  <input type="file" accept="image/*" id="bi-upload" onChange={() => showToast('上传功能复用现有组件')} />
                  <label htmlFor="bi-upload" className="bi-upload-icon" style={{ cursor: 'pointer' }}>↑</label>
                  <div>
                    <strong>上传品牌资料</strong>
                    <small>Logo、包装、VI 或已有角色图（可选）</small>
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
                        <div className="bi-confidence">
                          <span>置信度</span>
                          <div><i style={{ width: '82%' }} /></div>
                          <strong>82%</strong>
                        </div>
                      </div>

                      {/* Gate grid */}
                      <div className="bi-gate-grid">
                        {GATES.map((g, i) => (
                          <article key={i}>
                            <span className="bi-gate-icon" style={{ fontSize: 16 }}>{g.icon}</span>
                            <div>
                              <strong>{g.name}</strong>
                              <small>{g.note}</small>
                            </div>
                            <b className={g.ok ? '' : 'warning'}>{g.status}</b>
                          </article>
                        ))}
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
                    <span className="bi-status-pill">3 个候选</span>
                  </div>

                  <div className="bi-direction-list">
                    {directions.map(dir => (
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
                      ✓ 方向已锁定：{directions.find(d => d.id === selectedDirection)?.name}
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
                    <button onClick={() => { const a = assets[0]; if (a) handleAddToCanvas(a.imageUrl); }}>发送到画布</button>
                    <button onClick={() => showToast('收藏功能开发中')}>收藏</button>
                    <button onClick={() => showToast('淘汰功能开发中')}>淘汰</button>
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
                      <div style={{ textAlign: 'center', padding: 12, color: '#e0b85c', fontSize: 10 }}>
                        生成中...
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
                          onClick={() => handleGenerateAsset(t)}
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
                <button onClick={() => setShowAdvanced(false)}>取消</button>
                <button className="save" onClick={() => { setShowAdvanced(false); showToast('设置已保存'); }}>保存设置</button>
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
