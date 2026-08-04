'use client';

import { Move, MousePointer2, RotateCcw, ScanLine, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clientPointToImagePoint, getContainedImageRect } from '@/lib/effect-reverse-engineering/preview-geometry';
import type { EffectReverseRegion, EffectReverseTaskRecord, NormalizedPoint } from '@/lib/effect-reverse-engineering/types';
import type { ReverseTab } from './i18n';
import { REVERSE_COPY } from './i18n';

type PreviewMode = 'original' | 'structure' | 'compare';
type PreviewTool = 'select' | 'pan' | 'annotate';

interface Props {
  imageUrl: string;
  points: NormalizedPoint[];
  regions: EffectReverseRegion[];
  task: EffectReverseTaskRecord | null;
  busy: boolean;
  instruction: string;
  onPointsChange: (points: NormalizedPoint[]) => void;
  onInstructionChange: (value: string) => void;
  onResetPoints: () => void;
  onSubmit: (action: 'correct' | 'export-png' | 'export-svg' | 'export-pdf' | 'export-zip') => void;
  onCancel: () => void;
}

export function EffectReverseWorkspace({ imageUrl, points, regions, task, busy, instruction, onPointsChange, onInstructionChange, onResetPoints, onSubmit, onCancel }: Props) {
  const [tab, setTab] = useState<ReverseTab>('preview');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('original');
  const [previewTool, setPreviewTool] = useState<PreviewTool>('select');
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const perspectiveContainerRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [perspectiveSize, setPerspectiveSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ naturalWidth: 0, naturalHeight: 0 });
  const previewDragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const hasRealResult = Boolean(task?.status === 'completed' && task.result);
  const tabs: ReadonlyArray<readonly [ReverseTab, string]> = [
    ['preview', REVERSE_COPY.previewTab],
    ['analysis', REVERSE_COPY.analysisTab],
    ['perspective', REVERSE_COPY.flat],
    ['vector', REVERSE_COPY.vector],
    ['history', REVERSE_COPY.history],
  ];

  useEffect(() => {
    const observe = (element: HTMLDivElement | null, update: (size: { width: number; height: number }) => void) => {
      if (!element) return undefined;
      const sync = () => update({ width: element.clientWidth, height: element.clientHeight });
      sync();
      const observer = new ResizeObserver(sync);
      observer.observe(element);
      return () => observer.disconnect();
    };
    const stopPreview = observe(previewContainerRef.current, setPreviewSize);
    const stopPerspective = observe(perspectiveContainerRef.current, setPerspectiveSize);
    return () => { stopPreview?.(); stopPerspective?.(); };
  }, [tab]);

  const previewImageRect = useMemo(() => getContainedImageRect(previewSize, { width: imageSize.naturalWidth, height: imageSize.naturalHeight }), [imageSize, previewSize]);
  const perspectiveImageRect = useMemo(() => getContainedImageRect(perspectiveSize, { width: imageSize.naturalWidth, height: imageSize.naturalHeight }), [imageSize, perspectiveSize]);

  const mapPointerToImage = (event: ReactPointerEvent<HTMLDivElement>, zoom = 1, offset = { x: 0, y: 0 }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clientPointToImagePoint(
      { x: event.clientX, y: event.clientY },
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      { width: imageSize.naturalWidth, height: imageSize.naturalHeight },
      zoom,
      offset,
    );
  };

  const updatePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragIndex === null) return;
    const nextPoint = mapPointerToImage(event);
    if (nextPoint) onPointsChange(points.map((point, index) => index === dragIndex ? nextPoint : point));
  };

  const addPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy || points.length >= 4) return;
    const nextPoint = mapPointerToImage(event);
    if (nextPoint) onPointsChange([...points, nextPoint]);
  };

  const unavailablePanel = (message: string) => (
    <div className="flex min-h-[540px] flex-1 items-center justify-center border border-dashed border-white/15 bg-black/20 px-8 text-center text-sm text-neutral-400">
      {message}
    </div>
  );

  const onPreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewTool === 'annotate') {
      const point = mapPointerToImage(event, previewZoom, previewOffset);
      if (point) onPointsChange(points.length >= 4 ? [point] : [...points, point]);
      return;
    }
    if (previewTool !== 'pan') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: previewOffset.x, originY: previewOffset.y };
  };

  const onPreviewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPreviewOffset({ x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y });
  };

  const onPreviewPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewDragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    previewDragRef.current = null;
  };

  const resetPreview = () => {
    setPreviewZoom(1);
    setPreviewOffset({ x: 0, y: 0 });
  };

  return (
    <main data-testid="effect-reverse-workspace" data-panel="workspace" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0d0e0f]">
      <nav className="flex h-[58px] shrink-0 items-end gap-1 border-b border-white/10 px-5" role="tablist" aria-label={REVERSE_COPY.workspaceLabel}>
        {tabs.map(([value, label]) => {
          const resultRequired = value === 'vector' || value === 'history';
          return (
            <button
              key={value}
              type="button"
              role="tab"
              disabled={resultRequired && !hasRealResult}
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`h-full border-b-2 px-4 text-sm transition-colors ${tab === value ? 'border-[#d4af37] text-[#e2c35f]' : 'border-transparent text-neutral-400 hover:text-neutral-200'} disabled:cursor-not-allowed disabled:opacity-35`}
              title={resultRequired && !hasRealResult ? REVERSE_COPY.unavailableUntilResult : label}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5">
        <div className="flex items-center gap-1 text-neutral-400" aria-label="预览工具">
          {([['select', REVERSE_COPY.selectTool, MousePointer2], ['pan', REVERSE_COPY.panTool, Move], ['annotate', REVERSE_COPY.annotateTool, ScanLine]] as const).map(([tool, label, Icon]) => <button key={tool} type="button" title={label} data-active={previewTool === tool} onClick={() => setPreviewTool(tool)} className={`flex h-[34px] w-[34px] items-center justify-center rounded-md ${previewTool === tool ? 'bg-[#d4af37] text-black' : 'hover:bg-white/10 hover:text-white'}`}><Icon className="h-4 w-4" /></button>)}
          <span className="mx-1 h-5 w-px bg-white/10" />
          <button type="button" title={REVERSE_COPY.zoomIn} onClick={() => setPreviewZoom((value) => Math.min(4, Number((value + 0.1).toFixed(2))))} className="flex h-[34px] w-[34px] items-center justify-center rounded-md hover:bg-white/10 hover:text-white"><ZoomIn className="h-4 w-4" /></button>
          <button type="button" title={REVERSE_COPY.zoomOut} onClick={() => setPreviewZoom((value) => Math.max(0.25, Number((value - 0.1).toFixed(2))))} className="flex h-[34px] w-[34px] items-center justify-center rounded-md hover:bg-white/10 hover:text-white"><ZoomOut className="h-4 w-4" /></button>
          <button type="button" title={REVERSE_COPY.resetView} onClick={resetPreview} className="flex h-[34px] w-[34px] items-center justify-center rounded-md hover:bg-white/10 hover:text-white"><RotateCcw className="h-4 w-4" /></button>
          <output className="ml-1 min-w-12 text-center text-[11px] text-neutral-500">{Math.round(previewZoom * 100)}%</output>
        </div>
        {tab === 'preview' && (
          <div className="flex rounded-md border border-white/10 bg-black/30 p-0.5" aria-label="预览模式">
            {([['original', REVERSE_COPY.original], ['structure', REVERSE_COPY.structureLayer], ['compare', REVERSE_COPY.compare]] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setPreviewMode(value)} className={`rounded px-3 py-1.5 text-xs ${previewMode === value ? 'bg-[#d4af37] text-black' : 'text-neutral-400 hover:text-white'}`}>{label}</button>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5">
        {tab === 'preview' && (
          <div ref={previewContainerRef} className={`relative flex min-h-[540px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black ${previewTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : previewTool === 'annotate' ? 'cursor-crosshair' : 'cursor-default'}`} onPointerDown={onPreviewPointerDown} onPointerMove={onPreviewPointerMove} onPointerUp={onPreviewPointerUp} onPointerCancel={onPreviewPointerUp}>
            <div className="relative flex h-full w-full items-center justify-center will-change-transform" style={{ transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewZoom})` }}>
              <div data-preview-image-frame className="absolute" style={{ left: previewImageRect.left, top: previewImageRect.top, width: previewImageRect.width, height: previewImageRect.height }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={REVERSE_COPY.originalAlt} className="h-full w-full select-none object-contain" draggable={false} onLoad={(event) => setImageSize({ naturalWidth: event.currentTarget.naturalWidth, naturalHeight: event.currentTarget.naturalHeight })} />
                {previewMode !== 'original' && regions.filter((region) => region.visible).map((region, index) => <div key={region.id} className={`pointer-events-none absolute border ${previewMode === 'compare' ? 'border-cyan-400/70' : 'border-[#d4af37]/80'}`} style={{ inset: `${8 + index * 3}%` }} />)}
                {points.map((point, index) => <span key={`${point.x}-${point.y}-${index}`} className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black bg-[#d4af37]" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />)}
                {previewMode === 'compare' && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,.7)]" />}
              </div>
            </div>
            <aside data-testid="effect-reverse-analysis-overlay" className="absolute right-4 top-4 w-56 rounded-lg border border-white/10 bg-[#111]/95 p-3 text-xs shadow-lg" aria-label={REVERSE_COPY.analysisSection}>
              <div className="mb-3 flex items-center justify-between"><strong className="text-neutral-100">{REVERSE_COPY.analysisSection}</strong><span className="text-[10px] text-neutral-500">{regions.length ? REVERSE_COPY.manualMode : REVERSE_COPY.notAnalyzed}</span></div>
              <div className="space-y-3 text-neutral-400">
                <div><div className="mb-1 flex justify-between"><span>{REVERSE_COPY.spatialPlanes}</span><span className="text-neutral-200">{regions.length} / {regions.length || 0}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[#d4af37]" style={{ width: regions.length ? '100%' : '0%' }} /></div></div>
                <div><div className="mb-1 flex justify-between"><span>{REVERSE_COPY.perspectiveConsistency}</span><span>{REVERSE_COPY.metadataPending}</span></div><div className="h-1.5 rounded-full bg-white/10" /></div>
                <div className="flex justify-between"><span>{REVERSE_COPY.geometryAnomalies}</span><span>{REVERSE_COPY.metadataPending}</span></div>
              </div>
            </aside>
          </div>
        )}
        {tab === 'analysis' && (
          <div className="flex min-h-[540px] flex-1 flex-col gap-4 rounded-lg border border-white/10 bg-black/20 p-5 text-sm text-neutral-400">
            <div className="flex items-center justify-between gap-3"><div><strong className="text-neutral-100">{REVERSE_COPY.analysis}</strong><p className="mt-1 text-xs">{regions.length ? `已识别 ${regions.length} 个结构区域，所有推断结果仍需人工复核。` : REVERSE_COPY.notAnalyzed}</p></div></div>
            <div data-testid="effect-reverse-analysis-grid" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {regions.length ? regions.map((region) => <article key={region.id} className="rounded-lg border border-white/10 bg-[#131415] p-4"><div className="mb-3 flex items-center justify-between"><strong className="text-neutral-100">{region.label}</strong><span className="rounded bg-white/5 px-2 py-1 text-[10px] text-neutral-400">{region.kind}</span></div><dl className="space-y-2 text-xs"><div className="flex justify-between"><dt>{REVERSE_COPY.visible}</dt><dd>{region.visible ? REVERSE_COPY.enabled : REVERSE_COPY.disabled}</dd></div><div className="flex justify-between"><dt>{REVERSE_COPY.locked}</dt><dd>{region.locked ? REVERSE_COPY.enabled : REVERSE_COPY.disabled}</dd></div><div className="flex justify-between"><dt>置信度</dt><dd>{REVERSE_COPY.metadataPending}</dd></div></dl></article>) : <div className="col-span-full flex min-h-52 items-center justify-center rounded-lg border border-dashed border-white/15 text-neutral-500">{REVERSE_COPY.notAnalyzed}</div>}
            </div>
            <p className="rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">{REVERSE_COPY.capabilityBoundary}</p>
          </div>
        )}
        {tab === 'perspective' && (
          <div data-testid="effect-reverse-flat-grid" ref={perspectiveContainerRef} className="relative min-h-[540px] flex-1 overflow-hidden rounded-lg border border-white/10 bg-black" aria-label={REVERSE_COPY.perspectiveCorrection} onPointerMove={updatePoint} onPointerUp={() => setDragIndex(null)} onPointerLeave={() => setDragIndex(null)} onPointerDown={addPoint}>
            <div data-preview-image-frame className="absolute" style={{ left: perspectiveImageRect.left, top: perspectiveImageRect.top, width: perspectiveImageRect.width, height: perspectiveImageRect.height }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={task?.result?.correctedImageUrl || imageUrl} alt={REVERSE_COPY.perspectiveAlt} className="h-full w-full object-contain" draggable={false} onLoad={(event) => setImageSize({ naturalWidth: event.currentTarget.naturalWidth, naturalHeight: event.currentTarget.naturalHeight })} />
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1"><polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#d4af37" strokeWidth="0.004" /></svg>
              {points.map((point, index) => <button key={`point-${index}`} type="button" aria-label={REVERSE_COPY.movePerspectivePoint(index + 1)} className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black bg-[#d4af37] shadow-lg" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setDragIndex(index); }} />)}
            </div>
          </div>
        )}
        {tab === 'vector' && (hasRealResult ? <div data-testid="effect-reverse-vector-result" className="flex min-h-[540px] flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-white/10 bg-black/20 p-8 text-center"><strong className="text-neutral-100">{REVERSE_COPY.vector}</strong><p className="max-w-xl text-sm text-neutral-400">{REVERSE_COPY.vectorStatsUnavailable}</p>{task?.result?.exportUrl ? <a href={task.result.exportUrl} download className="rounded-md bg-[#d4af37] px-4 py-2 text-xs font-semibold text-black">{REVERSE_COPY.download}</a> : <p className="text-xs text-neutral-500">{REVERSE_COPY.noVectorResult}</p>}</div> : unavailablePanel(REVERSE_COPY.unavailableUntilResult))}
        {tab === 'history' && unavailablePanel(REVERSE_COPY.historyUnavailable)}
      </div>

      <textarea value={instruction} onChange={(event) => onInstructionChange(event.target.value)} maxLength={4000} placeholder={REVERSE_COPY.instruction} className="mx-5 my-3 min-h-16 shrink-0 resize-y rounded-md border border-white/10 bg-black/20 p-2 text-xs outline-none" />
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-white/10 px-5 py-3">
        <button type="button" onClick={onResetPoints} className="rounded-md border border-white/10 px-3 py-2 text-xs">{REVERSE_COPY.resetPoints}</button>
        {busy && <button type="button" onClick={onCancel} className="rounded-md border border-red-500/50 px-3 py-2 text-xs text-red-300">{REVERSE_COPY.cancel}</button>}
      </div>
      {task && <div data-testid="effect-reverse-task-progress" className="space-y-1 border-t border-white/10 px-5 py-2 text-xs" aria-live="polite"><div className="flex justify-between"><span>{REVERSE_COPY.progress}：{task.label}</span><span>{task.progress}%</span></div><div className="h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-[#d4af37]" style={{ width: `${task.progress}%` }} /></div></div>}
    </main>
  );
}
