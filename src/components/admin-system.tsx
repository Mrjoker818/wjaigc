'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, UserPlus, Trash2, Ban, CheckCircle2, KeyRound, Plug, RefreshCw, Activity, Wallet, Pencil, Zap, CheckCircle, XCircle, Loader2, Search, Settings, ChevronDown, Plus, ShieldCheck, AlertTriangle, ArrowUp, ArrowDown, ShoppingBag } from 'lucide-react';
import { User } from '@/lib/user-types';
import { ConfirmDialog } from './custom-dialogs';
import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import { getModelDisplayName } from '@/lib/model-name-map';

interface AdminSystemProps {
  themeStyle?: 'gold' | 'monochrome';
  onClose: () => void;
}

type ApiKind = 'general' | 'image' | 'chat' | '3d' | 'vectorize' | 'layer' | 'video';
type UserPermissionKey = 'image' | 'chat' | 'threeD' | 'imageEdit' | 'vectorize' | 'layer' | 'video';

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

export function AdminSystem({ themeStyle = 'gold', onClose }: AdminSystemProps) {
  const isGold = themeStyle === 'gold';
  const [users, setUsers] = useState<User[]>([]);
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'apis' | 'data' | 'ecom-templates' | 'credits'>('users');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('123456');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [confirmDlg, setConfirmDlg] = useState<{ open: boolean; title: string; message: string; variant?: 'danger' | 'warning'; onConfirm: () => void; onCancel: () => void }>({ open: false, title: '', message: '', onConfirm: () => {}, onCancel: () => {} });
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [resetPwdUser, setResetPwdUser] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

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

  // Data tab state
  const [selectedDataUser, setSelectedDataUser] = useState<string | null>(null);
  const [userDataKeys, setUserDataKeys] = useState<{ dataKey: string; updatedAt: number }[]>([]);
  const [userDataLoading, setUserDataLoading] = useState(false);
  const [viewingDataKey, setViewingDataKey] = useState<string | null>(null);
  const [viewingDataValue, setViewingDataValue] = useState<unknown>(null);
  const [viewingDataLoading, setViewingDataLoading] = useState(false);

  // Ecom template tab state
  const [ecomTemplates, setEcomTemplates] = useState<Array<Record<string, unknown>>>([]);
  const [editingEcomTpl, setEditingEcomTpl] = useState<Record<string, unknown> | null>(null);
  const [isEcomTplSaving, setIsEcomTplSaving] = useState(false);
  const [showNewEcomTpl, setShowNewEcomTpl] = useState(false);

  // Credits tab state
  const [creditsUsers, setCreditsUsers] = useState<Array<{ userId: string; userName: string; balance: number; totalRecharged: number; totalUsed: number }>>([]);
  const [selectedCreditsUser, setSelectedCreditsUser] = useState<string | null>(null);
  const [creditsTransactions, setCreditsTransactions] = useState<Array<{ id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: number }>>([]);
  const [adminRechargeAmount, setAdminRechargeAmount] = useState(100);
  const [adminRechargeDesc, setAdminRechargeDesc] = useState('');
  const [isAdminRecharging, setIsAdminRecharging] = useState(false);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ providerId: string; success: boolean; summary: string; tests: Array<{ name: string; status: string; detail: string }> } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [apiBalances, setApiBalances] = useState<Array<{
    providerId: string; providerName: string; providerType: string;
    balance: number | null; currency: string; totalUsage: number; dailyUsage: number;
    lastUpdated: string; error?: string;
  }>>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) throw new Error(`获取用户列表失败: HTTP ${response.status}`);
      const data = await response.json();
      if (data.success && Array.isArray(data.users)) {
        setUsers(data.users);
      } else {
        // 服务器返回失败时不回退到 localStorage，因为部署后 localStorage 为空
        setUsers([]);
      }
    } catch {
      setUsers([]);
    }
    try {
      const response = await fetch('/api/admin/apis', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) throw new Error(`获取API配置失败: HTTP ${response.status}`);
      const data = await response.json();
      if (data.success) setProviders(data.providers || []);
      else setProviders([]);
    } catch {
      setProviders([]);
    }
  }, []);

  const loadUserData = useCallback(async (userId: string) => {
    setSelectedDataUser(userId);
    setUserDataKeys([]);
    setViewingDataValue(null);
    setViewingDataKey(null);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-data', userId }),
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        setUserDataKeys(data.keys || []);
      }
    } catch {
      setUserDataKeys([]);
    }
  }, []);

  const loadDataDetail = useCallback(async (userId: string, key: string) => {
    setViewingDataValue(null);
    setViewingDataKey(key);
    setViewingDataLoading(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-data', userId, key }),
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        setViewingDataValue(data.value);
      } else {
        setViewingDataValue({ error: data.error || '加载失败' });
      }
    } catch {
      setViewingDataValue({ error: '请求失败' });
    } finally {
      setViewingDataLoading(false);
    }
  }, []);

  const deleteUserData = useCallback(async (userId: string, key: string) => {
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-data', userId, key }),
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        await loadUserData(userId);
        if (viewingDataKey === key) {
          setViewingDataValue(null);
          setViewingDataKey(null);
        }
      }
    } catch { /* ignore */ }
  }, [loadUserData, viewingDataKey]);

  // ─── Credits management ──────────────────────────────────────────

  const loadCreditsOverview = useCallback(async () => {
    setCreditsLoading(true);
    try {
      const resp = await fetch('/api/credits?action=admin-overview', { credentials: 'include' });
      const data = await resp.json();
      if (data.success) {
        setCreditsUsers(data.users || []);
      }
    } catch { /* ignore */ }
    setCreditsLoading(false);
  }, []);

  const loadCreditsTransactions = useCallback(async (userId: string) => {
    setSelectedCreditsUser(userId);
    setCreditsTransactions([]);
    try {
      const resp = await fetch(`/api/credits?action=transactions&userId=${userId}&limit=50`, { credentials: 'include' });
      const data = await resp.json();
      if (data.success) {
        setCreditsTransactions(data.transactions || []);
      }
    } catch { /* ignore */ }
  }, []);

  const handleAdminRecharge = useCallback(async () => {
    if (!selectedCreditsUser || adminRechargeAmount <= 0) return;
    setIsAdminRecharging(true);
    try {
      const resp = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'admin-recharge',
          userId: selectedCreditsUser,
          amount: adminRechargeAmount,
          description: adminRechargeDesc || `管理员充值 ${adminRechargeAmount} 积分`,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        await loadCreditsOverview();
        await loadCreditsTransactions(selectedCreditsUser);
        setAdminRechargeDesc('');
      } else {
        alert(data.error || '充值失败');
      }
    } catch {
      alert('充值请求失败');
    }
    setIsAdminRecharging(false);
  }, [selectedCreditsUser, adminRechargeAmount, adminRechargeDesc, loadCreditsOverview, loadCreditsTransactions]);

  // ─── Ecom template CRUD ──────────────────────────────────────────

  const loadEcomTemplates = useCallback(async () => {
    try {
      const resp = await fetch('/api/ecom-templates');
      const data = await resp.json();
      if (data.success) setEcomTemplates(data.templates || []);
    } catch { /* ignore */ }
  }, []);

  const saveEcomTemplate = useCallback(async (tpl: Record<string, unknown>) => {
    setIsEcomTplSaving(true);
    try {
      // Convert snake_case from DB row to camelCase for API
      const payload: Record<string, unknown> = {
        action: 'save',
        id: tpl.id,
        name: tpl.name,
        icon: tpl.icon,
        description: tpl.description,
        promptTemplate: tpl.prompt_template || tpl.promptTemplate,
        negativePrompt: tpl.negative_prompt || tpl.negativePrompt,
        aspectRatio: tpl.aspect_ratio || tpl.aspectRatio,
        category: tpl.category,
        fidelityAnchor: tpl.fidelity_anchor || tpl.fidelityAnchor,
        sortOrder: tpl.sort_order || tpl.sortOrder,
        isEnabled: tpl.is_enabled !== undefined ? tpl.is_enabled : tpl.isEnabled,
      };
      const resp = await fetch('/api/ecom-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (data.success) {
        await loadEcomTemplates();
        setEditingEcomTpl(null);
        setShowNewEcomTpl(false);
      } else {
        alert(data.error || '保存失败');
      }
    } catch { alert('保存失败'); }
    setIsEcomTplSaving(false);
  }, [loadEcomTemplates]);

  const deleteEcomTemplate = useCallback(async (id: string) => {
    if (!confirm('确定删除此模板？')) return;
    try {
      const resp = await fetch('/api/ecom-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      if ((await resp.json()).success) {
        setEcomTemplates(prev => prev.filter(t => t.id !== id));
      }
    } catch { /* ignore */ }
  }, []);

  const toggleEcomTemplateEnabled = useCallback(async (id: string, enabled: boolean) => {
    try {
      const resp = await fetch('/api/ecom-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', id, isEnabled: enabled }),
      });
      if ((await resp.json()).success) {
        setEcomTemplates(prev => prev.map(t => t.id === id ? { ...t, is_enabled: enabled } : t));
      }
    } catch { /* ignore */ }
  }, []);

  const moveEcomTemplateOrder = useCallback(async (id: string, direction: 'up' | 'down') => {
    try {
      await fetch('/api/ecom-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reorder', id, direction }),
      });
      await loadEcomTemplates();
    } catch { /* ignore */ }
  }, [loadEcomTemplates]);

  useEffect(() => {
    void loadEcomTemplates();
  }, [loadEcomTemplates]);

  const refreshBalances = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/api-balance', { credentials: 'include' });
      if (!response.ok) throw new Error(`获取余额失败: HTTP ${response.status}`);
      const data = await response.json();
      if (data.success) setApiBalances(data.balances || []);
    } catch {
      setApiBalances([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshBalances();
    void loadCreditsOverview();
  }, [refresh, refreshBalances, loadCreditsOverview]);

  const panelClass = isGold ? 'bg-[#111] border-[#2a2a2a] text-white' : 'bg-white border-gray-200 text-gray-900';
  const softClass = isGold ? 'bg-[#171717] border-[#2a2a2a]' : 'bg-gray-50 border-gray-200';
  const inputClass = isGold
    ? 'bg-[#0d0d0d] border-[#2a2a2a] text-white placeholder:text-[#555]'
    : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400';
  const labelClass = `block text-xs font-medium mb-1.5 ${isGold ? 'text-[#b8b8b8]' : 'text-gray-600'}`;

  const handleCreateUser = async () => {
    if (!newUserName.trim() || !newUserPassword.trim()) return;
    await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'create',
        name: newUserName.trim(),
        password: newUserPassword.trim(),
        email: newUserEmail.trim() || undefined,
      }),
    });
    setNewUserName('');
    setNewUserPassword('123456');
    setNewUserEmail('');
    await refresh();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleToggleUser = async (user: User) => {
    await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'update',
        userId: user.id,
        updates: { status: user.status === 'disabled' ? 'active' : 'disabled' },
      }),
    });
    await refresh();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleDeleteUser = async (user: User) => {
    if (user.role === 'admin') return;
    setConfirmDlg({
      open: true,
      title: '删除用户',
      message: `确定删除用户 ${user.name} 吗？该用户的本地项目数据会一并移除。`,
      onConfirm: async () => {
        await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: 'delete', userId: user.id }),
        });
        await refresh();
        window.dispatchEvent(new Event('wujie-admin-users-updated'));
        setConfirmDlg(prev => ({ ...prev, open: false }));
      },
      onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
    });
  };

  const handleRenameUser = async (userId: string) => {
    if (!editName.trim()) return;
    await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'update', userId, updates: { name: editName.trim() } }),
    });
    setEditingUser(null);
    setEditName('');
    await refresh();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleResetPassword = async (userId: string) => {
    if (!newPassword.trim() || newPassword.trim().length < 4) return;
    setConfirmDlg({
      open: true,
      title: '重置密码',
      message: `确定将密码重置为 "${newPassword.trim()}" 吗？`,
      variant: 'warning',
      onConfirm: async () => {
        await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: 'update', userId, updates: { password: newPassword.trim() } }),
        });
        setResetPwdUser(null);
        setNewPassword('');
        setConfirmDlg(prev => ({ ...prev, open: false }));
      },
      onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
    });
  };

  const handleToggleUserPermission = async (user: User, key: UserPermissionKey) => {
    const current: Record<UserPermissionKey, boolean> = {
      image: user.apiPermissions?.image ?? true,
      chat: user.apiPermissions?.chat ?? true,
      threeD: user.apiPermissions?.threeD ?? true,
      imageEdit: user.apiPermissions?.imageEdit ?? true,
      vectorize: user.apiPermissions?.vectorize ?? true,
      layer: user.apiPermissions?.layer ?? true,
      video: user.apiPermissions?.video ?? true,
    };
    await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'update',
        userId: user.id,
        updates: {
          apiPermissions: {
            ...current,
            [key]: !current[key],
          },
        },
      }),
    });
    await refresh();
    window.dispatchEvent(new Event('wujie-admin-users-updated'));
  };

  const handleDiscoverModels = async () => {
    if (!apiBaseUrl.trim() || !apiKey.trim()) return;
    setIsDiscovering(true);
    try {
      const response = await fetch('/api/admin/apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover', baseUrl: apiBaseUrl.trim(), apiKey: apiKey.trim(), modelType: apiKind }),
      });
      if (!response.ok) throw new Error(`模型发现失败: HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success && data.error) {  setTestNewResult({ success: false, message: data.error });
        setDiscoveredModels([]);
        return;
      }
      const models = data.models || [];
      setDiscoveredModels(models);
      setModelSearchQuery('');

      // 矢量模型和分层模型：自动匹配特定模型
      if (apiKind === 'vectorize') {
        const vectorizeModels = models.filter((m: ModelInfo) => {
          const id = m.id.toLowerCase();
          return id.includes('vector') || id.includes('vectorize') || id.includes('svg') || id.includes('tracer') || id.includes('starvector');
        });
        if (vectorizeModels.length > 0) {
          setSelectedModels(vectorizeModels.map((m: ModelInfo) => m.id));
        } else if (models.length > 0) {
          // 如果没找到特定模型，选择所有模型让管理员挑选
          setSelectedModels([]);
        }
      } else if (apiKind === 'layer') {
        const layerModels = models.filter((m: ModelInfo) => {
          const id = m.id.toLowerCase();
          return id.includes('layer') || id.includes('segment') || id.includes('qwen-image-layered');
        });
        if (layerModels.length > 0) {
          setSelectedModels(layerModels.map((m: ModelInfo) => m.id));
        } else if (models.length > 0) {
          setSelectedModels([]);
        }
      } else if (apiKind === 'video') {
        const videoModels = models.filter((m: ModelInfo) => {
          const id = m.id.toLowerCase();
          return id.includes('video-generation') || id.includes('seedance') || id.includes('hailuo') || id.includes('vidu') || id.includes('kling-v3') || id.includes('runway') || id.includes('gen-3') || id.includes('gen-4') || id.includes('pika') || id.includes('ray2') || id.includes('ray3') || id.includes('sora') || id.includes('veo') || id.includes('minimax-video') || id.includes('video-01');
        });
        if (videoModels.length > 0) {
          setSelectedModels(videoModels.map((m: ModelInfo) => m.id));
        } else if (models.length > 0) {
          setSelectedModels([]);
        }
      }
      // 图像/LLM/3D模型：默认不选择，管理员手动选择
    } catch (err) {
      const msg = err instanceof Error ? err.message : '识别模型失败';
      setTestNewResult({ success: false, message: msg.includes('JSON') ? 'API 返回了非 JSON 响应，请检查 Base URL 是否正确' : msg });
      setDiscoveredModels([]);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleAddApi = async () => {
    if (!apiName.trim() || !apiBaseUrl.trim() || !apiKey.trim()) return;
    const models = selectedModels.length ? selectedModels : apiModel.trim() ? [apiModel.trim()] : [];
    const res = await fetch('/api/admin/apis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: apiName.trim(),
        baseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
        modelType: apiKind,
        selectedModels: models,
        requestStyle: apiKind === 'general' ? 'auto' : apiKind === 'chat' ? 'chat-completions' : apiKind === 'vectorize' || apiKind === 'layer' ? 'chat-completions' : 'images-generations',
        advancedParams: [
          ...advancedParams.filter(p => p.key.trim()),
          ...(compatProfile !== 'auto' ? [{ key: 'compatProfile', value: compatProfile }] : []),
        ],
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: '保存失败' }));
      alert(data.error || '保存失败，请重试');
      return;
    }
    setApiName('');
    setApiBaseUrl('');
    setApiKey('');
    setApiModel('');
    setCompatProfile('auto');
    setDiscoveredModels([]);
    setEditingProviderId(null);
    setAdvancedParams([]);
    setShowAdvancedParams(false);
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refresh();
  };

  const handleEditApi = (provider: ApiProvider) => {
    // Fill the left form with provider data for editing
    setEditingProviderId(provider.id);
    setApiName(provider.displayName || provider.name);
    setApiBaseUrl(provider.baseUrl);
    setApiKey(''); // Don't prefill the key for security
    setApiKind((provider.modelType || 'image') as ApiKind);
    // Load the provider's compatProfile from advancedParams
    const savedProfile = provider.advancedParams?.compatProfile || 'auto';
    setCompatProfile(['apimart', 'openai', 'openai-async', 'auto'].includes(savedProfile) ? savedProfile : 'auto');
    // Load the provider's models into discovered models
    const providerModels = provider.discoveredModels || [];
    if (providerModels.length > 0) {
      setDiscoveredModels(providerModels);
      setSelectedModels(provider.selectedModels || []);
      setModelSearchQuery('');
    } else {
      setDiscoveredModels([]);
      setSelectedModels([]);
    }
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
    // Inject compatProfile into advancedParams if not 'auto'
    const paramsWithCompat = [
      ...filteredParams.filter(p => p.key !== 'compatProfile'),
      ...(compatProfile !== 'auto' ? [{ key: 'compatProfile', value: compatProfile }] : []),
    ];
    if (paramsWithCompat.length > 0) updates.advancedParams = paramsWithCompat;

    const res = await fetch('/api/admin/apis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', providerId: editingProviderId, updates }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: '更新失败' }));
      alert(data.error || '更新失败，请重试');
      return;
    }
    // Reset form
    setEditingProviderId(null);
    setApiName('');
    setApiBaseUrl('');
    setApiKey('');
    setApiModel('');
    setCompatProfile('auto');
    setDiscoveredModels([]);
    setSelectedModels([]);
    setAdvancedParams([]);
    setShowAdvancedParams(false);
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refresh();
  };

  const handleTestConnection = async (provider: ApiProvider) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/test-provider-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ providerId: provider.id }),
      });
      if (!response.ok) throw new Error(`测试连接失败: HTTP ${response.status}`);
      const data = await response.json();
      setTestResult({
        providerId: provider.id,
        success: data.success,
        message: data.success ? (data.info || '连接成功') : (data.error || '连接失败'),
      });
    } catch {
      setTestResult({
        providerId: provider.id,
        success: false,
        message: '网络错误，无法连接',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleVerifyProtocol = async (provider: ApiProvider) => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const response = await fetch('/api/verify-protocol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ providerId: provider.id }),
      });
      if (!response.ok) throw new Error(`协议验证失败: HTTP ${response.status}`);
      const data = await response.json();
      setVerifyResult({
        providerId: provider.id,
        success: data.success,
        summary: data.summary || '',
        tests: data.tests || [],
      });
    } catch {
      setVerifyResult({
        providerId: provider.id,
        success: false,
        summary: '验证请求失败',
        tests: [],
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleTestNewConnection = async () => {
    if (!apiBaseUrl || !apiKey) return;
    setIsTestingNew(true);
    setTestNewResult(null);
    try {
      const advParams: Record<string, string> = {};
      advancedParams.forEach(p => { if (p.key.trim()) advParams[p.key.trim()] = p.value; });
      const response = await fetch('/api/test-provider-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          baseUrl: apiBaseUrl,
          apiKey: apiKey,
          requestStyle: apiKind === 'chat' ? 'chat-completions' : apiKind === 'vectorize' || apiKind === 'layer' ? 'chat-completions' : 'images-generations',
          advancedParams: advParams,
        }),
      });
      if (!response.ok) throw new Error(`测试连接失败: HTTP ${response.status}`);
      const data = await response.json();
      setTestNewResult({
        success: data.success,
        message: data.success ? (data.info || '连接成功') : (data.error || '连接失败'),
        modelCount: data.modelCount,
        error: data.error,
      });
    } catch {
      setTestNewResult({
        success: false,
        message: '网络错误，无法连接',
      });
    } finally {
      setIsTestingNew(false);
    }
  };

  const handleToggleApi = async (provider: ApiProvider) => {
    await fetch('/api/admin/apis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', providerId: provider.id, updates: { isEnabled: !provider.isEnabled } }),
    });
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refresh();
  };

  const handleRefreshApi = async (provider: ApiProvider) => {
    await fetch('/api/admin/apis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh', providerId: provider.id }),
    });
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refresh();
  };

  const handleDeleteApi = (provider: ApiProvider) => {
    setConfirmDlg({
      open: true,
      title: '删除 API',
      message: `确定删除 API「${provider.displayName || provider.name}」吗？此操作不可撤销。`,
      variant: 'danger',
      onConfirm: async () => {
        await fetch('/api/admin/apis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', providerId: provider.id }),
        });
        window.dispatchEvent(new Event('wujie-admin-apis-updated'));
        await refresh();
        setConfirmDlg(prev => ({ ...prev, open: false }));
      },
      onCancel: () => setConfirmDlg(prev => ({ ...prev, open: false })),
    });
  };

  const handleReorderApi = async (providerId: string, direction: 'up' | 'down') => {
    try {
      const res = await fetch('/api/admin/apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reorder', providerId, direction }),
      });
      const data = await res.json();
      if (data.success) {
        window.dispatchEvent(new Event('wujie-admin-apis-updated'));
        await refresh();
      }
    } catch (e) {
      console.error('[admin] reorder error:', e);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
      <div className={`w-full max-w-5xl max-h-[88vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${panelClass}`}>
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isGold ? 'border-[#2a2a2a]' : 'border-gray-100'}`}>
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="无界AI" className="w-7 h-7 object-contain rounded flex-shrink-0" />
            <div>
              <h2 className="text-lg font-semibold">管理员系统</h2>
              <p className={`text-xs mt-1 ${isGold ? 'text-[#777]' : 'text-gray-500'}`}>用户、权限、模型 API 与项目数据统一管理</p>
            </div>
          </div>
          <button aria-label="关闭管理员系统" onClick={onClose} className={`p-2 rounded-lg ${isGold ? 'hover:bg-[#222] text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`px-5 py-2 flex gap-2 border-b ${isGold ? 'border-[#222]' : 'border-gray-100'}`}>
          {[
            ['users', '用户管理'],
            ['apis', 'API 管理'],
            ['data', '数据管理'],
            ['credits', '积分管理'],
            ['ecom-templates', '电商模板'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as 'users' | 'apis' | 'data' | 'ecom-templates' | 'credits')}
              aria-pressed={activeTab === id}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${activeTab === id ? 'bg-[#d4af37] text-black' : isGold ? 'text-[#888] hover:bg-[#1a1a1a]' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'users' && (
            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
              <div className={`rounded-xl border p-4 h-fit ${softClass}`}>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4" />添加用户</h3>
                <div className="space-y-3">
                  <div>
                    <label className={labelClass} htmlFor="admin-new-user-name">用户名</label>
                    <input id="admin-new-user-name" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="例如 设计师01" value={newUserName} onChange={e => setNewUserName(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="admin-new-user-password">初始密码</label>
                    <input id="admin-new-user-password" type="password" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="至少 6 位" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="admin-new-user-email">邮箱（可选）</label>
                    <input id="admin-new-user-email" type="email" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="邮箱地址" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} />
                  </div>
                  <button onClick={handleCreateUser} className="w-full h-9 rounded-lg bg-[#d4af37] text-black text-sm font-semibold">创建用户</button>
                </div>
              </div>

              <div className="space-y-2">
                {users.map(user => (
                  <div key={user.id} className={`rounded-xl border p-4 ${softClass}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#d4af37] text-black flex items-center justify-center font-bold shrink-0">{user.name.slice(0, 1).toUpperCase()}</div>
                      <div className="flex-1 min-w-0">
                        {editingUser === user.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              className={`h-8 px-2 rounded-lg border text-sm flex-1 ${inputClass}`}
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') void handleRenameUser(user.id); if (e.key === 'Escape') { setEditingUser(null); setEditName(''); } }}
                              autoFocus
                            />
                            <button onClick={() => void handleRenameUser(user.id)} className="px-2 py-1 rounded-lg bg-[#d4af37] text-black text-xs font-semibold">保存</button>
                            <button onClick={() => { setEditingUser(null); setEditName(''); }} className={`px-2 py-1 rounded-lg text-xs border ${isGold ? 'border-[#2a2a2a] text-[#888]' : 'border-gray-200 text-gray-500'}`}>取消</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate">{user.name}</p>
                            <button aria-label={`修改用户名 ${user.name}`} onClick={() => { setEditingUser(user.id); setEditName(user.name); }} className={`p-1 rounded ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title="改名">
                              <Pencil className="w-3.5 h-3.5 text-blue-400" />
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs px-2 py-0.5 rounded ${user.role === 'admin' ? 'bg-[#d4af37]/20 text-[#d4af37]' : isGold ? 'bg-[#222] text-[#888]' : 'bg-gray-200 text-gray-600'}`}>{user.role === 'admin' ? '管理员' : '用户'}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${user.status === 'disabled' ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-500'}`}>{user.status === 'disabled' ? '已禁用' : '正常'}</span>
                        </div>
                        <p className={`text-xs mt-1 truncate ${isGold ? 'text-[#666]' : 'text-gray-500'}`}>{user.storageFolder || `users/${user.id}`}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button aria-label={`${user.status === 'disabled' ? '启用' : '禁用'}用户 ${user.name}`} onClick={() => handleToggleUser(user)} disabled={user.role === 'admin'} className={`p-2 rounded-lg ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-100'} disabled:opacity-30`} title={user.status === 'disabled' ? '启用' : '禁用'}>
                          {user.status === 'disabled' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Ban className="w-4 h-4 text-amber-500" />}
                        </button>
                        <button aria-label={`重置密码 ${user.name}`} onClick={() => { setResetPwdUser(user.id); setNewPassword(''); }} disabled={user.role === 'admin'} className={`p-2 rounded-lg ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-100'} disabled:opacity-30`} title="重置密码">
                          <KeyRound className="w-4 h-4 text-amber-400" />
                        </button>
                        <button aria-label={`删除用户 ${user.name}`} onClick={() => handleDeleteUser(user)} disabled={user.role === 'admin'} className={`p-2 rounded-lg ${isGold ? 'hover:bg-red-950/40' : 'hover:bg-red-50'} disabled:opacity-30`} title="删除">
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                    {/* 重置密码区域 */}
                    {resetPwdUser === user.id && (
                      <div className={`mt-3 pt-3 border-t ${isGold ? 'border-[#2a2a2a]' : 'border-gray-200'}`}>
                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            className={`h-8 px-2 rounded-lg border text-sm flex-1 ${inputClass}`}
                            placeholder="输入新密码（至少4位）"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void handleResetPassword(user.id); if (e.key === 'Escape') { setResetPwdUser(null); setNewPassword(''); } }}
                            autoFocus
                          />
                          <button onClick={() => void handleResetPassword(user.id)} disabled={!newPassword.trim() || newPassword.trim().length < 4} className="px-2 py-1 rounded-lg bg-amber-500 text-black text-xs font-semibold disabled:opacity-40">确认重置</button>
                          <button onClick={() => { setResetPwdUser(null); setNewPassword(''); }} className={`px-2 py-1 rounded-lg text-xs border ${isGold ? 'border-[#2a2a2a] text-[#888]' : 'border-gray-200 text-gray-500'}`}>取消</button>
                        </div>
                      </div>
                    )}
                    {/* 权限标签 */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(Object.keys(userPermissionLabels) as UserPermissionKey[]).map((key) => {
                        const enabled = user.apiPermissions?.[key] ?? true;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => void handleToggleUserPermission(user, key)}
                            className={`px-2 py-1 rounded-md text-xs border ${enabled ? 'bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/30' : isGold ? 'bg-[#151515] text-[#666] border-[#2a2a2a]' : 'bg-white text-gray-400 border-gray-200'}`}
                          >
                            {userPermissionLabels[key]}{enabled ? '' : ' off'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'apis' && (
            <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
              <div className={`rounded-xl border p-4 h-fit ${softClass}`}>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><KeyRound className="w-4 h-4" />添加固定 API</h3>
                <div className="space-y-3">
                  <div>
                    <label className={labelClass} htmlFor="admin-api-kind">API 类型</label>
                    <select id="admin-api-kind" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} value={apiKind} onChange={e => { setApiKind(e.target.value as ApiKind); setDiscoveredModels([]); setSelectedModels([]); }}>
                    {(Object.keys(apiKindLabels) as ApiKind[]).map(kind => <option key={kind} value={kind}>{apiKindLabels[kind]}</option>)}
                    </select>
                    <p className={`text-xs mt-1 ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>{apiKindDescriptions[apiKind]}</p>
                  </div>
                  <button onClick={() => void handleDiscoverModels()} disabled={isDiscovering} className={`w-full h-9 rounded-lg text-sm font-semibold ${isGold ? 'bg-[#1a1a1a] text-[#d4af37] border border-[#2a2a2a]' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}>
                    {isDiscovering ? '识别模型中...' : (apiKind === 'general' ? '识别所有模型' : apiKind === 'vectorize' ? '识别矢量化模型' : apiKind === 'layer' ? '识别分层模型' : apiKind === 'video' ? '识别视频模型' : '自动识别模型')}
                  </button>
                  {apiKind === 'general' && !isDiscovering && discoveredModels.length === 0 && (
                    <p className={`text-xs ${isGold ? 'text-[#777]' : 'text-gray-500'}`}>选择此类型后将显示当前API接口的所有可用模型，不按类型过滤</p>
                  )}
                  {apiKind === 'vectorize' && !isDiscovering && discoveredModels.length === 0 && (
                    <p className={`text-xs ${isGold ? 'text-[#777]' : 'text-gray-500'}`}>系统将自动匹配名称中包含 vectorize / vector / svg / tracer 的模型</p>
                  )}
                  {apiKind === 'layer' && !isDiscovering && discoveredModels.length === 0 && (
                    <p className={`text-xs ${isGold ? 'text-[#777]' : 'text-gray-500'}`}>系统将自动匹配名称中包含 qwen-image-layered / layer / segment 的模型</p>
                  )}
                  {discoveredModels.length > 0 && (
                    <div className={`rounded-lg border p-3 ${isGold ? 'bg-[#0d0d0d] border-[#2a2a2a]' : 'bg-white border-gray-200'}`}>
                      {/* 模型搜索框 */}
                      <div className="relative mb-2">
                        <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${isGold ? 'text-[#666]' : 'text-gray-400'}`} />
                        <input
                          type="text"
                          placeholder="搜索模型..."
                          value={modelSearchQuery}
                          onChange={e => setModelSearchQuery(e.target.value)}
                          className={`w-full h-8 pl-8 pr-3 rounded-md border text-xs ${isGold ? 'bg-[#151515] border-[#2a2a2a] text-[#ccc] placeholder:text-[#555]' : 'bg-gray-50 border-gray-200 text-gray-700 placeholder:text-gray-400'}`}
                        />
                      </div>                      <div className="flex items-center justify-between mb-2">
                        <p className={`text-xs ${isGold ? 'text-[#777]' : 'text-gray-500'}`}>选择前端可见模型</p>
                        <button
                          onClick={() => {
                            const allIds = discoveredModels.map(m => m.id);
                            if (selectedModels.length === allIds.length) {
                              setSelectedModels([]);
                            } else {
                              setSelectedModels(allIds);
                            }
                          }}
                          className={`text-xs px-2 py-0.5 rounded border ${isGold ? 'text-[#d4af37] border-[#d4af37]/30 hover:bg-[#d4af37]/10' : 'text-blue-600 border-blue-200 hover:bg-blue-50'}`}
                        >
                          {selectedModels.length === discoveredModels.length ? '取消全选' : '全选'}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const q = modelSearchQuery.toLowerCase().trim();
                          const sorted = q
                            ? [...discoveredModels].sort((a, b) => {
                                const aName = (a.name || a.id).toLowerCase();
                                const bName = (b.name || b.id).toLowerCase();
                                const aMatch = aName.includes(q) ? 0 : 1;
                                const bMatch = bName.includes(q) ? 0 : 1;
                                return aMatch - bMatch;
                              })
                            : discoveredModels;
                          return sorted.map((model) => (
                            <button
                              key={model.id}
                              onClick={() => setSelectedModels(prev => prev.includes(model.id) ? prev.filter(id => id !== model.id) : [...prev, model.id])}
                              className={`px-2.5 py-1 rounded-md text-xs border ${selectedModels.includes(model.id) ? 'bg-[#d4af37] text-black border-transparent' : isGold ? 'bg-[#151515] text-[#999] border-[#2a2a2a]' : 'bg-gray-50 text-gray-600 border-gray-200'}`}
                            >
                              {model.name && model.name !== model.id ? model.name : getModelDisplayName(model.id)}
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className={labelClass} htmlFor="admin-api-name">显示名称</label>
                    <input id="admin-api-name" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="例如：图像生成接口" value={apiName} onChange={e => setApiName(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="admin-api-base-url">接口地址</label>
                    <input id="admin-api-base-url" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="https://接口域名" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="admin-api-key">固定 API 密钥</label>
                    <input id="admin-api-key" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="只保存在服务端配置" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="admin-api-model">默认模型 ID（可选）</label>
                    <input id="admin-api-model" className={`w-full h-10 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="未自动识别时填写" value={apiModel} onChange={e => setApiModel(e.target.value)} />
                  </div>
                  {/* API 兼容性配置 */}
                  <div>
                    <label className={labelClass} htmlFor="admin-compat-profile">API 兼容模式</label>
                    <select
                      id="admin-compat-profile"
                      className={`w-full h-10 px-3 rounded-lg border text-sm ${isGold ? 'bg-[#111] border-[#2a2a2a] text-[#ccc]' : 'bg-white border-gray-200 text-gray-800'}`}
                      value={compatProfile}
                      onChange={e => setCompatProfile(e.target.value)}
                    >
                      <option value="auto">自动检测 — 根据API地址和响应自动适配</option>
                      <option value="apimart">异步轮询 (宽高比) — 支持宽高比格式，返回task_id需轮询</option>
                      <option value="openai">OpenAI 兼容 (直接返回) — 需像素尺寸，直接返回图片</option>
                      <option value="openai-async">OpenAI 兼容 (异步轮询) — 需像素尺寸，返回task_id</option>
                    </select>
                    <p className={`mt-1 text-xs ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>
                      添加新API时选择兼容模式可避免格式不匹配问题
                    </p>
                  </div>
                  {/* 高级参数 */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedParams(!showAdvancedParams)}
                      className={`flex items-center gap-2 text-sm font-medium ${isGold ? 'text-[#ccc]' : 'text-gray-700'}`}
                    >
                      <Settings className="w-4 h-4" />
                      <span>高级参数{advancedParams.length > 0 ? `(${advancedParams.length})` : ''}</span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvancedParams ? 'rotate-180' : ''}`} />
                    </button>
                    {showAdvancedParams && (
                      <div className="mt-2 space-y-2">
                        {advancedParams.map((param, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              className={`w-[35%] shrink-0 h-9 px-2.5 rounded-lg border text-sm ${isGold ? 'bg-[#111] border-[#2a2a2a] text-[#ccc] placeholder-[#555]' : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'}`}
                              placeholder="参数名"
                              value={param.key}
                              onChange={e => {
                                const next = [...advancedParams];
                                next[idx] = { ...next[idx], key: e.target.value };
                                setAdvancedParams(next);
                              }}
                            />
                            <input
                              className={`flex-1 min-w-0 h-9 px-2.5 rounded-lg border text-sm ${isGold ? 'bg-[#111] border-[#2a2a2a] text-[#ccc] placeholder-[#555]' : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'}`}
                              placeholder="参数值"
                              value={param.value}
                              onChange={e => {
                                const next = [...advancedParams];
                                next[idx] = { ...next[idx], value: e.target.value };
                                setAdvancedParams(next);
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => setAdvancedParams(prev => prev.filter((_, i) => i !== idx))}
                              className="p-1.5 rounded-md text-red-500 hover:bg-red-500/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setAdvancedParams(prev => [...prev, { key: `param_${Date.now().toString().slice(-5)}`, value: '' }])}
                          className={`flex items-center gap-1.5 text-xs ${isGold ? 'text-[#888] hover:text-[#aaa]' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          添加参数
                        </button>
                      </div>
                    )}
                  </div>
                  {/* 操作按钮 */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTestNewConnection()}
                      disabled={isTestingNew || !apiBaseUrl || !apiKey}
                      className={`flex-1 h-9 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 border disabled:opacity-40 ${isGold ? 'border-[#333] text-[#d4af37] hover:bg-[#1a1a1a]' : 'border-gray-300 text-[#d4af37] hover:bg-gray-50'}`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isTestingNew ? 'animate-spin' : ''}`} />
                      {isTestingNew ? '测试中...' : '测试连接'}
                    </button>
                    <button
                      onClick={() => editingProviderId ? void handleUpdateApi() : void handleAddApi()}
                      className={`flex-1 h-9 rounded-lg text-sm font-semibold ${editingProviderId ? 'bg-blue-600 text-white' : 'bg-[#d4af37] text-black'}`}
                    >
                      {editingProviderId ? '更新 API' : '添加 API'}
                    </button>
                  </div>
                  {testNewResult && (
                    <div className={`text-xs px-3 py-2 rounded-lg ${testNewResult.success ? (isGold ? 'bg-green-500/10 text-green-400' : 'bg-green-50 text-green-700') : (isGold ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-700')}`}>
                      {testNewResult.success ? `连接成功 · ${testNewResult.modelCount ?? 0} 个模型可用` : `连接失败：${testNewResult.error}`}
                    </div>
                  )}
                  {editingProviderId && (
                    <button onClick={() => { setEditingProviderId(null); setApiName(''); setApiBaseUrl(''); setApiKey(''); setApiModel(''); setDiscoveredModels([]); setSelectedModels([]); setModelSearchQuery(''); }} className={`w-full h-9 rounded-lg text-sm border ${isGold ? 'border-[#333] text-[#888] hover:bg-[#1a1a1a]' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                      取消编辑
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-end gap-2">
                  <button aria-label="刷新余额" onClick={() => void refreshBalances()} className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 ${isGold ? 'bg-[#1a1a1a] text-[#aaa]' : 'bg-gray-100 text-gray-600'}`}><Activity className="w-3 h-3" />刷新余额</button>
                  <button aria-label="刷新模型列表" onClick={() => void refresh()} className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 ${isGold ? 'bg-[#1a1a1a] text-[#aaa]' : 'bg-gray-100 text-gray-600'}`}><RefreshCw className="w-3 h-3" />刷新模型</button>
                </div>
                {providers.map((provider, providerIndex) => (
                  <div key={provider.id} className={`rounded-xl border p-4 ${softClass}`}>
                    <div className="flex items-start gap-3">
                      <Plug className={`w-5 h-5 mt-0.5 shrink-0 ${provider.isEnabled ? 'text-[#d4af37]' : 'text-gray-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{provider.displayName || provider.name}</p>
                          <span className={`text-xs px-2 py-0.5 rounded ${isGold ? 'bg-[#222] text-[#aaa]' : 'bg-gray-200 text-gray-600'}`}>{apiKindLabels[provider.modelType as ApiKind] || (provider.modelType === 'imageEdit' ? '图像处理' : provider.modelType === 'universal' ? '通用' : provider.modelType === 'general' ? '通用模型' : provider.modelType)}</span>
                          {provider.isEnabled && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-500">启用</span>
                          )}
                        </div>
                        <p className={`text-xs mt-1 truncate ${isGold ? 'text-[#666]' : 'text-gray-500'}`}>{provider.baseUrl}</p>
                        <p className={`text-xs mt-1 font-mono ${isGold ? 'text-[#555]' : 'text-gray-400'}`}>{(provider as any).apiKeyPreview || `${provider.apiKey.slice(0, 8)}****************`}</p>
                        {/* 当前选择的模型 */}
                        {provider.selectedModels && provider.selectedModels.length > 0 && (
                          <div className="mt-2">
                            <p className={`text-xs mb-1 ${isGold ? 'text-[#888]' : 'text-gray-500'}`}>当前模型：</p>
                            <div className="flex flex-wrap gap-1">
                              {provider.selectedModels.map((modelId: string) => {
                                const discovered = (provider.discoveredModels || []).find((dm: { id: string }) => dm.id === modelId);
                                const displayName = discovered?.name && discovered.name !== modelId ? discovered.name : getModelDisplayName(modelId);
                                return (
                                <span key={modelId} className={`text-xs px-2 py-0.5 rounded ${isGold ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-amber-50 text-amber-700'}`}>{displayName}</span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* 功能对接提示 */}
                        {provider.modelType === 'vectorize' && provider.isEnabled && (
                          <div className={`mt-2 text-xs px-2 py-1 rounded ${isGold ? 'bg-[#d4af37]/10 text-[#d4af37]' : 'bg-amber-50 text-amber-700'}`}>
                            已对接：矢量化工具 / 导出SVG
                          </div>
                        )}
                        {provider.modelType === 'layer' && provider.isEnabled && (
                          <div className={`mt-2 text-xs px-2 py-1 rounded ${isGold ? 'bg-[#d4af37]/10 text-[#d4af37]' : 'bg-amber-50 text-amber-700'}`}>
                            已对接：编辑元素 / 下载PSD
                          </div>
                        )}
                        {/* 余额/用量信息 */}
                        {(() => {
                          const bal = apiBalances.find(b => b.providerId === provider.id || b.providerName === provider.name || provider.baseUrl.includes(b.providerId));
                          if (!bal) return null;
                          return (
                            <div className={`flex items-center gap-3 mt-2 text-xs ${isGold ? 'text-[#888]' : 'text-gray-500'}`}>
                              {bal.balance !== null && (
                                <span className="flex items-center gap-1">
                                  <Wallet className="w-3 h-3" />
                                  余额: <span className={bal.balance > 10 ? 'text-green-500' : bal.balance > 1 ? 'text-yellow-500' : 'text-red-500'}>{bal.balance.toFixed(2)} {bal.currency}</span>
                                </span>
                              )}
                              {bal.totalUsage > 0 && <span>总用量: {bal.totalUsage}</span>}
                              {bal.dailyUsage > 0 && <span>今日: {bal.dailyUsage}</span>}
                              {bal.error && <span className="text-red-400 text-xs">{bal.error}</span>}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    {/* 底部工具栏：图标横排右下角 */}
                    <div className="flex items-center justify-end gap-1 mt-3 pt-2 border-t border-current/5">
                      <button aria-label={`上移 ${provider.displayName || provider.name}`} onClick={() => void handleReorderApi(provider.id, 'up')} disabled={providerIndex === 0} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-[#222] text-[#999]' : 'hover:bg-gray-100 text-gray-500'} disabled:opacity-20 disabled:cursor-not-allowed`} title="上移">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button aria-label={`下移 ${provider.displayName || provider.name}`} onClick={() => void handleReorderApi(provider.id, 'down')} disabled={providerIndex === providers.length - 1} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-[#222] text-[#999]' : 'hover:bg-gray-100 text-gray-500'} disabled:opacity-20 disabled:cursor-not-allowed`} title="下移">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <div className={`w-px h-4 mx-1 ${isGold ? 'bg-[#333]' : 'bg-gray-200'}`} />
                      <button aria-label={`重新探测 ${provider.displayName || provider.name} 的模型`} onClick={() => void handleRefreshApi(provider)} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-[#222] text-[#999]' : 'hover:bg-gray-100 text-gray-500'}`} title="重新探测模型">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button aria-label={`测试 ${provider.displayName || provider.name} 的连接`} onClick={() => void handleTestConnection(provider)} disabled={isTesting} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title="测试连接">
                        {isTesting && testResult?.providerId === provider.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-500" /> : <Zap className="w-3.5 h-3.5 text-yellow-500" />}
                      </button>
                      <button aria-label={`验证 ${provider.displayName || provider.name} 的协议`} onClick={() => void handleVerifyProtocol(provider)} disabled={isVerifying} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title="协议验证">
                        {isVerifying && verifyResult?.providerId === provider.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" /> : <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />}
                      </button>
                      <button onClick={() => void handleToggleApi(provider)} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title={provider.isEnabled ? '停用' : '启用'}>
                        {provider.isEnabled ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-gray-500" />}
                      </button>
                      <button aria-label={`编辑 API ${provider.displayName || provider.name}`} onClick={() => handleEditApi(provider)} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title="编辑">
                        <Pencil className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                      <button aria-label={`删除 API ${provider.displayName || provider.name}`} onClick={() => void handleDeleteApi(provider)} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-red-950/40' : 'hover:bg-red-50'}`} title="删除">
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                    {/* Test connection result */}
                    {testResult && testResult.providerId === provider.id && (
                      <div className={`mt-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${testResult.success ? (isGold ? 'bg-green-900/20 text-green-400' : 'bg-green-50 text-green-700') : (isGold ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-700')}`}>
                        {testResult.success ? <CheckCircle className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                        <span>{testResult.message}</span>
                        <button onClick={() => setTestResult(null)} className="ml-auto opacity-50 hover:opacity-100"><X size={12} /></button>
                      </div>
                    )}
                    {/* Protocol verification result */}
                    {verifyResult && verifyResult.providerId === provider.id && (
                      <div className={`mt-2 px-3 py-2 rounded-lg text-xs ${isGold ? 'bg-cyan-900/20 text-cyan-300' : 'bg-cyan-50 text-cyan-800'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          <span className="font-medium">协议验证: {verifyResult.summary}</span>
                          <button onClick={() => setVerifyResult(null)} className="ml-auto opacity-50 hover:opacity-100"><X size={12} /></button>
                        </div>
                        <div className="space-y-1 ml-5">
                          {verifyResult.tests.map((test, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              {test.status === 'pass' ? <CheckCircle className="w-3 h-3 text-green-400 shrink-0" /> : test.status === 'warn' ? <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" /> : <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                              <span className="opacity-80">{test.name}:</span>
                              <span className="opacity-60">{test.detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Edit mode highlight */}
                    {editingProviderId === provider.id && (
                      <div className={`mt-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${isGold ? 'bg-blue-900/20 text-blue-400' : 'bg-blue-50 text-blue-700'}`}>
                        <Pencil className="w-3.5 h-3.5 shrink-0" />
                        <span>正在编辑此 API，请在左侧表单中修改</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'data' && (
            <div className={`rounded-xl border p-5 ${softClass}`}>
              <h3 className="text-sm font-semibold mb-3">用户数据管理</h3>
              <div className="flex gap-4 min-h-[400px]">
                {/* Left: User list */}
                <div className="w-1/3 border-r pr-3">
                  <div className={`text-xs font-medium mb-2 ${isGold ? 'text-[#999]' : 'text-gray-500'}`}>选择用户</div>
                  <div className="space-y-1 max-h-[500px] overflow-y-auto">
                    {users.map(user => (
                      <button
                        key={user.id}
                        onClick={() => loadUserData(user.id)}
                        className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                          selectedDataUser === user.id
                            ? isGold ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-primary/10 text-primary'
                            : isGold ? 'bg-[#0d0d0d] hover:bg-[#1a1a1a] text-gray-200' : 'bg-white hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="font-medium">{user.name}</div>
                        <div className={`text-xs mt-0.5 ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>{user.id}</div>
                      </button>
                    ))}
                  </div>
                </div>
                {/* Right: Data keys + detail */}
                <div className="flex-1 flex gap-4 min-w-0">
                  {/* Data keys list */}
                  <div className="w-1/2 border-r pr-3">
                    <div className={`text-xs font-medium mb-2 ${isGold ? 'text-[#999]' : 'text-gray-500'}`}>
                      {selectedDataUser ? '数据条目' : '请先选择用户'}
                    </div>
                    {selectedDataUser ? (
                      userDataKeys.length > 0 ? (
                        <div className="space-y-1 max-h-[500px] overflow-y-auto">
                          {userDataKeys.map((dk) => (
                            <div
                              key={dk.dataKey}
                              className={`group rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                                viewingDataKey === dk.dataKey
                                  ? isGold ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-primary/10 text-primary'
                                  : isGold ? 'bg-[#0d0d0d] hover:bg-[#1a1a1a]' : 'bg-white hover:bg-gray-50'
                              }`}
                              onClick={() => loadDataDetail(selectedDataUser, dk.dataKey)}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{dk.dataKey}</div>
                                <div className={`text-xs mt-0.5 ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>
                                  {dk.updatedAt ? new Date(dk.updatedAt).toLocaleString('zh-CN') : ''}
                                </div>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteUserData(selectedDataUser, dk.dataKey); }}
                                className={`opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded transition-opacity ${
                                  isGold ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-50 text-red-500'
                                }`}
                                title="删除此数据"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`text-xs ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>该用户暂无数据</div>
                      )
                    ) : (
                      <div className={`text-xs ${isGold ? 'text-[#555]' : 'text-gray-300'}`}>← 点击左侧用户查看数据</div>
                    )}
                  </div>
                  {/* Data detail */}
                  <div className="w-1/2 min-w-0">
                    <div className={`text-xs font-medium mb-2 ${isGold ? 'text-[#999]' : 'text-gray-500'}`}>
                      {viewingDataKey ? `数据详情: ${viewingDataKey}` : '数据内容'}
                    </div>
                    {viewingDataLoading ? (
                      <div className={`text-xs ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>加载中...</div>
                    ) : viewingDataValue !== null ? (
                      <div className={`rounded-lg p-3 text-xs font-mono max-h-[500px] overflow-auto ${
                        isGold ? 'bg-[#0d0d0d] text-gray-300' : 'bg-gray-50 text-gray-700'
                      }`}>
                        <pre className="whitespace-pre-wrap break-all">{typeof viewingDataValue === 'string' ? viewingDataValue : JSON.stringify(viewingDataValue, null, 2)}</pre>
                      </div>
                    ) : (
                      <div className={`text-xs ${isGold ? 'text-[#555]' : 'text-gray-300'}`}>
                        {selectedDataUser ? '← 点击左侧条目查看详情' : ''}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Tab: Credits Management ── */}
          {activeTab === 'credits' && (
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
              {/* Left: User list with credits */}
              <div className={`rounded-xl border p-4 h-fit ${softClass}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2"><Zap className="w-4 h-4" />用户积分概览</h3>
                  <button onClick={loadCreditsOverview} className="text-xs text-[#d4af37] hover:underline" disabled={creditsLoading}>
                    {creditsLoading ? '加载中...' : '刷新'}
                  </button>
                </div>
                {creditsUsers.length === 0 ? (
                  <p className="text-xs text-[#666] text-center py-4">暂无数据</p>
                ) : (
                  <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
                    {creditsUsers.map((u) => (
                      <button
                        key={u.userId}
                        onClick={() => loadCreditsTransactions(u.userId)}
                        className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                          selectedCreditsUser === u.userId
                            ? 'bg-[#d4af37]/10 border border-[#d4af37]/30'
                            : 'hover:bg-[#1a1a1a] border border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-white">{u.userName}</span>
                          <span className="text-xs font-bold text-[#d4af37]">{u.balance.toLocaleString()} <span className="text-[#666] font-normal">≈¥{(u.balance * 0.01).toFixed(2)}</span></span>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[10px] text-[#666]">
                          <span>充值 {u.totalRecharged.toLocaleString()}</span>
                          <span>使用 {u.totalUsed.toLocaleString()}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: Selected user details */}
              <div className={`rounded-xl border p-4 ${softClass}`}>
                {!selectedCreditsUser ? (
                  <p className="text-xs text-[#666] text-center py-8">选择左侧用户查看详情</p>
                ) : (
                  <div>
                    {/* Admin recharge */}
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Wallet className="w-4 h-4" />管理员充值</h3>
                    <div className="flex gap-2 mb-4">
                      <input
                        type="number"
                        min="1"
                        value={adminRechargeAmount}
                        onChange={(e) => setAdminRechargeAmount(Math.max(1, parseInt(e.target.value) || 0))}
                        className="flex-1 rounded-lg px-3 py-2 text-xs bg-[#1a1a1a] border border-[#333] text-white focus:border-[#d4af37] outline-none"
                        placeholder="积分数量"
                      />
                      <input
                        type="text"
                        value={adminRechargeDesc}
                        onChange={(e) => setAdminRechargeDesc(e.target.value)}
                        className="flex-1 rounded-lg px-3 py-2 text-xs bg-[#1a1a1a] border border-[#333] text-white focus:border-[#d4af37] outline-none"
                        placeholder="备注（可选）"
                      />
                      <button
                        onClick={handleAdminRecharge}
                        disabled={isAdminRecharging}
                        className="px-4 py-2 rounded-lg text-xs font-medium bg-[#d4af37] text-black hover:bg-[#e5c44e] disabled:opacity-50 transition-colors"
                      >
                        {isAdminRecharging ? '充值中...' : '充值'}
                      </button>
                    </div>

                    {/* Quick amounts */}
                    <div className="flex gap-1.5 mb-2">
                      {[50, 100, 200, 500, 1000, 5000].map((amt) => (
                        <button
                          key={amt}
                          onClick={() => setAdminRechargeAmount(amt)}
                          className={`px-2.5 py-1 rounded text-[10px] transition-colors ${
                            adminRechargeAmount === amt
                              ? 'bg-[#d4af37] text-black'
                              : 'bg-[#1a1a1a] text-[#999] hover:text-white border border-[#333]'
                          }`}
                        >
                          {amt}积分
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#666] mb-4">1积分 ≈ ¥0.01 | {adminRechargeAmount}积分 ≈ ¥{(adminRechargeAmount * 0.01).toFixed(2)}</p>

                    {/* Transaction history */}
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Activity className="w-4 h-4" />交易记录</h3>
                    {creditsTransactions.length === 0 ? (
                      <p className="text-xs text-[#666] text-center py-4">暂无记录</p>
                    ) : (
                      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                        <div className="grid grid-cols-[1fr_80px_80px_100px_80px] gap-2 px-3 py-1.5 text-[10px] text-[#666] font-medium uppercase">
                          <span>类型</span>
                          <span className="text-right">数量</span>
                          <span className="text-right">余额</span>
                          <span>备注</span>
                          <span className="text-right">时间</span>
                        </div>
                        {creditsTransactions.map((tx) => (
                          <div
                            key={tx.id}
                            className="grid grid-cols-[1fr_80px_80px_100px_80px] gap-2 px-3 py-2 rounded-lg bg-[#1a1a1a] text-xs items-center"
                          >
                            <span className="font-medium">
                              {tx.type === 'recharge' ? '充值' : tx.type === 'consume' ? '消费' : tx.type === 'refund' ? '退款' : '管理员调整'}
                            </span>
                            <span className={`text-right font-bold ${tx.amount > 0 ? 'text-[#d4af37]' : 'text-[#ff6b6b]'}`}>
                              {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}<span className="text-[#555] text-[10px]"> ≈¥{(Math.abs(tx.amount) * 0.01).toFixed(2)}</span>
                            </span>
                            <span className="text-right text-[#999]">{tx.balanceAfter.toLocaleString()}</span>
                            <span className="text-[#666] truncate" title={tx.description}>{tx.description || '-'}</span>
                            <span className="text-right text-[#666]">{new Date(tx.createdAt).toLocaleDateString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Tab: E-commerce Templates ── */}
          {activeTab === 'ecom-templates' && (
            <div className={`rounded-xl border p-5 ${softClass}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2"><ShoppingBag className="w-4 h-4" />电商模板管理</h3>
                <button
                  onClick={() => {
                    setEditingEcomTpl({
                      id: `tpl_${Date.now()}`,
                      name: '',
                      icon: '📄',
                      description: '',
                      prompt_template: '',
                      negative_prompt: 'low quality, blurry, distorted, deformed, watermark',
                      aspect_ratio: '1:1',
                      category: 'product',
                      fidelity_anchor: '',
                      sort_order: ecomTemplates.length + 1,
                      is_enabled: true,
                    });
                    setShowNewEcomTpl(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#d4af37] text-black hover:bg-[#e0b840] transition-colors cursor-pointer"
                >
                  <Plus size={12} /> 新增模板
                </button>
              </div>

              {/* Template list */}
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {ecomTemplates.length === 0 ? (
                  <div className={`text-center py-8 text-sm ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>
                    暂无自定义模板，点击"新增模板"添加
                  </div>
                ) : ecomTemplates.map((tpl, idx) => (
                  <div
                    key={tpl.id as string}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 ${isGold ? 'bg-[#0d0d0d] hover:bg-[#1a1a1a]' : 'bg-white hover:bg-gray-50'} transition-colors`}
                  >
                    {/* Icon + name */}
                    <span className="text-lg">{tpl.icon as string || '📄'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{tpl.name as string || '未命名'}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${tpl.is_enabled ? (isGold ? 'bg-green-500/20 text-green-400' : 'bg-green-50 text-green-600') : (isGold ? 'bg-[#333] text-[#666]' : 'bg-gray-100 text-gray-400')}`}>
                          {tpl.is_enabled ? '启用' : '禁用'}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${isGold ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-blue-50 text-blue-600'}`}>
                          {(tpl.category as string) || 'product'}
                        </span>
                        <span className={`text-[10px] ${isGold ? 'text-[#555]' : 'text-gray-400'}`}>
                          {tpl.aspect_ratio as string}
                        </span>
                      </div>
                      <div className={`text-xs mt-0.5 truncate ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>
                        {tpl.description as string || '无描述'}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => moveEcomTemplateOrder(tpl.id as string, 'up')} disabled={idx === 0} className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-30 ${isGold ? 'hover:bg-[#2a2a2a] text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`} title="上移">
                        <ArrowUp size={12} />
                      </button>
                      <button onClick={() => moveEcomTemplateOrder(tpl.id as string, 'down')} disabled={idx === ecomTemplates.length - 1} className={`p-1 rounded transition-colors cursor-pointer disabled:opacity-30 ${isGold ? 'hover:bg-[#2a2a2a] text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`} title="下移">
                        <ArrowDown size={12} />
                      </button>
                      <button onClick={() => toggleEcomTemplateEnabled(tpl.id as string, !tpl.is_enabled)} className={`p-1 rounded transition-colors cursor-pointer ${isGold ? 'hover:bg-[#2a2a2a]' : 'hover:bg-gray-100'}`} title={tpl.is_enabled ? '禁用' : '启用'}>
                        {tpl.is_enabled ? <CheckCircle2 size={12} className="text-green-400" /> : <Ban size={12} className={isGold ? 'text-[#555]' : 'text-gray-300'} />}
                      </button>
                      <button onClick={() => { setEditingEcomTpl({ ...tpl }); setShowNewEcomTpl(false); }} className={`p-1 rounded transition-colors cursor-pointer ${isGold ? 'hover:bg-[#2a2a2a] text-[#888]' : 'hover:bg-gray-100 text-gray-500'}`} title="编辑">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => deleteEcomTemplate(tpl.id as string)} className={`p-1 rounded transition-colors cursor-pointer ${isGold ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-50 text-red-500'}`} title="删除">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Edit/New template form */}
              {(showNewEcomTpl || editingEcomTpl) && (
                <div className={`mt-4 rounded-xl border p-4 ${softClass}`}>
                  <h4 className="text-sm font-semibold mb-3">
                    {showNewEcomTpl ? '新增模板' : `编辑模板: ${editingEcomTpl?.name || ''}`}
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass} htmlFor="ecom-tpl-name">模板名称 *</label>
                      <input id="ecom-tpl-name" className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="如：白底主图" value={(editingEcomTpl?.name as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, name: e.target.value } : null)} />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="ecom-tpl-icon">图标</label>
                      <input id="ecom-tpl-icon" className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="如：📦" value={(editingEcomTpl?.icon as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, icon: e.target.value } : null)} />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="ecom-tpl-category">分类</label>
                      <select id="ecom-tpl-category" className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} value={(editingEcomTpl?.category as string) || 'product'} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, category: e.target.value } : null)}>
                        <option value="product">商品展示</option>
                        <option value="scene">场景氛围</option>
                        <option value="model">模特展示</option>
                        <option value="graphic">平面设计</option>
                        <option value="detail">细节展示</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="ecom-tpl-ratio">画面比例</label>
                      <select id="ecom-tpl-ratio" className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} value={(editingEcomTpl?.aspect_ratio as string) || '1:1'} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, aspect_ratio: e.target.value } : null)}>
                        <option value="1:1">1:1</option>
                        <option value="4:3">4:3</option>
                        <option value="3:4">3:4</option>
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="3:2">3:2</option>
                        <option value="2:3">2:3</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className={labelClass} htmlFor="ecom-tpl-desc">描述</label>
                      <input id="ecom-tpl-desc" className={`w-full h-9 px-3 rounded-lg border text-sm ${inputClass}`} placeholder="简短描述此模板的用途" value={(editingEcomTpl?.description as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, description: e.target.value } : null)} />
                    </div>
                    <div className="col-span-2">
                      <label className={labelClass} htmlFor="ecom-tpl-prompt">提示词模板 *</label>
                      <textarea id="ecom-tpl-prompt" className={`w-full h-28 px-3 py-2 rounded-lg border text-sm ${inputClass} resize-y`} placeholder="使用 {SUBJECT} {brand_color_prompt} {style_extra} 等占位符" value={(editingEcomTpl?.prompt_template as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, prompt_template: e.target.value } : null)} />
                    </div>
                    <div className="col-span-2">
                      <label className={labelClass} htmlFor="ecom-tpl-neg">反向提示词</label>
                      <textarea id="ecom-tpl-neg" className={`w-full h-16 px-3 py-2 rounded-lg border text-sm ${inputClass} resize-y`} placeholder="排除的低质量描述" value={(editingEcomTpl?.negative_prompt as string) || ''} onChange={e => setEditingEcomTpl(prev => prev ? { ...prev, negative_prompt: e.target.value } : null)} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => editingEcomTpl && saveEcomTemplate(editingEcomTpl)}
                      disabled={isEcomTplSaving || !(editingEcomTpl?.name) || !(editingEcomTpl?.prompt_template)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[#d4af37] text-black hover:bg-[#e0b840] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isEcomTplSaving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                      {isEcomTplSaving ? '保存中...' : '保存模板'}
                    </button>
                    <button
                      onClick={() => { setEditingEcomTpl(null); setShowNewEcomTpl(false); }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${isGold ? 'text-[#888] hover:bg-[#1a1a1a]' : 'text-gray-500 hover:bg-gray-100'}`}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDlg.open}
        title={confirmDlg.title}
        message={confirmDlg.message}
        variant={confirmDlg.variant}
        onConfirm={confirmDlg.onConfirm}
        onCancel={confirmDlg.onCancel}
      />
    </div>
  );
}
