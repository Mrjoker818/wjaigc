'use client';

import React, { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createEmptyWorkflow, type Workflow } from '@/lib/workflow-engine';
import { importWorkflowFile } from '@/lib/workflow-file';
import { createWorkflowFromPreset, WORKFLOW_PRESETS } from '@/lib/workflow-presets';

// ==================== 双主题 ====================

const TEMPLATE_CATEGORY_TAGS = {
  AI修图: ['修图', '分层', '重绘'],
  批量处理: ['批量'],
  创意生成: ['生成', '转换', '设计', '电商', '品牌', '视频', '社媒', '漫画'],
  自动化: ['流水线', '优化', '批量'],
};
type TemplateCategory = '全部' | keyof typeof TEMPLATE_CATEGORY_TAGS;
const TEMPLATE_CATEGORIES: TemplateCategory[] = ['全部', 'AI修图', '批量处理', '创意生成', '自动化'];

// ==================== 小型节点流SVG缩略图 ====================

function MiniFlowSVG({ count = 5, color = '#d4af37' }: { count?: number; color?: string }) {
  const nodes = Array.from({ length: count }, (_, i) => ({
    x: 8 + i * 22,
    y: 12 + (i % 2 === 0 ? 0 : 4),
  }));
  return (
    <svg width={count * 22 + 8} height="28" viewBox={`0 0 ${count * 22 + 8} 28`}>
      {nodes.map((n, i) => i > 0 && (
        <line key={`l${i}`} x1={nodes[i - 1].x + 4} y1={nodes[i - 1].y} x2={n.x - 4} y2={n.y}
          stroke={color} strokeWidth="1" opacity="0.4" />
      ))}
      {nodes.map((n, i) => (
        <circle key={`n${i}`} cx={n.x} cy={n.y} r="3.5"
          fill={i === 0 ? '#3b82f6' : i === count - 1 ? '#2ea043' : color} opacity="0.8" />
      ))}
    </svg>
  );
}

// ==================== 工作流卡片 ====================

interface WorkflowCardProps {
  wf: Workflow;
  onEdit: (id: string) => void;
  onRun: (id: string) => void;
  onToggleFav: (id: string) => void;
}

