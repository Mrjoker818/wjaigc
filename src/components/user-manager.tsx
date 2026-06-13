'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User, Project, UsageStats } from '@/lib/user-types';
import { UserManager as UserManagerCore } from '@/lib/user-manager';
import { APP_VERSION_LABEL } from '@/config/app-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PromptDialog, ConfirmDialog, TextareaDialog } from '@/components/custom-dialogs';
import {
  User as UserIcon,
  Folder,
  Plus,
  Trash2,
  Upload,
  Settings,
  BarChart3,
  LogOut,
  Play,
  FileText,
  X,
  ChevronRight,
  Clock,
  Zap,
  Eye,
  EyeOff,
  Pencil,
  MessageSquareText,
} from 'lucide-react';

interface UserManagerProps {
  themeStyle?: 'gold' | 'monochrome';
  onLogin?: (user: User) => void;
  onLogout?: () => void;
  onSelectProject?: (project: Project) => void;
  onClose?: () => void;
  /** Current canvas image count - used to override stale project data */
  currentImageCount?: number;
  /** Current project ID being worked on */
  currentProjectId?: string;
}

export function UserManager({ themeStyle = 'gold', onLogin, onLogout, onSelectProject, onClose, currentImageCount, currentProjectId }: UserManagerProps) {
  const userManager = useMemo(() => UserManagerCore.getInstance(), []);
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats[]>([]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [activeTab, setActiveTab] = useState<'projects' | 'credits' | 'stats' | 'settings'>('projects');
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [loginName, setLoginName] = useState('Mr.joker');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const importProjectInputRef = useRef<HTMLInputElement>(null);
  const isGold = themeStyle === 'gold';

  // Credits state
  const [credits, setCredits] = useState<{ balance: number; totalRecharged: number; totalUsed: number } | null>(null);
  const [creditTransactions, setCreditTransactions] = useState<Array<{ id: string; type: string; amount: number; balanceAfter: number; description: string | null; createdAt: number; user_name?: string }>>([]);
  const [customRechargeAmount, setCustomRechargeAmount] = useState(100);
  const [isRecharging, setIsRecharging] = useState(false);
  const [rechargeError, setRechargeError] = useState('');

  // Derived values
  const creditsBalance = credits?.balance ?? 0;
  const creditsTotalRecharged = credits?.totalRecharged ?? 0;
  const creditsTotalUsed = credits?.totalUsed ?? 0;
  const creditsTransactions = creditTransactions;

  // Custom dialog state
  const [promptDialog, setPromptDialog] = useState<{open: boolean, title: string, defaultValue: string, placeholder: string, onConfirm: ((value: string) => void) | null}>({open: false, title: '', defaultValue: '', placeholder: '', onConfirm: null});
  const [confirmDialog, setConfirmDialog] = useState<{open: boolean, title: string, message: string, onConfirm: (() => void | Promise<void>) | null}>({open: false, title: '', message: '', onConfirm: null});
  const [textareaDialog, setTextareaDialog] = useState<{open: boolean, title: string, defaultValue: string, placeholder: string, onConfirm: ((value: string) => void) | null}>({open: false, title: '', defaultValue: '', placeholder: '', onConfirm: null});

  const syncServerSession = useCallback(async (profile: User, password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: profile.name,
          password,
          profile,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  const loadAvailableUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/users', { cache: 'no-store', credentials: 'include' });
      const data = await response.json() as { success?: boolean; users?: User[] };
      if (data.success && Array.isArray(data.users)) {
        setAvailableUsers(data.users);
        return;
      }
    } catch {
      // Fall back to local cache below.
    }
    setAvailableUsers(userManager.getAllUsers().filter(existingUser => existingUser.role !== 'admin' && existingUser.status !== 'disabled'));
  }, [userManager]);

  const loadData = React.useCallback(() => {
    setUser(userManager.getUser());
    setProjects(userManager.getProjects());
    setUsageStats(userManager.getUsageStats(30));
  }, [userManager]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    void loadAvailableUsers();
    const refreshUsers = () => void loadAvailableUsers();
    window.addEventListener('wujie-admin-users-updated', refreshUsers);
    return () => window.removeEventListener('wujie-admin-users-updated', refreshUsers);
  }, [loadAvailableUsers]);

  useEffect(() => {
    if (!user?.password) return;
    void syncServerSession(user, user.password);
  }, [user, syncServerSession]);

  // Load credits when user is logged in
  const loadCreditsData = useCallback(async () => {
    if (!user) return;
    try {
      const [creditsRes, txRes] = await Promise.all([
        fetch('/api/credits', { credentials: 'include' }),
        fetch('/api/credits?transactions=true&limit=30', { credentials: 'include' }),
      ]);
      if (creditsRes.ok) {
        const creditsData = await creditsRes.json();
        if (creditsData.success) setCredits(creditsData.credits);
      }
      if (txRes.ok) {
        const txData = await txRes.json();
        if (txData.success) setCreditTransactions(txData.transactions || []);
      }
    } catch {
      // Credits system may not be available
    }
  }, [user]);

  const handleRecharge = useCallback(async (amount: number) => {
    if (!user || amount <= 0) return;
    setIsRecharging(true);
    setRechargeError('');
    try {
      const resp = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'recharge', amount }),
      });
      const data = await resp.json();
      if (data.success) {
        await loadCreditsData();
      } else {
        setRechargeError(data.error || '充值失败');
      }
    } catch {
      setRechargeError('充值请求失败');
    }
    setIsRecharging(false);
  }, [user, loadCreditsData]);

  useEffect(() => {
    if (user) void loadCreditsData();
  }, [user, loadCreditsData]);

  const submitLogin = async (name: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          password,
        }),
      });

      if (!response.ok) {
        setLoginError('登录失败，或该用户已被禁用');
        return;
      }

      const data = await response.json() as { user?: User };
      if (!data.user) {
        setLoginError('登录失败，或该用户已被禁用');
        return;
      }

      const loggedIn = await userManager.upsertUserFromServer(data.user);
      setLoginError('');
      loadData();
      onLogin?.(loggedIn);
    } catch {
      setLoginError('登录失败，或该用户已被禁用');
    }
  };

  const handleLogin = async () => {
    await submitLogin(loginName.trim(), loginPassword);
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    userManager.createProject(newProjectName.trim(), newProjectDescription.trim() || undefined);
    setNewProjectName('');
    setNewProjectDescription('');
    setShowNewProjectDialog(false);
    loadData();
  };

  const handleExportProject = async (project: Project) => {
    try {
      const content = await userManager.exportProjectToWujie(project.id);
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
      console.error('Export project failed:', err);
      alert('导出项目失败: ' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  const handleImportProject = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        userManager.importProjectFromWujie(String(reader.result || ''));
        loadData();
      } catch {
        alert('导入失败，请选择有效的 .wujie 文件。');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleDeleteProject = (projectId: string) => {
    setTimeout(() => {
    setConfirmDialog({
      open: true,
      title: '删除项目',
      message: '确定删除这个项目吗？此操作无法撤销。',
      onConfirm: async () => {
        await userManager.deleteProject(projectId);
        loadData();
        setConfirmDialog({ open: false, title: '', message: '', onConfirm: null });
      }
    });
    }, 50);
  };

  const handleRenameProject = (project: Project) => {
    setTimeout(() => {
      setPromptDialog({
        open: true,
        title: '重命名项目',
        defaultValue: project.name,
        placeholder: '输入项目名称',
        onConfirm: (value: string) => {
          if (value && value.trim() && value.trim() !== project.name) {
            userManager.updateProject(project.id, { name: value.trim() });
            loadData();
          }
          setPromptDialog({ open: false, title: '', placeholder: '', defaultValue: '', onConfirm: null });
        }
      });
    }, 50);
  };

  const handleEditDescription = (project: Project) => {
    setTimeout(() => {
      setTextareaDialog({
        open: true,
        title: '编辑项目备注',
        defaultValue: project.description || '',
        placeholder: '输入项目备注说明...',
        onConfirm: (value: string) => {
          if (value !== (project.description || '')) {
            userManager.updateProject(project.id, { description: value });
            loadData();
          }
          setTextareaDialog({ open: false, title: '', placeholder: '', defaultValue: '', onConfirm: null });
        }
      });
    }, 50);
  };

  const handleLogout = () => {
    userManager.logout();
    onLogout?.();
  };

  const handleSelectUser = async (selectedUser: User) => {
    setLoginName(selectedUser.name);
    setLoginError('');
    if (selectedUser.password) {
      await submitLogin(selectedUser.name, selectedUser.password);
    } else {
      setLoginPassword('');
    }
  };

  const getProjectTime = (project: Project) => {
    const diff = Date.now() - new Date(project.updatedAt).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return String(Math.floor(diff / 60000)) + ' 分钟前';
    if (diff < 86400000) return String(Math.floor(diff / 3600000)) + ' 小时前';
    return new Date(project.updatedAt).toLocaleDateString();
  };

  const totalUsage = usageStats.reduce((acc, stat) => ({
    requests: acc.requests + stat.requests,
    imagesGenerated: acc.imagesGenerated + stat.imagesGenerated,
    tokensUsed: acc.tokensUsed + stat.tokensUsed,
    estimatedCost: acc.estimatedCost + stat.estimatedCost,
  }), { requests: 0, imagesGenerated: 0, tokensUsed: 0, estimatedCost: 0 });

  const allUsers = availableUsers.length
    ? availableUsers
    : userManager.getAllUsers().filter(existingUser => existingUser.role !== 'admin' && existingUser.status !== 'disabled');

  if (!user) {
    return (
      <div className="fixed inset-0 z-[100] flex min-h-screen" style={{ background: '#0A0A0F' }}>
        <div className="w-full min-h-screen flex flex-col lg:flex-row">

          {/* 左侧品牌展示区 */}
          <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12 xl:p-16"
               style={{ background: 'linear-gradient(135deg, #0E0E16 0%, #151520 40%, #1A1A28 70%, #0E0E16 100%)' }}>

            {/* 渐变光效背景装饰 */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none" aria-hidden="true">
              <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full opacity-20"
                   style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.3) 0%, transparent 70%)' }} />
              <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full opacity-10"
                   style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.25) 0%, transparent 70%)' }} />
              <div className="absolute top-1/2 left-1/3 w-64 h-64 rounded-full opacity-10"
                   style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.2) 0%, transparent 60%)' }} />
            </div>

            {/* 品牌头部 */}
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-3">
                <img src="/logo.png" alt="无界AI" className="w-10 h-10 object-contain rounded-lg" />
                <h1 className="text-3xl xl:text-4xl font-bold text-foreground tracking-tight">无界AI</h1>
              </div>
              <p className="text-muted-foreground text-base xl:text-lg">AI图像生成与协作平台</p>
            </div>

            {/* 特性卡片 */}
            <div className="relative z-10 space-y-4 my-12">
              <div className="flex items-start gap-4 p-5 rounded-lg bg-muted/50 border border-border/20 hover:border-primary/30 transition-colors group">
                <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] transition-shadow">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">无限画布</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">自由缩放、无限延展的创作空间，支持多图层协同编辑</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-5 rounded-lg bg-muted/50 border border-border/20 hover:border-primary/30 transition-colors group">
                <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] transition-shadow">
                  <MessageSquareText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">AI智能修图</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">一键抠图、智能补全、风格迁移，让创作更高效</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-5 rounded-lg bg-muted/50 border border-border/20 hover:border-primary/30 transition-colors group">
                <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center shrink-0 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] transition-shadow">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">工作流编排</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">可视化节点编排，自定义AI处理流水线，自动化批量生成</p>
                </div>
              </div>
            </div>

            {/* 版本号 */}
            <div className="relative z-10">
              <p className="text-xs text-muted-foreground/50 font-mono">{APP_VERSION_LABEL}</p>
            </div>
          </div>

          {/* 右侧登录表单区 */}
          <div className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-12" style={{ backgroundColor: '#0F1117' }}>
            <div className="w-full max-w-sm">

              {/* 移动端品牌标识 */}
              <div className="lg:hidden flex items-center gap-2 mb-10 justify-center">
                <img src="/logo.png" alt="无界AI" className="w-8 h-8 object-contain rounded" />
                <span className="text-2xl font-bold text-foreground tracking-tight">无界AI</span>
              </div>

              {/* 登录标题 */}
              <h2 className="text-2xl font-bold text-foreground mb-8">登录</h2>

              {/* 登录表单 */}
              <form onSubmit={(e) => { e.preventDefault(); void handleLogin(); }} autoComplete="off">
                {/* 用户名输入框 */}
                <div className="mb-5">
                  <Label className="block text-xs font-medium text-muted-foreground mb-1.5">用户名</Label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <UserIcon className="w-4 h-4 text-muted-foreground/60" />
                    </div>
                    <input
                      type="text"
                      value={loginName}
                      onChange={(e) => setLoginName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }}
                      placeholder="请输入用户名"
                      className="w-full bg-muted border-none rounded-md pl-10 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                    />
                  </div>
                </div>

                {/* 密码输入框 */}
                <div className="mb-6">
                  <Label className="block text-xs font-medium text-muted-foreground mb-1.5">密码</Label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Settings className="w-4 h-4 text-muted-foreground/60" />
                    </div>
                    <input
                      type={showLoginPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }}
                      placeholder="请输入密码"
                      className="w-full bg-muted border-none rounded-md pl-10 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword((value) => !value)}
                      aria-label={showLoginPassword ? '隐藏密码' : '显示密码'}
                      title={showLoginPassword ? '隐藏密码' : '显示密码'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                      {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* 登录按钮 */}
                <button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground font-semibold py-2.5 rounded-md text-sm hover:brightness-110 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2"
                >
                  登录
                </button>
              </form>

              {/* 错误提示 */}
              {loginError && (
                <div className="mt-4 px-4 py-3 rounded-md text-sm font-medium" style={{ backgroundColor: '#3D1518' }}>
                  <span className="text-destructive">{loginError}</span>
                </div>
              )}

                  <p className="mt-6 text-xs text-muted-foreground/50">请联系管理员创建新账户。</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'projects' as const, label: '项目', icon: Folder },
    { id: 'credits' as const, label: '积分', icon: Zap },
    { id: 'stats' as const, label: '统计', icon: BarChart3 },
    { id: 'settings' as const, label: '设置', icon: Settings },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/90 backdrop-blur-xl">
      <div className="w-full max-w-2xl max-h-[85vh] rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.6)] flex flex-col bg-card border border-border">
        <div className="px-5 py-3 flex items-center justify-between shrink-0 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-primary-foreground font-bold text-sm bg-gradient-to-br from-primary to-[#b8860b]">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{user.name}</h3>
              <p className="text-xs text-muted-foreground">{user.email || '未设置邮箱'} · 加入于 {new Date(user.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-2 rounded-lg transition-colors hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="px-5 pt-2 pb-0 flex items-center gap-1 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all ${activeTab === tab.id ? (isGold ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-gray-100 text-gray-900') : (isGold ? 'text-[#666] hover:text-[#999] hover:bg-[#1a1a1a]' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50')}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'projects' && (
            <div>
              <div className="flex justify-between items-center mb-3 gap-2">
                <p className={`text-xs font-medium uppercase tracking-wider ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>我的项目</p>
                <div className="flex items-center gap-2">
                  <input ref={importProjectInputRef} type="file" accept=".wujie,application/json,text/html" className="hidden" onChange={handleImportProject} />
                  <button onClick={() => importProjectInputRef.current?.click()} className={`text-xs font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${isGold ? 'bg-[#1a1a1a] text-[#d4af37] border border-[#2a2a2a]' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}>
                    <Upload className="w-3 h-3" />
                    导入 .wujie
                  </button>
                  <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
                    <DialogTrigger asChild>
                      <button className={`text-xs font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${isGold ? 'bg-gradient-to-r from-[#d4af37] to-[#daa520] text-black' : 'bg-gray-900 text-white'}`}>
                        <Plus className="w-3 h-3" />
                        新建
                      </button>
                    </DialogTrigger>
                    <DialogContent className={isGold ? 'bg-[#141414] border-[#2a2a2a]' : 'bg-white border-gray-200'}>
                      <DialogHeader>
                        <DialogTitle className={isGold ? 'text-white' : 'text-gray-900'}>创建项目</DialogTitle>
                        <DialogDescription className={isGold ? 'text-[#888]' : 'text-gray-500'}>创建一个新的工作项目。</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 py-4">
                        <div>
                          <Label className={`text-xs ${isGold ? 'text-[#888]' : 'text-gray-500'}`}>项目名称</Label>
                          <Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="新项目" className={`mt-1 h-10 ${isGold ? 'border-[#2a2a2a] bg-[#1a1a1a] text-white focus:border-[#d4af37]' : 'border-gray-200 bg-gray-50 text-gray-900'}`} />
                        </div>
                        <div>
                          <Label className={`text-xs ${isGold ? 'text-[#888]' : 'text-gray-500'}`}>项目描述</Label>
                          <Input value={newProjectDescription} onChange={(e) => setNewProjectDescription(e.target.value)} placeholder="可选描述" className={`mt-1 h-10 ${isGold ? 'border-[#2a2a2a] bg-[#1a1a1a] text-white focus:border-[#d4af37]' : 'border-gray-200 bg-gray-50 text-gray-900'}`} />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button onClick={handleCreateProject} className={`h-10 ${isGold ? 'bg-gradient-to-r from-[#d4af37] to-[#daa520] text-black' : 'bg-gray-900 text-white'}`}>创建项目</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              {projects.length === 0 ? (
                <div className={`flex flex-col items-center justify-center py-12 text-center rounded-xl ${isGold ? 'bg-[#0f0f0f] border border-dashed border-[#2a2a2a]' : 'bg-gray-50 border border-dashed border-gray-200'}`}>
                  <Folder className={`w-10 h-10 mb-3 ${isGold ? 'text-[#333]' : 'text-gray-300'}`} />
                  <p className={`text-sm font-medium ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>暂无项目</p>
                  <p className={`text-xs mt-1 ${isGold ? 'text-[#444]' : 'text-gray-300'}`}>创建项目后即可开始整理作品。</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {projects.map((project) => (
                    <div key={project.id} className={`group rounded-xl p-3 transition-all ${isGold ? 'bg-[#0f0f0f] border border-[#2a2a2a] hover:border-[#3a3a3a]' : 'bg-gray-50/80 border border-gray-100 hover:border-gray-200'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${isGold ? 'bg-[#1a1a1a]' : 'bg-gray-100'}`}>
                          <Folder className={`w-5 h-5 ${isGold ? 'text-[#d4af37]' : 'text-gray-500'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${isGold ? 'text-white' : 'text-gray-900'}`}>{project.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className={`text-xs ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>{project.description || '无描述'}</span>
                            <span className={`text-xs ${isGold ? 'text-[#444]' : 'text-gray-300'}`}>·</span>
                            <span className={`text-xs ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>{currentProjectId === project.id && currentImageCount !== undefined ? currentImageCount : project.canvasImages.length} 张图片</span>
                            <span className={`text-xs ${isGold ? 'text-[#444]' : 'text-gray-300'}`}>·</span>
                            <span className={`text-xs flex items-center gap-0.5 ${isGold ? 'text-[#555]' : 'text-gray-300'}`}>
                              <Clock className="w-3 h-3" />
                              {getProjectTime(project)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          {onSelectProject && (
                            <button onClick={() => onSelectProject(project)} className={`p-2 rounded-lg transition-colors ${isGold ? 'text-[#d4af37] hover:bg-[#d4af37]/10' : 'text-gray-500 hover:bg-gray-100'}`} title="加载项目">
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => handleRenameProject(project)} className={`p-2 rounded-lg transition-colors ${isGold ? 'text-[#888] hover:bg-[#1a1a1a]' : 'text-gray-400 hover:bg-gray-100'}`} title="重命名">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleEditDescription(project)} className={`p-2 rounded-lg transition-colors ${isGold ? 'text-[#888] hover:bg-[#1a1a1a]' : 'text-gray-400 hover:bg-gray-100'}`} title="编辑备注">
                            <MessageSquareText className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleExportProject(project)} className={`p-2 rounded-lg transition-colors ${isGold ? 'text-[#888] hover:bg-[#1a1a1a]' : 'text-gray-400 hover:bg-gray-100'}`} title="导出项目">
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDeleteProject(project.id)} className={`p-2 rounded-lg transition-colors ${isGold ? 'text-red-500/70 hover:bg-red-900/20 hover:text-red-400' : 'text-red-300 hover:bg-red-50 hover:text-red-500'}`} title="删除项目">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'credits' && (
            <div>
              {/* 积分余额卡片 */}
              <div className={`rounded-xl p-4 mb-4 ${isGold ? 'bg-[#1a1a1a] border border-[#333]' : 'bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium ${isGold ? 'text-[#999]' : 'text-gray-500'}`}>当前积分</span>
                  <button
                    onClick={loadCreditsData}
                    className={`text-xs px-2 py-0.5 rounded ${isGold ? 'text-[#d4af37] hover:bg-[#252525]' : 'text-blue-500 hover:bg-blue-50'} transition-colors`}
                  >
                    刷新
                  </button>
                </div>
                <div className={`text-3xl font-bold ${isGold ? 'text-[#d4af37]' : 'text-blue-600'}`}>
                  {creditsBalance.toLocaleString()}
                </div>
                <div className={`flex gap-4 mt-2 text-xs ${isGold ? 'text-[#888]' : 'text-gray-400'}`}>
                  <span>累计充值: {creditsTotalRecharged.toLocaleString()}</span>
                  <span>累计使用: {creditsTotalUsed.toLocaleString()}</span>
                </div>
              </div>

              {/* 充值套餐 */}
              <p className={`text-xs font-medium uppercase tracking-wider mb-3 ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>充值套餐</p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { amount: 100, price: '10', unit: '元' },
                  { amount: 500, price: '45', unit: '元', badge: '9折' },
                  { amount: 1000, price: '80', unit: '元', badge: '8折' },
                  { amount: 5000, price: '350', unit: '元', badge: '7折' },
                ].map((pkg) => (
                  <button
                    key={pkg.amount}
                    onClick={() => handleRecharge(pkg.amount)}
                    disabled={isRecharging}
                    className={`relative rounded-lg p-3 text-left transition-all ${
                      isGold
                        ? 'bg-[#1a1a1a] border border-[#333] hover:border-[#d4af37]/50 disabled:opacity-50'
                        : 'bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm disabled:opacity-50'
                    }`}
                  >
                    {pkg.badge && (
                      <span className={`absolute -top-1.5 -right-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        isGold ? 'bg-[#d4af37] text-black' : 'bg-blue-500 text-white'
                      }`}>
                        {pkg.badge}
                      </span>
                    )}
                    <div className={`text-lg font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>
                      {pkg.amount.toLocaleString()}
                    </div>
                    <div className={`text-xs ${isGold ? 'text-[#999]' : 'text-gray-500'}`}>
                      ¥{pkg.price}
                    </div>
                  </button>
                ))}
              </div>

              {/* 自定义充值 */}
              <div className={`rounded-lg p-3 mb-4 ${isGold ? 'bg-[#1a1a1a] border border-[#333]' : 'bg-gray-50 border border-gray-200'}`}>
                <p className={`text-xs mb-2 ${isGold ? 'text-[#999]' : 'text-gray-500'}`}>自定义充值数量</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    value={customRechargeAmount}
                    onChange={(e) => setCustomRechargeAmount(Math.max(1, parseInt(e.target.value) || 0))}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm outline-none ${
                      isGold
                        ? 'bg-[#252525] border border-[#444] text-white focus:border-[#d4af37]'
                        : 'bg-white border border-gray-200 text-gray-900 focus:border-blue-400'
                    }`}
                    placeholder="输入积分数量"
                  />
                  <button
                    onClick={() => handleRecharge(customRechargeAmount)}
                    disabled={isRecharging || customRechargeAmount <= 0}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
                      isGold
                        ? 'bg-[#d4af37] text-black hover:bg-[#e5c44e]'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                  >
                    充值
                  </button>
                </div>
              </div>

              {/* 交易记录 */}
              <p className={`text-xs font-medium uppercase tracking-wider mb-3 ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>交易记录</p>
              {creditsTransactions.length === 0 ? (
                <p className={`text-xs text-center py-6 ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>暂无记录</p>
              ) : (
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                  {creditsTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                        isGold ? 'bg-[#1a1a1a]' : 'bg-white border border-gray-100'
                      }`}
                    >
                      <div>
                        <div className={`text-xs font-medium ${isGold ? 'text-white' : 'text-gray-900'}`}>
                          {tx.type === 'recharge' ? '充值' : tx.type === 'consume' ? '消费' : tx.type === 'refund' ? '退款' : '管理员调整'}
                        </div>
                        {tx.description && (
                          <div className={`text-[10px] mt-0.5 ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>
                            {tx.description}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className={`text-xs font-bold ${
                          tx.amount > 0
                            ? (isGold ? 'text-[#d4af37]' : 'text-green-500')
                            : (isGold ? 'text-[#ff6b6b]' : 'text-red-500')
                        }`}>
                          {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                        </div>
                        <div className={`text-[10px] ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <div>
              <p className={`text-xs font-medium uppercase tracking-wider mb-3 ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>用量统计（近 30 天）</p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: '请求数', value: totalUsage.requests, icon: Zap, color: isGold ? 'text-[#d4af37]' : 'text-gray-700' },
                  { label: '图片数', value: totalUsage.imagesGenerated, icon: Folder, color: isGold ? 'text-blue-400' : 'text-blue-600' },
                  { label: 'Token', value: totalUsage.tokensUsed.toLocaleString(), icon: BarChart3, color: isGold ? 'text-green-400' : 'text-green-600' },
                  { label: '费用', value: `$${totalUsage.estimatedCost.toFixed(2)}`, icon: Settings, color: isGold ? 'text-purple-400' : 'text-purple-600' },
                ].map((stat, i) => (
                  <div key={i} className={`rounded-xl p-3 ${isGold ? 'bg-[#0f0f0f] border border-[#2a2a2a]' : 'bg-gray-50 border border-gray-100'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <stat.icon className={`w-3.5 h-3.5 ${stat.color}`} />
                      <span className={`text-xs ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>{stat.label}</span>
                    </div>
                    <p className={`text-lg font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* 用户信息 */}
              <div className={`rounded-xl border p-4 ${isGold ? 'bg-[#0f0f0f] border-[#2a2a2a]' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg ${isGold ? 'bg-gradient-to-br from-[#d4af37] to-[#b8860b]' : 'bg-gradient-to-br from-gray-600 to-gray-800'}`}>
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${isGold ? 'text-white' : 'text-gray-900'}`}>{user.name}</p>
                    <p className={`text-xs ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>{user.email || '未设置邮箱'}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${user.role === 'admin' ? (isGold ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-amber-100 text-amber-700') : (isGold ? 'bg-[#1a1a1a] text-[#888] border border-[#2a2a2a]' : 'bg-gray-100 text-gray-500')}`}>
                    {user.role === 'admin' ? '管理员' : '普通用户'}
                  </span>
                </div>
                <div className={`text-xs space-y-1 ${isGold ? 'text-[#555]' : 'text-gray-400'}`}>
                  <p>用户ID: {user.id}</p>
                  <p>加入时间: {new Date(user.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              {/* API 权限 */}
              <div className={`rounded-xl border p-4 ${isGold ? 'bg-[#0f0f0f] border-[#2a2a2a]' : 'bg-gray-50 border-gray-100'}`}>
                <p className={`text-xs font-medium uppercase tracking-wider mb-3 ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>API 权限</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'image', label: '图像生成', icon: '🎨' },
                    { key: 'chat', label: 'AI 聊天', icon: '💬' },
                    { key: 'threeD', label: '3D 模型', icon: '🧊' },
                    { key: 'imageEdit', label: '图像编辑', icon: '✏️' },
                    { key: 'vectorize', label: '矢量化', icon: '📐' },
                    { key: 'layer', label: '图层分离', icon: '🗂️' },
                  ].map(perm => {
                    const enabled = user.apiPermissions?.[perm.key as keyof typeof user.apiPermissions] ?? false;
                    return (
                      <div key={perm.key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs ${enabled ? (isGold ? 'bg-[#d4af37]/10 text-[#d4af37]' : 'bg-green-50 text-green-600') : (isGold ? 'bg-[#1a1a1a] text-[#444]' : 'bg-gray-100 text-gray-300')}`}>
                        <span>{perm.icon}</span>
                        <span>{perm.label}</span>
                        <span className={`ml-auto w-1.5 h-1.5 rounded-full ${enabled ? 'bg-green-400' : (isGold ? 'bg-[#333]' : 'bg-gray-300')}`} />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 操作 */}
              <div className={`rounded-xl border p-4 ${isGold ? 'bg-[#0f0f0f] border-[#2a2a2a]' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex flex-col gap-2">
                  <button onClick={() => { userManager.setCurrentUser(user.id); void syncServerSession(user, user.password || ''); }} className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${isGold ? 'bg-[#1a1a1a] text-[#d4af37] border border-[#2a2a2a] hover:bg-[#222]' : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'}`}>
                    <Settings className="w-4 h-4" />
                    刷新会话
                  </button>
                  <button onClick={handleLogout} className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${isGold ? 'bg-red-900/20 text-red-400 border border-red-900/30 hover:bg-red-900/30' : 'bg-red-50 text-red-500 border border-red-100 hover:bg-red-100'}`}>
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 自定义弹窗 */}
      <PromptDialog
        open={promptDialog.open}
        title={promptDialog.title}
        placeholder={promptDialog.placeholder}
        defaultValue={promptDialog.defaultValue}
        onConfirm={promptDialog.onConfirm || (() => {})}
        onCancel={() => setPromptDialog({ open: false, title: '', placeholder: '', defaultValue: '', onConfirm: null })}
      />
      <TextareaDialog
        open={textareaDialog.open}
        title={textareaDialog.title}
        placeholder={textareaDialog.placeholder}
        defaultValue={textareaDialog.defaultValue}
        onConfirm={textareaDialog.onConfirm || (() => {})}
        onCancel={() => setTextareaDialog({ open: false, title: '', placeholder: '', defaultValue: '', onConfirm: null })}
      />
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm || (() => {})}
        onCancel={() => setConfirmDialog({ open: false, title: '', message: '', onConfirm: null })}
      />
    </div>
  );
}
