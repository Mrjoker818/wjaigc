'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { UserManager } from '@/lib/user-manager';
import type { Project, UsageStats } from '@/lib/user-types';
import {
  FolderOpen, Image, Sparkles, Search, Plus, Star, MoreHorizontal,
  Clock, LayoutGrid, ArrowRight, FolderPlus
} from 'lucide-react';

type FilterType = 'all' | 'recent' | 'favorite';

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function getProjectThumbnail(project: Project): string {
  if (project.canvasImages && project.canvasImages.length > 0) {
    return project.canvasImages[0].url;
  }
  return '';
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats[]>([]);
  const [totalImages, setTotalImages] = useState(0);
  const [monthImages, setMonthImages] = useState(0);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('wujie-favorites');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const loadData = useCallback(() => {
    const um = UserManager.getInstance();
    const allProjects = um.getProjects();
    setProjects(allProjects);

    // 计算图片总数
    const imgCount = allProjects.reduce(
      (acc, p) => acc + (p.canvasImages?.length || 0), 0
    );
    setTotalImages(imgCount);

    // 获取使用统计
    const stats = um.getUsageStats(30);
    setUsageStats(stats);
    const monthTotal = stats.reduce((acc, s) => acc + s.imagesGenerated, 0);
    setMonthImages(monthTotal);
  }, []);

  useEffect(() => {
    loadData();
    // 定期刷新（其他tab可能修改了数据）
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const toggleFavorite = (projectId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      localStorage.setItem('wujie-favorites', JSON.stringify([...next]));
      return next;
    });
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    const um = UserManager.getInstance();
    const project = um.createProject(newProjectName.trim());
    router.push(`/?projectId=${project.id}`);
  };

  const handleDeleteProject = (projectId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('确定要删除此项目吗？此操作不可撤销。')) return;
    const um = UserManager.getInstance();
    um.deleteProject(projectId);
    loadData();
  };

  // 筛选和搜索
  let filteredProjects = [...projects];

  if (filter === 'recent') {
    filteredProjects.sort((a, b) => b.updatedAt - a.updatedAt);
    filteredProjects = filteredProjects.slice(0, 10);
  } else if (filter === 'favorite') {
    filteredProjects = filteredProjects.filter(p => favorites.has(p.id));
  } else {
    filteredProjects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredProjects = filteredProjects.filter(
      p => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
    );
  }

  const recentProjects = [...projects]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* 顶部标题区 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">我的项目</h1>
          <p className="text-sm text-muted-foreground mt-1">管理你的创作项目</p>
        </div>
        <button
          onClick={() => setShowNewProject(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          新建项目
        </button>
      </div>

      {/* 搜索与筛选 */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索项目名称..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
        </div>
        <div className="flex gap-2">
          {([['all', '全部'], ['recent', '最近'], ['favorite', '收藏']] as [FilterType, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-4 py-2 text-sm rounded-lg transition-all cursor-pointer ${
                filter === key
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="flex items-center gap-4 p-4 bg-card rounded-xl border border-border shadow-card">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FolderOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">{projects.length}</div>
            <div className="text-xs text-muted-foreground">项目总数</div>
          </div>
        </div>
        <div className="flex items-center gap-4 p-4 bg-card rounded-xl border border-border shadow-card">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Image className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">{totalImages}</div>
            <div className="text-xs text-muted-foreground">图片总数</div>
          </div>
        </div>
        <div className="flex items-center gap-4 p-4 bg-card rounded-xl border border-border shadow-card">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">{monthImages}</div>
            <div className="text-xs text-muted-foreground">本月生成</div>
          </div>
        </div>
      </div>

      {/* 最近编辑 */}
      {recentProjects.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              最近编辑
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {recentProjects.map((project) => {
              const thumb = getProjectThumbnail(project);
              return (
                <Link
                  key={project.id}
                  href={`/?projectId=${project.id}`}
                  className="group flex items-center gap-3 p-3 bg-card rounded-xl border border-border hover:border-primary/30 shadow-card hover:shadow-lg transition-all cursor-pointer"
                >
                  <div className="w-16 h-12 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                    {thumb ? (
                      <img src={thumb} alt={project.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <FolderOpen className="w-5 h-5 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{project.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {project.canvasImages?.length || 0} 张图片 · {formatTime(project.updatedAt)}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/0 group-hover:text-primary transition-colors" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 项目网格 */}
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
          <LayoutGrid className="w-5 h-5 text-primary" />
          所有项目
          <span className="text-sm font-normal text-muted-foreground">({filteredProjects.length})</span>
        </h2>

        {filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="w-16 h-16 text-muted-foreground/20 mb-4" />
            <p className="text-muted-foreground text-lg mb-2">
              {searchQuery ? '没有找到匹配的项目' : '还没有项目'}
            </p>
            <p className="text-muted-foreground/60 text-sm mb-6">
              {searchQuery ? '试试其他关键词' : '创建你的第一个项目，开始创作之旅'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowNewProject(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-all cursor-pointer"
              >
                <FolderPlus className="w-4 h-4" />
                新建项目
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredProjects.map((project) => {
              const thumb = getProjectThumbnail(project);
              const isFav = favorites.has(project.id);
              const imgCount = project.canvasImages?.length || 0;

              return (
                <div
                  key={project.id}
                  onClick={() => router.push(`/?projectId=${project.id}`)}
                  className="group relative bg-card rounded-xl border border-border hover:border-primary/30 shadow-card hover:shadow-lg transition-all cursor-pointer overflow-hidden"
                >
                  {/* 缩略图 */}
                  <div className="aspect-[16/10] bg-muted overflow-hidden relative">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={project.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <FolderOpen className="w-10 h-10 text-muted-foreground/20" />
                      </div>
                    )}
                    {/* 收藏按钮 */}
                    <button
                      onClick={(e) => toggleFavorite(project.id, e)}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors cursor-pointer"
                    >
                      <Star className={`w-3.5 h-3.5 ${isFav ? 'text-primary fill-primary' : 'text-white/70'}`} />
                    </button>
                    {/* 图片数 */}
                    {imgCount > 0 && (
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/50 backdrop-blur-sm text-[10px] text-white/80 flex items-center gap-1">
                        <Image className="w-3 h-3" />
                        {imgCount}
                      </div>
                    )}
                  </div>

                  {/* 项目信息 */}
                  <div className="p-3.5 flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-foreground truncate">{project.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatTime(project.updatedAt)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleDeleteProject(project.id, e)}
                      className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                      title="删除项目"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 新建项目弹窗 */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-float p-6 w-full max-w-md border border-border">
            <h2 className="text-lg font-semibold text-foreground mb-4">新建项目</h2>
            <input
              type="text"
              placeholder="输入项目名称"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject(); }}
              autoFocus
              className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowNewProject(false); setNewProjectName(''); }}
                className="px-4 py-2 text-sm bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                创建并打开
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
