'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Sparkles, FolderPlus, Trash2, Edit3, Check, X,
  ChevronRight, ChevronDown, Plus, Search, Lightbulb,
  GripVertical, Copy, ExternalLink, Eye, Languages,
  Tag, Image, FileText, Loader2, ChevronLeft, RefreshCw,
  Bookmark, BookmarkCheck, ArrowRight, Zap,
  Maximize2, Minimize2, Download, Upload, Shuffle, Star, Clock, BarChart3,
  Bot, ShoppingBag, Send, Settings2, Palette, LayoutGrid
} from 'lucide-react';

// ===== Types =====
export interface PromptItem {
  id: string;
  text: string;
  textEn?: string;
  tag?: string;
  pinned?: boolean;
  createdAt: number;
  useCount?: number;
  favorited?: boolean;
}

export interface PromptCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  expanded: boolean;
  prompts: PromptItem[];
}

export interface ResourcePrompt {
  id: string;
  name: string;
  nameEn?: string;
  content: string;
  contentEn?: string;
  categoryId: string;
  order: number;
  sourceCategory?: string;
  previewImage?: string;
  author?: string;
  authorUrl?: string;
}

export interface ResourceCategory {
  id: string;
  name: string;
  nameEn?: string;
  order: number;
  count: number;
}

export interface JsonPromptSchema {
  subject: string;
  action_pose: string;
  details_appearance: string;
  environment_background: string;
  lighting_atmosphere: string;
  style_camera: string;
  colors: string[];
  materials: string[];
  aspect_ratio: string;
  [key: string]: unknown;
}

export interface ZhJsonPromptSchema {
  主体: string;
  动作姿态: string;
  细节外观: string;
  环境背景: string;
  光影氛围: string;
  风格镜头: string;
  色彩: string[];
  材质: string[];
  宽高比: string;
  [key: string]: unknown;
}

export interface VisionApiResultData {
  zh?: { title: string; prompt: string; analysis: string; };
  en?: { title: string; prompt: string; analysis: string; };
  zh_style_tags?: string[];
  en_style_tags?: string[];
  zh_json?: ZhJsonPromptSchema;
  en_json?: JsonPromptSchema;
  json_prompt?: JsonPromptSchema;
  confidence?: number;
  raw?: string;
}

export interface OmpSettings {
  enabled: boolean;
  categories: PromptCategory[];
  recentUsed: PromptItem[];
  visionDefaultFormat: 'natural' | 'json';
  savedVisionResults: VisionApiResultData[];
  favorites: PromptItem[];
}

const STORAGE_KEY = 'oh-my-prompt-data-v2';

// ===== Agent / Ecommerce Types (from oh-my-prompt repo) =====
export type AgentTemplateCategory = 'general' | 'ecommerce'
export type EcommercePlatform = 'amazon' | 'taobao' | 'jd' | 'pinduoduo' | 'temu' | 'shein'
export type EcommerceMarket = 'china' | 'usa' | 'europe' | 'japan' | 'southeast_asia'
export type EcommerceLanguage = 'zh' | 'en' | 'ja'
export type EcommerceAspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16'

export interface GeneralAgentSections {
  subject?: string
  style?: string
  lighting?: string
  colors?: string
  composition?: string
  materials?: string
  mood?: string
  negativePrompt?: string
}

export interface EcommercePromptItem {
  type: string
  typeEn: string
  prompt: string
  aspectRatio: string
  details?: {
    subject?: string
    scene?: string
    composition?: string
    lighting?: string
    style?: string
    sellingPoint?: string
    parameters?: string
  }
}

// ===== Category Icon/Color Mapping =====
const CATEGORY_ICONS: Record<string, { icon: string; color: string }> = {
  'gpt-image': { icon: '🤖', color: '#10a37f' },
  'nano-banana': { icon: '🍌', color: '#fbbf24' },
  'prompts-chat-image': { icon: '💬', color: '#6366f1' },
  '3d-miniatures-dioramas': { icon: '🏠', color: '#f97316' },
  'product-photography': { icon: '📦', color: '#14b8a6' },
  'character-design': { icon: '🎭', color: '#a855f7' },
  'food-culinary': { icon: '🍜', color: '#ef4444' },
  'fantasy-scifi': { icon: '🔮', color: '#8b5cf6' },
  'sports-action': { icon: '⚽', color: '#22c55e' },
  'urban-cityscapes': { icon: '🌆', color: '#3b82f6' },
  'architecture-interiors': { icon: '🏛️', color: '#78716c' },
  'nature-landscapes': { icon: '🏔️', color: '#059669' },
  'logo-branding': { icon: '✏️', color: '#ec4899' },
  'vintage-retro': { icon: '📻', color: '#b45309' },
  'cinematic-posters': { icon: '🎬', color: '#dc2626' },
  'anime-manga': { icon: '🌸', color: '#f472b6' },
  'minimalist-icons': { icon: '⬜', color: '#6b7280' },
  'fashion-photography': { icon: '👗', color: '#e11d48' },
  'portrait-photography': { icon: '📷', color: '#0ea5e9' },
  'misc': { icon: '📎', color: '#9ca3af' },
};

// ===== Helper =====
function genId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

/** Get image URL - direct external URL with referrer bypass */
function getImgUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  // Already a relative path or data URL - return as-is
  if (url.startsWith('/') || url.startsWith('data:')) return url;
  // Return direct URL - browser will load with referrerpolicy
  return url;
}

function loadSettings(): OmpSettings {
  if (typeof window === 'undefined') return { enabled: false, categories: [], recentUsed: [], visionDefaultFormat: 'natural', savedVisionResults: [], favorites: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { enabled: false, categories: [], recentUsed: [], visionDefaultFormat: 'natural', savedVisionResults: [], favorites: [], ...parsed };
    }
    const v1Raw = localStorage.getItem('oh-my-prompt-data');
    if (v1Raw) {
      const v1 = JSON.parse(v1Raw);
      const migrated: OmpSettings = { enabled: v1.enabled || false, categories: v1.categories || [], recentUsed: v1.recentUsed || [], visionDefaultFormat: 'natural', savedVisionResults: [], favorites: [] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {}
  return { enabled: false, categories: [], recentUsed: [], visionDefaultFormat: 'natural', savedVisionResults: [], favorites: [] };
}

function saveSettings(s: OmpSettings): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

// ===== Resource Library Data Loader =====
let resourceDataCache: { categories: ResourceCategory[]; prompts: Map<string, ResourcePrompt[]> } | null = null;

async function loadResourceData(): Promise<{ categories: ResourceCategory[]; prompts: Map<string, ResourcePrompt[]> }> {
  if (resourceDataCache) return resourceDataCache;
  try {
    // 优先使用 API 路由获取资源数据（确保部署环境也能正常工作）
    // public/ 静态文件作为备用
    let index: { categories?: ResourceCategory[]; categoryFiles?: string[] };
    try {
      const apiRes = await fetch('/api/omp-resources');
      if (!apiRes.ok) throw new Error('API route failed');
      index = await apiRes.json();
    } catch {
      // Fallback to static files
      const staticRes = await fetch('/data/omp-resources/index.json');
      if (!staticRes.ok) throw new Error('Failed to load resource index');
      index = await staticRes.json();
    }
    const categories: ResourceCategory[] = (index.categories || []).map((cat: ResourceCategory) => ({ id: cat.id, name: cat.name, nameEn: cat.nameEn, order: cat.order, count: cat.count }));
    const promptsMap = new Map<string, ResourcePrompt[]>();
    const categoryFiles: string[] = index.categoryFiles || [];
    const batchSize = 5;
    for (let i = 0; i < categoryFiles.length; i += batchSize) {
      const batch = categoryFiles.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map(async (catId) => {
        // 优先 API 路由，备用静态文件
        let data: { prompts?: ResourcePrompt[] };
        try {
          const apiRes = await fetch(`/api/omp-resources?cat=${catId}`);
          if (!apiRes.ok) throw new Error('API route failed');
          data = await apiRes.json();
        } catch {
          const staticRes = await fetch(`/data/omp-resources/categories/${catId}.json`);
          if (!staticRes.ok) return null;
          data = await staticRes.json();
        }
        return { catId, prompts: data.prompts || [] };
      }));
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) promptsMap.set(result.value.catId, result.value.prompts);
      }
    }
    resourceDataCache = { categories, prompts: promptsMap };
    return resourceDataCache;
  } catch (err) {
    console.error('[Oh My Prompt] Failed to load resource data:', err);
    return { categories: [], prompts: new Map() };
  }
}

