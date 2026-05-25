'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Upload, Sparkles, Image as ImageIcon, Palette,
  Scan, Sun, Settings, Loader2, Check, ChevronDown,
  Monitor, ZoomIn, Layers, Eye
} from 'lucide-react';

/* ─── types ─── */
interface ImageModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

interface RefineResult {
  imageUrl: string;
  label: string;
}

interface Props {
  onClose: () => void;
  onAddImage?: (url: string) => void;
  initialImageUrl?: string;
}

/* ─── preset configs ─── */
const MODES = [
  { id: 'skin', name: '人物精修', icon: '👤', desc: '磨皮/美白/去瑕疵/塑形', color: '#f472b6' },
  { id: 'product', name: '商品精修', icon: '📦', desc: '去污/增强质感/补光', color: '#60a5fa' },
  { id: 'sharpen', name: '画质提升', icon: '🔍', desc: '降噪/锐化/超分辨率', color: '#34d399' },
  { id: 'tone', name: '色调精修', icon: '🎨', desc: '调色/风格化/氛围', color: '#a78bfa' },
] as const;

const SKIN_PRESETS = [
  { id: 'light', name: '自然白皙', desc: '自然美白，保留肤质纹理' },
  { id: 'smooth', name: '柔焦磨皮', desc: '平滑肌肤，柔焦效果' },
  { id: 'vivid', name: '鲜艳活力', desc: '增强气色，鲜活表现' },
  { id: 'film', name: '胶片质感', desc: '复古胶片肤色风格' },
];

const PRODUCT_PRESETS = [
  { id: 'clean', name: '纯净去污', desc: '去除瑕疵、灰尘、反光' },
  { id: 'texture', name: '质感增强', desc: '强化材质纹理细节' },
  { id: 'highlight', name: '高光提亮', desc: '突出产品亮点区域' },
  { id: 'shadow', name: '阴影优化', desc: '优化阴影层次和深度' },
];

const SHARPEN_PRESETS = [
  { id: 'denoise', name: '智能降噪', desc: '去除噪点，保留细节' },
  { id: 'sharpen', name: '锐化增强', desc: '增强边缘清晰度' },
  { id: 'upscale', name: '超分辨率', desc: '2倍分辨率提升' },
  { id: 'hdr', name: 'HDR增强', desc: '高动态范围优化' },
];

const TONE_PRESETS = [
  { id: 'warm', name: '暖色调', desc: '暖黄橙色调，温馨氛围' },
  { id: 'cool', name: '冷色调', desc: '蓝青色调，清新感' },
  { id: 'cinematic', name: '电影感', desc: '电影级色彩分级' },
  { id: 'vintage', name: '复古色调', desc: '怀旧复古色调' },
  { id: 'custom', name: '自定义', desc: '输入自定义色调描述' },
];

