'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Sparkles, Palette, PenTool, Image as ImageIcon,
  ChevronRight, ChevronDown, Loader2, RefreshCw, Copy,
  Check, Download, ArrowRight, Wand2, Star, Eye,
  Type, Layout, Zap, RotateCcw, Save, BookOpen
} from 'lucide-react';

/* ========== TYPES ========== */

interface LogoDirection {
  positioning: string;
  visualMood: string;
  colorPalette: string[];
  typography: string;
  composition: string;
  fitReason: string;
}

interface SymbolConcept {
  coreMetaphor: string;
  iconForm: string;
  negativeSpaceIdea: string;
  alternativeRoutes: string[];
}

interface VisualSystemNotes {
  recommendedLockups: string[];
  oneColorBehavior: string;
  smallSizeBehavior: string;
  usageNotes: string;
}

interface BrandSystemBoardLayout {
  canvasSpec: string;
  modules: string[];
  footerValues: string[];
  styleNotes: string;
}

interface PlatformPrompt {
  platform: string;
  prompt: string;
  notes?: string;
}

interface ImageModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

interface LogoSkillPanelProps {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[]) => void;
  /** 当前品牌工厂项目数据 */
  brandProject?: {
    brandName: string;
    industry?: string;
    projectType?: string;
    description?: string;
    targetAudience?: string;
    tone?: string;
    keywords?: string[];
    brandDna?: {
      brandKeywords?: string[];
      mainColors?: string[];
      secondaryColors?: string[];
      fontStyle?: string;
      visualTone?: string;
      logoRules?: string[];
      forbiddenRules?: string[];
    } | null;
  } | null;
}

type Step = 'input' | 'direction' | 'generate' | 'result';

const LOGO_TYPES = [
  { value: 'brand', label: '品牌Logo' },
  { value: 'company', label: '公司Logo' },
  { value: 'product', label: '产品Logo' },
  { value: 'cultural-creative', label: '文创IP' },
  { value: 'campaign', label: '活动/广告' },
  { value: 'event', label: '事件' },
  { value: 'app', label: 'App' },
  { value: 'sub-brand', label: '子品牌' },
  { value: 'personal-brand', label: '个人品牌' },
];

const OUTPUT_LAYOUTS = [
  { value: 'brand-system-board', label: '品牌系统板', desc: '完整品牌规范展示（推荐）', icon: Layout },
  { value: 'standalone-logo', label: '独立Logo', desc: '白底独立Logo图', icon: Star },
  { value: 'square-avatar', label: '方形图标', desc: 'App图标/头像', icon: Zap },
  { value: 'identity-board', label: '简版身份板', desc: 'Logo + 配色 + 字体', icon: BookOpen },
  { value: 'transparent-asset', label: '透明资产', desc: '透明背景素材', icon: Download },
];

const TARGET_PLATFORMS = [
  { value: 'gpt-image', label: 'GPT Image' },
  { value: 'midjourney', label: 'Midjourney' },
  { value: 'flux', label: 'Flux' },
  { value: 'ideogram', label: 'Ideogram' },
  { value: 'all', label: '全部平台' },
];

/* ========== COMPONENT ========== */

