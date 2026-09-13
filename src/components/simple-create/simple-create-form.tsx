'use client';

import { ImagePlus, LoaderCircle, Sparkles, X } from 'lucide-react';
import React from 'react';

import type { SimpleCreateModel } from './simple-create-page';

export interface SimpleCreateFormValue {
  prompt: string;
  providerId: string;
  model: string;
  aspectRatio: string;
  size: string;
  quality: string;
  outputCount: number;
  referenceImages: string[];
}

interface SimpleCreateFormProps {
  models: SimpleCreateModel[];
  submitting: boolean;
  uploadBusy: boolean;
  referenceImages: string[];
  onUpload(file: File): Promise<void>;
  onRemoveReference(index: number): void;
  onSubmit(value: SimpleCreateFormValue): Promise<void>;
}

export function SimpleCreateForm({
  models,
  submitting,
  uploadBusy,
  referenceImages,
  onUpload,
  onRemoveReference,
  onSubmit,
}: SimpleCreateFormProps) {
  const [selectedKey, setSelectedKey] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [aspectRatio, setAspectRatio] = React.useState('');
  const [size, setSize] = React.useState('');
  const [quality, setQuality] = React.useState('');
  const [outputCount, setOutputCount] = React.useState(1);

  const selected = models.find(model => `${model.providerId}::${model.modelId}` === selectedKey)
    || models[0];

  React.useEffect(() => {
    if (!selected) return;
    const key = `${selected.providerId}::${selected.modelId}`;
    if (selectedKey !== key) setSelectedKey(key);
    setAspectRatio(current => selected.allowedRatios.includes(current) ? current : selected.allowedRatios[0] || '1:1');
    setSize(current => selected.allowedSizes.includes(current) ? current : selected.allowedSizes[0] || '1024x1024');
    setQuality(current => selected.qualityOptions.includes(current) ? current : selected.qualityOptions[0] || 'standard');
    setOutputCount(current => Math.min(Math.max(current, 1), Math.min(selected.maxOutputs, 4)));
  }, [selected, selectedKey]);

  const maxReferences = selected?.supportsReferenceImages
    ? Math.max(1, selected.maxReferenceImages || 1)
    : 0;
  const canSubmit = Boolean(selected && prompt.trim() && !submitting);

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected || !canSubmit) return;
        void onSubmit({
          prompt: prompt.trim(),
          providerId: selected.providerId,
          model: selected.modelId,
          aspectRatio,
          size,
          quality,
          outputCount,
          referenceImages,
        });
      }}
    >
      <label className="block space-y-2 text-sm font-medium text-zinc-200">
        <span>模型</span>
        <select
          aria-label="模型"
          value={selectedKey}
          onChange={event => setSelectedKey(event.target.value)}
          className="min-h-11 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-white outline-none focus:border-amber-400"
        >
          {models.map(model => (
            <option key={`${model.providerId}::${model.modelId}`} value={`${model.providerId}::${model.modelId}`}>
              {model.providerName} · {model.modelName}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-2 text-sm font-medium text-zinc-200">
        <span>提示词</span>
        <textarea
          aria-label="提示词"
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          rows={5}
          placeholder="描述你想生成的画面"
          className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-amber-400"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <SelectField label="画面比例" value={aspectRatio} values={selected?.allowedRatios || []} onChange={setAspectRatio} />
        <SelectField label="图片尺寸" value={size} values={selected?.allowedSizes || []} onChange={setSize} />
        <SelectField label="图片质量" value={quality} values={selected?.qualityOptions || []} onChange={setQuality} />
        <SelectField
          label="生成数量"
          value={String(outputCount)}
          values={Array.from({ length: Math.min(selected?.maxOutputs || 1, 4) }, (_, index) => String(index + 1))}
          onChange={value => setOutputCount(Number(value))}
        />
      </div>

      {maxReferences > 0 && (
        <div className="space-y-2">
          <span className="block text-sm font-medium text-zinc-200">参考图</span>
          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-zinc-600 bg-zinc-900 px-3 text-sm text-zinc-300 hover:border-amber-400 hover:text-white">
            {uploadBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            <span>{uploadBusy ? '正在上传' : '添加参考图'}</span>
            <input
              aria-label="参考图"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={uploadBusy || referenceImages.length >= maxReferences}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void onUpload(file);
              }}
            />
          </label>
          {referenceImages.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="已上传参考图">
              {referenceImages.map((url, index) => (
                <div key={`${url}-${index}`} className="relative h-16 w-16 overflow-hidden rounded-md border border-zinc-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="参考图已上传" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`移除参考图 ${index + 1}`}
                    onClick={() => onRemoveReference(index)}
                    className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center bg-black/70 text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-amber-400 px-4 text-sm font-semibold text-black transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
      >
        {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        开始生成
      </button>
    </form>
  );
}

function SelectField({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange(value: string): void;
}) {
  return (
    <label className="space-y-2 text-sm font-medium text-zinc-200">
      <span className="block">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="min-h-11 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-white outline-none focus:border-amber-400"
      >
        {values.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  );
}
