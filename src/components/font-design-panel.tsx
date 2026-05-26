'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Sparkles, Copy, Image as ImageIcon, Download, Loader2,
  ChevronDown, ChevronUp, RefreshCw, Star, Cpu, Wand2,
  Check, Shuffle, Trash2, Clock, Plus, GripVertical, Minus, PenTool,
} from 'lucide-react';

interface StyleSubCategory { id: string; name: string; prompt: string; }
interface StyleCategory { id: string; name: string; subStyles: StyleSubCategory[]; }
interface SceneOption { id: string; name: string; description: string; }
interface DesignPlan {
  title: string; stylePositioning: string; glyphFeatures: string;
  strokeAdvice: string; graphicFusion: string; colorMaterial: string;
  applicableScene: string; recommendIndex: number;
}
interface ImageModel { id: string; name: string; providerId: string; providerName: string; }
interface HistoryItem {
  id: string; text: string; scene: string; style: string;
  prompt: string; imageUrl?: string; createdAt: string;
}

interface FontDesignPanelProps {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[]) => void;
}

const RANDOM_EXAMPLES = [
  '好好养自己', '无界AI', '门槛', '大梦一场', '破晓',
  '云上书屋', '万物生长', '山海经', '一杯春', '月半小夜曲',
  '浮生六记', '食光食堂', '如故', '一念之间', '潮汐',
];

const RATIO_OPTIONS = [
  { id: '16:9', name: '横版 16:9', icon: '▬' },
  { id: '1:1', name: '正方形 1:1', icon: '▣' },
  { id: '9:16', name: '竖版 9:16', icon: '▮' },
  { id: 'logo', name: '透明Logo', icon: '◇' },
];

const COLOR_OPTIONS = [
  { id: '白色', color: '#ffffff', border: '#888' },
  { id: '黑色', color: '#1a1a1a', border: '#555' },
  { id: '金色', color: '#d4af37', border: '#d4af37' },
  { id: '红色', color: '#dc2626', border: '#dc2626' },
  { id: '黑金', color: 'linear-gradient(135deg,#1a1a1a,#d4af37)', border: '#d4af37' },
  { id: '红金', color: 'linear-gradient(135deg,#dc2626,#d4af37)', border: '#d4af37' },
  { id: '银色', color: '#c0c0c0', border: '#999' },
  { id: '渐变', color: 'linear-gradient(135deg,#667eea,#764ba2)', border: '#764ba2' },
  { id: '霓虹蓝', color: '#00d4ff', border: '#00d4ff' },
  { id: '暖橙', color: '#f97316', border: '#f97316' },
];

const BACKGROUND_OPTIONS = ['纯色背景', '透明背景', '高级留白', '商业KV背景', '暗黑背景', '黑金背景'];

