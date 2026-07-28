'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Compass,
  FileImage,
  ImagePlus,
  Palette,
  PenTool,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  Upload,
  WandSparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  VECTOR_ASPECT_RATIOS,
  VECTOR_KEYWORD_TEMPLATES,
  buildVectorPrompt,
  getVectorModelCapabilities,
  isRecraftVectorModel,
  normalizeVectorSelection,
  type VectorModelCapabilities,
  type VectorPresetSelection,
  type VectorTemplateGroup,
} from '@/lib/vector-design';
import { VectorEditorDialog, type VectorDesignAsset } from './vector-editor-dialog';

interface VectorModel {
  id: string;
  name?: string;
  displayName?: string;
  providerId: string;
  providerName?: string;
  isDefault?: boolean;
}

interface VectorDesignPanelProps {
  themeStyle: 'gold' | 'monochrome';
  selectedImage: { id: string; url: string; svgUrl?: string; svgDataUrl?: string } | null;
  onAddVector: (asset: VectorDesignAsset, sourceImageId?: string) => void;
}

type VectorMode = 'generate' | 'image-to-image' | 'vectorize' | 'explore';

interface VectorApiResponse {
  success?: boolean;
  error?: string;
  enhancedPrompt?: string;
  styleId?: string;
  asset?: VectorDesignAsset;
  assets?: VectorDesignAsset[];
}

const GROUP_LABELS: Record<VectorTemplateGroup, string> = {
  quick: '输出约束',
  category: '产品品类',
  design: '设计类型',
  style: '风格预设',
};

const MODE_OPTIONS: Array<{
  id: VectorMode;
  label: string;
  icon: typeof WandSparkles;
}> = [
  { id: 'generate', label: '创作', icon: WandSparkles },
  { id: 'image-to-image', label: '参考', icon: ImagePlus },
  { id: 'vectorize', label: '描摹', icon: ScanLine },
  { id: 'explore', label: '探索', icon: Compass },
];

const RECRAFT_V3_VECTOR_STYLES = [
  'Vector art',
  'Line art',
  'Linocut',
  'Color blobs',
  'Engraving',
  'Bold stroke',
  'Chemistry',
  'Colored stencil',
  'Cosmics',
  'Cutout',
  'Depressive',
  'Editorial',
  'Emotional flat',
  'Marker outline',
  'Mosaic',
  'Naivector',
  'Roundish flat',
  'Segmented Colors',
  'Sharp contrast',
  'Thin',
  'Vector Photo',
  'Vivid shapes',
  'Seamless Vector',
];

const RECRAFT_V2_VECTOR_STYLES = [
  'Vector art',
  'Icon',
  'Line art',
  'Linocut',
  'Cartoon',
  'Flat 2.0',
  'Color blobs',
  'Vector Kawaii',
  'Doodle Line art',
  'Seamless Vector',
  'Engraving',
  'Outline',
  'Pictogram',
  'Colored outline',
  'Doodle',
  'Colored shape',
  'Gradient outline',
  'Offset doodle',
  'Gradient shape',
  'Broken line',
  'Offset fill',
];

const INITIAL_SELECTION: VectorPresetSelection = {
  quickIds: ['transparent', 'limited-palette', 'small-size-clarity'],
  categoryId: 'logo',
  designId: 'minimal-symbol',
  styleId: 'modern-minimal',
};

function selectedTemplateIds(selection: VectorPresetSelection): string[] {
  return [
    ...selection.quickIds,
    selection.categoryId,
    selection.designId,
    selection.styleId,
  ].filter((id): id is string => Boolean(id));
}

function modeNeedsImage(mode: VectorMode): boolean {
  return mode === 'image-to-image' || mode === 'vectorize';
}

function modeNeedsPrompt(mode: VectorMode): boolean {
  return mode !== 'vectorize';
}

function modeButtonLabel(mode: VectorMode): string {
  if (mode === 'vectorize') return '转换为可编辑 SVG';
  if (mode === 'image-to-image') return '生成参考矢量';
  if (mode === 'explore') return '探索设计方向';
  return '生成矢量设计';
}

