'use client';

import React, { useState, useCallback } from 'react';
import {
  Workflow, NODE_TYPE_COLORS, NODE_CATEGORY_LABELS, NODE_TEMPLATES,
  createEmptyWorkflow, getNodeCategory,
} from '@/lib/workflow-engine';

// ==================== Mock 数据 ====================

const MOCK_WORKFLOWS: Workflow[] = [
  {
    id: 'wf-1', name: '人像精修流程', version: 'v2.1', status: 'idle',
    nodes: [], connections: [], createdAt: Date.now() - 86400000 * 7, updatedAt: Date.now() - 3600000,
    description: '一键完成人像修图：移除背景→调色→无损放大',
    thumbnailUrl: '', favorited: true,
    stats: { totalRuns: 89, avgDurationMs: 12400, successRate: 0.96 },
  },
  {
    id: 'wf-2', name: '产品图批量处理', version: 'v1.3', status: 'idle',
    nodes: [], connections: [], createdAt: Date.now() - 86400000 * 14, updatedAt: Date.now() - 86400000 * 2,
    description: '批量处理电商产品图：白底合成→调色→多尺寸导出',
    thumbnailUrl: '', favorited: false,
    stats: { totalRuns: 234, avgDurationMs: 8200, successRate: 0.94 },
  },
  {
    id: 'wf-3', name: 'AI创意海报', version: 'v1.0', status: 'idle',
    nodes: [], connections: [], createdAt: Date.now() - 86400000 * 3, updatedAt: Date.now() - 86400000,
    description: 'AI生成创意海报：Agent自动决策风格→生成→排版',
    thumbnailUrl: '', favorited: true,
    stats: { totalRuns: 12, avgDurationMs: 32000, successRate: 0.83 },
  },
  {
    id: 'wf-4', name: '矢量Logo生成', version: 'v1.2', status: 'idle',
    nodes: [], connections: [], createdAt: Date.now() - 86400000 * 5, updatedAt: Date.now() - 43200000,
    description: '生成Logo→矢量化→多格式导出',
    thumbnailUrl: '', favorited: false,
    stats: { totalRuns: 56, avgDurationMs: 15600, successRate: 0.91 },
  },
  {
    id: 'wf-5', name: '动漫风格转换', version: 'v1.1', status: 'idle',
    nodes: [], connections: [], createdAt: Date.now() - 86400000 * 10, updatedAt: Date.now() - 172800000,
    description: '将照片转为动漫风格：风格分析→条件分支→生成',
    thumbnailUrl: '', favorited: true,
    stats: { totalRuns: 178, avgDurationMs: 9800, successRate: 0.97 },
  },
  {
    id: 'wf-6', name: '证件照处理', version: 'v3.0', status: 'idle',
    nodes: [], connections: [], createdAt: Date.now() - 86400000 * 30, updatedAt: Date.now() - 7200000,
    description: '证件照自动化：移除背景→白底合成→调色→1寸/2寸裁切',
    thumbnailUrl: '', favorited: true,
    stats: { totalRuns: 567, avgDurationMs: 6400, successRate: 0.99 },
  },
];

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

