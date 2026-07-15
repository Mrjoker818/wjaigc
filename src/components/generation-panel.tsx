'use client';

import NextImage from 'next/image';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Upload, X, Plus, Cpu, GitMerge, GripHorizontal, Zap, FileText } from 'lucide-react';
import { } from 'sonner';
import { UniversalApiManager } from '@/lib/universal-api-manager';
import { ApiProvider } from '@/lib/universal-api-types';
import { } from '@/lib/user-manager';
import { ThirdPartyModelDialog } from '@/components/third-party-model-dialog';
import { getModelDisplayName } from '@/lib/model-name-map';
import { getPromptTemplates, PromptTemplate, searchTemplates } from '@/lib/prompt-templates';
import { QUALITY_TO_SIZE as SHARED_QUALITY_TO_SIZE, ASPECT_RATIO_TO_PIXELS as SHARED_ASPECT_RATIO_TO_PIXELS, findModelConfig as sharedFindModelConfig, calculateActualPixels as sharedCalculateActualPixels, getModelParamType, getResolutionTierOptions, getQualityLevelOptions, getProviderAspectRatios, getProviderPixelSizingOption, RESOLUTION_TIER_DISPLAY_NAMES, QUALITY_LEVEL_DISPLAY_NAMES } from '@/lib/canvas-generation-group';

export interface GenerationParams {
    prompt: string;
    size: string;
    referenceImages: string[];
    referenceDescriptions?: string[]; // per-image descriptions for better subject recognition
    referenceMode: 'style' | 'content' | 'fusion';
    imageCategory: string;
    productCategory?: string;
    aspectRatio: string;
    stylePreset: string;
    outputCount: number;
    model: string;
    providerId?: string;  // 服务端API提供商ID，从复合键 providerId::modelId 中拆解
    quality?: string;
    resolution?: string; // GPT-Image系列分辨率档位参数（1K/2K/4K）
    apiKey?: string;
    estimatedTime?: number;
    universalBaseUrl?: string;
    universalApiKey?: string;
    referenceCategories?: Record<number, string[]>; // per-image selected categories
    referenceStrengths?: number[];
    altRefImageUrls?: string[]; // Alt+Click marked reference image URLs
}

export interface CtrlRefSelection {
    id: string;
    url: string;
    number: number;
    keyword?: string;
}

export interface AltRefMarker {
    id: string;
    url: string;
    number: number;
}

interface GenerationPanelProps {
    onGenerate: (params: GenerationParams) => void;
    onAnalyzeImage?: (imageData: string) => Promise<string>;
    onAddToCanvas?: (imageUrl: string) => void;
    onExtractPrompt?: (imageUrl: string) => Promise<string>;
    onUpdatePrompt?: (prompt: string) => string;
    externalPrompt?: string;
    onExternalPromptConsumed?: () => void;
    onError?: (error: string) => void;
    themeStyle?: 'gold' | 'monochrome';
    ctrlRefSelections?: CtrlRefSelection[];
    altRefMarkers?: AltRefMarker[];
    onRemoveAltRefMarker?: (id: string) => void;
    onRemoveCtrlRef?: (id: string) => void;
    onUpdateCtrlRefKeyword?: (id: string, keyword: string) => void;
    onFusionGenerate?: (refs: CtrlRefSelection[], fusionPrompt: string) => void;
    onModelChange?: (model: string) => void;
    externalReferenceImage?: { url: string; description?: string } | null;
    onExternalReferenceImageConsumed?: () => void;
    onOpenPromptEquation?: () => void;
    applyFavoriteParams?: { prompt?: string; model?: string; aspectRatio?: string; quality?: string; negativePrompt?: string } | null;
    onFavoriteParamsApplied?: () => void;
    /** 当前画布选中的图片URL，用于图生图等 */
    selectedImageUrl?: string | null;
}

// 产品品类
const PRODUCT_CATEGORIES = [
    { value: 'none', label: '通用' },
    { value: 'baijiu', label: '白酒' },
    { value: 'yangjiu', label: '洋酒' },
    { value: 'hongjiu', label: '红酒' },
    { value: 'pijiu', label: '啤酒' },
    { value: 'baojianjiu', label: '保健酒' }
];

// 设计类型
const DESIGN_TYPES = [
    { value: 'none', label: '通用' },
    { value: 'poster', label: '海报' },
    { value: 'logo', label: 'LOGO' },
    { value: 'packaging', label: '包装设计' },
    { value: 'detail-page', label: '详情页' },
    { value: 'display', label: '美陈' },
    { value: 'ip-character', label: 'IP形象' }
];

// 通用快速风格标签
const COMMON_QUICK_TAGS = ["4K高清", "高质量", "精美", "电影级光线", "鲜艳色彩", "自然", "人像", "风景", "抽象", "极简", "复古", "霓虹", "赛博朋克", "动漫风格", "水彩", "油画"];

// 根据设计类型动态生成的快速风格标签
const DESIGN_TYPE_TAGS: Record<string, string[]> = {
    'none': [],
    'poster': ["视觉冲击", "大标题排版", "图文混排", "渐变背景", "创意合成", "商业海报", "活动宣传", "电影海报", "音乐节", "品牌推广"],
    'logo': ["矢量风格", "扁平化", "线条感", "几何构成", "品牌标识", "字体图形化", "极简符号", "负空间", "渐变色彩", "徽章风格"],
    'packaging': ["产品展示", "材质质感", "盒型结构", "瓶贴设计", "标签排版", "开窗展示", "高端礼盒", "环保材质", "货架陈列", "系列包装"],
    'detail-page': ["电商排版", "卖点提炼", "场景化展示", "信息层级", "促销氛围", "对比展示", "功效图解", "用户评价", "长图设计", "移动端适配"],
    'display': ["空间场景", "橱窗陈列", "道具设计", "灯光氛围", "品牌体验", "互动装置", "节日主题", "材质搭配", "视觉动线", "沉浸式体验"],
    'ip-character': ["角色设计", "表情包", "IP衍生", "Q版造型", "拟人化", "吉祥物", "动作姿势", "三视图", "潮玩设计", "故事场景"]
};

// 根据产品品类的快速风格标签
const PRODUCT_CATEGORY_TAGS: Record<string, string[]> = {
    'none': [],
    'baijiu': ["酱香型", "浓香型", "清香型", "窖藏", "纯粮酿造", "传统工艺", "年份原浆", "国宴级", "礼品装", "非遗工艺"],
    'yangjiu': ["威士忌", "白兰地", "伏特加", "朗姆酒", "鸡尾酒", "橡木桶陈酿", "单一麦芽", "调酒场景", "冰镇质感", "英伦绅士"],
    'hongjiu': ["波尔多", "勃艮第", "赤霞珠", "黑皮诺", "橡木桶", "醒酒器", "酒庄风景", "葡萄园", "品鉴场景", "酒红色调"],
    'pijiu': ["精酿啤酒", "麦芽香", "啤酒花", "冰爽感", "泡沫质感", "瓶身设计", "派对氛围", "运动畅饮", "夏日清凉", "聚会场景"],
    'baojianjiu': ["养生概念", "药食同源", "传统配方", "滋补功效", "中药材", "保健认证", "礼盒装", "老年关怀", "养生文化", "天然萃取"]
};

// 风格预设 - 根据设计类型动态生成
const BASE_STYLE_PRESETS = [
    { value: 'auto', label: '自动' },
    { value: 'photorealistic', label: '写实摄影' },
    { value: 'digital-art', label: '数字艺术' },
    { value: 'anime', label: '动漫风格' },
    { value: '3d-render', label: '3D渲染' },
    { value: 'oil-painting', label: '油画风格' },
    { value: 'watercolor', label: '水彩风格' },
    { value: 'sketch', label: '素描风格' },
    { value: 'pixel-art', label: '像素艺术' },
    { value: 'minimalist', label: '极简风格' },
    { value: 'vintage', label: '复古风格' },
    { value: 'cyberpunk', label: '赛博朋克' }
];

