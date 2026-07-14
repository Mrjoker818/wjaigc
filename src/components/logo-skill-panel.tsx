'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import {
  PenTool, X, Loader2, Wand2, Star, Eye, ArrowRight,
  Copy, Check, ChevronDown, ChevronRight, RotateCcw,
  RefreshCw, Sparkles, Download, Save, Palette, ImageIcon,
  Layout, GripVertical, Minus, Cpu, Zap, AlertTriangle,
  Settings2, Layers, MessageSquare,
} from 'lucide-react';

/* ========== TYPES ========== */

type Step = 'input' | 'direction' | 'generate' | 'result';

interface LogoDirection {
  positioning: string;
  positioningEn?: string;
  visualMood: string;
  visualMoodEn?: string;
  colorPalette: string[];
  colorPaletteEn?: string[];
  typography: string;
  typographyEn?: string;
  composition: string;
  compositionEn?: string;
  fitReason?: string;
  fitReasonEn?: string;
}

interface SymbolConcept {
  coreMetaphor: string;
  coreMetaphorEn?: string;
  iconForm: string;
  iconFormEn?: string;
  negativeSpaceIdea?: string;
  negativeSpaceIdeaEn?: string;
  alternativeRoutes: string[];
  alternativeRoutesEn?: string[];
}

interface VisualSystemNotes {
  oneColorBehavior: string;
  oneColorBehaviorEn?: string;
  smallSizeBehavior: string;
  smallSizeBehaviorEn?: string;
  recommendedLockups: string[];
  recommendedLockupsEn?: string[];
}

interface BrandSystemBoardLayout {
  canvasSpec: string;
  modules: string[];
  footerValues: string[];
}

interface PlatformPrompt {
  platform: string;
  prompt: string;
  notes?: string;
}

interface ImageModel {
  id: string;
  name: string;
  providerId?: string;
  providerName?: string;
}

interface LogoSkillPanelProps {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[], meta?: { modelName?: string; apiProvider?: string }) => void;
  brandProject?: {
    id?: string;
    brandName?: string;
    description?: string;
    targetAudience?: string;
    tone?: string;
    brandDna?: {
      mainColors?: string[];
      secondaryColors?: string[];
      fontStyle?: string;
    } | null;
  } | null;
  onSaveToBrandAssets?: (logoUrl: string, direction?: LogoDirection) => void;
  onOpenBrandDna?: () => void;
  onOpenMainKv?: () => void;
}

/* ========== CONSTANTS ========== */

const PANEL_W = 780;

const LOGO_TYPES = [
  { value: 'brand', label: '品牌标' },
  { value: 'wordmark', label: '文字标' },
  { value: 'lettermark', label: '字母标' },
  { value: 'pictogram', label: '图形标' },
  { value: 'abstract', label: '抽象标' },
  { value: 'mascot', label: '吉祥物' },
  { value: 'emblem', label: '徽章纹章' },
  { value: 'combination', label: '组合标' },
  { value: 'app-icon', label: 'App 图标' },
  { value: 'dynamic', label: '动态标' },
];

/* ========== Portal 下拉菜单组件（避免 overflow 裁剪）========== */
function ModelDropdownPortal({
  buttonRef,
  isMonochrome,
  children,
}: {
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  isMonochrome: boolean;
  children: React.ReactNode;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (buttonRef?.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const dropH = 240;
      const top = spaceBelow < dropH
        ? rect.top - dropH - 4
        : rect.bottom + 4;
      setStyle({
        position: 'fixed',
        top,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      });
    }
   
  }, [buttonRef]);

  return ReactDOM.createPortal(
    <div
      style={style}
      className={`max-h-60 overflow-y-auto rounded-xl border shadow-2xl ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-white/10'}`}
    >
      {children}
    </div>,
    document.body,
  );
}

const OUTPUT_LAYOUTS = [
  { value: 'brand-system-board', label: '品牌板', icon: Layout },
  { value: 'square-avatar', label: '头像', icon: ImageIcon },
  { value: 'horizontal-lockup', label: '横排', icon: Layout },
  { value: 'vertical-lockup', label: '竖排', icon: Layout },
  { value: 'icon-only', label: '图标', icon: Star },
];

const TARGET_PLATFORMS = [
  { value: 'all', label: '全平台通用' },
  { value: 'gpt-image', label: 'GPT Image' },
  { value: 'midjourney', label: 'Midjourney' },
  { value: 'flux', label: 'Flux' },
  { value: 'ideogram', label: 'Ideogram' },
];

/* ========== COMPONENT ========== */

