'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, UserPlus, Trash2, Ban, CheckCircle2, KeyRound, Plug, RefreshCw, Activity, Wallet, Pencil, Zap, CheckCircle, XCircle, Loader2, Search, Settings, ChevronDown, Plus } from 'lucide-react';
import { User } from '@/lib/user-types';
import { ConfirmDialog } from './custom-dialogs';
import type { ApiProvider, ModelInfo } from '@/lib/universal-api-types';
import { getModelDisplayName } from '@/lib/model-name-map';

interface AdminSystemProps {
  themeStyle?: 'gold' | 'monochrome';
  onClose: () => void;
}

type ApiKind = 'image' | 'chat' | '3d' | 'vectorize' | 'layer';
type UserPermissionKey = 'image' | 'chat' | 'threeD' | 'imageEdit' | 'vectorize' | 'layer';
type AdminProvider = ApiProvider & { apiKeyPreview?: string };

const apiKindLabels: Record<ApiKind, string> = {
  image: '图像模型',
  chat: 'LLM 模型',
  '3d': '3D 模型',
  vectorize: '矢量模型',
  layer: '图片分层模型',
};

const apiKindDescriptions: Record<ApiKind, string> = {
  image: '支持自动识别模型，管理员选择后对接到图像生成功能',
  chat: '支持自动识别模型，管理员选择后对接到AI聊天功能',
  '3d': '支持自动识别模型，管理员选择后对接到一键转3D功能',
  vectorize: '添加API后系统自动识别 vectorize 模型，对接到矢量化工具和导出SVG',
  layer: '添加API后系统自动识别 qwen-image-layered 模型，对接到编辑元素和下载PSD',
};

const userPermissionLabels: Record<UserPermissionKey, string> = {
  image: '图像',
  chat: 'LLM',
  threeD: '3D',
  imageEdit: '编辑',
  vectorize: '矢量',
  layer: '分层',
};

