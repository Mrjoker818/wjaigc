'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileImage, ImagePlus, PenTool, Sparkles, Upload, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import { VECTOR_KEYWORD_TEMPLATES, isRecraftVectorModel, type VectorTemplateGroup } from '@/lib/vector-design';
import { VectorEditorDialog, type VectorDesignAsset } from './vector-editor-dialog';

interface VectorModel {
  id: string;
  name?: string;
  displayName?: string;
  providerId: string;
  providerName?: string;
  isDefault?: boolean;
}

interface VectorDesignPanelProps {
  themeStyle: 'gold' | 'monochrome';
  selectedImage: { id: string; url: string; svgUrl?: string; svgDataUrl?: string } | null;
  onAddVector: (asset: VectorDesignAsset, sourceImageId?: string) => void;
}

const GROUP_LABELS: Record<VectorTemplateGroup, string> = {
  quick: '快速关键词',
  category: '产品品类',
  design: '设计类型',
  style: '风格预设',
};

const ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:1', '1:2'];

export function VectorDesignPanel({ themeStyle, selectedImage, onAddVector }: VectorDesignPanelProps) {
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [prompt, setPrompt] = useState('');
  const [templateIds, setTemplateIds] = useState<string[]>(['line-art', 'two-color', 'transparent', 'no-text']);
  const [models, setModels] = useState<VectorModel[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [aspect, setAspect] = useState('1:1');
  const [count, setCount] = useState(1);
  const [uploadedImage, setUploadedImage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<VectorDesignAsset[]>([]);
  const [editingAsset, setEditingAsset] = useState<VectorDesignAsset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMono = themeStyle === 'monochrome';

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/models?type=vectorize')
      .then(response => response.json())
      .then(data => {
        if (cancelled) return;
        const nextModels = (Array.isArray(data.models) ? data.models : []).filter((model: VectorModel) => isRecraftVectorModel(model.id));
        setModels(nextModels);
        const preferred = nextModels.find((model: VectorModel) => /recraftv4_1.*_vector/i.test(model.id))
          || nextModels.find((model: VectorModel) => model.isDefault)
          || nextModels[0];
        if (preferred) setModelKey(`${preferred.providerId}::${preferred.id}`);
      })
      .catch(() => setModels([]));
    return () => { cancelled = true; };
  }, []);

  const activeImageUrl = uploadedImage || selectedImage?.url || '';
  const selectedModel = useMemo(() => {
    const [providerId, ...modelParts] = modelKey.split('::');
    const model = modelParts.join('::');
    return models.find(item => item.providerId === providerId && item.id === model) || null;
  }, [modelKey, models]);

  const toggleTemplate = (id: string) => {
    setTemplateIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
  };

  const generate = async () => {
    if (!selectedModel) {
      toast.error('请先在管理员后台授权 Recraft Vector 模型');
      return;
    }
    if (mode === 'text' && !prompt.trim()) {
      toast.info('请输入要生成的矢量图内容');
      return;
    }
    if (mode === 'image' && !activeImageUrl) {
      toast.info('请从画布选择图片或上传参考图');
      return;
    }
    setIsGenerating(true);
    try {
      const requests = Array.from({ length: count }, () => fetch('/api/vector-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode === 'text' ? 'generate' : 'vectorize',
          providerId: selectedModel.providerId,
          model: selectedModel.id,
          prompt,
          templateIds,
          size: aspect,
          imageUrl: mode === 'image' ? activeImageUrl : undefined,
        }),
      }).then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '矢量图生成失败');
        return data.asset as VectorDesignAsset;
      }));
      const assets = await Promise.all(requests);
      setResults(assets);
      if (assets.length === 1) setEditingAsset(assets[0]);
      toast.success(`已生成 ${assets.length} 个可编辑 SVG`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '矢量图生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const readUpload = (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('仅支持 PNG、JPG、WEBP');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('参考图不能超过 10MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setUploadedImage(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex min-h-full flex-col bg-[#111216] text-white">
      <div className="border-b border-white/7 px-4 py-4">
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isMono ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/12 text-[#d4af37]'}`}>
            <PenTool size={17} />
          </div>
          <div>
            <h2 className="text-sm font-semibold">AI 矢量设计</h2>
            <p className="text-[10px] text-gray-500">Recraft 原生 SVG · 可编辑元素</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 rounded-xl bg-[#1a1b20] p-1">
          <button type="button" onClick={() => setMode('text')} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs ${mode === 'text' ? 'bg-[#292b32] text-[#e3c55b] shadow' : 'text-gray-500'}`}>
            <WandSparkles size={13} /> 文生矢量
          </button>
          <button type="button" onClick={() => setMode('image')} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs ${mode === 'image' ? 'bg-[#292b32] text-[#e3c55b] shadow' : 'text-gray-500'}`}>
            <ImagePlus size={13} /> 图生矢量
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {mode === 'image' && (
          <section>
            <SectionTitle>参考图片</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={!selectedImage} onClick={() => setUploadedImage('')} className={`min-h-20 rounded-xl border p-2 text-left ${!uploadedImage && selectedImage ? 'border-[#d4af37]/55 bg-[#d4af37]/7' : 'border-white/8 bg-[#1a1b21]'} disabled:opacity-35`}>
                <FileImage size={16} className="mb-2 text-[#d4af37]" />
                <p className="text-xs text-gray-200">画布选中图片</p>
                <p className="mt-1 truncate text-[10px] text-gray-600">{selectedImage ? '已就绪' : '请先选择图片'}</p>
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className={`min-h-20 rounded-xl border p-2 text-left ${uploadedImage ? 'border-[#d4af37]/55 bg-[#d4af37]/7' : 'border-white/8 bg-[#1a1b21]'}`}>
                <Upload size={16} className="mb-2 text-[#d4af37]" />
                <p className="text-xs text-gray-200">上传参考图</p>
                <p className="mt-1 text-[10px] text-gray-600">{uploadedImage ? '已上传' : 'PNG/JPG/WEBP'}</p>
              </button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => event.target.files?.[0] && readUpload(event.target.files[0])} />
            </div>
            {activeImageUrl && <img src={activeImageUrl} alt="矢量化参考图" className="mt-2 h-24 w-full rounded-xl border border-white/8 object-contain bg-black/20" />}
          </section>
        )}

        {mode === 'text' && (
          <section>
            <SectionTitle>创意描述</SectionTitle>
            <textarea
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              placeholder="例如：帝王黄双色线条插画，一瓶白酒、酒杯与祥云组合，简洁高级，无文字"
              className="h-28 w-full resize-y rounded-xl border border-white/8 bg-[#1a1b21] p-3 text-xs leading-5 text-white outline-none placeholder:text-gray-600 focus:border-[#d4af37]/45"
            />
          </section>
        )}

        {(Object.keys(GROUP_LABELS) as VectorTemplateGroup[]).map(group => (
          <section key={group}>
            <SectionTitle>{GROUP_LABELS[group]}</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {VECTOR_KEYWORD_TEMPLATES.filter(template => template.group === group).map(template => {
                const active = templateIds.includes(template.id);
                return (
                  <button
                    type="button"
                    key={template.id}
                    onClick={() => toggleTemplate(template.id)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${active ? 'border-[#d4af37]/55 bg-[#d4af37]/12 text-[#e4c660]' : 'border-white/8 bg-[#1c1d23] text-gray-500 hover:text-gray-300'}`}
                  >
                    {template.label}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <section>
          <SectionTitle>Recraft 矢量模型</SectionTitle>
          <select value={modelKey} onChange={event => setModelKey(event.target.value)} className="h-11 w-full rounded-xl border border-white/8 bg-[#1a1b21] px-3 text-xs text-gray-200 outline-none">
            {models.length === 0 && <option value="">未授权 Recraft Vector 模型</option>}
            {models.map(model => <option key={`${model.providerId}::${model.id}`} value={`${model.providerId}::${model.id}`}>{model.displayName || model.name || model.id}</option>)}
          </select>
        </section>

        <section>
          <SectionTitle>画面比例</SectionTitle>
          <div className="grid grid-cols-4 gap-1.5">
            {ASPECTS.map(value => <button type="button" key={value} onClick={() => setAspect(value)} className={`rounded-lg border py-2 text-[11px] ${aspect === value ? 'border-[#d4af37]/55 bg-[#d4af37]/10 text-[#e4c660]' : 'border-white/8 bg-[#1a1b21] text-gray-500'}`}>{value}</button>)}
          </div>
        </section>

        <section>
          <SectionTitle>生成数量</SectionTitle>
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 2, 3, 4].map(value => <button type="button" key={value} onClick={() => setCount(value)} className={`rounded-lg border py-2 text-[11px] ${count === value ? 'border-[#d4af37]/55 bg-[#d4af37]/10 text-[#e4c660]' : 'border-white/8 bg-[#1a1b21] text-gray-500'}`}>{value} 个</button>)}
          </div>
        </section>

        {results.length > 0 && (
          <section>
            <SectionTitle>生成结果</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {results.map((asset, index) => (
                <div key={asset.svgUrl} className="overflow-hidden rounded-xl border border-white/8 bg-[#1a1b21]">
                  <img src={asset.previewUrl} alt={`矢量结果 ${index + 1}`} className="h-28 w-full bg-white/95 object-contain" />
                  <div className="grid grid-cols-2 gap-1 p-2">
                    <button type="button" onClick={() => setEditingAsset(asset)} className="rounded-lg border border-white/8 py-1.5 text-[10px] text-gray-300">编辑</button>
                    <button type="button" onClick={() => onAddVector(asset, mode === 'image' ? selectedImage?.id : undefined)} className="rounded-lg bg-[#d4af37] py-1.5 text-[10px] font-semibold text-black">上画布</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="border-t border-white/7 p-4">
        <button type="button" disabled={isGenerating || !selectedModel} onClick={generate} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#d9b94f] to-[#b8861e] py-3 text-xs font-bold text-black shadow-[0_8px_24px_rgba(212,175,55,.14)] disabled:opacity-40">
          <Sparkles size={15} /> {isGenerating ? '正在生成可编辑 SVG…' : mode === 'text' ? '生成矢量图' : '转换为矢量图'}
        </button>
      </div>

      {editingAsset && (
        <VectorEditorDialog
          asset={editingAsset}
          templateIds={templateIds}
          onClose={() => setEditingAsset(null)}
          onSave={asset => {
            setResults(previous => previous.map(item => item.svgUrl === editingAsset.svgUrl ? asset : item));
            onAddVector(asset, mode === 'image' ? selectedImage?.id : undefined);
          }}
        />
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-[#d4af37]" />
      <h3 className="text-xs font-semibold text-[#989aa2]">{children}</h3>
    </div>
  );
}
