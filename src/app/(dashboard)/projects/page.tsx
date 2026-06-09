'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  Plus,
  Star,
  MoreVertical,
  FolderOpen,
  Image,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  thumbnail: string;
  category: string;
  editedAt: string;
  status: 'active' | 'completed' | 'archived';
  starred: boolean;
}

const MOCK_PROJECTS: Project[] = [
  { id: '1', name: '品牌Logo设计', thumbnail: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=400&h=250&fit=crop', category: '商业科技', editedAt: '2 小时前', status: 'active', starred: true },
  { id: '2', name: '电商主图-春季新款', thumbnail: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=400&h=250&fit=crop', category: '服饰时尚', editedAt: '5 小时前', status: 'active', starred: false },
  { id: '3', name: '分镜故事板-科幻短片', thumbnail: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&h=250&fit=crop', category: '游戏娱乐', editedAt: '昨天', status: 'active', starred: true },
  { id: '4', name: '概念场景-赛博城市', thumbnail: 'https://images.unsplash.com/photo-1535016120720-40c646be5580?w=400&h=250&fit=crop', category: '建筑城市', editedAt: '3 天前', status: 'completed', starred: false },
  { id: '5', name: '角色立绘-奇幻战士', thumbnail: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&h=250&fit=crop', category: '人物', editedAt: '3 天前', status: 'active', starred: true },
  { id: '6', name: '产品包装-茶叶礼盒', thumbnail: 'https://images.unsplash.com/photo-1544947950-f2a74c8e3e5b?w=400&h=250&fit=crop', category: '商业科技', editedAt: '5 天前', status: 'completed', starred: false },
  { id: '7', name: '社交头像合集-赛博朋克', thumbnail: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=250&fit=crop', category: '人物', editedAt: '1 周前', status: 'archived', starred: false },
  { id: '8', name: 'UI素材-暗黑风格组件', thumbnail: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&h=250&fit=crop', category: '商业科技', editedAt: '1 周前', status: 'active', starred: false },
  { id: '9', name: '游戏角色-机甲战士', thumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=250&fit=crop', category: '游戏娱乐', editedAt: '2 周前', status: 'completed', starred: true },
  { id: '10', name: '建筑效果图-现代别墅', thumbnail: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=400&h=250&fit=crop', category: '建筑城市', editedAt: '2 周前', status: 'archived', starred: false },
];

type FilterKey = 'all' | 'active' | 'completed' | 'starred';

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'completed', label: '已完成' },
  { key: 'starred', label: '收藏' },
];

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  active: { label: '进行中', className: 'bg-primary/20 text-primary' },
  completed: { label: '已完成', className: 'bg-[#16A37B]/15 text-[#16A37B]' },
  archived: { label: '已归档', className: 'bg-muted text-muted-foreground' },
};

export default function ProjectsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [projects, setProjects] = useState(MOCK_PROJECTS);

  const filteredProjects = useMemo(() => {
    let result = projects;
    if (activeFilter === 'active') result = result.filter((p) => p.status === 'active');
    else if (activeFilter === 'completed') result = result.filter((p) => p.status === 'completed');
    else if (activeFilter === 'starred') result = result.filter((p) => p.starred);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q));
    }
    return result;
  }, [projects, activeFilter, searchQuery]);

  const recentProjects = projects.slice(0, 3);

  const toggleStar = (id: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, starred: !p.starred } : p))
    );
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* 顶部标题 + 新建按钮 */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold text-foreground">我的项目</h1>
        <Link
          href="/?action=new-project"
          className="flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          新建项目
        </Link>
      </div>

      {/* 搜索栏 */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索项目..."
          className="w-full h-9 pl-9 pr-4 rounded-md bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
        />
      </div>

      {/* 筛选标签 */}
      <div className="flex items-center gap-1.5 mb-6">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`h-7 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeFilter === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { icon: FolderOpen, value: '12', label: '项目总数' },
          { icon: Image, value: '186', label: '图片总数' },
          { icon: Sparkles, value: '43', label: '本月生成' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex items-center gap-3 bg-card rounded-lg shadow-card p-4 border border-transparent hover:border-primary/20 transition-colors"
          >
            <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center">
              <stat.icon className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <div className="text-lg font-semibold text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 最近编辑 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">最近编辑</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {recentProjects.map((project) => (
            <Link
              key={project.id}
              href={`/?projectId=${project.id}`}
              className="bg-card rounded-lg shadow-card overflow-hidden cursor-pointer hover:border-primary/20 hover:scale-[1.02] transition-all border border-transparent"
            >
              <div className="aspect-video overflow-hidden">
                <img
                  src={project.thumbnail}
                  alt={project.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold text-foreground truncate">{project.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{project.editedAt}编辑</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* 全部项目 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">全部项目</h2>
          <div className="text-xs text-muted-foreground">共 {filteredProjects.length} 个项目</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredProjects.map((project) => {
            const statusInfo = STATUS_MAP[project.status];
            return (
              <Link
                key={project.id}
                href={`/?projectId=${project.id}`}
                className="bg-card rounded-lg shadow-card overflow-hidden cursor-pointer hover:border-primary/20 hover:scale-[1.02] transition-all border border-transparent relative group block"
              >
                <div className="aspect-[16/10] overflow-hidden relative">
                  <img
                    src={project.thumbnail}
                    alt={project.name}
                    className="w-full h-full object-cover"
                  />
                  {/* 收藏星标 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleStar(project.id); }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 flex items-center justify-center hover:bg-black/60 transition-colors cursor-pointer"
                    aria-label={project.starred ? '取消收藏' : '添加收藏'}
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        project.starred ? 'text-primary fill-primary' : 'text-muted-foreground'
                      }`}
                    />
                  </button>
                  {/* 状态标签 */}
                  <div className="absolute bottom-2 left-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium backdrop-blur-sm ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                </div>
                <div className="p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{project.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{project.editedAt}</div>
                  </div>
                  <button
                    className="w-6 h-6 rounded flex items-center justify-center hover:bg-surface-container-high transition-colors shrink-0 cursor-pointer"
                    aria-label="更多操作"
                  >
                    <MoreVertical className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              </Link>
            );
          })}
        </div>

        {filteredProjects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FolderOpen className="w-12 h-12 mb-3 opacity-30" />
            <div className="text-sm">没有找到匹配的项目</div>
          </div>
        )}
      </div>

      {/* 从模板创建 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">从模板创建</h2>
          <Link
            href="/templates"
            className="text-sm text-primary font-medium hover:underline flex items-center gap-1 cursor-pointer"
          >
            查看更多
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { name: 'AI人像生成', desc: '高质量人物肖像，支持多风格', img: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=250&fit=crop' },
            { name: '电商商品图', desc: '一键生成多场景商品展示', img: 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=400&h=250&fit=crop' },
            { name: '概念艺术场景', desc: '奇幻科幻场景，快速出图', img: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=250&fit=crop' },
          ].map((tpl) => (
            <div
              key={tpl.name}
              className="bg-card rounded-lg shadow-card overflow-hidden cursor-pointer hover:border-primary/20 hover:scale-[1.02] transition-all border border-transparent"
            >
              <div className="aspect-video overflow-hidden">
                <img src={tpl.img} alt={tpl.name} className="w-full h-full object-cover" />
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold text-foreground">{tpl.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{tpl.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
