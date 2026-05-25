'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Sparkles, Copy, Image as ImageIcon, Download, Loader2,
  ChevronDown, ChevronUp, RefreshCw, Star, Cpu, Wand2,
  Check, Shuffle, Trash2, Clock, Plus,
} from 'lucide-react';

interface StyleSubCategory { id: string; name: string; prompt: string; }
interface StyleCategory { id: string; name: string; subStyles: StyleSubCategory[]; }
interface SceneOption { id: string; name: string; description: string; }
interface DesignPlan {
  title: string; stylePositioning: string; glyphFeatures: string;
  strokeAdvice: string; graphicFusion: string; colorMaterial: string;
  applicableScene: string; recommendIndex: number;
}
interface ImageModel { id: string; name: string; providerId: string; providerName: string; }
interface HistoryItem {
  id: string; text: string; scene: string; style: string;
  prompt: string; imageUrl?: string; createdAt: string;
}

interface FontDesignPanelProps {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[]) => void;
}

const RANDOM_EXAMPLES = [
  '好好养自己', '无界AI', '门槛', '大梦一场', '破晓',
  '云上书屋', '万物生长', '山海经', '一杯春', '月半小夜曲',
  '浮生六记', '食光食堂', '如故', '一念之间', '潮汐',
];

const RATIO_OPTIONS = [
  { id: '16:9', name: '横版 16:9', icon: '▬' },
  { id: '1:1', name: '正方形 1:1', icon: '▣' },
  { id: '9:16', name: '竖版 9:16', icon: '▮' },
  { id: 'logo', name: '透明Logo', icon: '◇' },
];

const COLOR_OPTIONS = [
  { id: '白色', color: '#ffffff', border: '#888' },
  { id: '黑色', color: '#1a1a1a', border: '#555' },
  { id: '金色', color: '#d4af37', border: '#d4af37' },
  { id: '红色', color: '#dc2626', border: '#dc2626' },
  { id: '黑金', color: 'linear-gradient(135deg,#1a1a1a,#d4af37)', border: '#d4af37' },
  { id: '红金', color: 'linear-gradient(135deg,#dc2626,#d4af37)', border: '#d4af37' },
  { id: '银色', color: '#c0c0c0', border: '#999' },
  { id: '渐变', color: 'linear-gradient(135deg,#667eea,#764ba2)', border: '#764ba2' },
  { id: '霓虹蓝', color: '#00d4ff', border: '#00d4ff' },
  { id: '暖橙', color: '#f97316', border: '#f97316' },
];

const BACKGROUND_OPTIONS = ['纯色背景', '透明背景', '高级留白', '商业KV背景', '暗黑背景', '黑金背景'];

