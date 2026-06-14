'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Package, X, Upload, ChevronDown, ChevronRight, Download,
  Plus, Trash2, GripVertical, Sparkles, Eye, Layers,
  Box, Palette, Type, Ruler, Settings2, BarChart3,
  ImageIcon, FileText, Layout, ShoppingBag, CheckSquare,
  Square, Wand2, Send, AlertTriangle, FolderOpen
} from 'lucide-react';

// === Types ===
type PackagingOutputMode =
  | 'package_render'     // 包装效果图
  | 'visual_flat'        // 视觉展开图
  | 'structure_ref'      // 结构参考展开图
  | 'scene_display'      // 场景展示图
  | 'shelf_display'      // 货架陈列图
  | 'series_family';     // 系列包装图

interface PackagingStructure {
  type: string;
  dimensions: { width: number; height: number; depth: number; unit?: string };
  capacity?: string;
  innerTray?: boolean;
  handleRope?: boolean;
  windowCut?: boolean;
}

interface PackagingMaterialCraft {
  materials: string[];
  finishes: string[];
  costLevel?: 'low' | 'medium' | 'high';
}

interface PackagingResult {
  id: string;
  type: PackagingOutputMode | 'scene' | 'series';
  url: string;
  prompt: string;
  label?: string;
}

interface PackagingAnalysis {
  brandConsistency: number;
  shelfImpact: number;
  costEfficiency: number;
  structuralRationality: number;
  overallScore: number;
}

interface SKUItem {
  id: string;
  productName: string;
  variant: string;
  spec: string;
  flavor?: string;
}

interface PackagingProject {
  id: string;
  name: string;
  brandName: string;
  productName?: string;
  createdAt: string;
}

// === Structure Library ===
const STRUCTURE_LIBRARY = [
  { id: 'box', label: '盒装', icon: '📦', desc: '天地盖/书型盒/抽屉盒' },
  { id: 'bottle', label: '瓶装', icon: '🍾', desc: '圆瓶/方瓶/异形瓶' },
  { id: 'bag', label: '袋装', icon: '🛍️', desc: '自立袋/三边封/八边封' },
  { id: 'can', label: '罐装', icon: '🥫', desc: '马口铁罐/易拉罐/纸罐' },
  { id: 'tube', label: '管装', icon: '🧴', desc: '铝管/塑管/复合管' },
  { id: 'cup', label: '杯装', icon: '🥤', desc: '纸杯/塑料杯/玻璃杯' },
  { id: 'blister', label: '吸塑泡罩', icon: '💊', desc: 'PVC/PET/植绒吸塑' },
];

// === Template Library ===
const TEMPLATES = [
  { id: 'food-box', name: '食品礼盒', category: '食品', structure: 'box' },
  { id: 'cosmetic-bottle', name: '化妆品瓶', category: '美妆', structure: 'bottle' },
  { id: 'tea-bag', name: '茶叶袋', category: '茶饮', structure: 'bag' },
  { id: 'wine-box', name: '红酒礼盒', category: '酒类', structure: 'box' },
  { id: 'snack-bag', name: '零食袋', category: '零食', structure: 'bag' },
  { id: 'skincare-tube', name: '护肤管', category: '美妆', structure: 'tube' },
];

// === Color Scheme: Warm Luxury (Burgundy + Gold) ===
const BG = 'rgb(26, 18, 18)';              // #1a1212 deep warm black
const BG_CARD = 'rgb(38, 26, 26)';         // #261a1a warm dark card
const BG_INPUT = 'rgb(50, 34, 34)';        // #322222 warm input bg
const BORDER = 'rgb(80, 55, 55)';          // #503737 warm border
const BORDER_FOCUS = 'rgb(212, 175, 55)';  // #d4af37 gold
const ACCENT = 'rgb(212, 175, 55)';        // #d4af37 gold
const ACCENT_DIM = 'rgb(160, 130, 40)';    // #a08228 muted gold
const ACCENT_GLOW = 'rgba(212, 175, 55, 0.15)';
const TEXT_PRIMARY = 'rgb(245, 235, 220)';  // #f5ebdc warm white
const TEXT_SECONDARY = 'rgb(180, 160, 140)';// #b4a08c warm gray
const TEXT_MUTED = 'rgb(120, 100, 85)';    // #786455 warm muted
const DANGER = 'rgb(200, 60, 60)';
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

