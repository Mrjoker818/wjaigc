'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ShoppingBag, Loader2, Sparkles, Settings, GripVertical } from 'lucide-react';
import { BrandTemplateSelector } from './brand-ecommerce/BrandTemplateSelector';
import { BrandSettingsForm } from './brand-ecommerce/BrandSettingsForm';
import { BrandResultGallery, type GenerateResult } from './brand-ecommerce/BrandResultGallery';
import { BrandAssetManager, type BrandAssetData } from './brand-ecommerce/BrandAssetManager';

// ─── Types ────────────────────────────────────────────────────────

interface EcomTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  promptTemplate: string;
  negativePrompt: string;
  aspectRatio: string;
  category: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyPreview: string;
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

interface Props {
  isMonochrome?: boolean;
  onClose: () => void;
  onAddImages?: (urls: string[]) => void;
  referenceImageUrl?: string;
}

// ─── Component ────────────────────────────────────────────────────

export function BrandEcommercePanel({ isMonochrome = false, onClose, onAddImages, referenceImageUrl }: Props) {
  // Theme shortcuts
  const bg = isMonochrome ? 'bg-white' : 'bg-[#1a1a1a]';
  const bgDeep = isMonochrome ? 'bg-gray-50' : 'bg-[#141414]';
  const border = isMonochrome ? 'border-gray-200' : 'border-white/[0.08]';
  const text = isMonochrome ? 'text-gray-900' : 'text-gray-100';
  const textSub = isMonochrome ? 'text-gray-500' : 'text-gray-400';
  const textMuted = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const accent = isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]';
  const accentHover = isMonochrome ? 'hover:bg-blue-600' : 'hover:bg-[#e0b840]';
  const accentText = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';
  const accentColor = isMonochrome ? '#2563eb' : '#d4af37';

  // ─── State ────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<EcomTemplate[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<ImageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [llmModels, setLlmModels] = useState<LlmModel[]>([]);
  const [selectedLlmModel, setSelectedLlmModel] = useState('');
  const [productDesc, setProductDesc] = useState('');
  const [styleExtra, setStyleExtra] = useState('');
  const [mainText, setMainText] = useState('');
  const [secondaryText, setSecondaryText] = useState('');
  const [accentSymbol, setAccentSymbol] = useState('');
  const [sceneDesc, setSceneDesc] = useState('modern minimalist interior');
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [colorInput, setColorInput] = useState('');
  const [refImage, setRefImage] = useState(referenceImageUrl || '');
  const [refImageFile, setRefImageFile] = useState<File | null>(null);
  const [productImage, setProductImage] = useState('');
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAssisting, setIsAssisting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [results, setResults] = useState<GenerateResult[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'template' | 'settings' | 'results'>('template');
  const [showLlmDropdown, setShowLlmDropdown] = useState(false);
  const llmDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // ─── Drag state ───────────────────────────────────────────────
  const panelW = 680;
  const panelH = 600;
  const [position, setPosition] = useState(() => {
    if (typeof window !== 'undefined') {
      return { x: Math.max(0, (window.innerWidth - panelW) / 2), y: Math.max(0, (window.innerHeight - panelH) / 2) };
    }
    return { x: 0, y: 0 };
  });
  const isDragging = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // ─── Drag handlers ────────────────────────────────────────────
  const handlePanelDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    setIsDraggingState(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      ev.stopPropagation();
      setPosition({ x: ev.clientX - dragStart.current.x, y: ev.clientY - dragStart.current.y });
    };
    const onMouseUp = (ev: MouseEvent) => {
      ev.stopPropagation();
      isDragging.current = false;
      setIsDraggingState(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // ─── Load templates ───────────────────────────────────────────

  useEffect(() => {
    fetch('/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'templates' }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setTemplates(data.templates);
          setSelectedTemplates(new Set(['white-bg', 'scene-lifestyle']));
        }
      })
      .catch(() => {});
  }, []);

  // ─── Load models ──────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/models?type=image')
      .then(r => r.json())
      .then(data => {
        const providers: ProviderInfo[] = data.providers || [];
        const providerMap = new Map(providers.map((p: ProviderInfo) => [p.id, p]));
        const modelList = data.models || [];
        if (modelList.length) {
          const mapped = modelList.map((m: { id: string; name: string; providerId?: string }) => {
            const prov = providerMap.get(m.providerId || '');
            return { id: m.id, name: m.name, providerId: m.providerId || '', providerName: prov?.name || '' };
          });
          setModels(mapped);
          const saved = localStorage.getItem('wujie_selected_model');
          if (saved && mapped.some((m: ImageModel) => m.id === saved)) {
            setSelectedModel(saved);
          } else if (mapped.length) {
            setSelectedModel(mapped[0].id);
          }
        }
      })
      .catch(() => {});

    fetch('/api/models?type=chat')
      .then(r => r.json())
      .then(data => {
        const providers: ProviderInfo[] = data.providers || [];
        const providerMap = new Map(providers.map((p: ProviderInfo) => [p.id, p]));
        const modelList = data.models || [];
        if (modelList.length) {
          const mapped = modelList.map((m: { id: string; name: string; providerId?: string }) => {
            const prov = providerMap.get(m.providerId || '');
            return { id: m.id, name: m.name, providerId: m.providerId || '', providerName: prov?.name || '' };
          });
          setLlmModels(mapped);
          const saved = localStorage.getItem('wujie_selected_llm_model');
          if (saved && mapped.some((m: LlmModel) => m.id === saved)) {
            setSelectedLlmModel(saved);
          } else if (mapped.length) {
            setSelectedLlmModel(mapped[0].id);
          }
        }
      })
      .catch(() => {});
  }, []);

  // ─── Close dropdowns on outside click ─────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
      if (llmDropdownRef.current && !llmDropdownRef.current.contains(e.target as Node)) {
        setShowLlmDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Upload reference image ──────────────────────────────────

  const handleFileUpload = useCallback(async (file: File) => {
    setRefImageFile(file);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const resp = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: dataUrl }),
      });
      const data = await resp.json();
      if (data.url) setRefImage(data.url);
    } catch {
      setRefImage(URL.createObjectURL(file));
    }
  }, []);

  const handleProductImageUpload = useCallback(async (file: File) => {
    setProductImageFile(file);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const resp = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: dataUrl }),
      });
      const data = await resp.json();
      if (data.url) setProductImage(data.url);
    } catch {
      setProductImage(URL.createObjectURL(file));
    }
  }, []);

  // ─── Toggle template ─────────────────────────────────────────

  const toggleTemplate = useCallback((id: string) => {
    setSelectedTemplates(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Add / remove brand color ────────────────────────────────

  const addBrandColor = useCallback(() => {
    const c = colorInput.trim();
    if (c && !brandColors.includes(c) && brandColors.length < 5) {
      setBrandColors(prev => [...prev, c]);
      setColorInput('');
    }
  }, [colorInput, brandColors]);

  const removeBrandColor = useCallback((c: string) => {
    setBrandColors(prev => prev.filter(x => x !== c));
  }, []);

  // ─── Generate (async submit + poll with incremental results) ──

  const handleGenerate = useCallback(async () => {
    if (!selectedTemplates.size || !productDesc.trim()) return;
    if (!selectedModel) {
      setActiveTab('settings');
      return;
    }
    setIsGenerating(true);
    setResults([]);
    setProgress(0);
    setActiveTab('results');

    try {
      // ★ Simulated progress while waiting
      let simProgress = 5;
      const progressInterval = setInterval(() => {
        simProgress = Math.min(simProgress + Math.random() * 5, 90);
        setProgress(Math.round(simProgress));
      }, 3000);

      const resp = await fetch('/api/brand-ecommerce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          templateIds: Array.from(selectedTemplates),
          productDesc: productDesc.trim(),
          styleExtra: styleExtra.trim(),
          sceneDesc: sceneDesc.trim(),
          model: selectedModel,
          referenceImageUrl: refImage,
          productImageUrl: productImage,
          brandColors,
          variantCount: 2, // ★ Request 2 variants per template
        }),
        signal: AbortSignal.timeout(600000),
      });
      clearInterval(progressInterval);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.error('[brand-ecommerce-panel] HTTP error:', resp.status, errText);
        setResults([{ templateId: 'error', templateName: '生成失败', error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` }]);
        setIsGenerating(false);
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = await resp.json();
      } catch {
        setResults([{ templateId: 'error', templateName: '生成失败', error: '响应解析失败' }]);
        setIsGenerating(false);
        return;
      }

      if (data.error) {
        setResults([{ templateId: 'error', templateName: '生成失败', error: String(data.error) }]);
        setIsGenerating(false);
        return;
      }

      // ★ Sync mode: results returned directly
      const syncResults = data.results as GenerateResult[] | undefined;
      if (syncResults && syncResults.length > 0) {
        setResults(syncResults);
        setIsGenerating(false);
        return;
      }

      // ★ Fallback: poll mode (async task)
      const respTaskId = data.taskId as string | undefined;
      if (respTaskId) {
        setTaskId(respTaskId);
        let pollAttempts = 0;
        const maxPollAttempts = 120;

        const poll = async () => {
          if (pollAttempts >= maxPollAttempts) {
            setResults(prev => prev.length ? prev : [{ templateId: 'error', templateName: '生成失败', error: '轮询超时' }]);
            setIsGenerating(false);
            setTaskId(null);
            return;
          }
          pollAttempts++;
          try {
            const pollResp = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: respTaskId }),
            });
            const pollData = await pollResp.json();

            // ★ Incremental: if partial results available, append them
            if (pollData.partialResults && Array.isArray(pollData.partialResults)) {
              setResults(prev => {
                const existingIds = new Set(prev.map(r => `${r.templateId}-v${r.variantIndex ?? 0}`));
                const newResults = (pollData.partialResults as GenerateResult[]).filter(
                  (r: GenerateResult) => !existingIds.has(`${r.templateId}-v${r.variantIndex ?? 0}`)
                );
                return [...prev, ...newResults];
              });
            }

            if (pollData.status === 'completed' && pollData.result?.results) {
              setResults(pollData.result.results);
              setIsGenerating(false);
              setTaskId(null);
              return;
            }
            if (pollData.status === 'failed' || pollData.status === 'cancelled') {
              setResults(prev => prev.length ? prev : [{ templateId: 'error', templateName: '生成失败', error: pollData.error || '任务失败' }]);
              setIsGenerating(false);
              setTaskId(null);
              return;
            }
            if (pollData.progress !== undefined) setProgress(pollData.progress);
            if (pollData.label) setProgressLabel(pollData.label);
            setTimeout(poll, 3000);
          } catch {
            setTimeout(poll, 3000);
          }
        };
        setTimeout(poll, 3000);
      } else {
        setResults([{ templateId: 'error', templateName: '生成失败', error: 'API返回格式异常' }]);
        setIsGenerating(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '网络错误';
      setResults([{ templateId: 'error', templateName: '生成失败', error: msg }]);
      setIsGenerating(false);
    }
  }, [selectedTemplates, productDesc, styleExtra, sceneDesc, selectedModel, refImage, brandColors, productImage]);

  // ─── Add to canvas ────────────────────────────────────────────

  const handleAddToCanvas = useCallback((urls?: string[]) => {
    const targetUrls = urls || results.filter(r => r.imageUrl).map(r => r.imageUrl!);
    if (targetUrls.length && onAddImages) {
      onAddImages(targetUrls);
    }
  }, [results, onAddImages]);

  // ─── Cancel ──────────────────────────────────────────────────

  const handleCancel = useCallback(async () => {
    if (taskId) {
      try {
        await fetch('/api/cancel-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
      } catch { /* ignore */ }
      setTaskId(null);
    }
    setIsGenerating(false);
  }, [taskId]);

  // ─── Regenerate single template ──────────────────────────────

  const handleRegenerateTemplate = useCallback((templateId: string) => {
    // Remove results for this template and re-generate just it
    setResults(prev => prev.filter(r => r.templateId !== templateId));
    // Trigger generation for just this template
    if (!selectedModel || !productDesc.trim()) return;

    setIsGenerating(true);
    setProgress(0);
    setProgressLabel('重新生成...');

    fetch('/api/brand-ecommerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generate',
        templateIds: [templateId],
        productDesc: productDesc.trim(),
        styleExtra: styleExtra.trim(),
        sceneDesc: sceneDesc.trim(),
        model: selectedModel,
        referenceImageUrl: refImage,
        productImageUrl: productImage,
        brandColors,
        variantCount: 2,
      }),
      signal: AbortSignal.timeout(300000),
    })
      .then(r => r.json())
      .then(data => {
        if (data.results) {
          setResults(prev => [...prev.filter(r => r.templateId !== templateId), ...data.results]);
        } else if (data.taskId) {
          // Poll for single template
          const pollId = data.taskId;
          const poll = async () => {
            try {
              const pr = await fetch('/api/poll-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: pollId }) });
              const pd = await pr.json();
              if (pd.status === 'completed' && pd.result?.results) {
                setResults(prev => [...prev.filter(r => r.templateId !== templateId), ...pd.result.results]);
                setIsGenerating(false);
                return;
              }
              if (pd.status === 'failed' || pd.status === 'cancelled') {
                setIsGenerating(false);
                return;
              }
              setTimeout(poll, 3000);
            } catch { setTimeout(poll, 3000); }
          };
          setTimeout(poll, 2000);
        }
      })
      .catch(() => setIsGenerating(false));
  }, [selectedModel, productDesc, styleExtra, sceneDesc, refImage, productImage, brandColors]);

  // ─── AI Assist ────────────────────────────────────────────────

  const handleAiAssist = useCallback(async () => {
    if (!selectedLlmModel || !productDesc.trim()) return;
    setIsAssisting(true);
    try {
      const resp = await fetch('/api/brand-ecommerce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assist',
          productDesc: productDesc.trim(),
          sceneDesc: sceneDesc.trim(),
          templateIds: Array.from(selectedTemplates),
          model: selectedLlmModel,
        }),
      });
      const data = await resp.json();
      if (data.error) {
        console.error('AI assist error:', data.error);
      } else if (data.suggestions) {
        const s = data.suggestions;
        if (s.mainText && !mainText) setMainText(s.mainText);
        if (s.secondaryText && !secondaryText) setSecondaryText(s.secondaryText);
        if (s.accentSymbol && !accentSymbol) setAccentSymbol(s.accentSymbol);
        if (s.styleExtra && !styleExtra.trim()) setStyleExtra(s.styleExtra);
        if (s.sceneDesc && !sceneDesc.trim()) setSceneDesc(s.sceneDesc);
        if (s.subjectAction) setProductDesc(prev => prev.includes(s.subjectAction) ? prev : `${prev}，${s.subjectAction}`);
        if (s.backgroundElements) setSceneDesc(prev => prev ? `${prev}，${s.backgroundElements}` : s.backgroundElements);
      }
    } catch (err) {
      console.error('AI assist failed:', err);
    }
    setIsAssisting(false);
  }, [selectedLlmModel, productDesc, sceneDesc, selectedTemplates, mainText, secondaryText, accentSymbol, styleExtra]);

  // ─── Apply loaded brand asset ────────────────────────────────────

  const handleApplyBrandAsset = useCallback((asset: BrandAssetData) => {
    if (asset.productDesc) setProductDesc(asset.productDesc);
    if (asset.styleExtra) setStyleExtra(asset.styleExtra);
    if (asset.sceneDesc) setSceneDesc(asset.sceneDesc);
    if (asset.brandColors?.length) setBrandColors(asset.brandColors);
    if (asset.referenceImageUrl) setRefImage(asset.referenceImageUrl);
    if (asset.productImageUrl) setProductImage(asset.productImageUrl);
    if (asset.mainText) setMainText(asset.mainText);
    if (asset.secondaryText) setSecondaryText(asset.secondaryText);
    if (asset.accentSymbol) setAccentSymbol(asset.accentSymbol);
    if (asset.selectedModel && models.some(m => m.id === asset.selectedModel)) {
      setSelectedModel(asset.selectedModel);
    }
    // Switch to settings tab so user can review
    setActiveTab('settings');
  }, [models]);

  // ─── Success results count ────────────────────────────────────

  const successResults = results.filter(r => r.imageUrl);

  // ─── Tab labels ──────────────────────────────────────────────

  const tabLabels: Record<string, string> = {
    template: '模板选择',
    settings: '生成设置',
    results: `生成结果${successResults.length ? ` (${successResults.length})` : ''}`,
  };

  return (
    <div
      className="fixed z-[150]"
      data-floating-panel="true"
      style={{ left: position.x, top: position.y, width: panelW, maxHeight: '85vh' }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      {/* Panel */}
      <div
        data-floating-panel="true"
        className="rounded-2xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: isMonochrome ? '#fff' : '#1c1c1c',
          border: isDraggingState ? `2px solid ${accentColor}` : `1px solid ${isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.1)'}`,
          boxShadow: isDraggingState
            ? (isMonochrome ? '0 0 24px rgba(37,99,235,0.25), 0 25px 50px -12px rgba(0,0,0,0.25)' : '0 0 24px rgba(212,175,55,0.3), 0 25px 50px -12px rgba(0,0,0,0.5)')
            : (isMonochrome ? '0 25px 50px -12px rgba(0,0,0,0.15)' : '0 25px 50px -12px rgba(0,0,0,0.5)'),
          maxHeight: '85vh',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center gap-2 px-3 py-2 select-none shrink-0 cursor-grab active:cursor-grabbing"
          style={{ borderBottom: `1px solid ${isMonochrome ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}` }}
          onMouseDown={handlePanelDragStart}
        >
          <GripVertical size={14} style={{ color: isMonochrome ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)' }} />
          <ShoppingBag size={15} style={{ color: isMonochrome ? '#6b6b6b' : '#d4af37' }} />
          <span className="text-base font-semibold flex-1" style={{ color: isMonochrome ? '#6b6b6b' : '#d4af37' }}>
            品牌电商
          </span>
          <BrandAssetManager
            currentSettings={{
              productDesc,
              styleExtra,
              sceneDesc,
              brandColors,
              refImage,
              productImage,
              selectedModel,
              mainText,
              secondaryText,
              accentSymbol,
            }}
            onApply={handleApplyBrandAsset}
            userId="default"
            isMonochrome={isMonochrome}
          />
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: isMonochrome ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.5)', background: isMonochrome ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)' }}>
            模板批量生成
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors cursor-pointer"
            style={{ color: isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)' }}
            onMouseEnter={e => (e.currentTarget.style.color = isMonochrome ? '#000' : '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)')}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex items-center gap-1 px-5 pt-3 pb-0">
          {(['template', 'settings', 'results'] as const).map(tab => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3.5 py-2 text-sm font-medium rounded-t-lg transition-colors cursor-pointer ${
                  active
                    ? isMonochrome ? 'bg-gray-50 text-blue-600 border border-b-0 border-gray-200' : 'bg-[#111] text-[#d4af37] border border-b-0 border-white/[0.08]'
                    : isMonochrome ? 'text-gray-400 hover:text-gray-600' : 'text-[#666] hover:text-[#999]'
                }`}
              >
                {tabLabels[tab]}
              </button>
            );
          })}
        </div>

        {/* ── Content ── */}
        <div className={`flex-1 overflow-y-auto px-5 py-4 ${bgDeep}`}>

          {/* Tab: Template Selection */}
          {activeTab === 'template' && (
            <BrandTemplateSelector
              templates={templates}
              selectedTemplates={selectedTemplates}
              onToggle={toggleTemplate}
              onSelectAll={() => setSelectedTemplates(new Set(templates.map(t => t.id)))}
              onClearAll={() => setSelectedTemplates(new Set())}
              isMonochrome={isMonochrome}
            />
          )}

          {/* Tab: Settings */}
          {activeTab === 'settings' && (
            <BrandSettingsForm
              models={models}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              showModelDropdown={showModelDropdown}
              onToggleModelDropdown={() => setShowModelDropdown(v => !v)}
              modelDropdownRef={modelDropdownRef}
              llmModels={llmModels}
              selectedLlmModel={selectedLlmModel}
              onSelectLlmModel={setSelectedLlmModel}
              showLlmDropdown={showLlmDropdown}
              onToggleLlmDropdown={() => setShowLlmDropdown(v => !v)}
              llmDropdownRef={llmDropdownRef}
              isAssisting={isAssisting}
              onAiAssist={handleAiAssist}
              productDesc={productDesc}
              onProductDescChange={setProductDesc}
              mainText={mainText}
              onMainTextChange={setMainText}
              secondaryText={secondaryText}
              onSecondaryTextChange={setSecondaryText}
              accentSymbol={accentSymbol}
              onAccentSymbolChange={setAccentSymbol}
              sceneDesc={sceneDesc}
              onSceneDescChange={setSceneDesc}
              styleExtra={styleExtra}
              onStyleExtraChange={setStyleExtra}
              brandColors={brandColors}
              colorInput={colorInput}
              onColorInputChange={setColorInput}
              onAddBrandColor={addBrandColor}
              onRemoveBrandColor={removeBrandColor}
              refImage={refImage}
              onFileUpload={handleFileUpload}
              onRemoveRefImage={() => { setRefImage(''); setRefImageFile(null); }}
              productImage={productImage}
              onProductImageUpload={handleProductImageUpload}
              onRemoveProductImage={() => { setProductImage(''); setProductImageFile(null); }}
              isMonochrome={isMonochrome}
            />
          )}

          {/* Tab: Results */}
          {activeTab === 'results' && (
            <BrandResultGallery
              results={results}
              isGenerating={isGenerating}
              progress={progress}
              progressLabel={progressLabel}
              selectedTemplateCount={selectedTemplates.size}
              onCancel={handleCancel}
              onAddToCanvas={handleAddToCanvas}
              onRegenerateTemplate={handleRegenerateTemplate}
              isMonochrome={isMonochrome}
            />
          )}
        </div>

        {/* ── Footer ── */}
        <div className={`flex items-center justify-between px-5 py-3.5 border-t ${border} ${bg}`}>
          <div className="flex items-center gap-2">
            {selectedTemplates.size > 0 && (
              <span className={`text-sm ${textSub}`}>
                已选 <span className={accentText}>{selectedTemplates.size}</span> 个模板
              </span>
            )}
            {successResults.length > 0 && (
              <button
                onClick={() => handleAddToCanvas()}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${accent} ${isMonochrome ? 'text-white' : 'text-black'} ${accentHover} transition-colors cursor-pointer`}
              >
                <Sparkles size={12} />
                添加到画布 ({successResults.length})
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${isMonochrome ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 hover:bg-[#2a2a2a]'} transition-colors cursor-pointer`}
            >
              关闭
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !selectedTemplates.size || !productDesc.trim() || !selectedModel}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                isGenerating || !selectedTemplates.size || !productDesc.trim() || !selectedModel
                  ? isMonochrome ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#333] text-[#555] cursor-not-allowed'
                  : `${accent} ${isMonochrome ? 'text-white' : 'text-black'} ${accentHover} shadow-lg`
              }`}
            >
              {isGenerating ? (
                <><Loader2 size={13} className="animate-spin" />生成中...</>
              ) : !selectedModel ? (
                <><Settings size={13} />请先选择模型</>
              ) : (
                <><Sparkles size={13} />批量生成</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
