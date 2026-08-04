'use client';

import { Download, ImagePlus, LockKeyhole, RotateCcw, ScanLine, WandSparkles } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { EffectReverseRegion } from '@/lib/effect-reverse-engineering/types';
import type { EffectReverseSource } from '../effect-reverse-engineering-panel';
import { REVERSE_COPY } from './i18n';
import { EffectReverseLayerPanel } from './layer-panel';

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function SectionHeading({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
        <span className="h-2 w-2 rotate-45 border border-[#d4af37] bg-[#d4af37]/20" aria-hidden="true" />
        {children}
      </h3>
      {action}
    </div>
  );
}

interface Props {
  source: EffectReverseSource;
  onSelect?: (source: EffectReverseSource) => void;
  onUploadSource?: (file: File) => Promise<EffectReverseSource>;
  mode?: 'restore' | 'production' | 'construction';
  geometryCorrection?: boolean;
  analyzerAvailable?: boolean;
  analysisSubmitted?: boolean;
  regions: EffectReverseRegion[];
  busy: boolean;
  hasRealResult: boolean;
  horizontalCorrection: number;
  verticalCorrection: number;
  perspectiveStrength: number;
  basePart: string;
  baseDimension: string;
  dimensionUnit: string;
  onModeChange?: (mode: NonNullable<Props['mode']>) => void;
  onGeometryCorrectionChange?: (enabled: boolean) => void;
  onAnalyze?: () => void;
  onRegionsChange: (regions: EffectReverseRegion[]) => void;
  onHorizontalCorrectionChange: (value: number) => void;
  onVerticalCorrectionChange: (value: number) => void;
  onPerspectiveStrengthChange: (value: number) => void;
  onBasePartChange: (value: string) => void;
  onBaseDimensionChange: (value: string) => void;
  onDimensionUnitChange: (value: string) => void;
  onResetPoints: () => void;
  onSubmit: (action: 'correct' | 'export-png' | 'export-svg' | 'export-pdf' | 'export-zip') => void;
}

