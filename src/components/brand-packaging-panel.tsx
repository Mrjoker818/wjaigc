'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Package, X, Minus, Maximize2, Plus, Trash2, Star,
  Upload, Image, FileText, Layers, DollarSign, CheckCircle2,
  ChevronDown, ChevronUp, Settings2, Sparkles, Download,
  Send, Palette, Box, Ruler, Paintbrush, FileImage, Search,
  Grid3X3, LayoutGrid, Store, ShoppingBag, BookOpen, BarChart3,
  Tag, Info, Loader2, Type, Scissors, PenLine, Video, GitBranch
} from 'lucide-react';
import { getModelDisplayName } from '@/lib/model-name-map';
import { constrainFloatingPanelPosition, getFloatingPanelViewport, subscribeFloatingPanelViewport } from '@/lib/floating-panel-position';

/* ============================================================
   类型定义
   ============================================================ */
export type PackagingCategory = 'beauty' | 'food' | 'drink' | 'wine' | 'daily' | 'gift' | 'pet' | 'health' | 'electronics' | 'home' | 'maternal' | 'stationery' | 'apparel' | 'toy' | 'tea' | 'coffee' | 'snack' | 'condiment' | 'jewelry' | 'automotive';
export type PackagingOutputMode = 'package_render' | 'visual_flat_layout' | 'structural_flat_layout' | 'knife_template' | 'line_drawing' | 'scene_display' | 'shelf_display' | 'ecommerce_image' | 'series_family' | 'roaming_video' | 'model_3d' | 'flow_chart';

export interface PackagingSku {
  id: string;
  name: string;
  spec: string;
  isHero: boolean;
}

export interface BrandAssets {
  logoUrl?: string;
  brandColors: string[];
  fontStyle?: string;
  patterns: string[];
}

export interface PackagingStructure {
  type: string;
  length?: number;
  width?: number;
  height?: number;
  capacity?: string;
  netContent?: string;
  insertTray?: string;
  handleRope?: string;
  windowType?: string;
}

export interface PackagingMaterialCraft {
  materials: string[];
  crafts: string[];
  costLevel?: 'low' | 'medium' | 'high';
}

export interface PackagingAdvancedOptions {
  enableCopywriting: boolean;
  enableInfoLayout: boolean;
  enableBrandConsistency: boolean;
  enableCostAnalysis: boolean;
  enableFeasibilityAnalysis: boolean;
  enableDecompose: boolean;
}

export interface PackagingResult {
  id: string;
  type: PackagingOutputMode;
  url: string;
  prompt?: string;
}

export interface PackagingAnalysis {
  brandRecognition: number;
  shelfImpact: number;
  premiumFeeling: number;
  feasibility: number;
  printComplexity: number;
  costLevel: string;
  suggestions: string[];
}

interface Props {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[], meta?: { modelName?: string; apiProvider?: string }) => void;
}

/* ============================================================
   常量
   ============================================================ */
const CATEGORIES: { value: PackagingCategory; label: string; subLabels?: string[] }[] = [
  { value: 'beauty', label: '美妆 / 护肤', subLabels: ['精华液', '面霜', '面膜', '口红', '粉底', '香水', '眼影', '卸妆'] },
  { value: 'food', label: '食品', subLabels: ['休闲食品', '烘焙糕点', '速食', '干货', '有机食品', '冷冻食品'] },
  { value: 'snack', label: '零食 / 糖果', subLabels: ['坚果', '巧克力', '薯片', '果冻', '饼干', '蜜饯', '肉干'] },
  { value: 'drink', label: '饮品', subLabels: ['果汁', '气泡水', '乳饮料', '功能饮料', '奶茶', '植物蛋白饮'] },
  { value: 'tea', label: '茶叶', subLabels: ['绿茶', '红茶', '普洱', '花茶', '白茶', '乌龙茶', '茶礼盒'] },
  { value: 'coffee', label: '咖啡', subLabels: ['挂耳咖啡', '咖啡豆', '速溶咖啡', '胶囊咖啡', '手冲套装'] },
  { value: 'wine', label: '酒水', subLabels: ['白酒', '红酒', '洋酒', '啤酒', '果酒', '威士忌', '香槟'] },
  { value: 'condiment', label: '调味品', subLabels: ['酱油', '食用油', '酱料', '香料', '调味汁', '食盐'] },
  { value: 'daily', label: '日化', subLabels: ['洗发水', '沐浴露', '洗衣液', '牙膏', '洗手液', '柔顺剂'] },
  { value: 'gift', label: '礼盒', subLabels: ['中秋礼盒', '年货礼盒', '婚庆礼盒', '商务礼盒', '节日限定'] },
  { value: 'pet', label: '宠物', subLabels: ['猫粮', '狗粮', '宠物零食', '宠物用品', '猫砂', '宠物保健'] },
  { value: 'health', label: '保健', subLabels: ['维生素', '益生菌', '蛋白粉', '鱼油', '胶原蛋白', '中药饮片'] },
  { value: 'electronics', label: '电子 / 数码', subLabels: ['手机配件', '耳机', '智能穿戴', '充电器', '数据线', '存储设备'] },
  { value: 'home', label: '家居', subLabels: ['香薰蜡烛', '收纳盒', '家纺', '清洁用品', '餐具', '装饰摆件'] },
  { value: 'maternal', label: '母婴', subLabels: ['奶粉', '纸尿裤', '婴儿洗护', '辅食', '孕产用品', '童装'] },
  { value: 'stationery', label: '文具', subLabels: ['笔记本', '笔具', '手账', '文创周边', '书包', '文件夹'] },
  { value: 'apparel', label: '服装', subLabels: ['T恤', '牛仔裤', '羽绒服', '内衣', '袜子', '配饰'] },
  { value: 'toy', label: '玩具', subLabels: ['积木', '毛绒玩具', '益智玩具', '模型', '盲盒', '手办'] },
  { value: 'jewelry', label: '珠宝首饰', subLabels: ['戒指', '项链', '手链', '耳饰', '胸针', '手表'] },
  { value: 'automotive', label: '汽车用品', subLabels: ['车载香水', '行车记录仪', '脚垫', '座套', '清洁护理'] },
];

const PACKAGING_TYPES = [
  // 纸盒类
  '插舌盒', '天地盖盒', '抽屉盒', '翻盖盒', '书型盒', '对开门盒', '异形盒',
  // 软包装类
  '自立袋', '三边封袋', '八边封袋', '吸嘴袋', '铝箔袋',
  // 管/瓶类
  '软管', '瓶身标签', '喷雾瓶', '滴管瓶', '广口瓶', '窄口瓶',
  // 罐/桶类
  '铁罐', '纸罐', '塑料罐',
  // 套装类
  '礼盒套装', '手提袋', '内托+外盒',
];

const MATERIALS = [
  '白卡纸', '铜版纸', '牛皮纸', '特种纸', '瓦楞纸', '灰板纸', '珠光纸', '黑卡纸',
  'PET', 'PP', 'PE', '磨砂亚克力',
  '马口铁', '铝合金',
  '玻璃', '陶瓷',
  '甘蔗渣', '竹纤维', '可降解PLA',
];

const CRAFTS = ['烫金', '烫银', 'UV', '局部UV', '压纹', '浮雕', '击凸', '模切', '镭射', '光油', '哑油', '丝印', '覆膜', '起凸', '压暗', '热转印', '击烫', '水晶标', '其他'];

// === 升级：包装类型分组过滤（packaging-cmf-finishes-skill 整合 — 渐进式，不破坏原有平铺结构）===
const PACKAGING_TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: '全部', types: [] }, // 空数组代表全部
  { label: '纸盒', types: ['插舌盒', '天地盖盒', '抽屉盒', '翻盖盒', '书型盒', '对开门盒', '异形盒'] },
  { label: '软包装', types: ['自立袋', '三边封袋', '八边封袋', '吸嘴袋', '铝箔袋'] },
  { label: '管/瓶', types: ['软管', '瓶身标签', '喷雾瓶', '滴管瓶', '广口瓶', '窄口瓶'] },
  { label: '罐/桶', types: ['铁罐', '纸罐', '塑料罐'] },
  { label: '套装', types: ['礼盒套装', '手提袋', '内托+外盒'] },
];

// === 升级：showcase-series 镜头节奏预设（packaging-showcase-series-skill 整合 — 作为 series_family 的可选增强模式）===
type ShowcaseSpec = 'standard' | 'compact' | 'full';
const SHOWCASE_PRESETS: Record<ShowcaseSpec, { label: string; count: number; shots: string[] }> = {
  compact: {
    label: '精简 6 张',
    count: 6,
    shots: ['英雄主图', '正面平铺', '工艺微距', '细节特写', '生活场景', '系列展示'],
  },
  standard: {
    label: '标准 10 张',
    count: 10,
    shots: ['英雄主图', '正面展示', '系列组合', '结构说明', '工艺微距', '细节特写', '生活场景', '系列家族', '平铺全览', '收尾全景'],
  },
  full: {
    label: '完整 14 张',
    count: 14,
    shots: ['英雄主图', '正面展示', '背面展示', '系列组合', '结构爆炸', '工艺微距', '细节特写1', '细节特写2', '生活场景', '货架陈列', '系列家族', '平铺全览', '礼品场景', '收尾全景'],
  },
};