// 新增风格预设
const EXTRA_STYLE_PRESETS: Record<string, Array<{ value: string; label: string }>> = {
    'none': [],
    'poster': [
        { value: 'neo-chinese', label: '新中式' },
        { value: 'guochao', label: '国潮国风' },
        { value: 'minimalist-luxury', label: '极简轻奢风' },
        { value: 'retro-nostalgia', label: '复古怀旧风' },
        { value: 'cyberpunk-neon', label: '赛博霓虹' },
        { value: 'creative-composite', label: '创意合成' },
        { value: 'big-typo', label: '大字排版' },
        { value: 'japanese-minimal', label: '日系极简' },
        { value: 'pop-art', label: '波普艺术' },
        { value: 'ink-wash', label: '水墨意境' }
    ],
    'logo': [
        { value: 'neo-chinese', label: '新中式' },
        { value: 'flat-design', label: '扁平化' },
        { value: 'geometric', label: '几何构成' },
        { value: 'lettermark', label: '字母标志' },
        { value: 'minimalist-luxury', label: '极简轻奢风' },
        { value: 'retro-badge', label: '复古徽章' },
        { value: 'gradient-mesh', label: '渐变网格' },
        { value: 'line-art', label: '线条艺术' },
        { value: 'japanese-minimal', label: '日系极简' },
        { value: 'guochao', label: '国潮国风' }
    ],
    'packaging': [
        { value: 'neo-chinese', label: '新中式' },
        { value: 'guochao', label: '国潮国风' },
        { value: 'minimalist-luxury', label: '极简轻奢风' },
        { value: 'foil-stamping', label: '烫金工艺' },
        { value: 'japanese-minimal', label: '日系极简' },
        { value: 'internet-famous', label: '网红风' },
        { value: 'european-gentleman', label: '欧式绅士' },
        { value: 'material-craft', label: '材质工艺' },
        { value: 'folk-regional', label: '民俗地域' },
        { value: 'retro-nostalgia', label: '复古怀旧风' }
    ],
    'detail-page': [
        { value: 'internet-famous', label: '网红风' },
        { value: 'minimalist-luxury', label: '极简轻奢风' },
        { value: 'light-luxury', label: '轻奢高端' },
        { value: 'japanese-minimal', label: '日系极简' },
        { value: 'neo-chinese', label: '新中式' },
        { value: 'guochao', label: '国潮国风' },
        { value: 'promo-atmosphere', label: '促销氛围' },
        { value: 'fresh-natural', label: '清新自然' },
        { value: 'tech-futuristic', label: '科技未来' },
        { value: 'retro-nostalgia', label: '复古怀旧风' }
    ],
    'display': [
        { value: 'neo-chinese', label: '新中式' },
        { value: 'guochao', label: '国潮国风' },
        { value: 'light-luxury', label: '轻奢高端' },
        { value: 'window-lighting', label: '橱窗灯光' },
        { value: 'european-gentleman', label: '欧式绅士' },
        { value: 'pastoral', label: '田园森系' },
        { value: 'cyberpunk-neon', label: '赛博霓虹' },
        { value: 'folk-regional', label: '民俗地域' },
        { value: 'festival-carnival', label: '节日狂欢' },
        { value: 'immersive', label: '沉浸体验' }
    ],
    'ip-character': [
        { value: 'guochao', label: '国潮国风' },
        { value: 'neo-chinese', label: '新中式' },
        { value: 'q-chibi', label: 'Q版萌系' },
        { value: 'cyberpunk-neon', label: '赛博朋克' },
        { value: 'japanese-anime', label: '日系动漫' },
        { value: 'retro-nostalgia', label: '复古怀旧风' },
        { value: 'trendy-art', label: '潮流艺术' },
        { value: 'folk-regional', label: '民俗地域' },
        { value: 'kawaii', label: '可爱卡哇伊' },
        { value: 'mecha', label: '机甲风格' }
    ]
};

// 获取当前可用的风格预设列表
// 通用设计类型：展示通用画面效果风格（写实摄影、油画等）
// 具体设计类型：只展示该类型专属的风格预设，避免通用画面风格干扰设计决策
const getStylePresets = (designType: string) => {
    if (designType === 'none') {
        return BASE_STYLE_PRESETS;
    }
    const extras = EXTRA_STYLE_PRESETS[designType] || [];
    return [{ value: 'auto', label: '自动' }, ...extras];
};

// 获取当前可用的快速风格标签
const getQuickTags = (category: string, designType: string): string[] => {
    const categoryTags = PRODUCT_CATEGORY_TAGS[category] || [];
    const designTags = DESIGN_TYPE_TAGS[designType] || [];
    return [...COMMON_QUICK_TAGS, ...categoryTags, ...designTags];
};

// 使用共享的质量尺寸映射
const QUALITY_TO_SIZE = SHARED_QUALITY_TO_SIZE;

// 模型列表仅从管理员/用户配置的服务器端加载，无内置默认模型

// 风格预设现在通过 getStylePresets(designType) 动态获取

// 使用共享的模糊匹配函数
const findModelConfig = sharedFindModelConfig;

function get3DModelLabel(modelId: string): string {
    const m = modelId.toLowerCase();
    if (m.includes('hunyuan') || m.includes('混元')) {
        if (m.includes('lite') || m.includes('quick')) return '极速版';
        if (m.includes('pro') || m.includes('standard')) return '专业版';
    }
    if (m.includes('lite') || m.includes('quick')) return '极速版';
    if (m.includes('pro') || m.includes('professional') || m.includes('standard')) return '专业版';
    return modelId;
}

