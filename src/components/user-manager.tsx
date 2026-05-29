'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User, Project, UsageStats } from '@/lib/user-types';
import { UserManager as UserManagerCore } from '@/lib/user-manager';
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
  const [activeTab, setActiveTab] = useState<'projects' | 'stats' | 'settings'>('projects');
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [loginName, setLoginName] = useState('Mr.joker');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const importProjectInputRef = useRef<HTMLInputElement>(null);
  const isGold = themeStyle === 'gold';

  // Custom dialog state
  const [promptDialog, setPromptDialog] = useState<{open: boolean, title: string, defaultValue: string, placeholder: string, onConfirm: ((value: string) => void) | null}>({open: false, title: '', defaultValue: '', placeholder: '', onConfirm: null});
  const [confirmDialog, setConfirmDialog] = useState<{open: boolean, title: string, message: string, onConfirm: (() => void) | null}>({open: false, title: '', message: '', onConfirm: null});
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
      onConfirm: () => {
        userManager.deleteProject(projectId);
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: isGold ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)', backdropFilter: 'blur(20px)' }}>
        <div className={`w-full max-w-md rounded-2xl overflow-hidden shadow-2xl ${isGold ? 'bg-[#111] border border-[#2a2a2a]' : 'bg-white border border-gray-200'}`}>
          <div className={`px-6 pt-6 pb-4 text-center ${isGold ? 'bg-gradient-to-b from-[#1a1a1a] to-[#111]' : 'bg-gradient-to-b from-gray-50 to-white'}`}>
            <div className="w-16 h-16 mx-auto mb-3">
              <img src="/logo.png" alt="无界AI" className="w-full h-full object-contain rounded-2xl" />
            </div>
            <h2 className={`text-xl font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>无界AI 登录</h2>
            <p className={`text-sm mt-1 ${isGold ? 'text-[#888]' : 'text-gray-500'}`}>请选择用户并输入密码</p>
          </div>

          <div className={`px-6 pb-6 ${isGold ? 'border-t border-[#2a2a2a]' : 'border-t border-gray-100'}`}>
            <div className="space-y-3 mt-4">
              <div>
                <Label className={`text-xs ${isGold ? 'text-[#888]' : 'text-gray-500'}`}>用户名</Label>
                <Input value={loginName} onChange={(e) => setLoginName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }} placeholder="输入用户名" className={`mt-1 h-10 ${isGold ? 'border-[#2a2a2a] bg-[#1a1a1a] text-white focus:border-[#d4af37]' : 'border-gray-200 bg-gray-50 text-gray-900'}`} />
              </div>
              <div>
                <Label className={`text-xs ${isGold ? 'text-[#888]' : 'text-gray-500'}`}>密码</Label>
                <div className="relative mt-1">
                  <Input
                    type={showLoginPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }}
                    placeholder="输入密码"
                    className={`h-10 pr-11 ${isGold ? 'border-[#2a2a2a] bg-[#1a1a1a] text-white focus:border-[#d4af37]' : 'border-gray-200 bg-gray-50 text-gray-900'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((value) => !value)}
                    aria-label={showLoginPassword ? '隐藏密码' : '显示密码'}
                    title={showLoginPassword ? '隐藏密码' : '显示密码'}
                    className={`absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg transition-colors ${isGold ? 'text-[#888] hover:bg-[#252525] hover:text-[#d4af37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4af37]' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400'}`}
                  >
                    {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {loginError && <p className="text-xs text-red-400">{loginError}</p>}
                <button onClick={() => void handleLogin()} className={`w-full p-3 rounded-xl text-sm font-medium transition-all ${isGold ? 'bg-gradient-to-r from-[#d4af37] to-[#daa520] text-black hover:from-[#daa520] hover:to-[#d4af37]' : 'bg-gray-900 text-white hover:bg-gray-800'}`}>
                登录
              </button>
            </div>

            {allUsers.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className={`text-xs font-medium uppercase tracking-wider ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>已有用户</p>
                {allUsers.filter((existingUser) => existingUser.role !== 'admin').map((existingUser) => (
                  <button
                    key={existingUser.id}
                    onClick={() => void handleSelectUser(existingUser)}
                    className={`w-full p-3 rounded-xl text-left transition-all group flex items-center gap-3 ${isGold ? 'hover:bg-[#1a1a1a] bg-[#0f0f0f] border border-[#2a2a2a]' : 'hover:bg-gray-50 bg-gray-50/50 border border-gray-100'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm ${isGold ? 'bg-gradient-to-br from-[#d4af37] to-[#b8860b]' : 'bg-gradient-to-br from-gray-600 to-gray-800'}`}>
                      {existingUser.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate text-sm ${isGold ? 'text-white' : 'text-gray-900'}`}>{existingUser.name}</p>
                      <p className={`text-xs truncate ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>{existingUser.email || '未设置邮箱'}</p>
                    </div>
                    <ChevronRight className={`w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity ${isGold ? 'text-[#d4af37]' : 'text-gray-400'}`} />
                  </button>
                ))}
              </div>
            )}

            <p className={`mt-4 text-xs ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>请联系管理员创建新账户。</p>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'projects' as const, label: '项目', icon: Folder },
    { id: 'stats' as const, label: '统计', icon: BarChart3 },
    { id: 'settings' as const, label: '设置', icon: Settings },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: isGold ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)', backdropFilter: 'blur(20px)' }}>
      <div className={`w-full max-w-2xl max-h-[85vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col ${isGold ? 'bg-[#111] border border-[#2a2a2a]' : 'bg-white border border-gray-200'}`}>
        <div className={`px-5 py-3 flex items-center justify-between shrink-0 ${isGold ? 'border-b border-[#2a2a2a]' : 'border-b border-gray-100'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm ${isGold ? 'bg-gradient-to-br from-[#d4af37] to-[#b8860b]' : 'bg-gradient-to-br from-gray-600 to-gray-800'}`}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${isGold ? 'text-white' : 'text-gray-900'}`}>{user.name}</h3>
              <p className={`text-xs ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>{user.email || '未设置邮箱'} · 加入于 {new Date(user.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isGold ? 'hover:bg-[#1a1a1a] text-[#888]' : 'hover:bg-gray-100 text-gray-400'}`}>
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
