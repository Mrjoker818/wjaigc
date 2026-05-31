'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Palette, Plus, Trash2, Edit3, Check, X, Sparkles,
  ChevronDown, ChevronUp, Image as ImageIcon, Loader2,
  Wand2, LayoutGrid, Eye, Copy, Upload, Type,
  SwatchBook, Tag, Zap, ArrowRight, Camera, FileImage
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
  { id: 'social_media', name: '社交媒体', icon: '📱', desc: '社交配图' },
  { id: 'business_card', name: '名片', icon: '💳', desc: '商务名片' },
  { id: 'packaging', name: '包装', icon: '📦', desc: '产品包装' },
  { id: 'banner', name: '横幅', icon: '🏴', desc: '广告横幅' },
  { id: 'logo_variation', name: 'Logo变体', icon: '⭐', desc: 'Logo延展' },
  { id: 'letterhead', name: '信头纸', icon: '📝', desc: '文件信头' },
  { id: 'merchandise', name: '周边', icon: '👕', desc: '周边设计' },
];

// ========== Shared Styles ==========
function useTheme(isGold: boolean) {
  return {
    bg: isGold ? 'bg-[#111]' : 'bg-card',
    surface: isGold ? 'bg-[#1a1a1a]' : 'bg-muted/30',
    surfaceHover: isGold ? 'hover:bg-[#222]' : 'hover:bg-muted/50',
    border: isGold ? 'border-white/[0.06]' : 'border-border',
    borderLight: isGold ? 'border-white/[0.04]' : 'border-border/50',
    text: isGold ? 'text-gray-100' : 'text-foreground',
    textSec: isGold ? 'text-gray-400' : 'text-muted-foreground',
    textTri: isGold ? 'text-gray-500' : 'text-muted-foreground/60',
    accent: isGold ? 'text-[#d4af37]' : 'text-primary',
    accentBg: isGold ? 'bg-[#d4af37]/10' : 'bg-primary/10',
    accentBorder: isGold ? 'border-[#d4af37]/30' : 'border-primary/30',
    accentText: isGold ? 'text-[#d4af37]' : 'text-primary',
    inputBg: isGold ? 'bg-[#1a1a1a]' : 'bg-muted/50',
    inputBorder: isGold ? 'border-white/[0.08]' : 'border-border/60',
  };
}

// ========== Compact Color Swatch ==========
function ColorSwatch({ value, onChange, label, isGold }: {
  value: string; onChange: (v: string) => void; label: string; isGold: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useTheme(isGold);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md transition-colors hover:bg-white/5"
        title={`${label}: ${value}`}
      >
        <div
          className="w-5 h-5 rounded shrink-0 ring-1 ring-inset ring-white/10"
          style={{ backgroundColor: value }}
        />
        <span className={`text-[10px] ${t.textSec} truncate`}>{label}</span>
        <span className={`text-[10px] font-mono ml-auto ${t.textTri}`}>{value}</span>
      </button>
      {open && (
        <div className={`absolute left-0 right-0 top-full mt-1 z-50 p-2 rounded-lg ${t.bg} border ${t.border} shadow-xl`}>
          <input
            type="color" value={value} onChange={e => onChange(e.target.value)}
            className="w-full h-24 rounded cursor-pointer border-0"
            autoFocus
          />
          <input
            type="text" value={value}
            onChange={e => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value)}
            className={`w-full mt-1.5 ${t.inputBg} border ${t.inputBorder} rounded px-2 py-1 text-[10px] font-mono text-center ${t.text}`}
            maxLength={7}
          />
        </div>
      )}
    </div>
  );
}

