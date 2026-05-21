'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Sparkles, FolderPlus, Trash2, Edit3, Check, X,
  ChevronRight, ChevronDown, Plus, Search, Lightbulb,
  GripVertical, Copy, ExternalLink, Eye, Languages,
  Tag, Image, FileText, Loader2, ChevronLeft, RefreshCw,
  Bookmark, BookmarkCheck, ArrowRight, Zap
} from 'lucide-react';

// ===== Types (aligned with oh-my-prompt repository) =====
export interface PromptItem {
  id: string;
  text: string;
  textEn?: string;
  tag?: string;
  pinned?: boolean;
  createdAt: number;
}

export interface PromptCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  expanded: boolean;
  prompts: PromptItem[];
}

// Resource library types (from oh-my-prompt repo)
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

// Vision API result types (from oh-my-prompt repo)
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
  zh: {
    title: string;
    prompt: string;
    analysis: string;
  };
  en: {
    title: string;
    prompt: string;
    analysis: string;
  };
  zh_style_tags: string[];
  en_style_tags: string[];
  zh_json?: ZhJsonPromptSchema;
  en_json?: JsonPromptSchema;
  json_prompt: JsonPromptSchema;
  confidence: number;
}

export interface OmpSettings {
  enabled: boolean;
  categories: PromptCategory[];
  recentUsed: PromptItem[];
  visionDefaultFormat: 'natural' | 'json';
  savedVisionResults: VisionApiResultData[];
}

const STORAGE_KEY = 'oh-my-prompt-data-v2';

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

function loadSettings(): OmpSettings {
  if (typeof window === 'undefined') return { enabled: false, categories: [], recentUsed: [], visionDefaultFormat: 'natural', savedVisionResults: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: false,
        categories: [],
        recentUsed: [],
        visionDefaultFormat: 'natural',
        savedVisionResults: [],
        ...parsed,
      };
    }
    // Try to migrate from v1 storage
    const v1Raw = localStorage.getItem('oh-my-prompt-data');
    if (v1Raw) {
      const v1 = JSON.parse(v1Raw);
      const migrated: OmpSettings = {
        enabled: v1.enabled || false,
        categories: v1.categories || [],
        recentUsed: v1.recentUsed || [],
        visionDefaultFormat: 'natural',
        savedVisionResults: [],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {}
  return { enabled: false, categories: [], recentUsed: [], visionDefaultFormat: 'natural', savedVisionResults: [] };
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
    const indexRes = await fetch('/data/omp-resources/index.json');
    if (!indexRes.ok) throw new Error('Failed to load resource index');
    const index = await indexRes.json();

    const categories: ResourceCategory[] = (index.categories || []).map((cat: ResourceCategory) => ({
      id: cat.id,
      name: cat.name,
      nameEn: cat.nameEn,
      order: cat.order,
      count: cat.count,
    }));

    // Load all category files
    const promptsMap = new Map<string, ResourcePrompt[]>();
    const categoryFiles: string[] = index.categoryFiles || [];

    // Load categories in parallel batches
    const batchSize = 5;
    for (let i = 0; i < categoryFiles.length; i += batchSize) {
      const batch = categoryFiles.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (catId) => {
          const res = await fetch(`/data/omp-resources/categories/${catId}.json`);
          if (!res.ok) return null;
          const data = await res.json();
          return { catId, prompts: data.prompts || [] };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          promptsMap.set(result.value.catId, result.value.prompts);
        }
      }
    }

    resourceDataCache = { categories, prompts: promptsMap };
    return resourceDataCache;
  } catch (err) {
    console.error('[Oh My Prompt] Failed to load resource data:', err);
    return { categories: [], prompts: new Map() };
  }
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
}