function WorkflowCard({ wf, onEdit, onRun, onToggleFav, theme }: WorkflowCardProps & { theme: Record<string, string> }) {
  const statusColors: Record<string, string> = {
    idle: theme.dimText, running: theme.accent, completed: '#2ea043', failed: '#f85149', paused: '#d29922',
  };

  return (
    <div className="rounded-lg p-4 transition-colors group" style={{ backgroundColor: theme.cardBg, border: '1px solid ' + theme.border }}>
      <div className="flex items-start gap-3">
        <MiniFlowSVG count={Math.min(wf.stats?.totalRuns ? 5 : 3, 6)} color={theme.accent} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium truncate" style={{ color: theme.primaryText }}>{wf.name}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${statusColors[wf.status]}20`, color: statusColors[wf.status] }}>
              {wf.version}
            </span>
          </div>
          <p className="text-xs mt-1 line-clamp-1" style={{ color: theme.dimText }}>{wf.description}</p>
          <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: theme.dimText }}>
            <span>{wf.stats?.totalRuns ?? 0} 次执行</span>
            <span>{wf.stats?.successRate ? `${Math.round(wf.stats.successRate * 100)}%` : '0%'} 成功</span>
            <span>{formatTime(wf.updatedAt)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-2" style={{ borderTop: '1px solid ' + theme.border }}>
        <button onClick={() => onEdit(wf.id)}
          className="px-2.5 py-1 rounded-md text-[10px] transition-colors" style={{ color: theme.primaryText, backgroundColor: theme.cardBg, border: '1px solid ' + theme.border }}>
          编辑
        </button>
        <button onClick={() => onRun(wf.id)}
          className="px-2.5 py-1 rounded-md text-[10px] font-medium hover:opacity-90 transition-opacity" style={{ color: theme.accentBtnText, backgroundColor: theme.accent }}>
          运行
        </button>
        <button onClick={() => onToggleFav(wf.id)}
          className="ml-auto p-1 rounded transition-colors" style={{ color: wf.favorited ? theme.accent : theme.dimText }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={wf.favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

// ==================== 主页面 ====================

interface WorkflowHubProps {
  onBack: () => void;
  onEditWorkflow: (wf: Workflow) => void;
  onRunWorkflow?: (wf: Workflow) => void;
  themeStyle?: 'gold' | 'monochrome';
  userId?: string;
}

const hubThemes: Record<string, Record<string, string>> = {
  gold: {
    bg: '#0a0e17',
    pageBg: '#0a0e17',
    headerBg: '#0e1117',
    cardBg: '#1c2333',
    cardBgHover: '#243044',
    border: '#2d3a4d',
    accent: '#d4af37',
    accentDim: 'rgba(212,175,55,0.15)',
    accentBtnText: '#0e1117',
    primaryText: '#e2e8f0',
    text: '#e2e8f0',
    dimText: '#94a3b8',
    textDim: '#94a3b8',
    inputBg: '#0e1117',
    categoryBg: '#141820',
    categoryActive: '#1c2333',
    badgeBg: 'rgba(212,175,55,0.2)',
    statsText: '#64748b',
  },
  monochrome: {
    bg: '#f8fafc',
    pageBg: '#f8fafc',
    headerBg: '#ffffff',
    cardBg: '#ffffff',
    cardBgHover: '#f1f5f9',
    border: '#e2e8f0',
    accent: '#3b82f6',
    accentDim: 'rgba(59,130,246,0.1)',
    accentBtnText: '#ffffff',
    primaryText: '#0f172a',
    text: '#0f172a',
    dimText: '#475569',
    textDim: '#475569',
    inputBg: '#f1f5f9',
    categoryBg: '#f1f5f9',
    categoryActive: '#e0e7ff',
    badgeBg: 'rgba(59,130,246,0.1)',
    statsText: '#64748b',
  },
};

export default function WorkflowHub(props: WorkflowHubProps) {
  return <WorkflowHubContent key={props.userId} {...props} />;
}

function WorkflowHubContent({ onBack, onEditWorkflow, onRunWorkflow, themeStyle = 'gold', userId }: WorkflowHubProps) {
  const T = hubThemes[themeStyle];
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>('全部');
  const [exportWorkflowId, setExportWorkflowId] = useState('');
  const [importError, setImportError] = useState('');
  const workflowFileInput = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);
  const importRequestRef = useRef(0);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadWorkflows = useCallback(async () => {
    if (!userId) {
      setWorkflows([]);
      return;
    }
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const response = await fetch(`/api/workflow/save?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('加载工作流失败');
      const data = await response.json() as { workflows?: Workflow[] };
      setWorkflows(Array.isArray(data.workflows) ? data.workflows : []);
    } catch {
      setWorkflowsError('工作流加载失败，请重试');
    } finally {
      setWorkflowsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const persistWorkflow = useCallback(async (workflow: Workflow): Promise<boolean> => {
    if (!userId) return false;
    const response = await fetch('/api/workflow/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, workflow }),
    });
    return response.ok;
  }, [userId]);

  const filtered = workflows.filter(wf =>
    !search || wf.name.includes(search) || wf.description?.includes(search)
  );

  const handleEdit = useCallback((id: string) => {
    const wf = workflows.find(w => w.id === id);
    if (wf) onEditWorkflow(wf);
  }, [workflows, onEditWorkflow]);

  const handleRun = useCallback((id: string) => {
    const wf = workflows.find(w => w.id === id);
    if (wf) {
      if (onRunWorkflow) onRunWorkflow(wf);
      else onEditWorkflow(wf);
    }
  }, [workflows, onEditWorkflow, onRunWorkflow]);

  const handleToggleFav = useCallback((id: string) => {
    const current = workflows.find(workflow => workflow.id === id);
    if (!current) return;
    const updated = { ...current, favorited: !current.favorited, updatedAt: Date.now() };
    setWorkflows(prev => prev.map(workflow => workflow.id === id ? updated : workflow));
    void persistWorkflow(updated).then(saved => {
      if (!saved) setWorkflows(prev => prev.map(workflow => workflow.id === id ? current : workflow));
    }).catch(() => {
      setWorkflows(prev => prev.map(workflow => workflow.id === id ? current : workflow));
    });
  }, [persistWorkflow, workflows]);

  const handleCreate = useCallback(() => {
    const wf = createEmptyWorkflow('新工作流');
    onEditWorkflow(wf);
  }, [onEditWorkflow]);

  const handleImport = async (file: File): Promise<void> => {
    const request = ++importRequestRef.current;
    const current = (): boolean => mountedRef.current && importRequestRef.current === request;
    setImportError('');
    try {
      const text = await file.text();
      if (!current()) return;
      const workflow = importWorkflowFile(text);
      if (!workflow) {
        setImportError('无法识别此工作流文件。请选择无界或 ComfyUI 导出的 JSON。');
        return;
      }
      onEditWorkflow(workflow);
    } catch {
      if (current()) setImportError('文件读取失败，请重试。');
    }
  };

  const workflowToExport = workflows.find(workflow => workflow.id === exportWorkflowId);
  const handleExport = (): void => {
    if (!workflowToExport) return;
    const { name, description, nodes, connections } = workflowToExport;
    const contents = JSON.stringify({ name, description, nodes, connections }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 96) || 'workflow'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const totalRuns = workflows.reduce((sum, wf) => sum + (wf.stats?.totalRuns ?? 0), 0);
  const totalFavs = workflows.filter(wf => wf.favorited).length;
  const listedTemplates = activeCategory === '全部' ? WORKFLOW_PRESETS : WORKFLOW_PRESETS.filter(
    preset => preset.tags.some(tag => TEMPLATE_CATEGORY_TAGS[activeCategory].includes(tag)),
  );
  const totalDuration = workflows.reduce((sum, { stats }) => sum + (stats?.totalRuns ?? 0) * (stats?.avgDurationMs ?? 0), 0);
  const totalSuccesses = workflows.reduce((sum, { stats }) => sum + (stats?.totalRuns ?? 0) * (stats?.successRate ?? 0), 0);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col node-editor-root" style={{ backgroundColor: T.bg }}>
      {/* 顶部导航 */}
      <div className="h-12 flex items-center px-4 shrink-0" style={{ backgroundColor: T.headerBg, borderBottom: `1px solid ${T.border}` }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: T.primaryText }}>无界AI</span>
          <span className="text-xs" style={{ color: T.dimText }}>Studio</span>
        </div>
        <div className="flex items-center gap-4 ml-8">
          <button onClick={onBack} className="text-xs transition-colors hover:opacity-80" style={{ color: T.dimText }}>画布</button>
          <span className="text-xs font-medium" style={{ color: T.accent }}>收藏与分享</span>
        </div>
        <div className="flex-1" />
        <button className="p-1.5 rounded-md transition-colors hover:opacity-80" style={{ color: T.dimText }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
      </div>

      {/* 主内容 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
          {/* 标题区 */}
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold" style={{ color: T.primaryText }}>工作流中心</h1>
              <p className="text-sm mt-1" style={{ color: T.dimText }}>管理、分享和发现AI工作流模板</p>
            </div>
            <div className="flex items-center gap-2">
              <input ref={workflowFileInput} type="file" accept=".json,application/json" hidden onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void handleImport(file);
              }} />
              <button type="button" onClick={() => workflowFileInput.current?.click()}
                className="px-3 py-1.5 rounded-md text-xs transition-colors" style={{ color: T.primaryText, border: `1px solid ${T.border}` }}>
                导入工作流
              </button>
              <button onClick={handleCreate}
                className="px-4 py-1.5 rounded-md text-xs font-medium hover:opacity-90 transition-opacity" style={{ color: T.accentBtnText, backgroundColor: T.accent }}>
                新建工作流
              </button>
            </div>
          </div>

          {/* 统计概览 */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: '我的工作流', value: workflows.length, icon: '📁' },
              { label: '已收藏', value: totalFavs, icon: '⭐' },
              { label: '累计执行', value: totalRuns, icon: '🚀' },
            ].map(stat => (
              <div key={stat.label} className="rounded-lg p-4" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{stat.icon}</span>
                  <span className="text-xs" style={{ color: T.dimText }}>{stat.label}</span>
                </div>
                <p className="text-2xl font-bold mt-1" style={{ color: T.primaryText }}>{stat.value}</p>
              </div>
            ))}
          </div>

          {/* 我的工作流 */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-medium" style={{ color: T.primaryText }}>我的工作流</h2>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索..."
                className="w-40 rounded-md px-2.5 py-1 text-xs focus:outline-none" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}`, color: T.primaryText }} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {workflowsLoading && <p className="col-span-2 text-sm" style={{ color: T.dimText }}>正在加载工作流...</p>}
              {!workflowsLoading && workflowsError && <p className="col-span-2 text-sm" style={{ color: '#f85149' }}>{workflowsError}</p>}
              {!workflowsLoading && !workflowsError && filtered.length === 0 && (
                <p className="col-span-2 text-sm" style={{ color: T.dimText }}>暂无工作流，点击“新建工作流”开始创建。</p>
              )}
              {!workflowsLoading && !workflowsError && filtered.map(wf => (
                <WorkflowCard key={wf.id} wf={wf} onEdit={handleEdit} onRun={handleRun} onToggleFav={handleToggleFav} theme={T} />
              ))}
            </div>
          </section>

          {/* 工作流市场 */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-base font-medium" style={{ color: T.primaryText }}>工作流市场</h2>
              <div className="flex flex-wrap items-center gap-1">
                {TEMPLATE_CATEGORIES.map(cat => (
                  <button key={cat} aria-pressed={activeCategory === cat} onClick={() => setActiveCategory(cat)}
                    className="px-2.5 py-1 rounded-md text-[10px] transition-colors"
                    style={activeCategory === cat ? { backgroundColor: `${T.accent}20`, color: T.accent } : { color: T.dimText }}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listedTemplates.map(tpl => (
                <article key={tpl.id} className="rounded-lg overflow-hidden transition-colors" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
                  {/* 封面 */}
                  <div className="h-24 flex items-center justify-center" style={{ background: `linear-gradient(to bottom right, ${T.cardBg}, ${T.bg})` }}>
                    <MiniFlowSVG count={4} color={T.accent} />
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-medium" style={{ color: T.primaryText }}>{tpl.name}</h3>
                    <p className="text-[10px] mt-1" style={{ color: T.dimText }}>{tpl.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {tpl.tags.map(tag => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: T.badgeBg, color: T.accent }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[10px]" style={{ color: T.dimText }}>{tpl.nodes.length} 个节点</span>
                      <button onClick={() => onEditWorkflow(createWorkflowFromPreset(tpl))}
                        className="min-h-11 px-2.5 rounded-md text-xs transition-colors" style={{ color: T.primaryText, border: `1px solid ${T.border}` }}>
                        使用模板
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* 分享与导入 */}
          <section>
            <h2 className="text-base font-medium mb-4" style={{ color: T.primaryText }}>分享与导入</h2>
            <div className="grid grid-cols-2 gap-4">
              {/* 分享 */}
              <div className="rounded-lg p-4" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
                <h3 className="text-sm font-medium mb-3" style={{ color: T.primaryText }}>分享工作流文件</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label="选择要导出的工作流" value={exportWorkflowId}
                    onChange={event => setExportWorkflowId(event.target.value)}
                    className="min-h-11 min-w-0 flex-1 rounded-md px-2.5 text-xs"
                    style={{ backgroundColor: T.inputBg, border: `1px solid ${T.border}`, color: T.primaryText }}>
                    <option value="">选择已保存的工作流</option>
                    {workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
                  </select>
                  <button type="button" onClick={handleExport} disabled={!workflowToExport}
                    className="min-h-11 px-3 rounded-md text-xs shrink-0 disabled:opacity-50"
                    style={{ color: T.accentBtnText, backgroundColor: T.accent }}>
                    导出 JSON
                  </button>
                </div>
              </div>
              {/* 导入 */}
              <div className="rounded-lg p-4" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
                <h3 className="text-sm font-medium mb-3" style={{ color: T.primaryText }}>导入工作流</h3>
                <button type="button" onClick={() => workflowFileInput.current?.click()}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault();
                    const file = event.dataTransfer.files[0];
                    if (file) void handleImport(file);
                  }}
                  className="block w-full border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer"
                  style={{ borderColor: T.border }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={T.dimText} strokeWidth="2" className="mx-auto">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  <span className="block text-xs mt-2" style={{ color: T.dimText }}>选择或拖入 JSON 文件</span>
                </button>
                {importError && <p role="alert" className="mt-2 text-xs text-destructive">{importError}</p>}
              </div>
            </div>
          </section>

          {/* 执行统计 */}
          <section>
            <h2 className="text-base font-medium mb-4" style={{ color: T.primaryText }}>执行统计</h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: '总执行次数', value: totalRuns.toLocaleString(), color: T.accent },
                { label: '平均耗时', value: totalRuns ? `${(totalDuration / totalRuns / 1000).toFixed(1)} 秒` : '—', color: '#3b82f6' },
                { label: '成功率', value: totalRuns ? `${(totalSuccesses / totalRuns * 100).toFixed(1)}%` : '—', color: '#2ea043' },
              ].map(stat => (
                <div key={stat.label} className="rounded-lg p-4" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
                  <span className="text-xs" style={{ color: T.dimText }}>{stat.label}</span>
                  <p className="text-xl font-bold mt-1" style={{ color: stat.color }}>{stat.value}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
