'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getModelDisplayName } from '@/lib/model-name-map';
import { VenueRegionCanvas, type VenueRegion } from '@/components/venue-region-canvas';
import {
  Box, X, Minus, Maximize2, Upload, Image as ImageIcon, Layers,
  ChevronDown, Sparkles, Download, Send, Search,
  Ruler, Paintbrush, LayoutGrid, Eye, Lightbulb,
  Users, Store, Building2, TreePine, FileText,
  Grid3X3, BarChart3, DollarSign, Info, Loader2, Palette,
  Camera, RotateCcw, FileDown, DoorOpen, FileImage, Package, Monitor,
  MapPin, Layout, Lock, CheckCircle, AlertTriangle, Plus
} from 'lucide-react';

/* ============================================================
   类型定义
   ============================================================ */
export type DisplayImageUsageMode = 'texture_mapping' | 'style_extension' | 'structure_reference';
export type DisplaySceneType = 'pop_up_store' | 'exhibition_booth' | 'retail_stack' | 'window_display' | 'photo_spot' | 'product_display' | 'mall_installation';
export type DisplayEnvironment = 'mall_atrium' | 'exhibition_hall' | 'retail_store' | 'outdoor' | 'supermarket';
export type DisplayViewOption = 'front' | 'angle_45' | 'side' | 'top' | 'entrance' | 'detail' | 'back' | 'bird_eye';
export type DisplayRenderStyle = 'photorealistic' | '3d_render' | 'concept_sketch';

export interface DisplayDimensions {
  length: number;
  width: number;
  height: number;
}

export interface Display3DAsset {
  id: string;
  type: string;
  url: string;
  name: string;
}

export interface DisplayComponent {
  id: string;
  index: number;
  name: string;
  sizeSuggestion: string;
  material: string;
  craft: string;
}

export interface DisplayMaterialSpec {
  id: string;
  name: string;
  description: string;
}

export interface BomItem {
  id: string;
  name: string;
  count: number;
  estimatedPrice: string;
}

export interface DisplayFloorPlanZone {
  name: string;
  description: string;
}

export interface Display3DResult {
  id: string;
  type: string;
  url: string;
  label?: string;
}

interface Props {
  isMonochrome?: boolean;
  sourceImage?: { id: string; url: string; prompt?: string } | null;
  onClose: () => void;
  onAddImages?: (urls: string[], meta?: { modelName?: string; apiProvider?: string }) => void;
}

/* ============================================================
   活动现场设计师类型定义
   ============================================================ */
export interface VenueAnalysis {
  spaceType: string;
  estimatedDimensions: { length: number; width: number; height: number };
  lighting: string;
  regions: VenueRegion[];
  structuralLimits: string[];
  designNotes: string;
}

export interface ActivityBrief {
  eventName: string;
  eventType: string;
  expectedCapacity: string;
  primaryGoal: string;
  budget: string;
  brandStyle: string;
  specialRequirements: string;
}

export interface LayoutProposal {
  id: string;
  name: string;
  concept: string;
  style: string;
  highlights: string[];
  regionUsage: { regionId: string; usage: string; priority: string }[];
  mainInstallation: string;
  visualElements: { primaryColor: string; materials: string[]; lighting: string };
  flowDesign: string;
  estimatedCost: string;
  renderPromptHint: string;
  pros: string[];
  cons: string[];
}

export interface DesignID {
  id: string;
  version: string;
  brandName: string;
  theme: string;
  lockedAt: string;
  lockedFields: {
    layout: { spaceType: string; dimensions?: { length: number; width: number; height: number }; regionUsage: { regionId: string; usage: string; priority: string }[]; flowDesign: string; mainInstallation: string };
    colors: { primary: string; scheme: string };
    materials: string[];
    brandRules: { brandName: string; eventName: string; highlights: string[] };
    lightingScheme: string;
    viewAngles: string[];
    renderPromptHint: string;
    estimatedCost: string;
    pros: string[];
    concept: string;
  };
}

export interface QcDimension {
  score: number;
  comment: string;
}

export interface QcResult {
  passed: boolean;
  overallScore: number;
  dimensions: {
    brandIdentity: QcDimension;
    styleConsistency: QcDimension;
    spaceLayout: QcDimension;
    materialColor: QcDimension;
    overallQuality: QcDimension;
  };
  issues: string[];
  suggestions: string[];
  verdict: string;
}

export interface VenueVersion {
  id: string;
  designIdVersion: string;
  imageUrl: string;
  qcResult?: QcResult;
  createdAt: string;
}

type AppMode = 'display3d' | 'activity-venue';
type ActivityStep = 1 | 2 | 3 | 4;

/* ============================================================
   常量
   ============================================================ */
const IMAGE_USAGE_MODES: { value: DisplayImageUsageMode; label: string; desc: string }[] = [
  { value: 'texture_mapping', label: '贴图应用', desc: '将图片贴到背板/灯箱/地贴' },
  { value: 'style_extension', label: '风格延展', desc: '参考图片风格生成展陈' },
  { value: 'structure_reference', label: '结构参考', desc: '参考图片空间结构' },
];

const RENDER_STYLES: { value: DisplayRenderStyle; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: 'photorealistic', label: '写实照片级', desc: '追求真实感，适合方案汇报', icon: <Camera size={14} /> },
  { value: '3d_render', label: '3D渲染级', desc: '高质量渲染质感，真实灯光材质', icon: <Monitor size={14} /> },
  { value: 'concept_sketch', label: '概念草图级', desc: '快速概念表达，适合方案初探', icon: <Paintbrush size={14} /> },
];

const SCENE_TYPES: { value: DisplaySceneType; label: string; icon: React.ReactNode }[] = [
  { value: 'pop_up_store', label: '快闪店', icon: <Store size={14} /> },
  { value: 'exhibition_booth', label: '展会展位', icon: <Building2 size={14} /> },
  { value: 'retail_stack', label: '商超堆头', icon: <Grid3X3 size={14} /> },
  { value: 'window_display', label: '橱窗陈列', icon: <Eye size={14} /> },
  { value: 'photo_spot', label: '打卡装置', icon: <Camera size={14} /> },
  { value: 'product_display', label: '产品展示台', icon: <Box size={14} /> },
  { value: 'mall_installation', label: '商场美陈', icon: <TreePine size={14} /> },
];

const ENVIRONMENTS: { value: DisplayEnvironment; label: string }[] = [
  { value: 'mall_atrium', label: '商场中庭' },
  { value: 'exhibition_hall', label: '展馆' },
  { value: 'retail_store', label: '门店' },
  { value: 'outdoor', label: '户外' },
  { value: 'supermarket', label: '超市' },
];

const VIEW_OPTIONS: { value: DisplayViewOption; label: string }[] = [
  { value: 'front', label: '正面全景' },
  { value: 'angle_45', label: '45度斜角' },
  { value: 'side', label: '侧面全景' },
  { value: 'top', label: '俯瞰全貌' },
  { value: 'entrance', label: '入口视角' },
  { value: 'detail', label: '局部细节' },
  { value: 'back', label: '背面视角' },
  { value: 'bird_eye', label: '鸟瞰视角' },
];

const MATERIAL_STYLES = ['轻奢质感', '科技未来', '自然环保', '年轻潮流', '极简现代', '复古经典'];
const LIGHTING_STYLES = ['明亮聚焦', '柔和高级', '科技冷光', '暖色氛围', '自然采光', '舞台灯光'];
const CROWD_STYLES = ['无人', '少量人物', '活动人流', '长曝光人流', '专业模特'];

const ASSET_TYPES: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'kv', label: '主视觉KV', icon: <ImageIcon size={12} /> },
  { key: 'backboard', label: '背板图', icon: <Layers size={12} /> },
  { key: 'doorway', label: '门头图', icon: <DoorOpen size={12} /> },
  { key: 'floor', label: '地贴图', icon: <Grid3X3 size={12} /> },
  { key: 'poster', label: '海报图', icon: <FileImage size={12} /> },
  { key: 'package', label: '包装图', icon: <Package size={12} /> },
  { key: 'logo', label: 'Logo', icon: <Sparkles size={12} /> },
  { key: 'ip', label: 'IP形象', icon: <Users size={12} /> },
  { key: '3d_screenshot', label: '3D截图', icon: <Box size={12} /> },
  { key: 'rendering', label: '效果图', icon: <Monitor size={12} /> },
];

const ASSET_LIBRARY = ['平面布局', '模型库', '材质库', '贴图库', '场景库', '灯光库', 'Logo', '字体库'];
const OUTPUT_RESOLUTIONS = ['1920×1080', '2560×1440', '3840×2160'];
const OUTPUT_FORMATS = ['PNG', 'JPG', 'WEBP'];
const OUTPUT_QUALITIES = ['标准', '高', '极高'];

/* ============================================================
   Prompt 模板
   ============================================================ */
function buildDisplay3DPrompt(state: {
  brandName: string;
  productName: string;
  sceneType: DisplaySceneType;
  environment: DisplayEnvironment;
  dimensions: DisplayDimensions;
  imageUsageMode: DisplayImageUsageMode;
  materialStyle?: string;
  lightingStyle?: string;
  budget?: number;
  viewOptions: DisplayViewOption[];
  outputResolution?: string;
  outputFormat?: string;
  outputQuality?: string;
  customPrompt?: string;
  brandColor?: string;
  focusProduct?: string;
  renderStyle?: string;
}): string {
  const sceneLabel = SCENE_TYPES.find(s => s.value === state.sceneType)?.label || state.sceneType;
  const envLabel = ENVIRONMENTS.find(e => e.value === state.environment)?.label || state.environment;
  const usageLabel = IMAGE_USAGE_MODES.find(m => m.value === state.imageUsageMode)?.label || state.imageUsageMode;
  const viewLabels = state.viewOptions.map(v => VIEW_OPTIONS.find(o => o.value === v)?.label || v).join('、');
  const renderStyleLabel = RENDER_STYLES.find((r: { value: string }) => r.value === state.renderStyle)?.label || state.renderStyle || '3D渲染级';
  return `为品牌「${state.brandName}」设计一个商业级3D展陈空间效果图。
产品名称：${state.productName || '品牌产品'}
展陈类型：${sceneLabel}
环境场景：${envLabel}
空间尺寸：${state.dimensions.length}×${state.dimensions.width}×${state.dimensions.height}mm
图像使用模式：${usageLabel}
渲染风格：${renderStyleLabel}
输出规格：${state.outputResolution || '3840×2160'} ${state.outputFormat || 'PNG'} ${state.outputQuality || '高'}
材质风格：${state.materialStyle || '未指定'}
灯光氛围：${state.lightingStyle || '未指定'}
品牌主色：${state.brandColor || '按品牌标准'}
重点展示产品：${state.focusProduct || '全线产品'}
预算范围：${state.budget ? `¥${state.budget}` : '未指定'}
设计要求：
1. 生成真实商业级展陈效果图。
2. 包含品牌门头、主背板、产品陈列区、打卡装置、灯箱、地贴、导视系统。
3. 空间结构合理，动线清晰，品牌识别度高。
4. 如果上传了主视觉KV或平面图，需要将其作为贴图应用到背板、门头、灯箱、地贴等位置。
5. 画面需要具备高质量3D渲染质感，真实灯光、真实材质。
6. 不要出现乱码文字，不要出现无关品牌。
7. 品牌色调贯穿整体空间设计，重点产品需要突出展示。
输出视角：${viewLabels}
${state.customPrompt ? `\n附加要求：${state.customPrompt}` : ''}`;
}

/* ============================================================
   组件
   ============================================================ */