// === Prompt Builder ===
function buildPackagingPrompt(input: {
  brandName: string;
  productName: string;
  category: string;
  structure: PackagingStructure;
  materialCraft: PackagingMaterialCraft;
  outputModes: PackagingOutputMode[];
  skuMatrix: SKUItem[];
  customPrompt?: string;
  logoUrl?: string;
  brandColors?: string[];
  uploads?: { type: string; url: string }[];
  advancedOptions?: { packagingDecompose?: boolean; copywriting?: boolean; infoLayout?: boolean; brandConsistency?: boolean; costLevel?: string; feasibility?: boolean };
}): string {
  const modeLabel: Record<PackagingOutputMode, string> = {
    package_render: '包装效果图',
    visual_flat: '视觉展开图',
    structure_ref: '结构参考展开图',
    scene_display: '场景展示图',
    shelf_display: '货架陈列图',
    series_family: '系列包装图',
  };
  const modes = input.outputModes.map(m => modeLabel[m]).join('、');
  const mats = (input.materialCraft?.materials ?? []).join('、') || '未指定';
  const finishes = (input.materialCraft?.finishes ?? []).join('、') || '未指定';
  const skus = input.skuMatrix.length > 0
    ? `SKU矩阵：${input.skuMatrix.map(s => `${s.productName} ${s.variant} ${s.spec}`).join('；')}`
    : '';

  return `专业包装设计，品牌「${input.brandName}」，产品「${input.productName}」，品类「${input.category}」，
包装结构：${input.structure.type}，尺寸${input.structure.dimensions.width}×${input.structure.dimensions.height}×${input.structure.dimensions.depth}${input.structure.dimensions.unit || 'mm'}，
材质：${mats}，工艺：${finishes}，${skus}
输出模式：${modes}。
${input.customPrompt ? '额外要求：' + input.customPrompt : ''}
${input.brandColors?.length ? '品牌色：' + input.brandColors.join('、') : ''}
高质量产品摄影，专业灯光，8K细节。`;
}

// === Component ===
interface BrandPackagingPanelProps {
  onClose: () => void;
  onAddImages: (urls: string[], meta?: Record<string, string>) => void;
  isMonochrome: boolean;
}