export default function LogoSkillPanel({
  isMonochrome = false,
  onClose,
  onAddImages,
  brandProject,
}: LogoSkillPanelProps) {
  // ─── State ─────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('input');
  const [brandName, setBrandName] = useState(brandProject?.brandName || '');
  const [logoType, setLogoType] = useState('brand');
  const [brief, setBrief] = useState(brandProject?.description || '');
  const [audience, setAudience] = useState(brandProject?.targetAudience || '');
  const [preferredStyle, setPreferredStyle] = useState(brandProject?.tone || '');
  const [referenceStyle, setReferenceStyle] = useState('');
  const [chineseName, setChineseName] = useState('');
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

  // 展开状态
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  // ─── 初始化品牌项目数据 ───────────────────────────────────────
  useEffect(() => {
    if (brandProject) {
      if (brandProject.brandName) setBrandName(brandProject.brandName);
      if (brandProject.description) setBrief(brandProject.description);
      if (brandProject.targetAudience) setAudience(brandProject.targetAudience);
      if (brandProject.tone) setPreferredStyle(brandProject.tone);
      // 构建参考风格
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
  }, [brandProject]);

  // ─── 加载模型列表 ────────────────────────────────────────────
  useEffect(() => {
    loadModels();
  }, []);

  async function loadModels() {
    try {
      const [imgRes, chatRes] = await Promise.all([
        fetch('/api/models?type=image'),
        fetch('/api/models?type=chat'),
      ]);
      if (imgRes.ok) {
        const data = await imgRes.json();
        const models = (data.models || []).map((m: Record<string, unknown>) => ({
          id: m.modelId as string || m.id as string,
          name: (m.modelName as string) || (m.modelId as string) || (m.id as string),
          providerId: m.providerId as string || '',
          providerName: m.providerName as string || '',
        }));
        setImageModels(models);
        if (models.length > 0) setSelectedImageModel(models[0].id);
      }
      if (chatRes.ok) {
        const data = await chatRes.json();
        const models = (data.models || []).map((m: Record<string, unknown>) => ({
          id: m.modelId as string || m.id as string,
          name: (m.modelName as string) || (m.modelId as string) || (m.id as string),
          providerId: m.providerId as string || '',
          providerName: m.providerName as string || '',
        }));
        setLlmModels(models);
        if (models.length > 0) setSelectedLlmModel(models[0].id);
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
          chineseName: chineseName.trim() || undefined,
          llmModel: selectedLlmModel || undefined,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || '生成方向失败');
        return;
      }

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
          chineseName: chineseName.trim() || undefined,
          revisionNotes: revisionNotes.trim(),
          llmModel: selectedLlmModel || undefined,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || '修订方向失败');
        return;
      }

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

    if (!bestPrompt) {
      setError('没有可用的生成提示词');
      return;
    }

    setIsGeneratingImage(true);
    setError('');
    setImageUrls([]);
    setTaskId(null);
    setStep('generate');

    try {
      const res = await fetch('/api/logo-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-image',
          prompt: bestPrompt,
          imageModel: selectedImageModel || undefined,
          size: outputLayout === 'square-avatar' ? '1024x1024' : '1024x1024',
          n: 1,
        }),
      });

      const data = await res.json();
      if (!data.success && data.status !== 'processing') {
        setError(data.error || '图像生成失败');
        setStep('direction');
        return;
      }

      if (data.imageUrls && data.imageUrls.length > 0) {
        setImageUrls(data.imageUrls);
        setSelectedImageUrl(data.imageUrls[0]);
        setStep('result');
      } else if (data.taskId) {
        // 异步任务，轮询结果
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
      onAddImages([selectedImageUrl]);
    }
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

  // ─── 样式 ────────────────────────────────────────────────────
  const bg = isMonochrome ? 'bg-white' : 'bg-[#0d0d0d]';
  const textPrimary = isMonochrome ? 'text-gray-900' : 'text-white';
  const textSecondary = isMonochrome ? 'text-gray-500' : 'text-gray-400';
  const border = isMonochrome ? 'border-gray-200' : 'border-white/10';
  const cardBg = isMonochrome ? 'bg-gray-50' : 'bg-white/5';
  const inputBg = isMonochrome ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10';
  const accent = isMonochrome ? 'text-blue-600' : 'text-[#d4af37]';
  const accentBg = isMonochrome ? 'bg-blue-600' : 'bg-[#d4af37]';
  const accentBgHover = isMonochrome ? 'hover:bg-blue-700' : 'hover:bg-[#c4a030]';

  return (
    <div className={`fixed inset-0 z-[200] flex ${bg} ${textPrimary}`}>
      {/* 左侧：步骤内容 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部导航栏 */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${border}`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg ${accentBg} flex items-center justify-center`}>
              <PenTool className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Logo Generator Pro</h1>
              <p className={`text-xs ${textSecondary}`}>SanbaoAI Prompt Core 驱动</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 步骤指示器 */}
            {(['input', 'direction', 'generate', 'result'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                {i > 0 && <div className={`w-4 h-px ${step === s || ([...(['input', 'direction', 'generate', 'result'] as Step[])].indexOf(step) > i ? accent : isMonochrome ? 'bg-gray-300' : 'bg-gray-600')}`} />}
                <div className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium ${
                  step === s ? `${accentBg} text-white` :
                  [...(['input', 'direction', 'generate', 'result'] as Step[])].indexOf(step) > i ? `${accentBg}/80 text-white` :
                  isMonochrome ? 'bg-gray-200 text-gray-500' : 'bg-white/10 text-gray-500'
                }`}>
                  {i + 1}
                </div>
              </div>
            ))}
            <button onClick={onClose} className={`ml-4 p-2 rounded-lg ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10'} transition-colors`}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className={`mb-4 p-3 rounded-lg border ${isMonochrome ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
              {error}
            </div>
          )}

          {step === 'input' && renderInputStep()}
          {step === 'direction' && renderDirectionStep()}
          {step === 'generate' && renderGeneratingStep()}
          {step === 'result' && renderResultStep()}
        </div>
      </div>

      {/* 右侧：平台 Prompt 面板 */}
      {step === 'direction' && platformPrompts.length > 0 && (
        <div className={`w-[420px] border-l ${border} flex flex-col`}>
          <div className={`px-4 py-3 border-b ${border} flex items-center justify-between`}>
            <h3 className={`font-semibold text-sm ${textPrimary}`}>平台 Prompt</h3>
            <span className={`text-xs ${textSecondary}`}>{platformPrompts.length} 个变体</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {platformPrompts.map((pp) => (
              <div key={pp.platform} className={`rounded-lg border ${border} overflow-hidden`}>
                <button
                  onClick={() => setExpandedPrompt(expandedPrompt === pp.platform ? null : pp.platform)}
                  className={`w-full px-4 py-3 flex items-center justify-between ${cardBg} hover:opacity-80 transition-opacity`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`font-medium text-sm ${accent}`}>{pp.platform}</span>
                    {pp.notes && <span className={`text-xs ${textSecondary}`}>— {pp.notes.slice(0, 40)}...</span>}
                  </div>
                  {expandedPrompt === pp.platform ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {expandedPrompt === pp.platform && (
                  <div className={`px-4 py-3 ${bg}`}>
                    <pre className={`text-xs ${textSecondary} whitespace-pre-wrap break-all leading-relaxed`}>{pp.prompt}</pre>
                    <button
                      onClick={() => handleCopyPrompt(pp.prompt, pp.platform)}
                      className={`mt-2 px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1 ${
                        copiedPrompt === pp.platform
                          ? `${accentBg} text-white`
                          : isMonochrome ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-white/10 hover:bg-white/20 text-white'
                      } transition-colors`}
                    >
                      {copiedPrompt === pp.platform ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedPrompt === pp.platform ? '已复制' : '复制 Prompt'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ─── Step 1: 输入 ───────────────────────────────────────────
  function renderInputStep() {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        {/* 品牌名称 */}
        <div>
          <label className={`block text-sm font-medium mb-2 ${textPrimary}`}>
            品牌名称 <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-3">
            <input
              value={brandName}
              onChange={e => setBrandName(e.target.value)}
              placeholder="英文品牌名称"
              className={`flex-1 px-4 py-3 rounded-lg border ${inputBg} ${textPrimary} placeholder:text-gray-400 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
            />
            <input
              value={chineseName}
              onChange={e => setChineseName(e.target.value)}
              placeholder="中文名称（可选）"
              className={`w-48 px-4 py-3 rounded-lg border ${inputBg} ${textPrimary} placeholder:text-gray-400 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
            />
          </div>
        </div>

        {/* Logo 类型 */}
        <div>
          <label className={`block text-sm font-medium mb-2 ${textPrimary}`}>Logo 类型</label>
          <div className="flex flex-wrap gap-2">
            {LOGO_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setLogoType(t.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  logoType === t.value
                    ? `${accentBg} text-white`
                    : isMonochrome ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 品牌简报 */}
        <div>
          <label className={`block text-sm font-medium mb-2 ${textPrimary}`}>
            品牌简报 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            placeholder="描述你的品牌：做什么、服务谁、有什么独特价值、品牌性格..."
            rows={4}
            className={`w-full px-4 py-3 rounded-lg border ${inputBg} ${textPrimary} placeholder:text-gray-400 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} resize-y`}
          />
        </div>

        {/* 目标受众 & 偏好风格 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`block text-sm font-medium mb-2 ${textPrimary}`}>目标受众</label>
            <input
              value={audience}
              onChange={e => setAudience(e.target.value)}
              placeholder="例如：25-35岁都市白领"
              className={`w-full px-4 py-3 rounded-lg border ${inputBg} ${textPrimary} placeholder:text-gray-400 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
            />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-2 ${textPrimary}`}>偏好风格</label>
            <input
              value={preferredStyle}
              onChange={e => setPreferredStyle(e.target.value)}
              placeholder="例如：极简现代、东方国潮"
              className={`w-full px-4 py-3 rounded-lg border ${inputBg} ${textPrimary} placeholder:text-gray-400 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
            />
          </div>
        </div>

        {/* 参考风格 */}
        <div>
          <label className={`block text-sm font-medium mb-2 ${textPrimary}`}>参考风格描述（可选）</label>
          <textarea
            value={referenceStyle}
            onChange={e => setReferenceStyle(e.target.value)}
            placeholder="描述参考设计的布局、间距、色彩克制、字体情绪..."
            rows={2}
            className={`w-full px-4 py-3 rounded-lg border ${inputBg} ${textPrimary} placeholder:text-gray-400 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} resize-y`}
          />
        </div>

        {/* 输出布局 */}
        <div>
          <label className={`block text-sm font-medium mb-2 ${textPrimary}`}>输出布局</label>
          <div className="grid grid-cols-5 gap-2">
            {OUTPUT_LAYOUTS.map(l => {
              const Icon = l.icon;
              return (
                <button
                  key={l.value}
                  onClick={() => setOutputLayout(l.value)}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    outputLayout === l.value
                      ? isMonochrome ? 'border-blue-500 bg-blue-50' : 'border-[#d4af37] bg-[#d4af37]/10'
                      : `${border} ${cardBg} hover:opacity-80`
                  }`}
                >
                  <Icon className={`h-5 w-5 mx-auto mb-1 ${outputLayout === l.value ? accent : textSecondary}`} />
                  <div className={`text-xs font-medium ${outputLayout === l.value ? accent : textSecondary}`}>{l.label}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 目标平台 & LLM模型 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`block text-sm font-medium mb-2 ${textPrimary}`}>目标平台</label>
            <select
              value={targetPlatform}
              onChange={e => setTargetPlatform(e.target.value)}
              className={`w-full px-4 py-3 rounded-lg border ${inputBg} ${textPrimary} focus:outline-none`}
            >
              {TARGET_PLATFORMS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={`block text-sm font-medium mb-2 ${textPrimary}`}>LLM 模型</label>
            <select
              value={selectedLlmModel}
              onChange={e => setSelectedLlmModel(e.target.value)}
              className={`w-full px-4 py-3 rounded-lg border ${inputBg} ${textPrimary} focus:outline-none`}
            >
              {llmModels.length === 0 && <option value="">未配置</option>}
              {llmModels.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 生成按钮 */}
        <button
          onClick={handleGenerateDirection}
          disabled={isGeneratingDirection || !brandName.trim() || !brief.trim()}
          className={`w-full py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all ${
            isGeneratingDirection || !brandName.trim() || !brief.trim()
              ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white/10 text-gray-500 cursor-not-allowed'
              : `${accentBg} ${accentBgHover} text-white shadow-lg`
          }`}
        >
          {isGeneratingDirection ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              正在生成创意方向...
            </>
          ) : (
            <>
              <Wand2 className="h-5 w-5" />
              生成 Logo 方向
            </>
          )}
        </button>
      </div>
    );
  }

  // ─── Step 2: 方向展示 ────────────────────────────────────────
  function renderDirectionStep() {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Logo Direction */}
        {direction && (
          <div className={`rounded-xl border ${border} p-5`}>
            <div className="flex items-center gap-2 mb-4">
              <CompassIcon className={`h-5 w-5 ${accent}`} />
              <h3 className={`font-bold text-lg ${textPrimary}`}>Logo 方向</h3>
            </div>
            <div className="space-y-3">
              <div>
                <span className={`text-xs font-medium ${textSecondary}`}>定位</span>
                <p className={`text-sm ${textPrimary} mt-0.5`}>{direction.positioning}</p>
              </div>
              <div>
                <span className={`text-xs font-medium ${textSecondary}`}>视觉氛围</span>
                <p className={`text-sm ${textPrimary} mt-0.5`}>{direction.visualMood}</p>
              </div>
              <div>
                <span className={`text-xs font-medium ${textSecondary}`}>配色方案</span>
                <div className="flex items-center gap-2 mt-1">
                  {direction.colorPalette.map((c, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className="w-6 h-6 rounded-md border border-white/20" style={{ backgroundColor: c.startsWith('#') ? c : undefined }} />
                      <span className={`text-xs ${textSecondary}`}>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <span className={`text-xs font-medium ${textSecondary}`}>字体</span>
                <p className={`text-sm ${textPrimary} mt-0.5`}>{direction.typography}</p>
              </div>
              <div>
                <span className={`text-xs font-medium ${textSecondary}`}>构图</span>
                <p className={`text-sm ${textPrimary} mt-0.5`}>{direction.composition}</p>
              </div>
              {direction.fitReason && (
                <div className={`text-xs ${textSecondary} italic`}>适配原因: {direction.fitReason}</div>
              )}
            </div>
          </div>
        )}

        {/* Symbol Concept */}
        {symbol && (
          <div className={`rounded-xl border ${border} p-5`}>
            <div className="flex items-center gap-2 mb-4">
              <Star className={`h-5 w-5 ${accent}`} />
              <h3 className={`font-bold text-lg ${textPrimary}`}>符号概念</h3>
            </div>
            <div className="space-y-3">
              <div>
                <span className={`text-xs font-medium ${textSecondary}`}>核心隐喻</span>
                <p className={`text-sm ${textPrimary} mt-0.5`}>{symbol.coreMetaphor}</p>
              </div>
              <div>
                <span className={`text-xs font-medium ${textSecondary}`}>图标形式</span>
                <p className={`text-sm ${textPrimary} mt-0.5`}>{symbol.iconForm}</p>
              </div>
              {symbol.negativeSpaceIdea && (
                <div>
                  <span className={`text-xs font-medium ${textSecondary}`}>负空间</span>
                  <p className={`text-sm ${textPrimary} mt-0.5`}>{symbol.negativeSpaceIdea}</p>
                </div>
              )}
              {symbol.alternativeRoutes.length > 0 && (
                <div>
                  <span className={`text-xs font-medium ${textSecondary}`}>替代路线</span>
                  <ul className="mt-1 space-y-1">
                    {symbol.alternativeRoutes.map((r, i) => (
                      <li key={i} className={`text-sm ${textPrimary} flex items-start gap-2`}>
                        <ArrowRight className={`h-3 w-3 mt-1 ${accent} shrink-0`} />
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
          <div className={`rounded-xl border ${border} p-5`}>
            <div className="flex items-center gap-2 mb-4">
              <Eye className={`h-5 w-5 ${accent}`} />
              <h3 className={`font-bold text-lg ${textPrimary}`}>视觉系统说明</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className={`text-xs font-medium ${textSecondary}`}>单色行为</span>
                <p className={`text-sm ${textPrimary} mt-0.5`}>{visualNotes.oneColorBehavior}</p>
              </div>
              <div>
                <span className={`text-xs font-medium ${textSecondary}`}>小尺寸行为</span>
                <p className={`text-sm ${textPrimary} mt-0.5`}>{visualNotes.smallSizeBehavior}</p>
              </div>
            </div>
            {visualNotes.recommendedLockups.length > 0 && (
              <div className="mt-3">
                <span className={`text-xs font-medium ${textSecondary}`}>推荐组合</span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {visualNotes.recommendedLockups.map((l, i) => (
                    <span key={i} className={`px-2 py-1 rounded text-xs ${cardBg} ${textSecondary}`}>{l}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 修订输入 */}
        <div className={`rounded-xl border ${border} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <RefreshCw className={`h-5 w-5 ${accent}`} />
            <h3 className={`font-semibold ${textPrimary}`}>修订方向</h3>
          </div>
          <div className="flex gap-2">
            <input
              value={revisionNotes}
              onChange={e => setRevisionNotes(e.target.value)}
              placeholder="描述你想调整的方面，例如：配色更温暖一些、符号更具科技感..."
              className={`flex-1 px-4 py-3 rounded-lg border ${inputBg} ${textPrimary} placeholder:text-gray-400 focus:outline-none focus:ring-2 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
              onKeyDown={e => { if (e.key === 'Enter' && revisionNotes.trim()) handleRefineDirection(); }}
            />
            <button
              onClick={handleRefineDirection}
              disabled={!revisionNotes.trim() || isGeneratingDirection}
              className={`px-4 py-3 rounded-lg ${accentBg} text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-1`}
            >
              {isGeneratingDirection ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              修订
            </button>
          </div>
        </div>

        {/* 生成图像 */}
        <div className={`rounded-xl border ${border} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className={`h-5 w-5 ${accent}`} />
              <h3 className={`font-semibold ${textPrimary}`}>生成 Logo 图像</h3>
            </div>
            {imageModels.length > 0 && (
              <select
                value={selectedImageModel}
                onChange={e => setSelectedImageModel(e.target.value)}
                className={`px-3 py-1.5 rounded-lg border text-xs ${inputBg} ${textPrimary} focus:outline-none`}
              >
                {imageModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
          </div>
          <p className={`text-sm ${textSecondary} mb-4`}>将使用 {outputLayout === 'brand-system-board' ? '品牌系统展示板' : OUTPUT_LAYOUTS.find(l => l.value === outputLayout)?.label} 布局生成图像</p>
          <div className="flex gap-3">
            <button
              onClick={handleGenerateImage}
              disabled={isGeneratingImage}
              className={`flex-1 py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 ${accentBg} ${accentBgHover} text-white transition-all disabled:opacity-50`}
            >
              {isGeneratingImage ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
              生成 Logo 图像
            </button>
            <button
              onClick={handleReset}
              className={`px-4 py-3 rounded-xl ${isMonochrome ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-white/10 hover:bg-white/20 text-white'} transition-colors font-medium`}
            >
              重新开始
            </button>
          </div>
        </div>

        {/* 查看原始响应 */}
        <div>
          <button
            onClick={() => setShowRawResponse(!showRawResponse)}
            className={`text-xs ${textSecondary} hover:underline flex items-center gap-1`}
          >
            {showRawResponse ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showRawResponse ? '隐藏' : '查看'}原始 LLM 响应
          </button>
          {showRawResponse && (
            <pre className={`mt-2 p-4 rounded-lg text-xs ${textSecondary} whitespace-pre-wrap break-all overflow-auto max-h-64 ${cardBg}`}>
              {rawResponse}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // ─── Step 3: 生成中 ──────────────────────────────────────────
  function renderGeneratingStep() {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className={`w-24 h-24 rounded-2xl ${cardBg} flex items-center justify-center mx-auto mb-6`}>
            <Loader2 className={`h-12 w-12 animate-spin ${accent}`} />
          </div>
          <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>正在生成 Logo</h2>
          <p className={`text-sm ${textSecondary}`}>
            {taskId ? '图像生成中，请稍候...' : '正在准备提示词...'}
          </p>
          {taskId && (
            <p className={`text-xs ${textSecondary} mt-2`}>任务ID: {taskId}</p>
          )}
        </div>
      </div>
    );
  }

  // ─── Step 4: 结果 ────────────────────────────────────────────
  function renderResultStep() {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h2 className={`text-xl font-bold ${textPrimary}`}>生成结果</h2>
          <div className="flex gap-2">
            <button
              onClick={handleAddToCanvas}
              className={`px-4 py-2 rounded-lg ${accentBg} text-white font-medium flex items-center gap-1`}
            >
              <Download className="h-4 w-4" />
              添加到画布
            </button>
            <button
              onClick={() => setStep('direction')}
              className={`px-4 py-2 rounded-lg ${isMonochrome ? 'bg-gray-100 text-gray-700' : 'bg-white/10 text-white'} font-medium flex items-center gap-1`}
            >
              <RotateCcw className="h-4 w-4" />
              返回方向
            </button>
            <button
              onClick={handleReset}
              className={`px-4 py-2 rounded-lg ${isMonochrome ? 'bg-gray-100 text-gray-700' : 'bg-white/10 text-white'} font-medium`}
            >
              重新开始
            </button>
          </div>
        </div>

        {/* 图像网格 */}
        <div className="grid grid-cols-2 gap-4">
          {imageUrls.map((url, i) => (
            <button
              key={i}
              onClick={() => setSelectedImageUrl(url)}
              className={`rounded-xl overflow-hidden border-2 transition-all ${
                selectedImageUrl === url
                  ? isMonochrome ? 'border-blue-500' : 'border-[#d4af37]'
                  : `${border} hover:opacity-80`
              }`}
            >
              <img src={url} alt={`Logo ${i + 1}`} className="w-full aspect-square object-contain bg-white" />
            </button>
          ))}
        </div>

        {/* 选中图像大图预览 */}
        {selectedImageUrl && (
          <div className={`rounded-xl border ${border} overflow-hidden`}>
            <img src={selectedImageUrl} alt="Selected Logo" className="w-full max-h-[500px] object-contain bg-white" />
          </div>
        )}
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
