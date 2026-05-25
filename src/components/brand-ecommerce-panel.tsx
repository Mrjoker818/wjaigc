'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ShoppingBag, Upload, Sparkles, Loader2, Check, ChevronDown, Image as ImageIcon, Palette, RefreshCw, Settings } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────

interface EcomTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  promptTemplate: string;
  negativePrompt: string;
  aspectRatio: string;
  category: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyPreview: string;
}

interface ImageModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  providerApiKeyPreview: string;
}

interface GenerateResult {
  templateId: string;
  templateName: string;
  imageUrl?: string;
  error?: string;
}

interface Props {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[]) => void;
  referenceImageUrl?: string;
}

// ─── Component ────────────────────────────────────────────────────

export function BrandEcommercePanel({ isMonochrome = false, onClose, onAddImages, referenceImageUrl }: Props) {
  // Theme
  const bg = isMonochrome ? 'bg-white' : 'bg-[#1a1a1a]';
  const bgDeep = isMonochrome ? 'bg-gray-50' : 'bg-[#141414]';
  const border = isMonochrome ? 'border-gray-200' : 'border-white/[0.08]';
  const borderLight = isMonochrome ? 'border-gray-100' : 'border-white/[0.05]';
  const text = isMonochrome ? 'text-gray-900' : 'text-gray-100';
  const textSub = isMonochrome ? 'text-gray-500' : 'text-gray-400';
  const textMuted = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const accent = isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]';
  const accentHover = isMonochrome ? 'hover:bg-blue-600' : 'hover:bg-[#e0b840]';
  const accentText = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';
  const inputBg = isMonochrome ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-white/[0.08]';
  const inputFocus = isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30';

  // State
  const [templates, setTemplates] = useState<EcomTemplate[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<ImageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [productDesc, setProductDesc] = useState('');
  const [styleExtra, setStyleExtra] = useState('');
  const [sceneDesc, setSceneDesc] = useState('modern minimalist interior');
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [colorInput, setColorInput] = useState('');
  const [refImage, setRefImage] = useState(referenceImageUrl || '');
  const [refImageFile, setRefImageFile] = useState<File | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [results, setResults] = useState<GenerateResult[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'template' | 'settings' | 'results'>('template');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // ─── Load templates ───────────────────────────────────────────

  useEffect(() => {
    fetch('/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'templates' }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setTemplates(data.templates);
          // Default select: white-bg + scene-lifestyle
          setSelectedTemplates(new Set(['white-bg', 'scene-lifestyle']));
        }
      })
      .catch(() => {});
  }, []);

  // ─── Load models from admin API ──────────────────────────────

  useEffect(() => {
    fetch('/api/models?type=image')
      .then(r => r.json())
      .then(data => {
        const providers: ProviderInfo[] = data.providers || [];
        const providerMap = new Map(providers.map((p: ProviderInfo) => [p.id, p]));
        const modelList = data.models || [];
        if (modelList.length) {
          const mapped = modelList.map((m: { id: string; name: string; providerId?: string }) => {
            const prov = providerMap.get(m.providerId || '');
            return {
              id: m.id,
              name: m.name,
              providerId: m.providerId || '',
              providerName: prov?.name || '',
              providerBaseUrl: prov?.baseUrl || '',
              providerApiKeyPreview: prov?.apiKeyPreview || '',
            };
          });
          setModels(mapped);
          const saved = localStorage.getItem('wujie_selected_model');
          if (saved && mapped.some((m: ImageModel) => m.id === saved)) {
            setSelectedModel(saved);
          } else if (mapped.length) {
            setSelectedModel(mapped[0].id);
          }
        }
      })
      .catch(() => {});
  }, []);

  // ─── Close model dropdown on outside click ───────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Upload reference image ──────────────────────────────────

  const handleFileUpload = useCallback(async (file: File) => {
    setRefImageFile(file);
    const formData = new FormData();
    formData.append('image', file);
    try {
      const resp = await fetch('/api/save-image', { method: 'POST', body: formData });
      const data = await resp.json();
      if (data.url) {
        setRefImage(data.url);
      }
    } catch {
      // Fallback to local blob
      const blob = URL.createObjectURL(file);
      setRefImage(blob);
    }
  }, []);

  // ─── Toggle template ─────────────────────────────────────────

  const toggleTemplate = useCallback((id: string) => {
    setSelectedTemplates(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Add brand color ─────────────────────────────────────────

  const addBrandColor = useCallback(() => {
    const c = colorInput.trim();
    if (c && !brandColors.includes(c) && brandColors.length < 5) {
      setBrandColors(prev => [...prev, c]);
      setColorInput('');
    }
  }, [colorInput, brandColors]);

  const removeBrandColor = useCallback((c: string) => {
    setBrandColors(prev => prev.filter(x => x !== c));
  }, []);

  // ─── Generate ────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!selectedTemplates.size || !productDesc.trim()) return;
    if (!selectedModel) {
      setActiveTab('settings');
      return;
    }
    setIsGenerating(true);
    setResults([]);
    setProgress(0);
    setActiveTab('results');

    try {
      const resp = await fetch('/api/brand-ecommerce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          templateIds: Array.from(selectedTemplates),
          productDesc: productDesc.trim(),
          styleExtra: styleExtra.trim(),
          sceneDesc: sceneDesc.trim(),
          model: selectedModel,
          referenceImageUrl: refImage,
          brandColors,
        }),
      });
      const data = await resp.json();
      if (data.error) {
        setResults([{ templateId: 'error', templateName: '生成失败', error: data.error }]);
        setIsGenerating(false);
        return;
      }
      if (data.taskId) {
        setTaskId(data.taskId);
        // Start polling
        const poll = async () => {
          try {
            const pollResp = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: data.taskId }),
            });
            const pollData = await pollResp.json();
            if (pollData.status === 'completed' && pollData.result?.results) {
              setResults(pollData.result.results);
              setIsGenerating(false);
              setTaskId(null);
              return;
            }
            if (pollData.status === 'failed' || pollData.status === 'cancelled') {
              setResults([{ templateId: 'error', templateName: '生成失败', error: pollData.error || '任务失败' }]);
              setIsGenerating(false);
              setTaskId(null);
              return;
            }
            if (pollData.progress !== undefined) {
              setProgress(pollData.progress);
            }
            if (pollData.label) {
              setProgressLabel(pollData.label);
            }
            // Continue polling
            setTimeout(poll, 2000);
          } catch {
            setTimeout(poll, 3000);
          }
        };
        setTimeout(poll, 2000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '网络错误';
      setResults([{ templateId: 'error', templateName: '生成失败', error: msg }]);
      setIsGenerating(false);
    }
  }, [selectedTemplates, productDesc, styleExtra, sceneDesc, selectedModel, refImage, brandColors]);

  // ─── Add result images to canvas ─────────────────────────────

  const handleAddToCanvas = useCallback(() => {
    const urls = results.filter(r => r.imageUrl).map(r => r.imageUrl!);
    if (urls.length && onAddImages) {
      onAddImages(urls);
    }
  }, [results, onAddImages]);

  // ─── Cancel ──────────────────────────────────────────────────

  const handleCancel = useCallback(async () => {
    if (taskId) {
      try {
        await fetch('/api/cancel-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
      } catch { /* ignore */ }
      setTaskId(null);
    }
    setIsGenerating(false);
  }, [taskId]);

  // ─── Category labels ─────────────────────────────────────────

  const categoryLabel: Record<string, string> = {
    product: '白底主图',
    scene: '场景氛围',
    model: '模特展示',
    detail: '详情组合',
    promo: '促销海报',
    social: '社交媒体',
    creative: '创意合成',
    brand: '品牌故事',
    tech: '科技数码',
  };

  const categoryAccent: Record<string, string> = {
    product: isMonochrome ? 'border-blue-300 bg-blue-50' : 'border-[#4a9eff]/30 bg-[#4a9eff]/10',
    scene: isMonochrome ? 'border-emerald-300 bg-emerald-50' : 'border-[#34d399]/30 bg-[#34d399]/10',
    model: isMonochrome ? 'border-pink-300 bg-pink-50' : 'border-[#f472b6]/30 bg-[#f472b6]/10',
    detail: isMonochrome ? 'border-violet-300 bg-violet-50' : 'border-[#a78bfa]/30 bg-[#a78bfa]/10',
    promo: isMonochrome ? 'border-amber-300 bg-amber-50' : 'border-[#fbbf24]/30 bg-[#fbbf24]/10',
    social: isMonochrome ? 'border-rose-300 bg-rose-50' : 'border-[#fb7185]/30 bg-[#fb7185]/10',
    creative: isMonochrome ? 'border-orange-300 bg-orange-50' : 'border-[#fb923c]/30 bg-[#fb923c]/10',
    brand: isMonochrome ? 'border-sky-300 bg-sky-50' : 'border-[#38bdf8]/30 bg-[#38bdf8]/10',
    tech: isMonochrome ? 'border-cyan-300 bg-cyan-50' : 'border-[#22d3ee]/30 bg-[#22d3ee]/10',
  };

  // ─── Aspect ratio visual ─────────────────────────────────────

  const aspectVisual = (ar: string) => {
    const [w, h] = ar.split(':').map(Number);
    const maxDim = 16;
    const scale = maxDim / Math.max(w, h);
    const vw = Math.round(w * scale);
    const vh = Math.round(h * scale);
    return { width: vw, height: vh };
  };

  // ─── Success results count ───────────────────────────────────

  const successResults = results.filter(r => r.imageUrl);
  const errorResults = results.filter(r => r.error);

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className={`relative w-[680px] max-h-[85vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
          isMonochrome
            ? 'bg-white border-gray-200 shadow-gray-300/30'
            : 'bg-gradient-to-b from-[#1c1c1c] to-[#141414] border-white/[0.1] shadow-black/60'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className={`flex items-center justify-between px-5 py-3.5 border-b ${border}`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isMonochrome ? 'bg-blue-100' : 'bg-[#d4af37]/15'
            }`}>
              <ShoppingBag size={16} className={accentText} />
            </div>
            <div>
              <h2 className={`text-sm font-semibold ${text}`}>品牌电商</h2>
              <p className={`text-xs ${textMuted}`}>JSON 模板批量生成商品图</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-[#555] hover:text-white hover:bg-[#2a2a2a]'
            }`}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div className={`flex items-center gap-1 px-5 pt-3 pb-0`}>
          {(['template', 'settings', 'results'] as const).map(tab => {
            const labels = { template: '模板选择', settings: '生成设置', results: `生成结果${successResults.length ? ` (${successResults.length})` : ''}` };
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3.5 py-2 text-xs font-medium rounded-t-lg transition-colors ${
                  active
                    ? isMonochrome ? 'bg-gray-50 text-blue-600 border border-b-0 border-gray-200' : 'bg-[#111] text-[#d4af37] border border-b-0 border-white/[0.08]'
                    : isMonochrome ? 'text-gray-400 hover:text-gray-600' : 'text-[#666] hover:text-[#999]'
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* ── Content ── */}
        <div className={`flex-1 overflow-y-auto px-5 py-4 ${bgDeep}`}>

          {/* ── Tab: Template Selection ── */}
          {activeTab === 'template' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <p className={`text-xs ${textSub}`}>选择需要生成的商品图类型（可多选）</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedTemplates(new Set(templates.map(t => t.id)))}
                    className={`text-xs ${accentText} hover:underline`}
                  >全选</button>
                  <button
                    onClick={() => setSelectedTemplates(new Set())}
                    className={`text-xs ${textMuted} hover:underline`}
                  >清空</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {templates.map(tpl => {
                  const selected = selectedTemplates.has(tpl.id);
                  const catColor = categoryAccent[tpl.category] || categoryAccent.product;
                  const vis = aspectVisual(tpl.aspectRatio);
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => toggleTemplate(tpl.id)}
                      className={`relative text-left p-3.5 rounded-xl border transition-all duration-200 ${
                        selected
                          ? `${catColor} border-current/30`
                          : isMonochrome ? 'bg-white border-gray-200 hover:border-gray-300' : 'bg-[#1a1a1a] border-white/[0.05] hover:border-white/[0.12]'
                      }`}
                    >
                      {/* Check mark */}
                      {selected && (
                        <div className={`absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center ${accent}`}>
                          <Check size={12} className={isMonochrome ? 'text-white' : 'text-black'} />
                        </div>
                      )}
                      <div className="flex items-start gap-3">
                        <span className="text-lg leading-none mt-0.5">{tpl.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-semibold ${text}`}>{tpl.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${catColor}`}>
                              {categoryLabel[tpl.category]}
                            </span>
                          </div>
                          <p className={`text-[11px] ${textMuted} leading-relaxed`}>{tpl.description}</p>
                          <div className="flex items-center gap-2 mt-2">
                            {/* Aspect ratio visual */}
                            <div className={`flex items-center gap-1.5`}>
                              <div
                                className={`rounded-sm border ${isMonochrome ? 'border-gray-300' : 'border-white/20'}`}
                                style={{ width: vis.width, height: vis.height, backgroundColor: isMonochrome ? '#e5e7eb' : '#333' }}
                              />
                              <span className={`text-[10px] font-mono ${textMuted}`}>{tpl.aspectRatio}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Tab: Settings ── */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* Model selection */}
              <div>
                <label className={`block text-xs font-medium ${textSub} mb-1.5`}>生成模型 <span className="text-red-400">*</span></label>
                <div className="relative" ref={modelDropdownRef}>
                  <button
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm ${inputBg} ${text} transition-colors ${inputFocus} focus:outline-none focus:ring-2`}
                  >
                    <span className="truncate">
                      {selectedModel
                        ? (models.find(m => m.id === selectedModel)?.name || selectedModel)
                        : '选择模型...'}
                    </span>
                    <ChevronDown size={14} className={textMuted} />
                  </button>
                  {showModelDropdown && (
                    <div className={`absolute z-50 top-full mt-1 w-full rounded-lg border shadow-xl max-h-64 overflow-y-auto ${
                      isMonochrome ? 'bg-white border-gray-200' : 'bg-[#222] border-white/[0.1]'
                    }`}>
                      {models.length ? models.map(m => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setSelectedModel(m.id);
                            setShowModelDropdown(false);
                            localStorage.setItem('wujie_selected_model', m.id);
                          }}
                          className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                            m.id === selectedModel
                              ? isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/10 text-[#d4af37]'
                              : isMonochrome ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-[#2a2a2a]'
                          }`}
                        >
                          <div className="font-medium">{m.name}</div>
                          <div className={`text-[10px] mt-0.5 ${textMuted}`}>
                            {m.providerName && <span className="mr-1.5">{m.providerName}</span>}
                            {m.providerBaseUrl && <span className="font-mono opacity-60">{m.providerBaseUrl.replace(/^https?:\/\//, '')}</span>}
                          </div>
                          {m.providerApiKeyPreview && (
                            <div className={`text-[10px] font-mono ${textMuted} opacity-50`}>Key: {m.providerApiKeyPreview}</div>
                          )}
                        </button>
                      )) : (
                        <div className={`px-3 py-4 text-center text-sm ${textMuted}`}>
                          暂无可用模型，请在管理员后台配置图像模型
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Product description */}
              <div>
                <label className={`block text-xs font-medium ${textSub} mb-1.5`}>商品描述 <span className="text-red-400">*</span></label>
                <textarea
                  value={productDesc}
                  onChange={e => setProductDesc(e.target.value)}
                  placeholder="描述你的商品，如：高端无线降噪耳机，磨砂黑色，金属质感..."
                  rows={3}
                  className={`w-full px-3 py-2.5 rounded-lg border text-sm ${inputBg} ${text} ${inputFocus} focus:outline-none focus:ring-2 resize-none placeholder:${isMonochrome ? 'text-gray-400' : 'text-gray-600'}`}
                />
              </div>

              {/* Scene description */}
              <div>
                <label className={`block text-xs font-medium ${textSub} mb-1.5`}>场景描述</label>
                <input
                  type="text"
                  value={sceneDesc}
                  onChange={e => setSceneDesc(e.target.value)}
                  placeholder="场景图使用的环境描述，如：现代简约客厅、清新花园..."
                  className={`w-full px-3 py-2.5 rounded-lg border text-sm ${inputBg} ${text} ${inputFocus} focus:outline-none focus:ring-2`}
                />
              </div>

              {/* Style extra */}
              <div>
                <label className={`block text-xs font-medium ${textSub} mb-1.5`}>风格补充</label>
                <input
                  type="text"
                  value={styleExtra}
                  onChange={e => setStyleExtra(e.target.value)}
                  placeholder="额外的风格关键词，如：高级感、奢华、清新自然..."
                  className={`w-full px-3 py-2.5 rounded-lg border text-sm ${inputBg} ${text} ${inputFocus} focus:outline-none focus:ring-2`}
                />
              </div>

              {/* Brand colors */}
              <div>
                <label className={`block text-xs font-medium ${textSub} mb-1.5`}>
                  <Palette size={12} className="inline mr-1" />品牌色 (最多5个)
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {brandColors.map(c => (
                    <div key={c} className="flex items-center gap-1.5 group">
                      <div className="w-6 h-6 rounded-md border border-white/10" style={{ backgroundColor: c }} />
                      <span className={`text-[11px] font-mono ${textSub}`}>{c}</span>
                      <button
                        onClick={() => removeBrandColor(c)}
                        className={`opacity-0 group-hover:opacity-100 text-[10px] ${textMuted} hover:text-red-400 transition-opacity`}
                      >✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={colorInput || '#000000'}
                    onChange={e => setColorInput(e.target.value)}
                    className="w-9 h-9 rounded-lg border cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={colorInput}
                    onChange={e => setColorInput(e.target.value)}
                    placeholder="#HEX 或颜色名"
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm ${inputBg} ${text} ${inputFocus} focus:outline-none focus:ring-2`}
                    onKeyDown={e => { if (e.key === 'Enter') addBrandColor(); }}
                  />
                  <button
                    onClick={addBrandColor}
                    className={`px-3 py-2 rounded-lg text-xs font-medium ${accent} ${accentHover} ${isMonochrome ? 'text-white' : 'text-black'} transition-colors`}
                  >添加</button>
                </div>
              </div>

              {/* Reference image upload */}
              <div>
                <label className={`block text-xs font-medium ${textSub} mb-1.5`}>参考图 (可选)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }}
                />
                {refImage ? (
                  <div className={`relative rounded-lg overflow-hidden border ${border} group`}>
                    <img src={refImage} alt="参考图" className="w-full h-32 object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium ${accent} ${isMonochrome ? 'text-white' : 'text-black'}`}
                      >更换</button>
                      <button
                        onClick={() => { setRefImage(''); setRefImageFile(null); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white"
                      >移除</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={`w-full h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition-colors ${
                      isMonochrome ? 'border-gray-300 hover:border-gray-400 text-gray-400' : 'border-white/[0.08] hover:border-white/[0.15] text-gray-500'
                    }`}
                  >
                    <Upload size={18} />
                    <span className="text-xs">点击上传商品参考图</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Tab: Results ── */}
          {activeTab === 'results' && (
            <div className="space-y-3">
              {/* Progress */}
              {isGenerating && (
                <div className={`rounded-xl border ${border} p-4`}>
                  <div className="flex items-center gap-3 mb-3">
                    <Loader2 size={18} className={`animate-spin ${accentText}`} />
                    <div className="flex-1">
                      <p className={`text-xs font-medium ${text}`}>{progressLabel || '正在生成...'}</p>
                      <p className={`text-[11px] ${textMuted}`}>已选择 {selectedTemplates.size} 个模板</p>
                    </div>
                    <button
                      onClick={handleCancel}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${isMonochrome ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-[#2a2a2a] text-gray-300 hover:bg-[#333]'}`}
                    >取消</button>
                  </div>
                  <div className={`w-full h-1.5 rounded-full overflow-hidden ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${progress}%`, background: isMonochrome ? '#3b82f6' : 'linear-gradient(90deg, #d4af37, #f0d060, #d4af37)' }}
                    />
                  </div>
                </div>
              )}

              {/* Results grid */}
              {results.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {results.map((r, i) => (
                    <div key={i} className={`rounded-xl border overflow-hidden ${border}`}>
                      {r.imageUrl ? (
                        <div className="relative group">
                          <img src={r.imageUrl} alt={r.templateName} className="w-full aspect-square object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      ) : (
                        <div className={`w-full aspect-square flex items-center justify-center ${isMonochrome ? 'bg-gray-100' : 'bg-[#222]'}`}>
                          <div className="text-center px-3">
                            <X size={20} className="text-red-400 mx-auto mb-1" />
                            <p className="text-[10px] text-red-400">{r.error?.slice(0, 50) || '生成失败'}</p>
                          </div>
                        </div>
                      )}
                      <div className={`px-3 py-2 ${isMonochrome ? 'bg-gray-50' : 'bg-[#1a1a1a]'}`}>
                        <p className={`text-xs font-medium ${text}`}>{r.templateName}</p>
                        {r.error && <p className="text-[10px] text-red-400 truncate">{r.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {!isGenerating && results.length === 0 && (
                <div className={`text-center py-12 ${textMuted}`}>
                  <ImageIcon size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">尚未生成结果</p>
                  <p className="text-xs mt-1">选择模板并配置参数后，点击生成按钮</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className={`flex items-center justify-between px-5 py-3.5 border-t ${border} ${bg}`}>
          <div className="flex items-center gap-2">
            {selectedTemplates.size > 0 && (
              <span className={`text-xs ${textSub}`}>
                已选 <span className={accentText}>{selectedTemplates.size}</span> 个模板
              </span>
            )}
            {successResults.length > 0 && (
              <button
                onClick={handleAddToCanvas}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${accent} ${isMonochrome ? 'text-white' : 'text-black'} ${accentHover} transition-colors`}
              >
                <Sparkles size={12} />
                添加到画布 ({successResults.length})
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-lg text-xs font-medium ${isMonochrome ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 hover:bg-[#2a2a2a]'} transition-colors`}
            >关闭</button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !selectedTemplates.size || !productDesc.trim() || !selectedModel}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold transition-all ${
                isGenerating || !selectedTemplates.size || !productDesc.trim() || !selectedModel
                  ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-[#555] cursor-not-allowed'
                  : `${accent} ${isMonochrome ? 'text-white' : 'text-black'} ${accentHover} shadow-lg`
              }`}
            >
              {isGenerating ? (
                <><Loader2 size={13} className="animate-spin" />生成中...</>
              ) : !selectedModel ? (
                <><Settings size={13} />请先选择模型</>
              ) : (
                <><Sparkles size={13} />批量生成</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
