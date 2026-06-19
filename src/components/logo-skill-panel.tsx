'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  PenTool, X, Loader2, Wand2, Star, Eye, ArrowRight,
  Copy, Check, ChevronDown, ChevronRight, RotateCcw,
  RefreshCw, Sparkles, Download, Save, Palette, ImageIcon,
  Layout, GripVertical, Minus, Cpu, Zap, AlertTriangle,
} from 'lucide-react';

/* ========== TYPES ========== */

type Step = 'input' | 'direction' | 'generate' | 'result';

interface LogoDirection {
  positioning: string;
  visualMood: string;
  colorPalette: string[];
  typography: string;
  composition: string;
  fitReason?: string;
}

interface SymbolConcept {
  coreMetaphor: string;
  iconForm: string;
  negativeSpaceIdea?: string;
  alternativeRoutes: string[];
}

interface VisualSystemNotes {
  oneColorBehavior: string;
  smallSizeBehavior: string;
  recommendedLockups: string[];
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
const PANEL_H = 640;

const LOGO_TYPES = [
  { value: 'brand', label: '品牌 Logo' },
  { value: 'app-icon', label: 'App 图标' },
  { value: 'emblem', label: '徽章/纹章' },
  { value: 'wordmark', label: '文字标' },
  { value: 'pictogram', label: '图形符号' },
];

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

  // Center panel on first render
  useEffect(() => {
    setPos({
      x: Math.max(20, (window.innerWidth - PANEL_W) / 2),
      y: Math.max(72, (window.innerHeight - PANEL_H) / 2),
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
  const [referenceStyle, setReferenceStyle] = useState('');
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

  // 展开状态
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

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
        // 构建 providerId → providerName 映射
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
          // 使用复合键 providerId::modelId 区分不同提供商的同名模型
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
      const res = await fetch('/api/logo-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-image',
          prompt: bestPrompt,
          imageModel: imgModel || undefined,
          imageProviderId: imgProviderId || undefined,
          size: '1024x1024',
          n: 1,
        }),
      });
      const data = await res.json();
      if (!data.success && data.status !== 'processing') {
        const errMsg = data.error || '图像生成失败';
        // 友好化错误提示
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
          body: JSON.stringify({ taskId: tid, model, apiBaseUrl, apiKey }),
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
    onSaveToBrandAssets?.(selectedImageUrl, direction || undefined);
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
      if (data.success) setSavedToBrand(true);
    }).catch(() => {}).finally(() => setIsSavingToBrand(false));
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
  const sectionBg = isMonochrome ? 'bg-gray-50/80' : 'bg-white/[0.02]';

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

  // ─── 从复合键解析 modelId 和 providerId ────────────────────────
  function parseCompositeKey(key: string): { modelId: string; providerId: string } {
    if (key.includes('::')) {
      const [pid, ...rest] = key.split('::');
      return { providerId: pid, modelId: rest.join('::') };
    }
    return { modelId: key, providerId: '' };
  }

