'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  FolderOpen, Plus, Search, Star, Trash2, MoreVertical, Image,
  Sparkles, LayoutTemplate, Layers, Clock, ChevronRight, ArrowRight,
  Box, Copy, Check, Palette, Type, BookOpen,
  LogOut, Shield, X, Eye, Mail, Calendar, KeyRound, Zap, Pencil,
  // Admin/User management icons
  UserPlus, Ban, CheckCircle2, Plug, RefreshCw, Activity, Wallet,
  Loader2, Settings, ChevronDown, ShieldCheck, AlertTriangle,
  ArrowUp, ArrowDown, ShoppingBag, Users, Server, Database,
  XCircle, BarChart3, Upload, RotateCcw, Film,
} from 'lucide-react';
import { UserManager } from '@/lib/user-manager';
import type { Project, CanvasImage, User, UsageStats } from '@/lib/user-types';
import { ConfirmDialog } from '@/components/custom-dialogs';
import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import { getModelDisplayName } from '@/lib/model-name-map';

type TabType = 'projects' | 'templates' | 'assets' | 'stats' | 'credits' | 'settings' | 'users' | 'apis' | 'data' | 'ecom-templates';
type ProjectFilter = 'all' | 'recent' | 'starred';
type AssetSubTab = 'images' | 'prompts' | 'brands';
type ApiKind = 'general' | 'image' | 'chat' | '3d' | 'vectorize' | 'layer' | 'video';
type UserPermissionKey = 'image' | 'chat' | 'threeD' | 'imageEdit' | 'vectorize' | 'layer' | 'video';
type AdminProvider = ApiProvider & { apiKeyPreview?: string };

const apiKindLabels: Record<ApiKind, string> = {
  general: '通用模型',
  image: '图像模型',
  chat: 'LLM 模型',
  '3d': '3D 模型',
  vectorize: '矢量模型',
  layer: '图片分层模型',
  video: '视频模型',
};

const apiKindDescriptions: Record<ApiKind, string> = {
  general: '选择此类型后自动识别并显示当前API的所有模型，不按类型过滤',
  image: '支持自动识别模型，管理员选择后对接到图像生成功能',
  chat: '支持自动识别模型，管理员选择后对接到AI聊天功能',
  '3d': '支持自动识别模型，管理员选择后对接到一键转3D功能',
  vectorize: '添加API后系统自动识别 vectorize 模型，对接到矢量化工具和导出SVG',
  layer: '添加API后系统自动识别 qwen-image-layered 模型，对接到编辑元素和下载PSD',
  video: '添加API后系统自动识别视频模型（可灵/Seedance/海螺/Vidu/Runway/Pika/Sora等），对接到文生视频和图生视频功能',
};

const userPermissionLabels: Record<UserPermissionKey, string> = {
  image: '图像',
  chat: 'LLM',
  threeD: '3D',
  imageEdit: '编辑',
  vectorize: '矢量',
  layer: '分层',
  video: '视频',
};

interface DashboardViewProps {
  user: User;
  onOpenProject: (project: Project) => void;
  onNewProject: () => void;
  onLogout?: () => void;
  isMonochrome?: boolean;
}

interface PromptEntry {
  text: string;
  model: string;
  projectName: string;
}

