'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronDown,
  Copy,
  Film,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  Settings2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { classifyIntent, describeIntent, type ClassifiedIntent } from '@/lib/intent-classifier';
import type {
  QuickCreateAspectRatio,
  QuickCreateCompilePhase,
  QuickCreateCompileResult,
  QuickCreateModelSource,
  QuickCreateQuality,
} from '@/lib/quick-create-compile';
import type { QuickCreateModelCandidate, ResolvedQuickCreateModel } from '@/lib/model-defaults';

export interface QuickCreateCompileViewState {
  phase: QuickCreateCompilePhase | null;
  statusMessage: string;
  streamText: string;
  result: QuickCreateCompileResult | null;
  error: string;
  isCompiling: boolean;
}

export interface QuickCreateRequest {
  prompt: string;
  aspectRatio: QuickCreateAspectRatio;
  quality: QuickCreateQuality;
  outputCount: number;
  referenceImages: string[];
  intent: ClassifiedIntent;
  imageModelOverride?: string;
  chatModelOverride?: string;
}

interface QuickCreatePanelProps {
  themeStyle?: 'gold' | 'monochrome';
  selectedImage?: { id: string; url: string; prompt?: string } | null;
  imageModels: QuickCreateModelCandidate[];
  chatModels: QuickCreateModelCandidate[];
  resolvedImageModel: ResolvedQuickCreateModel;
  resolvedChatModel: ResolvedQuickCreateModel;
  compileState: QuickCreateCompileViewState;
  modelsLoading?: boolean;
  modelsError?: string;
  onGenerate: (request: QuickCreateRequest) => Promise<boolean>;
  onOpenProfessional: (prompt?: string) => void;
  onOpenChat: (prompt?: string) => void;
  onOpenVideo: (prompt?: string, mode?: 'generate' | 'extend') => void;
}

type GoalGroup = '热门创作' | '品牌识别' | '商业营销' | '空间美陈' | '内容出版' | '数字创意';

interface QuickGoal {
  label: string;
  group: GoalGroup;
  prompt: string;
  keywords: string;
}

interface ParameterRecommendation {
  aspectRatio: QuickCreateAspectRatio;
  quality: QuickCreateQuality;
  outputCount: number;
  ratioReason: string;
  countReason: string;
  qualityReason: string;
}

const GOAL_GROUPS: GoalGroup[] = ['热门创作', '品牌识别', '商业营销', '空间美陈', '内容出版', '数字创意'];