export default function OhMyPrompt({ onInsertPrompt, onVisionPrompt, isVisionAnalyzing, isOpen, onClose, themeStyle, embedded = false, visionResult }: OhMyPromptProps) {
  const [settings, setSettings] = useState<OmpSettings>(loadSettings);
  const [activeTab, setActiveTab] = useState<'insert' | 'manage' | 'resource' | 'vision'>('resource');
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saveSettings(settings); }, [settings]);

  // Load resource data on mount
  useEffect(() => {
    let mounted = true;
    loadResourceData().then(({ categories, prompts }) => {
      if (mounted) {
        setResourceCategories(categories);
        setResourcePrompts(prompts);
        setResourceLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  const isMonochrome = themeStyle === 'monochrome';

  // ===== Category Management =====
  const addCategory = useCallback(() => {
    const cat: PromptCategory = {
      id: genId(),
      name: '新分类',
      icon: '📁',
      color: isMonochrome ? '#3b82f6' : '#d4af37',
      expanded: true,
      prompts: [],
    };
    setSettings(prev => ({ ...prev, categories: [...prev.categories, cat] }));
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
  }, [isMonochrome]);

  const deleteCategory = useCallback((catId: string) => {
    setSettings(prev => ({
      ...prev,
      categories: prev.categories.filter(c => c.id !== catId),
    }));
  }, []);

  const renameCategory = useCallback((catId: string, newName: string) => {
    setSettings(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === catId ? { ...c, name: newName } : c),
    }));
    setEditingCatId(null);
  }, []);

  const toggleCategory = useCallback((catId: string) => {
    const isBuiltin = catId.startsWith('builtin-');
    if (isBuiltin) {
      setBuiltinExpandedIds(prev => {
        const next = new Set(prev);
        if (next.has(catId)) next.delete(catId); else next.add(catId);
        return next;
      });
    } else {
      setSettings(prev => ({
        ...prev,
        categories: prev.categories.map(c => c.id === catId ? { ...c, expanded: !c.expanded } : c),
      }));
    }
  }, []);

  // ===== Prompt Management =====
  const addPrompt = useCallback((catId: string, text: string, textEn?: string) => {
    const prompt: PromptItem = { id: genId(), text, textEn, createdAt: Date.now() };
    setSettings(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === catId ? { ...c, prompts: [...c.prompts, prompt] } : c),
    }));
    setNewPromptText('');
    setNewPromptTextEn('');
    setAddingToCatId(null);
  }, []);

  const deletePrompt = useCallback((catId: string, promptId: string) => {
    setSettings(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === catId ? { ...c, prompts: c.prompts.filter(p => p.id !== promptId) } : c),
      recentUsed: prev.recentUsed.filter(p => p.id !== promptId),
    }));
  }, []);

  const insertPrompt = useCallback((prompt: PromptItem) => {
    onInsertPrompt(prompt.text);
    setSettings(prev => ({
      ...prev,
      recentUsed: [prompt, ...prev.recentUsed.filter(p => p.id !== prompt.id)].slice(0, 20),
    }));
  }, [onInsertPrompt]);

  const insertResourcePrompt = useCallback((rp: ResourcePrompt) => {
    const text = rp.content || rp.name;
    onInsertPrompt(text);
    // Also add to recent
    const prompt: PromptItem = { id: rp.id, text, textEn: rp.contentEn || rp.nameEn, tag: rp.sourceCategory, createdAt: Date.now() };
    setSettings(prev => ({
      ...prev,
      recentUsed: [prompt, ...prev.recentUsed.filter(p => p.id !== prompt.id)].slice(0, 20),
    }));
  }, [onInsertPrompt]);

  const copyPrompt = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  // ===== Drag & Drop =====
  const handleDragStart = useCallback((catId: string, promptId: string) => {
    setDragItem({ catId, promptId });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

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

  // ===== Search =====
  const filteredCategories = searchQuery
    ? settings.categories.map(c => ({
        ...c,
        expanded: true,
        prompts: c.prompts.filter(p =>
          p.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (p.textEn && p.textEn.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (p.tag && p.tag.toLowerCase().includes(searchQuery.toLowerCase()))
        ),
      })).filter(c => c.prompts.length > 0)
    : settings.categories;

  // Search across resource library
  const filteredResourcePrompts = useMemo(() => {
    if (!searchQuery || activeTab !== 'resource') return null;
    const results: ResourcePrompt[] = [];
    const query = searchQuery.toLowerCase();
    for (const [, prompts] of resourcePrompts) {
      for (const p of prompts) {
        if (
          (p.name && p.name.toLowerCase().includes(query)) ||
          (p.nameEn && p.nameEn.toLowerCase().includes(query)) ||
          (p.content && p.content.toLowerCase().includes(query)) ||
          (p.sourceCategory && p.sourceCategory.toLowerCase().includes(query))
        ) {
          results.push(p);
        }
      }
    }
    return results;
  }, [searchQuery, resourcePrompts, activeTab]);

  // ===== Vision result rendering =====
  const renderVisionResult = () => {
    if (!visionResult) {
      return (
        <div className="p-4 flex flex-col items-center justify-center gap-3 min-h-[200px]">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isMonochrome ? 'bg-blue-500/10' : 'bg-[#d4af37]/10'}`}>
            <Eye className={`w-8 h-8 ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`} />
          </div>
          <div className="text-center">
            <p className={`text-sm font-medium mb-1 ${isMonochrome ? 'text-gray-800' : 'text-[#ccc]'}`}>图片识词</p>
            <p className={`text-xs leading-relaxed ${isMonochrome ? 'text-gray-500' : 'text-[#666]'}`}>
              悬停画布上的图片，点击 ✨ 按钮<br />
              自动生成双语结构化提示词<br />
              支持自然语言 / JSON 两种格式
            </p>
          </div>
          {onVisionPrompt && (
            <button
              onClick={() => {
                // Could trigger canvas-level image selection
              }}
              className={`mt-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isMonochrome
                  ? 'bg-blue-500/20 border border-blue-500/40 text-blue-600 hover:bg-blue-500/30'
                  : 'bg-[#d4af37]/20 border border-[#d4af37]/40 text-[#d4af37] hover:bg-[#d4af37]/30'
              }`}
            >
              选择画布图片识别
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="p-3 space-y-3">
        {/* Title and confidence */}
        <div className="flex items-center justify-between">
          <h4 className={`text-sm font-semibold ${isMonochrome ? 'text-gray-800' : 'text-[#d4af37]'}`}>
            {visionResult.zh.title || visionResult.en.title}
          </h4>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            visionResult.confidence >= 0.8
              ? isMonochrome ? 'bg-green-100 text-green-700' : 'bg-green-900/30 text-green-400'
              : visionResult.confidence >= 0.5
                ? isMonochrome ? 'bg-yellow-100 text-yellow-700' : 'bg-yellow-900/30 text-yellow-400'
                : isMonochrome ? 'bg-red-100 text-red-700' : 'bg-red-900/30 text-red-400'
          }`}>
            置信度 {Math.round(visionResult.confidence * 100)}%
          </span>
        </div>

        {/* Style Tags */}
        {(visionResult.zh_style_tags?.length > 0 || visionResult.en_style_tags?.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {visionResult.zh_style_tags?.map((tag, i) => (
              <span key={`zh-${i}`} className={`text-xs px-1.5 py-0.5 rounded-full ${
                isMonochrome ? 'bg-blue-100 text-blue-700' : 'bg-[#d4af37]/15 text-[#d4af37]'
              }`}>{tag}</span>
            ))}
            {visionResult.en_style_tags?.map((tag, i) => (
              <span key={`en-${i}`} className={`text-xs px-1.5 py-0.5 rounded-full ${
                isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-[#333] text-[#999]'
              }`}>{tag}</span>
            ))}
          </div>
        )}

        {/* Format Toggle */}
        <div className={`flex rounded-md overflow-hidden ${isMonochrome ? 'border border-gray-200' : 'border border-[#333]'}`}>
          <button
            className={`flex-1 px-3 py-1 text-xs font-medium transition-colors ${
              visionFormat === 'natural'
                ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
                : isMonochrome ? 'bg-gray-50 text-gray-600' : 'bg-[#1a1a1a] text-[#888]'
            }`}
            onClick={() => setVisionFormat('natural')}
          >
            <FileText className="w-3 h-3 inline mr-1" />自然语言
          </button>
          <button
            className={`flex-1 px-3 py-1 text-xs font-medium transition-colors ${
              visionFormat === 'json'
                ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
                : isMonochrome ? 'bg-gray-50 text-gray-600' : 'bg-[#1a1a1a] text-[#888]'
            }`}
            onClick={() => setVisionFormat('json')}
          >
            <Zap className="w-3 h-3 inline mr-1" />结构化
          </button>
        </div>

        {/* Content */}
        {visionFormat === 'natural' ? (
          <div className="space-y-2">
            {/* Chinese prompt */}
            {visionResult.zh.prompt && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Languages className={`w-3 h-3 ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`} />
                  <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>中文提示词</span>
                  <button className={`ml-auto p-0.5 rounded hover:${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} onClick={() => copyPrompt(visionResult.zh.prompt)}>
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                <div className={`text-xs leading-relaxed p-2 rounded-md ${
                  isMonochrome ? 'bg-gray-50 text-gray-700 border border-gray-100' : 'bg-[#1a1a1a] text-[#ccc] border border-[#222]'
                }`}>
                  {visionResult.zh.prompt}
                </div>
              </div>
            )}
            {/* English prompt */}
            {visionResult.en.prompt && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Languages className={`w-3 h-3 ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`} />
                  <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>英文提示词</span>
                  <button className={`ml-auto p-0.5 rounded hover:${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} onClick={() => copyPrompt(visionResult.en.prompt)}>
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                <div className={`text-xs leading-relaxed p-2 rounded-md ${
                  isMonochrome ? 'bg-gray-50 text-gray-700 border border-gray-100' : 'bg-[#1a1a1a] text-[#ccc] border border-[#222]'
                }`}>
                  {visionResult.en.prompt}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {/* JSON structured view */}
            {visionResult.zh_json && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>中文结构化</span>
                  <button className={`ml-auto p-0.5 rounded hover:${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} onClick={() => copyPrompt(JSON.stringify(visionResult.zh_json, null, 2))}>
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                {renderJsonFields(visionResult.zh_json, true)}
              </div>
            )}
            {visionResult.en_json && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <span className={`text-xs font-medium ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>英文结构化</span>
                  <button className={`ml-auto p-0.5 rounded hover:${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} onClick={() => copyPrompt(JSON.stringify(visionResult.en_json, null, 2))}>
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                {renderJsonFields(visionResult.en_json, false)}
              </div>
            )}
          </div>
        )}

        {/* Insert buttons */}
        <div className="flex gap-2">
          {visionResult.zh.prompt && (
            <button
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isMonochrome
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-[#d4af37] text-black hover:bg-[#e5c147]'
              }`}
              onClick={() => onInsertPrompt(visionResult.zh.prompt!)}
            >
              插入中文
            </button>
          )}
          {visionResult.en.prompt && (
            <button
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isMonochrome
                  ? 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                  : 'bg-[#333] text-[#ccc] hover:bg-[#444]'
              }`}
              onClick={() => onInsertPrompt(visionResult.en.prompt!)}
            >
              插入英文
            </button>
          )}
        </div>
      </div>
    );
  };

  // Render JSON fields in a key-value grid
  const renderJsonFields = (data: Record<string, unknown>, isChinese: boolean) => {
    return (
      <div className={`space-y-1 p-2 rounded-md text-xs ${
        isMonochrome ? 'bg-gray-50 border border-gray-100' : 'bg-[#1a1a1a] border border-[#222]'
      }`}>
        {Object.entries(data).map(([key, value]) => {
          if (Array.isArray(value)) {
            return (
              <div key={key} className="flex items-start gap-2">
                <span className={`font-medium min-w-[60px] ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'}`}>{key}</span>
                <div className="flex flex-wrap gap-1">
                  {value.map((item: string, i: number) => (
                    <span key={i} className={`px-1.5 py-0.5 rounded ${
                      isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-[#333] text-[#ccc]'
                    }`}>{item}</span>
                  ))}
                </div>
              </div>
            );
          }
          if (typeof value === 'object' && value !== null) {
            return (
              <div key={key} className="flex items-start gap-2">
                <span className={`font-medium min-w-[60px] ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'}`}>{key}</span>
                <span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{JSON.stringify(value)}</span>
              </div>
            );
          }
          return (
            <div key={key} className="flex items-start gap-2">
              <span className={`font-medium min-w-[60px] ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'}`}>{key}</span>
              <span className={isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}>{String(value)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // ===== Render Prompt Item =====
  const renderPromptItem = (prompt: PromptItem, catId: string, idx: number, isBuiltIn: boolean) => (
    <div
      key={prompt.id}
      draggable={!isBuiltIn}
      onDragStart={() => handleDragStart(catId, prompt.id)}
      onDragOver={handleDragOver}
      onDrop={(e) => handleDrop(e, catId, idx)}
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors cursor-pointer ${
        isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#1a1a1a]'
      }`}
      onClick={() => insertPrompt(prompt)}
    >
      {!isBuiltIn && (
        <GripVertical className={`w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ${isMonochrome ? 'text-gray-400' : 'text-[#555]'}`} />
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-xs truncate ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>{prompt.text}</div>
        {prompt.textEn && (
          <div className={`text-xs truncate ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{prompt.textEn}</div>
        )}
      </div>
      {prompt.tag && (
        <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${
          isMonochrome ? 'bg-blue-100 text-blue-700' : 'bg-[#d4af37]/15 text-[#d4af37]'
        }`}>{prompt.tag}</span>
      )}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400 hover:text-blue-500' : 'hover:bg-[#333] text-[#888] hover:text-[#d4af37]'}`}
          onClick={(e) => { e.stopPropagation(); copyPrompt(prompt.text); }}
          title="复制"
        >
          <Copy className="w-3 h-3" />
        </button>
        {!isBuiltIn && (
          <button
            className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400 hover:text-red-500' : 'hover:bg-[#333] text-[#888] hover:text-red-400'}`}
            onClick={(e) => { e.stopPropagation(); deletePrompt(catId, prompt.id); }}
            title="删除"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );

  // ===== Render Resource Prompt Item =====
  const renderResourcePromptItem = (rp: ResourcePrompt) => (
    <div
      key={rp.id}
      className={`group flex items-start gap-2 px-2 py-2 rounded-md transition-colors cursor-pointer ${
        isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#1a1a1a]'
      }`}
      onClick={() => insertResourcePrompt(rp)}
    >
      {rp.previewImage && (
        <div className={`w-10 h-10 rounded flex-shrink-0 overflow-hidden ${isMonochrome ? 'bg-gray-100' : 'bg-[#222]'}`}>
          <img
            src={rp.previewImage}
            alt={rp.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium truncate ${isMonochrome ? 'text-gray-800' : 'text-[#ccc]'}`}>
          {rp.name}
          {rp.nameEn && <span className={`ml-1 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>/ {rp.nameEn}</span>}
        </div>
        <div className={`text-xs truncate mt-0.5 ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>
          {rp.content?.substring(0, 60)}...
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {rp.sourceCategory && (
            <span className={`text-xs px-1 py-0 rounded ${
              isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/10 text-[#d4af37]'
            }`}>{rp.sourceCategory}</span>
          )}
          {rp.author && (
            <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#555]'}`}>by {rp.author}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1">
        <button
          className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-400 hover:text-blue-500' : 'hover:bg-[#333] text-[#888] hover:text-[#d4af37]'}`}
          onClick={(e) => { e.stopPropagation(); copyPrompt(rp.content); }}
          title="复制"
        >
          <Copy className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  // ===== Render Category =====
  const renderCategory = (cat: PromptCategory, isBuiltIn: boolean) => (
    <div key={cat.id} className="mb-1">
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer group ${
          isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#1a1a1a]'
        }`}
        onClick={() => toggleCategory(cat.id)}
      >
        <span className="text-sm">{cat.icon}</span>
        {editingCatId === cat.id ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              className={`flex-1 text-xs px-1.5 py-0.5 rounded outline-none ${
                isMonochrome ? 'bg-gray-100 text-gray-800 border border-blue-300' : 'bg-[#1a1a1a] text-[#ccc] border border-[#d4af37]/50'
              }`}
              value={editingCatName}
              onChange={(e) => setEditingCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') renameCategory(cat.id, editingCatName); if (e.key === 'Escape') setEditingCatId(null); }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
            <button className="p-0.5 text-green-400" onClick={(e) => { e.stopPropagation(); renameCategory(cat.id, editingCatName); }}>
              <Check className="w-3 h-3" />
            </button>
            <button className="p-0.5 text-red-400" onClick={(e) => { e.stopPropagation(); setEditingCatId(null); }}>
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <>
            <span className={`text-xs font-medium flex-1 ${isMonochrome ? 'text-gray-800' : 'text-[#ccc]'}`}>{cat.name}</span>
            <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{cat.prompts.length}</span>
            {!isBuiltIn && (
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                <button className={`p-0.5 ${isMonochrome ? 'text-gray-400 hover:text-blue-500' : 'text-[#888] hover:text-[#d4af37]'}`} onClick={(e) => { e.stopPropagation(); setEditingCatId(cat.id); setEditingCatName(cat.name); }} title="重命名">
                  <Edit3 className="w-3 h-3" />
                </button>
                <button className={`p-0.5 ${isMonochrome ? 'text-gray-400 hover:text-red-500' : 'text-[#888] hover:text-red-400'}`} onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id); }} title="删除">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </>
        )}
        {cat.expanded ? <ChevronDown className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`} /> : <ChevronRight className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`} />}
      </div>
      {cat.expanded && (
        <div className={`ml-4 ${isMonochrome ? 'border-l border-gray-200' : 'border-l border-[#222]'}`}>
          {cat.prompts.map((p, idx) => renderPromptItem(p, cat.id, idx, isBuiltIn))}
          {!isBuiltIn && (
            addingToCatId === cat.id ? (
              <div className="px-2 py-1.5 space-y-1">
                <input
                  className={`w-full text-xs px-2 py-1 rounded outline-none ${
                    isMonochrome ? 'bg-gray-50 text-gray-800 border border-gray-200 focus:border-blue-300' : 'bg-[#1a1a1a] text-[#ccc] border border-[#333] focus:border-[#d4af37]/50'
                  }`}
                  placeholder="中文提示词..."
                  value={newPromptText}
                  onChange={(e) => setNewPromptText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newPromptText.trim()) addPrompt(cat.id, newPromptText.trim(), newPromptTextEn.trim() || undefined); }}
                  autoFocus
                />
                <input
                  className={`w-full text-xs px-2 py-1 rounded outline-none ${
                    isMonochrome ? 'bg-gray-50 text-gray-500 border border-gray-200 focus:border-blue-300' : 'bg-[#1a1a1a] text-[#888] border border-[#333] focus:border-[#d4af37]/50'
                  }`}
                  placeholder="英文补充（可选）..."
                  value={newPromptTextEn}
                  onChange={(e) => setNewPromptTextEn(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newPromptText.trim()) addPrompt(cat.id, newPromptText.trim(), newPromptTextEn.trim() || undefined); }}
                />
                <div className="flex gap-1">
                  <button className={`px-2 py-0.5 text-xs rounded ${
                    isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
                  }`} onClick={() => { if (newPromptText.trim()) addPrompt(cat.id, newPromptText.trim(), newPromptTextEn.trim() || undefined); }}>保存</button>
                  <button className={`px-2 py-0.5 text-xs rounded ${
                    isMonochrome ? 'bg-gray-200 text-gray-600' : 'bg-[#333] text-[#ccc]'
                  }`} onClick={() => { setAddingToCatId(null); setNewPromptText(''); setNewPromptTextEn(''); }}>取消</button>
                </div>
              </div>
            ) : (
              <button
                className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                  isMonochrome ? 'text-gray-400 hover:text-blue-500' : 'text-[#888] hover:text-[#d4af37]'
                }`}
                onClick={() => setAddingToCatId(cat.id)}
              >
                <Plus className="w-3 h-3" /> 添加提示词
              </button>
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
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer group ${
            isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#1a1a1a]'
          }`}
          onClick={() => {
            setExpandedResourceCats(prev => {
              const next = new Set(prev);
              if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
              return next;
            });
          }}
        >
          <span className="text-sm">{iconInfo.icon}</span>
          <span className={`text-xs font-medium flex-1 ${isMonochrome ? 'text-gray-800' : 'text-[#ccc]'}`}>{cat.name}</span>
          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>{cat.count || prompts.length}</span>
          {isExpanded ? <ChevronDown className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`} /> : <ChevronRight className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`} />}
        </div>
        {isExpanded && (
          <div className={`ml-4 ${isMonochrome ? 'border-l border-gray-200' : 'border-l border-[#222]'}`}>
            {prompts.slice(0, 10).map(rp => renderResourcePromptItem(rp))}
            {prompts.length > 10 && (
              <button
                className={`flex items-center gap-1 px-2 py-1 text-xs w-full text-left transition-colors ${
                  isMonochrome ? 'text-blue-500 hover:text-blue-600' : 'text-[#d4af37] hover:text-[#e5c147]'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedResourceCat(cat.id);
                }}
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
        <div className={`flex items-center gap-2 px-3 py-2 border-b ${isMonochrome ? 'border-gray-200' : 'border-[#222]'}`}>
          <button
            className={`p-1 rounded ${isMonochrome ? 'hover:bg-gray-200 text-gray-600' : 'hover:bg-[#333] text-[#888]'}`}
            onClick={() => setSelectedResourceCat(null)}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm">{iconInfo.icon}</span>
          <span className={`text-sm font-medium ${isMonochrome ? 'text-gray-800' : 'text-[#ccc]'}`}>{cat?.name}</span>
          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>({prompts.length})</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {prompts.map(rp => renderResourcePromptItem(rp))}
        </div>
      </div>
    );
  };

  return (
    <div ref={panelRef} className={embedded ? 'flex flex-col overflow-hidden' : `w-80 h-full flex flex-col overflow-hidden ${isMonochrome ? 'bg-white border-l border-gray-200' : 'bg-[#0d0d0d] border-l border-[#222]'}`}>
      {/* Header - hidden in embedded mode since parent provides one */}
      {!embedded && (
        <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${isMonochrome ? 'border-gray-200' : 'border-[#222]'}`}>
          <Sparkles className={`w-4 h-4 ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`} />
          <span className={`text-sm font-semibold ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'}`}>灵感提示词库</span>
          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`}>v2.0</span>
        </div>
      )}

      {/* Tabs */}
      <div className={`flex border-b ${isMonochrome ? 'border-gray-200' : 'border-[#222]'}`}>
        {[
          { id: 'resource' as const, label: '资源库', icon: <Lightbulb className="w-3 h-3" /> },
          { id: 'insert' as const, label: '我的', icon: <Bookmark className="w-3 h-3" /> },
          { id: 'manage' as const, label: '管理', icon: <FolderPlus className="w-3 h-3" /> },
          { id: 'vision' as const, label: '图片识词', icon: <Eye className="w-3 h-3" /> },
        ].map(tab => (
          <button
            key={tab.id}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition-colors ${
              activeTab === tab.id
                ? isMonochrome ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50/50' : 'text-[#d4af37] border-b-2 border-[#d4af37] bg-[#d4af37]/5'
                : isMonochrome ? 'text-gray-500 hover:text-gray-700' : 'text-[#888] hover:text-[#ccc]'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {activeTab !== 'vision' && (
        <div className={`px-3 py-2 border-b ${isMonochrome ? 'border-gray-200' : 'border-[#222]'}`}>
          <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${isMonochrome ? 'bg-gray-50' : 'bg-[#1a1a1a]'}`}>
            <Search className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-[#666]'}`} />
            <input
              className={`flex-1 bg-transparent text-xs outline-none ${isMonochrome ? 'text-gray-800 placeholder:text-gray-400' : 'text-[#ccc] placeholder:text-[#555]'}`}
              placeholder="搜索提示词..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}>
                <X className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-[#555]'}`} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Resource Library Tab */}
        {activeTab === 'resource' && (
          <div className="flex flex-col h-full">
            {selectedResourceCat ? (
              renderExpandedResourceCat()
            ) : resourceLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className={`w-5 h-5 animate-spin ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`} />
                <span className={`ml-2 text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#666]'}`}>加载资源库...</span>
              </div>
            ) : filteredResourcePrompts ? (
              <div className="p-2">
                <div className={`mb-2 px-2 py-1 text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>
                  搜索结果: {filteredResourcePrompts.length} 条
                </div>
                {filteredResourcePrompts.slice(0, 50).map(rp => renderResourcePromptItem(rp))}
                {filteredResourcePrompts.length > 50 && (
                  <div className={`text-xs text-center py-2 ${isMonochrome ? 'text-gray-400' : 'text-[#555]'}`}>
                    仅显示前50条，请缩小搜索范围
                  </div>
                )}
              </div>
            ) : (
              <div className="p-2">
                <div className={`mb-2 px-2 py-1 text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#888]'}`}>
                  精选提示词资源库，点击即可插入
                </div>
                {resourceCategories.map(cat => renderResourceCategory(cat))}
              </div>
            )}
          </div>
        )}

        {/* Insert / My Prompts Tab */}
        {activeTab === 'insert' && (
          <div className="p-2">
            {/* Recent */}
            {settings.recentUsed.length > 0 && !searchQuery && (
              <div className="mb-3">
                <div className={`flex items-center gap-1.5 px-2 py-1 text-xs uppercase tracking-wider ${isMonochrome ? 'text-gray-400' : 'text-[#888]'}`}>
                  <span>🕐</span> 最近使用
                </div>
                {settings.recentUsed.slice(0, 8).map(p => renderPromptItem(p, '__recent__', 0, true))}
              </div>
            )}

            {/* User Categories */}
            {filteredCategories.length > 0 ? (
              filteredCategories.map(c => renderCategory(c, false))
            ) : (
              !searchQuery && (
                <div className="text-center py-6">
                  <Bookmark className={`w-8 h-8 mx-auto mb-2 ${isMonochrome ? 'text-gray-300' : 'text-[#333]'}`} />
                  <p className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#666]'}`}>还没有提示词</p>
                  <p className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#555]'}`}>切换到「管理」添加</p>
                </div>
              )
            )}
          </div>
        )}

        {/* Manage Tab */}
        {activeTab === 'manage' && (
          <div className="p-2">
            <button
              className={`w-full flex items-center justify-center gap-1.5 py-2 mb-3 text-xs rounded-md transition-colors ${
                isMonochrome
                  ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                  : 'text-[#d4af37] bg-[#d4af37]/10 hover:bg-[#d4af37]/20'
              }`}
              onClick={addCategory}
            >
              <FolderPlus className="w-3.5 h-3.5" /> 新建分类
            </button>
            {filteredCategories.map(c => renderCategory(c, false))}
            {filteredCategories.length === 0 && (
              <div className="text-center py-6">
                <p className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-[#666]'}`}>点击上方按钮创建分类</p>
              </div>
            )}
          </div>
        )}

        {/* Vision / Image-to-Prompt Tab */}
        {activeTab === 'vision' && (
          <div>
            {isVisionAnalyzing ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className={`w-8 h-8 animate-spin ${isMonochrome ? 'text-blue-500' : 'text-[#d4af37]'}`} />
                <div className="text-center">
                  <p className={`text-sm font-medium ${isMonochrome ? 'text-gray-800' : 'text-[#ccc]'}`}>正在分析图片...</p>
                  <p className={`text-xs mt-1 ${isMonochrome ? 'text-gray-500' : 'text-[#666]'}`}>生成双语结构化提示词</p>
                </div>
              </div>
            ) : (
              renderVisionResult()
            )}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className={`px-3 py-1.5 border-t text-xs text-center ${isMonochrome ? 'border-gray-200 text-gray-400' : 'border-[#222] text-[#555]'}`}>
        点击提示词 → 插入 | 悬停图片 ✨ → 识词 | 资源库 {resourceCategories.length} 类
      </div>
    </div>
  );
}
