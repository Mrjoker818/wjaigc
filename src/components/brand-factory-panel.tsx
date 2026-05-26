'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Plus, Trash2, Sparkles, Loader2, ChevronDown, ChevronRight,
  Palette, Compass, LayoutGrid, FolderOpen, Archive, ArchiveRestore,
  Copy, Download, Check, AlertTriangle, RefreshCw, Wand2, Eye,
  Image as ImageIcon, Building2, Edit3, Layers, Star, Search,
  GripVertical, Upload, Save, History, Shield, FileText,
  Package, ShoppingCart, Store, Gift, UserCircle, Megaphone,
  ZoomIn, RotateCcw, ToggleLeft, ToggleRight, ExternalLink,
} from 'lucide-react';

// ═══ Types ═══

interface BrandProject {
  id: string;
  projectName: string;
  brandName: string;
  industry: string;
  projectType: string;
  keywords: string[];
  targetAudience: string;
  tone: string;
  description: string;
  logoUrl: string;
  productUrl: string;
  ipUrl: string;
  referenceUrls: string[];
  brandDna: Record<string, unknown>;
  creativeDirections: CreativeDirection[];
  status: string;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

interface CreativeDirection {
  id: string;
  name: string;
  concept: string;
  slogan: string;
  visualKeywords: string[];
  colorPlan: string[];
  fontPlan: string;
  compositionStyle: string;
  prompt: string;
  recommendedMaterials: string[];
}

interface BrandMaterial {
  id: string;
  projectId: string;
  directionId: string;
  materialType: string;
  title: string;
  ratio: string;
  imageUrl: string;
  prompt: string;
  score: number;
  status: string;
  createdAt: number;
}

interface VersionRecord {
  id: string;
  projectId: string;
  targetType: string;
  targetId: string;
  versionName: string;
  note: string;
  snapshot: Record<string, unknown>;
  createdAt: number;
}

interface ImageModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

interface LlmModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

type TabId = 'projects' | 'assets' | 'dna' | 'directions' | 'kv' | 'materials' | 'consistency' | 'versions' | 'export';

const TAB_CONFIG: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'projects', label: '项目', icon: <FolderOpen size={13} /> },
  { id: 'assets', label: '资产', icon: <Layers size={13} /> },
  { id: 'dna', label: 'DNA', icon: <Palette size={13} /> },
  { id: 'directions', label: '方向', icon: <Compass size={13} /> },
  { id: 'kv', label: 'KV', icon: <Megaphone size={13} /> },
  { id: 'materials', label: '物料', icon: <LayoutGrid size={13} /> },
  { id: 'consistency', label: '检测', icon: <Shield size={13} /> },
  { id: 'versions', label: '版本', icon: <History size={13} /> },
  { id: 'export', label: '导出', icon: <Download size={13} /> },
];

const INDUSTRY_OPTIONS = [
  '餐饮美食', '时尚服饰', '美妆护肤', '数码科技', '家居生活',
  '教育培训', '医疗健康', '金融保险', '汽车出行', '文化娱乐',
  '体育健身', '旅游酒店', '食品饮料', '母婴亲子', '其他',
];

const TONE_OPTIONS = [
  '高端奢华', '年轻潮流', '温暖亲切', '专业严谨', '活泼有趣',
  '简约现代', '复古经典', '自然生态', '科技未来', '东方美学',
];

// ═══ Material Types by Category (from document section 7.1-7.8) ═══

const MATERIAL_CATEGORIES: {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: { id: string; label: string; ratio: string }[];
}[] = [
  {
    id: 'brand-base',
    label: '品牌基础包',
    icon: <Star size={13} />,
    items: [
      { id: 'logo-page', label: 'Logo应用页', ratio: '16:9' },
      { id: 'brand-color-card', label: '品牌色卡', ratio: '1:1' },
      { id: 'brand-font-page', label: '品牌字体页', ratio: '16:9' },
      { id: 'brand-pattern', label: '品牌纹样', ratio: '1:1' },
      { id: 'brand-moodboard', label: '品牌Moodboard', ratio: '16:9' },
      { id: 'brand-visual-board', label: '品牌视觉板', ratio: '16:9' },
      { id: 'brand-spec', label: '品牌规范一页纸', ratio: '16:9' },
    ],
  },
  {
    id: 'ad',
    label: '广告传播包',
    icon: <Megaphone size={13} />,
    items: [
      { id: 'kv-main', label: '品牌主KV', ratio: '16:9' },
      { id: 'ad-new-product', label: '新品上市海报', ratio: '3:4' },
      { id: 'ad-upgrade', label: '品牌升级海报', ratio: '3:4' },
      { id: 'ad-event', label: '活动海报', ratio: '3:4' },
      { id: 'ad-holiday', label: '节日海报', ratio: '3:4' },
      { id: 'ad-product', label: '产品广告图', ratio: '1:1' },
      { id: 'ad-bus-stop', label: '公交站广告', ratio: '16:9' },
      { id: 'ad-subway', label: '地铁灯箱广告', ratio: '16:9' },
      { id: 'ad-elevator', label: '电梯广告', ratio: '9:16' },
      { id: 'ad-billboard', label: '户外大牌', ratio: '16:9' },
      { id: 'ad-launch-event', label: '发布会背景板', ratio: '16:9' },
      { id: 'ad-exhibition', label: '展会主视觉', ratio: '16:9' },
      { id: 'ad-led', label: 'LED大屏画面', ratio: '16:9' },
    ],
  },
  {
    id: 'social',
    label: '社媒矩阵包',
    icon: <UserCircle size={13} />,
    items: [
      { id: 'social-xhs-cover', label: '小红书封面', ratio: '3:4' },
      { id: 'social-xhs-long', label: '小红书长图', ratio: '9:16' },
      { id: 'social-douyin', label: '抖音封面', ratio: '9:16' },
      { id: 'social-video', label: '视频号封面', ratio: '1:1' },
      { id: 'social-moments', label: '朋友圈海报', ratio: '1:1' },
      { id: 'social-wechat-header', label: '公众号头图', ratio: '2.35:1' },
      { id: 'social-weibo-long', label: '微博长图', ratio: '9:16' },
      { id: 'social-bilibili', label: 'B站封面', ratio: '16:9' },
      { id: 'social-live-preview', label: '直播预告图', ratio: '3:4' },
      { id: 'social-video-title', label: '短视频片头视觉', ratio: '16:9' },
      { id: 'social-grid', label: '品牌九宫格', ratio: '1:1' },
      { id: 'social-seed', label: '社媒种草图', ratio: '3:4' },
    ],
  },
  {
    id: 'ecommerce',
    label: '电商物料包',
    icon: <ShoppingCart size={13} />,
    items: [
      { id: 'ecom-main', label: '商品主图', ratio: '1:1' },
      { id: 'ecom-scene', label: '商品场景图', ratio: '3:4' },
      { id: 'ecom-detail-hero', label: '详情页首屏', ratio: '3:1' },
      { id: 'ecom-detail-sell', label: '详情页卖点图', ratio: '16:9' },
      { id: 'ecom-banner', label: '店铺首页Banner', ratio: '16:9' },
      { id: 'ecom-promo', label: '大促活动图', ratio: '1:1' },
      { id: 'ecom-coupon', label: '优惠券图', ratio: '3:2' },
      { id: 'ecom-liveroom', label: '直播间背景', ratio: '16:9' },
      { id: 'ecom-influencer', label: '达人种草图', ratio: '3:4' },
      { id: 'ecom-feed', label: '信息流广告图', ratio: '3:2' },
      { id: 'ecom-shelf', label: '货架展示图', ratio: '1:1' },
      { id: 'ecom-combo', label: '产品组合图', ratio: '1:1' },
    ],
  },
  {
    id: 'offline',
    label: '线下终端包',
    icon: <Store size={13} />,
    items: [
      { id: 'offline-door', label: '门头设计', ratio: '16:9' },
      { id: 'offline-facade', label: '门店外立面', ratio: '3:4' },
      { id: 'offline-window', label: '橱窗设计', ratio: '3:4' },
      { id: 'offline-counter', label: '收银台桌卡', ratio: '4:3' },
      { id: 'offline-menu', label: '菜单牌', ratio: '3:4' },
      { id: 'offline-price', label: '价签', ratio: '3:2' },
      { id: 'offline-rollup', label: '易拉宝', ratio: '9:16' },
      { id: 'offline-stand', label: '展架', ratio: '9:16' },
      { id: 'offline-floor', label: '地贴', ratio: '1:1' },
      { id: 'offline-wall', label: '墙贴', ratio: '16:9' },
      { id: 'offline-flag', label: '吊旗', ratio: '3:4' },
      { id: 'offline-lightbox', label: '灯箱', ratio: '16:9' },
      { id: 'offline-shelf-end', label: '货架端架', ratio: '3:4' },
      { id: 'offline-heap', label: '商超堆头', ratio: '1:1' },
      { id: 'offline-guide', label: '导视牌', ratio: '9:16' },
      { id: 'offline-checkin', label: '打卡墙', ratio: '16:9' },
      { id: 'offline-display', label: '品牌陈列墙', ratio: '16:9' },
    ],
  },
  {
    id: 'popup',
    label: '快闪空间包',
    icon: <Package size={13} />,
    items: [
      { id: 'popup-facade', label: '快闪店外立面', ratio: '3:4' },
      { id: 'popup-door', label: '快闪店门头', ratio: '16:9' },
      { id: 'popup-selling', label: '售卖区', ratio: '16:9' },
      { id: 'popup-interactive', label: '互动区', ratio: '16:9' },
      { id: 'popup-photo', label: '打卡区', ratio: '3:4' },
      { id: 'popup-checkout', label: '收银区', ratio: '16:9' },
      { id: 'popup-product', label: '产品陈列区', ratio: '3:4' },
      { id: 'popup-install', label: '品牌装置', ratio: '3:4' },
      { id: 'popup-wall-decor', label: '墙面装饰', ratio: '16:9' },
      { id: 'popup-floor-guide', label: '地面导视', ratio: '1:1' },
      { id: 'popup-merch', label: '周边展示区', ratio: '3:4' },
      { id: 'popup-birdview', label: '鸟瞰布局图', ratio: '16:9' },
      { id: 'popup-multi-angle', label: '多角度空间效果图', ratio: '3:4' },
    ],
  },
  {
    id: 'packaging',
    label: '包装周边包',
    icon: <Gift size={13} />,
    items: [
      { id: 'pkg-box', label: '包装盒', ratio: '1:1' },
      { id: 'pkg-bag', label: '包装袋', ratio: '3:4' },
      { id: 'pkg-gift', label: '礼盒', ratio: '1:1' },
      { id: 'pkg-bottle', label: '瓶贴', ratio: '3:4' },
      { id: 'pkg-can', label: '罐身设计', ratio: '3:4' },
      { id: 'pkg-handbag', label: '手提袋', ratio: '3:4' },
      { id: 'pkg-canvas', label: '帆布袋', ratio: '3:4' },
      { id: 'pkg-sticker', label: '贴纸', ratio: '1:1' },
      { id: 'pkg-badge', label: '徽章', ratio: '1:1' },
      { id: 'pkg-keychain', label: '钥匙扣', ratio: '1:1' },
      { id: 'pkg-tshirt', label: 'T恤', ratio: '1:1' },
      { id: 'pkg-hat', label: '帽子', ratio: '1:1' },
      { id: 'pkg-cup', label: '杯子', ratio: '1:1' },
      { id: 'pkg-id', label: '工牌', ratio: '3:2' },
      { id: 'pkg-apron', label: '员工围裙', ratio: '3:4' },
      { id: 'pkg-postcard', label: '明信片', ratio: '3:2' },
      { id: 'pkg-card', label: '品牌卡片', ratio: '3:2' },
    ],
  },
  {
    id: 'ip',
    label: 'IP延展包',
    icon: <UserCircle size={13} />,
    items: [
      { id: 'ip-3view', label: 'IP三视图', ratio: '16:9' },
      { id: 'ip-emoji', label: 'IP表情包', ratio: '1:1' },
      { id: 'ip-action', label: 'IP动作库', ratio: '3:4' },
      { id: 'ip-holiday', label: 'IP节日海报', ratio: '3:4' },
      { id: 'ip-social-sticker', label: 'IP社媒贴纸', ratio: '1:1' },
      { id: 'ip-pkg-apply', label: 'IP包装应用', ratio: '1:1' },
      { id: 'ip-store-install', label: 'IP门店装置', ratio: '3:4' },
      { id: 'ip-popup-photo', label: 'IP快闪打卡点', ratio: '3:4' },
      { id: 'ip-doll', label: 'IP玩偶效果图', ratio: '3:4' },
      { id: 'ip-merch', label: 'IP周边效果图', ratio: '3:4' },
      { id: 'ip-interact', label: 'IP与产品互动图', ratio: '3:4' },
    ],
  },
];