function modelCapabilityLabel(capabilities: VectorModelCapabilities): string {
  const tier = capabilities.tier === 'standard'
    ? '标准'
    : capabilities.tier === 'pro'
      ? 'Pro'
      : capabilities.tier === 'utility'
        ? 'Utility'
        : 'Utility Pro';
  return `${capabilities.family.toUpperCase()} · ${tier} · ${capabilities.megapixels}MP`;
}

export function VectorDesignPanel({
  themeStyle,
  selectedImage,
  onAddVector,
}: VectorDesignPanelProps) {
  const [mode, setMode] = useState<VectorMode>('generate');
  const [prompt, setPrompt] = useState('');
  const [selection, setSelection] = useState<VectorPresetSelection>(INITIAL_SELECTION);
  const [models, setModels] = useState<VectorModel[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [aspect, setAspect] = useState('1:1');
  const [count, setCount] = useState(1);
  const [uploadedImage, setUploadedImage] = useState('');
  const [strength, setStrength] = useState(0.35);
  const [nativeStyle, setNativeStyle] = useState('');
  const [customStyleId, setCustomStyleId] = useState('');
  const [similarity, setSimilarity] = useState(3);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [artisticLevel, setArtisticLevel] = useState(2);
  const [paletteEnabled, setPaletteEnabled] = useState(false);
  const [palette, setPalette] = useState(['#d4af37', '#111111', '#ffffff']);
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [randomSeed, setRandomSeed] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isCreatingStyle, setIsCreatingStyle] = useState(false);
  const [similarSourceId, setSimilarSourceId] = useState('');
  const [results, setResults] = useState<VectorDesignAsset[]>([]);
  const [editingAsset, setEditingAsset] = useState<VectorDesignAsset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMono = themeStyle === 'monochrome';

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/models?type=vectorize')
      .then(response => response.json())
      .then(data => {
        if (cancelled) return;
        const nextModels = (Array.isArray(data.models) ? data.models : [])
          .filter((model: VectorModel) => isRecraftVectorModel(model.id));
        setModels(nextModels);
        const preferred = nextModels.find((model: VectorModel) => /recraftv4_1.*_vector/i.test(model.id))
          || nextModels.find((model: VectorModel) => model.isDefault)
          || nextModels[0];
        if (preferred) setModelKey(`${preferred.providerId}::${preferred.id}`);
      })
      .catch(() => setModels([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCustomStyleId('');
    setResults([]);
    setSimilarSourceId('');
  }, [modelKey]);

  const activeImageUrl = uploadedImage || selectedImage?.url || '';
  const selectedModel = useMemo(() => {
    const [providerId, ...modelParts] = modelKey.split('::');
    const model = modelParts.join('::');
    return models.find(item => item.providerId === providerId && item.id === model) || null;
  }, [modelKey, models]);
  const capabilities = useMemo(() => {
    if (!selectedModel) return null;
    try {
      return getVectorModelCapabilities(selectedModel.id);
    } catch {
      return null;
    }
  }, [selectedModel]);
  const templateIds = useMemo(() => selectedTemplateIds(selection), [selection]);
  const promptInputLimit = useMemo(() => {
    if (!capabilities) return 1000;
    const reservedLength = buildVectorPrompt({ prompt: '', selection }).length;
    return Math.max(1, capabilities.promptLimit - reservedLength - 2);
  }, [capabilities, selection]);
  const nativeStyles = capabilities?.family === 'v3'
    ? RECRAFT_V3_VECTOR_STYLES
    : capabilities?.family === 'v2'
      ? RECRAFT_V2_VECTOR_STYLES
      : [];

  useEffect(() => {
    if (!capabilities) return;
    if (mode === 'image-to-image' && !capabilities.supportsImageToImage) {
      setMode('generate');
    }
    if (mode === 'explore' && !capabilities.supportsExplore) {
      setMode('generate');
    }
    setCount(previous => Math.min(previous, capabilities.maxCount));
    if (!capabilities.supportsStyles) setNativeStyle('');
    if (!capabilities.supportsCustomStyles) setCustomStyleId('');
    if (!capabilities.supportsNegativePrompt) setNegativePrompt('');
  }, [capabilities, mode]);

  const updateQuickSelection = (id: string) => {
    if (id === 'transparent' && !selection.quickIds.includes(id)) {
      setBackgroundEnabled(false);
    }
    setSelection(previous => normalizeVectorSelection({
      ...previous,
      quickIds: previous.quickIds.includes(id)
        ? previous.quickIds.filter(item => item !== id)
        : [...previous.quickIds, id],
    }));
  };

  const updateSingleSelection = (
    group: Exclude<VectorTemplateGroup, 'quick'>,
    id: string,
  ) => {
    setSelection(previous => normalizeVectorSelection({
      ...previous,
      [`${group}Id`]: previous[`${group}Id`] === id ? undefined : id,
    }));
  };

  const readUpload = (file: File) => {
    const acceptedTypes = mode === 'image-to-image'
      ? ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
      : ['image/png', 'image/jpeg', 'image/webp'];
    if (!acceptedTypes.includes(file.type)) {
      toast.error(mode === 'image-to-image'
        ? '参考创作仅支持 PNG、JPG、WEBP、SVG'
        : '位图描摹仅支持 PNG、JPG、WEBP');
      return;
    }
    if (file.size >= 10 * 1024 * 1024) {
      toast.error('参考图必须小于 10MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setUploadedImage(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const enhancePrompt = async () => {
    if (!selectedModel || !prompt.trim()) {
      toast.info('请先输入创意描述并选择模型');
      return;
    }
    setIsEnhancing(true);
    try {
      const response = await fetch('/api/vector-design', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: 'enhance-prompt',
          providerId: selectedModel.providerId,
          model: selectedModel.id,
          prompt,
          size: aspect,
        }),
      });
      const data = await response.json() as VectorApiResponse;
      if (!response.ok || !data.success || !data.enhancedPrompt) {
        throw new Error(data.error || '提示词优化失败');
      }
      setPrompt(data.enhancedPrompt);
      toast.success('创意描述已优化');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提示词优化失败');
    } finally {
      setIsEnhancing(false);
    }
  };

  const createCustomStyle = async () => {
    if (!selectedModel || !capabilities?.supportsCustomStyles || !activeImageUrl) {
      toast.info('请选择 Recraft V3 Vector 和一张参考图');
      return;
    }
    setIsCreatingStyle(true);
    try {
      const response = await fetch('/api/vector-design', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: 'create-style',
          providerId: selectedModel.providerId,
          model: selectedModel.id,
          prompt: prompt.trim() || undefined,
          imageUrl: activeImageUrl,
          size: aspect,
        }),
      });
      const data = await response.json() as VectorApiResponse;
      if (!response.ok || !data.success || !data.styleId) {
        throw new Error(data.error || '创建自定义风格失败');
      }
      setCustomStyleId(data.styleId);
      setNativeStyle('');
      toast.success('自定义风格已创建并应用');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建自定义风格失败');
    } finally {
      setIsCreatingStyle(false);
    }
  };

  const exploreSimilar = async (asset: VectorDesignAsset) => {
    if (!asset.providerId || !asset.model || !asset.sourceImageId) {
      toast.error('当前结果缺少 Explore 来源 ID');
      return;
    }
    setSimilarSourceId(asset.sourceImageId);
    try {
      const response = await fetch('/api/vector-design', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: 'explore-similar',
          providerId: asset.providerId,
          model: asset.model,
          sourceImageId: asset.sourceImageId,
          similarity,
          size: aspect,
        }),
      });
      const data = await response.json() as VectorApiResponse;
      if (!response.ok || !data.success || !data.assets?.length) {
        throw new Error(data.error || '相似探索失败');
      }
      setResults(data.assets);
      toast.success('已生成 8 个相似设计方向');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '相似探索失败');
    } finally {
      setSimilarSourceId('');
    }
  };

  const generate = async () => {
    if (!selectedModel || !capabilities) {
      toast.error('请先在管理员后台授权 Recraft Vector 模型');
      return;
    }
    if (modeNeedsPrompt(mode) && !prompt.trim()) {
      toast.info('请输入要生成的矢量图内容');
      return;
    }
    if (modeNeedsImage(mode) && !activeImageUrl) {
      toast.info('请从画布选择图片或上传参考图');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch('/api/vector-design', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: mode,
          providerId: selectedModel.providerId,
          model: selectedModel.id,
          prompt,
          selection,
          templateIds,
          size: aspect,
          n: count,
          imageUrl: modeNeedsImage(mode) ? activeImageUrl : undefined,
          strength: mode === 'image-to-image' ? strength : undefined,
          style: capabilities.supportsStyles && nativeStyle ? nativeStyle : undefined,
          styleId: capabilities.supportsCustomStyles && customStyleId
            ? customStyleId
            : undefined,
          negativePrompt: capabilities.supportsNegativePrompt && negativePrompt
            ? negativePrompt
            : undefined,
          artisticLevel: capabilities.family === 'v3' ? artisticLevel : undefined,
          noText: capabilities.supportsNoTextControl
            ? selection.quickIds.includes('no-text')
            : undefined,
          colors: paletteEnabled ? palette : undefined,
          backgroundColor: backgroundEnabled ? backgroundColor : undefined,
          randomSeed: randomSeed ? Number(randomSeed) : undefined,
        }),
      });
      const data = await response.json() as VectorApiResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error || '矢量图生成失败');
      }
      const assets = Array.isArray(data.assets)
        ? data.assets
        : data.asset
          ? [data.asset]
          : [];
      if (assets.length === 0) throw new Error('提供商没有返回可编辑 SVG');
      setResults(assets);
      if (assets.length === 1) setEditingAsset(assets[0]);
      toast.success(`已生成 ${assets.length} 个可编辑 SVG`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '矢量图生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const modeSourceImageId = !uploadedImage && modeNeedsImage(mode)
    ? selectedImage?.id
    : undefined;
  const activeClass = isMono
    ? 'border-blue-500/55 bg-blue-500/12 text-blue-300'
    : 'border-[#d4af37]/55 bg-[#d4af37]/12 text-[#e4c660]';

  return (
    <div className="flex min-h-full flex-col bg-[#111216] text-white">
      <header className="border-b border-white/8 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isMono ? 'bg-blue-500/12 text-blue-300' : 'bg-[#d4af37]/12 text-[#d4af37]'}`}>
              <PenTool size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">AI 矢量设计</h2>
              <p className="mt-0.5 truncate text-[10px] text-gray-500">
                {capabilities ? modelCapabilityLabel(capabilities) : '等待已授权模型'}
              </p>
            </div>
          </div>
          <span className="shrink-0 text-[10px] text-gray-600">
            {capabilities ? `最多 ${capabilities.maxCount} 个` : ''}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-4 rounded-lg bg-[#1a1b20] p-1">
          {MODE_OPTIONS.map(option => {
            const Icon = option.icon;
            const unsupported = option.id === 'image-to-image'
              ? capabilities ? !capabilities.supportsImageToImage : false
              : option.id === 'explore'
                ? capabilities ? !capabilities.supportsExplore : false
                : false;
            return (
              <button
                type="button"
                key={option.id}
                title={unsupported ? '当前模型不支持此模式' : option.label}
                disabled={unsupported}
                onClick={() => setMode(option.id)}
                className={`flex h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-md text-[10px] transition-colors ${
                  mode === option.id
                    ? isMono
                      ? 'bg-blue-500/14 text-blue-300'
                      : 'bg-[#2b2a24] text-[#e3c55b]'
                    : 'text-gray-500 hover:bg-white/4 hover:text-gray-300'
                } disabled:cursor-not-allowed disabled:opacity-25`}
              >
                <Icon size={14} />
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <section className="border-b border-white/7 px-4 py-4">
          <SectionTitle>Recraft 矢量模型</SectionTitle>
          <select
            value={modelKey}
            onChange={event => setModelKey(event.target.value)}
            className="h-10 w-full rounded-lg border border-white/8 bg-[#1a1b21] px-3 text-xs text-gray-200 outline-none focus:border-[#d4af37]/45"
          >
            {models.length === 0 && <option value="">未授权 Recraft Vector 模型</option>}
            {models.map(model => (
              <option
                key={`${model.providerId}::${model.id}`}
                value={`${model.providerId}::${model.id}`}
              >
                {model.displayName || model.name || model.id}
              </option>
            ))}
          </select>
        </section>

        {modeNeedsImage(mode) && (
          <section className="border-b border-white/7 px-4 py-4">
            <SectionTitle>参考图片</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!selectedImage}
                onClick={() => setUploadedImage('')}
                className={`min-h-18 rounded-lg border p-2 text-left ${
                  !uploadedImage && selectedImage
                    ? activeClass
                    : 'border-white/8 bg-[#1a1b21] text-gray-400'
                } disabled:opacity-35`}
              >
                <FileImage size={15} className="mb-2" />
                <span className="block text-[11px]">画布图片</span>
                <span className="mt-0.5 block truncate text-[9px] opacity-60">
                  {selectedImage ? '已选择' : '未选择'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`min-h-18 rounded-lg border p-2 text-left ${
                  uploadedImage ? activeClass : 'border-white/8 bg-[#1a1b21] text-gray-400'
                }`}
              >
                <Upload size={15} className="mb-2" />
                <span className="block text-[11px]">上传图片</span>
                <span className="mt-0.5 block text-[9px] opacity-60">
                  {uploadedImage
                    ? '已上传'
                    : mode === 'image-to-image'
                      ? 'PNG / JPG / WEBP / SVG'
                      : 'PNG / JPG / WEBP'}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={mode === 'image-to-image'
                  ? 'image/png,image/jpeg,image/webp,image/svg+xml'
                  : 'image/png,image/jpeg,image/webp'}
                className="hidden"
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) readUpload(file);
                }}
              />
            </div>
            {activeImageUrl && (
              <Image
                src={activeImageUrl}
                alt="矢量设计参考图"
                width={480}
                height={192}
                unoptimized
                className="mt-2 h-24 w-full rounded-lg border border-white/8 bg-black/20 object-contain"
              />
            )}
            {mode === 'image-to-image' && (
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between text-[10px] text-gray-500">
                    <span>变化强度</span>
                    <span>{Math.round(strength * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={strength}
                    onChange={event => setStrength(Number(event.target.value))}
                    className="w-full accent-[#d4af37]"
                  />
                </label>
                {capabilities?.supportsCustomStyles && (
                  <button
                    type="button"
                    disabled={isCreatingStyle || !activeImageUrl}
                    onClick={createCustomStyle}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-white/8 bg-[#1a1b21] text-[10px] text-gray-300 disabled:opacity-35"
                  >
                    <Palette size={13} />
                    {isCreatingStyle
                      ? '正在创建风格…'
                      : customStyleId
                        ? '重新创建自定义风格'
                        : '从参考图创建自定义风格'}
                  </button>
                )}
                {customStyleId && (
                  <p className="truncate text-[9px] text-emerald-400">
                    已应用自定义风格 {customStyleId}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {modeNeedsPrompt(mode) && (
          <section className="border-b border-white/7 px-4 py-4">
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle compact>创意描述</SectionTitle>
              <button
                type="button"
                title="优化提示词"
                disabled={isEnhancing || !prompt.trim() || !selectedModel}
                onClick={enhancePrompt}
                className="flex h-7 items-center gap-1 rounded-md border border-white/8 px-2 text-[10px] text-gray-400 hover:text-white disabled:opacity-35"
              >
                <WandSparkles size={12} />
                {isEnhancing ? '优化中' : '优化'}
              </button>
            </div>
            <textarea
              value={prompt}
              maxLength={promptInputLimit}
              onChange={event => setPrompt(event.target.value)}
              placeholder="描述主体、构图、应用场景与需要保留的文字"
              className="h-28 w-full resize-y rounded-lg border border-white/8 bg-[#1a1b21] p-3 text-xs leading-5 text-white outline-none placeholder:text-gray-600 focus:border-[#d4af37]/45"
            />
            <div className="mt-1 text-right text-[9px] text-gray-600">
              {prompt.length}/{promptInputLimit}
            </div>
          </section>
        )}

        {mode === 'explore' && (
          <section className="border-b border-white/7 px-4 py-4">
            <SectionTitle>相似探索强度</SectionTitle>
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-[10px] text-gray-500">
                <span>从探索结果继续延展时使用</span>
                <span>{similarity}/5</span>
              </span>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={similarity}
                onChange={event => setSimilarity(Number(event.target.value))}
                className="w-full accent-[#d4af37]"
              />
            </label>
          </section>
        )}

        {mode !== 'vectorize' && (
          <>
            {(Object.keys(GROUP_LABELS) as VectorTemplateGroup[]).map(group => (
              <section key={group} className="border-b border-white/7 px-4 py-4">
                <SectionTitle>{GROUP_LABELS[group]}</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {VECTOR_KEYWORD_TEMPLATES
                    .filter(template => template.group === group)
                    .map(template => {
                      const active = group === 'quick'
                        ? selection.quickIds.includes(template.id)
                        : selection[`${group}Id`] === template.id;
                      return (
                        <button
                          type="button"
                          key={template.id}
                          onClick={() => {
                            if (group === 'quick') updateQuickSelection(template.id);
                            else updateSingleSelection(group, template.id);
                          }}
                          className={`rounded-md border px-2 py-1.5 text-[10px] transition-colors ${
                            active
                              ? activeClass
                              : 'border-white/8 bg-[#1a1b21] text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {template.label}
                        </button>
                      );
                    })}
                </div>
              </section>
            ))}
          </>
        )}

        {mode !== 'vectorize' && (
          <section className="border-b border-white/7 px-4 py-4">
            <SectionTitle>画面比例</SectionTitle>
            <div className="grid grid-cols-4 gap-1.5">
              {VECTOR_ASPECT_RATIOS.map(option => (
                <button
                  type="button"
                  key={option.value}
                  title={option.label}
                  onClick={() => setAspect(option.value)}
                  className={`h-9 rounded-md border text-[10px] ${
                    aspect === option.value
                      ? activeClass
                      : 'border-white/8 bg-[#1a1b21] text-gray-500'
                  }`}
                >
                  {option.value}
                </button>
              ))}
            </div>
          </section>
        )}

        {mode !== 'vectorize' && mode !== 'explore' && capabilities && (
          <section className="border-b border-white/7 px-4 py-4">
            <SectionTitle>生成数量</SectionTitle>
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: capabilities.maxCount }, (_, index) => index + 1).map(value => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setCount(value)}
                  className={`h-9 rounded-md border text-[10px] ${
                    count === value
                      ? activeClass
                      : 'border-white/8 bg-[#1a1b21] text-gray-500'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </section>
        )}

        {mode !== 'vectorize' && mode !== 'explore' && capabilities && (
          <details className="border-b border-white/7 px-4 py-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-gray-400">
              <SlidersHorizontal size={14} />
              生成参数
            </summary>
            <div className="mt-4 space-y-4">
              {capabilities.supportsStyles && (
                <label className="block">
                  <span className="mb-1.5 block text-[10px] text-gray-500">Recraft 原生风格</span>
                  <select
                    value={nativeStyle}
                    onChange={event => {
                      setNativeStyle(event.target.value);
                      if (event.target.value) setCustomStyleId('');
                    }}
                    className="h-9 w-full rounded-lg border border-white/8 bg-[#1a1b21] px-2 text-[11px] text-gray-300 outline-none"
                  >
                    <option value="">模型默认</option>
                    {nativeStyles.map(style => (
                      <option key={style} value={style}>{style}</option>
                    ))}
                  </select>
                </label>
              )}

              {capabilities.supportsNegativePrompt && (
                <label className="block">
                  <span className="mb-1.5 block text-[10px] text-gray-500">负向提示词</span>
                  <textarea
                    value={negativePrompt}
                    onChange={event => setNegativePrompt(event.target.value)}
                    placeholder="不希望出现的内容"
                    className="h-16 w-full resize-y rounded-lg border border-white/8 bg-[#1a1b21] p-2 text-[11px] text-gray-300 outline-none"
                  />
                </label>
              )}

              {capabilities.family === 'v3' && (
                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between text-[10px] text-gray-500">
                    <span>艺术强度</span>
                    <span>{artisticLevel}</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="1"
                    value={artisticLevel}
                    onChange={event => setArtisticLevel(Number(event.target.value))}
                    className="w-full accent-[#d4af37]"
                  />
                </label>
              )}

              <div>
                <label className="mb-2 flex items-center justify-between text-[10px] text-gray-500">
                  <span>偏好色盘</span>
                  <input
                    type="checkbox"
                    checked={paletteEnabled}
                    onChange={event => setPaletteEnabled(event.target.checked)}
                    className="accent-[#d4af37]"
                  />
                </label>
                {paletteEnabled && (
                  <div className="grid grid-cols-3 gap-2">
                    {palette.map((color, index) => (
                      <label
                        key={`${index}-${color}`}
                        className="flex h-9 items-center gap-2 rounded-lg border border-white/8 bg-[#1a1b21] px-2"
                      >
                        <input
                          type="color"
                          value={color}
                          title={`偏好色 ${index + 1}`}
                          onChange={event => {
                            setPalette(previous => previous.map((item, itemIndex) => (
                              itemIndex === index ? event.target.value : item
                            )));
                          }}
                          className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
                        />
                        <span className="truncate text-[9px] uppercase text-gray-500">{color}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between text-[10px] text-gray-500">
                    <span>背景色</span>
                    <input
                      type="checkbox"
                      checked={backgroundEnabled}
                      onChange={event => {
                        const enabled = event.target.checked;
                        setBackgroundEnabled(enabled);
                        if (enabled) {
                          setSelection(previous => normalizeVectorSelection({
                            ...previous,
                            quickIds: previous.quickIds.filter(id => id !== 'transparent'),
                          }));
                        }
                      }}
                      className="accent-[#d4af37]"
                    />
                  </span>
                  <input
                    type="color"
                    value={backgroundColor}
                    disabled={!backgroundEnabled}
                    title="背景色"
                    onChange={event => setBackgroundColor(event.target.value)}
                    className="h-9 w-full cursor-pointer rounded-lg border border-white/8 bg-[#1a1b21] p-1 disabled:opacity-35"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] text-gray-500">随机种子</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={randomSeed}
                    onChange={event => setRandomSeed(event.target.value)}
                    placeholder="随机"
                    className="h-9 w-full rounded-lg border border-white/8 bg-[#1a1b21] px-2 text-[11px] text-gray-300 outline-none"
                  />
                </label>
              </div>
            </div>
          </details>
        )}

        {results.length > 0 && (
          <section className="px-4 py-4">
            <SectionTitle>生成结果</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {results.map((asset, index) => (
                <article
                  key={asset.svgUrl}
                  className="overflow-hidden rounded-lg border border-white/8 bg-[#1a1b21]"
                >
                  <Image
                    src={asset.previewUrl}
                    alt={`矢量结果 ${index + 1}`}
                    width={Math.max(1, asset.width)}
                    height={Math.max(1, asset.height)}
                    unoptimized
                    className="h-28 w-full bg-white object-contain"
                  />
                  <div className={`grid gap-1 p-2 ${
                    mode === 'explore' && asset.sourceImageId ? 'grid-cols-3' : 'grid-cols-2'
                  }`}>
                    <button
                      type="button"
                      onClick={() => setEditingAsset(asset)}
                      className="rounded-md border border-white/8 py-1.5 text-[10px] text-gray-300"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => onAddVector(asset, modeSourceImageId)}
                      className={`rounded-md py-1.5 text-[10px] font-semibold ${
                        isMono ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
                      }`}
                    >
                      上画布
                    </button>
                    {mode === 'explore' && asset.sourceImageId && (
                      <button
                        type="button"
                        disabled={Boolean(similarSourceId)}
                        onClick={() => void exploreSimilar(asset)}
                        className="rounded-md border border-[#d4af37]/30 py-1.5 text-[10px] text-[#d4af37] disabled:opacity-35"
                      >
                        {similarSourceId === asset.sourceImageId ? '探索中' : '相似'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="border-t border-white/8 p-4">
        <button
          type="button"
          disabled={isGenerating || Boolean(similarSourceId) || !selectedModel}
          onClick={generate}
          className={`flex h-11 w-full items-center justify-center gap-2 rounded-lg text-xs font-bold disabled:opacity-40 ${
            isMono ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
          }`}
        >
          <Sparkles size={15} />
          {isGenerating ? '正在处理 SVG…' : modeButtonLabel(mode)}
        </button>
      </footer>

      {editingAsset && (
        <VectorEditorDialog
          asset={editingAsset}
          templateIds={templateIds}
          onClose={() => setEditingAsset(null)}
          onSave={asset => {
            setResults(previous => previous.map(item => (
              item.svgUrl === editingAsset.svgUrl ? asset : item
            )));
            onAddVector(asset, modeSourceImageId);
          }}
        />
      )}
    </div>
  );
}

function SectionTitle({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'flex items-center gap-2' : 'mb-2 flex items-center gap-2'}>
      <span className="h-1.5 w-1.5 rounded-full bg-[#d4af37]" />
      <h3 className="text-[11px] font-semibold text-[#989aa2]">{children}</h3>
    </div>
  );
}
