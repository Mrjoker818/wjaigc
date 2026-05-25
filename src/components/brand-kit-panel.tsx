'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Palette, Plus, Trash2, Edit3, Check, X, Sparkles,
  ChevronDown, ChevronUp, Image as ImageIcon, Loader2,
  Wand2, LayoutGrid, Eye, Copy, Upload, Type,
  SwatchBook, Globe, Heart, Tag, Zap, ArrowRight
} from 'lucide-react';

// ========== Brand Kit Type ==========
interface BrandKit {
  id: string;
  name: string;
  description: string;
  logo?: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fontStyle: 'serif' | 'sans-serif' | 'display' | 'handwriting' | 'monospace';
  styleKeywords: string[];
  referenceImages: string[];
  brandDna?: string;
  industry?: string;
  mood?: string;
  createdAt: number;
  updatedAt: number;
}

interface BrandKitPanelProps {
  isGold: boolean;
  onAddImages?: (imageUrls: string[]) => void;
}

// ========== Default Colors ==========
const defaultColors = {
  primary: '#1a1a2e',
  secondary: '#16213e',
  accent: '#d4af37',
  background: '#ffffff',
  text: '#1a1a1a',
};

// ========== Scene Type Options ==========
const SCENE_TYPES = [
  { id: 'poster', name: '海报', icon: '🖼️', desc: '宣传海报' },
  { id: 'social_media', name: '社交媒体', icon: '📱', desc: '社交平台配图' },
  { id: 'business_card', name: '名片', icon: '💳', desc: '商务名片' },
  { id: 'packaging', name: '包装', icon: '📦', desc: '产品包装' },
  { id: 'banner', name: '横幅', icon: '🏴', desc: '广告横幅' },
  { id: 'logo_variation', name: 'Logo 变体', icon: '⭐', desc: 'Logo 延展' },
  { id: 'letterhead', name: '信头纸', icon: '📝', desc: '文件信头' },
  { id: 'merchandise', name: '周边商品', icon: '👕', desc: '周边设计' },
];

// ========== Section Header ==========
function SectionHeader({ icon: Icon, title, isGold, action }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  isGold: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className={`w-3.5 h-3.5 ${isGold ? 'text-[#d4af37]' : 'text-primary'}`} />
      <span className={`text-xs font-semibold tracking-wide uppercase ${isGold ? 'text-gray-400' : 'text-muted-foreground'}`}>
        {title}
      </span>
      <div className={`flex-1 h-px ${isGold ? 'bg-white/5' : 'bg-border'}`} />
      {action}
    </div>
  );
}

// ========== Color Picker Component ==========
function ColorPicker({ value, onChange, label, isGold }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  isGold: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="flex flex-col items-center gap-1.5 relative group">
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="w-10 h-10 rounded-lg border-2 transition-all duration-200 hover:scale-110 hover:shadow-lg active:scale-95"
          style={{
            backgroundColor: value,
            borderColor: isGold ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.1)',
            boxShadow: `0 2px 8px ${value}40`,
          }}
          title={label}
        />
        {open && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 p-2 rounded-lg border border-border bg-popover shadow-xl">
            <input
              type="color"
              value={value}
              onChange={e => onChange(e.target.value)}
              className="w-28 h-28 rounded cursor-pointer border-0"
              autoFocus
            />
            <div className="flex items-center gap-1 mt-2 px-1">
              <input
                type="text"
                value={value}
                onChange={e => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value)}
                className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs font-mono text-foreground text-center"
                maxLength={7}
              />
            </div>
          </div>
        )}
      </div>
      <span className={`text-[10px] ${isGold ? 'text-gray-500' : 'text-muted-foreground'} group-hover:text-foreground transition-colors`}>
        {label}
      </span>
    </div>
  );
}

