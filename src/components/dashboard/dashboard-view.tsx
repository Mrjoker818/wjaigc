'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  FolderOpen, Plus, Search, Star, Trash2, MoreVertical, Image,
  Sparkles, LayoutTemplate, Layers, Clock, ChevronRight, ArrowRight,
  Box, Copy, Check, Palette, Type, BookOpen, Users, Settings,
  LogOut, Shield, X, Eye, Mail, Calendar, KeyRound, Zap, Pencil
} from 'lucide-react';
import { UserManager } from '@/lib/user-manager';
import type { Project, CanvasImage, User, UsageStats } from '@/lib/user-types';

type TabType = 'projects' | 'templates' | 'assets';
type ProjectFilter = 'all' | 'recent' | 'starred';
type AssetSubTab = 'images' | 'prompts' | 'brands';

interface DashboardViewProps {
  user: User;
  onOpenProject: (project: Project) => void;
  onNewProject: () => void;
  onLogout?: () => void;
  onOpenAdmin?: () => void;
  themeStyle?: 'dark' | 'light' | 'gold' | 'monochrome';
}

interface PromptEntry {
  text: string;
  model: string;
  projectName: string;
}

export default function DashboardView({ user, onOpenProject, onNewProject, onLogout, onOpenAdmin, themeStyle = 'dark' }: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('projects');
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [assetTab, setAssetTab] = useState<AssetSubTab>('images');
  const [imageFilter, setImageFilter] = useState<'all' | 'generated' | 'uploaded'>('all');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('wujie-starred-projects') || '[]')); } catch { return new Set(); }
  });
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showUserMenu && !target.closest('[data-user-menu]')) {
        setShowUserMenu(false);
      }
      if (menuOpenId && !target.closest('[data-project-menu]')) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showUserMenu, menuOpenId]);

  // Theme vars
  const isDark = themeStyle === 'dark' || themeStyle === 'gold' || themeStyle === 'monochrome';
  const accentColor = '#d4af37';
  const bg = isDark ? 'bg-[#0a0a0f]' : 'bg-gray-50';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
  const surfaceBg = isDark ? 'bg-[#141420]' : 'bg-white';
  const cardBg = isDark ? 'bg-[#1a1a2e]/80' : 'bg-white';
  const borderClass = isDark ? 'border-primary/20' : 'border-gray-200';
  const accentBg = isDark ? 'bg-[#d4af37]' : 'bg-[#d4af37]';
  const accentBgLight = isDark ? 'bg-[#d4af37]/15' : 'bg-[#d4af37]/10';
  const accentClass = 'text-[#d4af37]';

  // Data
  const mgr = UserManager.getInstance();
  const projects = mgr.getProjects();
  const statsArr: UsageStats[] = mgr.getUsageStats();
  const stats: UsageStats | null = statsArr.length > 0 ? statsArr[statsArr.length - 1] : null;

  const allImages = useMemo(() => {
    const imgs: (CanvasImage & { projectName: string })[] = [];
    projects.forEach((p: Project) => {
      ((p.canvasImages as unknown as CanvasImage[]) || []).forEach((img: CanvasImage) => {
        imgs.push({ ...img, projectName: p.name });
      });
    });
    return imgs;
  }, [projects]);

  const allPrompts: PromptEntry[] = useMemo(() => {
    const prompts: PromptEntry[] = [];
    const seen = new Set<string>();
    projects.forEach((p: Project) => {
      ((p.canvasImages as unknown as CanvasImage[]) || []).forEach((img: CanvasImage) => {
        if (img.prompt && !seen.has(img.prompt)) {
          seen.add(img.prompt);
          prompts.push({ text: img.prompt, model: img.model || '', projectName: p.name });
        }
      });
    });
    return prompts;
  }, [projects]);

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => { setNowTs(Date.now()); }, []);

  const recentActivity = useMemo(() => {
    if (!nowTs) return [];
    function fmtTimeAgo(date: string | number | undefined): string {
      if (!date) return '无时间记录';
      const then = new Date(date).getTime();
      const diff = nowTs - then;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
      return `${Math.floor(diff / 86400000)} 天前`;
    }
    return [...projects]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 4)
      .map(p => ({
        id: p.id,
        name: p.name,
        time: fmtTimeAgo(p.updatedAt),
        imageCount: ((p.canvasImages as unknown as CanvasImage[]) || []).length,
      }));
  }, [projects, nowTs]);

  const filteredProjects = useMemo(() => {
    let list = [...projects];
    if (searchQuery) list = list.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    if (projectFilter === 'recent') list = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
    if (projectFilter === 'starred') list = list.filter(p => starredIds.has(p.id));
    return list;
  }, [projects, searchQuery, projectFilter, starredIds]);

  const filteredImages = useMemo(() => {
    if (imageFilter === 'all') return allImages;
    if (imageFilter === 'generated') return allImages.filter(i => i.model);
    return allImages.filter(i => !i.model);
  }, [allImages, imageFilter]);

  // Handlers
  const toggleStar = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarredIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem('wujie-starred-projects', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (!confirm('确定删除此项目？此操作不可恢复。')) return;
    mgr.deleteProject(id);
    setMenuOpenId(null);
    window.location.reload();
  }, [mgr]);

  const handleUseTemplate = useCallback((template: { name: string }) => {
    const newProject = mgr.createProject(template.name);
    onOpenProject(newProject);
  }, [mgr, onOpenProject]);

  const handleCopyPrompt = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }, []);

  const handleRenameProject = useCallback((projectId: string, currentName: string) => {
    setRenamingProjectId(projectId);
    setRenameValue(currentName);
    setMenuOpenId(null);
  }, []);

  const handleConfirmRename = useCallback(() => {
    if (renamingProjectId && renameValue.trim()) {
      mgr.updateProject(renamingProjectId, { name: renameValue.trim() });
    }
    setRenamingProjectId(null);
    setRenameValue('');
  }, [mgr, renamingProjectId, renameValue]);

  const handleExportProject = useCallback(async (project: Project) => {
    try {
      const content = await mgr.exportProjectToWujie(project.id);
      const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name}.wujie`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('导出项目失败:', err);
    }
    setMenuOpenId(null);
  }, [mgr]);

  // Templates data (product built-in)
  const templates = [
    { id: 'brand-logo', name: '品牌Logo设计', desc: '多场景Logo生成与变体', category: '品牌设计', image: 'https://images.unsplash.com/photo-1626785774625-ddcddc3445e9?w=400&h=250&fit=crop', usage: '2.1k' },
    { id: 'ecommerce', name: '电商商品主图', desc: '白底/场景/细节三视图', category: '电商图', image: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&h=250&fit=crop', usage: '1.8k' },
    { id: 'poster', name: '创意海报生成', desc: '活动推广海报设计', category: '创意海报', image: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=400&h=250&fit=crop', usage: '3.5k' },
    { id: 'portrait', name: '人物肖像精修', desc: 'AI人像美化与风格化', category: '人物肖像', image: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=250&fit=crop', usage: '1.2k' },
    { id: 'concept', name: '概念场景设计', desc: '科幻/奇幻场景生成', category: '概念场景', image: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=250&fit=crop', usage: '980' },
    { id: 'social', name: '社交媒体套图', desc: '多平台适配图组', category: '社交媒体', image: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&h=250&fit=crop', usage: '2.4k' },
    { id: 'mockup', name: '产品样机展示', desc: 'Mockup场景化展示', category: '电商图', image: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=400&h=250&fit=crop', usage: '760' },
    { id: 'ip-char', name: 'IP角色设计', desc: '从草稿到三视图', category: '品牌设计', image: 'https://images.unsplash.com/photo-1608889825103-eb5ed706fc64?w=400&h=250&fit=crop', usage: '540' },
  ];

  // Brand assets (mock for now, would come from user data)
  const brands = [
    { id: '1', name: 'TechVision', color: '#4A90D9', keywords: ['科技', '创新', '未来感'] },
    { id: '2', name: 'GreenLeaf', color: '#4CAF50', keywords: ['自然', '有机', '环保'] },
  ];

  // =================== RENDER ===================
  return (
    <div className="h-screen w-screen flex overflow-hidden">
      {/* ===== Sidebar ===== */}
      <aside className={`w-[260px] shrink-0 flex flex-col ${isDark ? 'bg-[#0e0e1a]' : 'bg-white'} border-r ${isDark ? 'border-white/5' : 'border-gray-200'} overflow-hidden`}>
        {/* User info */}
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 cursor-pointer hover:ring-2 hover:ring-[#d4af37]/40 transition-all"
              style={{ backgroundColor: accentColor }}
              onClick={() => setShowUserProfile(!showUserProfile)}
              title="查看用户信息"
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-semibold truncate ${textPrimary}`}>{user.name}</div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                  user.role === 'admin'
                    ? `${accentBgLight} ${accentClass}`
                    : isDark ? 'bg-white/5 text-gray-500' : 'bg-gray-100 text-gray-500'
                }`}>
                  {user.role === 'admin' ? '管理员' : '创作者'}
                </span>
              </div>
            </div>
            <div className="relative" data-user-menu>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} transition-colors cursor-pointer`}
              >
                <Settings className={`w-4 h-4 ${textSecondary}`} />
              </button>
              {showUserMenu && (
                <div className={`absolute right-0 top-8 ${cardBg} rounded-xl shadow-2xl py-2 z-50 min-w-[180px] border ${borderClass}`}>
                  <button
                    onClick={() => { setShowUserMenu(false); setShowUserProfile(true); }}
                    className={`w-full px-4 py-2 text-left text-xs flex items-center gap-2 ${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} cursor-pointer`}
                  >
                    <Users className="w-3.5 h-3.5" /> 个人信息
                  </button>
                  {user.role === 'admin' && (
                    <button
                      onClick={() => { setShowUserMenu(false); if (onOpenAdmin) onOpenAdmin(); }}
                      className={`w-full px-4 py-2 text-left text-xs flex items-center gap-2 ${accentClass} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} cursor-pointer`}
                    >
                      <Shield className="w-3.5 h-3.5" /> 管理员面板
                    </button>
                  )}
                  <div className={`my-1 border-t ${isDark ? 'border-white/5' : 'border-gray-100'}`} />
                  <button
                    onClick={() => { setShowUserMenu(false); if (onLogout) onLogout(); }}
                    className="w-full px-4 py-2 text-left text-xs flex items-center gap-2 text-red-400 hover:bg-red-500/10 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" /> 退出登录
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* User profile expandable */}
          {showUserProfile && (
            <div className={`mt-3 rounded-xl p-3 space-y-2.5 ${isDark ? 'bg-[#12121e] border border-white/5' : 'bg-gray-50 border border-gray-100'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] uppercase tracking-wider font-semibold ${textSecondary}`}>账户信息</span>
                <button
                  onClick={() => setShowUserProfile(false)}
                  className={`p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-200'}`}
                >
                  <X className={`w-3 h-3 ${textSecondary}`} />
                </button>
              </div>
              <div className={`text-[11px] space-y-1.5 ${textSecondary}`}>
                <div className="flex items-center gap-2">
                  <Mail className="w-3 h-3 shrink-0" />
                  <span className="truncate">{user.email || '未设置邮箱'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span>加入于 {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '未知'}</span>
                </div>
              </div>
              {/* API Permissions */}
              <div>
                <div className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${textSecondary}`}>功能权限</div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { key: 'image', label: '图像', icon: '🎨' },
                    { key: 'chat', label: '对话', icon: '💬' },
                    { key: 'threeD', label: '3D', icon: '🧊' },
                    { key: 'imageEdit', label: '编辑', icon: '✏️' },
                    { key: 'vectorize', label: '矢量', icon: '📐' },
                    { key: 'layer', label: '分层', icon: '🗂️' },
                  ].map(perm => {
                    const enabled = user.apiPermissions?.[perm.key as keyof typeof user.apiPermissions] ?? false;
                    return (
                      <span key={perm.key} className={`text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-1 ${
                        enabled
                          ? `${accentBgLight} ${accentClass}`
                          : isDark ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-300'
                      }`}>
                        <span>{perm.icon}</span>
                        <span>{perm.label}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
              {/* Admin badge */}
              {user.role === 'admin' && (
                <button
                  onClick={() => { setShowUserProfile(false); if (onOpenAdmin) onOpenAdmin(); }}
                  className={`w-full text-xs font-medium flex items-center justify-center gap-2 rounded-lg px-3 py-2 ${accentBgLight} ${accentClass} hover:opacity-80 transition-opacity cursor-pointer`}
                >
                  <Shield className="w-3.5 h-3.5" /> 打开管理员面板
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-1 min-h-0 overflow-y-auto">
          {[
            { key: 'projects' as TabType, label: '我的项目', icon: FolderOpen, count: projects.length },
            { key: 'templates' as TabType, label: '模板广场', icon: LayoutTemplate, count: null },
            { key: 'assets' as TabType, label: '资产库', icon: Layers, count: allImages.length },
          ].map(item => (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                activeTab === item.key
                  ? `${accentBgLight} ${accentClass}`
                  : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`
              }`}
            >
              <item.icon className="w-4.5 h-4.5" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.count !== null && (
                <span className={`text-xs ${activeTab === item.key ? accentClass : textSecondary}`}>
                  {item.count}
                </span>
              )}
            </button>
          ))}

          {/* Admin Section */}
          {user.role === 'admin' && (
            <>
              <div className={`text-[10px] uppercase tracking-wider font-semibold mt-3 mb-1 px-1 ${textSecondary}`}>管理员</div>
              <button
                onClick={() => { if (onOpenAdmin) onOpenAdmin(); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${isDark ? 'text-[#d4af37]/70 hover:bg-[#d4af37]/10' : 'text-[#b8860b] hover:bg-[#d4af37]/10'}`}
              >
                <Shield className="w-4.5 h-4.5" />
                <span className="flex-1 text-left">管理员面板</span>
              </button>
            </>
          )}
        </nav>

        {/* Recent Activity */}
        <div className="px-3 pb-2 overflow-y-auto min-h-0">
          <div className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${textSecondary}`}>创作动态</div>
          <div className="space-y-0.5">
            {recentActivity.slice(0, 4).map(a => (
              <button
                key={a.id}
                onClick={() => {
                  const p = projects.find((pr: Project) => pr.id === a.id);
                  if (p) onOpenProject(p);
                }}
                className={`w-full text-left px-2.5 py-2 rounded-lg ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} transition-colors cursor-pointer group`}
              >
                <div className={`text-xs font-medium truncate group-hover:text-[#d4af37] transition-colors ${textPrimary}`}>{a.name}</div>
                <div className={`text-[10px] ${textSecondary} mt-0.5`}>{a.time}</div>
              </button>
            ))}
            {recentActivity.length === 0 && (
              <div className={`text-[10px] ${textSecondary} px-2.5 py-2`}>暂无动态</div>
            )}
          </div>
        </div>

        {/* Quick Create */}
        <div className="p-3">
          <button
            onClick={onNewProject}
            className={`w-full ${accentBg} text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer`}
          >
            <Plus className="w-4 h-4" /> 新建项目
          </button>
        </div>
      </aside>

      {/* ===== Main Content ===== */}
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-6 space-y-6">

          {/* ===== Projects Tab ===== */}
          {activeTab === 'projects' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={`text-2xl font-bold flex items-center gap-2.5 ${textPrimary}`}>
                    <Sparkles className="w-6 h-6" style={{ color: accentColor }} />
                    欢迎回来，{user.name}
                  </h1>
                  <p className={`text-sm mt-1 ${textSecondary}`}>你的创作工作台</p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: '项目总数', value: projects.length, icon: FolderOpen, color: accentColor },
                  { label: '图片总数', value: allImages.length, icon: Image, color: '#22c55e' },
                  { label: '本月生成', value: stats?.imagesGenerated || 0, icon: Sparkles, color: '#f59e0b' },
                ].map((s, i) => (
                  <div key={i} className={`${cardBg} rounded-xl p-5 flex items-center gap-4 ${isDark ? 'border border-white/5' : 'border border-gray-100'}`}>
                    <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ backgroundColor: s.color + '18' }}>
                      <s.icon className="w-5 h-5" style={{ color: s.color }} />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{s.value}</div>
                      <div className={`text-xs ${textSecondary}`}>{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Search + Filter */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
                  <input
                    type="text"
                    placeholder="搜索项目..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`w-full ${surfaceBg} ${textPrimary} pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none focus:ring-2 ${isDark ? 'border border-white/10' : 'border border-gray-200'}`}
                    style={{ '--tw-ring-color': accentColor + '40' } as React.CSSProperties}
                  />
                </div>
                <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: isDark ? '#141420' : '#f3f4f6' }}>
                  {([
                    { key: 'all' as ProjectFilter, label: '全部' },
                    { key: 'recent' as ProjectFilter, label: '最近' },
                    { key: 'starred' as ProjectFilter, label: '收藏' },
                  ]).map(f => (
                    <button
                      key={f.key}
                      onClick={() => setProjectFilter(f.key)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        projectFilter === f.key
                          ? `${accentBgLight} ${accentClass}`
                          : `${textSecondary} ${isDark ? 'hover:text-white' : 'hover:text-gray-900'}`
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              {recentActivity.length > 0 && projectFilter === 'all' && (
                <div>
                  <h3 className={`text-xs font-semibold mb-3 flex items-center gap-2 uppercase tracking-wider ${textSecondary}`}>
                    <Clock className="w-3.5 h-3.5" /> 最近动态
                  </h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {recentActivity.map(a => {
                      const proj = projects.find((p: Project) => p.id === a.id);
                      const imgs = (proj?.canvasImages as unknown as CanvasImage[]) || [];
                      const thumb = imgs.length > 0 ? imgs[imgs.length - 1].url : '';
                      return (
                        <div
                          key={a.id}
                          onClick={() => {
                            const p = projects.find((pr: Project) => pr.id === a.id);
                            if (p) onOpenProject(p);
                          }}
                          className={`${cardBg} rounded-xl p-3 cursor-pointer ${isDark ? 'border border-white/5 hover:border-[#d4af37]/30' : 'border border-gray-100 hover:border-[#d4af37]/50'} transition-all group`}
                        >
                          {thumb && (
                            <div className="aspect-[16/9] rounded-lg overflow-hidden mb-2">
                              <img src={thumb} alt={a.name} className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="font-medium text-sm truncate group-hover:text-[#d4af37] transition-colors">{a.name}</div>
                          <div className={`text-xs mt-0.5 ${textSecondary}`}>{a.time} · {a.imageCount} 张图片</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Project Grid */}
              {filteredProjects.length > 0 ? (
                <div>
                  <h3 className={`text-xs font-semibold mb-3 uppercase tracking-wider ${textSecondary}`}>
                    所有项目 ({filteredProjects.length})
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {filteredProjects.map(project => {
                      const images = (project.canvasImages as unknown as CanvasImage[]) || [];
                      const thumb = images.length > 0 ? images[images.length - 1].url : '';
                      const isStarred = starredIds.has(project.id);
                      return (
                        <div
                          key={project.id}
                          onClick={() => onOpenProject(project)}
                          className={`${cardBg} rounded-xl overflow-hidden cursor-pointer group ${isDark ? 'border border-white/5 hover:border-[#d4af37]/30' : 'border border-gray-100 hover:border-[#d4af37]/50'} transition-all hover:scale-[1.02]`}
                        >
                          {/* Thumbnail */}
                          <div className="relative aspect-[16/10] overflow-hidden">
                            {thumb ? (
                              <img src={thumb} alt={project.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            ) : (
                              <div className={`w-full h-full ${surfaceBg} flex items-center justify-center`}>
                                <FolderOpen className={`w-8 h-8 ${textSecondary}`} />
                              </div>
                            )}
                            {/* Star */}
                            <button
                              onClick={(e) => toggleStar(project.id, e)}
                              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 flex items-center justify-center hover:bg-black/60 transition-colors cursor-pointer"
                            >
                              <Star className={`w-3.5 h-3.5 ${isStarred ? 'text-[#d4af37] fill-[#d4af37]' : 'text-white/70'}`} />
                            </button>
                            {/* Image count badge */}
                            {images.length > 0 && (
                              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/50 text-white text-xs flex items-center gap-1">
                                <Image className="w-3 h-3" /> {images.length}
                              </div>
                            )}
                          </div>
                          {/* Info */}
                          <div className="p-3 flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              {renamingProjectId === project.id ? (
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleConfirmRename();
                                    if (e.key === 'Escape') { setRenamingProjectId(null); setRenameValue(''); }
                                  }}
                                  onBlur={handleConfirmRename}
                                  autoFocus
                                  className={`w-full text-sm font-medium bg-transparent outline-none border-b ${isDark ? 'border-[#d4af37]' : 'border-[#b8860b]'} ${textPrimary}`}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <div className="font-medium text-sm truncate">{project.name}</div>
                              )}
                              <div className={`text-xs mt-0.5 ${textSecondary}`}>
                                {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '无时间记录'}
                              </div>
                            </div>
                            <div className="relative">
                              <button
                                onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === project.id ? null : project.id); }}
                                className={`p-1 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'} cursor-pointer`}
                              >
                                <MoreVertical className={`w-4 h-4 ${textSecondary}`} />
                              </button>
                              {menuOpenId === project.id && (
                                <div className={`absolute right-0 top-6 ${cardBg} rounded-lg shadow-xl py-1 z-10 min-w-[140px] border ${borderClass}`}>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRenameProject(project.id, project.name); }}
                                    className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 ${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} cursor-pointer`}
                                  >
                                    <Pencil className="w-3 h-3" /> 重命名
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void handleExportProject(project); }}
                                    className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 ${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} cursor-pointer`}
                                  >
                                    <Box className="w-3 h-3" /> 导出项目
                                  </button>
                                  <div className={`my-1 border-t ${isDark ? 'border-white/5' : 'border-gray-100'}`} />
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }}
                                    className="w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" /> 删除项目
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className={`${cardBg} rounded-xl p-16 text-center ${isDark ? 'border border-white/5' : 'border border-gray-100'}`}>
                  <FolderOpen className={`w-16 h-16 mx-auto mb-4 ${textSecondary}`} />
                  <p className={`text-lg font-medium ${textSecondary}`}>
                    {searchQuery ? '没有找到匹配的项目' : '还没有项目'}
                  </p>
                  <p className={`text-sm mt-1 ${textSecondary}`}>
                    {searchQuery ? '试试其他关键词' : '创建你的第一个项目，开始AI创作之旅'}
                  </p>
                  {!searchQuery && (
                    <button
                      onClick={onNewProject}
                      className={`${accentBg} text-white px-6 py-2.5 rounded-xl text-sm mt-6 inline-flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity`}
                    >
                      <Plus className="w-4 h-4" /> 新建项目
                    </button>
                  )}
                </div>
              )}

              {/* Quick: Templates */}
              <div className={`${isDark ? 'border-t border-white/5' : 'border-t border-gray-200'} pt-6`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`text-xs font-semibold flex items-center gap-2 uppercase tracking-wider ${textSecondary}`}>
                    <LayoutTemplate className="w-3.5 h-3.5" /> 从模板开始
                  </h3>
                  <button onClick={() => setActiveTab('templates')} className={`text-xs ${accentClass} hover:underline cursor-pointer flex items-center gap-1`}>
                    查看更多 <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {templates.slice(0, 4).map(t => (
                    <div
                      key={t.id}
                      onClick={() => handleUseTemplate(t)}
                      className={`${cardBg} rounded-xl overflow-hidden cursor-pointer ${isDark ? 'border border-white/5 hover:border-[#d4af37]/30' : 'border border-gray-100 hover:border-[#d4af37]/50'} transition-all group`}
                    >
                      <div className="aspect-[16/10] overflow-hidden">
                        <img src={t.image} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      </div>
                      <div className="p-2.5">
                        <div className="text-xs font-medium truncate">{t.name}</div>
                        <div className={`text-[10px] mt-0.5 ${textSecondary} truncate`}>{t.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ===== Templates Tab ===== */}
          {activeTab === 'templates' && (
            <div className="space-y-6">
              {/* Header */}
              <div>
                <h1 className={`text-2xl font-bold flex items-center gap-2.5 ${textPrimary}`}>
                  <LayoutTemplate className="w-6 h-6" style={{ color: accentColor }} />
                  模板广场
                </h1>
                <p className={`text-sm mt-1 ${textSecondary}`}>选择模板，快速开始创作</p>
              </div>

              {/* Search */}
              <div className="relative max-w-md">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
                <input
                  type="text"
                  placeholder="搜索模板..."
                  className={`w-full ${surfaceBg} ${textPrimary} pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none focus:ring-2 ${isDark ? 'border border-white/10' : 'border border-gray-200'}`}
                  style={{ '--tw-ring-color': accentColor + '40' } as React.CSSProperties}
                />
              </div>

              {/* Featured */}
              <div>
                <h3 className={`text-xs font-semibold mb-3 flex items-center gap-2 uppercase tracking-wider ${textSecondary}`}>
                  <Sparkles className="w-3.5 h-3.5" style={{ color: accentColor }} /> 精选推荐
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className={`${cardBg} rounded-xl overflow-hidden cursor-pointer group ${isDark ? 'border border-white/5 hover:border-[#d4af37]/30' : 'border border-gray-100 hover:border-[#d4af37]/50'} transition-all`}>
                    <div className="aspect-[16/9] overflow-hidden">
                      <img src="https://images.unsplash.com/photo-1626785774625-ddcddc3445e9?w=600&h=340&fit=crop" alt="品牌设计全流程" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    </div>
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`${accentBgLight} ${accentClass} text-xs px-2.5 py-0.5 rounded-md font-semibold`}>精选</span>
                        <span className={`text-xs ${textSecondary}`}>品牌设计</span>
                      </div>
                      <h4 className="font-semibold text-lg">品牌设计全流程</h4>
                      <p className={`text-sm mt-1 ${textSecondary}`}>从Logo生成到品牌视觉体系，一站式品牌设计工作流</p>
                      <button
                        onClick={() => handleUseTemplate({ name: '品牌设计全流程' })}
                        className={`${accentBg} text-white px-5 py-2 rounded-xl text-sm mt-4 inline-flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity`}
                      >
                        立即使用 <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {templates.slice(1, 3).map(t => (
                      <div
                        key={t.id}
                        onClick={() => handleUseTemplate(t)}
                        className={`${cardBg} rounded-xl overflow-hidden cursor-pointer ${isDark ? 'border border-white/5 hover:border-[#d4af37]/30' : 'border border-gray-100 hover:border-[#d4af37]/50'} transition-all flex group`}
                      >
                        <div className="w-[140px] shrink-0 overflow-hidden">
                          <img src={t.image} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        </div>
                        <div className="flex-1 p-4 flex flex-col justify-center">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`${accentBgLight} ${accentClass} text-[10px] px-2 py-0.5 rounded font-semibold`}>精选</span>
                          </div>
                          <h4 className="font-medium">{t.name}</h4>
                          <p className={`text-xs mt-1 ${textSecondary} line-clamp-2`}>{t.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* All Templates */}
              <div>
                <h3 className={`text-xs font-semibold mb-3 uppercase tracking-wider ${textSecondary}`}>
                  全部模板 ({templates.length})
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {templates.map(t => (
                    <div
                      key={t.id}
                      onClick={() => handleUseTemplate(t)}
                      className={`${cardBg} rounded-xl overflow-hidden cursor-pointer ${isDark ? 'border border-white/5 hover:border-[#d4af37]/30' : 'border border-gray-100 hover:border-[#d4af37]/50'} transition-all group`}
                    >
                      <div className="aspect-[16/10] overflow-hidden relative">
                        <img src={t.image} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        <span className={`absolute top-2 left-2 ${isDark ? 'bg-black/60' : 'bg-white/80'} text-[10px] px-2 py-0.5 rounded-md font-medium ${textSecondary}`}>
                          {t.category}
                        </span>
                      </div>
                      <div className="p-3">
                        <h4 className="font-medium text-sm truncate">{t.name}</h4>
                        <p className={`text-xs mt-0.5 ${textSecondary} line-clamp-1`}>{t.desc}</p>
                        <div className="flex items-center justify-between mt-2.5">
                          <span className={`text-[10px] ${textSecondary}`}>{t.usage} 人使用</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleUseTemplate(t); }}
                            className={`${accentBgLight} ${accentClass} text-xs px-3 py-1 rounded-lg font-medium hover:opacity-80 transition-opacity cursor-pointer`}
                          >
                            使用模板
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI Build Entry */}
              <div className={`${cardBg} rounded-xl p-8 text-center ${isDark ? 'border border-white/5' : 'border border-gray-100'}`}>
                <Box className="w-10 h-10 mx-auto mb-3" style={{ color: accentColor }} />
                <p className="text-base font-medium">没有找到合适的模板？</p>
                <p className={`text-sm mt-1 ${textSecondary}`}>试试AI智能建图，用自然语言描述你的需求</p>
                <button
                  onClick={onNewProject}
                  className={`${accentBg} text-white px-6 py-2.5 rounded-xl text-sm mt-4 inline-flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity`}
                >
                  <Sparkles className="w-4 h-4" /> AI智能建图
                </button>
              </div>
            </div>
          )}

          {/* ===== Assets Tab ===== */}
          {activeTab === 'assets' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={`text-2xl font-bold flex items-center gap-2.5 ${textPrimary}`}>
                    <Layers className="w-6 h-6" style={{ color: accentColor }} />
                    资产库
                  </h1>
                  <p className={`text-sm mt-1 ${textSecondary}`}>管理你的创作素材和提示词</p>
                </div>
              </div>

              {/* Sub-tabs */}
              <div className="flex gap-2 p-1 rounded-xl" style={{ backgroundColor: isDark ? '#141420' : '#f3f4f6' }}>
                {([
                  { key: 'images' as AssetSubTab, label: '图片素材', icon: Image, count: allImages.length },
                  { key: 'prompts' as AssetSubTab, label: '提示词库', icon: BookOpen, count: allPrompts.length },
                  { key: 'brands' as AssetSubTab, label: '品牌资产', icon: Palette, count: brands.length },
                ]).map(sub => (
                  <button
                    key={sub.key}
                    onClick={() => setAssetTab(sub.key)}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                      assetTab === sub.key
                        ? `${accentBgLight} ${accentClass}`
                        : `${textSecondary} ${isDark ? 'hover:text-white' : 'hover:text-gray-900'}`
                    }`}
                  >
                    <sub.icon className="w-4 h-4" />
                    {sub.label}
                    {sub.count > 0 && (
                      <span className={`text-xs ${assetTab === sub.key ? accentClass : textSecondary}`}>
                        {sub.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Images Sub-tab */}
              {assetTab === 'images' && (
                <div className="space-y-4">
                  {/* Filter row */}
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: isDark ? '#141420' : '#f3f4f6' }}>
                      {(['all', 'generated', 'uploaded'] as const).map(f => (
                        <button
                          key={f}
                          onClick={() => setImageFilter(f)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                            imageFilter === f ? `${accentBgLight} ${accentClass}` : textSecondary
                          }`}
                        >
                          {f === 'all' ? '全部' : f === 'generated' ? 'AI生成' : '上传图片'}
                        </button>
                      ))}
                    </div>
                    <span className={`text-xs ${textSecondary} ml-auto`}>{filteredImages.length} 张图片</span>
                  </div>

                  {/* Image Grid */}
                  {filteredImages.length > 0 ? (
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                      {filteredImages.map((img, i) => (
                        <div
                          key={img.id || i}
                          className={`group relative aspect-square rounded-xl overflow-hidden ${cardBg} ${isDark ? 'border border-white/5' : 'border border-gray-100'} cursor-pointer`}
                        >
                          <img src={img.url} alt="" className="w-full h-full object-cover" />
                          {/* Hover overlay */}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(img.url, '_blank');
                              }}
                              className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center cursor-pointer hover:bg-white/30 transition-colors"
                              title="查看大图"
                            >
                              <Eye className="w-4 h-4 text-white" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const a = document.createElement('a');
                                a.href = img.url;
                                a.download = `image-${i}.png`;
                                a.click();
                              }}
                              className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center cursor-pointer hover:bg-white/30 transition-colors"
                              title="下载"
                            >
                              <Image className="w-4 h-4 text-white" />
                            </button>
                          </div>
                          {/* Source badge */}
                          {img.model && (
                            <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/50 text-white text-[10px] font-medium">
                              AI生成
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`${cardBg} rounded-xl p-16 text-center ${isDark ? 'border border-white/5' : 'border border-gray-100'}`}>
                      <Image className={`w-14 h-14 mx-auto mb-4 ${textSecondary}`} />
                      <p className={`text-base font-medium ${textSecondary}`}>暂无图片素材</p>
                      <p className={`text-sm mt-1 ${textSecondary}`}>创建项目并生成图片后，素材会自动出现在这里</p>
                    </div>
                  )}
                </div>
              )}

              {/* Prompts Sub-tab */}
              {assetTab === 'prompts' && (
                <div className="space-y-3">
                  {allPrompts.length > 0 ? (
                    allPrompts.map((p, i) => (
                      <div key={i} className={`${cardBg} rounded-xl p-5 ${isDark ? 'border border-white/5' : 'border border-gray-100'} group`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-relaxed break-all">{p.text}</p>
                            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                              {p.model && (
                                <span className={`${accentBgLight} ${accentClass} text-[10px] px-2 py-0.5 rounded-md font-medium`}>
                                  {p.model.length > 24 ? p.model.slice(0, 24) + '...' : p.model}
                                </span>
                              )}
                              <span className={`text-[10px] ${textSecondary} flex items-center gap-1`}>
                                <FolderOpen className="w-3 h-3" /> {p.projectName}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleCopyPrompt(p.text, i)}
                            className={`shrink-0 px-4 py-2 rounded-lg text-xs font-medium ${isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-gray-100 hover:bg-gray-200'} ${copiedIdx === i ? accentClass : textSecondary} transition-colors cursor-pointer flex items-center gap-1.5`}
                          >
                            {copiedIdx === i ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            {copiedIdx === i ? '已复制' : '复制'}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className={`${cardBg} rounded-xl p-16 text-center ${isDark ? 'border border-white/5' : 'border border-gray-100'}`}>
                      <BookOpen className={`w-14 h-14 mx-auto mb-4 ${textSecondary}`} />
                      <p className={`text-base font-medium ${textSecondary}`}>暂无提示词</p>
                      <p className={`text-sm mt-1 ${textSecondary}`}>在项目中生成图片后，提示词会自动保存在这里</p>
                    </div>
                  )}
                </div>
              )}

              {/* Brands Sub-tab */}
              {assetTab === 'brands' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {brands.map(b => (
                      <div key={b.id} className={`${cardBg} rounded-xl p-5 ${isDark ? 'border border-white/5' : 'border border-gray-100'}`}>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: b.color }}>
                            {b.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm">{b.name}</div>
                            <div className={`text-[10px] ${textSecondary}`}>品牌资产</div>
                          </div>
                          <button className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} cursor-pointer`}>
                            <MoreVertical className={`w-4 h-4 ${textSecondary}`} />
                          </button>
                        </div>
                        {/* Color swatch */}
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-5 h-5 rounded-md" style={{ backgroundColor: b.color }} />
                          <span className={`text-xs ${textSecondary} font-mono`}>{b.color}</span>
                        </div>
                        {/* Keywords */}
                        <div className="flex flex-wrap gap-1.5">
                          {b.keywords.map(k => (
                            <span key={k} className={`text-[10px] px-2 py-0.5 rounded-md ${isDark ? 'bg-white/5' : 'bg-gray-100'} ${textSecondary}`}>
                              {k}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    {/* Create brand card */}
                    <div
                      className={`rounded-xl p-5 border-2 border-dashed ${isDark ? 'border-[#d4af37]/30' : 'border-[#d4af37]/40'} flex flex-col items-center justify-center gap-2 cursor-pointer hover:${isDark ? 'border-[#d4af37]/60' : 'border-[#d4af37]/70'} transition-colors min-h-[160px]`}
                    >
                      <Plus className="w-6 h-6" style={{ color: accentColor }} />
                      <span className={`text-sm ${accentClass}`}>创建品牌</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
