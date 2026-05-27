'use client';

/**
 * AI PSD 生成器 — 浮动面板组件
 *
 * 对应文档：AI_PSD生成器_Lite_Pro_无界AI开发文档.md
 * 布局：三栏（左参数+中预览+右图层树），浮动可拖拽窗口
 * 主题：黑金配色，与品牌工厂/精修引擎一致
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, GripVertical, Layers, Image, Sparkles, FileImage,
  Upload, RotateCcw, Eye, EyeOff, ChevronDown, ChevronRight,
  Download, ZoomIn, Maximize2, Loader2, Check, Clock,
  Type, Palette, Box, Trash2, FileText, Archive, Info,
  Plus, Minus, RefreshCw
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────

interface ImageModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

interface LayerItem {
  layerId: string;
  name: string;
  v4Name: string;
  type: string;
  group: string;
  status: 'pending' | 'generating' | 'completed' | 'failed' | 'skipped';
  progress: number;
  imageUrl: string;
  opacity: number;
  visible: boolean;
  isUserAsset: boolean;
  blendMode: string;
}

interface QualityReport {
  overall: number;
  consistency: number;
  editability: number;
}

interface TaskData {
  taskId: string;
  status: string;
  progress: number;
  label: string;
  layerPlan: Record<string, unknown> | null;
  previewImageUrl: string;
  layers: LayerItem[];
  psdFileUrl: string;
  zipFileUrl: string;
  reportMarkdown: string;
  qualityReport: QualityReport | null;
  error?: string;
}

interface HistoryItem {
  taskId: string;
  name: string;
  layerCount: number;
  time: string;
  thumbnailUrl: string;
}

interface AiPsdPanelProps {
  onClose: () => void;
  onAddImages: (urls: string[]) => void;
}

// ─── Constants (aligned with dev doc) ─────────────────────────

const ASPECT_RATIOS = [
  { label: '1:1', value: '1:1', w: 1, h: 1 },
  { label: '4:3', value: '4:3', w: 4, h: 3 },
  { label: '3:4', value: '3:4', w: 3, h: 4 },
  { label: '16:9', value: '16:9', w: 16, h: 9 },
  { label: '9:16', value: '9:16', w: 9, h: 16 },
  { label: '3:2', value: '3:2', w: 3, h: 2 },
  { label: '2:3', value: '2:3', w: 2, h: 3 },
  { label: '21:9', value: '21:9', w: 21, h: 9 },
  { label: '自定义', value: 'custom', w: 0, h: 0 },
];

const USAGE_TYPES = ['海报', 'Banner', '电商主图', '详情页', '社媒封面', '广告素材', '包装设计', '画册'];

const STYLE_DIRECTIONS = [
  { label: '极简', value: 'minimal' },
  { label: '科技', value: 'tech' },
  { label: '自然', value: 'nature' },
  { label: '奢华', value: 'luxury' },
  { label: '复古', value: 'retro' },
  { label: '卡通', value: 'cartoon' },
  { label: '商务', value: 'business' },
  { label: '艺术', value: 'artistic' },
  { label: '潮流', value: 'trendy' },
  { label: '国风', value: 'chinese' },
];

const COLOR_TENDENCIES = [
  { label: '自动', value: 'auto' },
  { label: '暖色调', value: 'warm' },
  { label: '冷色调', value: 'cool' },
  { label: '中性色', value: 'neutral' },
  { label: '高对比', value: 'high-contrast' },
  { label: '低饱和', value: 'low-sat' },
  { label: '自定义', value: 'custom' },
];

const LAYER_COMPLEXITIES = [
  { label: '简洁', value: 'simple', desc: '5-6层' },
  { label: '标准', value: 'standard', desc: '8-10层' },
  { label: '精细', value: 'detailed', desc: '12-15层' },
];

const OUTPUT_QUALITIES = [
  { label: 'Lite', value: 'lite', desc: '标准质量' },
  { label: 'Pro', value: 'pro', desc: '高质量' },
  { label: 'Studio', value: 'studio', desc: '最高质量' },
];

const TEXT_LAYER_MODES = [
  { label: '图片层', value: 'image', desc: '文字光栅化为图片层' },
  { label: '可编辑层', value: 'editable', desc: '保留文字配置JSON' },
];

const GENERATE_MODES = [
  { key: 'text', label: '文本生成', icon: Type },
  { key: 'reference', label: '参考图生成', icon: Image },
  { key: 'brand', label: '品牌物料', icon: Palette },
];

const MATERIAL_TYPES = ['海报', 'Banner', '电商主图', '社媒封面', '广告素材', '名片', '画册封面', '易拉宝'];

// ─── Layer group definitions (V4 naming) ──────────────────────

const LAYER_GROUPS = [
  { key: 'bg', label: '背景层', icon: Box },
  { key: 'fx', label: '光效层', icon: Sparkles },
  { key: 'subject', label: '主体层', icon: Image },
  { key: 'deco', label: '装饰层', icon: Layers },
  { key: 'fx-atmosphere', label: '氛围层', icon: Sparkles },
  { key: 'text', label: '文字层', icon: Type },
];

const GENERATE_STEPS = [
  { key: 'planning', label: '图层规划' },
  { key: 'preview', label: '整图预览' },
  { key: 'layers', label: '逐层生成' },
  { key: 'export', label: '合成导出' },
];

// ─── Theme tokens (consistent with brand-factory/refine-engine) ──

const th = {
  panel: 'bg-[#1a1a1a] border border-white/[0.08] rounded-2xl shadow-2xl',
  header: 'bg-gradient-to-r from-[#1a1a1a] to-[#141414] border-b border-white/[0.08] rounded-t-2xl px-4 py-2.5',
  title: 'text-gray-100 font-semibold',
  text: 'text-gray-100',
  textSec: 'text-gray-400',
  textMuted: 'text-gray-500',
  border: 'border-white/[0.08]',
  borderLight: 'border-white/[0.06]',
  input: 'bg-[#111] border border-white/[0.08] rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-[#d4af37]/50 w-full',
  textarea: 'bg-[#111] border border-white/[0.08] rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-[#d4af37]/50 w-full resize-y',
  btn: 'bg-[#d4af37] text-black font-semibold rounded-lg px-4 py-2 hover:bg-[#e5c44a] transition-colors disabled:opacity-50',
  btnSm: 'bg-[#d4af37] text-black font-semibold rounded-lg px-3 py-1.5 text-xs hover:bg-[#e5c44a] transition-colors disabled:opacity-50',
  btnGhost: 'text-gray-400 hover:text-gray-100 hover:bg-white/[0.06] rounded-lg px-3 py-1.5 transition-colors',
  btnGhostSm: 'text-gray-400 hover:text-gray-100 hover:bg-white/[0.06] rounded-md px-2 py-1 text-xs transition-colors',
  card: 'bg-[#111] border border-white/[0.06] rounded-lg',
  select: 'bg-[#111] border border-white/[0.08] rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-[#d4af37]/50 appearance-none cursor-pointer w-full',
  sectionLabel: 'text-[11px] text-gray-500 uppercase tracking-wider mb-1.5',
  tag: 'px-2.5 py-1 rounded-lg text-xs cursor-pointer transition-colors select-none',
  tagActive: 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30',
  tagInactive: 'bg-white/[0.04] text-gray-400 border border-white/[0.06] hover:border-white/[0.12] hover:text-gray-300',
  gold: '#d4af37',
  goldLight: '#e5c44a',
};

// ─── Component ────────────────────────────────────────────────

export default function AiPsdPanel({ onClose, onAddImages }: AiPsdPanelProps) {
  // === Panel drag state ===
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // === Generate mode ===
  const [generateMode, setGenerateMode] = useState<'text' | 'reference' | 'brand'>('text');

  // === Left panel state ===
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [slogan, setSlogan] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [customWidth, setCustomWidth] = useState(1600);
  const [customHeight, setCustomHeight] = useState(900);
  const [usageType, setUsageType] = useState('海报');
  const [styleDirections, setStyleDirections] = useState<string[]>([]);
  const [colorTendency, setColorTendency] = useState('auto');
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [layerComplexity, setLayerComplexity] = useState('standard');
  const [outputQuality, setOutputQuality] = useState('pro');
  const [textLayerMode, setTextLayerMode] = useState('image');

  // === Asset upload state ===
  const [referenceImages, setReferenceImages] = useState<{ url: string; name: string }[]>([]);
  const [productImage, setProductImage] = useState<{ url: string; name: string } | null>(null);
  const [logoImage, setLogoImage] = useState<{ url: string; name: string } | null>(null);
  const [referenceStrength, setReferenceStrength] = useState(70);

  // === Brand material mode ===
  const [brandName, setBrandName] = useState('');
  const [brandSlogan, setBrandSlogan] = useState('');
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [brandFont, setBrandFont] = useState('');
  const [materialType, setMaterialType] = useState('海报');

  // === Model selection ===
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [llmModels, setLlmModels] = useState<ImageModel[]>([]);
  const [selectedImageModel, setSelectedImageModel] = useState('');
  const [selectedLlmModel, setSelectedLlmModel] = useState('');
  const [showModelPanel, setShowModelPanel] = useState(false);

  // === Task state ===
  const [taskId, setTaskId] = useState('');
  const [taskData, setTaskData] = useState<TaskData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0); // 0-3: planning/preview/layers/export
  const [layerProgress, setLayerProgress] = useState({ done: 0, total: 0 });

  // === Right panel state ===
  const [rightTab, setRightTab] = useState<'layers' | 'report'>('layers');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [previewScale, setPreviewScale] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // === Error state ===
  const [error, setError] = useState('');

  const PANEL_W = 1100;
  const PANEL_H = 720;

  // ─── Drag handlers ──────────────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPanelPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const handleUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => { document.removeEventListener('mousemove', handleMove); document.removeEventListener('mouseup', handleUp); };
  }, [isDragging]);

  // Center panel on mount
  useEffect(() => {
    setPanelPos({
      x: Math.max(0, (window.innerWidth - PANEL_W) / 2),
      y: Math.max(0, (window.innerHeight - PANEL_H) / 2),
    });
  }, []);

  // ─── Load models from admin system ────────────────────────
  useEffect(() => {
    fetch('/api/models?type=image')
      .then(r => r.json())
      .then(data => {
        const providers: { id: string; name: string; [k: string]: unknown }[] = data.providers || [];
        const providerMap = new Map(providers.map(p => [p.id, p]));
        const modelList: { id: string; name: string; providerId?: string }[] = data.models || [];
        if (modelList.length) {
          const mapped = modelList.map(m => {
            const prov = providerMap.get(m.providerId || '');
            return { id: m.id, name: m.name, providerId: m.providerId || '', providerName: prov?.name || '' };
          });
          setImageModels(mapped);
          const saved = localStorage.getItem('wujie_psd_image_model');
          if (saved && mapped.some(m => m.id === saved)) {
            setSelectedImageModel(saved);
          } else if (mapped.length) {
            setSelectedImageModel(mapped[0].id);
          }
        }
      })
      .catch(() => {});

    fetch('/api/models?type=chat')
      .then(r => r.json())
      .then(data => {
        const providers: { id: string; name: string; [k: string]: unknown }[] = data.providers || [];
        const providerMap = new Map(providers.map(p => [p.id, p]));
        const modelList: { id: string; name: string; providerId?: string }[] = data.models || [];
        if (modelList.length) {
          const mapped = modelList.map(m => {
            const prov = providerMap.get(m.providerId || '');
            return { id: m.id, name: m.name, providerId: m.providerId || '', providerName: prov?.name || '' };
          });
          setLlmModels(mapped);
          const saved = localStorage.getItem('wujie_psd_llm_model');
          if (saved && mapped.some(m => m.id === saved)) {
            setSelectedLlmModel(saved);
          } else if (mapped.length) {
            setSelectedLlmModel(mapped[0].id);
          }
        }
      })
      .catch(() => {});
  }, []);

  // ─── Poll task status ─────────────────────────────────────
  useEffect(() => {
    if (!taskId || !isGenerating) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/ai-psd/status?taskId=${taskId}`);
        const data = await res.json();
        if (data.success && data.task) {
          setTaskData(data.task);
          // Update step based on status
          if (data.task.status === 'completed') {
            setIsGenerating(false);
            setCurrentStep(3);
          } else if (data.task.status === 'failed') {
            setIsGenerating(false);
            setError(data.task.error || '任务失败');
          } else {
            // Map progress to step
            const p = data.task.progress;
            if (p <= 10) setCurrentStep(0);
            else if (p <= 25) setCurrentStep(1);
            else if (p <= 90) setCurrentStep(2);
            // Count layer progress
            const layers = data.task.layers || [];
            const done = layers.filter((l: LayerItem) => l.status === 'completed').length;
            setLayerProgress({ done, total: layers.length });
          }
        }
      } catch { /* ignore polling errors */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [taskId, isGenerating]);

  // ─── File upload handler ───────────────────────────────────
  const handleFileUpload = useCallback(async (
    files: FileList | null,
    target: 'reference' | 'product' | 'logo'
  ) => {
    if (!files || files.length === 0) return;
    setError('');

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 20 * 1024 * 1024) {
        setError('文件大小不能超过20MB');
        continue;
      }
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/save-image', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.url) {
          const item = { url: data.url, name: file.name };
          if (target === 'reference') {
            setReferenceImages(prev => [...prev, item]);
          } else if (target === 'product') {
            setProductImage(item);
          } else if (target === 'logo') {
            setLogoImage(item);
          }
        }
      } catch {
        setError('上传失败');
      }
    }
  }, []);

  // ─── Generate handler ─────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!prompt && generateMode === 'text') {
      setError('请输入创意描述');
      return;
    }
    setError('');
    setIsGenerating(true);
    setCurrentStep(0);
    setTaskData(null);
    setLayerProgress({ done: 0, total: 0 });

    try {
      const res = await fetch('/api/ai-psd/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: generateMode,
          prompt,
          title,
          subtitle,
          slogan,
          aspectRatio,
          customWidth,
          customHeight,
          usageType,
          styleDirections,
          colorTendency,
          customColors,
          layerComplexity,
          outputQuality,
          textLayerMode,
          imageModel: selectedImageModel,
          llmModel: selectedLlmModel,
          referenceImages: referenceImages.map(r => r.url),
          productImage: productImage?.url || '',
          logoImage: logoImage?.url || '',
          brandName,
          brandSlogan,
          brandColors,
          brandFont,
          materialType,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setTaskId(data.taskId);
      } else {
        setError(data.error || '创建任务失败');
        setIsGenerating(false);
      }
    } catch (err) {
      setError('网络错误');
      setIsGenerating(false);
    }
  }, [prompt, title, subtitle, slogan, aspectRatio, customWidth, customHeight, usageType,
    styleDirections, colorTendency, customColors, layerComplexity, outputQuality, textLayerMode,
    selectedImageModel, selectedLlmModel, referenceImages, productImage, logoImage,
    generateMode, brandName, brandSlogan, brandColors, brandFont, materialType]);

  // ─── Cancel handler ────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    if (!taskId) return;
    try {
      await fetch('/api/cancel-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
    } catch { /* ignore */ }
    setIsGenerating(false);
    setTaskData(null);
    setTaskId('');
  }, [taskId]);

  // ─── Reset handler ─────────────────────────────────────────
  const handleReset = useCallback(() => {
    setTaskData(null);
    setTaskId('');
    setIsGenerating(false);
    setCurrentStep(0);
    setError('');
  }, []);

  // ─── Download handler ──────────────────────────────────────
  const handleDownload = useCallback(async (format: 'psd' | 'zip' | 'json' | 'report') => {
    if (!taskData) return;
    const urlMap: Record<string, string> = {
      psd: taskData.psdFileUrl,
      zip: taskData.zipFileUrl,
    };
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(taskData.layerPlan, null, 2)], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `ai-psd-plan-${taskId}.json`;
      link.click();
      URL.revokeObjectURL(blobUrl);
      return;
    }
    if (format === 'report') {
      const blob = new Blob([taskData.reportMarkdown || ''], { type: 'text/markdown' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `ai-psd-report-${taskId}.md`;
      link.click();
      URL.revokeObjectURL(blobUrl);
      return;
    }
    const url = urlMap[format];
    if (url) {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `ai-psd-${taskId}.${format === 'psd' ? 'psd' : 'zip'}`;
      link.click();
      URL.revokeObjectURL(blobUrl);
    }
  }, [taskData, taskId]);

  // ─── Toggle style direction ────────────────────────────────
  const toggleStyle = useCallback((value: string) => {
    setStyleDirections(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  }, []);

  // ─── Toggle layer group collapse ───────────────────────────
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // ─── Toggle layer visibility ───────────────────────────────
  const toggleLayerVisibility = useCallback((layerId: string) => {
    setTaskData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        layers: prev.layers.map(l =>
          l.layerId === layerId ? { ...l, visible: !l.visible } : l
        ),
      };
    });
  }, []);

  // ─── Add custom color ──────────────────────────────────────
  const addCustomColor = useCallback(() => {
    setCustomColors(prev => [...prev, '#000000']);
  }, []);

  const updateCustomColor = useCallback((index: number, color: string) => {
    setCustomColors(prev => prev.map((c, i) => i === index ? color : c));
  }, []);

  const removeCustomColor = useCallback((index: number) => {
    setCustomColors(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ─── Derive view state ─────────────────────────────────────
  const isCompleted = taskData?.status === 'completed';
  const isIdle = !isGenerating && !isCompleted;
  const layers = taskData?.layers || [];
  const groupedLayers = LAYER_GROUPS.map(g => ({
    ...g,
    layers: layers.filter(l => {
      if (g.key === 'fx-atmosphere') return l.group === 'fx' && l.type === 'atmosphere';
      if (g.key === 'fx') return l.group === 'fx' && l.type !== 'atmosphere';
      return l.group === g.key;
    }),
  })).filter(g => g.layers.length > 0);

  // ─── Render helpers ────────────────────────────────────────

  const renderModelPanel = () => {
    if (!showModelPanel) return null;
    return (
      <div className={`${th.card} mx-3 mt-1 mb-2 p-3 space-y-3`}>
        <div>
          <label className={th.sectionLabel}>图像模型</label>
          <select className={th.select} value={selectedImageModel}
            onChange={e => { setSelectedImageModel(e.target.value); localStorage.setItem('wujie_psd_image_model', e.target.value); }}>
            <option value="">选择图像模型</option>
            {imageModels.map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.providerName})</option>
            ))}
          </select>
        </div>
        <div>
          <label className={th.sectionLabel}>LLM 模型</label>
          <select className={th.select} value={selectedLlmModel}
            onChange={e => { setSelectedLlmModel(e.target.value); localStorage.setItem('wujie_psd_llm_model', e.target.value); }}>
            <option value="">选择LLM模型</option>
            {llmModels.map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.providerName})</option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  // ─── Left panel: Parameter area ────────────────────────────
  const renderLeftPanel = () => (
    <div className="w-[320px] shrink-0 overflow-y-auto p-3 space-y-3" style={{ scrollbarWidth: 'thin' }}>
      {/* Generate mode tabs */}
      <div className="flex gap-1">
        {GENERATE_MODES.map(m => {
          const Icon = m.icon;
          return (
            <button key={m.key}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs transition-colors ${
                generateMode === m.key
                  ? 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30'
                  : 'bg-white/[0.04] text-gray-400 border border-white/[0.06] hover:text-gray-300'
              }`}
              onClick={() => setGenerateMode(m.key as 'text' | 'reference' | 'brand')}>
              <Icon className="w-3.5 h-3.5" />
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* Creative description */}
      <div>
        <label className={th.sectionLabel}>创意描述</label>
        <textarea className={th.textarea} rows={3} placeholder="描述你想要的画面效果..."
          value={prompt} onChange={e => setPrompt(e.target.value)} />
      </div>

      {/* Copywriting content */}
      <div>
        <label className={th.sectionLabel}>文案内容</label>
        <input className={`${th.input} mb-1.5`} placeholder="主标题" value={title}
          onChange={e => setTitle(e.target.value)} />
        <input className={`${th.input} mb-1.5`} placeholder="副标题" value={subtitle}
          onChange={e => setSubtitle(e.target.value)} />
        <input className={th.input} placeholder="Slogan / 广告语" value={slogan}
          onChange={e => setSlogan(e.target.value)} />
      </div>

      {/* Aspect ratio */}
      <div>
        <label className={th.sectionLabel}>画幅比例</label>
        <div className="flex flex-wrap gap-1.5">
          {ASPECT_RATIOS.map(r => (
            <button key={r.value}
              className={`${th.tag} ${
                aspectRatio === r.value ? th.tagActive : th.tagInactive
              }`}
              onClick={() => setAspectRatio(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
        {aspectRatio === 'custom' && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-gray-500 mb-0.5 block">宽度(px)</label>
              <input type="number" className={th.input} min={512} max={4096} value={customWidth}
                onChange={e => setCustomWidth(Math.min(4096, Math.max(512, parseInt(e.target.value) || 512)))} />
            </div>
            <ArrowRight className="w-4 h-4 text-gray-500 mt-4" />
            <div className="flex-1">
              <label className="text-[10px] text-gray-500 mb-0.5 block">高度(px)</label>
              <input type="number" className={th.input} min={512} max={4096} value={customHeight}
                onChange={e => setCustomHeight(Math.min(4096, Math.max(512, parseInt(e.target.value) || 512)))} />
            </div>
          </div>
        )}
        {aspectRatio === 'custom' && (
          <p className="text-[10px] text-gray-500 mt-1">范围 512-4096px，建议不超过 2048px 以保证生成速度</p>
        )}
      </div>

      {/* Usage type */}
      <div>
        <label className={th.sectionLabel}>用途类型</label>
        <div className="flex flex-wrap gap-1.5">
          {USAGE_TYPES.map(t => (
            <button key={t}
              className={`${th.tag} ${usageType === t ? th.tagActive : th.tagInactive}`}
              onClick={() => setUsageType(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Style direction (multi-select) */}
      <div>
        <label className={th.sectionLabel}>风格方向 <span className="text-gray-600 normal-case">(多选)</span></label>
        <div className="flex flex-wrap gap-1.5">
          {STYLE_DIRECTIONS.map(s => (
            <button key={s.value}
              className={`${th.tag} ${styleDirections.includes(s.value) ? th.tagActive : th.tagInactive}`}
              onClick={() => toggleStyle(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Color tendency */}
      <div>
        <label className={th.sectionLabel}>色彩倾向</label>
        <div className="flex flex-wrap gap-1.5">
          {COLOR_TENDENCIES.map(c => (
            <button key={c.value}
              className={`${th.tag} ${colorTendency === c.value ? th.tagActive : th.tagInactive}`}
              onClick={() => setColorTendency(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
        {colorTendency === 'custom' && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {customColors.map((color, i) => (
              <div key={i} className="relative">
                <input type="color" value={color}
                  className="w-7 h-7 rounded cursor-pointer border border-white/10"
                  onChange={e => updateCustomColor(i, e.target.value)} />
                <button className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center"
                  onClick={() => removeCustomColor(i)}>
                  <X className="w-2 h-2 text-white" />
                </button>
              </div>
            ))}
            <button className="w-7 h-7 rounded border border-dashed border-white/20 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:border-white/40"
              onClick={addCustomColor}>
              <Plus className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Layer complexity */}
      <div>
        <label className={th.sectionLabel}>图层复杂度</label>
        <div className="flex gap-1.5">
          {LAYER_COMPLEXITIES.map(c => (
            <button key={c.value}
              className={`flex-1 ${th.tag} ${layerComplexity === c.value ? th.tagActive : th.tagInactive}`}
              onClick={() => setLayerComplexity(c.value)}>
              <div>{c.label}</div>
              <div className="text-[10px] opacity-60">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Output quality */}
      <div>
        <label className={th.sectionLabel}>输出质量</label>
        <div className="flex gap-1.5">
          {OUTPUT_QUALITIES.map(q => (
            <button key={q.value}
              className={`flex-1 ${th.tag} ${outputQuality === q.value ? th.tagActive : th.tagInactive}`}
              onClick={() => setOutputQuality(q.value)}>
              <div>{q.label}</div>
              <div className="text-[10px] opacity-60">{q.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Text layer mode */}
      <div>
        <label className={th.sectionLabel}>文字生成方式</label>
        <div className="flex gap-1.5">
          {TEXT_LAYER_MODES.map(m => (
            <button key={m.value}
              className={`flex-1 ${th.tag} ${textLayerMode === m.value ? th.tagActive : th.tagInactive}`}
              onClick={() => setTextLayerMode(m.value)}>
              <div>{m.label}</div>
              <div className="text-[10px] opacity-60">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Reference image mode content */}
      {generateMode === 'reference' && (
        <div>
          <label className={th.sectionLabel}>参考图 <span className="text-[#d4af37] normal-case">(上传后保留原图)</span></label>
          <div className="space-y-2">
            {referenceImages.map((img, i) => (
              <div key={i} className={`${th.card} p-2 flex items-center gap-2`}>
                <img src={img.url} alt={img.name} className="w-10 h-10 rounded object-cover" />
                <span className="text-xs text-gray-400 flex-1 truncate">{img.name}</span>
                <button className="text-gray-500 hover:text-red-400" onClick={() => setReferenceImages(prev => prev.filter((_, j) => j !== i))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <label className={`${th.card} p-3 flex items-center justify-center gap-2 cursor-pointer hover:border-[#d4af37]/30 transition-colors`}>
              <Upload className="w-4 h-4 text-gray-500" />
              <span className="text-xs text-gray-400">上传参考图</span>
              <input type="file" className="hidden" accept="image/*" multiple
                onChange={e => handleFileUpload(e.target.files, 'reference')} />
            </label>
            {referenceImages.length > 0 && (
              <div>
                <label className="text-[10px] text-gray-500">参考强度</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={100} value={referenceStrength}
                    className="flex-1 accent-[#d4af37]"
                    onChange={e => setReferenceStrength(parseInt(e.target.value))} />
                  <span className="text-xs text-gray-400 w-8 text-right">{referenceStrength}%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Brand material mode content */}
      {generateMode === 'brand' && (
        <>
          <div>
            <label className={th.sectionLabel}>品牌名称</label>
            <input className={th.input} placeholder="品牌名称" value={brandName}
              onChange={e => setBrandName(e.target.value)} />
          </div>
          <div>
            <label className={th.sectionLabel}>品牌 Slogan</label>
            <input className={th.input} placeholder="品牌广告语" value={brandSlogan}
              onChange={e => setBrandSlogan(e.target.value)} />
          </div>
          <div>
            <label className={th.sectionLabel}>品牌色板</label>
            <div className="flex items-center gap-2 flex-wrap">
              {brandColors.map((color, i) => (
                <div key={i} className="relative">
                  <input type="color" value={color}
                    className="w-7 h-7 rounded cursor-pointer border border-white/10"
                    onChange={e => setBrandColors(prev => prev.map((c, j) => j === i ? e.target.value : c))} />
                  <button className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center"
                    onClick={() => setBrandColors(prev => prev.filter((_, j) => j !== i))}>
                    <X className="w-2 h-2 text-white" />
                  </button>
                </div>
              ))}
              <button className="w-7 h-7 rounded border border-dashed border-white/20 flex items-center justify-center text-gray-500 hover:text-gray-300"
                onClick={() => setBrandColors(prev => [...prev, '#000000'])}>
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div>
            <label className={th.sectionLabel}>品牌字体</label>
            <input className={th.input} placeholder="如: 思源黑体, Helvetica..." value={brandFont}
              onChange={e => setBrandFont(e.target.value)} />
          </div>
          <div>
            <label className={th.sectionLabel}>物料类型</label>
            <div className="flex flex-wrap gap-1.5">
              {MATERIAL_TYPES.map(t => (
                <button key={t}
                  className={`${th.tag} ${materialType === t ? th.tagActive : th.tagInactive}`}
                  onClick={() => setMaterialType(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Product image + Logo (all modes) */}
      <div>
        <label className={th.sectionLabel}>产品图 <span className="text-[#d4af37] normal-case">(原图保留)</span></label>
        {productImage ? (
          <div className={`${th.card} p-2 flex items-center gap-2`}>
            <img src={productImage.url} alt={productImage.name} className="w-10 h-10 rounded object-cover" />
            <span className="text-xs text-gray-400 flex-1 truncate">{productImage.name}</span>
            <button className="text-gray-500 hover:text-red-400" onClick={() => setProductImage(null)}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <label className={`${th.card} p-3 flex items-center justify-center gap-2 cursor-pointer hover:border-[#d4af37]/30 transition-colors`}>
            <Upload className="w-4 h-4 text-gray-500" />
            <span className="text-xs text-gray-400">上传产品图</span>
            <input type="file" className="hidden" accept="image/*"
              onChange={e => handleFileUpload(e.target.files, 'product')} />
          </label>
        )}
      </div>

      <div>
        <label className={th.sectionLabel}>Logo <span className="text-[#d4af37] normal-case">(原图保留)</span></label>
        {logoImage ? (
          <div className={`${th.card} p-2 flex items-center gap-2`}>
            <img src={logoImage.url} alt={logoImage.name} className="w-10 h-10 rounded object-cover" />
            <span className="text-xs text-gray-400 flex-1 truncate">{logoImage.name}</span>
            <button className="text-gray-500 hover:text-red-400" onClick={() => setLogoImage(null)}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <label className={`${th.card} p-3 flex items-center justify-center gap-2 cursor-pointer hover:border-[#d4af37]/30 transition-colors`}>
            <Upload className="w-4 h-4 text-gray-500" />
            <span className="text-xs text-gray-400">上传 Logo</span>
            <input type="file" className="hidden" accept="image/*"
              onChange={e => handleFileUpload(e.target.files, 'logo')} />
          </label>
        )}
      </div>
    </div>
  );

  // ─── Center: Preview area ──────────────────────────────────
  const renderPreviewArea = () => {
    // Empty state
    if (isIdle && !taskData) {
      return (
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center p-6">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-4">
            <Layers className="w-8 h-8 text-gray-600" />
          </div>
          <p className="text-sm text-gray-400 mb-2">AI PSD 分层生成器</p>
          <p className="text-xs text-gray-500 mb-6">输入参数后点击生成，自动规划图层并逐层生成</p>
          {/* Flow steps */}
          <div className="flex items-center gap-3">
            {GENERATE_STEPS.map((step, i) => (
              <React.Fragment key={step.key}>
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                    <span className="text-[10px] text-gray-500">{i + 1}</span>
                  </div>
                  <span className="text-[10px] text-gray-500 mt-1">{step.label}</span>
                </div>
                {i < GENERATE_STEPS.length - 1 && (
                  <div className="w-6 h-px bg-white/[0.08] mb-4" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      );
    }

    // Generating state
    if (isGenerating) {
      return (
        <div className="flex-1 min-w-0 flex flex-col p-4">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-4">
            {GENERATE_STEPS.map((step, i) => (
              <React.Fragment key={step.key}>
                <div className="flex items-center gap-1.5">
                  {i < currentStep ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : i === currentStep ? (
                    <Loader2 className="w-4 h-4 text-[#d4af37] animate-spin" />
                  ) : (
                    <Clock className="w-4 h-4 text-gray-600" />
                  )}
                  <span className={`text-xs ${i < currentStep ? 'text-green-400' : i === currentStep ? 'text-[#d4af37]' : 'text-gray-600'}`}>
                    {step.label}
                  </span>
                </div>
                {i < GENERATE_STEPS.length - 1 && (
                  <div className="flex-1 h-px bg-white/[0.08]" />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-400">{taskData?.label || '处理中...'}</span>
              <span className="text-[#d4af37]">{taskData?.progress || 0}%</span>
            </div>
            <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#d4af37] to-[#e5c44a] rounded-full transition-all duration-500"
                style={{ width: `${taskData?.progress || 0}%` }} />
            </div>
          </div>

          {/* Layer progress */}
          {currentStep === 2 && layerProgress.total > 0 && (
            <div className="mb-3 text-xs text-gray-400">
              逐层生成中: {layerProgress.done}/{layerProgress.total} 层
            </div>
          )}

          {/* Preview image if available */}
          {taskData?.previewImageUrl ? (
            <div className="flex-1 flex items-center justify-center bg-black/20 rounded-lg overflow-hidden">
              <img src={taskData.previewImageUrl} alt="预览"
                className="max-w-full max-h-full object-contain rounded" />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-black/20 rounded-lg">
              <div className="flex flex-col items-center">
                <Loader2 className="w-8 h-8 text-[#d4af37] animate-spin mb-2" />
                <p className="text-xs text-gray-500">正在生成预览...</p>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Completed state
    if (isCompleted) {
      return (
        <div className="flex-1 min-w-0 flex flex-col p-4">
          <div className="flex items-center gap-2 mb-3">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-xs text-green-400">生成完成</span>
          </div>
          {taskData?.previewImageUrl ? (
            <div className="flex-1 flex items-center justify-center bg-black/20 rounded-lg overflow-hidden relative">
              <img src={taskData.previewImageUrl} alt="预览"
                className="max-w-full max-h-full object-contain rounded"
                style={{ transform: `scale(${previewScale})` }} />
              {/* Zoom controls */}
              <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 rounded-lg p-1">
                <button className="p-1 text-gray-400 hover:text-white" onClick={() => setPreviewScale(s => Math.max(0.25, s - 0.25))}>
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] text-gray-400 w-10 text-center">{Math.round(previewScale * 100)}%</span>
                <button className="p-1 text-gray-400 hover:text-white" onClick={() => setPreviewScale(s => Math.min(3, s + 0.25))}>
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button className="p-1 text-gray-400 hover:text-white" onClick={() => setPreviewScale(1)}>
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-black/20 rounded-lg">
              <FileImage className="w-12 h-12 text-gray-600" />
            </div>
          )}
        </div>
      );
    }

    // Failed state
    if (error && !isGenerating) {
      return (
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center p-6">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
            <X className="w-6 h-6 text-red-400" />
          </div>
          <p className="text-sm text-red-400 mb-2">生成失败</p>
          <p className="text-xs text-gray-500 mb-4">{error}</p>
          <button className={th.btnSm} onClick={handleReset}>重新开始</button>
        </div>
      );
    }

    return null;
  };

  // ─── Right panel: Layer tree / Report ──────────────────────
  const renderRightPanel = () => (
    <div className="w-[220px] shrink-0 flex flex-col border-l border-white/[0.06] bg-[#141414]">
      {/* Tab switcher */}
      <div className="flex border-b border-white/[0.06]">
        <button className={`flex-1 py-2 text-xs transition-colors ${
          rightTab === 'layers' ? 'text-[#d4af37] border-b-2 border-[#d4af37]' : 'text-gray-500 hover:text-gray-300'
        }`} onClick={() => setRightTab('layers')}>
          图层
        </button>
        <button className={`flex-1 py-2 text-xs transition-colors ${
          rightTab === 'report' ? 'text-[#d4af37] border-b-2 border-[#d4af37]' : 'text-gray-500 hover:text-gray-300'
        }`} onClick={() => setRightTab('report')}>
          报告
        </button>
      </div>

      {rightTab === 'layers' ? renderLayerTree() : renderReport()}
    </div>
  );

  const renderLayerTree = () => {
    if (layers.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <Layers className="w-8 h-8 text-gray-600 mb-2" />
          <p className="text-xs text-gray-500">生成后显示图层树</p>
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ scrollbarWidth: 'thin' }}>
        {groupedLayers.map(group => {
          const Icon = group.icon;
          const isCollapsed = collapsedGroups.has(group.key);
          return (
            <div key={group.key}>
              <button className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-300 hover:bg-white/[0.04] rounded transition-colors"
                onClick={() => toggleGroup(group.key)}>
                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                <Icon className="w-3 h-3 text-gray-500" />
                <span className="flex-1 text-left">{group.label}</span>
                <span className="text-[10px] text-gray-600">{group.layers.length}</span>
              </button>
              {!isCollapsed && group.layers.map(layer => (
                <div key={layer.layerId}
                  className="flex items-center gap-1.5 pl-7 pr-2 py-1.5 text-[11px] hover:bg-white/[0.04] rounded group transition-colors">
                  {/* Visibility toggle */}
                  <button className="text-gray-500 hover:text-gray-300"
                    onClick={() => toggleLayerVisibility(layer.layerId)}>
                    {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
                  {/* Layer status icon */}
                  {layer.status === 'completed' && <Check className="w-3 h-3 text-green-400" />}
                  {layer.status === 'generating' && <Loader2 className="w-3 h-3 text-[#d4af37] animate-spin" />}
                  {layer.status === 'pending' && <Clock className="w-3 h-3 text-gray-600" />}
                  {layer.status === 'failed' && <X className="w-3 h-3 text-red-400" />}
                  {/* V4 name */}
                  <span className="flex-1 truncate text-gray-400" title={layer.name}>{layer.v4Name || layer.name}</span>
                  {/* Regenerate button (not for user assets) */}
                  {!layer.isUserAsset && isCompleted && (
                    <button className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-[#d4af37] transition-all"
                      title="重新生成此层">
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  const renderReport = () => {
    if (!taskData) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <FileText className="w-8 h-8 text-gray-600 mb-2" />
          <p className="text-xs text-gray-500">生成后显示质量报告</p>
        </div>
      );
    }

    const report = taskData.qualityReport;
    return (
      <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ scrollbarWidth: 'thin' }}>
        {/* Task info */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-500">任务ID</span>
            <span className="text-gray-300 font-mono">{taskId.slice(0, 16)}...</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-500">生成模式</span>
            <span className="text-gray-300">{GENERATE_MODES.find(m => m.key === generateMode)?.label}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-500">画幅比例</span>
            <span className="text-gray-300">{aspectRatio === 'custom' ? `${customWidth}x${customHeight}` : aspectRatio}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-500">图层数</span>
            <span className="text-gray-300">{layers.length}</span>
          </div>
        </div>

        {/* Quality scores */}
        {report && (
          <div className={`${th.card} p-3 space-y-2`}>
            <h4 className="text-xs text-gray-300 font-medium">质量评分</h4>
            {[
              { label: '整体质量', value: report.overall },
              { label: '一致性', value: report.consistency },
              { label: '可编辑性', value: report.editability },
            ].map(item => (
              <div key={item.label}>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-gray-400">{item.label}</span>
                  <span className={item.value >= 80 ? 'text-green-400' : item.value >= 60 ? 'text-yellow-400' : 'text-red-400'}>
                    {item.value}
                  </span>
                </div>
                <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${item.value}%`,
                      backgroundColor: item.value >= 80 ? '#4ade80' : item.value >= 60 ? '#facc15' : '#f87171',
                    }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Download report */}
        {isCompleted && (
          <button className={`${th.btnGhostSm} w-full flex items-center justify-center gap-1.5`}
            onClick={() => handleDownload('report')}>
            <Download className="w-3 h-3" />
            <span>下载报告</span>
          </button>
        )}
      </div>
    );
  };

  // ─── Bottom action bar ─────────────────────────────────────
  const renderBottomBar = () => (
    <div className={`${th.border} border-t px-4 py-2.5 flex items-center gap-2`}>
      {isIdle && (
        <button className={`${th.btn} flex-1 flex items-center justify-center gap-2`}
          onClick={handleGenerate}
          disabled={!prompt && generateMode === 'text'}>
          <Sparkles className="w-4 h-4" />
          <span>开始生成</span>
        </button>
      )}
      {isGenerating && (
        <>
          <div className="flex-1 flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-[#d4af37] animate-spin" />
            <span className="text-xs text-gray-400">{taskData?.label || '处理中...'}</span>
            <span className="text-xs text-[#d4af37]">{taskData?.progress || 0}%</span>
          </div>
          <button className={`${th.btnGhostSm} text-red-400 hover:text-red-300`}
            onClick={handleCancel}>
            取消
          </button>
        </>
      )}
      {isCompleted && (
        <>
          <div className="flex items-center gap-1.5 mr-2">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-xs text-green-400">已完成 · {layers.length} 层</span>
          </div>
          <div className="flex-1" />
          <button className={`${th.btnGhostSm} flex items-center gap-1`}
            onClick={() => handleDownload('psd')}>
            <Download className="w-3 h-3" />
            PSD
          </button>
          <button className={`${th.btnGhostSm} flex items-center gap-1`}
            onClick={() => handleDownload('zip')}>
            <Archive className="w-3 h-3" />
            ZIP
          </button>
          <button className={`${th.btnGhostSm} flex items-center gap-1`}
            onClick={() => handleDownload('json')}>
            <FileText className="w-3 h-3" />
            JSON
          </button>
          {taskData?.previewImageUrl && (
            <button className={th.btnSm}
              onClick={() => onAddImages([taskData.previewImageUrl])}>
              添加到画布
            </button>
          )}
          <button className={`${th.btnGhostSm} flex items-center gap-1`}
            onClick={handleReset}>
            <RotateCcw className="w-3 h-3" />
            重新开始
          </button>
        </>
      )}
    </div>
  );

  // ─── Main render ───────────────────────────────────────────
  return (
    <div
      ref={panelRef}
      className={`fixed z-[90] ${isDragging ? 'cursor-grabbing' : ''}`}
      style={{ left: panelPos.x, top: panelPos.y, width: PANEL_W }}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      <div
        data-floating-panel="true"
        className={`${th.panel} flex flex-col ${isDragging ? 'ring-2 ring-[#d4af37]/30 shadow-[0_0_30px_rgba(212,175,55,0.15)]' : ''}`}
        style={{ maxHeight: '85vh' }}
      >
        {/* Header with drag handle */}
        <div className={`${th.header} flex items-center gap-2 cursor-grab active:cursor-grabbing select-none`}
          onMouseDown={handleDragStart}>
          <GripVertical className="w-4 h-4 text-gray-500" />
          <Layers className="w-4 h-4 text-[#d4af37]" />
          <span className={`${th.title} text-sm flex-1`}>AI PSD 生成器</span>
          {taskId && <span className="text-[10px] text-[#d4af37] bg-[#d4af37]/10 px-2 py-0.5 rounded font-mono">{taskId.slice(0, 12)}</span>}
          {/* History button */}
          <button className={`${th.btnGhost} flex items-center gap-1 text-[10px] ${showHistory ? 'text-[#d4af37]' : ''}`}
            onClick={e => { e.stopPropagation(); setShowHistory(!showHistory); }}>
            <Clock className="w-3 h-3" />
            <span>历史</span>
          </button>
          {/* Model toggle button */}
          <button className={`${th.btnGhost} flex items-center gap-1 text-[10px] ${showModelPanel ? 'text-[#d4af37]' : ''}`}
            onClick={e => { e.stopPropagation(); setShowModelPanel(!showModelPanel); }}>
            <Box className="w-3 h-3" />
            <span>模型</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showModelPanel ? 'rotate-180' : ''}`} />
          </button>
          <button className={`${th.btnGhost} p-1`} onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {/* Model selection dropdown */}
        {renderModelPanel()}

        {/* Error bar */}
        {error && isGenerating && (
          <div className="bg-red-500/10 text-red-400 text-xs p-2 mx-3 mt-1 rounded">{error}</div>
        )}

        {/* Body: Three columns */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: Parameters */}
          <div className="overflow-y-auto border-r border-white/[0.06]" style={{ scrollbarWidth: 'thin' }}>
            {renderLeftPanel()}
          </div>

          {/* Center: Preview */}
          {renderPreviewArea()}

          {/* Right: Layer tree / Report */}
          {renderRightPanel()}
        </div>

        {/* Bottom action bar */}
        {renderBottomBar()}
      </div>
    </div>
  );
}

// Helper component used in custom ratio
function ArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}