export function GenerationPanel(
    { onGenerate, onAddToCanvas, themeStyle = 'gold', externalPrompt, onExternalPromptConsumed, ctrlRefSelections = [], altRefMarkers = [], onRemoveAltRefMarker, onRemoveCtrlRef, onUpdateCtrlRefKeyword, onFusionGenerate, onModelChange, externalReferenceImage, onExternalReferenceImageConsumed, onOpenPromptEquation, applyFavoriteParams, onFavoriteParamsApplied }: GenerationPanelProps
) {
    const [prompt, setPrompt] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [externalPromptApplied, setExternalPromptApplied] = useState(false);
    const [externalRefImgApplied, setExternalRefImgApplied] = useState(false);
    const [fusionPrompt, setFusionPrompt] = useState("");

    // Prompt template popup state
    const [showTemplatePopup, setShowTemplatePopup] = useState(false);
    const [templateSearchQuery, setTemplateSearchQuery] = useState('');
    const [filteredTemplates, setFilteredTemplates] = useState<PromptTemplate[]>([]);
    const [selectedTemplateIndex, setSelectedTemplateIndex] = useState(0);
    const [hoveredTemplateId, setHoveredTemplateId] = useState<string | null>(null);
    const [thumbnailRect, setThumbnailRect] = useState<DOMRect | null>(null);
    const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
    useRef<HTMLDivElement>(null);
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [referenceDescriptions, setReferenceDescriptions] = useState<string[]>([]);
    const [referenceSelectedCategories, setReferenceSelectedCategories] = useState<Record<number, Set<string>>>({});
    const [referenceStrengths, setReferenceStrengths] = useState<number[]>([]);
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [quality, setQuality] = useState("auto");
    const [resolution, setResolution] = useState("2K");
    const [outputCount, setOutputCount] = useState(1);
    const [stylePreset, setStylePreset] = useState("auto");
    const [productCategory, setProductCategory] = useState("none");
    const [designType, setDesignType] = useState("none");
    const [model, setModel] = useState("");
    const [discoveredModels, setDiscoveredModels] = useState<{id: string, providerId: string, providerName: string, is3DProvider?: boolean, displayLabel?: string, apiDisplayName?: string}[]>([]);

    // Sync external prompt from chat-panel prompt optimizer
    useEffect(() => {
        if (externalPrompt && !externalPromptApplied) {
            setPrompt(externalPrompt);
            setExternalPromptApplied(true);
            onExternalPromptConsumed?.();
        }
        if (!externalPrompt) {
            setExternalPromptApplied(false);
        }
    }, [externalPrompt, externalPromptApplied, onExternalPromptConsumed]);

    // Apply favorite params (prompt, model, aspectRatio, quality)
    useEffect(() => {
        if (applyFavoriteParams) {
            if (applyFavoriteParams.prompt) setPrompt(applyFavoriteParams.prompt);
            if (applyFavoriteParams.model) {
                // ★ 修复：当传入纯 modelId 时，尝试解析为复合键（providerId::modelId）
                let resolvedModel = applyFavoriteParams.model;
                if (!resolvedModel.includes('::')) {
                  // 从 discoveredModels 查找匹配的复合键
                  const matched = discoveredModels.find(m => m.id === resolvedModel);
                  if (matched?.providerId) {
                    resolvedModel = `${matched.providerId}::${matched.id}`;
                  } else {
                    // 从 localStorage 读取当前选择的提供商
                    try {
                      const wsmStr = localStorage.getItem('wujie_selected_model');
                      if (wsmStr) {
                        const wsm = JSON.parse(wsmStr);
                        if (wsm.providerId && wsm.model === resolvedModel) {
                          resolvedModel = `${wsm.providerId}::${wsm.model}`;
                        }
                      }
                    } catch {}
                  }
                }
                setModel(resolvedModel);
                onModelChange?.(resolvedModel.includes('::') ? resolvedModel.split('::').pop()! : resolvedModel);
            }
            if (applyFavoriteParams.aspectRatio) setAspectRatio(applyFavoriteParams.aspectRatio);
            if (applyFavoriteParams.quality) setQuality(applyFavoriteParams.quality);
            // negativePrompt is stored in CanvasImage but not directly applicable
            // in generation panel (used in img2img panel). It's included in the
            // data for future use and for the "copy keywords" feature.
            onFavoriteParamsApplied?.();
        }
    }, [applyFavoriteParams, discoveredModels, onFavoriteParamsApplied, onModelChange]);

    // Sync external reference image from canvas right-click "发送参考图"
    useEffect(() => {
        if (externalReferenceImage && !externalRefImgApplied) {
            const refUrl = typeof externalReferenceImage === 'string' ? externalReferenceImage : externalReferenceImage.url;
            const refDesc = typeof externalReferenceImage === 'string' ? '' : (externalReferenceImage.description || '');
            setReferenceImages(prev => {
                if (prev.includes(refUrl)) return prev;
                const next = [...prev, refUrl];
                // Also add description at the same index
                setReferenceDescriptions(prevDesc => {
                    const newDesc = [...prevDesc];
                    while (newDesc.length < next.length - 1) newDesc.push('');
                    newDesc.push(refDesc);
                    return newDesc;
                });
                return next;
            });
            setExternalRefImgApplied(true);
            onExternalReferenceImageConsumed?.();
        }
        if (!externalReferenceImage) {
            setExternalRefImgApplied(false);
        }
    }, [externalReferenceImage, externalRefImgApplied, onExternalReferenceImageConsumed]);
    const MAX_REF_IMAGES = 10;

    // Reference category labels
    const REF_CATEGORIES = [
        { key: 'style', label: '风格' },
        { key: 'composition', label: '构图' },
        { key: 'scene', label: '场景' },
        { key: 'color', label: '色彩' },
        { key: 'subject', label: '主体' },
        { key: 'detail', label: '细节' },
    ];
    // Reference panel: max 2 categories per image
    const MAX_REF_CATEGORIES = 2;
    const [showThirdPartyDialog, setShowThirdPartyDialog] = useState(false);
    const [thirdPartyDefaultType, setThirdPartyDefaultType] = useState<'image' | 'chat'>('image');
    const [, ] = useState('');
    const [, ] = useState('');
    const [, ] = useState('');
    const [, ] = useState(false);
    const [universalProviders, setUniversalProviders] = useState<ApiProvider[]>([]);
    const [universalApiManager, setUniversalApiManager] = useState<UniversalApiManager | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Track which slot triggered the upload
    const [uploadSlotIndex, setUploadSlotIndex] = useState<number>(-1);
    // Draggable prompt textarea height
    const [promptHeight, setPromptHeight] = useState(72); // default ~3 rows
    const promptDragRef = useRef<{ startY: number; startH: number } | null>(null);

    // 初始化万能API管理器（仅客户端）
    useEffect(() => {
        if (typeof window !== 'undefined') {
            setUniversalApiManager(UniversalApiManager.getInstance());
        }
    }, []);

    // 模型切换时自动重置分辨率/质量/比例默认值（后缀驱动动态识别）
    useEffect(() => {
        if (!model) return;
        const pureModelId = model.includes('::') ? model.split('::').pop()! : model;
        if (!pureModelId) return;

        const lower = pureModelId.toLowerCase();
        getModelParamType(pureModelId);
        const resolutionTiers = getResolutionTierOptions(pureModelId);
        const qualityLevels = getQualityLevelOptions(pureModelId);

        // 分辨率默认值：优先按后缀推断
        let defaultResolution = resolutionTiers[0] || '2K';
        if (lower.includes('-4k') || lower.includes('-4k-omni')) {
            if (resolutionTiers.includes('4K')) defaultResolution = '4K';
        } else if (lower.includes('-2k') || lower.includes('-2k-omni') || lower.includes('-hd')) {
            if (resolutionTiers.includes('2K')) defaultResolution = '2K';
        }
        setResolution(defaultResolution);

        // 质量默认值：优先按后缀推断
        let defaultQuality = qualityLevels[0] || 'auto';
        if (lower.includes('-4k') || lower.includes('-2k')) {
            defaultQuality = qualityLevels.includes('high') ? 'high' : defaultQuality;
        } else if (lower.includes('-hd') || lower.includes('-high')) {
            defaultQuality = qualityLevels.includes('high') ? 'high' : defaultQuality;
        }
        setQuality(defaultQuality);

        // 画面比例：重置为新模型支持的首个比例
        const providerId = model.includes('::') ? model.split('::')[0] : '';
        const providerName = discoveredModels.find(item => item.id === pureModelId && item.providerId === providerId)?.providerName || '';
        const supportedRatios = getProviderAspectRatios(pureModelId, `${providerId} ${providerName}`);
        if (supportedRatios.length > 0 && !supportedRatios.includes(aspectRatio)) {
            setAspectRatio(supportedRatios[0]);
        }
    }, [model, discoveredModels]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load initial model selection from localStorage
    const [pendingModelMigration, setPendingModelMigration] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window !== 'undefined' && !model) {
            try {
                const currentUserId = localStorage.getItem('unbounded_ai_current_user');
                if (currentUserId) {
                    const stored = localStorage.getItem('unbounded_ai_user_data');
                    if (stored) {
                        const data = JSON.parse(stored);
                        const saved = data?.userData?.[currentUserId]?.selectedModel;
                        if (saved) {
                            if (!saved.includes('::')) {
                                // 旧版纯 modelId，需等 discoveredModels 加载后迁移为复合键
                                setPendingModelMigration(saved);
                            } else {
                                setModel(saved);
                                // 同步写入 wujie_selected_model
                                try {
                                    const pureId = saved.includes('::') ? saved.split('::').pop()! : saved;
                                    const providerId = saved.includes('::') ? saved.split('::')[0] : '';
                                    const dm = discoveredModels.find(m => m.id === pureId && m.providerId === providerId);
                                    localStorage.setItem('wujie_selected_model', JSON.stringify({
                                        model: pureId,
                                        providerId: providerId,
                                        compositeKey: saved,
                                        apiDisplayName: dm?.apiDisplayName || dm?.displayLabel || '',
                                        providerName: dm?.providerName || '',
                                        quality: quality,
                                        aspectRatio: aspectRatio,
                                    }));
                                } catch {}
                            }
                        }
                    }
                }
            } catch {}
        }
    }, [aspectRatio, discoveredModels, model, quality]);

    // 通知父组件当前模型变化（API Key由服务端管理，无需传递）
    // 传递纯 modelId（从复合键 providerId::modelId 中拆解）
    useEffect(() => {
        const pureModelId = model ? (model.includes('::') ? model.split('::').pop()! : model) : '';
        onModelChange?.(pureModelId);
    }, [model, onModelChange]);

    // 获取当前模型支持的比例
    const pureModelId = model ? (model.includes('::') ? model.split('::').pop()! : model) : '';
    const selectedProviderId = model.includes('::') ? model.split('::')[0] : '';
    const selectedProviderName = discoveredModels.find(item => item.id === pureModelId && item.providerId === selectedProviderId)?.providerName || '';
    const selectedProviderHint = `${selectedProviderId} ${selectedProviderName}`;
    const getSupportedAspectRatios = useCallback(() => {
        return getProviderAspectRatios(pureModelId, selectedProviderHint);
    }, [pureModelId, selectedProviderHint]);

    // 获取当前模型支持的质量
    useCallback(() => {
            const paramType = getModelParamType(pureModelId);
            if (paramType === 'quality') {
                return getQualityLevelOptions(pureModelId);
            }
            // 'resolution' or 'both': return resolution tier options
            return getResolutionTierOptions(pureModelId);
        }, [pureModelId]);

    // 尺寸映射 — 使用 calculateActualPixels 综合考虑模型+比例+质量
    const getModelSize = useCallback((ratio: string): string => {
        const sizingOption = getProviderPixelSizingOption(selectedProviderHint, quality, resolution);
        const modelSize = sharedCalculateActualPixels(ratio, sizingOption, pureModelId);
        if (modelSize) return modelSize.replace('×', 'x');
        // 通用回退
        if (SHARED_ASPECT_RATIO_TO_PIXELS[ratio]) return SHARED_ASPECT_RATIO_TO_PIXELS[ratio];
        const fallback: Record<string, string> = {
            "1:1": "1024x1024", "4:3": "1536x1024", "3:4": "1024x1536",
            "16:9": "2048x1152", "9:16": "1152x2048", "3:2": "1536x1024",
            "2:3": "1024x1536", "21:9": "2048x878", "9:21": "878x2048",
        };
        return fallback[ratio] || "1024x1024";
    }, [quality, resolution, pureModelId, selectedProviderHint]);

    // 质量对应的尺寸提示 — 显示该质量+当前比例的实际像素
    useCallback((q: string): string => {
            const actualSize = sharedCalculateActualPixels(aspectRatio, q, pureModelId);
            if (actualSize) return actualSize.replace('×', 'x');
            const qMap = findModelConfig(QUALITY_TO_SIZE, pureModelId);
            if (qMap && qMap[q]) return qMap[q];
            return q;
        }, [aspectRatio, pureModelId]);

    // 生成
    const handleGenerate = () => {
        if (!prompt.trim() && selectedTags.length === 0 && altRefMarkers.length === 0) return;
        
        // Build alt reference marker prefix
        let altRefPrefix = '';
        if (altRefMarkers.length > 0) {
            altRefPrefix = altRefMarkers.map(m => `[参考图R${m.number}]`).join(' ') + ' ';
        }
        
        // Resolve #N reference anchors in prompt (e.g., #1 → [参考图1: description])
        let resolvedPrompt = altRefPrefix + prompt.trim();
        if (referenceImages.length > 0) {
            resolvedPrompt = resolvedPrompt.replace(/#(\d+)/g, (_match, numStr) => {
                const num = parseInt(numStr, 10);
                if (num >= 1 && num <= referenceImages.length) {
                    const desc = referenceDescriptions[num - 1]?.trim();
                    return desc ? `[参考图${num}: ${desc}]` : `[参考图${num}]`;
                }
                return _match; // keep original if out of range
            });
        }
        
        const fullPrompt = [resolvedPrompt, ...selectedTags].filter(Boolean).join(", ");
        
        // Check if model is from a universal provider
        const universalModel = discoveredModels.find(m => m.id === model);
        
        // 从复合键 providerId::modelId 中拆解出纯 modelId 和 providerId
        const pureModelId = model.includes('::') ? model.split('::').pop()! : model;
        let compositeProviderId = model.includes('::') ? model.split('::')[0] : undefined;
        
        // ★ 修复：当 model 不含 :: 时（如 applyFavoriteParams 传入的纯 modelId），
        // 尝试从 localStorage 或 discoveredModels 回填 providerId，避免多提供商同名模型选错
        if (!compositeProviderId && pureModelId) {
          // 1. 优先从 localStorage wujie_selected_model 读取
          try {
            const wsmStr = localStorage.getItem('wujie_selected_model');
            if (wsmStr) {
              const wsm = JSON.parse(wsmStr);
              if (wsm.providerId && wsm.model === pureModelId) {
                compositeProviderId = wsm.providerId;
              }
            }
          } catch {}
          // 2. 如果 localStorage 没有，从 discoveredModels 查找第一个匹配的提供商
          if (!compositeProviderId) {
            const matchedModel = discoveredModels.find(m => m.id === pureModelId);
            if (matchedModel?.providerId) {
              compositeProviderId = matchedModel.providerId;
            }
          }
        }
        
        // ★ 调试日志：确认前端传递的 providerId
        console.log('[generation-panel] 提交生成请求:', { model, pureModelId, compositeProviderId, hasProviderId: !!compositeProviderId });
        
        onGenerate({
            prompt: fullPrompt,
            size: getModelSize(aspectRatio) || "1024x1024",
            referenceImages,
            referenceDescriptions,
            referenceMode: 'style',
            imageCategory: 'general',
            productCategory: productCategory !== 'none' ? productCategory : undefined,
            aspectRatio,
            stylePreset,
            outputCount,
            quality,
            resolution: getModelParamType(pureModelId) === 'both' ? resolution : undefined, // GPT-Image系列分辨率档位
            model: pureModelId,
            providerId: compositeProviderId,
            referenceCategories: Object.fromEntries(
                Object.entries(referenceSelectedCategories).map(([k, v]) => [k, Array.from(v)])
            ),
            referenceStrengths,
            // Pass universal provider info if applicable
            ...(universalModel ? {
                universalBaseUrl: universalProviders.find(p => p.id === universalModel.providerId)?.baseUrl,
                universalApiKey: universalProviders.find(p => p.id === universalModel.providerId)?.apiKey,
            } : {}),
            // Pass alt reference marker image URLs for image-to-image models
            altRefImageUrls: altRefMarkers.map(m => m.url),
        });
    };

    // 监听自定义生成事件
    const handleGenerateRef = useRef(handleGenerate);
    useEffect(() => {
        handleGenerateRef.current = handleGenerate;
    });
    useEffect(() => {
        const handleTriggerGenerate = () => {
            handleGenerateRef.current();
        };
        document.addEventListener('trigger-generate', handleTriggerGenerate);
        return () => document.removeEventListener('trigger-generate', handleTriggerGenerate);
    }, []);

    // 初始化万能API管理器
    useEffect(() => {
        if (universalApiManager) {
            setUniversalProviders(universalApiManager.getProviders());
        }
    }, [universalApiManager]);

    // 从 UniversalApiManager 加载第三方图像模型
    useEffect(() => {
        if (universalApiManager) {
            const providers = universalApiManager.getProviders();
            const imageModels: {id: string, providerId: string, providerName: string, is3DProvider?: boolean, displayLabel?: string}[] = [];
            providers.forEach(p => {
                if ((p.modelType?.includes('image') || p.modelType?.includes('3d') || p.modelType === 'general' || p.type === 'general' || (!p.modelType && (p.type === 'image' || p.type === 'universal'))) && p.isEnabled) {
                    const is3D = p.modelType?.includes('3d') && !p.modelType?.includes('image');

                    // 只使用用户手动选择的模型列表，不自动发现全部模型
                    if (p.selectedModels && p.selectedModels.length > 0) {
                        p.selectedModels.forEach(mId => {
                            imageModels.push({
                                id: mId,
                                providerId: p.id,
                                providerName: p.displayName || p.name,
                                is3DProvider: is3D,
                                displayLabel: is3D ? get3DModelLabel(mId) : undefined,
                            });
                        });
                    } else if (p.selectedModel) {
                        imageModels.push({
                            id: p.selectedModel,
                            providerId: p.id,
                            providerName: p.displayName || p.name,
                            is3DProvider: is3D,
                            displayLabel: is3D ? get3DModelLabel(p.selectedModel) : undefined,
                        });
                    }
                }
            });
            // Cloud-admin models are loaded separately from /api/models. An empty
            // legacy local provider list must not erase that server-provided list.
            if (imageModels.length > 0) {
                setDiscoveredModels(imageModels);
            }
            setUniversalProviders(providers);
        }
    }, [showThirdPartyDialog, universalApiManager]);

    // 切换标签
    const toggleTag = (tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
        );
    };

    // 处理图片上传
    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files) {
            if (uploadSlotIndex >= 0) {
                // Upload to specific slot
                const file = files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = event => {
                        const result = event.target?.result as string;
                        if (result) {
                            setReferenceImages(prev => {
                                const newImages = [...prev];
                                // Pad array if needed
                                while (newImages.length < uploadSlotIndex) {
                                    newImages.push('');
                                }
                                newImages[uploadSlotIndex] = result;
                                return newImages;
                            });
                            if (onAddToCanvas) {
                                onAddToCanvas(result);
                            }
                        }
                    };
                    reader.readAsDataURL(file);
                }
            } else {
                // Upload to any available slot
                const remaining = MAX_REF_IMAGES - referenceImages.filter(Boolean).length;
                Array.from(files).slice(0, remaining).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = event => {
                        const result = event.target?.result as string;
                        if (result) {
                            setReferenceImages(prev => {
                                const newImages = [...prev];
                                // Find first empty slot
                                const emptyIdx = newImages.findIndex(img => !img);
                                if (emptyIdx >= 0) {
                                    newImages[emptyIdx] = result;
                                } else if (newImages.length < MAX_REF_IMAGES) {
                                    newImages.push(result);
                                }
                                return newImages;
                            });
                            // Also ensure strengths array is padded
                            setReferenceStrengths(prev => {
                                const newArr = [...prev];
                                while (newArr.length < referenceImages.length + 1) newArr.push(50);
                                return newArr;
                            });
                            if (onAddToCanvas) {
                                onAddToCanvas(result);
                            }
                        }
                    };
                    reader.readAsDataURL(file);
                });
            }
        }
        e.target.value = "";
        setUploadSlotIndex(-1);
    };

    // 触发指定槽位上传
    const triggerSlotUpload = (index: number) => {
        setUploadSlotIndex(index);
        fileInputRef.current?.click();
    };

    // 移除上传的图片（真正删除数组元素，而非设空字符串）
    const removeReferenceImage = (index: number) => {
        setReferenceImages(prev => prev.filter((_, i) => i !== index));
        setReferenceDescriptions(prev => prev.filter((_, i) => i !== index));
        setReferenceSelectedCategories(prev => {
            const next: Record<number, Set<string>> = {};
            // 重新映射索引：删除index后，后面的元素索引前移
            Object.keys(prev).forEach(k => {
                const keyNum = parseInt(k, 10);
                if (keyNum < index) {
                    next[keyNum] = prev[keyNum];
                } else if (keyNum > index) {
                    next[keyNum - 1] = prev[keyNum];
                }
            });
            return next;
        });
    };

    // 样式类
    const isMonochrome = themeStyle === 'monochrome';
    
    const containerClass = isMonochrome 
        ? "bg-white"
        : "bg-transparent";

    // 万能API相关函数
  // 迁移旧版纯 modelId → 复合键 providerId::modelId
    useEffect(() => {
        if (pendingModelMigration && discoveredModels.length > 0) {
            // 当多个提供商有同名模型时，优先选择第一个匹配的（按 sort_order 排序）
            const matches = discoveredModels.filter(dm => dm.id === pendingModelMigration);
            const match = matches.length > 0 ? matches[0] : undefined;
            if (match) {
                const compositeKey = `${match.providerId}::${match.id}`;
                setModel(compositeKey);
                try {
                    const currentUserId = localStorage.getItem('unbounded_ai_current_user');
                    if (currentUserId) {
                        const stored = localStorage.getItem('unbounded_ai_user_data');
                        if (stored) {
                            const data = JSON.parse(stored);
                            if (data?.userData?.[currentUserId]) {
                                data.userData[currentUserId].selectedModel = compositeKey;
                                localStorage.setItem('unbounded_ai_user_data', JSON.stringify(data));
                            }
                        }
                    }
                } catch {}
                // 同步写入 wujie_selected_model
                try {
                    const pureId = compositeKey.includes('::') ? compositeKey.split('::').pop()! : compositeKey;
                    const providerId = compositeKey.includes('::') ? compositeKey.split('::')[0] : '';
                    const dm = discoveredModels.find(m => m.id === pureId && m.providerId === providerId);
                    localStorage.setItem('wujie_selected_model', JSON.stringify({
                        model: pureId,
                        providerId: providerId,
                        compositeKey: compositeKey,
                        apiDisplayName: dm?.apiDisplayName || dm?.displayLabel || '',
                        providerName: dm?.providerName || '',
                        quality: quality,
                        aspectRatio: aspectRatio,
                    }));
                } catch {}
            }
            setPendingModelMigration(null);
        }
    }, [pendingModelMigration, discoveredModels, quality, aspectRatio]);

    // 3D模型名称友好标签映射
    // 从服务器加载管理员配置的图像模型
    const loadServerModels = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await fetch('/api/models?type=image', { signal });
            if (res.ok) {
                const data = await res.json();
                const serverModels: {id: string, providerId: string, providerName: string, is3DProvider?: boolean, displayLabel?: string, apiDisplayName?: string}[] = [];
                const providerMap = new Map<string, string>();
                if (data.providers && Array.isArray(data.providers)) {
                    for (const p of data.providers) {
                        providerMap.set(p.id, p.name || p.displayName || '');
                    }
                }
                // 优先从顶层 models 数组读取（已由服务端按 selectedModels + type 过滤）
                if (data.models && Array.isArray(data.models)) {
                    for (const m of data.models) {
                        const is3D = m.id?.toLowerCase().includes('3d') || m.name?.toLowerCase().includes('3d');
                        serverModels.push({
                            id: m.id || m.name,
                            providerId: m.providerId || '',
                            providerName: providerMap.get(m.providerId) || m.providerId || '',
                            is3DProvider: is3D,
                            displayLabel: is3D ? get3DModelLabel(m.id || m.name) : undefined,
                            apiDisplayName: m.name || '',
                        });
                    }
                }
                if (serverModels.length > 0) {
                    // 完整替换模型列表，确保管理员更新后自动同步
                    setDiscoveredModels(serverModels);
                    // 仅在未选中模型时自动选择第一个；刷新列表时不改变当前选择
                    setModel(prev => {
                        if (!prev && serverModels.length > 0) {
                            return `${serverModels[0].providerId}::${serverModels[0].id}`;
                        }
                        // 刷新时保持当前选择不变，即使模型已不存在于列表中
                        // 用户可手动切换到其他模型
                        return prev;
                    });
                }
            }
        } catch {
            // 静默失败
        }
    }, []);

    useEffect(() => {
        const ac = new AbortController();
        loadServerModels(ac.signal);
        // 页面重新可见时刷新模型列表（用户可能刚从管理面板切回）
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                loadServerModels(ac.signal);
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            ac.abort();
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [loadServerModels]);
    // 动态槽位 - 根据已有图片数量决定显示哪些槽位
    const filledCount = referenceImages.filter(Boolean).length;
    const imageSlots = referenceImages.length < MAX_REF_IMAGES
        ? [...referenceImages.keys(), referenceImages.length] // existing + one empty add slot
        : [...referenceImages.keys()]; // max reached, no add slot

    // 确保类型和强度数组与图片数组对齐
    const getRefCategories = (i: number): Set<string> => referenceSelectedCategories[i] || new Set();
    const getRefStrength = (i: number): number => referenceStrengths[i] ?? 0;

    // Toggle a category for a reference image
    const toggleRefCategory = (i: number, cat: string) => {
        setReferenceSelectedCategories(prev => {
            const current = prev[i] || new Set();
            const next = new Set(current);
            if (next.has(cat)) {
                next.delete(cat);
            } else {
                if (next.size >= MAX_REF_CATEGORIES) return prev; // max 2
                next.add(cat);
            }
            return { ...prev, [i]: next };
        });
    };

    // 添加新参考图槽位
    const addRefSlot = () => {
        if (referenceImages.length >= MAX_REF_IMAGES) return;
        setReferenceImages(prev => [...prev, '']);
        setReferenceDescriptions(prev => [...prev, '']);
        setReferenceStrengths(prev => [...prev, 0]);
    };

    // 根据主题模式设定样式 - 国际化标准尺寸，舒适可读
    const mc = isMonochrome; // shorthand
    // Section title style
    const stl = mc 
        ? "text-xs font-semibold text-blue-500 uppercase tracking-wider flex items-center gap-1.5 mb-1"
        : "text-xs font-semibold text-gold-muted uppercase tracking-wider flex items-center gap-1.5 mb-1";
    const dot = <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${mc ? 'bg-blue-500' : 'bg-gold'}`} />;
    // Input/Select style - comfortable padding
    const inputStl = mc
        ? "w-full px-3 py-2 rounded-lg text-sm bg-white text-gray-900 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:shadow-sm transition-all hover:border-blue-300"
        : "w-full px-3 py-2 rounded-lg text-sm bg-[#1a1d26] text-text-bright border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-gold/30 focus:shadow-gold/8 transition-all hover:border-white/[0.10]";
    // Grid button unselected/selected
    const gridBtnBase = "py-1.5 px-2 text-xs rounded-md transition-all duration-200 border";
    const gridBtnOff = mc
        ? "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600"
        : "bg-white/5 text-gold-muted border-white/[0.06] hover:border-white/[0.10] hover:text-[#bbb]";
    const gridBtnOn = mc
        ? "bg-blue-500 text-white border-blue-500 shadow-sm shadow-blue-200"
        : "bg-gold/15 text-gold border-gold/40 shadow-gold/8";

    return (
        <div className={`h-full flex flex-col ${containerClass}`}>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 custom-scrollbar">
                {/* 模型选择 */}
                <div className="space-y-1">
                    <label className={stl}>{dot}图像模型</label>
                    <select
                        value={model}
                        onChange={(e) => {
                            const compositeKey = e.target.value;
                            setModel(compositeKey);
                            // Save selected model (composite key) to localStorage for canvas tools
                            try {
                              const currentUserId = localStorage.getItem('unbounded_ai_current_user');
                              if (currentUserId) {
                                const stored = localStorage.getItem('unbounded_ai_user_data');
                                const data = stored ? JSON.parse(stored) : { userData: {} };
                                if (!data.userData) data.userData = {};
                                if (!data.userData[currentUserId]) data.userData[currentUserId] = {};
                                data.userData[currentUserId].selectedModel = compositeKey;
                                localStorage.setItem('unbounded_ai_user_data', JSON.stringify(data));
                              }
                            } catch (err) {
                              console.error('Failed to save selected model:', err);
                            }
                            // 同步写入 wujie_selected_model 供画布工具读取
                            try {
                              const newPureModelId = compositeKey.includes('::') ? compositeKey.split('::').pop()! : compositeKey;
                              const providerId = compositeKey.includes('::') ? compositeKey.split('::')[0] : '';
                              const dm = discoveredModels.find(m => m.id === newPureModelId && m.providerId === providerId);
                              localStorage.setItem('wujie_selected_model', JSON.stringify({
                                model: newPureModelId,
                                providerId: providerId,
                                compositeKey: compositeKey,
                                apiDisplayName: dm?.apiDisplayName || dm?.displayLabel || '',
                                providerName: dm?.providerName || '',
                                quality: quality,
                                aspectRatio: aspectRatio,
                              }));
                            } catch {}
                            // Extract pure modelId for ratio/quality lookup
                            const newPureModelId = compositeKey.includes('::') ? compositeKey.split('::').pop()! : compositeKey;
                            const newProviderId = compositeKey.includes('::') ? compositeKey.split('::')[0] : '';
                            // 动态获取模型支持的画面比例列表
                            const newProviderName = discoveredModels.find(item => item.id === newPureModelId && item.providerId === newProviderId)?.providerName || '';
                            const supportedRatios = getProviderAspectRatios(newPureModelId, `${newProviderId} ${newProviderName}`);
                            setAspectRatio(supportedRatios[0]);
                            // 动态获取模型支持的分辨率/质量选项
                            const paramType = getModelParamType(newPureModelId);
                            const resolutionTiers = getResolutionTierOptions(newPureModelId);
                            const qualityLevels = getQualityLevelOptions(newPureModelId);
                            const mlower = newPureModelId.toLowerCase();
                            // 按后缀推断默认分辨率
                            let defaultResolution = resolutionTiers[0] || '1K';
                            if (/-4k(?:-omni)?$/.test(mlower)) defaultResolution = '4K';
                            else if (/-2k$/.test(mlower)) defaultResolution = '2K';
                            // 按后缀推断默认质量
                            let defaultQuality = qualityLevels[0] || 'auto';
                            if (/-4k(?:-omni)?$/.test(mlower) || /-2k$/.test(mlower) || /-hd$|[-_]high$/.test(mlower)) {
                                defaultQuality = 'high';
                            }
                            // 根据 paramType 设置对应 state
                            if (paramType === 'both' || paramType === 'resolution') {
                                setResolution(resolutionTiers.includes(defaultResolution) ? defaultResolution : resolutionTiers[0] || '1K');
                            }
                            if (paramType === 'both' || paramType === 'quality') {
                                setQuality(qualityLevels.includes(defaultQuality) ? defaultQuality : qualityLevels[0] || 'auto');
                            }
                        }}
                        className={`${inputStl} appearance-none cursor-pointer`}
                    >
                        {/* 管理员/第三方模型 */}
                        {(() => {
                            // Group discovered models by provider name
                            const grouped: Record<string, typeof discoveredModels> = {};
                            discoveredModels.forEach(dm => {
                                const key = (dm.providerName || '未知').replace(/\bimgae\b/gi, 'image');
                                if (!grouped[key]) grouped[key] = [];
                                grouped[key].push(dm);
                            });
                            return Object.entries(grouped).map(([providerName, models]) => {
                                const has3D = models.some(dm => dm.is3DProvider);
                                const label = has3D ? `${providerName} (3D)` : providerName;
                                return (
                                <optgroup key={providerName} label={label}>
                                    {models.map(dm => {
                                        // Use composite key (modelId::providerId) to distinguish same-name models from different providers
                                        const compositeValue = `${dm.providerId}::${dm.id}`;
                                        return (
                                        <option key={compositeValue} value={compositeValue} className={mc ? "bg-white text-gray-900" : "bg-[#1a1d26] text-text-bright"}>
                                            {dm.is3DProvider ? `[3D] ${dm.displayLabel || dm.apiDisplayName || getModelDisplayName(dm.id)}` : dm.apiDisplayName || getModelDisplayName(dm.id)}
                                        </option>
                                        );
                                    })}
                                </optgroup>
                            );
                            });
                        })()}
                    </select>
                    {(() => {
                        const discoveredModel = discoveredModels.find(dm => {
                            const compositeKey = `${dm.providerId}::${dm.id}`;
                            return compositeKey === model || dm.id === model;
                        });
                        if (discoveredModel) return <p className={`text-xs mt-0.5 ${mc ? 'text-gray-400' : 'text-gold-muted/70'}`}>{discoveredModel.is3DProvider ? `${discoveredModel.displayLabel || discoveredModel.apiDisplayName || getModelDisplayName(discoveredModel.id)} · 来自 ${discoveredModel.providerName}` : `${discoveredModel.apiDisplayName || getModelDisplayName(discoveredModel.id)} · 来自 ${discoveredModel.providerName}`}</p>;
                        return null;
                    })()}
                </div>

                {/* 创意描述 - 可拖动调整高度，支持参考图标记 */}
                <div className="space-y-1">
                    <label className={stl}>{dot}创意描述{altRefMarkers.length > 0 && <span className="ml-1.5 text-xs text-[#6366f1] font-normal">({altRefMarkers.length}张参考图)</span>}</label>
                    <div className="relative">
                    <div className={`relative rounded-md border ${mc ? 'border-gray-200' : 'border-white/[0.06]'} overflow-hidden`}>
                        {/* Alt reference marker chips displayed above the textarea */}
                        {altRefMarkers.length > 0 && (
                            <div className={`flex flex-wrap gap-1.5 px-3 py-2 border-b ${mc ? 'border-gray-200 bg-gray-50' : 'border-white/[0.06] bg-white/[0.03]'}`}>
                                {altRefMarkers.map((marker) => (
                                    <div
                                        key={marker.id}
                                        className={`group inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                                            mc
                                                ? 'bg-white border border-indigo-200 text-indigo-700 hover:border-indigo-400'
                                                : 'bg-[#6366f1]/15 border border-[#6366f1]/30 text-[#818cf8] hover:border-[#6366f1]/60'
                                        }`}
                                    >
                                        {/* Thumbnail */}
                                        <NextImage unoptimized width={1} height={1}                                             src={marker.url}
                                            alt=""
                                            className="w-5 h-5 rounded object-cover flex-shrink-0"
                                        />
                                        {/* Marker number */}
                                        <span className="font-bold">R{marker.number}</span>
                                        {/* Description hint */}
                                        <span className={`${mc ? 'text-gray-400' : 'text-gold-muted/50'}`}>参考图{marker.number}</span>
                                        {/* Remove button */}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveAltRefMarker?.(marker.id);
                                            }}
                                            className={`ml-0.5 rounded-full p-0.5 transition-colors ${
                                                mc
                                                    ? 'hover:bg-indigo-100 text-indigo-400 hover:text-indigo-700'
                                                    : 'hover:bg-[#6366f1]/30 text-[#6366f1]/50 hover:text-[#818cf8]'
                                            }`}
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <textarea
                            ref={promptTextareaRef}
                            value={prompt}
                            onChange={(e) => {
                                const newValue = e.target.value;
                                setPrompt(newValue);
                                
                                // Check for / trigger
                                const cursorPos = e.target.selectionStart;
                                const textBeforeCursor = newValue.slice(0, cursorPos);
                                const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
                                
                                if (lastSlashIndex >= 0) {
                                    const charBeforeSlash = lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : ' ';
                                    // Show popup if / is at start or after whitespace
                                    if (lastSlashIndex === 0 || /\s/.test(charBeforeSlash)) {
                                        const query = textBeforeCursor.slice(lastSlashIndex + 1);
                                        setTemplateSearchQuery(query);
                                        const results = query ? searchTemplates(query) : getPromptTemplates();
                                        setFilteredTemplates(results.slice(0, 20));
                                        setSelectedTemplateIndex(0);
                                        setShowTemplatePopup(true);
                                    } else {
                                        setShowTemplatePopup(false);
                                    }
                                } else {
                                    setShowTemplatePopup(false);
                                }
                            }}
                            onKeyDown={(e) => {
                                // Handle template popup navigation
                                if (showTemplatePopup && filteredTemplates.length > 0) {
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setSelectedTemplateIndex(prev => (prev + 1) % filteredTemplates.length);
                                        return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setSelectedTemplateIndex(prev => (prev - 1 + filteredTemplates.length) % filteredTemplates.length);
                                        return;
                                    }
                                    if (e.key === 'Enter' || e.key === 'Tab') {
                                        e.preventDefault();
                                        const selected = filteredTemplates[selectedTemplateIndex];
                                        if (selected) {
                                            // Replace the /query with template content
                                            const cursorPos = e.currentTarget.selectionStart;
                                            const textBeforeCursor = prompt.slice(0, cursorPos);
                                            const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
                                            const textAfterCursor = prompt.slice(cursorPos);
                                            const newPrompt = prompt.slice(0, lastSlashIndex) + selected.content + textAfterCursor;
                                            setPrompt(newPrompt);
                                            setShowTemplatePopup(false);
                                        }
                                        return;
                                    }
                                    if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setShowTemplatePopup(false);
                                        return;
                                    }
                                }
                                
                                // Backspace at the start of textarea: remove last alt ref marker
                                if (e.key === 'Backspace' && altRefMarkers.length > 0) {
                                    const textarea = e.currentTarget;
                                    if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
                                        e.preventDefault();
                                        const lastMarker = altRefMarkers[altRefMarkers.length - 1];
                                        onRemoveAltRefMarker?.(lastMarker.id);
                                    }
                                }
                            }}
                            placeholder={referenceImages.length > 0
                                ? "用 #1、#2... 引用参考图，如：#1的风格，#2的构图... (输入 / 使用模板)"
                                : altRefMarkers.length > 0
                                    ? "用 R1、R2... 引用参考图来控制生成效果..."
                                    : "描述你想要创建的图像... (输入 / 使用模板)"}
                            style={{ height: prompt ? promptHeight : undefined, minHeight: 80 }}
                            className={`w-full px-3 py-2.5 text-sm resize-none ${mc ? 'bg-gray-50 text-gray-900 placeholder:text-gray-400' : 'bg-white/5 text-text-bright placeholder:text-gold-muted/50'} leading-relaxed focus:outline-none focus:ring-1 ${mc ? 'focus:ring-gray-300' : 'focus:ring-gold/30'} rounded-lg transition-shadow`}
                        />
                        {/* 拖动手柄 - 仅在有内容时显示 */}
                        {prompt && (
                            <div
                                className={`absolute bottom-0 right-0 w-8 h-4 cursor-ns-resize flex items-center justify-center ${mc ? 'hover:bg-gray-200' : 'hover:bg-[#2a2a2a]'} transition-colors rounded-tl`}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    promptDragRef.current = { startY: e.clientY, startH: promptHeight };
                                    const onMove = (ev: MouseEvent) => {
                                        if (!promptDragRef.current) return;
                                        const delta = ev.clientY - promptDragRef.current.startY;
                                        const newH = Math.max(80, Math.min(500, promptDragRef.current.startH + delta));
                                        setPromptHeight(newH);
                                    };
                                    const onUp = () => {
                                        promptDragRef.current = null;
                                        window.removeEventListener('mousemove', onMove);
                                        window.removeEventListener('mouseup', onUp);
                                    };
                                    window.addEventListener('mousemove', onMove);
                                    window.addEventListener('mouseup', onUp);
                                }}
                            >
                                <GripHorizontal className={`w-4 h-4 ${mc ? 'text-gray-400' : 'text-gold-muted/50'}`} />
                            </div>
                        )}
                    </div>
                    {/* Template Popup - outside overflow-hidden container */}
                    {showTemplatePopup && filteredTemplates.length > 0 && (
                            <div className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-xl shadow-2xl ${
                                mc ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-white/[0.12]'
                            }`}>
                                <div className={`px-3 py-2 border-b ${mc ? 'border-gray-100' : 'border-white/[0.06]'}`}>
                                    <span className={`text-xs ${mc ? 'text-gray-500' : 'text-gold-muted/70'}`}>
                                        提示词模板 {templateSearchQuery && `· 搜索: "${templateSearchQuery}"`}
                                    </span>
                                </div>
                                <div className="max-h-60 overflow-y-auto overscroll-contain">
                                    {filteredTemplates.map((template, index) => (
                                        <button
                                            key={template.id}
                                            onClick={() => {
                                                const cursorPos = promptTextareaRef.current?.selectionStart || prompt.length;
                                                const textBeforeCursor = prompt.slice(0, cursorPos);
                                                const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
                                                const textAfterCursor = prompt.slice(cursorPos);
                                                const newPrompt = prompt.slice(0, lastSlashIndex) + template.content + textAfterCursor;
                                                setPrompt(newPrompt);
                                                setShowTemplatePopup(false);
                                                promptTextareaRef.current?.focus();
                                            }}
                                            onMouseEnter={(e) => {
                                                if (template.thumbnail) {
                                                    setHoveredTemplateId(template.id);
                                                    setThumbnailRect(e.currentTarget.getBoundingClientRect());
                                                }
                                            }}
                                            onMouseLeave={() => setHoveredTemplateId(null)}
                                            className={`w-full text-left px-3 py-2.5 transition-colors relative ${
                                                index === selectedTemplateIndex
                                                    ? mc ? 'bg-gray-100' : 'bg-white/[0.06]'
                                                    : mc ? 'hover:bg-gray-50' : 'hover:bg-white/[0.03]'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                {template.thumbnail ? (
                                                    <NextImage unoptimized width={1} height={1} src={template.thumbnail} alt={template.name} className={`w-7 h-7 rounded object-cover flex-shrink-0 ${mc ? 'border border-gray-200' : 'border border-white/[0.08]'}`} />
                                                ) : (
                                                    <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${mc ? 'text-gray-400' : 'text-gold-muted/50'}`} />
                                                )}
                                                <span className={`text-sm font-medium truncate ${mc ? 'text-gray-900' : 'text-foreground'}`}>
                                                    {template.name}
                                                </span>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                                                    mc ? 'bg-gray-100 text-gray-500' : 'bg-white/[0.06] text-gold-muted/70'
                                                }`}>
                                                    {template.category}
                                                </span>
                                            </div>
                                            <p className={`text-xs mt-1 line-clamp-1 pl-9 ${mc ? 'text-gray-500' : 'text-gold-muted/50'}`}>
                                                {template.content}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                                {/* Floating thumbnail - portal to body to avoid overflow clipping */}
                                {hoveredTemplateId && (() => {
                                    const tpl = filteredTemplates.find(t => t.id === hoveredTemplateId);
                                    if (!tpl?.thumbnail || !thumbnailRect) return null;
                                    return createPortal(
                                        <div
                                            className="fixed z-[9999] pointer-events-none"
                                            style={{
                                                left: thumbnailRect.left - 176,
                                                top: Math.max(8, thumbnailRect.top - 40),
                                            }}
                                        >
                                            <div className={`rounded-lg shadow-2xl overflow-hidden border ${mc ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-white/[0.12]'}`}>
                                                <NextImage unoptimized width={1} height={1} src={tpl.thumbnail} alt={tpl.name} className="w-40 h-40 object-cover" />
                                                <div className={`px-2 py-1 text-[10px] truncate ${mc ? 'text-gray-600' : 'text-gold-muted'}`}>{tpl.name}</div>
                                            </div>
                                        </div>,
                                        document.body
                                    );
                                })()}
                                <div className={`px-3 py-2 border-t ${mc ? 'border-gray-100' : 'border-white/[0.06]'}`}>
                                    <span className={`text-[10px] ${mc ? 'text-gray-400' : 'text-gold-muted/40'}`}>
                                        ↑↓ 选择 · Enter 确认 · Esc 关闭
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                    {/* 提示词方程式按钮 */}
                    <button
                        onClick={() => onOpenPromptEquation?.()}
                        className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all duration-200 border ${
                            mc
                                ? 'border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700 bg-white'
                                : 'border-white/[0.06] text-gold-muted hover:border-gold/40 hover:text-gold bg-white/5'
                        }`}
                    >
                        <Zap className={`w-3.5 h-3.5 ${mc ? '' : 'text-gold'}`} />
                        提示词方程式
                    </button>
                </div>

                {/* 快速风格 */}
                <div className="space-y-1">
                    <label className={stl}>{dot}快速风格</label>
                    <div className="flex flex-wrap gap-1">
                        {getQuickTags(productCategory, designType).map(tag => (
                            <button
                                key={tag}
                                onClick={() => toggleTag(tag)}
                                className={`px-2 py-1 rounded-md text-xs transition-all duration-200 border ${
                                    selectedTags.includes(tag) 
                                        ? mc
                                            ? 'bg-blue-500 text-white border-blue-500'
                                            : 'bg-gold/15 text-gold border-gold/30'
                                        : mc
                                            ? 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                                            : 'bg-white/5 text-gold-muted/70 border-white/[0.06] hover:border-white/[0.10] hover:text-muted-foreground'
                                }`}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 产品品类 - 单独一行 */}
                <div className="space-y-1">
                    <label className={stl}>{dot}产品品类</label>
                    <select
                        value={productCategory}
                        onChange={(e) => {
                            setProductCategory(e.target.value);
                            setDesignType('');
                            setStylePreset('');
                        }}
                        className={`${inputStl} appearance-none cursor-pointer`}
                    >
                        {PRODUCT_CATEGORIES.map(cat => (
                            <option key={cat.value} value={cat.value}>{cat.label}</option>
                        ))}
                    </select>
                </div>

                {/* 设计类型 - 单独一行 */}
                <div className="space-y-1">
                    <label className={stl}>{dot}设计类型</label>
                    <select
                        value={designType}
                        onChange={(e) => {
                            setDesignType(e.target.value);
                            setStylePreset('');
                        }}
                        className={`${inputStl} appearance-none cursor-pointer`}
                    >
                        <option value="">选择设计类型</option>
                        {DESIGN_TYPES.map(dt => (
                            <option key={dt.value} value={dt.value}>{dt.label}</option>
                        ))}
                    </select>
                </div>

                {/* 风格预设 - 单独一行，根据设计类型动态变化 */}
                <div className="space-y-1">
                    <label className={stl}>{dot}风格预设</label>
                    <select
                        value={stylePreset}
                        onChange={(e) => setStylePreset(e.target.value)}
                        className={`${inputStl} appearance-none cursor-pointer`}
                    >
                        <option value="">选择风格预设</option>
                        {getStylePresets(designType).map(preset => (
                            <option key={preset.value} value={preset.value}>{preset.label}</option>
                        ))}
                    </select>
                </div>

                {/* 多图参考 - Enhanced Multi-image Reference */}
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                        <label className={stl}>{dot}参考图片</label>
                        <span className={`text-xs px-1.5 py-0.5 rounded-md ${mc ? 'bg-gray-100 text-gray-500' : 'bg-white/5 text-gold-muted/70'}`}>
                            {filledCount}/{MAX_REF_IMAGES}
                        </span>
                    </div>
                    <div className="space-y-1.5">
                        {imageSlots.map(i => {
                            // Last slot is the "add" button if under max
                            if (i === referenceImages.length && i < MAX_REF_IMAGES) {
                                return (
                                    <button
                                        key="add-ref"
                                        onClick={addRefSlot}
                                        className={`w-full py-2.5 rounded-md border border-dashed flex items-center justify-center gap-1.5 transition-all ${
                                            mc
                                                ? 'border-gray-300 hover:border-gray-500 hover:bg-gray-50 text-gray-400 hover:text-gray-700'
                                                : 'border-white/[0.06] hover:border-gold/40 hover:bg-white/10 text-gold-muted/50 hover:text-gold'
                                        }`}
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        <span className="text-xs">新增参考图</span>
                                    </button>
                                );
                            }
                            const img = referenceImages[i];
                            const selectedCats = getRefCategories(i);
                            const strength = getRefStrength(i);
                            return (
                                <div key={i} className={`rounded-md border transition-all ${
                                    mc ? 'bg-white border-gray-200' : 'bg-[#0d0d0d] border-[#252525]'
                                }`}>
                                    {img ? (
                                        <div className="flex items-center gap-2 p-1.5">
                                            {/* 缩略图 + 序号锚点 */}
                                            <div className="relative w-12 h-12 flex-shrink-0 rounded overflow-hidden group">
                                                <NextImage unoptimized width={1} height={1} src={img} className="w-full h-full object-cover" alt="" />
                                                {/* 序号锚点标签 #1, #2, #3... */}
                                                <span className={`absolute top-0 left-0 text-[10px] font-bold px-1 py-0 rounded-br leading-tight ${
                                                    mc ? 'bg-indigo-500 text-white' : 'bg-gold/90 text-black'
                                                }`}>
                                                    #{i + 1}
                                                </span>
                                                <button
                                                    onClick={() => removeReferenceImage(i)}
                                                    className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500/90 rounded-full text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                                >
                                                    <X className="h-2 w-2" />
                                                </button>
                                            </div>
                                            {/* 参考类型 + 强度 */}
                                            <div className="flex-1 min-w-0 space-y-1">
                                                <div className="flex flex-wrap gap-1">
                                                    {REF_CATEGORIES.map(cat => (
                                                        <button
                                                            key={cat.key}
                                                            onClick={() => toggleRefCategory(i, cat.key)}
                                                            className={`text-xs px-1.5 py-0.5 rounded transition-all ${
                                                                selectedCats.has(cat.key)
                                                                    ? 'bg-blue-500 text-white font-semibold'
                                                                    : mc ? 'bg-gray-100 text-gray-400 hover:text-blue-500' : 'bg-white/5 text-gold-muted/70 hover:text-muted-foreground'
                                                            }`}
                                                        >
                                                            {cat.label}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`text-xs ${mc ? 'text-gray-400' : 'text-gold-muted/70'}`}>强度</span>
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={100}
                                                        value={strength}
                                                        onChange={e => {
                                                            const newStr = [...referenceStrengths];
                                                            while (newStr.length <= i) newStr.push(0);
                                                            newStr[i] = parseInt(e.target.value);
                                                            setReferenceStrengths(newStr);
                                                        }}
                                                        className="flex-1 h-1 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5"
                                                        style={{
                                                          background: `linear-gradient(to right, ${mc ? '#3b82f6' : '#d4af37'} ${strength}%, ${mc ? '#e2e8f0' : 'rgba(255,255,255,0.1)'} ${strength}%)`
                                                        }}
                                                    />
                                                    <span className={`text-xs w-7 text-right ${mc ? 'text-gray-500' : 'text-gold-muted'}`}>{strength}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => triggerSlotUpload(i)}
                                            className={`w-full py-2.5 rounded-md border border-dashed flex items-center justify-center gap-1.5 transition-all ${
                                                mc
                                                    ? 'border-gray-300 hover:border-gray-500 hover:bg-gray-50 text-gray-400 hover:text-gray-700'
                                                    : 'border-white/[0.06] hover:border-gold/40 hover:bg-white/10 text-gold-muted/50 hover:text-gold'
                                            }`}
                                        >
                                            <Upload className="h-3.5 w-3.5" />
                                            <span className="text-xs">上传参考图 #{i+1}</span>
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={handleImageUpload}
                    />
                </div>

                {/* Ctrl+Click 画布参考融合 - 关键词与尺寸调整 */}
                {ctrlRefSelections.length > 0 && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className={stl}>{dot}参考融合</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${mc ? 'bg-gray-100 text-gray-500' : 'bg-white/5 text-[#777]'}`}>
                                画布中 Ctrl+Click 添加
                            </span>
                            <button
                                onClick={() => {
                                    ctrlRefSelections.forEach(ref => onRemoveCtrlRef?.(ref.id));
                                }}
                                className={`ml-auto text-xs px-2 py-0.5 rounded-md transition-colors ${
                                    mc ? 'text-gray-400 hover:text-red-500' : 'text-gold-muted/70 hover:text-red-400'
                                }`}
                            >
                                清空
                            </button>
                        </div>
                        <div className={`rounded-lg p-3 border ${mc ? 'bg-gray-50 border-gray-200' : 'bg-[#0d0d0d] border-[#252525]'}`}>
                            {/* 关键词输入区 */}
                            <div className="space-y-2">
                                {ctrlRefSelections.map((ref) => (
                                    <div key={ref.id} className="flex items-center gap-2">
                                        <span className="shrink-0 w-5 h-5 rounded-full bg-gold text-black text-xs font-bold flex items-center justify-center">
                                            {ref.number}
                                        </span>
                                        <div className="w-9 h-9 rounded overflow-hidden border border-gold/40 shrink-0">
                                            <NextImage unoptimized width={1} height={1} src={ref.url} className="w-full h-full object-cover" alt="" />
                                        </div>
                                        <input
                                            type="text"
                                            value={ref.keyword || ''}
                                            onChange={(e) => onUpdateCtrlRefKeyword?.(ref.id, e.target.value)}
                                            placeholder={`#${ref.number} 关键词（如：人物、背景）`}
                                            className={`flex-1 min-w-0 px-3 py-1.5 rounded-md text-xs border ${
                                                mc
                                                    ? 'bg-white border-gray-200 text-gray-700 placeholder:text-gray-400'
                                                    : 'bg-white/5 border-white/[0.06] text-[#ccc] placeholder:text-gold-muted/50'
                                            } focus:outline-none focus:border-[#d4af37]/50`}
                                        />
                                        <button
                                            onClick={() => onRemoveCtrlRef?.(ref.id)}
                                            className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                                                mc ? 'text-gray-300 hover:text-red-500' : 'text-[#444] hover:text-red-400'
                                            }`}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {/* 融合描述 */}
                            <div className="mt-2.5">
                                <textarea
                                    value={fusionPrompt}
                                    onChange={(e) => setFusionPrompt(e.target.value)}
                                    placeholder="融合描述：描述如何将参考图融合（如：1和2里的人物拥抱，在3的背景中）..."
                                    rows={2}
                                    className={`w-full px-3 py-2 rounded-md text-xs border resize-none ${
                                        mc
                                            ? 'bg-white border-gray-200 text-gray-700 placeholder:text-gray-400'
                                            : 'bg-white/5 border-white/[0.06] text-[#ccc] placeholder:text-gold-muted/50'
                                    } focus:outline-none focus:border-[#d4af37]/50 leading-relaxed`}
                                />
                            </div>
                            {/* 融合生成按钮 */}
                            <button
                                onClick={() => onFusionGenerate?.(ctrlRefSelections, fusionPrompt)}
                                className="w-full mt-2.5 py-2 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.98]"
                            >
                                <GitMerge className="h-4 w-4" />
                                融合生成
                            </button>
                        </div>
                    </div>
                )}

                {/* 图像比例 */}
                <div className="space-y-1">
                    <label className={stl}>{dot}图像比例</label>
                    <div className="grid grid-cols-5 gap-1.5">
                        {getSupportedAspectRatios().map(ratio => (
                            <button
                                key={ratio}
                                onClick={() => setAspectRatio(ratio)}
                                className={`${gridBtnBase} ${aspectRatio === ratio ? gridBtnOn : gridBtnOff}`}

                            >
                                <div className="flex flex-col items-center leading-none gap-0.5">
                                    <div
                                      className="border currentColor rounded-[1px]"
                                      style={{
                                        width: (() => {
                                          const [w] = ratio.split(':').map(Number);
                                          const h = ratio.split(':').map(Number)[1];
                                          const maxDim = 16;
                                          return Math.max(6, (w / Math.max(w, h)) * maxDim);
                                        })(),
                                        height: (() => {
                                          const [w, h] = ratio.split(':').map(Number);
                                          const maxDim = 16;
                                          return Math.max(6, (h / Math.max(w, h)) * maxDim);
                                        })(),
                                        borderWidth: 1.5,
                                        opacity: aspectRatio === ratio ? 1 : 0.5,
                                      }}
                                    />
                                    <span className="text-xs">{ratio}</span>
                                    {/* 方案A：画面比例不再显示像素尺寸，像素由API根据模型类型和质量参数决定 */}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 输出参数：根据模型类型显示分辨率档位或质量级别 */}
                {/* ★ 关键修复：paramType === 'both' 时显示分辨率档位 + 生成质量两个独立行 */}
                {(() => {
                    const pureModelId = model.includes('::') ? model.split('::').pop()! : model;
                    const paramType = getModelParamType(pureModelId);
                    const resolutionTiers = getResolutionTierOptions(pureModelId);
                    const qualityLevels = getQualityLevelOptions(pureModelId);
                    const showResolutions = resolutionTiers.length > 1;
                    const showQuality = qualityLevels.length > 1;

                    if (!showResolutions && !showQuality) return null;

                    return (
                        <>
                            {/* 分辨率档位行（both/resolution 类型显示） */}
                            {(paramType === 'both' || paramType === 'resolution') && showResolutions && (
                                <div className="space-y-1">
                                    <label className={stl}>{dot}分辨率</label>
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {resolutionTiers.map(q => (
                                            <button
                                                key={q}
                                                onClick={() => {
                                                    if (paramType === 'both') {
                                                        setResolution(q);
                                                    } else {
                                                        setQuality(q);
                                                    }
                                                }}
                                                className={`${gridBtnBase} ${(paramType === 'both' ? resolution : quality) === q ? gridBtnOn : gridBtnOff}`}
                                            >
                                                <div className="flex flex-col items-center leading-none">
                                                    <span className="text-xs">
                                                        {RESOLUTION_TIER_DISPLAY_NAMES[q] || q}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 质量级别行（both/quality 类型显示） */}
                            {(paramType === 'both' || paramType === 'quality') && showQuality && (
                                <div className="space-y-1">
                                    <label className={stl}>{dot}{paramType === 'both' ? '生成质量' : '图片质量'}</label>
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {qualityLevels.map(q => (
                                            <button
                                                key={q}
                                                onClick={() => setQuality(q)}
                                                className={`${gridBtnBase} ${quality === q ? gridBtnOn : gridBtnOff}`}
                                            >
                                                <div className="flex flex-col items-center leading-none">
                                                    <span className="text-xs">
                                                        {q === 'auto' ? '自动' : 
                                                         q === 'low' ? '快速' : 
                                                         q === 'medium' ? '中等' : 
                                                         q === 'standard' ? '标准' : 
                                                         q === 'high' ? '高清' : 
                                                         q === 'hd' ? '高清' : 
                                                         q === 'ultra' ? '超清' : 
                                                         (QUALITY_LEVEL_DISPLAY_NAMES[q] || q)}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    );
                })()}

                {/* 生图数量 */}
                <div className="space-y-1">
                    <label className={stl}>{dot}生图数量</label>
                    <div className="grid grid-cols-4 gap-1.5">
                        {[1, 2, 3, 4].map(n => (
                            <button
                                key={n}
                                onClick={() => setOutputCount(n)}
                                className={`${gridBtnBase} ${outputCount === n ? gridBtnOn : gridBtnOff}`}
                            >
                                x{n}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 第三方模型调用 */}
                <button
                    onClick={() => { setThirdPartyDefaultType('image'); setShowThirdPartyDialog(true); }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs border transition-all duration-200 ${
                        mc
                            ? 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
                            : 'bg-white/5 text-[#777] border-white/[0.06] hover:border-[#d4af37]/20 hover:text-muted-foreground'
                    }`}
                >
                    <span className="flex items-center gap-1.5">
                        <Cpu className="h-3.5 w-3.5" />
                        第三方模型
                    </span>
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>
            {/* 第三方模型调用弹窗 */}
            <ThirdPartyModelDialog
                isOpen={showThirdPartyDialog}
                onClose={() => setShowThirdPartyDialog(false)}
                themeStyle={themeStyle}
                defaultType={thirdPartyDefaultType}
                onProviderAdded={(provider) => {
                    if (universalApiManager) {
                        setUniversalProviders(universalApiManager.getProviders());
                        if (provider.modelType === '3d') return;
                        const is3D = provider.modelType?.includes('3d') && !provider.modelType?.includes('image');
                        if (provider.selectedModels && provider.selectedModels.length > 0) {
                            const newModels = provider.selectedModels.map(mId => ({
                                id: mId,
                                providerId: provider.id,
                                providerName: provider.displayName || provider.name,
                                is3DProvider: is3D,
                                displayLabel: is3D ? get3DModelLabel(mId) : undefined,
                            }));
                            setDiscoveredModels(prev => [...prev, ...newModels]);
                        } else if (provider.selectedModel) {
                            setDiscoveredModels(prev => [...prev, {
                                id: provider.selectedModel!,
                                providerId: provider.id,
                                providerName: provider.displayName || provider.name,
                                is3DProvider: is3D,
                                displayLabel: is3D ? get3DModelLabel(provider.selectedModel!) : undefined,
                            }]);
                        }
                    }
                }}
                onProviderDeleted={() => {
                    if (universalApiManager) {
                        setUniversalProviders(universalApiManager.getProviders());
                    }
                }}
                onProviderUpdated={() => {
                    if (universalApiManager) {
                        setUniversalProviders(universalApiManager.getProviders());
                        const providers = universalApiManager.getProviders();
                        const imageModels: {id: string, providerId: string, providerName: string, is3DProvider?: boolean, displayLabel?: string}[] = [];
                        providers.forEach(p => {
                            if ((p.modelType?.includes('image') || p.modelType?.includes('3d') || p.modelType === 'general' || p.type === 'general' || (!p.modelType && (p.type === 'image' || p.type === 'universal'))) && p.isEnabled) {
                                const is3D = p.modelType?.includes('3d') && !p.modelType?.includes('image');
                                if (p.selectedModels && p.selectedModels.length > 0) {
                                    p.selectedModels.forEach(mId => {
                                        imageModels.push({ id: mId, providerId: p.id, providerName: p.displayName || p.name, is3DProvider: is3D, displayLabel: is3D ? get3DModelLabel(mId) : undefined });
                                    });
                                } else if (p.selectedModel) {
                                    imageModels.push({ id: p.selectedModel, providerId: p.id, providerName: p.displayName || p.name, is3DProvider: is3D, displayLabel: is3D ? get3DModelLabel(p.selectedModel) : undefined });
                                }
                            }
                        });
                        setDiscoveredModels(imageModels);
                    }
                }}
            />
        </div>
    );
}