// ========== Brand Kit Editor ==========
function BrandKitEditor({ kit, onSave, onCancel, isGold }: {
  kit: Partial<BrandKit>;
  onSave: (kit: Partial<BrandKit>) => void;
  onCancel: () => void;
  isGold: boolean;
}) {
  const [editKit, setEditKit] = useState<Partial<BrandKit>>(kit);
  const [keywordInput, setKeywordInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const handleAddKeyword = () => {
    if (keywordInput.trim()) {
      const newKeywords = [...(editKit.styleKeywords || []), keywordInput.trim()];
      setEditKit({ ...editKit, styleKeywords: newKeywords });
      setKeywordInput('');
    }
  };

  const handleRemoveKeyword = (idx: number) => {
    const newKeywords = (editKit.styleKeywords || []).filter((_, i) => i !== idx);
    setEditKit({ ...editKit, styleKeywords: newKeywords });
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const resp = await fetch('/api/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze', kit: editKit }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.brandDna) {
          setEditKit({ ...editKit, brandDna: data.brandDna });
        }
      }
    } catch (e) {
      console.error('Brand DNA analysis failed:', e);
    }
    setAnalyzing(false);
  };

  const bg = isGold ? 'bg-[#141414]' : 'bg-card';
  const textC = isGold ? 'text-gray-200' : 'text-foreground';
  const accentC = isGold ? 'text-[#d4af37]' : 'text-primary';
  const sectionBg = isGold ? 'bg-[#1c1c1c] hover:bg-[#222]' : 'bg-muted/40 hover:bg-muted/60';
  const inputCls = `w-full bg-muted/60 border border-border/50 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all`;

  return (
    <div className={`${bg} rounded-xl border border-border overflow-hidden`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${isGold ? 'border-white/5 bg-[#1a1a1a]' : 'border-border bg-muted/30'}`}>
        <div className="flex items-center gap-2">
          <div className={`w-1 h-4 rounded-full ${isGold ? 'bg-[#d4af37]' : 'bg-primary'}`} />
          <span className={`text-sm font-semibold ${textC}`}>
            {editKit.id ? '编辑品牌' : '创建品牌'}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* ===== Brand Info Section ===== */}
        <div>
          <SectionHeader icon={Type} title="基本信息" isGold={isGold} />
          <div className="space-y-3">
            <input
              type="text"
              value={editKit.name || ''}
              onChange={e => setEditKit({ ...editKit, name: e.target.value })}
              className={inputCls}
              placeholder="品牌名称"
            />
            <textarea
              value={editKit.description || ''}
              onChange={e => setEditKit({ ...editKit, description: e.target.value })}
              className={`${inputCls} resize-none`}
              rows={2}
              placeholder="品牌核心价值、定位和个性..."
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`text-[10px] ${isGold ? 'text-gray-500' : 'text-muted-foreground'} mb-1 block`}>行业</label>
                <select
                  value={editKit.industry || ''}
                  onChange={e => setEditKit({ ...editKit, industry: e.target.value })}
                  className={inputCls}
                >
                  <option value="">选择行业</option>
                  <option value="tech">科技</option>
                  <option value="fashion">时尚</option>
                  <option value="food">餐饮</option>
                  <option value="health">健康</option>
                  <option value="education">教育</option>
                  <option value="finance">金融</option>
                  <option value="entertainment">娱乐</option>
                  <option value="beauty">美妆</option>
                  <option value="sports">运动</option>
                  <option value="travel">旅行</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <div>
                <label className={`text-[10px] ${isGold ? 'text-gray-500' : 'text-muted-foreground'} mb-1 block`}>情绪调性</label>
                <select
                  value={editKit.mood || ''}
                  onChange={e => setEditKit({ ...editKit, mood: e.target.value })}
                  className={inputCls}
                >
                  <option value="">选择调性</option>
                  <option value="professional">专业</option>
                  <option value="playful">活泼</option>
                  <option value="luxury">奢华</option>
                  <option value="minimal">极简</option>
                  <option value="warm">温馨</option>
                  <option value="bold">大胆</option>
                  <option value="elegant">优雅</option>
                  <option value="energetic">活力</option>
                  <option value="calm">沉稳</option>
                  <option value="creative">创意</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* ===== Colors Section ===== */}
        <div>
          <SectionHeader icon={SwatchBook} title="品牌色彩" isGold={isGold} />
          <div className={`p-3 rounded-lg ${isGold ? 'bg-[#1c1c1c]' : 'bg-muted/30'}`}>
            {/* Color Preview Bar */}
            <div className="flex gap-1 mb-3 rounded-lg overflow-hidden h-6">
              {Object.entries(editKit.colors || defaultColors).map(([key, color]) => (
                <div
                  key={key}
                  className="flex-1 transition-all duration-300 hover:flex-[2]"
                  style={{ backgroundColor: color }}
                  title={`${key}: ${color}`}
                />
              ))}
            </div>
            {/* Color Pickers */}
            <div className="flex items-start justify-between px-1">
              <ColorPicker label="主色" value={editKit.colors?.primary || defaultColors.primary} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, primary: v } })} isGold={isGold} />
              <ColorPicker label="辅色" value={editKit.colors?.secondary || defaultColors.secondary} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, secondary: v } })} isGold={isGold} />
              <ColorPicker label="强调" value={editKit.colors?.accent || defaultColors.accent} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, accent: v } })} isGold={isGold} />
              <ColorPicker label="背景" value={editKit.colors?.background || defaultColors.background} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, background: v } })} isGold={isGold} />
              <ColorPicker label="文字" value={editKit.colors?.text || defaultColors.text} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, text: v } })} isGold={isGold} />
            </div>
          </div>
        </div>

        {/* ===== Font Style Section ===== */}
        <div>
          <SectionHeader icon={Type} title="字体风格" isGold={isGold} />
          <div className="grid grid-cols-5 gap-2">
            {([
              { key: 'serif' as const, label: '衬线', sample: 'Ser' },
              { key: 'sans-serif' as const, label: '无衬线', sample: 'San' },
              { key: 'display' as const, label: '展示', sample: 'Dis' },
              { key: 'handwriting' as const, label: '手写', sample: 'Han' },
              { key: 'monospace' as const, label: '等宽', sample: 'Mon' },
            ]).map(fs => (
              <button
                key={fs.key}
                onClick={() => setEditKit({ ...editKit, fontStyle: fs.key })}
                className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border transition-all duration-200 ${
                  editKit.fontStyle === fs.key
                    ? isGold ? 'border-[#d4af37]/50 bg-[#d4af37]/10 shadow-sm shadow-[#d4af37]/10' : 'border-primary/50 bg-primary/10 shadow-sm shadow-primary/10'
                    : `border-border/50 ${sectionBg}`
                }`}
              >
                <span className={`text-lg font-bold ${
                  editKit.fontStyle === fs.key
                    ? isGold ? 'text-[#d4af37]' : 'text-primary'
                    : isGold ? 'text-gray-500' : 'text-muted-foreground'
                }`} style={{ fontFamily: fs.key }}>
                  {fs.sample}
                </span>
                <span className={`text-[10px] ${
                  editKit.fontStyle === fs.key ? accentC : isGold ? 'text-gray-500' : 'text-muted-foreground'
                }`}>
                  {fs.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ===== Style Keywords Section ===== */}
        <div>
          <SectionHeader icon={Tag} title="风格关键词" isGold={isGold} />
          <div className="space-y-2.5">
            <div className="flex gap-2">
              <input
                type="text"
                value={keywordInput}
                onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddKeyword()}
                className={`${inputCls} flex-1`}
                placeholder="输入关键词，回车添加..."
              />
              <button
                onClick={handleAddKeyword}
                disabled={!keywordInput.trim()}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-30 ${
                  isGold ? 'bg-[#d4af37]/15 text-[#d4af37] hover:bg-[#d4af37]/25' : 'bg-primary/10 text-primary hover:bg-primary/20'
                }`}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {(editKit.styleKeywords || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(editKit.styleKeywords || []).map((kw, idx) => (
                  <span
                    key={idx}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 hover:scale-105 ${
                      isGold ? 'bg-[#d4af37]/12 text-[#d4af37] border border-[#d4af37]/20' : 'bg-primary/8 text-primary border border-primary/15'
                    }`}
                  >
                    {kw}
                    <button
                      onClick={() => handleRemoveKeyword(idx)}
                      className="ml-0.5 hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ===== Brand DNA Section ===== */}
        {editKit.brandDna && (
          <div>
            <SectionHeader icon={Sparkles} title="品牌 DNA" isGold={isGold} />
            <div className={`text-xs leading-relaxed ${isGold ? 'text-gray-400' : 'text-muted-foreground'} bg-muted/30 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap border border-border/30`}>
              {editKit.brandDna}
            </div>
          </div>
        )}

        {/* ===== Actions ===== */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !editKit.name}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-40 ${
              isGold ? 'bg-[#d4af37]/15 text-[#d4af37] hover:bg-[#d4af37]/25' : 'bg-primary/10 text-primary hover:bg-primary/20'
            }`}
          >
            {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {analyzing ? '分析中...' : 'AI 分析 DNA'}
          </button>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className={`px-4 py-2 rounded-lg text-xs ${isGold ? 'text-gray-500 hover:text-gray-300 hover:bg-white/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted'} transition-all duration-200`}
          >
            取消
          </button>
          <button
            onClick={() => onSave(editKit)}
            disabled={!editKit.name}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 disabled:opacity-40 ${
              isGold
                ? 'bg-[#d4af37] text-black hover:bg-[#d4af37]/85 shadow-sm shadow-[#d4af37]/20'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm shadow-primary/20'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ========== Brand Kit Card ==========
function BrandKitCard({ kit, selected, onSelect, onEdit, onDelete, onBatchGenerate, isGold }: {
  kit: BrandKit;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onBatchGenerate: () => void;
  isGold: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const accentC = isGold ? '#d4af37' : '';

  return (
    <div
      className={`rounded-xl border transition-all duration-300 overflow-hidden cursor-pointer group ${
        selected
          ? isGold ? 'border-[#d4af37]/40 bg-[#d4af37]/5 shadow-sm shadow-[#d4af37]/10' : 'border-primary/40 bg-primary/5 shadow-sm shadow-primary/10'
          : `border-border/50 ${isGold ? 'bg-[#1a1a1a] hover:border-white/10' : 'bg-card hover:border-primary/20'}`
      }`}
      onClick={onSelect}
    >
      {/* Color Strip at Top */}
      <div className="flex h-1.5">
        <div className="flex-1 transition-all duration-300" style={{ backgroundColor: kit.colors.primary }} />
        <div className="flex-1 transition-all duration-300" style={{ backgroundColor: kit.colors.secondary }} />
        <div className="flex-1 transition-all duration-300" style={{ backgroundColor: kit.colors.accent }} />
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="flex flex-col items-center">
          <div className="w-5 h-5 rounded-full border border-white/10 shadow-sm" style={{ backgroundColor: kit.colors.primary }} />
          <div className="flex gap-0.5 mt-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: kit.colors.secondary }} />
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: kit.colors.accent }} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold truncate ${isGold ? 'text-gray-200' : 'text-foreground'}`}>
            {kit.name}
          </div>
          {kit.industry && (
            <div className={`text-[10px] mt-0.5 ${isGold ? 'text-gray-600' : 'text-muted-foreground'}`}>
              {kit.industry}{kit.mood ? ` · ${kit.mood}` : ''}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={onBatchGenerate}
            className={`p-1.5 rounded-lg transition-all duration-200 ${
              isGold ? 'text-[#d4af37] hover:bg-[#d4af37]/15' : 'text-primary hover:bg-primary/10'
            }`}
            title="批量生成品牌构件"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className={`p-1.5 rounded-lg transition-all duration-200 ${isGold ? 'text-gray-600 hover:text-gray-400 hover:bg-white/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded Details */}
      <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className={`px-3.5 pb-3 border-t ${isGold ? 'border-white/5' : 'border-border'} pt-2.5 space-y-2.5`}>
          {kit.description && (
            <p className={`text-xs leading-relaxed ${isGold ? 'text-gray-500' : 'text-muted-foreground'}`}>{kit.description}</p>
          )}

          {/* Style Keywords */}
          {kit.styleKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {kit.styleKeywords.slice(0, 8).map((kw, i) => (
                <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  isGold ? 'bg-[#d4af37]/8 text-[#d4af37]/80' : 'bg-primary/5 text-primary/80'
                }`}>
                  {kw}
                </span>
              ))}
              {kit.styleKeywords.length > 8 && (
                <span className={`text-[10px] px-1.5 py-0.5 ${isGold ? 'text-gray-600' : 'text-muted-foreground'}`}>
                  +{kit.styleKeywords.length - 8}
                </span>
              )}
            </div>
          )}

          {/* Brand DNA Preview */}
          {kit.brandDna && (
            <div className={`text-[10px] leading-relaxed ${isGold ? 'text-gray-600' : 'text-muted-foreground'} bg-muted/20 rounded-lg p-2 max-h-16 overflow-y-auto whitespace-pre-wrap`}>
              <Sparkles className="w-3 h-3 inline mr-1" style={{ color: accentC }} />
              {kit.brandDna.split('\n').slice(0, 2).join('\n')}...
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-0.5">
            <button onClick={onEdit} className={`text-[10px] flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${isGold ? 'text-gray-500 hover:text-gray-300 hover:bg-white/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              <Edit3 className="w-3 h-3" /> 编辑
            </button>
            <button onClick={onDelete} className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-md text-destructive/70 hover:text-destructive hover:bg-destructive/5 transition-colors">
              <Trash2 className="w-3 h-3" /> 删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== Batch Generate Dialog ==========
function BatchGenerateDialog({ kit, isGold, onClose, onAddImages, currentImageModel }: {
  kit: BrandKit;
  isGold: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[]) => void;
  currentImageModel?: string;
}) {
  const [selectedScenes, setSelectedScenes] = useState<string[]>(['poster', 'social_media', 'banner']);
  const [count, setCount] = useState(2);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<Array<{scene: string; prompt: string; url?: string}>>([]);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [polling, setPolling] = useState(false);

  const toggleScene = (id: string) => {
    setSelectedScenes(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    if (selectedScenes.length === 0) return;
    setGenerating(true);
    setResults([]);

    try {
      const resp = await fetch('/api/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch-generate',
          kitId: kit.id,
          sceneTypes: selectedScenes,
          count,
          imageModel: currentImageModel,
          aspectRatio,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        setResults(data.prompts?.map((p: {scene: string; prompt: string}) => ({
          scene: p.scene,
          prompt: p.prompt,
        })) || []);

        if (data.taskIds?.length > 0) {
          setTaskIds(data.taskIds);
          setPolling(true);
          pollForResults(data.taskIds, data.prompts);
        } else {
          setGenerating(false);
        }
      } else {
        console.error('Batch generate failed');
        setGenerating(false);
      }
    } catch (e) {
      console.error('Batch generate error:', e);
      setGenerating(false);
    }
  };

  const pollForResults = async (tIds: string[], prompts: Array<{scene: string; prompt: string}>) => {
    const completed = new Set<string>();
    const maxAttempts = 120;
    let attempts = 0;

    const poll = async () => {
      if (completed.size >= tIds.length || attempts >= maxAttempts) {
        setGenerating(false);
        setPolling(false);
        return;
      }

      attempts++;

      for (const tid of tIds) {
        if (completed.has(tid)) continue;

        try {
          const resp = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: tid }),
          });

          if (resp.ok) {
            const data = await resp.json();
            if (data.status === 'completed' && data.result?.url) {
              completed.add(tid);
              setResults(prev => prev.map((r, i) => {
                const promptIdx = tIds.indexOf(tid);
                if (i === promptIdx) return { ...r, url: data.result.url };
                return r;
              }));
            } else if (data.status === 'failed') {
              completed.add(tid);
            }
          }
        } catch {}
      }

      if (completed.size < tIds.length) {
        setTimeout(poll, 5000);
      } else {
        setGenerating(false);
        setPolling(false);
      }
    };

    poll();
  };

  const handleAddToCanvas = () => {
    const urls = results.filter(r => r.url).map(r => r.url!);
    if (urls.length > 0 && onAddImages) {
      onAddImages(urls);
    }
    onClose();
  };

  const bg = isGold ? 'bg-[#141414]' : 'bg-card';
  const textC = isGold ? 'text-gray-200' : 'text-foreground';
  const inputCls = `w-full bg-muted/60 border border-border/50 rounded-lg px-2.5 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`${bg} rounded-2xl border border-border shadow-2xl w-[580px] max-h-[85vh] overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center gap-3 px-5 py-4 border-b ${isGold ? 'border-white/5' : 'border-border'}`}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isGold ? 'bg-[#d4af37]/15' : 'bg-primary/10'}`}>
            <LayoutGrid className={`w-4 h-4 ${isGold ? 'text-[#d4af37]' : 'text-primary'}`} />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${textC}`}>批量生成品牌构件</h3>
            <p className={`text-[10px] mt-0.5 ${isGold ? 'text-gray-600' : 'text-muted-foreground'}`}>
              {kit.name} · AI 自动生成品牌延展设计
            </p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${isGold ? 'text-gray-600 hover:text-gray-400 hover:bg-white/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto max-h-[calc(85vh-68px)]">
          {/* Scene Selection */}
          <div>
            <SectionHeader icon={LayoutGrid} title="选择场景类型" isGold={isGold} />
            <div className="grid grid-cols-4 gap-2">
              {SCENE_TYPES.map(st => {
                const isSelected = selectedScenes.includes(st.id);
                return (
                  <button
                    key={st.id}
                    onClick={() => toggleScene(st.id)}
                    className={`relative px-2 py-3 rounded-xl border text-xs transition-all duration-200 flex flex-col items-center gap-1.5 ${
                      isSelected
                        ? isGold ? 'border-[#d4af37]/40 bg-[#d4af37]/10 shadow-sm shadow-[#d4af37]/10' : 'border-primary/40 bg-primary/10 shadow-sm shadow-primary/10'
                        : `border-border/50 ${isGold ? 'bg-[#1c1c1c] hover:border-white/10' : 'bg-muted/30 hover:border-primary/20'}`
                    }`}
                  >
                    <span className="text-lg">{st.icon}</span>
                    <span className={`font-medium ${isSelected ? (isGold ? 'text-[#d4af37]' : 'text-primary') : (isGold ? 'text-gray-400' : 'text-foreground')}`}>
                      {st.name}
                    </span>
                    <span className={`text-[9px] ${isGold ? 'text-gray-600' : 'text-muted-foreground'}`}>{st.desc}</span>
                    {isSelected && (
                      <div className={`absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full flex items-center justify-center ${isGold ? 'bg-[#d4af37]' : 'bg-primary'}`}>
                        <Check className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Settings Row */}
          <div>
            <SectionHeader icon={Zap} title="生成设置" isGold={isGold} />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={`text-[10px] ${isGold ? 'text-gray-500' : 'text-muted-foreground'} mb-1 block`}>每场景数量</label>
                <select
                  value={count}
                  onChange={e => setCount(Number(e.target.value))}
                  className={inputCls}
                >
                  <option value={1}>1 张</option>
                  <option value={2}>2 张</option>
                  <option value={3}>3 张</option>
                </select>
              </div>
              <div>
                <label className={`text-[10px] ${isGold ? 'text-gray-500' : 'text-muted-foreground'} mb-1 block`}>画面比例</label>
                <select
                  value={aspectRatio}
                  onChange={e => setAspectRatio(e.target.value)}
                  className={inputCls}
                >
                  <option value="1:1">1:1 方形</option>
                  <option value="16:9">16:9 横版</option>
                  <option value="9:16">9:16 竖版</option>
                  <option value="4:3">4:3 横版</option>
                </select>
              </div>
              <div>
                <label className={`text-[10px] ${isGold ? 'text-gray-500' : 'text-muted-foreground'} mb-1 block`}>图像模型</label>
                <div className={`text-xs px-2.5 py-2 bg-muted/40 border border-border/50 rounded-lg ${isGold ? 'text-gray-500' : 'text-muted-foreground'} truncate`}>
                  {currentImageModel || '默认'}
                </div>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className={`flex items-center gap-2 text-xs p-3 rounded-lg ${isGold ? 'bg-[#1c1c1c] text-gray-400 border border-white/5' : 'bg-muted/30 text-muted-foreground border border-border/30'}`}>
            <Sparkles className={`w-3.5 h-3.5 ${isGold ? 'text-[#d4af37]' : 'text-primary'}`} />
            <span>将生成 <strong className={isGold ? 'text-[#d4af37]' : 'text-primary'}>{selectedScenes.length}</strong> 个场景 × <strong className={isGold ? 'text-[#d4af37]' : 'text-primary'}>{count}</strong> 张 = <strong className={isGold ? 'text-[#d4af37]' : 'text-primary'}>{selectedScenes.length * count}</strong> 张品牌构件</span>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || selectedScenes.length === 0}
            className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-40 ${
              isGold
                ? 'bg-[#d4af37] text-black hover:bg-[#d4af37]/85 shadow-lg shadow-[#d4af37]/20'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
            }`}
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {polling ? '生成中，等待结果...' : '正在生成提示词...'}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                批量生成品牌构件
              </>
            )}
          </button>

          {/* Results */}
          {results.length > 0 && (
            <div>
              <SectionHeader icon={Eye} title="生成结果" isGold={isGold} />
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className={`flex gap-3 p-2.5 rounded-xl border transition-all duration-300 ${
                      r.url
                        ? isGold ? 'border-[#d4af37]/20 bg-[#d4af37]/5' : 'border-primary/20 bg-primary/5'
                        : `${isGold ? 'border-white/5 bg-[#1c1c1c]' : 'border-border bg-muted/30'}`
                    }`}
                  >
                    {r.url ? (
                      <img
                        src={r.url}
                        alt={r.scene}
                        className="w-16 h-16 object-cover rounded-lg border border-border/30"
                      />
                    ) : (
                      <div className={`w-16 h-16 rounded-lg flex items-center justify-center ${generating ? 'animate-pulse' : ''} ${isGold ? 'bg-[#222]' : 'bg-muted'}`}>
                        {generating ? (
                          <Loader2 className={`w-5 h-5 animate-spin ${isGold ? 'text-[#d4af37]' : 'text-primary'}`} />
                        ) : (
                          <ImageIcon className="w-5 h-5 text-muted-foreground/50" />
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-semibold ${textC}`}>
                        {SCENE_TYPES.find(s => s.id === r.scene)?.icon} {SCENE_TYPES.find(s => s.id === r.scene)?.name || r.scene}
                      </div>
                      <p className={`text-[10px] mt-0.5 leading-relaxed ${isGold ? 'text-gray-500' : 'text-muted-foreground'} line-clamp-2`}>
                        {r.prompt}
                      </p>
                      {r.url && (
                        <button
                          onClick={() => navigator.clipboard.writeText(r.prompt)}
                          className="mt-1 text-[10px] flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Copy className="w-3 h-3" /> 复制提示词
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Add to Canvas */}
                {results.some(r => r.url) && (
                  <button
                    onClick={handleAddToCanvas}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium border transition-all duration-200 flex items-center justify-center gap-2 ${
                      isGold
                        ? 'border-[#d4af37]/40 text-[#d4af37] hover:bg-[#d4af37]/10'
                        : 'border-primary/40 text-primary hover:bg-primary/5'
                    }`}
                  >
                    <ArrowRight className="w-4 h-4" />
                    添加到画布
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ========== Main Brand Kit Panel ==========
export default function BrandKitPanel({ isGold, onAddImages }: BrandKitPanelProps) {
  // 获取当前图像模型（从 localStorage 读取 generation-panel 的选择）
  const [currentImageModel, setCurrentImageModel] = useState<string>('');
  useEffect(() => {
    const readModel = () => {
      try {
        const stored = localStorage.getItem('wujie_selected_model');
        if (stored) {
          const parsed = JSON.parse(stored);
          setCurrentImageModel(parsed.model || parsed.modelId || '');
        }
      } catch { /* ignore */ }
    };
    readModel();
    const interval = setInterval(readModel, 2000);
    return () => clearInterval(interval);
  }, []);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editKit, setEditKit] = useState<Partial<BrandKit> | null>(null);
  const [batchDialog, setBatchDialog] = useState<BrandKit | null>(null);
  const [loading, setLoading] = useState(true);

  const accentC = isGold ? 'text-[#d4af37]' : 'text-primary';
  const textC = isGold ? 'text-gray-200' : 'text-foreground';

  // Load brand kits
  const loadKits = useCallback(async () => {
    try {
      const resp = await fetch('/api/brand-kit');
      if (resp.ok) {
        const data = await resp.json();
        setKits(data.kits || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadKits(); }, [loadKits]);

  // Create new brand kit
  const handleCreate = () => {
    setEditKit({
      name: '',
      description: '',
      colors: { ...defaultColors },
      fontStyle: 'sans-serif',
      styleKeywords: [],
      referenceImages: [],
    });
    setEditing(true);
  };

  // Edit existing kit
  const handleEdit = (kit: BrandKit) => {
    setEditKit({ ...kit });
    setEditing(true);
  };

  // Save kit (create or update)
  const handleSave = async (kitData: Partial<BrandKit>) => {
    const action = kitData.id ? 'update' : 'create';
    try {
      const resp = await fetch('/api/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...kitData }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.kit) setSelectedKitId(data.kit.id);
      }
    } catch {}
    setEditing(false);
    setEditKit(null);
    loadKits();
  };

  // Delete kit
  const handleDelete = async (id: string) => {
    try {
      await fetch('/api/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
    } catch {}
    if (selectedKitId === id) setSelectedKitId(null);
    loadKits();
  };

  const selectedKit = kits.find(k => k.id === selectedKitId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className={`w-5 h-5 animate-spin ${isGold ? 'text-[#d4af37]' : 'text-primary'}`} />
          <span className={`text-xs ${isGold ? 'text-gray-600' : 'text-muted-foreground'}`}>加载品牌构件...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center ${isGold ? 'bg-[#d4af37]/15' : 'bg-primary/10'}`}>
            <Palette className={`w-3.5 h-3.5 ${accentC}`} />
          </div>
          <span className={`text-sm font-semibold ${textC}`}>品牌构件</span>
          {kits.length > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isGold ? 'bg-[#d4af37]/10 text-[#d4af37]' : 'bg-primary/10 text-primary'}`}>
              {kits.length}
            </span>
          )}
        </div>
        <button
          onClick={handleCreate}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
            isGold ? 'bg-[#d4af37]/12 text-[#d4af37] hover:bg-[#d4af37]/20 shadow-sm shadow-[#d4af37]/5' : 'bg-primary/10 text-primary hover:bg-primary/20 shadow-sm shadow-primary/5'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          新建品牌
        </button>
      </div>

      {/* Editor */}
      {editing && editKit && (
        <BrandKitEditor
          kit={editKit}
          onSave={handleSave}
          onCancel={() => { setEditing(false); setEditKit(null); }}
          isGold={isGold}
        />
      )}

      {/* Kit List */}
      {!editing && (
        <>
          {kits.length === 0 ? (
            <div className={`text-center py-10 rounded-xl border-2 border-dashed transition-colors ${
              isGold ? 'border-white/10 text-gray-700' : 'border-border text-muted-foreground'
            }`}>
              <div className={`w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center ${isGold ? 'bg-white/5' : 'bg-muted'}`}>
                <Palette className="w-6 h-6 opacity-30" />
              </div>
              <p className={`text-xs font-medium ${isGold ? 'text-gray-500' : 'text-muted-foreground'}`}>尚未创建品牌套件</p>
              <p className={`text-[10px] mt-1.5 ${isGold ? 'text-gray-700' : 'text-muted-foreground/60'}`}>
                创建品牌套件后可批量生成品牌构件
              </p>
              <button
                onClick={handleCreate}
                className={`mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  isGold ? 'bg-[#d4af37]/12 text-[#d4af37] hover:bg-[#d4af37]/20' : 'bg-primary/10 text-primary hover:bg-primary/20'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                创建第一个品牌
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {kits.map(kit => (
                <BrandKitCard
                  key={kit.id}
                  kit={kit}
                  selected={selectedKitId === kit.id}
                  onSelect={() => setSelectedKitId(kit.id === selectedKitId ? null : kit.id)}
                  onEdit={() => handleEdit(kit)}
                  onDelete={() => handleDelete(kit.id)}
                  onBatchGenerate={() => setBatchDialog(kit)}
                  isGold={isGold}
                />
              ))}
            </div>
          )}

          {/* Quick batch generate if kit is selected */}
          {selectedKit && !editing && (
            <button
              onClick={() => setBatchDialog(selectedKit)}
              className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
                isGold
                  ? 'bg-[#d4af37] text-black hover:bg-[#d4af37]/85 shadow-lg shadow-[#d4af37]/20'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              批量生成 {selectedKit.name} 构件
            </button>
          )}
        </>
      )}

      {/* Batch Generate Dialog */}
      {batchDialog && (
        <BatchGenerateDialog
          kit={batchDialog}
          isGold={isGold}
          onClose={() => setBatchDialog(null)}
          onAddImages={onAddImages}
          currentImageModel={currentImageModel}
        />
      )}
    </div>
  );
}