export default function FontDesignPanel({ isMonochrome = false, onClose, onAddImages }: FontDesignPanelProps) {
  const [text, setText] = useState('好好养自己');
  const [scene, setScene] = useState('KV主标题');
  const [primaryStyleCategory, setPrimaryStyleCategory] = useState('smart-recommend');
  const [secondaryStyle, setSecondaryStyle] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [ratio, setRatio] = useState('16:9');
  const [color, setColor] = useState('黑金');
  const [background, setBackground] = useState('高级留白');
  const [material, setMaterial] = useState('平面矢量');
  const [strokeOptions, setStrokeOptions] = useState<string[]>([]);
  const [graphicElements, setGraphicElements] = useState<string[]>([]);
  const [jimengEnhanced, setJimengEnhanced] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [activeTab, setActiveTab] = useState<'plans' | 'prompt' | 'images' | 'history'>('plans');
  const [plans, setPlans] = useState<DesignPlan[]>([]);
  const [prompts, setPrompts] = useState<{ prompt: string; shortPrompt: string; enhancedPrompt: string; blackOnWhitePrompt: string; transparentLogoPrompt: string } | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageTaskId, setImageTaskId] = useState<string | null>(null);

  const [styleCategories, setStyleCategories] = useState<StyleCategory[]>([]);
  const [scenes, setScenes] = useState<SceneOption[]>([]);
  const [strokeOptionList, setStrokeOptionList] = useState<{ id: string; name: string }[]>([]);
  const [graphicOptionList, setGraphicOptionList] = useState<{ id: string; name: string }[]>([]);
  const [materialList, setMaterialList] = useState<{ id: string; name: string }[]>([]);
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [copiedToast, setCopiedToast] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // ─── Drag state ───
  const panelWidth = 1100;
  const panelHeight = 720;
  const [position, setPosition] = useState(() => {
    if (typeof window !== 'undefined') {
      return { x: (window.innerWidth - panelWidth) / 2, y: (window.innerHeight - panelHeight) / 2 };
    }
    return { x: 0, y: 0 };
  });
  const [hasPosition, setHasPosition] = useState(true);
  const isDragging = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

  useEffect(() => {
    fetch('/api/font-design/plan')
      .then(r => r.json())
      .then(data => {
        if (data.styleCategories) setStyleCategories(data.styleCategories);
        if (data.scenes) setScenes(data.scenes);
        if (data.strokeOptions) setStrokeOptionList(data.strokeOptions);
        if (data.graphicElements) setGraphicOptionList(data.graphicElements);
        if (data.materials) setMaterialList(data.materials);
      })
      .catch(() => {});

    fetch('/api/models?type=image')
      .then(r => r.json())
      .then(data => {
        // Build providerId -> providerName mapping from providers array
        const providerMap = new Map<string, string>();
        if (data.providers && Array.isArray(data.providers)) {
          for (const p of data.providers) {
            providerMap.set(p.id, p.displayName || p.name || p.id);
          }
        }
        const models: ImageModel[] = (data.models || []).map((m: { id: string; name: string; providerId: string }) => ({
          id: m.id, name: m.name, providerId: m.providerId,
          providerName: providerMap.get(m.providerId) || m.providerId,
        }));
        setImageModels(models);
        if (models.length > 0 && !selectedModel) setSelectedModel(models[0].id);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!imageTaskId || !isGeneratingImage) return;
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: imageTaskId, model: selectedModel }),
        });
        const data = await res.json();
        if (data.status === 'completed') {
          const urls = data.result?.directImageUrls || (data.imageUrl ? [data.imageUrl] : []);
          setGeneratedImages(prev => [...prev, ...urls]);
          setIsGeneratingImage(false);
          setImageTaskId(null);
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        } else if (data.status === 'failed') {
          setIsGeneratingImage(false);
          setImageTaskId(null);
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      } catch { /* continue polling */ }
    }, 3000);
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, [imageTaskId, isGeneratingImage, selectedModel]);

  const handleRandomExample = useCallback(() => {
    setText(RANDOM_EXAMPLES[Math.floor(Math.random() * RANDOM_EXAMPLES.length)]);
  }, []);

  const toggleStroke = useCallback((name: string) => {
    setStrokeOptions(prev => prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]);
  }, []);

  const toggleGraphic = useCallback((name: string) => {
    setGraphicElements(prev => prev.includes(name) ? prev.filter(g => g !== name) : [...prev, name]);
  }, []);

  const showToast = useCallback((msg: string) => {
    setCopiedToast(msg);
    setTimeout(() => setCopiedToast(null), 2000);
  }, []);

  const copyToClipboard = useCallback(async (content: string, label: string) => {
    try { await navigator.clipboard.writeText(content); showToast(`${label}已复制`); }
    catch { showToast('复制失败'); }
  }, [showToast]);

  const handleGeneratePlans = useCallback(async () => {
    if (!text.trim()) return;
    setIsGeneratingPlan(true);
    setActiveTab('plans');
    try {
      const res = await fetch('/api/font-design/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, scene, primaryStyleCategory, secondaryStyle,
          ratio: RATIO_OPTIONS.find(r => r.id === ratio)?.name || ratio,
          color, background, strokeOptions, graphicElements, material, jimengEnhanced,
        }),
      });
      const data = await res.json();
      if (data.error) { showToast(data.error); return; }
      setPlans(data.plans || []);
      setPrompts({ prompt: data.prompt || '', shortPrompt: data.shortPrompt || '', enhancedPrompt: data.enhancedPrompt || '', blackOnWhitePrompt: data.shortPrompt || '', transparentLogoPrompt: '' });
    } catch { showToast('生成方案失败'); }
    finally { setIsGeneratingPlan(false); }
  }, [text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced, showToast]);

  const handleGeneratePrompt = useCallback(async () => {
    if (!text.trim()) return;
    setIsGeneratingPrompt(true);
    setActiveTab('prompt');
    try {
      const res = await fetch('/api/font-design/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, scene, primaryStyleCategory, secondaryStyle,
          ratio: RATIO_OPTIONS.find(r => r.id === ratio)?.name || ratio,
          color, background, strokeOptions, graphicElements, material, jimengEnhanced,
        }),
      });
      const data = await res.json();
      if (data.error) { showToast(data.error); return; }
      setPrompts({ prompt: data.prompt || '', shortPrompt: data.shortPrompt || '', enhancedPrompt: data.enhancedPrompt || '', blackOnWhitePrompt: data.blackOnWhitePrompt || '', transparentLogoPrompt: data.transparentLogoPrompt || '' });
    } catch { showToast('生成提示词失败'); }
    finally { setIsGeneratingPrompt(false); }
  }, [text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced, showToast]);

  const handleGenerateImage = useCallback(async (mode: 'full' | 'black-on-white' | 'transparent-logo' = 'full') => {
    if (!text.trim()) return;
    setIsGeneratingImage(true);
    setGeneratedImages([]);
    setActiveTab('images');
    try {
      const res = await fetch('/api/font-design/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, scene, primaryStyleCategory, secondaryStyle,
          ratio: mode === 'transparent-logo' ? '1:1' : ratio,
          color, background, strokeOptions, graphicElements, material, jimengEnhanced,
          model: selectedModel, mode, count: 1,
        }),
      });
      const data = await res.json();
      if (data.error) { showToast(data.error); setIsGeneratingImage(false); return; }
      setImageTaskId(data.taskId);
      if (data.prompt) {
        setPrompts(prev => prev ? { ...prev, prompt: data.prompt } : { prompt: data.prompt, shortPrompt: '', enhancedPrompt: '', blackOnWhitePrompt: '', transparentLogoPrompt: '' });
      }
      setHistory(prev => [{ id: `h-${Date.now()}`, text, scene, style: secondaryStyle || primaryStyleCategory, prompt: data.prompt || '', createdAt: new Date().toLocaleString() }, ...prev]);
    } catch { showToast('生成图片失败'); setIsGeneratingImage(false); }
  }, [text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced, selectedModel, showToast]);

  const handleAddToCanvas = useCallback((url: string) => { onAddImages?.([url]); }, [onAddImages]);

  const currentCategory = styleCategories.find(c => c.id === primaryStyleCategory);
  const accentColor = isMonochrome ? '#3b82f6' : '#d4af37';
  const bgPanel = isMonochrome ? '#ffffff' : '#0f0f0f';
  const cardBgColor = isMonochrome ? '#f9fafb' : '#141414';
  const borderColor = isMonochrome ? '#e5e7eb' : '#1a1a1a';
  const borderColorLight = isMonochrome ? '#d1d5db' : '#2a2a2a';
  const textColor = isMonochrome ? '#111827' : '#f5f5f5';
  const subTextColor = isMonochrome ? '#6b7280' : '#a1a1aa';
  const mutedColor = isMonochrome ? '#9ca3af' : '#4b5563';
  const shadow = isMonochrome ? '0 8px 32px rgba(0,0,0,0.12)' : '0 0 60px rgba(0,0,0,0.6), 0 0 20px rgba(212,175,55,0.05)';
  const dragShadow = isMonochrome ? '0 0 24px rgba(37,99,235,0.25), 0 8px 32px rgba(0,0,0,0.12)' : '0 0 24px rgba(212,175,55,0.3), 0 8px 32px rgba(0,0,0,0.5)';

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 10px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 500,
    border: `1px solid ${active ? accentColor : borderColorLight}`,
    background: active ? (isMonochrome ? 'rgba(59,130,246,0.1)' : 'rgba(212,175,55,0.15)') : cardBgColor,
    color: active ? accentColor : subTextColor,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
  });

  const subChipStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 500,
    border: `1px solid ${active ? accentColor : borderColorLight}`,
    background: active ? (isMonochrome ? 'rgba(59,130,246,0.08)' : 'rgba(212,175,55,0.1)') : cardBgColor,
    color: active ? accentColor : subTextColor,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap' as const,
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    background: isMonochrome ? '#f9fafb' : '#0a0a0a',
    border: `1px solid ${borderColorLight}`,
    color: textColor,
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  const goldBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    background: `linear-gradient(135deg, ${accentColor}, ${isMonochrome ? '#2563eb' : '#8b7225'})`,
    color: isMonochrome ? '#ffffff' : '#0a0a0a',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
  };

  const secondaryBtnStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 500,
    border: `1px solid ${borderColorLight}`,
    background: isMonochrome ? '#f9fafb' : '#1c1c1c',
    color: accentColor,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  };

  const tabLabels: Record<string, string> = { plans: '设计方案', prompt: '即梦提示词', images: '生成图片', history: '历史记录' };

  return (
    <div
      ref={panelRef}
      data-floating-panel
      className="fixed z-[150]"
      style={{
        left: position.x,
        top: position.y,
        width: panelWidth,
        maxHeight: isMinimized ? undefined : '85vh',
        borderRadius: 12,
        backgroundColor: bgPanel,
        border: isDraggingState
          ? `2px solid ${accentColor}`
          : `1px solid ${borderColorLight}`,
        boxShadow: isDraggingState ? dragShadow : shadow,
        color: textColor,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onMouseDown={stopPropagation}
      onPointerDown={stopPropagation}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* ─── Header (draggable) ─── */}
      <div
        className="flex items-center gap-2 px-5 py-3 cursor-move select-none shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}`, background: isMonochrome ? '#f9fafb' : 'linear-gradient(180deg, #161616, #0f0f0f)' }}
        onMouseDown={handlePanelDragStart}
      >
        <GripVertical size={16} style={{ color: mutedColor }} />
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm shrink-0"
          style={{ background: `linear-gradient(135deg, ${accentColor}, ${isMonochrome ? '#2563eb' : '#8b7225'})`, color: isMonochrome ? '#ffffff' : '#0a0a0a' }}
        >
          字
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold" style={{ color: textColor }}>字境大师 Pro</h1>
          <p className="text-[11px] mt-0.5" style={{ color: subTextColor }}>中文标题字 / KV文字 / 封面字 / 文字Logo 设计器</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: mutedColor, border: `1px solid ${borderColorLight}` }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = accentColor)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = borderColorLight)}
            title={isMinimized ? '展开' : '最小化'}
          >
            <Minus size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: mutedColor, border: `1px solid ${borderColorLight}` }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,60,60,0.3)'; e.currentTarget.style.color = '#ff5555'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = borderColorLight; e.currentTarget.style.color = mutedColor; }}
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ─── Body (hidden when minimized) ─── */}
      {!isMinimized && (
        <div className="flex flex-1 overflow-hidden" style={{ maxHeight: `calc(85vh - 52px)` }}>
          {/* ==================== LEFT PANEL: Parameters (38%) ==================== */}
          <div
            className="flex flex-col shrink-0"
            style={{ width: '38%', borderRight: `1px solid ${borderColor}`, overflow: 'hidden' }}
          >
            <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'thin' }}>
              {/* 1. Text Input */}
              <div>
                <label className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: subTextColor }}>
                  <PenTool size={13} style={{ color: accentColor }} />
                  输入要设计的中文文字
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="请输入中文标题、活动主题、封面标题或文字Logo名称"
                    style={inputStyle}
                    maxLength={20}
                    onFocus={e => { e.currentTarget.style.borderColor = accentColor; }}
                    onBlur={e => { e.currentTarget.style.borderColor = borderColorLight; }}
                  />
                  <button
                    onClick={handleRandomExample}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] px-2 py-1 rounded-md font-medium transition-all"
                    style={{ color: accentColor, background: isMonochrome ? 'rgba(59,130,246,0.08)' : 'rgba(212,175,55,0.1)', border: `1px solid ${isMonochrome ? 'rgba(59,130,246,0.2)' : 'rgba(212,175,55,0.2)'}` }}
                  >
                    随机示例
                  </button>
                </div>
                <p className="text-[10px] mt-1" style={{ color: `${subTextColor}99` }}>建议 2-20 个中文字符</p>
              </div>

              {/* 2. Scene Selection */}
              <div>
                <label className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: subTextColor }}>
                  <span style={{ color: accentColor }}>■</span>
                  使用场景
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {scenes.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setScene(s.name)}
                      style={chipStyle(scene === s.name)}
                      onMouseEnter={e => { if (scene !== s.name) e.currentTarget.style.borderColor = accentColor; }}
                      onMouseLeave={e => { if (scene !== s.name) e.currentTarget.style.borderColor = borderColorLight; }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Font Style */}
              <div>
                <label className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: subTextColor }}>
                  <span style={{ color: accentColor }}>◆</span>
                  字体风格
                </label>
                {/* Level 1: Category tabs (flex-wrap) */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {styleCategories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => { setPrimaryStyleCategory(cat.id); setSecondaryStyle(cat.subStyles[0]?.name || ''); }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 500,
                        border: `1px solid ${primaryStyleCategory === cat.id ? accentColor : borderColorLight}`,
                        background: primaryStyleCategory === cat.id ? (isMonochrome ? 'rgba(59,130,246,0.1)' : 'rgba(212,175,55,0.15)') : 'transparent',
                        color: primaryStyleCategory === cat.id ? accentColor : subTextColor,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
                {/* Level 2: Sub-style grid */}
                {currentCategory && (
                  <div className="grid grid-cols-4 gap-1.5 min-h-[80px] max-h-[120px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                    {currentCategory.subStyles.map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => setSecondaryStyle(sub.name)}
                        style={subChipStyle(secondaryStyle === sub.name)}
                        onMouseEnter={e => { if (secondaryStyle !== sub.name) e.currentTarget.style.borderColor = accentColor; }}
                        onMouseLeave={e => { if (secondaryStyle !== sub.name) e.currentTarget.style.borderColor = borderColorLight; }}
                      >
                        {sub.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. Model Selection */}
              <div ref={modelDropdownRef}>
                <label className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: subTextColor }}>
                  <Cpu size={13} style={{ color: accentColor }} />
                  生图模型
                </label>
                <div className="relative">
                  <button
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    className="w-full flex items-center justify-between"
                    style={inputStyle}
                  >
                    <div className="truncate flex items-center gap-1.5">
                      <span>{imageModels.find(m => m.id === selectedModel)?.name || selectedModel || '选择模型'}</span>
                      {imageModels.find(m => m.id === selectedModel)?.providerName && (
                        <span style={{ color: `${subTextColor}99`, fontSize: '10px' }}>· {imageModels.find(m => m.id === selectedModel)?.providerName}</span>
                      )}
                    </div>
                    <ChevronDown size={14} className="shrink-0 ml-2" style={{ color: mutedColor, transition: 'transform 0.2s', transform: showModelDropdown ? 'rotate(180deg)' : 'none' }} />
                  </button>
                  {showModelDropdown && (
                    <div
                      className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-xl z-20 max-h-[180px] overflow-y-auto"
                      style={{ background: cardBgColor, border: `1px solid ${borderColorLight}`, scrollbarWidth: 'thin' }}
                    >
                      {imageModels.length === 0 && <div className="px-3 py-2 text-xs" style={{ color: subTextColor }}>暂无可用模型，请在管理员后台配置</div>}
                      {imageModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { setSelectedModel(m.id); setShowModelDropdown(false); }}
                          className="w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 transition-colors"
                          style={{
                            borderLeft: selectedModel === m.id ? `2px solid ${accentColor}` : '2px solid transparent',
                            background: selectedModel === m.id ? (isMonochrome ? 'rgba(59,130,246,0.06)' : 'rgba(212,175,55,0.08)') : 'transparent',
                          }}
                          onMouseEnter={e => { if (selectedModel !== m.id) e.currentTarget.style.background = isMonochrome ? 'rgba(59,130,246,0.04)' : 'rgba(212,175,55,0.05)'; }}
                          onMouseLeave={e => { if (selectedModel !== m.id) e.currentTarget.style.background = 'transparent'; }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="truncate" style={{ color: textColor }}>{m.name}</div>
                            <div className="truncate mt-0.5" style={{ color: `${subTextColor}99` }}>{m.providerName}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[10px] mt-1" style={{ color: `${subTextColor}66` }}>模型由管理员后台统一配置管理</p>
              </div>

              {/* 5. Advanced Parameters (collapsible) */}
              <div>
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-xs font-medium w-full"
                  style={{ color: subTextColor }}
                >
                  <Cpu size={13} style={{ color: accentColor }} />
                  高级参数
                  <ChevronDown size={13} className="ml-auto" style={{ transition: 'transform 0.2s', transform: showAdvanced ? 'rotate(180deg)' : 'none' }} />
                </button>

                {showAdvanced && (
                  <div className="mt-2 space-y-3">
                    {/* 画面比例 */}
                    <div>
                      <p className="text-[11px] mb-1.5" style={{ color: `${subTextColor}aa` }}>画面比例</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {RATIO_OPTIONS.map((r) => (
                          <button key={r.id} onClick={() => setRatio(r.id)} style={chipStyle(ratio === r.id)}>
                            <span className="mr-1">{r.icon}</span>{r.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 字体颜色 */}
                    <div>
                      <p className="text-[11px] mb-1.5" style={{ color: `${subTextColor}aa` }}>字体颜色</p>
                      <div className="flex gap-2 flex-wrap items-center">
                        {COLOR_OPTIONS.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setColor(c.id)}
                            className="transition-all"
                            style={{
                              width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
                              border: color === c.id ? `2px solid ${accentColor}` : `2px solid transparent`,
                              background: c.color,
                              boxShadow: color === c.id ? `0 0 8px ${accentColor}44` : 'none',
                              transform: color === c.id ? 'scale(1.15)' : 'scale(1)',
                            }}
                            title={c.id}
                          />
                        ))}
                      </div>
                    </div>
                    {/* 背景类型 */}
                    <div>
                      <p className="text-[11px] mb-1.5" style={{ color: `${subTextColor}aa` }}>背景类型</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {BACKGROUND_OPTIONS.map((bg) => (
                          <button key={bg} onClick={() => setBackground(bg)} style={chipStyle(background === bg)}>
                            {bg}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 笔画处理 */}
                    <div>
                      <p className="text-[11px] mb-1.5" style={{ color: `${subTextColor}aa` }}>笔画处理（多选）</p>
                      <div className="flex flex-wrap gap-1">
                        {strokeOptionList.map((s) => (
                          <button key={s.id} onClick={() => toggleStroke(s.name)} style={subChipStyle(strokeOptions.includes(s.name))}>
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 图形融合 */}
                    <div>
                      <p className="text-[11px] mb-1.5" style={{ color: `${subTextColor}aa` }}>图形融合（多选）</p>
                      <div className="flex flex-wrap gap-1">
                        {graphicOptionList.map((g) => (
                          <button key={g.id} onClick={() => toggleGraphic(g.name)} style={subChipStyle(graphicElements.includes(g.name))}>
                            {g.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 字体质感 */}
                    <div>
                      <p className="text-[11px] mb-1.5" style={{ color: `${subTextColor}aa` }}>字体质感</p>
                      <div className="flex flex-wrap gap-1">
                        {materialList.map((m) => (
                          <button key={m.id} onClick={() => setMaterial(m.name)} style={chipStyle(material === m.name)}>
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 即梦增强模式 */}
                    <div className="flex items-center justify-between pt-1">
                      <div>
                        <p className="text-[11px]" style={{ color: `${subTextColor}aa` }}>即梦增强模式</p>
                        <p className="text-[10px] mt-0.5" style={{ color: `${subTextColor}66` }}>自动强化提示词，减少中文乱码和错字</p>
                      </div>
                      <button
                        onClick={() => setJimengEnhanced(!jimengEnhanced)}
                        className="relative transition-all"
                        style={{
                          width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
                          background: jimengEnhanced ? accentColor : borderColorLight,
                        }}
                      >
                        <span
                          className="absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform"
                          style={{ left: 2, transform: jimengEnhanced ? 'translateX(18px)' : 'translateX(0)' }}
                        />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons at bottom */}
            <div className="p-4 pt-0 space-y-2 shrink-0" style={{ borderTop: `1px solid ${borderColor}`, background: isMonochrome ? 'linear-gradient(0deg, #ffffff, transparent)' : 'linear-gradient(0deg, #0f0f0f, transparent)' }}>
              <div className="pt-3">
                <button
                  onClick={handleGeneratePlans}
                  disabled={isGeneratingPlan || !text.trim()}
                  style={{ ...goldBtnStyle, opacity: (isGeneratingPlan || !text.trim()) ? 0.5 : 1, cursor: (isGeneratingPlan || !text.trim()) ? 'not-allowed' : 'pointer' }}
                >
                  {isGeneratingPlan ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : <Sparkles className="h-4 w-4 inline mr-1" />}
                  生成字体方案
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={handleGeneratePrompt} disabled={isGeneratingPrompt || !text.trim()} style={{ ...secondaryBtnStyle, flex: 1, opacity: (isGeneratingPrompt || !text.trim()) ? 0.5 : 1 }}>
                  {isGeneratingPrompt ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : <Wand2 className="h-3 w-3 inline mr-1" />}
                  生成即梦提示词
                </button>
                <button onClick={() => handleGenerateImage('black-on-white')} disabled={isGeneratingImage || !text.trim()} style={{ ...secondaryBtnStyle, flex: 1, opacity: (isGeneratingImage || !text.trim()) ? 0.5 : 1 }}>
                  黑底白字测试
                </button>
                <button onClick={() => handleGenerateImage('full')} disabled={isGeneratingImage || !text.trim()} style={{ ...secondaryBtnStyle, flex: 1, opacity: (isGeneratingImage || !text.trim()) ? 0.5 : 1 }}>
                  {isGeneratingImage ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : <ImageIcon className="h-3 w-3 inline mr-1" />}
                  直接生成图片
                </button>
              </div>
            </div>
          </div>

          {/* ==================== RIGHT PANEL: Results (62%) ==================== */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Tab bar */}
            <div className="flex px-4 shrink-0" style={{ borderBottom: `1px solid ${borderColor}`, background: bgPanel }}>
              {(['plans', 'prompt', 'images', 'history'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="py-2.5 text-[13px] font-medium transition-colors relative"
                  style={{
                    color: activeTab === tab ? accentColor : subTextColor,
                    borderBottom: activeTab === tab ? `2px solid ${accentColor}` : '2px solid transparent',
                    background: 'none',
                    borderLeft: 'none',
                    borderRight: 'none',
                    borderTop: 'none',
                    cursor: 'pointer',
                    padding: '10px 16px',
                  }}
                >
                  {tabLabels[tab]}
                </button>
              ))}
            </div>

            {/* Tab content area */}
            <div className="flex-1 overflow-y-auto p-4" style={{ background: isMonochrome ? '#ffffff' : '#0a0a0a', scrollbarWidth: 'thin' }}>

              {/* ========== Tab 1: 设计方案 ========== */}
              {activeTab === 'plans' && (
                <div className="space-y-3">
                  {plans.length === 0 && !isGeneratingPlan && (
                    <div className="text-center py-12" style={{ color: subTextColor }}>
                      <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">输入文字并点击&ldquo;生成字体方案&rdquo;</p>
                      <p className="text-xs mt-1">系统将根据文字含义和风格偏好推荐设计方案</p>
                    </div>
                  )}
                  {isGeneratingPlan && (
                    <div className="text-center py-12" style={{ color: subTextColor }}>
                      <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" style={{ color: accentColor }} />
                      <p className="text-sm">正在分析文字含义，生成设计方案...</p>
                    </div>
                  )}
                  {plans.map((plan, idx) => (
                    <div
                      key={idx}
                      className="plan-card"
                      style={{
                        borderLeft: `3px solid ${accentColor}`,
                        background: cardBgColor,
                        borderRadius: 8,
                        padding: 16,
                        marginBottom: 12,
                        transition: 'all 0.3s ease',
                        cursor: 'default',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = isMonochrome ? '#f0f0f0' : '#1c1c1c'; e.currentTarget.style.boxShadow = isMonochrome ? '0 4px 12px rgba(0,0,0,0.08)' : `0 0 15px rgba(212,175,55,0.12), 0 4px 12px rgba(0,0,0,0.3)`; }}
                      onMouseLeave={e => { e.currentTarget.style.background = cardBgColor; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="text-sm font-semibold" style={{ color: textColor }}>{plan.title}</h3>
                          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded mt-1 font-medium" style={{ background: isMonochrome ? 'rgba(59,130,246,0.1)' : 'rgba(212,175,55,0.15)', color: accentColor }}>
                            推荐指数 {Array.from({ length: 5 }).map((_, i) => i < plan.recommendIndex ? '★' : '☆').join('')}
                          </span>
                        </div>
                        <span className="text-[10px]" style={{ color: `${subTextColor}66` }}>方案 {idx + 1}</span>
                      </div>
                      <div className="space-y-1.5 text-[12px]">
                        {[
                          { label: '风格定位', value: plan.stylePositioning },
                          { label: '字形特点', value: plan.glyphFeatures },
                          { label: '笔画处理', value: plan.strokeAdvice },
                          { label: '图形融合', value: plan.graphicFusion },
                          { label: '色彩质感', value: plan.colorMaterial },
                          { label: '适用场景', value: plan.applicableScene },
                        ].map((item) => (
                          <p key={item.label}>
                            <span style={{ color: subTextColor }}>{item.label}：</span>
                            <span style={{ color: textColor }}>{item.value}</span>
                          </p>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => copyToClipboard(JSON.stringify(plan), '方案')} style={secondaryBtnStyle}>
                          <Copy size={12} className="inline mr-1" />复制
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ========== Tab 2: 即梦提示词 ========== */}
              {activeTab === 'prompt' && (
                <div className="space-y-4">
                  {!prompts && !isGeneratingPrompt && (
                    <div className="text-center py-12" style={{ color: subTextColor }}>
                      <Wand2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">输入文字并点击&ldquo;即梦提示词&rdquo;生成</p>
                    </div>
                  )}
                  {isGeneratingPrompt && (
                    <div className="text-center py-12" style={{ color: subTextColor }}>
                      <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" style={{ color: accentColor }} />
                      <p className="text-sm">正在生成即梦提示词...</p>
                    </div>
                  )}
                  {prompts && (
                    <>
                      {[
                        { label: '完整提示词', content: prompts.prompt, copyKey: '完整提示词', enhanced: false },
                        { label: '精简版提示词', content: prompts.shortPrompt, copyKey: '精简版', enhanced: false },
                        { label: '增强版提示词', content: prompts.enhancedPrompt, copyKey: '增强版', enhanced: true },
                      ].map((section) => (
                        <div key={section.label}>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium flex items-center gap-1.5" style={{ color: subTextColor }}>
                              {section.label}
                              {section.enhanced && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: isMonochrome ? 'rgba(59,130,246,0.1)' : 'rgba(212,175,55,0.15)', color: accentColor }}>即梦增强</span>
                              )}
                            </p>
                            <button onClick={() => copyToClipboard(section.content, section.copyKey)} style={{ ...secondaryBtnStyle, fontSize: 11, padding: '4px 10px' }}>
                              <Copy size={12} className="inline mr-1" />复制
                            </button>
                          </div>
                          <div
                            className="text-[12px] whitespace-pre-wrap overflow-y-auto"
                            style={{
                              background: isMonochrome ? '#f9fafb' : '#0a0a0a',
                              border: `1px solid ${section.enhanced ? `${accentColor}66` : borderColorLight}`,
                              borderRadius: 8,
                              padding: 16,
                              lineHeight: 1.8,
                              color: isMonochrome ? '#374151' : '#e5e5e5',
                              minHeight: section.enhanced ? 120 : 80,
                              maxHeight: section.enhanced ? 180 : 120,
                              scrollbarWidth: 'thin',
                              boxShadow: section.enhanced ? (isMonochrome ? 'inset 0 0 20px rgba(59,130,246,0.03)' : 'inset 0 0 20px rgba(212,175,55,0.03)') : 'none',
                            }}
                          >
                            {section.content}
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => handleGenerateImage('full')} disabled={isGeneratingImage} style={{ ...goldBtnStyle, width: 'auto', opacity: isGeneratingImage ? 0.5 : 1 }}>
                          <ImageIcon size={14} className="inline mr-1" />发送到图像生成
                        </button>
                        <button onClick={() => handleGenerateImage('black-on-white')} disabled={isGeneratingImage} style={{ ...secondaryBtnStyle, opacity: isGeneratingImage ? 0.5 : 1 }}>
                          黑底白字测试
                        </button>
                        <button onClick={() => handleGenerateImage('transparent-logo')} disabled={isGeneratingImage} style={{ ...secondaryBtnStyle, opacity: isGeneratingImage ? 0.5 : 1 }}>
                          透明Logo版
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ========== Tab 3: 生成图片 ========== */}
              {activeTab === 'images' && (
                <div className="space-y-4">
                  {generatedImages.length === 0 && !isGeneratingImage && (
                    <div className="text-center py-12" style={{ color: subTextColor }}>
                      <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">点击&ldquo;生图&rdquo;或&ldquo;发送到图像生成&rdquo;生成字体设计图片</p>
                    </div>
                  )}
                  {isGeneratingImage && (
                    <div className="text-center py-12">
                      <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" style={{ color: accentColor }} />
                      <p className="text-sm" style={{ color: subTextColor }}>正在生成字体设计图片，请耐心等待...</p>
                      <p className="text-xs mt-1" style={{ color: subTextColor }}>通常需要15-60秒</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {generatedImages.map((url, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg overflow-hidden group relative"
                        style={{ border: `1px solid ${borderColorLight}`, background: cardBgColor, transition: 'all 0.3s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = accentColor; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = borderColorLight; }}
                      >
                        <img src={url} alt={`字体设计 ${idx + 1}`} className="w-full aspect-video object-cover" crossOrigin="anonymous" />
                        <div
                          className="absolute inset-0 flex items-center justify-center gap-2 transition-opacity opacity-0 group-hover:opacity-100"
                          style={{ background: 'rgba(0,0,0,0.7)' }}
                        >
                          <button onClick={() => handleAddToCanvas(url)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: accentColor, color: isMonochrome ? '#ffffff' : '#0a0a0a' }}>
                            <Plus size={12} className="inline mr-1" />加入画布
                          </button>
                          <button
                            onClick={() => { const a = document.createElement('a'); a.href = url; a.download = `font-design-${idx + 1}.png`; a.click(); }}
                            className="px-3 py-1.5 rounded-lg text-xs text-white"
                            style={{ border: '1px solid rgba(255,255,255,0.3)' }}
                          >
                            <Download size={12} className="inline mr-1" />下载
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {generatedImages.length > 0 && (
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => handleGenerateImage('full')} disabled={isGeneratingImage} style={{ ...secondaryBtnStyle, opacity: isGeneratingImage ? 0.5 : 1 }}>
                        <RefreshCw size={12} className="inline mr-1" />重新生成
                      </button>
                      <button onClick={() => onAddImages?.(generatedImages)} style={{ ...goldBtnStyle, width: 'auto' }}>
                        <Plus size={12} className="inline mr-1" />全部加入画布
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ========== Tab 4: 历史记录 ========== */}
              {activeTab === 'history' && (
                <div className="space-y-2">
                  {history.length === 0 && (
                    <div className="text-center py-12" style={{ color: subTextColor }}>
                      <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">暂无历史记录</p>
                      <p className="text-xs mt-1">生成图片后自动记录</p>
                    </div>
                  )}
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 group p-3 rounded-lg transition-all"
                      style={{ border: `1px solid ${borderColor}`, background: cardBgColor, cursor: 'default' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = borderColorLight; e.currentTarget.style.background = isMonochrome ? '#f0f0f0' : '#1c1c1c'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = borderColor; e.currentTarget.style.background = cardBgColor; }}
                    >
                      <div className="w-12 h-12 rounded flex items-center justify-center shrink-0" style={{ background: isMonochrome ? '#f3f4f6' : '#1c1c1c' }}>
                        <ImageIcon className="h-4 w-4 opacity-30" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: textColor }}>{item.text}</div>
                        <div className="text-[10px]" style={{ color: subTextColor }}>{item.scene} · {item.style}</div>
                        <div className="text-[10px]" style={{ color: subTextColor }}>{item.createdAt}</div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setText(item.text); setScene(item.scene); }}
                          className="p-1.5 rounded"
                          style={{ color: accentColor }}
                          title="再次生成"
                        >
                          <RefreshCw size={12} />
                        </button>
                        {item.prompt && (
                          <button onClick={() => copyToClipboard(item.prompt, '提示词')} className="p-1.5 rounded" style={{ color: accentColor }} title="复制提示词">
                            <Copy size={12} />
                          </button>
                        )}
                        <button onClick={() => setHistory(prev => prev.filter(h => h.id !== item.id))} className="p-1.5 rounded text-red-400" title="删除">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Copied toast */}
      {copiedToast && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-xs font-medium shadow-lg z-50"
          style={{ background: accentColor, color: isMonochrome ? '#ffffff' : '#0a0a0a' }}
        >
          <Check size={12} className="inline mr-1" />{copiedToast}
        </div>
      )}
    </div>
  );
}