// === 升级：调研助手快捷动作（packaging-design-research-skill 整合 — 可选折叠面板）===
const RESEARCH_QUICK_ACTIONS = [
  { key: 'competitor', label: '竞品格局速览', prompt: '分析{brandName} {category}品类的竞品包装设计特征，提炼关键设计方向与差异化机会' },
  { key: 'trend', label: '设计趋势推荐', prompt: '推荐当前{category}品类包装设计的3个核心趋势，给出可落地的视觉方向建议' },
  { key: 'cmf_direction', label: 'CMF方向建议', prompt: '针对{brandName} {productName}产品，推荐最适合的包装材质(Material)、色彩(Color)与表面工艺(Finish)组合方案，并说明推荐理由' },
  { key: 'brief', label: '生成AI Brief', prompt: '为{brandName} {productName} {category}产品包装生成一份完整的设计简报(Brief)，包含：品牌定位、目标消费者、设计方向、禁忌事项、参考风格' },
];

const OUTPUT_MODES: { value: PackagingOutputMode; label: string; icon: React.ReactNode }[] = [
  { value: 'package_render', label: '包装效果图', icon: <Package size={14} /> },
  { value: 'visual_flat_layout', label: '视觉展开图', icon: <LayoutGrid size={14} /> },
  { value: 'structural_flat_layout', label: '结构展开图', icon: <Grid3X3 size={14} /> },
  { value: 'knife_template', label: '刀版图', icon: <Scissors size={14} /> },
  { value: 'line_drawing', label: '线稿图', icon: <PenLine size={14} /> },
  { value: 'scene_display', label: '场景展示', icon: <Image size={14} /> },
  { value: 'shelf_display', label: '货架陈列', icon: <Store size={14} /> },
  { value: 'ecommerce_image', label: '电商主图', icon: <ShoppingBag size={14} /> },
  { value: 'series_family', label: '系列包装', icon: <Layers size={14} /> },
  { value: 'roaming_video', label: '漫游视频', icon: <Video size={14} /> },
  { value: 'model_3d', label: '3D模型', icon: <Box size={14} /> },
  { value: 'flow_chart', label: '包装流程图', icon: <GitBranch size={14} /> },
];

const ADVANCED_TOOLS = [
  { key: 'enableDecompose', label: '包装拆解', icon: <Layers size={14} /> },
  { key: 'enableCopywriting', label: '文案生成', icon: <FileText size={14} /> },
  { key: 'enableInfoLayout', label: '信息区布局', icon: <LayoutGrid size={14} /> },
  { key: 'enableBrandConsistency', label: '品牌一致性', icon: <Palette size={14} /> },
  { key: 'enableCostAnalysis', label: '成本等级', icon: <DollarSign size={14} /> },
  { key: 'enableFeasibilityAnalysis', label: '可落地评估', icon: <CheckCircle2 size={14} /> },
];

const INSERT_TRAY_OPTIONS = ['无内托', '纸托', 'EVA内托', '吸塑内托', '海绵内托', '绸布内衬', '瓦楞隔板', '珍珠棉'];
const HANDLE_ROPE_OPTIONS = ['无', '棉绳', '丝带', '皮绳', '织带', '金属链', '竹提手', '纸绳'];
const WINDOW_OPTIONS = ['否', '透明开窗', '异形开窗', '镂空透窗', '半透明磨砂窗'];

const EXTEND_SCENES = ['电商主图', '礼盒套装', '节日限定', '旅行便携', '会员专享', '联名款', '限定款', '环保概念', '高奢礼赠', '日常家用', '商务定制', '活动促销'];

/* ============================================================
   Prompt 模板
   ============================================================ */
function buildPackagingPrompt(state: {
  brandName: string;
  productName: string;
  category: PackagingCategory;
  structure: PackagingStructure;
  materialCraft: PackagingMaterialCraft;
  outputModes: PackagingOutputMode[];
  skuMatrix: PackagingSku[];
  extendScenes?: string[];
  customPrompt?: string;
}): string {
  const categoryLabel = CATEGORIES.find(c => c.value === state.category)?.label || state.category;
  const outputLabels = state.outputModes.map(m => OUTPUT_MODES.find(o => o.value === m)?.label || m).join('、');
  const extendInfo = state.extendScenes?.length ? `延展场景：${state.extendScenes.join('、')}` : '';
  return `为品牌「${state.brandName}」设计一套商业级包装。
产品名称：${state.productName}
品类：${categoryLabel}
包装结构：${state.structure.type || '未指定'}
规格尺寸：${state.structure.length ?? '?'}×${state.structure.width ?? '?'}×${state.structure.height ?? '?'}mm
材质：${state.materialCraft.materials.join('、') || '未指定'}
工艺：${state.materialCraft.crafts.join('、') || '未指定'}
${extendInfo}
设计要求：
1. 包装需要具有真实商业落地感。
2. 保持品牌名清晰可见。
3. 视觉风格高级、干净、专业。
4. 材质表现真实，包括纸张、哑膜、烫金、压纹、局部UV等细节。
5. 输出适合品牌提案、电商展示和线下货架展示。
6. 不要生成乱码文字，不要出现错误品牌名，不要出现无关品牌。
输出方向：${outputLabels}
${state.customPrompt ? `\n附加要求：${state.customPrompt}` : ''}`;
}

/* ============================================================
   组件
   ============================================================ */