// ===== Floating Window Hook =====
function useFloatingWindow(defaultWidth = 540, defaultHeight = 720) {
  const [pos, setPos] = useState({ x: 40, y: 40 });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });
  const [isMaximized, setIsMaximized] = useState(false);
  const [preMaxState, setPreMaxState] = useState({ pos: { x: 40, y: 40 }, size: { w: defaultWidth, h: defaultHeight } });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.origX + ev.clientX - dragRef.current.startX, y: dragRef.current.origY + ev.clientY - dragRef.current.startY });
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos, isMaximized]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      setSize({ w: Math.max(360, resizeRef.current.origW + ev.clientX - resizeRef.current.startX), h: Math.max(300, resizeRef.current.origH + ev.clientY - resizeRef.current.startY) });
    };
    const onUp = () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size, isMaximized]);

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setPos(preMaxState.pos);
      setSize(preMaxState.size);
    } else {
      setPreMaxState({ pos, size });
      setPos({ x: 0, y: 0 });
      setSize({ w: window.innerWidth, h: window.innerHeight });
    }
    setIsMaximized(prev => !prev);
  }, [isMaximized, pos, size, preMaxState]);

  return { pos, size, isMaximized, onDragStart, onResizeStart, toggleMaximize };
}

// ===== Main Component =====
interface OhMyPromptProps {
  onInsertPrompt: (text: string) => void;
  onVisionPrompt?: (imageUrl: string) => void;
  isVisionAnalyzing?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  themeStyle?: string;
  embedded?: boolean;
  visionResult?: VisionApiResultData | null;
  // Floating mode props
  floating?: boolean;
}