export default function RefineEnginePanel({ onClose, onAddImage, initialImageUrl }: Props) {
  /* ─── state ─── */
  const [activeMode, setActiveMode] = useState<string>('skin');
  const [sourceImage, setSourceImage] = useState<string>(initialImageUrl || '');
  const [selectedModel, setSelectedModel] = useState('');
  const [models, setModels] = useState<ImageModel[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('light');
  const [intensity, setIntensity] = useState(70);
  const [customPrompt, setCustomPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RefineResult[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'settings' | 'results'>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  /* ─── load models ─── */
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('/api/models?type=image');
        const data = await resp.json();
        const imageModels: ImageModel[] = (data.models || []).map((m: Record<string, unknown>) => {
          const provider = (data.providers || []).find((p: Record<string, unknown>) => p.id === m.providerId);
          return {
            id: m.id as string,
            name: (m.name as string) || (m.id as string),
            providerId: m.providerId as string,
            providerName: (provider?.displayName as string) || (provider?.name as string) || '未知提供商',
          };
        });
        setModels(imageModels);
        if (imageModels.length > 0) setSelectedModel(imageModels[0].id);
      } catch (err) {
        console.error('Failed to load models:', err);
      }
    })();
  }, []);

  /* ─── close dropdown on outside click ─── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ─── switch tab when image is set ─── */
  useEffect(() => {
    if (sourceImage && activeTab === 'upload') {
      setActiveTab('settings');
    }
  }, [sourceImage, activeTab]);

  /* ─── get presets for current mode ─── */
  const getCurrentPresets = useCallback(() => {
    switch (activeMode) {
      case 'skin': return SKIN_PRESETS;
      case 'product': return PRODUCT_PRESETS;
      case 'sharpen': return SHARPEN_PRESETS;
      case 'tone': return TONE_PRESETS;
      default: return [];
    }
  }, [activeMode]);

  /* ─── handle file upload ─── */
  const handleFileUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    try {
      const resp = await fetch('/api/save-image', { method: 'POST', body: formData });
      const data = await resp.json();
      if (data.url) setSourceImage(data.url);
    } catch (err) {
      console.error('Upload failed:', err);
    }
  };

  /* ─── handle refine ─── */
  const handleRefine = async () => {
    if (!sourceImage || !selectedModel) return;
    setIsProcessing(true);
    setProgress(10);
    setResults([]);
    setActiveTab('results');

    try {
      const resp = await fetch('/api/refine-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refine',
          imageUrl: sourceImage,
          mode: activeMode,
          preset: selectedPreset,
          intensity,
          customPrompt,
          model: selectedModel,
        }),
      });
      const data = await resp.json();

      if (data.taskId) {
        // Poll for async result
        setProgress(30);
        const pollInterval = setInterval(async () => {
          try {
            const pollResp = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: data.taskId, model: selectedModel }),
            });
            const pollData = await pollResp.json();

            if (pollData.status === 'completed' && pollData.result) {
              clearInterval(pollInterval);
              setProgress(100);
              const urls = pollData.result.directImageUrls || pollData.result.imageUrls || [];
              const label = MODES.find(m => m.id === activeMode)?.name || '精修';
              setResults(urls.map((url: string) => ({ imageUrl: url, label })));
              setIsProcessing(false);
            } else if (pollData.status === 'failed') {
              clearInterval(pollInterval);
              setIsProcessing(false);
              setResults([]);
            } else {
              setProgress(prev => Math.min(prev + 5, 90));
            }
          } catch {
            clearInterval(pollInterval);
            setIsProcessing(false);
          }
        }, 2000);
      } else if (data.directImageUrls || data.imageUrls) {
        // Direct result
        setProgress(100);
        const urls = data.directImageUrls || data.imageUrls || [];
        const label = MODES.find(m => m.id === activeMode)?.name || '精修';
        setResults(urls.map((url: string) => ({ imageUrl: url, label })));
        setIsProcessing(false);
      } else if (data.error) {
        console.error('Refine error:', data.error);
        setIsProcessing(false);
      }
    } catch (err) {
      console.error('Refine failed:', err);
      setIsProcessing(false);
    }
  };

  /* ─── get model display name ─── */
  const getModelDisplay = (modelId: string) => {
    const model = models.find(m => m.id === modelId);
    if (!model) return modelId;
    return `${model.providerName} · ${model.name}`;
  };

  /* ─── render ─── */
  return (
    <div
      data-floating-panel
      onPointerDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      className="fixed right-4 top-16 bottom-20 w-[420px] z-[80] flex flex-col rounded-xl overflow-hidden"
      style={{ background: 'rgba(15,15,15,0.97)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
    >
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))' }}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <span className="text-[15px] font-semibold text-gray-100">精修引擎</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ─── Tabs ─── */}
      <div className="flex border-b border-white/10">
        {[
          { id: 'upload' as const, label: '上传图片', icon: <Upload className="w-3.5 h-3.5" /> },
          { id: 'settings' as const, label: '精修设置', icon: <Settings className="w-3.5 h-3.5" /> },
          { id: 'results' as const, label: '精修结果', icon: <Eye className="w-3.5 h-3.5" /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-purple-300 border-b-2 border-purple-400 bg-purple-500/10'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* ─── Upload Tab ─── */}
        {activeTab === 'upload' && (
          <div className="p-4 space-y-4">
            {/* Source image preview */}
            {sourceImage ? (
              <div className="relative rounded-lg overflow-hidden border border-white/10">
                <img src={sourceImage} alt="Source" className="w-full h-auto max-h-[300px] object-contain bg-black/30" />
                <button
                  onClick={() => setSourceImage('')}
                  className="absolute top-2 right-2 p-1 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 p-8 rounded-lg border-2 border-dashed border-white/15 hover:border-purple-400/40 cursor-pointer transition-colors"
              >
                <div className="w-14 h-14 rounded-full bg-purple-500/15 flex items-center justify-center">
                  <Upload className="w-7 h-7 text-purple-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-300 mb-1">点击上传或拖拽图片</p>
                  <p className="text-xs text-gray-500">支持 JPG / PNG / WebP</p>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
            />

            {/* Quick select from canvas */}
            {onAddImage && (
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-2">或在画布中选择已有图片</p>
                <p className="text-[11px] text-gray-600">选中画布图片后，通过图片工具栏的"精修引擎"按钮打开</p>
              </div>
            )}

            {/* Model selection in upload tab */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">生图模型</label>
              <div className="relative" ref={modelDropdownRef}>
                <button
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-200 hover:border-purple-400/30 transition-colors"
                >
                  <span>{selectedModel ? getModelDisplay(selectedModel) : '选择模型'}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showModelDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showModelDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-lg bg-[#1a1a1a] border border-white/10 shadow-xl z-10 max-h-64 overflow-y-auto">
                    {models.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-gray-500 text-center">暂无可用模型，请在管理员系统添加</div>
                    ) : (
                      models.map(m => (
                        <button
                          key={`${m.id}-${m.providerId}`}
                          onClick={() => { setSelectedModel(m.id); setShowModelDropdown(false); }}
                          className={`w-full px-3 py-2.5 text-left hover:bg-white/5 transition-colors ${
                            selectedModel === m.id ? 'bg-purple-500/15' : ''
                          }`}
                        >
                          <div className="text-sm text-gray-200">{m.name}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{m.providerName}</div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Settings Tab ─── */}
        {activeTab === 'settings' && (
          <div className="p-4 space-y-5">
            {/* Source preview thumbnail */}
            {sourceImage && (
              <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                <img src={sourceImage} alt="Source" className="w-12 h-12 object-cover rounded-md" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300 truncate">已选择图片</p>
                  <button onClick={() => setActiveTab('upload')} className="text-[11px] text-purple-400 hover:underline">更换图片</button>
                </div>
              </div>
            )}

            {/* Mode selector */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">精修模式</label>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => { setActiveMode(mode.id); setSelectedPreset(getCurrentPresetsForMode(mode.id)[0]?.id || ''); }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                      activeMode === mode.id
                        ? 'border-purple-400/50 bg-purple-500/10'
                        : 'border-white/8 bg-white/3 hover:border-white/15'
                    }`}
                  >
                    <span className="text-lg">{mode.icon}</span>
                    <div className="text-left">
                      <div className="text-xs font-medium text-gray-200">{mode.name}</div>
                      <div className="text-[10px] text-gray-500">{mode.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Preset selector */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">效果预设</label>
              <div className="grid grid-cols-2 gap-2">
                {getCurrentPresets().map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedPreset(preset.id)}
                    className={`px-3 py-2 rounded-lg border text-left transition-all ${
                      selectedPreset === preset.id
                        ? 'border-purple-400/50 bg-purple-500/10'
                        : 'border-white/8 bg-white/3 hover:border-white/15'
                    }`}
                  >
                    <div className="text-xs font-medium text-gray-200">{preset.name}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{preset.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Intensity slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-400">精修强度</label>
                <span className="text-xs text-purple-300 font-mono">{intensity}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={intensity}
                onChange={e => setIntensity(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #a78bfa ${intensity}%, rgba(255,255,255,0.1) ${intensity}%)`,
                }}
              />
              <div className="flex justify-between text-[10px] text-gray-600">
                <span>轻微</span>
                <span>适中</span>
                <span>强烈</span>
              </div>
            </div>

            {/* Custom prompt (for tone/custom) */}
            {(activeMode === 'tone' && selectedPreset === 'custom') && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-400">自定义色调描述</label>
                <textarea
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  placeholder="描述你想要的色调效果，如：温暖的日落金色调，带一点橙色光晕..."
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-200 placeholder:text-gray-600 resize-none focus:outline-none focus:border-purple-400/30"
                  rows={3}
                />
              </div>
            )}

            {/* Model selection */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">生图模型</label>
              <div className="relative" ref={modelDropdownRef}>
                <button
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-200 hover:border-purple-400/30 transition-colors"
                >
                  <span>{selectedModel ? getModelDisplay(selectedModel) : '选择模型'}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showModelDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showModelDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-lg bg-[#1a1a1a] border border-white/10 shadow-xl z-10 max-h-64 overflow-y-auto">
                    {models.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-gray-500 text-center">暂无可用模型</div>
                    ) : (
                      models.map(m => (
                        <button
                          key={`${m.id}-${m.providerId}`}
                          onClick={() => { setSelectedModel(m.id); setShowModelDropdown(false); }}
                          className={`w-full px-3 py-2.5 text-left hover:bg-white/5 transition-colors ${
                            selectedModel === m.id ? 'bg-purple-500/15' : ''
                          }`}
                        >
                          <div className="text-sm text-gray-200">{m.name}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{m.providerName}</div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Results Tab ─── */}
        {activeTab === 'results' && (
          <div className="p-4 space-y-4">
            {isProcessing ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="relative">
                  <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
                  <Sparkles className="w-5 h-5 text-purple-300 absolute -top-1 -right-1 animate-pulse" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-200">精修处理中...</p>
                  <p className="text-xs text-gray-500 mt-1">AI正在优化您的图片</p>
                </div>
                {/* Progress bar */}
                <div className="w-full max-w-xs h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-blue-400 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500">{progress}%</span>
              </div>
            ) : results.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">精修完成 · {results.length} 张结果</span>
                  <button
                    onClick={handleRefine}
                    className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" /> 重新精修
                  </button>
                </div>
                {/* Before/After comparison */}
                {sourceImage && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-[10px] text-gray-500">原图</span>
                      <img src={sourceImage} alt="Original" className="w-full rounded-lg border border-white/10" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-purple-400">精修后</span>
                      <img src={results[0].imageUrl} alt="Refined" className="w-full rounded-lg border border-purple-400/30" />
                    </div>
                  </div>
                )}
                {/* All results */}
                {results.length > 1 && (
                  <div className="space-y-2">
                    <span className="text-[10px] text-gray-500">全部结果</span>
                    <div className="grid grid-cols-2 gap-2">
                      {results.map((r, i) => (
                        <div key={i} className="relative group">
                          <img src={r.imageUrl} alt={r.label} className="w-full rounded-lg border border-white/10" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                            <button
                              onClick={() => onAddImage?.(r.imageUrl)}
                              className="px-2 py-1 text-[10px] bg-purple-500/80 text-white rounded-md hover:bg-purple-500 transition-colors"
                            >
                              添加到画布
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Add to canvas button for single result */}
                {results.length === 1 && (
                  <button
                    onClick={() => onAddImage?.(results[0].imageUrl)}
                    className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}
                  >
                    <ImageIcon className="w-4 h-4" />
                    添加到画布
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Scan className="w-10 h-10 text-gray-600" />
                <p className="text-sm text-gray-400">暂无精修结果</p>
                <p className="text-xs text-gray-600">请在"精修设置"中配置参数后开始精修</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Bottom Action ─── */}
      <div className="shrink-0 p-4 border-t border-white/10 bg-[#111]/80">
        {activeTab !== 'results' ? (
          <button
            onClick={() => { setActiveTab('results'); handleRefine(); }}
            disabled={!sourceImage || !selectedModel || isProcessing}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
            style={{ background: sourceImage && selectedModel ? 'linear-gradient(135deg, #8b5cf6, #6366f1)' : 'rgba(255,255,255,0.05)' }}
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {!sourceImage ? '请先上传图片' : !selectedModel ? '请选择模型' : '开始精修'}
          </button>
        ) : !isProcessing && results.length === 0 ? (
          <button
            onClick={() => setActiveTab('settings')}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-gray-300 bg-white/5 hover:bg-white/10 transition-colors"
          >
            返回设置
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ─── helper: get presets for a mode ─── */
function getCurrentPresetsForMode(mode: string) {
  switch (mode) {
    case 'skin': return SKIN_PRESETS;
    case 'product': return PRODUCT_PRESETS;
    case 'sharpen': return SHARPEN_PRESETS;
    case 'tone': return TONE_PRESETS;
    default: return [];
  }
}