const QUICK_GOALS: QuickGoal[] = [
  {
    label: '创意海报',
    group: '热门创作',
    keywords: '主视觉 · 活动 · 招贴',
    prompt: '设计一组具有强视觉焦点的创意海报，建立清晰的信息层级、标题排版和品牌记忆点，兼顾传播冲击力与高级质感',
  },
  {
    label: '电商商品图',
    group: '热门创作',
    keywords: '主图 · 详情页 · 场景图',
    prompt: '为商品设计一套专业电商视觉，突出产品卖点、材质细节和使用场景，包含主图与差异化营销方向',
  },
  {
    label: '品牌视觉',
    group: '热门创作',
    keywords: 'VI · 品牌资产 · 视觉语言',
    prompt: '为品牌建立一套统一且可延展的视觉语言，明确核心图形、色彩气质、字体关系和典型应用场景',
  },
  {
    label: '社媒配图',
    group: '热门创作',
    keywords: '小红书 · 公众号 · 信息流',
    prompt: '设计一组适合社交媒体传播的系列配图，强化首屏吸引力、信息可读性和统一的账号视觉识别',
  },
  {
    label: '包装设计',
    group: '品牌识别',
    keywords: '盒型 · 标签 · 瓶身',
    prompt: '为产品设计三款差异化包装方案，完整考虑品牌识别、货架冲击力、包装结构、材质工艺和核心信息排版',
  },
  {
    label: '品牌标志',
    group: '品牌识别',
    keywords: 'Logo · 标准字 · 图形标',
    prompt: '为品牌设计四个专业标志方向，兼顾独特性、识别度、缩放适配和跨媒介应用，并呈现图形标与标准字关系',
  },
  {
    label: 'IP 形象',
    group: '品牌识别',
    keywords: '角色 · 三视图 · 表情',
    prompt: '设计一套具有鲜明性格和品牌关联的 IP 形象，包含角色核心造型、色彩体系、标志性道具与多种表情方向',
  },
  {
    label: '字体设计',
    group: '品牌识别',
    keywords: '标题字 · 字标 · 创意字形',
    prompt: '设计一款具有独特字形语言的品牌标题字，强化结构、笔画、负空间和可读性，适用于品牌标志与主视觉标题',
  },
  {
    label: '营销主视觉',
    group: '商业营销',
    keywords: 'KV · Campaign · 发布会',
    prompt: '设计一套商业营销主视觉 KV，突出活动主题和核心利益点，并预留标题、卖点与行动引导的专业排版空间',
  },
  {
    label: '产品场景图',
    group: '商业营销',
    keywords: '广告摄影 · 氛围 · 卖点',
    prompt: '为产品生成三张高品质商业场景图，通过光影、构图和环境叙事突出产品功能、材质与目标人群气质',
  },
  {
    label: '促销物料',
    group: '商业营销',
    keywords: '折扣 · 节日 · 门店',
    prompt: '设计一组统一的促销传播物料，包含醒目的优惠信息、清晰价格层级和适合线上线下延展的视觉元素',
  },
  {
    label: '社交媒体套图',
    group: '商业营销',
    keywords: '系列封面 · 九宫格 · Story',
    prompt: '设计四张具有统一视觉节奏的社交媒体套图，包含封面、内容信息页和互动引导页，适配移动端阅读',
  },
  {
    label: '美陈设计',
    group: '空间美陈',
    keywords: '商业空间 · 节庆 · 装置',
    prompt: '为商业空间设计一套主题美陈方案，包含核心艺术装置、入口氛围、互动打卡点和整体空间色彩关系',
  },
  {
    label: '展览展陈',
    group: '空间美陈',
    keywords: '展台 · 动线 · 信息层级',
    prompt: '设计一套专业展览展陈视觉，统筹空间动线、展台造型、品牌信息层级、灯光氛围和观众互动体验',
  },
  {
    label: '快闪店',
    group: '空间美陈',
    keywords: 'Pop-up · 零售 · 打卡',
    prompt: '设计一个具有社交传播力的品牌快闪店概念，包含外立面、核心陈列、体验区和标志性打卡装置',
  },
  {
    label: '导视系统',
    group: '空间美陈',
    keywords: '标识 · 路径 · 空间图形',
    prompt: '设计一套清晰统一的空间导视系统，包含方向指引、区域标识、信息图形和符合环境气质的材质应用',
  },
  {
    label: '画册设计',
    group: '内容出版',
    keywords: '品牌手册 · 宣传册 · 版式',
    prompt: '设计一套专业品牌画册视觉，建立封面、目录、跨页和图文详情页的统一网格与编辑设计语言',
  },
  {
    label: '书籍封面',
    group: '内容出版',
    keywords: '文学 · 商业 · 概念封面',
    prompt: '设计三款具有出版品质的书籍封面方向，通过概念图形、字体层级和留白建立内容气质与市场识别度',
  },
  {
    label: '杂志视觉',
    group: '内容出版',
    keywords: '封面 · 专题 · Editorial',
    prompt: '设计一套现代杂志视觉，包含高辨识度封面与专题跨页，强调编辑排版、图片节奏和栏目层级',
  },
  {
    label: '演示文稿',
    group: '内容出版',
    keywords: 'PPT · 路演 · 提案',
    prompt: '设计一套 16:9 商业演示文稿主视觉，包含封面、章节页、数据页和总结页，风格专业且信息层级清晰',
  },
  {
    label: 'App / 网页界面',
    group: '数字创意',
    keywords: 'UI · 落地页 · 产品界面',
    prompt: '设计一套现代数字产品界面主视觉，明确导航、核心内容、行动按钮和组件层级，兼顾品牌感与易用性',
  },
  {
    label: '概念插画',
    group: '数字创意',
    keywords: '叙事 · 编辑插画 · 场景',
    prompt: '创作三幅统一风格的概念插画，通过角色、场景、光影和视觉隐喻表达主题，并保持系列叙事一致性',
  },
  {
    label: '贴纸表情包',
    group: '数字创意',
    keywords: '表情 · 动作 · 社交传播',
    prompt: '设计四款统一角色风格的贴纸表情，覆盖不同情绪与动作，轮廓清晰、表意直接并适合小尺寸传播',
  },
  {
    label: '3D 视觉',
    group: '数字创意',
    keywords: '三维图标 · 立体场景 · 材质',
    prompt: '创建一套精致的 3D 视觉概念，统一造型语言、材质、光照和空间层次，适合作为品牌主视觉资产',
  },
];