export default function BrandPackagingPanel({ isMonochrome = false, onClose, onAddImages }: Props) {
  // === Window drag state ===
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [windowPos, setWindowPos] = useState({ x: 40, y: 40 });

  const [panelViewport, setPanelViewport] = useState(getFloatingPanelViewport);
  const compactPanel = panelViewport.width < 1024 || panelViewport.height < 600;
  const panelInset = compactPanel ? 8 : 40;
  const panelWidth = isMinimized ? Math.min(340, Math.max(0, panelViewport.width - 16)) : Math.max(0, panelViewport.width - panelInset * 2);
  const panelHeight = isMinimized ? 56 : Math.max(0, panelViewport.height - panelInset * 2);
  const boundedPosition = constrainFloatingPanelPosition({
    x: windowPos.x - panelViewport.left, y: windowPos.y - panelViewport.top,
    viewportWidth: panelViewport.width, viewportHeight: panelViewport.height,
    panelWidth, panelHeight, margin: 8,
  });
  const panelLeft = panelViewport.left + boundedPosition.x;
  const panelTop = panelViewport.top + boundedPosition.y;

  useEffect(() => subscribeFloatingPanelViewport(() => {
    setPanelViewport(getFloatingPanelViewport());
  }), []);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // === Sidebar tab ===
  const [sidebarTab, setSidebarTab] = useState<'projects' | 'templates' | 'history'>('projects');

  // === Model selection ===
  const [imageModels, setImageModels] = useState<{ id: string; name: string; providerId: string; providerName: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [chatModels, setChatModels] = useState<{ id: string; name: string; providerId: string; providerName: string }[]>([]);
  const [selectedChatModel, setSelectedChatModel] = useState('');
  const [selectedChatProviderId, setSelectedChatProviderId] = useState('');

  // === Form state ===
  const [brandName, setBrandName] = useState('');
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState<PackagingCategory>('beauty');
  const [skuMatrix, setSkuMatrix] = useState<PackagingSku[]>([
    { id: '1', name: '基础版', spec: '100g', isHero: true },
  ]);
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [structure, setStructure] = useState<PackagingStructure>({ type: '天地盖盒' });
  const [materialCraft, setMaterialCraft] = useState<PackagingMaterialCraft>({ materials: [], crafts: [] });
  const [extendScenes, setExtendScenes] = useState<string[]>([]);
  const [uploads, setUploads] = useState<{ type: string; url: string; name: string }[]>([]);
  // P3-6: 追踪本地创建的 Blob URL，组件卸载时统一回收，避免内存泄漏
  const blobUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const set = blobUrlsRef.current;
    return () => {
      set.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* noop */ } });
      set.clear();
    };
  }, []);
  const [outputModes, setOutputModes] = useState<PackagingOutputMode[]>(['package_render']);
  const [advancedOptions, setAdvancedOptions] = useState<PackagingAdvancedOptions>({
    enableCopywriting: false,
    enableInfoLayout: false,
    enableBrandConsistency: true,
    enableCostAnalysis: false,
    enableFeasibilityAnalysis: false,
    enableDecompose: false,
  });
  const [customPrompt, setCustomPrompt] = useState('');
  const [exportFormat, setExportFormat] = useState<'PNG' | 'SVG' | 'PDF' | 'AI'>('PNG');

  // === 升级：调研助手 state（packaging-design-research-skill 整合）===
  const [showResearchPanel, setShowResearchPanel] = useState(false);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchSuggestion, setResearchSuggestion] = useState('');
  const [researchActionKey, setResearchActionKey] = useState('');

  // === 升级：CMF 精准模式 state（packaging-cmf-finishes-skill 整合）===
  const [typeGroupFilter, setTypeGroupFilter] = useState('全部');
  const [cmfModeEnabled, setCmfModeEnabled] = useState(false);
  const [cmfLoading, setCmfLoading] = useState(false);
  const [cmfSuggestion, setCmfSuggestion] = useState('');
  const [showCmfSuggestion, setShowCmfSuggestion] = useState(false);

  // === 升级：showcase 系列规格 state（packaging-showcase-series-skill 整合）===
  const [showcaseSpec, setShowcaseSpec] = useState<ShowcaseSpec>('standard');

  // === Results state ===
  const [results, setResults] = useState<PackagingResult[]>([]);
  const [analysis, setAnalysis] = useState<PackagingAnalysis | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeResultTab, setActiveResultTab] = useState<'all' | 'favorites' | 'optimize'>('all');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // === Search state ===
  const [searchQuery, setSearchQuery] = useState('');

  // Theme — 品牌包装系统: 标准黑金配色 (#d4af37 + #1a1a1a)
  const accent = isMonochrome ? '#3b82f6' : '#d4af37';
  const accentLight = isMonochrome ? '#60a5fa' : '#e0b840';
  const bg = isMonochrome ? '#ffffff' : '#1a1a1a';
  const bgSoft = isMonochrome ? '#f9fafb' : '#111';
  const bgPanel = isMonochrome ? 'rgba(249,250,251,0.95)' : 'rgba(26,26,26,0.92)';
  const bgCard = isMonochrome ? '#f3f4f6' : 'rgba(17,17,17,0.9)';
  const border = isMonochrome ? '#e5e5e5' : 'rgba(255,255,255,0.1)';
  const borderStrong = isMonochrome ? '#3b82f6' : 'rgba(212,175,55,0.4)';
  const textPrimary = isMonochrome ? '#111827' : '#e5e5e5';
  const textMuted = isMonochrome ? '#6b7280' : '#888';
  const textAccent = isMonochrome ? '#3b82f6' : '#d4af37';

  // === Drag handlers ===
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragOffset({ x: e.clientX - panelLeft, y: e.clientY - panelTop });
  }, [panelLeft, panelTop]);

  // === Load image models ===
  useEffect(() => {
    fetch('/api/models?type=image')
      .then(r => r.json())
      .then(data => {
        const providers: { id: string; name: string; isEnabled?: boolean }[] = data.providers || [];
        const enabledProviderIds = new Set(providers.filter(p => p.isEnabled !== false).map(p => p.id));
        const providerMap = new Map(providers.map((p: { id: string; name: string }) => [p.id, p]));
        const modelList: { id: string; name: string; providerId?: string }[] = (data.models || []).filter(
          (m: { providerId?: string }) => enabledProviderIds.has(m.providerId || '')
        );
        if (modelList.length) {
          const mapped = modelList.map(m => ({
            id: m.id,
            name: m.name,
            providerId: m.providerId || '',
            providerName: providerMap.get(m.providerId || '')?.name || '',
          }));
          setImageModels(mapped);
          // Read saved model from localStorage (same key as generation-panel)
          const saved = localStorage.getItem('wujie_selected_image_model');
          if (saved) {
            const pureModel = saved.includes('::') ? saved.split('::')[1] : saved;
            const savedProvId = saved.includes('::') ? saved.split('::')[0] : '';
            if (mapped.some(m => m.id === pureModel)) {
              setSelectedModel(pureModel);
              setSelectedProviderId(savedProvId);
            } else {
              setSelectedModel(mapped[0].id);
              setSelectedProviderId(mapped[0].providerId);
            }
          } else {
            setSelectedModel(mapped[0].id);
            setSelectedProviderId(mapped[0].providerId);
          }
        }
      })
      .catch(() => {});
  }, []);

  // === Load chat models ===
  useEffect(() => {
    fetch('/api/models?type=chat')
      .then(r => r.json())
      .then(data => {
        const providers: { id: string; name: string; isEnabled?: boolean }[] = data.providers || [];
        const enabledProviderIds = new Set(providers.filter(p => p.isEnabled !== false).map(p => p.id));
        const providerMap = new Map(providers.map((p: { id: string; name: string }) => [p.id, p]));
        const modelList: { id: string; name: string; providerId?: string }[] = (data.models || []).filter(
          (m: { providerId?: string }) => enabledProviderIds.has(m.providerId || '')
        );
        if (modelList.length) {
          const mapped = modelList.map(m => ({
            id: m.id,
            name: m.name,
            providerId: m.providerId || '',
            providerName: providerMap.get(m.providerId || '')?.name || '',
          }));
          setChatModels(mapped);
          const saved = localStorage.getItem('wujie_selected_chat_model');
          if (saved) {
            const pureModel = saved.includes('::') ? saved.split('::')[1] : saved;
            const savedProvId = saved.includes('::') ? saved.split('::')[0] : '';
            if (mapped.some(m => m.id === pureModel)) {
              setSelectedChatModel(pureModel);
              setSelectedChatProviderId(savedProvId);
            } else {
              setSelectedChatModel(mapped[0].id);
              setSelectedChatProviderId(mapped[0].providerId);
            }
          } else {
            setSelectedChatModel(mapped[0].id);
            setSelectedChatProviderId(mapped[0].providerId);
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => setWindowPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    const handleUp = () => {
      setWindowPos({ x: panelLeft, y: panelTop });
      setIsDragging(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [isDragging, dragOffset, panelLeft, panelTop]);

  // === SKU management ===
  const addSku = () => {
    setSkuMatrix(prev => [...prev, { id: Date.now().toString(), name: `SKU ${prev.length + 1}`, spec: '', isHero: false }]);
  };
  const removeSku = (id: string) => setSkuMatrix(prev => prev.filter(s => s.id !== id));
  const updateSku = (id: string, field: keyof PackagingSku, value: string | boolean) => {
    setSkuMatrix(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  // === Material / Craft toggle ===
  const toggleMaterial = (m: string) => {
    setMaterialCraft(prev => ({
      ...prev,
      materials: prev.materials.includes(m) ? prev.materials.filter(x => x !== m) : [...prev.materials, m],
    }));
  };
  const toggleCraft = (c: string) => {
    setMaterialCraft(prev => ({
      ...prev,
      crafts: prev.crafts.includes(c) ? prev.crafts.filter(x => x !== c) : [...prev.crafts, c],
    }));
  };

  const toggleExtendScene = (s: string) => {
    setExtendScenes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  // === Output mode toggle ===
  const toggleOutputMode = (mode: PackagingOutputMode) => {
    setOutputModes(prev => prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]);
  };

  // === Upload handler ===
  const handleUpload = (type: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      blobUrlsRef.current.add(url); // P3-6: 追踪以备 revoke
      if (type === 'Logo') setLogoUrl(url);
      else setUploads(prev => [...prev, { type, url, name: file.name }]);
    };
    input.click();
  };

  // === Generate ===
  const handleGenerate = useCallback(async () => {
    setErrorMsg('');
    if (!brandName.trim()) return;
    setIsGenerating(true);
    try {
      const prompt = buildPackagingPrompt({ brandName, productName, category, structure, materialCraft, outputModes, skuMatrix, extendScenes, customPrompt });
      const res = await fetch('/api/brand-packaging/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName, productName, category, skuMatrix,
          brandAssets: { logoUrl, brandColors },
          structure, materialCraft, uploads, extendScenes,
          outputModes, advancedOptions, prompt, exportFormat,
          model: selectedModel,
          providerId: selectedProviderId,
          chatModel: selectedChatModel,
          chatProviderId: selectedChatProviderId,
          showcaseSpec,
          quality: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).quality : undefined; } catch { return undefined; } })(),
          aspectRatio: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).aspectRatio : undefined; } catch { return undefined; } })(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg('生成失败: ' + (data.error || '未知错误'));
        setIsGenerating(false);
        return;
      }
      if (data.taskId) {
        // Poll for results via /api/poll-task (POST) — standard task polling mechanism
        const taskId = data.taskId;
        const poll = async () => {
          try {
            const taskRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: selectedModel, providerId: selectedProviderId }),
            });
            const taskData = await taskRes.json();
            if (taskData.status === 'completed') {
              const imageUrls: string[] = taskData.result?.imageUrls || taskData.imageUrls || [];
              if (imageUrls.length > 0) {
                const newResults: PackagingResult[] = imageUrls.map((url: string, i: number) => ({
                  id: `${taskId}_${i}`,
                  type: outputModes[i % outputModes.length] || 'package_render',
                  url,
                  prompt: taskData.result?.prompt,
                }));
                setResults(prev => [...prev, ...newResults]);
                // Auto-add to canvas
                onAddImages?.(imageUrls, { modelName: selectedModel, apiProvider: selectedProviderId });
              }
              // Generate mock analysis for display
              setAnalysis({
                brandRecognition: Math.round(70 + Math.random() * 25),
                shelfImpact: Math.round(65 + Math.random() * 30),
                premiumFeeling: Math.round(60 + Math.random() * 35),
                feasibility: Math.round(55 + Math.random() * 40),
                printComplexity: Math.round(30 + Math.random() * 50),
                costLevel: materialCraft.costLevel || 'medium',
                suggestions: [
                  '建议加强品牌色在主视觉面的面积占比',
                  '烫金工艺可提升高级感，但会增加印刷成本',
                  '建议在侧面增加产品卖点信息区',
                ],
              });
              setIsGenerating(false);
            } else if (taskData.status === 'failed') {
              setIsGenerating(false);
              setErrorMsg('生成失败: ' + (taskData.error || '未知错误'));
            } else {
              setTimeout(poll, 3000);
            }
          } catch { setIsGenerating(false); }
        };
        poll();
      } else if (data.results) {
        setResults(data.results);
        if (data.analysis) setAnalysis(data.analysis);
        setIsGenerating(false);
      } else {
        setIsGenerating(false);
      }
    } catch (e) {
      console.error('[brand-packaging] Generate failed:', e);
      setIsGenerating(false);
    }
  }, [brandName, productName, category, structure, materialCraft, outputModes, skuMatrix, extendScenes, customPrompt, logoUrl, brandColors, uploads, advancedOptions, onAddImages, selectedModel, selectedProviderId, selectedChatModel, selectedChatProviderId, showcaseSpec]);

  // === Generate same series ===
  const handleGenerateSeries = useCallback(async () => {
    if (results.length === 0) return;
    setIsGenerating(true);
    try {
      const seriesPrompt = buildPackagingPrompt({ brandName, productName, category, structure, materialCraft, outputModes: ['series_family'], skuMatrix, extendScenes, customPrompt: (customPrompt || '') + ' 同系列不同SKU变体包装设计，保持统一品牌视觉语言' });
      const res = await fetch('/api/brand-packaging/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName, productName, category, skuMatrix,
          brandAssets: { logoUrl, brandColors },
          structure, materialCraft, uploads,
          outputModes: ['series_family'], advancedOptions, prompt: seriesPrompt,
          model: selectedModel,
          providerId: selectedProviderId,
          chatModel: selectedChatModel,
          chatProviderId: selectedChatProviderId,
          showcaseSpec,
          quality: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).quality : undefined; } catch { return undefined; } })(),
          aspectRatio: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).aspectRatio : undefined; } catch { return undefined; } })(),
        }),
      });
      const data = await res.json();
      if (data.taskId) {
        const poll = async () => {
          try {
            const taskRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: data.taskId, model: selectedModel, providerId: selectedProviderId }),
            });
            const taskData = await taskRes.json();
            if (taskData.status === 'completed') {
              const imageUrls: string[] = taskData.result?.imageUrls || taskData.imageUrls || [];
              if (imageUrls.length > 0) {
                const newResults = imageUrls.map((url: string, i: number) => ({
                  id: `series_${data.taskId}_${i}`,
                  type: 'series_family' as const,
                  url,
                  prompt: seriesPrompt,
                }));
                setResults(prev => [...prev, ...newResults]);
                onAddImages?.(imageUrls, { modelName: selectedModel, apiProvider: selectedProviderId });
              }
              setIsGenerating(false);
            } else if (taskData.status === 'failed') {
              setIsGenerating(false);
            } else {
              setTimeout(poll, 3000);
            }
          } catch { setIsGenerating(false); }
        };
        poll();
      } else {
        setIsGenerating(false);
      }
    } catch (e) {
      console.error('[brand-packaging] Series generation failed:', e);
      setIsGenerating(false);
    }
  }, [brandName, productName, category, structure, materialCraft, skuMatrix, extendScenes, customPrompt, logoUrl, brandColors, uploads, advancedOptions, results, onAddImages, selectedModel, selectedProviderId, selectedChatModel, selectedChatProviderId]);

  // === Generate scene display ===
  const handleGenerateScene = useCallback(async () => {
    if (results.length === 0) return;
    setIsGenerating(true);
    try {
      const scenePrompt = buildPackagingPrompt({ brandName, productName, category, structure, materialCraft, outputModes: ['scene_display'], skuMatrix, extendScenes, customPrompt: (customPrompt || '') + ' 产品在货架/展厅/电商场景中的实景展示效果图' });
      const res = await fetch('/api/brand-packaging/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName, productName, category, skuMatrix,
          brandAssets: { logoUrl, brandColors },
          structure, materialCraft, uploads,
          outputModes: ['scene_display'], advancedOptions, prompt: scenePrompt,
          model: selectedModel,
          providerId: selectedProviderId,
          chatModel: selectedChatModel,
          chatProviderId: selectedChatProviderId,
          quality: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).quality : undefined; } catch { return undefined; } })(),
          aspectRatio: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).aspectRatio : undefined; } catch { return undefined; } })(),
        }),
      });
      const data = await res.json();
      if (data.taskId) {
        const poll = async () => {
          try {
            const taskRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: data.taskId, model: selectedModel, providerId: selectedProviderId }),
            });
            const taskData = await taskRes.json();
            if (taskData.status === 'completed') {
              const imageUrls: string[] = taskData.result?.imageUrls || taskData.imageUrls || [];
              if (imageUrls.length > 0) {
                const newResults = imageUrls.map((url: string, i: number) => ({
                  id: `scene_${data.taskId}_${i}`,
                  type: 'scene_display' as const,
                  url,
                  prompt: scenePrompt,
                }));
                setResults(prev => [...prev, ...newResults]);
                onAddImages?.(imageUrls, { modelName: selectedModel, apiProvider: selectedProviderId });
              }
              setIsGenerating(false);
            } else if (taskData.status === 'failed') {
              setIsGenerating(false);
            } else {
              setTimeout(poll, 3000);
            }
          } catch { setIsGenerating(false); }
        };
        poll();
      } else {
        setIsGenerating(false);
      }
    } catch (e) {
      console.error('[brand-packaging] Scene generation failed:', e);
      setIsGenerating(false);
    }
  }, [brandName, productName, category, structure, materialCraft, skuMatrix, extendScenes, customPrompt, logoUrl, brandColors, uploads, advancedOptions, results, onAddImages, selectedModel, selectedProviderId, selectedChatModel, selectedChatProviderId]);

  // === Download image ===
  const handleDownloadImage = useCallback(async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('[brand-packaging] Download failed:', e);
    }
  }, []);

  // === Toggle favorite ===
  const toggleFavorite = (id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // === Render helpers ===
  const inputCls = `w-full rounded-lg border px-3 py-2 text-xs outline-none transition-colors ${isMonochrome ? 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-200' : 'bg-black/30 border-white/10 text-amber-50 placeholder:text-white/30 focus:border-amber-400/60 focus:ring-1 focus:ring-amber-400/20'}`;
  const selectCls = inputCls;
  const tagBtnCls = (active: boolean) => `rounded-lg border px-3 py-1.5 text-xs cursor-pointer transition-all ${active ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/15 text-amber-200') : (isMonochrome ? 'border-gray-200 bg-gray-50 text-gray-500 hover:border-blue-300' : 'border-white/10 bg-black/30 text-white/60 hover:border-amber-400/40')}`;
  const panelCls = `rounded-xl border p-4 ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#111]/90 border-white/[0.08]'}`;
  const stepBadgeCls = `flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-bold ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'}`;

  const filteredResults = useMemo(() => {
    if (activeResultTab === 'favorites') return results.filter(r => favorites.has(r.id));
    if (activeResultTab === 'optimize') return results; // placeholder
    return results;
  }, [results, activeResultTab, favorites]);

  // === RENDER ===
  return createPortal(
    <div className="fixed z-[200] flex items-start justify-start" style={{ pointerEvents: 'auto', ...(isMinimized ? { left: panelLeft, top: panelTop } : { inset: 0 }) }}>
      {!isMinimized && <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />}

      <div
        data-popup
        className="relative flex min-w-0 flex-col rounded-xl overflow-hidden shadow-2xl border [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:whitespace-nowrap [&_select]:min-h-11 [&_select]:min-w-0 [&_select]:max-w-full [&_input]:min-h-11 [&_input]:min-w-0 [&_textarea]:min-h-11 [&_textarea]:min-w-0 [&_svg]:shrink-0 max-sm:[&_input]:text-base max-sm:[&_select]:text-base max-sm:[&_textarea]:text-base"
        style={{
          width: panelWidth,
          height: panelHeight,
          background: bg,
          borderColor: isMonochrome ? '#e5e5e5' : 'rgba(212,175,55,0.3)',
          ...(isMinimized ? {} : { left: panelLeft, top: panelTop }),
          ...(isDragging ? { outline: `2px solid ${accent}`, outlineOffset: '-2px' } : {}),
        }}
        onMouseDown={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        {/* === Title bar (draggable) === */}
        <div
          data-panel-header
          className="flex min-w-0 items-center justify-between gap-2 px-3 shrink-0 cursor-move select-none"
          style={{ height: 54, background: isMonochrome ? '#f9fafb' : '#111', borderBottom: isMinimized ? 'none' : (isMonochrome ? '1px solid #e5e5e5' : '1px solid rgba(212,175,55,0.3)') }}
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-2">
            <Package size={14} style={{ color: accent }} />
            <span className="whitespace-nowrap text-sm font-medium" style={{ color: textAccent }}>品牌包装系统 Pro</span>
          </div>
          <div className="flex items-center gap-1">
            <button className={`w-11 h-11 shrink-0 flex items-center justify-center rounded transition-colors ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-white/10'}`} onClick={() => setIsMinimized(!isMinimized)} title={isMinimized ? '展开' : '最小化'} aria-label={isMinimized ? '展开品牌包装系统' : '最小化品牌包装系统'} onMouseDown={e => e.stopPropagation()}>
              {isMinimized ? <Maximize2 size={14} style={{ color: textMuted }} /> : <Minus size={14} style={{ color: textMuted }} />}
            </button>
            <button className={`w-11 h-11 shrink-0 flex items-center justify-center rounded transition-colors ${isMonochrome ? 'hover:bg-red-100' : 'hover:bg-red-500/30'}`} onClick={onClose} title="关闭" aria-label="关闭品牌包装系统" onMouseDown={e => e.stopPropagation()}>
              <X size={14} style={{ color: textMuted }} />
            </button>
          </div>
        </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:flex-row lg:overflow-hidden" style={{ display: isMinimized ? 'none' : undefined }}>
            <button className="flex shrink-0 items-center justify-between gap-2 px-4 py-2 text-sm lg:hidden" style={{ color: textAccent, borderBottom: `1px solid ${border}` }} onClick={() => setSidebarOpen(!sidebarOpen)} aria-expanded={sidebarOpen} aria-label="项目、模板与历史">
              项目、模板与历史 {sidebarOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {/* === LEFT SIDEBAR === */}
            <aside className={`w-full lg:w-[240px] shrink-0 border-b lg:border-b-0 lg:border-r ${sidebarOpen ? 'flex' : 'hidden'} lg:flex flex-col overflow-hidden`}
              style={{ background: isMonochrome ? '#f9fafb' : 'rgba(0,0,0,0.4)', borderColor: border }}
            >
              {/* New project button */}
              <div className="p-3">
                <button
                  className="w-full rounded-xl py-2.5 text-xs font-bold cursor-pointer transition-all"
                  style={{ background: isMonochrome ? '#3b82f6' : '#d4af37', color: isMonochrome ? '#fff' : '#000' }}
                >
                  + 新建项目
                </button>
              </div>

              {/* Tab switcher */}
              <div className="mx-3 mb-3 grid grid-cols-3 rounded-lg p-0.5 text-xs" style={{ background: isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.05)' }}>
                {(['projects', 'templates', 'history'] as const).map(tab => (
                  <button key={tab} className={`rounded-md py-1.5 cursor-pointer transition-colors ${sidebarTab === tab ? (isMonochrome ? 'bg-white text-blue-600 shadow-sm' : 'bg-amber-500/20 text-amber-200') : (isMonochrome ? 'text-gray-500' : 'text-white/50')}`}
                    onClick={() => setSidebarTab(tab)}>
                    {{ projects: '项目', templates: '模板', history: '历史' }[tab]}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="mx-3 mb-3 relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: textMuted }} />
                <input className={`${inputCls} pl-7`} placeholder="搜索项目或模板" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>

              {/* List placeholder */}
              <div className="flex-1 overflow-y-auto px-3">
                <div className="flex flex-col items-center justify-center py-10 text-xs" style={{ color: textMuted }}>
                  <Package size={24} className="mb-2 opacity-30" />
                  {sidebarTab === 'projects' && '暂无项目，点击新建开始'}
                  {sidebarTab === 'templates' && '模板库即将上线'}
                  {sidebarTab === 'history' && '暂无历史记录'}
                </div>
              </div>
            </aside>

            {/* === MAIN CONTENT === */}
            <main className="flex min-w-0 flex-none flex-col lg:min-h-0 lg:flex-1 lg:overflow-hidden">
              {/* Header */}
              <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-1 shrink-0" style={{ borderBottom: `1px solid ${border}` }}>
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold" style={{ color: textPrimary }}>品牌包装工作台</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: isMonochrome ? '#dbeafe' : 'rgba(212,175,55,0.15)', color: textAccent }}>Pro</span>
                </div>
                <div className="flex items-center gap-2">
                  <button className={`rounded-lg px-3 py-1.5 text-xs cursor-pointer transition-colors ${isMonochrome ? 'text-gray-500 hover:bg-gray-100' : 'text-white/50 hover:bg-white/5'}`}>
                    <BookOpen size={13} className="inline mr-1" />帮助
                  </button>
                </div>
              </header>

              {/* Workspace: left form + right results */}
              <div className="grid min-w-0 grid-cols-1 gap-4 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)] lg:overflow-hidden lg:p-4">
                {/* LEFT: Form area */}
                <div className="min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-2" data-toolbar>
                  {/* Step 1: Brand Assets */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>1</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>品牌资产与核心信息</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-2 mb-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-[12px] mb-1" style={{ color: textMuted }}>品牌名</label>
                        <input className={inputCls} placeholder="例如：山茶记" value={brandName} onChange={e => setBrandName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-[12px] mb-1" style={{ color: textMuted }}>产品名称</label>
                        <input className={inputCls} placeholder="例如：山茶花洁面乳" value={productName} onChange={e => setProductName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-[12px] mb-1" style={{ color: textMuted }}>品类</label>
                        <select className={selectCls} value={category} onChange={e => setCategory(e.target.value as PackagingCategory)}>
                          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Brand assets row */}
                    <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                      {/* SKU Matrix */}
                      <div className="rounded-lg border p-2.5" style={{ borderColor: border, background: bgCard }}>
                        <div className="text-[12px] font-semibold mb-2" style={{ color: textMuted }}>系列 SKU 矩阵</div>
                        <table className="w-full table-fixed text-[12px]">
                          <thead><tr style={{ color: textMuted }}>
                            <th className="py-1 text-left">SKU 名称</th>
                            <th className="py-1 text-left">规格</th>
                            <th className="py-1 text-center">主推</th>
                            <th className="py-1 text-center">操作</th>
                          </tr></thead>
                          <tbody>
                            {skuMatrix.map(sku => (
                              <tr key={sku.id} style={{ borderTop: `1px solid ${border}` }}>
                                <td className="py-1"><input className={`${inputCls} py-1 text-[12px]`} value={sku.name} onChange={e => updateSku(sku.id, 'name', e.target.value)} /></td>
                                <td className="py-1"><input className={`${inputCls} py-1 text-[12px]`} value={sku.spec} onChange={e => updateSku(sku.id, 'spec', e.target.value)} placeholder="100g" /></td>
                                <td className="py-1 text-center cursor-pointer" onClick={() => updateSku(sku.id, 'isHero', !sku.isHero)}>{sku.isHero ? <Star size={12} fill={accent} style={{ color: accent, margin: '0 auto' }} /> : '-'}</td>
                                <td className="py-1 text-center"><Trash2 size={11} className="cursor-pointer mx-auto" style={{ color: textMuted }} onClick={() => removeSku(sku.id)} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <button className="mt-2 text-[12px] cursor-pointer" style={{ color: textAccent }} onClick={addSku}>+ 新增 SKU</button>
                      </div>
                      {/* Logo + Colors + Font + Pattern */}
                      <div className="flex flex-wrap gap-2 xl:flex-col">
                        <button className="w-[72px] h-[72px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors"
                          style={{ borderColor: border, color: textMuted }}
                          onClick={() => handleUpload('Logo')}>
                          {logoUrl ? <img src={logoUrl} alt="品牌 Logo" className="w-full h-full object-contain rounded" /> : <><Upload size={14} /><span className="text-[9px] mt-0.5">Logo</span></>}
                        </button>
                        <div className="flex gap-1">
                          <input type="color" className="w-11 h-11 rounded cursor-pointer" value={brandColors[0] || '#d4af37'} onChange={e => setBrandColors([e.target.value])} title="品牌色" />
                          <input type="color" className="w-11 h-11 rounded cursor-pointer" value={brandColors[1] || '#000000'} onChange={e => setBrandColors(prev => [prev[0] || '#d4af37', e.target.value])} title="辅助色" />
                        </div>
                        <button className="w-[72px] h-[40px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors text-[9px]"
                          style={{ borderColor: border, color: textMuted }}
                          onClick={() => handleUpload('Font')}>
                          <Type size={10} />
                          <span className="mt-0.5">品牌字体</span>
                        </button>
                        <button className="w-[72px] h-[40px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors text-[9px]"
                          style={{ borderColor: border, color: textMuted }}
                          onClick={() => handleUpload('Pattern')}>
                          <Palette size={10} />
                          <span className="mt-0.5">品牌纹样</span>
                        </button>
                      </div>
                    </div>

                    {/* === 升级：调研助手（packaging-design-research-skill 整合 — 可选折叠，不影响主流程）=== */}
                    <div className="mt-3 rounded-lg border overflow-hidden" style={{ borderColor: border }}>
                      <button
                        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer transition-colors"
                        style={{ background: bgCard, color: textMuted }}
                        onClick={() => setShowResearchPanel(!showResearchPanel)}
                      >
                        <span className="text-[12px] flex items-center gap-1.5">
                          <BookOpen size={12} />
                          调研助手（可选）
                        </span>
                        <span className="text-[10px]">{showResearchPanel ? '▲ 收起' : '▼ 展开'}</span>
                      </button>
                      {showResearchPanel && (
                        <div className="p-3" style={{ background: bgSoft, borderTop: `1px solid ${border}` }}>
                          <p className="text-[11px] mb-2.5" style={{ color: textMuted }}>
                            基于品牌信息，AI 为你快速生成调研建议，可一键填充到设计要求
                          </p>
                          <div className="grid grid-cols-2 gap-1.5 mb-2.5">
                            {RESEARCH_QUICK_ACTIONS.map(action => (
                              <button
                                key={action.key}
                                className={`rounded-lg border px-2 py-1.5 text-[11px] cursor-pointer transition-colors text-left flex items-center gap-1.5 ${researchActionKey === action.key && researchLoading ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/10 text-amber-200') : (isMonochrome ? 'border-gray-200 text-gray-500 hover:border-blue-300' : 'border-white/10 text-white/50 hover:border-amber-400/40')}`}
                                disabled={researchLoading}
                                onClick={async () => {
                                  if (!brandName) { alert('请先填写品牌名'); return; }
                                  setResearchLoading(true);
                                  setResearchActionKey(action.key);
                                  setResearchSuggestion('');
                                  try {
                                    const prompt = action.prompt
                                      .replace('{brandName}', brandName)
                                      .replace('{productName}', productName)
                                      .replace('{category}', category);
                                    const res = await fetch('/api/chat', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        messages: [{ role: 'user', content: prompt }],
                                        model: selectedChatModel,
                                        providerId: selectedChatProviderId,
                                      }),
                                    });
                                    const reader = res.body?.getReader();
                                    if (!reader) throw new Error('No reader');
                                    let full = '';
                                    while (true) {
                                      const { done, value } = await reader.read();
                                      if (done) break;
                                      full += new TextDecoder().decode(value);
                                    }
                                    setResearchSuggestion(full.replace(/^data:\s*/gm, '').replace(/\[DONE\]/g, '').trim());
                                  } catch (e: unknown) {
                                    setResearchSuggestion(`调研失败：${e instanceof Error ? e.message : String(e)}`);
                                  } finally {
                                    setResearchLoading(false);
                                  }
                                }}
                              >
                                {researchActionKey === action.key && researchLoading ? '生成中...' : action.label}
                              </button>
                            ))}
                          </div>
                          {researchSuggestion && (
                            <div className="rounded-lg border p-2.5" style={{ borderColor: border, background: bgCard }}>
                              <p className="text-[11px] whitespace-pre-wrap mb-2 max-h-32 overflow-y-auto" style={{ color: textMuted }}>{researchSuggestion}</p>
                              <button
                                className={`rounded-lg border px-2 py-1 text-[11px] cursor-pointer transition-colors ${isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20'}`}
                                onClick={() => setCustomPrompt(prev => prev ? `${prev}\n\n【调研建议】\n${researchSuggestion}` : `【调研建议】\n${researchSuggestion}`)}
                              >
                                → 填充到附加要求
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Step 2: Structure */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>2</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>包装结构与规格</h3>
                    </div>

                    {/* === 升级：包装类型分组过滤器（packaging-cmf-finishes 整合 — 渐进式）=== */}
                    <div className="mb-2 flex items-center gap-1.5">
                      {PACKAGING_TYPE_GROUPS.map(g => (
                        <button
                          key={g.label}
                          className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer transition-colors ${typeGroupFilter === g.label ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/15 text-amber-200') : (isMonochrome ? 'border-gray-200 text-gray-500 hover:border-blue-300' : 'border-white/10 text-white/50 hover:border-amber-400/40')}`}
                          onClick={() => setTypeGroupFilter(g.label)}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>

                    {/* 包装类型选择器（根据分组过滤）*/}
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {PACKAGING_TYPES.filter(t => {
                        const group = PACKAGING_TYPE_GROUPS.find(g => g.label === typeGroupFilter);
                        if (!group || group.types.length === 0) return true; // "全部"显示所有
                        return group.types.includes(t);
                      }).map(t => (
                        <button key={t} className={tagBtnCls(structure.type === t)} onClick={() => setStructure(prev => ({ ...prev, type: t }))}>{t}</button>
                      ))}
                    </div>

                    {/* === 升级：CMF 精准模式开关（packaging-cmf-finishes 整合 — 可选增强）=== */}
                    <div className="mb-2 flex items-center gap-2 rounded-lg border p-2" style={{ borderColor: border, background: bgCard }}>
                      <button
                        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] cursor-pointer transition-all ${cmfModeEnabled ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/15 text-amber-200') : (isMonochrome ? 'border-gray-200 text-gray-500 hover:border-blue-300' : 'border-white/10 text-white/50 hover:border-amber-400/40')}`}
                        onClick={() => setCmfModeEnabled(!cmfModeEnabled)}
                      >
                        <Sparkles size={12} />
                        {cmfModeEnabled ? '✓ CMF精准模式' : '启用CMF精准模式'}
                      </button>
                      <span className="text-[10px]" style={{ color: textMuted }}>
                        {cmfModeEnabled ? '已启用 CMF 方案推荐 + 物理尺寸强制确认' : '可选：开启后获得精准的材质-色彩-工艺方案推荐'}
                      </span>
                    </div>

                    {/* 物理尺寸输入（CMF 模式时显示必填提示）*/}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[12px] mb-1 flex items-center gap-1" style={{ color: cmfModeEnabled ? textAccent : textMuted }}>
                          长 (mm){cmfModeEnabled && <span style={{ color: isMonochrome ? '#ef4444' : '#f87171' }}>*</span>}
                        </label>
                        <input className={inputCls} type="number" placeholder="60" value={structure.length || ''} onChange={e => setStructure(p => ({ ...p, length: Number(e.target.value) }))} style={cmfModeEnabled && !structure.length ? { borderColor: isMonochrome ? '#fca5a5' : 'rgba(248,113,113,0.5)' } : {}} />
                      </div>
                      <div>
                        <label className="block text-[12px] mb-1 flex items-center gap-1" style={{ color: cmfModeEnabled ? textAccent : textMuted }}>
                          宽 (mm){cmfModeEnabled && <span style={{ color: isMonochrome ? '#ef4444' : '#f87171' }}>*</span>}
                        </label>
                        <input className={inputCls} type="number" placeholder="40" value={structure.width || ''} onChange={e => setStructure(p => ({ ...p, width: Number(e.target.value) }))} style={cmfModeEnabled && !structure.width ? { borderColor: isMonochrome ? '#fca5a5' : 'rgba(248,113,113,0.5)' } : {}} />
                      </div>
                      <div>
                        <label className="block text-[12px] mb-1 flex items-center gap-1" style={{ color: cmfModeEnabled ? textAccent : textMuted }}>
                          高 (mm){cmfModeEnabled && <span style={{ color: isMonochrome ? '#ef4444' : '#f87171' }}>*</span>}
                        </label>
                        <input className={inputCls} type="number" placeholder="150" value={structure.height || ''} onChange={e => setStructure(p => ({ ...p, height: Number(e.target.value) }))} style={cmfModeEnabled && !structure.height ? { borderColor: isMonochrome ? '#fca5a5' : 'rgba(248,113,113,0.5)' } : {}} />
                      </div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>容量</label><input className={inputCls} placeholder="100 ml" value={structure.capacity || ''} onChange={e => setStructure(p => ({ ...p, capacity: e.target.value }))} /></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>净含量</label><input className={inputCls} placeholder="100 g" value={structure.netContent || ''} onChange={e => setStructure(p => ({ ...p, netContent: e.target.value }))} /></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>内托</label><select className={selectCls} value={structure.insertTray || ''} onChange={e => setStructure(p => ({ ...p, insertTray: e.target.value }))}>{INSERT_TRAY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>手提绳</label><select className={selectCls} value={structure.handleRope || ''} onChange={e => setStructure(p => ({ ...p, handleRope: e.target.value }))}>{HANDLE_ROPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>开窗</label><select className={selectCls} value={structure.windowType || ''} onChange={e => setStructure(p => ({ ...p, windowType: e.target.value }))}>{WINDOW_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
                    </div>
                  </section>

                  {/* Step 3: Extend & Craft */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>3</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>延展与工艺</h3>
                    </div>
                    <div className="mb-2 text-[12px] font-semibold" style={{ color: textMuted }}>延展场景</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {EXTEND_SCENES.map(s => <button key={s} className={tagBtnCls(extendScenes.includes(s))} onClick={() => toggleExtendScene(s)}>{s}</button>)}
                    </div>

                    {/* === 升级：CMF 智能推荐（packaging-cmf-finishes 整合 — 仅在 CMF 模式时可用）=== */}
                    {cmfModeEnabled && (
                      <div className="mb-3 rounded-lg border p-3" style={{ borderColor: borderStrong, background: bgCard }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: textAccent }}>
                            <Sparkles size={14} />
                            CMF 智能方案推荐
                          </span>
                          <button
                            className={`rounded-lg border px-2 py-1 text-[11px] cursor-pointer transition-colors flex items-center gap-1 ${isMonochrome ? 'border-blue-400 text-blue-700 hover:bg-blue-50' : 'border-amber-400/60 text-amber-200 hover:bg-amber-400/10'}`}
                            onClick={async () => {
                              if (!brandName || !productName || !category) {
                                alert('请先填写品牌名、产品名称和品类');
                                return;
                              }
                              setCmfLoading(true);
                              try {
                                const prompt = `你是 CMF 包装设计专家。为品牌"${brandName}"的产品"${productName}"（品类：${category}，包装类型：${structure.type}）推荐最适合的包装材质(Material)、色彩(Color)与表面工艺(Finish)组合方案。
                                
要求：
1. 推荐 1-2 种基础材质（从这些选项中选择：${MATERIALS.join('、')}）
2. 推荐 2-3 种核心品牌色彩（具体色值或色调描述）
3. 推荐 1-2 种表面工艺（从这些选项中选择：${CRAFTS.join('、')}）
4. 简要说明推荐理由（品牌调性匹配度、成本、可落地性）

请以 JSON 格式返回：
{
  "materials": ["材质1", "材质2"],
  "colors": ["色彩描述1", "色彩描述2"],
  "crafts": ["工艺1", "工艺2"],
  "reason": "推荐理由（1-2句话）"
}`;
                                const res = await fetch('/api/chat', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    messages: [{ role: 'user', content: prompt }],
                                    model: selectedChatModel,
                                    providerId: selectedChatProviderId,
                                  }),
                                });
                                const reader = res.body?.getReader();
                                if (!reader) throw new Error('No reader');
                                let fullText = '';
                                while (true) {
                                  const { done, value } = await reader.read();
                                  if (done) break;
                                  fullText += new TextDecoder().decode(value);
                                }
                                // 提取 JSON（LLM 可能返回 markdown 代码块包裹的 JSON）
                                const jsonMatch = fullText.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                  const suggestion = JSON.parse(jsonMatch[0]);
                                  setCmfSuggestion(JSON.stringify(suggestion, null, 2));
                                  setShowCmfSuggestion(true);
                                } else {
                                  setCmfSuggestion(fullText);
                                  setShowCmfSuggestion(true);
                                }
                              } catch (e: unknown) {
                                alert(`CMF 推荐失败：${e instanceof Error ? e.message : String(e)}`);
                              } finally {
                                setCmfLoading(false);
                              }
                            }}
                            disabled={cmfLoading}
                          >
                            {cmfLoading ? '推荐中...' : '获取推荐方案'}
                          </button>
                        </div>
                        {showCmfSuggestion && cmfSuggestion && (
                          <div className="rounded-lg border p-2 text-[11px] mb-2" style={{ borderColor: border, background: bgSoft, color: textMuted }}>
                            <div className="font-mono whitespace-pre-wrap">{cmfSuggestion}</div>
                            <button
                              className={`mt-2 rounded-lg border px-2 py-1 text-[11px] cursor-pointer transition-colors ${isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'border-amber-400/60 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20'}`}
                              onClick={() => {
                                try {
                                  const suggestion = JSON.parse(cmfSuggestion);
                                  // 自动勾选推荐的材质和工艺
                                  if (suggestion.materials && Array.isArray(suggestion.materials)) {
                                    setMaterialCraft(prev => ({ ...prev, materials: suggestion.materials.filter((m: string) => MATERIALS.includes(m)) }));
                                  }
                                  if (suggestion.crafts && Array.isArray(suggestion.crafts)) {
                                    setMaterialCraft(prev => ({ ...prev, crafts: suggestion.crafts.filter((c: string) => CRAFTS.includes(c)) }));
                                  }
                                  alert('已采纳 CMF 推荐方案');
                                } catch {
                                  alert('推荐方案格式错误，请手动选择');
                                }
                              }}
                            >
                              ✓ 一键采纳
                            </button>
                          </div>
                        )}
                        <p className="text-[10px]" style={{ color: textMuted }}>
                          基于品牌定位与品类特征，AI 将推荐最适合的材质、色彩与工艺组合方案
                        </p>
                      </div>
                    )}

                    <div className="mb-2 text-[12px] font-semibold" style={{ color: textMuted }}>基础材质</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {MATERIALS.map(m => <button key={m} className={tagBtnCls(materialCraft.materials.includes(m))} onClick={() => toggleMaterial(m)}>{m}</button>)}
                    </div>
                    <div className="mb-2 text-[12px] font-semibold" style={{ color: textMuted }}>表面工艺</div>
                    <div className="flex flex-wrap gap-1.5">
                      {CRAFTS.map(c => <button key={c} className={tagBtnCls(materialCraft.crafts.includes(c))} onClick={() => toggleCraft(c)}>{c}</button>)}
                    </div>
                  </section>

                  {/* Step 4: Upload */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>4</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>上传参考与素材</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {['产品图', '包装参考图', 'Logo', '材质贴图'].map((t, i) => (
                        <button key={t} className="h-[72px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors"
                          style={{ borderColor: border, color: textMuted }}
                          onClick={() => handleUpload(t)}>
                          <Upload size={14} />
                          <span className="text-[9px] mt-1">{t}</span>
                        </button>
                      ))}
                    </div>
                    {uploads.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {uploads.map((u, i) => (
                          <div key={i} className="relative w-12 h-12 rounded border overflow-hidden" style={{ borderColor: border }}>
                            <img src={u.url} alt={`上传图片 ${i + 1}`} className="w-full h-full object-cover" />
                            <button className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center" onClick={() => setUploads(prev => prev.filter((_, j) => j !== i))}><X size={8} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Step 5: Output modes */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>5</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>输出模式</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {OUTPUT_MODES.map(m => (
                        <button key={m.value} className={`rounded-lg border p-2 text-[12px] flex flex-col items-center gap-1 cursor-pointer transition-all ${outputModes.includes(m.value) ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/10 text-amber-200') : (isMonochrome ? 'border-gray-200 bg-gray-50 text-gray-500 hover:border-blue-300' : 'border-white/10 bg-black/30 text-white/60 hover:border-amber-400/40')}`}
                          onClick={() => toggleOutputMode(m.value)}>
                          {m.icon}<span>{m.label}</span>
                        </button>
                      ))}
                    </div>

                    {/* === 升级：showcase 镜头节奏（packaging-showcase-series-skill 整合 — 仅 series_family 选中时展示）=== */}
                    {outputModes.includes('series_family') && (
                      <div className="mt-3 rounded-lg border p-3" style={{ borderColor: border, background: bgSoft }}>
                        <p className="text-[11px] font-medium mb-2" style={{ color: textMuted }}>系列图组镜头节奏</p>
                        <div className="flex gap-1.5 mb-2.5">
                          {(Object.entries(SHOWCASE_PRESETS) as [ShowcaseSpec, typeof SHOWCASE_PRESETS[ShowcaseSpec]][]).map(([spec, preset]) => (
                            <button
                              key={spec}
                              className={`flex-1 rounded-lg border py-1.5 text-[11px] cursor-pointer transition-all text-center ${showcaseSpec === spec ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/10 text-amber-200') : (isMonochrome ? 'border-gray-200 text-gray-500 hover:border-blue-300' : 'border-white/10 text-white/40 hover:border-amber-400/30')}`}
                              onClick={() => setShowcaseSpec(spec)}
                            >
                              <span className="font-medium">{preset.label}</span>
                              <span className="block text-[10px] opacity-70">{preset.count}张</span>
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {SHOWCASE_PRESETS[showcaseSpec].shots.map((shot, i) => (
                            <span key={i} className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: isMonochrome ? '#f0f4ff' : 'rgba(255,255,255,0.06)', color: isMonochrome ? '#3b82f6' : 'rgba(255,255,255,0.45)' }}>
                              {i + 1}. {shot}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Step 6: Advanced tools */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>6</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>高级工具</h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {ADVANCED_TOOLS.map(tool => (
                        <button key={tool.key} className={`rounded-lg border px-3 py-1.5 text-[12px] flex items-center gap-1 cursor-pointer transition-all ${({ ...advancedOptions } as Record<string, boolean>)[tool.key] ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/10 text-amber-200') : (isMonochrome ? 'border-gray-200 bg-gray-50 text-gray-500 hover:border-blue-300' : 'border-white/10 bg-black/30 text-white/60 hover:border-amber-400/40')}`}
                          onClick={() => setAdvancedOptions(prev => ({ ...prev, [tool.key]: !(({ ...prev } as Record<string, boolean>)[tool.key]) }))}>
                          {tool.icon}{tool.label}
                        </button>
                      ))}
                    </div>
                    {/* Custom prompt */}
                    <textarea className={`${inputCls} min-h-[60px] mb-3`} placeholder="附加设计要求..." value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} />
                    {/* Export format + Generate button */}
                    {/* 模型选择 - 图像模型与LLM模型左右横向排列 */}
                    {imageModels.length > 0 && (
                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <span className="text-[11px] font-medium" style={{ color: textMuted }}>图像模型</span>
                          <select
                            className="w-full rounded-lg border px-2 py-1.5 text-[12px] cursor-pointer mt-0.5"
                            style={{
                              background: isMonochrome ? '#f9fafb' : '#111',
                              color: isMonochrome ? '#374151' : '#e5e5e5',
                              borderColor: isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.12)',
                            }}
                            value={`${selectedProviderId}::${selectedModel}`}
                            onChange={(e) => {
                              const val = e.target.value;
                              const sepIdx = val.indexOf('::');
                              if (sepIdx > 0) {
                                setSelectedProviderId(val.substring(0, sepIdx));
                                setSelectedModel(val.substring(sepIdx + 2));
                              }
                            }}
                          >
                            {(() => {
                              const grouped: Record<string, typeof imageModels> = {};
                              imageModels.forEach(m => {
                                const key = m.providerName || '未知';
                                if (!grouped[key]) grouped[key] = [];
                                grouped[key].push(m);
                              });
                              return Object.entries(grouped).map(([provName, models]) => (
                                <optgroup key={provName} label={provName}>
                                  {models.map(m => (
                                    <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                                      {getModelDisplayName(m.id) || m.name || m.id}
                                    </option>
                                  ))}
                                </optgroup>
                              ));
                            })()}
                          </select>
                          {(() => {
                            const cur = imageModels.find(m => m.providerId === selectedProviderId && m.id === selectedModel);
                            if (cur) return <p className="text-[11px] mt-0.5" style={{ color: isMonochrome ? '#9ca3af' : 'rgba(212,175,55,0.5)' }}>{getModelDisplayName(cur.id) || cur.name} · 来自 {cur.providerName}</p>;
                            return null;
                          })()}
                        </div>
                        {chatModels.length > 0 && (
                          <div>
                            <span className="text-[11px] font-medium" style={{ color: textMuted }}>LLM模型</span>
                            <select
                              className="w-full rounded-lg border px-2 py-1.5 text-[12px] cursor-pointer mt-0.5"
                              style={{
                                background: isMonochrome ? '#f9fafb' : '#111',
                                color: isMonochrome ? '#374151' : '#e5e5e5',
                                borderColor: isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.12)',
                              }}
                              value={`${selectedChatProviderId}::${selectedChatModel}`}
                              onChange={(e) => {
                                const val = e.target.value;
                                const sepIdx = val.indexOf('::');
                                if (sepIdx > 0) {
                                  setSelectedChatProviderId(val.substring(0, sepIdx));
                                  setSelectedChatModel(val.substring(sepIdx + 2));
                                }
                              }}
                            >
                              {(() => {
                                const grouped: Record<string, typeof chatModels> = {};
                                chatModels.forEach(m => {
                                  const key = m.providerName || '未知';
                                  if (!grouped[key]) grouped[key] = [];
                                  grouped[key].push(m);
                                });
                                return Object.entries(grouped).map(([provName, models]) => (
                                  <optgroup key={provName} label={provName}>
                                    {models.map(m => (
                                      <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                                        {getModelDisplayName(m.id) || m.name || m.id}
                                      </option>
                                    ))}
                                  </optgroup>
                                ));
                              })()}
                            </select>
                            {(() => {
                              const cur = chatModels.find(m => m.providerId === selectedChatProviderId && m.id === selectedChatModel);
                              if (cur) return <p className="text-[11px] mt-0.5" style={{ color: isMonochrome ? '#9ca3af' : 'rgba(212,175,55,0.5)' }}>{getModelDisplayName(cur.id) || cur.name} · 来自 {cur.providerName}</p>;
                              return null;
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px]" style={{ color: textMuted }}>导出格式</span>
                        {(['PNG', 'SVG', 'PDF', 'AI'] as const).map(f => (
                          <button key={f} className={`rounded-md border px-2 py-1 text-[12px] cursor-pointer transition-colors ${exportFormat === f ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/10 text-amber-200') : (isMonochrome ? 'border-gray-200 text-gray-500' : 'border-white/10 text-white/50')}`}
                            onClick={() => setExportFormat(f)}>{f}</button>
                        ))}
                      </div>
                      <button
                        className="rounded-xl px-8 py-2.5 text-sm font-bold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: isMonochrome ? '#3b82f6' : '#d4af37', color: isMonochrome ? '#fff' : '#000' }}
                        onClick={handleGenerate}
                        disabled={isGenerating || !brandName.trim()}
                      >
                        {isGenerating ? <><Loader2 size={14} className="inline animate-spin mr-1" />生成中...</> : <><Sparkles size={14} className="inline mr-1" />生成方案</>}
                      </button>
                      {errorMsg && (
                        <p className="text-xs mt-1.5 px-1" style={{ color: '#ef4444' }}>{errorMsg}</p>
                      )}
                    </div>
                  </section>
                </div>

                {/* RIGHT: Results area */}
                <div className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:overflow-hidden">
                  {/* Results grid */}
                  <section className={`${panelCls} min-w-0 flex-1 flex flex-col lg:min-h-0 lg:overflow-hidden`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <h3 className="text-xs font-semibold" style={{ color: textPrimary }}>预览与结果</h3>
                      <div className="flex gap-1">
                        {(['all', 'favorites', 'optimize'] as const).map(tab => (
                          <button key={tab} className={`rounded-lg px-2.5 py-1 text-[12px] cursor-pointer transition-colors ${activeResultTab === tab ? (isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-amber-500/20 text-amber-200') : (isMonochrome ? 'text-gray-500 hover:bg-gray-100' : 'text-white/50 hover:bg-white/5')}`}
                            onClick={() => setActiveResultTab(tab)}>
                            {{ all: `全部 ${results.length}`, favorites: `收藏 ${favorites.size}`, optimize: '待优化' }[tab]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto">
                      {filteredResults.length === 0 ? (
                        <div className="flex min-h-32 flex-col items-center justify-center h-full text-xs" style={{ color: textMuted }}>
                          <Package size={32} className="mb-2 opacity-20" />
                          {isGenerating ? '正在生成包装方案...' : '设置参数后点击"生成方案"'}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {filteredResults.map(r => (
                            <div key={r.id} className="rounded-lg border overflow-hidden cursor-pointer group relative" style={{ borderColor: border }}>
                              <img src={r.url} alt={OUTPUT_MODES.find(m => m.value === r.type)?.label ?? r.type} className="w-full aspect-[4/3] object-cover" />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-100 lg:opacity-0 lg:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex flex-col justify-end p-2">
                                <span className="text-[12px] text-white">{OUTPUT_MODES.find(m => m.value === r.type)?.label || r.type}</span>
                                <div className="flex gap-1 mt-1">
                                  <button className="p-1 rounded bg-white/20 hover:bg-white/40" onClick={() => toggleFavorite(r.id)} aria-label={favorites.has(r.id) ? '取消收藏方案' : '收藏方案'}>
                                    <Star size={10} fill={favorites.has(r.id) ? accent : 'none'} style={{ color: favorites.has(r.id) ? accent : '#fff' }} />
                                  </button>
                                  <button className="p-1 rounded bg-white/20 hover:bg-white/40" onClick={() => onAddImages?.([r.url], { modelName: selectedModel, apiProvider: selectedProviderId })} title="发送到画布">
                                    <Send size={10} style={{ color: '#fff' }} />
                                  </button>
                                  <button className="p-1 rounded bg-white/20 hover:bg-white/40" onClick={() => handleDownloadImage(r.url, `${brandName}_${r.type}.png`)} title="下载">
                                    <Download size={10} style={{ color: '#fff' }} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {results.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className={`rounded-lg border px-3 py-1.5 text-[12px] cursor-pointer disabled:opacity-50 ${isMonochrome ? 'border-blue-300 text-blue-600 hover:bg-blue-50' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'}`}
                          onClick={handleGenerateSeries}
                          disabled={isGenerating}
                        >
                          一键生成同系列
                        </button>
                        <button
                          className={`rounded-lg border px-3 py-1.5 text-[12px] cursor-pointer disabled:opacity-50 ${isMonochrome ? 'border-blue-300 text-blue-600 hover:bg-blue-50' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'}`}
                          onClick={handleGenerateScene}
                          disabled={isGenerating}
                        >
                          一键生成场景展示
                        </button>
                      </div>
                    )}
                  </section>

                  {/* Analysis panel */}
                  <section className={panelCls}>
                    <h3 className="text-xs font-semibold mb-3" style={{ color: textPrimary }}>方案评估与分析</h3>
                    {analysis ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="flex items-center justify-center rounded-lg border p-4" style={{ borderColor: border, background: bgCard }}>
                          <div className="text-[12px]" style={{ color: textMuted }}>雷达图组件</div>
                        </div>
                        <div className="space-y-1.5">
                          {([
                            ['品牌识别度', analysis.brandRecognition],
                            ['货架吸引力', analysis.shelfImpact],
                            ['高级感', analysis.premiumFeeling],
                            ['可落地性', analysis.feasibility],
                            ['印刷复杂度', analysis.printComplexity],
                          ] as const).map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: bgCard }}>
                              <span style={{ color: textMuted }}>{label}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.1)' }}>
                                  <div className="h-full rounded-full" style={{ width: `${value}%`, background: accent }} />
                                </div>
                                <span className="font-semibold w-6 text-right" style={{ color: textAccent }}>{value}</span>
                              </div>
                            </div>
                          ))}
                          <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: bgCard }}>
                            <span style={{ color: textMuted }}>成本等级</span>
                            <span className="font-semibold" style={{ color: textAccent }}>{analysis.costLevel}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center py-6 text-[12px]" style={{ color: textMuted }}>
                        生成方案后自动显示评估分析
                      </div>
                    )}
                  </section>
                </div>
              </div>
              <div className="px-4 pb-2">
                <p className="text-[12px] leading-relaxed" style={{ color: textMuted }}>
                  ⚠ 视觉展开图不是最终印刷刀版 · 结构参考展开图需要人工复核 · 准刀版需接入标准包装结构模板库 · 小字内容建议由设计师后期排版
                </p>
              </div>
            </main>
          </div>
      </div>
    </div>,
    document.body,
  );
}