// ========== Image Uploader ==========
function ImageUploader({ onImageReady, isGold, compact }: {
  onImageReady: (url: string) => void;
  isGold: boolean;
  compact?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useTheme(isGold);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setPreview(dataUrl);
      };
      reader.readAsDataURL(file);

      const reader2 = new FileReader();
      const dataUrlPromise = new Promise<string>((resolve) => {
        reader2.onload = (ev) => resolve(ev.target?.result as string);
        reader2.readAsDataURL(file);
      });
      const dataUrl = await dataUrlPromise;

      const resp = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: dataUrl }),
      });
      if (resp.ok) {
        const data = await resp.json();
        onImageReady(data.url || data.path || dataUrl);
      } else {
        onImageReady(dataUrl);
      }
    } catch {
      const reader3 = new FileReader();
      reader3.onload = (ev) => onImageReady(ev.target?.result as string);
      reader3.readAsDataURL(file);
    }
    setUploading(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  if (compact) {
    return (
      <>
        <input
          ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ${t.accentBg} ${t.accentText} ${t.accentBorder} border disabled:opacity-40`}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          {uploading ? '上传中...' : '上传识别'}
        </button>
      </>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onClick={() => fileRef.current?.click()}
      className={`relative rounded-lg border-2 border-dashed cursor-pointer transition-all duration-200 overflow-hidden ${
        isGold ? 'border-white/10 hover:border-[#d4af37]/30 bg-[#1a1a1a]' : 'border-border hover:border-primary/30 bg-muted/20'
      } ${preview ? 'h-28' : 'h-24'}`}
    >
      <input
        ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      {uploading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
          <Loader2 className={`w-5 h-5 animate-spin ${isGold ? 'text-[#d4af37]' : 'text-primary'}`} />
        </div>
      ) : null}
      {preview ? (
        <div className="relative h-full w-full">
          <img src={preview} alt="brand" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <span className="text-[10px] text-white/80">点击更换图片</span>
            <Sparkles className="w-3 h-3 text-[#d4af37]" />
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          <Upload className={`w-5 h-5 ${t.textTri}`} />
          <span className={`text-[10px] ${t.textTri}`}>拖拽或点击上传品牌素材</span>
          <span className={`text-[9px] ${t.textTri}`}>自动识别品牌色彩与风格</span>
        </div>
      )}
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
  const t = useTheme(isGold);
  const inputCls = `w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-sm ${t.text} placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/30 focus:border-[#d4af37]/30 transition-all`;

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

  // Analyze from uploaded image
  const handleImageAnalyze = async (imageUrl: string) => {
    setAnalyzing(true);
    // Add uploaded image to reference images
    setEditKit(prev => prev ? { ...prev, referenceImages: [...(prev.referenceImages || []), imageUrl] } : prev);
    try {
      const resp = await fetch('/api/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze-image', imageUrl, brandName: editKit.name }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.brandDNA) {
          const dna = data.brandDNA;
          const newKit = { ...editKit };
          if (dna.primaryColor) newKit.colors = { ...newKit.colors!, primary: dna.primaryColor };
          if (dna.secondaryColors?.[0]) newKit.colors = { ...newKit.colors!, secondary: dna.secondaryColors[0] };
          if (dna.secondaryColors?.[1]) newKit.colors = { ...newKit.colors!, accent: dna.secondaryColors[1] };
          if (dna.styleKeywords?.length) newKit.styleKeywords = [...(newKit.styleKeywords || []), ...dna.styleKeywords.filter((k: string) => !(newKit.styleKeywords || []).includes(k))];
          if (dna.mood) newKit.mood = dna.mood;
          if (dna.industry) newKit.industry = dna.industry;
          if (dna.description) newKit.description = dna.description;
          if (dna.fontFamily) {
            const ff = dna.fontFamily.toLowerCase();
            if (ff.includes('serif') && !ff.includes('sans')) newKit.fontStyle = 'serif';
            else if (ff.includes('handwrit') || ff.includes('script')) newKit.fontStyle = 'handwriting';
            else if (ff.includes('display') || ff.includes('decorative')) newKit.fontStyle = 'display';
            else if (ff.includes('mono')) newKit.fontStyle = 'monospace';
          }
          newKit.brandDna = JSON.stringify(dna, null, 2);
          setEditKit(newKit);
        }
      }
    } catch (e) {
      console.error('Brand image analysis failed:', e);
    }
    setAnalyzing(false);
  };

  // Analyze from kit data
  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const resp = await fetch('/api/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze',
          images: editKit.referenceImages || [],
          brandName: editKit.name,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.brandDNA) {
          const dna = data.brandDNA;
          const newKit = { ...editKit };
          if (dna.primaryColor) newKit.colors = { ...newKit.colors!, primary: dna.primaryColor };
          if (dna.secondaryColors?.[0]) newKit.colors = { ...newKit.colors!, secondary: dna.secondaryColors[0] };
          if (dna.secondaryColors?.[1]) newKit.colors = { ...newKit.colors!, accent: dna.secondaryColors[1] };
          if (dna.styleKeywords?.length) newKit.styleKeywords = [...(newKit.styleKeywords || []), ...dna.styleKeywords.filter((k: string) => !(newKit.styleKeywords || []).includes(k))];
          if (dna.mood) newKit.mood = dna.mood;
          if (dna.industry) newKit.industry = dna.industry;
          if (dna.description) newKit.description = dna.description;
          if (dna.fontFamily) {
            const ff = dna.fontFamily.toLowerCase();
            if (ff.includes('serif') && !ff.includes('sans')) newKit.fontStyle = 'serif';
            else if (ff.includes('handwrit') || ff.includes('script')) newKit.fontStyle = 'handwriting';
            else if (ff.includes('display') || ff.includes('decorative')) newKit.fontStyle = 'display';
            else if (ff.includes('mono')) newKit.fontStyle = 'monospace';
          }
          newKit.brandDna = JSON.stringify(dna, null, 2);
          setEditKit(newKit);
        }
      }
    } catch (e) {
      console.error('Brand DNA analysis failed:', e);
    }
    setAnalyzing(false);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header Bar */}
      <div className={`flex items-center justify-between px-3 py-2.5 shrink-0 ${isGold ? 'bg-[#1a1a1a] border-b border-white/[0.06]' : 'bg-muted/20 border-b border-border/50'}`}>
        <div className="flex items-center gap-2">
          <div className={`w-1 h-3.5 rounded-full ${isGold ? 'bg-[#d4af37]' : 'bg-primary'}`} />
          <span className={`text-xs font-semibold ${t.text}`}>{editKit.id ? '编辑品牌' : '创建品牌'}</span>
        </div>
        <ImageUploader onImageReady={handleImageAnalyze} isGold={isGold} compact />
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3.5">
        {/* Upload & Image Preview */}
        <ImageUploader
          onImageReady={handleImageAnalyze}
          isGold={isGold}
        />

        {/* Brand Info */}
        <div className="space-y-2.5">
          <input
            type="text"
            value={editKit.name || ''}
            onChange={e => setEditKit({ ...editKit, name: e.target.value })}
            className={inputCls}
            placeholder="品牌名称 *"
          />
          <textarea
            value={editKit.description || ''}
            onChange={e => setEditKit({ ...editKit, description: e.target.value })}
            className={`${inputCls} resize-none`}
            rows={2}
            placeholder="品牌核心价值、定位和个性..."
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={editKit.industry || ''}
              onChange={e => setEditKit({ ...editKit, industry: e.target.value })}
              className={`${inputCls} text-xs`}
            >
              <option value="">选择行业</option>
              {['tech|科技','fashion|时尚','food|餐饮','health|健康','education|教育','finance|金融','entertainment|娱乐','beauty|美妆','sports|运动','travel|旅行','other|其他'].map(o => {
                const [v, l] = o.split('|');
                return <option key={v} value={v}>{l}</option>;
              })}
            </select>
            <select
              value={editKit.mood || ''}
              onChange={e => setEditKit({ ...editKit, mood: e.target.value })}
              className={`${inputCls} text-xs`}
            >
              <option value="">选择调性</option>
              {['professional|专业','playful|活泼','luxury|奢华','minimal|极简','warm|温馨','bold|大胆','elegant|优雅','energetic|活力','calm|沉稳','creative|创意'].map(o => {
                const [v, l] = o.split('|');
                return <option key={v} value={v}>{l}</option>;
              })}
            </select>
          </div>
        </div>

        {/* Colors */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <SwatchBook className={`w-3 h-3 ${t.accent}`} />
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${t.textSec}`}>品牌色彩</span>
          </div>
          {/* Color preview bar */}
          <div className="flex gap-0.5 mb-2 rounded-md overflow-hidden h-4">
            {Object.values(editKit.colors || defaultColors).map((color, i) => (
              <div key={i} className="flex-1" style={{ backgroundColor: color }} />
            ))}
          </div>
          <div className={`rounded-lg ${t.surface} p-1 space-y-0.5`}>
            <ColorSwatch label="主色" value={editKit.colors?.primary || defaultColors.primary} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, primary: v } })} isGold={isGold} />
            <ColorSwatch label="辅色" value={editKit.colors?.secondary || defaultColors.secondary} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, secondary: v } })} isGold={isGold} />
            <ColorSwatch label="强调" value={editKit.colors?.accent || defaultColors.accent} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, accent: v } })} isGold={isGold} />
            <ColorSwatch label="背景" value={editKit.colors?.background || defaultColors.background} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, background: v } })} isGold={isGold} />
            <ColorSwatch label="文字" value={editKit.colors?.text || defaultColors.text} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, text: v } })} isGold={isGold} />
          </div>
        </div>

        {/* Font Style */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Type className={`w-3 h-3 ${t.accent}`} />
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${t.textSec}`}>字体风格</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
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
                className={`flex flex-col items-center gap-0.5 px-1 py-2 rounded-lg border transition-all duration-200 ${
                  editKit.fontStyle === fs.key
                    ? `${t.accentBg} ${t.accentBorder}`
                    : `${t.borderLight} ${t.surface} ${t.surfaceHover}`
                }`}
              >
                <span className={`text-base font-bold ${
                  editKit.fontStyle === fs.key ? t.accentText : t.textTri
                }`} style={{ fontFamily: fs.key }}>{fs.sample}</span>
                <span className={`text-[9px] ${
                  editKit.fontStyle === fs.key ? t.accentText : t.textTri
                }`}>{fs.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Style Keywords */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Tag className={`w-3 h-3 ${t.accent}`} />
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${t.textSec}`}>风格关键词</span>
          </div>
          <div className="flex gap-1.5 mb-2">
            <input
              type="text"
              value={keywordInput}
              onChange={e => setKeywordInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddKeyword()}
              className={`${inputCls} flex-1 text-xs py-1.5`}
              placeholder="输入关键词，回车添加..."
            />
            <button
              onClick={handleAddKeyword}
              disabled={!keywordInput.trim()}
              className={`px-2 rounded-lg transition-all duration-200 disabled:opacity-30 ${t.accentBg} ${t.accentText}`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          {(editKit.styleKeywords || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(editKit.styleKeywords || []).map((kw, idx) => (
                <span
                  key={idx}
                  className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${t.accentBg} ${t.accentText}`}
                >
                  {kw}
                  <button onClick={() => handleRemoveKeyword(idx)} className="ml-0.5 hover:text-destructive transition-colors">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Brand DNA (if exists) */}
        {editKit.brandDna && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles className={`w-3 h-3 ${t.accent}`} />
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${t.textSec}`}>品牌 DNA</span>
            </div>
            <div className={`text-[10px] leading-relaxed ${t.textSec} ${t.surface} rounded-lg p-2.5 max-h-28 overflow-y-auto whitespace-pre-wrap`}>
              {editKit.brandDna}
            </div>
          </div>
        )}
      </div>

      {/* Fixed Bottom Actions */}
      <div className={`flex items-center gap-2 px-3 py-2.5 shrink-0 ${isGold ? 'bg-[#111] border-t border-white/[0.06]' : 'bg-card border-t border-border/50'}`}>
        <button
          onClick={handleAnalyze}
          disabled={analyzing || !editKit.name}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 disabled:opacity-30 ${t.accentBg} ${t.accentText}`}
        >
          {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
          {analyzing ? '分析中...' : 'AI 分析'}
        </button>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className={`px-3 py-1.5 rounded-lg text-[11px] ${t.textSec} hover:${t.text} transition-all duration-200`}
        >
          取消
        </button>
        <button
          onClick={() => onSave(editKit)}
          disabled={!editKit.name}
          className={`flex items-center gap-1 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 disabled:opacity-30 ${
            isGold ? 'bg-[#d4af37] text-black hover:bg-[#d4af37]/85' : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          <Check className="w-3 h-3" />
          保存
        </button>
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
  const t = useTheme(isGold);

  return (
    <div
      className={`rounded-lg border transition-all duration-200 overflow-hidden cursor-pointer ${
        selected
          ? `${t.accentBorder} ${t.accentBg}`
          : `${t.borderLight} ${t.bg} hover:border-white/10`
      }`}
      onClick={onSelect}
    >
      {/* Color strip */}
      <div className="flex h-1">
        <div className="flex-1" style={{ backgroundColor: kit.colors.primary }} />
        <div className="flex-1" style={{ backgroundColor: kit.colors.secondary }} />
        <div className="flex-1" style={{ backgroundColor: kit.colors.accent }} />
      </div>

      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex flex-col items-center gap-0.5">
          <div className="w-5 h-5 rounded-full ring-1 ring-inset ring-white/10" style={{ backgroundColor: kit.colors.primary }} />
          <div className="flex gap-0.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: kit.colors.secondary }} />
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: kit.colors.accent }} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold truncate ${t.text}`}>{kit.name}</div>
          {kit.industry && (
            <div className={`text-[9px] mt-0.5 ${t.textTri}`}>
              {kit.industry}{kit.mood ? ` · ${kit.mood}` : ''}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={onBatchGenerate}
            className={`p-1 rounded-md transition-colors ${t.accentText} hover:bg-white/5`}
            title="批量生成"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className={`p-1 rounded-md transition-colors ${t.textSec} hover:${t.text}`}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Expanded */}
      <div className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className={`px-3 pb-2.5 pt-2 ${isGold ? 'border-t border-white/[0.04]' : 'border-t border-border/50'} space-y-2`}>
          {kit.description && <p className={`text-[10px] leading-relaxed ${t.textSec}`}>{kit.description}</p>}
          {kit.styleKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {kit.styleKeywords.slice(0, 6).map((kw, i) => (
                <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded-full ${t.accentBg} ${t.accentText}`}>{kw}</span>
              ))}
              {kit.styleKeywords.length > 6 && <span className={`text-[9px] ${t.textTri}`}>+{kit.styleKeywords.length - 6}</span>}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className={`text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded-md ${t.textSec} hover:${t.text} transition-colors`}>
              <Edit3 className="w-2.5 h-2.5" /> 编辑
            </button>
            <button onClick={onDelete} className="text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-red-500/60 hover:text-red-500 transition-colors">
              <Trash2 className="w-2.5 h-2.5" /> 删除
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
  const t = useTheme(isGold);
  const inputCls = `w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-2.5 py-1.5 text-xs ${t.text} focus:outline-none focus:ring-1 focus:ring-[#d4af37]/30 transition-all`;

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
          scene: p.scene, prompt: p.prompt,
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
        setGenerating(false); setPolling(false); return;
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
        const delay = attempts < 5 ? 1000 : attempts < 15 ? 1500 : 2000;
        setTimeout(poll, delay);
      } else {
        setGenerating(false); setPolling(false);
      }
    };
    poll();
  };

  const handleAddToCanvas = () => {
    const urls = results.filter(r => r.url).map(r => r.url!);
    if (urls.length > 0 && onAddImages) onAddImages(urls);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`${isGold ? 'bg-[#111]' : 'bg-card'} rounded-2xl border ${t.border} shadow-2xl w-[520px] max-h-[80vh] overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center gap-2.5 px-4 py-3 ${isGold ? 'border-b border-white/[0.06]' : 'border-b border-border'}`}>
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.accentBg}`}>
            <LayoutGrid className={`w-3.5 h-3.5 ${t.accentText}`} />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${t.text}`}>批量生成品牌构件</h3>
            <p className={`text-[10px] ${t.textTri}`}>{kit.name} · AI 自动生成</p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className={`p-1 rounded-lg ${t.textSec} hover:${t.text} transition-colors`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(80vh-52px)]">
          {/* Scene Selection */}
          <div className="grid grid-cols-4 gap-1.5">
            {SCENE_TYPES.map(st => {
              const sel = selectedScenes.includes(st.id);
              return (
                <button
                  key={st.id}
                  onClick={() => toggleScene(st.id)}
                  className={`relative px-1.5 py-2 rounded-lg border text-[10px] transition-all duration-200 flex flex-col items-center gap-0.5 ${
                    sel ? `${t.accentBg} ${t.accentBorder}` : `${t.borderLight} ${t.surface} ${t.surfaceHover}`
                  }`}
                >
                  <span className="text-base">{st.icon}</span>
                  <span className={`font-medium ${sel ? t.accentText : t.text}`}>{st.name}</span>
                  {sel && <div className={`absolute top-1 right-1 w-3 h-3 rounded-full flex items-center justify-center ${isGold ? 'bg-[#d4af37]' : 'bg-primary'}`}><Check className="w-2 h-2 text-white" /></div>}
                </button>
              );
            })}
          </div>

          {/* Settings */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className={`text-[9px] ${t.textTri} mb-1 block`}>每场景数量</span>
              <select value={count} onChange={e => setCount(Number(e.target.value))} className={inputCls}>
                <option value={1}>1 张</option>
                <option value={2}>2 张</option>
                <option value={3}>3 张</option>
              </select>
            </div>
            <div>
              <span className={`text-[9px] ${t.textTri} mb-1 block`}>画面比例</span>
              <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} className={inputCls}>
                <option value="1:1">1:1 方形</option>
                <option value="16:9">16:9 横版</option>
                <option value="9:16">9:16 竖版</option>
                <option value="4:3">4:3 横版</option>
              </select>
            </div>
            <div>
              <span className={`text-[9px] ${t.textTri} mb-1 block`}>图像模型</span>
              <div className={`${t.inputBg} border ${t.inputBorder} rounded-lg px-2.5 py-1.5 text-[10px] ${t.textSec} truncate`}>
                {currentImageModel || '默认'}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className={`flex items-center gap-1.5 text-[10px] px-3 py-2 rounded-lg ${t.surface} ${t.textSec}`}>
            <Zap className={`w-3 h-3 ${t.accentText}`} />
            <span>将生成 <strong className={t.accentText}>{selectedScenes.length * count}</strong> 张品牌构件</span>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || selectedScenes.length === 0}
            className={`w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 disabled:opacity-30 ${
              isGold ? 'bg-[#d4af37] text-black hover:bg-[#d4af37]/85' : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {generating ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />{polling ? '生成中...' : '生成提示词...'}</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5" />批量生成</>
            )}
          </button>

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-1.5">
              <span className={`text-[10px] font-medium ${t.textSec}`}>生成结果</span>
              {results.map((r, i) => (
                <div key={i} className={`flex gap-2.5 p-2 rounded-lg border ${r.url ? t.accentBorder : t.borderLight} ${t.surface}`}>
                  {r.url ? (
                    <img src={r.url} alt={r.scene} className="w-14 h-14 object-cover rounded-md shrink-0" />
                  ) : (
                    <div className={`w-14 h-14 rounded-md flex items-center justify-center ${generating ? 'animate-pulse' : ''} ${isGold ? 'bg-[#222]' : 'bg-muted'}`}>
                      {generating ? <Loader2 className={`w-4 h-4 animate-spin ${t.accentText}`} /> : <ImageIcon className="w-4 h-4 text-gray-600" />}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[10px] font-semibold ${t.text}`}>
                      {SCENE_TYPES.find(s => s.id === r.scene)?.icon} {SCENE_TYPES.find(s => s.id === r.scene)?.name || r.scene}
                    </div>
                    <p className={`text-[9px] mt-0.5 leading-relaxed ${t.textSec} line-clamp-2`}>{r.prompt}</p>
                    {r.url && (
                      <button onClick={() => navigator.clipboard.writeText(r.prompt)} className="mt-0.5 text-[9px] flex items-center gap-0.5 text-gray-600 hover:text-gray-400 transition-colors">
                        <Copy className="w-2.5 h-2.5" /> 复制
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {results.some(r => r.url) && (
                <button
                  onClick={handleAddToCanvas}
                  className={`w-full py-2 rounded-xl text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${t.accentBorder} ${t.accentText} hover:${t.accentBg}`}
                >
                  <ArrowRight className="w-3.5 h-3.5" /> 添加到画布
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ========== Main Brand Kit Panel ==========
export default function BrandKitPanel({ isGold, onAddImages }: BrandKitPanelProps) {
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
  const t = useTheme(isGold);

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

  const handleCreate = () => {
    setEditKit({
      name: '', description: '',
      colors: { ...defaultColors },
      fontStyle: 'sans-serif',
      styleKeywords: [],
      referenceImages: [],
    });
    setEditing(true);
  };

  const handleEdit = (kit: BrandKit) => {
    setEditKit({ ...kit });
    setEditing(true);
  };

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
      <div className="flex items-center justify-center h-32">
        <Loader2 className={`w-4 h-4 animate-spin ${t.accentText}`} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-5 h-5 rounded flex items-center justify-center ${t.accentBg}`}>
            <Palette className={`w-3 h-3 ${t.accentText}`} />
          </div>
          <span className={`text-xs font-semibold ${t.text}`}>品牌构件</span>
          {kits.length > 0 && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${t.accentBg} ${t.accentText}`}>{kits.length}</span>
          )}
        </div>
        <button
          onClick={handleCreate}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-200 ${t.accentBg} ${t.accentText}`}
        >
          <Plus className="w-3 h-3" />
          新建
        </button>
      </div>

      {/* Editor - takes full height when editing */}
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
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
          {kits.length === 0 ? (
            <div className={`text-center py-8 rounded-xl border-2 border-dashed ${isGold ? 'border-white/[0.06]' : 'border-border'}`}>
              <div className={`w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center ${isGold ? 'bg-white/5' : 'bg-muted'}`}>
                <Palette className={`w-5 h-5 ${t.textTri}`} />
              </div>
              <p className={`text-[10px] font-medium ${t.textSec}`}>尚未创建品牌套件</p>
              <p className={`text-[9px] mt-1 ${t.textTri}`}>上传品牌素材自动识别风格</p>
              <button
                onClick={handleCreate}
                className={`mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all duration-200 ${t.accentBg} ${t.accentText}`}
              >
                <Plus className="w-3 h-3" /> 创建品牌
              </button>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {/* Batch generate button */}
      {selectedKit && !editing && (
        <button
          onClick={() => setBatchDialog(selectedKit)}
          className={`w-full py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 mt-2 shrink-0 transition-all duration-200 ${
            isGold ? 'bg-[#d4af37] text-black hover:bg-[#d4af37]/85' : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          批量生成 {selectedKit.name}
        </button>
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
