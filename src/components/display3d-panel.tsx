'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getModelDisplayName } from '@/lib/model-name-map';
import {
  Box, X, Minus, Maximize2, Upload, Image as ImageIcon, Layers,
  ChevronDown, Sparkles, Download, Send, Search,
  Ruler, Paintbrush, LayoutGrid, Eye, Lightbulb,
  Users, Store, Building2, TreePine, FileText,
  Grid3X3, BarChart3, DollarSign, Info, Loader2, Palette,
  Camera, RotateCcw, FileDown, DoorOpen, FileImage, Package, Monitor
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

export interface Display3DResult {
  id: string;
  type: string;
  url: string;
  label?: string;
}

interface Props {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[], meta?: { modelName?: string; apiProvider?: string }) => void;
}

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

// Mock data for decomposition
const MOCK_COMPONENTS: DisplayComponent[] = [
  { id: '1', index: 1, name: '门头', sizeSuggestion: '9000×1200×600', material: '发光字+亚克力', craft: '烤漆+内发光' },
  { id: '2', index: 2, name: '主背板', sizeSuggestion: '6000×3000', material: '喷绘布+KT板', craft: 'UV喷绘' },
  { id: '3', index: 3, name: '灯箱', sizeSuggestion: '800×1800×120', material: '亚克力+灯片', craft: '内发光' },
  { id: '4', index: 4, name: '展柜', sizeSuggestion: '1200×600×950', material: '木质+玻璃', craft: '烤漆' },
  { id: '5', index: 5, name: '地贴', sizeSuggestion: '9000×6000', material: 'PVC地贴', craft: 'UV喷印' },
  { id: '6', index: 6, name: '立牌', sizeSuggestion: '600×1600', material: 'KT板+PVC', craft: 'UV喷绘' },
  { id: '7', index: 7, name: '打卡装置', sizeSuggestion: '1800×1800×2400', material: '亚克力+铁艺', craft: '烤漆造型' },
  { id: '8', index: 8, name: '收银台', sizeSuggestion: '1500×700×1050', material: '木质+亚克力', craft: '烤漆' },
  { id: '9', index: 9, name: '展示台', sizeSuggestion: '1000×1000×900', material: '木质+亚克力', craft: '烤漆+灯带' },
];

const MOCK_MATERIALS: DisplayMaterialSpec[] = [
  { id: '1', name: '乳白色烤漆板', description: '表面烤漆，高光细腻' },
  { id: '2', name: '亚克力灯箱', description: '内发光，均匀透光' },
  { id: '3', name: '金色不锈钢拉丝', description: '304拉丝，香槟金' },
  { id: '4', name: 'PVC地贴', description: 'UV喷印，防滑耐磨' },
  { id: '5', name: '木纹饰面板', description: '环保板材，木纹自然' },
  { id: '6', name: '喷绘布', description: 'UV喷绘，色彩饱满' },
];

