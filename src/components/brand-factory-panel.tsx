'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X, Plus, Trash2, Sparkles, Loader2, ChevronDown, ChevronRight,
  Palette, Compass, LayoutGrid, FolderOpen, Archive, ArchiveRestore,
  Copy, Download, Check, AlertTriangle, RefreshCw, Wand2, Eye,
  Image as ImageIcon, Building2, Edit3, Layers, Star, Search,
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

type TabId = 'projects' | 'dna' | 'directions' | 'materials';

const TAB_CONFIG: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'projects', label: '项目中心', icon: <FolderOpen size={14} /> },
  { id: 'dna', label: '品牌DNA', icon: <Palette size={14} /> },
  { id: 'directions', label: '创意方向', icon: <Compass size={14} /> },
  { id: 'materials', label: '物料中心', icon: <LayoutGrid size={14} /> },
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

const MATERIAL_TYPE_OPTIONS = [
  { id: 'social-wechat', label: '微信公众号头图', ratio: '2.35:1' },
  { id: 'social-xiaohongshu', label: '小红书封面', ratio: '3:4' },
  { id: 'social-douyin', label: '抖音封面', ratio: '9:16' },
  { id: 'social-weibo', label: '微博配图', ratio: '16:9' },
  { id: 'ecom-main', label: '电商主图', ratio: '1:1' },
  { id: 'ecom-detail', label: '详情页Banner', ratio: '3:1' },
  { id: 'ecom-poster', label: '电商海报', ratio: '3:4' },
  { id: 'offline-poster', label: '线下海报', ratio: '3:4' },
  { id: 'offline-card', label: '名片', ratio: '9:5' },
  { id: 'packaging-box', label: '包装盒', ratio: '1:1' },
  { id: 'packaging-bag', label: '包装袋', ratio: '3:4' },
  { id: 'ip-character', label: 'IP形象', ratio: '1:1' },
  { id: 'kv-main', label: '主KV', ratio: '16:9' },
  { id: 'brand-logo', label: '品牌Logo', ratio: '1:1' },
];

// ═══ Props ═══

interface BrandFactoryPanelProps {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[]) => void;
}

// ═══ Component ═══

