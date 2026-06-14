'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Store, X, Upload, ChevronDown, Download, Plus, Trash2,
  Sparkles, Eye, Layers, Box, Palette, Ruler, Settings2,
  Camera, RotateCw, Grid3x3, FileText, BarChart3,
  CheckSquare, Square, Send, AlertTriangle, FolderOpen,
  Maximize2, Image, ZoomIn, ChevronRight, Wand2
} from 'lucide-react';

// === Types ===
type Display3DSceneType = 'pop-up' | 'exhibition' | 'supermarket' | 'window' | 'check-in' | 'mall-atrium' | 'flagship' | 'product-display';
type ImageUsageMode = 'texture_mapping' | 'style_extension' | 'structure_reference';

interface Display3DDimensions {
  length: number;
  width: number;
  height: number;
  unit: string;
}

interface Display3DResult {
  id: string;
  type: string;
  url: string;
  label?: string;
  prompt?: string;
}

interface DecompositionComponent {
  id: string;
  name: string;
  material: string;
  craft: string;
  quantity: number;
  estimatedPrice: number;
  dimensions?: string;
}

interface Display3DDecomposition {
  components: DecompositionComponent[];
  totalEstimate: number;
  layoutNotes?: string;
}

interface Display3DProject {
  id: string;
  name: string;
  brandName: string;
  createdAt: string;
}

// === Scene Preset Library ===
const SCENE_PRESETS = [
  { id: 'pop-up', label: '快闪店', icon: '🏪', desc: '临时品牌快闪空间' },
  { id: 'exhibition', label: '展厅', icon: '🏛️', desc: '品牌长期展厅' },
  { id: 'supermarket', label: '商超端架', icon: '🛒', desc: '超市端架/堆头' },
  { id: 'window', label: '橱窗', icon: '🪟', desc: '品牌橱窗陈列' },
  { id: 'check-in', label: '打卡区', icon: '📸', desc: '互动打卡装置' },
  { id: 'mall-atrium', label: '中庭', icon: '🏬', desc: '商场中庭大场景' },
  { id: 'flagship', label: '旗舰店', icon: '🏢', desc: '品牌旗舰店空间' },
  { id: 'product-display', label: '产品展台', icon: '🎯', desc: '单品展示台面' },
];

// === Template Library ===
const TEMPLATES = [
  { id: 'pop-up-cosmetic', name: '美妆快闪', scene: 'pop-up', style: '现代简约' },
  { id: 'tea-exhibition', name: '茶叶展厅', scene: 'exhibition', style: '新中式' },
  { id: 'food-supermarket', name: '食品端架', scene: 'supermarket', style: '活力鲜艳' },
  { id: 'luxury-window', name: '奢侈品橱窗', scene: 'window', style: '高端极简' },
  { id: 'tech-flagship', name: '科技旗舰店', scene: 'flagship', style: '未来科技' },
];

// === Color Scheme: Cool Tech/Architecture (Deep Navy + Steel Gold) ===
const BG = 'rgb(14, 20, 32)';              // #0e1420 deep navy
const BG_CARD = 'rgb(20, 28, 44)';         // #141c2c dark navy card
const BG_INPUT = 'rgb(28, 38, 58)';        // #1c263a navy input
const BORDER = 'rgb(45, 60, 85)';          // #2d3c55 slate border
const BORDER_FOCUS = 'rgb(140, 170, 210)';  // #8caad2 steel blue focus
const ACCENT = 'rgb(170, 185, 210)';       // #aab9d2 steel silver-blue
const ACCENT_WARM = 'rgb(190, 170, 120)';  // #beaa78 cool gold
const ACCENT_GLOW = 'rgba(170, 185, 210, 0.12)';
const ACCENT_WARM_GLOW = 'rgba(190, 170, 120, 0.12)';
const TEXT_PRIMARY = 'rgb(220, 228, 240)';  // #dce4f0 cool white
const TEXT_SECONDARY = 'rgb(140, 160, 185)';// #8ca0b9 slate text
const TEXT_MUTED = 'rgb(80, 100, 125)';    // #50647d muted slate
const DANGER = 'rgb(200, 80, 80)';
const SUCCESS = 'rgb(80, 180, 80)';