const ASPECT_RATIO_OPTIONS = ['1:1', '4:5', '3:4', '2:3', '16:9', '9:16', '3:2', '4:3'] as const;
const QUALITY_OPTIONS = [
  { value: 'standard', label: '标准' },
  { value: 'high', label: '高清' },
] as const;

function parseExplicitCount(prompt: string): number | null {
  const arabicMatch = prompt.match(/(?:生成|设计|制作|创建|出|要)?\s*(\d+)\s*(?:张|幅|款|版|个|套|组)/i);
  if (arabicMatch) return Math.min(4, Math.max(1, Number(arabicMatch[1])));

  const chineseNumbers: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4 };
  const chineseMatch = prompt.match(/(?:生成|设计|制作|创建|出|要)?\s*([一两二三四])\s*(?:张|幅|款|版|个|套|组)/);
  return chineseMatch ? chineseNumbers[chineseMatch[1]] : null;
}

function recommendParameters(prompt: string, intent: ClassifiedIntent): ParameterRecommendation {
  const normalized = prompt.toLowerCase().replace(/\s+/g, ' ');
  let aspectRatio: QuickCreateAspectRatio = '1:1';
  let ratioReason = '通用方形构图';

  const explicitRatio = normalized.match(/(?:比例|画幅|尺寸)?\s*(1:1|4:5|3:4|2:3|16:9|9:16|3:2|4:3)/)?.[1];
  if (explicitRatio) {
    aspectRatio = explicitRatio as QuickCreateAspectRatio;
    ratioReason = '已识别明确比例';
  } else if (/1080\s*[x×*]\s*1920|手机壁纸|竖屏视频|短视频封面|story|reels|9比16|竖版全屏/.test(normalized)) {
    aspectRatio = '9:16';
    ratioReason = '适配竖屏内容';
  } else if (/1920\s*[x×*]\s*1080|演示文稿|ppt|路演|横版视频|电影感|大屏|banner|横幅|16比9/.test(normalized) || intent.action === 'video') {
    aspectRatio = '16:9';
    ratioReason = '适配横屏展示';
  } else if (/小红书|信息流|社交媒体|社媒|ins|instagram|商品详情|4比5/.test(normalized)) {
    aspectRatio = '4:5';
    ratioReason = '适配社媒信息流';
  } else if (/海报|包装|书籍封面|杂志封面|人物全身|ip形象|ip 形象|3比4/.test(normalized)) {
    aspectRatio = '3:4';
    ratioReason = '适配竖版设计';
  } else if (/画册|宣传册|摄影|风景|空间|展陈|美陈|快闪店|3比2/.test(normalized)) {
    aspectRatio = '3:2';
    ratioReason = '适配场景展示';
  } else if (/logo|标志|图标|头像|贴纸|表情|方形|正方形|1比1/.test(normalized)) {
    aspectRatio = '1:1';
    ratioReason = '适配标志与方形资产';
  }

  const explicitCount = parseExplicitCount(normalized);
  let outputCount = explicitCount ?? 1;
  let countReason = explicitCount ? `已识别数量，单次最多 4 张` : '单张精准输出';
  if (!explicitCount && /九宫格|系列套图|社交媒体套图|贴纸|表情包|四个方向|四款|多款|多版|多套/.test(normalized)) {
    outputCount = 4;
    countReason = '系列创作需要多方向对比';
  } else if (!explicitCount && /三款|三张|三幅|三版|三个方向|概念提案|方案对比|一组|一套|系列|套图/.test(normalized)) {
    outputCount = 3;
    countReason = '自动提供 3 个创意方向';
  } else if (!explicitCount && /两款|两张|两版|两个方向|对比方案/.test(normalized)) {
    outputCount = 2;
    countReason = '自动提供双方案对比';
  }

  const highQuality = /高清|高精度|精细|细节|4k|2k|印刷|出版|商业摄影|专业|材质|产品图|包装|标志|logo|字体|主视觉|kv|写实/.test(normalized);
  const draftQuality = /草图|初稿|快速|灵感|概念探索|低成本|先看看/.test(normalized);
  const quality = highQuality && !draftQuality ? 'high' : 'standard';
  const qualityReason = quality === 'high' ? '专业交付场景优先细节' : draftQuality ? '概念探索优先速度' : '平衡速度与质量';

  return { aspectRatio, quality, outputCount, ratioReason, countReason, qualityReason };
}

function getRouteLabel(intent: ClassifiedIntent): string {
  if (intent.action === 'video' || intent.action === 'video_extend') return '视频导演';
  if (intent.action === '3d') return '3D 创作';
  if (intent.category === 'operate') return '智能图片编辑';
  if (intent.category === 'analyze' || intent.category === 'chat') return 'AI 助手';
  if (intent.category === 'brand') return '品牌设计 Skill';
  return '图像生成';
}

