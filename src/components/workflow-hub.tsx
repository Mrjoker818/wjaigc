'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Workflow, NODE_TYPE_COLORS, NODE_CATEGORY_LABELS, NODE_TEMPLATES,
  createEmptyWorkflow, getNodeCategory,
} from '@/lib/workflow-engine';

// ==================== 双主题 ====================

const MOCK_TEMPLATES = [
  { id: 'tpl-1', name: 'AI修图大师', author: 'Mr.joker', users: 1234, rating: 4.8, desc: '智能识别图片内容，自动选择最佳修图方案', tags: ['agent', 'condition', 'loop'] as const },
  { id: 'tpl-2', name: '批量产品图', author: 'Designer', users: 892, rating: 4.6, desc: '电商产品图批量处理白底+调色+裁切', tags: ['loop'] as const },
  { id: 'tpl-3', name: '创意风格混合', author: 'Artist', users: 654, rating: 4.7, desc: '多风格图生图+条件分支+智能选择', tags: ['condition', 'agent'] as const },
  { id: 'tpl-4', name: '矢量图标工坊', author: 'IconMaker', users: 432, rating: 4.5, desc: '生成图标→矢量化→多尺寸导出', tags: ['loop'] as const },
  { id: 'tpl-5', name: '证件照Pro', author: 'PhotoStudio', users: 2345, rating: 4.9, desc: '全自动证件照处理流水线', tags: ['condition'] as const },
];

const TAG_COLORS: Record<string, string> = {
  agent: '#f472b6',
  condition: '#f59e0b',
  loop: '#f59e0b',
};

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

export default function WorkflowHub({ onBack, onEditWorkflow, onRunWorkflow, themeStyle = 'gold', userId }: WorkflowHubProps) {
  const T = hubThemes[themeStyle];
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('全部');
  const [shareUrl] = useState('https://wujie.ai/wf/share/abc123');
  const [copied, setCopied] = useState(false);

  const loadWorkflows = useCallback(async () => {
    if (!userId) {
      setWorkflows([]);
      return;
    }
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const response = await fetch('/api/workflow/save');
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

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [shareUrl]);

  const totalRuns = workflows.reduce((sum, wf) => sum + (wf.stats?.totalRuns ?? 0), 0);
  const totalFavs = workflows.filter(wf => wf.favorited).length;

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
              <button className="px-3 py-1.5 rounded-md text-xs transition-colors" style={{ color: T.primaryText, border: `1px solid ${T.border}` }}>
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
              { label: '本周执行', value: totalRuns, icon: '🚀' },
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
            <div className="grid grid-cols-2 gap-4">
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-medium" style={{ color: T.primaryText }}>工作流市场</h2>
              <div className="flex items-center gap-1">
                {['全部', 'AI修图', '批量处理', '创意生成', '自动化'].map(cat => (
                  <button key={cat} onClick={() => setActiveCategory(cat)}
                    className="px-2.5 py-1 rounded-md text-[10px] transition-colors"
                    style={activeCategory === cat ? { backgroundColor: `${T.accent}20`, color: T.accent } : { color: T.dimText }}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {MOCK_TEMPLATES.map(tpl => (
                <div key={tpl.id} className="rounded-lg overflow-hidden transition-colors" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
                  {/* 封面 */}
                  <div className="h-24 flex items-center justify-center" style={{ background: `linear-gradient(to bottom right, ${T.cardBg}, ${T.bg})` }}>
                    <MiniFlowSVG count={4} color={T.accent} />
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-medium" style={{ color: T.primaryText }}>{tpl.name}</h3>
                    <p className="text-[10px] mt-1" style={{ color: T.dimText }}>{tpl.desc}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {tpl.tags.map(tag => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${TAG_COLORS[tag]}20`, color: TAG_COLORS[tag] }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[10px]" style={{ color: T.dimText }}>{tpl.users} 人使用</span>
                      <button className="px-2.5 py-1 rounded-md text-[10px] transition-colors" style={{ color: T.primaryText, border: `1px solid ${T.border}` }}>
                        使用模板
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 分享与导入 */}
          <section>
            <h2 className="text-base font-medium mb-4" style={{ color: T.primaryText }}>分享与导入</h2>
            <div className="grid grid-cols-2 gap-4">
              {/* 分享 */}
              <div className="rounded-lg p-4" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
                <h3 className="text-sm font-medium mb-3" style={{ color: T.primaryText }}>分享工作流</h3>
                <div className="flex items-center gap-2">
                  <input type="text" readOnly value={shareUrl}
                    className="flex-1 rounded-md px-2.5 py-1.5 text-xs focus:outline-none" style={{ backgroundColor: T.inputBg, border: `1px solid ${T.border}`, color: T.dimText }} />
                  <button onClick={handleCopyLink}
                    className="px-3 py-1.5 rounded-md text-xs hover:opacity-90 transition-opacity shrink-0" style={{ color: T.accentBtnText, backgroundColor: T.accent }}>
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <span className="text-xs" style={{ color: T.dimText }}>权限:</span>
                  <select className="rounded-md px-2 py-1 text-xs focus:outline-none" style={{ backgroundColor: T.inputBg, border: `1px solid ${T.border}`, color: T.primaryText }}>
                    <option>仅查看</option>
                    <option>可编辑</option>
                  </select>
                </div>
              </div>
              {/* 导入 */}
              <div className="rounded-lg p-4" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
                <h3 className="text-sm font-medium mb-3" style={{ color: T.primaryText }}>导入工作流</h3>
                <div className="border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer" style={{ borderColor: T.border }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={T.dimText} strokeWidth="2" className="mx-auto">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  <p className="text-xs mt-2" style={{ color: T.dimText }}>拖拽 JSON 文件到这里</p>
                </div>
              </div>
            </div>
          </section>

          {/* 执行统计 */}
          <section>
            <h2 className="text-base font-medium mb-4" style={{ color: T.primaryText }}>执行统计</h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: '总执行次数', value: '1,247', color: T.accent },
                { label: '平均耗时', value: '3.2s', color: '#3b82f6' },
                { label: '成功率', value: '94.7%', color: '#2ea043' },
              ].map(stat => (
                <div key={stat.label} className="rounded-lg p-4" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
                  <span className="text-xs" style={{ color: T.dimText }}>{stat.label}</span>
                  <p className="text-xl font-bold mt-1" style={{ color: stat.color }}>{stat.value}</p>
                </div>
              ))}
            </div>
            {/* 简易7天柱状图 */}
            <div className="mt-4 rounded-lg p-4" style={{ backgroundColor: T.cardBg, border: `1px solid ${T.border}` }}>
              <p className="text-xs mb-3" style={{ color: T.dimText }}>近7天执行量</p>
              <div className="flex items-end gap-2 h-20">
                {[45, 62, 38, 78, 55, 89, 72].map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t" style={{ height: `${(v / 89) * 60}px`, backgroundColor: i === 5 ? T.accent : `${T.accent}40` }} />
                    <span className="text-[9px]" style={{ color: T.dimText }}>{['一', '二', '三', '四', '五', '六', '日'][i]}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