function WorkflowCard({ wf, onEdit, onRun, onToggleFav }: WorkflowCardProps) {
  const statusColors: Record<string, string> = {
    idle: '#7d8590', running: '#d4af37', completed: '#2ea043', failed: '#f85149', paused: '#d29922',
  };

  return (
    <div className="bg-[#1c2333] border border-[#30363d] rounded-lg p-4 hover:border-[#d4af37]/30 transition-colors group">
      <div className="flex items-start gap-3">
        <MiniFlowSVG count={Math.min(wf.stats?.totalRuns ? 5 : 3, 6)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-[#e6edf3] truncate">{wf.name}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${statusColors[wf.status]}20`, color: statusColors[wf.status] }}>
              {wf.version}
            </span>
          </div>
          <p className="text-xs text-[#7d8590] mt-1 line-clamp-1">{wf.description}</p>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-[#7d8590]">
            <span>{wf.stats?.totalRuns ?? 0} 次执行</span>
            <span>{wf.stats?.successRate ? `${Math.round(wf.stats.successRate * 100)}%` : '0%'} 成功</span>
            <span>{formatTime(wf.updatedAt)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[#30363d]">
        <button onClick={() => onEdit(wf.id)}
          className="px-2.5 py-1 rounded-md text-[10px] text-[#e6edf3] bg-[#1c2333] border border-[#30363d] hover:border-[#d4af37]/30 transition-colors">
          编辑
        </button>
        <button onClick={() => onRun(wf.id)}
          className="px-2.5 py-1 rounded-md text-[10px] font-medium text-[#0e1117] bg-[#d4af37] hover:opacity-90 transition-opacity">
          运行
        </button>
        <button onClick={() => onToggleFav(wf.id)}
          className={`ml-auto p-1 rounded transition-colors ${wf.favorited ? 'text-[#d4af37]' : 'text-[#7d8590] hover:text-[#d4af37]'}`}>
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
}

export default function WorkflowHub({ onBack, onEditWorkflow }: WorkflowHubProps) {
  const [workflows, setWorkflows] = useState(MOCK_WORKFLOWS);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('全部');
  const [shareUrl] = useState('https://wujie.ai/wf/share/abc123');
  const [copied, setCopied] = useState(false);

  const filtered = workflows.filter(wf =>
    !search || wf.name.includes(search) || wf.description?.includes(search)
  );

  const handleEdit = useCallback((id: string) => {
    const wf = workflows.find(w => w.id === id);
    if (wf) onEditWorkflow(wf);
  }, [workflows, onEditWorkflow]);

  const handleRun = useCallback((id: string) => {
    const wf = workflows.find(w => w.id === id);
    if (wf) onEditWorkflow(wf);
  }, [workflows, onEditWorkflow]);

  const handleToggleFav = useCallback((id: string) => {
    setWorkflows(prev => prev.map(wf => wf.id === id ? { ...wf, favorited: !wf.favorited } : wf));
  }, []);

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
    <div className="fixed inset-0 bg-[#0e1117] z-[100] flex flex-col">
      {/* 顶部导航 */}
      <div className="h-12 bg-[#161b22] border-b border-[#30363d] flex items-center px-4 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className="text-sm font-bold text-[#e6edf3]">无界AI</span>
          <span className="text-xs text-[#7d8590]">Studio</span>
        </div>
        <div className="flex items-center gap-4 ml-8">
          <button onClick={onBack} className="text-xs text-[#7d8590] hover:text-[#e6edf3] transition-colors">画布</button>
          <span className="text-xs text-[#d4af37] font-medium">收藏与分享</span>
        </div>
        <div className="flex-1" />
        <button className="p-1.5 rounded-md text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#1c2333] transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
      </div>

      {/* 主内容 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
          {/* 标题区 */}
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold text-[#e6edf3]">工作流中心</h1>
              <p className="text-sm text-[#7d8590] mt-1">管理、分享和发现AI工作流模板</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 rounded-md text-xs text-[#e6edf3] border border-[#30363d] hover:border-[#d4af37]/30 transition-colors">
                导入工作流
              </button>
              <button onClick={handleCreate}
                className="px-4 py-1.5 rounded-md text-xs font-medium text-[#0e1117] bg-[#d4af37] hover:opacity-90 transition-opacity">
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
              <div key={stat.label} className="bg-[#1c2333] border border-[#30363d] rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{stat.icon}</span>
                  <span className="text-xs text-[#7d8590]">{stat.label}</span>
                </div>
                <p className="text-2xl font-bold text-[#e6edf3] mt-1">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* 我的工作流 */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-medium text-[#e6edf3]">我的工作流</h2>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索..."
                className="w-40 bg-[#1c2333] border border-[#30363d] rounded-md px-2.5 py-1 text-xs text-[#e6edf3] placeholder:text-[#7d8590]/50 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {filtered.map(wf => (
                <WorkflowCard key={wf.id} wf={wf} onEdit={handleEdit} onRun={handleRun} onToggleFav={handleToggleFav} />
              ))}
            </div>
          </section>

          {/* 工作流市场 */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-medium text-[#e6edf3]">工作流市场</h2>
              <div className="flex items-center gap-1">
                {['全部', 'AI修图', '批量处理', '创意生成', '自动化'].map(cat => (
                  <button key={cat} onClick={() => setActiveCategory(cat)}
                    className={`px-2.5 py-1 rounded-md text-[10px] transition-colors ${activeCategory === cat ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'text-[#7d8590] hover:text-[#e6edf3]'}`}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {MOCK_TEMPLATES.map(tpl => (
                <div key={tpl.id} className="bg-[#1c2333] border border-[#30363d] rounded-lg overflow-hidden hover:border-[#d4af37]/30 transition-colors">
                  {/* 封面 */}
                  <div className="h-24 bg-gradient-to-br from-[#1c2333] to-[#0e1117] flex items-center justify-center">
                    <MiniFlowSVG count={4} />
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-medium text-[#e6edf3]">{tpl.name}</h3>
                    <p className="text-[10px] text-[#7d8590] mt-1">{tpl.desc}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {tpl.tags.map(tag => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${TAG_COLORS[tag]}20`, color: TAG_COLORS[tag] }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[10px] text-[#7d8590]">{tpl.users} 人使用</span>
                      <button className="px-2.5 py-1 rounded-md text-[10px] text-[#e6edf3] border border-[#30363d] hover:border-[#d4af37]/30 transition-colors">
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
            <h2 className="text-base font-medium text-[#e6edf3] mb-4">分享与导入</h2>
            <div className="grid grid-cols-2 gap-4">
              {/* 分享 */}
              <div className="bg-[#1c2333] border border-[#30363d] rounded-lg p-4">
                <h3 className="text-sm font-medium text-[#e6edf3] mb-3">分享工作流</h3>
                <div className="flex items-center gap-2">
                  <input type="text" readOnly value={shareUrl}
                    className="flex-1 bg-[#0e1117] border border-[#30363d] rounded-md px-2.5 py-1.5 text-xs text-[#7d8590] focus:outline-none" />
                  <button onClick={handleCopyLink}
                    className="px-3 py-1.5 rounded-md text-xs text-[#0e1117] bg-[#d4af37] hover:opacity-90 transition-opacity shrink-0">
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <span className="text-xs text-[#7d8590]">权限:</span>
                  <select className="bg-[#0e1117] border border-[#30363d] rounded-md px-2 py-1 text-xs text-[#e6edf3] focus:outline-none">
                    <option>仅查看</option>
                    <option>可编辑</option>
                  </select>
                </div>
              </div>
              {/* 导入 */}
              <div className="bg-[#1c2333] border border-[#30363d] rounded-lg p-4">
                <h3 className="text-sm font-medium text-[#e6edf3] mb-3">导入工作流</h3>
                <div className="border-2 border-dashed border-[#30363d] rounded-lg p-4 text-center hover:border-[#d4af37]/30 transition-colors cursor-pointer">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7d8590" strokeWidth="2" className="mx-auto">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  <p className="text-xs text-[#7d8590] mt-2">拖拽 JSON 文件到这里</p>
                </div>
              </div>
            </div>
          </section>

          {/* 执行统计 */}
          <section>
            <h2 className="text-base font-medium text-[#e6edf3] mb-4">执行统计</h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: '总执行次数', value: '1,247', color: '#d4af37' },
                { label: '平均耗时', value: '3.2s', color: '#3b82f6' },
                { label: '成功率', value: '94.7%', color: '#2ea043' },
              ].map(stat => (
                <div key={stat.label} className="bg-[#1c2333] border border-[#30363d] rounded-lg p-4">
                  <span className="text-xs text-[#7d8590]">{stat.label}</span>
                  <p className="text-xl font-bold mt-1" style={{ color: stat.color }}>{stat.value}</p>
                </div>
              ))}
            </div>
            {/* 简易7天柱状图 */}
            <div className="mt-4 bg-[#1c2333] border border-[#30363d] rounded-lg p-4">
              <p className="text-xs text-[#7d8590] mb-3">近7天执行量</p>
              <div className="flex items-end gap-2 h-20">
                {[45, 62, 38, 78, 55, 89, 72].map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t" style={{ height: `${(v / 89) * 60}px`, backgroundColor: `${i === 5 ? '#d4af37' : '#d4af3740'}` }} />
                    <span className="text-[9px] text-[#7d8590]">{['一', '二', '三', '四', '五', '六', '日'][i]}</span>
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
