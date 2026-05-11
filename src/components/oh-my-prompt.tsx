'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles, FolderPlus, Trash2, Edit3, Check, X,
  ChevronRight, ChevronDown, Plus, Search, Lightbulb,
  GripVertical, Copy, ExternalLink
} from 'lucide-react';

// ===== Types =====
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

export interface OmpSettings {
  enabled: boolean;
  categories: PromptCategory[];
  recentUsed: PromptItem[];
}

const STORAGE_KEY = 'oh-my-prompt-data';

// ===== Built-in Resource Library =====
const BUILT_IN_CATEGORIES: PromptCategory[] = [
  {
    id: 'builtin-style',
    name: '风格预设',
    icon: '🎨',
    color: '#d4af37',
    expanded: false,
    prompts: [
      { id: 'b1', text: '赛博朋克风格，霓虹灯光，未来科技感，黑暗城市背景', textEn: 'Cyberpunk style, neon lights, futuristic tech, dark city background', tag: '赛博朋克', createdAt: Date.now() },
      { id: 'b2', text: '水彩插画风格，柔和渐变，纸张纹理，艺术感', textEn: 'Watercolor illustration, soft gradients, paper texture, artistic', tag: '水彩', createdAt: Date.now() },
      { id: 'b3', text: '极简主义风格，大量留白，简洁线条，现代设计', textEn: 'Minimalist style, lots of whitespace, clean lines, modern design', tag: '极简', createdAt: Date.now() },
      { id: 'b4', text: '复古怀旧风格，胶片质感，褪色色调，老照片效果', textEn: 'Vintage retro, film grain, faded tones, old photo effect', tag: '复古', createdAt: Date.now() },
      { id: 'b5', text: '超写实摄影，8K分辨率，专业灯光，微距细节', textEn: 'Hyper-realistic photography, 8K resolution, professional lighting, macro details', tag: '写实', createdAt: Date.now() },
      { id: 'b6', text: '扁平化设计，鲜艳色彩，几何形状，矢量插画', textEn: 'Flat design, vivid colors, geometric shapes, vector illustration', tag: '扁平', createdAt: Date.now() },
      { id: 'b7', text: '蒸汽朋克风格，黄铜机械，维多利亚时代，齿轮装置', textEn: 'Steampunk style, brass machinery, Victorian era, gear mechanisms', tag: '蒸汽朋克', createdAt: Date.now() },
      { id: 'b8', text: '日式动漫风格，柔和色调，大眼睛，精致线条', textEn: 'Japanese anime style, soft colors, big eyes, delicate linework', tag: '动漫', createdAt: Date.now() },
    ]
  },
  {
    id: 'builtin-lighting',
    name: '灯光系统',
    icon: '💡',
    color: '#fbbf24',
    expanded: false,
    prompts: [
      { id: 'bl1', text: '电影级灯光，戏剧化阴影，侧逆光勾勒轮廓', textEn: 'Cinematic lighting, dramatic shadows, rim lighting on contours', tag: '电影灯光', createdAt: Date.now() },
      { id: 'bl2', text: '柔和自然光，黄金时刻，温暖色调', textEn: 'Soft natural light, golden hour, warm tones', tag: '自然光', createdAt: Date.now() },
      { id: 'bl3', text: '体积光，丁达尔效应，光束穿透', textEn: 'Volumetric light, Tyndall effect, light shafts piercing through', tag: '体积光', createdAt: Date.now() },
      { id: 'bl4', text: '霓虹灯光，彩色反射，雨夜氛围', textEn: 'Neon lighting, colorful reflections, rainy night atmosphere', tag: '霓虹', createdAt: Date.now() },
      { id: 'bl5', text: '影棚布光，三点布光，白色背景', textEn: 'Studio lighting, three-point setup, white background', tag: '影棚', createdAt: Date.now() },
      { id: 'bl6', text: '月光照明，冷蓝色调，神秘氛围', textEn: 'Moonlight, cool blue tones, mysterious atmosphere', tag: '月光', createdAt: Date.now() },
    ]
  },
  {
    id: 'builtin-quality',
    name: '画质增强',
    icon: '✨',
    color: '#34d399',
    expanded: false,
    prompts: [
      { id: 'bq1', text: '8K超高清，极致细节，专业摄影级别', textEn: '8K ultra HD, extreme detail, professional photography grade', tag: '8K', createdAt: Date.now() },
      { id: 'bq2', text: '4K高清，锐利细节，清晰纹理', textEn: '4K HD, sharp details, clear textures', tag: '4K', createdAt: Date.now() },
      { id: 'bq3', text: '景深效果，虚化背景，焦点清晰', textEn: 'Depth of field, blurred background, sharp focus', tag: '景深', createdAt: Date.now() },
      { id: 'bq4', text: 'HDR效果，高动态范围，明暗细节丰富', textEn: 'HDR effect, high dynamic range, rich highlight and shadow details', tag: 'HDR', createdAt: Date.now() },
      { id: 'bq5', text: '微距摄影，超近距，极致细节纹理', textEn: 'Macro photography, ultra close-up, extreme texture detail', tag: '微距', createdAt: Date.now() },
    ]
  },
  {
    id: 'builtin-scene',
    name: '场景模板',
    icon: '🏗️',
    color: '#60a5fa',
    expanded: false,
    prompts: [
      { id: 'bs1', text: '展览展位设计，专业建筑摄影，模块化结构', textEn: 'Exhibition booth design, professional architectural photography, modular structures', tag: '展览', createdAt: Date.now() },
      { id: 'bs2', text: '室内设计，现代极简空间，自然光线', textEn: 'Interior design, modern minimalist space, natural light', tag: '室内', createdAt: Date.now() },
      { id: 'bs3', text: '产品摄影，纯色背景，商业广告级', textEn: 'Product photography, solid color background, commercial ad grade', tag: '产品', createdAt: Date.now() },
      { id: 'bs4', text: '城市景观，高楼大厦，日落时分', textEn: 'Cityscape, skyscrapers, sunset', tag: '城市', createdAt: Date.now() },
      { id: 'bs5', text: '自然风景，山脉湖泊，晨雾弥漫', textEn: 'Natural landscape, mountains and lakes, morning mist', tag: '风景', createdAt: Date.now() },
      { id: 'bs6', text: '人物肖像，柔和焦外，专业棚拍', textEn: 'Portrait photography, soft bokeh, professional studio shot', tag: '人像', createdAt: Date.now() },
    ]
  },
  {
    id: 'builtin-material',
    name: '材质质感',
    icon: '💎',
    color: '#a78bfa',
    expanded: false,
    prompts: [
      { id: 'bm1', text: '金属拉丝质感，反射光泽，冷色调', textEn: 'Brushed metal texture, reflective gloss, cool tones', tag: '金属', createdAt: Date.now() },
      { id: 'bm2', text: '大理石纹理，天然纹路，奢华质感', textEn: 'Marble texture, natural veins, luxurious feel', tag: '大理石', createdAt: Date.now() },
      { id: 'bm3', text: '原木质感，温暖色调，自然纹理', textEn: 'Natural wood texture, warm tones, organic grain', tag: '木材', createdAt: Date.now() },
      { id: 'bm4', text: '玻璃材质，透明折射，光影变幻', textEn: 'Glass material, transparent refraction, light and shadow play', tag: '玻璃', createdAt: Date.now() },
      { id: 'bm5', text: '丝绸质感，柔滑光泽，飘逸流动', textEn: 'Silk texture, smooth luster, flowing and draping', tag: '丝绸', createdAt: Date.now() },
    ]
  }
];