export default function OhMyPrompt({ onInsertPrompt, onVisionPrompt, isVisionAnalyzing, isOpen, onClose, themeStyle, embedded = false, visionResult, floating = false }: OhMyPromptProps) {
  const [settings, setSettings] = useState<OmpSettings>(loadSettings);
  const [activeTab, setActiveTab] = useState<'insert' | 'manage' | 'resource' | 'vision' | 'agent' | 'ecommerce'>('resource');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [newPromptText, setNewPromptText] = useState('');
  const [newPromptTextEn, setNewPromptTextEn] = useState('');
  const [addingToCatId, setAddingToCatId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<{ catId: string; promptId: string } | null>(null);
  const [builtinExpandedIds, setBuiltinExpandedIds] = useState<Set<string>>(new Set());
  const [resourceCategories, setResourceCategories] = useState<ResourceCategory[]>([]);
  const [resourcePrompts, setResourcePrompts] = useState<Map<string, ResourcePrompt[]>>(new Map());
  const [resourceLoading, setResourceLoading] = useState(true);
  const [expandedResourceCats, setExpandedResourceCats] = useState<Set<string>>(new Set());
  const [visionFormat, setVisionFormat] = useState<'natural' | 'json'>('natural');
  const [selectedResourceCat, setSelectedResourceCat] = useState<string | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<ResourcePrompt | PromptItem | null>(null);
  const [randomPrompt, setRandomPrompt] = useState<ResourcePrompt | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Agent / Ecommerce state
  const [agentInput, setAgentInput] = useState('');
  const [agentGenerating, setAgentGenerating] = useState(false);
  const [agentResult, setAgentResult] = useState<{ prompt: string; sections?: GeneralAgentSections } | null>(null);
  const [agentError, setAgentError] = useState('');
  const [ecomPlatform, setEcomPlatform] = useState<EcommercePlatform>('taobao');
  const [ecomMarket, setEcomMarket] = useState<EcommerceMarket>('china');
  const [ecomLanguage, setEcomLanguage] = useState<EcommerceLanguage>('zh');
  const [ecomAspectRatio, setEcomAspectRatio] = useState<EcommerceAspectRatio>('1:1');
  const [ecomSellingPoints, setEcomSellingPoints] = useState('');
  const [ecomGenerating, setEcomGenerating] = useState(false);
  const [ecomResult, setEcomResult] = useState<EcommercePromptItem[] | null>(null);
  const [ecomError, setEcomError] = useState('');

  // Floating window state
  const floatWin = useFloatingWindow(540, 720);

  useEffect(() => { saveSettings(settings); }, [settings]);

  useEffect(() => {
    let mounted = true;
    loadResourceData().then(({ categories, prompts }) => {
      if (mounted) { setResourceCategories(categories); setResourcePrompts(prompts); setResourceLoading(false); }
    });
    return () => { mounted = false; };
  }, []);

  const isMonochrome = themeStyle === 'monochrome';

  // Theme colors - ensuring text is always visible
  const tc = useMemo(() => ({
    bg: isMonochrome ? 'bg-white' : 'bg-[#0d0d0d]',
    bgCard: isMonochrome ? 'bg-gray-50' : 'bg-[#151515]',
    bgHover: isMonochrome ? 'hover:bg-blue-50' : 'hover:bg-[#1a1a1a]',
    bgInput: isMonochrome ? 'bg-gray-50' : 'bg-[#1a1a1a]',
    border: isMonochrome ? 'border-gray-200' : 'border-[#2a2a2a]',
    text: isMonochrome ? 'text-gray-900' : 'text-[#e5e5e5]',
    textSec: isMonochrome ? 'text-gray-600' : 'text-[#aaa]',
    textMuted: isMonochrome ? 'text-gray-400' : 'text-[#777]',
    accent: isMonochrome ? 'text-blue-600' : 'text-[#d4af37]',
    accentBg: isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]',
    accentBgLight: isMonochrome ? 'bg-blue-50' : 'bg-[#d4af37]/10',
    accentBorder: isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/40',
    accentText: isMonochrome ? 'text-blue-600' : 'text-[#d4af37]',
    accentTextOn: isMonochrome ? 'text-white' : 'text-black',
    danger: isMonochrome ? 'text-red-500' : 'text-red-400',
  }), [isMonochrome]);

  // ===== Wheel stop propagation =====
  const handleWheelStop = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  // ===== Category Management =====
  const addCategory = useCallback(() => {
    const cat: PromptCategory = { id: genId(), name: '新分类', icon: '📁', color: isMonochrome ? '#3b82f6' : '#d4af37', expanded: true, prompts: [] };
    setSettings(prev => ({ ...prev, categories: [...prev.categories, cat] }));
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
  }, [isMonochrome]);

  const deleteCategory = useCallback((catId: string) => {
    setSettings(prev => ({ ...prev, categories: prev.categories.filter(c => c.id !== catId) }));
  }, []);

  const renameCategory = useCallback((catId: string, newName: string) => {
    setSettings(prev => ({ ...prev, categories: prev.categories.map(c => c.id === catId ? { ...c, name: newName } : c) }));
    setEditingCatId(null);
  }, []);

  const toggleCategory = useCallback((catId: string) => {
    const isBuiltin = catId.startsWith('builtin-');
    if (isBuiltin) {
      setBuiltinExpandedIds(prev => { const next = new Set(prev); if (next.has(catId)) next.delete(catId); else next.add(catId); return next; });
    } else {
      setSettings(prev => ({ ...prev, categories: prev.categories.map(c => c.id === catId ? { ...c, expanded: !c.expanded } : c) }));
    }
  }, []);

  // ===== Prompt Management =====
  const addPrompt = useCallback((catId: string, text: string, textEn?: string) => {
    const prompt: PromptItem = { id: genId(), text, textEn, createdAt: Date.now(), useCount: 0 };
    setSettings(prev => ({ ...prev, categories: prev.categories.map(c => c.id === catId ? { ...c, prompts: [...c.prompts, prompt] } : c) }));
    setNewPromptText(''); setNewPromptTextEn(''); setAddingToCatId(null);
  }, []);

  const deletePrompt = useCallback((catId: string, promptId: string) => {
    setSettings(prev => ({ ...prev, categories: prev.categories.map(c => c.id === catId ? { ...c, prompts: c.prompts.filter(p => p.id !== promptId) } : c), recentUsed: prev.recentUsed.filter(p => p.id !== promptId), favorites: (prev.favorites || []).filter(p => p.id !== promptId) }));
  }, []);

  const insertPrompt = useCallback((prompt: PromptItem) => {
    onInsertPrompt(prompt.text);
    setSettings(prev => ({
      ...prev,
      recentUsed: [{ ...prompt, useCount: (prompt.useCount || 0) + 1 }, ...prev.recentUsed.filter(p => p.id !== prompt.id)].slice(0, 30),
    }));
  }, [onInsertPrompt]);

  const insertResourcePrompt = useCallback((rp: ResourcePrompt) => {
    const text = rp.content || rp.name;
    onInsertPrompt(text);
    const prompt: PromptItem = { id: rp.id, text, textEn: rp.contentEn || rp.nameEn, tag: rp.sourceCategory, createdAt: Date.now(), useCount: 1 };
    setSettings(prev => ({ ...prev, recentUsed: [prompt, ...prev.recentUsed.filter(p => p.id !== prompt.id)].slice(0, 30) }));
  }, [onInsertPrompt]);

  const toggleFavorite = useCallback((prompt: PromptItem) => {
    setSettings(prev => {
      const favs = prev.favorites || [];
      const exists = favs.find(f => f.id === prompt.id);
      return { ...prev, favorites: exists ? favs.filter(f => f.id !== prompt.id) : [...favs, { ...prompt, favorited: true }] };
    });
  }, []);

  const copyPrompt = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  // ===== Random prompt =====
  const pickRandom = useCallback(() => {
    const allPrompts: ResourcePrompt[] = [];
    for (const [, prompts] of resourcePrompts) allPrompts.push(...prompts);
    if (allPrompts.length === 0) return;
    setRandomPrompt(allPrompts[Math.floor(Math.random() * allPrompts.length)]);
  }, [resourcePrompts]);

  // ===== Agent Generate =====
  const handleAgentGenerate = useCallback(async () => {
    if (!agentInput.trim()) return;
    setAgentGenerating(true);
    setAgentError('');
    setAgentResult(null);
    try {
      const res = await fetch('/api/omp-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputText: agentInput, templateCategory: 'general' }),
      });
      const data = await res.json();
      if (!data.success) { setAgentError(data.error || '生成失败'); return; }
      const result = data.data;
      setAgentResult({ prompt: result.prompt, sections: result.agentResult?.sections });
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setAgentGenerating(false);
    }
  }, [agentInput]);

  // ===== Ecommerce Generate =====
  const handleEcommerceGenerate = useCallback(async () => {
    if (!agentInput.trim()) return;
    setEcomGenerating(true);
    setEcomError('');
    setEcomResult(null);
    try {
      const res = await fetch('/api/omp-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputText: agentInput,
          templateCategory: 'ecommerce',
          ecommerceConfig: {
            platform: ecomPlatform,
            market: ecomMarket,
            language: ecomLanguage,
            aspectRatio: ecomAspectRatio,
            setStructure: 'smart',
            sellingPoints: ecomSellingPoints,
          },
        }),
      });
      const data = await res.json();
      if (!data.success) { setEcomError(data.error || '生成失败'); return; }
      const result = data.data;
      setEcomResult(result.ecommercePrompts?.prompts || null);
    } catch (err) {
      setEcomError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setEcomGenerating(false);
    }
  }, [agentInput, ecomPlatform, ecomMarket, ecomLanguage, ecomAspectRatio, ecomSellingPoints]);

  // ===== Export / Import =====
  const handleExport = useCallback(() => {
    const data = JSON.stringify(settings, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `oh-my-prompt-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [settings]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string);
        if (imported.categories) {
          setSettings(prev => ({
            ...prev,
            categories: [...prev.categories, ...imported.categories],
            favorites: [...(prev.favorites || []), ...(imported.favorites || [])],
          }));
        }
      } catch { /* ignore */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // ===== Drag & Drop =====
  const handleDragStart = useCallback((catId: string, promptId: string) => { setDragItem({ catId, promptId }); }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const handleDrop = useCallback((e: React.DragEvent, targetCatId: string, targetIdx: number) => {
    e.preventDefault();
    if (!dragItem) return;
    const { catId: srcCatId, promptId } = dragItem;
    setSettings(prev => {
      const newCats = [...prev.categories];
      const srcCat = newCats.find(c => c.id === srcCatId);
      if (!srcCat) return prev;
      const srcIdx = srcCat.prompts.findIndex(p => p.id === promptId);
      if (srcIdx === -1) return prev;
      const [moved] = srcCat.prompts.splice(srcIdx, 1);
      const tgtCat = newCats.find(c => c.id === targetCatId);
      if (!tgtCat) return prev;
      tgtCat.prompts.splice(targetIdx, 0, moved);
      return { ...prev, categories: newCats };
    });
    setDragItem(null);
  }, [dragItem]);

  // ===== Search with highlight =====
  const highlightText = useCallback((text: string, query: string) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return <>
      {text.substring(0, idx)}
      <mark className={isMonochrome ? 'bg-yellow-200 text-gray-900 rounded px-0.5' : 'bg-[#d4af37]/30 text-[#d4af37] rounded px-0.5'}>{text.substring(idx, idx + query.length)}</mark>
      {text.substring(idx + query.length)}
    </>;
  }, [isMonochrome]);

  const filteredCategories = searchQuery
    ? settings.categories.map(c => ({ ...c, expanded: true, prompts: c.prompts.filter(p => p.text.toLowerCase().includes(searchQuery.toLowerCase()) || (p.textEn && p.textEn.toLowerCase().includes(searchQuery.toLowerCase())) || (p.tag && p.tag.toLowerCase().includes(searchQuery.toLowerCase()))) })).filter(c => c.prompts.length > 0)
    : settings.categories;

  const filteredResourcePrompts = useMemo(() => {
    if (!searchQuery || activeTab !== 'resource') return null;
    const results: ResourcePrompt[] = [];
    const query = searchQuery.toLowerCase();
    for (const [, prompts] of resourcePrompts) {
      for (const p of prompts) {
        if ((p.name && p.name.toLowerCase().includes(query)) || (p.nameEn && p.nameEn.toLowerCase().includes(query)) || (p.content && p.content.toLowerCase().includes(query)) || (p.sourceCategory && p.sourceCategory.toLowerCase().includes(query))) results.push(p);
      }
    }
    return results;
  }, [searchQuery, resourcePrompts, activeTab]);

  // ===== Vision result rendering =====
  const renderVisionResult = () => {
    if (!visionResult || ((!visionResult.zh?.title && !visionResult.en?.title) && !visionResult.raw)) {
      return (
        <div className="p-6 flex flex-col items-center justify-center gap-3 min-h-[200px]">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isMonochrome ? 'bg-blue-500/10' : 'bg-[#d4af37]/10'}`}>
            <Eye className={`w-8 h-8 ${tc.accent}`} />
          </div>
          <div className="text-center">
            <p className={`text-sm font-medium mb-1 ${tc.text}`}>图片识词</p>
            <p className={`text-xs leading-relaxed ${tc.textMuted}`}>
              悬停画布上的图片，点击 ✨ 按钮<br />自动生成双语结构化提示词<br />支持自然语言 / JSON 两种格式
            </p>
          </div>
          {onVisionPrompt && (
            <button
              onClick={() => onClose?.()}
              title="关闭面板后，请在画布上点击图片右下角的 ✨ 按钮进行识词"
              className={`mt-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${isMonochrome ? 'bg-blue-500/20 border border-blue-500/40 text-blue-600 hover:bg-blue-500/30' : 'bg-[#d4af37]/20 border border-[#d4af37]/40 text-[#d4af37] hover:bg-[#d4af37]/30'}`}
            >
              选择画布图片识别
            </button>
          )}
        </div>
      );
    }
    // Raw content fallback (API returned unparsed text)
    if (visionResult.raw && !visionResult.zh?.title && !visionResult.en?.title) {
      return (
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className={`text-sm font-semibold ${tc.text}`}>图片识词结果</h4>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isMonochrome ? 'bg-yellow-100 text-yellow-700' : 'bg-yellow-900/30 text-yellow-400'}`}>原始输出</span>
          </div>
          <div className={`text-xs leading-relaxed p-2 rounded-md whitespace-pre-wrap max-h-[300px] overflow-y-auto ${isMonochrome ? 'bg-gray-50 text-gray-700 border border-gray-100' : 'bg-[#1a1a1a] text-[#ccc] border border-[#222]'}`}>
            {String(visionResult.raw)}
          </div>
          <div className="flex gap-2">
            <button className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#e5c147]'}`} onClick={() => onInsertPrompt(String(visionResult.raw))}>插入内容</button>
          </div>
        </div>
      );
    }
    const confidence = visionResult.confidence ?? 0;
    return (
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className={`text-sm font-semibold ${tc.text}`}>{visionResult.zh?.title || visionResult.en?.title || '图片识词结果'}</h4>
          <span className={`text-xs px-2 py-0.5 rounded-full ${confidence >= 0.8 ? isMonochrome ? 'bg-green-100 text-green-700' : 'bg-green-900/30 text-green-400' : confidence >= 0.5 ? isMonochrome ? 'bg-yellow-100 text-yellow-700' : 'bg-yellow-900/30 text-yellow-400' : isMonochrome ? 'bg-red-100 text-red-700' : 'bg-red-900/30 text-red-400'}`}>
            置信度 {Math.round(confidence * 100)}%
          </span>
        </div>
        {((visionResult.zh_style_tags?.length ?? 0) > 0 || (visionResult.en_style_tags?.length ?? 0) > 0) && (
          <div className="flex flex-wrap gap-1">
            {visionResult.zh_style_tags?.map((tag, i) => (<span key={`zh-${i}`} className={`text-xs px-1.5 py-0.5 rounded-full ${isMonochrome ? 'bg-blue-100 text-blue-700' : 'bg-[#d4af37]/15 text-[#d4af37]'}`}>{tag}</span>))}
            {visionResult.en_style_tags?.map((tag, i) => (<span key={`en-${i}`} className={`text-xs px-1.5 py-0.5 rounded-full ${isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-[#333] text-[#999]'}`}>{tag}</span>))}
          </div>
        )}
        <div className={`flex rounded-md overflow-hidden ${isMonochrome ? 'border border-gray-200' : 'border border-[#333]'}`}>
          <button className={`flex-1 px-3 py-1 text-xs font-medium transition-colors ${visionFormat === 'natural' ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black' : isMonochrome ? 'bg-gray-50 text-gray-600' : 'bg-[#1a1a1a] text-[#888]'}`} onClick={() => setVisionFormat('natural')}>
            <FileText className="w-3 h-3 inline mr-1" />自然语言
          </button>
          <button className={`flex-1 px-3 py-1 text-xs font-medium transition-colors ${visionFormat === 'json' ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black' : isMonochrome ? 'bg-gray-50 text-gray-600' : 'bg-[#1a1a1a] text-[#888]'}`} onClick={() => setVisionFormat('json')}>
            <Zap className="w-3 h-3 inline mr-1" />结构化
          </button>
        </div>
        {visionFormat === 'natural' ? (
          <div className="space-y-2">
            {visionResult.zh?.prompt && (<div><div className="flex items-center gap-1 mb-1"><Languages className={`w-3 h-3 ${tc.accent}`} /><span className={`text-xs font-medium ${tc.textSec}`}>中文提示词</span><button className={`ml-auto p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-[#333]'}`} onClick={() => copyPrompt(visionResult.zh!.prompt)}><Copy className={`w-3 h-3 ${tc.textMuted}`} /></button></div><div className={`text-xs leading-relaxed p-2 rounded-md ${isMonochrome ? 'bg-gray-50 text-gray-700 border border-gray-100' : 'bg-[#1a1a1a] text-[#ccc] border border-[#222]'}`}>{visionResult.zh!.prompt}</div></div>)}
            {visionResult.en?.prompt && (<div><div className="flex items-center gap-1 mb-1"><Languages className={`w-3 h-3 ${tc.accent}`} /><span className={`text-xs font-medium ${tc.textSec}`}>英文提示词</span><button className={`ml-auto p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-[#333]'}`} onClick={() => copyPrompt(visionResult.en!.prompt)}><Copy className={`w-3 h-3 ${tc.textMuted}`} /></button></div><div className={`text-xs leading-relaxed p-2 rounded-md ${isMonochrome ? 'bg-gray-50 text-gray-700 border border-gray-100' : 'bg-[#1a1a1a] text-[#ccc] border border-[#222]'}`}>{visionResult.en!.prompt}</div></div>)}
          </div>
        ) : (
          <div className="space-y-2">
            {visionResult.zh_json && (<div><div className="flex items-center gap-1 mb-1"><span className={`text-xs font-medium ${tc.textSec}`}>中文结构化</span><button className={`ml-auto p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-[#333]'}`} onClick={() => copyPrompt(JSON.stringify(visionResult.zh_json, null, 2))}><Copy className={`w-3 h-3 ${tc.textMuted}`} /></button></div>{renderJsonFields(visionResult.zh_json, true)}</div>)}
            {visionResult.en_json && (<div><div className="flex items-center gap-1 mb-1"><span className={`text-xs font-medium ${tc.textSec}`}>英文结构化</span><button className={`ml-auto p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200' : 'hover:bg-[#333]'}`} onClick={() => copyPrompt(JSON.stringify(visionResult.en_json, null, 2))}><Copy className={`w-3 h-3 ${tc.textMuted}`} /></button></div>{renderJsonFields(visionResult.en_json, false)}</div>)}
          </div>
        )}
        <div className="flex gap-2">
          {visionResult.zh?.prompt && (<button className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#e5c147]'}`} onClick={() => onInsertPrompt(visionResult.zh!.prompt!)}>插入中文</button>)}
          {visionResult.en?.prompt && (<button className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${isMonochrome ? 'bg-gray-200 text-gray-800 hover:bg-gray-300' : 'bg-[#333] text-[#ccc] hover:bg-[#444]'}`} onClick={() => onInsertPrompt(visionResult.en!.prompt!)}>插入英文</button>)}
        </div>
      </div>
    );
  };

  const renderJsonFields = (data: Record<string, unknown>, isChinese: boolean) => (
    <div className={`space-y-1 p-2 rounded-md text-xs ${isMonochrome ? 'bg-gray-50 border border-gray-100' : 'bg-[#1a1a1a] border border-[#222]'}`}>
      {Object.entries(data).map(([key, value]) => {
        if (Array.isArray(value)) return (<div key={key} className="flex items-start gap-2"><span className={`font-medium min-w-[60px] ${tc.accent}`}>{key}</span><div className="flex flex-wrap gap-1">{value.map((item: string, i: number) => (<span key={i} className={`px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-[#333] text-[#ccc]'}`}>{item}</span>))}</div></div>);
        if (typeof value === 'object' && value !== null) return (<div key={key} className="flex items-start gap-2"><span className={`font-medium min-w-[60px] ${tc.accent}`}>{key}</span><span className={tc.textSec}>{JSON.stringify(value)}</span></div>);
        return (<div key={key} className="flex items-start gap-2"><span className={`font-medium min-w-[60px] ${tc.accent}`}>{key}</span><span className={tc.text}>{String(value)}</span></div>);
      })}
    </div>
  );

  // ===== Render Prompt Item (user prompts) =====
  const renderPromptItem = (prompt: PromptItem, catId: string, idx: number, isBuiltIn: boolean) => (
    <div key={prompt.id} draggable={!isBuiltIn} onDragStart={() => handleDragStart(catId, prompt.id)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, catId, idx)}
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors cursor-pointer ${tc.bgHover}`}
      onClick={() => insertPrompt(prompt)}
    >
      {!isBuiltIn && (<GripVertical className={`w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ${tc.textMuted}`} />)}
      <button className={`p-0.5 flex-shrink-0 ${tc.textMuted} hover:${isMonochrome ? 'text-amber-500' : 'text-amber-400'}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(prompt); }} title="收藏">
        {(settings.favorites || []).some(f => f.id === prompt.id) ? <BookmarkCheck className="w-3 h-3 text-amber-500" /> : <Bookmark className="w-3 h-3" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-xs truncate ${tc.text}`}>{searchQuery ? highlightText(prompt.text, searchQuery) : prompt.text}</div>
        {prompt.textEn && (<div className={`text-xs truncate ${tc.textMuted}`}>{searchQuery ? highlightText(prompt.textEn, searchQuery) : prompt.textEn}</div>)}
      </div>
      {prompt.tag && (<span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${tc.accentBgLight} ${tc.accentText}`}>{prompt.tag}</span>)}
      {prompt.useCount !== undefined && prompt.useCount > 0 && (<span className={`text-xs flex-shrink-0 ${tc.textMuted}`}>{prompt.useCount}x</span>)}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400 hover:text-blue-500' : 'hover:bg-[#333] text-[#888] hover:text-[#d4af37]'}`} onClick={(e) => { e.stopPropagation(); copyPrompt(prompt.text); }} title="复制"><Copy className="w-3 h-3" /></button>
        {!isBuiltIn && (<button className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400 hover:text-red-500' : 'hover:bg-[#333] text-[#888] hover:text-red-400'}`} onClick={(e) => { e.stopPropagation(); deletePrompt(catId, prompt.id); }} title="删除"><Trash2 className="w-3 h-3" /></button>)}
      </div>
    </div>
  );

  // ===== Render Resource Prompt Item with Thumbnail =====
  const renderResourcePromptItem = (rp: ResourcePrompt) => (
    <div key={rp.id}
      className={`group flex items-start gap-2.5 px-2.5 py-2 rounded-lg transition-colors cursor-pointer ${tc.bgHover}`}
      onClick={() => insertResourcePrompt(rp)}
    >
      {/* Thumbnail */}
      <div className={`w-14 h-14 rounded-md flex-shrink-0 overflow-hidden ${isMonochrome ? 'bg-gray-100 border border-gray-200' : 'bg-[#222] border border-[#333]'}`}>
        {rp.previewImage ? (
          <img src={getImgUrl(rp.previewImage)} referrerPolicy="no-referrer" crossOrigin="anonymous" alt={rp.name} className="w-full h-full object-cover" loading="lazy"
            onError={(e) => { const el = e.target as HTMLImageElement; el.style.display = 'none'; if (el.parentElement) el.parentElement.innerHTML = `<div class="w-full h-full flex items-center justify-center text-lg">${CATEGORY_ICONS[rp.categoryId]?.icon || '📝'}</div>`; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-lg">{CATEGORY_ICONS[rp.categoryId]?.icon || '📝'}</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium truncate ${tc.text}`}>
          {searchQuery ? highlightText(rp.name, searchQuery) : rp.name}
          {rp.nameEn && <span className={`ml-1 ${tc.textMuted}`}>/ {searchQuery ? highlightText(rp.nameEn, searchQuery) : rp.nameEn}</span>}
        </div>
        <div className={`text-xs truncate mt-0.5 ${tc.textSec}`}>
          {searchQuery ? highlightText(rp.content?.substring(0, 80) || '', searchQuery) : rp.content?.substring(0, 80)}...
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {rp.sourceCategory && (<span className={`text-xs px-1 py-0 rounded ${tc.accentBgLight} ${tc.accentText}`}>{rp.sourceCategory}</span>)}
          {rp.author && (<span className={`text-xs ${tc.textMuted}`}>by {rp.author}</span>)}
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1">
        <button className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400 hover:text-blue-500' : 'hover:bg-[#333] text-[#888] hover:text-[#d4af37]'}`} onClick={(e) => { e.stopPropagation(); copyPrompt(rp.content); }} title="复制"><Copy className="w-3 h-3" /></button>
        <button className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400 hover:text-amber-500' : 'hover:bg-[#333] text-[#888] hover:text-amber-400'}`} onClick={(e) => { e.stopPropagation(); toggleFavorite({ id: rp.id, text: rp.content, textEn: rp.contentEn, tag: rp.sourceCategory, createdAt: Date.now() }); }} title="收藏"><Bookmark className="w-3 h-3" /></button>
        <button className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400 hover:text-blue-500' : 'hover:bg-[#333] text-[#888] hover:text-[#d4af37]'}`} onClick={(e) => { e.stopPropagation(); setPreviewPrompt(rp); }} title="预览"><Eye className="w-3 h-3" /></button>
      </div>
    </div>
  );

  // ===== Render Category =====
  const renderCategory = (cat: PromptCategory, isBuiltIn: boolean) => (
    <div key={cat.id} className="mb-1">
      <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer group ${tc.bgHover}`} onClick={() => toggleCategory(cat.id)}>
        <span className="text-sm">{cat.icon}</span>
        {editingCatId === cat.id ? (
          <div className="flex items-center gap-1 flex-1">
            <input className={`flex-1 text-xs px-1.5 py-0.5 rounded outline-none ${isMonochrome ? 'bg-gray-100 text-gray-800 border border-blue-300' : 'bg-[#1a1a1a] text-[#ccc] border border-[#d4af37]/50'}`} value={editingCatName} onChange={(e) => setEditingCatName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') renameCategory(cat.id, editingCatName); if (e.key === 'Escape') setEditingCatId(null); }} autoFocus onClick={(e) => e.stopPropagation()} />
            <button className="p-0.5 text-green-400" onClick={(e) => { e.stopPropagation(); renameCategory(cat.id, editingCatName); }}><Check className="w-3 h-3" /></button>
            <button className="p-0.5 text-red-400" onClick={(e) => { e.stopPropagation(); setEditingCatId(null); }}><X className="w-3 h-3" /></button>
          </div>
        ) : (
          <>
            <span className={`text-xs font-medium flex-1 ${tc.text}`}>{cat.name}</span>
            <span className={`text-xs ${tc.textMuted}`}>{cat.prompts.length}</span>
            {!isBuiltIn && (<div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
              <button className={`p-0.5 ${isMonochrome ? 'text-gray-400 hover:text-blue-500' : 'text-[#888] hover:text-[#d4af37]'}`} onClick={(e) => { e.stopPropagation(); setEditingCatId(cat.id); setEditingCatName(cat.name); }} title="重命名"><Edit3 className="w-3 h-3" /></button>
              <button className={`p-0.5 ${isMonochrome ? 'text-gray-400 hover:text-red-500' : 'text-[#888] hover:text-red-400'}`} onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id); }} title="删除"><Trash2 className="w-3 h-3" /></button>
            </div>)}
          </>
        )}
        {cat.expanded ? <ChevronDown className={`w-3 h-3 ${tc.textMuted}`} /> : <ChevronRight className={`w-3 h-3 ${tc.textMuted}`} />}
      </div>
      {cat.expanded && (
        <div className={`ml-4 ${isMonochrome ? 'border-l border-gray-200' : 'border-l border-[#222]'}`}>
          {cat.prompts.map((p, idx) => renderPromptItem(p, cat.id, idx, isBuiltIn))}
          {!isBuiltIn && (
            addingToCatId === cat.id ? (
              <div className="px-2 py-1.5 space-y-1">
                <input className={`w-full text-xs px-2 py-1 rounded outline-none ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-200 focus:border-blue-300' : 'bg-[#1a1a1a] text-[#ccc] border border-[#333] focus:border-[#d4af37]/50'}`} placeholder="中文提示词..." value={newPromptText} onChange={(e) => setNewPromptText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newPromptText.trim()) addPrompt(cat.id, newPromptText.trim(), newPromptTextEn.trim() || undefined); }} autoFocus />
                <input className={`w-full text-xs px-2 py-1 rounded outline-none ${isMonochrome ? 'bg-gray-50 text-gray-500 border border-gray-200 focus:border-blue-300' : 'bg-[#1a1a1a] text-[#888] border border-[#333] focus:border-[#d4af37]/50'}`} placeholder="英文补充（可选）..." value={newPromptTextEn} onChange={(e) => setNewPromptTextEn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newPromptText.trim()) addPrompt(cat.id, newPromptText.trim(), newPromptTextEn.trim() || undefined); }} />
                <div className="flex gap-1">
                  <button className={`px-2 py-0.5 text-xs rounded ${tc.accentBg} ${tc.accentTextOn}`} onClick={() => { if (newPromptText.trim()) addPrompt(cat.id, newPromptText.trim(), newPromptTextEn.trim() || undefined); }}>保存</button>
                  <button className={`px-2 py-0.5 text-xs rounded ${isMonochrome ? 'bg-gray-200 text-gray-600' : 'bg-[#333] text-[#ccc]'}`} onClick={() => { setAddingToCatId(null); setNewPromptText(''); setNewPromptTextEn(''); }}>取消</button>
                </div>
              </div>
            ) : (
              <button className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${tc.accentText} hover:opacity-80`} onClick={() => setAddingToCatId(cat.id)}><Plus className="w-3 h-3" /> 添加提示词</button>
            )
          )}
        </div>
      )}
    </div>
  );

  // ===== Render Resource Category =====
  const renderResourceCategory = (cat: ResourceCategory) => {
    const isExpanded = expandedResourceCats.has(cat.id);
    const iconInfo = CATEGORY_ICONS[cat.id] || { icon: '📁', color: '#9ca3af' };
    const prompts = resourcePrompts.get(cat.id) || [];
    return (
      <div key={cat.id} className="mb-1">
        <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer group ${tc.bgHover}`}
          onClick={() => { setExpandedResourceCats(prev => { const next = new Set(prev); if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id); return next; }); }}
        >
          <span className="text-sm">{iconInfo.icon}</span>
          <span className={`text-xs font-medium flex-1 ${tc.text}`}>{cat.name}</span>
          <span className={`text-xs ${tc.textMuted}`}>{cat.count || prompts.length}</span>
          {isExpanded ? <ChevronDown className={`w-3 h-3 ${tc.textMuted}`} /> : <ChevronRight className={`w-3 h-3 ${tc.textMuted}`} />}
        </div>
        {isExpanded && (
          <div className={`ml-4 ${isMonochrome ? 'border-l border-gray-200' : 'border-l border-[#222]'}`}>
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-2 gap-1.5 p-1">
                {prompts.slice(0, 10).map(rp => (
                  <div key={rp.id} className={`rounded-md overflow-hidden cursor-pointer ${isMonochrome ? 'bg-gray-50 border border-gray-200 hover:border-blue-300' : 'bg-[#1a1a1a] border border-[#333] hover:border-[#d4af37]/50'}`} onClick={() => insertResourcePrompt(rp)}>
                    <div className={`w-full h-16 overflow-hidden ${isMonochrome ? 'bg-gray-100' : 'bg-[#222]'}`}>
                      {rp.previewImage ? <img src={getImgUrl(rp.previewImage)} referrerPolicy="no-referrer" crossOrigin="anonymous" alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div className="w-full h-full flex items-center justify-center text-xl">{iconInfo.icon}</div>}
                    </div>
                    <div className="px-1.5 py-1"><div className={`text-xs truncate ${tc.text}`}>{rp.name}</div></div>
                  </div>
                ))}
              </div>
            ) : (
              prompts.slice(0, 10).map(rp => renderResourcePromptItem(rp))
            )}
            {prompts.length > 10 && (
              <button className={`flex items-center gap-1 px-2 py-1 text-xs w-full text-left transition-colors ${tc.accentText} hover:opacity-80`}
                onClick={(e) => { e.stopPropagation(); setSelectedResourceCat(cat.id); }}
              >
                查看全部 {prompts.length} 条 <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ===== Render Expanded Resource Category =====
  const renderExpandedResourceCat = () => {
    if (!selectedResourceCat) return null;
    const cat = resourceCategories.find(c => c.id === selectedResourceCat);
    const prompts = resourcePrompts.get(selectedResourceCat) || [];
    const iconInfo = CATEGORY_ICONS[selectedResourceCat] || { icon: '📁', color: '#9ca3af' };
    return (
      <div className="flex flex-col h-full">
        <div className={`flex items-center gap-2 px-3 py-2 border-b ${tc.border}`}>
          <button className={`p-1 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-600' : 'hover:bg-[#333] text-[#888]'}`} onClick={() => setSelectedResourceCat(null)}><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm">{iconInfo.icon}</span>
          <span className={`text-sm font-medium ${tc.text}`}>{cat?.name}</span>
          <span className={`text-xs ${tc.textMuted}`}>({prompts.length})</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 gap-1.5">
              {prompts.map(rp => (
                <div key={rp.id} className={`rounded-md overflow-hidden cursor-pointer ${isMonochrome ? 'bg-gray-50 border border-gray-200 hover:border-blue-300' : 'bg-[#1a1a1a] border border-[#333] hover:border-[#d4af37]/50'}`} onClick={() => insertResourcePrompt(rp)}>
                  <div className={`w-full h-16 overflow-hidden ${isMonochrome ? 'bg-gray-100' : 'bg-[#222]'}`}>
                    {rp.previewImage ? <img src={getImgUrl(rp.previewImage)} referrerPolicy="no-referrer" crossOrigin="anonymous" alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div className="w-full h-full flex items-center justify-center text-xl">{iconInfo.icon}</div>}
                  </div>
                  <div className="px-1.5 py-1"><div className={`text-xs truncate ${tc.text}`}>{rp.name}</div></div>
                </div>
              ))}
            </div>
          ) : (
            prompts.map(rp => renderResourcePromptItem(rp))
          )}
        </div>
      </div>
    );
  };

  // ===== Preview Modal =====
  const renderPreviewModal = () => {
    if (!previewPrompt) return null;
    const isResource = 'categoryId' in previewPrompt;
    const rp = previewPrompt as ResourcePrompt;
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setPreviewPrompt(null)}>
        <div className={`rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto ${isMonochrome ? 'bg-white' : 'bg-[#1a1a1a] border border-[#333]'}`} onClick={(e) => e.stopPropagation()} onWheel={handleWheelStop}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${tc.border}`}>
            <span className={`text-sm font-semibold ${tc.text}`}>{rp.name || (previewPrompt as PromptItem).text.substring(0, 30)}</span>
            <button className={`p-1 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-[#333] text-[#888]'}`} onClick={() => setPreviewPrompt(null)}><X className="w-4 h-4" /></button>
          </div>
          <div className="p-4 space-y-3">
            {isResource && rp.previewImage && (
              <div className={`w-full h-48 rounded-lg overflow-hidden ${isMonochrome ? 'bg-gray-100' : 'bg-[#222]'}`}>
                <img src={getImgUrl(rp.previewImage)} referrerPolicy="no-referrer" crossOrigin="anonymous" alt={rp.name} className="w-full h-full object-cover" />
              </div>
            )}
            <div>
              <div className={`text-xs font-medium mb-1 ${tc.textSec}`}>提示词内容</div>
              <div className={`text-sm leading-relaxed p-3 rounded-lg whitespace-pre-wrap ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-100' : 'bg-[#0d0d0d] text-[#ccc] border border-[#222]'}`}>
                {rp.content || (previewPrompt as PromptItem).text}
              </div>
            </div>
            {isResource && rp.contentEn && (
              <div>
                <div className={`text-xs font-medium mb-1 ${tc.textSec}`}>English</div>
                <div className={`text-sm leading-relaxed p-3 rounded-lg whitespace-pre-wrap ${isMonochrome ? 'bg-gray-50 text-gray-600 border border-gray-100' : 'bg-[#0d0d0d] text-[#999] border border-[#222]'}`}>{rp.contentEn}</div>
              </div>
            )}
            <div className="flex gap-2">
              <button className={`flex-1 py-2 rounded-lg text-xs font-medium ${tc.accentBg} ${tc.accentTextOn}`} onClick={() => { onInsertPrompt(rp.content || (previewPrompt as PromptItem).text); setPreviewPrompt(null); }}>插入到输入框</button>
              <button className={`px-4 py-2 rounded-lg text-xs font-medium ${isMonochrome ? 'bg-gray-200 text-gray-700' : 'bg-[#333] text-[#ccc]'}`} onClick={() => { copyPrompt(rp.content || (previewPrompt as PromptItem).text); setPreviewPrompt(null); }}>复制</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ===== Content rendering =====
  const renderContent = () => (
    <>
      {/* Resource Library Tab */}
      {activeTab === 'resource' && (
        <div className="flex flex-col h-full">
          {selectedResourceCat ? renderExpandedResourceCat() : resourceLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className={`w-5 h-5 animate-spin ${tc.accent}`} />
              <span className={`ml-2 text-xs ${tc.textMuted}`}>加载资源库...</span>
            </div>
          ) : filteredResourcePrompts ? (
            <div className="p-2">
              <div className={`mb-2 px-2 py-1 text-xs ${tc.textSec}`}>搜索结果: {filteredResourcePrompts.length} 条</div>
              {filteredResourcePrompts.slice(0, 50).map(rp => renderResourcePromptItem(rp))}
              {filteredResourcePrompts.length > 50 && (<div className={`text-xs text-center py-2 ${tc.textMuted}`}>仅显示前50条，请缩小搜索范围</div>)}
            </div>
          ) : (
            <div className="p-2">
              {/* Random prompt */}
              {randomPrompt && (
                <div className={`mb-2 p-2.5 rounded-lg border ${isMonochrome ? 'bg-blue-50 border-blue-200' : 'bg-[#d4af37]/5 border-[#d4af37]/20'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Shuffle className={`w-3 h-3 ${tc.accentText}`} />
                    <span className={`text-xs font-medium ${tc.accentText}`}>随机推荐</span>
                    <button className={`ml-auto p-0.5 ${tc.textMuted} hover:opacity-70`} onClick={pickRandom}><RefreshCw className="w-3 h-3" /></button>
                  </div>
                  <div className={`text-xs mb-1 font-medium ${tc.text}`}>{randomPrompt.name}</div>
                  <div className={`text-xs ${tc.textSec}`}>{randomPrompt.content?.substring(0, 100)}...</div>
                  <button className={`mt-1.5 text-xs px-2 py-0.5 rounded ${tc.accentBg} ${tc.accentTextOn}`} onClick={() => { insertResourcePrompt(randomPrompt); setRandomPrompt(null); }}>插入</button>
                </div>
              )}
              {/* View mode + random button */}
              <div className={`flex items-center justify-between mb-2 px-2 py-1 text-xs ${tc.textSec}`}>
                <span>精选提示词资源库，点击即可插入</span>
                <div className="flex items-center gap-1">
                  <button className={`p-1 rounded ${viewMode === 'list' ? (isMonochrome ? 'bg-blue-100 text-blue-600' : 'bg-[#d4af37]/20 text-[#d4af37]') : tc.textMuted}`} onClick={() => setViewMode('list')} title="列表"><FileText className="w-3 h-3" /></button>
                  <button className={`p-1 rounded ${viewMode === 'grid' ? (isMonochrome ? 'bg-blue-100 text-blue-600' : 'bg-[#d4af37]/20 text-[#d4af37]') : tc.textMuted}`} onClick={() => setViewMode('grid')} title="网格"><Image className="w-3 h-3" /></button>
                  <button className={`p-1 rounded ${tc.textMuted} hover:${tc.accentText.replace('text-', 'text-')}`} onClick={pickRandom} title="随机推荐"><Shuffle className="w-3 h-3" /></button>
                </div>
              </div>
              {resourceCategories.map(cat => renderResourceCategory(cat))}
            </div>
          )}
        </div>
      )}

      {/* Insert / My Prompts Tab */}
      {activeTab === 'insert' && (
        <div className="p-2">
          {/* Favorites section */}
          {(settings.favorites || []).length > 0 && !searchQuery && (
            <div className="mb-3">
              <div className={`flex items-center gap-1.5 px-2 py-1 text-xs uppercase tracking-wider ${tc.textSec}`}>
                <Star className="w-3 h-3 text-amber-500" /> 收藏夹 ({(settings.favorites || []).length})
              </div>
              {(settings.favorites || []).slice(0, 8).map(p => renderPromptItem(p, '__fav__', 0, true))}
            </div>
          )}
          {/* Recent */}
          {settings.recentUsed.length > 0 && !searchQuery && (
            <div className="mb-3">
              <div className={`flex items-center gap-1.5 px-2 py-1 text-xs uppercase tracking-wider ${tc.textSec}`}>
                <Clock className="w-3 h-3" /> 最近使用
              </div>
              {settings.recentUsed.slice(0, 8).map(p => renderPromptItem(p, '__recent__', 0, true))}
            </div>
          )}
          {/* Usage stats */}
          {settings.recentUsed.length > 0 && !searchQuery && (
            <div className="mb-3">
              <div className={`flex items-center gap-1.5 px-2 py-1 text-xs uppercase tracking-wider ${tc.textSec}`}>
                <BarChart3 className="w-3 h-3" /> 高频使用
              </div>
              {[...settings.recentUsed].sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).filter(p => (p.useCount || 0) > 0).slice(0, 5).map(p => renderPromptItem(p, '__stats__', 0, true))}
            </div>
          )}
          {/* User Categories */}
          {filteredCategories.length > 0 ? filteredCategories.map(c => renderCategory(c, false)) : !searchQuery && (
            <div className="text-center py-6">
              <Bookmark className={`w-8 h-8 mx-auto mb-2 ${tc.textMuted}`} />
              <p className={`text-xs ${tc.textSec}`}>还没有提示词</p>
              <p className={`text-xs ${tc.textMuted}`}>切换到「管理」添加</p>
            </div>
          )}
        </div>
      )}

      {/* Manage Tab */}
      {activeTab === 'manage' && (
        <div className="p-2">
          <button className={`w-full flex items-center justify-center gap-1.5 py-2 mb-3 text-xs rounded-md transition-colors ${tc.accentBgLight} ${tc.accentText} hover:opacity-80`} onClick={addCategory}>
            <FolderPlus className="w-3.5 h-3.5" /> 新建分类
          </button>
          {/* Import/Export */}
          <div className={`flex gap-2 mb-3`}>
            <button className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-md ${isMonochrome ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-[#1a1a1a] text-[#888] hover:bg-[#222]'}`} onClick={handleExport}>
              <Download className="w-3 h-3" /> 导出
            </button>
            <button className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-md ${isMonochrome ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-[#1a1a1a] text-[#888] hover:bg-[#222]'}`} onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-3 h-3" /> 导入
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          </div>
          {filteredCategories.map(c => renderCategory(c, false))}
          {filteredCategories.length === 0 && (<div className="text-center py-6"><p className={`text-xs ${tc.textSec}`}>点击上方按钮创建分类</p></div>)}
        </div>
      )}

      {/* Vision Tab */}
      {activeTab === 'vision' && (
        <div>
          {isVisionAnalyzing ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className={`w-8 h-8 animate-spin ${tc.accent}`} />
              <div className="text-center">
                <p className={`text-sm font-medium ${tc.text}`}>正在分析图片...</p>
                <p className={`text-xs mt-1 ${tc.textSec}`}>生成双语结构化提示词</p>
              </div>
            </div>
          ) : renderVisionResult()}
        </div>
      )}

      {/* Agent Tab */}
      {activeTab === 'agent' && (
        <div className="flex flex-col h-full">
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Bot className={`w-4 h-4 ${tc.accent}`} />
              <span className={`text-sm font-semibold ${tc.text}`}>AI 提示词增强</span>
            </div>
            <p className={`text-xs leading-relaxed ${tc.textSec}`}>
              输入简短描述，AI 自动扩展为专业级的图像生成提示词，包含主体、风格、光影、色彩、构图等维度。
            </p>
            <textarea
              className={`w-full h-24 text-xs p-2.5 rounded-lg resize-none outline-none ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-200 focus:border-blue-300' : 'bg-[#1a1a1a] text-[#ccc] border border-[#333] focus:border-[#d4af37]/50'}`}
              placeholder="描述你想要的画面，例如：一个赛博朋克风格的未来城市..."
              value={agentInput}
              onChange={(e) => setAgentInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAgentGenerate(); }}
            />
            <button
              className={`w-full py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${agentGenerating ? (isMonochrome ? 'bg-blue-300 text-white' : 'bg-[#d4af37]/50 text-black') : (isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#e5c147]')}`}
              onClick={handleAgentGenerate}
              disabled={agentGenerating || !agentInput.trim()}
            >
              {agentGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {agentGenerating ? '增强中...' : 'AI 增强'}
            </button>
            {agentError && (
              <div className={`text-xs p-2 rounded-lg ${isMonochrome ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-red-900/20 text-red-400 border border-red-800/30'}`}>{agentError}</div>
            )}
            {agentResult && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${tc.textSec}`}>增强结果</span>
                  <div className="flex items-center gap-1">
                    <button className={`p-1 rounded text-xs ${isMonochrome ? 'hover:bg-gray-200 text-gray-400' : 'hover:bg-[#333] text-[#888]'}`} onClick={() => copyPrompt(agentResult.prompt)} title="复制"><Copy className="w-3 h-3" /></button>
                    <button className={`p-1.5 rounded text-xs font-medium ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'}`} onClick={() => onInsertPrompt(agentResult.prompt)}>插入</button>
                  </div>
                </div>
                <div className={`text-xs leading-relaxed p-2.5 rounded-lg whitespace-pre-wrap ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-100' : 'bg-[#1a1a1a] text-[#ccc] border border-[#222]'}`}>
                  {agentResult.prompt}
                </div>
                {agentResult.sections && Object.keys(agentResult.sections).length > 0 && (
                  <div className={`p-2 rounded-lg space-y-1 ${isMonochrome ? 'bg-gray-50 border border-gray-100' : 'bg-[#1a1a1a] border border-[#222]'}`}>
                    {Object.entries(agentResult.sections).map(([key, value]) => {
                      if (!value) return null;
                      const labelMap: Record<string, string> = { subject: '主体', style: '风格', lighting: '光影', colors: '色彩', composition: '构图', materials: '材质', mood: '氛围', negativePrompt: '排除' };
                      return (
                        <div key={key} className="flex items-start gap-2 text-xs">
                          <span className={`font-medium min-w-[32px] ${tc.accent}`}>{labelMap[key] || key}</span>
                          <span className={tc.text}>{value}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ecommerce Tab */}
      {activeTab === 'ecommerce' && (
        <div className="flex flex-col h-full">
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingBag className={`w-4 h-4 ${tc.accent}`} />
              <span className={`text-sm font-semibold ${tc.text}`}>电商套图生成</span>
            </div>
            <p className={`text-xs leading-relaxed ${tc.textSec}`}>
              一键生成电商产品套图提示词，覆盖主图、场景图、细节图、卖点图等。
            </p>
            {/* Product description input */}
            <textarea
              className={`w-full h-20 text-xs p-2.5 rounded-lg resize-none outline-none ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-200 focus:border-blue-300' : 'bg-[#1a1a1a] text-[#ccc] border border-[#333] focus:border-[#d4af37]/50'}`}
              placeholder="描述商品，例如：一款白色蓝牙耳机，简约设计..."
              value={agentInput}
              onChange={(e) => setAgentInput(e.target.value)}
            />
            {/* Selling points */}
            <textarea
              className={`w-full h-14 text-xs p-2.5 rounded-lg resize-none outline-none ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-200 focus:border-blue-300' : 'bg-[#1a1a1a] text-[#ccc] border border-[#333] focus:border-[#d4af37]/50'}`}
              placeholder="核心卖点（可选），例如：降噪、长续航、轻便"
              value={ecomSellingPoints}
              onChange={(e) => setEcomSellingPoints(e.target.value)}
            />
            {/* Config grid */}
            <div className="grid grid-cols-2 gap-2">
              {/* Platform */}
              <div>
                <div className={`text-xs mb-1 ${tc.textSec}`}>平台</div>
                <select className={`w-full text-xs p-1.5 rounded-lg outline-none ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-200' : 'bg-[#1a1a1a] text-[#ccc] border border-[#333]'}`} value={ecomPlatform} onChange={(e) => setEcomPlatform(e.target.value as EcommercePlatform)}>
                  <option value="taobao">淘宝</option>
                  <option value="jd">京东</option>
                  <option value="pinduoduo">拼多多</option>
                  <option value="amazon">Amazon</option>
                  <option value="temu">Temu</option>
                  <option value="shein">SHEIN</option>
                </select>
              </div>
              {/* Market */}
              <div>
                <div className={`text-xs mb-1 ${tc.textSec}`}>市场</div>
                <select className={`w-full text-xs p-1.5 rounded-lg outline-none ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-200' : 'bg-[#1a1a1a] text-[#ccc] border border-[#333]'}`} value={ecomMarket} onChange={(e) => setEcomMarket(e.target.value as EcommerceMarket)}>
                  <option value="china">中国</option>
                  <option value="usa">美国</option>
                  <option value="europe">欧洲</option>
                  <option value="japan">日本</option>
                  <option value="southeast_asia">东南亚</option>
                </select>
              </div>
              {/* Language */}
              <div>
                <div className={`text-xs mb-1 ${tc.textSec}`}>语言</div>
                <select className={`w-full text-xs p-1.5 rounded-lg outline-none ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-200' : 'bg-[#1a1a1a] text-[#ccc] border border-[#333]'}`} value={ecomLanguage} onChange={(e) => setEcomLanguage(e.target.value as EcommerceLanguage)}>
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                </select>
              </div>
              {/* Aspect Ratio */}
              <div>
                <div className={`text-xs mb-1 ${tc.textSec}`}>比例</div>
                <select className={`w-full text-xs p-1.5 rounded-lg outline-none ${isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-200' : 'bg-[#1a1a1a] text-[#ccc] border border-[#333]'}`} value={ecomAspectRatio} onChange={(e) => setEcomAspectRatio(e.target.value as EcommerceAspectRatio)}>
                  <option value="1:1">1:1</option>
                  <option value="4:3">4:3</option>
                  <option value="3:4">3:4</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
            </div>
            {/* Generate button */}
            <button
              className={`w-full py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${ecomGenerating ? (isMonochrome ? 'bg-blue-300 text-white' : 'bg-[#d4af37]/50 text-black') : (isMonochrome ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-[#d4af37] text-black hover:bg-[#e5c147]')}`}
              onClick={handleEcommerceGenerate}
              disabled={ecomGenerating || !agentInput.trim()}
            >
              {ecomGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LayoutGrid className="w-3.5 h-3.5" />}
              {ecomGenerating ? '生成套图中...' : '生成套图'}
            </button>
            {ecomError && (
              <div className={`text-xs p-2 rounded-lg ${isMonochrome ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-red-900/20 text-red-400 border border-red-800/30'}`}>{ecomError}</div>
            )}
            {/* Results */}
            {ecomResult && ecomResult.length > 0 && (
              <div className="space-y-2">
                <div className={`text-xs font-medium ${tc.textSec}`}>套图提示词 ({ecomResult.length} 张)</div>
                {ecomResult.map((item, idx) => (
                  <div key={idx} className={`p-2.5 rounded-lg ${isMonochrome ? 'bg-gray-50 border border-gray-100' : 'bg-[#1a1a1a] border border-[#222]'}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-medium ${tc.accent}`}>{item.type}</span>
                        <span className={`text-xs ${tc.textMuted}`}>{item.typeEn}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#333] text-[#888]'}`}>{item.aspectRatio}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400' : 'hover:bg-[#333] text-[#888]'}`} onClick={() => copyPrompt(item.prompt)} title="复制"><Copy className="w-3 h-3" /></button>
                        <button className={`p-1 rounded text-xs font-medium ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'}`} onClick={() => onInsertPrompt(item.prompt)}>插入</button>
                      </div>
                    </div>
                    <div className={`text-xs leading-relaxed ${tc.textSec}`}>{item.prompt}</div>
                    {item.details && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {Object.entries(item.details).map(([k, v]) => v ? (
                          <span key={k} className={`text-xs px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-[#333] text-[#aaa]'}`}>{v}</span>
                        ) : null)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );

  // ===== Floating mode rendering =====
  if (floating) {
    return (
      <>
        <div
          className="fixed z-[200] flex flex-col shadow-2xl rounded-xl overflow-hidden"
          style={{
            left: floatWin.pos.x,
            top: floatWin.pos.y,
            width: floatWin.size.w,
            height: floatWin.size.h,
            background: isMonochrome ? '#fff' : '#0d0d0d',
            border: isMonochrome ? '1px solid #e5e5e5' : '1px solid #2a2a2a',
          }}
          onWheel={handleWheelStop}
        >
          {/* Draggable title bar */}
          <div
            className={`flex items-center gap-2 px-4 py-2.5 border-b select-none cursor-move ${isMonochrome ? 'border-gray-200' : 'border-[#2a2a2a]'}`}
            onMouseDown={floatWin.onDragStart}
          >
            <Sparkles className={`w-4 h-4 ${tc.accentText}`} />
            <span className={`text-sm font-semibold ${tc.accentText}`}>灵感提示词库</span>
            <span className={`text-xs ${tc.textMuted}`}>v3.0</span>
            <div className="flex-1" />
            <button className={`p-1 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400' : 'hover:bg-[#333] text-[#666]'}`} onClick={floatWin.toggleMaximize} title={floatWin.isMaximized ? '还原' : '最大化'}>
              {floatWin.isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            {onClose && (
              <button className={`p-1 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400' : 'hover:bg-[#333] text-[#666]'}`} onClick={onClose}><X className="w-3.5 h-3.5" /></button>
            )}
          </div>

          {/* Tabs */}
          <div className={`flex border-b ${tc.border}`}>
            {[
              { id: 'resource' as const, label: '资源库', icon: <Lightbulb className="w-3 h-3" /> },
              { id: 'agent' as const, label: 'AI增强', icon: <Bot className="w-3 h-3" /> },
              { id: 'ecommerce' as const, label: '电商套图', icon: <ShoppingBag className="w-3 h-3" /> },
              { id: 'insert' as const, label: '我的', icon: <Bookmark className="w-3 h-3" /> },
              { id: 'manage' as const, label: '管理', icon: <FolderPlus className="w-3 h-3" /> },
              { id: 'vision' as const, label: '识词', icon: <Eye className="w-3 h-3" /> },
            ].map(tab => (
              <button key={tab.id} className={`flex-1 flex items-center justify-center gap-0.5 py-2 text-xs transition-colors ${activeTab === tab.id ? isMonochrome ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50/50' : 'text-[#d4af37] border-b-2 border-[#d4af37] bg-[#d4af37]/5' : isMonochrome ? 'text-gray-500 hover:text-gray-700' : 'text-[#888] hover:text-[#ccc]'}`} onClick={() => setActiveTab(tab.id)}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          {!['vision', 'agent', 'ecommerce'].includes(activeTab) && (
            <div className={`px-3 py-2 border-b ${tc.border}`}>
              <div className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 ${tc.bgInput}`}>
                <Search className={`w-3 h-3 ${tc.textMuted}`} />
                <input className={`flex-1 bg-transparent text-xs outline-none ${tc.text} placeholder:${tc.textMuted}`} placeholder="搜索提示词..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                {searchQuery && (<button onClick={() => setSearchQuery('')}><X className={`w-3 h-3 ${tc.textMuted}`} /></button>)}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar" onWheel={handleWheelStop}>
            {renderContent()}
          </div>

          {/* Footer */}
          <div className={`px-3 py-1.5 border-t text-xs text-center ${tc.border} ${tc.textMuted}`}>
            点击提示词 → 插入 | AI增强 / 电商套图 / 识词
          </div>

          {/* Resize handle */}
          {!floatWin.isMaximized && (
            <div
              className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize z-10 flex items-end justify-end pr-0.5 pb-0.5"
              onMouseDown={floatWin.onResizeStart}
            >
              <GripVertical className={`w-3 h-3 rotate-[135deg] ${tc.textMuted}`} />
            </div>
          )}
        </div>
        {renderPreviewModal()}
      </>
    );
  }

  // ===== Embedded / inline mode rendering =====
  return (
    <div ref={panelRef} className={embedded ? 'flex flex-col overflow-hidden' : `w-80 h-full flex flex-col overflow-hidden ${tc.bg} border-l ${tc.border}`} onWheel={handleWheelStop}>
      {!embedded && (
        <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${tc.border}`}>
          <Sparkles className={`w-4 h-4 ${tc.accentText}`} />
          <span className={`text-sm font-semibold ${tc.accentText}`}>灵感提示词库</span>
          <span className={`text-xs ${tc.textMuted}`}>v2.0</span>
        </div>
      )}
      <div className={`flex border-b ${tc.border}`}>
        {[
          { id: 'resource' as const, label: '资源库', icon: <Lightbulb className="w-3 h-3" /> },
          { id: 'agent' as const, label: 'AI增强', icon: <Bot className="w-3 h-3" /> },
          { id: 'ecommerce' as const, label: '电商套图', icon: <ShoppingBag className="w-3 h-3" /> },
          { id: 'insert' as const, label: '我的', icon: <Bookmark className="w-3 h-3" /> },
          { id: 'manage' as const, label: '管理', icon: <FolderPlus className="w-3 h-3" /> },
          { id: 'vision' as const, label: '识词', icon: <Eye className="w-3 h-3" /> },
        ].map(tab => (
          <button key={tab.id} className={`flex-1 flex items-center justify-center gap-0.5 py-2 text-xs transition-colors ${activeTab === tab.id ? isMonochrome ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50/50' : 'text-[#d4af37] border-b-2 border-[#d4af37] bg-[#d4af37]/5' : isMonochrome ? 'text-gray-500 hover:text-gray-700' : 'text-[#888] hover:text-[#ccc]'}`} onClick={() => setActiveTab(tab.id)}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>
      {!['vision', 'agent', 'ecommerce'].includes(activeTab) && (
        <div className={`px-3 py-2 border-b ${tc.border}`}>
          <div className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 ${tc.bgInput}`}>
            <Search className={`w-3 h-3 ${tc.textMuted}`} />
            <input className={`flex-1 bg-transparent text-xs outline-none ${tc.text} placeholder:${tc.textMuted}`} placeholder="搜索提示词..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            {searchQuery && (<button onClick={() => setSearchQuery('')}><X className={`w-3 h-3 ${tc.textMuted}`} /></button>)}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto custom-scrollbar" onWheel={handleWheelStop}>
        {renderContent()}
      </div>
      <div className={`px-3 py-1.5 border-t text-xs text-center ${tc.border} ${tc.textMuted}`}>
        点击提示词 → 插入 | 悬停图片 ✨ → 识词 | 资源库 {resourceCategories.length} 类
      </div>
      {renderPreviewModal()}
    </div>
  );
}