export function BrandFactoryPanel({ isMonochrome = false, onClose, onAddImages }: BrandFactoryPanelProps) {
  // Theme
  const bg = isMonochrome ? 'bg-white' : 'bg-[#1a1a1a]';
  const bgDeep = isMonochrome ? 'bg-gray-50' : 'bg-[#111]';
  const bgCard = isMonochrome ? 'bg-gray-50' : 'bg-[#141414]';
  const border = isMonochrome ? 'border-gray-200' : 'border-white/[0.08]';
  const borderLight = isMonochrome ? 'border-gray-100' : 'border-white/[0.06]';
  const text = isMonochrome ? 'text-gray-900' : 'text-gray-100';
  const textSub = isMonochrome ? 'text-gray-500' : 'text-gray-400';
  const textMuted = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const accent = isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]';
  const accentHover = isMonochrome ? 'hover:bg-blue-600' : 'hover:bg-[#e0b840]';
  const accentText = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';
  const accentBg = isMonochrome ? 'bg-blue-50' : 'bg-[#d4af37]/10';
  const inputCls = isMonochrome
    ? 'bg-white border-gray-200 text-gray-900 focus:border-blue-500 placeholder:text-gray-400'
    : 'bg-[#111] border-white/[0.08] text-gray-100 focus:border-[#d4af37] placeholder:text-gray-500';

  // State
  const [activeTab, setActiveTab] = useState<TabId>('projects');
  const [projects, setProjects] = useState<BrandProject[]>([]);
  const [currentProject, setCurrentProject] = useState<BrandProject | null>(null);
  const [materials, setMaterials] = useState<BrandMaterial[]>([]);
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

  // Direction generation
  const [directionCount, setDirectionCount] = useState(3);
  const [selectedDirectionId, setSelectedDirectionId] = useState('');

  // Material generation
  const [selectedMaterialTypes, setSelectedMaterialTypes] = useState<Set<string>>(new Set());

  // ─── Load models ──────────────────────────────────────────────
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
  }, []);

  // ─── Load projects ────────────────────────────────────────────
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

  // ─── Load project detail ──────────────────────────────────────
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
      const rawMats = data.materials || [];
      setMaterials(rawMats);
    } catch { /* ignore */ }
  }, []);

  // ─── Create project ───────────────────────────────────────────
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
        setActiveTab('dna');
        setNewProjectName('');
        setNewBrandName('');
        setNewIndustry('');
        setNewTone('');
        setNewDescription('');
        setNewKeywords('');
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  // ─── Delete project ───────────────────────────────────────────
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

  // ─── Archive project ──────────────────────────────────────────
  const handleArchiveProject = async (id: string, archive: boolean) => {
    try {
      await fetch('/api/brand-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive-project', id, archive }),
      });
      await loadProjects();
      if (currentProject?.id === id) {
        await loadProject(id);
      }
    } catch { /* ignore */ }
  };

  // ─── Analyze DNA ──────────────────────────────────────────────
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
        // Save DNA to project
        await fetch('/api/brand-factory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update-project',
            id: currentProject.id,
            brandDna: data.dna,
          }),
        });
        await loadProject(currentProject.id);
      }
    } catch { /* ignore */ }
    setAnalyzing(false);
  };

  // ─── Generate Directions ──────────────────────────────────────
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
          body: JSON.stringify({
            action: 'update-project',
            id: currentProject.id,
            creativeDirections: directions,
          }),
        });
        await loadProject(currentProject.id);
      }
    } catch { /* ignore */ }
    setGenerating(false);
  };

  // ─── Batch Generate Materials ─────────────────────────────────
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
        // Save each material
        for (const mat of data.materials as Record<string, unknown>[]) {
          const mt = MATERIAL_TYPE_OPTIONS.find(o => o.id === mat.materialType);
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

  // ─── Delete material ──────────────────────────────────────────
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

  // ─── Select project ───────────────────────────────────────────
  const handleSelectProject = (p: BrandProject) => {
    setCurrentProject(p);
    loadProject(p.id);
    setActiveTab('dna');
  };

  // ═══ Render ═══

  return (
    <div
      data-popup="brand-factory"
      className={`fixed right-4 top-4 bottom-4 w-[420px] z-[90] flex flex-col rounded-2xl border overflow-hidden shadow-2xl ${bg} ${border}`}
      style={{ boxShadow: isMonochrome ? '0 8px 40px rgba(0,0,0,0.1)' : '0 8px 40px rgba(0,0,0,0.6)' }}
    >
      {/* Header */}
      <div className={`flex items-center justify-between px-5 py-3.5 border-b ${border} ${isMonochrome ? 'bg-gray-50' : 'bg-gradient-to-r from-[#1a1a1a] to-[#141414]'}`}>
        <div className="flex items-center gap-2.5">
          <Building2 size={18} className={accentText} />
          <span className={`text-base font-semibold ${text}`}>品牌工厂</span>
          {currentProject && (
            <span className={`text-xs ${textMuted} truncate max-w-[140px]`}>{currentProject.brandName}</span>
          )}
        </div>
        <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${isMonochrome ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-gray-500 hover:text-white hover:bg-white/10'}`}>
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className={`flex border-b ${border}`}>
        {TAB_CONFIG.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all border-b-2 ${
              activeTab === tab.id
                ? `${accentText} border-current`
                : `${textMuted} border-transparent hover:${textSub}`
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'thin' }}>
        {/* ═══ PROJECTS TAB ═══ */}
        {activeTab === 'projects' && (
          <>
            {/* Create new project */}
            <div className={`p-4 rounded-xl border ${border} ${bgCard} space-y-3`}>
              <h3 className={`text-sm font-semibold ${text} flex items-center gap-2`}>
                <Plus size={14} className={accentText} /> 新建项目
              </h3>
              <input
                className={`w-full px-3 py-2 rounded-lg border text-sm ${inputCls} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
                placeholder="品牌名称 *"
                value={newBrandName}
                onChange={e => setNewBrandName(e.target.value)}
              />
              <input
                className={`w-full px-3 py-2 rounded-lg border text-sm ${inputCls} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
                placeholder="项目名称（默认与品牌名相同）"
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
              />
              <div className="flex gap-2">
                <select
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm ${inputCls} focus:outline-none`}
                  value={newIndustry}
                  onChange={e => setNewIndustry(e.target.value)}
                >
                  <option value="">选择行业</option>
                  {INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <select
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm ${inputCls} focus:outline-none`}
                  value={newTone}
                  onChange={e => setNewTone(e.target.value)}
                >
                  <option value="">品牌调性</option>
                  {TONE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <input
                className={`w-full px-3 py-2 rounded-lg border text-sm ${inputCls} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'}`}
                placeholder="关键词（逗号分隔）"
                value={newKeywords}
                onChange={e => setNewKeywords(e.target.value)}
              />
              <textarea
                className={`w-full px-3 py-2 rounded-lg border text-sm ${inputCls} focus:outline-none focus:ring-1 ${isMonochrome ? 'focus:ring-blue-500/30' : 'focus:ring-[#d4af37]/30'} resize-none`}
                rows={3}
                placeholder="品牌描述（可选）"
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
              />
              <button
                onClick={handleCreateProject}
                disabled={loading || !newBrandName.trim()}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  loading || !newBrandName.trim()
                    ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed`
                    : `${accent} text-black ${accentHover} shadow-lg active:scale-[0.98]`
                }`}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                创建项目
              </button>
            </div>

            {/* Project list */}
            <div className="space-y-2">
              <h3 className={`text-xs font-medium ${textMuted} uppercase tracking-wider`}>我的项目</h3>
              {projects.length === 0 ? (
                <div className={`text-center py-8 ${textMuted} text-sm`}>
                  暂无项目，创建一个开始品牌设计
                </div>
              ) : (
                projects.map(p => (
                  <div
                    key={p.id}
                    onClick={() => handleSelectProject(p)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      currentProject?.id === p.id
                        ? `${accentBg} ${isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/30'}`
                        : `${border} ${bgCard} hover:${isMonochrome ? 'border-blue-200' : 'border-white/[0.15]'}`
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${text} truncate`}>{p.brandName}</div>
                        <div className={`text-xs ${textMuted} mt-0.5`}>
                          {p.industry && <span>{p.industry} · </span>}
                          {p.tone && <span>{p.tone}</span>}
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
                        <button
                          onClick={() => handleArchiveProject(p.id, !p.isArchived)}
                          className={`p-1 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-blue-600 hover:bg-blue-50' : 'text-gray-500 hover:text-[#d4af37] hover:bg-[#d4af37]/10'}`}
                          title={p.isArchived ? '取消归档' : '归档'}
                        >
                          {p.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                        </button>
                        <button
                          onClick={() => handleDeleteProject(p.id)}
                          className={`p-1 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'}`}
                          title="删除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ═══ DNA TAB ═══ */}
        {activeTab === 'dna' && (
          <>
            {!currentProject ? (
              <div className={`text-center py-12 ${textMuted} text-sm`}>
                请先在项目中心选择或创建一个项目
              </div>
            ) : (
              <>
                {/* Project Info */}
                <div className={`p-4 rounded-xl border ${border} ${bgCard} space-y-3`}>
                  <h3 className={`text-sm font-semibold ${text} flex items-center gap-2`}>
                    <Building2 size={14} className={accentText} /> {currentProject.brandName}
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {currentProject.industry && <div><span className={textMuted}>行业：</span><span className={textSub}>{currentProject.industry}</span></div>}
                    {currentProject.tone && <div><span className={textMuted}>调性：</span><span className={textSub}>{currentProject.tone}</span></div>}
                  </div>
                  {currentProject.description && <p className={`text-xs ${textSub}`}>{currentProject.description}</p>}
                </div>

                {/* Analyze DNA Button */}
                <button
                  onClick={handleAnalyzeDNA}
                  disabled={analyzing}
                  className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                    analyzing
                      ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed`
                      : `${accent} text-black ${accentHover} shadow-lg active:scale-[0.98]`
                  }`}
                >
                  {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {analyzing ? 'AI分析中...' : 'AI分析品牌DNA'}
                </button>

                {/* DNA Results */}
                {currentProject.brandDna && Object.keys(currentProject.brandDna).length > 0 && (
                  <div className={`p-4 rounded-xl border ${border} ${bgCard} space-y-3`}>
                    <h3 className={`text-sm font-semibold ${text} flex items-center gap-2`}>
                      <Palette size={14} className={accentText} /> 品牌DNA
                    </h3>

                    {/* Brand Keywords */}
                    {((currentProject.brandDna as Record<string, unknown>).brandKeywords as string[])?.length > 0 && (
                      <div>
                        <div className={`text-xs ${textMuted} mb-1.5`}>品牌关键词</div>
                        <div className="flex flex-wrap gap-1.5">
                          {((currentProject.brandDna as Record<string, unknown>).brandKeywords as string[]).map((k, i) => (
                            <span key={i} className={`text-xs px-2 py-1 rounded-lg ${isMonochrome ? 'bg-blue-50 text-blue-700' : 'bg-[#d4af37]/10 text-[#d4af37]'}`}>{k}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Main Colors */}
                    {((currentProject.brandDna as Record<string, unknown>).mainColors as string[])?.length > 0 && (
                      <div>
                        <div className={`text-xs ${textMuted} mb-1.5`}>主色调</div>
                        <div className="flex flex-wrap gap-2">
                          {((currentProject.brandDna as Record<string, unknown>).mainColors as string[]).map((c, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <div className="w-6 h-6 rounded-lg border border-white/10" style={{ background: c }} />
                              <span className={`text-[10px] ${textSub}`}>{c}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Secondary Colors */}
                    {((currentProject.brandDna as Record<string, unknown>).secondaryColors as string[])?.length > 0 && (
                      <div>
                        <div className={`text-xs ${textMuted} mb-1.5`}>辅助色</div>
                        <div className="flex flex-wrap gap-2">
                          {((currentProject.brandDna as Record<string, unknown>).secondaryColors as string[]).map((c, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-md border border-white/10" style={{ background: c }} />
                              <span className={`text-[10px] ${textSub}`}>{c}</span>
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
                      const val = (currentProject.brandDna as Record<string, unknown>)[key];
                      if (!val || typeof val !== 'string') return null;
                      return (
                        <div key={key}>
                          <div className={`text-xs ${textMuted} mb-1`}>{label}</div>
                          <div className={`text-xs ${textSub} p-2 rounded-lg ${bgDeep} leading-relaxed`}>{val}</div>
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
                      const val = (currentProject.brandDna as Record<string, unknown>)[key];
                      if (!val || !Array.isArray(val) || val.length === 0) return null;
                      return (
                        <div key={key}>
                          <div className={`text-xs ${textMuted} mb-1`}>{label}</div>
                          <ul className="space-y-0.5">
                            {(val as string[]).map((r, i) => (
                              <li key={i} className={`text-xs ${textSub} flex items-start gap-1.5`}>
                                <span className={`mt-1 w-1 h-1 rounded-full flex-shrink-0 ${accent} scale-75`} />
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}

                    {/* Recommended Materials */}
                    {((currentProject.brandDna as Record<string, unknown>).recommendedMaterials as string[])?.length > 0 && (
                      <div>
                        <div className={`text-xs ${textMuted} mb-1.5`}>推荐物料</div>
                        <div className="flex flex-wrap gap-1.5">
                          {((currentProject.brandDna as Record<string, unknown>).recommendedMaterials as string[]).map((m, i) => (
                            <span key={i} className={`text-[10px] px-2 py-0.5 rounded ${isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-[#222] text-gray-400'}`}>{m}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* LLM Model Selection */}
                <div className={`p-3 rounded-xl border ${borderLight} ${bgCard}`}>
                  <div className={`text-xs ${textMuted} mb-2`}>分析模型</div>
                  <select
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${inputCls} focus:outline-none`}
                    value={selectedLlmModel}
                    onChange={e => setSelectedLlmModel(e.target.value)}
                  >
                    {llmModels.length === 0 && <option value="">请先配置LLM模型</option>}
                    {llmModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ DIRECTIONS TAB ═══ */}
        {activeTab === 'directions' && (
          <>
            {!currentProject ? (
              <div className={`text-center py-12 ${textMuted} text-sm`}>
                请先在项目中心选择或创建一个项目
              </div>
            ) : (
              <>
                {/* Generate directions */}
                <div className={`p-4 rounded-xl border ${border} ${bgCard} space-y-3`}>
                  <h3 className={`text-sm font-semibold ${text} flex items-center gap-2`}>
                    <Compass size={14} className={accentText} /> 生成创意方向
                  </h3>
                  {Object.keys(currentProject.brandDna || {}).length === 0 && (
                    <div className={`text-xs ${textMuted} flex items-center gap-1.5`}>
                      <AlertTriangle size={12} /> 建议先分析品牌DNA，以获得更精准的创意方向
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${textMuted}`}>方向数量</span>
                    <div className="flex gap-1.5">
                      {[2, 3, 4, 5].map(n => (
                        <button
                          key={n}
                          onClick={() => setDirectionCount(n)}
                          className={`w-7 h-7 rounded-lg text-xs font-medium transition-all ${
                            directionCount === n
                              ? `${accent} text-black`
                              : `${bgDeep} ${textSub} hover:${text}`
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={handleGenerateDirections}
                    disabled={generating}
                    className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                      generating
                        ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed`
                        : `${accent} text-black ${accentHover} shadow-lg active:scale-[0.98]`
                    }`}
                  >
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {generating ? '生成中...' : '生成创意方向'}
                  </button>
                </div>

                {/* Direction List */}
                {currentProject.creativeDirections?.length > 0 && (
                  <div className="space-y-2">
                    <h3 className={`text-xs font-medium ${textMuted} uppercase tracking-wider`}>创意方向</h3>
                    {currentProject.creativeDirections.map((dir, idx) => (
                      <div
                        key={dir.id || idx}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          selectedDirectionId === dir.id
                            ? `${accentBg} ${isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/30'}`
                            : `${border} ${bgCard} hover:border-white/[0.15]`
                        }`}
                        onClick={() => setSelectedDirectionId(dir.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold ${accentText}`}>#{idx + 1}</span>
                              <span className={`text-sm font-semibold ${text}`}>{dir.name || `方向 ${idx + 1}`}</span>
                            </div>
                            {dir.slogan && <p className={`text-xs ${accentText} mt-1 italic`}>{dir.slogan}</p>}
                            {dir.concept && <p className={`text-xs ${textSub} mt-1 line-clamp-2`}>{dir.concept}</p>}
                            {dir.visualKeywords?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {dir.visualKeywords.slice(0, 5).map((k, i) => (
                                  <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/10 text-[#d4af37]/80'}`}>{k}</span>
                                ))}
                              </div>
                            )}
                            {dir.colorPlan?.length > 0 && (
                              <div className="flex gap-1.5 mt-2">
                                {dir.colorPlan.map((c, i) => (
                                  <div key={i} className="w-5 h-5 rounded-md border border-white/10" style={{ background: c }} title={c} />
                                ))}
                              </div>
                            )}
                          </div>
                          <ChevronRight size={14} className={`${textMuted} mt-1 flex-shrink-0`} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══ MATERIALS TAB ═══ */}
        {activeTab === 'materials' && (
          <>
            {!currentProject ? (
              <div className={`text-center py-12 ${textMuted} text-sm`}>
                请先在项目中心选择或创建一个项目
              </div>
            ) : (
              <>
                {/* Material type selector */}
                <div className={`p-4 rounded-xl border ${border} ${bgCard} space-y-3`}>
                  <h3 className={`text-sm font-semibold ${text} flex items-center gap-2`}>
                    <LayoutGrid size={14} className={accentText} /> 批量生成物料
                  </h3>
                  <div className="grid grid-cols-2 gap-1.5 max-h-[240px] overflow-y-auto">
                    {MATERIAL_TYPE_OPTIONS.map(mt => (
                      <button
                        key={mt.id}
                        onClick={() => {
                          setSelectedMaterialTypes(prev => {
                            const next = new Set(prev);
                            if (next.has(mt.id)) next.delete(mt.id); else next.add(mt.id);
                            return next;
                          });
                        }}
                        className={`px-2.5 py-2 rounded-lg border text-left transition-all ${
                          selectedMaterialTypes.has(mt.id)
                            ? `${accentBg} ${isMonochrome ? 'border-blue-300' : 'border-[#d4af37]/30'} ${accentText}`
                            : `${border} ${textSub} hover:${text}`
                        }`}
                      >
                        <div className="text-xs font-medium">{mt.label}</div>
                        <div className={`text-[10px] ${textMuted}`}>{mt.ratio}</div>
                      </button>
                    ))}
                  </div>
                  {selectedMaterialTypes.size > 0 && (
                    <div className={`text-xs ${textMuted}`}>
                      已选择 <span className={accentText}>{selectedMaterialTypes.size}</span> 种物料
                    </div>
                  )}
                  <button
                    onClick={handleBatchGenerate}
                    disabled={generating || selectedMaterialTypes.size === 0}
                    className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                      generating || selectedMaterialTypes.size === 0
                        ? `${isMonochrome ? 'bg-blue-200 text-blue-400' : 'bg-[#222]/80 text-[#555]'} cursor-not-allowed`
                        : `${accent} text-black ${accentHover} shadow-lg active:scale-[0.98]`
                    }`}
                  >
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {generating ? '生成中...' : '批量生成Prompt'}
                  </button>
                </div>

                {/* Material list */}
                {materials.length > 0 && (
                  <div className="space-y-2">
                    <h3 className={`text-xs font-medium ${textMuted} uppercase tracking-wider`}>物料列表</h3>
                    {materials.map(mat => (
                      <div key={mat.id} className={`p-3 rounded-xl border ${border} ${bgCard}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium ${text}`}>{mat.title || '未命名物料'}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-[#222] text-gray-400'}`}>
                                {mat.materialType}
                              </span>
                              <span className={`text-[10px] ${textMuted}`}>{mat.ratio}</span>
                            </div>
                            {mat.prompt && (
                              <p className={`text-xs ${textSub} mt-1.5 line-clamp-2 leading-relaxed`}>{mat.prompt}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            {mat.imageUrl && (
                              <button
                                onClick={() => onAddImages?.([mat.imageUrl])}
                                className={`p-1.5 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-blue-600 hover:bg-blue-50' : 'text-gray-500 hover:text-[#d4af37] hover:bg-[#d4af37]/10'}`}
                                title="添加到画布"
                              >
                                <ImageIcon size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteMaterial(mat.id)}
                              className={`p-1.5 rounded-lg ${isMonochrome ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'}`}
                              title="删除"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default BrandFactoryPanel;