// Monochrome scheme
const M_BG = 'rgb(255, 255, 255)';
const M_BG_CARD = 'rgb(248, 248, 250)';
const M_BG_INPUT = 'rgb(240, 240, 245)';
const M_BORDER = 'rgb(220, 220, 225)';
const M_ACCENT = 'rgb(59, 130, 246)';
const M_ACCENT_DIM = 'rgb(96, 165, 250)';
const M_TEXT_PRIMARY = 'rgb(15, 23, 42)';
const M_TEXT_SECONDARY = 'rgb(100, 116, 139)';
const M_TEXT_MUTED = 'rgb(148, 163, 184)';

// === Component ===
interface Display3DPanelProps {
  onClose: () => void;
  onAddImages: (urls: string[], meta?: Record<string, string>) => void;
  isMonochrome: boolean;
}

export default function Display3DPanel({ onClose, onAddImages, isMonochrome }: Display3DPanelProps) {
  // Drag
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Sidebar
  const [showSidebar, setShowSidebar] = useState(false);
  const [projects, setProjects] = useState<Display3DProject[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // Params
  const [brandName, setBrandName] = useState('');
  const [productName, setProductName] = useState('');
  const [sceneType, setSceneType] = useState<Display3DSceneType>('pop-up');
  const [environment, setEnvironment] = useState('indoor');
  const [dimensions, setDimensions] = useState<Display3DDimensions>({ length: 600, width: 400, height: 300, unit: 'cm' });
  const [imageUsageMode, setImageUsageMode] = useState<ImageUsageMode>('texture_mapping');
  const [materialStyle, setMaterialStyle] = useState('');
  const [lightingStyle, setLightingStyle] = useState('');
  const [budget, setBudget] = useState('');
  const [viewOptions, setViewOptions] = useState<string[]>(['front']);
  const [crowdStyle, setCrowdStyle] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');

  // Assets
  const [assets, setAssets] = useState<{ type: string; url: string; name: string }[]>([]);

  // Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Display3DResult[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [activeTab, setActiveTab] = useState(0);

  // Decomposition
  const [decomposition, setDecomposition] = useState<Display3DDecomposition | null>(null);
  const [isDecomposing, setIsDecomposing] = useState(false);

  // Preview
  const [selectedResult, setSelectedResult] = useState<Display3DResult | null>(null);

  // Color getter
  const c = useCallback((key: string) => {
    if (isMonochrome) {
      const m: Record<string, string> = { bg: M_BG, card: M_BG_CARD, input: M_BG_INPUT, border: M_BORDER, accent: M_ACCENT, accentDim: M_ACCENT_DIM, text: M_TEXT_PRIMARY, text2: M_TEXT_SECONDARY, text3: M_TEXT_MUTED, warmAccent: M_ACCENT };
      return m[key] || '';
    }
    const w: Record<string, string> = { bg: BG, card: BG_CARD, input: BG_INPUT, border: BORDER, accent: ACCENT, accentDim: ACCENT_WARM, text: TEXT_PRIMARY, text2: TEXT_SECONDARY, text3: TEXT_MUTED, warmAccent: ACCENT_WARM };
    return w[key] || '';
  }, [isMonochrome]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, button, [data-no-drag]')) return;
    dragOffset.current = { x: e.clientX - (panelRef.current?.offsetLeft || 0), y: e.clientY - (panelRef.current?.offsetTop || 0) };
    const handleMouseMove = (ev: MouseEvent) => {
      if (panelRef.current) {
        panelRef.current.style.left = `${ev.clientX - dragOffset.current.x}px`;
        panelRef.current.style.top = `${ev.clientY - dragOffset.current.y}px`;
      }
    };
    const handleMouseUp = () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Upload handler
  const handleUpload = useCallback((assetType: string) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const url = URL.createObjectURL(file);
        setAssets(prev => [...prev, { type: assetType, url, name: file.name }]);
      }
    };
    input.click();
  }, []);

  // Generate
  const handleGenerate = useCallback(async () => {
    if (!brandName.trim()) { setErrorMsg('请填写品牌名称'); return; }
    setErrorMsg(''); setIsGenerating(true); setProgress(10);
    try {
      const res = await fetch('/api/display-3d/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, productName, sceneType, environment, dimensions, imageUsageMode, materialStyle, lightingStyle, budget, viewOptions, crowdStyle, customPrompt }),
      });
      const data = await res.json();
      if (!data.success) { setErrorMsg(data.error || '生成失败'); setIsGenerating(false); return; }
      const taskId = data.taskId;
      setProgress(30);
      const poll = async () => {
        try {
          const pr = await fetch('/api/poll-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, model: '' }) });
          const pd = await pr.json();
          if (pd.status === 'completed') {
            const urls: string[] = pd.result?.imageUrls || [];
            if (urls.length > 0) {
              setResults(prev => [...prev, ...urls.map((u: string, i: number) => ({ id: `d3d_${Date.now()}_${i}`, type: viewOptions[i % viewOptions.length] || 'front', url: u }))] );
              onAddImages(urls);
            }
            setIsGenerating(false); setProgress(100); return;
          }
          if (pd.status === 'failed') { setErrorMsg(pd.error || '生成失败'); setIsGenerating(false); return; }
          setProgress(p => Math.min(p + 8, 90));
          setTimeout(poll, 2000);
        } catch { setErrorMsg('轮询出错'); setIsGenerating(false); }
      };
      setTimeout(poll, 2000);
    } catch { setErrorMsg('请求失败'); setIsGenerating(false); }
  }, [brandName, productName, sceneType, environment, dimensions, imageUsageMode, materialStyle, lightingStyle, budget, viewOptions, crowdStyle, customPrompt, onAddImages]);

  // Decompose
  const handleDecompose = useCallback(async () => {
    if (results.length === 0) { setErrorMsg('请先生成效果图'); return; }
    setErrorMsg(''); setIsDecomposing(true);
    try {
      const res = await fetch('/api/display-3d/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: results[0].url, sceneType, brandName, dimensions }),
      });
      const data = await res.json();
      if (!data.success) { setErrorMsg(data.error || '拆解失败'); setIsDecomposing(false); return; }
      const taskId = data.taskId;
      const poll = async () => {
        try {
          const pr = await fetch('/api/poll-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, model: '' }) });
          const pd = await pr.json();
          if (pd.status === 'completed') {
            const result = pd.result;
            if (result?.components) {
              setDecomposition({ components: result.components, totalEstimate: result.totalEstimate || 0, layoutNotes: result.layoutNotes });
            }
            setIsDecomposing(false); return;
          }
          if (pd.status === 'failed') { setErrorMsg(pd.error || '拆解失败'); setIsDecomposing(false); return; }
          setTimeout(poll, 2000);
        } catch { setErrorMsg('轮询出错'); setIsDecomposing(false); }
      };
      setTimeout(poll, 2000);
    } catch { setErrorMsg('请求失败'); setIsDecomposing(false); }
  }, [results, sceneType, brandName, dimensions]);

  // Export PDF
  const handleExportPdf = useCallback(async () => {
    if (results.length === 0) return;
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls: results.map(r => r.url), brandName, projectName: `${brandName} 3D展陈方案` }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${brandName}_展陈方案.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { setErrorMsg('PDF导出失败'); }
  }, [results, brandName]);

  // Export BOM
  const handleExportBom = useCallback(async () => {
    if (!decomposition) return;
    try {
      const res = await fetch('/api/export/bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bomItems: decomposition.components.map(c => ({ name: c.name, count: c.quantity, material: c.material, craft: c.craft, estimatedPrice: c.estimatedPrice })), brandName, projectName: `${brandName} 展陈方案` }),
      });
      const data = await res.json();
      if (data.csv) {
        const blob = new Blob(['\uFEFF' + data.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${brandName}_BOM清单.csv`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch { setErrorMsg('BOM导出失败'); }
  }, [decomposition, brandName]);

  // Export Annotation
  const handleExportAnnotation = useCallback(async () => {
    if (results.length === 0) return;
    try {
      await fetch('/api/export/annotation-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: results[0].url, brandName }),
      });
    } catch { /* annotation is async, results come via polling */ }
  }, [results, brandName]);

  // Send to canvas
  const handleSendToCanvas = useCallback(async (imageUrls: string[]) => {
    try {
      await fetch('/api/export/to-canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls, brandName, projectName: `${brandName} 展陈方案` }),
      });
      onAddImages(imageUrls);
    } catch { setErrorMsg('发送到画布失败'); }
  }, [brandName, onAddImages]);

  // Download
  const handleDownloadImage = useCallback(async (url: string, filename: string) => {
    try {
      const res = await fetch(url); const blob = await res.blob(); const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = blobUrl; a.download = filename; a.click(); URL.revokeObjectURL(blobUrl);
    } catch { setErrorMsg('下载失败'); }
  }, []);

  // Steps
  const steps = [
    { label: '资产上传', icon: <Upload size={16} /> },
    { label: '场景设置', icon: <Store size={16} /> },
    { label: '环境尺寸', icon: <Ruler size={16} /> },
    { label: '输出视角', icon: <Camera size={16} /> },
  ];

  const viewLabels = [
    { key: 'front', label: '正面' },
    { key: 'side', label: '侧面' },
    { key: 'top', label: '俯视' },
    { key: 'back', label: '背面' },
    { key: '45deg', label: '45度角' },
    { key: 'detail', label: '细节特写' },
  ];

  const assetTypes = ['主视觉KV', '背板图', '门头图', '地贴图', '海报图', '包装图', 'Logo', 'IP形象', '3D截图', '效果图'];

  // Render
  return createPortal(
    <div
      ref={panelRef}
      onMouseDown={handleMouseDown}
      className="fixed z-[200] shadow-2xl"
      style={{
        left: '80px', top: '50px',
        width: '92vw', maxWidth: '1280px',
        height: '82vh', maxHeight: '820px',
        borderRadius: '12px',
        overflow: 'hidden',
        display: 'flex',
        background: c('bg'),
        border: `1px solid ${isMonochrome ? M_BORDER : 'rgba(170,185,210,0.15)'}`,
      }}
    >
      {/* === Sidebar === */}
      {showSidebar && (
        <div
          style={{ width: '220px', minWidth: '220px', background: isMonochrome ? M_BG_CARD : 'rgb(16,22,36)', borderRight: `1px solid ${c('border')}` }}
          className="flex flex-col overflow-hidden" data-no-drag
        >
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${c('border')}` }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: c('text') }}>项目库</div>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ padding: '8px 10px' }}>
            {projects.length === 0 && <div style={{ fontSize: '12px', color: c('text3'), textAlign: 'center', padding: '20px 0' }}>暂无项目</div>}
            {projects.map(p => (
              <div key={p.id} style={{ padding: '8px 10px', borderRadius: '8px', marginBottom: '4px', cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = isMonochrome ? M_BG_INPUT : 'rgb(28,38,58)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: c('text') }}>{p.name}</div>
                <div style={{ fontSize: '11px', color: c('text3') }}>{new Date(p.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 10px', borderTop: `1px solid ${c('border')}` }}>
            <button onClick={() => setShowTemplates(!showTemplates)}
              style={{ width: '100%', padding: '8px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: c('warmAccent'), background: isMonochrome ? M_BG_INPUT : 'rgb(28,38,58)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles size={14} /> 模板库
            </button>
            {showTemplates && (
              <div style={{ marginTop: '6px' }}>
                {TEMPLATES.map(t => (
                  <div key={t.id}
                    style={{ padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: c('text2'), marginBottom: '2px', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = isMonochrome ? M_BG_INPUT : 'rgb(28,38,58)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => { setSceneType(t.scene as Display3DSceneType); setShowTemplates(false); }}
                  >
                    <span style={{ color: c('warmAccent'), fontWeight: 600 }}>{t.name}</span>
                    <span style={{ marginLeft: '6px', color: c('text3') }}>{t.style}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === Left Column: Form === */}
      <div style={{ width: '380px', minWidth: '340px', borderRight: `1px solid ${c('border')}`, display: 'flex', flexDirection: 'column' }} data-no-drag>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${c('border')}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isMonochrome ? M_BG_CARD : 'rgb(16,22,36)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setShowSidebar(s => !s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c('warmAccent'), padding: '2px' }} title="项目库">
              <FolderOpen size={18} />
            </button>
            <Store size={20} style={{ color: c('warmAccent') }} />
            <span style={{ fontSize: '17px', fontWeight: 800, color: c('text'), letterSpacing: '0.5px' }}>3D 展陈系统 Pro</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c('text3') }}><X size={18} /></button>
        </div>

        {/* Step Tabs */}
        <div style={{ display: 'flex', padding: '8px 12px', gap: '2px', borderBottom: `1px solid ${c('border')}`, flexWrap: 'wrap' }}>
          {steps.map((s, i) => (
            <button key={i} onClick={() => setActiveStep(i)}
              style={{
                padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                color: activeStep === i ? c('warmAccent') : c('text3'),
                background: activeStep === i ? (isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_WARM_GLOW) : 'transparent',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.15s',
              }}
            >{s.icon} {s.label}</button>
          ))}
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '16px 18px' }}>
          {/* Step 0: Asset Upload */}
          {activeStep === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Upload size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('warmAccent') }} />
                资产上传
              </div>
              <div style={{ fontSize: '13px', color: c('text3'), marginBottom: '4px' }}>上传展陈所需素材，AI 将智能应用到场景</div>

              {/* Image Usage Mode */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '6px' }}>图像使用模式</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {([
                    { mode: 'texture_mapping' as ImageUsageMode, label: '贴图应用', desc: '作为展陈贴图' },
                    { mode: 'style_extension' as ImageUsageMode, label: '风格延展', desc: '提取风格元素' },
                    { mode: 'structure_reference' as ImageUsageMode, label: '结构参考', desc: '参考空间结构' },
                  ]).map(item => (
                    <button key={item.mode} onClick={() => setImageUsageMode(item.mode)}
                      style={{
                        flex: 1, padding: '8px 6px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center',
                        background: imageUsageMode === item.mode ? (isMonochrome ? 'rgba(59,130,246,0.15)' : ACCENT_WARM_GLOW) : c('input'),
                        border: `1px solid ${imageUsageMode === item.mode ? c('warmAccent') : c('border')}`,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: 700, color: imageUsageMode === item.mode ? c('warmAccent') : c('text2') }}>{item.label}</div>
                      <div style={{ fontSize: '11px', color: c('text3'), marginTop: '2px' }}>{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Asset Upload Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                {assetTypes.map(type => {
                  const existing = assets.filter(a => a.type === type);
                  return (
                    <button key={type} onClick={() => handleUpload(type)}
                      style={{
                        padding: '8px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center',
                        background: existing.length > 0 ? (isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_WARM_GLOW) : c('input'),
                        border: `1px solid ${existing.length > 0 ? c('warmAccent') : c('border')}`,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '12px', fontWeight: 600, color: existing.length > 0 ? c('warmAccent') : c('text2') }}>{type}</div>
                      {existing.length > 0 && <div style={{ fontSize: '10px', color: c('text3'), marginTop: '1px' }}>x{existing.length}</div>}
                    </button>
                  );
                })}
              </div>

              {/* Uploaded thumbnails */}
              {assets.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {assets.map((a, i) => (
                    <div key={i} style={{ width: '48px', height: '48px', borderRadius: '6px', overflow: 'hidden', position: 'relative', border: `1px solid ${c('border')}` }}>
                      <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button onClick={() => setAssets(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: '1px', right: '1px', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}>
                        <X size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 1: Scene Settings */}
          {activeStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Store size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('warmAccent') }} />
                场景设置
              </div>

              {/* Brand & Product */}
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                品牌名称 <span style={{ color: DANGER }}>*</span>
                <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="品牌名称"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
              </label>
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                产品名称
                <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="产品名称"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
              </label>

              {/* Scene Preset Library */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '8px' }}>场景预设库</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                  {SCENE_PRESETS.map(s => (
                    <button key={s.id} onClick={() => setSceneType(s.id as Display3DSceneType)}
                      style={{
                        padding: '10px 6px', borderRadius: '8px', textAlign: 'center', cursor: 'pointer',
                        background: sceneType === s.id ? (isMonochrome ? 'rgba(59,130,246,0.15)' : ACCENT_WARM_GLOW) : c('input'),
                        border: `1px solid ${sceneType === s.id ? c('warmAccent') : c('border')}`,
                        color: sceneType === s.id ? c('warmAccent') : c('text2'),
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '20px', marginBottom: '2px' }}>{s.icon}</div>
                      <div style={{ fontSize: '11px', fontWeight: 700 }}>{s.label}</div>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: c('text3'), marginTop: '4px' }}>
                  {SCENE_PRESETS.find(s => s.id === sceneType)?.desc}
                </div>
              </div>

              {/* Environment */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '6px' }}>环境类型</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {['室内', '室外', '半户外', '商场', '展会'].map(env => (
                    <button key={env} onClick={() => setEnvironment(env === '室内' ? 'indoor' : env === '室外' ? 'outdoor' : env === '半户外' ? 'semi-outdoor' : env === '商场' ? 'mall' : 'exhibition')}
                      style={{
                        padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        background: (environment === 'indoor' && env === '室内') || (environment === 'outdoor' && env === '室外') || (environment === 'semi-outdoor' && env === '半户外') || (environment === 'mall' && env === '商场') || (environment === 'exhibition' && env === '展会')
                          ? (isMonochrome ? 'rgba(59,130,246,0.15)' : ACCENT_WARM_GLOW) : c('input'),
                        border: `1px solid ${c('border')}`,
                        color: (environment === 'indoor' && env === '室内') || (environment === 'outdoor' && env === '室外') || (environment === 'semi-outdoor' && env === '半户外') || (environment === 'mall' && env === '商场') || (environment === 'exhibition' && env === '展会')
                          ? c('warmAccent') : c('text2'),
                        transition: 'all 0.15s',
                      }}
                    >{env}</button>
                  ))}
                </div>
              </div>

              {/* Style & Crowd */}
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                材质风格
                <input value={materialStyle} onChange={e => setMaterialStyle(e.target.value)} placeholder="如：现代简约 / 新中式 / 未来科技"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
              </label>
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                灯光风格
                <input value={lightingStyle} onChange={e => setLightingStyle(e.target.value)} placeholder="如：自然光 / 暖色射灯 / 冷色氛围灯"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
              </label>
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                人群氛围
                <input value={crowdStyle} onChange={e => setCrowdStyle(e.target.value)} placeholder="如：高端商务 / 年轻潮流 / 家庭亲子"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
              </label>
            </div>
          )}

          {/* Step 2: Dimensions */}
          {activeStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Ruler size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('warmAccent') }} />
                环境与尺寸
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['length', 'width', 'height'] as const).map(dim => (
                  <label key={dim} style={{ flex: 1, textAlign: 'center' }}>
                    <span style={{ fontSize: '11px', color: c('text3'), fontWeight: 600 }}>{dim === 'length' ? '长' : dim === 'width' ? '宽' : '高'}</span>
                    <input type="number" value={dimensions[dim]} onChange={e => setDimensions(prev => ({ ...prev, [dim]: Number(e.target.value) }))}
                      style={{ width: '100%', marginTop: '3px', padding: '6px 8px', borderRadius: '6px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none', textAlign: 'center' }} />
                  </label>
                ))}
                <span style={{ fontSize: '12px', color: c('text3'), alignSelf: 'flex-end', paddingBottom: '8px' }}>cm</span>
              </div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                预算范围
                <input value={budget} onChange={e => setBudget(e.target.value)} placeholder="如：5万-10万"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
              </label>
              {/* Custom Prompt */}
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '4px' }}>自定义提示词</div>
                <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} placeholder="额外设计要求..."
                  style={{ width: '100%', minHeight: '80px', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none', resize: 'vertical', lineHeight: '1.5' }} />
              </div>
            </div>
          )}

          {/* Step 3: View Options */}
          {activeStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Camera size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('warmAccent') }} />
                输出视角
              </div>
              {viewLabels.map(v => (
                <button key={v.key} onClick={() => setViewOptions(prev => prev.includes(v.key) ? prev.filter(x => x !== v.key) : [...prev, v.key])}
                  style={{
                    padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
                    background: viewOptions.includes(v.key) ? (isMonochrome ? 'rgba(59,130,246,0.12)' : ACCENT_WARM_GLOW) : c('input'),
                    border: `1px solid ${viewOptions.includes(v.key) ? c('warmAccent') : c('border')}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {viewOptions.includes(v.key) ? <CheckSquare size={15} style={{ color: c('warmAccent') }} /> : <Square size={15} style={{ color: c('text3') }} />}
                    <span style={{ fontSize: '14px', fontWeight: 700, color: viewOptions.includes(v.key) ? c('warmAccent') : c('text') }}>{v.label}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Generate Button */}
        <div style={{ padding: '14px 18px', borderTop: `1px solid ${c('border')}`, background: isMonochrome ? M_BG_CARD : 'rgb(16,22,36)' }}>
          {errorMsg && (
            <div style={{ fontSize: '12px', color: DANGER, marginBottom: '8px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(200,80,80,0.1)' }}>{errorMsg}</div>
          )}
          {isGenerating && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ height: '4px', borderRadius: '2px', background: c('input'), overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: c('warmAccent'), borderRadius: '2px', transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '12px', color: c('text3'), marginTop: '4px' }}>生成中... {progress}%</div>
            </div>
          )}
          <button onClick={handleGenerate} disabled={isGenerating}
            style={{
              width: '100%', padding: '12px', borderRadius: '10px', fontSize: '15px', fontWeight: 800,
              background: isGenerating ? c('input') : (isMonochrome ? M_ACCENT : ACCENT_WARM),
              color: isGenerating ? c('text3') : (isMonochrome ? '#fff' : '#0e1420'),
              border: 'none', cursor: isGenerating ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
              boxShadow: !isGenerating && !isMonochrome ? '0 2px 12px rgba(190,170,120,0.25)' : 'none',
            }}
          >
            <Sparkles size={16} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
            {isGenerating ? '生成中...' : '生成展陈方案'}
          </button>
        </div>
      </div>

      {/* === Right Column: Preview & Results === */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }} data-no-drag>
        {/* Results Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${c('border')}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isMonochrome ? M_BG_CARD : 'rgb(16,22,36)' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: c('text') }}>展陈方案</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {results.length > 0 && (
              <>
                <button onClick={handleDecompose} disabled={isDecomposing}
                  style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_WARM_GLOW, border: `1px solid ${c('warmAccent')}`, color: c('warmAccent'), cursor: 'pointer' }}>
                  <Layers size={12} style={{ verticalAlign: '-1px' }} /> {isDecomposing ? '拆解中...' : '方案拆解'}
                </button>
                <button onClick={handleExportPdf}
                  style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: c('input'), border: `1px solid ${c('border')}`, color: c('text2'), cursor: 'pointer' }}>
                  <FileText size={12} style={{ verticalAlign: '-1px' }} /> PDF
                </button>
                <button onClick={handleExportBom}
                  style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: c('input'), border: `1px solid ${c('border')}`, color: c('text2'), cursor: 'pointer' }}>
                  <BarChart3 size={12} style={{ verticalAlign: '-1px' }} /> BOM
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        {results.length > 0 && (
          <div style={{ display: 'flex', padding: '6px 12px', gap: '2px', borderBottom: `1px solid ${c('border')}`, flexWrap: 'wrap' }}>
            {['效果图', '方案拆解', '材质工艺', 'BOM清单'].map((tab, i) => (
              <button key={tab} onClick={() => setActiveTab(i)}
                style={{
                  padding: '4px 10px', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
                  color: activeTab === i ? c('warmAccent') : c('text3'),
                  background: activeTab === i ? (isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_WARM_GLOW) : 'transparent',
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                }}
              >{tab}</button>
            ))}
          </div>
        )}

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '16px' }}>
          {/* Tab 0: Preview Stage */}
          {activeTab === 0 && (
            results.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: c('text3') }}>
                {/* Empty state with preview stage atmosphere */}
                <div style={{ width: '200px', height: '140px', borderRadius: '12px', background: `linear-gradient(135deg, ${isMonochrome ? 'rgb(240,240,245)' : 'rgb(28,38,58)'}, ${isMonochrome ? 'rgb(248,248,250)' : 'rgb(20,28,44)'})`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px', border: `1px dashed ${c('border')}` }}>
                  <div style={{ textAlign: 'center' }}>
                    <RotateCw size={32} style={{ opacity: 0.2, marginBottom: '4px' }} />
                    <div style={{ fontSize: '11px', opacity: 0.4 }}>3D 预览舞台</div>
                  </div>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 600 }}>暂无方案</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>设置参数后点击生成</div>
              </div>
            ) : (
              <div>
                {/* Main preview area */}
                {selectedResult && (
                  <div style={{ marginBottom: '12px', borderRadius: '12px', overflow: 'hidden', border: `1px solid ${c('border')}`, background: isMonochrome ? M_BG_CARD : 'rgb(16,22,36)', position: 'relative' }}>
                    <img src={selectedResult.url} alt="" style={{ width: '100%', maxHeight: '300px', objectFit: 'contain' }} />
                    <div style={{ position: 'absolute', bottom: '8px', right: '8px', display: 'flex', gap: '4px' }}>
                      <button onClick={() => handleDownloadImage(selectedResult.url, `display3d_${selectedResult.id}.png`)}
                        style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '11px', background: 'rgba(0,0,0,0.6)', border: 'none', color: 'white', cursor: 'pointer' }}>
                        <Download size={11} /> 下载
                      </button>
                      <button onClick={() => handleSendToCanvas([selectedResult.url])}
                        style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '11px', background: 'rgba(0,0,0,0.6)', border: 'none', color: c('warmAccent'), cursor: 'pointer' }}>
                        <Send size={11} /> 画布
                      </button>
                    </div>
                  </div>
                )}
                {/* Result grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                  {results.map(r => (
                    <div key={r.id} onClick={() => setSelectedResult(r)}
                      style={{
                        borderRadius: '8px', overflow: 'hidden', cursor: 'pointer',
                        border: `2px solid ${selectedResult?.id === r.id ? c('warmAccent') : c('border')}`,
                        background: c('card'), transition: 'border 0.15s',
                      }}
                    >
                      <div style={{ aspectRatio: '4/3', overflow: 'hidden' }}>
                        <img src={r.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ padding: '4px 6px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: c('text2') }}>
                          {viewLabels.find(v => v.key === r.type)?.label || r.type}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Tab 1: Decomposition */}
          {activeTab === 1 && (
            decomposition ? (
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: c('text'), marginBottom: '10px' }}>
                  <Layers size={14} style={{ verticalAlign: '-1px', marginRight: '4px', color: c('warmAccent') }} />
                  方案拆解 - {decomposition.components.length} 个部件
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {decomposition.components.map(comp => (
                    <div key={comp.id} style={{ padding: '10px 12px', borderRadius: '8px', background: c('card'), border: `1px solid ${c('border')}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: c('text') }}>{comp.name}</div>
                        <div style={{ fontSize: '12px', color: c('text3'), marginTop: '2px' }}>
                          {comp.material} · {comp.craft} · x{comp.quantity}
                          {comp.dimensions && ` · ${comp.dimensions}`}
                        </div>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: c('warmAccent') }}>¥{comp.estimatedPrice.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', background: isMonochrome ? 'rgba(59,130,246,0.06)' : ACCENT_WARM_GLOW, border: `1px solid ${c('warmAccent')}`, textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', color: c('text2') }}>预估总价</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: c('warmAccent') }}>¥{decomposition.totalEstimate.toLocaleString()}</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: c('text3') }}>
                <Layers size={36} style={{ opacity: 0.3, marginBottom: '8px' }} />
                <div style={{ fontSize: '14px', fontWeight: 600 }}>生成效果图后点击"方案拆解"</div>
              </div>
            )
          )}

          {/* Tab 2: Material & Craft */}
          {activeTab === 2 && (
            <div style={{ color: c('text3'), textAlign: 'center', padding: '40px 0' }}>
              <Palette size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
              <div style={{ fontSize: '14px' }}>材质工艺标注将在方案拆解后显示</div>
            </div>
          )}

          {/* Tab 3: BOM */}
          {activeTab === 3 && (
            decomposition ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: c('text') }}>BOM 物料清单</div>
                  <button onClick={handleExportBom}
                    style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_WARM_GLOW, border: `1px solid ${c('warmAccent')}`, color: c('warmAccent'), cursor: 'pointer' }}>
                    <Download size={12} style={{ verticalAlign: '-1px' }} /> 导出 CSV
                  </button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr>
                        {['序号', '部件名称', '数量', '材质', '工艺', '预估单价', '预估总价'].map(h => (
                          <th key={h} style={{ padding: '8px 6px', textAlign: 'left', borderBottom: `1px solid ${c('border')}`, color: c('warmAccent'), fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {decomposition.components.map((comp, i) => (
                        <tr key={comp.id}>
                          <td style={{ padding: '6px', borderBottom: `1px solid ${c('border')}`, color: c('text3') }}>{i + 1}</td>
                          <td style={{ padding: '6px', borderBottom: `1px solid ${c('border')}`, color: c('text'), fontWeight: 600 }}>{comp.name}</td>
                          <td style={{ padding: '6px', borderBottom: `1px solid ${c('border')}`, color: c('text2') }}>{comp.quantity}</td>
                          <td style={{ padding: '6px', borderBottom: `1px solid ${c('border')}`, color: c('text2') }}>{comp.material}</td>
                          <td style={{ padding: '6px', borderBottom: `1px solid ${c('border')}`, color: c('text2') }}>{comp.craft}</td>
                          <td style={{ padding: '6px', borderBottom: `1px solid ${c('border')}`, color: c('text2') }}>¥{comp.estimatedPrice.toLocaleString()}</td>
                          <td style={{ padding: '6px', borderBottom: `1px solid ${c('border')}`, color: c('warmAccent'), fontWeight: 700 }}>¥{(comp.estimatedPrice * comp.quantity).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ color: c('text3'), textAlign: 'center', padding: '40px 0' }}>
                <BarChart3 size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
                <div style={{ fontSize: '14px' }}>完成方案拆解后查看 BOM 清单</div>
              </div>
            )
          )}

          {/* Disclaimer */}
          <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(140,170,210,0.06)', border: `1px solid rgba(140,170,210,0.15)` }}>
            <div style={{ fontSize: '12px', color: c('text3'), display: 'flex', alignItems: 'flex-start', gap: '6px', lineHeight: '1.6' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '2px', color: c('warmAccent') }} />
              <span>展陈效果图非施工图 / 材质与工艺建议需供应商确认 / 预估造价仅供参考，以实际报价为准</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