export function AdminSystem({ themeStyle = 'gold', onClose }: AdminSystemProps) {
  const isGold = themeStyle === 'gold';
  const [users, setUsers] = useState<User[]>([]);
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'apis' | 'data'>('users');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('123456');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [confirmDlg, setConfirmDlg] = useState<{ open: boolean; title: string; message: string; variant?: 'danger' | 'warning'; onConfirm: () => void; onCancel: () => void }>({ open: false, title: '', message: '', onConfirm: () => {}, onCancel: () => {} });

  const [apiName, setApiName] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiModel, setApiModel] = useState('');
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
  const [apiBalances, setApiBalances] = useState<Array<{
    providerId: string; providerName: string; providerType: string;
    balance: number | null; currency: string; totalUsage: number; dailyUsage: number;
    lastUpdated: string; error?: string;
  }>>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store', credentials: 'include' });
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
      const data = await response.json();
      if (data.success) setProviders(data.providers || []);
      else setProviders([]);
    } catch {
      setProviders([]);
    }
  }, []);

  const refreshBalances = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/api-balance', { credentials: 'include' });
      const data = await response.json();
      if (data.success) setApiBalances(data.balances || []);
    } catch {
      setApiBalances([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshBalances();
  }, [refresh, refreshBalances]);

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

  const handleToggleUserPermission = async (user: User, key: UserPermissionKey) => {
    const current: Record<UserPermissionKey, boolean> = {
      image: user.apiPermissions?.image ?? true,
      chat: user.apiPermissions?.chat ?? true,
      threeD: user.apiPermissions?.threeD ?? true,
      imageEdit: user.apiPermissions?.imageEdit ?? true,
      vectorize: user.apiPermissions?.vectorize ?? true,
      layer: user.apiPermissions?.layer ?? true,
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
      const data = await response.json();
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
      }
      // 图像/LLM/3D模型：默认不选择，管理员手动选择
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleAddApi = async () => {
    if (!apiName.trim() || !apiBaseUrl.trim() || !apiKey.trim()) return;
    const models = selectedModels.length ? selectedModels : apiModel.trim() ? [apiModel.trim()] : [];
    await fetch('/api/admin/apis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: apiName.trim(),
        baseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
        modelType: apiKind,
        selectedModels: models,
        requestStyle: apiKind === 'chat' ? 'chat-completions' : apiKind === 'vectorize' || apiKind === 'layer' ? 'chat-completions' : 'images-generations',
        advancedParams: advancedParams.filter(p => p.key.trim()),
      }),
    });
    setApiName('');
    setApiBaseUrl('');
    setApiKey('');
    setApiModel('');
    setDiscoveredModels([]);
    setSelectedModels([]);
    setEditingProviderId(null);
    setAdvancedParams([]);
    setShowAdvancedParams(false);
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refresh();
  };

  const handleEditApi = (provider: AdminProvider) => {
    // Fill the left form with provider data for editing
    setEditingProviderId(provider.id);
    setApiName(provider.displayName || provider.name);
    setApiBaseUrl(provider.baseUrl);
    setApiKey(''); // Don't prefill the key for security
    setApiKind((provider.modelType || 'image') as ApiKind);
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
    if (filteredParams.length > 0) updates.advancedParams = filteredParams;

    await fetch('/api/admin/apis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', providerId: editingProviderId, updates }),
    });
    // Reset form
    setEditingProviderId(null);
    setApiName('');
    setApiBaseUrl('');
    setApiKey('');
    setApiModel('');
    setDiscoveredModels([]);
    setSelectedModels([]);
    setAdvancedParams([]);
    setShowAdvancedParams(false);
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refresh();
  };

  const handleTestConnection = async (provider: AdminProvider) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/test-provider-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ providerId: provider.id }),
      });
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

  const handleToggleApi = async (provider: AdminProvider) => {
    await fetch('/api/admin/apis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', providerId: provider.id, updates: { isEnabled: !provider.isEnabled } }),
    });
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refresh();
  };

  const handleRefreshApi = async (provider: AdminProvider) => {
    await fetch('/api/admin/apis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh', providerId: provider.id }),
    });
    window.dispatchEvent(new Event('wujie-admin-apis-updated'));
    await refresh();
  };

  const handleDeleteApi = (provider: AdminProvider) => {
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

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
      <div className={`w-full max-w-5xl max-h-[88vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${panelClass}`}>
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isGold ? 'border-[#2a2a2a]' : 'border-gray-100'}`}>
          <div>
            <h2 className="text-lg font-semibold">管理员系统</h2>
            <p className={`text-xs mt-1 ${isGold ? 'text-[#777]' : 'text-gray-500'}`}>用户、权限、模型 API 与项目数据统一管理</p>
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
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as 'users' | 'apis' | 'data')}
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
                  <div key={user.id} className={`rounded-xl border p-4 flex items-center gap-3 ${softClass}`}>
                    <div className="w-10 h-10 rounded-xl bg-[#d4af37] text-black flex items-center justify-center font-bold">{user.name.slice(0, 1).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">{user.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded ${user.role === 'admin' ? 'bg-[#d4af37]/20 text-[#d4af37]' : isGold ? 'bg-[#222] text-[#888]' : 'bg-gray-200 text-gray-600'}`}>{user.role === 'admin' ? '管理员' : '用户'}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${user.status === 'disabled' ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-500'}`}>{user.status === 'disabled' ? '已禁用' : '正常'}</span>
                      </div>
                      <p className={`text-xs mt-1 truncate ${isGold ? 'text-[#666]' : 'text-gray-500'}`}>{user.storageFolder || `users/${user.id}`}</p>
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
                    <button aria-label={`${user.status === 'disabled' ? '启用' : '禁用'}用户 ${user.name}`} onClick={() => handleToggleUser(user)} disabled={user.role === 'admin'} className={`p-2 rounded-lg ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-100'} disabled:opacity-30`} title={user.status === 'disabled' ? '启用' : '禁用'}>
                      {user.status === 'disabled' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Ban className="w-4 h-4 text-amber-500" />}
                    </button>
                    <button aria-label={`删除用户 ${user.name}`} onClick={() => handleDeleteUser(user)} disabled={user.role === 'admin'} className={`p-2 rounded-lg ${isGold ? 'hover:bg-red-950/40' : 'hover:bg-red-50'} disabled:opacity-30`} title="删除">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
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
                    {isDiscovering ? '识别模型中...' : (apiKind === 'vectorize' ? '识别矢量化模型' : apiKind === 'layer' ? '识别分层模型' : '自动识别模型')}
                  </button>
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
                {providers.map(provider => (
                  <div key={provider.id} className={`rounded-xl border p-4 ${softClass}`}>
                    <div className="flex items-start gap-3">
                      <Plug className={`w-5 h-5 mt-0.5 shrink-0 ${provider.isEnabled ? 'text-[#d4af37]' : 'text-gray-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{provider.displayName || provider.name}</p>
                          <span className={`text-xs px-2 py-0.5 rounded ${isGold ? 'bg-[#222] text-[#aaa]' : 'bg-gray-200 text-gray-600'}`}>{apiKindLabels[provider.modelType as ApiKind] || (provider.modelType === 'imageEdit' ? '图像处理' : provider.modelType === 'universal' ? '通用' : provider.modelType)}</span>
                          {provider.isEnabled && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-500">启用</span>
                          )}
                        </div>
                        <p className={`text-xs mt-1 truncate ${isGold ? 'text-[#666]' : 'text-gray-500'}`}>{provider.baseUrl}</p>
                        <p className={`text-xs mt-1 font-mono ${isGold ? 'text-[#555]' : 'text-gray-400'}`}>{provider.apiKeyPreview || `${provider.apiKey.slice(0, 8)}****************`}</p>
                        {/* 当前选择的模型 */}
                        {provider.selectedModels && provider.selectedModels.length > 0 && (
                          <div className="mt-2">
                            <p className={`text-xs mb-1 ${isGold ? 'text-[#888]' : 'text-gray-500'}`}>当前模型：</p>
                            <div className="flex flex-wrap gap-1">
                              {provider.selectedModels.map(modelId => (
                                <span key={modelId} className={`text-xs px-2 py-0.5 rounded ${isGold ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-amber-50 text-amber-700'}`}>{getModelDisplayName(modelId)}</span>
                              ))}
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
                      <button aria-label={`重新探测 ${provider.displayName || provider.name} 的模型`} onClick={() => void handleRefreshApi(provider)} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-[#222] text-[#999]' : 'hover:bg-gray-100 text-gray-500'}`} title="重新探测模型">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button aria-label={`测试 ${provider.displayName || provider.name} 的连接`} onClick={() => void handleTestConnection(provider)} disabled={isTesting} className={`p-1.5 rounded-lg ${isGold ? 'hover:bg-[#222]' : 'hover:bg-gray-100'}`} title="测试连接">
                        {isTesting && testResult?.providerId === provider.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-500" /> : <Zap className="w-3.5 h-3.5 text-yellow-500" />}
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
              <h3 className="text-sm font-semibold mb-3">用户数据文件夹</h3>
              <div className="space-y-2">
                {users.map(user => (
                  <div key={user.id} className={`rounded-lg px-3 py-2 flex justify-between text-sm ${isGold ? 'bg-[#0d0d0d]' : 'bg-white'}`}>
                    <span>{user.name}</span>
                    <span className={isGold ? 'text-[#777]' : 'text-gray-500'}>{user.storageFolder || `users/${user.id}`}</span>
                  </div>
                ))}
              </div>
              <p className={`text-xs mt-4 ${isGold ? 'text-[#777]' : 'text-gray-500'}`}>用户登录或创建时会在服务器 `data/users/{'{userId}'}` 下创建对应文件夹；生成、聊天、上传和导出记录会按用户隔离保存，并可通过 .wujie 文件导入导出。</p>
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