export default function LogoSkillPanel({
  isMonochrome = false,
  onClose,
  onAddImages,
  brandProject,
  onSaveToBrandAssets,
  onOpenBrandDna,
  onOpenMainKv,
}: LogoSkillPanelProps) {
  // ─── Panel position (draggable) ──────────────────────────────
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  useEffect(() => {
    setPos({
      x: Math.max(20, (window.innerWidth - PANEL_W) / 2),
      y: Math.max(72, (window.innerHeight - 620) / 2),
    });
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
  }, [pos]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - PANEL_W, dragStart.current.px + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 100, dragStart.current.py + dy)),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  // ─── State ─────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('input');
  const [brandName, setBrandName] = useState(brandProject?.brandName || '');
  const [logoType, setLogoType] = useState('brand');
  const [brief, setBrief] = useState(brandProject?.description || '');
  const [audience, setAudience] = useState(brandProject?.targetAudience || '');
  const [preferredStyle, setPreferredStyle] = useState(brandProject?.tone || '');
  const [referenceStyle, setReferenceStyle] = useState(brandProject?.tone || '');
  const [englishName, setEnglishName] = useState('');
  const [outputLayout, setOutputLayout] = useState('brand-system-board');
  const [targetPlatform, setTargetPlatform] = useState('all');
  const [revisionNotes, setRevisionNotes] = useState('');

  // 方向结果
  const [direction, setDirection] = useState<LogoDirection | null>(null);
  const [symbol, setSymbol] = useState<SymbolConcept | null>(null);
  const [visualNotes, setVisualNotes] = useState<VisualSystemNotes | null>(null);
  const [boardLayout, setBoardLayout] = useState<BrandSystemBoardLayout | null>(null);
  const [platformPrompts, setPlatformPrompts] = useState<PlatformPrompt[]>([]);
  const [rawResponse, setRawResponse] = useState('');

  // 生成结果
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  // 加载状态
  const [isGeneratingDirection, setIsGeneratingDirection] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [error, setError] = useState('');

  // 模型列表
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [selectedImageModel, setSelectedImageModel] = useState('');
  const [llmModels, setLlmModels] = useState<ImageModel[]>([]);
  const [selectedLlmModel, setSelectedLlmModel] = useState('');
  const [showLlmDropdown, setShowLlmDropdown] = useState(false);
  const [showImageDropdown, setShowImageDropdown] = useState(false);
  const llmBtnRef = useRef<HTMLButtonElement>(null);
  const imgBtnRef = useRef<HTMLButtonElement>(null);

  // 展开状态
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // 点击面板外关闭下拉菜单
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowLlmDropdown(false);
        setShowImageDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ─── 初始化品牌项目数据 ───────────────────────────────────────
  const brandProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (brandProject) {
      const projId = brandProject.brandName + '|' + (brandProject.description || '');
      if (projId !== brandProjectIdRef.current) {
        brandProjectIdRef.current = projId;
        if (brandProject.brandName) setBrandName(brandProject.brandName);
        if (brandProject.description) setBrief(brandProject.description);
        if (brandProject.targetAudience) setAudience(brandProject.targetAudience);
        if (brandProject.tone) setPreferredStyle(brandProject.tone);
        const refParts: string[] = [];
        if (brandProject.brandDna?.mainColors?.length) {
          refParts.push(`主色: ${brandProject.brandDna.mainColors.join(', ')}`);
        }
        if (brandProject.brandDna?.secondaryColors?.length) {
          refParts.push(`辅助色: ${brandProject.brandDna.secondaryColors.join(', ')}`);
        }
        if (brandProject.brandDna?.fontStyle) {
          refParts.push(`字体: ${brandProject.brandDna.fontStyle}`);
        }
        if (refParts.length > 0) setReferenceStyle(refParts.join('; '));
      }
    }
  }, [brandProject]);

  // ─── 加载模型列表 ────────────────────────────────────────────
  useEffect(() => { loadModels(); }, []);

  async function loadModels() {
    try {
      const [imgRes, chatRes] = await Promise.all([
        fetch('/api/models?type=image'),
        fetch('/api/models?type=chat'),
      ]);
      if (imgRes.ok) {
        const data = await imgRes.json();
        const providerMap = new Map<string, string>();
        if (data.providers && Array.isArray(data.providers)) {
          for (const p of data.providers) {
            providerMap.set(p.id, p.name || p.displayName || '');
          }
        }
        const models = (data.models || []).map((m: Record<string, unknown>) => {
          const pid = (m.providerId as string) || '';
          const modelId = (m.id as string) || (m.modelId as string) || '';
          return {
            id: modelId,
            name: (m.apiDisplayName as string) || (m.name as string) || (m.modelName as string) || modelId,
            providerId: pid,
            providerName: providerMap.get(pid) || pid || '',
          };
        });
        setImageModels(models);
        if (models.length > 0) {
          setSelectedImageModel(`${models[0].providerId}::${models[0].id}`);
        }
      }
      if (chatRes.ok) {
        const data = await chatRes.json();
        const providerMap = new Map<string, string>();
        if (data.providers && Array.isArray(data.providers)) {
          for (const p of data.providers) {
            providerMap.set(p.id, p.name || p.displayName || '');
          }
        }
        const models = (data.models || []).map((m: Record<string, unknown>) => {
          const pid = (m.providerId as string) || '';
          const modelId = (m.id as string) || (m.modelId as string) || '';
          return {
            id: modelId,
            name: (m.apiDisplayName as string) || (m.name as string) || (m.modelName as string) || modelId,
            providerId: pid,
            providerName: providerMap.get(pid) || pid || '',
          };
        });
        setLlmModels(models);
        if (models.length > 0) {
          setSelectedLlmModel(`${models[0].providerId}::${models[0].id}`);
        }
      }
    } catch { /* ignore */ }
  }

  // ─── 生成方向 ───────────────────────────────────────────────
  async function handleGenerateDirection() {
    if (!brandName.trim() || !brief.trim()) {
      setError('请填写品牌名称和品牌简报');
      return;
    }
    setIsGeneratingDirection(true);
    setError('');
    try {
      const { modelId: llmModel, providerId: llmProviderId } = parseCompositeKey(selectedLlmModel);
      const res = await fetch('/api/logo-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-directions',
          brandName: brandName.trim(),
          brief: brief.trim(),
          logoType,
          audience: audience.trim() || undefined,
          preferredStyle: preferredStyle.trim() || undefined,
          referenceStyle: referenceStyle.trim() || undefined,
          outputLayout,
          targetPlatform,
          englishName: englishName.trim() || undefined,
          llmModel: llmModel || undefined,
          llmProviderId: llmProviderId || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || '生成方向失败'); return; }
      setDirection(data.direction);
      setSymbol(data.symbol);
      setVisualNotes(data.visualNotes);
      setBoardLayout(data.boardLayout);
      setPlatformPrompts(data.platformPrompts || []);
      setRawResponse(data.rawResponse || '');
      setStep('direction');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setIsGeneratingDirection(false);
    }
  }

  // ─── 修订方向 ───────────────────────────────────────────────
  async function handleRefineDirection() {
    if (!revisionNotes.trim()) return;
    setIsGeneratingDirection(true);
    setError('');
    try {
      const { modelId: llmModel, providerId: llmProviderId } = parseCompositeKey(selectedLlmModel);
      const res = await fetch('/api/logo-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refine-direction',
          brandName: brandName.trim(),
          brief: brief.trim(),
          logoType,
          audience: audience.trim() || undefined,
          preferredStyle: preferredStyle.trim() || undefined,
          referenceStyle: referenceStyle.trim() || undefined,
          outputLayout,
          targetPlatform,
          englishName: englishName.trim() || undefined,
          revisionNotes: revisionNotes.trim(),
          llmModel: llmModel || undefined,
          llmProviderId: llmProviderId || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || '修订方向失败'); return; }
      setDirection(data.direction);
      setSymbol(data.symbol);
      setVisualNotes(data.visualNotes);
      setBoardLayout(data.boardLayout);
      setPlatformPrompts(data.platformPrompts || []);
      setRawResponse(data.rawResponse || '');
      setRevisionNotes('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setIsGeneratingDirection(false);
    }
  }

  // ─── 生成图像 ───────────────────────────────────────────────
  async function handleGenerateImage() {
    const bestPrompt = platformPrompts.find(p => p.platform === 'GPT Image')?.prompt
      || platformPrompts.find(p => p.platform === 'Universal')?.prompt;
    if (!bestPrompt) { setError('没有可用的生成提示词'); return; }
    setIsGeneratingImage(true);
    setError('');
    setImageUrls([]);
    setTaskId(null);
    setStep('generate');
    try {
      const { modelId: imgModel, providerId: imgProviderId } = parseCompositeKey(selectedImageModel);
      const imgModelInfo = (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s) : {}; } catch { return {}; } })();
      const imgQuality = imgModelInfo.quality || '1K';
      const imgAspectRatio = imgModelInfo.aspectRatio || '1:1';
      const res = await fetch('/api/logo-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-image',
          prompt: bestPrompt,
          imageModel: imgModel || undefined,
          imageProviderId: imgProviderId || undefined,
          quality: imgQuality,
          aspectRatio: imgAspectRatio,
          n: 1,
        }),
      });
      const data = await res.json();
      if (!data.success && data.status !== 'processing') {
        const errMsg = data.error || '图像生成失败';
        if (errMsg.includes('all failover groups exhausted') || errMsg.includes('channel')) {
          setError('当前 API 渠道繁忙，请稍后重试或切换其他图像模型');
        } else if (errMsg.includes('未找到可用的图像模型')) {
          setError('未配置图像模型，请在管理员后台添加 API 提供商');
        } else {
          setError(errMsg);
        }
        setStep('direction');
        return;
      }
      if (data.imageUrls && data.imageUrls.length > 0) {
        setImageUrls(data.imageUrls);
        setSelectedImageUrl(data.imageUrls[0]);
        setStep('result');
      } else if (data.taskId) {
        setTaskId(data.taskId);
        pollForResult(data.taskId, data.imageModel, data.apiBaseUrl, data.apiKey);
      } else {
        setError('图像生成返回格式异常');
        setStep('direction');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误');
      setStep('direction');
    } finally {
      setIsGeneratingImage(false);
    }
  }

  // ─── 轮询异步任务 ────────────────────────────────────────────
  async function pollForResult(tid: string, model: string, apiBaseUrl?: string, apiKey?: string) {
    const maxAttempts = 60;
    const interval = 3000;
    let attempts = 0;
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, interval));
      attempts++;
      try {
        const res = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: tid, model, providerId: selectedImageModel?.split('::')[0] || undefined, apiBaseUrl, apiKey }),
        });
        const data = await res.json();
        if (data.status === 'completed' && data.imageUrls?.length > 0) {
          setImageUrls(data.imageUrls);
          setSelectedImageUrl(data.imageUrls[0]);
          setStep('result');
          return;
        }
        if (data.status === 'failed') {
          setError(data.error || '图像生成失败');
          setStep('direction');
          return;
        }
      } catch { /* continue polling */ }
    }
    setError('图像生成超时，请稍后重试');
    setStep('direction');
  }

  // ─── 复制 Prompt ────────────────────────────────────────────
  async function handleCopyPrompt(prompt: string, platform: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(platform);
      setTimeout(() => setCopiedPrompt(null), 2000);
    } catch { /* ignore */ }
  }

  // ─── 保存到画布 ──────────────────────────────────────────────
  function handleAddToCanvas() {
    if (selectedImageUrl && onAddImages) {
      const meta: { modelName?: string; apiProvider?: string } = {};
      if (selectedImageModel) {
        const { modelId, providerId } = parseCompositeKey(selectedImageModel);
        meta.modelName = modelId;
        if (providerId) meta.apiProvider = providerId;
      }
      onAddImages([selectedImageUrl], meta);
    }
  }

  // ─── 保存到品牌资产 ──────────────────────────────────────────
  const [isSavingToBrand, setIsSavingToBrand] = useState(false);
  const [savedToBrand, setSavedToBrand] = useState(false);

  function handleSaveToBrandAssets() {
    if (!selectedImageUrl) return;
    setIsSavingToBrand(true);

    // 如果有品牌项目，直接更新项目的 logoUrl
    const savePromises: Promise<void>[] = [];

    if (brandProject?.id) {
      savePromises.push(
        fetch('/api/brand-factory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update-project',
            id: brandProject.id,
            logoUrl: selectedImageUrl,
          }),
        }).then(res => res.json()).then(data => {
          if (!data.success) console.error('品牌工厂更新失败:', data.error);
        }).catch(err => console.error('品牌工厂保存出错:', err))
      );
    }

    // 同时保存到 logo-skill 的资产记录
    savePromises.push(
      fetch('/api/logo-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-asset',
          brandName,
          logoType,
          logoUrl: selectedImageUrl,
          direction: direction || undefined,
          symbol: symbol || undefined,
          visualNotes: visualNotes || undefined,
          platformPrompts: platformPrompts.length > 0 ? platformPrompts : undefined,
          projectId: brandProject?.id,
        }),
      }).then(res => res.json()).then(data => {
        if (!data.success) console.error('Logo资产保存失败:', data.error);
      }).catch(err => console.error('Logo资产保存出错:', err))
    );

    Promise.all(savePromises).then(() => {
      setSavedToBrand(true);
    }).catch(() => {
    }).finally(() => setIsSavingToBrand(false));
  }

  // ─── 重新开始 ────────────────────────────────────────────────
  function handleReset() {
    setStep('input');
    setDirection(null);
    setSymbol(null);
    setVisualNotes(null);
    setBoardLayout(null);
    setPlatformPrompts([]);
    setRawResponse('');
    setImageUrls([]);
    setTaskId(null);
    setSelectedImageUrl(null);
    setError('');
    setRevisionNotes('');
  }

  // ─── 样式 (黑金/单色双主题) ──────────────────────────────────
  const bg = isMonochrome ? 'bg-white' : 'bg-[#0d0d0d]';
  const textPrimary = isMonochrome ? 'text-gray-900' : 'text-white';
  const textSecondary = isMonochrome ? 'text-gray-500' : 'text-gray-400';
  const border = isMonochrome ? 'border-gray-200' : 'border-white/10';
  const cardBg = isMonochrome ? 'bg-gray-50' : 'bg-white/5';
  const inputBg = isMonochrome ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10';
  const accent = isMonochrome ? 'text-blue-600' : 'text-[#d4af37]';
  const accentBg = isMonochrome ? 'bg-blue-600' : 'bg-[#d4af37]';
  const accentBgHover = isMonochrome ? 'hover:bg-blue-700' : 'hover:bg-[#c4a030]';
  const glassBg = isMonochrome ? 'bg-white/80 backdrop-blur-sm' : 'bg-white/[0.03] backdrop-blur-xl';
  const headerBg = isMonochrome ? 'bg-gray-50' : 'bg-[#111]';

  // ─── 步骤指示器 ──────────────────────────────────────────────
  const steps: Step[] = ['input', 'direction', 'generate', 'result'];
  const stepLabels: Record<Step, string> = { input: '输入', direction: '方向', generate: '生成', result: '结果' };

  // ─── 模型分组 ─────────────────────────────────────────────────
  function groupModelsByProvider(models: ImageModel[]): Record<string, ImageModel[]> {
    const grouped: Record<string, ImageModel[]> = {};
    models.forEach(m => {
      const key = m.providerName || '默认';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(m);
    });
    return grouped;
  }

  function parseCompositeKey(key: string): { modelId: string; providerId: string } {
    if (key.includes('::')) {
      const [pid, ...rest] = key.split('::');
      return { providerId: pid, modelId: rest.join('::') };
    }
    return { modelId: key, providerId: '' };
  }

  function getSelectedModelInfo(models: ImageModel[], compositeKey: string): ImageModel | undefined {
    const { modelId, providerId } = parseCompositeKey(compositeKey);
    return models.find(m => m.id === modelId && m.providerId === providerId);
  }

  /* ========== 渲染：模型选择下拉 ========== */
  function renderModelDropdown(
    models: ImageModel[],
    selected: string,
    onSelect: (key: string) => void,
    show: boolean,
    onToggle: () => void,
    icon: React.ReactNode,
    placeholder: string,
    buttonRef?: React.RefObject<HTMLButtonElement | null>,
  ) {
    const selectedInfo = getSelectedModelInfo(models, selected);

    return (
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={onToggle}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors ${inputBg} ${textPrimary} hover:brightness-110 focus:outline-none cursor-pointer`}
        >
          <span className="truncate text-left flex items-center gap-2 min-w-0">
            {icon}
            <span className="truncate">{selectedInfo?.name || placeholder}</span>
            {selectedInfo?.providerName && (
              <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${isMonochrome ? 'bg-gray-100 text-gray-500' : 'bg-white/10 text-white/50'}`}>
                {selectedInfo.providerName}
              </span>
            )}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${show ? 'rotate-180' : ''} ${isMonochrome ? 'text-gray-400' : 'text-gray-500'}`} />
        </button>
        {show && (
          <ModelDropdownPortal
            buttonRef={buttonRef}
            isMonochrome={isMonochrome}
          >
            {Object.entries(groupModelsByProvider(models)).map(([providerName, pModels]) => (
              <div key={providerName}>
                <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider sticky top-0 ${isMonochrome ? 'text-gray-400 bg-gray-50 border-b border-gray-100' : 'text-white/40 bg-[#1a1a1a] border-b border-white/5'}`}>
                  {providerName}
                </div>
                {pModels.map(m => {
                  const compositeKey = `${m.providerId}::${m.id}`;
                  const isSelected = selected === compositeKey;
                  return (
                    <button
                      key={compositeKey}
                      type="button"
                      onClick={() => { onSelect(compositeKey); setShowLlmDropdown(false); setShowImageDropdown(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors cursor-pointer ${
                        isSelected
                          ? isMonochrome
                            ? 'bg-blue-50 text-blue-600 font-semibold'
                            : 'bg-[#d4af37]/10 text-[#d4af37] font-semibold'
                          : isMonochrome
                            ? 'text-gray-700 hover:bg-gray-50'
                            : 'text-white/80 hover:bg-white/5'
                      }`}
                    >
                      <span className="truncate flex-1 text-left">{m.name}</span>
                      {isSelected && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </ModelDropdownPortal>
        )}
      </div>
    );
  }

  /* ========== 主渲染 ========== */
  return (
    <div
      ref={panelRef}
      className={`fixed z-[90] ${dragging ? 'cursor-grabbing' : ''}`}
      style={{ left: pos.x, top: pos.y, width: PANEL_W }}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      data-popup
    >
      <div
        data-floating-panel="true"
        className={`flex flex-col rounded-2xl overflow-hidden ${bg} border ${border} ${
          dragging
            ? `ring-2 ${isMonochrome ? 'ring-blue-500/30 shadow-[0_0_30px_rgba(59,130,246,0.15)]' : 'ring-[#d4af37]/30 shadow-[0_0_30px_rgba(212,175,55,0.2)]'}`
            : isMonochrome
              ? 'shadow-[0_8px_32px_rgba(0,0,0,0.12)]'
              : 'shadow-[0_8px_32px_rgba(0,0,0,0.6),0_0_0_1px_rgba(212,175,55,0.1)]'
        }`}
        style={{ maxHeight: isMinimized ? undefined : 'calc(100vh - 80px)' }}
      >
        {/* ─── 标题栏 ─────────────────────────────────────── */}
        <div
          className={`flex items-center justify-between px-6 py-3.5 border-b select-none cursor-grab active:cursor-grabbing shrink-0 ${headerBg} ${border}`}
          onMouseDown={onDragStart}
        >
          <div className="flex items-center gap-3">
            <GripVertical className={`h-4 w-4 ${isMonochrome ? 'text-gray-300' : 'text-gray-600'}`} />
            <div className={`w-8 h-8 rounded-lg ${accentBg} flex items-center justify-center shadow-sm`}>
              <PenTool className="h-4 w-4 text-white" />
            </div>
            <h1 className={`text-base font-bold ${textPrimary} tracking-tight`}>Logo Generator Pro</h1>
          </div>

          {/* 步骤指示器 */}
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center">
                {i > 0 && (
                  <div className={`w-8 h-px mx-1 ${steps.indexOf(step) > i ? (isMonochrome ? 'bg-blue-400' : 'bg-[#d4af37]') : (isMonochrome ? 'bg-gray-200' : 'bg-white/10')}`} />
                )}
                <div
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${
                    step === s
                      ? `${accentBg} text-white`
                      : steps.indexOf(step) > i
                        ? isMonochrome
                          ? 'text-blue-600 bg-blue-50'
                          : 'text-[#d4af37] bg-[#d4af37]/10'
                        : isMonochrome
                          ? 'text-gray-400'
                          : 'text-gray-600'
                  }`}
                >
                  {stepLabels[s]}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => setIsMinimized(!isMinimized)} className={`p-2 rounded-lg ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-white/10'} transition-colors cursor-pointer`}>
              <Minus className={`h-4 w-4 ${textSecondary}`} />
            </button>
            <button onClick={onClose} className={`p-2 rounded-lg ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-white/10'} transition-colors cursor-pointer`}>
              <X className={`h-4 w-4 ${textSecondary}`} />
            </button>
          </div>
        </div>

        {/* ─── 内容区 ─────────────────────────────────── */}
        {!isMinimized && (
          <div className="flex-1 overflow-y-auto">
            {error && (
              <div className={`mx-6 mt-4 p-3.5 rounded-xl border text-sm flex items-start gap-2.5 ${
                isMonochrome ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-500/10 border-red-500/20 text-red-400'
              }`}>
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {step === 'input' && renderInputStep()}
            {step === 'direction' && renderDirectionStep()}
            {step === 'generate' && renderGeneratingStep()}
            {step === 'result' && renderResultStep()}
          </div>
        )}
      </div>
    </div>
  );

  // ─── Step 1: 输入 ─────────
  function renderInputStep() {
    return (
      <div className="p-6 space-y-6">
        {/* ── 第一行：品牌名称 + 英文名 ── */}
        <div className="grid grid-cols-[1fr_200px] gap-4">
          <div>
            <label className={`block text-sm font-semibold mb-2 ${textPrimary}`}>
              品牌名称 <span className="text-red-500">*</span>
            </label>
            <input
              value={brandName}
              onChange={e => setBrandName(e.target.value)}
              placeholder="中文品牌名称"
              className={`w-full px-4 py-3 rounded-xl border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} transition-shadow`}
            />
          </div>
          <div>
            <label className={`block text-sm font-semibold mb-2 ${textPrimary}`}>英文名</label>
            <input
              value={englishName}
              onChange={e => setEnglishName(e.target.value)}
              placeholder="English Name"
              className={`w-full px-4 py-3 rounded-xl border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} transition-shadow`}
            />
          </div>
        </div>

        {/* ── 第二行：品牌简报 ── */}
        <div>
          <label className={`block text-sm font-semibold mb-2 ${textPrimary}`}>
            品牌简报 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            placeholder="描述你的品牌：做什么、服务谁、有什么独特价值..."
            rows={3}
            className={`w-full px-4 py-3 rounded-xl border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} resize-y transition-shadow leading-relaxed`}
          />
        </div>

        {/* ── 第三行：受众 / 偏好风格 / 参考风格 ── */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={`block text-xs font-medium mb-2 ${textSecondary}`}>目标受众</label>
            <input
              value={audience}
              onChange={e => setAudience(e.target.value)}
              placeholder="如：25-35岁都市白领"
              className={`w-full px-3.5 py-2.5 rounded-lg border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} transition-shadow`}
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-2 ${textSecondary}`}>偏好风格</label>
            <input
              value={preferredStyle}
              onChange={e => setPreferredStyle(e.target.value)}
              placeholder="如：极简现代"
              className={`w-full px-3.5 py-2.5 rounded-lg border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} transition-shadow`}
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-2 ${textSecondary}`}>参考风格</label>
            <input
              value={referenceStyle}
              onChange={e => setReferenceStyle(e.target.value)}
              placeholder="色彩、布局、间距..."
              className={`w-full px-3.5 py-2.5 rounded-lg border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} transition-shadow`}
            />
          </div>
        </div>

        {/* ── 第四行：Logo 类型（左半）+ 输出布局（右半）── */}
        <div className="grid grid-cols-2 gap-6">
          {/* Logo 类型 — 3 列网格 */}
          <div>
            <label className={`block text-sm font-semibold mb-2.5 ${textPrimary}`}>Logo 类型</label>
            <div className="grid grid-cols-5 gap-1.5">
              {LOGO_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setLogoType(t.value)}
                  className={`px-2 py-2 rounded-lg text-[11px] font-medium transition-all duration-200 cursor-pointer text-center ${
                    logoType === t.value
                      ? `${accentBg} text-white shadow-sm`
                      : isMonochrome
                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        : 'bg-white/8 text-gray-300 hover:bg-white/15'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* 输出布局 — 图标网格 5 列横排 */}
          <div>
            <label className={`block text-sm font-semibold mb-2.5 ${textPrimary}`}>输出布局</label>
            <div className="grid grid-cols-5 gap-2">
              {OUTPUT_LAYOUTS.map(l => {
                const Icon = l.icon;
                return (
                  <button
                    key={l.value}
                    onClick={() => setOutputLayout(l.value)}
                    title={l.label}
                    className={`flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-lg transition-all duration-200 cursor-pointer ${
                      outputLayout === l.value
                        ? isMonochrome
                          ? 'border-2 border-blue-500 bg-blue-50'
                          : 'border-2 border-[#d4af37] bg-[#d4af37]/10'
                        : `${cardBg} hover:opacity-80 border border-transparent`
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${outputLayout === l.value ? accent : textSecondary}`} />
                    <span className={`text-[10px] font-medium whitespace-nowrap ${outputLayout === l.value ? textPrimary : textSecondary}`}>{l.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── 第五行：模型 + 高级设置 + 生成按钮 ── */}
        <div className={`rounded-xl border ${border} ${glassBg} p-5 space-y-4`}>
          {/* 模型行 */}
          <div className="grid grid-cols-2 gap-4">
            {/* LLM 模型 */}
            <div>
              <label className={`block text-xs font-medium mb-2 ${textSecondary}`}>LLM 模型</label>
              {llmModels.length === 0 ? (
                <div className={`px-3 py-2.5 rounded-lg border text-xs ${inputBg} ${textSecondary}`}>未配置</div>
              ) : (
                renderModelDropdown(
                  llmModels, selectedLlmModel, setSelectedLlmModel,
                  showLlmDropdown,
                  () => { setShowLlmDropdown(v => !v); setShowImageDropdown(false); },
                  <Cpu className="h-4 w-4 shrink-0 opacity-60" />,
                  '选择 LLM',
                  llmBtnRef,
                )
              )}
            </div>
            {/* 图像模型 */}
            <div>
              <label className={`block text-xs font-medium mb-2 ${textSecondary}`}>图像模型</label>
              {imageModels.length === 0 ? (
                <div className={`px-3 py-2.5 rounded-lg border text-xs ${inputBg} ${textSecondary}`}>未配置</div>
              ) : (
                renderModelDropdown(
                  imageModels, selectedImageModel, setSelectedImageModel,
                  showImageDropdown,
                  () => { setShowImageDropdown(v => !v); setShowLlmDropdown(false); },
                  <ImageIcon className="h-4 w-4 shrink-0 opacity-60" />,
                  '选择图像模型',
                  imgBtnRef,
                )
              )}
            </div>
          </div>

          {/* 高级设置（折叠） */}
          <div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${textSecondary} hover:${textPrimary}`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              高级设置
              {showSettings ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            {showSettings && (
              <div className={`mt-2.5 pt-2.5 border-t ${isMonochrome ? 'border-gray-200' : 'border-white/10'}`}>
                <label className={`block text-[11px] font-medium mb-1.5 ${textSecondary}`}>目标平台</label>
                <select
                  value={targetPlatform}
                  onChange={e => setTargetPlatform(e.target.value)}
                  className={`w-64 px-4 py-2 rounded-lg border text-sm ${inputBg} ${textPrimary} focus:outline-none cursor-pointer`}
                >
                  {TARGET_PLATFORMS.map(p => (
                    <option key={p.value} value={p.value} className={isMonochrome ? '' : 'bg-[#1a1a1a] text-white'}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* 生成按钮 */}
          <button
            onClick={handleGenerateDirection}
            disabled={isGeneratingDirection || !brandName.trim() || !brief.trim()}
            className={`w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer ${
              isGeneratingDirection || !brandName.trim() || !brief.trim()
                ? isMonochrome
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-white/10 text-gray-500 cursor-not-allowed'
                : `${accentBg} ${accentBgHover} text-white shadow-lg hover:shadow-xl active:scale-[0.98]`
            }`}
          >
            {isGeneratingDirection ? (
              <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
            ) : (
              <><Wand2 className="h-4 w-4" />生成 Logo 方向</>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ─── Step 2: 方向展示 — 全宽两段式 ──────────────
  // 双语渲染辅助：中英双语显示
  function bilingual(zh: string, en?: string) {
    if (!en || en === zh) return <span className={`text-[13px] leading-relaxed ${textPrimary}`}>{zh}</span>;
    return (
      <div className="space-y-0.5">
        <p className={`text-[13px] leading-relaxed ${textPrimary}`}>{zh}</p>
        <p className={`text-[11px] leading-relaxed ${textSecondary} italic`}>{en}</p>
      </div>
    );
  }

  function renderDirectionStep() {
    return (
      <div className="p-4 space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        {/* 三栏横向布局：Logo方向 | 符号概念 | 视觉系统 */}
        <div className="grid grid-cols-3 gap-3">
          {/* Logo 方向 */}
          {direction && (
            <div className={`rounded-xl border ${border} ${glassBg} p-4 space-y-3`}>
              <div className="flex items-center gap-1.5">
                <CompassIcon className={`h-4 w-4 ${accent}`} />
                <h3 className={`font-bold text-[13px] ${textPrimary}`}>Logo 方向</h3>
                {direction.visualMood && (
                  <span className={`ml-auto px-2 py-0.5 rounded-full text-[9px] font-semibold ${
                    isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-[#d4af37]/15 text-[#d4af37]'
                  }`}>
                    {direction.visualMood}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1 block`}>定位 Positioning</span>
                  {bilingual(direction.positioning || '待确定', direction.positioningEn)}
                </div>
                <div>
                  <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1 block`}>构图 Composition</span>
                  {bilingual(direction.composition, direction.compositionEn)}
                </div>
                <div>
                  <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1 block`}>字体 Typography</span>
                  {bilingual(direction.typography, direction.typographyEn)}
                </div>
                {direction.colorPalette.length > 0 && (
                  <div>
                    <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1.5 block`}>配色 Palette</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {direction.colorPalette.map((c, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <div className="w-5 h-5 rounded border border-white/20" style={{ backgroundColor: c.startsWith('#') ? c : undefined }} />
                          <span className={`text-[10px] font-mono ${textSecondary}`}>{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 符号概念 */}
          {symbol && (
            <div className={`rounded-xl border ${border} ${glassBg} p-4 space-y-3`}>
              <div className="flex items-center gap-1.5">
                <Star className={`h-4 w-4 ${accent}`} />
                <h3 className={`font-bold text-[13px] ${textPrimary}`}>符号概念</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1 block`}>核心隐喻 Core Metaphor</span>
                  {bilingual(symbol.coreMetaphor || '待确定', symbol.coreMetaphorEn)}
                </div>
                <div>
                  <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1 block`}>图标形式 Icon Form</span>
                  {bilingual(symbol.iconForm, symbol.iconFormEn)}
                </div>
                {symbol.negativeSpaceIdea && (
                  <div>
                    <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1 block`}>负空间 Negative Space</span>
                    {bilingual(symbol.negativeSpaceIdea, symbol.negativeSpaceIdeaEn)}
                  </div>
                )}
                {symbol.alternativeRoutes.length > 0 && (
                  <div>
                    <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1 block`}>替代路线 Alternatives</span>
                    <ul className="space-y-1">
                      {symbol.alternativeRoutes.map((r, i) => {
                        const enRoute = symbol.alternativeRoutesEn?.[i];
                        return (
                          <li key={i} className="flex items-start gap-1.5">
                            <ArrowRight className={`h-3 w-3 mt-1 ${accent} shrink-0`} />
                            {bilingual(r, enRoute)}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 视觉系统 */}
          {visualNotes && (
            <div className={`rounded-xl border ${border} ${glassBg} p-4 space-y-3`}>
              <div className="flex items-center gap-1.5">
                <Eye className={`h-4 w-4 ${accent}`} />
                <h3 className={`font-bold text-[13px] ${textPrimary}`}>视觉系统</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1 block`}>单色行为 Monochrome</span>
                  {bilingual(visualNotes.oneColorBehavior, visualNotes.oneColorBehaviorEn)}
                </div>
                <div>
                  <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1 block`}>小尺寸行为 Small Size</span>
                  {bilingual(visualNotes.smallSizeBehavior, visualNotes.smallSizeBehaviorEn)}
                </div>
                {visualNotes.recommendedLockups.length > 0 && (
                  <div>
                    <span className={`text-[9px] font-semibold uppercase tracking-wider ${textSecondary} mb-1.5 block`}>推荐组合 Lockups</span>
                    <div className="flex flex-wrap gap-1.5">
                      {visualNotes.recommendedLockups.map((l, i) => (
                        <span key={i} className={`px-2 py-0.5 rounded text-[10px] ${cardBg} ${textSecondary}`}>{l}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 下半段A：修订方向 — 独立卡片 */}
        <div className={`rounded-xl border ${border} ${glassBg} px-5 py-3.5`}>
          <div className="flex items-center gap-3">
            <RefreshCw className={`h-4 w-4 shrink-0 ${accent}`} />
            <input
              value={revisionNotes}
              onChange={e => setRevisionNotes(e.target.value)}
              placeholder="输入修订意见，调整方向后重新生成..."
              className={`flex-1 min-w-0 px-3 py-2.5 rounded-lg border text-[13px] ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} transition-shadow`}
              onKeyDown={e => { if (e.key === 'Enter' && revisionNotes.trim()) handleRefineDirection(); }}
            />
            <button
              onClick={handleRefineDirection}
              disabled={!revisionNotes.trim() || isGeneratingDirection}
              className={`px-4 py-2.5 rounded-lg text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                isMonochrome ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {isGeneratingDirection ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              修订方向
            </button>
          </div>
        </div>

        {/* 下半段B：操作栏 — 模型+生成 */}
        <div className={`rounded-xl border ${border} ${glassBg} px-5 py-3.5`}>
          <div className="flex items-center gap-4">
            {/* 图像模型 */}
            <div className="shrink-0">
              {imageModels.length === 0 ? (
                <span className={`text-[11px] ${textSecondary}`}>未配置图像模型</span>
              ) : (
                renderModelDropdown(
                  imageModels, selectedImageModel, setSelectedImageModel,
                  showImageDropdown,
                  () => { setShowImageDropdown(v => !v); setShowLlmDropdown(false); },
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />,
                  '选择图像模型',
                  imgBtnRef,
                )
              )}
            </div>

            {/* 分隔线 */}
            <div className={`w-px h-8 shrink-0 ${isMonochrome ? 'bg-gray-200' : 'bg-white/10'}`} />

            {/* 生成 + 重来 */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleGenerateImage}
                disabled={isGeneratingImage || imageModels.length === 0}
                className={`px-6 py-2.5 rounded-lg font-bold text-[14px] flex items-center gap-2 ${accentBg} ${accentBgHover} text-white transition-all duration-200 disabled:opacity-50 active:scale-[0.98] cursor-pointer`}
              >
                {isGeneratingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                生成 Logo
              </button>
              <button
                onClick={handleReset}
                className={`px-3 py-2.5 rounded-lg text-[13px] transition-colors font-medium cursor-pointer ${
                  isMonochrome ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                重来
              </button>
            </div>

            {/* 平台 Prompt 按钮 — 右侧 */}
            {platformPrompts.length > 0 && (
              <>
                <div className={`w-px h-8 shrink-0 ${isMonochrome ? 'bg-gray-200' : 'bg-white/10'}`} />
                <button
                  onClick={() => setExpandedPrompt(expandedPrompt === '__list__' ? null : '__list__')}
                  className={`text-[11px] ${textSecondary} hover:underline flex items-center gap-1 cursor-pointer shrink-0`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {expandedPrompt === '__list__' ? '隐藏' : '查看'}平台 Prompt ({platformPrompts.length})
                  {expandedPrompt === '__list__' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
              </>
            )}
          </div>

          {/* 平台 Prompt 展开区域 */}
          {expandedPrompt === '__list__' && platformPrompts.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-2">
              {platformPrompts.map((pp, i) => (
                <div key={i} className={`rounded-lg border ${border} overflow-hidden`}>
                  <div className={`px-3 py-2 flex items-center justify-between ${cardBg}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[11px] font-bold ${accent}`}>{pp.platform}</span>
                      {pp.notes && <span className={`text-[10px] ${textSecondary} truncate`}>{pp.notes}</span>}
                    </div>
                    <button
                      onClick={() => handleCopyPrompt(pp.prompt, pp.platform)}
                      className={`p-1 rounded cursor-pointer ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-white/10'} transition-colors shrink-0`}
                      title="复制"
                    >
                      {copiedPrompt === pp.platform ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className={`h-3.5 w-3.5 ${textSecondary}`} />}
                    </button>
                  </div>
                  <div className={`px-3 py-2 ${isMonochrome ? 'bg-white' : 'bg-black/20'}`}>
                    <pre className={`text-[10px] ${textSecondary} whitespace-pre-wrap break-all leading-relaxed`}>{pp.prompt}</pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 原始响应 — 独立区块 */}
        {rawResponse && (
          <div>
            <button
              onClick={() => setShowRawResponse(!showRawResponse)}
              className={`text-[11px] ${textSecondary} hover:underline flex items-center gap-1 cursor-pointer`}
            >
              {showRawResponse ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {showRawResponse ? '隐藏' : '查看'}原始 LLM 响应
            </button>
            {showRawResponse && (
              <pre className={`mt-2 p-3 rounded-lg text-[10px] ${textSecondary} whitespace-pre-wrap break-all overflow-auto max-h-32 ${cardBg}`}>
                {rawResponse}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Step 3: 生成中 ──────────────────────────────────────────
  function renderGeneratingStep() {
    return (
      <div className="py-20 flex items-center justify-center">
        <div className="text-center">
          <div className={`w-28 h-28 rounded-2xl ${glassBg} border ${border} flex items-center justify-center mx-auto mb-5 relative`}>
            <Loader2 className={`h-14 w-14 animate-spin ${accent}`} />
          </div>
          <h2 className={`text-base font-bold ${textPrimary} mb-2`}>正在生成 Logo</h2>
          <p className={`text-sm ${textSecondary}`}>
            {taskId ? '图像生成中，请稍候...' : '正在准备提示词...'}
          </p>
          {taskId && (
            <div className="mt-4 flex justify-center">
              <div className={`w-56 h-1.5 rounded-full ${cardBg} overflow-hidden`}>
                <div className="h-full bg-gradient-to-r from-transparent via-[#d4af37] to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Step 4: 结果（左大图 + 右操作） ────────────────────────────
  function renderResultStep() {
    return (
      <div className="p-6">
        <div className="flex gap-6">
          {/* ── 左：大图预览 + 缩略图 ── */}
          <div className="flex-1 min-w-0 space-y-3">
            {selectedImageUrl && (
              <div className={`rounded-xl overflow-hidden border ${border} ${isMonochrome ? 'bg-gray-50' : 'bg-white/5'}`}>
                <img src={selectedImageUrl} alt="Logo 预览" className="w-full aspect-square object-contain bg-white" />
              </div>
            )}
            {imageUrls.length > 1 && (
              <div className="flex gap-2.5">
                {imageUrls.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => { setSelectedImageUrl(url); setSavedToBrand(false); }}
                    className={`w-20 h-20 rounded-lg overflow-hidden border-2 transition-all duration-200 cursor-pointer ${
                      selectedImageUrl === url
                        ? isMonochrome ? 'border-blue-500 shadow-md' : 'border-[#d4af37] shadow-[0_0_12px_rgba(212,175,55,0.2)]'
                        : `${border} hover:opacity-80`
                    }`}
                  >
                    <img src={url} alt={`Logo ${i + 1}`} className="w-full h-full object-contain bg-white" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── 右：操作面板 ── */}
          <div className="w-[280px] shrink-0 space-y-4">
            {/* 主操作 */}
            <div className={`rounded-xl border ${border} ${glassBg} p-4`}>
              <h3 className={`text-sm font-semibold mb-3 ${textPrimary}`}>操作</h3>
              <div className="space-y-2.5">
                <button
                  onClick={handleAddToCanvas}
                  className={`w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer ${accentBg} ${accentBgHover} text-white`}
                >
                  <Download className="h-4 w-4" />添加到画布
                </button>
                {brandProject && (
                  <button
                    onClick={handleSaveToBrandAssets}
                    disabled={isSavingToBrand || !selectedImageUrl}
                    className={`w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 cursor-pointer ${
                      savedToBrand
                        ? 'bg-green-500/20 text-green-400'
                        : `${accentBg} ${accentBgHover} text-white`
                    }`}
                  >
                    {isSavingToBrand ? <Loader2 className="h-4 w-4 animate-spin" /> : savedToBrand ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    {savedToBrand ? '已保存' : '保存到品牌资产'}
                  </button>
                )}
              </div>
            </div>

            {/* 导航 */}
            <div className={`rounded-xl border ${border} ${glassBg} p-4`}>
              <div className="space-y-2">
                <button
                  onClick={() => setStep('direction')}
                  className={`w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 cursor-pointer ${
                    isMonochrome ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-white hover:bg-white/20'
                  } transition-colors`}
                >
                  <RotateCcw className="h-4 w-4" />返回方向
                </button>
                <button
                  onClick={handleReset}
                  className={`w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 cursor-pointer ${
                    isMonochrome ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-white hover:bg-white/20'
                  } transition-colors`}
                >
                  重新开始
                </button>
              </div>
            </div>

            {/* 快捷入口 */}
            {brandProject && savedToBrand && (
              <div className={`rounded-xl p-4 ${isMonochrome ? 'bg-gray-50 border border-gray-200' : 'bg-[#1a1a1a]/80 border border-[#d4af37]/20'}`}>
                <h3 className={`text-sm font-semibold mb-3 ${textPrimary}`}>接下来可以：</h3>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={onOpenBrandDna}
                    className={`p-2.5 rounded-lg text-center transition-all cursor-pointer ${
                      isMonochrome
                        ? 'bg-white border border-gray-200 hover:border-blue-300 text-gray-700'
                        : 'bg-[#222] border border-[#d4af37]/20 hover:border-[#d4af37]/50 text-white'
                    }`}
                  >
                    <Palette className="h-5 w-5 mx-auto mb-1" />
                    <span className="text-[11px]">品牌 DNA</span>
                  </button>
                  <button
                    onClick={onOpenMainKv}
                    className={`p-2.5 rounded-lg text-center transition-all cursor-pointer ${
                      isMonochrome
                        ? 'bg-white border border-gray-200 hover:border-blue-300 text-gray-700'
                        : 'bg-[#222] border border-[#d4af37]/20 hover:border-[#d4af37]/50 text-white'
                    }`}
                  >
                    <ImageIcon className="h-5 w-5 mx-auto mb-1" />
                    <span className="text-[11px]">主 KV</span>
                  </button>
                  <button
                    onClick={onClose}
                    className={`p-2.5 rounded-lg text-center transition-all cursor-pointer ${
                      isMonochrome
                        ? 'bg-white border border-gray-200 hover:border-blue-300 text-gray-700'
                        : 'bg-[#222] border border-[#d4af37]/20 hover:border-[#d4af37]/50 text-white'
                    }`}
                  >
                    <Wand2 className="h-5 w-5 mx-auto mb-1" />
                    <span className="text-[11px]">物料中心</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

/* ========== 辅助组件 ========== */

function CompassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}
