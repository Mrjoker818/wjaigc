'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Upload, Sparkles, Image as ImageIcon,
  Scan, Loader2, ChevronDown,
  Eye, GripVertical, Sun, Camera, Package, Cpu, Wand2, Sliders, Ratio, BadgeCheck
} from 'lucide-react';
import {
  MODEL_ASPECT_RATIOS as SHARED_MODEL_ASPECT_RATIOS,
  MODEL_QUALITIES as SHARED_MODEL_QUALITIES,
  QUALITY_DISPLAY_NAMES as SHARED_QUALITY_DISPLAY_NAMES,
  DEFAULT_ASPECT_RATIOS as SHARED_DEFAULT_ASPECT_RATIOS,
  DEFAULT_QUALITIES as SHARED_DEFAULT_QUALITIES,
  ASPECT_RATIO_TO_PIXELS as SHARED_ASPECT_RATIO_TO_PIXELS,
  findModelConfig as sharedFindModelConfig,
} from '@/lib/canvas-generation-group';

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
  const [customAzimuth, setCustomAzimuth] = useState(30);   // 水平方位角 0-360°
  const [customElevation, setCustomElevation] = useState(15); // 垂直仰角 -90° ~ +90°
  const [showAnglePicker, setShowAnglePicker] = useState(false);
  const [productName, setProductName] = useState('');
  const [customMaterial, setCustomMaterial] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [reflectIndex, setReflectIndex] = useState(0.4);

  // ─── Aspect ratio & quality state ───
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [quality, setQuality] = useState('standard');

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
  const pollAttemptRef = useRef(0);
  useEffect(() => {
    if (switchToSettingsRef.current && sourceImage) {
      setActiveTab('settings');
      switchToSettingsRef.current = false;
    }
  }, [sourceImage]);

  // ─── Derived state ───
  const selectedCategoryName = categories.find(c => c.id === selectedCategory)?.name || '默认';

  // ─── Get supported aspect ratios for selected model ───
  const getSupportedAspectRatios = useCallback(() => {
    const pureModelId = selectedModel.includes('::') ? selectedModel.split('::').pop()! : selectedModel;
    return sharedFindModelConfig(SHARED_MODEL_ASPECT_RATIOS, pureModelId) || SHARED_DEFAULT_ASPECT_RATIOS;
  }, [selectedModel]);

  // ─── Get supported qualities for selected model ───
  const getSupportedQualities = useCallback(() => {
    const pureModelId = selectedModel.includes('::') ? selectedModel.split('::').pop()! : selectedModel;
    return sharedFindModelConfig(SHARED_MODEL_QUALITIES, pureModelId) || SHARED_DEFAULT_QUALITIES;
  }, [selectedModel]);

  // ─── Get pixel size hint for current aspect ratio ───
  const getPixelSize = useCallback((ratio: string): string => {
    return SHARED_ASPECT_RATIO_TO_PIXELS[ratio] || '1024x1024';
  }, []);

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
        viewAngle: selectedViewAngle === 'custom' ? 'dynamic' : selectedViewAngle,
        ...(selectedViewAngle === 'custom' ? { customAzimuth, customElevation } : {}),
        customInstructions,
        aspectRatio,
        quality,
      };

      setProgress(10);
      setProgressLabel('正在精修，请耐心等待...');

      // ★ Show simulated progress while waiting for sync POST response
      // Server processes synchronously and returns result directly
      let simProgress = 10;
      const progressInterval = setInterval(() => {
        simProgress = Math.min(simProgress + Math.random() * 3, 90);
        setProgress(Math.round(simProgress));
      }, 2000);

      const resp = await fetch('/api/refine-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600000), // 10 minutes timeout for sync processing
      });
      clearInterval(progressInterval); // Stop simulated progress
      const data = await resp.json();
      console.log('[refine-engine-panel] POST response:', JSON.stringify(data).slice(0, 300));

      // Handle error responses
      if (!data.success && data.error) {
        console.error('[refine-engine-panel] API error:', data.error);
        setProgressLabel('精修失败: ' + data.error);
        setIsProcessing(false);
        return;
      }

      // ★ Sync mode: result returned directly from POST
      const directUrls = data.directImageUrls || data.imageUrls || [];
      if (directUrls.length > 0) {
        console.log('[refine-engine-panel] Got directImageUrls:', directUrls);
        setProgress(100);
        setProgressLabel('精修完成');
        const label = refineMode === 'expert' ? '专家精修' : '标准精修';
        setResults(directUrls.map((url: string) => ({ imageUrl: url, label })));
        setIsProcessing(false);
        return;
      }

      // ★ If server returned success but no images — it's a failure
      if (data.success && !data.taskId) {
        console.error('[refine-engine-panel] Sync mode returned success but no images');
        setProgressLabel('精修完成但未返回图片');
        setIsProcessing(false);
        return;
      }

      // ★ Fallback: poll mode (if backend returns taskId without directImageUrls)
      if (data.taskId) {
        console.log('[refine-engine-panel] No directImageUrls, falling back to poll mode with taskId:', data.taskId);
        setProgressLabel('精修处理中...');
        pollAttemptRef.current = 0;
        setProgress(30);
        const pollInterval = setInterval(async () => {
          pollAttemptRef.current++;
          // Safety: stop polling after 7 minutes (210 attempts × 2s)
          if (pollAttemptRef.current > 210) {
            clearInterval(pollInterval);
            setProgressLabel('超时，请重试');
            setIsProcessing(false);
            return;
          }
          try {
            const pollResp = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: data.taskId, model: selectedModel }),
            });
            const pollData = await pollResp.json();
            console.log(`[refine-engine-panel] Poll #${pollAttemptRef.current}: status=${pollData.status}, progress=${pollData.progress}, hasResult=${!!pollData.result}`);

            if (pollData.status === 'completed') {
              clearInterval(pollInterval);
              setProgress(100);
              setProgressLabel('精修完成');
              // Support two response formats:
              // 1. pollData.result.directImageUrls (from refine-engine sync mode)
              // 2. pollData.imageUrl (from poll-task remote polling — APImart async)
              const resultUrls: string[] = [];
              if (pollData.result?.directImageUrls) {
                resultUrls.push(...pollData.result.directImageUrls);
              } else if (pollData.result?.imageUrls) {
                resultUrls.push(...pollData.result.imageUrls);
              }
              if (pollData.imageUrl && !resultUrls.includes(pollData.imageUrl)) {
                resultUrls.push(pollData.imageUrl);
              }
              console.log('[refine-engine-panel] Poll completed, urls:', resultUrls, 'raw:', JSON.stringify(pollData).substring(0, 500));
              if (resultUrls.length > 0) {
                const label = refineMode === 'expert' ? '专家精修' : '标准精修';
                setResults(resultUrls.map((url: string) => ({ imageUrl: url, label })));
              } else {
                setProgressLabel('精修完成但未获取到图片');
              }
              setIsProcessing(false);
            } else if (pollData.status === 'failed') {
              clearInterval(pollInterval);
              setProgressLabel(pollData.error || '精修失败');
              setIsProcessing(false);
              setResults([]);
            } else if (pollData.status === 'cancelled') {
              clearInterval(pollInterval);
              setProgressLabel('任务已取消');
              setIsProcessing(false);
              setResults([]);
            } else {
              // Still processing — update progress but don't stop polling
              setProgress(prev => Math.min(prev + 2, 95));
              if (pollData.progress) setProgressLabel(pollData.label || '精修处理中...');
              else if (pollData.status === 'processing' || pollData.status === 'queued') {
                setProgressLabel(pollData.status === 'queued' ? '排队中...' : '精修处理中...');
              }
            }
          } catch (pollErr) {
            // Don't stop polling on transient network errors — just log and continue
            console.warn('[refine-engine-panel] Poll error (will retry):', pollErr);
          }
        }, 2000);
      } else {
        // No taskId and no directImageUrls — unknown response
        console.error('[refine-engine-panel] Unexpected response:', data);
        setProgressLabel('精修失败：未知响应');
        setIsProcessing(false);
      }
    } catch (err) {
      console.error('Refine failed:', err);
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        setProgressLabel('精修超时，请重试');
      } else {
        setProgressLabel('精修失败，请重试');
      }
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
                    onClick={() => { setSelectedViewAngle(va.id); setShowAnglePicker(false); }}
                    className="px-2 py-2 rounded-md text-xs font-medium transition-all text-center"
                    style={{
                      background: selectedViewAngle === va.id && !showAnglePicker ? accentBg : isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${selectedViewAngle === va.id && !showAnglePicker ? accentBorder : borderColorLight}`,
                      color: selectedViewAngle === va.id && !showAnglePicker ? accentColor : textSubColor,
                    }}
                  >
                    {va.name}
                  </button>
                ))}
                {/* 3D angle button */}
                <button
                  onClick={() => { setSelectedViewAngle('custom'); setShowAnglePicker(true); }}
                  className="px-2 py-2 rounded-md text-xs font-medium transition-all text-center relative"
                  style={{
                    background: showAnglePicker ? accentBg : isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${showAnglePicker ? accentBorder : borderColorLight}`,
                    color: showAnglePicker ? accentColor : textSubColor,
                  }}
                >
                  三维视角
                </button>
              </div>

              {/* 3D angle picker - shown when "三维视角" is selected */}
              {showAnglePicker && (
                <div className="mt-3 p-3 rounded-lg space-y-3" style={{ background: isMonochrome ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)', border: `1px solid ${borderColorLight}` }}>
                  {/* Combined 3D Cube + Circle direction selector */}
                  <div className="flex items-center justify-center">
                    <div
                      className="relative rounded-full cursor-crosshair"
                      style={{
                        width: 160, height: 160,
                        background: isMonochrome
                          ? 'radial-gradient(circle, #f3f4f6 0%, #e5e7eb 60%, #d1d5db 100%)'
                          : 'radial-gradient(circle, #1a1a1a 0%, #141414 60%, #0d0d0d 100%)',
                        border: `1.5px solid ${borderColor}`,
                      }}
                      onMouseDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const cx = rect.left + rect.width / 2;
                        const cy = rect.top + rect.height / 2;
                        const updateAngle = (clientX: number, clientY: number) => {
                          const dx = clientX - cx;
                          const dy = clientY - cy;
                          const r = rect.width / 2;
                          let az = Math.atan2(dx, -dy) * 180 / Math.PI;
                          if (az < 0) az += 360;
                          let el = Math.sqrt(dx * dx + dy * dy) / r * 90;
                          if (el > 90) el = 90;
                          setCustomAzimuth(Math.round(az));
                          setCustomElevation(Math.round(el));
                        };
                        updateAngle(e.clientX, e.clientY);
                        const onMove = (ev: MouseEvent) => { updateAngle(ev.clientX, ev.clientY); };
                        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                      }}
                    >
                      {/* Grid lines */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div style={{ width: 1, height: '100%', background: borderColorLight }} />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div style={{ height: 1, width: '100%', background: borderColorLight }} />
                      </div>
                      {/* Concentric circle guides */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none" style={{ width: '66%', height: '66%', border: `1px dashed ${borderColorLight}` }} />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none" style={{ width: '33%', height: '33%', border: `1px dashed ${borderColorLight}` }} />
                      {/* Center dot */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none" style={{ background: textMutedColor }} />

                      {/* 3D Cube preview - centered inside the circle */}
                      <div
                        className="absolute top-1/2 left-1/2 pointer-events-none"
                        style={{
                          width: 0, height: 0,
                          perspective: 300,
                          transformStyle: 'preserve-3d',
                        }}
                      >
                        <div
                          style={{
                            width: 72, height: 72,
                            position: 'absolute',
                            left: -36, top: -36,
                            transformStyle: 'preserve-3d',
                            transform: `rotateX(${-customElevation}deg) rotateY(${-customAzimuth}deg)`,
                            transition: 'transform 0.15s ease-out',
                          }}
                        >
                          {/* Front face */}
                          <div style={{
                            position: 'absolute', width: 72, height: 72,
                            background: accentColor + '20',
                            border: `1.5px solid ${accentColor}50`,
                            transform: 'translateZ(36px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, color: accentColor, fontWeight: 600,
                          }}>前</div>
                          {/* Back face */}
                          <div style={{
                            position: 'absolute', width: 72, height: 72,
                            background: isMonochrome ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
                            border: `1.5px solid ${borderColor}`,
                            transform: 'rotateY(180deg) translateZ(36px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, color: textMutedColor,
                          }}>后</div>
                          {/* Left face */}
                          <div style={{
                            position: 'absolute', width: 72, height: 72,
                            background: isMonochrome ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
                            border: `1.5px solid ${borderColorLight}`,
                            transform: 'rotateY(-90deg) translateZ(36px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, color: textMutedColor,
                          }}>左</div>
                          {/* Right face */}
                          <div style={{
                            position: 'absolute', width: 72, height: 72,
                            background: isMonochrome ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
                            border: `1.5px solid ${borderColorLight}`,
                            transform: 'rotateY(90deg) translateZ(36px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, color: textMutedColor,
                          }}>右</div>
                          {/* Top face */}
                          <div style={{
                            position: 'absolute', width: 72, height: 72,
                            background: accentColor + '10',
                            border: `1.5px solid ${accentColor}30`,
                            transform: 'rotateX(90deg) translateZ(36px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, color: accentColor + '70',
                          }}>顶</div>
                          {/* Bottom face */}
                          <div style={{
                            position: 'absolute', width: 72, height: 72,
                            background: isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                            border: `1.5px solid ${borderColorLight}`,
                            transform: 'rotateX(-90deg) translateZ(36px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, color: textMutedColor,
                          }}>底</div>
                        </div>
                      </div>

                      {/* Direction indicator dot (camera position) */}
                      <div
                        className="absolute w-3.5 h-3.5 rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2"
                        style={{
                          background: accentColor,
                          boxShadow: `0 0 8px ${accentColor}80`,
                          left: `${50 + 45 * (customElevation / 90) * Math.sin(customAzimuth * Math.PI / 180)}%`,
                          top: `${50 - 45 * (customElevation / 90) * Math.cos(customAzimuth * Math.PI / 180)}%`,
                          transition: 'left 0.1s, top 0.1s',
                          zIndex: 10,
                        }}
                      />
                      {/* Direction labels */}
                      <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[9px] pointer-events-none" style={{ color: textMutedColor }}>前</span>
                      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] pointer-events-none" style={{ color: textMutedColor }}>后</span>
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] pointer-events-none" style={{ color: textMutedColor }}>左</span>
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] pointer-events-none" style={{ color: textMutedColor }}>右</span>
                      {/* Angle display */}
                      <div className="absolute bottom-2 right-2 text-[9px] font-mono pointer-events-none" style={{ color: accentColor + '80' }}>
                        {customAzimuth}°·{customElevation}°
                      </div>
                      {/* Drag hint */}
                      <div className="absolute top-1.5 right-2 text-[8px] pointer-events-none" style={{ color: textMutedColor + '60' }}>
                        拖拽调角
                      </div>
                    </div>
                  </div>

                  {/* Azimuth slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium" style={{ color: textSubColor }}>水平方位</span>
                      <span className="text-xs font-mono" style={{ color: accentColor }}>{customAzimuth}°</span>
                    </div>
                    <input
                      type="range" min={0} max={360} step={5}
                      value={customAzimuth}
                      onChange={e => setCustomAzimuth(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ background: `linear-gradient(to right, ${accentColor}30, ${accentColor} ${customAzimuth / 360 * 100}%, ${borderColorLight} ${customAzimuth / 360 * 100}%, ${borderColorLight})` }}
                    />
                    <div className="flex justify-between text-[9px]" style={{ color: textMutedColor }}>
                      <span>0° 前</span><span>90° 右</span><span>180° 后</span><span>270° 左</span><span>360°</span>
                    </div>
                  </div>

                  {/* Elevation slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium" style={{ color: textSubColor }}>垂直仰角</span>
                      <span className="text-xs font-mono" style={{ color: accentColor }}>{customElevation}°</span>
                    </div>
                    <input
                      type="range" min={0} max={90} step={5}
                      value={customElevation}
                      onChange={e => setCustomElevation(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ background: `linear-gradient(to right, ${accentColor}30, ${accentColor} ${customElevation / 90 * 100}%, ${borderColorLight} ${customElevation / 90 * 100}%, ${borderColorLight})` }}
                    />
                    <div className="flex justify-between text-[9px]" style={{ color: textMutedColor }}>
                      <span>0° 平视</span><span>45° 半俯</span><span>90° 正俯</span>
                    </div>
                  </div>

                  {/* Quick angle presets */}
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '正面微仰', az: 0, el: 15 },
                      { label: '左侧45°', az: 270, el: 10 },
                      { label: '右侧45°', az: 90, el: 10 },
                      { label: '3/4视角', az: 35, el: 20 },
                      { label: '俯视30°', az: 0, el: 30 },
                      { label: '俯视60°', az: 0, el: 60 },
                      { label: '斜后45°', az: 210, el: 15 },
                      { label: '全俯视', az: 0, el: 90 },
                    ].map(preset => (
                      <button
                        key={preset.label}
                        onClick={() => { setCustomAzimuth(preset.az); setCustomElevation(preset.el); }}
                        className="px-2 py-1 rounded text-[10px] font-medium transition-all"
                        style={{
                          background: customAzimuth === preset.az && customElevation === preset.el ? accentBg : isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${customAzimuth === preset.az && customElevation === preset.el ? accentBorder : borderColorLight}`,
                          color: customAzimuth === preset.az && customElevation === preset.el ? accentColor : textMutedColor,
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
                          onClick={() => {
                            setSelectedModel(m.id);
                            setShowModelDropdown(false);
                            // Reset aspect ratio and quality when model changes
                            const pureModelId = m.id.includes('::') ? m.id.split('::').pop()! : m.id;
                            const supportedRatios = sharedFindModelConfig(SHARED_MODEL_ASPECT_RATIOS, pureModelId) || SHARED_DEFAULT_ASPECT_RATIOS;
                            setAspectRatio(supportedRatios[0] || '1:1');
                            const supportedQuals = sharedFindModelConfig(SHARED_MODEL_QUALITIES, pureModelId) || SHARED_DEFAULT_QUALITIES;
                            setQuality(supportedQuals[0] || 'standard');
                          }}
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

            {/* Aspect ratio selector - single row */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium flex items-center gap-1" style={{ color: textSubColor }}>
                <Ratio size={12} /> 画面比例
              </label>
              <div className="flex flex-wrap gap-1">
                {getSupportedAspectRatios().map(ratio => {
                  const isActive = aspectRatio === ratio;
                  return (
                    <button
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all"
                      style={{
                        background: isActive ? accentBg : isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${isActive ? accentBorder : borderColorLight}`,
                        color: isActive ? accentColor : textSubColor,
                      }}
                    >
                      {/* Inline mini ratio shape */}
                      <div
                        className="rounded-[1px]"
                        style={{
                          width: (() => {
                            const [w] = ratio.split(':').map(Number);
                            const h = Number(ratio.split(':')[1]);
                            const maxDim = 10;
                            return Math.max(4, (w / Math.max(w, h)) * maxDim);
                          })(),
                          height: (() => {
                            const [w, h] = ratio.split(':').map(Number);
                            const maxDim = 10;
                            return Math.max(4, (h / Math.max(w, h)) * maxDim);
                          })(),
                          border: `1px solid ${isActive ? accentColor : textMutedColor}`,
                          opacity: isActive ? 1 : 0.5,
                        }}
                      />
                      {ratio}
                    </button>
                  );
                })}
              </div>
              <div className="text-[10px]" style={{ color: textMutedColor }}>
                {getPixelSize(aspectRatio)}
              </div>
            </div>

            {/* Quality selector - single row */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium flex items-center gap-1" style={{ color: textSubColor }}>
                <BadgeCheck size={12} /> 画面质量
              </label>
              <div className="flex flex-wrap gap-1">
                {getSupportedQualities().map(q => {
                  const isActive = quality === q;
                  const displayName = SHARED_QUALITY_DISPLAY_NAMES[q] || q;
                  return (
                    <button
                      key={q}
                      onClick={() => setQuality(q)}
                      className="px-2.5 py-1 rounded text-[11px] font-medium transition-all text-center"
                      style={{
                        background: isActive ? accentBg : isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${isActive ? accentBorder : borderColorLight}`,
                        color: isActive ? accentColor : textSubColor,
                      }}
                    >
                      {displayName}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── Results Tab ─── */}
        {activeTab === 'results' && (
          <div className="p-4 space-y-4">
            {isProcessing ? (
              /* ── Processing: show aspect-ratio-matched placeholder ── */
              <div className="flex flex-col items-center gap-3">
                {/* Aspect-ratio-matched loading frame */}
                <div
                  className="w-full rounded-lg overflow-hidden flex items-center justify-center"
                  style={{
                    aspectRatio: (() => {
                      const [w, h] = aspectRatio.split(':').map(Number);
                      return `${w} / ${h}`;
                    })(),
                    background: isMonochrome ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)',
                    border: `1px dashed ${borderColorLight}`,
                    maxHeight: '320px',
                  }}
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className="relative">
                      <Loader2 size={28} className="animate-spin" style={{ color: accentColor }} />
                      <Sparkles size={12} className="absolute -top-0.5 -right-0.5 animate-pulse" style={{ color: accentColor }} />
                    </div>
                    <span className="text-xs" style={{ color: textMutedColor }}>{progressLabel || '精修处理中...'}</span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="w-full max-w-[220px] h-1.5 rounded-full overflow-hidden" style={{ background: borderColorLight }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${progress}%`, background: accentColor }}
                  />
                </div>
                <span className="text-[11px] font-mono" style={{ color: textMutedColor }}>{progress}%</span>
              </div>
            ) : results.length > 0 ? (
              /* ── Results: aspect-ratio-matched image frames ── */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: textSubColor }}>精修完成 · {results.length} 张</span>
                  <button
                    onClick={handleRefine}
                    className="text-[11px] flex items-center gap-1 transition-colors"
                    style={{ color: accentColor }}
                  >
                    <Sparkles size={11} /> 重新精修
                  </button>
                </div>

                {/* Result images in aspect-ratio frames */}
                <div className="space-y-3">
                  {results.map((r, i) => (
                    <div key={i} className="relative group">
                      {/* Aspect-ratio-matched image frame */}
                      <div
                        className="w-full rounded-lg overflow-hidden"
                        style={{
                          aspectRatio: (() => {
                            const [w, h] = aspectRatio.split(':').map(Number);
                            return `${w} / ${h}`;
                          })(),
                          border: `2px solid ${i === 0 ? accentBorder : borderColor}`,
                          maxHeight: '320px',
                          background: isMonochrome ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)',
                        }}
                      >
                        <img
                          src={r.imageUrl}
                          alt={r.label}
                          className="w-full h-full object-contain"
                          onLoad={() => console.log(`[refine-engine-panel] Image ${i} loaded:`, r.imageUrl.slice(0, 80))}
                          onError={(e) => console.error(`[refine-engine-panel] Image ${i} FAILED to load:`, r.imageUrl.slice(0, 80), e)}
                        />
                      </div>
                      {/* Hover overlay with add-to-canvas button */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                        <button
                          onClick={() => onAddImage?.(r.imageUrl)}
                          className="px-3 py-1.5 text-xs rounded-md text-white transition-colors flex items-center gap-1"
                          style={{ background: accentColor }}
                        >
                          <ImageIcon size={12} /> 添加到画布
                        </button>
                      </div>
                      {results.length > 1 && (
                        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ background: 'rgba(0,0,0,0.5)' }}>
                          {i + 1}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add all to canvas button */}
                <button
                  onClick={() => {
                    results.forEach(r => onAddImage?.(r.imageUrl));
                  }}
                  className="w-full py-2.5 rounded-md text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
                  style={{ background: accentColor }}
                  onMouseEnter={e => (e.currentTarget.style.background = accentHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = accentColor)}
                >
                  <ImageIcon size={14} />
                  {results.length === 1 ? '添加到画布' : `全部添加到画布 (${results.length})`}
                </button>
              </div>
            ) : (
              /* ── No results ── */
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
