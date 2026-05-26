'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Sparkles, Copy, Image as ImageIcon, Download, Loader2,
  ChevronDown, ChevronUp, RefreshCw, Star, Cpu, Wand2,
  Check, Shuffle, Trash2, Clock, Plus, GripVertical, Minus, PenTool,
  Palette, Zap, Search, List, Grid3X3, Maximize2,
} from 'lucide-react';

interface StyleSubCategory { id: string; name: string; prompt: string; }
interface StyleCategory { id: string; name: string; subStyles: StyleSubCategory[]; }
interface SceneOption { id: string; name: string; description: string; }
interface DesignPlan {
  title: string; stylePositioning: string; glyphFeatures: string;
  strokeAdvice: string; graphicFusion: string; colorMaterial: string;
  applicableScene: string; recommendIndex: number; prompt: string;
}
interface ImageModel { id: string; name: string; providerId: string; providerName: string; }
interface HistoryItem {
  id: string; text: string; scene: string; style: string;
  prompt: string; imageUrl?: string; createdAt: string;
}

// Gallery data loaded from API
interface GalleryDataItem {
  id: string;
  imageFile: string;
  sourceUrl: string;
  prompt: string;
  displayText: string;
  category: string;
  categoryName: string;
  localPath?: string;
}
interface GalleryCategory {
  id: string;
  name: string;
  count: number;
}
type GalleryViewMode = 'list' | 'thumbnail' | 'large';

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