function getModelSourceLabel(source: ResolvedQuickCreateModel['source']): string {
  const labels: Record<ResolvedQuickCreateModel['source'], string> = {
    'task-override': '本次任务覆盖',
    'quick-create-default': '快速创作默认',
    'global-default': '全局默认',
    'recent-selection': '最近专业选择',
    'first-available': '首个可用模型',
    none: '暂无可用模型',
  };
  return labels[source];
}

function getModelDisplayName(resolved: ResolvedQuickCreateModel): string {
  if (!resolved.model) return '未配置';
  return resolved.model.name || resolved.model.modelId;
}

function getCompilePhaseLabel(phase: QuickCreateCompilePhase | null): string {
  if (!phase) return '等待编译';
  const labels: Record<QuickCreateCompilePhase, string> = {
    validating: '校验需求',
    routing: '选择模型',
    understanding: '理解创意',
    strategizing: '制定方案',
    finalizing: '整理提示词',
    ready: '方案就绪',
  };
  return labels[phase];
}

function getCompileModelSourceLabel(source: QuickCreateModelSource): string {
  const labels: Record<QuickCreateModelSource, string> = {
    'task-override': '本次任务覆盖',
    'quick-create-default': '快速创作默认',
    'global-default': '全局默认',
    'recent-selection': '最近专业选择',
    'first-available': '首个授权模型',
  };
  return labels[source];
}