  // ─── 获取当前选中模型的提供商信息 ────────────────────────────
  function getSelectedModelInfo(models: ImageModel[], compositeKey: string): ImageModel | undefined {
    const { modelId, providerId } = parseCompositeKey(compositeKey);
    return models.find(m => m.id === modelId && m.providerId === providerId);
  }

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
              : 'shadow-[0_8px_32px_rgba(0,0,0,0.6),0_0_0_1px_rgba(212,175,55,0.15)]'
        }`}
        style={{ maxHeight: isMinimized ? undefined : 'calc(100vh - 96px)' }}
      >
        {/* ─── 可拖动标题栏 ─────────────────────────────────────── */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b select-none cursor-grab active:cursor-grabbing shrink-0 ${
            isMinimized ? `rounded-2xl border-b-0 ${border}` : border
          } ${isMonochrome ? 'bg-gray-50' : 'bg-[#1a1a1a]'}`}
          onMouseDown={onDragStart}
        >
          <div className="flex items-center gap-2">
            <GripVertical className={`h-4 w-4 ${textSecondary}`} />
            <div className={`w-6 h-6 rounded-md ${accentBg} flex items-center justify-center`}>
              <PenTool className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <h1 className={`text-sm font-bold ${textPrimary}`}>Logo Generator Pro</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* 步骤指示器 */}
            <div className="flex items-center gap-1">
              {steps.map((s, i) => (
                <div key={s} className="flex items-center gap-1">
                  {i > 0 && (
                    <div className={`w-3 h-px ${steps.indexOf(step) >= i ? accent : isMonochrome ? 'bg-gray-300' : 'bg-gray-600'}`} />
                  )}
                  <div
                    className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-medium ${
                      step === s
                        ? `${accentBg} text-white`
                        : steps.indexOf(step) > i
                          ? `${accentBg}/80 text-white`
                          : isMonochrome
                            ? 'bg-gray-200 text-gray-400'
                            : 'bg-white/10 text-gray-500'
                    }`}
                  >
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className={`p-1.5 rounded-lg ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-white/10'} transition-colors`}
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className={`p-1.5 rounded-lg ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-white/10'} transition-colors`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ─── 内容区 (可滚动) ─────────────────────────────────── */}
        {!isMinimized && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {error && (
              <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                isMonochrome ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-500/10 border-red-500/20 text-red-400'
              }`}>
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
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

  // ─── Step 1: 输入 ───────────────────────────────────────────
  function renderInputStep() {
    return (
      <div className="grid grid-cols-2 gap-4">
        {/* 左栏：品牌信息 */}
        <div className="space-y-3">
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${textPrimary}`}>
              品牌名称 <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                placeholder="中文品牌名称"
                className={`flex-1 px-3 py-2 rounded-lg border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
              />
              <input
                value={englishName}
                onChange={e => setEnglishName(e.target.value)}
                placeholder="英文名(可选)"
                className={`w-32 px-3 py-2 rounded-lg border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
              />
            </div>
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1.5 ${textPrimary}`}>Logo 类型</label>
            <div className="flex flex-wrap gap-1.5">
              {LOGO_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setLogoType(t.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 ${
                    logoType === t.value
                      ? `${accentBg} text-white shadow-sm`
                      : isMonochrome
                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1.5 ${textPrimary}`}>
              品牌简报 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              placeholder="描述你的品牌：做什么、服务谁、有什么独特价值..."
              rows={3}
              className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} resize-y`}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${textPrimary}`}>目标受众</label>
              <input
                value={audience}
                onChange={e => setAudience(e.target.value)}
                placeholder="如：25-35岁都市白领"
                className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
              />
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${textPrimary}`}>偏好风格</label>
              <input
                value={preferredStyle}
                onChange={e => setPreferredStyle(e.target.value)}
                placeholder="如：极简现代"
                className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
              />
            </div>
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1.5 ${textPrimary}`}>参考风格（可选）</label>
            <textarea
              value={referenceStyle}
              onChange={e => setReferenceStyle(e.target.value)}
              placeholder="参考设计的布局、间距、色彩..."
              rows={2}
              className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} resize-y`}
            />
          </div>
        </div>

        {/* 右栏：设置 + 模型 + 生成按钮 */}
        <div className="space-y-3">
          {/* 输出布局 */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${textPrimary}`}>输出布局</label>
            <div className="grid grid-cols-5 gap-1.5">
              {OUTPUT_LAYOUTS.map(l => {
                const Icon = l.icon;
                return (
                  <button
                    key={l.value}
                    onClick={() => setOutputLayout(l.value)}
                    className={`p-2 rounded-lg border text-center transition-all duration-200 ${
                      outputLayout === l.value
                        ? isMonochrome
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-[#d4af37] bg-[#d4af37]/10'
                        : `${border} ${cardBg} hover:opacity-80`
                    }`}
                  >
                    <Icon className={`h-4 w-4 mx-auto mb-0.5 ${outputLayout === l.value ? accent : textSecondary}`} />
                    <div className={`text-[10px] font-medium ${outputLayout === l.value ? accent : textSecondary}`}>
                      {l.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 目标平台 & LLM 模型 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${textPrimary}`}>目标平台</label>
              <select
                value={targetPlatform}
                onChange={e => setTargetPlatform(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg} ${textPrimary} focus:outline-none`}
              >
                {TARGET_PLATFORMS.map(p => (
                  <option key={p.value} value={p.value} className={isMonochrome ? '' : 'bg-[#1a1a1a] text-white'}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <label className={`block text-xs font-medium mb-1.5 ${textPrimary}`}>LLM 模型</label>
              {llmModels.length === 0 ? (
                <div className={`px-3 py-2 rounded-lg border text-xs ${inputBg} ${textSecondary}`}>
                  未配置 LLM 模型
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setShowLlmDropdown(v => !v); setShowImageDropdown(false); }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${inputBg} ${textPrimary} hover:brightness-110 focus:outline-none`}
                  >
                    <span className="truncate text-left flex items-center gap-1.5 min-w-0">
                      <Cpu className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="truncate">
                        {(() => {
                          const info = getSelectedModelInfo(llmModels, selectedLlmModel);
                          return info?.name || '选择模型';
                        })()}
                      </span>
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${showLlmDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {(() => {
                    const info = getSelectedModelInfo(llmModels, selectedLlmModel);
                    if (info?.providerName) {
                      return (
                        <p className={`text-[10px] mt-0.5 ${textSecondary}`}>
                          <Cpu className="h-2.5 w-2.5 inline mr-0.5" />
                          {info.providerName}
                        </p>
                      );
                    }
                    return null;
                  })()}
                  {showLlmDropdown && (
                    <div className={`absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border shadow-xl ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-white/10'}`}>
                      {Object.entries(groupModelsByProvider(llmModels)).map(([providerName, models]) => (
                        <div key={providerName}>
                          <div className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${isMonochrome ? 'text-gray-400 bg-gray-50' : 'text-white/40 bg-white/[0.03]'}`}>
                            {providerName}
                          </div>
                          {models.map(m => {
                            const compositeKey = `${m.providerId}::${m.id}`;
                            const isSelected = selectedLlmModel === compositeKey;
                            return (
                              <button
                                key={compositeKey}
                                type="button"
                                onClick={() => { setSelectedLlmModel(compositeKey); setShowLlmDropdown(false); }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                                  isSelected
                                    ? isMonochrome
                                      ? 'bg-blue-50 text-blue-600'
                                      : 'bg-gold/10 text-gold'
                                    : isMonochrome
                                      ? 'text-gray-700 hover:bg-gray-50'
                                      : 'text-white/80 hover:bg-white/5'
                                }`}
                              >
                                <Cpu className="h-3 w-3 shrink-0 opacity-40" />
                                <span className="truncate flex-1 text-left">{m.name}</span>
                                {isSelected && <Check className="h-3 w-3 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 生成按钮 */}
          <button
            onClick={handleGenerateDirection}
            disabled={isGeneratingDirection || !brandName.trim() || !brief.trim()}
            className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 ${
              isGeneratingDirection || !brandName.trim() || !brief.trim()
                ? isMonochrome
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-white/10 text-gray-500 cursor-not-allowed'
                : `${accentBg} ${accentBgHover} text-white shadow-lg hover:shadow-xl active:scale-[0.98]`
            }`}
          >
            {isGeneratingDirection ? (
              <><Loader2 className="h-4 w-4 animate-spin" />正在生成...</>
            ) : (
              <><Wand2 className="h-4 w-4" />生成 Logo 方向</>
            )}
          </button>

          {/* 提示 */}
          <div className={`p-3 rounded-lg ${sectionBg} border ${border}`}>
            <div className="flex items-start gap-2">
              <Zap className={`h-3.5 w-3.5 mt-0.5 ${accent} shrink-0`} />
              <div className="text-[10px]">
                <p className={`font-medium ${textPrimary} mb-0.5`}>如何使用？</p>
                <p className={textSecondary}>
                  填写品牌名称和简报，选择 LLM 模型，AI 将自动生成多套 Logo 方向方案和对应平台的生成提示词。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 2: 方向展示 (横屏两栏) ──────────────────────────────
  function renderDirectionStep() {
    return (
      <div className="grid grid-cols-2 gap-4">
        {/* 左栏：方向详情 */}
        <div className="space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          {/* Logo Direction */}
          {direction && (
            <div className={`rounded-xl border ${border} ${glassBg} p-3`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <CompassIcon className={`h-4 w-4 ${accent}`} />
                  <h3 className={`font-bold text-sm ${textPrimary}`}>Logo 方向</h3>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-[#d4af37]/15 text-[#d4af37]'
                }`}>
                  {direction.visualMood || '方案 A'}
                </span>
              </div>
              <div className="space-y-2">
                <div>
                  <span className={`text-[10px] font-medium ${textSecondary}`}>定位</span>
                  <p className={`text-xs ${textPrimary} mt-0.5`}>{direction.positioning || '待确定'}</p>
                </div>
                <div>
                  <span className={`text-[10px] font-medium ${textSecondary}`}>视觉氛围</span>
                  <p className={`text-xs ${textPrimary} mt-0.5`}>{direction.visualMood || '待确定'}</p>
                </div>
                <div>
                  <span className={`text-[10px] font-medium ${textSecondary}`}>配色方案</span>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {direction.colorPalette.map((c, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded border border-white/20" style={{ backgroundColor: c.startsWith('#') ? c : undefined }} />
                        <span className={`text-[10px] ${textSecondary}`}>{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <span className={`text-[10px] font-medium ${textSecondary}`}>字体</span>
                  <p className={`text-xs ${textPrimary} mt-0.5`}>{direction.typography}</p>
                </div>
                <div>
                  <span className={`text-[10px] font-medium ${textSecondary}`}>构图</span>
                  <p className={`text-xs ${textPrimary} mt-0.5`}>{direction.composition}</p>
                </div>
                {direction.fitReason && (
                  <div className={`text-[10px] ${textSecondary} italic`}>适配: {direction.fitReason}</div>
                )}
              </div>
            </div>
          )}

          {/* Symbol Concept */}
          {symbol && (
            <div className={`rounded-xl border ${border} ${glassBg} p-3`}>
              <div className="flex items-center gap-1.5 mb-2">
                <Star className={`h-4 w-4 ${accent}`} />
                <h3 className={`font-bold text-sm ${textPrimary}`}>符号概念</h3>
              </div>
              <div className="space-y-2">
                <div>
                  <span className={`text-[10px] font-medium ${textSecondary}`}>核心隐喻</span>
                  <p className={`text-xs ${textPrimary} mt-0.5`}>{symbol.coreMetaphor || '待确定'}</p>
                </div>
                <div>
                  <span className={`text-[10px] font-medium ${textSecondary}`}>图标形式</span>
                  <p className={`text-xs ${textPrimary} mt-0.5`}>{symbol.iconForm}</p>
                </div>
                {symbol.negativeSpaceIdea && (
                  <div>
                    <span className={`text-[10px] font-medium ${textSecondary}`}>负空间</span>
                    <p className={`text-xs ${textPrimary} mt-0.5`}>{symbol.negativeSpaceIdea}</p>
                  </div>
                )}
                {symbol.alternativeRoutes.length > 0 && (
                  <div>
                    <span className={`text-[10px] font-medium ${textSecondary}`}>替代路线</span>
                    <ul className="mt-1 space-y-0.5">
                      {symbol.alternativeRoutes.map((r, i) => (
                        <li key={i} className={`text-xs ${textPrimary} flex items-start gap-1`}>
                          <ArrowRight className={`h-2.5 w-2.5 mt-0.5 ${accent} shrink-0`} />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Visual System Notes */}
          {visualNotes && (
            <div className={`rounded-xl border ${border} ${glassBg} p-3`}>
              <div className="flex items-center gap-1.5 mb-2">
                <Eye className={`h-4 w-4 ${accent}`} />
                <h3 className={`font-bold text-sm ${textPrimary}`}>视觉系统</h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className={`text-[10px] font-medium ${textSecondary}`}>单色行为</span>
                  <p className={`text-xs ${textPrimary} mt-0.5`}>{visualNotes.oneColorBehavior}</p>
                </div>
                <div>
                  <span className={`text-[10px] font-medium ${textSecondary}`}>小尺寸行为</span>
                  <p className={`text-xs ${textPrimary} mt-0.5`}>{visualNotes.smallSizeBehavior}</p>
                </div>
              </div>
              {visualNotes.recommendedLockups.length > 0 && (
                <div className="mt-2">
                  <span className={`text-[10px] font-medium ${textSecondary}`}>推荐组合</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {visualNotes.recommendedLockups.map((l, i) => (
                      <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] ${cardBg} ${textSecondary}`}>{l}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右栏：Prompt + 生成 */}
        <div className="space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          {/* 平台 Prompt */}
          {platformPrompts.length > 0 && (
            <div className={`rounded-xl border ${border} overflow-hidden`}>
              <button
                onClick={() => setExpandedPrompt(expandedPrompt === '__prompts__' ? null : '__prompts__')}
                className={`w-full px-3 py-2 flex items-center justify-between ${cardBg} hover:opacity-80 transition-opacity`}
              >
                <div className="flex items-center gap-1.5">
                  <Wand2 className={`h-3.5 w-3.5 ${accent}`} />
                  <span className={`text-xs font-semibold ${textPrimary}`}>多平台 Prompt</span>
                  <span className={`text-[10px] ${textSecondary}`}>({platformPrompts.length})</span>
                </div>
                {expandedPrompt === '__prompts__' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {expandedPrompt === '__prompts__' && (
                <div className={`p-3 space-y-2 ${isMonochrome ? 'bg-gray-50' : 'bg-black/20'}`}>
                  {platformPrompts.map((pp, i) => (
                    <div key={i} className={`rounded-lg border ${border} overflow-hidden`}>
                      <button
                        onClick={() => setExpandedPrompt(expandedPrompt === pp.platform ? null : pp.platform)}
                        className={`w-full px-3 py-2 flex items-center justify-between ${cardBg} hover:opacity-80 transition-opacity`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] font-bold ${accent}`}>{pp.platform}</span>
                          {pp.notes && <span className={`text-[10px] ${textSecondary}`}>({pp.notes})</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopyPrompt(pp.prompt, pp.platform); }}
                            className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-white/10'} transition-colors`}
                            title="复制"
                          >
                            {copiedPrompt === pp.platform ? <Check className="h-3 w-3 text-green-400" /> : <Copy className={`h-3 w-3 ${textSecondary}`} />}
                          </button>
                          {expandedPrompt === pp.platform ? <ChevronDown className={`h-3 w-3 ${textSecondary}`} /> : <ChevronRight className={`h-3 w-3 ${textSecondary}`} />}
                        </div>
                      </button>
                      {expandedPrompt === pp.platform && (
                        <div className={`px-3 py-2 ${isMonochrome ? 'bg-white' : 'bg-black/30'}`}>
                          <pre className={`text-[10px] ${textSecondary} whitespace-pre-wrap break-all leading-relaxed`}>{pp.prompt}</pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 修订输入 */}
          <div className={`rounded-xl border ${border} ${glassBg} p-3`}>
            <div className="flex items-center gap-1.5 mb-2">
              <RefreshCw className={`h-3.5 w-3.5 ${accent}`} />
              <h3 className={`font-semibold text-xs ${textPrimary}`}>修订方向</h3>
            </div>
            <div className="flex gap-2">
              <input
                value={revisionNotes}
                onChange={e => setRevisionNotes(e.target.value)}
                placeholder="描述你想调整的方面..."
                className={`flex-1 px-3 py-2 rounded-lg border text-xs ${inputBg} ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
                onKeyDown={e => { if (e.key === 'Enter' && revisionNotes.trim()) handleRefineDirection(); }}
              />
              <button
                onClick={handleRefineDirection}
                disabled={!revisionNotes.trim() || isGeneratingDirection}
                className={`px-3 py-2 rounded-lg ${accentBg} text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-1`}
              >
                {isGeneratingDirection ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                修订
              </button>
            </div>
          </div>

          {/* 生成图像 */}
          <div className={`rounded-xl border ${border} ${glassBg} p-3`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className={`h-3.5 w-3.5 ${accent}`} />
                <h3 className={`font-semibold text-xs ${textPrimary}`}>生成 Logo 图像</h3>
              </div>
            </div>

            {/* 图像模型选择器 */}
            {imageModels.length > 0 && (
              <div className="mb-2 relative">
                <button
                  type="button"
                  onClick={() => { setShowImageDropdown(v => !v); setShowLlmDropdown(false); }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${inputBg} ${textPrimary} hover:brightness-110 focus:outline-none`}
                >
                  <span className="truncate text-left flex items-center gap-1.5 min-w-0">
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="truncate">
                      {(() => {
                        const info = getSelectedModelInfo(imageModels, selectedImageModel);
                        return info?.name || '选择图像模型';
                      })()}
                    </span>
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${showImageDropdown ? 'rotate-180' : ''}`} />
                </button>
                {(() => {
                  const info = getSelectedModelInfo(imageModels, selectedImageModel);
                  if (info?.providerName) {
                    return (
                      <p className={`text-[10px] mt-0.5 ${textSecondary}`}>
                        <Cpu className="h-2.5 w-2.5 inline mr-0.5" />
                        {info.providerName}
                      </p>
                    );
                  }
                  return null;
                })()}
                {showImageDropdown && (
                  <div className={`absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border shadow-xl ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-white/10'}`}>
                    {Object.entries(groupModelsByProvider(imageModels)).map(([providerName, models]) => (
                      <div key={providerName}>
                        <div className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${isMonochrome ? 'text-gray-400 bg-gray-50' : 'text-white/40 bg-white/[0.03]'}`}>
                          {providerName}
                        </div>
                        {models.map(m => {
                          const compositeKey = `${m.providerId}::${m.id}`;
                          const isSelected = selectedImageModel === compositeKey;
                          return (
                            <button
                              key={compositeKey}
                              type="button"
                              onClick={() => { setSelectedImageModel(compositeKey); setShowImageDropdown(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                                isSelected
                                  ? isMonochrome
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'bg-gold/10 text-gold'
                                  : isMonochrome
                                    ? 'text-gray-700 hover:bg-gray-50'
                                    : 'text-white/80 hover:bg-white/5'
                              }`}
                            >
                              <ImageIcon className="h-3 w-3 shrink-0 opacity-40" />
                              <span className="truncate flex-1 text-left">{m.name}</span>
                              {isSelected && <Check className="h-3 w-3 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {imageModels.length === 0 && (
              <div className={`p-3 rounded-lg border ${border} ${sectionBg} mb-2`}>
                <p className={`text-[10px] ${textSecondary}`}>
                  未配置图像模型，请在管理员后台添加 API 提供商
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleGenerateImage}
                disabled={isGeneratingImage || imageModels.length === 0}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 ${accentBg} ${accentBgHover} text-white transition-all duration-200 disabled:opacity-50 active:scale-[0.98]`}
              >
                {isGeneratingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                生成 Logo
              </button>
              <button
                onClick={handleReset}
                className={`px-3 py-2.5 rounded-xl text-xs transition-colors font-medium ${
                  isMonochrome ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                重来
              </button>
            </div>
          </div>

          {/* 查看原始响应 */}
          <div>
            <button
              onClick={() => setShowRawResponse(!showRawResponse)}
              className={`text-[10px] ${textSecondary} hover:underline flex items-center gap-1`}
            >
              {showRawResponse ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {showRawResponse ? '隐藏' : '查看'}原始 LLM 响应
            </button>
            {showRawResponse && (
              <pre className={`mt-1 p-3 rounded-lg text-[10px] ${textSecondary} whitespace-pre-wrap break-all overflow-auto max-h-40 ${cardBg}`}>
                {rawResponse}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 3: 生成中 ──────────────────────────────────────────
  function renderGeneratingStep() {
    return (
      <div className="py-12 flex items-center justify-center">
        <div className="text-center">
          <div className={`w-20 h-20 rounded-2xl ${glassBg} border ${border} flex items-center justify-center mx-auto mb-4 relative`}>
            <Loader2 className={`h-10 w-10 animate-spin ${accent}`} />
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-t from-transparent via-transparent to-transparent animate-pulse" />
          </div>
          <h2 className={`text-sm font-bold ${textPrimary} mb-1`}>正在生成 Logo</h2>
          <p className={`text-xs ${textSecondary}`}>
            {taskId ? '图像生成中，请稍候...' : '正在准备提示词...'}
          </p>
          {taskId && (
            <div className="mt-3 flex justify-center">
              <div className={`w-48 h-1 rounded-full ${cardBg} overflow-hidden`}>
                <div className="h-full bg-gradient-to-r from-transparent via-[#d4af37] to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Step 4: 结果 ────────────────────────────────────────────
  function renderResultStep() {
    return (
      <div className="grid grid-cols-2 gap-4">
        {/* 左栏：结果图片 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className={`text-sm font-bold ${textPrimary}`}>生成结果</h2>
          </div>
          <div className="space-y-2">
            {imageUrls.map((url, i) => (
              <button
                key={i}
                onClick={() => { setSelectedImageUrl(url); setSavedToBrand(false); }}
                className={`w-full rounded-xl overflow-hidden border-2 transition-all duration-200 ${
                  selectedImageUrl === url
                    ? isMonochrome ? 'border-blue-500 shadow-md' : 'border-[#d4af37] shadow-[0_0_20px_rgba(212,175,55,0.2)]'
                    : `${border} hover:opacity-80`
                }`}
              >
                <img src={url} alt={`Logo ${i + 1}`} className="w-full aspect-square object-contain bg-white" />
              </button>
            ))}
          </div>
        </div>

        {/* 右栏：操作 */}
        <div className="space-y-3">
          <div className={`rounded-xl border ${border} ${glassBg} p-3`}>
            <h3 className={`text-xs font-semibold mb-3 ${textPrimary}`}>操作</h3>
            <div className="space-y-2">
              <button
                onClick={handleAddToCanvas}
                className={`w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200 ${
                  isMonochrome ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                <Download className="h-3.5 w-3.5" />添加到画布
              </button>
              {brandProject && (
                <button
                  onClick={handleSaveToBrandAssets}
                  disabled={isSavingToBrand || !selectedImageUrl}
                  className={`w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200 ${
                    savedToBrand
                      ? 'bg-green-500/20 text-green-400'
                      : `${accentBg} ${accentBgHover} text-white`
                  } disabled:opacity-50`}
                >
                  {isSavingToBrand ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : savedToBrand ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                  {savedToBrand ? '已保存' : '保存到品牌资产'}
                </button>
              )}
              <button
                onClick={() => setStep('direction')}
                className={`w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 ${
                  isMonochrome ? 'bg-gray-100 text-gray-700' : 'bg-white/10 text-white'
                } transition-colors`}
              >
                <RotateCcw className="h-3.5 w-3.5" />返回方向
              </button>
              <button
                onClick={handleReset}
                className={`w-full py-2.5 rounded-lg text-xs font-medium ${
                  isMonochrome ? 'bg-gray-100 text-gray-700' : 'bg-white/10 text-white'
                } transition-colors`}
              >
                重新开始
              </button>
            </div>
          </div>

          {/* 快捷入口 */}
          {brandProject && savedToBrand && (
            <div className={`rounded-xl p-3 ${isMonochrome ? 'bg-gray-50 border border-gray-200' : 'bg-[#1a1a1a]/80 border border-[#d4af37]/20'}`}>
              <h3 className={`text-xs font-semibold mb-2 ${textPrimary}`}>接下来可以：</h3>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={onOpenBrandDna}
                  className={`p-2 rounded-lg text-center transition-all text-xs ${
                    isMonochrome
                      ? 'bg-white border border-gray-200 hover:border-blue-300 text-gray-700'
                      : 'bg-[#222] border border-[#d4af37]/20 hover:border-[#d4af37]/50 text-white'
                  }`}
                >
                  <Palette className="h-4 w-4 mx-auto mb-0.5" />
                  <span className="text-[10px]">品牌 DNA</span>
                </button>
                <button
                  onClick={onOpenMainKv}
                  className={`p-2 rounded-lg text-center transition-all text-xs ${
                    isMonochrome
                      ? 'bg-white border border-gray-200 hover:border-blue-300 text-gray-700'
                      : 'bg-[#222] border border-[#d4af37]/20 hover:border-[#d4af37]/50 text-white'
                  }`}
                >
                  <ImageIcon className="h-4 w-4 mx-auto mb-0.5" />
                  <span className="text-[10px]">主 KV</span>
                </button>
                <button
                  onClick={onClose}
                  className={`p-2 rounded-lg text-center transition-all text-xs ${
                    isMonochrome
                      ? 'bg-white border border-gray-200 hover:border-blue-300 text-gray-700'
                      : 'bg-[#222] border border-[#d4af37]/20 hover:border-[#d4af37]/50 text-white'
                  }`}
                >
                  <Wand2 className="h-4 w-4 mx-auto mb-0.5" />
                  <span className="text-[10px]">物料中心</span>
                </button>
              </div>
            </div>
          )}
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