export default function DashboardView({ user, onOpenProject, onNewProject, onLogout, isMonochrome }: DashboardViewProps) {
  const isAdmin = user.role === 'admin';

  // ─── Navigation state ───
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
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ─── Admin: User management state ───
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('123456');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [resetPwdUser, setResetPwdUser] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmDlg, setConfirmDlg] = useState<{ open: boolean; title: string; message: string; variant?: 'danger' | 'warning'; onConfirm: () => void; onCancel: () => void }>({ open: false, title: '', message: '', onConfirm: () => {}, onCancel: () => {} });

  // ─── Admin: API management state ───
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [apiName, setApiName] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [compatProfile, setCompatProfile] = useState('auto');
  const [apiKind, setApiKind] = useState<ApiKind>('image');
  const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [advancedParams, setAdvancedParams] = useState<Array<{ key: string; value: string }>>([]);
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ providerId: string; success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingNew, setIsTestingNew] = useState(false);
  const [testNewResult, setTestNewResult] = useState<{ success: boolean; message: string; modelCount?: number; error?: string } | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ providerId: string; success: boolean; summary: string; tests: Array<{ name: string; status: string; detail: string }> } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [apiBalances, setApiBalances] = useState<Array<{
    providerId: string; providerName: string; providerType: string;
    balance: number | null; currency: string; totalUsage: number; dailyUsage: number;
    lastUpdated: string; error?: string;
  }>>([]);

  // ─── Admin: Data management state ───
  const [selectedDataUser, setSelectedDataUser] = useState<string | null>(null);
  const [userDataKeys, setUserDataKeys] = useState<{ dataKey: string; updatedAt: number }[]>([]);
  const [viewingDataKey, setViewingDataKey] = useState<string | null>(null);
  const [viewingDataValue, setViewingDataValue] = useState<unknown>(null);
  const [viewingDataLoading, setViewingDataLoading] = useState(false);
  const [dataSubTab, setDataSubTab] = useState<'kv' | 'images'>('images');
  const [userImages, setUserImages] = useState<Array<{ id: string; url: string; prompt: string; model: string; quality: string; aspectRatio: string; createdAt: string; duration: number | null; projectName: string; size: string | null; source: string }>>([]);
  const [userImagesLoading, setUserImagesLoading] = useState(false);
  const [imageSourceFilter, setImageSourceFilter] = useState<'all' | 'generated' | 'uploaded'>('all');
  const [imageDetailId, setImageDetailId] = useState<string | null>(null);

  // ─── Credits state ───
  const [creditsBalance, setCreditsBalance] = useState(0);
  const [creditsTotalRecharged, setCreditsTotalRecharged] = useState(0);
  const [creditsTotalUsed, setCreditsTotalUsed] = useState(0);
  const [creditsTransactions, setCreditsTransactions] = useState<Array<{ id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: number }>>([]);
  const [rechargeAmount, setRechargeAmount] = useState<number | ''>('');
  const [isRecharging, setIsRecharging] = useState(false);
  const [rechargeError, setRechargeError] = useState('');
  // Payment flow state
  const [paymentStep, setPaymentStep] = useState<'select' | 'paying' | 'success'>('select');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'alipay' | 'wechat'>('alipay');
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingOrderAmount, setPendingOrderAmount] = useState(0);
  const [paymentQrUrl, setPaymentQrUrl] = useState<string | null>(null);
  const [paymentPageUrl, setPaymentPageUrl] = useState<string | null>(null);
  const [paymentPolling, setPaymentPolling] = useState(false);
  const [creditsPricing, setCreditsPricing] = useState<{
    creditsToCNY: number;
    cnyToCredits: number;
    imageModels: Record<string, { credits: number; label: string; cny: string }>;
    videoModels: Record<string, { creditsPerSecond: number; label: string; cnyPerSecond: string }>;
    chatModels: Record<string, { creditsPerCall: number; label: string; cny: string }>;
    rechargePackages: { credits: number; bonusCredits: number; label: string; price: number }[];
  } | null>(null);
  const [showPricingRef, setShowPricingRef] = useState(false);
  // Admin credits state
  const [creditsUsers, setCreditsUsers] = useState<Array<{ userId: string; userName: string; balance: number; totalRecharged: number; totalUsed: number }>>([]);
  const [selectedCreditsUser, setSelectedCreditsUser] = useState<string | null>(null);
  const [creditsUserTransactions, setCreditsUserTransactions] = useState<Array<{ id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: number }>>([]);
  const [adminRechargeAmount, setAdminRechargeAmount] = useState<number | ''>('');
  const [adminRechargeDesc, setAdminRechargeDesc] = useState('');
  const [isAdminRecharging, setIsAdminRecharging] = useState(false);
  const [creditsLoading, setCreditsLoading] = useState(false);

  // ─── Admin: Ecom template state ───
  const [ecomTemplates, setEcomTemplates] = useState<Array<Record<string, unknown>>>([]);
  const [editingEcomTpl, setEditingEcomTpl] = useState<Record<string, unknown> | null>(null);
  const [isEcomTplSaving, setIsEcomTplSaving] = useState(false);
  const [showNewEcomTpl, setShowNewEcomTpl] = useState(false);

  // ─── Theme vars ───
  const isDark = !isMonochrome; // 单色模式用浅色主题，默认深色
  const accentHex = isMonochrome ? '#3b82f6' : '#d4af37';
  const accentColor = accentHex;
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
  const accentBgLight = isMonochrome ? 'bg-[#3b82f6]/10' : isDark ? 'bg-[#d4af37]/15' : 'bg-[#d4af37]/10';
  const accentClass = isMonochrome ? 'text-[#3b82f6]' : 'text-[#d4af37]';
  const accentBgClass = isMonochrome ? 'bg-[#3b82f6]' : 'bg-[#d4af37]';
  const accentHoverBgClass = isMonochrome ? 'hover:bg-[#2563eb]' : 'hover:bg-[#e0b840]';
  const accentBorderClass = isMonochrome ? 'border-[#3b82f6]' : 'border-[#d4af37]';
  const accentTextOnBgClass = isMonochrome ? 'text-white' : 'text-black';
  const accentRingClass = isMonochrome ? 'focus:ring-[#3b82f6]/30' : 'focus:ring-[#d4af37]/30';
  const accentShadowClass = isMonochrome ? 'hover:shadow-[#3b82f6]/5' : 'hover:shadow-[#d4af37]/5';
  const accentHoverBorderClass = isMonochrome ? 'hover:border-[#3b82f6]/30' : 'hover:border-[#d4af37]/30';
  // Admin styling
  const softClass = isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-gray-50 border-gray-200';
  const inputClass = isDark ? 'bg-white/5 border-white/10 text-white placeholder:text-[#555]' : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400';
  const labelClass = `block text-xs font-medium mb-1.5 ${isDark ? 'text-[#b8b8b8]' : 'text-gray-600'}`;
  // Credits-specific styling
  const cardBg = isDark ? 'bg-[#1a1a2e]/80' : 'bg-white';
  const borderColor = isDark ? 'border-primary/20' : 'border-gray-200';
  const inputBg = isDark ? 'bg-white/5' : 'bg-gray-50';

  // ─── Project data ───
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

  // ─── Project handlers ───
  const toggleStar = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarredIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem('wujie-starred-projects', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确定删除此项目？此操作不可恢复。')) return;
    await mgr.deleteProject(id);
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

  // ─── Import project ───
  const importProjectInputRef = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wujie,application/json,text/html';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          mgr.importProjectFromWujie(String(reader.result || ''));
          // Force re-render by toggling state
          setActiveTab('projects');
        } catch {
          alert('导入失败，请选择有效的 .wujie 文件。');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [mgr]);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (menuOpenId && !target.closest('[data-project-menu]')) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [menuOpenId]);

  // ─── Admin: Data fetching ───
  const refreshAdmin = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store', credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.users)) setAdminUsers(data.users);
        else setAdminUsers([]);
      }
    } catch { setAdminUsers([]); }
    try {
      const response = await fetch('/api/admin/apis', { cache: 'no-store', credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data.success) setProviders(data.providers || []);
        else setProviders([]);
      }
    } catch { setProviders([]); }
  }, []);

  const refreshBalances = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/api-balance', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data.success) setApiBalances(data.balances || []);
      }
    } catch { setApiBalances([]); }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      void refreshAdmin();
      void refreshBalances();
    }
  }, [isAdmin, refreshAdmin, refreshBalances]);

  // ─── Credits data loading ───


  // ─── Admin: User management handlers ───
  const handleCreateUser = async () => {
    if (!newUserName.trim() || !newUserPassword.trim()) return;
    await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'create', name: newUserName.trim(), password: newUserPassword.trim(), email: newUserEmail.trim() || undefined }),
    });
    setNewUserName(''); setNewUserPassword('123456'); setNewUserEmail('');
    await refreshAdmin();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleToggleUser = async (u: User) => {
    await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'update', userId: u.id, updates: { status: u.status === 'disabled' ? 'active' : 'disabled' } }),
    });
    await refreshAdmin();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleDeleteUser = (u: User) => {
    if (u.role === 'admin') return;
    setConfirmDlg({
      open: true, title: '删除用户', message: `确定删除用户 ${u.name} 吗？该用户的本地项目数据会一并移除。`,
      onConfirm: async () => {
        await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'delete', userId: u.id }) });
        await refreshAdmin();
        window.dispatchEvent(new Event('wujie-admin-users-updated'));
        setConfirmDlg(prev => ({ ...prev, open: false }));
      },
      onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
    });
  };

  const handleRenameUser = async (userId: string) => {
    if (!editName.trim()) return;
    await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId, updates: { name: editName.trim() } }) });
    setEditingUser(null); setEditName('');
    await refreshAdmin();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleResetPassword = (userId: string) => {
    if (!newPassword.trim() || newPassword.trim().length < 4) return;
    setConfirmDlg({
      open: true, title: '重置密码', message: `确定将密码重置为 "${newPassword.trim()}" 吗？`, variant: 'warning',
      onConfirm: async () => {
        await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'update', userId, updates: { password: newPassword.trim() } }) });
        setResetPwdUser(null); setNewPassword('');
        setConfirmDlg(prev => ({ ...prev, open: false }));
      },
      onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
    });
  };

  const handleToggleUserPermission = async (u: User, key: UserPermissionKey) => {
    const current: Record<UserPermissionKey, boolean> = {
      image: u.apiPermissions?.image ?? true, chat: u.apiPermissions?.chat ?? true,
      threeD: u.apiPermissions?.threeD ?? true, imageEdit: u.apiPermissions?.imageEdit ?? true,
      vectorize: u.apiPermissions?.vectorize ?? true, layer: u.apiPermissions?.layer ?? true,
      video: u.apiPermissions?.video ?? true,
    };
    await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ action: 'update', userId: u.id, updates: { apiPermissions: { ...current, [key]: !current[key] } } }),
    });
    await refreshAdmin();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  // ─── Admin: API management handlers ───
  const handleDiscoverModels = async () => {
    if (!apiBaseUrl.trim() || !apiKey.trim()) return;
    setIsDiscovering(true);
    try {
      const response = await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'discover', baseUrl: apiBaseUrl.trim(), apiKey: apiKey.trim(), modelType: apiKind }) });
      if (!response.ok) throw new Error(`模型发现失败: HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success && data.error) { setTestNewResult({ success: false, message: data.error }); setDiscoveredModels([]); return; }
      const models = data.models || [];
      setDiscoveredModels(models); setModelSearchQuery('');
      if (apiKind === 'vectorize') {
        const vModels = models.filter((m: ModelInfo) => { const id = m.id.toLowerCase(); return id.includes('vector') || id.includes('vectorize') || id.includes('svg') || id.includes('tracer') || id.includes('starvector'); });
        setSelectedModels(vModels.length > 0 ? vModels.map((m: ModelInfo) => m.id) : []);
      } else if (apiKind === 'layer') {
        const lModels = models.filter((m: ModelInfo) => { const id = m.id.toLowerCase(); return id.includes('layer') || id.includes('segment') || id.includes('qwen-image-layered'); });
        setSelectedModels(lModels.length > 0 ? lModels.map((m: ModelInfo) => m.id) : []);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '识别模型失败';
      setTestNewResult({ success: false, message: msg.includes('JSON') ? 'API 返回了非 JSON 响应，请检查 Base URL 是否正确' : msg });
      setDiscoveredModels([]);
    } finally { setIsDiscovering(false); }
  };

  const handleAddApi = async () => {
    if (!apiName.trim() || !apiBaseUrl.trim() || !apiKey.trim()) return;
    const models = selectedModels.length ? selectedModels : apiModel.trim() ? [apiModel.trim()] : [];
    const res = await fetch('/api/admin/apis', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: apiName.trim(), baseUrl: apiBaseUrl.trim(), apiKey: apiKey.trim(), modelType: apiKind, selectedModels: models,
        requestStyle: apiKind === 'general' ? 'auto' : apiKind === 'chat' ? 'chat-completions' : apiKind === 'vectorize' || apiKind === 'layer' ? 'chat-completions' : apiKind === 'video' ? 'images-generations' : 'images-generations',
        advancedParams: [...advancedParams.filter(p => p.key.trim()), ...(compatProfile !== 'auto' ? [{ key: 'compatProfile', value: compatProfile }] : [])],
      }),
    });
    if (!res.ok) { const data = await res.json().catch(() => ({ error: '保存失败' })); alert(data.error || '保存失败，请重试'); return; }
    setApiName(''); setApiBaseUrl(''); setApiKey(''); setApiModel(''); setCompatProfile('auto');
    setDiscoveredModels([]); setSelectedModels([]); setEditingProviderId(null);
    setAdvancedParams([]); setShowAdvancedParams(false);
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refreshAdmin();
  };

  const handleEditApi = (provider: AdminProvider) => {
    setEditingProviderId(provider.id);
    setApiName(provider.displayName || provider.name); setApiBaseUrl(provider.baseUrl); setApiKey('');
    setApiKind((provider.modelType || 'image') as ApiKind);
    const savedProfile = provider.advancedParams?.compatProfile || 'auto';
    setCompatProfile(['apimart', 'openai', 'openai-async', 'auto'].includes(savedProfile) ? savedProfile : 'auto');
    const providerModels = provider.discoveredModels || [];
    if (providerModels.length > 0) { setDiscoveredModels(providerModels); setSelectedModels(provider.selectedModels || []); setModelSearchQuery(''); }
    else { setDiscoveredModels([]); setSelectedModels([]); }
    setApiModel('');
  };

  const handleUpdateApi = async () => {
    if (!editingProviderId) return;
    const models = selectedModels.length ? selectedModels : apiModel.trim() ? [apiModel.trim()] : undefined;
    const updates: Record<string, unknown> = {};
    if (apiName.trim()) updates.displayName = apiName.trim();
    if (apiBaseUrl.trim()) updates.baseUrl = apiBaseUrl.trim();
    if (apiKey.trim()) updates.apiKey = apiKey.trim();
    updates.modelType = apiKind;
    if (models) updates.selectedModels = models;
    const filteredParams = advancedParams.filter(p => p.key.trim());
    const paramsWithCompat = [...filteredParams.filter(p => p.key !== 'compatProfile'), ...(compatProfile !== 'auto' ? [{ key: 'compatProfile', value: compatProfile }] : [])];
    if (paramsWithCompat.length > 0) updates.advancedParams = paramsWithCompat;
    const res = await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', providerId: editingProviderId, updates }) });
    if (!res.ok) { const data = await res.json().catch(() => ({ error: '更新失败' })); alert(data.error || '更新失败，请重试'); return; }
    setEditingProviderId(null); setApiName(''); setApiBaseUrl(''); setApiKey(''); setApiModel(''); setCompatProfile('auto');
    setDiscoveredModels([]); setSelectedModels([]); setAdvancedParams([]); setShowAdvancedParams(false);
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refreshAdmin();
  };

  const handleTestConnection = async (provider: AdminProvider) => {
    setIsTesting(true); setTestResult(null);
    try {
      const response = await fetch('/api/test-provider-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ providerId: provider.id }) });
      if (!response.ok) throw new Error(`测试连接失败: HTTP ${response.status}`);
      const data = await response.json();
      setTestResult({ providerId: provider.id, success: data.success, message: data.success ? (data.info || '连接成功') : (data.error || '连接失败') });
    } catch { setTestResult({ providerId: provider.id, success: false, message: '网络错误，无法连接' }); }
    finally { setIsTesting(false); }
  };

  const handleTestNewConnection = async () => {
    if (!apiBaseUrl || !apiKey) return;
    setIsTestingNew(true); setTestNewResult(null);
    try {
      const advParams: Record<string, string> = {};
      advancedParams.forEach(p => { if (p.key.trim()) advParams[p.key.trim()] = p.value; });
      const response = await fetch('/api/test-provider-connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ baseUrl: apiBaseUrl, apiKey, requestStyle: apiKind === 'chat' ? 'chat-completions' : apiKind === 'vectorize' || apiKind === 'layer' ? 'chat-completions' : apiKind === 'video' ? 'images-generations' : 'images-generations', advancedParams: advParams }),
      });
      if (!response.ok) throw new Error(`测试连接失败: HTTP ${response.status}`);
      const data = await response.json();
      setTestNewResult({ success: data.success, message: data.success ? (data.info || '连接成功') : (data.error || '连接失败'), modelCount: data.modelCount, error: data.error });
    } catch { setTestNewResult({ success: false, message: '网络错误，无法连接' }); }
    finally { setIsTestingNew(false); }
  };

  const handleVerifyProtocol = async (provider: AdminProvider) => {
    setIsVerifying(true); setVerifyResult(null);
    try {
      const response = await fetch('/api/verify-protocol', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ providerId: provider.id }) });
      if (!response.ok) throw new Error(`协议验证失败: HTTP ${response.status}`);
      const data = await response.json();
      setVerifyResult({ providerId: provider.id, success: data.success, summary: data.summary || '', tests: data.tests || [] });
    } catch { setVerifyResult({ providerId: provider.id, success: false, summary: '验证请求失败', tests: [] }); }
    finally { setIsVerifying(false); }
  };

  const handleToggleApi = async (provider: AdminProvider) => {
    await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', providerId: provider.id, updates: { isEnabled: !provider.isEnabled } }) });
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refreshAdmin();
  };

  const handleRefreshApi = async (provider: AdminProvider) => {
    await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh', providerId: provider.id }) });
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refreshAdmin();
  };

  const handleDeleteApi = (provider: AdminProvider) => {
    setConfirmDlg({
      open: true, title: '删除 API', message: `确定删除 API「${provider.displayName || provider.name}」吗？此操作不可撤销。`, variant: 'danger',
      onConfirm: async () => {
        await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', providerId: provider.id }) });
        window.dispatchEvent(new Event('wujie-admin-apis-updated'));
        await refreshAdmin();
        setConfirmDlg(prev => ({ ...prev, open: false }));
      },
      onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
    });
  };

  const handleReorderApi = async (providerId: string, direction: 'up' | 'down') => {
    try {
      const res = await fetch('/api/admin/apis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder', providerId, direction }) });
      const data = await res.json();
      if (data.success) { window.dispatchEvent(new Event('wujie-admin-apis-updated')); await refreshAdmin(); }
    } catch (e) { console.error('[admin] reorder error:', e); }
  };

  // ─── Admin: Data management handlers ───
  const loadUserData = useCallback(async (userId: string) => {
    setSelectedDataUser(userId); setUserDataKeys([]); setViewingDataValue(null); setViewingDataKey(null);
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list-data', userId }), credentials: 'include' });
      const data = await response.json();
      if (data.success) setUserDataKeys(data.keys || []);
    } catch { setUserDataKeys([]); }
  }, []);

  const loadDataDetail = useCallback(async (userId: string, key: string) => {
    setViewingDataValue(null); setViewingDataKey(key); setViewingDataLoading(true);
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get-data', userId, key }), credentials: 'include' });
      const data = await response.json();
      if (data.success) setViewingDataValue(data.value);
      else setViewingDataValue({ error: data.error || '加载失败' });
    } catch { setViewingDataValue({ error: '请求失败' }); }
    finally { setViewingDataLoading(false); }
  }, []);

  const deleteUserData = useCallback(async (userId: string, key: string) => {
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-data', userId, key }), credentials: 'include' });
      const data = await response.json();
      if (data.success) { await loadUserData(userId); if (viewingDataKey === key) { setViewingDataValue(null); setViewingDataKey(null); } }
    } catch { /* ignore */ }
  }, [loadUserData, viewingDataKey]);

  // ─── Admin: User images ───
  const loadUserImages = useCallback(async (userId: string) => {
    setUserImagesLoading(true);
    setImageDetailId(null);
    try {
      const resp = await fetch(`/api/admin/user-images?userId=${encodeURIComponent(userId)}`);
      const data = await resp.json();
      if (data.images) {
        setUserImages(data.images);
      } else {
        setUserImages([]);
      }
    } catch { setUserImages([]); }
    setUserImagesLoading(false);
  }, []);

  // ─── Credits handlers ───
  const loadCreditsData = useCallback(async () => {
    try {
      const resp = await fetch('/api/credits');
      const data = await resp.json();
      if (data.success) {
        setCreditsBalance(data.credits?.balance ?? 0);
        setCreditsTotalRecharged(data.credits?.totalRecharged ?? 0);
        setCreditsTotalUsed(data.credits?.totalUsed ?? 0);
        if (data.pricing) setCreditsPricing(data.pricing);
      }
      // Load transactions
      try {
        const txResp = await fetch('/api/credits?transactions=true&limit=30');
        const txData = await txResp.json();
        if (txData.success) setCreditsTransactions(txData.transactions || []);
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  }, []);

  const handleCreateOrder = useCallback(async (credits: number, method: 'alipay' | 'wechat') => {
    if (credits <= 0) return;
    setIsRecharging(true);
    setRechargeError('');
    setPaymentStep('paying');
    setSelectedPaymentMethod(method);
    try {
      const resp = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-order', credits, paymentMethod: method }),
      });
      const data = await resp.json();
      if (data.success && data.order) {
        setPendingOrderId(data.order.orderId);
        setPendingOrderAmount(data.order.amount);
        setPaymentQrUrl(data.order.qrCodeUrl || null);
        setPaymentPageUrl(data.order.paymentUrl || null);
        // Start polling for payment status
        setPaymentPolling(true);
        pollOrderStatus(data.order.orderId);
      } else {
        setRechargeError(data.error || '创建订单失败');
        setPaymentStep('select');
      }
    } catch { setRechargeError('网络错误'); setPaymentStep('select'); }
    setIsRecharging(false);
  }, []);

  const pollOrderStatus = useCallback(async (orderId: string) => {
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max (5s interval)
    const poll = async () => {
      try {
        const resp = await fetch('/api/credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'query-order', orderId }),
        });
        const data = await resp.json();
        if (data.success && data.order?.status === 'paid') {
          setPaymentStep('success');
          setPaymentPolling(false);
          await loadCreditsData();
          return;
        }
        if (data.order?.status === 'expired' || data.order?.status === 'failed') {
          setRechargeError(data.order.status === 'expired' ? '订单已过期，请重新发起' : '支付失败，请重试');
          setPaymentStep('select');
          setPaymentPolling(false);
          return;
        }
      } catch { /* ignore network errors during polling */ }
      attempts++;
      if (attempts < maxAttempts && paymentPolling) {
        setTimeout(poll, 5000);
      } else {
        setPaymentPolling(false);
      }
    };
    poll();
  }, [loadCreditsData, paymentPolling]);

  const loadCreditsOverview = useCallback(async () => {
    setCreditsLoading(true);
    try {
      const resp = await fetch('/api/credits?action=admin-overview');
      const data = await resp.json();
      if (data.success) setCreditsUsers(data.users || []);
    } catch { /* ignore */ }
    setCreditsLoading(false);
  }, []);

  const loadCreditsTransactions = useCallback(async (userId: string) => {
    try {
      const resp = await fetch(`/api/credits?action=transactions&userId=${encodeURIComponent(userId)}&limit=50`);
      const data = await resp.json();
      if (data.success) setCreditsUserTransactions(data.transactions || []);
    } catch { /* ignore */ }
  }, []);

  const handleAdminRecharge = useCallback(async () => {
    if (!selectedCreditsUser || !adminRechargeAmount || Number(adminRechargeAmount) <= 0) return;
    setIsAdminRecharging(true);
    try {
      const resp = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-recharge', userId: selectedCreditsUser, amount: Number(adminRechargeAmount), description: adminRechargeDesc || `管理员充值 ${adminRechargeAmount} 积分` }),
      });
      const data = await resp.json();
      if (data.success) {
        setAdminRechargeAmount('');
        setAdminRechargeDesc('');
        await loadCreditsOverview();
        await loadCreditsTransactions(selectedCreditsUser);
      } else {
        alert(data.error || '充值失败');
      }
    } catch { alert('网络错误'); }
    setIsAdminRecharging(false);
  }, [selectedCreditsUser, adminRechargeAmount, adminRechargeDesc, loadCreditsOverview, loadCreditsTransactions]);

  useEffect(() => {
    if (activeTab === 'credits') {
      void loadCreditsData();
      if (isAdmin) void loadCreditsOverview();
    }
  }, [activeTab, isAdmin, loadCreditsData, loadCreditsOverview]);

  // ─── Admin: Ecom template handlers ───
  const loadEcomTemplates = useCallback(async () => {
    try { const resp = await fetch('/api/ecom-templates'); const data = await resp.json(); if (data.success) setEcomTemplates(data.templates || []); } catch { /* ignore */ }
  }, []);

  const saveEcomTemplate = useCallback(async (tpl: Record<string, unknown>) => {
    setIsEcomTplSaving(true);
    try {
      const payload: Record<string, unknown> = {
        action: 'save', id: tpl.id, name: tpl.name, icon: tpl.icon, description: tpl.description,
        promptTemplate: tpl.prompt_template || tpl.promptTemplate, negativePrompt: tpl.negative_prompt || tpl.negativePrompt,
        aspectRatio: tpl.aspect_ratio || tpl.aspectRatio, category: tpl.category,
        fidelityAnchor: tpl.fidelity_anchor || tpl.fidelityAnchor, sortOrder: tpl.sort_order || tpl.sortOrder,
        isEnabled: tpl.is_enabled !== undefined ? tpl.is_enabled : tpl.isEnabled,
      };
      const resp = await fetch('/api/ecom-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await resp.json();
      if (data.success) { await loadEcomTemplates(); setEditingEcomTpl(null); setShowNewEcomTpl(false); }
      else alert(data.error || '保存失败');
    } catch { alert('保存失败'); }
    setIsEcomTplSaving(false);
  }, [loadEcomTemplates]);

  const deleteEcomTemplate = useCallback(async (id: string) => {
    if (!confirm('确定删除此模板？')) return;
    try { const resp = await fetch('/api/ecom-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) }); if ((await resp.json()).success) setEcomTemplates(prev => prev.filter(t => t.id !== id)); } catch { /* ignore */ }
  }, []);

  const toggleEcomTemplateEnabled = useCallback(async (id: string, enabled: boolean) => {
    try { const resp = await fetch('/api/ecom-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id, isEnabled: enabled }) }); if ((await resp.json()).success) setEcomTemplates(prev => prev.map(t => t.id === id ? { ...t, is_enabled: enabled } : t)); } catch { /* ignore */ }
  }, []);

  const moveEcomTemplateOrder = useCallback(async (id: string, direction: 'up' | 'down') => {
    try { await fetch('/api/ecom-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder', id, direction }) }); await loadEcomTemplates(); } catch { /* ignore */ }
  }, [loadEcomTemplates]);

  useEffect(() => { if (isAdmin) void loadEcomTemplates(); }, [isAdmin, loadEcomTemplates]);

  // ─── Templates data ───
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

  const brands = [
    { id: '1', name: 'TechVision', color: '#4A90D9', keywords: ['科技', '创新', '未来感'] },
    { id: '2', name: 'GreenLeaf', color: '#4CAF50', keywords: ['自然', '有机', '环保'] },
  ];

  // =================== RENDER ===================
  return (
    <div className="h-screen w-screen flex overflow-hidden" style={{ '--dash-accent': accentHex, '--dash-accent-light': isMonochrome ? 'rgba(59,130,246,0.1)' : 'rgba(212,175,55,0.15)', '--dash-accent-mid': isMonochrome ? 'rgba(59,130,246,0.2)' : 'rgba(212,175,55,0.2)', '--dash-accent-ring': isMonochrome ? 'rgba(59,130,246,0.3)' : 'rgba(212,175,55,0.3)', '--dash-accent-hover': isMonochrome ? '#2563eb' : '#e0b840', '--dash-accent-text': isMonochrome ? '#fff' : '#000', } as React.CSSProperties }>
      {/* ===== Sidebar ===== */}
      <aside className={`w-[260px] shrink-0 flex flex-col ${isDark ? 'bg-[#0e0e1a]' : 'bg-white'} border-r ${isDark ? 'border-white/5' : 'border-gray-200'} overflow-hidden`}>
        {/* User info */}
        <div className="p-4">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setShowUserProfile(!showUserProfile)}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 hover:ring-2 ${accentRingClass} transition-all`} style={{ backgroundColor: accentColor }} title="查看用户信息">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-semibold truncate ${textPrimary}`}>{user.name}</div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${isAdmin ? `${accentBgLight} ${accentClass}` : isDark ? 'bg-white/5 text-gray-500' : 'bg-gray-100 text-gray-500'}`}>
                  {isAdmin ? '管理员' : '创作者'}
                </span>
              </div>
            </div>
            <ChevronRight className={`w-4 h-4 ${textSecondary} transition-transform duration-200 ${showUserProfile ? 'rotate-90' : ''}`} />
          </div>

          {/* User profile expandable */}
          {showUserProfile && (
            <div className={`mt-3 rounded-xl p-3 space-y-2.5 ${isDark ? 'bg-[#12121e] border border-white/5' : 'bg-gray-50 border border-gray-100'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] uppercase tracking-wider font-semibold ${textSecondary}`}>账户信息</span>
                <button onClick={(e) => { e.stopPropagation(); setShowUserProfile(false); }} className={`p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-200'}`}><X className={`w-3 h-3 ${textSecondary}`} /></button>
              </div>
              <div className={`text-[11px] space-y-1.5 ${textSecondary}`}>
                <div className="flex items-center gap-2"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{user.email || '未设置邮箱'}</span></div>
                <div className="flex items-center gap-2"><Calendar className="w-3 h-3 shrink-0" /><span>加入于 {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '未知'}</span></div>
              </div>
              <div>
                <div className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${textSecondary}`}>功能权限</div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { key: 'image', label: '图像', icon: '🎨' }, { key: 'chat', label: '对话', icon: '💬' },
                    { key: 'threeD', label: '3D', icon: '🧊' }, { key: 'imageEdit', label: '编辑', icon: '✏️' },
                    { key: 'vectorize', label: '矢量', icon: '📐' }, { key: 'layer', label: '分层', icon: '🗂️' },
                    { key: 'video', label: '视频', icon: '🎬' },
                  ].map(perm => {
                    const enabled = user.apiPermissions?.[perm.key as keyof typeof user.apiPermissions] ?? false;
                    return (<span key={perm.key} className={`text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-1 ${enabled ? `${accentBgLight} ${accentClass}` : isDark ? 'bg-white/5 text-gray-600' : 'bg-gray-100 text-gray-300'}`}><span>{perm.icon}</span><span>{perm.label}</span></span>);
                  })}
                </div>
              </div>
              <button onClick={() => { if (onLogout) onLogout(); }} className="w-full text-xs font-medium flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors cursor-pointer">
                <LogOut className="w-3.5 h-3.5" /> 退出登录
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-1 min-h-0 overflow-y-auto">
          {/* Regular tabs */}
          {[
            { key: 'projects' as TabType, label: '我的项目', icon: FolderOpen, count: projects.length },
            { key: 'templates' as TabType, label: '模板广场', icon: LayoutTemplate, count: null },
            { key: 'assets' as TabType, label: '资产库', icon: Layers, count: allImages.length },
            { key: 'stats' as TabType, label: '统计', icon: BarChart3, count: null },
            { key: 'settings' as TabType, label: '设置', icon: Settings, count: null },
            { key: 'credits' as TabType, label: '积分', icon: Wallet, count: creditsBalance > 0 ? creditsBalance : null },
          ].map(item => (
            <button key={item.key} onClick={() => setActiveTab(item.key)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${activeTab === item.key ? `${accentBgLight} ${accentClass}` : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}`}>
              <item.icon className="w-4.5 h-4.5" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.count !== null && <span className={`text-xs ${activeTab === item.key ? accentClass : textSecondary}`}>{item.count}</span>}
            </button>
          ))}

          {/* Admin tabs (only visible for admins) */}
          {isAdmin && (
            <>
              <div className={`pt-3 pb-1 mt-2 border-t ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
                <span className={`text-[10px] uppercase tracking-wider font-semibold ${textSecondary} px-3`}>管理</span>
              </div>
              {[
                { key: 'users' as TabType, label: '用户管理', icon: Users, count: adminUsers.length },
                { key: 'apis' as TabType, label: 'API 管理', icon: Server, count: providers.length },
                { key: 'data' as TabType, label: '数据管理', icon: Database, count: null },
                { key: 'credits' as TabType, label: '积分管理', icon: Wallet, count: null },
                { key: 'ecom-templates' as TabType, label: '电商模板', icon: ShoppingBag, count: ecomTemplates.length },
              ].map(item => (
                <button key={item.key} onClick={() => setActiveTab(item.key)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${activeTab === item.key ? `${accentBgLight} ${accentClass}` : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}`}>
                  <item.icon className="w-4.5 h-4.5" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.count !== null && <span className={`text-xs ${activeTab === item.key ? accentClass : textSecondary}`}>{item.count}</span>}
                </button>
              ))}
            </>
          )}
        </nav>

        {/* Bottom: Recent activity */}
        <div className={`p-3 border-t ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
          <div className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${textSecondary}`}>最近动态</div>
          <div className="space-y-1.5">
            {recentActivity.slice(0, 3).map(a => (
              <div key={a.id} className={`text-[11px] flex items-center gap-2 ${textSecondary}`}>
                <Clock className="w-3 h-3 shrink-0" />
                <span className="truncate flex-1">{a.name}</span>
                <span className="shrink-0">{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ===== Main Content ===== */}
      <main className="dashboard-scrollable flex-1 min-w-0 min-h-0">
        {/* ── Tab: Projects ── */}
        {activeTab === 'projects' && (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className={`px-8 pt-8 pb-4 ${isDark ? 'bg-[#0a0a0f]' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={`text-2xl font-bold ${textPrimary}`}>我的项目</h1>
                  <p className={`text-sm mt-1 ${textSecondary}`}>{projects.length} 个项目 · {allImages.length} 张图片</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${textSecondary}`} />
                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索项目..." className={`pl-9 pr-4 py-2 rounded-xl text-sm ${isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-gray-200'} border focus:outline-none focus:ring-1 ${accentRingClass} w-56`} />
                  </div>
                  <button onClick={importProjectInputRef} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer ${isDark ? `bg-white/5 border border-white/10 ${accentClass} hover:bg-white/10` : `bg-gray-100 border border-gray-200 ${isMonochrome ? 'text-[#3b82f6]' : 'text-gray-700'} hover:bg-gray-200`}`}>
                    <Upload className="w-4 h-4" /> 导入 .wujie
                  </button>
                  <button onClick={onNewProject} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium ${accentBgClass} ${accentTextOnBgClass} ${accentHoverBgClass} transition-colors cursor-pointer`}>
                    <Plus className="w-4 h-4" /> 新建项目
                  </button>
                </div>
              </div>
              {/* Filters */}
              <div className="flex gap-2 mt-4">
                {(['all', 'recent', 'starred'] as const).map(f => (
                  <button key={f} onClick={() => setProjectFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${projectFilter === f ? `${accentBgLight} ${accentClass}` : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}`}>
                    {{ all: '全部', recent: '最近', starred: '收藏' }[f]}
                  </button>
                ))}
              </div>
            </div>
            {/* Project Grid */}
            <div className="flex-1 overflow-y-auto px-8 pb-8">
              {filteredProjects.length === 0 ? (
                <div className={`flex flex-col items-center justify-center h-64 ${textSecondary}`}>
                  <FolderOpen className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">{searchQuery ? '没有找到匹配的项目' : '还没有项目，点击"新建项目"开始创作'}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
                  {filteredProjects.map(project => {
                    const imgs = (project.canvasImages as unknown as CanvasImage[]) || [];
                    const thumb = imgs.length > 0 ? imgs[imgs.length - 1]?.url : null;
                    const isRenaming = renamingProjectId === project.id;
                    return (
                      <div key={project.id} onClick={() => !isRenaming && onOpenProject(project)} className={`group rounded-xl border cursor-pointer transition-all hover:shadow-lg ${accentShadowClass} ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'} ${accentHoverBorderClass}`}>
                        {/* Thumbnail */}
                        <div className={`relative h-36 overflow-hidden rounded-t-xl ${isDark ? 'bg-gradient-to-br from-[#1a1a2e] to-[#0a0a0f]' : 'bg-gradient-to-br from-blue-50 to-gray-50'}`}>
                          {thumb ? <img src={thumb} alt={project.name} className="w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full"><Image className={`w-8 h-8 ${textSecondary} opacity-30`} /></div>}
                          {starredIds.has(project.id) && <Star className={`absolute top-2 right-2 w-4 h-4 ${accentClass} fill-current`} style={{ color: accentHex }} />}
                        </div>
                        {/* Info */}
                        <div className="p-3">
                          {isRenaming ? (
                            <div className="flex items-center gap-1">
                              <input value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleConfirmRename(); if (e.key === 'Escape') { setRenamingProjectId(null); setRenameValue(''); } }} onClick={e => e.stopPropagation()} autoFocus className={`flex-1 h-7 px-2 rounded text-sm ${inputClass}`} />
                              <Check className="w-4 h-4 text-green-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); handleConfirmRename(); }} />
                            </div>
                          ) : (
                            <h3 className={`text-sm font-semibold truncate ${textPrimary}`}>{project.name}</h3>
                          )}
                          <div className={`flex items-center justify-between mt-1`}>
                            <span className={`text-xs ${textSecondary}`}>{imgs.length} 张图片</span>
                            <div className="flex items-center gap-1">
                              <button onClick={(e) => toggleStar(project.id, e)} className={`p-1 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}>
                                <Star className={`w-3 h-3 ${starredIds.has(project.id) ? accentClass : textSecondary}`} style={starredIds.has(project.id) ? { color: accentHex, fill: accentHex } : undefined} />
                              </button>
                              <div className="relative" data-project-menu>
                                <button onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === project.id ? null : project.id); }} className={`p-1 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}>
                                  <MoreVertical className={`w-3 h-3 ${textSecondary}`} />
                                </button>
                                {menuOpenId === project.id && (
                                  <div className={`absolute right-0 top-6 z-20 rounded-xl border shadow-xl py-1 min-w-[120px] ${isDark ? 'bg-[#1a1a2e] border-white/10' : 'bg-white border-gray-200'}`}>
                                    <button onClick={(e) => { e.stopPropagation(); handleRenameProject(project.id, project.name); }} className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}><Pencil className="w-3 h-3" />重命名</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleExportProject(project); }} className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}><ArrowRight className="w-3 h-3" />导出 .wujie</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }} className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 text-red-400 hover:bg-red-500/10"><Trash2 className="w-3 h-3" />删除</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Templates ── */}
        {activeTab === 'templates' && (
          <div className="h-full overflow-y-auto px-8 py-8">
            <h1 className={`text-2xl font-bold mb-1 ${textPrimary}`}>模板广场</h1>
            <p className={`text-sm mb-6 ${textSecondary}`}>选择模板快速开始创作</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {templates.map(t => (
                <div key={t.id} className={`group rounded-xl border overflow-hidden cursor-pointer transition-all hover:shadow-lg ${accentShadowClass} ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'} ${accentHoverBorderClass}`} onClick={() => handleUseTemplate(t)}>
                  <div className="relative h-40 overflow-hidden">
                    <img src={t.image} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    <div className="absolute top-2 left-2"><span className={`text-[10px] px-2 py-0.5 rounded-full ${accentBgLight} ${accentClass} font-medium`}>{t.category}</span></div>
                    <div className="absolute top-2 right-2"><span className={`text-[10px] px-2 py-0.5 rounded-full ${isDark ? 'bg-black/50 text-white' : 'bg-white/80 text-gray-700'}`}>{t.usage} 次使用</span></div>
                  </div>
                  <div className="p-3">
                    <h3 className={`text-sm font-semibold ${textPrimary}`}>{t.name}</h3>
                    <p className={`text-xs mt-1 ${textSecondary}`}>{t.desc}</p>
                    <button className={`mt-2 w-full py-1.5 rounded-lg text-xs font-medium ${accentBgLight} ${accentClass} ${isMonochrome ? 'hover:bg-[#3b82f6]/20' : 'hover:bg-[#d4af37]/20'} transition-colors`}>使用模板</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tab: Assets ── */}
        {activeTab === 'assets' && (
          <div className="h-full flex flex-col">
            <div className={`px-8 pt-8 pb-4 ${isDark ? 'bg-[#0a0a0f]' : 'bg-gray-50'}`}>
              <h1 className={`text-2xl font-bold ${textPrimary}`}>资产库</h1>
              <div className="flex gap-2 mt-4">
                {(['images', 'prompts', 'brands'] as const).map(t => (
                  <button key={t} onClick={() => setAssetTab(t)} className={`px-4 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${assetTab === t ? `${accentBgLight} ${accentClass}` : `${textSecondary} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}`}>
                    {{ images: '图片', prompts: '提示词', brands: '品牌' }[t]}
                  </button>
                ))}
                {assetTab === 'images' && (
                  <div className="flex gap-1 ml-4">
                    {(['all', 'generated', 'uploaded'] as const).map(f => (
                      <button key={f} onClick={() => setImageFilter(f)} className={`px-2 py-1 rounded text-[10px] ${imageFilter === f ? accentClass : textSecondary}`}>
                        {{ all: '全部', generated: 'AI生成', uploaded: '上传' }[f]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-8 pb-8">
              {assetTab === 'images' && (
                filteredImages.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center h-64 ${textSecondary}`}><Image className="w-12 h-12 mb-3 opacity-30" /><p className="text-sm">暂无图片</p></div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-4">
                    {filteredImages.map((img, idx) => (
                      <div key={idx} className={`rounded-xl border overflow-hidden ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'}`}>
                        <div className="h-28 overflow-hidden"><img src={img.url} alt="" className="w-full h-full object-cover" /></div>
                        <div className="p-2"><p className={`text-[10px] truncate ${textSecondary}`}>{img.projectName}</p>{img.model && <p className={`text-[9px] ${accentClass} truncate`}>{img.model}</p>}</div>
                      </div>
                    ))}
                  </div>
                )
              )}
              {assetTab === 'prompts' && (
                allPrompts.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center h-64 ${textSecondary}`}><Sparkles className="w-12 h-12 mb-3 opacity-30" /><p className="text-sm">暂无提示词</p></div>
                ) : (
                  <div className="space-y-2 mt-4">
                    {allPrompts.map((p, idx) => (
                      <div key={idx} className={`rounded-xl border p-3 ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'}`}>
                        <p className={`text-sm ${textPrimary} line-clamp-2`}>{p.text}</p>
                        <div className={`flex items-center justify-between mt-2`}>
                          <span className={`text-[10px] ${textSecondary}`}>{p.projectName}{p.model ? ` · ${p.model}` : ''}</span>
                          <button onClick={() => handleCopyPrompt(p.text, idx)} className={`text-[10px] ${accentClass} hover:underline cursor-pointer`}>{copiedIdx === idx ? '已复制' : '复制'}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
              {assetTab === 'brands' && (
                <div className="space-y-3 mt-4">
                  {brands.map(b => (
                    <div key={b.id} className={`rounded-xl border p-4 ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg" style={{ backgroundColor: b.color }} />
                        <div><h3 className={`text-sm font-semibold ${textPrimary}`}>{b.name}</h3><div className="flex gap-1 mt-1">{b.keywords.map(k => <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded ${accentBgLight} ${accentClass}`}>{k}</span>)}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Stats ── */}
        {activeTab === 'stats' && (
          <div className="h-full overflow-y-auto p-8">
            <h1 className={`text-2xl font-bold mb-1 ${textPrimary}`}>统计</h1>
            <p className={`text-sm mb-6 ${textSecondary}`}>用量统计（近 30 天）</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: '请求数', value: statsArr.reduce((a, s) => a + (s.requests || 0), 0), icon: Zap, color: accentClass },
                { label: '图片数', value: statsArr.reduce((a, s) => a + (s.imagesGenerated || 0), 0), icon: Image, color: 'text-blue-400' },
                { label: 'Token', value: statsArr.reduce((a, s) => a + (s.tokensUsed || 0), 0).toLocaleString(), icon: BarChart3, color: 'text-green-400' },
                { label: '费用', value: `$${statsArr.reduce((a, s) => a + (s.estimatedCost || 0), 0).toFixed(2)}`, icon: Wallet, color: 'text-purple-400' },
              ].map((stat, i) => (
                <div key={i} className={`rounded-xl border p-5 ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                    <span className={`text-xs ${textSecondary}`}>{stat.label}</span>
                  </div>
                  <p className={`text-2xl font-bold ${textPrimary}`}>{stat.value}</p>
                </div>
              ))}
            </div>
            {statsArr.length === 0 && (
              <div className={`flex flex-col items-center justify-center h-48 ${textSecondary}`}>
                <BarChart3 className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">暂无统计数据</p>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Credits (User) ── */}
        {activeTab === 'credits' && !isAdmin && (
          <div className="h-full overflow-y-auto p-8">
            <h1 className={`text-2xl font-bold mb-1 ${textPrimary}`}>积分中心</h1>
            <p className={`text-sm mb-6 ${textSecondary}`}>管理您的积分余额与充值</p>

            {/* Balance Card */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className={`${cardBg} rounded-xl p-5 border ${borderColor}`}>
                <div className={`text-xs ${textSecondary} mb-1`}>当前余额</div>
                <div className="text-3xl font-bold text-blue-500">{creditsBalance}</div>
                <div className={`text-xs ${textSecondary} mt-1`}>≈ ¥{(creditsBalance * 0.01).toFixed(2)}</div>
              </div>
              <div className={`${cardBg} rounded-xl p-5 border ${borderColor}`}>
                <div className={`text-xs ${textSecondary} mb-1`}>累计充值</div>
                <div className="text-2xl font-bold text-green-500">{creditsTotalRecharged}</div>
                <div className={`text-xs ${textSecondary} mt-1`}>≈ ¥{(creditsTotalRecharged * 0.01).toFixed(2)}</div>
              </div>
              <div className={`${cardBg} rounded-xl p-5 border ${borderColor}`}>
                <div className={`text-xs ${textSecondary} mb-1`}>累计使用</div>
                <div className="text-2xl font-bold text-orange-500">{creditsTotalUsed}</div>
                <div className={`text-xs ${textSecondary} mt-1`}>≈ ¥{(creditsTotalUsed * 0.01).toFixed(2)}</div>
              </div>
            </div>

            {/* Pricing Reference (collapsible) */}
            {creditsPricing && (
              <div className="mb-6">
                <button
                  onClick={() => setShowPricingRef(!showPricingRef)}
                  className={`flex items-center gap-2 text-sm font-medium ${textSecondary} hover:text-blue-500 transition-colors`}
                >
                  <ChevronRight className={`w-4 h-4 transition-transform ${showPricingRef ? 'rotate-90' : ''}`} />
                  模型定价参考（1积分 ≈ ¥0.01）
                </button>
                {showPricingRef && (
                  <div className="mt-3 space-y-4">
                    {/* Image Models */}
                    <div className={`${cardBg} rounded-lg border ${borderColor} overflow-hidden`}>
                      <div className={`px-4 py-2 text-xs font-semibold ${textSecondary} bg-gradient-to-r from-blue-500/10 to-transparent`}>图像生成</div>
                      <div className="divide-y divide-border/30">
                        {Object.entries(creditsPricing.imageModels).map(([name, info]) => (
                          <div key={name} className="flex justify-between items-center px-4 py-2">
                            <span className={`text-sm ${textPrimary}`}>{info?.label || name}</span>
                            <span className="text-sm font-medium text-blue-500">{info?.credits ?? 0} 积分/次 <span className={textSecondary}>(¥{info?.cny ?? '0'})</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Video Models */}
                    <div className={`${cardBg} rounded-lg border ${borderColor} overflow-hidden`}>
                      <div className={`px-4 py-2 text-xs font-semibold ${textSecondary} bg-gradient-to-r from-purple-500/10 to-transparent`}>视频生成 (5秒)</div>
                      <div className="divide-y divide-border/30">
                        {Object.entries(creditsPricing.videoModels).map(([name, info]) => (
                          <div key={name} className="flex justify-between items-center px-4 py-2">
                            <span className={`text-sm ${textPrimary}`}>{info?.label || name}</span>
                            <span className="text-sm font-medium text-purple-500">{Math.round((info?.creditsPerSecond ?? 0) * 5)} 积分/5秒 <span className={textSecondary}>(¥{info?.cnyPerSecond ? (Number(info.cnyPerSecond) * 5).toFixed(2) : '0'})</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* LLM Models */}
                    <div className={`${cardBg} rounded-lg border ${borderColor} overflow-hidden`}>
                      <div className={`px-4 py-2 text-xs font-semibold ${textSecondary} bg-gradient-to-r from-green-500/10 to-transparent`}>AI 聊天</div>
                      <div className="divide-y divide-border/30">
                        {Object.entries(creditsPricing.chatModels).map(([name, info]) => (
                          <div key={name} className="flex justify-between items-center px-4 py-2">
                            <span className={`text-sm ${textPrimary}`}>{info?.label || name}</span>
                            <span className="text-sm font-medium text-green-500">{info?.creditsPerCall ?? 0} 积分/次 <span className={textSecondary}>(¥{info?.cny ?? '0'})</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Payment Step: Select Package ── */}
            {paymentStep === 'select' && (
              <>
                {/* Recharge Packages */}
                <div className="mb-6">
                  <h3 className={`text-base font-semibold ${textPrimary} mb-3`}>充值套餐</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {(creditsPricing?.rechargePackages || [
                      { credits: 100, bonusCredits: 0, label: '体验', price: 1 },
                      { credits: 500, bonusCredits: 10, label: '基础', price: 5 },
                      { credits: 2000, bonusCredits: 100, label: '标准', price: 20 },
                      { credits: 10000, bonusCredits: 1000, label: '专业', price: 100 },
                    ]).map((pkg) => (
                      <button
                        key={pkg.credits}
                        onClick={() => {
                          setRechargeAmount(pkg.credits);
                          setPaymentStep('select');
                        }}
                        className={`${cardBg} rounded-xl p-4 border ${borderColor} hover:border-blue-500/50 transition-all text-left group`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className={`text-xs ${textSecondary} mb-1`}>{pkg.label}</div>
                            <div className="text-xl font-bold text-blue-500">{pkg.credits}</div>
                            <div className={`text-xs ${textSecondary}`}>积分{pkg.bonusCredits > 0 ? <span className="text-green-500 ml-1">+{pkg.bonusCredits}赠送</span> : ''}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-green-500">¥{pkg.price}</div>
                            <Zap className="w-4 h-4 text-blue-500 mt-1 ml-auto" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Amount + Payment Method Selection */}
                <div className="mb-6">
                  <h3 className={`text-base font-semibold ${textPrimary} mb-3`}>自定义充值</h3>
                  <div className="flex gap-3 mb-4">
                    <input
                      type="number"
                      min="1"
                      value={rechargeAmount}
                      onChange={(e) => setRechargeAmount(Math.max(1, parseInt(e.target.value) || 0))}
                      className={`flex-1 px-4 py-2.5 rounded-lg border ${borderColor} ${inputBg} ${textPrimary} text-sm focus:outline-none focus:border-blue-500`}
                      placeholder="输入积分数量"
                    />
                    <div className={`px-4 py-2.5 rounded-lg ${cardBg} border ${borderColor} text-sm ${textSecondary} flex items-center whitespace-nowrap`}>
                      ¥{(Number(rechargeAmount || 0) * 0.01).toFixed(2)}
                    </div>
                  </div>

                  {/* Payment Method Selection */}
                  <div className={`text-sm font-medium ${textPrimary} mb-2`}>选择支付方式</div>
                  <div className="flex gap-3 mb-4">
                    <button
                      onClick={() => setSelectedPaymentMethod('alipay')}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${
                        selectedPaymentMethod === 'alipay'
                          ? 'border-blue-500 bg-blue-500/10'
                          : `${borderColor} ${cardBg} hover:border-blue-500/50`
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#1677FF] flex items-center justify-center text-white text-xs font-bold">支</div>
                      <span className={`text-sm font-medium ${selectedPaymentMethod === 'alipay' ? 'text-blue-500' : textPrimary}`}>支付宝</span>
                    </button>
                    <button
                      onClick={() => setSelectedPaymentMethod('wechat')}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${
                        selectedPaymentMethod === 'wechat'
                          ? 'border-green-500 bg-green-500/10'
                          : `${borderColor} ${cardBg} hover:border-green-500/50`
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#07C160] flex items-center justify-center text-white text-xs font-bold">微</div>
                      <span className={`text-sm font-medium ${selectedPaymentMethod === 'wechat' ? 'text-green-500' : textPrimary}`}>微信支付</span>
                    </button>
                  </div>

                  <button
                    onClick={() => handleCreateOrder(Number(rechargeAmount) || 0, selectedPaymentMethod)}
                    disabled={isRecharging || !rechargeAmount || Number(rechargeAmount) <= 0}
                    className={`w-full py-3 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                      selectedPaymentMethod === 'alipay'
                        ? 'bg-[#1677FF] hover:bg-[#0958d9]'
                        : 'bg-[#07C160] hover:bg-[#06ad56]'
                    }`}
                  >
                    {isRecharging ? '创建订单中...' : `${selectedPaymentMethod === 'alipay' ? '支付宝' : '微信'}支付 ¥${(Number(rechargeAmount || 0) * 0.01).toFixed(2)}`}
                  </button>

                  {rechargeError && (
                    <div className="mt-3 text-sm text-red-500 text-center">{rechargeError}</div>
                  )}
                </div>
              </>
            )}

            {/* ── Payment Step: Paying ── */}
            {paymentStep === 'paying' && (
              <div className={`${cardBg} rounded-xl border ${borderColor} p-6 mb-6`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className={`text-base font-semibold ${textPrimary}`}>确认支付</h3>
                  <button
                    onClick={() => { setPaymentStep('select'); setPaymentPolling(false); setRechargeError(''); }}
                    className={`text-xs ${textSecondary} hover:text-red-500`}
                  >
                    取消支付
                  </button>
                </div>
                <div className="text-center">
                  <div className={`text-sm ${textSecondary} mb-2`}>支付金额</div>
                  <div className="text-4xl font-bold text-blue-500 mb-1">¥{(pendingOrderAmount * 0.01).toFixed(2)}</div>
                  <div className={`text-sm ${textSecondary} mb-6`}>{pendingOrderAmount} 积分</div>

                  {/* QR Code / Payment Link */}
                  {paymentQrUrl ? (
                    <div className="inline-block p-4 bg-white rounded-xl mb-4">
                      <img src={paymentQrUrl} alt="支付二维码" className="w-48 h-48" />
                    </div>
                  ) : paymentPageUrl ? (
                    <div className="mb-4">
                      <a
                        href={paymentPageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-medium ${
                          selectedPaymentMethod === 'alipay' ? 'bg-[#1677FF] hover:bg-[#0958d9]' : 'bg-[#07C160] hover:bg-[#06ad56]'
                        }`}
                      >
                        {selectedPaymentMethod === 'alipay' ? '打开支付宝支付' : '打开微信支付'}
                        <ArrowRight className="w-4 h-4" />
                      </a>
                    </div>
                  ) : (
                    <div className="mb-4">
                      <div className={`inline-block p-4 rounded-xl ${inputBg}`}>
                        <div className={`text-sm ${textSecondary}`}>
                          {paymentPolling ? '正在等待支付...' : '请完成支付'}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className={`text-sm ${textSecondary} mb-2`}>
                    请使用{selectedPaymentMethod === 'alipay' ? '支付宝' : '微信'}扫描二维码完成支付
                  </div>
                  {paymentPolling && (
                    <div className="flex items-center justify-center gap-2 text-blue-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">等待支付确认...</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Payment Step: Success ── */}
            {paymentStep === 'success' && (
              <div className={`${cardBg} rounded-xl border ${borderColor} p-8 mb-6 text-center`}>
                <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className={`text-xl font-bold ${textPrimary} mb-2`}>充值成功</h3>
                <div className={`text-sm ${textSecondary} mb-4`}>
                  已成功充值 {pendingOrderAmount} 积分
                </div>
                <button
                  onClick={() => {
                    setPaymentStep('select');
                    setPendingOrderId(null);
                    setPendingOrderAmount(0);
                    setPaymentQrUrl(null);
                    setPaymentPageUrl(null);
                    setRechargeAmount('');
                  }}
                  className="px-6 py-2.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
                >
                  继续充值
                </button>
              </div>
            )}

            {/* Transaction History */}
            <div>
              <h3 className={`text-base font-semibold ${textPrimary} mb-3`}>交易记录</h3>
              {creditsTransactions.length === 0 ? (
                <div className={`text-center py-8 ${textSecondary} text-sm`}>暂无交易记录</div>
              ) : (
                <div className="space-y-2">
                  {creditsTransactions.map((tx: { id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: number }) => (
                    <div key={tx.id} className={`flex items-center justify-between ${cardBg} rounded-lg px-4 py-3 border ${borderColor}`}>
                      <div>
                        <div className={`text-sm font-medium ${textPrimary}`}>
                          {tx.type === 'recharge' ? '充值' : tx.type === 'consume' ? '使用' : tx.type === 'refund' ? '退款' : '调整'}
                        </div>
                        <div className={`text-xs ${textSecondary}`}>{tx.description || '-'}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-semibold ${tx.amount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {tx.amount > 0 ? '+' : ''}{tx.amount}
                        </div>
                        <div className={`text-xs ${textSecondary}`}>余额: {tx.balanceAfter}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Credits (Admin) ── */}
        {activeTab === 'credits' && isAdmin && (
          <div className="h-full overflow-y-auto p-8">
            <h1 className={`text-2xl font-bold mb-1 ${textPrimary}`}>积分管理</h1>
            <p className={`text-sm mb-6 ${textSecondary}`}>查看用户积分情况，进行充值与调整（1积分 ≈ ¥0.01）</p>

            {/* Overview Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className={`${cardBg} rounded-xl p-5 border ${borderColor}`}>
                <div className={`text-xs ${textSecondary} mb-1`}>总用户数</div>
                <div className="text-2xl font-bold text-blue-500">{creditsUsers.length}</div>
              </div>
              <div className={`${cardBg} rounded-xl p-5 border ${borderColor}`}>
                <div className={`text-xs ${textSecondary} mb-1`}>总充值积分</div>
                <div className="text-2xl font-bold text-green-500">{creditsUsers.reduce((sum: number, u: { totalRecharged: number }) => sum + (u.totalRecharged || 0), 0)}</div>
              </div>
              <div className={`${cardBg} rounded-xl p-5 border ${borderColor}`}>
                <div className={`text-xs ${textSecondary} mb-1`}>总消耗积分</div>
                <div className="text-2xl font-bold text-orange-500">{creditsUsers.reduce((sum: number, u: { totalUsed: number }) => sum + (u.totalUsed || 0), 0)}</div>
              </div>
            </div>

            {/* User Credits Table */}
            <div className="mb-6">
              <h3 className={`text-base font-semibold ${textPrimary} mb-3`}>用户积分概览</h3>
              <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className={`${inputBg} border-b ${borderColor}`}>
                      <th className={`text-left px-4 py-3 ${textSecondary} font-medium`}>用户</th>
                      <th className={`text-right px-4 py-3 ${textSecondary} font-medium`}>余额</th>
                      <th className={`text-right px-4 py-3 ${textSecondary} font-medium`}>累计充值</th>
                      <th className={`text-right px-4 py-3 ${textSecondary} font-medium`}>累计使用</th>
                      <th className={`text-center px-4 py-3 ${textSecondary} font-medium`}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditsUsers.length === 0 ? (
                      <tr><td colSpan={5} className={`text-center py-6 ${textSecondary}`}>暂无数据</td></tr>
                    ) : creditsUsers.map((user) => (
                      <tr key={user.userId} className={`border-b ${borderColor} hover:bg-muted/50 transition-colors`}>
                        <td className={`px-4 py-3 ${textPrimary} font-medium`}>{user.userName || user.userId}</td>
                        <td className="px-4 py-3 text-right font-semibold text-blue-500">{user.balance}</td>
                        <td className="px-4 py-3 text-right text-green-500">{user.totalRecharged}</td>
                        <td className="px-4 py-3 text-right text-orange-500">{user.totalUsed}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => { setSelectedCreditsUser(user.userId); loadCreditsTransactions(user.userId); }}
                            className="text-xs text-blue-500 hover:text-blue-600 font-medium"
                          >
                            详情/充值
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected User Detail */}
            {selectedCreditsUser && (
              <div className={`${cardBg} rounded-xl border ${borderColor} p-6 mb-6`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className={`text-base font-semibold ${textPrimary}`}>
                    {(creditsUsers.find(u => u.userId === selectedCreditsUser)?.userName || selectedCreditsUser)} 的积分详情
                  </h3>
                  <button onClick={() => setSelectedCreditsUser(null)} className={`text-xs ${textSecondary} hover:text-red-500`}>关闭</button>
                </div>

                {/* Admin Recharge */}
                <div className="mb-4">
                  <div className={`text-sm font-medium ${textPrimary} mb-2`}>管理员充值</div>
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {[50, 100, 500, 1000, 5000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => setAdminRechargeAmount(amount)}
                        className={`px-3 py-1.5 text-xs rounded-lg border ${adminRechargeAmount === amount ? 'border-blue-500 bg-blue-500/10 text-blue-500' : `${borderColor} ${textSecondary} hover:border-blue-500/50`} transition-colors`}
                      >
                        {amount}积分
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      value={adminRechargeAmount}
                      onChange={(e) => setAdminRechargeAmount(Math.max(1, parseInt(e.target.value) || 0))}
                      className={`flex-1 px-3 py-2 rounded-lg border ${borderColor} ${inputBg} ${textPrimary} text-sm focus:outline-none focus:border-blue-500`}
                      placeholder="自定义积分"
                    />
                    <input
                      type="text"
                      value={adminRechargeDesc}
                      onChange={(e) => setAdminRechargeDesc(e.target.value)}
                      className={`flex-1 px-3 py-2 rounded-lg border ${borderColor} ${inputBg} ${textPrimary} text-sm focus:outline-none focus:border-blue-500`}
                      placeholder="备注说明"
                    />
                    <button
                      onClick={async () => {
                        if (!selectedCreditsUser || Number(adminRechargeAmount || 0) <= 0) return;
                        setIsAdminRecharging(true);
                        try {
                          const res = await fetch('/api/credits', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'admin-recharge',
                              userId: selectedCreditsUser,
                              amount: adminRechargeAmount,
                              description: adminRechargeDesc || `管理员充值 ${adminRechargeAmount} 积分`,
                            }),
                          });
                          const data = await res.json();
                          if (data.success) {
                            setAdminRechargeAmount(100);
                            setAdminRechargeDesc('');
                            loadCreditsOverview();
                            loadCreditsTransactions(selectedCreditsUser);
                          } else {
                            alert(data.error || '充值失败');
                          }
                        } catch { alert('网络错误'); }
                        setIsAdminRecharging(false);
                      }}
                      disabled={isAdminRecharging || Number(adminRechargeAmount || 0) <= 0}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
                    >
                      {isAdminRecharging ? '处理中...' : '充值'}
                    </button>
                  </div>
                </div>

                {/* User Transactions */}
                <div>
                  <div className={`text-sm font-medium ${textPrimary} mb-2`}>交易记录</div>
                  {creditsTransactions.length === 0 ? (
                    <div className={`text-center py-4 ${textSecondary} text-sm`}>暂无记录</div>
                  ) : (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {creditsTransactions.map((tx: { id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: number }) => (
                        <div key={tx.id} className={`flex items-center justify-between px-3 py-2 rounded-lg ${inputBg}`}>
                          <div>
                            <span className={`text-xs font-medium ${tx.amount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {tx.amount > 0 ? '+' : ''}{tx.amount}
                            </span>
                            <span className={`text-xs ${textSecondary} ml-2`}>
                              {tx.type === 'recharge' ? '充值' : tx.type === 'consume' ? '使用' : tx.type === 'refund' ? '退款' : '调整'}
                            </span>
                          </div>
                          <div className={`text-xs ${textSecondary}`}>
                            余额 {tx.balanceAfter} · {new Date(tx.createdAt).toLocaleString('zh-CN')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Settings ── */}
        {activeTab === 'settings' && (
          <div className="h-full overflow-y-auto p-8">
            <h1 className={`text-2xl font-bold mb-1 ${textPrimary}`}>设置</h1>
            <p className={`text-sm mb-6 ${textSecondary}`}>账户信息与偏好设置</p>

            {/* User Info */}
            <div className={`rounded-xl border p-5 mb-4 ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center gap-4 mb-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-xl ${isMonochrome ? 'bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8]' : isDark ? 'bg-gradient-to-br from-[#d4af37] to-[#b8860b]' : 'bg-gradient-to-br from-gray-600 to-gray-800'}`}>
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-base font-semibold ${textPrimary}`}>{user?.name || '未知用户'}</p>
                  <p className={`text-sm ${textSecondary}`}>{user?.email || '未设置邮箱'}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${user?.role === 'admin' ? (isDark ? `bg-[${accentHex}]/15 ${accentClass}` : isMonochrome ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700') : (isDark ? 'bg-white/5 text-[#888] border border-white/10' : 'bg-gray-100 text-gray-500')}`}>
                  {user?.role === 'admin' ? '管理员' : '普通用户'}
                </span>
              </div>
              <div className={`text-sm space-y-1 ${textSecondary}`}>
                <p>用户ID: {user?.id || '-'}</p>
                <p>加入时间: {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}</p>
              </div>
            </div>

            {/* API Permissions */}
            <div className={`rounded-xl border p-5 mb-4 ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'}`}>
              <p className={`text-xs font-medium uppercase tracking-wider mb-3 ${textSecondary}`}>API 权限</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'image', label: '图像生成', icon: Image },
                  { key: 'chat', label: 'AI 聊天', icon: Sparkles },
                  { key: 'video', label: '视频生成', icon: Film },
                  { key: 'threeD', label: '3D 模型', icon: Box },
                  { key: 'imageEdit', label: '图像编辑', icon: Pencil },
                  { key: 'vectorize', label: '矢量化', icon: Palette },
                  { key: 'layer', label: '图层分离', icon: Layers },
                ].map(perm => {
                  const enabled = user?.apiPermissions?.[perm.key as keyof typeof user.apiPermissions] ?? false;
                  const PermIcon = perm.icon;
                  return (
                    <div key={perm.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${enabled ? (isDark ? `${accentBgLight} ${accentClass}` : 'bg-green-50 text-green-600') : (isDark ? 'bg-white/5 text-[#444]' : 'bg-gray-100 text-gray-300')}`}>
                      <PermIcon className="w-3.5 h-3.5" />
                      <span>{perm.label}</span>
                      <span className={`ml-auto w-2 h-2 rounded-full ${enabled ? 'bg-green-400' : (isDark ? 'bg-white/10' : 'bg-gray-300')}`} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className={`rounded-xl border p-5 ${isDark ? 'bg-[#1a1a2e]/80 border-primary/20' : 'bg-white border-gray-200'}`}>
              <div className="flex flex-col gap-3">
                <button onClick={() => { if (user) { mgr.setCurrentUser(user.id); } }} className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all cursor-pointer ${isDark ? `bg-white/5 border border-white/10 ${accentClass} hover:bg-white/10` : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'}`}>
                  <RotateCcw className="w-4 h-4" /> 刷新会话
                </button>
                <button onClick={onLogout} className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all cursor-pointer bg-red-900/20 text-red-400 border border-red-900/30 hover:bg-red-900/30">
                  <LogOut className="w-4 h-4" /> 退出登录
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ ADMIN TABS ══════════ */}

        {/* ── Tab: Users ── */}
        {activeTab === 'users' && isAdmin && (
          <div className="h-full overflow-y-auto p-6">
            <h1 className={`text-xl font-bold mb-1 ${textPrimary}`}>用户管理</h1>
            <p className={`text-sm mb-6 ${textSecondary}`}>创建用户、管理权限和账户状态</p>
            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
              {/* Add user form */}
              <div className={`rounded-xl border p-4 h-fit ${softClass}`}>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4" />添加用户</h3>
                <div className="space-y-3">
                  <div><label className={labelClass} htmlFor="admin-new-user-name">用户名</label><input id="admin-new-user-name" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="例如 设计师01" value={newUserName} onChange={e => setNewUserName(e.target.value)} /></div>
                  <div><label className={labelClass} htmlFor="admin-new-user-password">初始密码</label><input id="admin-new-user-password" type="password" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="至少 6 位" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} /></div>
                  <div><label className={labelClass} htmlFor="admin-new-user-email">邮箱（可选）</label><input id="admin-new-user-email" type="email" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="邮箱地址" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} /></div>
                  <button onClick={() => void handleCreateUser()} className={`w-full h-9 rounded-lg ${accentBgClass} ${accentTextOnBgClass} text-sm font-semibold cursor-pointer`}>创建用户</button>
                </div>
              </div>
              {/* User list */}
              <div className="space-y-2">
                {adminUsers.map(u => (
                  <div key={u.id} className={`rounded-xl border p-4 ${softClass}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${accentBgClass} ${accentTextOnBgClass} flex items-center justify-center font-bold shrink-0`}>{u.name.slice(0, 1).toUpperCase()}</div>
                      <div className="flex-1 min-w-0">
                        {editingUser === u.id ? (
                          <div className="flex items-center gap-2">
                            <input className={`h-8 px-2 rounded-lg border text-sm flex-1 ${inputClass}`} value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void handleRenameUser(u.id); if (e.key === 'Escape') { setEditingUser(null); setEditName(''); } }} autoFocus />
                            <button onClick={() => void handleRenameUser(u.id)} className={`px-2 py-1 rounded-lg ${accentBgClass} ${accentTextOnBgClass} text-xs font-semibold cursor-pointer`}>保存</button>
                            <button onClick={() => { setEditingUser(null); setEditName(''); }} className={`px-2 py-1 rounded-lg text-xs border cursor-pointer ${isDark ? 'border-white/10 text-[#888]' : 'border-gray-200 text-gray-500'}`}>取消</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate">{u.name}</p>
                            {u.role === 'admin' && <span className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-[#3b82f6]/20 text-[#3b82f6]' : 'bg-[#d4af37]/20 text-[#d4af37]'}`}>管理员</span>}
                            {u.status === 'disabled' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">已禁用</span>}
                          </div>
                        )}
                        <p className={`text-xs mt-0.5 ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>{u.email || '无邮箱'} · {u.id}</p>
                      </div>
                    </div>
                    {/* Permissions */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(Object.keys(userPermissionLabels) as UserPermissionKey[]).map(key => {
                        const enabled = u.apiPermissions?.[key] ?? true;
                        return (<button key={key} onClick={() => void handleToggleUserPermission(u, key)} className={`text-[10px] px-2 py-1 rounded-md border cursor-pointer ${enabled ? `${accentBgLight} ${accentClass} border-transparent` : isDark ? 'bg-white/5 text-[#555] border-white/10' : 'bg-gray-50 text-gray-300 border-gray-200'}`}>{userPermissionLabels[key]}</button>);
                      })}
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3 pt-2 border-t border-current/5">
                      <button onClick={() => { setEditingUser(u.id); setEditName(u.name); }} className={`text-xs px-2 py-1 rounded-lg cursor-pointer ${isDark ? 'hover:bg-white/10 text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`}><Pencil className="w-3 h-3 inline mr-1" />重命名</button>
                      {resetPwdUser === u.id ? (
                        <div className="flex items-center gap-1">
                          <input type="password" className={`h-7 px-2 rounded-lg border text-xs w-24 ${inputClass}`} placeholder="新密码" value={newPassword} onChange={e => setNewPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void handleResetPassword(u.id); }} autoFocus />
                          <button onClick={() => void handleResetPassword(u.id)} className={`text-[10px] px-2 py-1 rounded-lg ${accentBgClass} ${accentTextOnBgClass} font-semibold cursor-pointer`}>确定</button>
                          <button onClick={() => { setResetPwdUser(null); setNewPassword(''); }} className={`text-[10px] px-2 py-1 rounded-lg cursor-pointer ${isDark ? 'text-[#888]' : 'text-gray-500'}`}>取消</button>
                        </div>
                      ) : (
                        <button onClick={() => { setResetPwdUser(u.id); setNewPassword(''); }} className={`text-xs px-2 py-1 rounded-lg cursor-pointer ${isDark ? 'hover:bg-white/10 text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`}><KeyRound className="w-3 h-3 inline mr-1" />重置密码</button>
                      )}
                      {u.role !== 'admin' && (
                        <>
                          <button onClick={() => void handleToggleUser(u)} className={`text-xs px-2 py-1 rounded-lg cursor-pointer ${u.status === 'disabled' ? 'text-green-400 hover:bg-green-500/10' : isDark ? 'hover:bg-white/10 text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`}>
                            {u.status === 'disabled' ? <><CheckCircle2 className="w-3 h-3 inline mr-1" />启用</> : <><Ban className="w-3 h-3 inline mr-1" />禁用</>}
                          </button>
                          <button onClick={() => handleDeleteUser(u)} className="text-xs px-2 py-1 rounded-lg text-red-400 hover:bg-red-500/10 cursor-pointer"><Trash2 className="w-3 h-3 inline mr-1" />删除</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: API Management ── */}
        {activeTab === 'apis' && isAdmin && (
          <div className="h-full overflow-y-auto p-6">
            <h1 className={`text-xl font-bold mb-1 ${textPrimary}`}>API 管理</h1>
            <p className={`text-sm mb-6 ${textSecondary}`}>配置图像、对话、3D、矢量等模型接口</p>
            <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
              {/* Add/Edit API form */}
              <div className={`rounded-xl border p-4 h-fit ${softClass}`}>
                <h3 className="text-sm font-semibold mb-3">{editingProviderId ? '编辑 API' : '添加 API'}</h3>
                <div className="space-y-3">
                  <div><label className={labelClass}>API 类型</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(Object.keys(apiKindLabels) as ApiKind[]).map(kind => (
                        <button key={kind} onClick={() => setApiKind(kind)} className={`px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer ${apiKind === kind ? `${accentBgClass} ${accentTextOnBgClass}` : isDark ? 'bg-white/5 text-[#999] border border-white/10' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>{apiKindLabels[kind]}</button>
                      ))}
                    </div>
                    <p className={`mt-1 text-[10px] ${isDark ? 'text-[#555]' : 'text-gray-400'}`}>{apiKindDescriptions[apiKind]}</p>
                  </div>
                  <div><label className={labelClass}>接口地址</label><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="https://接口域名" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} /></div>
                  <div><label className={labelClass}>固定 API 密钥</label><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="只保存在服务端配置" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} /></div>
                  {/* Discover models */}
                  <button onClick={() => void handleDiscoverModels()} disabled={isDiscovering || !apiBaseUrl.trim() || !apiKey.trim()} className={`w-full h-9 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 border ${isDark ? 'border-white/20 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50'} ${accentClass} disabled:opacity-40 cursor-pointer`}>
                    <RefreshCw className={`w-3.5 h-3.5 ${isDiscovering ? 'animate-spin' : ''}`} />{isDiscovering ? '识别中...' : '自动识别模型'}
                  </button>
                  {discoveredModels.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1"><p className={`text-xs ${isDark ? 'text-[#777]' : 'text-gray-500'}`}>选择前端可见模型</p>
                        <button onClick={() => { const allIds = discoveredModels.map(m => m.id); setSelectedModels(selectedModels.length === allIds.length ? [] : allIds); }} className={`text-xs px-2 py-0.5 rounded border cursor-pointer ${accentClass} ${accentBorderClass} ${accentBgLight}`}>{selectedModels.length === discoveredModels.length ? '取消全选' : '全选'}</button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(() => { const q = modelSearchQuery.toLowerCase().trim(); const sorted = q ? [...discoveredModels].sort((a, b) => { const aMatch = (a.name || a.id).toLowerCase().includes(q) ? 0 : 1; const bMatch = (b.name || b.id).toLowerCase().includes(q) ? 0 : 1; return aMatch - bMatch; }) : discoveredModels; return sorted.map(model => (<button key={model.id} onClick={() => setSelectedModels(prev => prev.includes(model.id) ? prev.filter(id => id !== model.id) : [...prev, model.id])} className={`px-2.5 py-1 rounded-md text-xs border cursor-pointer ${selectedModels.includes(model.id) ? `${accentBgClass} ${accentTextOnBgClass} border-transparent` : isDark ? 'bg-white/5 text-[#999] border-white/10' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>{model.name && model.name !== model.id ? model.name : getModelDisplayName(model.id)}</button>)); })()}
                      </div>
                    </div>
                  )}
                  <div><label className={labelClass}>显示名称</label><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="例如：图像生成接口" value={apiName} onChange={e => setApiName(e.target.value)} /></div>
                  <div><label className={labelClass}>默认模型 ID（可选）</label><input className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="未自动识别时填写" value={apiModel} onChange={e => setApiModel(e.target.value)} /></div>
                  <div><label className={labelClass}>API 兼容模式</label>
                    <select className={`w-full h-10 px-3 rounded-lg border text-sm ${isDark ? 'bg-white/5 border-white/10 text-[#ccc]' : 'bg-white border-gray-200 text-gray-800'}`} value={compatProfile} onChange={e => setCompatProfile(e.target.value)}>
                      <option value="auto">自动检测</option><option value="apimart">异步轮询 (宽高比)</option><option value="openai">OpenAI 兼容 (直接返回)</option><option value="openai-async">OpenAI 兼容 (异步轮询)</option>
                    </select>
                  </div>
                  {/* Advanced params */}
                  <div>
                    <button type="button" onClick={() => setShowAdvancedParams(!showAdvancedParams)} className={`flex items-center gap-2 text-sm font-medium cursor-pointer ${isDark ? 'text-[#ccc]' : 'text-gray-700'}`}><Settings className="w-4 h-4" /><span>高级参数{advancedParams.length > 0 ? `(${advancedParams.length})` : ''}</span><ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvancedParams ? 'rotate-180' : ''}`} /></button>
                    {showAdvancedParams && (
                      <div className="mt-2 space-y-2">
                        {advancedParams.map((param, idx) => (<div key={idx} className="flex items-center gap-2"><input className={`w-[35%] shrink-0 h-9 px-2.5 rounded-lg border text-sm ${inputClass}`} placeholder="参数名" value={param.key} onChange={e => { const next = [...advancedParams]; next[idx] = { ...next[idx], key: e.target.value }; setAdvancedParams(next); }} /><input className={`flex-1 min-w-0 h-9 px-2.5 rounded-lg border text-sm ${inputClass}`} placeholder="参数值" value={param.value} onChange={e => { const next = [...advancedParams]; next[idx] = { ...next[idx], value: e.target.value }; setAdvancedParams(next); }} /><button type="button" onClick={() => setAdvancedParams(prev => prev.filter((_, i) => i !== idx))} className="p-1.5 rounded-md text-red-500 hover:bg-red-500/10 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button></div>))}
                        <button type="button" onClick={() => setAdvancedParams(prev => [...prev, { key: `param_${Date.now().toString().slice(-5)}`, value: '' }])} className={`flex items-center gap-1.5 text-xs cursor-pointer ${isDark ? 'text-[#888] hover:text-[#aaa]' : 'text-gray-500 hover:text-gray-700'}`}><Plus className="w-3.5 h-3.5" />添加参数</button>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void handleTestNewConnection()} disabled={isTestingNew || !apiBaseUrl || !apiKey} className={`flex-1 h-9 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 border disabled:opacity-40 cursor-pointer ${isDark ? `border-white/20 ${accentClass} hover:bg-white/5` : `border-gray-300 ${accentClass} hover:bg-gray-50`}`}><RefreshCw className={`w-3.5 h-3.5 ${isTestingNew ? 'animate-spin' : ''}`} />{isTestingNew ? '测试中...' : '测试连接'}</button>
                    <button onClick={() => editingProviderId ? void handleUpdateApi() : void handleAddApi()} className={`flex-1 h-9 rounded-lg text-sm font-semibold cursor-pointer ${editingProviderId ? 'bg-blue-600 text-white' : `${accentBgClass} ${accentTextOnBgClass}`}`}>{editingProviderId ? '更新 API' : '添加 API'}</button>
                  </div>
                  {testNewResult && (<div className={`text-xs px-3 py-2 rounded-lg ${testNewResult.success ? (isDark ? 'bg-green-500/10 text-green-400' : 'bg-green-50 text-green-700') : (isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-700')}`}>{testNewResult.success ? `连接成功 · ${testNewResult.modelCount ?? 0} 个模型可用` : `连接失败：${testNewResult.error || testNewResult.message}`}</div>)}
                  {editingProviderId && (<button onClick={() => { setEditingProviderId(null); setApiName(''); setApiBaseUrl(''); setApiKey(''); setApiModel(''); setDiscoveredModels([]); setSelectedModels([]); setModelSearchQuery(''); }} className={`w-full h-9 rounded-lg text-sm border cursor-pointer ${isDark ? 'border-white/20 text-[#888] hover:bg-white/5' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>取消编辑</button>)}
                </div>
              </div>
              {/* Provider list */}
              <div className="space-y-2">
                <div className="flex justify-end gap-2">
                  <button onClick={() => void refreshBalances()} className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer ${isDark ? 'bg-white/5 text-[#aaa]' : 'bg-gray-100 text-gray-600'}`}><Activity className="w-3 h-3" />刷新余额</button>
                  <button onClick={() => void refreshAdmin()} className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer ${isDark ? 'bg-white/5 text-[#aaa]' : 'bg-gray-100 text-gray-600'}`}><RefreshCw className="w-3 h-3" />刷新模型</button>
                </div>
                {providers.map((provider, providerIndex) => (
                  <div key={provider.id} className={`rounded-xl border p-4 ${softClass}`}>
                    <div className="flex items-start gap-3">
                      <Plug className={`w-5 h-5 mt-0.5 shrink-0 ${provider.isEnabled ? accentClass : 'text-gray-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{provider.displayName || provider.name}</p>
                          <span className={`text-xs px-2 py-0.5 rounded ${isDark ? 'bg-[#222] text-[#aaa]' : 'bg-gray-200 text-gray-600'}`}>{apiKindLabels[provider.modelType as ApiKind] || provider.modelType}</span>
                          {provider.isEnabled && <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-500">启用</span>}
                        </div>
                        <p className={`text-xs mt-1 truncate ${isDark ? 'text-[#666]' : 'text-gray-500'}`}>{provider.baseUrl}</p>
                        <p className={`text-xs mt-1 font-mono ${isDark ? 'text-[#555]' : 'text-gray-400'}`}>{provider.apiKeyPreview || `${provider.apiKey.slice(0, 8)}****************`}</p>
                        {provider.selectedModels && provider.selectedModels.length > 0 && (
                          <div className="mt-2"><p className={`text-xs mb-1 ${isDark ? 'text-[#888]' : 'text-gray-500'}`}>当前模型：</p><div className="flex flex-wrap gap-1">{provider.selectedModels.map(modelId => { const discovered = (provider.discoveredModels || []).find((dm: { id: string }) => dm.id === modelId); const displayName = discovered?.name && discovered.name !== modelId ? discovered.name : getModelDisplayName(modelId); return <span key={modelId} className={`text-xs px-2 py-0.5 rounded ${isDark ? `bg-[${accentHex}]/15 ${accentClass}` : isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{displayName}</span>; })}</div></div>
                        )}
                        {provider.modelType === 'vectorize' && provider.isEnabled && <div className={`mt-2 text-xs px-2 py-1 rounded ${isDark ? `bg-[${accentHex}]/10 ${accentClass}` : isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>已对接：矢量化工具 / 导出SVG</div>}
                        {provider.modelType === 'layer' && provider.isEnabled && <div className={`mt-2 text-xs px-2 py-1 rounded ${isDark ? `bg-[${accentHex}]/10 ${accentClass}` : isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>已对接：编辑元素 / 下载PSD</div>}
                        {provider.modelType === 'video' && provider.isEnabled && <div className={`mt-2 text-xs px-2 py-1 rounded ${isDark ? `bg-[${accentHex}]/10 ${accentClass}` : isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>已对接：文生视频 / 图生视频 / 视频延长</div>}
                        {(() => { const bal = apiBalances.find(b => b.providerId === provider.id || b.providerName === provider.name || provider.baseUrl.includes(b.providerId)); if (!bal) return null; return (<div className={`flex items-center gap-3 mt-2 text-xs ${isDark ? 'text-[#888]' : 'text-gray-500'}`}>{bal.balance !== null && <span className="flex items-center gap-1"><Wallet className="w-3 h-3" />余额: <span className={bal.balance > 10 ? 'text-green-500' : bal.balance > 1 ? 'text-yellow-500' : 'text-red-500'}>{bal.balance.toFixed(2)} {bal.currency}</span></span>}{bal.totalUsage > 0 && <span>总用量: {bal.totalUsage}</span>}{bal.dailyUsage > 0 && <span>今日: {bal.dailyUsage}</span>}{bal.error && <span className="text-red-400 text-xs">{bal.error}</span>}</div>); })()}
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-1 mt-3 pt-2 border-t border-current/5">
                      <button onClick={() => void handleReorderApi(provider.id, 'up')} disabled={providerIndex === 0} className={`p-1.5 rounded-lg disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed ${isDark ? 'hover:bg-[#222] text-[#999]' : 'hover:bg-gray-100 text-gray-500'}`} title="上移"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button onClick={() => void handleReorderApi(provider.id, 'down')} disabled={providerIndex === providers.length - 1} className={`p-1.5 rounded-lg disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed ${isDark ? 'hover:bg-[#222] text-[#999]' : 'hover:bg-gray-100 text-gray-500'}`} title="下移"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <div className={`w-px h-4 mx-1 ${isDark ? 'bg-[#333]' : 'bg-gray-200'}`} />
                      <button onClick={() => void handleRefreshApi(provider)} className={`p-1.5 rounded-lg cursor-pointer ${isDark ? 'hover:bg-[#222] text-[#999]' : 'hover:bg-gray-100 text-gray-500'}`} title="重新探测模型"><RefreshCw className="w-3.5 h-3.5" /></button>
                      <button onClick={() => void handleTestConnection(provider)} disabled={isTesting} className={`p-1.5 rounded-lg cursor-pointer ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title="测试连接">{isTesting && testResult?.providerId === provider.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-500" /> : <Zap className="w-3.5 h-3.5 text-yellow-500" />}</button>
                      <button onClick={() => void handleVerifyProtocol(provider)} disabled={isVerifying} className={`p-1.5 rounded-lg cursor-pointer ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title="协议验证">{isVerifying && verifyResult?.providerId === provider.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" /> : <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />}</button>
                      <button onClick={() => void handleToggleApi(provider)} className={`p-1.5 rounded-lg cursor-pointer ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title={provider.isEnabled ? '停用' : '启用'}>{provider.isEnabled ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-gray-500" />}</button>
                      <button onClick={() => handleEditApi(provider)} className={`p-1.5 rounded-lg cursor-pointer ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title="编辑"><Pencil className="w-3.5 h-3.5 text-blue-400" /></button>
                      <button onClick={() => handleDeleteApi(provider)} className={`p-1.5 rounded-lg cursor-pointer ${isDark ? 'hover:bg-red-950/40' : 'hover:bg-red-50'}`} title="删除"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
                    </div>
                    {testResult && testResult.providerId === provider.id && (<div className={`mt-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${testResult.success ? (isDark ? 'bg-green-900/20 text-green-400' : 'bg-green-50 text-green-700') : (isDark ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-700')}`}>{testResult.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}<span>{testResult.message}</span><button onClick={() => setTestResult(null)} className="ml-auto opacity-50 hover:opacity-100 cursor-pointer"><X size={12} /></button></div>)}
                    {verifyResult && verifyResult.providerId === provider.id && (<div className={`mt-2 px-3 py-2 rounded-lg text-xs ${isDark ? 'bg-cyan-900/20 text-cyan-300' : 'bg-cyan-50 text-cyan-800'}`}><div className="flex items-center gap-2 mb-1"><ShieldCheck className="w-3.5 h-3.5 shrink-0" /><span className="font-medium">协议验证: {verifyResult.summary}</span><button onClick={() => setVerifyResult(null)} className="ml-auto opacity-50 hover:opacity-100 cursor-pointer"><X size={12} /></button></div><div className="space-y-1 ml-5">{verifyResult.tests.map((test, i) => (<div key={i} className="flex items-center gap-1.5">{test.status === 'pass' ? <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" /> : test.status === 'warn' ? <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" /> : <XCircle className="w-3 h-3 text-red-400 shrink-0" />}<span className="opacity-80">{test.name}:</span><span className="opacity-60">{test.detail}</span></div>))}</div></div>)}
                    {editingProviderId === provider.id && (<div className={`mt-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${isDark ? 'bg-blue-900/20 text-blue-400' : 'bg-blue-50 text-blue-700'}`}><Pencil className="w-3.5 h-3.5 shrink-0" /><span>正在编辑此 API，请在左侧表单中修改</span></div>)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Data Management ── */}
        {activeTab === 'data' && isAdmin && (
          <div className="h-full overflow-y-auto p-6">
            <h1 className={`text-xl font-bold mb-1 ${textPrimary}`}>数据管理</h1>
            <p className={`text-sm mb-4 ${textSecondary}`}>浏览和管理用户项目数据与生成图片</p>
            {/* Sub-tab switcher */}
            <div className={`flex gap-1 mb-4 p-1 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
              <button onClick={() => setDataSubTab('kv')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${dataSubTab === 'kv' ? (isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-primary/10 text-primary') : (isDark ? 'text-[#888] hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')}`}>用户数据</button>
              <button onClick={() => setDataSubTab('images')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${dataSubTab === 'images' ? (isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-primary/10 text-primary') : (isDark ? 'text-[#888] hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')}`}>生成图片</button>
            </div>
            <div className={`rounded-xl border p-5 ${softClass}`}>
              <div className="flex gap-4 min-h-[400px]">
                {/* Left: User list */}
                <div className="w-1/4 border-r pr-3">
                  <div className={`text-xs font-medium mb-2 ${isDark ? 'text-[#999]' : 'text-gray-500'}`}>选择用户</div>
                  <div className="space-y-1 max-h-[500px] overflow-y-auto">
                    {adminUsers.map(u => (<button key={u.id} onClick={() => { void loadUserData(u.id); void loadUserImages(u.id); }} className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer ${selectedDataUser === u.id ? (isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-primary/10 text-primary') : isDark ? 'bg-white/5 hover:bg-white/10 text-gray-200' : 'bg-white hover:bg-gray-50 text-gray-700'}`}><div className="font-medium">{u.name}</div><div className={`text-xs mt-0.5 ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>{u.id}</div></button>))}
                  </div>
                </div>
                {/* Right: Content based on sub-tab */}
                <div className="flex-1 min-w-0">
                  {dataSubTab === 'kv' ? (
                    /* KV data view */
                    <div className="flex gap-4 min-h-[400px]">
                      <div className="w-1/2 border-r pr-3">
                        <div className={`text-xs font-medium mb-2 ${isDark ? 'text-[#999]' : 'text-gray-500'}`}>{selectedDataUser ? '数据条目' : '请先选择用户'}</div>
                        {selectedDataUser ? (userDataKeys.length > 0 ? (<div className="space-y-1 max-h-[500px] overflow-y-auto">{userDataKeys.map(dk => (<div key={dk.dataKey} className={`group rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors flex items-center justify-between gap-2 ${viewingDataKey === dk.dataKey ? (isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-primary/10 text-primary') : isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-white hover:bg-gray-50'}`} onClick={() => void loadDataDetail(selectedDataUser, dk.dataKey)}><div className="min-w-0 flex-1"><div className="truncate font-medium">{dk.dataKey}</div><div className={`text-xs mt-0.5 ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>{dk.updatedAt ? new Date(dk.updatedAt).toLocaleString('zh-CN') : ''}</div></div><button onClick={(e) => { e.stopPropagation(); void deleteUserData(selectedDataUser, dk.dataKey); }} className={`opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded transition-opacity cursor-pointer ${isDark ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-50 text-red-500'}`} title="删除此数据"><Trash2 size={14} /></button></div>))}</div>) : (<div className={`text-xs ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>该用户暂无数据</div>)) : (<div className={`text-xs ${isDark ? 'text-[#555]' : 'text-gray-300'}`}>← 点击左侧用户查看数据</div>)}
                      </div>
                      <div className="w-1/2 min-w-0">
                        <div className={`text-xs font-medium mb-2 ${isDark ? 'text-[#999]' : 'text-gray-500'}`}>{viewingDataKey ? `数据详情: ${viewingDataKey}` : '数据内容'}</div>
                        {viewingDataLoading ? (<div className={`text-xs ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>加载中...</div>) : viewingDataValue !== null ? (<div className={`rounded-lg p-3 text-xs font-mono max-h-[500px] overflow-auto ${isDark ? 'bg-white/5 text-gray-300' : 'bg-gray-50 text-gray-700'}`}><pre className="whitespace-pre-wrap break-all">{typeof viewingDataValue === 'string' ? viewingDataValue : JSON.stringify(viewingDataValue, null, 2)}</pre></div>) : (<div className={`text-xs ${isDark ? 'text-[#555]' : 'text-gray-300'}`}>{selectedDataUser ? '← 点击左侧条目查看详情' : ''}</div>)}
                      </div>
                    </div>
                  ) : (
                    /* Images view */
                    <div>
                      {!selectedDataUser ? (
                        <div className={`text-xs ${isDark ? 'text-[#555]' : 'text-gray-300'}`}>← 点击左侧用户查看图片</div>
                      ) : userImagesLoading ? (
                        <div className={`text-xs ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>加载图片中...</div>
                      ) : userImages.length === 0 ? (
                        <div className={`text-xs ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>该用户暂无图片数据</div>
                      ) : (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className={`text-xs font-medium ${isDark ? 'text-[#999]' : 'text-gray-500'}`}>共 {userImages.length} 张图片</div>
                            <div className="flex gap-1.5">
                              {(['all', 'generated', 'uploaded'] as const).map(f => (
                                <button key={f} onClick={() => setImageSourceFilter(f)} className={`text-[10px] px-2 py-0.5 rounded cursor-pointer transition-colors ${imageSourceFilter === f ? (isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-primary/10 text-primary') : (isDark ? 'bg-white/5 text-[#888] hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}`}>{f === 'all' ? '全部' : f === 'generated' ? 'AI生成' : '上传'}</button>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto pr-1">
                            {userImages.filter(img => imageSourceFilter === 'all' || img.source === imageSourceFilter).map((img, idx) => (
                              <div key={idx} className={`rounded-lg border overflow-hidden ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
                                <div className="aspect-square bg-black/20 relative">
                                  <img src={img.url} alt={img.prompt || '图片'} className="w-full h-full object-cover" loading="lazy" />
                                  <span className={`absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded font-medium ${img.source === 'generated' ? (isDark ? 'bg-[#d4af37]/80 text-black' : 'bg-primary text-primary-foreground') : (isDark ? 'bg-blue-500/80 text-white' : 'bg-blue-500 text-white')}`}>{img.source === 'generated' ? 'AI' : '上传'}</span>
                                </div>
                                <div className="p-2.5 space-y-1">
                                  {img.prompt && <div className={`text-[11px] truncate ${isDark ? 'text-gray-300' : 'text-gray-700'}`} title={img.prompt}>{img.prompt}</div>}
                                  <div className="flex flex-wrap gap-1">
                                    {img.model && <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-primary/10 text-primary'}`}>{img.model.length > 20 ? img.model.slice(0, 20) + '…' : img.model}</span>}
                                    {img.aspectRatio && <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-white/10 text-[#888]' : 'bg-gray-100 text-gray-500'}`}>{img.aspectRatio}</span>}
                                    {img.quality && <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-white/10 text-[#888]' : 'bg-gray-100 text-gray-500'}`}>{img.quality}</span>}
                                  </div>
                                  <div className={`flex items-center justify-between text-[10px] ${isDark ? 'text-[#555]' : 'text-gray-400'}`}>
                                    <span>{img.createdAt ? new Date(img.createdAt).toLocaleString('zh-CN') : '未知时间'}</span>
                                    {img.duration != null && img.duration > 0 && <span>耗时 {img.duration < 1000 ? `${img.duration}ms` : `${(img.duration / 1000).toFixed(1)}s`}</span>}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Ecom Templates ── */}
        {activeTab === 'ecom-templates' && isAdmin && (
          <div className="h-full overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <div><h1 className={`text-xl font-bold ${textPrimary}`}>电商模板管理</h1><p className={`text-sm ${textSecondary}`}>管理品牌电商生成模板</p></div>
              <button onClick={() => { setEditingEcomTpl({ id: `tpl_${Date.now()}`, name: '', icon: '📄', description: '', prompt_template: '', negative_prompt: 'low quality, blurry, distorted, deformed, watermark', aspect_ratio: '1:1', category: 'product', fidelity_anchor: '', sort_order: ecomTemplates.length + 1, is_enabled: true }); setShowNewEcomTpl(true); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${accentBgClass} ${accentTextOnBgClass} ${accentHoverBgClass} transition-colors cursor-pointer`}><Plus size={12} /> 新增模板</button>
            </div>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {ecomTemplates.length === 0 ? (<div className={`text-center py-8 text-sm ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>暂无自定义模板，点击"新增模板"添加</div>) : ecomTemplates.map((tpl, idx) => (
                <div key={tpl.id as string} className={`flex items-center gap-3 rounded-lg px-4 py-3 ${isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-white hover:bg-gray-50'} transition-colors`}>
                  <span className="text-lg">{tpl.icon as string || '📄'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{tpl.name as string || '未命名'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${tpl.is_enabled ? (isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-50 text-green-600') : (isDark ? 'bg-[#333] text-[#666]' : 'bg-gray-100 text-gray-400')}`}>{tpl.is_enabled ? '启用' : '禁用'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-[#3b82f6]/20 text-[#3b82f6]' : isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-blue-50 text-blue-600'}`}>{(tpl.category as string) || 'product'}</span>
                      <span className={`text-[10px] ${isDark ? 'text-[#555]' : 'text-gray-400'}`}>{tpl.aspect_ratio as string}</span>
                    </div>
                    <div className={`text-xs mt-0.5 truncate ${isDark ? 'text-[#666]' : 'text-gray-400'}`}>{tpl.description as string || '无描述'}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => void moveEcomTemplateOrder(tpl.id as string, 'up')} disabled={idx === 0} className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-30 ${isDark ? 'hover:bg-white/10 text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`} title="上移"><ArrowUp size={12} /></button>
                    <button onClick={() => void moveEcomTemplateOrder(tpl.id as string, 'down')} disabled={idx === ecomTemplates.length - 1} className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-30 ${isDark ? 'hover:bg-white/10 text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`} title="下移"><ArrowDown size={12} /></button>
                    <button onClick={() => void toggleEcomTemplateEnabled(tpl.id as string, !tpl.is_enabled)} className={`p-1 rounded transition-colors cursor-pointer ${isDark ? 'hover:bg-[#2a2a2a]' : 'hover:bg-gray-100'}`} title={tpl.is_enabled ? '禁用' : '启用'}>{tpl.is_enabled ? <CheckCircle2 size={12} className="text-green-400" /> : <Ban size={12} className={isDark ? 'text-[#555]' : 'text-gray-300'} />}</button>
                    <button onClick={() => { setEditingEcomTpl({ ...tpl }); setShowNewEcomTpl(false); }} className={`p-1 rounded transition-colors cursor-pointer ${isDark ? 'hover:bg-white/10 text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`} title="编辑"><Pencil size={12} /></button>
                    <button onClick={() => void deleteEcomTemplate(tpl.id as string)} className={`p-1 rounded transition-colors cursor-pointer ${isDark ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-50 text-red-500'}`} title="删除"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
            {(showNewEcomTpl || editingEcomTpl) && (
              <div className={`mt-4 rounded-xl border p-4 ${softClass}`}>
                <h4 className="text-sm font-semibold mb-3">{showNewEcomTpl ? '新增模板' : `编辑模板: ${editingEcomTpl?.name || ''}`}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelClass}>模板名称 *</label><input className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="如：白底主图" value={(editingEcomTpl?.name as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, name: e.target.value } : null)} /></div>
                  <div><label className={labelClass}>图标</label><input className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="如：📦" value={(editingEcomTpl?.icon as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, icon: e.target.value } : null)} /></div>
                  <div><label className={labelClass}>分类</label><select className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} value={(editingEcomTpl?.category as string) || 'product'} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, category: e.target.value } : null)}><option value="product">商品展示</option><option value="scene">场景氛围</option><option value="model">模特展示</option><option value="graphic">平面设计</option><option value="detail">细节展示</option></select></div>
                  <div><label className={labelClass}>画面比例</label><select className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} value={(editingEcomTpl?.aspect_ratio as string) || '1:1'} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, aspect_ratio: e.target.value } : null)}><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="3:2">3:2</option><option value="2:3">2:3</option></select></div>
                  <div className="col-span-2"><label className={labelClass}>描述</label><input className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="简短描述此模板的用途" value={(editingEcomTpl?.description as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, description: e.target.value } : null)} /></div>
                  <div className="col-span-2"><label className={labelClass}>提示词模板 *</label><textarea className={`w-full h-28 px-3 py-2 rounded-lg border text-sm ${inputClass} resize-y`} placeholder="使用 {SUBJECT} {brand_color_prompt} {style_extra} 等占位符" value={(editingEcomTpl?.prompt_template as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, prompt_template: e.target.value } : null)} /></div>
                  <div className="col-span-2"><label className={labelClass}>反向提示词</label><textarea className={`w-full h-16 px-3 py-2 rounded-lg border text-sm ${inputClass} resize-y`} placeholder="排除的低质量描述" value={(editingEcomTpl?.negative_prompt as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, negative_prompt: e.target.value } : null)} /></div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => editingEcomTpl && void saveEcomTemplate(editingEcomTpl)} disabled={isEcomTplSaving || !(editingEcomTpl?.name) || !(editingEcomTpl?.prompt_template)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${accentBgClass} ${accentTextOnBgClass} ${accentHoverBgClass} transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}>{isEcomTplSaving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}{isEcomTplSaving ? '保存中...' : '保存模板'}</button>
                  <button onClick={() => { setEditingEcomTpl(null); setShowNewEcomTpl(false); }} className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${isDark ? 'text-[#888] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}>取消</button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <ConfirmDialog open={confirmDlg.open} title={confirmDlg.title} message={confirmDlg.message} variant={confirmDlg.variant} onConfirm={confirmDlg.onConfirm} onCancel={confirmDlg.onCancel} />
    </div>
  );
}
