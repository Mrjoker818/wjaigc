'use client';

import React, { useState, useEffect } from 'react';
import { UniversalApiManager } from '@/lib/universal-api-manager';
import { ApiProvider, PROVIDER_PRESETS, REQUEST_STYLES } from '@/lib/universal-api-types';
import { X, Key, RefreshCw, Plus, Trash2, Eye, EyeOff, Check, AlertCircle, Link2, ChevronDown, ChevronUp, Image, MessageSquare, Settings, Box, Film } from 'lucide-react';
import {
  buildCapabilityEditorModels,
  ModelCapabilityEditor,
  getVisibleAdvancedParams,
  mergeAdvancedParamsWithCapabilities,
} from './dashboard/model-capability-editor';
import type { ProviderCapabilityOverridesV1 } from '@/lib/task-core/model-capability-contract';
import { readProviderCapabilityOverrides } from '@/lib/task-core/model-capability-resolution';

interface ThirdPartyModelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  themeStyle: 'gold' | 'monochrome';
  onProviderAdded?: (provider: ApiProvider) => void;
  onProviderDeleted?: (providerId: string) => void;
  onProviderUpdated?: (provider: ApiProvider) => void;
  /** 打开时默认显示哪个类型 */
  defaultType?: 'image' | 'chat' | '3d' | 'video';
}