export default function Display3DPanel({ isMonochrome = false, sourceImage = null, onClose, onAddImages }: Props) {
  // === Window drag state ===
  const [isMinimized, setIsMinimized] = useState(false);
  // P2 fix: 追踪所有通过 createObjectURL 创建的 blob URL，组件卸载时统一 revoke
  const localBlobUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      localBlobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      localBlobUrlsRef.current = [];
    };
  }, []);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [windowPos, setWindowPos] = useState({ x: 60, y: 60 });

  // === Sidebar tab ===
  const [sidebarTab, setSidebarTab] = useState<'projects' | 'templates' | 'presets'>('projects');

  // === Form state ===
  const [brandName, setBrandName] = useState('');
  const [productName, setProductName] = useState('');
  const [assets, setAssets] = useState<Display3DAsset[]>([]);
  const [imageUsageMode, setImageUsageMode] = useState<DisplayImageUsageMode>('texture_mapping');
  const [renderStyle, setRenderStyle] = useState<DisplayRenderStyle>('3d_render');
  const [sceneType, setSceneType] = useState<DisplaySceneType>('pop_up_store');
  const [environment, setEnvironment] = useState<DisplayEnvironment>('mall_atrium');
  const [dimensions, setDimensions] = useState<DisplayDimensions>({ length: 9000, width: 6000, height: 4500 });
  const [budget, setBudget] = useState<number | ''>('');
  const [materialStyle, setMaterialStyle] = useState('轻奢质感');
  const [lightingStyle, setLightingStyle] = useState('明亮聚焦');
  const [crowdStyle, setCrowdStyle] = useState('无人');
  const [viewOptions, setViewOptions] = useState<DisplayViewOption[]>(['angle_45', 'front']);
  const [customPrompt, setCustomPrompt] = useState('');
  const [brandColor, setBrandColor] = useState('');
  const [focusProduct, setFocusProduct] = useState('');
  const [outputResolution, setOutputResolution] = useState('3840×2160');
  const [outputFormat, setOutputFormat] = useState('PNG');
  const [outputQuality, setOutputQuality] = useState('高');
  // 元素拆解生成比例——独立于主生成面板，默认 16:9 适合展陈效果图
  const [generateAspectRatio, setGenerateAspectRatio] = useState('16:9');

  // === Model selection state ===
  const [availableModels, setAvailableModels] = useState<{ providerId: string; model: string; displayName?: string; providerName?: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [chatModels, setChatModels] = useState<{ id: string; name: string; providerId: string; providerName: string }[]>([]);
  const [selectedChatModel, setSelectedChatModel] = useState('');
  const [selectedChatProviderId, setSelectedChatProviderId] = useState('');

  // Load available image models
  useEffect(() => {
    fetch('/api/models?type=image')
      .then(r => r.json())
      .then(data => {
        const providers: { id: string; name: string; isEnabled?: boolean }[] = data.providers || [];
        const enabledProviderIds = new Set(providers.filter(p => p.isEnabled !== false).map(p => p.id));
        const providerMap = new Map(providers.map((p: { id: string; name: string }) => [p.id, p]));
        const models = (data.models || [])
          .filter((m: { providerId?: string }) => enabledProviderIds.has(m.providerId || ''))
          .map((m: { providerId?: string; id?: string; model?: string; name?: string }) => ({
            providerId: m.providerId || '',
            model: m.model || m.id || '',
            displayName: m.name || m.model || m.id || '',
            providerName: providerMap.get(m.providerId || '')?.name || '',
          }));
        setAvailableModels(models);
        // Auto-select from localStorage or first available
        const saved = typeof window !== 'undefined' ? localStorage.getItem('currentImageModel') : '';
        if (saved) {
          const savedProvider = typeof window !== 'undefined' ? localStorage.getItem('currentImageProviderId') : '';
          const match = models.find((m: { providerId: string; model: string }) => m.model === saved && m.providerId === savedProvider);
          if (match) { setSelectedModel(match.model); setSelectedProviderId(match.providerId); return; }
        }
        if (models.length > 0) { setSelectedModel(models[0].model); setSelectedProviderId(models[0].providerId); }
      })
      .catch(() => {});
  }, []);

  // Load available chat models
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

  // === Results state ===
  const [results, setResults] = useState<Display3DResult[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [activePreviewTab, setActivePreviewTab] = useState<'render' | 'views' | 'decompose' | 'dimension' | 'material' | 'floorplan' | 'bom'>('render');
  const [selectedView, setSelectedView] = useState<string>('angle_45');
  const [decomposition, setDecomposition] = useState<{
    components: DisplayComponent[];
    materials: DisplayMaterialSpec[];
    bom: BomItem[];
    floorPlanZones: DisplayFloorPlanZone[];
    notes: string[];
    rawAnalysis?: string;
  } | null>(null);
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setDecomposition(null);
    setErrorMsg('');
    setSuccessMsg('');
    if (sourceImage?.url) {
      setActivePreviewTab('decompose');
    }
  }, [sourceImage?.id, sourceImage?.url]);

  // === 活动现场设计师 state ===
  const [appMode, setAppMode] = useState<AppMode>('display3d');
  const [activityStep, setActivityStep] = useState<ActivityStep>(1);
  const [venueImageUrl, setVenueImageUrl] = useState('');
  const [venueAnalysis, setVenueAnalysis] = useState<VenueAnalysis | null>(null);
  const [activityBrief, setActivityBrief] = useState<ActivityBrief>({
    eventName: '', eventType: '品牌快闪', expectedCapacity: '',
    primaryGoal: '品牌曝光', budget: '', brandStyle: '', specialRequirements: '',
  });
  const [proposals, setProposals] = useState<LayoutProposal[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<DesignID | null>(null);
  const [venueVersions, setVenueVersions] = useState<VenueVersion[]>([]);
  const [venueQcResult, setVenueQcResult] = useState<QcResult | null>(null);
  const [isAnalyzingVenue, setIsAnalyzingVenue] = useState(false);
  const [isGeneratingProposals, setIsGeneratingProposals] = useState(false);
  const [isLockingDesign, setIsLockingDesign] = useState(false);
  const [isGeneratingVenue, setIsGeneratingVenue] = useState(false);
  const [isQcRunning, setIsQcRunning] = useState(false);
  const [selectedVenueRegion, setSelectedVenueRegion] = useState<string | null>(null);

  // Theme — 3D展陈系统: 标准黑金配色 (#d4af37 + #1a1a1a)
  const accent = isMonochrome ? '#3b82f6' : '#d4af37';
  const bg = isMonochrome ? '#ffffff' : '#1a1a1a';
  const bgPanel = isMonochrome ? 'rgba(249,250,251,0.95)' : 'rgba(26,26,26,0.92)';
  const bgCard = isMonochrome ? '#f3f4f6' : 'rgba(17,17,17,0.9)';
  const border = isMonochrome ? '#e5e5e5' : 'rgba(255,255,255,0.1)';
  const textPrimary = isMonochrome ? '#111827' : '#e5e5e5';
  const textMuted = isMonochrome ? '#6b7280' : '#888';
  const textAccent = isMonochrome ? '#3b82f6' : '#d4af37';

  // === Drag handlers ===
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragOffset({ x: e.clientX - windowPos.x, y: e.clientY - windowPos.y });
  }, [windowPos]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => setWindowPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [isDragging, dragOffset]);

  // === Upload handler ===
  const handleUpload = (type: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      localBlobUrlsRef.current.push(url); // P2 fix: 记录 blob URL 供 unmount 时清理
      setAssets(prev => [...prev, { id: Date.now().toString(), type, url, name: file.name }]);
    };
    input.click();
  };

  // === View toggle ===
  const toggleView = (v: DisplayViewOption) => {
    setViewOptions(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };

  // === Generate ===
  const handleGenerate = useCallback(async () => {
    setErrorMsg('');
    if (!brandName.trim()) return;
    setIsGenerating(true);
    try {
      const prompt = buildDisplay3DPrompt({ brandName, productName, sceneType, environment, dimensions, imageUsageMode, materialStyle, lightingStyle, budget: budget || undefined, viewOptions, outputResolution, outputFormat, outputQuality, customPrompt, brandColor, focusProduct });
      const res = await fetch('/api/display-3d/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName, productName, assets,
          imageUsageMode, sceneType, environment,
          dimensions, budget, materialStyle, lightingStyle,
          crowdStyle, viewOptions, renderStyle, outputResolution, outputFormat, outputQuality, prompt,
          model: selectedModel, providerId: selectedProviderId,
          quality: outputQuality === '超高' ? '4K' : outputQuality === '高' ? '2K' : '1K',
          aspectRatio: generateAspectRatio,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        console.error('[display-3d] Generate error:', data.error);
        setIsGenerating(false);
        return;
      }
      if (data.taskId) {
        const taskId = data.taskId;
        // Poll via /api/poll-task (POST) — standard task polling mechanism
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
                const newResults = imageUrls.map((url: string, i: number) => ({
                  id: `${taskId}_${i}`,
                  type: 'rendering',
                  url,
                  label: viewOptions[i % viewOptions.length] || '效果图',
                }));
                setResults(prev => [...prev, ...newResults]);
                onAddImages?.(imageUrls, { modelName: selectedModel, apiProvider: selectedProviderId });
              }
              // Handle decompose results embedded in task
              if (taskData.result?.decomposition) {
                setDecomposition(taskData.result.decomposition);
              }
              setIsGenerating(false);
            } else if (taskData.status === 'failed') {
              console.error('[display-3d] Task failed:', taskData.error);
              setIsGenerating(false);
            } else {
              setTimeout(poll, 3000);
            }
          } catch (e) {
            console.error('[display-3d] Poll error:', e);
            setIsGenerating(false);
          }
        };
        poll();
      } else if (data.results) {
        setResults(data.results);
        setIsGenerating(false);
      } else {
        setIsGenerating(false);
      }
    } catch (e) {
      console.error('[display-3d] Generate failed:', e);
      setIsGenerating(false);
    }
  }, [brandName, productName, sceneType, environment, dimensions, imageUsageMode, materialStyle, lightingStyle, budget, viewOptions, renderStyle, outputResolution, outputFormat, outputQuality, customPrompt, crowdStyle, assets, onAddImages, selectedModel, selectedProviderId, brandColor, focusProduct, generateAspectRatio]);

  // === Decompose handler ===
  const handleDecompose = useCallback(async () => {
    const imageUrl = sourceImage?.url || results[0]?.url || '';
    const sourceLabel = sourceImage ? '当前画布图片' : '展陈效果图';
    if (!imageUrl) {
      setErrorMsg(`请先选择要分析的${sourceLabel}`);
      return;
    }
    if (!selectedChatModel || !selectedChatProviderId) {
      setErrorMsg('请选择已授权的分析模型后再进行元素拆解');
      return;
    }

    const analysisModel = selectedChatModel;
    const analysisProviderId = selectedChatProviderId;
    setErrorMsg('');
    setSuccessMsg('');
    setDecomposition(null);
    setIsDecomposing(true);
    try {
      const res = await fetch('/api/display-3d/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: brandName.trim() || '未命名品牌',
          sceneType,
          dimensions,
          imageUrl,
          model: analysisModel,
          providerId: analysisProviderId,
        }),
      });
      const data = await res.json().catch(() => ({})) as { taskId?: string; error?: string };
      if (!res.ok || data.error || !data.taskId) {
        throw new Error(data.error || '元素拆解任务提交失败');
      }

      const poll = async (): Promise<void> => {
        try {
          const taskRes = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: data.taskId, model: analysisModel, providerId: analysisProviderId }),
          });
          const taskData = await taskRes.json().catch(() => ({})) as {
            status?: string;
            error?: string;
            result?: { decomposition?: unknown; rawAnalysis?: string };
          };
          if (taskData.status === 'completed') {
            const decomposeResult = taskData.result?.decomposition;
            if (!decomposeResult || typeof decomposeResult !== 'object') {
              throw new Error('分析服务未返回有效的结构化拆解结果');
            }
            const result = decomposeResult as {
              components?: DisplayComponent[];
              materials?: DisplayMaterialSpec[];
              bom?: BomItem[];
              floorPlanZones?: DisplayFloorPlanZone[];
              notes?: string[];
              rawAnalysis?: string;
            };
            setDecomposition({
              components: Array.isArray(result.components) ? result.components : [],
              materials: Array.isArray(result.materials) ? result.materials : [],
              bom: Array.isArray(result.bom) ? result.bom : [],
              floorPlanZones: Array.isArray(result.floorPlanZones) ? result.floorPlanZones : [],
              notes: Array.isArray(result.notes) ? result.notes : [],
              rawAnalysis: result.rawAnalysis || taskData.result?.rawAnalysis,
            });
            setSuccessMsg('元素拆解已完成，以下内容均来自本次分析结果。');
            setIsDecomposing(false);
            setActivePreviewTab('decompose');
          } else if (taskData.status === 'failed' || !taskRes.ok) {
            throw new Error(taskData.error || '元素拆解任务失败');
          } else {
            window.setTimeout(() => { void poll(); }, 3000);
          }
        } catch (error) {
          setErrorMsg(error instanceof Error ? error.message : '元素拆解轮询失败，请重试');
          setIsDecomposing(false);
        }
      };
      void poll();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '元素拆解失败，请重试');
      setIsDecomposing(false);
    }
  }, [brandName, sceneType, dimensions, results, selectedChatModel, selectedChatProviderId, sourceImage]);

  // === Export handlers ===
  const handleExportPdf = useCallback(async () => {
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, sceneType, imageUrls: results.map(r => r.url), decomposition }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.htmlContent) {
          // 创建HTML blob并在新窗口打开，用户可通过浏览器"打印为PDF"
          const blob = new Blob([data.htmlContent], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const printWindow = window.open(url, '_blank');
          if (printWindow) {
            printWindow.onload = () => {
              printWindow.print();
            };
          } else {
            // 弹窗被拦截，降级为下载HTML文件
            const a = document.createElement('a');
            a.href = url;
            a.download = `${brandName}_展陈方案.html`;
            a.click();
          }
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      }
    } catch (e) { console.error('[display-3d] Export PDF failed:', e); }
  }, [brandName, sceneType, results, decomposition]);

  const handleExportBom = useCallback(async () => {
    const bomData = decomposition?.bom ?? [];
    if (bomData.length === 0) {
      setErrorMsg('当前拆解结果没有可导出的 BOM 清单');
      return;
    }

    try {
      const res = await fetch('/api/export/bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, items: bomData }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.csv) {
          // 创建CSV blob并下载
          const bom = new Blob(['\ufeff' + data.csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(bom);
          const a = document.createElement('a');
          a.href = url; a.download = `${brandName}_BOM清单.csv`; a.click();
          URL.revokeObjectURL(url);
        } else if (data.items) {
          // 降级：前端直接生成CSV
          const headers = ['名称', '类型', '规格', '数量', '单价(元)', '总价(元)'];
          const rows = data.items.map((item: { name: string; type: string; spec: string; quantity: number; unitPrice: number }) =>
            [item.name, item.type, item.spec, item.quantity, item.unitPrice, item.quantity * item.unitPrice].join(',')
          );
          const csv = [headers.join(','), ...rows].join('\n');
          const bom = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(bom);
          const a = document.createElement('a');
          a.href = url; a.download = `${brandName}_BOM清单.csv`; a.click();
          URL.revokeObjectURL(url);
        }
      }
    } catch (e) { console.error('[display-3d] Export BOM failed:', e); }
  }, [brandName, decomposition]);

  const handleExportAnnotation = useCallback(async () => {
    try {
      const imageUrl = results[0]?.url || '';
      const res = await fetch('/api/export/annotation-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, brandName, sceneType, dimensions }),
      });
      const data = await res.json();
      if (data.annotations) {
        setSuccessMsg('标注图已生成，共 ' + data.annotations.length + ' 个标注点');
        setTimeout(() => setSuccessMsg(''), 4000);
      }
    } catch (e) { console.error('[display-3d] Export annotation failed:', e); }
  }, [results, brandName, sceneType, dimensions]);

  const handleSendToCanvas = useCallback(() => {
    const urls = results.map(r => r.url).filter(Boolean);
    if (urls.length > 0) onAddImages?.(urls, { modelName: selectedModel, apiProvider: selectedProviderId });
  }, [results, onAddImages, selectedModel, selectedProviderId]);

  // === 活动现场设计师 handlers ===

  // Step1: 上传场馆照片
  const handleVenueImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      // Convert to base64 for vision API
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setVenueImageUrl(dataUrl);
        setVenueAnalysis(null);
        setProposals([]);
        setSelectedProposalId(null);
        setDesignId(null);
        setVenueVersions([]);
        setVenueQcResult(null);
        setActivityStep(1);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  // Step1: 分析场馆照片
  const handleAnalyzeVenue = useCallback(async () => {
    if (!venueImageUrl) return;
    setIsAnalyzingVenue(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/activity-venue/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueImageUrl,
          brief: activityBrief.eventName || activityBrief.eventType || '',
          model: selectedChatModel || undefined,
          providerId: selectedChatProviderId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.error || '场馆分析失败');
        setIsAnalyzingVenue(false);
        return;
      }
      if (data.taskId) {
        const taskId = data.taskId;
        const poll = async () => {
          try {
            const taskRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId }),
            });
            const taskData = await taskRes.json();
            if (taskData.status === 'completed') {
              const analysis = taskData.result?.analysis;
              if (analysis) {
                setVenueAnalysis(analysis);
                // Auto-fill dimensions from analysis
                if (analysis.estimatedDimensions) {
                  setDimensions({
                    length: analysis.estimatedDimensions.length || 9000,
                    width: analysis.estimatedDimensions.width || 6000,
                    height: analysis.estimatedDimensions.height || 4500,
                  });
                }
                setSuccessMsg('场馆分析完成，已识别 ' + (analysis.regions?.length || 0) + ' 个区域');
                setTimeout(() => setSuccessMsg(''), 4000);
                setActivityStep(2);
              }
              setIsAnalyzingVenue(false);
            } else if (taskData.status === 'failed') {
              setErrorMsg(taskData.error || '场馆分析失败');
              setIsAnalyzingVenue(false);
            } else {
              setTimeout(poll, 3000);
            }
          } catch {
            setErrorMsg('场馆分析轮询失败');
            setIsAnalyzingVenue(false);
          }
        };
        poll();
      } else {
        setIsAnalyzingVenue(false);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '场馆分析失败');
      setIsAnalyzingVenue(false);
    }
  }, [venueImageUrl, activityBrief, selectedChatModel, selectedChatProviderId]);

  // Step2: 生成布局方案
  const handleGenerateProposals = useCallback(async () => {
    if (!venueAnalysis || !activityBrief.eventName.trim()) return;
    setIsGeneratingProposals(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/activity-venue/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueAnalysis, activityBrief, brandName,
          assets: assets.map(a => ({ type: a.type, url: a.url })),
          model: selectedChatModel || undefined,
          providerId: selectedChatProviderId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.error || '方案生成失败');
        setIsGeneratingProposals(false);
        return;
      }
      if (data.taskId) {
        const taskId = data.taskId;
        const poll = async () => {
          try {
            const taskRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId }),
            });
            const taskData = await taskRes.json();
            if (taskData.status === 'completed') {
              const proposalList = taskData.result?.proposals || [];
              setProposals(proposalList);
              setSuccessMsg(`已生成 ${proposalList.length} 套布局方案`);
              setTimeout(() => setSuccessMsg(''), 4000);
              setIsGeneratingProposals(false);
            } else if (taskData.status === 'failed') {
              setErrorMsg(taskData.error || '方案生成失败');
              setIsGeneratingProposals(false);
            } else {
              setTimeout(poll, 3000);
            }
          } catch {
            setErrorMsg('方案生成轮询失败');
            setIsGeneratingProposals(false);
          }
        };
        poll();
      } else {
        setIsGeneratingProposals(false);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '方案生成失败');
      setIsGeneratingProposals(false);
    }
  }, [venueAnalysis, activityBrief, brandName, assets, selectedChatModel, selectedChatProviderId]);

  // Step3: 锁定方案为DesignID
  const handleLockDesign = useCallback(async () => {
    const proposal = proposals.find(p => p.id === selectedProposalId);
    if (!proposal) return;
    setIsLockingDesign(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/activity-venue/lock-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal, brandName, venueAnalysis, activityBrief }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.error || '锁定失败');
        setIsLockingDesign(false);
        return;
      }
      if (data.designId) {
        setDesignId(data.designId);
        setSuccessMsg(`DesignID ${data.designId.version} 已锁定`);
        setTimeout(() => setSuccessMsg(''), 4000);
        setActivityStep(3);
      }
      setIsLockingDesign(false);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '锁定失败');
      setIsLockingDesign(false);
    }
  }, [proposals, selectedProposalId, brandName, venueAnalysis, activityBrief]);

  // Step4: 生成效果图（基于DesignID）
  const handleGenerateVenueRender = useCallback(async () => {
    if (!designId) return;
    setIsGeneratingVenue(true);
    setErrorMsg('');
    try {
      const locked = designId.lockedFields;
      const prompt = `${locked.renderPromptHint || ''}
Brand: ${designId.brandName}. Theme: ${designId.theme}. Concept: ${locked.concept}.
Layout: ${locked.layout?.flowDesign || ''}. Main installation: ${locked.layout?.mainInstallation || ''}.
Materials: ${(locked.materials || []).join(', ')}. Lighting: ${locked.lightingScheme}.
Primary color: ${locked.colors?.primary || ''}. Style: ${locked.colors?.scheme || ''}.
Venue type: ${locked.layout?.spaceType || 'commercial space'}.
Professional 3D exhibition rendering, photorealistic, high quality, commercial grade.`;

      const res = await fetch('/api/display-3d/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: designId.brandName,
          productName: activityBrief.eventName || '',
          sceneType: 'pop_up_store',
          environment: 'mall_atrium',
          dimensions: dimensions,
          imageUsageMode: 'style_extension',
          materialStyle: locked.materials?.[0] || '',
          lightingStyle: locked.lightingScheme || '',
          viewOptions: ['front', 'angle_45'],
          renderStyle: 'photorealistic',
          prompt,
          model: selectedModel, providerId: selectedProviderId,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.error || '效果图生成失败');
        setIsGeneratingVenue(false);
        return;
      }
      if (data.taskId) {
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
                const newVersion: VenueVersion = {
                  id: `ver_${Date.now()}`,
                  designIdVersion: designId.version,
                  imageUrl: imageUrls[0],
                  createdAt: new Date().toISOString(),
                };
                setVenueVersions(prev => [...prev, newVersion]);
                onAddImages?.(imageUrls, { modelName: selectedModel, apiProvider: selectedProviderId });
                setSuccessMsg('效果图生成完成');
                setTimeout(() => setSuccessMsg(''), 4000);
              }
              setIsGeneratingVenue(false);
            } else if (taskData.status === 'failed') {
              setErrorMsg(taskData.error || '效果图生成失败');
              setIsGeneratingVenue(false);
            } else {
              setTimeout(poll, 3000);
            }
          } catch {
            setErrorMsg('效果图生成轮询失败');
            setIsGeneratingVenue(false);
          }
        };
        poll();
      } else {
        setIsGeneratingVenue(false);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '效果图生成失败');
      setIsGeneratingVenue(false);
    }
  }, [designId, activityBrief, dimensions, selectedModel, selectedProviderId, onAddImages]);

  // Step4: 质检效果图
  const handleVenueQc = useCallback(async () => {
    const latestVersion = venueVersions[venueVersions.length - 1];
    if (!latestVersion || !designId) return;
    setIsQcRunning(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/activity-venue/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: latestVersion.imageUrl,
          designId,
          model: selectedChatModel || undefined,
          providerId: selectedChatProviderId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.error || '质检失败');
        setIsQcRunning(false);
        return;
      }
      if (data.taskId) {
        const taskId = data.taskId;
        const poll = async () => {
          try {
            const taskRes = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId }),
            });
            const taskData = await taskRes.json();
            if (taskData.status === 'completed') {
              const qc = taskData.result?.qcResult;
              if (qc) {
                setVenueQcResult(qc);
                // Attach QC to latest version
                setVenueVersions(prev => prev.map((v, i) =>
                  i === prev.length - 1 ? { ...v, qcResult: qc } : v
                ));
                setSuccessMsg(qc.passed ? `质检通过 (综合评分 ${qc.overallScore}/10)` : `质检未通过 (综合评分 ${qc.overallScore}/10)`);
                setTimeout(() => setSuccessMsg(''), 5000);
              }
              setIsQcRunning(false);
            } else if (taskData.status === 'failed') {
              setErrorMsg(taskData.error || '质检失败');
              setIsQcRunning(false);
            } else {
              setTimeout(poll, 3000);
            }
          } catch {
            setErrorMsg('质检轮询失败');
            setIsQcRunning(false);
          }
        };
        poll();
      } else {
        setIsQcRunning(false);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '质检失败');
      setIsQcRunning(false);
    }
  }, [venueVersions, designId, selectedChatModel, selectedChatProviderId]);

  // === Render helpers ===
  const inputCls = `w-full rounded-lg border px-3 py-2 text-xs outline-none transition-colors ${isMonochrome ? 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-200' : 'bg-black/30 border-white/10 text-amber-50 placeholder:text-white/30 focus:border-amber-400/60 focus:ring-1 focus:ring-amber-400/20'}`;
  const selectCls = inputCls;
  const tagBtnCls = (active: boolean) => `rounded-lg border px-3 py-1.5 text-xs cursor-pointer transition-all ${active ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/15 text-amber-200') : (isMonochrome ? 'border-gray-200 bg-gray-50 text-gray-500 hover:border-blue-300' : 'border-white/10 bg-black/30 text-white/60 hover:border-amber-400/40')}`;
  const panelCls = `rounded-xl border p-4 ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#111]/90 border-white/[0.08]'}`;
  const stepBadgeCls = `flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-bold ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'}`;

  return createPortal(
    <div className="fixed z-[200] flex items-start justify-start" style={{ pointerEvents: 'auto', ...(isMinimized ? { left: windowPos.x, top: windowPos.y } : { inset: 0 }) }}>
      {!isMinimized && <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />}

      <div
        data-popup
        className="relative flex flex-col rounded-xl overflow-hidden shadow-2xl border"
        style={{
          width: isMinimized ? 340 : 'calc(100vw - 80px)',
          height: isMinimized ? 'auto' : 'calc(100vh - 80px)',
          background: bg,
          borderColor: isMonochrome ? '#e5e5e5' : 'rgba(212,175,55,0.3)',
          ...(isMinimized ? {} : { left: windowPos.x, top: windowPos.y }),
          ...(isDragging ? { outline: `2px solid ${accent}`, outlineOffset: '-2px' } : {}),
        }}
        onMouseDown={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        {/* Title bar */}
        <div
          data-panel-header
          className="flex items-center justify-between px-3 shrink-0 cursor-move select-none"
          style={{ height: 36, background: isMonochrome ? '#f9fafb' : '#111', borderBottom: isMinimized ? 'none' : (isMonochrome ? '1px solid #e5e5e5' : '1px solid rgba(212,175,55,0.3)') }}
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-2">
            <Box size={14} style={{ color: accent }} />
            <span className="text-sm font-medium" style={{ color: textAccent }}>3D 展陈系统 Pro</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-white/10'}`}
              onClick={() => setIsMinimized(!isMinimized)}
              aria-label={isMinimized ? '展开 3D 展陈系统' : '最小化 3D 展陈系统'}
              title={isMinimized ? '展开' : '最小化'}
            >
              {isMinimized ? <Maximize2 size={14} style={{ color: textMuted }} /> : <Minus size={14} style={{ color: textMuted }} />}
            </button>
            <button
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${isMonochrome ? 'hover:bg-red-100' : 'hover:bg-red-500/30'}`}
              onClick={onClose}
              aria-label="关闭 3D 展陈系统"
              title="关闭"
            >
              <X size={14} style={{ color: textMuted }} />
            </button>
          </div>
        </div>

        {isMinimized ? null : (
          <div className="flex flex-1 overflow-hidden">
            {/* LEFT SIDEBAR */}
            <aside className="w-[240px] shrink-0 border-r flex flex-col overflow-hidden"
              style={{ background: isMonochrome ? '#f9fafb' : 'rgba(0,0,0,0.4)', borderColor: border }}
            >
              <div className="p-3">
                <button className="w-full rounded-xl py-2.5 text-xs font-bold cursor-pointer transition-all"
                  style={{ background: isMonochrome ? '#3b82f6' : '#d4af37', color: isMonochrome ? '#fff' : '#000' }}>
                  + 新建项目
                </button>
              </div>
              <div className="mx-3 mb-3 grid grid-cols-3 rounded-lg p-0.5 text-xs" style={{ background: isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.05)' }}>
                {(['projects', 'templates', 'presets'] as const).map(tab => (
                  <button key={tab} className={`rounded-md py-1.5 cursor-pointer transition-colors ${sidebarTab === tab ? (isMonochrome ? 'bg-white text-blue-600 shadow-sm' : 'bg-amber-500/20 text-amber-200') : (isMonochrome ? 'text-gray-500' : 'text-white/50')}`}
                    onClick={() => setSidebarTab(tab)}>
                    {{ projects: '项目', templates: '模板', presets: '预设' }[tab]}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto px-3">
                <div className="flex flex-col items-center justify-center py-10 text-xs" style={{ color: textMuted }}>
                  <Box size={24} className="mb-2 opacity-30" />
                  {sidebarTab === 'projects' && '暂无项目'}
                  {sidebarTab === 'templates' && '模板库即将上线'}
                  {sidebarTab === 'presets' && '场景预设即将上线'}
                </div>
              </div>
            </aside>

            {/* MAIN CONTENT */}
            <main className="flex flex-1 flex-col overflow-hidden">
              {/* Header */}
              <header className="flex items-center justify-between px-4 shrink-0" style={{ height: 44, borderBottom: `1px solid ${border}` }}>
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold" style={{ color: textPrimary }}>
                    {appMode === 'display3d' ? '3D 展陈工作台' : '活动现场设计师'}
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: isMonochrome ? '#dbeafe' : 'rgba(212,175,55,0.15)', color: textAccent }}>Pro</span>
                  {/* Mode switcher */}
                  <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: border }}>
                    <button
                      onClick={() => setAppMode('display3d')}
                      className="px-3 py-1 text-xs cursor-pointer transition-colors"
                      style={{
                        background: appMode === 'display3d' ? (isMonochrome ? '#3b82f6' : '#d4af37') : 'transparent',
                        color: appMode === 'display3d' ? (isMonochrome ? '#fff' : '#000') : textMuted,
                      }}
                    >
                      展陈设计
                    </button>
                    <button
                      onClick={() => setAppMode('activity-venue')}
                      className="px-3 py-1 text-xs cursor-pointer transition-colors"
                      style={{
                        background: appMode === 'activity-venue' ? (isMonochrome ? '#3b82f6' : '#d4af37') : 'transparent',
                        color: appMode === 'activity-venue' ? (isMonochrome ? '#fff' : '#000') : textMuted,
                      }}
                    >
                      活动现场
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowHelp(true)} className={`rounded-lg px-3 py-1.5 text-xs cursor-pointer ${isMonochrome ? 'text-gray-500 hover:bg-gray-100' : 'text-white/50 hover:bg-white/5'}`}>
                    <Info size={13} className="inline mr-1" />说明
                  </button>
                </div>
              </header>

              {/* Workspace */}
              {appMode === 'activity-venue' ? (
                /* ========== 活动现场设计师模式 ========== */
                <div className="flex flex-1 overflow-hidden p-4 gap-4">
                  {/* LEFT: 4-step workflow */}
                  <div className="w-[380px] shrink-0 overflow-y-auto pr-2 space-y-4" data-toolbar>
                    {/* Step indicator */}
                    <div className={panelCls}>
                      <div className="flex items-center gap-1 mb-3">
                        {[1,2,3,4].map(step => (
                          <div key={step} className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                if (step === 1) setActivityStep(1);
                                else if (step === 2 && venueAnalysis) setActivityStep(2);
                                else if (step === 3 && selectedProposalId) setActivityStep(3);
                                else if (step === 4 && designId) setActivityStep(4);
                              }}
                              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold cursor-pointer transition-all ${
                                activityStep === step
                                  ? (isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black')
                                  : (step === 1 || (step === 2 && venueAnalysis) || (step === 3 && selectedProposalId) || (step === 4 && designId))
                                    ? (isMonochrome ? 'bg-blue-100 text-blue-600' : 'bg-amber-400/20 text-amber-300')
                                    : (isMonochrome ? 'bg-gray-100 text-gray-400' : 'bg-white/5 text-white/30')
                              }`}
                            >
                              {step === 1 ? '1' : step === 2 ? '2' : step === 3 ? '3' : '4'}
                            </button>
                            {step < 4 && <div className="w-4 h-px" style={{ background: border }} />}
                          </div>
                        ))}
                      </div>
                      <div className="text-xs" style={{ color: textMuted }}>
                        {activityStep === 1 && '上传场馆照片，AI 识别可用区域'}
                        {activityStep === 2 && '填写活动需求，生成 3 套布局方案'}
                        {activityStep === 3 && '选择方案并锁定 Design ID'}
                        {activityStep === 4 && '生成效果图 + AI 质检'}
                      </div>
                    </div>

                    {/* Step 1: Upload & Analyze */}
                    <section className={panelCls}>
                      <div className="mb-3 flex items-center gap-2">
                        <span className={stepBadgeCls}>1</span>
                        <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>场馆照片</h3>
                        {venueAnalysis && <CheckCircle size={14} className="ml-auto" style={{ color: '#22c55e' }} />}
                      </div>
                      <div className="space-y-3">
                        {!venueImageUrl ? (
                          <button
                            onClick={handleVenueImageUpload}
                            className="w-full rounded-lg border-2 border-dashed py-6 flex flex-col items-center justify-center cursor-pointer transition-colors"
                            style={{ borderColor: border, color: textMuted }}
                          >
                            <Upload size={20} className="mb-2 opacity-50" />
                            <span className="text-xs">点击上传场馆照片</span>
                            <span className="text-[10px] mt-1 opacity-60">支持 JPG / PNG</span>
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <div className="relative rounded-lg overflow-hidden" style={{ maxHeight: 180 }}>
                              <img src={venueImageUrl} className="w-full h-full object-cover" />
                              <button
                                onClick={() => { setVenueImageUrl(''); setVenueAnalysis(null); setProposals([]); setSelectedProposalId(null); setDesignId(null); setVenueVersions([]); setVenueQcResult(null); setActivityStep(1); }}
                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                              >
                                <X size={10} />
                              </button>
                            </div>
                            <button
                              onClick={handleAnalyzeVenue}
                              disabled={isAnalyzingVenue}
                              className={`w-full rounded-lg py-2 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 ${
                                isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#c4a030]'
                              }`}
                            >
                              {isAnalyzingVenue ? <><Loader2 size={12} className="inline animate-spin mr-1" />AI 分析中...</> : venueAnalysis ? '重新分析' : 'AI 分析场馆'}
                            </button>
                          </div>
                        )}
                        {venueAnalysis && (
                          <div className="space-y-1.5 text-[11px]" style={{ color: textMuted }}>
                            <div className="flex justify-between"><span>空间类型</span><span style={{ color: textPrimary }}>{venueAnalysis.spaceType}</span></div>
                            <div className="flex justify-between"><span>估算尺寸</span><span style={{ color: textPrimary }}>{venueAnalysis.estimatedDimensions?.length}×{venueAnalysis.estimatedDimensions?.width}×{venueAnalysis.estimatedDimensions?.height}mm</span></div>
                            <div className="flex justify-between"><span>光线条件</span><span style={{ color: textPrimary }}>{venueAnalysis.lighting}</span></div>
                            <div className="flex justify-between"><span>识别区域</span><span style={{ color: textPrimary }}>{venueAnalysis.regions?.length || 0} 个</span></div>
                          </div>
                        )}
                      </div>
                    </section>

                    {/* Step 2: Activity Brief */}
                    {venueAnalysis && (
                      <section className={panelCls}>
                        <div className="mb-3 flex items-center gap-2">
                          <span className={stepBadgeCls}>2</span>
                          <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>活动需求</h3>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[12px] mb-1" style={{ color: textMuted }}>品牌名称</label>
                            <input className={inputCls} value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="品牌名称" />
                          </div>
                          <div>
                            <label className="block text-[12px] mb-1" style={{ color: textMuted }}>活动名称</label>
                            <input className={inputCls} value={activityBrief.eventName} onChange={e => setActivityBrief(prev => ({ ...prev, eventName: e.target.value }))} placeholder="如：夏季新品发布会" />
                          </div>
                          <div>
                            <label className="block text-[12px] mb-1" style={{ color: textMuted }}>活动类型</label>
                            <select className={selectCls} value={activityBrief.eventType} onChange={e => setActivityBrief(prev => ({ ...prev, eventType: e.target.value }))}>
                              <option value="品牌快闪">品牌快闪</option>
                              <option value="产品发布">产品发布</option>
                              <option value="展会展位">展会展位</option>
                              <option value="商场美陈">商场美陈</option>
                              <option value="促销活动">促销活动</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[12px] mb-1" style={{ color: textMuted }}>预期客流</label>
                              <input className={inputCls} value={activityBrief.expectedCapacity} onChange={e => setActivityBrief(prev => ({ ...prev, expectedCapacity: e.target.value }))} placeholder="如：500人/天" />
                            </div>
                            <div>
                              <label className="block text-[12px] mb-1" style={{ color: textMuted }}>预算范围</label>
                              <input className={inputCls} value={activityBrief.budget} onChange={e => setActivityBrief(prev => ({ ...prev, budget: e.target.value }))} placeholder="如：¥50,000" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[12px] mb-1" style={{ color: textMuted }}>核心目标</label>
                            <select className={selectCls} value={activityBrief.primaryGoal} onChange={e => setActivityBrief(prev => ({ ...prev, primaryGoal: e.target.value }))}>
                              <option value="品牌曝光">品牌曝光</option>
                              <option value="产品体验">产品体验</option>
                              <option value="销售转化">销售转化</option>
                              <option value="社交传播">社交传播</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[12px] mb-1" style={{ color: textMuted }}>品牌风格</label>
                            <input className={inputCls} value={activityBrief.brandStyle} onChange={e => setActivityBrief(prev => ({ ...prev, brandStyle: e.target.value }))} placeholder="如：年轻潮流、高端奢华" />
                          </div>
                          <div>
                            <label className="block text-[12px] mb-1" style={{ color: textMuted }}>特别要求</label>
                            <textarea className={`${inputCls} resize-none`} rows={2} value={activityBrief.specialRequirements} onChange={e => setActivityBrief(prev => ({ ...prev, specialRequirements: e.target.value }))} placeholder="如：需要互动装置、打卡墙" />
                          </div>
                          <button
                            onClick={handleGenerateProposals}
                            disabled={isGeneratingProposals || !activityBrief.eventName.trim() || !brandName.trim()}
                            className={`w-full rounded-lg py-2 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 ${
                              isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#c4a030]'
                            }`}
                          >
                            {isGeneratingProposals ? <><Loader2 size={12} className="inline animate-spin mr-1" />生成中...</> : '生成 3 套布局方案'}
                          </button>
                        </div>
                      </section>
                    )}

                    {/* Step 3: Select & Lock Proposal */}
                    {proposals.length > 0 && (
                      <section className={panelCls}>
                        <div className="mb-3 flex items-center gap-2">
                          <span className={stepBadgeCls}>3</span>
                          <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>选择方案</h3>
                          {designId && <Lock size={14} className="ml-auto" style={{ color: '#22c55e' }} />}
                        </div>
                        <div className="space-y-2">
                          {proposals.map(p => (
                            <button
                              key={p.id}
                              onClick={() => setSelectedProposalId(p.id)}
                              className={`w-full rounded-lg border p-3 text-left cursor-pointer transition-all ${
                                selectedProposalId === p.id
                                  ? (isMonochrome ? 'border-blue-400 bg-blue-50' : 'border-amber-400/60 bg-amber-400/10')
                                  : (isMonochrome ? 'border-gray-200 hover:border-blue-300' : 'border-white/10 hover:border-amber-400/40')
                              }`}
                            >
                              <div className="text-xs font-semibold" style={{ color: selectedProposalId === p.id ? textAccent : textPrimary }}>{p.name}</div>
                              <div className="text-[11px] mt-1 line-clamp-2" style={{ color: textMuted }}>{p.concept}</div>
                              <div className="flex gap-1 mt-2 flex-wrap">
                                {p.highlights?.slice(0, 3).map((h, i) => (
                                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: isMonochrome ? '#eff6ff' : 'rgba(212,175,55,0.1)', color: textMuted }}>{h}</span>
                                ))}
                              </div>
                            </button>
                          ))}
                        </div>
                        {selectedProposalId && !designId && (
                          <button
                            onClick={handleLockDesign}
                            disabled={isLockingDesign}
                            className={`w-full mt-3 rounded-lg py-2 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 ${
                              isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#c4a030]'
                            }`}
                          >
                            {isLockingDesign ? <><Loader2 size={12} className="inline animate-spin mr-1" />锁定中...</> : '锁定为 Design ID'}
                          </button>
                        )}
                        {designId && (
                          <div className="mt-3 rounded-lg p-2.5 text-[11px]" style={{ background: isMonochrome ? '#f0fdf4' : 'rgba(34,197,94,0.1)', border: `1px solid ${isMonochrome ? '#bbf7d0' : 'rgba(34,197,94,0.2)'}` }}>
                            <div className="flex items-center gap-1 mb-1">
                              <Lock size={12} style={{ color: '#22c55e' }} />
                              <span className="font-semibold" style={{ color: isMonochrome ? '#166534' : '#4ade80' }}>DesignID: {designId.version}</span>
                            </div>
                            <div style={{ color: textMuted }}>{designId.theme} · {designId.lockedFields?.layout?.mainInstallation}</div>
                          </div>
                        )}
                      </section>
                    )}

                    {/* Step 4: Generate & QC */}
                    {designId && (
                      <section className={panelCls}>
                        <div className="mb-3 flex items-center gap-2">
                          <span className={stepBadgeCls}>4</span>
                          <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>生成与质检</h3>
                        </div>
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={handleGenerateVenueRender}
                              disabled={isGeneratingVenue}
                              className={`rounded-lg py-2 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 ${
                                isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#c4a030]'
                              }`}
                            >
                              {isGeneratingVenue ? <><Loader2 size={12} className="inline animate-spin mr-1" />生成中...</> : '生成效果图'}
                            </button>
                            <button
                              onClick={handleVenueQc}
                              disabled={isQcRunning || venueVersions.length === 0}
                              className={`rounded-lg py-2 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 border ${
                                isMonochrome ? 'border-blue-300 text-blue-600 hover:bg-blue-50' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'
                              }`}
                            >
                              {isQcRunning ? <><Loader2 size={12} className="inline animate-spin mr-1" />质检中...</> : 'AI 质检'}
                            </button>
                          </div>
                          {/* Version history */}
                          {venueVersions.length > 0 && (
                            <div>
                              <div className="text-[12px] font-semibold mb-2" style={{ color: textMuted }}>版本历史 ({venueVersions.length})</div>
                              <div className="space-y-2">
                                {venueVersions.map((v, i) => (
                                  <div key={v.id} className="rounded-lg border p-2" style={{ borderColor: border }}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[10px] font-medium" style={{ color: textMuted }}>v{i + 1} · {v.designIdVersion}</span>
                                      {v.qcResult && (
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${v.qcResult.passed ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                                          {v.qcResult.passed ? '通过' : '未通过'} {v.qcResult.overallScore}/10
                                        </span>
                                      )}
                                    </div>
                                    <div className="rounded overflow-hidden" style={{ maxHeight: 80 }}>
                                      <img src={v.imageUrl} className="w-full h-full object-cover" />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </section>
                    )}
                  </div>

                  {/* RIGHT: Preview */}
                  <div className="flex flex-1 flex-col overflow-hidden rounded-xl border" style={{ background: bgCard, borderColor: border }}>
                    {/* Preview tabs */}
                    <div className="flex items-center gap-1 px-3 py-2 shrink-0 border-b" style={{ borderColor: border }}>
                      {(['venue', 'proposals', 'render', 'qc'] as const).map(tab => (
                        <button
                          key={tab}
                          onClick={() => {
                            if (tab === 'venue') setActivityStep(1);
                            else if (tab === 'proposals') setActivityStep(2);
                            else if (tab === 'render') setActivityStep(4);
                            else if (tab === 'qc') setActivityStep(4);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                            (tab === 'venue' && activityStep === 1) ||
                            (tab === 'proposals' && activityStep === 2) ||
                            (tab === 'render' && activityStep === 4) ||
                            (tab === 'qc' && activityStep === 4)
                              ? (isMonochrome ? 'bg-blue-100 text-blue-700' : 'bg-amber-500/20 text-amber-200')
                              : (isMonochrome ? 'text-gray-500 hover:bg-gray-100' : 'text-white/50 hover:bg-white/5')
                          }`}
                        >
                          {{ venue: '场馆', proposals: '方案', render: '效果图', qc: '质检' }[tab]}
                        </button>
                      ))}
                    </div>

                    {/* Preview content */}
                    <div className="flex-1 overflow-y-auto p-4">
                      {/* Venue analysis view */}
                      {activityStep === 1 && venueImageUrl && venueAnalysis && (
                        <div className="space-y-4">
                          <div className="text-sm font-semibold" style={{ color: textPrimary }}>场馆区域标注</div>
                          <VenueRegionCanvas
                            imageUrl={venueImageUrl}
                            regions={venueAnalysis.regions || []}
                            selectedRegionId={selectedVenueRegion}
                            onSelectRegion={setSelectedVenueRegion}
                          />
                          <div className="grid grid-cols-2 gap-2 mt-3">
                            {(venueAnalysis.regions || []).map(r => (
                              <button
                                key={r.id}
                                onClick={() => setSelectedVenueRegion(r.id === selectedVenueRegion ? null : r.id)}
                                className={`rounded-lg border p-2 text-left cursor-pointer transition-all ${
                                  selectedVenueRegion === r.id
                                    ? (isMonochrome ? 'border-blue-400 bg-blue-50' : 'border-amber-400/60 bg-amber-400/10')
                                    : (isMonochrome ? 'border-gray-200' : 'border-white/10')
                                }`}
                              >
                                <div className="text-xs font-medium" style={{ color: selectedVenueRegion === r.id ? textAccent : textPrimary }}>{r.name}</div>
                                <div className="text-[10px] mt-0.5" style={{ color: textMuted }}>{r.type} · {r.estimatedSize || '-'}</div>
                                {r.notes && <div className="text-[10px] mt-1 line-clamp-1" style={{ color: textMuted }}>{r.notes}</div>}
                              </button>
                            ))}
                          </div>
                          {venueAnalysis.designNotes && (
                            <div className="rounded-lg p-3 text-[11px]" style={{ background: isMonochrome ? '#eff6ff' : 'rgba(59,130,246,0.1)', color: textMuted }}>
                              <div className="font-semibold mb-1" style={{ color: textPrimary }}>设计建议</div>
                              {venueAnalysis.designNotes}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Proposals view */}
                      {activityStep === 2 && proposals.length > 0 && (
                        <div className="space-y-4">
                          <div className="text-sm font-semibold" style={{ color: textPrimary }}>布局方案对比</div>
                          {proposals.map(p => (
                            <div key={p.id} className={`rounded-xl border p-4 ${selectedProposalId === p.id ? (isMonochrome ? 'border-blue-400' : 'border-amber-400/60') : ''}`} style={{ borderColor: selectedProposalId === p.id ? undefined : border }}>
                              <div className="flex items-start justify-between">
                                <div>
                                  <div className="text-sm font-semibold" style={{ color: selectedProposalId === p.id ? textAccent : textPrimary }}>{p.name}</div>
                                  <div className="text-[12px] mt-1" style={{ color: textMuted }}>{p.concept}</div>
                                </div>
                                <span className="text-xs px-2 py-1 rounded-full shrink-0 ml-2" style={{ background: isMonochrome ? '#eff6ff' : 'rgba(212,175,55,0.1)', color: textAccent }}>{p.estimatedCost}</span>
                              </div>
                              <div className="grid grid-cols-3 gap-2 mt-3">
                                <div className="rounded-lg p-2 text-[11px]" style={{ background: isMonochrome ? '#f9fafb' : 'rgba(255,255,255,0.03)' }}>
                                  <div className="font-semibold mb-1" style={{ color: textMuted }}>主装置</div>
                                  <div style={{ color: textPrimary }}>{p.mainInstallation}</div>
                                </div>
                                <div className="rounded-lg p-2 text-[11px]" style={{ background: isMonochrome ? '#f9fafb' : 'rgba(255,255,255,0.03)' }}>
                                  <div className="font-semibold mb-1" style={{ color: textMuted }}>材质</div>
                                  <div style={{ color: textPrimary }}>{p.visualElements?.materials?.join('、')}</div>
                                </div>
                                <div className="rounded-lg p-2 text-[11px]" style={{ background: isMonochrome ? '#f9fafb' : 'rgba(255,255,255,0.03)' }}>
                                  <div className="font-semibold mb-1" style={{ color: textMuted }}>灯光</div>
                                  <div style={{ color: textPrimary }}>{p.visualElements?.lighting}</div>
                                </div>
                              </div>
                              <div className="mt-3 text-[11px]" style={{ color: textMuted }}>
                                <div className="font-semibold mb-1">人流动线</div>
                                {p.flowDesign}
                              </div>
                              <div className="flex gap-2 mt-3">
                                {p.pros?.map((pro, i) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">+ {pro}</span>
                                ))}
                                {p.cons?.map((con, i) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500">- {con}</span>
                                ))}
                              </div>
                              <button
                                onClick={() => setSelectedProposalId(p.id)}
                                className={`mt-3 w-full rounded-lg py-1.5 text-xs cursor-pointer transition-colors ${
                                  selectedProposalId === p.id
                                    ? (isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black')
                                    : (isMonochrome ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-white/5 text-white/60 hover:bg-white/10')
                                }`}
                              >
                                {selectedProposalId === p.id ? '已选中' : '选择此方案'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Render results view */}
                      {activityStep === 4 && (
                        <div className="space-y-4">
                          {venueVersions.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-xs" style={{ color: textMuted }}>
                              <Box size={32} className="mb-3 opacity-20" />
                              <div>点击&quot;生成效果图&quot;按钮生成展陈效果图</div>
                              <div className="mt-1 text-[10px] opacity-60">基于锁定的 DesignID 生成</div>
                            </div>
                          ) : (
                            <>
                              {/* Latest result */}
                              <div className="space-y-3">
                                <div className="text-sm font-semibold" style={{ color: textPrimary }}>最新效果图</div>
                                <div className="rounded-xl overflow-hidden">
                                  <img src={venueVersions[venueVersions.length - 1]?.imageUrl} className="w-full" />
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => { const urls = venueVersions.map(v => v.imageUrl); if (urls.length > 0) onAddImages?.(urls, { modelName: selectedModel, apiProvider: selectedProviderId }); }}
                                    className={`flex-1 rounded-lg border px-3 py-2 text-xs cursor-pointer ${isMonochrome ? 'border-blue-300 text-blue-600 hover:bg-blue-50' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'}`}
                                  >
                                    发送到画布
                                  </button>
                                  <button
                                    onClick={handleVenueQc}
                                    disabled={isQcRunning}
                                    className={`flex-1 rounded-lg border px-3 py-2 text-xs cursor-pointer disabled:opacity-50 ${isMonochrome ? 'border-blue-300 text-blue-600 hover:bg-blue-50' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'}`}
                                  >
                                    {isQcRunning ? '质检中...' : '重新质检'}
                                  </button>
                                </div>
                              </div>

                              {/* QC Result */}
                              {venueQcResult && (
                                <div className={`rounded-xl border p-4 ${venueQcResult.passed ? (isMonochrome ? 'border-green-200' : 'border-green-500/30') : (isMonochrome ? 'border-red-200' : 'border-red-500/30')}`}>
                                  <div className="flex items-center gap-2 mb-3">
                                    {venueQcResult.passed
                                      ? <CheckCircle size={18} style={{ color: '#22c55e' }} />
                                      : <AlertTriangle size={18} style={{ color: '#ef4444' }} />}
                                    <span className="text-sm font-bold" style={{ color: venueQcResult.passed ? '#22c55e' : '#ef4444' }}>
                                      {venueQcResult.verdict}
                                    </span>
                                    <span className="ml-auto text-lg font-bold" style={{ color: textAccent }}>{venueQcResult.overallScore}/10</span>
                                  </div>
                                  <div className="grid grid-cols-5 gap-2">
                                    {Object.entries(venueQcResult.dimensions || {}).map(([key, dim]) => {
                                      const labels: Record<string, string> = { brandIdentity: '品牌识别', styleConsistency: '风格一致', spaceLayout: '空间布局', materialColor: '材质色彩', overallQuality: '整体质量' };
                                      return (
                                        <div key={key} className="rounded-lg p-2 text-center" style={{ background: isMonochrome ? '#f9fafb' : 'rgba(255,255,255,0.03)' }}>
                                          <div className="text-[10px]" style={{ color: textMuted }}>{labels[key] || key}</div>
                                          <div className="text-sm font-bold mt-1" style={{ color: dim.score >= 7 ? '#22c55e' : dim.score >= 5 ? '#f59e0b' : '#ef4444' }}>{dim.score}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {venueQcResult.suggestions?.length > 0 && (
                                    <div className="mt-3 text-[11px]" style={{ color: textMuted }}>
                                      <div className="font-semibold mb-1" style={{ color: textPrimary }}>优化建议</div>
                                      {venueQcResult.suggestions.map((s, i) => <div key={i} className="mt-0.5">· {s}</div>)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {/* Empty state */}
                      {((activityStep === 1 && !venueImageUrl) || (activityStep === 2 && proposals.length === 0)) && (
                        <div className="flex flex-col items-center justify-center py-20 text-xs" style={{ color: textMuted }}>
                          <MapPin size={32} className="mb-3 opacity-20" />
                          {activityStep === 1 && !venueImageUrl && <div>请先上传场馆照片</div>}
                          {activityStep === 2 && proposals.length === 0 && <div>请先填写活动需求并生成方案</div>}
                        </div>
                      )}
                    </div>

                    {/* Bottom: error/success messages */}
                    {(errorMsg || successMsg) && (
                      <div className="px-4 py-2 shrink-0 border-t" style={{ borderColor: border }}>
                        {errorMsg && <div className="text-xs" style={{ color: '#ef4444' }}>{errorMsg}</div>}
                        {successMsg && <div className="text-xs" style={{ color: '#22c55e' }}>{successMsg}</div>}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* ========== 原有展陈设计模式 ========== */
                <div className="grid flex-1 grid-cols-[360px_1fr] gap-4 overflow-hidden p-4">
                {/* LEFT: Form */}
                <div className="overflow-y-auto pr-2 space-y-4" data-toolbar>
                  {/* Basic Info: Brand & Product */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>*</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>品牌与产品</h3>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: isMonochrome ? '#fef2f2' : 'rgba(239,68,68,0.15)', color: isMonochrome ? '#dc2626' : '#f87171' }}>必填</span>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[12px] mb-1 font-medium" style={{ color: textMuted }}>品牌名称 <span style={{ color: isMonochrome ? '#dc2626' : '#f87171' }}>*</span></label>
                        <input className={inputCls} placeholder="如：NIKE、星巴克、华为" value={brandName} onChange={e => setBrandName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-[12px] mb-1" style={{ color: textMuted }}>产品名称</label>
                        <input className={inputCls} placeholder="如：Air Max 2025、抹茶拿铁" value={productName} onChange={e => setProductName(e.target.value)} />
                      </div>
                    </div>
                  </section>

                  {/* Step 1: Upload */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>1</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>资产上传</h3>
                      <span className="text-[11px] ml-auto" style={{ color: textMuted }}>点击上传对应素材</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {ASSET_TYPES.map(at => (
                        <button key={at.key} className={`h-[52px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors ${assets.some(a => a.type === at.key) ? (isMonochrome ? 'border-blue-400 bg-blue-50' : 'border-amber-400/60 bg-amber-400/10') : ''}`}
                          style={{ borderColor: assets.some(a => a.type === at.key) ? undefined : border, color: assets.some(a => a.type === at.key) ? textAccent : textMuted }}
                          onClick={() => handleUpload(at.label)}>
                          {at.icon}
                          <span className="text-[9px] mt-0.5">{at.label}</span>
                        </button>
                      ))}
                    </div>
                    {assets.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {assets.map(a => (
                          <div key={a.id} className="relative group rounded border overflow-hidden" style={{ borderColor: border }}>
                            <div className="w-12 h-12">
                              <img src={a.url} className="w-full h-full object-cover" />
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-white text-center py-0.5 truncate px-0.5">{a.type}</div>
                            <button className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setAssets(prev => prev.filter(x => x.id !== a.id))}><X size={8} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 mb-2 text-[12px] font-semibold" style={{ color: textMuted }}>快捷资产库</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {ASSET_LIBRARY.map(lib => (
                        <button key={lib} className="rounded-lg border px-1.5 py-1.5 text-[10px] cursor-pointer transition-colors"
                          style={{ borderColor: border, color: textMuted, background: 'transparent' }}
                          onClick={() => handleUpload(lib)}>
                          {lib}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Step 2: Image usage mode */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>2</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>图像使用模式</h3>
                    </div>
                    <div className="space-y-1.5">
                      {IMAGE_USAGE_MODES.map(m => (
                        <button key={m.value} className={`w-full rounded-lg border p-2.5 text-left cursor-pointer transition-all ${imageUsageMode === m.value ? (isMonochrome ? 'border-blue-400 bg-blue-50' : 'border-amber-400/60 bg-amber-400/10') : (isMonochrome ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-black/30')}`}
                          onClick={() => setImageUsageMode(m.value)}>
                          <div className="text-xs font-medium" style={{ color: imageUsageMode === m.value ? textAccent : textPrimary }}>{m.label}</div>
                          <div className="text-[12px] mt-0.5" style={{ color: textMuted }}>{m.desc}</div>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Step 3: Render style */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>3</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>渲染风格</h3>
                    </div>
                    <div className="space-y-1.5">
                      {RENDER_STYLES.map(s => (
                        <button key={s.value} className={`w-full rounded-lg border p-2.5 text-left cursor-pointer transition-all ${renderStyle === s.value ? (isMonochrome ? 'border-blue-400 bg-blue-50' : 'border-amber-400/60 bg-amber-400/10') : (isMonochrome ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-black/30')}`}
                          onClick={() => setRenderStyle(s.value)}>
                          <div className="flex items-center gap-2">
                            <span style={{ color: renderStyle === s.value ? accent : textMuted }}>{s.icon}</span>
                            <div className="text-xs font-medium" style={{ color: renderStyle === s.value ? textAccent : textPrimary }}>{s.label}</div>
                          </div>
                          <div className="text-[12px] mt-0.5 ml-6" style={{ color: textMuted }}>{s.desc}</div>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Step 4: Scene setting */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>4</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>场景设置</h3>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {SCENE_TYPES.map(s => (
                        <button key={s.value} className={`rounded-lg border p-2 text-[12px] flex flex-col items-center gap-1 cursor-pointer transition-all ${sceneType === s.value ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400/60 bg-amber-400/10 text-amber-200') : (isMonochrome ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-white/10 bg-black/30 text-white/60')}`}
                          onClick={() => setSceneType(s.value)}>
                          {s.icon}<span>{s.label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>长 (mm)</label><input className={inputCls} type="number" value={dimensions.length} onChange={e => setDimensions(p => ({ ...p, length: Number(e.target.value) }))} /></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>宽 (mm)</label><input className={inputCls} type="number" value={dimensions.width} onChange={e => setDimensions(p => ({ ...p, width: Number(e.target.value) }))} /></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>高 (mm)</label><input className={inputCls} type="number" value={dimensions.height} onChange={e => setDimensions(p => ({ ...p, height: Number(e.target.value) }))} /></div>
                    </div>
                  </section>

                  {/* Step 5: Environment & Size */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>5</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>环境与尺寸设置</h3>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {ENVIRONMENTS.map(e => (
                        <button key={e.value} className={tagBtnCls(environment === e.value)} onClick={() => setEnvironment(e.value)}>{e.label}</button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>预算（¥）</label><input className={inputCls} type="number" placeholder="150000" value={budget} onChange={e => setBudget(e.target.value ? Number(e.target.value) : '')} /></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>材质风格</label><select className={selectCls} value={materialStyle} onChange={e => setMaterialStyle(e.target.value)}>{MATERIAL_STYLES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>灯光氛围</label><select className={selectCls} value={lightingStyle} onChange={e => setLightingStyle(e.target.value)}>{LIGHTING_STYLES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>人群氛围</label><select className={selectCls} value={crowdStyle} onChange={e => setCrowdStyle(e.target.value)}>{CROWD_STYLES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>品牌主色</label><input className={inputCls} placeholder="如：#FF6600、星空蓝" value={brandColor} onChange={e => setBrandColor(e.target.value)} /></div>
                      <div><label className="block text-[12px] mb-1" style={{ color: textMuted }}>重点展示产品</label><input className={inputCls} placeholder="如：旗舰新品、限量联名款" value={focusProduct} onChange={e => setFocusProduct(e.target.value)} /></div>
                    </div>
                    <textarea className={`${inputCls} min-h-[56px]`} placeholder="附加需求，如空间动线、竞品差异化、互动装置..." value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} />
                  </section>

                  {/* Step 5: View selector */}
                  <section className={panelCls}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={stepBadgeCls}>6</span>
                      <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>输出视角选择</h3>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {VIEW_OPTIONS.map(v => (
                        <button key={v.value} className={tagBtnCls(viewOptions.includes(v.value))} onClick={() => toggleView(v.value)}>{v.label}</button>
                      ))}
                    </div>
                  </section>

                  {/* Output settings (inline) */}
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className="block text-[12px] mb-1" style={{ color: textMuted }}>分辨率</label>
                      <select className={selectCls} value={outputResolution} onChange={e => setOutputResolution(e.target.value)}>
                        {OUTPUT_RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] mb-1" style={{ color: textMuted }}>格式</label>
                      <select className={selectCls} value={outputFormat} onChange={e => setOutputFormat(e.target.value)}>
                        {OUTPUT_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[12px] mb-1" style={{ color: textMuted }}>质量</label>
                      <select className={selectCls} value={outputQuality} onChange={e => setOutputQuality(e.target.value)}>
                        {OUTPUT_QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
                      </select>
                    </div>
                  </div>
                  {/* Aspect ratio selector for generation */}
                  <div className="mb-3">
                    <label className="block text-[12px] mb-1" style={{ color: textMuted }}>生成比例</label>
                    <div className="flex gap-1 flex-wrap">
                      {(['16:9', '4:3', '1:1', '3:4', '9:16'] as const).map(ratio => (
                        <button
                          key={ratio}
                          onClick={() => setGenerateAspectRatio(ratio)}
                          className="px-2 py-1 rounded text-[11px] transition-colors"
                          style={{
                            background: generateAspectRatio === ratio
                              ? (isMonochrome ? '#111827' : '#d4af37')
                              : (isMonochrome ? '#f3f4f6' : 'rgba(255,255,255,0.07)'),
                            color: generateAspectRatio === ratio
                              ? (isMonochrome ? '#fff' : '#111')
                              : textMuted,
                            border: generateAspectRatio === ratio
                              ? 'none'
                              : `1px solid ${isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.1)'}`,
                          }}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Image Model selector */}
                  {availableModels.length > 0 && (
                    <div>
                      <label className="block text-[12px] mb-1" style={{ color: textMuted }}>图像模型</label>
                      <select
                        className="rounded-lg border px-2 py-1.5 text-[12px] cursor-pointer w-full"
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
                        {Array.from(new Set(availableModels.map(m => m.providerName || '未知'))).map(pName => (
                          <optgroup key={pName} label={pName}>
                            {availableModels
                              .filter(m => (m.providerName || '未知') === pName)
                              .map((m: { providerId: string; model: string; displayName?: string; providerName?: string }) => (
                                <option key={`${m.providerId}::${m.model}`} value={`${m.providerId}::${m.model}`}>
                                  {getModelDisplayName(m.model)}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                      {selectedModel && (
                        <div className="text-[10px] mt-0.5" style={{ color: textMuted }}>
                          {getModelDisplayName(selectedModel)} · 来自 {availableModels.find(m => m.providerId === selectedProviderId && m.model === selectedModel)?.providerName || '未知'}
                        </div>
                      )}
                    </div>
                  )}

                  {/* LLM Model selector */}
                  {chatModels.length > 0 && (
                    <div>
                      <label className="block text-[12px] mb-1" style={{ color: textMuted }}>LLM模型</label>
                      <select
                        className="rounded-lg border px-2 py-1.5 text-[12px] cursor-pointer w-full"
                        style={{
                          background: isMonochrome ? '#f9fafb' : '#111',
                          color: isMonochrome ? '#374151' : '#e5e5e5',
                          borderColor: isMonochrome ? '#d1d5db' : 'rgba(255,255,255,0.12)',
                        }}
                        value={`${selectedChatProviderId}::${selectedChatModel}`}
                        onChange={(e) => {
                          const val = e.target.value;
                          const sepIdx = val.indexOf('::');
                          if (sepIdx >= 0) {
                            setSelectedChatProviderId(val.substring(0, sepIdx));
                            setSelectedChatModel(val.substring(sepIdx + 2));
                          }
                        }}
                      >
                        {Array.from(new Set(chatModels.map(m => m.providerName || '未知'))).map(pName => (
                          <optgroup key={pName} label={pName}>
                            {chatModels
                              .filter(m => (m.providerName || '未知') === pName)
                              .map(m => (
                                <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                                  {m.name || m.id}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                      {selectedChatModel && (
                        <div className="text-[10px] mt-0.5" style={{ color: textMuted }}>
                          {chatModels.find(m => m.providerId === selectedChatProviderId && m.id === selectedChatModel)?.name || selectedChatModel} · 来自 {chatModels.find(m => m.providerId === selectedChatProviderId && m.id === selectedChatModel)?.providerName || '未知'}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Generate button */}
                  <button
                    className="w-full rounded-xl py-3 text-sm font-bold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: isMonochrome ? '#3b82f6' : '#d4af37', color: isMonochrome ? '#fff' : '#000' }}
                    onClick={handleGenerate}
                    disabled={isGenerating || !brandName.trim()}
                  >
                    {isGenerating ? <><Loader2 size={14} className="inline animate-spin mr-1" />生成中...</> : <><Sparkles size={14} className="inline mr-1" />生成展陈方案</>}
                  </button>
                  {errorMsg && (
                    <p className="text-xs mt-1.5 px-1" style={{ color: '#ef4444' }}>{errorMsg}</p>
                  )}
                  {successMsg && (
                    <p className="text-xs mt-1.5 px-1" style={{ color: '#22c55e' }}>{successMsg}</p>
                  )}
                </div>

                {/* RIGHT: Preview + Decomposition */}
                <div className="flex flex-col gap-3 overflow-hidden">
                  {/* Preview Stage */}
                  <section className={`${panelCls} flex-1 flex flex-col overflow-hidden`}>
                    {/* Tabs */}
                    <div className="flex items-center gap-1 mb-3 overflow-x-auto">
                      {(['render', 'views', 'decompose', 'dimension', 'material', 'floorplan', 'bom'] as const).map(tab => (
                        <button key={tab} className={`rounded-lg px-2.5 py-1.5 text-[12px] whitespace-nowrap cursor-pointer transition-colors ${activePreviewTab === tab ? (isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-amber-500/20 text-amber-200') : (isMonochrome ? 'text-gray-500 hover:bg-gray-100' : 'text-white/50 hover:bg-white/5')}`}
                          onClick={() => setActivePreviewTab(tab)}>
                          {{ render: '效果图', views: '多角度', decompose: '方案拆解', dimension: '尺寸标注', material: '材质工艺', floorplan: '平面拆解图', bom: '物料清单BOM' }[tab]}
                        </button>
                      ))}
                    </div>

                    {/* Render preview */}
                    {activePreviewTab === 'render' && (
                      <div className="flex-1 flex gap-3 overflow-hidden">
                        <div className="flex-1 rounded-xl border flex items-center justify-center relative overflow-hidden"
                          style={{ background: isMonochrome ? '#f9fafb' : 'rgba(0,0,0,0.4)', borderColor: border }}>
                          {results.length > 0 ? (
                            <img src={results[0]?.url} className="w-full h-full object-contain" />
                          ) : (
                            <div className="flex flex-col items-center text-xs" style={{ color: textMuted }}>
                              <Box size={32} className="mb-2 opacity-20" />
                              {isGenerating ? '正在生成3D展陈效果图...' : '设置参数后点击"生成展陈方案"'}
                            </div>
                          )}
                          {/* Numbered annotations overlay */}
                          {!isGenerating && results.length > 0 && (decomposition?.components ?? []).map((comp, i) => (
                            <div key={comp.id} className="absolute rounded-full w-5 h-5 flex items-center justify-center text-[9px] font-bold cursor-pointer"
                              style={{ background: accent, color: isMonochrome ? '#fff' : '#000', left: `${10 + i * 8}%`, top: `${20 + (i % 4) * 14}%` }}>
                              {comp.index}
                            </div>
                          ))}
                        </div>
                        {/* View thumbnails */}
                        <div className="w-[120px] space-y-1.5 overflow-y-auto">
                          {VIEW_OPTIONS.filter(v => viewOptions.includes(v.value)).map((v, i) => (
                            <button key={v.value} className={`w-full h-[46px] rounded-lg border flex items-center justify-center text-[12px] cursor-pointer ${selectedView === v.value ? (isMonochrome ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-amber-400 text-amber-200') : (isMonochrome ? 'border-gray-200 text-gray-500' : 'border-white/10 text-white/50')}`}
                              onClick={() => setSelectedView(v.value)}>
                              {v.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Decomposition: Component list */}
                    {activePreviewTab === 'decompose' && (
                      <div className="flex-1 overflow-auto">
                        <div className="mb-2 flex items-center gap-2">
                          <button
                            className="rounded-lg border px-3 py-1.5 text-[12px] cursor-pointer disabled:opacity-50"
                            style={{ borderColor: border, color: textAccent }}
                            onClick={handleDecompose}
                            disabled={isDecomposing || (!sourceImage?.url && results.length === 0)}
                          >
                            {isDecomposing ? <><Loader2 size={10} className="inline animate-spin mr-1" />拆解中...</> : <><Sparkles size={10} className="inline mr-1" />AI 拆解方案</>}
                          </button>
                        </div>
                        <table className="w-full text-[12px]">
                          <thead><tr style={{ color: textMuted }}>
                            <th className="py-2 text-left">编号</th>
                            <th className="text-left">部件名称</th>
                            <th className="text-left">尺寸建议</th>
                            <th className="text-left">材质</th>
                            <th className="text-left">工艺</th>
                          </tr></thead>
                          <tbody>
                            {(decomposition?.components ?? []).map(comp => (
                              <tr key={comp.id} style={{ borderTop: `1px solid ${border}` }}>
                                <td className="py-2" style={{ color: textAccent }}>{comp.index}</td>
                                <td style={{ color: textPrimary }}>{comp.name}</td>
                                <td style={{ color: textMuted }}>{comp.sizeSuggestion}</td>
                                <td style={{ color: textMuted }}>{comp.material}</td>
                                <td style={{ color: textMuted }}>{comp.craft}</td>
                              </tr>
                            ))}
                            {!isDecomposing && (decomposition?.components ?? []).length === 0 && (
                              <tr><td colSpan={5} className="py-8 text-center" style={{ color: textMuted }}>尚无真实构件拆解结果。请选择分析模型后执行 AI 拆解。</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Floor plan */}
                    {activePreviewTab === 'floorplan' && (
                      <div className="flex-1 flex flex-col gap-3 overflow-auto">
                        {(decomposition?.floorPlanZones ?? []).length > 0 ? (
                          <>
                            <div className="rounded-xl border p-3" style={{ background: isMonochrome ? '#f9fafb' : 'rgba(0,0,0,0.4)', borderColor: border }}>
                              <div className="mb-2 flex items-center justify-between text-[11px]" style={{ color: textMuted }}>
                                <span>空间建议：{dimensions.length} × {dimensions.width} mm</span>
                                <span>基于本次 AI 拆解</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {(decomposition?.floorPlanZones ?? []).map((zone, index) => (
                                  <div key={`${zone.name}-${index}`} className="rounded-lg border p-2" style={{ borderColor: border, background: bgCard }}>
                                    <div className="text-xs font-medium" style={{ color: textPrimary }}>{index + 1}. {zone.name}</div>
                                    <div className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>{zone.description || '本次分析未提供区域说明'}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <p className="text-[11px]" style={{ color: textMuted }}>区域顺序仅用于方案沟通，不代表精确平面位置或施工动线。</p>
                            {(decomposition?.notes ?? []).length > 0 && (
                              <div className="rounded-lg border p-2 text-[11px]" style={{ borderColor: border, background: bgCard, color: textMuted }}>
                                <div className="mb-1 font-medium" style={{ color: textPrimary }}>制作复核提示</div>
                                <ul className="list-disc space-y-1 pl-4">
                                  {(decomposition?.notes ?? []).map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}
                                </ul>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-xs py-8" style={{ color: textMuted }}>
                            <Layout size={28} className="mb-2 opacity-20" />
                            本次分析未返回平面分区信息。
                          </div>
                        )}
                      </div>
                    )}

                    {/* Material specs */}
                    {activePreviewTab === 'material' && (
                      <div className="flex-1 overflow-auto space-y-2">
                        {(decomposition?.materials ?? []).map(m => (
                          <div key={m.id} className="flex gap-2 rounded-lg p-2" style={{ background: bgCard }}>
                            <div className="h-10 w-10 rounded-lg shrink-0" style={{ background: isMonochrome ? '#dbeafe' : 'rgba(212,175,55,0.3)' }} />
                            <div>
                              <div className="text-xs" style={{ color: textPrimary }}>{m.name}</div>
                              <div className="text-[12px]" style={{ color: textMuted }}>{m.description}</div>
                            </div>
                          </div>
                        ))}
                        {!isDecomposing && (decomposition?.materials ?? []).length === 0 && (
                          <div className="py-8 text-center text-xs" style={{ color: textMuted }}>本次分析未返回材质与工艺信息。</div>
                        )}
                      </div>
                    )}

                    {/* BOM */}
                    {activePreviewTab === 'bom' && (
                      <div className="flex-1 overflow-auto">
                        {(decomposition?.bom ?? []).length > 0 ? (
                          <>
                            <div className="mb-2 text-xs font-semibold" style={{ color: textAccent }}>
                              预估成本 ¥{(decomposition?.bom ?? []).reduce((sum, b) => sum + (parseInt(String(b.estimatedPrice).replace(/[¥,]/g, '')) || 0), 0).toLocaleString('zh-CN')}
                            </div>
                            <div className="space-y-1.5">
                              {(decomposition?.bom ?? []).map(item => (
                                <div key={item.id} className="flex justify-between items-center rounded-lg px-2.5 py-2 text-xs" style={{ background: bgCard }}>
                                  <span style={{ color: textPrimary }}>{item.name}</span>
                                  <span style={{ color: textMuted }}>x{item.count}</span>
                                  <span style={{ color: textAccent }}>{item.estimatedPrice}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="py-8 text-center text-xs" style={{ color: textMuted }}>本次分析未返回 BOM，暂不可导出清单。</div>
                        )}
                      </div>
                    )}

                    {/* Dimension annotations */}
                    {activePreviewTab === 'dimension' && (
                      <div className="flex-1 overflow-auto">
                        {results.length > 0 ? (
                          <div className="space-y-2">
                            <div className="relative rounded-xl border overflow-hidden" style={{ background: isMonochrome ? '#f9fafb' : 'rgba(0,0,0,0.4)', borderColor: border }}>
                              <img src={results[0]?.url} className="w-full h-auto max-h-[280px] object-contain" />
                              {/* Dimension overlay lines */}
                              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                <line x1="10" y1="50" x2="90" y2="50" stroke={accent} strokeWidth="0.5" strokeDasharray="2,1" />
                                <line x1="50" y1="10" x2="50" y2="90" stroke={accent} strokeWidth="0.5" strokeDasharray="2,1" />
                                <text x="50" y="48" textAnchor="middle" fill={accent} fontSize="4" fontWeight="bold">{dimensions.length}mm</text>
                                <text x="48" y="55" textAnchor="middle" fill={accent} fontSize="4" fontWeight="bold">{dimensions.width}mm</text>
                                <text x="52" y="15" textAnchor="middle" fill={accent} fontSize="4" fontWeight="bold">{dimensions.height}mm</text>
                              </svg>
                            </div>
                            <div className="space-y-1">
                              {(decomposition?.components ?? []).map(comp => (
                                <div key={comp.id} className="flex items-center justify-between text-[12px] px-2 py-1.5 rounded-lg" style={{ background: bgCard }}>
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: accent, color: isMonochrome ? '#fff' : '#000' }}>{comp.index}</span>
                                    <span style={{ color: textPrimary }}>{comp.name}</span>
                                  </span>
                                  <span style={{ color: textMuted }}>{comp.sizeSuggestion}</span>
                                </div>
                              ))}
                              {(decomposition?.components ?? []).length === 0 && (
                                <div className="py-4 text-center text-xs" style={{ color: textMuted }}>暂无部件尺寸建议。</div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-xs py-8" style={{ color: textMuted }}>
                            <Ruler size={28} className="mb-2 opacity-20" />
                            生成效果图后自动标注各部件尺寸
                          </div>
                        )}
                      </div>
                    )}

                    {activePreviewTab === 'views' && (
                      <div className="flex-1 flex flex-col gap-2 overflow-auto">
                        {viewOptions.length > 0 ? (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-[12px]" style={{ color: textMuted }}>已选 {viewOptions.length} 个视角</span>
                              <button
                                className="rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer disabled:opacity-50"
                                style={{ borderColor: border, color: textAccent }}
                                onClick={handleGenerate}
                                disabled={isGenerating || results.length === 0}
                              >
                                {isGenerating ? <><Loader2 size={10} className="inline animate-spin mr-1" />生成中...</> : <><Sparkles size={10} className="inline mr-1" />批量生成多角度</>}
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 flex-1">
                              {viewOptions.map(v => {
                                const viewResult = results.find((r, i) => i > 0 && r.label === VIEW_OPTIONS.find(o => o.value === v)?.label);
                                return (
                                  <div key={v} className="rounded-lg border flex flex-col items-center justify-center h-[120px] relative overflow-hidden" style={{ borderColor: border, background: bgCard }}>
                                    {viewResult?.url ? (
                                      <img src={viewResult.url} className="w-full h-full object-cover" />
                                    ) : (
                                      <span className="text-[12px]" style={{ color: textMuted }}>{VIEW_OPTIONS.find(o => o.value === v)?.label || v}</span>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-[9px] text-white text-center py-0.5">
                                      {VIEW_OPTIONS.find(o => o.value === v)?.label || v}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-xs py-8" style={{ color: textMuted }}>
                            <Camera size={28} className="mb-2 opacity-20" />
                            请在“输出视角选择”中勾选视角
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  {/* Bottom decomposition row */}
                  <div className="grid grid-cols-[1.2fr_0.9fr_0.65fr_0.65fr] gap-2 min-h-[200px]" style={{ maxHeight: '240px' }}>
                    {/* Component list mini */}
                    <section className={`${panelCls} overflow-auto`}>
                      <h3 className="text-[12px] font-semibold mb-2" style={{ color: textPrimary }}>方案拆解 · 构成部件</h3>
                      <div className="space-y-1">
                        {(decomposition?.components ?? []).slice(0, 5).map(c => (
                          <div key={c.id} className="flex items-center justify-between text-[9px] py-0.5" style={{ color: textMuted }}>
                            <span style={{ color: textAccent }}>{c.index}.</span>
                            <span className="flex-1 ml-1" style={{ color: textPrimary }}>{c.name}</span>
                            <span>{c.sizeSuggestion}</span>
                          </div>
                        ))}
                        {(decomposition?.components ?? []).length === 0 && <div className="py-6 text-center text-[10px]" style={{ color: textMuted }}>暂无真实拆解数据</div>}
                      </div>
                    </section>

                    {/* Floor plan mini */}
                    <section className={`${panelCls} overflow-auto`}>
                      <h3 className="text-[12px] font-semibold mb-2" style={{ color: textPrimary }}>AI 平面分区建议</h3>
                      <div className="space-y-1">
                        {(decomposition?.floorPlanZones ?? []).slice(0, 4).map((zone, index) => (
                          <div key={`${zone.name}-${index}`} className="text-[9px]" style={{ color: textMuted }}>
                            <span style={{ color: textAccent }}>{index + 1}.</span>{' '}
                            <span style={{ color: textPrimary }}>{zone.name}</span>
                            {zone.description && <div className="pl-3 mt-0.5">{zone.description}</div>}
                          </div>
                        ))}
                        {(decomposition?.floorPlanZones ?? []).length === 0 && <div className="py-6 text-center text-[10px]" style={{ color: textMuted }}>暂无平面分区数据</div>}
                      </div>
                    </section>

                    {/* Material mini */}
                    <section className={`${panelCls} overflow-auto`}>
                      <h3 className="text-[12px] font-semibold mb-2" style={{ color: textPrimary }}>材质工艺</h3>
                      <div className="space-y-1">
                        {(decomposition?.materials ?? []).slice(0, 4).map(m => (
                          <div key={m.id} className="text-[9px]" style={{ color: textMuted }}>
                            <div style={{ color: textPrimary }}>{m.name}</div>
                          </div>
                        ))}
                        {(decomposition?.materials ?? []).length === 0 && <div className="py-6 text-center text-[10px]" style={{ color: textMuted }}>暂无材质数据</div>}
                      </div>
                    </section>

                    {/* BOM mini */}
                    <section className={`${panelCls} overflow-auto`}>
                      <h3 className="text-[12px] font-semibold mb-1" style={{ color: textPrimary }}>物料清单 BOM</h3>
                      <div className="space-y-0.5">
                        {(decomposition?.bom ?? []).slice(0, 5).map(item => (
                          <div key={item.id} className="flex justify-between text-[9px]" style={{ color: textMuted }}>
                            <span>{item.name}</span>
                            <span style={{ color: textAccent }}>{item.estimatedPrice}</span>
                          </div>
                        ))}
                        {(decomposition?.bom ?? []).length === 0 && <div className="py-6 text-center text-[10px]" style={{ color: textMuted }}>暂无 BOM 数据</div>}
                      </div>
                    </section>
                  </div>

                  {/* Export & action buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className={`rounded-lg border px-3 py-1.5 text-[12px] cursor-pointer disabled:opacity-50 ${isMonochrome ? 'border-blue-300 text-blue-600 hover:bg-blue-50' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'}`}
                      onClick={handleExportPdf}
                      disabled={results.length === 0}
                    >
                      导出PDF方案
                    </button>
                    <button
                      className={`rounded-lg border px-3 py-1.5 text-[12px] cursor-pointer disabled:opacity-50 ${isMonochrome ? 'border-blue-300 text-blue-600 hover:bg-blue-50' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'}`}
                      onClick={handleExportAnnotation}
                      disabled={results.length === 0}
                    >
                      导出标注图
                    </button>
                    <button
                      className={`rounded-lg border px-3 py-1.5 text-[12px] cursor-pointer disabled:opacity-50 ${isMonochrome ? 'border-blue-300 text-blue-600 hover:bg-blue-50' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'}`}
                      onClick={handleExportBom}
                      disabled={(decomposition?.bom.length ?? 0) === 0}
                    >
                      导出BOM
                    </button>
                    <button
                      className={`rounded-lg border px-3 py-1.5 text-[12px] cursor-pointer disabled:opacity-50 ${isMonochrome ? 'border-blue-300 text-blue-600 hover:bg-blue-50' : 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'}`}
                      onClick={() => { if (results.length > 0) onAddImages?.(results.slice(0, 1).map(r => r.url), { modelName: selectedModel, apiProvider: selectedProviderId }); }}
                      disabled={results.length === 0}
                    >
                      发送到画布
                    </button>
                  </div>

                  {/* Disclaimer */}
                  <div className="text-[9px] shrink-0 px-1" style={{ color: textMuted }}>
                    ⚠ AI效果图不是施工图 · 尺寸为建议尺寸 · 材质为推荐材质 · 平面拆解图为方案沟通图 · 真正落地需要设计师/制作方/结构工程师复核
                  </div>
                </div>
              </div>
              )}
            </main>

            {/* ====== 使用说明弹窗 ====== */}
            {showHelp && (
              <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowHelp(false)} style={{ background: 'rgba(0,0,0,0.6)' }}>
                <div className="w-[520px] max-h-[80vh] overflow-y-auto rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()} style={{ background: isMonochrome ? '#fff' : '#1a1a1a', border: `1px solid ${isMonochrome ? '#e5e5e5' : 'rgba(255,255,255,0.1)'}` }}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold" style={{ color: textPrimary }}>3D 展陈系统 Pro — 使用说明</h2>
                    <button onClick={() => setShowHelp(false)} className="rounded-lg p-1.5 cursor-pointer" style={{ color: textMuted }}><X size={18} /></button>
                  </div>
                  <div className="space-y-4 text-[13px] leading-relaxed" style={{ color: textPrimary }}>
                    <section>
                      <h3 className="text-sm font-semibold mb-1.5" style={{ color: textAccent }}>功能概述</h3>
                      <p style={{ color: textMuted }}>基于 AI 图像模型的商业级 3D 展陈空间效果图生成工具。输入品牌信息和展陈参数，一键生成逼真效果图，并支持方案拆解、尺寸标注、材质工艺、BOM 清单等多维度输出。</p>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold mb-1.5" style={{ color: textAccent }}>操作流程（6 步）</h3>
                      <ol className="space-y-1.5 list-decimal pl-4" style={{ color: textMuted }}>
                        <li><b style={{ color: textPrimary }}>品牌与产品</b>：填写品牌名称（必填）和产品名称，品牌名会融入效果图的门头与导视系统</li>
                        <li><b style={{ color: textPrimary }}>资产上传</b>：上传品牌素材（10种分类：主视觉KV/背板图/门头图/地贴图/海报图/包装图/Logo/IP形象/3D截图/效果图），AI 会参考素材风格生成展陈图</li>
                        <li><b style={{ color: textPrimary }}>图像使用模式</b>：定义上传图片的使用方式（贴图应用：直接贴到背板/灯箱/地贴；风格延展：参考图片风格生成展陈；结构参考：参考图片空间结构）</li>
                        <li><b style={{ color: textPrimary }}>渲染风格</b>：选择输出风格 — 写实照片级（真实场景，适合方案汇报）、3D渲染级（高质量渲染质感，默认推荐）、概念草图级（快速概念表达）</li>
                        <li><b style={{ color: textPrimary }}>场景设置</b>：选择展陈类型（快闪店/展会展位/商超堆头/橱窗陈列/打卡装置/产品展示台/商场美陈）和空间尺寸（长×宽×高 mm）</li>
                        <li><b style={{ color: textPrimary }}>环境与尺寸</b>：设定场地环境（商场中庭/展馆/门店/户外/超市）、预算、材质风格、灯光氛围、人群氛围、品牌主色、重点展示产品</li>
                      </ol>
                      <p className="mt-2" style={{ color: textMuted }}>然后在“输出视角选择”中勾选需要的视角，设置分辨率/格式/质量，点击“生成展陈方案”即可。</p>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold mb-1.5" style={{ color: textAccent }}>右侧预览区</h3>
                      <ul className="space-y-1 list-disc pl-4" style={{ color: textMuted }}>
                        <li><b style={{ color: textPrimary }}>效果图</b>：查看生成的主效果图，点击可添加到画布</li>
                        <li><b style={{ color: textPrimary }}>多角度</b>：不同视角的效果图展示</li>
                        <li><b style={{ color: textPrimary }}>方案拆解</b>：AI 分析展陈空间的结构组件、尺寸、材质</li>
                        <li><b style={{ color: textPrimary }}>尺寸标注</b>：标注展陈各部件的尺寸信息</li>
                        <li><b style={{ color: textPrimary }}>材质工艺</b>：推荐各部件的材质与制作工艺</li>
                        <li><b style={{ color: textPrimary }}>平面拆解图</b>：俯视平面布局方案图</li>
                        <li><b style={{ color: textPrimary }}>物料清单BOM</b>：展陈所需的物料清单及预算估算</li>
                      </ul>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold mb-1.5" style={{ color: textAccent }}>导出功能</h3>
                      <ul className="space-y-1 list-disc pl-4" style={{ color: textMuted }}>
                        <li><b style={{ color: textPrimary }}>导出PDF</b>：将效果图+拆解方案导出为PDF文档</li>
                        <li><b style={{ color: textPrimary }}>导出BOM</b>：将物料清单导出为CSV表格</li>
                        <li><b style={{ color: textPrimary }}>发送到画布</b>：将效果图发送到无限画布进行后续编辑</li>
                      </ul>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold mb-1.5" style={{ color: textAccent }}>注意事项</h3>
                      <ul className="space-y-1 list-disc pl-4" style={{ color: textMuted }}>
                        <li>AI 效果图不是施工图，尺寸为建议尺寸，真正落地需设计师/制作方/结构工程师复核</li>
                        <li>品牌名称为必填项，会体现在生成图的门头和品牌标识上</li>
                        <li>上传资产越丰富（KV、Logo、IP形象），生成效果越贴合品牌</li>
                        <li>需要管理员后台配置可用的图像模型才能生成效果图</li>
                      </ul>
                    </section>
                  </div>
                  <div className="mt-5 flex justify-end">
                    <button className="rounded-lg px-4 py-2 text-sm font-medium cursor-pointer" style={{ background: isMonochrome ? '#3b82f6' : '#d4af37', color: isMonochrome ? '#fff' : '#000' }} onClick={() => setShowHelp(false)}>知道了</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