export default function FontDesignPanel({ isMonochrome = false, onClose, onAddImages }: FontDesignPanelProps) {
  const [text, setText] = useState('好好养自己');
  const [scene, setScene] = useState('KV主标题');
  const [primaryStyleCategory, setPrimaryStyleCategory] = useState('smart-recommend');
  const [secondaryStyle, setSecondaryStyle] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [ratio, setRatio] = useState('16:9');
  const [color, setColor] = useState('黑金');
  const [background, setBackground] = useState('高级留白');
  const [material, setMaterial] = useState('平面矢量');
  const [strokeOptions, setStrokeOptions] = useState<string[]>([]);
  const [graphicElements, setGraphicElements] = useState<string[]>([]);
  const [jimengEnhanced, setJimengEnhanced] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [activeTab, setActiveTab] = useState<'plans' | 'prompt' | 'images' | 'history'>('plans');
  const [plans, setPlans] = useState<DesignPlan[]>([]);
  const [prompts, setPrompts] = useState<{ prompt: string; shortPrompt: string; enhancedPrompt: string; blackOnWhitePrompt: string; transparentLogoPrompt: string } | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageTaskId, setImageTaskId] = useState<string | null>(null);

  const [styleCategories, setStyleCategories] = useState<StyleCategory[]>([]);
  const [scenes, setScenes] = useState<SceneOption[]>([]);
  const [strokeOptionList, setStrokeOptionList] = useState<{ id: string; name: string }[]>([]);
  const [graphicOptionList, setGraphicOptionList] = useState<{ id: string; name: string }[]>([]);
  const [materialList, setMaterialList] = useState<{ id: string; name: string }[]>([]);
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [copiedToast, setCopiedToast] = useState<string | null>(null);

  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetch('/api/font-design/plan')
      .then(r => r.json())
      .then(data => {
        if (data.styleCategories) setStyleCategories(data.styleCategories);
        if (data.scenes) setScenes(data.scenes);
        if (data.strokeOptions) setStrokeOptionList(data.strokeOptions);
        if (data.graphicElements) setGraphicOptionList(data.graphicElements);
        if (data.materials) setMaterialList(data.materials);
      })
      .catch(() => {});

    fetch('/api/models?type=image')
      .then(r => r.json())
      .then(data => {
        const models: ImageModel[] = (data.models || []).map((m: { id: string; name: string; providerId: string }) => ({
          id: m.id, name: m.name, providerId: m.providerId, providerName: m.providerId,
        }));
        setImageModels(models);
        if (models.length > 0 && !selectedModel) setSelectedModel(models[0].id);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!imageTaskId || !isGeneratingImage) return;
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/poll-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: imageTaskId, model: selectedModel }),
        });
        const data = await res.json();
        if (data.status === 'completed') {
          const urls = data.result?.directImageUrls || (data.imageUrl ? [data.imageUrl] : []);
          setGeneratedImages(prev => [...prev, ...urls]);
          setIsGeneratingImage(false);
          setImageTaskId(null);
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        } else if (data.status === 'failed') {
          setIsGeneratingImage(false);
          setImageTaskId(null);
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      } catch { /* continue polling */ }
    }, 3000);
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, [imageTaskId, isGeneratingImage, selectedModel]);

  const handleRandomExample = useCallback(() => {
    setText(RANDOM_EXAMPLES[Math.floor(Math.random() * RANDOM_EXAMPLES.length)]);
  }, []);

  const toggleStroke = useCallback((name: string) => {
    setStrokeOptions(prev => prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]);
  }, []);

  const toggleGraphic = useCallback((name: string) => {
    setGraphicElements(prev => prev.includes(name) ? prev.filter(g => g !== name) : [...prev, name]);
  }, []);

  const showToast = useCallback((msg: string) => {
    setCopiedToast(msg);
    setTimeout(() => setCopiedToast(null), 2000);
  }, []);

  const copyToClipboard = useCallback(async (content: string, label: string) => {
    try { await navigator.clipboard.writeText(content); showToast(`${label}已复制`); }
    catch { showToast('复制失败'); }
  }, [showToast]);

  const handleGeneratePlans = useCallback(async () => {
    if (!text.trim()) return;
    setIsGeneratingPlan(true);
    setActiveTab('plans');
    try {
      const res = await fetch('/api/font-design/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, scene, primaryStyleCategory, secondaryStyle,
          ratio: RATIO_OPTIONS.find(r => r.id === ratio)?.name || ratio,
          color, background, strokeOptions, graphicElements, material, jimengEnhanced,
        }),
      });
      const data = await res.json();
      if (data.error) { showToast(data.error); return; }
      setPlans(data.plans || []);
      setPrompts({ prompt: data.prompt || '', shortPrompt: data.shortPrompt || '', enhancedPrompt: data.enhancedPrompt || '', blackOnWhitePrompt: data.shortPrompt || '', transparentLogoPrompt: '' });
    } catch { showToast('生成方案失败'); }
    finally { setIsGeneratingPlan(false); }
  }, [text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced, showToast]);

  const handleGeneratePrompt = useCallback(async () => {
    if (!text.trim()) return;
    setIsGeneratingPrompt(true);
    setActiveTab('prompt');
    try {
      const res = await fetch('/api/font-design/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, scene, primaryStyleCategory, secondaryStyle,
          ratio: RATIO_OPTIONS.find(r => r.id === ratio)?.name || ratio,
          color, background, strokeOptions, graphicElements, material, jimengEnhanced,
        }),
      });
      const data = await res.json();
      if (data.error) { showToast(data.error); return; }
      setPrompts({ prompt: data.prompt || '', shortPrompt: data.shortPrompt || '', enhancedPrompt: data.enhancedPrompt || '', blackOnWhitePrompt: data.blackOnWhitePrompt || '', transparentLogoPrompt: data.transparentLogoPrompt || '' });
    } catch { showToast('生成提示词失败'); }
    finally { setIsGeneratingPrompt(false); }
  }, [text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced, showToast]);

  const handleGenerateImage = useCallback(async (mode: 'full' | 'black-on-white' | 'transparent-logo' = 'full') => {
    if (!text.trim()) return;
    setIsGeneratingImage(true);
    setGeneratedImages([]);
    setActiveTab('images');
    try {
      const res = await fetch('/api/font-design/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, scene, primaryStyleCategory, secondaryStyle,
          ratio: mode === 'transparent-logo' ? '1:1' : ratio,
          color, background, strokeOptions, graphicElements, material, jimengEnhanced,
          model: selectedModel, mode, count: 1,
        }),
      });
      const data = await res.json();
      if (data.error) { showToast(data.error); setIsGeneratingImage(false); return; }
      setImageTaskId(data.taskId);
      if (data.prompt) {
        setPrompts(prev => prev ? { ...prev, prompt: data.prompt } : { prompt: data.prompt, shortPrompt: '', enhancedPrompt: '', blackOnWhitePrompt: '', transparentLogoPrompt: '' });
      }
      setHistory(prev => [{ id: `h-${Date.now()}`, text, scene, style: secondaryStyle || primaryStyleCategory, prompt: data.prompt || '', createdAt: new Date().toLocaleString() }, ...prev]);
    } catch { showToast('生成图片失败'); setIsGeneratingImage(false); }
  }, [text, scene, primaryStyleCategory, secondaryStyle, ratio, color, background, strokeOptions, graphicElements, material, jimengEnhanced, selectedModel, showToast]);

  const handleAddToCanvas = useCallback((url: string) => { onAddImages?.([url]); }, [onAddImages]);

  const currentCategory = styleCategories.find(c => c.id === primaryStyleCategory);
  const goldColor = isMonochrome ? '#3b82f6' : '#d4af37';
  const panelBg = isMonochrome ? 'bg-white' : 'bg-[#0a0a0a]/95';
  const cardBg = isMonochrome ? 'bg-gray-50' : 'bg-[#141414]';
  const borderColor = isMonochrome ? 'border-gray-200' : 'border-[#2a2a2a]';
  const textColor = isMonochrome ? 'text-gray-900' : 'text-[#f5f5f5]';
  const subTextColor = isMonochrome ? 'text-gray-500' : 'text-[#a1a1aa]';

  const chipCls = (active: boolean) => active
    ? isMonochrome ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-[#d4af37]/15 border-[#d4af37]/50 text-[#d4af37]'
    : `${cardBg} ${borderColor} ${subTextColor} hover:border-[#d4af37]/30`;

  const subChipCls = (active: boolean) => active
    ? isMonochrome ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-[#d4af37]/10 border-[#d4af37]/40 text-[#d4af37]'
    : `${cardBg} ${borderColor} ${subTextColor} hover:border-[#d4af37]/20`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-auto">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative ${panelBg} backdrop-blur-xl border ${borderColor} rounded-2xl shadow-2xl flex overflow-hidden`}
        style={{ width: '1180px', height: '740px', maxWidth: '95vw', maxHeight: '90vh' }}
        onWheel={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>

        {/* Left Panel */}
        <div className={`w-[38%] flex flex-col border-r ${borderColor} overflow-hidden`}>
          <div className={`px-5 py-4 border-b ${borderColor} flex items-center justify-between`}>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold" style={{ color: goldColor }}>字</span>
                <h2 className={`text-base font-bold ${textColor}`}>字境大师 Pro</h2>
              </div>
              <p className={`text-[11px] mt-0.5 ${subTextColor}`}>中文标题字 / KV文字 / 封面字 / 文字Logo 设计器</p>
            </div>
            <button onClick={onClose} className={`p-1.5 rounded-lg ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10'} transition-colors`}>
              <X className="h-4 w-4" style={{ color: goldColor }} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" style={{ scrollbarWidth: 'thin' }}>
            {/* Text Input */}
            <div>
              <label className={`text-xs font-medium ${subTextColor} mb-1.5 block`}>输入要设计的中文文字</label>
              <div className="flex gap-2">
                <input type="text" value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="请输入中文标题、活动主题、封面标题或文字Logo名称"
                  className={`flex-1 px-3 py-2 rounded-lg text-sm ${cardBg} border ${borderColor} ${textColor} placeholder:${subTextColor} focus:outline-none focus:ring-1`}
                  style={{ '--tw-ring-color': goldColor } as React.CSSProperties} maxLength={20} />
                <button onClick={handleRandomExample}
                  className={`px-2.5 py-2 rounded-lg text-xs border ${borderColor} ${isMonochrome ? 'hover:bg-gray-100 text-blue-600' : 'hover:bg-white/10'} transition-colors`}
                  style={{ color: goldColor }} title="随机示例">
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Scene */}
            <div>
              <label className={`text-xs font-medium ${subTextColor} mb-1.5 block`}>使用场景</label>
              <div className="flex flex-wrap gap-1.5">
                {scenes.map((s) => (
                  <button key={s.id} onClick={() => setScene(s.name)}
                    className={`px-2.5 py-1.5 rounded-md text-[11px] border transition-all ${chipCls(scene === s.name)}`}>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Style */}
            <div>
              <label className={`text-xs font-medium ${subTextColor} mb-1.5 block`}>字体风格</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {styleCategories.map((cat) => (
                  <button key={cat.id} onClick={() => { setPrimaryStyleCategory(cat.id); setSecondaryStyle(cat.subStyles[0]?.name || ''); }}
                    className={`px-2.5 py-1 rounded-md text-[11px] border transition-all ${chipCls(primaryStyleCategory === cat.id)}`}>
                    {cat.name}
                  </button>
                ))}
              </div>
              {currentCategory && (
                <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {currentCategory.subStyles.map((sub) => (
                    <button key={sub.id} onClick={() => setSecondaryStyle(sub.name)}
                      className={`px-2 py-1 rounded text-[10px] border transition-all ${subChipCls(secondaryStyle === sub.name)}`}>
                      {sub.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Model Selector */}
            <div ref={modelDropdownRef}>
              <label className={`text-xs font-medium ${subTextColor} mb-1.5 flex items-center gap-1.5`}>
                <Cpu className="h-3 w-3" /> 生图模型
              </label>
              <div className="relative">
                <button onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className={`w-full px-3 py-2 rounded-lg text-sm ${cardBg} border ${borderColor} ${textColor} flex items-center justify-between hover:border-[#d4af37]/30 transition-all`}>
                  <span className="truncate">{imageModels.find(m => m.id === selectedModel)?.name || selectedModel || '选择模型'}</span>
                  <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 ml-2" style={{ color: goldColor }} />
                </button>
                {showModelDropdown && (
                  <div className={`absolute top-full left-0 right-0 mt-1 ${cardBg} border ${borderColor} rounded-lg shadow-xl z-10 max-h-[200px] overflow-y-auto`} style={{ scrollbarWidth: 'thin' }}>
                    {imageModels.length === 0 && <div className={`px-3 py-2 text-xs ${subTextColor}`}>暂无可用模型，请在管理员后台配置</div>}
                    {imageModels.map((m) => (
                      <button key={m.id} onClick={() => { setSelectedModel(m.id); setShowModelDropdown(false); }}
                        className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors ${selectedModel === m.id ? (isMonochrome ? 'bg-blue-50' : 'bg-[#d4af37]/10') : (isMonochrome ? 'hover:bg-gray-50' : 'hover:bg-white/5')}`}>
                        {selectedModel === m.id && <Check className="h-3 w-3 flex-shrink-0" style={{ color: goldColor }} />}
                        <div className="flex-1 min-w-0">
                          <div className={`${textColor} truncate`}>{m.name}</div>
                          <div className={`${subTextColor} truncate`}>{m.providerName}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className={`text-[10px] mt-1 ${subTextColor}`}>模型由管理员后台统一配置管理</p>
            </div>

            {/* Advanced */}
            <div>
              <button onClick={() => setShowAdvanced(!showAdvanced)}
                className={`flex items-center gap-1.5 text-xs ${subTextColor} hover:text-[#d4af37] transition-colors`}>
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} 高级参数
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-3">
                  <div>
                    <label className={`text-[11px] ${subTextColor} mb-1 block`}>画面比例</label>
                    <div className="flex flex-wrap gap-1.5">
                      {RATIO_OPTIONS.map((r) => (
                        <button key={r.id} onClick={() => setRatio(r.id)}
                          className={`px-2 py-1 rounded text-[10px] border transition-all ${chipCls(ratio === r.id)}`}>
                          <span className="mr-1">{r.icon}</span>{r.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={`text-[11px] ${subTextColor} mb-1 block`}>字体颜色</label>
                    <div className="flex flex-wrap gap-1.5">
                      {COLOR_OPTIONS.map((c) => (
                        <button key={c.id} onClick={() => setColor(c.id)}
                          className={`w-6 h-6 rounded-full border-2 transition-all ${color === c.id ? 'ring-2 ring-offset-1 scale-110' : ''}`}
                          style={{ background: c.color, borderColor: c.border, '--tw-ring-color': goldColor, ringOffsetColor: isMonochrome ? '#fff' : '#0a0a0a' } as React.CSSProperties}
                          title={c.id} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={`text-[11px] ${subTextColor} mb-1 block`}>背景类型</label>
                    <div className="flex flex-wrap gap-1.5">
                      {BACKGROUND_OPTIONS.map((bg) => (
                        <button key={bg} onClick={() => setBackground(bg)}
                          className={`px-2 py-1 rounded text-[10px] border transition-all ${chipCls(background === bg)}`}>
                          {bg}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={`text-[11px] ${subTextColor} mb-1 block`}>笔画处理（多选）</label>
                    <div className="flex flex-wrap gap-1">
                      {strokeOptionList.map((s) => (
                        <button key={s.id} onClick={() => toggleStroke(s.name)}
                          className={`px-2 py-1 rounded text-[10px] border transition-all ${subChipCls(strokeOptions.includes(s.name))}`}>
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={`text-[11px] ${subTextColor} mb-1 block`}>图形融合（多选）</label>
                    <div className="flex flex-wrap gap-1">
                      {graphicOptionList.map((g) => (
                        <button key={g.id} onClick={() => toggleGraphic(g.name)}
                          className={`px-2 py-1 rounded text-[10px] border transition-all ${subChipCls(graphicElements.includes(g.name))}`}>
                          {g.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={`text-[11px] ${subTextColor} mb-1 block`}>字体质感</label>
                    <div className="flex flex-wrap gap-1">
                      {materialList.map((m) => (
                        <button key={m.id} onClick={() => setMaterial(m.name)}
                          className={`px-2 py-1 rounded text-[10px] border transition-all ${chipCls(material === m.name)}`}>
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] ${subTextColor}`}>即梦增强模式</span>
                    <button onClick={() => setJimengEnhanced(!jimengEnhanced)}
                      className={`w-9 h-5 rounded-full transition-all relative ${jimengEnhanced ? (isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]') : (isMonochrome ? 'bg-gray-300' : 'bg-[#333]')}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${jimengEnhanced ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className={`px-4 py-3 border-t ${borderColor} space-y-2`}>
            <button onClick={handleGeneratePlans} disabled={isGeneratingPlan || !text.trim()}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: `linear-gradient(135deg, ${isMonochrome ? '#3b82f6' : '#d4af37'}, ${isMonochrome ? '#2563eb' : '#b8941f'})` }}>
              {isGeneratingPlan ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : <Sparkles className="h-4 w-4 inline mr-1" />}
              生成字体方案
            </button>
            <div className="flex gap-2">
              <button onClick={handleGeneratePrompt} disabled={isGeneratingPrompt || !text.trim()}
                className={`flex-1 py-2 rounded-lg text-[11px] border ${borderColor} ${isMonochrome ? 'text-blue-600 hover:bg-blue-50' : 'text-[#d4af37] hover:bg-[#d4af37]/10'} transition-all disabled:opacity-50`}>
                {isGeneratingPrompt ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : <Wand2 className="h-3 w-3 inline mr-1" />} 即梦提示词
              </button>
              <button onClick={() => handleGenerateImage('black-on-white')} disabled={isGeneratingImage || !text.trim()}
                className={`flex-1 py-2 rounded-lg text-[11px] border ${borderColor} ${isMonochrome ? 'text-blue-600 hover:bg-blue-50' : 'text-[#d4af37] hover:bg-[#d4af37]/10'} transition-all disabled:opacity-50`}>
                黑底白字
              </button>
              <button onClick={() => handleGenerateImage('full')} disabled={isGeneratingImage || !text.trim()}
                className={`flex-1 py-2 rounded-lg text-[11px] border ${borderColor} ${isMonochrome ? 'text-blue-600 hover:bg-blue-50' : 'text-[#d4af37] hover:bg-[#d4af37]/10'} transition-all disabled:opacity-50`}>
                {isGeneratingImage ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : <ImageIcon className="h-3 w-3 inline mr-1" />} 生图
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-[62%] flex flex-col overflow-hidden">
          <div className={`flex border-b ${borderColor}`}>
            {(['plans', 'prompt', 'images', 'history'] as const).map((tab) => {
              const labels: Record<string, string> = { plans: '设计方案', prompt: '即梦提示词', images: '生成图片', history: '历史记录' };
              return (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-3 text-xs font-medium transition-all relative ${activeTab === tab ? textColor : subTextColor}`}>
                  {labels[tab]}
                  {activeTab === tab && <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full" style={{ backgroundColor: goldColor }} />}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'thin' }}>
            {/* Plans Tab */}
            {activeTab === 'plans' && (
              <div className="space-y-3">
                {plans.length === 0 && !isGeneratingPlan && (
                  <div className={`text-center py-12 ${subTextColor}`}>
                    <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">输入文字并点击"生成字体方案"</p>
                    <p className="text-xs mt-1">系统将根据文字含义和风格偏好推荐设计方案</p>
                  </div>
                )}
                {isGeneratingPlan && (
                  <div className={`text-center py-12 ${subTextColor}`}>
                    <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" style={{ color: goldColor }} />
                    <p className="text-sm">正在分析文字含义，生成设计方案...</p>
                  </div>
                )}
                {plans.map((plan, idx) => (
                  <div key={idx} className={`${cardBg} border ${borderColor} rounded-xl p-4 relative overflow-hidden hover:border-[#d4af37]/30 transition-all`}
                    style={{ borderLeftWidth: '3px', borderLeftColor: goldColor }}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className={`text-sm font-bold ${textColor}`}>{plan.title}</h3>
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`h-3 w-3 ${i < plan.recommendIndex ? 'fill-current' : ''}`} style={{ color: i < plan.recommendIndex ? goldColor : '#444' }} />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {[{ label: '风格定位', value: plan.stylePositioning }, { label: '字形特点', value: plan.glyphFeatures }, { label: '笔画处理', value: plan.strokeAdvice }, { label: '图形融合', value: plan.graphicFusion }, { label: '色彩质感', value: plan.colorMaterial }, { label: '适用场景', value: plan.applicableScene }].map((item) => (
                        <div key={item.label} className="flex text-[11px]">
                          <span className={`${subTextColor} w-16 flex-shrink-0`}>{item.label}</span>
                          <span className={`${textColor} flex-1`}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => copyToClipboard(JSON.stringify(plan), '方案')}
                        className={`px-2 py-1 rounded text-[10px] border ${borderColor} ${isMonochrome ? 'text-blue-600 hover:bg-blue-50' : 'text-[#d4af37] hover:bg-[#d4af37]/10'} transition-all`}>
                        <Copy className="h-3 w-3 inline mr-1" />复制
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Prompt Tab */}
            {activeTab === 'prompt' && (
              <div className="space-y-4">
                {!prompts && !isGeneratingPrompt && (
                  <div className={`text-center py-12 ${subTextColor}`}>
                    <Wand2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">输入文字并点击"即梦提示词"生成</p>
                  </div>
                )}
                {isGeneratingPrompt && (
                  <div className={`text-center py-12 ${subTextColor}`}>
                    <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" style={{ color: goldColor }} />
                    <p className="text-sm">正在生成即梦提示词...</p>
                  </div>
                )}
                {prompts && (
                  <>
                    {[
                      { label: '完整提示词', content: prompts.prompt, copyKey: '完整提示词' },
                      { label: '精简版', content: prompts.shortPrompt, copyKey: '精简版' },
                      { label: '增强版（即梦增强模式）', content: prompts.enhancedPrompt, copyKey: '增强版' },
                    ].map((section) => (
                      <div key={section.label}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-xs font-medium ${textColor}`}>{section.label}</span>
                          <button onClick={() => copyToClipboard(section.content, section.copyKey)}
                            className={`text-[10px] ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'}`}>
                            <Copy className="h-3 w-3 inline mr-0.5" />复制
                          </button>
                        </div>
                        <div className={`${cardBg} border ${borderColor} rounded-lg p-3 text-[11px] ${textColor} whitespace-pre-wrap max-h-[140px] overflow-y-auto`} style={{ scrollbarWidth: 'thin' }}>
                          {section.content}
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => handleGenerateImage('full')} disabled={isGeneratingImage}
                        className="px-3 py-2 rounded-lg text-xs text-black font-medium transition-all disabled:opacity-50"
                        style={{ background: `linear-gradient(135deg, ${isMonochrome ? '#3b82f6' : '#d4af37'}, ${isMonochrome ? '#2563eb' : '#b8941f'})` }}>
                        <ImageIcon className="h-3.5 w-3.5 inline mr-1" />发送到图像生成
                      </button>
                      <button onClick={() => handleGenerateImage('black-on-white')} disabled={isGeneratingImage}
                        className={`px-3 py-2 rounded-lg text-xs border ${borderColor} ${isMonochrome ? 'text-blue-600 hover:bg-blue-50' : 'text-[#d4af37] hover:bg-[#d4af37]/10'} transition-all disabled:opacity-50`}>
                        黑底白字测试
                      </button>
                      <button onClick={() => handleGenerateImage('transparent-logo')} disabled={isGeneratingImage}
                        className={`px-3 py-2 rounded-lg text-xs border ${borderColor} ${isMonochrome ? 'text-blue-600 hover:bg-blue-50' : 'text-[#d4af37] hover:bg-[#d4af37]/10'} transition-all disabled:opacity-50`}>
                        透明Logo版
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Images Tab */}
            {activeTab === 'images' && (
              <div className="space-y-4">
                {generatedImages.length === 0 && !isGeneratingImage && (
                  <div className={`text-center py-12 ${subTextColor}`}>
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">点击"生图"或"发送到图像生成"生成字体设计图片</p>
                  </div>
                )}
                {isGeneratingImage && (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" style={{ color: goldColor }} />
                      <p className={`text-sm ${subTextColor}`}>正在生成字体设计图片，请耐心等待...</p>
                      <p className={`text-xs mt-1 ${subTextColor}`}>通常需要15-60秒</p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {generatedImages.map((url, idx) => (
                    <div key={idx} className={`${cardBg} border ${borderColor} rounded-xl overflow-hidden group relative`}>
                      <img src={url} alt={`字体设计 ${idx + 1}`} className="w-full aspect-video object-cover" crossOrigin="anonymous" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button onClick={() => handleAddToCanvas(url)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-black" style={{ background: goldColor }}>
                          <Plus className="h-3 w-3 inline mr-1" />加入画布
                        </button>
                        <button onClick={() => { const a = document.createElement('a'); a.href = url; a.download = `font-design-${idx + 1}.png`; a.click(); }}
                          className="px-3 py-1.5 rounded-lg text-xs border border-white/30 text-white hover:bg-white/10 transition-all">
                          <Download className="h-3 w-3 inline mr-1" />下载
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {generatedImages.length > 0 && (
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => handleGenerateImage('full')} disabled={isGeneratingImage}
                      className={`px-3 py-2 rounded-lg text-xs border ${borderColor} ${isMonochrome ? 'text-blue-600' : 'text-[#d4af37]'} transition-all`}>
                      <RefreshCw className="h-3 w-3 inline mr-1" />重新生成
                    </button>
                    <button onClick={() => onAddImages?.(generatedImages)}
                      className="px-3 py-2 rounded-lg text-xs text-black font-medium" style={{ background: goldColor }}>
                      <Plus className="h-3 w-3 inline mr-1" />全部加入画布
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <div className="space-y-2">
                {history.length === 0 && (
                  <div className={`text-center py-12 ${subTextColor}`}>
                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">暂无历史记录</p>
                    <p className="text-xs mt-1">生成图片后自动记录</p>
                  </div>
                )}
                {history.map((item) => (
                  <div key={item.id} className={`${cardBg} border ${borderColor} rounded-lg p-3 flex items-center gap-3 group`}>
                    <div className={`w-12 h-12 rounded ${isMonochrome ? 'bg-gray-100' : 'bg-[#1c1c1c]'} flex items-center justify-center flex-shrink-0`}>
                      <ImageIcon className="h-4 w-4 opacity-30" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium ${textColor} truncate`}>{item.text}</div>
                      <div className={`text-[10px] ${subTextColor}`}>{item.scene} · {item.style}</div>
                      <div className={`text-[10px] ${subTextColor}`}>{item.createdAt}</div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setText(item.text); setScene(item.scene); }}
                        className={`p-1.5 rounded ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10'}`} title="再次生成">
                        <RefreshCw className="h-3 w-3" style={{ color: goldColor }} />
                      </button>
                      {item.prompt && (
                        <button onClick={() => copyToClipboard(item.prompt, '提示词')}
                          className={`p-1.5 rounded ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10'}`} title="复制提示词">
                          <Copy className="h-3 w-3" style={{ color: goldColor }} />
                        </button>
                      )}
                      <button onClick={() => setHistory(prev => prev.filter(h => h.id !== item.id))}
                        className={`p-1.5 rounded ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/10'}`} title="删除">
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {copiedToast && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-xs font-medium text-black shadow-lg z-50" style={{ background: goldColor }}>
            <Check className="h-3 w-3 inline mr-1" />{copiedToast}
          </div>
        )}
      </div>
    </div>
  );
}