export function QuickCreatePanel({
  themeStyle = 'gold',
  selectedImage,
  imageModels,
  chatModels,
  resolvedImageModel,
  resolvedChatModel,
  compileState,
  modelsLoading = false,
  modelsError,
  onGenerate,
  onOpenProfessional,
  onOpenChat,
  onOpenVideo,
}: QuickCreatePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [activeGoalGroup, setActiveGoalGroup] = useState<GoalGroup>('热门创作');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [uploadedReferences, setUploadedReferences] = useState<string[]>([]);
  const [includeSelectedImage, setIncludeSelectedImage] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedContent, setCopiedContent] = useState<'full' | 'positive' | 'negative' | null>(null);
  const [isUploadingReferences, setIsUploadingReferences] = useState(false);
  const [referenceUploadError, setReferenceUploadError] = useState<string>();
  const [aspectRatioOverride, setAspectRatioOverride] = useState<QuickCreateAspectRatio>();
  const [qualityOverride, setQualityOverride] = useState<QuickCreateQuality>();
  const [outputCountOverride, setOutputCountOverride] = useState<number>();
  const [showAdvancedModels, setShowAdvancedModels] = useState(false);
  const [imageModelOverride, setImageModelOverride] = useState('');
  const [chatModelOverride, setChatModelOverride] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const referenceImages = useMemo(() => {
    const selected = includeSelectedImage && selectedImage?.url ? [selectedImage.url] : [];
    return Array.from(new Set([...selected, ...uploadedReferences]));
  }, [includeSelectedImage, selectedImage, uploadedReferences]);

  const intent = useMemo(
    () => classifyIntent(prompt, {
      hasImages: referenceImages.length > 0,
      selectedImageId: includeSelectedImage ? selectedImage?.id ?? null : null,
      selectedImageUrl: includeSelectedImage ? selectedImage?.url ?? null : null,
    }),
    [includeSelectedImage, prompt, referenceImages.length, selectedImage],
  );

  const inferredParameters = useMemo(() => recommendParameters(prompt, intent), [intent, prompt]);
  const recommendation = useMemo(() => ({
    intent: prompt.trim() ? describeIntent(intent) : '等待输入创作需求',
    route: prompt.trim() ? getRouteLabel(intent) : '自动匹配',
    aspectRatio: aspectRatioOverride ?? inferredParameters.aspectRatio,
    quality: qualityOverride ?? inferredParameters.quality,
    outputCount: outputCountOverride ?? inferredParameters.outputCount,
  }), [aspectRatioOverride, inferredParameters, intent, outputCountOverride, prompt, qualityOverride]);

  const effectiveImageModel = useMemo<ResolvedQuickCreateModel>(() => {
    if (!imageModelOverride) return resolvedImageModel;
    const model = imageModels.find((candidate: QuickCreateModelCandidate) => candidate.id === imageModelOverride) ?? null;
    return model
      ? { id: model.id, model, source: 'task-override' }
      : resolvedImageModel;
  }, [imageModelOverride, imageModels, resolvedImageModel]);

  const effectiveChatModel = useMemo<ResolvedQuickCreateModel>(() => {
    if (!chatModelOverride) return resolvedChatModel;
    const model = chatModels.find((candidate: QuickCreateModelCandidate) => candidate.id === chatModelOverride) ?? null;
    return model
      ? { id: model.id, model, source: 'task-override' }
      : resolvedChatModel;
  }, [chatModelOverride, chatModels, resolvedChatModel]);

  const requiresImageModel = recommendation.route === '图像生成' || recommendation.route === '品牌设计 Skill';
  const imageModelUnavailable = requiresImageModel && !effectiveImageModel.model;

  const visibleGoals = useMemo(
    () => QUICK_GOALS.filter((goal: QuickGoal) => goal.group === activeGoalGroup),
    [activeGoalGroup],
  );

  useEffect(() => {
    setSubmitted(false);
  }, [includeSelectedImage, uploadedReferences]);

  const applyPrompt = (nextPrompt: string): void => {
    setPrompt(nextPrompt);
    setAspectRatioOverride(undefined);
    setQualityOverride(undefined);
    setOutputCountOverride(undefined);
    setSubmitted(false);
  };

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? []).filter((file: File) => file.type.startsWith('image/'));
    const remainingSlots = Math.max(0, 4 - uploadedReferences.length);
    const selectedFiles = files.slice(0, remainingSlots);
    event.target.value = '';

    if (selectedFiles.length === 0) return;

    setIsUploadingReferences(true);
    setReferenceUploadError(undefined);

    const results = await Promise.all(selectedFiles.map(async (file: File): Promise<string | null> => {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/api/save-image', { method: 'POST', body: formData });
        const data = await response.json() as { url?: string; error?: string };
        if (!response.ok || !data.url) throw new Error(data.error || '参考图片上传失败');
        return data.url;
      } catch (error) {
        console.error('[QuickCreatePanel] reference upload failed:', error);
        return null;
      }
    }));

    const persistedUrls = results.filter((url: string | null): url is string => Boolean(url));
    if (persistedUrls.length > 0) {
      setUploadedReferences((current: string[]) => Array.from(new Set([...current, ...persistedUrls])).slice(0, 4));
    }
    if (persistedUrls.length !== selectedFiles.length) setReferenceUploadError('部分参考图片上传失败，请重试');
    setIsUploadingReferences(false);
  };

  const handleSubmit = async (): Promise<void> => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isSubmitting) return;

    if (intent.action === 'video' || intent.action === 'video_extend') {
      onOpenVideo(trimmedPrompt, intent.action === 'video_extend' ? 'extend' : 'generate');
      return;
    }
    if (intent.action === '3d' || intent.category === 'operate' || intent.category === 'analyze' || intent.category === 'chat') {
      onOpenChat(trimmedPrompt);
      return;
    }

    setIsSubmitting(true);
    try {
      const accepted = await onGenerate({
        prompt: trimmedPrompt,
        aspectRatio: recommendation.aspectRatio,
        quality: recommendation.quality,
        outputCount: recommendation.outputCount,
        referenceImages,
        intent,
        imageModelOverride: imageModelOverride || undefined,
        chatModelOverride: chatModelOverride || undefined,
      });
      setSubmitted(accepted);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCompileResult = (result: QuickCreateCompileResult): string => {
    const directions = result.directions.map((direction: QuickCreateCompileResult['directions'][number], index: number) => (
      `${index + 1}. ${direction.title}\n${direction.description}\n关键词：${direction.visualKeywords.join('、')}`
    )).join('\n\n');

    return [
      `创作摘要：${result.summary}`,
      `创作策略：${result.strategy}`,
      `创意方向：\n${directions}`,
      `正向提示词：${result.positivePrompt}`,
      `负向提示词：${result.negativePrompt}`,
      `输出规格：${result.aspectRatio} · ${result.outputCount} 张 · ${result.quality === 'high' ? '高清' : '标准'}`,
      `实际 LLM：${result.model}（${result.providerName}）`,
    ].join('\n\n');
  };

  const copyText = async (content: string, kind: 'full' | 'positive' | 'negative'): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!copied) throw new Error('浏览器拒绝复制请求');
      }
      setCopiedContent(kind);
      window.setTimeout(() => setCopiedContent((current: 'full' | 'positive' | 'negative' | null) => current === kind ? null : current), 1800);
    } catch (error) {
      console.error('[QuickCreatePanel] failed to copy creative plan:', error);
      setCopiedContent(null);
    }
  };

  const isMonochrome = themeStyle === 'monochrome';
  const isFallbackPlan = compileState.result?.mode === 'fallback';
  const selectClassName = 'min-h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15';

  return (
    <div className="flex min-h-full flex-col px-4 py-4">
      <section className={`rounded-2xl border p-4 shadow-card ${isMonochrome ? 'border-border bg-card' : 'border-primary/20 bg-card'}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">一句话开始专业创作</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">像和创意搭档沟通一样描述，系统自动理解品类、尺寸、数量和质量。</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenProfessional(prompt)}
            className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            专业设置
          </button>
        </div>

        <textarea
          value={prompt}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => applyPrompt(event.target.value)}
          placeholder="例如：为东方茶饮设计 3 张春季新品海报，适合小红书竖版发布，清新克制、印刷级细节"
          className="min-h-32 w-full resize-y rounded-xl border border-border bg-muted px-3.5 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
        />

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <LayoutGrid className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            专业创作类别
          </div>
          <button
            type="button"
            aria-expanded={showAllCategories}
            onClick={() => setShowAllCategories((value: boolean) => !value)}
            className="flex min-h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {showAllCategories ? '收起分类' : '浏览全部'}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAllCategories ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        </div>

        {showAllCategories && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="创作类别分组">
            {GOAL_GROUPS.map((group: GoalGroup) => (
              <button
                key={group}
                type="button"
                role="tab"
                aria-selected={activeGoalGroup === group}
                onClick={() => setActiveGoalGroup(group)}
                className={`min-h-9 shrink-0 cursor-pointer rounded-lg px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${activeGoalGroup === group ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
              >
                {group}
              </button>
            ))}
          </div>
        )}

        <div className={`mt-2 grid gap-2 ${showAllCategories ? 'grid-cols-2' : 'grid-cols-2'}`} aria-label="常用创作目标">
          {(showAllCategories ? visibleGoals : QUICK_GOALS.slice(0, 4)).map((goal: QuickGoal) => (
            <button
              key={goal.label}
              type="button"
              onClick={() => applyPrompt(goal.prompt)}
              className="min-h-16 cursor-pointer rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span className="block text-xs font-semibold text-foreground">{goal.label}</span>
              <span className="mt-1 block truncate text-[10px] text-muted-foreground">{goal.keywords}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-foreground">参考图片</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">可选，最多添加 4 张</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingReferences || uploadedReferences.length >= 4}
            className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {isUploadingReferences ? '上传中' : '上传图片'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event: React.ChangeEvent<HTMLInputElement>) => { void handleFiles(event); }} />
        </div>

        {selectedImage && (
          <button
            type="button"
            aria-pressed={includeSelectedImage}
            onClick={() => setIncludeSelectedImage((value: boolean) => !value)}
            className={`mt-2 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${includeSelectedImage ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            <ImagePlus className="h-4 w-4 text-primary" aria-hidden="true" />
            {includeSelectedImage ? '已引用画布选中图片' : '引用画布当前选中图片'}
          </button>
        )}

        {referenceUploadError && <p className="mt-2 text-[11px] text-destructive" role="alert">{referenceUploadError}</p>}

        {uploadedReferences.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {uploadedReferences.map((url: string, index: number) => (
              <div key={`${url.slice(0, 32)}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`参考图片 ${index + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setUploadedReferences((current: string[]) => current.filter((item: string) => item !== url))}
                  aria-label={`移除参考图片 ${index + 1}`}
                  className="absolute right-1 top-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-background/85 text-foreground opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-3 rounded-2xl border border-border bg-muted/40 p-4">
        <div className="flex items-center gap-2">
          {recommendation.route === '视频导演' ? <Film className="h-4 w-4 text-primary" aria-hidden="true" /> : recommendation.route === '3D 创作' ? <Box className="h-4 w-4 text-primary" aria-hidden="true" /> : <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />}
          <h3 className="text-xs font-semibold text-foreground">系统已理解</h3>
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">自动匹配，可调整</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div><dt className="text-muted-foreground">识别目标</dt><dd className="mt-0.5 truncate text-foreground">{recommendation.intent}</dd></div>
          <div><dt className="text-muted-foreground">执行能力</dt><dd className="mt-0.5 text-foreground">{recommendation.route}</dd></div>
        </dl>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="block text-[10px] text-muted-foreground">
            画面比例
            <select value={recommendation.aspectRatio} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setAspectRatioOverride(event.target.value as QuickCreateAspectRatio)} className={`mt-1 ${selectClassName}`}>
              {ASPECT_RATIO_OPTIONS.map((ratio: string) => <option key={ratio} value={ratio}>{ratio}</option>)}
            </select>
          </label>
          <label className="block text-[10px] text-muted-foreground">
            生成数量
            <select value={recommendation.outputCount} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setOutputCountOverride(Number(event.target.value))} className={`mt-1 ${selectClassName}`}>
              {[1, 2, 3, 4].map((count: number) => <option key={count} value={count}>{count} 张</option>)}
            </select>
          </label>
          <label className="block text-[10px] text-muted-foreground">
            输出质量
            <select value={recommendation.quality} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setQualityOverride(event.target.value as QuickCreateQuality)} className={`mt-1 ${selectClassName}`}>
              {QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          {inferredParameters.ratioReason} · {inferredParameters.countReason} · {inferredParameters.qualityReason}
        </p>

        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            aria-expanded={showAdvancedModels}
            onClick={() => setShowAdvancedModels((value: boolean) => !value)}
            className="flex min-h-10 w-full cursor-pointer items-center justify-between rounded-lg px-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Settings2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              高级模型设置
            </span>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showAdvancedModels ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>

          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-border bg-background p-3">
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">图像模型</p>
              <p className="mt-1 truncate text-xs font-medium text-foreground">{getModelDisplayName(effectiveImageModel)}</p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {effectiveImageModel.model?.providerName || '等待管理员配置'} · {getModelSourceLabel(effectiveImageModel.source)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">LLM 路由</p>
              <p className="mt-1 truncate text-xs font-medium text-foreground">{getModelDisplayName(effectiveChatModel)}</p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {effectiveChatModel.model?.providerName || '当前任务不一定调用'} · {getModelSourceLabel(effectiveChatModel.source)}
              </p>
            </div>
          </div>

          {showAdvancedModels && (
            <div className="mt-2 grid gap-3 rounded-xl border border-border bg-background p-3">
              <label className="block text-[10px] text-muted-foreground">
                本次任务图像模型
                <select
                  value={imageModelOverride}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setImageModelOverride(event.target.value)}
                  disabled={modelsLoading || imageModels.length === 0}
                  className={`mt-1 ${selectClassName} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <option value="">系统智能匹配</option>
                  {imageModels.map((model: QuickCreateModelCandidate) => (
                    <option key={model.id} value={model.id}>{model.name || model.modelId} · {model.providerName || model.providerId}</option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] text-muted-foreground">
                本次任务 LLM
                <select
                  value={chatModelOverride}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setChatModelOverride(event.target.value)}
                  disabled={modelsLoading || chatModels.length === 0}
                  className={`mt-1 ${selectClassName} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <option value="">系统智能匹配</option>
                  {chatModels.map((model: QuickCreateModelCandidate) => (
                    <option key={model.id} value={model.id}>{model.name || model.modelId} · {model.providerName || model.providerId}</option>
                  ))}
                </select>
              </label>
              <p className="text-[10px] leading-4 text-muted-foreground">覆盖只作用于本次快速创作，不会修改管理员默认、专业创作最近选择或 AI 聊天当前模型。</p>
            </div>
          )}

          {modelsLoading && <p className="mt-2 text-[11px] text-muted-foreground">正在读取当前账号可用模型…</p>}
          {modelsError && <p className="mt-2 text-[11px] text-destructive" role="alert">{modelsError}</p>}
          {imageModelUnavailable && !modelsLoading && (
            <p className="mt-2 text-[11px] leading-4 text-destructive" role="alert">当前账号没有可用的图像模型，请联系管理员启用模型、配置服务端凭证并分配权限。</p>
          )}
        </div>
      </section>

      {(compileState.isCompiling || compileState.result || compileState.error) && (
        <section
          className={`mt-3 rounded-2xl border p-4 ${compileState.error ? 'border-destructive/30 bg-destructive/5' : 'border-primary/25 bg-primary/5'}`}
          aria-live="polite"
          aria-busy={compileState.isCompiling}
        >
          <div className="flex items-start gap-2.5">
            {compileState.isCompiling ? (
              <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
            ) : compileState.error ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                 <h3 className="text-xs font-semibold text-foreground">
                   {compileState.error ? '专业方案编译失败' : isFallbackPlan ? '已按原始需求提交' : compileState.result ? '专业创作方案已就绪' : '正在编译专业创作方案'}
                 </h3>
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${compileState.error ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                  {getCompilePhaseLabel(compileState.phase)}
                </span>
              </div>
               {compileState.statusMessage && !compileState.error && (
                 <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{compileState.statusMessage}</p>
               )}
               {isFallbackPlan && (
                 <p className="mt-1 text-[11px] leading-5 text-amber-600 dark:text-amber-300">专业提示词编译暂不可用，已按原始需求提交图像生成。</p>
               )}
              {compileState.error && (
                <p className="mt-1 text-[11px] leading-5 text-destructive" role="alert">{compileState.error}</p>
              )}
            </div>
          </div>

          {compileState.isCompiling && compileState.streamText && (
            <div className="mt-3 max-h-28 overflow-y-auto rounded-xl border border-border bg-background p-3">
              <p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">{compileState.streamText}</p>
            </div>
          )}

          {compileState.result && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { void copyText(formatCompileResult(compileState.result as QuickCreateCompileResult), 'full'); }}
                  className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {copiedContent === 'full' ? '方案已复制' : '复制完整方案'}
                </button>
                <button
                  type="button"
                  onClick={() => { void copyText(compileState.result?.positivePrompt ?? '', 'positive'); }}
                  className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {copiedContent === 'positive' ? '正向提示词已复制' : '复制正向提示词'}
                </button>
                <button
                  type="button"
                  onClick={() => { void copyText(compileState.result?.negativePrompt ?? '', 'negative'); }}
                  className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {copiedContent === 'negative' ? '负向提示词已复制' : '复制负向提示词'}
                </button>
              </div>
              <div className="rounded-xl border border-border bg-background p-3">
                <p className="text-[10px] font-medium text-muted-foreground">创作摘要</p>
                <p className="mt-1 text-xs leading-5 text-foreground">{compileState.result.summary}</p>
              </div>
              <div className="rounded-xl border border-border bg-background p-3">
                <p className="text-[10px] font-medium text-muted-foreground">创作策略</p>
                <p className="mt-1 text-xs leading-5 text-foreground">{compileState.result.strategy}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground">创意方向</p>
                <div className="mt-2 grid gap-2">
                  {compileState.result.directions.map((direction) => (
                    <article key={`${direction.title}-${direction.description}`} className="rounded-xl border border-border bg-background p-3">
                      <h4 className="text-xs font-semibold text-foreground">{direction.title}</h4>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{direction.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {direction.visualKeywords.map((keyword: string) => (
                          <span key={keyword} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{keyword}</span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-background p-3 text-[10px]">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">实际 LLM</dt>
                  <dd className="mt-1 truncate text-xs font-medium text-foreground">{compileState.result.model}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground">服务提供方</dt>
                  <dd className="mt-1 truncate text-xs font-medium text-foreground">{compileState.result.providerName}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground">路由来源</dt>
                  <dd className="mt-1 text-xs font-medium text-foreground">{getCompileModelSourceLabel(compileState.result.modelSource)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground">输出规格</dt>
                  <dd className="mt-1 text-xs font-medium text-foreground">{compileState.result.aspectRatio} · {compileState.result.outputCount} 张 · {compileState.result.quality === 'high' ? '高清' : '标准'}</dd>
                </div>
              </dl>
            </div>
          )}
        </section>
      )}

      {submitted && (
        <section className="mt-3 rounded-2xl border border-primary/25 bg-primary/10 p-4" aria-live="polite">
          <h3 className="text-xs font-semibold text-foreground">任务已提交，接下来可以</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => onOpenProfessional(prompt)} className="min-h-9 cursor-pointer rounded-lg bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted">生成同系列</button>
            <button type="button" onClick={() => onOpenChat(`请基于刚才的创作继续优化：${prompt}`)} className="min-h-9 cursor-pointer rounded-lg bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted">继续优化</button>
            <button type="button" onClick={() => onOpenVideo(prompt)} className="min-h-9 cursor-pointer rounded-lg bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted">生成视频</button>
          </div>
        </section>
      )}

      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!prompt.trim() || compileState.isCompiling || isSubmitting || isUploadingReferences || modelsLoading || imageModelUnavailable}
          className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-card transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {compileState.isCompiling || isSubmitting ? '正在编译专业方案' : recommendation.route === '视频导演' ? '打开视频创作' : recommendation.route === 'AI 助手' || recommendation.route === '智能图片编辑' || recommendation.route === '3D 创作' ? '交给 AI 助手' : `生成 ${recommendation.outputCount} 张`}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">系统会先自动理解参数，你也可以调整或进入专业模式</p>
      </div>
    </div>
  );
}