// ===== Helper =====
function genId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

function loadSettings(): OmpSettings {
  if (typeof window === 'undefined') return { enabled: false, categories: [], recentUsed: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: false, categories: [], recentUsed: [] };
}

function saveSettings(s: OmpSettings): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
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
}

export default function OhMyPrompt({ onInsertPrompt, onVisionPrompt, isVisionAnalyzing, isOpen, onClose, themeStyle, embedded = false }: OhMyPromptProps) {
  const [settings, setSettings] = useState<OmpSettings>(loadSettings);
  const [activeTab, setActiveTab] = useState<'insert' | 'manage' | 'resource' | 'vision'>('insert');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [newPromptText, setNewPromptText] = useState('');
  const [newPromptTextEn, setNewPromptTextEn] = useState('');
  const [addingToCatId, setAddingToCatId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<{ catId: string; promptId: string } | null>(null);
  const [builtinExpandedIds, setBuiltinExpandedIds] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saveSettings(settings); }, [settings]);

  // ===== Category Management =====
  const addCategory = useCallback(() => {
    const cat: PromptCategory = {
      id: genId(),
      name: '新分类',
      icon: '📁',
      color: '#d4af37',
      expanded: true,
      prompts: [],
    };
    setSettings(prev => ({ ...prev, categories: [...prev.categories, cat] }));
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
  }, []);

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
    // Check if it's a builtin category
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
    // Add to recent
    setSettings(prev => ({
      ...prev,
      recentUsed: [prompt, ...prev.recentUsed.filter(p => p.id !== prompt.id)].slice(0, 20),
    }));
  }, [onInsertPrompt]);

  const copyPrompt = useCallback((prompt: PromptItem) => {
    navigator.clipboard.writeText(prompt.text).catch(() => {});
  }, []);

  // ===== Drag & Drop =====
  const handleDragStart = useCallback((catId: string, promptId: string) => {
    setDragItem({ catId, promptId });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetCatId: string, targetPromptId?: string) => {
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

  const filteredBuiltIn = searchQuery
    ? BUILT_IN_CATEGORIES.map(c => ({
        ...c,
        expanded: true,
        prompts: c.prompts.filter(p =>
          p.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (p.textEn && p.textEn.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (p.tag && p.tag.toLowerCase().includes(searchQuery.toLowerCase()))
        ),
      })).filter(c => c.prompts.length > 0)
    : BUILT_IN_CATEGORIES.map(c => ({
        ...c,
        expanded: builtinExpandedIds.has(c.id),
      }));

  // ===== Render =====
  const renderPromptItem = (prompt: PromptItem, catId: string, idx: number, isBuiltIn: boolean) => (
    <div
      key={prompt.id}
      draggable={!isBuiltIn}
      onDragStart={() => handleDragStart(catId, prompt.id)}
      onDragOver={(e) => handleDragOver(e, catId)}
      onDrop={(e) => handleDrop(e, catId, idx)}
      className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-[#1a1a1a] transition-colors cursor-pointer"
      onClick={() => insertPrompt(prompt)}
    >
      {!isBuiltIn && (
        <GripVertical className="w-3 h-3 text-[#555] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[#ccc] truncate">{prompt.text}</div>
      </div>
      {prompt.tag && (
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-[#d4af37]/15 text-[#d4af37] flex-shrink-0">{prompt.tag}</span>
      )}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          className="p-0.5 rounded hover:bg-[#333] text-[#888] hover:text-[#d4af37]"
          onClick={(e) => { e.stopPropagation(); copyPrompt(prompt); }}
          title="复制"
        >
          <Copy className="w-3 h-3" />
        </button>
        {!isBuiltIn && (
          <button
            className="p-0.5 rounded hover:bg-[#333] text-[#888] hover:text-red-400"
            onClick={(e) => { e.stopPropagation(); deletePrompt(catId, prompt.id); }}
            title="删除"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );

  const renderCategory = (cat: PromptCategory, isBuiltIn: boolean) => (
    <div key={cat.id} className="mb-1">
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[#1a1a1a] cursor-pointer group"
        onClick={() => toggleCategory(cat.id)}
      >
        <span className="text-sm">{cat.icon}</span>
        {editingCatId === cat.id ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              className="flex-1 bg-[#1a1a1a] text-xs text-[#ccc] px-1.5 py-0.5 rounded border border-[#d4af37]/50 outline-none"
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
            <span className="text-xs font-medium text-[#ccc] flex-1">{cat.name}</span>
            <span className="text-xs text-[#666]">{cat.prompts.length}</span>
            {!isBuiltIn && (
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                <button className="p-0.5 text-[#888] hover:text-[#d4af37]" onClick={(e) => { e.stopPropagation(); setEditingCatId(cat.id); setEditingCatName(cat.name); }} title="重命名">
                  <Edit3 className="w-3 h-3" />
                </button>
                <button className="p-0.5 text-[#888] hover:text-red-400" onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id); }} title="删除">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </>
        )}
        {cat.expanded ? <ChevronDown className="w-3 h-3 text-[#666]" /> : <ChevronRight className="w-3 h-3 text-[#666]" />}
      </div>
      {cat.expanded && (
        <div className="ml-4 border-l border-[#222]">
          {cat.prompts.map((p, idx) => renderPromptItem(p, cat.id, idx, isBuiltIn))}
          {!isBuiltIn && (
            addingToCatId === cat.id ? (
              <div className="px-2 py-1.5 space-y-1">
                <input
                  className="w-full bg-[#1a1a1a] text-xs text-[#ccc] px-2 py-1 rounded border border-[#333] outline-none focus:border-[#d4af37]/50"
                  placeholder="中文提示词..."
                  value={newPromptText}
                  onChange={(e) => setNewPromptText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newPromptText.trim()) addPrompt(cat.id, newPromptText.trim(), newPromptTextEn.trim() || undefined); }}
                  autoFocus
                />
                <input
                  className="w-full bg-[#1a1a1a] text-xs text-[#888] px-2 py-1 rounded border border-[#333] outline-none focus:border-[#d4af37]/50"
                  placeholder="英文补充（可选）..."
                  value={newPromptTextEn}
                  onChange={(e) => setNewPromptTextEn(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newPromptText.trim()) addPrompt(cat.id, newPromptText.trim(), newPromptTextEn.trim() || undefined); }}
                />
                <div className="flex gap-1">
                  <button className="px-2 py-0.5 text-xs bg-[#d4af37] text-black rounded" onClick={() => { if (newPromptText.trim()) addPrompt(cat.id, newPromptText.trim(), newPromptTextEn.trim() || undefined); }}>保存</button>
                  <button className="px-2 py-0.5 text-xs bg-[#333] text-[#ccc] rounded" onClick={() => { setAddingToCatId(null); setNewPromptText(''); setNewPromptTextEn(''); }}>取消</button>
                </div>
              </div>
            ) : (
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs text-[#888] hover:text-[#d4af37] transition-colors"
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

  return (
    <div ref={panelRef} className={embedded ? 'flex flex-col overflow-hidden' : 'w-72 h-full bg-[#0d0d0d] border-l border-[#222] flex flex-col overflow-hidden'}>
      {/* Header - hidden in embedded mode since parent provides one */}
      {!embedded && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#222]">
          <Sparkles className="w-4 h-4 text-[#d4af37]" />
          <span className="text-sm font-semibold text-[#d4af37]">灵感提示词库</span>
          <span className="text-xs text-[#666]">v1.3</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[#222]">
        {[
          { id: 'insert' as const, label: '一键插入', icon: <ExternalLink className="w-3 h-3" /> },
          { id: 'manage' as const, label: '分类管理', icon: <FolderPlus className="w-3 h-3" /> },
          { id: 'resource' as const, label: '资源库', icon: <Lightbulb className="w-3 h-3" /> },
          { id: 'vision' as const, label: '图片识词', icon: <Sparkles className="w-3 h-3" /> },
        ].map(tab => (
          <button
            key={tab.id}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition-colors ${
              activeTab === tab.id ? 'text-[#d4af37] border-b-2 border-[#d4af37] bg-[#d4af37]/5' : 'text-[#888] hover:text-[#ccc]'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {activeTab !== 'vision' && (
        <div className="px-3 py-2 border-b border-[#222]">
          <div className="flex items-center gap-1.5 bg-[#1a1a1a] rounded-md px-2 py-1">
            <Search className="w-3 h-3 text-[#666]" />
            <input
              className="flex-1 bg-transparent text-xs text-[#ccc] outline-none placeholder:text-[#555]"
              placeholder="搜索提示词..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Insert Tab */}
        {activeTab === 'insert' && (
          <div className="p-2">
            {/* Recent */}
            {settings.recentUsed.length > 0 && !searchQuery && (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-[#888] uppercase tracking-wider">
                  <span>🕐</span> 最近使用
                </div>
                {settings.recentUsed.slice(0, 5).map(p => renderPromptItem(p, '__recent__', 0, true))}
              </div>
            )}

            {/* User Categories */}
            {filteredCategories.length > 0 ? (
              filteredCategories.map(c => renderCategory(c, false))
            ) : (
              !searchQuery && (
                <div className="text-center py-6">
                  <Lightbulb className="w-8 h-8 text-[#333] mx-auto mb-2" />
                  <p className="text-xs text-[#666]">还没有提示词</p>
                  <p className="text-xs text-[#555]">切换到「分类管理」添加</p>
                </div>
              )
            )}
          </div>
        )}

        {/* Manage Tab */}
        {activeTab === 'manage' && (
          <div className="p-2">
            <button
              className="w-full flex items-center justify-center gap-1.5 py-2 mb-3 text-xs text-[#d4af37] bg-[#d4af37]/10 rounded-md hover:bg-[#d4af37]/20 transition-colors"
              onClick={addCategory}
            >
              <FolderPlus className="w-3.5 h-3.5" /> 新建分类
            </button>
            {filteredCategories.map(c => renderCategory(c, false))}
            {filteredCategories.length === 0 && (
              <div className="text-center py-6">
                <p className="text-xs text-[#666]">点击上方按钮创建分类</p>
              </div>
            )}
          </div>
        )}

        {/* Resource Library */}
        {activeTab === 'resource' && (
          <div className="p-2">
            <div className="mb-2 px-2 py-1 text-xs text-[#888]">
              内置精选提示词，点击即可插入到创意描述
            </div>
            {filteredBuiltIn.map(c => renderCategory(c, true))}
          </div>
        )}

        {/* Vision / Image-to-Prompt */}
        {activeTab === 'vision' && (
          <div className="p-4 flex flex-col items-center justify-center gap-3 min-h-[200px]">
            <div className="w-16 h-16 rounded-full bg-[#d4af37]/10 flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-[#d4af37]" />
            </div>
            <div className="text-center">
              <p className="text-sm text-[#ccc] font-medium mb-1">图片识词</p>
              <p className="text-xs text-[#666] leading-relaxed">
                开启 OMP 后，悬停画布上的图片<br />
                点击 ✨ 按钮即可自动生成双语提示词<br />
                并插入到创意描述中
              </p>
            </div>
            {onVisionPrompt && (
              <button
                onClick={() => {
                  // Prompt user to select an image on the canvas
                }}
                className="mt-2 px-4 py-1.5 rounded-lg bg-[#d4af37]/20 border border-[#d4af37]/40 text-[#d4af37] text-xs font-medium hover:bg-[#d4af37]/30 transition-colors"
              >
                选择画布图片识别
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-[#222] text-xs text-[#555] text-center">
        点击提示词 → 插入到创意描述 | 悬停画布图片 ✨ → 图片识词
      </div>
    </div>
  );
}