export function ThirdPartyModelDialog({
  isOpen,
  onClose,
  themeStyle,
  onProviderAdded,
  onProviderDeleted,
  onProviderUpdated,
  defaultType = 'image',
}: ThirdPartyModelDialogProps) {
  const [manager] = useState(() => UniversalApiManager.getInstance());
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [activeTab, setActiveTab] = useState<'image' | 'chat' | '3d' | 'video'>(defaultType);

  // 添加表单状态
  const [showAddForm, setShowAddForm] = useState(false);
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formIsEnabled, setFormIsEnabled] = useState(true);
  const [formProvider, setFormProvider] = useState('openai');
  const [formApiKey, setFormApiKey] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('https://api.openai.com/v1');
  const [formRequestStyle, setFormRequestStyle] = useState<'chat-completions' | 'images-generations' | 'auto'>('chat-completions');
  // 多选模型
  const [formSelectedModels, setFormSelectedModels] = useState<string[]>([]);
  const [formAdvancedParams, setFormAdvancedParams] = useState<Record<string, string>>({});
  const [formTaskModelCapabilities, setFormTaskModelCapabilities] = useState<ProviderCapabilityOverridesV1>({ version: 1, models: {} });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');

  const isGold = themeStyle === 'gold';

  useEffect(() => {
    if (isOpen) {
      setProviders(manager.getProviders());
      setActiveTab(defaultType);
      resetForm();
    }
  }, [isOpen, defaultType, manager]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscapeKey);
    return () => window.removeEventListener('keydown', handleEscapeKey);
  }, [isOpen, onClose]);

  const resetForm = () => {
    setFormDisplayName('');
    setFormIsEnabled(true);
    setFormProvider('openai');
    setFormApiKey('');
    setFormBaseUrl('https://api.openai.com/v1');
    setFormRequestStyle(activeTab === 'chat' ? 'chat-completions' : 'images-generations');
    setFormSelectedModels([]);
    setFormAdvancedParams({});
    setFormTaskModelCapabilities({ version: 1, models: {} });
    setShowApiKey(false);
    setShowAdvanced(false);
    setDiscoveredModels([]);
    setTestResult(null);
    setEditingProviderId(null);
    setShowAddForm(false);
    setModelSearch('');
  };

  const handleProviderPresetChange = (presetId: string) => {
    setFormProvider(presetId);
    const preset = PROVIDER_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setFormBaseUrl(preset.baseUrl || '');
      if (presetId === 'openai') {
        setFormRequestStyle(activeTab === 'chat' ? 'chat-completions' : 'images-generations');
      } else {
        setFormRequestStyle(activeTab === 'chat' ? 'chat-completions' : 'images-generations');
      }
    }
  };

  const handleDiscoverModels = async () => {
    if (!formApiKey.trim() || !formBaseUrl.trim()) return;
    
    setIsDiscovering(true);
    setDiscoveredModels([]);
    
    try {
      const result = await UniversalApiManager.quickTestConnection(formBaseUrl, formApiKey);
      if (result.success && result.models) {
        setDiscoveredModels(result.models);
      }
    } catch (e) {
      console.error('Model discovery failed:', e);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleTestConnection = async () => {
    if (!formApiKey.trim() || !formBaseUrl.trim()) return;
    
    setIsTesting(true);
    setTestResult(null);
    
    try {
      const result = await UniversalApiManager.quickTestConnection(formBaseUrl, formApiKey);
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, message: '测试失败' });
    } finally {
      setIsTesting(false);
    }
  };

  const toggleModel = (modelId: string) => {
    setFormSelectedModels(prev => 
      prev.includes(modelId) 
        ? prev.filter(m => m !== modelId)
        : [...prev, modelId]
    );
  };

  const selectAllModels = () => {
    setFormSelectedModels(filteredModels.slice());
  };

  const deselectAllModels = () => {
    setFormSelectedModels([]);
  };

  const handleSubmit = () => {
    if (!formDisplayName.trim() || !formApiKey.trim() || !formBaseUrl.trim()) return;

    const primaryModel = formSelectedModels.length > 0 ? formSelectedModels[0] : '';

    if (editingProviderId) {
      const updated = manager.updateProvider(editingProviderId, {
        name: formDisplayName,
        displayName: formDisplayName,
        baseUrl: formBaseUrl,
        apiKey: formApiKey,
        isEnabled: formIsEnabled,
        modelType: activeTab,
        providerPreset: formProvider,
        requestStyle: formRequestStyle,
        selectedModel: primaryModel || undefined,
        selectedModels: formSelectedModels,
        advancedParams: mergeAdvancedParamsWithCapabilities(formAdvancedParams, formTaskModelCapabilities),
        isRelay: formProvider === 'custom',
      });
      if (updated && onProviderUpdated) onProviderUpdated(updated);
    } else {
      const providerKind = activeTab === '3d' ? 'universal' : activeTab;
      const provider = manager.addProvider(
        formDisplayName,
        formBaseUrl,
        formApiKey,
        providerKind,
        {
          displayName: formDisplayName,
          modelType: activeTab,
          providerPreset: formProvider,
          requestStyle: formRequestStyle,
          selectedModel: primaryModel || undefined,
          selectedModels: formSelectedModels,
          advancedParams: mergeAdvancedParamsWithCapabilities(formAdvancedParams, formTaskModelCapabilities),
          isRelay: formProvider === 'custom',
        }
      );
      if (onProviderAdded) onProviderAdded(provider);
    }

    setProviders(manager.getProviders());
    resetForm();
  };

  const handleDelete = (providerId: string) => {
    if (confirm('确定要删除此模型配置吗？')) {
      manager.deleteProvider(providerId);
      setProviders(manager.getProviders());
      if (onProviderDeleted) onProviderDeleted(providerId);
    }
  };

  const handleToggleEnabled = (providerId: string, isEnabled: boolean) => {
    const updated = manager.updateProvider(providerId, { isEnabled });
    setProviders(manager.getProviders());
    if (updated && onProviderUpdated) onProviderUpdated(updated);
  };

  const handleEdit = (provider: ApiProvider) => {
    setEditingProviderId(provider.id);
    setFormDisplayName(provider.displayName || provider.name);
    setFormIsEnabled(provider.isEnabled);
    setFormProvider(provider.providerPreset || 'custom');
    setFormApiKey(provider.apiKey);
    setFormBaseUrl(provider.baseUrl);
    setFormRequestStyle(
      provider.requestStyle === 'custom' 
        ? (provider.modelType === 'chat' ? 'chat-completions' : 'images-generations')
        : (provider.requestStyle || (provider.modelType === 'chat' ? 'chat-completions' : 'images-generations'))
    );
    setFormSelectedModels(provider.selectedModels || (provider.selectedModel ? [provider.selectedModel] : []));
    setFormAdvancedParams(getVisibleAdvancedParams(provider.advancedParams));
    setFormTaskModelCapabilities(readProviderCapabilityOverrides(provider.advancedParams?.taskModelCapabilities));
    setShowAddForm(true);
    setTestResult(null);
    setDiscoveredModels([]);
    setModelSearch('');
  };

  const handleAddParam = () => {
    const key = `param_${Date.now()}`;
    setFormAdvancedParams(prev => ({ ...prev, [key]: '' }));
  };

  const handleRemoveParam = (key: string) => {
    setFormAdvancedParams(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleParamKeyChange = (oldKey: string, newKey: string) => {
    if (newKey.trim() === 'taskModelCapabilities') return;
    setFormAdvancedParams(prev => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (k === oldKey) next[newKey] = v;
        else next[k] = v;
      }
      return next;
    });
  };

  const handleParamValueChange = (key: string, value: string) => {
    setFormAdvancedParams(prev => ({ ...prev, [key]: value }));
  };

  const currentProviders = providers.filter(p => 
    p.modelType === activeTab || p.type === 'universal' || p.type === 'general' || p.modelType === 'general' || p.type === activeTab
  );

  // 按搜索过滤模型
  const filteredModels = modelSearch.trim()
    ? discoveredModels.filter(m => m.toLowerCase().includes(modelSearch.toLowerCase()))
    : discoveredModels;

  if (!isOpen) return null;

  const inputCls = `flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs border outline-none transition-colors ${
    isGold 
      ? 'border-[#2a2a2a] bg-[#1a1a1a] text-white focus:border-[#d4af37] placeholder:text-[#444]' 
      : 'border-gray-200 bg-gray-50 text-gray-900 focus:border-gray-400 placeholder:text-gray-300'
  }`;

  const labelCls = `text-xs w-16 shrink-0 ${isGold ? 'text-[#888]' : 'text-gray-500'}`;

  const sectionTitleCls = `text-xs font-medium uppercase tracking-wider ${isGold ? 'text-[#555]' : 'text-gray-400'}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2" style={{ background: isGold ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)', backdropFilter: 'blur(20px)' }}>
      <div 
        className={`w-full max-w-[340px] max-h-[85vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col ${isGold ? 'bg-[#141414] border border-[#2a2a2a]' : 'bg-white border border-gray-200'}`}
        style={{ minWidth: '280px' }}
      >
        
        {/* Header */}
        <div className={`px-4 py-3 flex items-center justify-between shrink-0 ${isGold ? 'border-b border-[#2a2a2a]' : 'border-b border-gray-100'}`}>
          <h2 className={`text-sm font-semibold ${isGold ? 'text-white' : 'text-gray-900'}`}>
            {showAddForm ? (editingProviderId ? '编辑模型' : '添加') : '第三方模型调用'}
          </h2>
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${isGold ? 'hover:bg-[#1a1a1a] text-[#888]' : 'hover:bg-gray-100 text-gray-400'}`}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {!showAddForm ? (
            <>
              {/* Tab 选择 */}
              <div className="grid grid-cols-2 gap-2 px-4 pt-3 pb-2">
                <button
                  onClick={() => setActiveTab('image')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'image'
                      ? isGold
                        ? 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30'
                        : 'bg-gray-100 text-gray-900 border border-gray-200'
                      : isGold
                        ? 'bg-[#1a1a1a] text-[#666] border border-[#2a2a2a] hover:text-[#999]'
                        : 'bg-gray-50 text-gray-400 border border-gray-100 hover:text-gray-600'
                  }`}
                >
                  <Image className="w-3.5 h-3.5" />
                  图像模型
                </button>
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'chat'
                      ? isGold
                        ? 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30'
                        : 'bg-gray-100 text-gray-900 border border-gray-200'
                      : isGold
                        ? 'bg-[#1a1a1a] text-[#666] border border-[#2a2a2a] hover:text-[#999]'
                        : 'bg-gray-50 text-gray-400 border border-gray-100 hover:text-gray-600'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  文本对话模型
                </button>
                <button
                  onClick={() => setActiveTab('3d')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === '3d'
                      ? isGold
                        ? 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30'
                        : 'bg-gray-100 text-gray-900 border border-gray-200'
                      : isGold
                        ? 'bg-[#1a1a1a] text-[#666] border border-[#2a2a2a] hover:text-[#999]'
                        : 'bg-gray-50 text-gray-400 border border-gray-100 hover:text-gray-600'
                  }`}
                >
                  <Box className="w-3.5 h-3.5" />
                  3D 模型
                </button>
                <button
                  onClick={() => setActiveTab('video')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    activeTab === 'video'
                      ? isGold
                        ? 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30'
                        : 'bg-gray-100 text-gray-900 border border-gray-200'
                      : isGold
                        ? 'text-[#888] hover:text-[#d4af37] hover:bg-[#1a1a1a]'
                        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <Film className="w-3.5 h-3.5" />
                  视频模型
                </button>
              </div>

              {/* 已添加的模型列表 */}
              <div className="px-4 py-2">
                {currentProviders.length > 0 ? (
                  <div className="space-y-2 mb-3">
                    {currentProviders.map(provider => (
                      <div key={provider.id} className={`rounded-xl p-2.5 transition-all ${isGold ? 'bg-[#0f0f0f] border border-[#2a2a2a]' : 'bg-gray-50 border border-gray-100'}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            provider.connectionStatus === 'success' 
                              ? (isGold ? 'bg-green-900/30' : 'bg-green-50')
                              : provider.connectionStatus === 'failed'
                              ? (isGold ? 'bg-red-900/30' : 'bg-red-50')
                              : (isGold ? 'bg-[#1a1a1a]' : 'bg-gray-100')
                          }`}>
                            {activeTab === 'image' ? (
                              <Image className={`w-3.5 h-3.5 ${
                                provider.connectionStatus === 'success' ? 'text-green-400'
                                : provider.connectionStatus === 'failed' ? 'text-red-400'
                                : isGold ? 'text-[#d4af37]' : 'text-gray-500'
                              }`} />
                            ) : activeTab === '3d' ? (
                              <Box className={`w-3.5 h-3.5 ${
                                provider.connectionStatus === 'success' ? 'text-green-400'
                                : provider.connectionStatus === 'failed' ? 'text-red-400'
                                : isGold ? 'text-[#d4af37]' : 'text-gray-500'
                              }`} />
                            ) : activeTab === 'video' ? (
                              <Film className={`w-3.5 h-3.5 ${
                                provider.connectionStatus === 'success' ? 'text-green-400'
                                : provider.connectionStatus === 'failed' ? 'text-red-400'
                                : isGold ? 'text-[#d4af37]' : 'text-gray-500'
                              }`} />
                            ) : (
                              <MessageSquare className={`w-3.5 h-3.5 ${
                                provider.connectionStatus === 'success' ? 'text-green-400'
                                : provider.connectionStatus === 'failed' ? 'text-red-400'
                                : isGold ? 'text-[#d4af37]' : 'text-gray-500'
                              }`} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className={`text-xs font-medium truncate ${isGold ? 'text-white' : 'text-gray-900'}`}>
                                {provider.displayName || provider.name}
                              </p>
                              {provider.isRelay && (
                                <span className={`text-xs px-1 py-0.5 rounded ${isGold ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-50 text-purple-600'}`}>
                                  中转
                                </span>
                              )}
                              <span className={`text-xs px-1 py-0.5 rounded ${
                                provider.isEnabled 
                                  ? (isGold ? 'bg-green-900/30 text-green-400' : 'bg-green-50 text-green-600')
                                  : (isGold ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-600')
                              }`}>
                                {provider.isEnabled ? '启用' : '禁用'}
                              </span>
                            </div>
                            <p className={`text-xs mt-0.5 truncate ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>
                              {(provider.selectedModels && provider.selectedModels.length > 0) 
                                ? `${provider.selectedModels.length}个模型`
                                : provider.selectedModel || provider.name}
                            </p>
                          </div>
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => handleEdit(provider)}
                              className={`p-1 rounded-md ${isGold ? 'text-[#888] hover:bg-[#1a1a1a]' : 'text-gray-400 hover:bg-gray-100'}`}
                              title="编辑">
                              <Settings className="w-3 h-3" />
                            </button>
                            <button onClick={() => handleToggleEnabled(provider.id, !provider.isEnabled)}
                              className={`p-1 rounded-md ${isGold ? 'text-[#888] hover:bg-[#1a1a1a]' : 'text-gray-400 hover:bg-gray-100'}`}
                              title={provider.isEnabled ? '禁用' : '启用'}>
                              {provider.isEnabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                            </button>
                            <button onClick={() => handleDelete(provider.id)}
                              className={`p-1 rounded-md opacity-60 hover:opacity-100 ${isGold ? 'text-red-500 hover:bg-red-900/20' : 'text-red-400 hover:bg-red-50'}`}
                              title="删除">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`flex flex-col items-center justify-center py-8 text-center rounded-xl mb-3 ${isGold ? 'bg-[#0f0f0f] border border-dashed border-[#2a2a2a]' : 'bg-gray-50 border border-dashed border-gray-200'}`}>
                    {activeTab === 'image' ? (
                      <Image className={`w-8 h-8 mb-2 ${isGold ? 'text-[#333]' : 'text-gray-300'}`} />
                    ) : activeTab === '3d' ? (
                      <Box className={`w-8 h-8 mb-2 ${isGold ? 'text-[#333]' : 'text-gray-300'}`} />
                    ) : activeTab === 'video' ? (
                      <Film className={`w-8 h-8 mb-2 ${isGold ? 'text-[#333]' : 'text-gray-300'}`} />
                    ) : (
                      <MessageSquare className={`w-8 h-8 mb-2 ${isGold ? 'text-[#333]' : 'text-gray-300'}`} />
                    )}
                    <p className={`text-xs font-medium ${isGold ? 'text-[#666]' : 'text-gray-400'}`}>
                      还没有{activeTab === 'image' ? '图像' : activeTab === '3d' ? '3D' : activeTab === 'video' ? '视频' : '对话'}模型
                    </p>
                    <p className={`text-xs mt-1 ${isGold ? 'text-[#444]' : 'text-gray-300'}`}>
                      点击下方按钮添加第三方模型
                    </p>
                  </div>
                )}
              </div>

              {/* 添加按钮 */}
              <div className="px-4 pb-4">
                <button
                  onClick={() => { resetForm(); setShowAddForm(true); setFormRequestStyle(activeTab === 'chat' ? 'chat-completions' : 'images-generations'); }}
                  className={`w-full py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                    isGold ? 'bg-gradient-to-r from-[#d4af37] to-[#daa520] text-black hover:from-[#daa520] hover:to-[#d4af37]' : 'bg-gray-900 text-white hover:bg-gray-800'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加{activeTab === 'image' ? '图像' : activeTab === '3d' ? '3D' : activeTab === 'video' ? '视频' : '对话'}模型
                </button>
              </div>
            </>
          ) : (
            /* ============ 添加/编辑表单 ============ */
            <div className="px-4 py-3 space-y-3">
              {/* 基础配置 */}
              <div className="space-y-2">
                <p className={sectionTitleCls}>基础配置</p>
                
                {/* 显示名称 */}
                <div className="flex items-center gap-2">
                  <label className={labelCls}>显示名称</label>
                  <input
                    type="text"
                    value={formDisplayName}
                    onChange={(e) => setFormDisplayName(e.target.value)}
                    placeholder="请输入显示名称"
                    className={inputCls}
                  />
                </div>

                {/* 启用状态 */}
                <div className="flex items-center gap-2">
                  <label className={labelCls}>启用状态</label>
                  <button
                    type="button"
                    onClick={() => setFormIsEnabled(!formIsEnabled)}
                    className={`relative w-9 h-[18px] rounded-full transition-colors ${formIsEnabled ? (isGold ? 'bg-[#d4af37]' : 'bg-gray-700') : (isGold ? 'bg-[#2a2a2a]' : 'bg-gray-300')}`}
                  >
                    <span className={`absolute top-[1px] left-[1px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${formIsEnabled ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>

              {/* 提供商配置 */}
              <div className="space-y-2">
                <p className={sectionTitleCls}>提供商配置</p>
                
                {/* 提供商选择 */}
                <div className="flex items-center gap-2">
                  <label className={labelCls}>提供商</label>
                  <select
                    value={formProvider}
                    onChange={(e) => handleProviderPresetChange(e.target.value)}
                    className={inputCls}
                  >
                    {PROVIDER_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>{preset.name}</option>
                    ))}
                  </select>
                </div>

                {/* 提供商说明 */}
                {(() => {
                  const preset = PROVIDER_PRESETS.find(p => p.id === formProvider);
                  if (!preset?.description) return null;
                  return (
                    <p className={`text-xs leading-relaxed pl-[72px] ${isGold ? 'text-[#444]' : 'text-gray-400'}`}>
                      {preset.description}
                    </p>
                  );
                })()}

                {/* API密钥 */}
                <div className="flex items-center gap-2">
                  <label className={`${labelCls} flex items-center gap-1`}>
                    <Key className="w-2.5 h-2.5" />
                    API密钥
                  </label>
                  <div className="flex-1 relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={formApiKey}
                      onChange={(e) => setFormApiKey(e.target.value)}
                      placeholder="输入API密钥"
                      className={`w-full min-w-0 px-2.5 py-1.5 pr-8 rounded-lg text-xs border font-mono outline-none transition-colors ${isGold ? 'border-[#2a2a2a] bg-[#1a1a1a] text-white focus:border-[#d4af37]' : 'border-gray-200 bg-gray-50 text-gray-900'} placeholder:text-[#444]'}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded ${isGold ? 'text-[#666] hover:text-[#999]' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      {showApiKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                {/* API地址 */}
                <div className="flex items-center gap-2">
                  <label className={`${labelCls} flex items-center gap-1`}>
                    <Link2 className="w-2.5 h-2.5" />
                    API地址
                  </label>
                  <input
                    type="text"
                    value={formBaseUrl}
                    onChange={(e) => setFormBaseUrl(e.target.value)}
                    placeholder="https://api.example.com"
                    className={inputCls}
                  />
                </div>

                {/* 请求风格 */}
                <div className="flex items-center gap-2">
                  <label className={labelCls}>请求风格</label>
                  <select
                    value={formRequestStyle}
                    onChange={(e) => setFormRequestStyle(e.target.value as 'chat-completions' | 'images-generations')}
                    className={inputCls}
                  >
                    {REQUEST_STYLES.map(style => (
                      <option key={style.id} value={style.id}>{style.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 模型配置 - 多选 */}
              <div className="space-y-2">
                <p className={sectionTitleCls}>模型配置</p>
                
                {/* 模型搜索 + 刷新 */}
                <div className="flex items-center gap-2">
                  <label className={labelCls}>选择模型</label>
                  <div className="flex-1 flex gap-1.5 min-w-0">
                    <input
                      type="text"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder="搜索或手动输入模型ID"
                      className={inputCls}
                    />
                    <button
                      onClick={handleDiscoverModels}
                      disabled={isDiscovering || !formApiKey.trim() || !formBaseUrl.trim()}
                      className={`px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 transition-all shrink-0 ${
                        isDiscovering || !formApiKey.trim() || !formBaseUrl.trim()
                          ? 'opacity-50 cursor-not-allowed'
                          : isGold
                            ? 'bg-[#1a1a1a] text-[#d4af37] border border-[#2a2a2a] hover:border-[#d4af37]'
                            : 'bg-gray-100 text-gray-700 border border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      <RefreshCw className={`w-3 h-3 ${isDiscovering ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* 已选模型标签 */}
                {formSelectedModels.length > 0 && (
                  <div className="pl-[72px]">
                    <div className="flex items-center gap-1 flex-wrap">
                      {formSelectedModels.map(modelId => (
                        <span key={modelId} className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-md ${
                          isGold ? 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/20' : 'bg-gray-100 text-gray-700 border border-gray-200'
                        }`}>
                          <span className="truncate max-w-[100px]">{modelId}</span>
                          <button 
                            onClick={() => toggleModel(modelId)}
                            className={`shrink-0 ${isGold ? 'hover:text-white' : 'hover:text-gray-900'}`}
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      ))}
                      <span className={`text-xs ${isGold ? 'text-[#444]' : 'text-gray-400'}`}>
                        已选 {formSelectedModels.length} 个
                      </span>
                    </div>
                  </div>
                )}

                {/* 模型多选列表 */}
                {discoveredModels.length > 0 && (
                  <div className={`ml-[72px] rounded-lg border overflow-hidden ${isGold ? 'bg-[#0a0a0a] border-[#2a2a2a]' : 'bg-gray-50 border-gray-100'}`}>
                    {/* 列表头：全选/取消 */}
                    <div className={`flex items-center justify-between px-2 py-1.5 border-b ${isGold ? 'border-[#1a1a1a]' : 'border-gray-100'}`}>
                      <span className={`text-xs ${isGold ? 'text-[#555]' : 'text-gray-400'}`}>
                        发现 {discoveredModels.length} 个模型
                      </span>
                      <div className="flex items-center gap-2">
                        <button onClick={selectAllModels} className={`text-xs ${isGold ? 'text-[#d4af37] hover:text-[#daa520]' : 'text-blue-500 hover:text-blue-600'}`}>
                          全选
                        </button>
                        <button onClick={deselectAllModels} className={`text-xs ${isGold ? 'text-[#888] hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}>
                          清空
                        </button>
                      </div>
                    </div>
                    {/* 模型列表 */}
                    <div className="max-h-36 overflow-y-auto overflow-x-hidden">
                      {filteredModels.length > 0 ? filteredModels.map(modelId => {
                        const isSelected = formSelectedModels.includes(modelId);
                        return (
                          <div
                            key={modelId}
                            onClick={() => toggleModel(modelId)}
                            className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
                              isSelected 
                                ? (isGold ? 'bg-[#d4af37]/8' : 'bg-blue-50/50')
                                : (isGold ? 'hover:bg-[#111]' : 'hover:bg-gray-100/50')
                            }`}
                          >
                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-all ${
                              isSelected
                                ? (isGold ? 'bg-[#d4af37] border-[#d4af37]' : 'bg-blue-500 border-blue-500')
                                : (isGold ? 'border-[#333]' : 'border-gray-300')
                            }`}>
                              {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <span className={`text-xs truncate ${isSelected ? (isGold ? 'text-[#d4af37]' : 'text-blue-600') : (isGold ? 'text-[#aaa]' : 'text-gray-600')}`}>
                              {modelId}
                            </span>
                          </div>
                        );
                      }) : (
                        <div className={`px-2 py-4 text-center text-xs ${isGold ? 'text-[#444]' : 'text-gray-400'}`}>
                          没有匹配的模型
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 手动添加模型 */}
                {modelSearch.trim() && !discoveredModels.includes(modelSearch.trim()) && (
                  <div className="pl-[72px]">
                    <button
                      onClick={() => {
                        const trimmed = modelSearch.trim();
                        if (trimmed && !formSelectedModels.includes(trimmed)) {
                          setFormSelectedModels(prev => [...prev, trimmed]);
                        }
                        setModelSearch('');
                      }}
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md ${
                        isGold ? 'text-[#d4af37] bg-[#d4af37]/10 border border-[#d4af37]/20 hover:bg-[#d4af37]/20' 
                               : 'text-blue-500 bg-blue-50 border border-blue-200 hover:bg-blue-100'
                      }`}
                    >
                      <Plus className="w-2.5 h-2.5" />
                      添加 &ldquo;{modelSearch.trim()}&rdquo;
                    </button>
                  </div>
                )}
              </div>

              <ModelCapabilityEditor
                models={buildCapabilityEditorModels(
                  [],
                  formSelectedModels,
                  editingProviderId || 'new-provider',
                  activeTab,
                )}
                value={formTaskModelCapabilities}
                onChange={setFormTaskModelCapabilities}
              />

              {/* 高级参数 */}
              <div className="space-y-2">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className={`w-full flex items-center justify-between text-xs font-medium ${isGold ? 'text-[#555]' : 'text-gray-400'}`}
                >
                  <span className="flex items-center gap-1">
                    <Settings className="w-3 h-3" />
                    高级参数
                    <span className={`text-xs ${isGold ? 'text-[#333]' : 'text-gray-300'}`}>
                      ({Object.keys(formAdvancedParams).length})
                    </span>
                  </span>
                  {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showAdvanced && (
                  <div className={`space-y-1.5 p-2 rounded-lg ${isGold ? 'bg-[#0a0a0a] border border-[#2a2a2a]' : 'bg-gray-50 border border-gray-100'}`}>
                    {Object.entries(formAdvancedParams).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={key}
                          onChange={(e) => handleParamKeyChange(key, e.target.value)}
                          placeholder="参数名"
                          className={`w-[35%] px-2 py-1 rounded-md text-xs border outline-none ${isGold ? 'border-[#2a2a2a] bg-[#1a1a1a] text-white' : 'border-gray-200 bg-white text-gray-900'}`}
                        />
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => handleParamValueChange(key, e.target.value)}
                          placeholder="参数值"
                          className={`flex-1 min-w-0 px-2 py-1 rounded-md text-xs border outline-none ${isGold ? 'border-[#2a2a2a] bg-[#1a1a1a] text-white' : 'border-gray-200 bg-white text-gray-900'}`}
                        />
                        <button
                          onClick={() => handleRemoveParam(key)}
                          className={`p-0.5 rounded-md shrink-0 ${isGold ? 'text-red-500/60 hover:bg-red-900/20' : 'text-red-300 hover:bg-red-50'}`}
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={handleAddParam}
                      className={`flex items-center gap-1 text-xs ${isGold ? 'text-[#d4af37] hover:text-[#daa520]' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <Plus className="w-2.5 h-2.5" />
                      添加参数
                    </button>
                  </div>
                )}
              </div>

              {/* 测试连接结果 */}
              {testResult && (
                <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                  testResult.success 
                    ? (isGold ? 'bg-green-900/20 text-green-400 border border-green-900/30' : 'bg-green-50 text-green-600 border border-green-100')
                    : (isGold ? 'bg-red-900/20 text-red-400 border border-red-900/30' : 'bg-red-50 text-red-600 border border-red-100')
                }`}>
                  {testResult.success ? <Check className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                  {testResult.message}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-4 py-2.5 flex items-center justify-between shrink-0 ${isGold ? 'border-t border-[#2a2a2a] bg-[#0f0f0f]' : 'border-t border-gray-100 bg-gray-50'}`}>
          {showAddForm ? (
            <>
              <button
                onClick={handleTestConnection}
                disabled={isTesting || !formApiKey.trim() || !formBaseUrl.trim()}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isTesting || !formApiKey.trim() || !formBaseUrl.trim()
                    ? 'opacity-50 cursor-not-allowed'
                    : isGold
                      ? 'bg-[#1a1a1a] text-[#d4af37] border border-[#2a2a2a] hover:border-[#d4af37]'
                      : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-400'
                }`}
              >
                {isTesting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                测试连接
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={resetForm}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${isGold ? 'bg-[#1a1a1a] text-[#888] border border-[#2a2a2a] hover:text-white' : 'bg-white text-gray-500 border border-gray-200 hover:text-gray-900'}`}
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!formDisplayName.trim() || !formApiKey.trim() || !formBaseUrl.trim() || formSelectedModels.length === 0}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    !formDisplayName.trim() || !formApiKey.trim() || !formBaseUrl.trim() || formSelectedModels.length === 0
                      ? 'opacity-50 cursor-not-allowed'
                      : isGold
                        ? 'bg-gradient-to-r from-[#d4af37] to-[#daa520] text-black'
                        : 'bg-gray-900 text-white'
                  }`}
                >
                  {formSelectedModels.length === 0 && formDisplayName.trim() && formApiKey.trim() && formBaseUrl.trim()
                    ? '请选择模型'
                    : editingProviderId ? '保存' : '创建'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div />
              <button
                onClick={onClose}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${isGold ? 'bg-[#1a1a1a] text-[#888] border border-[#2a2a2a] hover:text-white' : 'bg-white text-gray-500 border border-gray-200 hover:text-gray-900'}`}
              >
                关闭
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
