'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Upload, Sparkles, Image as ImageIcon,
  Scan, Loader2, ChevronDown,
  Eye, GripVertical, Sun, Camera, Package, Cpu, Wand2, Sliders
} from 'lucide-react';

/* ─── types ─── */
interface ImageModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

interface CategoryPreset {
  id: string;
  name: string;
  material: string;
  reflectIndex: number;
  renderFocus: string;
}

interface LightingPreset {
  id: string;
  name: string;
  description: string;
}

interface ViewAnglePreset {
  id: string;
  name: string;
  description: string;
}

interface RefineResult {
  imageUrl: string;
  label: string;
}

interface Props {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImage?: (url: string) => void;
  initialImageUrl?: string;
}

/* ─── component ─── */
export default function RefineEnginePanel({ isMonochrome = false, onClose, onAddImage, initialImageUrl }: Props) {
  // ─── Theme tokens ───
  const bgPanel = isMonochrome ? 'rgba(255,255,255,0.98)' : 'rgba(20,20,20,0.97)';
  const bgDeep = isMonochrome ? '#f9fafb' : '#111111';
  const bgInput = isMonochrome ? '#f3f4f6' : '#0d0d0d';
  const borderColor = isMonochrome ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)';
  const borderColorLight = isMonochrome ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
  const textColor = isMonochrome ? '#111827' : '#f3f4f6';
  const textSubColor = isMonochrome ? '#6b7280' : '#9ca3af';
  const textMutedColor = isMonochrome ? '#9ca3af' : '#6b7280';
  const accentColor = isMonochrome ? '#2563eb' : '#d4af37';
  const accentHover = isMonochrome ? '#1d4ed8' : '#e0b840';
  const accentBg = isMonochrome ? 'rgba(37,99,235,0.08)' : 'rgba(212,175,55,0.1)';
  const accentBgHover = isMonochrome ? 'rgba(37,99,235,0.15)' : 'rgba(212,175,55,0.18)';
  const accentBorder = isMonochrome ? 'rgba(37,99,235,0.3)' : 'rgba(212,175,55,0.35)';
  const mutedColor = isMonochrome ? '#d1d5db' : '#4b5563';
  const shadow = isMonochrome ? '0 8px 32px rgba(0,0,0,0.12)' : '0 8px 32px rgba(0,0,0,0.5)';
  const backdrop = isMonochrome ? 'none' : 'blur(24px)';

  // ─── Drag state ───
  const [position, setPosition] = useState(() => {
    if (typeof window !== 'undefined') {
      return { x: (window.innerWidth - 460) / 2, y: (window.innerHeight - 580) / 2 };
    }
    return { x: 0, y: 0 };
  });
  const [hasPosition, setHasPosition] = useState(true);
  const isDragging = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // ─── Panel state ───
  const [refineMode, setRefineMode] = useState<'standard' | 'expert'>('standard');
  const [sourceImage, setSourceImage] = useState<string>(initialImageUrl || '');
  const [selectedModel, setSelectedModel] = useState('');
  const [models, setModels] = useState<ImageModel[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [results, setResults] = useState<RefineResult[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'settings' | 'results'>(
    initialImageUrl ? 'settings' : 'upload'
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // ─── Product refinement state ───
  const [categories, setCategories] = useState<CategoryPreset[]>([]);
  const [lightings, setLightings] = useState<LightingPreset[]>([]);
  const [viewAngles, setViewAngles] = useState<ViewAnglePreset[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('default');
  const [selectedLighting, setSelectedLighting] = useState('soft_studio');
  const [selectedViewAngle, setSelectedViewAngle] = useState('front');
  const [productName, setProductName] = useState('');
  const [customMaterial, setCustomMaterial] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [reflectIndex, setReflectIndex] = useState(0.4);

  // ─── Load presets & models ───
  useEffect(() => {
    (async () => {
      try {
        // Load presets from API
        const presetResp = await fetch('/api/refine-engine');
        const presetData = await presetResp.json();
        if (presetData.success) {
          setCategories(presetData.categories || []);
          setLightings(presetData.lightings || []);
          setViewAngles(presetData.viewAngles || []);
        }
      } catch (err) {
        console.error('Failed to load presets:', err);
      }
      try {
        // Load models
        const modelResp = await fetch('/api/refine-engine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'models' }),
        });
        const modelData = await modelResp.json();
        if (modelData.success) {
          const imageModels: ImageModel[] = (modelData.models || []).map((m: Record<string, unknown>) => {
            const provider = (modelData.providers || []).find((p: Record<string, unknown>) => p.id === m.providerId);
            return {
              id: m.id as string,
              name: (m.name as string) || (m.id as string),
              providerId: m.providerId as string,
              providerName: (provider?.displayName as string) || (provider?.name as string) || '未知提供商',
            };
          });
          setModels(imageModels);
          if (imageModels.length > 0) setSelectedModel(imageModels[0].id);
        }
      } catch (err) {
        console.error('Failed to load models:', err);
      }
    })();
  }, []);

  // ─── Close dropdown on outside click ───
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Switch tab when image is first uploaded (not when user manually navigates) ───
  const switchToSettingsRef = useRef(false);
  useEffect(() => {
    if (switchToSettingsRef.current && sourceImage) {
      setActiveTab('settings');
      switchToSettingsRef.current = false;
    }
  }, [sourceImage]);

  // ─── Derived state ───
  const selectedCategoryName = categories.find(c => c.id === selectedCategory)?.name || '默认';

  // ─── Update material/reflect when category changes ───
  useEffect(() => {
    const cat = categories.find(c => c.id === selectedCategory);
    if (cat) {
      setCustomMaterial(cat.material);
      setReflectIndex(cat.reflectIndex);
    }
  }, [selectedCategory, categories]);

  // ─── Drag handlers ───
  const handlePanelDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    setIsDraggingState(true);
    if (!hasPosition && panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      setPosition({ x: rect.left, y: rect.top });
      setHasPosition(true);
      dragStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    } else if (hasPosition) {
      dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    } else {
      isDragging.current = false;
      return;
    }
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      ev.stopPropagation();
      setPosition({ x: ev.clientX - dragStart.current.x, y: ev.clientY - dragStart.current.y });
    };
    const onMouseUp = (ev: MouseEvent) => {
      ev.stopPropagation();
      isDragging.current = false;
      setIsDraggingState(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const stopPropagation = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  // ─── Handle file upload ───
  const handleFileUpload = async (file: File) => {
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const resp = await fetch('/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: dataUrl }),
        });
        const data = await resp.json();
        if (data.url) {
          setSourceImage(data.url);
          switchToSettingsRef.current = true; // trigger auto-switch to settings
        }
      };
      reader.onerror = () => console.error('File read failed');
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Upload failed:', err);
    }
  };

  // ─── Handle refine ───
  const handleRefine = async () => {
    if (!sourceImage || !selectedModel) return;
    setIsProcessing(true);
    setProgress(10);
    setProgressLabel('提交任务...');
    setResults([]);
    setActiveTab('results');

    try {
      const body: Record<string, unknown> = {
        action: 'refine',
        imageUrl: sourceImage,
        mode: refineMode,
        model: selectedModel,
        productCategory: selectedCategory,
        productName: productName || '产品',
        materialType: customMaterial,
        reflectIndex,
        lightingPreset: selectedLighting,
        viewAngle: selectedViewAngle,
        customInstructions,
      };

      const resp = await fetch('/api/refine-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();

      if (data.taskId) {
        setProgressLabel('精修处理中...');
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
              setProgressLabel('精修完成');
              const urls = pollData.result.directImageUrls || pollData.result.imageUrls || [];
              const label = refineMode === 'expert' ? '专家精修' : '标准精修';
              setResults(urls.map((url: string) => ({ imageUrl: url, label })));
              setIsProcessing(false);
            } else if (pollData.status === 'failed') {
              clearInterval(pollInterval);
              setProgressLabel('精修失败');
              setIsProcessing(false);
              setResults([]);
            } else {
              setProgress(prev => Math.min(prev + 5, 90));
              if (pollData.progress) setProgressLabel(pollData.label || '精修处理中...');
            }
          } catch {
            clearInterval(pollInterval);
            setIsProcessing(false);
          }
        }, 2000);
      } else if (data.directImageUrls || data.imageUrls) {
        setProgress(100);
        setProgressLabel('精修完成');
        const urls = data.directImageUrls || data.imageUrls || [];
        const label = refineMode === 'expert' ? '专家精修' : '标准精修';
        setResults(urls.map((url: string) => ({ imageUrl: url, label })));
        setIsProcessing(false);
      } else if (data.error) {
        console.error('Refine error:', data.error);
        setProgressLabel('精修失败');
        setIsProcessing(false);
      }
    } catch (err) {
      console.error('Refine failed:', err);
      setIsProcessing(false);
    }
  };

  // ─── Model display name ───
  const getModelDisplay = (modelId: string) => {
    const model = models.find(m => m.id === modelId);
    if (!model) return modelId;
    return `${model.providerName} · ${model.name}`;
  };

  // ─── Render ───
  return (
    <div
      ref={panelRef}
      data-floating-panel
      className="fixed z-[150]"
      style={{
        left: position.x,
        top: position.y,
        width: 460,
        maxHeight: '85vh',
        borderRadius: 12,
        backgroundColor: bgPanel,
        border: isDraggingState
          ? `2px solid ${accentColor}`
          : `1px solid ${borderColor}`,
        boxShadow: isDraggingState
          ? (isMonochrome ? '0 0 24px rgba(37,99,235,0.25), 0 8px 32px rgba(0,0,0,0.12)' : '0 0 24px rgba(212,175,55,0.3), 0 8px 32px rgba(0,0,0,0.5)')
          : shadow,
        backdropFilter: backdrop,
        WebkitBackdropFilter: backdrop,
        color: textColor,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onMouseDown={stopPropagation}
      onPointerDown={stopPropagation}
    >
      {/* ─── Header (draggable) ─── */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-move select-none shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
        onMouseDown={handlePanelDragStart}
      >
        <GripVertical size={16} style={{ color: mutedColor }} />
        <Scan size={17} style={{ color: accentColor }} />
        <span className="text-base font-semibold flex-1" style={{ color: accentColor }}>
          精修引擎
        </span>
        <span className="text-xs px-2 py-0.5 rounded" style={{ color: textSubColor, background: isMonochrome ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)' }}>
          {selectedCategoryName} · {refineMode === 'expert' ? '专家精修' : '标准精修'}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-md transition-colors"
          style={{ color: textMutedColor }}
          onMouseEnter={e => (e.currentTarget.style.color = textColor)}
          onMouseLeave={e => (e.currentTarget.style.color = textMutedColor)}
        >
          <X size={16} />
        </button>
      </div>

      {/* ─── Mode Toggle ─── */}
      <div
        className="flex shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        {[
          { id: 'standard' as const, label: '标准模式', icon: <Sliders size={15} /> },
          { id: 'expert' as const, label: '专家模式', icon: <Cpu size={15} /> },
        ].map(mode => (
          <button
            key={mode.id}
            onClick={() => setRefineMode(mode.id)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors"
            style={{
              color: refineMode === mode.id ? accentColor : textMutedColor,
              borderBottom: refineMode === mode.id ? `2px solid ${accentColor}` : '2px solid transparent',
              background: refineMode === mode.id ? accentBg : 'transparent',
            }}
          >
            {mode.icon}
            {mode.label}
          </button>
        ))}
      </div>

      {/* ─── Tabs ─── */}
      <div
        className="flex shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        {[
          { id: 'upload' as const, label: '上传图片', icon: <Upload size={14} /> },
          { id: 'settings' as const, label: '精修设置', icon: <Wand2 size={14} /> },
          { id: 'results' as const, label: '精修结果', icon: <Eye size={14} /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors"
            style={{
              color: activeTab === tab.id ? accentColor : textMutedColor,
              borderBottom: activeTab === tab.id ? `1.5px solid ${accentColor}` : '1.5px solid transparent',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-y-auto min-h-0" style={{ background: bgDeep }}>
        {/* ─── Upload Tab ─── */}
        {activeTab === 'upload' && (
          <div className="p-4 space-y-4">
            {sourceImage ? (
              <div className="relative rounded-lg overflow-hidden" style={{ border: `1px solid ${borderColor}` }}>
                <img src={sourceImage} alt="Source" className="w-full h-auto max-h-[240px] object-contain" style={{ background: isMonochrome ? '#e5e7eb' : 'rgba(0,0,0,0.3)' }} />
                <button
                  onClick={() => setSourceImage('')}
                  className="absolute top-2 right-2 p-1.5 rounded-full transition-colors"
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                  title="移除图片"
                >
                  <X size={14} />
                </button>
                <button
                  onClick={() => { if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); } }}
                  className="absolute bottom-2 right-2 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                  style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}
                  title="重新选择图片"
                >
                  <Upload size={12} />
                  重新选择
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 p-8 rounded-lg border-2 border-dashed cursor-pointer transition-colors"
                style={{
                  borderColor: borderColorLight,
                  background: isMonochrome ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = accentBorder)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = borderColorLight)}
              >
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: accentBg }}
                >
                  <Upload size={24} style={{ color: accentColor }} />
                </div>
                <div className="text-center">
                  <p className="text-sm" style={{ color: textColor }}>点击上传或拖拽图片</p>
                  <p className="text-xs mt-1" style={{ color: textMutedColor }}>支持 JPG / PNG / WebP</p>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
            />

            {onAddImage && !sourceImage && (
              <p className="text-xs text-center" style={{ color: textMutedColor }}>
                选中画布图片后，可通过图片工具栏的"精修引擎"按钮直接打开
              </p>
            )}
          </div>
        )}

        {/* ─── Settings Tab ─── */}
        {activeTab === 'settings' && (
          <div className="p-4 space-y-4">
            {/* Source thumbnail */}
            {sourceImage && (
              <div className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)' }}>
                <img src={sourceImage} alt="Source" className="w-12 h-12 object-cover rounded-md" style={{ border: `1px solid ${borderColor}` }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: textColor }}>已选择图片</p>
                  <button onClick={() => { if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); } }} className="text-xs" style={{ color: accentColor }}>更换图片</button>
                </div>
              </div>
            )}

            {/* Product name */}
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: textSubColor }}>产品名称</label>
              <input
                type="text"
                value={productName}
                onChange={e => setProductName(e.target.value)}
                placeholder="如：高端白酒、智能手表..."
                className="w-full px-3 py-2.5 rounded-md text-sm outline-none transition-colors"
                style={{
                  background: bgInput,
                  border: `1px solid ${borderColor}`,
                  color: textColor,
                }}
                onFocus={e => (e.currentTarget.style.borderColor = accentBorder)}
                onBlur={e => (e.currentTarget.style.borderColor = borderColor)}
              />
            </div>

            {/* Category selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: textSubColor }}>产品品类</label>
              <div className="grid grid-cols-3 gap-2">
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className="px-2 py-2 rounded-md text-xs font-medium transition-all text-center"
                    style={{
                      background: selectedCategory === cat.id ? accentBg : isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${selectedCategory === cat.id ? accentBorder : borderColorLight}`,
                      color: selectedCategory === cat.id ? accentColor : textSubColor,
                    }}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Lighting selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5" style={{ color: textSubColor }}>
                <Sun size={14} /> 光影方案
              </label>
              <div className="grid grid-cols-3 gap-2">
                {lightings.map(light => (
                  <button
                    key={light.id}
                    onClick={() => setSelectedLighting(light.id)}
                    className="px-2 py-2 rounded-md text-xs font-medium transition-all text-center"
                    style={{
                      background: selectedLighting === light.id ? accentBg : isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${selectedLighting === light.id ? accentBorder : borderColorLight}`,
                      color: selectedLighting === light.id ? accentColor : textSubColor,
                    }}
                  >
                    {light.name}
                  </button>
                ))}
              </div>
            </div>

            {/* View angle selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5" style={{ color: textSubColor }}>
                <Camera size={14} /> 视角
              </label>
              <div className="grid grid-cols-3 gap-2">
                {viewAngles.map(va => (
                  <button
                    key={va.id}
                    onClick={() => setSelectedViewAngle(va.id)}
                    className="px-2 py-2 rounded-md text-xs font-medium transition-all text-center"
                    style={{
                      background: selectedViewAngle === va.id ? accentBg : isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${selectedViewAngle === va.id ? accentBorder : borderColorLight}`,
                      color: selectedViewAngle === va.id ? accentColor : textSubColor,
                    }}
                  >
                    {va.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Expert-only: Material & Reflect & Custom */}
            {refineMode === 'expert' && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium" style={{ color: textSubColor }}>材质描述</label>
                  <input
                    type="text"
                    value={customMaterial}
                    onChange={e => setCustomMaterial(e.target.value)}
                    placeholder="如：超透玻璃、磨砂铝合金..."
                    className="w-full px-3 py-2.5 rounded-md text-sm outline-none transition-colors"
                    style={{
                      background: bgInput,
                      border: `1px solid ${borderColor}`,
                      color: textColor,
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = accentBorder)}
                    onBlur={e => (e.currentTarget.style.borderColor = borderColor)}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium" style={{ color: textSubColor }}>反光指数</label>
                    <span className="text-sm font-mono" style={{ color: accentColor }}>{reflectIndex.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={Math.round(reflectIndex * 10)}
                    onChange={e => setReflectIndex(Number(e.target.value) / 10)}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, ${accentColor} ${reflectIndex * 100}%, ${borderColorLight} ${reflectIndex * 100}%)`,
                    }}
                  />
                  <div className="flex justify-between text-xs" style={{ color: textMutedColor }}>
                    <span>哑光 0.0</span>
                    <span>镜面 1.0</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" style={{ color: textSubColor }}>自定义指令</label>
                  <textarea
                    value={customInstructions}
                    onChange={e => setCustomInstructions(e.target.value)}
                    placeholder="附加精修指令，如：强调瓶身光泽，增强烫金质感..."
                    className="w-full px-3 py-2.5 rounded-md text-sm outline-none resize-none transition-colors"
                    style={{
                      background: bgInput,
                      border: `1px solid ${borderColor}`,
                      color: textColor,
                    }}
                    rows={2}
                    onFocus={e => (e.currentTarget.style.borderColor = accentBorder)}
                    onBlur={e => (e.currentTarget.style.borderColor = borderColor)}
                  />
                </div>
              </>
            )}

            {/* Model selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: textSubColor }}>生图模型</label>
              <div className="relative" ref={modelDropdownRef}>
                <button
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm transition-colors"
                  style={{
                    background: bgInput,
                    border: `1px solid ${borderColor}`,
                    color: textColor,
                  }}
                >
                  <span>{selectedModel ? getModelDisplay(selectedModel) : '选择模型'}</span>
                  <ChevronDown
                    size={14}
                    style={{ color: textMutedColor, transform: showModelDropdown ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}
                  />
                </button>
                {showModelDropdown && (
                  <div
                    className="absolute top-full left-0 right-0 mt-1 rounded-md shadow-xl z-10 max-h-48 overflow-y-auto"
                    style={{ background: bgPanel, border: `1px solid ${borderColor}` }}
                  >
                    {models.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-center" style={{ color: textMutedColor }}>
                        暂无可用模型，请在管理员系统添加
                      </div>
                    ) : (
                      models.map(m => (
                        <button
                          key={`${m.id}-${m.providerId}`}
                          onClick={() => { setSelectedModel(m.id); setShowModelDropdown(false); }}
                          className="w-full px-3 py-2.5 text-left transition-colors"
                          style={{
                            background: selectedModel === m.id ? accentBg : 'transparent',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = accentBgHover)}
                          onMouseLeave={e => (e.currentTarget.style.background = selectedModel === m.id ? accentBg : 'transparent')}
                        >
                          <div className="text-sm" style={{ color: textColor }}>{m.name}</div>
                          <div className="text-xs mt-0.5" style={{ color: textMutedColor }}>{m.providerName}</div>
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
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="relative">
                  <Loader2 size={36} className="animate-spin" style={{ color: accentColor }} />
                  <Sparkles size={16} className="absolute -top-1 -right-1 animate-pulse" style={{ color: accentColor }} />
                </div>
                <div className="text-center">
                  <p className="text-sm" style={{ color: textColor }}>{progressLabel || '精修处理中...'}</p>
                  <p className="text-xs mt-1" style={{ color: textMutedColor }}>AI正在优化您的产品图片</p>
                </div>
                <div className="w-full max-w-[220px] h-2 rounded-full overflow-hidden" style={{ background: borderColorLight }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${progress}%`, background: accentColor }}
                  />
                </div>
                <span className="text-xs font-mono" style={{ color: textMutedColor }}>{progress}%</span>
              </div>
            ) : results.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: textSubColor }}>精修完成 · {results.length} 张结果</span>
                  <button
                    onClick={handleRefine}
                    className="text-xs flex items-center gap-1.5 transition-colors"
                    style={{ color: accentColor }}
                  >
                    <Sparkles size={13} /> 重新精修
                  </button>
                </div>

                {/* Before/After comparison */}
                {sourceImage && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <span className="text-xs" style={{ color: textMutedColor }}>原图</span>
                      <img src={sourceImage} alt="Original" className="w-full rounded-md" style={{ border: `1px solid ${borderColor}` }} />
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-xs" style={{ color: accentColor }}>精修后</span>
                      <img src={results[0].imageUrl} alt="Refined" className="w-full rounded-md" style={{ border: `1px solid ${accentBorder}` }} />
                    </div>
                  </div>
                )}

                {/* Multiple results */}
                {results.length > 1 && (
                  <div className="space-y-2">
                    <span className="text-xs" style={{ color: textMutedColor }}>全部结果</span>
                    <div className="grid grid-cols-2 gap-3">
                      {results.map((r, i) => (
                        <div key={i} className="relative group">
                          <img src={r.imageUrl} alt={r.label} className="w-full rounded-md" style={{ border: `1px solid ${borderColor}` }} />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center">
                            <button
                              onClick={() => onAddImage?.(r.imageUrl)}
                              className="px-3 py-1.5 text-xs rounded-md text-white transition-colors"
                              style={{ background: accentColor }}
                            >
                              添加到画布
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Single result add button */}
                {results.length === 1 && (
                  <button
                    onClick={() => onAddImage?.(results[0].imageUrl)}
                    className="w-full py-3 rounded-md text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
                    style={{ background: accentColor }}
                    onMouseEnter={e => (e.currentTarget.style.background = accentHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = accentColor)}
                  >
                    <ImageIcon size={15} />
                    添加到画布
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Scan size={36} style={{ color: textMutedColor }} />
                <p className="text-sm" style={{ color: textSubColor }}>暂无精修结果</p>
                <p className="text-xs" style={{ color: textMutedColor }}>请在"精修设置"中配置参数后开始精修</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Bottom Action ─── */}
      <div
        className="shrink-0 px-4 py-3 flex gap-2"
        style={{
          borderTop: `1px solid ${borderColor}`,
          background: isMonochrome ? 'rgba(255,255,255,0.6)' : 'rgba(17,17,17,0.8)',
        }}
      >
        {activeTab === 'settings' && (
          <button
            onClick={handleRefine}
            disabled={!sourceImage || !selectedModel || isProcessing}
            className="w-full py-3 rounded-md text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
            style={{ background: accentColor }}
            onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = accentHover; }}
            onMouseLeave={e => { e.currentTarget.style.background = accentColor; }}
          >
            {isProcessing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {isProcessing ? '精修中...' : '开始精修'}
          </button>
        )}
        {activeTab === 'upload' && sourceImage && (
          <button
            onClick={() => setActiveTab('settings')}
            className="w-full py-3 rounded-md text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors"
            style={{ background: accentColor }}
          >
            <Wand2 size={15} />
            下一步：精修设置
          </button>
        )}
      </div>
    </div>
  );
}