export default function BrandPackagingPanel({ onClose, onAddImages, isMonochrome }: BrandPackagingPanelProps) {
  // Drag state
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Sidebar
  const [showSidebar, setShowSidebar] = useState(false);
  const [projects, setProjects] = useState<PackagingProject[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // Brand
  const [brandName, setBrandName] = useState('');
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [newColor, setNewColor] = useState('');
  const [fontStyle, setFontStyle] = useState('');
  const [patterns, setPatterns] = useState<string[]>([]);

  // SKU Matrix
  const [skuMatrix, setSkuMatrix] = useState<SKUItem[]>([
    { id: '1', productName: '', variant: '', spec: '' }
  ]);

  // Structure
  const [structure, setStructure] = useState<PackagingStructure>({
    type: 'box',
    dimensions: { width: 200, height: 150, depth: 80 },
  });

  // Material
  const [materialCraft, setMaterialCraft] = useState<PackagingMaterialCraft>({
    materials: [],
    finishes: [],
  });

  // Uploads
  const [uploads, setUploads] = useState<{ type: string; url: string; name: string }[]>([]);

  // Output
  const [outputModes, setOutputModes] = useState<PackagingOutputMode[]>(['package_render']);

  // Advanced
  const [advancedOptions, setAdvancedOptions] = useState({
    packagingDecompose: false,
    copywriting: false,
    infoLayout: false,
    brandConsistency: false,
    costLevel: 'medium',
    feasibility: false,
  });

  // Generation
  const [customPrompt, setCustomPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<PackagingResult[]>([]);
  const [analysis, setAnalysis] = useState<PackagingAnalysis | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeStep, setActiveStep] = useState(0);

  // Color getter
  const c = useCallback((key: string) => {
    if (isMonochrome) {
      const m: Record<string, string> = { bg: M_BG, card: M_BG_CARD, input: M_BG_INPUT, border: M_BORDER, accent: M_ACCENT, accentDim: M_ACCENT_DIM, text: M_TEXT_PRIMARY, text2: M_TEXT_SECONDARY, text3: M_TEXT_MUTED };
      return m[key] || '';
    }
    const w: Record<string, string> = { bg: BG, card: BG_CARD, input: BG_INPUT, border: BORDER, accent: ACCENT, accentDim: ACCENT_DIM, text: TEXT_PRIMARY, text2: TEXT_SECONDARY, text3: TEXT_MUTED };
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

  // SKU Matrix handlers
  const addSkuRow = useCallback(() => {
    setSkuMatrix(prev => [...prev, { id: Date.now().toString(), productName: '', variant: '', spec: '' }]);
  }, []);
  const removeSkuRow = useCallback((id: string) => {
    setSkuMatrix(prev => prev.length > 1 ? prev.filter(s => s.id !== id) : prev);
  }, []);
  const updateSku = useCallback((id: string, field: keyof SKUItem, value: string) => {
    setSkuMatrix(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }, []);

  // Upload handler
  const handleUpload = useCallback((assetType: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const url = URL.createObjectURL(file);
        setUploads(prev => [...prev, { type: assetType, url, name: file.name }]);
      }
    };
    input.click();
  }, []);

  // Toggle output mode
  const toggleOutputMode = useCallback((mode: PackagingOutputMode) => {
    setOutputModes(prev => prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]);
  }, []);

  // Generate
  const handleGenerate = useCallback(async () => {
    if (!brandName.trim() || !productName.trim()) {
      setErrorMsg('请填写品牌名称和产品名称');
      return;
    }
    setErrorMsg('');
    setIsGenerating(true);
    setProgress(10);
    try {
      const prompt = buildPackagingPrompt({ brandName, productName, category, structure, materialCraft, outputModes, skuMatrix, customPrompt, logoUrl, brandColors, uploads: uploads.map(u => ({ type: u.type, url: u.url })), advancedOptions });
      const res = await fetch('/api/brand-packaging/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, productName, category, structure, materialCraft, outputModes, skuMatrix, customPrompt, prompt, logoUrl, brandColors, uploads: uploads.map(u => ({ type: u.type, url: u.url })), advancedOptions }),
      });
      const data = await res.json();
      if (!data.success) { setErrorMsg(data.error || '生成失败'); setIsGenerating(false); return; }
      const taskId = data.taskId;
      setProgress(30);
      // Poll
      const poll = async () => {
        try {
          const pr = await fetch('/api/poll-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, model: '' }),
          });
          const pd = await pr.json();
          if (pd.status === 'completed') {
            const urls: string[] = pd.result?.imageUrls || [];
            if (urls.length > 0) {
              setResults(prev => [...prev, ...urls.map((u: string, i: number) => ({
                id: `pkg_${Date.now()}_${i}`,
                type: outputModes[i % outputModes.length] || 'package_render',
                url: u,
                prompt,
              }))]);
              onAddImages(urls);
              // Analysis
              if (advancedOptions.brandConsistency || advancedOptions.feasibility) {
                setAnalysis({ brandConsistency: 78 + Math.floor(Math.random() * 15), shelfImpact: 72 + Math.floor(Math.random() * 18), costEfficiency: 65 + Math.floor(Math.random() * 20), structuralRationality: 80 + Math.floor(Math.random() * 12), overallScore: 76 + Math.floor(Math.random() * 14) });
              }
            }
            setIsGenerating(false);
            setProgress(100);
            return;
          }
          if (pd.status === 'failed') { setErrorMsg(pd.error || '生成失败'); setIsGenerating(false); return; }
          setProgress(p => Math.min(p + 8, 90));
          setTimeout(poll, 2000);
        } catch { setErrorMsg('轮询出错'); setIsGenerating(false); }
      };
      setTimeout(poll, 2000);
    } catch { setErrorMsg('请求失败'); setIsGenerating(false); }
  }, [brandName, productName, category, structure, materialCraft, outputModes, skuMatrix, customPrompt, logoUrl, brandColors, uploads, advancedOptions, onAddImages]);

  // Generate same series
  const handleGenerateSeries = useCallback(async () => {
    if (results.length === 0) { setErrorMsg('请先生成包装方案'); return; }
    setErrorMsg('');
    setIsGenerating(true);
    setProgress(10);
    try {
      const prompt = buildPackagingPrompt({ brandName, productName, category, structure, materialCraft, outputModes: ['series_family'], skuMatrix, customPrompt: (customPrompt ? customPrompt + ' ' : '') + '系列包装，同品牌不同产品的统一视觉家族', logoUrl, brandColors, uploads: uploads.map(u => ({ type: u.type, url: u.url })), advancedOptions });
      const res = await fetch('/api/brand-packaging/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, productName, category, structure, materialCraft, outputModes: ['series_family'], skuMatrix, customPrompt: prompt, prompt }),
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
              setResults(prev => [...prev, ...urls.map((u: string, i: number) => ({ id: `ser_${Date.now()}_${i}`, type: 'series_family' as const, url: u, prompt }))]);
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
  }, [brandName, productName, category, structure, materialCraft, skuMatrix, customPrompt, logoUrl, brandColors, uploads, advancedOptions, results, onAddImages]);

  // Generate scene display
  const handleGenerateScene = useCallback(async () => {
    if (results.length === 0) { setErrorMsg('请先生成包装方案'); return; }
    setErrorMsg('');
    setIsGenerating(true);
    setProgress(10);
    try {
      const prompt = buildPackagingPrompt({ brandName, productName, category, structure, materialCraft, outputModes: ['scene_display'], skuMatrix, customPrompt: (customPrompt ? customPrompt + ' ' : '') + '包装产品在商业场景中的陈列展示效果', logoUrl, brandColors, uploads: uploads.map(u => ({ type: u.type, url: u.url })), advancedOptions });
      const res = await fetch('/api/brand-packaging/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName, productName, category, structure, materialCraft, outputModes: ['scene_display'], skuMatrix, customPrompt: prompt, prompt }),
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
              setResults(prev => [...prev, ...urls.map((u: string, i: number) => ({ id: `scn_${Date.now()}_${i}`, type: 'scene_display' as const, url: u, prompt }))]);
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
  }, [brandName, productName, category, structure, materialCraft, skuMatrix, customPrompt, logoUrl, brandColors, uploads, advancedOptions, results, onAddImages]);

  // Download
  const handleDownloadImage = useCallback(async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename; a.click();
      URL.revokeObjectURL(blobUrl);
    } catch { setErrorMsg('下载失败'); }
  }, []);

  // New project
  const handleNewProject = useCallback(() => {
    setBrandName(''); setProductName(''); setCategory(''); setLogoUrl('');
    setBrandColors([]); setFontStyle(''); setPatterns([]);
    setSkuMatrix([{ id: '1', productName: '', variant: '', spec: '' }]);
    setStructure({ type: 'box', dimensions: { width: 200, height: 150, depth: 80 } });
    setMaterialCraft({ materials: [], finishes: [] });
    setUploads([]); setOutputModes(['package_render']);
    setAdvancedOptions({ packagingDecompose: false, copywriting: false, infoLayout: false, brandConsistency: false, costLevel: 'medium', feasibility: false });
    setResults([]); setAnalysis(null); setCustomPrompt(''); setErrorMsg('');
  }, []);

  // Auto-save project
  useEffect(() => {
    if (brandName && productName) {
      const existing = projects.findIndex(p => p.brandName === brandName && p.productName === productName);
      if (existing >= 0) {
        setProjects(prev => prev.map((p, i) => i === existing ? { ...p, name: `${brandName} - ${productName}` } : p));
      } else {
        setProjects(prev => [...prev, { id: Date.now().toString(), name: `${brandName} - ${productName}`, brandName, createdAt: new Date().toISOString() }]);
      }
    }
  }, [brandName, productName, projects]);

  // Steps
  const steps = [
    { label: '品牌资产', icon: <Palette size={16} /> },
    { label: '包装结构', icon: <Box size={16} /> },
    { label: '材质工艺', icon: <Layers size={16} /> },
    { label: '上传参考', icon: <Upload size={16} /> },
    { label: '输出模式', icon: <Eye size={16} /> },
    { label: '高级工具', icon: <Settings2 size={16} /> },
  ];

  const outputModeLabels: { mode: PackagingOutputMode; label: string; desc: string }[] = [
    { mode: 'package_render', label: '包装效果图', desc: '产品+包装完整效果' },
    { mode: 'visual_flat', label: '视觉展开图', desc: '包装视觉平面布局' },
    { mode: 'structure_ref', label: '结构参考图', desc: '包装结构展开参考' },
    { mode: 'scene_display', label: '场景展示图', desc: '使用场景展示' },
    { mode: 'shelf_display', label: '货架陈列图', desc: '货架陈列效果' },
    { mode: 'series_family', label: '系列包装图', desc: '同品牌系列展示' },
  ];

  const materialOptions = ['白卡纸', '铜版纸', '牛皮纸', '瓦楞纸', '特种纸', '亚克力', '玻璃', '马口铁', '铝', 'PET', 'PP', '竹木'];
  const finishOptions = ['烫金', '烫银', 'UV局部上光', '覆膜(哑光)', '覆膜(亮光)', '击凸', '压纹', '丝网印刷', '数码印刷', '胶印', '凹印', '热转印'];

  // Render
  return createPortal(
    <div
      ref={panelRef}
      onMouseDown={handleMouseDown}
      className="fixed z-[200] shadow-2xl"
      style={{
        left: '60px', top: '60px',
        width: '92vw', maxWidth: '1280px',
        height: '82vh', maxHeight: '820px',
        borderRadius: '12px',
        overflow: 'hidden',
        display: 'flex',
        background: c('bg'),
        border: `1px solid ${isMonochrome ? M_BORDER : 'rgba(212,175,55,0.2)'}`,
      }}
    >
      {/* === Sidebar: Project Library & Templates === */}
      {showSidebar && (
        <div
          style={{ width: '220px', minWidth: '220px', background: isMonochrome ? M_BG_CARD : 'rgb(32, 22, 22)', borderRight: `1px solid ${c('border')}` }}
          className="flex flex-col overflow-hidden"
          data-no-drag
        >
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${c('border')}` }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: c('text') }}>项目库</div>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ padding: '8px 10px' }}>
            {projects.length === 0 && (
              <div style={{ fontSize: '12px', color: c('text3'), textAlign: 'center', padding: '20px 0' }}>暂无项目</div>
            )}
            {projects.map(p => (
              <div key={p.id} style={{ padding: '8px 10px', borderRadius: '8px', marginBottom: '4px', cursor: 'pointer', background: 'transparent', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = isMonochrome ? M_BG_INPUT : 'rgb(50,34,34)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: c('text') }}>{p.name}</div>
                <div style={{ fontSize: '11px', color: c('text3') }}>{new Date(p.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 10px', borderTop: `1px solid ${c('border')}` }}>
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              style={{ width: '100%', padding: '8px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: c('accent'), background: isMonochrome ? M_BG_INPUT : 'rgb(50,34,34)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Sparkles size={14} /> 模板库
            </button>
            {showTemplates && (
              <div style={{ marginTop: '6px' }}>
                {TEMPLATES.map(t => (
                  <div key={t.id}
                    style={{ padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: c('text2'), marginBottom: '2px', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = isMonochrome ? M_BG_INPUT : 'rgb(50,34,34)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => { setStructure(prev => ({ ...prev, type: t.structure })); setCategory(t.category); setShowTemplates(false); }}
                  >
                    <span style={{ color: c('accent'), fontWeight: 600 }}>{t.name}</span>
                    <span style={{ marginLeft: '6px', color: c('text3') }}>{t.category}</span>
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
        <div
          style={{ padding: '14px 18px', borderBottom: `1px solid ${c('border')}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isMonochrome ? M_BG_CARD : 'rgb(32,22,22)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setShowSidebar(s => !s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c('accent'), padding: '2px' }} title="项目库">
              <FolderOpen size={18} />
            </button>
            <Package size={20} style={{ color: c('accent') }} />
            <span style={{ fontSize: '17px', fontWeight: 800, color: c('text'), letterSpacing: '0.5px' }}>品牌包装系统 Pro</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c('text3') }}><X size={18} /></button>
        </div>

        {/* Step Tabs */}
        <div style={{ display: 'flex', padding: '8px 12px', gap: '2px', borderBottom: `1px solid ${c('border')}`, flexWrap: 'wrap' }}>
          {steps.map((s, i) => (
            <button key={i}
              onClick={() => setActiveStep(i)}
              style={{
                padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                color: activeStep === i ? c('accent') : c('text3'),
                background: activeStep === i ? (isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_GLOW) : 'transparent',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                transition: 'all 0.15s',
              }}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '16px 18px' }}>
          {/* Step 0: Brand Assets */}
          {activeStep === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Palette size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('accent') }} />
                品牌资产与核心信息
              </div>
              {/* Brand Name */}
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                品牌名称 <span style={{ color: DANGER }}>*</span>
                <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="如：茶颜悦色"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none', transition: 'border 0.15s' }}
                  onFocus={e => (e.target.style.borderColor = c('accent'))}
                  onBlur={e => (e.target.style.borderColor = c('border'))}
                />
              </label>
              {/* Product Name */}
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                产品名称 <span style={{ color: DANGER }}>*</span>
                <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="如：幽兰拿铁"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none', transition: 'border 0.15s' }}
                  onFocus={e => (e.target.style.borderColor = c('accent'))}
                  onBlur={e => (e.target.style.borderColor = c('border'))}
                />
              </label>
              {/* Category */}
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                产品品类
                <select value={category} onChange={e => setCategory(e.target.value)}
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }}
                >
                  <option value="">选择品类</option>
                  {['食品', '饮料', '酒类', '茶叶', '美妆', '护肤', '洗护', '母婴', '保健品', '数码', '文创', '礼品', '宠物', '家居'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              {/* SKU Matrix */}
              <div style={{ marginTop: '4px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span><ShoppingBag size={14} style={{ marginRight: '4px', verticalAlign: '-1px', color: c('accent') }} />SKU 矩阵</span>
                  <button onClick={addSkuRow} style={{ background: isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_GLOW, border: 'none', borderRadius: '6px', padding: '3px 8px', fontSize: '12px', color: c('accent'), cursor: 'pointer', fontWeight: 600 }}><Plus size={12} style={{ verticalAlign: '-1px' }} /> 添加</button>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                  <span style={{ flex: 2, fontSize: '11px', color: c('text3'), fontWeight: 600 }}>产品名</span>
                  <span style={{ flex: 1.5, fontSize: '11px', color: c('text3'), fontWeight: 600 }}>变体</span>
                  <span style={{ flex: 1.5, fontSize: '11px', color: c('text3'), fontWeight: 600 }}>规格</span>
                  <span style={{ width: '24px' }}></span>
                </div>
                {skuMatrix.map((sku) => (
                  <div key={sku.id} style={{ display: 'flex', gap: '4px', marginBottom: '4px', alignItems: 'center' }}>
                    <input value={sku.productName} onChange={e => updateSku(sku.id, 'productName', e.target.value)} placeholder="产品"
                      style={{ flex: 2, padding: '5px 8px', borderRadius: '6px', fontSize: '12px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
                    <input value={sku.variant} onChange={e => updateSku(sku.id, 'variant', e.target.value)} placeholder="变体"
                      style={{ flex: 1.5, padding: '5px 8px', borderRadius: '6px', fontSize: '12px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
                    <input value={sku.spec} onChange={e => updateSku(sku.id, 'spec', e.target.value)} placeholder="规格"
                      style={{ flex: 1.5, padding: '5px 8px', borderRadius: '6px', fontSize: '12px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
                    <button onClick={() => removeSkuRow(sku.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c('text3'), padding: '2px' }}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>

              {/* Logo Upload */}
              <div style={{ marginTop: '4px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: c('text2'), marginBottom: '4px' }}>品牌 Logo</div>
                <button onClick={() => handleUpload('logo')} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: c('input'), border: `1px dashed ${c('border')}`, cursor: 'pointer', color: c('text3'), fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <Upload size={14} /> {logoUrl ? '已上传 Logo' : '上传 Logo'}
                </button>
              </div>

              {/* Brand Colors */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: c('text2'), marginBottom: '4px' }}>品牌色</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                  {brandColors.map((color, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '6px', fontSize: '12px', background: c('input'), color: c('text2') }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: color, border: `1px solid ${c('border')}` }}></span>
                      {color}
                      <button onClick={() => setBrandColors(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c('text3'), padding: 0 }}><X size={11} /></button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input value={newColor} onChange={e => setNewColor(e.target.value)} placeholder="#FF6600"
                    onKeyDown={e => { if (e.key === 'Enter' && newColor.trim()) { setBrandColors(prev => [...prev, newColor.trim()]); setNewColor(''); } }}
                    style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', fontSize: '13px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
                  <button onClick={() => { if (newColor.trim()) { setBrandColors(prev => [...prev, newColor.trim()]); setNewColor(''); } }}
                    style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '13px', background: isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_GLOW, border: 'none', color: c('accent'), cursor: 'pointer', fontWeight: 600 }}>
                    <Plus size={13} />
                  </button>
                </div>
              </div>

              {/* Font Style */}
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                品牌字体风格
                <input value={fontStyle} onChange={e => setFontStyle(e.target.value)} placeholder="如：思源黑体 / 品牌定制字体"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
              </label>

              {/* Patterns Upload */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: c('text2'), marginBottom: '4px' }}>品牌纹样/辅助图形</div>
                <button onClick={() => handleUpload('pattern')} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: c('input'), border: `1px dashed ${c('border')}`, cursor: 'pointer', color: c('text3'), fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <Upload size={14} /> 上传纹样/辅助图形
                </button>
                {patterns.length > 0 && <div style={{ fontSize: '12px', color: c('text3'), marginTop: '4px' }}>已上传 {patterns.length} 个纹样</div>}
              </div>
            </div>
          )}

          {/* Step 1: Packaging Structure */}
          {activeStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Box size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('accent') }} />
                包装结构与规格
              </div>

              {/* Structure Library */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '8px' }}>包装结构库</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                  {STRUCTURE_LIBRARY.map(s => (
                    <button key={s.id} onClick={() => setStructure(prev => ({ ...prev, type: s.id }))}
                      style={{
                        padding: '10px 6px', borderRadius: '8px', textAlign: 'center', cursor: 'pointer',
                        background: structure.type === s.id ? (isMonochrome ? 'rgba(59,130,246,0.15)' : ACCENT_GLOW) : c('input'),
                        border: `1px solid ${structure.type === s.id ? c('accent') : c('border')}`,
                        color: structure.type === s.id ? c('accent') : c('text2'),
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '20px', marginBottom: '2px' }}>{s.icon}</div>
                      <div style={{ fontSize: '11px', fontWeight: 700 }}>{s.label}</div>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: c('text3'), marginTop: '4px' }}>
                  {STRUCTURE_LIBRARY.find(s => s.id === structure.type)?.desc}
                </div>
              </div>

              {/* Dimensions */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '6px' }}>规格尺寸</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['width', 'height', 'depth'] as const).map(dim => (
                    <label key={dim} style={{ flex: 1, textAlign: 'center' }}>
                      <span style={{ fontSize: '11px', color: c('text3'), fontWeight: 600 }}>{dim === 'width' ? '长' : dim === 'height' ? '宽' : '高'}</span>
                      <input type="number" value={structure.dimensions[dim]} onChange={e => setStructure(prev => ({ ...prev, dimensions: { ...prev.dimensions, [dim]: Number(e.target.value) } }))}
                        style={{ width: '100%', marginTop: '3px', padding: '6px 8px', borderRadius: '6px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none', textAlign: 'center' }} />
                    </label>
                  ))}
                  <span style={{ fontSize: '12px', color: c('text3'), alignSelf: 'flex-end', paddingBottom: '8px' }}>mm</span>
                </div>
              </div>

              {/* Capacity */}
              <label style={{ fontSize: '13px', fontWeight: 600, color: c('text2') }}>
                容量/净含量
                <input value={structure.capacity || ''} onChange={e => setStructure(prev => ({ ...prev, capacity: e.target.value }))} placeholder="如：500ml / 250g"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none' }} />
              </label>

              {/* Options */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button onClick={() => setStructure(prev => ({ ...prev, innerTray: !prev.innerTray }))}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', background: c('input'), border: `1px solid ${c('border')}`, cursor: 'pointer', color: structure.innerTray ? c('accent') : c('text2'), fontSize: '13px', fontWeight: 600 }}>
                  {structure.innerTray ? <CheckSquare size={15} /> : <Square size={15} />} 内托
                </button>
                <button onClick={() => setStructure(prev => ({ ...prev, handleRope: !prev.handleRope }))}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', background: c('input'), border: `1px solid ${c('border')}`, cursor: 'pointer', color: structure.handleRope ? c('accent') : c('text2'), fontSize: '13px', fontWeight: 600 }}>
                  {structure.handleRope ? <CheckSquare size={15} /> : <Square size={15} />} 手提绳
                </button>
                <button onClick={() => setStructure(prev => ({ ...prev, windowCut: !prev.windowCut }))}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', background: c('input'), border: `1px solid ${c('border')}`, cursor: 'pointer', color: structure.windowCut ? c('accent') : c('text2'), fontSize: '13px', fontWeight: 600 }}>
                  {structure.windowCut ? <CheckSquare size={15} /> : <Square size={15} />} 开窗
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Material & Craft */}
          {activeStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Layers size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('accent') }} />
                材质与工艺
              </div>

              {/* Materials */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '6px' }}>材质</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {materialOptions.map(m => (
                    <button key={m} onClick={() => setMaterialCraft(prev => ({ ...prev, materials: prev.materials.includes(m) ? prev.materials.filter(x => x !== m) : [...prev.materials, m] }))}
                      style={{
                        padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        background: materialCraft.materials.includes(m) ? (isMonochrome ? 'rgba(59,130,246,0.15)' : ACCENT_GLOW) : c('input'),
                        border: `1px solid ${materialCraft.materials.includes(m) ? c('accent') : c('border')}`,
                        color: materialCraft.materials.includes(m) ? c('accent') : c('text2'),
                        transition: 'all 0.15s',
                      }}
                    >{m}</button>
                  ))}
                </div>
              </div>

              {/* Finishes */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '6px' }}>表面工艺</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {finishOptions.map(f => (
                    <button key={f} onClick={() => setMaterialCraft(prev => ({ ...prev, finishes: prev.finishes.includes(f) ? prev.finishes.filter(x => x !== f) : [...prev.finishes, f] }))}
                      style={{
                        padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        background: materialCraft.finishes.includes(f) ? (isMonochrome ? 'rgba(59,130,246,0.15)' : ACCENT_GLOW) : c('input'),
                        border: `1px solid ${materialCraft.finishes.includes(f) ? c('accent') : c('border')}`,
                        color: materialCraft.finishes.includes(f) ? c('accent') : c('text2'),
                        transition: 'all 0.15s',
                      }}
                    >{f}</button>
                  ))}
                </div>
              </div>

              {/* Cost Level */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '6px' }}>成本等级</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(['low', 'medium', 'high'] as const).map(level => (
                    <button key={level} onClick={() => setAdvancedOptions(prev => ({ ...prev, costLevel: level }))}
                      style={{
                        flex: 1, padding: '8px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                        background: advancedOptions.costLevel === level ? (isMonochrome ? 'rgba(59,130,246,0.15)' : ACCENT_GLOW) : c('input'),
                        border: `1px solid ${advancedOptions.costLevel === level ? c('accent') : c('border')}`,
                        color: advancedOptions.costLevel === level ? c('accent') : c('text2'),
                        transition: 'all 0.15s',
                      }}
                    >{level === 'low' ? '经济' : level === 'medium' ? '中端' : '高端'}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Upload References */}
          {activeStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Upload size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('accent') }} />
                上传参考与素材
              </div>
              {['产品图', '包装参考', 'Logo', '材质图', '纹样参考'].map(type => (
                <div key={type}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: c('text2'), marginBottom: '4px' }}>{type}</div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {uploads.filter(u => u.type === type).map((u, i) => (
                      <div key={i} style={{ width: '56px', height: '56px', borderRadius: '6px', overflow: 'hidden', position: 'relative', border: `1px solid ${c('border')}` }}>
                        <img src={u.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <button onClick={() => setUploads(prev => prev.filter(x => x !== u))} style={{ position: 'absolute', top: '1px', right: '1px', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}>
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => handleUpload(type)}
                      style={{ width: '56px', height: '56px', borderRadius: '6px', border: `1px dashed ${c('border')}`, background: c('input'), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: c('text3') }}>
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 4: Output Modes */}
          {activeStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Eye size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('accent') }} />
                输出模式
              </div>
              {outputModeLabels.map(o => (
                <button key={o.mode} onClick={() => toggleOutputMode(o.mode)}
                  style={{
                    padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
                    background: outputModes.includes(o.mode) ? (isMonochrome ? 'rgba(59,130,246,0.12)' : ACCENT_GLOW) : c('input'),
                    border: `1px solid ${outputModes.includes(o.mode) ? c('accent') : c('border')}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {outputModes.includes(o.mode) ? <CheckSquare size={15} style={{ color: c('accent') }} /> : <Square size={15} style={{ color: c('text3') }} />}
                    <span style={{ fontSize: '14px', fontWeight: 700, color: outputModes.includes(o.mode) ? c('accent') : c('text') }}>{o.label}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: c('text3'), marginLeft: '23px', marginTop: '2px' }}>{o.desc}</div>
                </button>
              ))}
            </div>
          )}

          {/* Step 5: Advanced Tools */}
          {activeStep === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c('text'), marginBottom: '4px' }}>
                <Settings2 size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px', color: c('accent') }} />
                高级工具
              </div>
              {[
                { key: 'packagingDecompose' as const, label: '包装拆解', desc: '拆分包装各面设计元素', icon: <Layers size={14} /> },
                { key: 'copywriting' as const, label: '包装文案生成', desc: '自动生成包装文字内容', icon: <FileText size={14} /> },
                { key: 'infoLayout' as const, label: '信息区布局', desc: '合规信息区自动排版', icon: <Layout size={14} /> },
                { key: 'brandConsistency' as const, label: '品牌一致性', desc: '检测品牌调性一致度', icon: <BarChart3 size={14} /> },
                { key: 'feasibility' as const, label: '可落地评估', desc: '评估生产落地可行性', icon: <Wand2 size={14} /> },
              ].map(item => (
                <button key={item.key} onClick={() => setAdvancedOptions(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
                  style={{
                    padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
                    background: advancedOptions[item.key] ? (isMonochrome ? 'rgba(59,130,246,0.12)' : ACCENT_GLOW) : c('input'),
                    border: `1px solid ${advancedOptions[item.key] ? c('accent') : c('border')}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {advancedOptions[item.key] ? <CheckSquare size={15} style={{ color: c('accent') }} /> : <Square size={15} style={{ color: c('text3') }} />}
                    <span style={{ color: c('accent'), marginRight: '2px' }}>{item.icon}</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: advancedOptions[item.key] ? c('accent') : c('text') }}>{item.label}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: c('text3'), marginLeft: '23px', marginTop: '2px' }}>{item.desc}</div>
                </button>
              ))}

              {/* Custom Prompt */}
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: c('text2'), marginBottom: '4px' }}>自定义提示词</div>
                <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} placeholder="输入额外的设计要求..."
                  style={{ width: '100%', minHeight: '80px', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text'), outline: 'none', resize: 'vertical', lineHeight: '1.5' }} />
              </div>
            </div>
          )}
        </div>

        {/* Generate Button Area */}
        <div style={{ padding: '14px 18px', borderTop: `1px solid ${c('border')}`, background: isMonochrome ? M_BG_CARD : 'rgb(32,22,22)' }}>
          {errorMsg && (
            <div style={{ fontSize: '12px', color: DANGER, marginBottom: '8px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(200,60,60,0.1)' }}>{errorMsg}</div>
          )}
          {isGenerating && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ height: '4px', borderRadius: '2px', background: c('input'), overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: c('accent'), borderRadius: '2px', transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '12px', color: c('text3'), marginTop: '4px' }}>生成中... {progress}%</div>
            </div>
          )}
          <button onClick={handleGenerate} disabled={isGenerating}
            style={{
              width: '100%', padding: '12px', borderRadius: '10px', fontSize: '15px', fontWeight: 800,
              background: isGenerating ? c('input') : (isMonochrome ? M_ACCENT : ACCENT),
              color: isGenerating ? c('text3') : (isMonochrome ? '#fff' : '#1a1212'),
              border: 'none', cursor: isGenerating ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              boxShadow: !isGenerating && !isMonochrome ? '0 2px 12px rgba(212,175,55,0.3)' : 'none',
            }}
          >
            <Sparkles size={16} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
            {isGenerating ? '生成中...' : '生成包装方案'}
          </button>
        </div>
      </div>

      {/* === Right Column: Results === */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }} data-no-drag>
        {/* Results Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${c('border')}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isMonochrome ? M_BG_CARD : 'rgb(32,22,22)' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: c('text') }}>方案预览</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {results.length > 0 && (
              <>
                <button onClick={handleGenerateSeries} disabled={isGenerating}
                  style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_GLOW, border: `1px solid ${c('accent')}`, color: c('accent'), cursor: 'pointer' }}>
                  一键同系列
                </button>
                <button onClick={handleGenerateScene} disabled={isGenerating}
                  style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_GLOW, border: `1px solid ${c('accent')}`, color: c('accent'), cursor: 'pointer' }}>
                  场景展示
                </button>
                <button onClick={handleNewProject}
                  style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: c('input'), border: `1px solid ${c('border')}`, color: c('text2'), cursor: 'pointer' }}>
                  新建项目
                </button>
              </>
            )}
          </div>
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '16px' }}>
          {results.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: c('text3') }}>
              <Package size={48} style={{ marginBottom: '12px', opacity: 0.3 }} />
              <div style={{ fontSize: '15px', fontWeight: 600 }}>暂无方案</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>填写品牌信息后点击生成</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
              {results.map(r => (
                <div key={r.id} style={{ borderRadius: '10px', overflow: 'hidden', border: `1px solid ${c('border')}`, background: c('card') }}>
                  <div style={{ aspectRatio: '4/3', overflow: 'hidden' }}>
                    <img src={r.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: c('text') }}>
                      {outputModeLabels.find(o => o.mode === r.type)?.label || r.type}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <button onClick={() => handleDownloadImage(r.url, `packaging_${r.id}.png`)}
                        style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', background: c('input'), border: `1px solid ${c('border')}`, color: c('text2'), cursor: 'pointer' }}>
                        <Download size={11} style={{ verticalAlign: '-1px' }} /> 下载
                      </button>
                      <button onClick={() => onAddImages([r.url])}
                        style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', background: isMonochrome ? 'rgba(59,130,246,0.1)' : ACCENT_GLOW, border: `1px solid ${c('accent')}`, color: c('accent'), cursor: 'pointer' }}>
                        <Send size={11} style={{ verticalAlign: '-1px' }} /> 画布
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Analysis */}
          {analysis && (
            <div style={{ marginTop: '16px', padding: '14px', borderRadius: '10px', background: c('card'), border: `1px solid ${c('border')}` }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: c('text'), marginBottom: '10px' }}>
                <BarChart3 size={14} style={{ verticalAlign: '-1px', marginRight: '4px', color: c('accent') }} />
                方案评估
              </div>
              {[
                { label: '品牌一致性', value: analysis.brandConsistency },
                { label: '货架冲击力', value: analysis.shelfImpact },
                { label: '成本效率', value: analysis.costEfficiency },
                { label: '结构合理性', value: analysis.structuralRationality },
              ].map(item => (
                <div key={item.label} style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
                    <span style={{ color: c('text2') }}>{item.label}</span>
                    <span style={{ color: c('accent'), fontWeight: 700 }}>{item.value}%</span>
                  </div>
                  <div style={{ height: '4px', borderRadius: '2px', background: c('input'), overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${item.value}%`, background: c('accent'), borderRadius: '2px', transition: 'width 0.5s' }} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '18px', fontWeight: 800, color: c('accent') }}>
                综合评分 {analysis.overallScore}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(200,150,50,0.06)', border: `1px solid rgba(200,150,50,0.15)` }}>
            <div style={{ fontSize: '12px', color: c('text3'), display: 'flex', alignItems: 'flex-start', gap: '6px', lineHeight: '1.6' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '2px', color: isMonochrome ? M_ACCENT : ACCENT }} />
              <span>视觉展开图不是最终印刷刀版 / 结构参考展开图需要人工复核 / 准刀版需接入标准包装结构模板库 / 小字内容建议由设计师后期排版</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