// All material types flattened for lookup
const ALL_MATERIAL_TYPES = MATERIAL_CATEGORIES.flatMap(cat => cat.items);

// ═══ Props ═══

interface BrandFactoryPanelProps {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[]) => void;
}

// ═══ Component ═══

export function BrandFactoryPanel({ isMonochrome = false, onClose, onAddImages }: BrandFactoryPanelProps) {
  // ─── Theme ──────────────────────────────────────────────────────
  const accentColor = isMonochrome ? '#2563eb' : '#d4af37';
  const bgColor = isMonochrome ? '#fff' : '#1c1c1c';
  const bgDeep = isMonochrome ? '#f5f5f5' : '#111';
  const bgCard = isMonochrome ? '#fafafa' : '#141414';
  const borderColor = isMonochrome ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
  const borderLightColor = isMonochrome ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
  const textColor = isMonochrome ? '#1a1a1a' : '#e5e5e5';
  const textSubColor = isMonochrome ? '#666' : '#999';
  const textMutedColor = isMonochrome ? '#999' : '#666';

  // Tailwind class helpers
  const th = {
    bg: isMonochrome ? 'bg-white' : 'bg-[#1c1c1c]',
    bgDeep: isMonochrome ? 'bg-gray-50' : 'bg-[#111]',
    bgCard: isMonochrome ? 'bg-gray-50' : 'bg-[#141414]',
    border: isMonochrome ? 'border-gray-200' : 'border-white/[0.08]',
    borderLight: isMonochrome ? 'border-gray-100' : 'border-white/[0.06]',
    text: isMonochrome ? 'text-gray-900' : 'text-gray-100',
    textSub: isMonochrome ? 'text-gray-500' : 'text-gray-400',
    textMuted: isMonochrome ? 'text-gray-400' : 'text-gray-500',
    accent: isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]',
    accentHover: isMonochrome ? 'hover:bg-blue-600' : 'hover:bg-[#e0b840]',
    accentText: isMonochrome ? 'text-blue-500' : 'text-[#d4af37]',
    accentBg: isMonochrome ? 'bg-blue-50' : 'bg-[#d4af37]/10',
    input: isMonochrome
      ? 'bg-white border-gray-200 text-gray-900 focus:border-blue-500 placeholder:text-gray-400'
      : 'bg-[#111] border-white/[0.08] text-gray-100 focus:border-[#d4af37] placeholder:text-gray-500',
  };

  // ─── Drag state (floating movable window) ───────────────────────
  const panelW = 760;
  const panelH = 640;
  const [position, setPosition] = useState(() => {
    if (typeof window !== 'undefined') {
      return { x: Math.max(0, (window.innerWidth - panelW) / 2), y: Math.max(0, (window.innerHeight - panelH) / 2) };
    }
    return { x: 0, y: 0 };
  });
  const isDragging = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handlePanelDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    if ((e.target as HTMLElement).closest('select')) return;
    if ((e.target as HTMLElement).closest('input')) return;
    if ((e.target as HTMLElement).closest('textarea')) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    setIsDraggingState(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
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

  // ─── State ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('projects');
  const [projects, setProjects] = useState<BrandProject[]>([]);
  const [currentProject, setCurrentProject] = useState<BrandProject | null>(null);
  const [materials, setMaterials] = useState<BrandMaterial[]>([]);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [llmModels, setLlmModels] = useState<LlmModel[]>([]);
  const [selectedImageModel, setSelectedImageModel] = useState('');
  const [selectedLlmModel, setSelectedLlmModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);

  // New project form
  const [newProjectName, setNewProjectName] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [newIndustry, setNewIndustry] = useState('');
  const [newTone, setNewTone] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newKeywords, setNewKeywords] = useState('');

  // Asset upload
  const [uploadingAsset, setUploadingAsset] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const ipInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  // Direction generation
  const [directionCount, setDirectionCount] = useState(3);
  const [selectedDirectionId, setSelectedDirectionId] = useState('');

  // KV generation
  const [kvTheme, setKvTheme] = useState('');
  const [kvRatio, setKvRatio] = useState('16:9');
  const [kvSlogan, setKvSlogan] = useState('');

  // Material generation
  const [selectedMaterialTypes, setSelectedMaterialTypes] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['brand-base', 'ad', 'social']));

  // Consistency check
  const [consistencyScores, setConsistencyScores] = useState<Record<string, number>>({});
  const [checking, setChecking] = useState(false);

  // Export
  const [exportFormat, setExportFormat] = useState<'images' | 'prompts' | 'markdown'>('images');

  // ─── Load models ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [imgRes, llmRes] = await Promise.all([
          fetch('/api/models?type=image'),
          fetch('/api/models?type=chat'),
        ]);
        if (imgRes.ok) {
          const data = await imgRes.json();
          const models = data.models || [];
          setImageModels(models);
          if (models.length > 0 && !selectedImageModel) setSelectedImageModel(models[0].id);
        }
        if (llmRes.ok) {
          const data = await llmRes.json();
          const models = data.models || [];
          setLlmModels(models);
          if (models.length > 0 && !selectedLlmModel) setSelectedLlmModel(models[0].id);
        }
      } catch { /* ignore */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Load projects ──────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/brand-factory');
      if (!res.ok) return;
      const data = await res.json();
      const raw = data.projects || [];
      const parsed: BrandProject[] = raw.map((p: Record<string, unknown>) => ({
        ...p,
        keywords: typeof p.keywords === 'string' ? JSON.parse(p.keywords || '[]') : (p.keywords || []),
        referenceUrls: typeof p.referenceUrls === 'string' ? JSON.parse(p.referenceUrls || '[]') : (p.referenceUrls || []),
        brandDna: typeof p.brandDna === 'string' ? JSON.parse(p.brandDna || '{}') : (p.brandDna || {}),
        creativeDirections: typeof p.creativeDirections === 'string' ? JSON.parse(p.creativeDirections || '[]') : (p.creativeDirections || []),
        isArchived: !!p.isArchived,
      }));
      setProjects(parsed);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // ─── Load project detail ────────────────────────────────────────
  const loadProject = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/brand-factory?projectId=${id}`);
      if (!res.ok) return;
      const data = await res.json();
      const p = data.project;
      if (!p) return;
      const parsed: BrandProject = {
        ...p,
        keywords: typeof p.keywords === 'string' ? JSON.parse(p.keywords || '[]') : (p.keywords || []),
        referenceUrls: typeof p.referenceUrls === 'string' ? JSON.parse(p.referenceUrls || '[]') : (p.referenceUrls || []),
        brandDna: typeof p.brandDna === 'string' ? JSON.parse(p.brandDna || '{}') : (p.brandDna || {}),
        creativeDirections: typeof p.creativeDirections === 'string' ? JSON.parse(p.creativeDirections || '[]') : (p.creativeDirections || []),
        isArchived: !!p.isArchived,
      };
      setCurrentProject(parsed);
      setMaterials(data.materials || []);
    } catch { /* ignore */ }
  }, []);

  // ─── Parse project ──────────────────────────────────────────────
  const parseProject = (p: Record<string, unknown>): BrandProject => {
    const raw = p as unknown as BrandProject;
    return {
      ...raw,
      keywords: typeof p.keywords === 'string' ? JSON.parse(p.keywords || '[]') : (p.keywords || []) as string[],
      referenceUrls: typeof p.referenceUrls === 'string' ? JSON.parse(p.referenceUrls || '[]') : (p.referenceUrls || []) as string[],
      brandDna: typeof p.brandDna === 'string' ? JSON.parse(p.brandDna || '{}') : (p.brandDna || {}) as Record<string, unknown>,
      creativeDirections: typeof p.creativeDirections === 'string' ? JSON.parse(p.creativeDirections || '[]') : (p.creativeDirections || []) as CreativeDirection[],
      isArchived: !!p.isArchived,
    };
  };

  // ─── Create project ┐
  const handleCreateProject = async () => {
    if (!newBrandName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-project',
          projectName: newProjectName.trim() || newBrandName.trim(),
          brandName: newBrandName.trim(),
          industry: newIndustry,
          tone: newTone,
          description: newDescription,
          keywords: newKeywords.split(/[,，]/).map(s => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (data.success && data.project) {
        await loadProjects();
        await loadProject(data.project.id);
        setActiveTab('assets');
        setNewProjectName(''); setNewBrandName(''); setNewIndustry('');
        setNewTone(''); setNewDescription(''); setNewKeywords('');
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  // ─── Delete project ┐
  const handleDeleteProject = async (id: string) => {
    if (!confirm('确定删除此项目？所有品牌DNA、创意方向和物料将被删除。')) return;
    try {
      await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-project', id }),
      });
      if (currentProject?.id === id) setCurrentProject(null);
      await loadProjects();
    } catch { /* ignore */ }
  };

  // ─── Archive project ┐
  const handleArchiveProject = async (id: string, archive: boolean) => {
    try {
      await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive-project', id, archive }),
      });
      await loadProjects();
      if (currentProject?.id === id) await loadProject(id);
    } catch { /* ignore */ }
  };

  // ─── Upload asset ┐
  const handleAssetUpload = async (type: 'logo' | 'product' | 'ip' | 'reference', file: File) => {
    if (!currentProject) return;
    setUploadingAsset(type);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const saveRes = await fetch('/api/save-image', { method: 'POST', body: formData });
      const saveData = await saveRes.json();
      if (!saveData.url) return;

      const updateField = type === 'logo' ? 'logoUrl' : type === 'product' ? 'productUrl' : type === 'ip' ? 'ipUrl' : 'referenceUrls';
      const updateValue = type === 'reference'
        ? [...(currentProject.referenceUrls || []), saveData.url]
        : saveData.url;

      await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-project', id: currentProject.id, [updateField]: updateValue }),
      });
      await loadProject(currentProject.id);
    } catch { /* ignore */ }
    setUploadingAsset(null);
  };

  // ─── Analyze DNA ┐
  const handleAnalyzeDNA = async () => {
    if (!currentProject) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze-dna',
          brandName: currentProject.brandName,
          industry: currentProject.industry,
          keywords: currentProject.keywords,
          tone: currentProject.tone,
          description: currentProject.description,
          logoUrl: currentProject.logoUrl,
          productUrl: currentProject.productUrl,
          ipUrl: currentProject.ipUrl,
          llmModel: selectedLlmModel,
        }),
      });
      const data = await res.json();
      if (data.success && data.dna) {
        await fetch('/api/brand-factory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update-project', id: currentProject.id, brandDna: data.dna }),
        });
        await loadProject(currentProject.id);
      }
    } catch { /* ignore */ }
    setAnalyzing(false);
  };

  // ─── Generate Directions ┐
  const handleGenerateDirections = async () => {
    if (!currentProject) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-directions',
          brandName: currentProject.brandName,
          brandDna: currentProject.brandDna,
          count: directionCount,
          llmModel: selectedLlmModel,
        }),
      });
      const data = await res.json();
      if (data.success && data.directions) {
        const directions = (data.directions as CreativeDirection[]).map((d, i) => ({
          ...d,
          id: d.id || `dir-${Date.now()}-${i}`,
        }));
        await fetch('/api/brand-factory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update-project', id: currentProject.id, creativeDirections: directions }),
        });
        await loadProject(currentProject.id);
      }
    } catch { /* ignore */ }
    setGenerating(false);
  };

  // ─── Generate KV ┐
  const handleGenerateKV = async () => {
    if (!currentProject) return;
    setGenerating(true);
    try {
      const direction = currentProject.creativeDirections?.find(d => d.id === selectedDirectionId);
      const res = await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-kv',
          brandName: currentProject.brandName,
          brandDna: currentProject.brandDna,
          directionId: selectedDirectionId,
          directionPrompt: direction?.prompt || '',
          theme: kvTheme,
          slogan: kvSlogan,
          ratio: kvRatio,
          llmModel: selectedLlmModel,
        }),
      });
      const data = await res.json();
      if (data.success && data.materials) {
        for (const mat of data.materials as Record<string, unknown>[]) {
          await fetch('/api/brand-factory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'save-material',
              projectId: currentProject.id,
              directionId: selectedDirectionId,
              materialType: 'kv-main',
              title: `主KV${kvTheme ? ' - ' + kvTheme : ''}`,
              ratio: kvRatio,
              prompt: mat.prompt || '',
            }),
          });
        }
        await loadProject(currentProject.id);
      }
    } catch { /* ignore */ }
    setGenerating(false);
  };

  // ─── Batch Generate Materials ┐
  const handleBatchGenerate = async () => {
    if (!currentProject || selectedMaterialTypes.size === 0) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch-generate',
          brandName: currentProject.brandName,
          brandDna: currentProject.brandDna,
          materialTypes: Array.from(selectedMaterialTypes),
          llmModel: selectedLlmModel,
        }),
      });
      const data = await res.json();
      if (data.success && data.materials) {
        for (const mat of data.materials as Record<string, unknown>[]) {
          const mt = ALL_MATERIAL_TYPES.find(o => o.id === mat.materialType);
          await fetch('/api/brand-factory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'save-material',
              projectId: currentProject.id,
              directionId: selectedDirectionId,
              materialType: mat.materialType || 'kv',
              title: mat.title || mt?.label || '物料',
              ratio: mat.ratio || mt?.ratio || '1:1',
              prompt: mat.prompt || '',
            }),
          });
        }
        await loadProject(currentProject.id);
        setActiveTab('materials');
      }
    } catch { /* ignore */ }
    setGenerating(false);
  };

  // ─── Consistency Check ┐
  const handleConsistencyCheck = async () => {
    if (!currentProject) return;
    setChecking(true);
    try {
      const res = await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'consistency-check',
          brandName: currentProject.brandName,
          brandDna: currentProject.brandDna,
          materials: materials.filter(m => m.imageUrl),
          llmModel: selectedLlmModel,
        }),
      });
      const data = await res.json();
      if (data.success && data.scores) {
        setConsistencyScores(data.scores as Record<string, number>);
      }
    } catch { /* ignore */ }
    setChecking(false);
  };

  // ─── Save Version ┐
  const handleSaveVersion = async (targetType: string, note: string) => {
    if (!currentProject) return;
    try {
      await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-version',
          projectId: currentProject.id,
          targetType,
          versionName: `V${versions.length + 1}`,
          note,
          snapshot: {
            brandDna: currentProject.brandDna,
            creativeDirections: currentProject.creativeDirections,
          },
        }),
      });
      // Reload versions
      const res = await fetch(`/api/brand-factory?projectId=${currentProject.id}&versions=true`);
      const data = await res.json();
      if (data.success) setVersions(data.versions || []);
    } catch { /* ignore */ }
  };

  // ─── Delete material ┐
  const handleDeleteMaterial = async (id: string) => {
    try {
      await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-material', id }),
      });
      setMaterials(prev => prev.filter(m => m.id !== id));
    } catch { /* ignore */ }
  };

  // ─── Select project ┐
  const handleSelectProject = (p: BrandProject) => {
    setCurrentProject(p);
    loadProject(p.id);
    setActiveTab('assets');
  };

  // ─── Export ┐
  const handleExport = () => {
    if (!currentProject) return;
    if (exportFormat === 'prompts') {
      const lines = materials.map(m => `[${m.title}] (${m.ratio})\n${m.prompt}`).join('\n\n---\n\n');
      const blob = new Blob([lines], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${currentProject.brandName}_prompts.txt`; a.click();
      URL.revokeObjectURL(url);
    } else if (exportFormat === 'markdown') {
      const dna = currentProject.brandDna as Record<string, unknown>;
      let md = `# ${currentProject.brandName} 品牌提案\n\n`;
      md += `## 项目信息\n- 品牌：${currentProject.brandName}\n- 行业：${currentProject.industry}\n- 调性：${currentProject.tone}\n\n`;
      if (dna.brandKeywords) md += `## 品牌DNA\n- 关键词：${(dna.brandKeywords as string[]).join('、')}\n- 视觉调性：${dna.visualTone || ''}\n- 字体方向：${dna.fontStyle || ''}\n\n`;
      if (currentProject.creativeDirections?.length) {
        md += `## 创意方向\n`;
        currentProject.creativeDirections.forEach((d, i) => {
          md += `### 方向${i + 1}：${d.name}\n- 概念：${d.concept}\n- 标语：${d.slogan}\n- 视觉关键词：${d.visualKeywords?.join('、')}\n\n`;
        });
      }
      if (materials.length) {
        md += `## 物料清单\n`;
        materials.forEach(m => { md += `- **${m.title}** (${m.ratio})\n  Prompt: ${m.prompt}\n\n`; });
      }
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${currentProject.brandName}_proposal.md`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  // ─── Toggle category ┐
  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  // ─── Toggle all materials in category ┐
  const toggleCategoryMaterials = (catId: string) => {
    const cat = MATERIAL_CATEGORIES.find(c => c.id === catId);
    if (!cat) return;
    const catTypeIds = cat.items.map(i => i.id);
    const allSelected = catTypeIds.every(id => selectedMaterialTypes.has(id));
    setSelectedMaterialTypes(prev => {
      const next = new Set(prev);
      catTypeIds.forEach(id => { allSelected ? next.delete(id) : next.add(id); });
      return next;
    });
  };

  // ─── DNA field helper ┐
  const getDnaField = (key: string): unknown => {
    if (!currentProject?.brandDna) return null;
    return (currentProject.brandDna as Record<string, unknown>)[key];
  };

  // ═══ Render ═══

  // No project guard
  const noProject = (
    <div className={`text-center py-16 ${th.textMuted} text-sm`}>
      <Building2 size={32} className="mx-auto mb-3 opacity-30" />
      请先在项目中心选择或创建一个项目
    </div>
  );

  return (
    <div
      className="fixed z-[150]"
      data-floating-panel="true"
      style={{ left: position.x, top: position.y, width: panelW, maxHeight: '85vh' }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      <div
        data-floating-panel="true"
        className="rounded-2xl flex flex-col"
        style={{
          backgroundColor: bgColor,
          border: isDraggingState ? `2px solid ${accentColor}` : `1px solid ${borderColor}`,
          boxShadow: isDraggingState
            ? (isMonochrome ? '0 0 24px rgba(37,99,235,0.25), 0 25px 50px -12px rgba(0,0,0,0.25)' : '0 0 24px rgba(212,175,55,0.3), 0 25px 50px -12px rgba(0,0,0,0.5)')
            : (isMonochrome ? '0 25px 50px -12px rgba(0,0,0,0.15)' : '0 25px 50px -12px rgba(0,0,0,0.5)'),
          maxHeight: '85vh',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ═══ Header (draggable) ═══ */}
        <div
          className="flex items-center gap-2 px-3 py-2.5 select-none shrink-0 cursor-grab active:cursor-grabbing rounded-t-2xl"
          style={{ borderBottom: `1px solid ${borderColor}` }}
          onMouseDown={handlePanelDragStart}
        >
          <GripVertical size={14} style={{ color: textMutedColor }} />
          <Building2 size={16} style={{ color: accentColor }} />
          <span className="text-base font-semibold flex-1" style={{ color: accentColor }}>
            品牌工厂
          </span>
          {currentProject && (
            <span className="text-xs px-2 py-0.5 rounded" style={{ color: textSubColor, background: isMonochrome ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)' }}>
              {currentProject.brandName}
            </span>
          )}
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: textMutedColor, background: isMonochrome ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)' }}>
            项目化品牌资产生成
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors cursor-pointer"
            style={{ color: textMutedColor }}
            onMouseEnter={e => (e.currentTarget.style.color = textColor)}
            onMouseLeave={e => (e.currentTarget.style.color = textMutedColor)}
          >
            <X size={16} />
          </button>
        </div>

        {/* ═══ Tabs ═══ */}
        <div className="flex shrink-0 overflow-x-auto" style={{ borderBottom: `1px solid ${borderColor}` }}>
          {TAB_CONFIG.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center justify-center gap-1 px-3 py-2 text-[11px] font-medium transition-all whitespace-nowrap"
              style={{
                borderBottom: activeTab === tab.id ? `2px solid ${accentColor}` : '2px solid transparent',
                color: activeTab === tab.id ? accentColor : textMutedColor,
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══ Content ═══ */}
        <div className="flex-1 overflow-y-auto p-4" style={{ maxHeight: 'calc(85vh - 100px)', scrollbarWidth: 'thin' }}>

          {/* ═══ PROJECTS TAB ═══ */}
          {activeTab === 'projects' && (
            <div className="flex gap-4">
              {/* Left: Create form */}
              <div className={`w-[300px] shrink-0 p-4 rounded-xl border ${th.border} ${th.bgCard} space-y-3`}>
                <h3 className={`text-sm font-semibold ${th.text} flex items-center gap-2`}>
                  <Plus size={14} className={th.accentText} /> 新建项目
                </h3>
                <input className={`w-full px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`} placeholder="品牌名称 *" value={newBrandName} onChange={e => setNewBrandName(e.target.value)} />
                <input className={`w-full px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`} placeholder="项目名称（默认同品牌名）" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} />
                <div className="flex gap-2">
                  <select className={`flex-1 px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none`} value={newIndustry} onChange={e => setNewIndustry(e.target.value)}>
                    <option value="">选择行业</option>
                    {INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <select className={`flex-1 px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none`} value={newTone} onChange={e => setNewTone(e.target.value)}>
                    <option value="">品牌调性</option>
                    {TONE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <input className={`w-full px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`} placeholder="关键词（逗号分隔）" value={newKeywords} onChange={e => setNewKeywords(e.target.value)} />
                <textarea className={`w-full px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} resize-none`} rows={2} placeholder="品牌描述（可选）" value={newDescription} onChange={e => setNewDescription(e.target.value)} />
                <button onClick={handleCreateProject} disabled={loading || !newBrandName.trim()} className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${loading || !newBrandName.trim() ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed` : `${th.accent} text-black ${th.accentHover} shadow-lg active:scale-[0.98]`}`}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  创建项目
                </button>
              </div>
              {/* Right: Project list */}
              <div className="flex-1 space-y-2 min-w-0">
                <h3 className={`text-xs font-medium ${th.textMuted} uppercase tracking-wider`}>我的项目</h3>
                {projects.length === 0 ? (
                  <div className={`text-center py-12 ${th.textMuted} text-sm`}>暂无项目，创建一个开始品牌设计</div>
                ) : (
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                    {projects.map(p => (
                      <div key={p.id} onClick={() => handleSelectProject(p)} className={`p-3 rounded-xl border cursor-pointer transition-all ${currentProject?.id === p.id ? `${th.accentBg} ${isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/30'}` : `${th.border} ${th.bgCard} hover:${isMonochrome ? 'border-blue-200' : 'border-white/[0.15]'}`}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium ${th.text} truncate`}>{p.brandName}</div>
                            <div className={`text-xs ${th.textMuted} mt-0.5`}>
                              {p.industry && <span>{p.industry} · </span>}{p.tone}
                            </div>
                            {p.keywords?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {p.keywords.slice(0, 4).map((k, i) => (
                                  <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/10 text-[#d4af37]'}`}>{k}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
                            <button onClick={() => handleArchiveProject(p.id, !p.isArchived)} className={`p-1 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-blue-600 hover:bg-blue-50' : 'text-gray-500 hover:text-[#d4af37] hover:bg-[#d4af37]/10'}`} title={p.isArchived ? '取消归档' : '归档'}>
                              {p.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                            </button>
                            <button onClick={() => handleDeleteProject(p.id)} className={`p-1 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'}`} title="删除">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ ASSETS TAB ═══ */}
          {activeTab === 'assets' && (
            !currentProject ? noProject : (
              <div className="space-y-4">
                <div className={`p-4 rounded-xl border ${th.border} ${th.bgCard}`}>
                  <h3 className={`text-sm font-semibold ${th.text} flex items-center gap-2 mb-4`}>
                    <Layers size={14} className={th.accentText} /> 品牌资产上传
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Logo Upload */}
                    <div className={`p-3 rounded-xl border ${th.borderLight} ${th.bgDeep} space-y-2`}>
                      <div className={`text-xs font-medium ${th.textSub}`}>品牌Logo</div>
                      {currentProject.logoUrl ? (
                        <div className="relative group">
                          <img src={currentProject.logoUrl} alt="Logo" className="w-full h-24 object-contain rounded-lg" style={{ background: isMonochrome ? '#fff' : '#1a1a1a' }} />
                          <button onClick={async () => { await fetch('/api/brand-factory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update-project', id: currentProject.id, logoUrl: '' }) }); await loadProject(currentProject.id); }} className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                        </div>
                      ) : (
                        <button onClick={() => logoInputRef.current?.click()} disabled={!!uploadingAsset} className={`w-full h-24 rounded-lg border-2 border-dashed ${th.border} flex flex-col items-center justify-center gap-1 ${isMonochrome ? 'hover:border-blue-300 hover:bg-blue-50/50' : 'hover:border-[#d4af37]/30 hover:bg-[#d4af37]/5'} transition-all`}>
                          {uploadingAsset === 'logo' ? <Loader2 size={16} className="animate-spin" style={{ color: accentColor }} /> : <Upload size={16} style={{ color: textMutedColor }} />}
                          <span className={`text-[10px] ${th.textMuted}`}>上传Logo</span>
                        </button>
                      )}
                      <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAssetUpload('logo', f); }} />
                    </div>
                    {/* Product Upload */}
                    <div className={`p-3 rounded-xl border ${th.borderLight} ${th.bgDeep} space-y-2`}>
                      <div className={`text-xs font-medium ${th.textSub}`}>产品图</div>
                      {currentProject.productUrl ? (
                        <div className="relative group">
                          <img src={currentProject.productUrl} alt="Product" className="w-full h-24 object-contain rounded-lg" style={{ background: isMonochrome ? '#fff' : '#1a1a1a' }} />
                          <button onClick={async () => { await fetch('/api/brand-factory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update-project', id: currentProject.id, productUrl: '' }) }); await loadProject(currentProject.id); }} className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                        </div>
                      ) : (
                        <button onClick={() => productInputRef.current?.click()} disabled={!!uploadingAsset} className={`w-full h-24 rounded-lg border-2 border-dashed ${th.border} flex flex-col items-center justify-center gap-1 ${isMonochrome ? 'hover:border-blue-300 hover:bg-blue-50/50' : 'hover:border-[#d4af37]/30 hover:bg-[#d4af37]/5'} transition-all`}>
                          {uploadingAsset === 'product' ? <Loader2 size={16} className="animate-spin" style={{ color: accentColor }} /> : <Upload size={16} style={{ color: textMutedColor }} />}
                          <span className={`text-[10px] ${th.textMuted}`}>上传产品图</span>
                        </button>
                      )}
                      <input ref={productInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAssetUpload('product', f); }} />
                    </div>
                    {/* IP Upload */}
                    <div className={`p-3 rounded-xl border ${th.borderLight} ${th.bgDeep} space-y-2`}>
                      <div className={`text-xs font-medium ${th.textSub}`}>IP形象</div>
                      {currentProject.ipUrl ? (
                        <div className="relative group">
                          <img src={currentProject.ipUrl} alt="IP" className="w-full h-24 object-contain rounded-lg" style={{ background: isMonochrome ? '#fff' : '#1a1a1a' }} />
                          <button onClick={async () => { await fetch('/api/brand-factory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update-project', id: currentProject.id, ipUrl: '' }) }); await loadProject(currentProject.id); }} className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                        </div>
                      ) : (
                        <button onClick={() => ipInputRef.current?.click()} disabled={!!uploadingAsset} className={`w-full h-24 rounded-lg border-2 border-dashed ${th.border} flex flex-col items-center justify-center gap-1 ${isMonochrome ? 'hover:border-blue-300 hover:bg-blue-50/50' : 'hover:border-[#d4af37]/30 hover:bg-[#d4af37]/5'} transition-all`}>
                          {uploadingAsset === 'ip' ? <Loader2 size={16} className="animate-spin" style={{ color: accentColor }} /> : <Upload size={16} style={{ color: textMutedColor }} />}
                          <span className={`text-[10px] ${th.textMuted}`}>上传IP形象</span>
                        </button>
                      )}
                      <input ref={ipInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAssetUpload('ip', f); }} />
                    </div>
                    {/* Reference Images */}
                    <div className={`p-3 rounded-xl border ${th.borderLight} ${th.bgDeep} space-y-2`}>
                      <div className={`text-xs font-medium ${th.textSub}`}>参考图</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(currentProject.referenceUrls || []).slice(0, 4).map((url, i) => (
                          <img key={i} src={url} alt={`Ref ${i}`} className="w-10 h-10 object-cover rounded-lg" style={{ background: isMonochrome ? '#fff' : '#1a1a1a' }} />
                        ))}
                        <button onClick={() => refInputRef.current?.click()} disabled={!!uploadingAsset} className={`w-10 h-10 rounded-lg border-2 border-dashed ${th.border} flex items-center justify-center ${isMonochrome ? 'hover:border-blue-300' : 'hover:border-[#d4af37]/30'} transition-all`}>
                          {uploadingAsset === 'reference' ? <Loader2 size={12} className="animate-spin" style={{ color: accentColor }} /> : <Plus size={12} style={{ color: textMutedColor }} />}
                        </button>
                      </div>
                      <input ref={refInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAssetUpload('reference', f); }} />
                    </div>
                  </div>
                </div>
                {/* Quick actions */}
                <div className="flex gap-2">
                  <button onClick={() => setActiveTab('dna')} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border ${th.border} ${th.bgCard} ${th.textSub} hover:${th.text} transition-all flex items-center justify-center gap-2`}>
                    <Sparkles size={14} /> 分析品牌DNA
                  </button>
                  <button onClick={() => setActiveTab('directions')} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border ${th.border} ${th.bgCard} ${th.textSub} hover:${th.text} transition-all flex items-center justify-center gap-2`}>
                    <Compass size={14} /> 生成创意方向
                  </button>
                </div>
              </div>
            )
          )}

          {/* ═══ DNA TAB ═══ */}
          {activeTab === 'dna' && (
            !currentProject ? noProject : (
              <div className="flex gap-4">
                {/* Left: Controls */}
                <div className="w-[280px] shrink-0 space-y-3">
                  <button onClick={handleAnalyzeDNA} disabled={analyzing} className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${analyzing ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed` : `${th.accent} text-black ${th.accentHover} shadow-lg active:scale-[0.98]`}`}>
                    {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {analyzing ? 'AI分析中...' : 'AI分析品牌DNA'}
                  </button>
                  <div className={`p-3 rounded-xl border ${th.borderLight} ${th.bgCard}`}>
                    <div className={`text-xs ${th.textMuted} mb-2`}>分析模型</div>
                    <select className={`w-full px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none`} value={selectedLlmModel} onChange={e => setSelectedLlmModel(e.target.value)}>
                      {llmModels.length === 0 && <option value="">请先配置LLM模型</option>}
                      {llmModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <button onClick={() => handleSaveVersion('dna', '品牌DNA更新')} className={`w-full py-2 rounded-xl text-xs font-medium border ${th.border} ${th.bgCard} ${th.textSub} hover:${th.text} transition-all flex items-center justify-center gap-1.5`}>
                    <Save size={12} /> 保存版本
                  </button>
                </div>
                {/* Right: DNA Results */}
                <div className="flex-1 space-y-3 min-w-0">
                  {Object.keys(currentProject.brandDna || {}).length === 0 ? (
                    <div className={`text-center py-16 ${th.textMuted} text-sm`}>
                      <Palette size={32} className="mx-auto mb-3 opacity-30" />
                      点击"AI分析品牌DNA"开始分析
                    </div>
                  ) : (
                    <div className={`p-4 rounded-xl border ${th.border} ${th.bgCard} space-y-3`}>
                      {/* Brand Keywords */}
                      {(getDnaField('brandKeywords') as string[])?.length > 0 && (
                        <div>
                          <div className={`text-xs ${th.textMuted} mb-1.5`}>品牌关键词</div>
                          <div className="flex flex-wrap gap-1.5">
                            {(getDnaField('brandKeywords') as string[]).map((k, i) => (
                              <span key={i} className={`text-xs px-2 py-1 rounded-lg ${isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-[#d4af37]/10 text-[#d4af37]'}`}>{k}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Main Colors */}
                      {(getDnaField('mainColors') as string[])?.length > 0 && (
                        <div>
                          <div className={`text-xs ${th.textMuted} mb-1.5`}>主色调</div>
                          <div className="flex flex-wrap gap-2">
                            {(getDnaField('mainColors') as string[]).map((c, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <div className="w-6 h-6 rounded-lg border border-white/10" style={{ background: c }} />
                                <span className={`text-[10px] ${th.textSub}`}>{c}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Secondary Colors */}
                      {(getDnaField('secondaryColors') as string[])?.length > 0 && (
                        <div>
                          <div className={`text-xs ${th.textMuted} mb-1.5`}>辅助色</div>
                          <div className="flex flex-wrap gap-2">
                            {(getDnaField('secondaryColors') as string[]).map((c, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-md border border-white/10" style={{ background: c }} />
                                <span className={`text-[10px] ${th.textSub}`}>{c}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Text fields */}
                      {[
                        { key: 'fontStyle', label: '字体方向' },
                        { key: 'visualTone', label: '视觉调性' },
                        { key: 'promptSummary', label: '品牌Prompt' },
                      ].map(({ key, label }) => {
                        const val = getDnaField(key);
                        if (!val || typeof val !== 'string') return null;
                        return (
                          <div key={key}>
                            <div className={`text-xs ${th.textMuted} mb-1`}>{label}</div>
                            <div className={`text-xs ${th.textSub} p-2 rounded-lg leading-relaxed`} style={{ background: bgDeep }}>{val}</div>
                          </div>
                        );
                      })}
                      {/* Rules */}
                      {[
                        { key: 'logoRules', label: 'Logo规则' },
                        { key: 'productRules', label: '产品规则' },
                        { key: 'ipRules', label: 'IP规则' },
                        { key: 'forbiddenRules', label: '禁区规则' },
                      ].map(({ key, label }) => {
                        const val = getDnaField(key);
                        if (!val || !Array.isArray(val) || val.length === 0) return null;
                        return (
                          <div key={key}>
                            <div className={`text-xs ${th.textMuted} mb-1`}>{label}</div>
                            <ul className="space-y-0.5">
                              {(val as string[]).map((r, i) => (
                                <li key={i} className={`text-xs ${th.textSub} flex items-start gap-1.5`}>
                                  <span className="mt-1 w-1 h-1 rounded-full flex-shrink-0" style={{ background: accentColor, transform: 'scale(0.75)' }} />
                                  {r}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                      {/* Recommended Materials */}
                      {(getDnaField('recommendedMaterials') as string[])?.length > 0 && (
                        <div>
                          <div className={`text-xs ${th.textMuted} mb-1.5`}>推荐物料</div>
                          <div className="flex flex-wrap gap-1.5">
                            {(getDnaField('recommendedMaterials') as string[]).map((m, i) => (
                              <span key={i} className={`text-[10px] px-2 py-0.5 rounded ${isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-[#222] text-gray-400'}`}>{m}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {/* ═══ DIRECTIONS TAB ═══ */}
          {activeTab === 'directions' && (
            !currentProject ? noProject : (
              <div className="flex gap-4">
                {/* Left: Controls */}
                <div className="w-[280px] shrink-0 space-y-3">
                  <div className={`p-4 rounded-xl border ${th.border} ${th.bgCard} space-y-3`}>
                    <h3 className={`text-sm font-semibold ${th.text} flex items-center gap-2`}>
                      <Compass size={14} className={th.accentText} /> 生成创意方向
                    </h3>
                    {Object.keys(currentProject.brandDna || {}).length === 0 && (
                      <div className={`text-xs ${th.textMuted} flex items-center gap-1.5`}>
                        <AlertTriangle size={12} /> 建议先分析品牌DNA
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <span className={`text-xs ${th.textMuted}`}>方向数量</span>
                      <div className="flex gap-1.5">
                        {[3, 6, 9, 12].map(n => (
                          <button key={n} onClick={() => setDirectionCount(n)} className={`w-8 h-7 rounded-lg text-xs font-medium transition-all ${directionCount === n ? `${th.accent} text-black` : `${th.bgDeep} ${th.textSub}`}`}>
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={handleGenerateDirections} disabled={generating} className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${generating ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed` : `${th.accent} text-black ${th.accentHover} shadow-lg active:scale-[0.98]`}`}>
                      {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                      {generating ? '生成中...' : '生成创意方向'}
                    </button>
                  </div>
                </div>
                {/* Right: Direction cards */}
                <div className="flex-1 space-y-2 min-w-0 max-h-[480px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {currentProject.creativeDirections?.length > 0 ? currentProject.creativeDirections.map((dir, idx) => (
                    <div key={dir.id || idx} className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedDirectionId === dir.id ? `${th.accentBg} ${isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/30'}` : `${th.border} ${th.bgCard} hover:border-white/[0.15]`}`} onClick={() => setSelectedDirectionId(dir.id)}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${th.accentText}`}>#{idx + 1}</span>
                            <span className={`text-sm font-semibold ${th.text}`}>{dir.name || `方向 ${idx + 1}`}</span>
                          </div>
                          {dir.slogan && <p className={`text-xs ${th.accentText} mt-1 italic`}>{dir.slogan}</p>}
                          {dir.concept && <p className={`text-xs ${th.textSub} mt-1 line-clamp-2`}>{dir.concept}</p>}
                          {dir.visualKeywords?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {dir.visualKeywords.slice(0, 5).map((k, i) => (
                                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/10 text-[#d4af37]/80'}`}>{k}</span>
                              ))}
                            </div>
                          )}
                          {dir.colorPlan?.length > 0 && (
                            <div className="flex gap-1.5 mt-1.5">
                              {dir.colorPlan.map((c, i) => <div key={i} className="w-4 h-4 rounded-md border border-white/10" style={{ background: c }} title={c} />)}
                            </div>
                          )}
                        </div>
                        <ChevronRight size={14} className={`${th.textMuted} mt-1 flex-shrink-0`} />
                      </div>
                    </div>
                  )) : (
                    <div className={`text-center py-12 ${th.textMuted} text-sm`}>暂无创意方向，点击生成</div>
                  )}
                </div>
              </div>
            )
          )}

          {/* ═══ KV TAB ═══ */}
          {activeTab === 'kv' && (
            !currentProject ? noProject : (
              <div className="flex gap-4">
                {/* Left: KV Settings */}
                <div className="w-[300px] shrink-0 space-y-3">
                  <div className={`p-4 rounded-xl border ${th.border} ${th.bgCard} space-y-3`}>
                    <h3 className={`text-sm font-semibold ${th.text} flex items-center gap-2`}>
                      <Megaphone size={14} className={th.accentText} /> 主KV生成
                    </h3>
                    <div>
                      <div className={`text-xs ${th.textMuted} mb-1.5`}>选择创意方向</div>
                      <select className={`w-full px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none`} value={selectedDirectionId} onChange={e => setSelectedDirectionId(e.target.value)}>
                        <option value="">选择方向</option>
                        {currentProject.creativeDirections?.map((d, i) => (
                          <option key={d.id || i} value={d.id}>{d.name || `方向 ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className={`text-xs ${th.textMuted} mb-1.5`}>主题文案</div>
                      <input className={`w-full px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`} placeholder="如：无界AI 2024品牌升级" value={kvTheme} onChange={e => setKvTheme(e.target.value)} />
                    </div>
                    <div>
                      <div className={`text-xs ${th.textMuted} mb-1.5`}>传播语/标语</div>
                      <input className={`w-full px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`} placeholder="如：创造力无界" value={kvSlogan} onChange={e => setKvSlogan(e.target.value)} />
                    </div>
                    <div>
                      <div className={`text-xs ${th.textMuted} mb-1.5`}>画面比例</div>
                      <div className="flex gap-1.5">
                        {['16:9', '3:4', '1:1', '9:16'].map(r => (
                          <button key={r} onClick={() => setKvRatio(r)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${kvRatio === r ? `${th.accent} text-black` : `${th.bgDeep} ${th.textSub}`}`}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className={`text-xs ${th.textMuted} mb-1.5`}>图像模型</div>
                      <select className={`w-full px-3 py-2 rounded-lg border text-sm ${th.input} focus:outline-none`} value={selectedImageModel} onChange={e => setSelectedImageModel(e.target.value)}>
                        {imageModels.length === 0 && <option value="">请先配置图像模型</option>}
                        {imageModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <button onClick={handleGenerateKV} disabled={generating || !selectedDirectionId} className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${generating || !selectedDirectionId ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed` : `${th.accent} text-black ${th.accentHover} shadow-lg active:scale-[0.98]`}`}>
                      {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                      {generating ? '生成中...' : '生成主KV'}
                    </button>
                  </div>
                </div>
                {/* Right: KV Results */}
                <div className="flex-1 space-y-2 min-w-0">
                  <h3 className={`text-xs font-medium ${th.textMuted} uppercase tracking-wider`}>主KV物料</h3>
                  {materials.filter(m => m.materialType === 'kv-main').length === 0 ? (
                    <div className={`text-center py-12 ${th.textMuted} text-sm`}>暂无KV，选择方向后生成</div>
                  ) : (
                    materials.filter(m => m.materialType === 'kv-main').map(mat => (
                      <div key={mat.id} className={`p-3 rounded-xl border ${th.border} ${th.bgCard}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium ${th.text}`}>{mat.title}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-[#222] text-gray-400'}`}>{mat.ratio}</span>
                            </div>
                            {mat.prompt && <p className={`text-xs ${th.textSub} mt-1.5 line-clamp-3 leading-relaxed`}>{mat.prompt}</p>}
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            <button onClick={() => { navigator.clipboard.writeText(mat.prompt); }} className={`p-1.5 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-blue-600 hover:bg-blue-50' : 'text-gray-500 hover:text-[#d4af37] hover:bg-[#d4af37]/10'}`} title="复制Prompt"><Copy size={13} /></button>
                            <button onClick={() => handleDeleteMaterial(mat.id)} className={`p-1.5 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'}`} title="删除"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          )}

          {/* ═══ MATERIALS TAB ═══ */}
          {activeTab === 'materials' && (
            !currentProject ? noProject : (
              <div className="flex gap-4">
                {/* Left: Material type selector */}
                <div className="w-[300px] shrink-0 space-y-3">
                  <div className={`p-4 rounded-xl border ${th.border} ${th.bgCard} space-y-3`}>
                    <h3 className={`text-sm font-semibold ${th.text} flex items-center gap-2`}>
                      <LayoutGrid size={14} className={th.accentText} /> 批量生成物料
                    </h3>
                    {/* Category list */}
                    <div className="space-y-1 max-h-[380px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                      {MATERIAL_CATEGORIES.map(cat => (
                        <div key={cat.id}>
                          <div className="flex items-center gap-1.5 py-1.5 cursor-pointer" onClick={() => toggleCategory(cat.id)}>
                            <ChevronRight size={12} className={`transition-transform ${expandedCategories.has(cat.id) ? 'rotate-90' : ''}`} style={{ color: textMutedColor }} />
                            <input
                              type="checkbox"
                              checked={cat.items.every(i => selectedMaterialTypes.has(i.id))}
                              onChange={() => toggleCategoryMaterials(cat.id)}
                              className="rounded accent-[#d4af37]"
                              onClick={e => e.stopPropagation()}
                            />
                            <span className={`text-xs ${th.textSub}`}>{cat.icon}</span>
                            <span className={`text-xs font-medium ${th.textSub}`}>{cat.label}</span>
                            <span className={`text-[10px] ${th.textMuted}`}>({cat.items.length})</span>
                          </div>
                          {expandedCategories.has(cat.id) && (
                            <div className="ml-6 grid grid-cols-2 gap-1 mb-1.5">
                              {cat.items.map(mt => (
                                <button key={mt.id} onClick={() => { setSelectedMaterialTypes(prev => { const next = new Set(prev); if (next.has(mt.id)) next.delete(mt.id); else next.add(mt.id); return next; }); }} className={`px-2 py-1.5 rounded-lg border text-left transition-all text-[11px] ${selectedMaterialTypes.has(mt.id) ? `${th.accentBg} ${isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/30'} ${th.accentText}` : `${th.borderLight} ${th.textMuted}`}`}>
                                  <div className="truncate">{mt.label}</div>
                                  <div style={{ color: textMutedColor, fontSize: '9px' }}>{mt.ratio}</div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {selectedMaterialTypes.size > 0 && (
                      <div className={`text-xs ${th.textMuted}`}>已选择 <span className={th.accentText}>{selectedMaterialTypes.size}</span> 种物料</div>
                    )}
                    <button onClick={handleBatchGenerate} disabled={generating || selectedMaterialTypes.size === 0} className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${generating || selectedMaterialTypes.size === 0 ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed` : `${th.accent} text-black ${th.accentHover} shadow-lg active:scale-[0.98]`}`}>
                      {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                      {generating ? '生成中...' : '批量生成Prompt'}
                    </button>
                  </div>
                </div>
                {/* Right: Material list */}
                <div className="flex-1 space-y-2 min-w-0 max-h-[480px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {materials.length === 0 ? (
                    <div className={`text-center py-12 ${th.textMuted} text-sm`}>暂无物料，选择物料类型后批量生成</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <h3 className={`text-xs font-medium ${th.textMuted} uppercase tracking-wider`}>物料列表 ({materials.length})</h3>
                        <button onClick={() => setActiveTab('consistency')} className={`text-xs ${th.accentText} flex items-center gap-1 hover:underline`}>
                          <Shield size={11} /> 一致性检测
                        </button>
                      </div>
                      {materials.map(mat => (
                        <div key={mat.id} className={`p-3 rounded-xl border ${th.border} ${th.bgCard}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium ${th.text}`}>{mat.title || '未命名物料'}</div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-[#222] text-gray-400'}`}>{mat.materialType}</span>
                                <span className={`text-[10px] ${th.textMuted}`}>{mat.ratio}</span>
                                {mat.score > 0 && <span className={`text-[10px] ${mat.score >= 80 ? th.accentText : 'text-red-400'}`}>一致性 {mat.score}分</span>}
                              </div>
                              {mat.prompt && <p className={`text-xs ${th.textSub} mt-1.5 line-clamp-2 leading-relaxed`}>{mat.prompt}</p>}
                            </div>
                            <div className="flex items-center gap-1 ml-2">
                              <button onClick={() => { navigator.clipboard.writeText(mat.prompt); }} className={`p-1.5 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-blue-600 hover:bg-blue-50' : 'text-gray-500 hover:text-[#d4af37] hover:bg-[#d4af37]/10'}`} title="复制Prompt"><Copy size={13} /></button>
                              {mat.imageUrl && <button onClick={() => onAddImages?.([mat.imageUrl])} className={`p-1.5 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-blue-600 hover:bg-blue-50' : 'text-gray-500 hover:text-[#d4af37] hover:bg-[#d4af37]/10'}`} title="添加到画布"><ImageIcon size={13} /></button>}
                              <button onClick={() => handleDeleteMaterial(mat.id)} className={`p-1.5 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'}`} title="删除"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )
          )}

          {/* ═══ CONSISTENCY TAB ═══ */}
          {activeTab === 'consistency' && (
            !currentProject ? noProject : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className={`text-sm font-semibold ${th.text} flex items-center gap-2`}>
                    <Shield size={14} className={th.accentText} /> 品牌一致性检测
                  </h3>
                  <button onClick={handleConsistencyCheck} disabled={checking} className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${checking ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed` : `${th.accent} text-black ${th.accentHover} shadow-lg active:scale-[0.98]`}`}>
                    {checking ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                    {checking ? '检测中...' : '开始检测'}
                  </button>
                </div>
                {/* Score cards */}
                {Object.keys(consistencyScores).length > 0 ? (
                  <div className="grid grid-cols-5 gap-3">
                    {[
                      { key: 'logo', label: 'Logo一致性', icon: <Star size={16} /> },
                      { key: 'product', label: '产品保真', icon: <Package size={16} /> },
                      { key: 'ip', label: 'IP一致性', icon: <UserCircle size={16} /> },
                      { key: 'brandColor', label: '品牌色', icon: <Palette size={16} /> },
                      { key: 'chinese', label: '中文标题', icon: <FileText size={16} /> },
                    ].map(({ key, label, icon }) => {
                      const score = consistencyScores[key] || 0;
                      const color = score >= 80 ? '#22c55e' : score >= 60 ? accentColor : '#ef4444';
                      return (
                        <div key={key} className={`p-4 rounded-xl border ${th.border} ${th.bgCard} text-center`}>
                          <div className="mx-auto mb-2" style={{ color: textMutedColor }}>{icon}</div>
                          <div className="text-2xl font-bold" style={{ color }}>{score}</div>
                          <div className={`text-[10px] ${th.textMuted} mt-1`}>{label}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={`text-center py-16 ${th.textMuted} text-sm`}>
                    <Shield size={32} className="mx-auto mb-3 opacity-30" />
                    点击"开始检测"分析物料一致性
                  </div>
                )}
                {/* Issues list placeholder */}
                {Object.keys(consistencyScores).length > 0 && (
                  <div className={`p-4 rounded-xl border ${th.border} ${th.bgCard}`}>
                    <h4 className={`text-xs font-medium ${th.textSub} mb-2`}>检测结果</h4>
                    {Object.entries(consistencyScores).filter(([, s]) => s < 80).length === 0 ? (
                      <div className={`text-sm ${th.textSub} flex items-center gap-2`}><Check size={14} style={{ color: '#22c55e' }} /> 所有维度均通过一致性检测</div>
                    ) : (
                      <div className="space-y-1.5">
                        {Object.entries(consistencyScores).filter(([, s]) => s < 80).map(([key, score]) => (
                          <div key={key} className={`text-xs ${th.textSub} flex items-center gap-2`}>
                            <AlertTriangle size={12} style={{ color: score < 60 ? '#ef4444' : accentColor }} />
                            {key === 'logo' ? 'Logo' : key === 'product' ? '产品' : key === 'ip' ? 'IP' : key === 'brandColor' ? '品牌色' : '中文标题'}一致性较低 ({score}分)
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          )}

          {/* ═══ VERSIONS TAB ═══ */}
          {activeTab === 'versions' && (
            !currentProject ? noProject : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className={`text-sm font-semibold ${th.text} flex items-center gap-2`}>
                    <History size={14} className={th.accentText} /> 版本管理
                  </h3>
                  <button onClick={() => handleSaveVersion('full', '手动保存')} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${th.border} ${th.bgCard} ${th.textSub} hover:${th.text} transition-all flex items-center gap-1.5`}>
                    <Save size={12} /> 保存当前版本
                  </button>
                </div>
                {versions.length === 0 ? (
                  <div className={`text-center py-16 ${th.textMuted} text-sm`}>
                    <History size={32} className="mx-auto mb-3 opacity-30" />
                    暂无版本记录，点击"保存当前版本"
                  </div>
                ) : (
                  <div className="space-y-2">
                    {versions.map(v => (
                      <div key={v.id} className={`p-3 rounded-xl border ${th.border} ${th.bgCard} flex items-start justify-between`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-semibold ${th.text}`}>{v.versionName}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-[#222] text-gray-400'}`}>{v.targetType}</span>
                          </div>
                          <div className={`text-xs ${th.textMuted} mt-0.5`}>{v.note || '无备注'}</div>
                          <div className={`text-[10px] ${th.textMuted} mt-0.5`}>{new Date(Number(v.createdAt)).toLocaleString()}</div>
                        </div>
                        <button className={`p-1.5 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-blue-600 hover:bg-blue-50' : 'text-gray-500 hover:text-[#d4af37] hover:bg-[#d4af37]/10'}`} title="恢复此版本">
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          {/* ═══ EXPORT TAB ═══ */}
          {activeTab === 'export' && (
            !currentProject ? noProject : (
              <div className="space-y-4">
                <h3 className={`text-sm font-semibold ${th.text} flex items-center gap-2`}>
                  <Download size={14} className={th.accentText} /> 导出
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'images' as const, label: '图片素材', desc: '导出所有已生成图片', icon: <ImageIcon size={20} /> },
                    { id: 'prompts' as const, label: 'Prompt包', desc: '导出所有物料Prompt', icon: <FileText size={20} /> },
                    { id: 'markdown' as const, label: 'Markdown提案', desc: '导出完整品牌提案', icon: <Edit3 size={20} /> },
                  ].map(fmt => (
                    <button key={fmt.id} onClick={() => setExportFormat(fmt.id)} className={`p-4 rounded-xl border text-left transition-all ${exportFormat === fmt.id ? `${th.accentBg} ${isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/30'}` : `${th.border} ${th.bgCard} hover:border-white/[0.15]`}`}>
                      <div className="mb-2" style={{ color: exportFormat === fmt.id ? accentColor : textMutedColor }}>{fmt.icon}</div>
                      <div className={`text-sm font-medium ${th.text}`}>{fmt.label}</div>
                      <div className={`text-[10px] ${th.textMuted} mt-0.5`}>{fmt.desc}</div>
                    </button>
                  ))}
                </div>
                <button onClick={handleExport} disabled={materials.length === 0 && exportFormat === 'images'} className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${materials.length === 0 && exportFormat === 'images' ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed` : `${th.accent} text-black ${th.accentHover} shadow-lg active:scale-[0.98]`}`}>
                  <Download size={14} /> 导出 {exportFormat === 'images' ? '图片' : exportFormat === 'prompts' ? 'Prompt' : '提案'}
                </button>
              </div>
            )
          )}

        </div>
      </div>
    </div>
  );
}
