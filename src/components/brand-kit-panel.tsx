'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Palette, Plus, Trash2, Edit3, Check, X, Sparkles,
  ChevronDown, ChevronUp, Image as ImageIcon, Loader2,
  Wand2, LayoutGrid, Eye, Copy
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
  { id: 'poster', name: '海报', icon: '🖼️' },
  { id: 'social_media', name: '社交媒体', icon: '📱' },
  { id: 'business_card', name: '名片', icon: '💳' },
  { id: 'packaging', name: '包装', icon: '📦' },
  { id: 'banner', name: '横幅', icon: '🏴' },
  { id: 'logo_variation', name: 'Logo 变体', icon: '⭐' },
  { id: 'letterhead', name: '信头纸', icon: '📝' },
  { id: 'merchandise', name: '周边商品', icon: '👕' },
];

// ========== Color Picker Component ==========
function ColorPicker({ value, onChange, label }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-border bg-transparent"
        />
      </div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
        maxLength={7}
      />
      <span className="text-xs text-muted-foreground w-12">{label}</span>
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

  const bg = isGold ? 'bg-[#1a1a1a]' : 'bg-card';
  const textC = isGold ? 'text-gray-200' : 'text-foreground';
  const accentC = isGold ? 'text-[#d4af37]' : 'text-primary';

  return (
    <div className={`${bg} rounded-lg p-4 space-y-4 border border-border`}>
      {/* Name */}
      <div>
        <label className={`text-xs ${textC} font-medium mb-1 block`}>品牌名称</label>
        <input
          type="text"
          value={editKit.name || ''}
          onChange={e => setEditKit({ ...editKit, name: e.target.value })}
          className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground"
          placeholder="输入品牌名称..."
        />
      </div>

      {/* Description */}
      <div>
        <label className={`text-xs ${textC} font-medium mb-1 block`}>品牌描述</label>
        <textarea
          value={editKit.description || ''}
          onChange={e => setEditKit({ ...editKit, description: e.target.value })}
          className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground resize-y"
          rows={2}
          placeholder="描述品牌的核心价值、定位和个性..."
        />
      </div>

      {/* Industry & Mood */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={`text-xs ${textC} font-medium mb-1 block`}>行业</label>
          <select
            value={editKit.industry || ''}
            onChange={e => setEditKit({ ...editKit, industry: e.target.value })}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground"
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
          <label className={`text-xs ${textC} font-medium mb-1 block`}>情绪调性</label>
          <select
            value={editKit.mood || ''}
            onChange={e => setEditKit({ ...editKit, mood: e.target.value })}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground"
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

      {/* Colors */}
      <div>
        <label className={`text-xs ${textC} font-medium mb-2 block`}>品牌色彩</label>
        <div className="space-y-2">
          <ColorPicker label="主色" value={editKit.colors?.primary || defaultColors.primary} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, primary: v } })} />
          <ColorPicker label="辅色" value={editKit.colors?.secondary || defaultColors.secondary} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, secondary: v } })} />
          <ColorPicker label="强调" value={editKit.colors?.accent || defaultColors.accent} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, accent: v } })} />
          <ColorPicker label="背景" value={editKit.colors?.background || defaultColors.background} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, background: v } })} />
          <ColorPicker label="文字" value={editKit.colors?.text || defaultColors.text} onChange={v => setEditKit({ ...editKit, colors: { ...editKit.colors!, text: v } })} />
        </div>
      </div>

      {/* Font Style */}
      <div>
        <label className={`text-xs ${textC} font-medium mb-1 block`}>字体风格</label>
        <div className="grid grid-cols-5 gap-2">
          {(['serif', 'sans-serif', 'display', 'handwriting', 'monospace'] as const).map(fs => (
            <button
              key={fs}
              onClick={() => setEditKit({ ...editKit, fontStyle: fs })}
              className={`px-2 py-1.5 rounded text-xs border transition-all ${
                editKit.fontStyle === fs
                  ? `${isGold ? 'bg-[#d4af37]/20 border-[#d4af37]' : 'bg-primary/10 border-primary'} ${accentC}`
                  : 'border-border bg-muted text-muted-foreground hover:border-primary/30'
              }`}
            >
              {fs === 'serif' ? '衬线' : fs === 'sans-serif' ? '无衬线' : fs === 'display' ? '展示' : fs === 'handwriting' ? '手写' : '等宽'}
            </button>
          ))}
        </div>
      </div>

      {/* Style Keywords */}
      <div>
        <label className={`text-xs ${textC} font-medium mb-1 block`}>风格关键词</label>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={keywordInput}
            onChange={e => setKeywordInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddKeyword()}
            className="flex-1 bg-muted border border-border rounded px-3 py-1.5 text-xs text-foreground"
            placeholder="输入风格关键词，回车添加..."
          />
          <button
            onClick={handleAddKeyword}
            className="px-3 py-1.5 rounded bg-muted border border-border text-xs text-foreground hover:bg-primary/10"
          >
            添加
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(editKit.styleKeywords || []).map((kw, idx) => (
            <span
              key={idx}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                isGold ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-primary/10 text-primary'
              }`}
            >
              {kw}
              <button onClick={() => handleRemoveKeyword(idx)} className="hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Brand DNA (read-only) */}
      {editKit.brandDna && (
        <div>
          <label className={`text-xs ${textC} font-medium mb-1 block flex items-center gap-1`}>
            <Sparkles className="w-3 h-3" /> 品牌 DNA
          </label>
          <div className={`text-xs ${isGold ? 'text-gray-400' : 'text-muted-foreground'} bg-muted/50 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto`}>
            {editKit.brandDna}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleAnalyze}
          disabled={analyzing || !editKit.name}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs ${
            isGold ? 'bg-[#d4af37]/20 text-[#d4af37] hover:bg-[#d4af37]/30' : 'bg-primary/10 text-primary hover:bg-primary/20'
          } disabled:opacity-50 transition-colors`}
        >
          {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
          {analyzing ? '分析中...' : 'AI 分析品牌 DNA'}
        </button>
        <div className="flex-1" />
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground">
          取消
        </button>
        <button
          onClick={() => onSave(editKit)}
          disabled={!editKit.name}
          className={`flex items-center gap-1 px-4 py-1.5 rounded text-xs font-medium ${
            isGold ? 'bg-[#d4af37] text-black hover:bg-[#d4af37]/80' : 'bg-primary text-primary-foreground hover:bg-primary/90'
          } disabled:opacity-50 transition-colors`}
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
  const accentC = isGold ? '#d4af37' : '';

  return (
    <div
      className={`rounded-lg border transition-all cursor-pointer ${
        selected
          ? isGold ? 'border-[#d4af37] bg-[#d4af37]/5' : 'border-primary bg-primary/5'
          : 'border-border bg-card hover:border-primary/30'
      }`}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-center gap-2 p-3">
        {/* Color preview dots */}
        <div className="flex gap-1">
          <div className="w-4 h-4 rounded-full border border-border/50" style={{ backgroundColor: kit.colors.primary }} />
          <div className="w-4 h-4 rounded-full border border-border/50" style={{ backgroundColor: kit.colors.secondary }} />
          <div className="w-4 h-4 rounded-full border border-border/50" style={{ backgroundColor: kit.colors.accent }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium truncate ${isGold ? 'text-gray-200' : 'text-foreground'}`}>
            {kit.name}
          </div>
          {kit.industry && (
            <div className={`text-xs ${isGold ? 'text-gray-500' : 'text-muted-foreground'}`}>
              {kit.industry} · {kit.mood || ''}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button
            onClick={onBatchGenerate}
            className={`p-1.5 rounded transition-colors ${
              isGold ? 'text-[#d4af37] hover:bg-[#d4af37]/15' : 'text-primary hover:bg-primary/10'
            }`}
            title="批量生成品牌构件"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className={`px-3 pb-3 border-t border-border pt-2 space-y-2 ${isGold ? 'text-gray-400' : 'text-muted-foreground'}`}>
          {kit.description && <p className="text-xs">{kit.description}</p>}

          {/* Style Keywords */}
          {kit.styleKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {kit.styleKeywords.map((kw, i) => (
                <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${
                  isGold ? 'bg-[#d4af37]/10 text-[#d4af37]' : 'bg-primary/5 text-primary'
                }`}>
                  {kw}
                </span>
              ))}
            </div>
          )}

          {/* Brand DNA Preview */}
          {kit.brandDna && (
            <div className="text-xs bg-muted/30 rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
              <Sparkles className="w-3 h-3 inline mr-1" style={{ color: accentC }} />
              {kit.brandDna.split('\n').slice(0, 3).join('\n')}...
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={onEdit} className="text-xs flex items-center gap-1 px-2 py-1 rounded hover:bg-muted">
              <Edit3 className="w-3 h-3" /> 编辑
            </button>
            <button onClick={onDelete} className="text-xs flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-destructive">
              <Trash2 className="w-3 h-3" /> 删除
            </button>
          </div>
        </div>
      )}
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
        // Show prompts immediately
        setResults(data.prompts?.map((p: {scene: string; prompt: string}) => ({
          scene: p.scene,
          prompt: p.prompt,
        })) || []);

        if (data.taskIds?.length > 0) {
          setTaskIds(data.taskIds);
          // Start polling for results
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
    const maxAttempts = 120; // 10 minutes
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

  const bg = isGold ? 'bg-[#1a1a1a]' : 'bg-card';
  const textC = isGold ? 'text-gray-200' : 'text-foreground';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className={`${bg} rounded-xl border border-border shadow-2xl w-[560px] max-h-[85vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <LayoutGrid className={`w-5 h-5 ${isGold ? 'text-[#d4af37]' : 'text-primary'}`} />
          <div>
            <h3 className={`text-base font-semibold ${textC}`}>批量生成品牌构件</h3>
            <p className={`text-xs ${isGold ? 'text-gray-500' : 'text-muted-foreground'}`}>
              {kit.name} · AI 自动生成品牌延展设计
            </p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scene Selection */}
        <div className="p-4 space-y-4">
          <div>
            <label className={`text-xs ${textC} font-medium mb-2 block`}>选择场景类型</label>
            <div className="grid grid-cols-4 gap-2">
              {SCENE_TYPES.map(st => (
                <button
                  key={st.id}
                  onClick={() => toggleScene(st.id)}
                  className={`px-2 py-2 rounded text-xs border transition-all flex flex-col items-center gap-1 ${
                    selectedScenes.includes(st.id)
                      ? isGold ? 'border-[#d4af37] bg-[#d4af37]/10 text-[#d4af37]' : 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted text-muted-foreground hover:border-primary/30'
                  }`}
                >
                  <span className="text-lg">{st.icon}</span>
                  <span>{st.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Settings Row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={`text-xs ${textC} font-medium mb-1 block`}>每场景数量</label>
              <select
                value={count}
                onChange={e => setCount(Number(e.target.value))}
                className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground"
              >
                <option value={1}>1 张</option>
                <option value={2}>2 张</option>
                <option value={3}>3 张</option>
              </select>
            </div>
            <div>
              <label className={`text-xs ${textC} font-medium mb-1 block`}>画面比例</label>
              <select
                value={aspectRatio}
                onChange={e => setAspectRatio(e.target.value)}
                className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground"
              >
                <option value="1:1">1:1 方形</option>
                <option value="16:9">16:9 横版</option>
                <option value="9:16">9:16 竖版</option>
                <option value="4:3">4:3 横版</option>
              </select>
            </div>
            <div>
              <label className={`text-xs ${textC} font-medium mb-1 block`}>图像模型</label>
              <div className={`text-xs px-2 py-1.5 bg-muted border border-border rounded ${isGold ? 'text-gray-400' : 'text-muted-foreground'}`}>
                {currentImageModel || '默认'}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className={`text-xs p-2 rounded ${isGold ? 'bg-[#1a1a1a] text-gray-400' : 'bg-muted text-muted-foreground'}`}>
            将生成 {selectedScenes.length} 个场景 x {count} 张 = <span className={isGold ? 'text-[#d4af37] font-medium' : 'text-primary font-medium'}>{selectedScenes.length * count} 张</span> 品牌构件
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || selectedScenes.length === 0}
            className={`w-full py-2.5 rounded font-medium text-sm flex items-center justify-center gap-2 ${
              isGold
                ? 'bg-[#d4af37] text-black hover:bg-[#d4af37]/80'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            } disabled:opacity-50 transition-colors`}
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
            <div className="space-y-2">
              <div className={`text-xs font-medium ${textC}`}>生成结果</div>
              {results.map((r, i) => (
                <div key={i} className="flex gap-3 p-2 rounded border border-border bg-muted/30">
                  {r.url ? (
                    <img
                      src={r.url}
                      alt={r.scene}
                      className="w-20 h-20 object-cover rounded border border-border"
                    />
                  ) : (
                    <div className={`w-20 h-20 rounded flex items-center justify-center ${
                      generating ? 'animate-pulse' : ''
                    } ${isGold ? 'bg-[#2a2a2a]' : 'bg-muted'}`}>
                      {generating ? (
                        <Loader2 className={`w-5 h-5 animate-spin ${isGold ? 'text-[#d4af37]' : 'text-primary'}`} />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-medium ${textC}`}>
                      {SCENE_TYPES.find(s => s.id === r.scene)?.icon} {SCENE_TYPES.find(s => s.id === r.scene)?.name || r.scene}
                    </div>
                    <p className={`text-xs mt-0.5 ${isGold ? 'text-gray-500' : 'text-muted-foreground'} line-clamp-3`}>
                      {r.prompt}
                    </p>
                    {r.url && (
                      <button
                        onClick={() => navigator.clipboard.writeText(r.prompt)}
                        className="mt-1 text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
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
                  className={`w-full py-2 rounded text-sm font-medium border transition-colors ${
                    isGold
                      ? 'border-[#d4af37] text-[#d4af37] hover:bg-[#d4af37]/10'
                      : 'border-primary text-primary hover:bg-primary/5'
                  }`}
                >
                  添加到画布
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
    const interval = setInterval(readModel, 2000); // 定期同步
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
        <Loader2 className={`w-5 h-5 animate-spin ${isGold ? 'text-[#d4af37]' : 'text-primary'}`} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className={`w-4 h-4 ${accentC}`} />
          <span className={`text-sm font-medium ${textC}`}>品牌构件</span>
        </div>
        <button
          onClick={handleCreate}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs ${
            isGold ? 'bg-[#d4af37]/15 text-[#d4af37] hover:bg-[#d4af37]/25' : 'bg-primary/10 text-primary hover:bg-primary/20'
          } transition-colors`}
        >
          <Plus className="w-3 h-3" />
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
            <div className={`text-center py-8 ${isGold ? 'text-gray-600' : 'text-muted-foreground'}`}>
              <Palette className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">尚未创建品牌套件</p>
              <p className="text-xs mt-1">创建品牌套件后可批量生成品牌构件</p>
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
              className={`w-full py-2.5 rounded text-sm font-medium flex items-center justify-center gap-2 ${
                isGold
                  ? 'bg-[#d4af37] text-black hover:bg-[#d4af37]/80'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              } transition-colors`}
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