import { MODEL_ASPECT_RATIOS, DEFAULT_ASPECT_RATIOS, findModelConfig, ASPECT_RATIO_TO_PIXELS } from '@/lib/canvas-generation-group';

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

  const [activeTab, setActiveTab] = useState<'plans' | 'prompt' | 'images' | 'gallery' | 'history'>('plans');
  const [plans, setPlans] = useState<DesignPlan[]>([]);
  const [prompts, setPrompts] = useState<{ prompt: string; shortPrompt: string; enhancedPrompt: string; blackOnWhitePrompt: string; transparentLogoPrompt: string } | null>(null);
  type GeneratedImage = { url: string; planIndex: number; variant: number; planTitle?: string };
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // 将比例字符串(如"3:4")转为CSS aspect-ratio值
  const getAspectRatioStyle = (ratioStr: string): React.CSSProperties => {
    if (!ratioStr || ratioStr === '透明Logo') return { aspectRatio: '1/1' };
    const parts = ratioStr.split(':');
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return { aspectRatio: `${w}/${h}` };
    }
    return { aspectRatio: '1/1' };
  };

  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  // Gallery state
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryItems, setGalleryItems] = useState<GalleryDataItem[]>([]);
  const [galleryCategories, setGalleryCategories] = useState<GalleryCategory[]>([]);
  const [galleryFilter, setGalleryFilter] = useState<string>('all');
  const [galleryViewMode, setGalleryViewMode] = useState<GalleryViewMode>('thumbnail');
  const [galleryPage, setGalleryPage] = useState(1);
  const [galleryTotalPages, setGalleryTotalPages] = useState(1);
  const [galleryTotalCount, setGalleryTotalCount] = useState(0);
  const [gallerySearch, setGallerySearch] = useState('');
  // Inspiration reference state (from gallery "制作同款")
  const [inspirationRef, setInspirationRef] = useState<GalleryDataItem | null>(null);
  const [inspirationKeywords, setInspirationKeywords] = useState('');
  // Ref-based task tracking (no state, no re-renders, no useEffect polling bugs)
  const activeTasksRef = useRef<Map<string, { planIndex: number; variant: number; planTitle: string }>>(new Map());
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const selectedModelRef = useRef(selectedModel);
  // Keep selectedModelRef in sync
  useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);

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

  // ─── Polling mechanism (ref-based, no useEffect) ───
  // Starts polling after tasks are submitted. Uses setTimeout recursion instead of
  // setInterval + useEffect to avoid stale closures, duplicate images, and loading stuck bugs.
  const startPolling = useCallback(() => {
    if (pollingTimerRef.current) return; // Already polling

    const poll = async () => {
      const taskIds = Array.from(activeTasksRef.current.keys());
      if (taskIds.length === 0) {
        setIsGeneratingImage(false);
        pollingTimerRef.current = null;
        return;
      }

      let hasRemaining = false;
      for (const tid of taskIds) {
        try {
          const res = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: tid, model: selectedModelRef.current }),
          });
          const data = await res.json();
          if (data.status === 'completed') {
            const meta = activeTasksRef.current.get(tid);
            activeTasksRef.current.delete(tid);
            // Take ONLY 1 image from the result
            const urls: string[] = data.result?.directImageUrls || (data.imageUrl ? [data.imageUrl] : []);
            const firstUrl = urls[0];
            if (firstUrl && meta) {
              setGeneratedImages(prev => [...prev, { url: firstUrl, planIndex: meta.planIndex, variant: meta.variant, planTitle: meta.planTitle }]);
            }
          } else if (data.status === 'failed') {
            activeTasksRef.current.delete(tid);
          } else {
            hasRemaining = true;
          }
        } catch {
          hasRemaining = true;
        }
      }

      // Check if there are still active tasks
      if (activeTasksRef.current.size > 0) {
        pollingTimerRef.current = setTimeout(poll, 3000);
      } else {
        setIsGeneratingImage(false);
        pollingTimerRef.current = null;
      }
    };

    poll(); // Start immediately
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    activeTasksRef.current.clear();
  }, []);

  // Cleanup on unmount
  useEffect(() => { return () => { stopPolling(); setIsGeneratingImage(false); }; }, [stopPolling]);

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

  /** Resolve a style name (e.g. "竹节笔意") to its visual description from styleCategories */
  const resolveStyleVisualDesc = useCallback((styleName: string): string => {
    if (!styleName || styleName === '智能推荐') return '';
    for (const cat of styleCategories) {
      for (const sub of cat.subStyles) {
        if (sub.name === styleName) return sub.prompt;
        if (sub.id === styleName) return sub.prompt;
      }
    }
    return '';
  }, [styleCategories]);

  /** Build a style enforcement prefix string for prompt construction */
  const buildStyleEnforcementPrefix = useCallback((): string => {
    const styleName = secondaryStyle || primaryStyleCategory;
    if (!styleName || styleName === 'smart-recommend' || styleName === '智能推荐') return '';
    const visualDesc = resolveStyleVisualDesc(styleName);
    if (!visualDesc) return `【必须严格遵循】${styleName}风格，`;
    return `【必须严格遵循${styleName}风格：${visualDesc}】`;
  }, [secondaryStyle, primaryStyleCategory, resolveStyleVisualDesc]);

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
          ratio,
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
          ratio,
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
    stopPolling();
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
      if (data.taskId) {
        activeTasksRef.current.set(data.taskId, { planIndex: 0, variant: 0, planTitle: mode === 'black-on-white' ? '黑底白字' : mode === 'transparent-logo' ? '透明Logo' : '完整版' });
        startPolling();
      } else {
        setIsGeneratingImage(false);
      }
      if (data.prompt) {
        setPrompts(prev => prev ? { ...prev, prompt: data.prompt } : { prompt: data.prompt, shortPrompt: '', enhancedPrompt: '', blackOnWhitePrompt: '', transparentLogoPrompt: '' });
      }
      setHistory(prev => [{ id: `h-${Date.now()}`, text, scene, style: secondaryStyle || primaryStyleCategory, prompt: data.prompt || '', createdAt: new Date().toLocaleString() }, ...prev]);
    } catch { showToast('生成图片失败'); setIsGeneratingImage(false); }
  }, [text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced, selectedModel, showToast, stopPolling, startPolling]);

  /** Generate 2 variant images for a single design plan */
  const handleGeneratePlanImage = useCallback(async (plan: DesignPlan, planIndex: number) => {
    if (!text.trim()) return;
    stopPolling();
    setIsGeneratingImage(true);
    setGeneratedImages([]);
    setActiveTab('images');
    const stylePrefix = buildStyleEnforcementPrefix();
    try {
      // Always enforce style prefix on top of plan prompt
      const planPrompt = plan.prompt
        ? `${stylePrefix}${plan.prompt}`
        : `${stylePrefix}文字内容"${text}"，${scene}场景，${secondaryStyle || primaryStyleCategory}风格`;
      // Submit 2 tasks with significantly different prompt variants for high variation
      for (let v = 0; v < 2; v++) {
        const variantPrompt = v === 0
          ? `${planPrompt}，极简留白构图，文字居中突出，大面积负空间，精致细节特写`
          : `${planPrompt}，丰富装饰构图，文字与图形元素交织，满版布局，视觉冲击力强`;
        const res = await fetch('/api/font-design/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text, scene, primaryStyleCategory, secondaryStyle,
            ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced,
            model: selectedModel, mode: 'full', count: 1,
            prompt: variantPrompt,
          }),
        });
        const data = await res.json();
        if (data.error) { showToast(`变体${v + 1}生成失败: ${data.error}`); continue; }
        if (data.taskId) {
          activeTasksRef.current.set(data.taskId, { planIndex, variant: v, planTitle: plan.title });
        }
      }
      if (activeTasksRef.current.size > 0) {
        startPolling();
      } else {
        setIsGeneratingImage(false);
      }
      setHistory(prev => [{ id: `h-${Date.now()}`, text, scene, style: plan.title || secondaryStyle || primaryStyleCategory, prompt: plan.prompt || '', createdAt: new Date().toLocaleString() }, ...prev]);
    } catch { showToast('生成图片失败'); setIsGeneratingImage(false); }
  }, [text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced, selectedModel, showToast, stopPolling, startPolling, buildStyleEnforcementPrefix]);

  /** Generate 2 varied images per plan × 4 plans = 8 different images total */
  const handleGenerateAllPlanImages = useCallback(async () => {
    if (plans.length === 0) { showToast('请先生成设计方案'); return; }
    stopPolling();
    setIsGeneratingImage(true);
    setGeneratedImages([]);
    setActiveTab('images');
    const stylePrefix = buildStyleEnforcementPrefix();
    try {
      for (let pi = 0; pi < plans.length; pi++) {
        const plan = plans[pi];
        // Always enforce style prefix on top of plan prompt to ensure user settings take effect
        const planPrompt = plan.prompt
          ? `${stylePrefix}${plan.prompt}`
          : `${stylePrefix}文字内容"${text}"，${scene}场景，${secondaryStyle || primaryStyleCategory}风格`;
        // Submit 2 highly varied tasks per plan
        for (let v = 0; v < 2; v++) {
          const variantPrompt = v === 0
            ? `${planPrompt}，极简留白构图，文字居中突出，大面积负空间，精致细节特写`
            : `${planPrompt}，丰富装饰构图，文字与图形元素交织，满版布局，视觉冲击力强`;
          const res = await fetch('/api/font-design/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text, scene, primaryStyleCategory, secondaryStyle,
              ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced,
              model: selectedModel, mode: 'full', count: 1,
              prompt: variantPrompt,
            }),
          });
          const data = await res.json();
          if (data.error) { showToast(`方案"${plan.title}"生成失败: ${data.error}`); continue; }
          if (data.taskId) {
            activeTasksRef.current.set(data.taskId, { planIndex: pi, variant: v, planTitle: plan.title });
          }
        }
      }
      if (activeTasksRef.current.size > 0) {
        startPolling();
      } else {
        setIsGeneratingImage(false);
      }
      setHistory(prev => [...plans.map((plan, i) => ({ id: `h-${Date.now()}-${i}`, text, scene, style: plan.title || secondaryStyle || primaryStyleCategory, prompt: plan.prompt || '', createdAt: new Date().toLocaleString() })), ...prev]);
    } catch { showToast('生成图片失败'); setIsGeneratingImage(false); }
  }, [plans, text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced, selectedModel, showToast, stopPolling, startPolling, buildStyleEnforcementPrefix]);

  /** Black-on-white test: 2 images per plan × 4 plans = 8 different images */
  const handleBlackOnWhiteTest = useCallback(async () => {
    if (plans.length === 0) { showToast('请先生成字体方案'); return; }
    stopPolling();
    setIsGeneratingImage(true);
    setGeneratedImages([]);
    setActiveTab('images');
    const stylePrefix = buildStyleEnforcementPrefix();
    try {
      for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const planPrompt = plan.prompt
          ? `${stylePrefix}${plan.prompt}`
          : `${stylePrefix}文字内容"${text}"，${scene}场景，${secondaryStyle || primaryStyleCategory}风格`;
        // Submit 2 variants per plan with high variation
        for (let v = 0; v < 2; v++) {
          const variantDesc = v === 0
            ? '，极简留白构图，文字居中突出，大面积负空间'
            : '，丰富装饰构图，满版布局，文字与装饰元素交织';
          const blackOnWhitePrompt = `黑底白字测试: ${planPrompt}${variantDesc}, pure black background, white text only, high contrast, clear letterforms, no decorative elements, no colors, stark monochrome, crisp edges`;
          const resp = await fetch('/api/font-design/generate-image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, prompt: blackOnWhitePrompt, model: selectedModel, ratio, count: 1, color: '白色', background: '纯黑背景' }),
          });
          const data = await resp.json();
          if (data.taskId) {
            activeTasksRef.current.set(data.taskId, { planIndex: i, variant: v, planTitle: (plan.title || `方案${i + 1}`) + ' 黑底白字' });
          } else if (data.imageUrl) {
            setGeneratedImages(prev => [...prev, { url: data.imageUrl, planIndex: i, variant: v, planTitle: (plan.title || `方案${i + 1}`) + ' 黑底白字' }]);
          }
        }
      }
      if (activeTasksRef.current.size > 0) { startPolling(); } else { setIsGeneratingImage(false); }
    } catch { showToast('黑底白字测试失败'); setIsGeneratingImage(false); }
  }, [plans, text, scene, primaryStyleCategory, secondaryStyle, ratio, selectedModel, showToast, stopPolling, startPolling, buildStyleEnforcementPrefix]);

  const handleAddToCanvas = useCallback((url: string) => { onAddImages?.([url]); }, [onAddImages]);

  // Gallery: load data from API
  const loadGalleryData = useCallback(async (category?: string, page?: number, search?: string) => {
    setGalleryLoading(true);
    try {
      const params = new URLSearchParams();
      if (category && category !== 'all') params.set('category', category);
      if (page) params.set('page', String(page));
      if (search) params.set('search', search);
      params.set('pageSize', '30');
      const resp = await fetch(`/api/font-design/gallery?${params.toString()}`);
      if (resp.ok) {
        const data = await resp.json();
        setGalleryItems(data.items || []);
        setGalleryCategories(data.categories || []);
        setGalleryTotalPages(data.totalPages || 1);
        setGalleryTotalCount(data.filteredCount || 0);
      }
    } catch (err) {
      console.error('加载图库失败:', err);
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  // Load gallery on first tab visit
  useEffect(() => {
    if (activeTab === 'gallery' && galleryItems.length === 0 && !galleryLoading) {
      loadGalleryData(galleryFilter, galleryPage, gallerySearch);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Gallery: "一键制作同款" handler — switch left panel to inspiration creation mode
  const handleUseInspiration = useCallback((item: GalleryDataItem) => {
    // Set inspiration reference
    setInspirationRef(item);

    // Set editable keywords from the inspiration prompt
    setInspirationKeywords(item.prompt || '');

    // Fill text field with the display text for context
    const displayText = item.displayText || '';
    if (displayText) setText(displayText);

    // Map category to primaryStyleCategory for generation context
    const catToStyle: Record<string, string> = {
      'cat-0': 'oriental', 'cat-1': 'modern', 'cat-2': 'handwriting',
      'cat-3': 'dimensional', 'cat-4': 'oriental', 'cat-5': 'cute',
      'cat-6': 'modern', 'cat-7': 'modern', 'cat-8': 'neon',
      'cat-9': 'modern', 'cat-10': 'creative', 'cat-11': 'creative',
    };
    setPrimaryStyleCategory(catToStyle[item.category] || 'smart-recommend');

    // Switch to images tab to see results after generation
    setActiveTab('images');
  }, []);

  // Generate images based on inspiration reference (user confirmed after editing)
  const handleInspirationGenerate = useCallback(() => {
    if (!inspirationKeywords.trim() || isGeneratingImage) return;
    const model = selectedModelRef.current;
    if (!model) { showToast('请先选择生图模型'); return; }

    const finalPromptBase = inspirationKeywords.trim();

    setGeneratedImages([]);
    activeTasksRef.current.clear();
    setIsGeneratingImage(true);
    setActiveTab('images');

    for (let vIdx = 0; vIdx < 2; vIdx++) {
      const variationHint = vIdx === 0 ? '，构图偏紧凑特写视角' : '，构图偏开阔全景视角';
      const finalPrompt = finalPromptBase + variationHint;
      fetch('/api/font-design/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt, model, ratio, mode: 'standard',
          text: text || inspirationRef?.displayText || '',
          scene: '文化艺术',
          primaryStyleCategory: primaryStyleCategory,
        }),
      }).then(r => r.json()).then(data => {
        if (data.taskId) {
          activeTasksRef.current.set(data.taskId, { planIndex: 0, variant: vIdx, planTitle: (inspirationRef?.categoryName || '灵感') + '同款' });
          if (vIdx === 1) startPolling();
        }
      }).catch(err => {
        console.error('灵感同款生成失败:', err);
        if (vIdx === 1) setIsGeneratingImage(false);
      });
    }
  }, [inspirationKeywords, isGeneratingImage, inspirationRef, text, ratio, primaryStyleCategory, startPolling, showToast]);

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

  const tabLabels: Record<string, string> = { plans: '设计方案', prompt: '即梦提示词', images: '生成图片', gallery: '灵感图库', history: '历史记录' };

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
              {inspirationRef ? (
                /* ═══════════ 灵感同款创作区 (replaces normal left panel) ═══════════ */
                <>
                  {/* Reference Image Card */}
                  <div
                    className="relative rounded-xl overflow-hidden"
                    style={{
                      border: `1px solid ${accentColor}50`,
                      background: isMonochrome ? 'rgba(59,130,246,0.04)' : 'rgba(212,175,55,0.06)',
                    }}
                  >
                    {/* Header bar */}
                    <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${borderColorLight}` }}>
                      <div className="flex items-center gap-1.5">
                        <ImageIcon size={13} style={{ color: accentColor }} />
                        <span className="text-[11px] font-semibold" style={{ color: accentColor }}>灵感参考</span>
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px]"
                          style={{ background: `${accentColor}20`, color: accentColor }}
                        >
                          {inspirationRef.categoryName}
                        </span>
                      </div>
                      <button
                        onClick={() => setInspirationRef(null)}
                        className="w-5 h-5 rounded-full flex items-center justify-center transition-colors text-[11px]"
                        style={{ background: isMonochrome ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)', color: subTextColor, cursor: 'pointer' }}
                        title="退出灵感模式"
                      >
                        <X size={11} />
                      </button>
                    </div>
                    {/* Image preview */}
                    <div className="p-3 flex justify-center" style={{ background: isMonochrome ? '#f9fafb' : '#0a0a0a' }}>
                      <div className="rounded-lg overflow-hidden shadow-lg" style={{ maxWidth: '100%', maxHeight: 160 }}>
                        <img
                          src={inspirationRef.localPath || `/api/font-design/gallery-image?id=${inspirationRef.id}`}
                          alt="灵感参考图"
                          className="object-contain"
                          style={{ maxWidth: '100%', maxHeight: 160, display: 'block' }}
                        />
                      </div>
                    </div>
                    {/* Display text */}
                    {inspirationRef.displayText && (
                      <div className="px-3 pb-2">
                        <p className="text-[11px] truncate" style={{ color: subTextColor }}>
                          {inspirationRef.displayText}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Keywords Editing Area */}
                  <div>
                    <label className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: subTextColor }}>
                      <PenTool size={13} style={{ color: accentColor }} />
                      关键词
                      <span className="text-[9px] ml-1" style={{ color: `${subTextColor}99` }}>可自由调整</span>
                    </label>
                    <textarea
                      value={inspirationKeywords}
                      onChange={(e) => setInspirationKeywords(e.target.value)}
                      placeholder="在此输入或调整关键词描述..."
                      className="w-full resize-y"
                      style={{
                        ...inputStyle,
                        minHeight: 100,
                        maxHeight: 200,
                        lineHeight: 1.5,
                        fontSize: 12,
                        fontFamily: 'inherit',
                      }}
                    />
                    <p className="text-[10px] mt-1" style={{ color: `${subTextColor}99` }}>
                      修改关键词会影响生成结果的风格和内容
                    </p>
                  </div>

                  {/* Model Selection (compact) */}
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
                              onClick={() => { setSelectedModel(m.id); setShowModelDropdown(false); const supportedRatios = findModelConfig(MODEL_ASPECT_RATIOS, m.id) || DEFAULT_ASPECT_RATIOS; if (!supportedRatios.includes(ratio) && ratio !== 'logo') setRatio(supportedRatios[0]); }}
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
                  </div>

                  {/* Aspect Ratio (compact) */}
                  <div>
                    <label className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: subTextColor }}>
                      <span style={{ color: accentColor }}>⊞</span>
                      画面比例
                    </label>
                    <div className="flex gap-1.5 flex-wrap">
                      {(findModelConfig(MODEL_ASPECT_RATIOS, selectedModel) || DEFAULT_ASPECT_RATIOS).map((r: string) => (
                        <button key={r} onClick={() => setRatio(r)} style={chipStyle(ratio === r)}>
                          {r}
                        </button>
                      ))}
                      <button onClick={() => setRatio('logo')} style={chipStyle(ratio === 'logo')}>
                        ◇ 透明Logo
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* ═══════════ Normal Left Panel (original settings) ═══════════ */
                <>
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
                        {(findModelConfig(MODEL_ASPECT_RATIOS, selectedModel) || DEFAULT_ASPECT_RATIOS).map((r: string) => (
                          <button key={r} onClick={() => setRatio(r)} style={chipStyle(ratio === r)}>
                            {r}
                          </button>
                        ))}
                        <button onClick={() => setRatio('logo')} style={chipStyle(ratio === 'logo')}>
                          ◇ 透明Logo
                        </button>
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
                </>
              )}
            </div>

            {/* Action buttons at bottom */}
            <div className="p-4 pt-0 space-y-2 shrink-0" style={{ borderTop: `1px solid ${borderColor}`, background: isMonochrome ? 'linear-gradient(0deg, #ffffff, transparent)' : 'linear-gradient(0deg, #0f0f0f, transparent)' }}>
              <div className="pt-3">
                {inspirationRef ? (
                  <button
                    onClick={handleInspirationGenerate}
                    disabled={isGeneratingImage || !inspirationKeywords.trim()}
                    style={{
                      ...goldBtnStyle,
                      opacity: (isGeneratingImage || !inspirationKeywords.trim()) ? 0.5 : 1,
                      cursor: (isGeneratingImage || !inspirationKeywords.trim()) ? 'not-allowed' : 'pointer',
                      background: `linear-gradient(135deg, ${accentColor}, ${isMonochrome ? '#2563eb' : '#c4941e'})`,
                      boxShadow: isMonochrome ? '0 0 16px rgba(59,130,246,0.3)' : '0 0 16px rgba(212,175,55,0.3)',
                    }}
                  >
                    {isGeneratingImage ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : <ImageIcon className="h-4 w-4 inline mr-1" />}
                    灵感同款生成
                  </button>
                ) : (
                  <button
                    onClick={handleGeneratePlans}
                    disabled={isGeneratingPlan || !text.trim()}
                    style={{ ...goldBtnStyle, opacity: (isGeneratingPlan || !text.trim()) ? 0.5 : 1, cursor: (isGeneratingPlan || !text.trim()) ? 'not-allowed' : 'pointer' }}
                  >
                    {isGeneratingPlan ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : <Sparkles className="h-4 w-4 inline mr-1" />}
                    生成字体方案
                  </button>
                )}
              </div>
              {!inspirationRef && (
                <div className="flex gap-2">
                  <button onClick={handleGeneratePrompt} disabled={isGeneratingPrompt || !text.trim()} style={{ ...secondaryBtnStyle, flex: 1, opacity: (isGeneratingPrompt || !text.trim()) ? 0.5 : 1 }}>
                    {isGeneratingPrompt ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : <Wand2 className="h-3 w-3 inline mr-1" />}
                    生成即梦提示词
                  </button>
                  <button onClick={handleBlackOnWhiteTest} disabled={isGeneratingImage || !text.trim() || plans.length === 0} style={{ ...secondaryBtnStyle, flex: 1, opacity: (isGeneratingImage || !text.trim() || plans.length === 0) ? 0.5 : 1 }} title={plans.length === 0 ? '请先生成字体方案' : '按4个方案分别生成黑底白字图片'}>
                    黑底白字测试
                  </button>
                  <button onClick={handleGenerateAllPlanImages} disabled={isGeneratingImage || !text.trim() || plans.length === 0} style={{ ...secondaryBtnStyle, flex: 1, opacity: (isGeneratingImage || !text.trim() || plans.length === 0) ? 0.5 : 1 }} title={plans.length === 0 ? '请先生成字体方案' : '按4个方案分别生成4张匹配图片'}>
                    {isGeneratingImage ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : <ImageIcon className="h-3 w-3 inline mr-1" />}
                    生成方案图片
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ==================== RIGHT PANEL: Results (62%) ==================== */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Tab bar */}
            <div className="flex px-4 shrink-0" style={{ borderBottom: `1px solid ${borderColor}`, background: bgPanel }}>
              {(['plans', 'prompt', 'images', 'gallery', 'history'] as const).map((tab) => (
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
                        <button onClick={() => handleGeneratePlanImage(plan, idx)} disabled={isGeneratingImage} style={{ padding: '5px 12px', borderRadius: 4, fontSize: 11, fontWeight: 500, border: 'none', background: isMonochrome ? '#1a1a1a' : '#d4af37', color: isMonochrome ? '#fff' : '#1a1a1a', cursor: 'pointer', opacity: isGeneratingImage ? 0.5 : 1, transition: 'all 0.2s ease' }}>
                          <Wand2 size={12} className="inline mr-1" />生成图片
                        </button>
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
                  {!prompts && !isGeneratingPrompt && !inspirationRef && (
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
                        <button onClick={handleBlackOnWhiteTest} disabled={isGeneratingImage || plans.length === 0} style={{ ...secondaryBtnStyle, opacity: (isGeneratingImage || plans.length === 0) ? 0.5 : 1 }} title="按4个方案分别生成黑底白字图片">
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
                  {/* Group images by plan */}
                  {(() => {
                    const grouped = new Map<number, GeneratedImage[]>();
                    generatedImages.forEach(img => {
                      const key = img.planIndex ?? 0;
                      if (!grouped.has(key)) grouped.set(key, []);
                      grouped.get(key)!.push(img);
                    });
                    const sortedKeys = Array.from(grouped.keys()).sort((a, b) => a - b);
                    return sortedKeys.map(planIdx => {
                      const imgs = grouped.get(planIdx)!;
                      const planTitle = plans[planIdx]?.title ?? `方案 ${planIdx + 1}`;
                      return (
                        <div key={planIdx} className="mb-4">
                          <p className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: accentColor }}>
                            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: accentColor }}></span>
                            {planTitle}
                          </p>
                          <div className={`grid gap-3 ${(() => { const parts = ratio.split(':'); const w = parseFloat(parts[0]) || 1; const h = parseFloat(parts[1]) || 1; return h > w ? 'grid-cols-1' : 'grid-cols-2'; })()}`}>
                            {imgs.map((img, vIdx) => (
                              <div
                                key={`${planIdx}-${vIdx}`}
                                className="rounded-lg overflow-hidden group relative"
                                style={{ border: `1px solid ${borderColorLight}`, background: cardBgColor, transition: 'all 0.3s' }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = accentColor; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = borderColorLight; }}
                              >
                                <img src={img.url} alt={`${planTitle} 变体${vIdx + 1}`} className="w-full object-cover" style={getAspectRatioStyle(ratio)} crossOrigin="anonymous" />
                                <div
                                  className="absolute inset-0 flex items-center justify-center gap-2 transition-opacity opacity-0 group-hover:opacity-100"
                                  style={{ background: 'rgba(0,0,0,0.7)' }}
                                >
                                  <button onClick={() => handleAddToCanvas(img.url)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: accentColor, color: isMonochrome ? '#ffffff' : '#0a0a0a' }}>
                                    <Plus size={12} className="inline mr-1" />加入画布
                                  </button>
                                  <button
                                    onClick={() => { const a = document.createElement('a'); a.href = img.url; a.download = `font-design-${planIdx + 1}-${vIdx + 1}.png`; a.click(); }}
                                    className="px-3 py-1.5 rounded-lg text-xs text-white"
                                    style={{ border: '1px solid rgba(255,255,255,0.3)' }}
                                  >
                                    <Download size={12} className="inline mr-1" />下载
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()}
                  {generatedImages.length > 0 && (
                    <div className="flex gap-2 justify-center items-center">
                      <span className="text-xs" style={{ color: subTextColor }}>{generatedImages.length} 张图片</span>
                      <button onClick={() => handleGenerateImage('full')} disabled={isGeneratingImage} style={{ ...secondaryBtnStyle, opacity: isGeneratingImage ? 0.5 : 1 }}>
                        <RefreshCw size={12} className="inline mr-1" />重新生成
                      </button>
                      <button onClick={() => onAddImages?.(generatedImages.map(g => g.url))} style={{ ...goldBtnStyle, width: 'auto' }}>
                        <Plus size={12} className="inline mr-1" />全部加入画布
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ========== Tab 4: 灵感图库 ========== */}
              {activeTab === 'gallery' && (
                <div className="flex flex-col gap-3">
                  {/* Header */}
                  <div className="text-center">
                    <Palette className="h-5 w-5 mx-auto mb-1 opacity-40" style={{ color: accentColor }} />
                    <p className="text-sm font-medium" style={{ color: textColor }}>即梦灵感图库</p>
                    <p className="text-[10px] mt-0.5" style={{ color: subTextColor }}>
                      {galleryTotalCount > 0 ? `${galleryTotalCount} 张精选字体设计灵感` : '精选字体设计灵感，一键制作同款'}
                    </p>
                  </div>

                  {/* Search + View mode toggle */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md" style={{ background: isMonochrome ? '#f3f4f6' : '#1c1c1c', border: `1px solid ${borderColor}` }}>
                      <Search size={12} style={{ color: subTextColor }} />
                      <input
                        type="text"
                        value={gallerySearch}
                        onChange={e => { setGallerySearch(e.target.value); setGalleryPage(1); loadGalleryData(galleryFilter, 1, e.target.value); }}
                        placeholder="搜索关键词..."
                        className="flex-1 bg-transparent text-xs outline-none"
                        style={{ color: textColor }}
                      />
                    </div>
                    <div className="flex rounded-md overflow-hidden" style={{ border: `1px solid ${borderColor}` }}>
                      {([['list', List], ['thumbnail', Grid3X3], ['large', Maximize2]] as const).map(([mode, Icon]) => (
                        <button
                          key={mode}
                          onClick={() => setGalleryViewMode(mode)}
                          className="p-1.5 transition-colors"
                          style={{
                            background: galleryViewMode === mode ? accentColor : (isMonochrome ? '#f3f4f6' : '#1c1c1c'),
                            color: galleryViewMode === mode ? (isMonochrome ? '#fff' : '#000') : subTextColor,
                          }}
                          title={mode === 'list' ? '列表模式' : mode === 'thumbnail' ? '缩略图模式' : '大图模式'}
                        >
                          <Icon size={12} />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Category filter pills */}
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => { setGalleryFilter('all'); setGalleryPage(1); loadGalleryData('all', 1, gallerySearch); }}
                      className="px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors"
                      style={{
                        background: galleryFilter === 'all' ? accentColor : (isMonochrome ? '#f3f4f6' : '#1c1c1c'),
                        color: galleryFilter === 'all' ? (isMonochrome ? '#fff' : '#000') : subTextColor,
                        border: `1px solid ${galleryFilter === 'all' ? accentColor : borderColor}`,
                      }}
                    >全部</button>
                    {galleryCategories.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => { setGalleryFilter(cat.id); setGalleryPage(1); loadGalleryData(cat.id, 1, gallerySearch); }}
                        className="px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors"
                        style={{
                          background: galleryFilter === cat.id ? accentColor : (isMonochrome ? '#f3f4f6' : '#1c1c1c'),
                          color: galleryFilter === cat.id ? (isMonochrome ? '#fff' : '#000') : subTextColor,
                          border: `1px solid ${galleryFilter === cat.id ? accentColor : borderColor}`,
                        }}
                      >{cat.name}({cat.count})</button>
                    ))}
                  </div>

                  {/* Gallery content */}
                  {galleryLoading ? (
                    <div className="flex flex-col items-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin mb-2" style={{ color: accentColor }} />
                      <p className="text-xs" style={{ color: subTextColor }}>加载图库中...</p>
                    </div>
                  ) : galleryItems.length === 0 ? (
                    <div className="text-center py-10">
                      <ImageIcon className="h-6 w-6 mx-auto mb-2 opacity-30" />
                      <p className="text-xs" style={{ color: subTextColor }}>暂无灵感数据</p>
                    </div>
                  ) : galleryViewMode === 'list' ? (
                    /* ========== LIST MODE ========== */
                    <div className="flex flex-col gap-1.5">
                      {galleryItems.map(item => (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 p-2 rounded-lg group transition-all"
                          style={{ border: `1px solid ${borderColor}`, background: cardBgColor, cursor: 'default' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = borderColorLight; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = borderColor; }}
                        >
                          <div className="w-10 h-10 rounded overflow-hidden shrink-0" style={{ background: isMonochrome ? '#f3f4f6' : '#1c1c1c' }}>
                            <img
                              src={`${item.localPath || `/api/font-design/gallery-image?id=${item.id}`}`}
                              alt={item.displayText || '灵感'}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate" style={{ color: textColor }}>
                              {item.displayText || item.categoryName}
                            </p>
                            <p className="text-[10px] line-clamp-1" style={{ color: subTextColor }}>
                              {item.prompt.substring(0, 60)}...
                            </p>
                          </div>
                          <button
                            onClick={() => handleUseInspiration(item)}
                            className="shrink-0 px-2 py-1 rounded text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: accentColor, color: isMonochrome ? '#fff' : '#000', cursor: 'pointer' }}
                          >
                            制作同款
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : galleryViewMode === 'thumbnail' ? (
                    /* ========== THUMBNAIL MODE ========== */
                    <div className="grid grid-cols-2 gap-2">
                      {galleryItems.map(item => (
                        <div
                          key={item.id}
                          className="group relative overflow-hidden rounded-lg transition-all"
                          style={{ border: `1px solid ${borderColor}`, background: cardBgColor, cursor: 'default' }}
                        >
                          <div className="relative aspect-[4/3] overflow-hidden" style={{ background: isMonochrome ? '#f3f4f6' : '#111' }}>
                            <img
                              src={`${item.localPath || `/api/font-design/gallery-image?id=${item.id}`}`}
                              alt={item.displayText || '灵感'}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              loading="lazy"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <button
                                onClick={() => handleUseInspiration(item)}
                                className="px-2.5 py-1.5 rounded-md text-[10px] font-medium"
                                style={{ background: accentColor, color: isMonochrome ? '#fff' : '#000', cursor: 'pointer' }}
                              >
                                一键制作同款
                              </button>
                            </div>
                          </div>
                          <div className="p-2">
                            <p className="text-[10px] font-medium truncate" style={{ color: textColor }}>
                              {item.displayText || item.categoryName}
                            </p>
                            <p className="text-[9px] mt-0.5 line-clamp-1" style={{ color: subTextColor }}>
                              {item.prompt.substring(0, 40)}...
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* ========== LARGE IMAGE MODE ========== */
                    <div className="flex flex-col gap-3">
                      {galleryItems.map(item => (
                        <div
                          key={item.id}
                          className="group relative overflow-hidden rounded-lg transition-all"
                          style={{ border: `1px solid ${borderColor}`, background: cardBgColor, cursor: 'default' }}
                        >
                          <div className="relative aspect-[16/9] overflow-hidden" style={{ background: isMonochrome ? '#f3f4f6' : '#111' }}>
                            <img
                              src={`${item.localPath || `/api/font-design/gallery-image?id=${item.id}`}`}
                              alt={item.displayText || '灵感'}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                            <div className="absolute bottom-0 left-0 right-0 p-3">
                              <p className="text-xs font-medium text-white truncate">{item.displayText || item.categoryName}</p>
                              <p className="text-[10px] text-white/70 line-clamp-2 mt-0.5">{item.prompt.substring(0, 100)}</p>
                            </div>
                            <button
                              onClick={() => handleUseInspiration(item)}
                              className="absolute top-2 right-2 px-2.5 py-1.5 rounded-md text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{ background: accentColor, color: isMonochrome ? '#fff' : '#000', cursor: 'pointer' }}
                            >
                              一键制作同款
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Pagination */}
                  {galleryTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <button
                        onClick={() => { const p = Math.max(1, galleryPage - 1); setGalleryPage(p); loadGalleryData(galleryFilter, p, gallerySearch); }}
                        disabled={galleryPage <= 1}
                        className="px-2 py-1 rounded text-[10px]"
                        style={{
                          background: isMonochrome ? '#f3f4f6' : '#1c1c1c',
                          color: galleryPage <= 1 ? subTextColor : textColor,
                          border: `1px solid ${borderColor}`,
                          cursor: galleryPage <= 1 ? 'not-allowed' : 'pointer',
                          opacity: galleryPage <= 1 ? 0.5 : 1,
                        }}
                      >
                        上一页
                      </button>
                      <span className="text-[10px]" style={{ color: subTextColor }}>
                        {galleryPage} / {galleryTotalPages}
                      </span>
                      <button
                        onClick={() => { const p = Math.min(galleryTotalPages, galleryPage + 1); setGalleryPage(p); loadGalleryData(galleryFilter, p, gallerySearch); }}
                        disabled={galleryPage >= galleryTotalPages}
                        className="px-2 py-1 rounded text-[10px]"
                        style={{
                          background: isMonochrome ? '#f3f4f6' : '#1c1c1c',
                          color: galleryPage >= galleryTotalPages ? subTextColor : textColor,
                          border: `1px solid ${borderColor}`,
                          cursor: galleryPage >= galleryTotalPages ? 'not-allowed' : 'pointer',
                          opacity: galleryPage >= galleryTotalPages ? 0.5 : 1,
                        }}
                      >
                        下一页
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ========== Tab 5: 历史记录 ========== */}
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