export function EffectReverseSourcePanel({ source, onSelect, onUploadSource, mode = 'restore', geometryCorrection = false, analyzerAvailable = false, analysisSubmitted = false, regions, busy, hasRealResult, horizontalCorrection, verticalCorrection, perspectiveStrength, basePart, baseDimension, dimensionUnit, onModeChange, onGeometryCorrectionChange, onAnalyze, onRegionsChange, onHorizontalCorrectionChange, onVerticalCorrectionChange, onPerspectiveStrengthChange, onBasePartChange, onBaseDimensionChange, onDimensionUnitChange, onResetPoints, onSubmit }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const selectFile = async (file: File | undefined) => {
    if (!file || !onUploadSource) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setUploadError(REVERSE_COPY.uploadInvalidType);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(REVERSE_COPY.uploadTooLarge);
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const uploadedSource = await onUploadSource(file);
      onSelect?.(uploadedSource);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : REVERSE_COPY.uploadReadFailed);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    void selectFile(event.dataTransfer.files?.[0]);
  };

  return (
    <aside
      data-testid="effect-reverse-source-panel"
      data-panel="source-panel"
      className="flex min-h-0 flex-col gap-5 overflow-y-auto border-r border-white/10 px-[18px] pb-[22px] pt-5 max-[960px]:border-b max-[960px]:border-r-0"
    >
      <section aria-labelledby="effect-reverse-upload-heading">
      <div id="effect-reverse-upload-heading"><SectionHeading>{REVERSE_COPY.uploadSection}</SectionHeading></div>
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { void selectFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
      <button
        type="button"
        disabled={uploading || !onUploadSource}
        className={`flex min-h-[130px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed bg-black/20 px-3 text-center text-xs text-neutral-300 transition-colors ${isDraggingFile ? 'border-[#e2c35f] bg-[#1b1c17]' : 'border-[#d4af37]/40 hover:border-[#e2c35f] hover:bg-[#151714]'}`}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setIsDraggingFile(true); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDraggingFile(true); }}
        onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFile(false); }}
        onDrop={handleDrop}
      >
        <ImagePlus className="h-5 w-5 text-[#d4af37]" />
        <span>{uploading ? '正在保存到项目…' : REVERSE_COPY.upload}</span>
        <span className="text-[10px] leading-4 text-neutral-500">{REVERSE_COPY.uploadDropHint}</span>
      </button>
      {uploadError && <p role="alert" className="-mt-3 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] leading-4 text-red-200">{uploadError}</p>}
      <button
        type="button"
        className="overflow-hidden border border-[#d4af37]/50 bg-black/20 text-left"
        onClick={() => onSelect?.(source)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source.imageUrl}
          alt={source.label || source.imageId}
          className="aspect-video w-full object-contain"
          draggable={false}
        />
      </button>
      <div className="space-y-1 text-[11px] text-neutral-400">
        <div className="flex items-center gap-1 text-neutral-200">
          <LockKeyhole className="h-3 w-3" />
          {REVERSE_COPY.frozenSource}
        </div>
        <div className="truncate">{source.label || source.imageId}</div>
        <div className="truncate">{REVERSE_COPY.project}：{source.projectId}</div>
        <div className="truncate">{REVERSE_COPY.version}：{source.versionId}</div>
      </div>
      </section>
      <fieldset className="border-t border-white/10 pt-4">
        <legend className="sr-only">{REVERSE_COPY.modeSection}</legend>
        <SectionHeading>{REVERSE_COPY.modeSection}</SectionHeading>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-black/30 p-1">{([
          ['restore', REVERSE_COPY.restoreMode],
          ['production', REVERSE_COPY.productionMode],
          ['construction', REVERSE_COPY.constructionMode],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => onModeChange?.(value)} className={`min-h-9 rounded-md px-1 text-[11px] ${mode === value ? 'bg-[#d4af37] font-medium text-black' : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-100'}`}>{label}</button>
        ))}</div>
      </fieldset>
      <section className="border-t border-white/10 pt-4">
        <SectionHeading action={<span data-testid="effect-reverse-analysis-state" className="text-[10px] text-neutral-500">{!analyzerAvailable ? REVERSE_COPY.analysisUnavailable : analysisSubmitted ? REVERSE_COPY.analysisSubmitted : REVERSE_COPY.analysisReady}</span>}>{REVERSE_COPY.analysisSection}</SectionHeading>
        <button type="button" disabled={!analyzerAvailable || busy} onClick={onAnalyze} className="flex w-full items-center justify-center gap-2 rounded-md border border-[#d4af37]/50 px-3 py-2 text-xs text-[#d4af37] outline-none hover:bg-[#d4af37]/10 focus-visible:ring-2 focus-visible:ring-[#d4af37] disabled:cursor-not-allowed disabled:opacity-40">
          <WandSparkles className="h-3.5 w-3.5" />{analysisSubmitted ? REVERSE_COPY.analysisSubmitted : REVERSE_COPY.analyze}
        </button>
      </section>
      <section className="border-t border-white/10 pt-4">
        <SectionHeading>{REVERSE_COPY.structuresSection}</SectionHeading>
        <EffectReverseLayerPanel regions={regions} analyzerAvailable={analyzerAvailable} onChange={onRegionsChange} onAnalyze={() => onAnalyze?.()} />
      </section>
      <section className="space-y-3 border-t border-white/10 pt-4">
        <SectionHeading>{REVERSE_COPY.perspectiveSection}</SectionHeading>
        {([
          [REVERSE_COPY.horizontalCorrection, horizontalCorrection, onHorizontalCorrectionChange, -50, 50, '°'],
          [REVERSE_COPY.verticalCorrection, verticalCorrection, onVerticalCorrectionChange, -50, 50, '°'],
          [REVERSE_COPY.perspectiveStrength, perspectiveStrength, onPerspectiveStrengthChange, 0, 100, '%'],
        ] as const).map(([label, value, onChange, min, max, suffix]) => (
          <label key={label} className="grid grid-cols-[72px_minmax(0,1fr)_40px] items-center gap-2 text-[11px] text-neutral-400">
            <span>{label}</span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="accent-[#d4af37]" /><output className="text-right text-neutral-200">{value}{suffix}</output>
          </label>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onSubmit('correct')} disabled={busy} className="rounded-md border border-[#d4af37]/40 px-3 py-2 text-xs text-[#e2c35f] disabled:opacity-40">{REVERSE_COPY.autoCorrection}</button>
          <button type="button" onClick={onResetPoints} className="flex items-center justify-center gap-1 rounded-md border border-white/10 px-3 py-2 text-xs text-neutral-300"><RotateCcw className="h-3.5 w-3.5" />{REVERSE_COPY.resetPoints}</button>
        </div>
      </section>
      <section className="space-y-3 border-t border-white/10 pt-4">
        <SectionHeading>{REVERSE_COPY.dimensionSection}</SectionHeading>
        <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-[11px] text-neutral-400"><span>{REVERSE_COPY.basePart}</span><select value={basePart} onChange={(event) => onBasePartChange(event.target.value)} className="rounded-md border border-white/10 bg-[#141414] px-2 py-2 text-neutral-200">{REVERSE_COPY.basePartOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <div className="grid grid-cols-[72px_minmax(0,1fr)_64px] items-center gap-2 text-[11px] text-neutral-400"><span>{REVERSE_COPY.baseDimension}</span><input value={baseDimension} onChange={(event) => onBaseDimensionChange(event.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={REVERSE_COPY.unset} className="min-w-0 rounded-md border border-white/10 bg-black/20 px-2 py-2 text-neutral-100 outline-none" /><select value={dimensionUnit} onChange={(event) => onDimensionUnitChange(event.target.value)} className="rounded-md border border-white/10 bg-[#141414] px-1 py-2 text-neutral-200"><option value="mm">mm</option><option value="cm">cm</option><option value="px">px</option></select></div>
        <p className="rounded-md border border-amber-400/20 bg-amber-400/5 p-2 text-[10px] leading-4 text-amber-200">{baseDimension ? REVERSE_COPY.ratioOnly : REVERSE_COPY.noRealDimension}</p>
      </section>
      <section className="space-y-3 border-t border-white/10 pt-4">
        <SectionHeading>{REVERSE_COPY.advancedSection}</SectionHeading>
        <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-neutral-300">
          <span className="flex items-center gap-2"><ScanLine className="h-3.5 w-3.5 text-[#d4af37]" />{REVERSE_COPY.geometryCorrection}</span>
          <input type="checkbox" checked={geometryCorrection} onChange={(event) => onGeometryCorrectionChange?.(event.target.checked)} className="accent-[#d4af37]" />
        </label>
        <button type="button" disabled={busy} onClick={() => onSubmit('correct')} className="flex w-full items-center justify-center gap-2 rounded-md bg-[#d4af37] px-4 py-3 text-xs font-semibold text-black disabled:opacity-40"><WandSparkles className="h-4 w-4" />{REVERSE_COPY.correct}</button>
        <SectionHeading>{REVERSE_COPY.exportSection}</SectionHeading>
        <div className="grid grid-cols-2 gap-2">{(['export-svg', 'export-pdf', 'export-zip'] as const).map((action) => <button key={action} type="button" disabled={!hasRealResult || busy} onClick={() => onSubmit(action)} className="flex items-center justify-center gap-1 rounded-md border border-white/10 px-2 py-2 text-[11px] text-neutral-300 disabled:cursor-not-allowed disabled:opacity-35"><Download className="h-3.5 w-3.5" />{REVERSE_COPY.downloadFormat(action.replace('export-', '').toUpperCase())}</button>)}<button type="button" disabled title={REVERSE_COPY.dxfUnavailable} className="rounded-md border border-white/10 px-2 py-2 text-[11px] text-neutral-500">导出 DXF</button></div>
        <p className="text-[10px] leading-4 text-neutral-500">{REVERSE_COPY.dxfUnavailable}</p>
      </section>
    </aside>
  );
}