const MOCK_BOM: BomItem[] = [
  { id: '1', name: '门头', count: 1, estimatedPrice: '¥12,800' },
  { id: '2', name: '主背板', count: 1, estimatedPrice: '¥9,600' },
  { id: '3', name: '灯箱', count: 2, estimatedPrice: '¥6,400' },
  { id: '4', name: '展柜', count: 3, estimatedPrice: '¥18,900' },
  { id: '5', name: '地贴', count: 1, estimatedPrice: '¥3,200' },
  { id: '6', name: '立牌', count: 2, estimatedPrice: '¥1,600' },
  { id: '7', name: '打卡装置', count: 1, estimatedPrice: '¥7,800' },
  { id: '8', name: '收银台', count: 1, estimatedPrice: '¥6,500' },
  { id: '9', name: '展示台', count: 4, estimatedPrice: '¥11,200' },
];

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
export default function Display3DPanel({ isMonochrome = false, onClose, onAddImages }: Props) {
  // === Window drag state ===
  const [isMinimized, setIsMinimized] = useState(false);
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
    rawAnalysis?: string;
  } | null>(null);
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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
          quality: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).quality : undefined; } catch { return undefined; } })(),
          aspectRatio: (() => { try { const s = localStorage.getItem('wujie_selected_model'); return s ? JSON.parse(s).aspectRatio : undefined; } catch { return undefined; } })(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        console.error('[display-3d] Generate error:', data.error);
        setErrorMsg(data.error?.message || data.error || '3D 生成提交失败');
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
              setErrorMsg(taskData.error?.message || taskData.error || '3D 生成任务失败');
              setIsGenerating(false);
            } else {
              setTimeout(poll, 3000);
            }
          } catch (e) {
            console.error('[display-3d] Poll error:', e);
            setErrorMsg(e instanceof Error ? e.message : '3D 任务轮询失败');
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
      setErrorMsg(e instanceof Error ? e.message : '3D 生成请求失败');
      setIsGenerating(false);
    }
  }, [brandName, productName, sceneType, environment, dimensions, imageUsageMode, materialStyle, lightingStyle, budget, viewOptions, renderStyle, outputResolution, outputFormat, outputQuality, customPrompt, crowdStyle, assets, onAddImages, selectedModel, selectedProviderId, brandColor, focusProduct]);

  // === Decompose handler ===
  const handleDecompose = useCallback(async () => {
    if (!brandName.trim() || results.length === 0) return;
    setIsDecomposing(true);
    try {
      const imageUrl = results[0]?.url || '';
      const res = await fetch('/api/display-3d/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, sceneType, dimensions, imageUrl, model: selectedChatModel || undefined, providerId: selectedChatProviderId || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        console.error('[display-3d] Decompose error:', data.error);
        setIsDecomposing(false);
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
              const decomposeResult = taskData.result?.decomposition || taskData.result;
              if (decomposeResult) {
                setDecomposition({
                  components: decomposeResult.components?.map((c: Record<string, unknown>, i: number) => ({
                    id: String(i + 1), index: c.index as number || i + 1,
                    name: (c.name as string) || '未命名', sizeSuggestion: (c.sizeSuggestion as string) || '-',
                    material: (c.material as string) || '-', craft: (c.craft as string) || '-',
                  })) || MOCK_COMPONENTS,
                  materials: decomposeResult.materials?.map((m: Record<string, unknown>, i: number) => ({
                    id: String(i + 1), name: (m.name as string) || '未指定',
                    description: (m.description as string) || '',
                  })) || MOCK_MATERIALS,
                  bom: decomposeResult.bom?.map((b: Record<string, unknown>, i: number) => ({
                    id: String(i + 1), name: (b.name as string) || '未指定',
                    count: (b.count as number) || 1,
                    estimatedPrice: typeof b.estimatedPrice === 'number' ? `¥${b.estimatedPrice.toLocaleString()}` : (b.estimatedPrice as string) || '-',
                  })) || MOCK_BOM,
                  rawAnalysis: decomposeResult.rawAnalysis || taskData.result?.rawAnalysis,
                });
              }
              setIsDecomposing(false);
              setActivePreviewTab('decompose');
            } else if (taskData.status === 'failed') {
              console.error('[display-3d] Decompose failed:', taskData.error);
              setIsDecomposing(false);
            } else {
              setTimeout(poll, 3000);
            }
          } catch (e) {
            console.error('[display-3d] Decompose poll error:', e);
            setIsDecomposing(false);
          }
        };
        poll();
      } else {
        setIsDecomposing(false);
      }
    } catch (e) {
      console.error('[display-3d] Decompose failed:', e);
      setIsDecomposing(false);
    }
  }, [brandName, sceneType, dimensions, results, onAddImages, selectedChatModel, selectedChatProviderId, selectedModel, selectedProviderId]);

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
    try {
      const bomData = decomposition?.bom || MOCK_BOM;
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
            <button className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-white/10'}`} onClick={() => setIsMinimized(!isMinimized)}>
              {isMinimized ? <Maximize2 size={14} style={{ color: textMuted }} /> : <Minus size={14} style={{ color: textMuted }} />}
            </button>
            <button className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${isMonochrome ? 'hover:bg-red-100' : 'hover:bg-red-500/30'}`} onClick={onClose}>
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
                  <h2 className="text-base font-semibold" style={{ color: textPrimary }}>3D 展陈工作台</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: isMonochrome ? '#dbeafe' : 'rgba(212,175,55,0.15)', color: textAccent }}>Pro</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowHelp(true)} className={`rounded-lg px-3 py-1.5 text-xs cursor-pointer ${isMonochrome ? 'text-gray-500 hover:bg-gray-100' : 'text-white/50 hover:bg-white/5'}`}>
                    <Info size={13} className="inline mr-1" />说明
                  </button>
                </div>
              </header>

              {/* Workspace */}
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
                  <div className="grid grid-cols-3 gap-2 mb-3">
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
                          {!isGenerating && results.length > 0 && MOCK_COMPONENTS.map((comp, i) => (
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
                            disabled={isDecomposing || results.length === 0}
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
                            {(decomposition?.components || MOCK_COMPONENTS).map(comp => (
                              <tr key={comp.id} style={{ borderTop: `1px solid ${border}` }}>
                                <td className="py-2" style={{ color: textAccent }}>{comp.index}</td>
                                <td style={{ color: textPrimary }}>{comp.name}</td>
                                <td style={{ color: textMuted }}>{comp.sizeSuggestion}</td>
                                <td style={{ color: textMuted }}>{comp.material}</td>
                                <td style={{ color: textMuted }}>{comp.craft}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Floor plan */}
                    {activePreviewTab === 'floorplan' && (
                      <div className="flex-1 flex flex-col">
                        <div className="flex-1 rounded-xl border relative" style={{ background: isMonochrome ? '#f9fafb' : 'rgba(0,0,0,0.4)', borderColor: border }}>
                          <svg viewBox="0 0 400 260" className="w-full h-full">
                            <rect x="50" y="35" width="300" height="180" rx="20" fill={isMonochrome ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.08)'} stroke={accent} strokeWidth="1.5" />
                            <text x="200" y="25" textAnchor="middle" fill={textMuted} fontSize="11">{dimensions.length} mm</text>
                            <text x="35" y="130" textAnchor="middle" fill={textMuted} fontSize="11" transform="rotate(-90 35 130)">{dimensions.width} mm</text>
                            {MOCK_COMPONENTS.map((comp, i) => {
                              const positions = [[300,55],[200,55],[100,90],[200,130],[80,180],[320,180],[200,180],[280,130],[130,135]];
                              const [cx, cy] = positions[i] || [150, 100];
                              return (
                                <g key={comp.id}>
                                  <circle cx={cx} cy={cy} r="13" fill={accent} />
                                  <text x={cx} y={cy + 4} textAnchor="middle" fill={isMonochrome ? '#fff' : '#000'} fontSize="11" fontWeight="bold">{comp.index}</text>
                                </g>
                              );
                            })}
                            <path d="M200 245 L200 215" stroke={accent} strokeWidth="2" />
                            <text x="200" y="255" textAnchor="middle" fill={textPrimary} fontSize="11">入口</text>
                          </svg>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[12px]" style={{ color: textMuted }}>
                          <span>人流动线</span><span>展示区</span><span>体验区</span><span>服务区</span><span>储物/后场</span>
                        </div>
                      </div>
                    )}

                    {/* Material specs */}
                    {activePreviewTab === 'material' && (
                      <div className="flex-1 overflow-auto space-y-2">
                        {(decomposition?.materials || MOCK_MATERIALS).map(m => (
                          <div key={m.id} className="flex gap-2 rounded-lg p-2" style={{ background: bgCard }}>
                            <div className="h-10 w-10 rounded-lg shrink-0" style={{ background: isMonochrome ? '#dbeafe' : 'rgba(212,175,55,0.3)' }} />
                            <div>
                              <div className="text-xs" style={{ color: textPrimary }}>{m.name}</div>
                              <div className="text-[12px]" style={{ color: textMuted }}>{m.description}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* BOM */}
                    {activePreviewTab === 'bom' && (
                      <div className="flex-1 overflow-auto">
                        <div className="mb-2 text-xs font-semibold" style={{ color: textAccent }}>
                          预估成本 {decomposition?.bom ? `¥${decomposition.bom.reduce((sum, b) => sum + (parseInt(String(b.estimatedPrice).replace(/[¥,]/g, '')) || 0), 0).toLocaleString()}` : '¥128,560'}
                        </div>
                        <div className="space-y-1.5">
                          {(decomposition?.bom || MOCK_BOM).map(item => (
                            <div key={item.id} className="flex justify-between items-center rounded-lg px-2.5 py-2 text-xs" style={{ background: bgCard }}>
                              <span style={{ color: textPrimary }}>{item.name}</span>
                              <span style={{ color: textMuted }}>x{item.count}</span>
                              <span style={{ color: textAccent }}>{item.estimatedPrice}</span>
                            </div>
                          ))}
                        </div>
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
                              {(decomposition?.components || MOCK_COMPONENTS).map(comp => (
                                <div key={comp.id} className="flex items-center justify-between text-[12px] px-2 py-1.5 rounded-lg" style={{ background: bgCard }}>
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: accent, color: isMonochrome ? '#fff' : '#000' }}>{comp.index}</span>
                                    <span style={{ color: textPrimary }}>{comp.name}</span>
                                  </span>
                                  <span style={{ color: textMuted }}>{comp.sizeSuggestion}</span>
                                </div>
                              ))}
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
                            请在"输出视角选择"中勾选视角
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
                        {MOCK_COMPONENTS.slice(0, 5).map(c => (
                          <div key={c.id} className="flex items-center justify-between text-[9px] py-0.5" style={{ color: textMuted }}>
                            <span style={{ color: textAccent }}>{c.index}.</span>
                            <span className="flex-1 ml-1" style={{ color: textPrimary }}>{c.name}</span>
                            <span>{c.sizeSuggestion}</span>
                          </div>
                        ))}
                      </div>
                    </section>

                    {/* Floor plan mini */}
                    <section className={`${panelCls} overflow-hidden`}>
                      <h3 className="text-[12px] font-semibold mb-2" style={{ color: textPrimary }}>AI 平面拆解参考图</h3>
                      <div className="h-[140px]">
                        <svg viewBox="0 0 200 140" className="w-full h-full">
                          <rect x="25" y="15" width="150" height="100" rx="10" fill={isMonochrome ? 'rgba(59,130,246,0.06)' : 'rgba(255,255,255,0.05)'} stroke={accent} strokeWidth="1" />
                          {[[1,150,28],[2,100,28],[3,50,50],[4,100,70],[5,40,95]].map(([id,x,y]) => (
                            <g key={id}>
                              <circle cx={x} cy={y} r="8" fill={accent} />
                              <text x={x} y={y+3} textAnchor="middle" fill={isMonochrome ? '#fff' : '#000'} fontSize="8" fontWeight="bold">{id}</text>
                            </g>
                          ))}
                          <text x="100" y="130" textAnchor="middle" fill={textMuted} fontSize="8">入口</text>
                        </svg>
                      </div>
                    </section>

                    {/* Material mini */}
                    <section className={`${panelCls} overflow-auto`}>
                      <h3 className="text-[12px] font-semibold mb-2" style={{ color: textPrimary }}>材质工艺</h3>
                      <div className="space-y-1">
                        {MOCK_MATERIALS.slice(0, 4).map(m => (
                          <div key={m.id} className="text-[9px]" style={{ color: textMuted }}>
                            <div style={{ color: textPrimary }}>{m.name}</div>
                          </div>
                        ))}
                      </div>
                    </section>

                    {/* BOM mini */}
                    <section className={`${panelCls} overflow-auto`}>
                      <h3 className="text-[12px] font-semibold mb-1" style={{ color: textPrimary }}>物料清单 BOM</h3>
                      <div className="text-[9px] mb-1" style={{ color: textAccent }}>¥128,560</div>
                      <div className="space-y-0.5">
                        {MOCK_BOM.slice(0, 5).map(item => (
                          <div key={item.id} className="flex justify-between text-[9px]" style={{ color: textMuted }}>
                            <span>{item.name}</span>
                            <span style={{ color: textAccent }}>{item.estimatedPrice}</span>
                          </div>
                        ))}
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
                      disabled={results.length === 0}
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
                      <p className="mt-2" style={{ color: textMuted }}>然后在"输出视角选择"中勾选需要的视角，设置分辨率/格式/质量，点击"生成展陈方案"即可。</p>
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
