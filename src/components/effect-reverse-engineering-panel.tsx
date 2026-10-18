'use client';

import { GripHorizontal, GripVertical, Maximize2, Minimize2, ScanLine, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { taskEventsClient } from '@/lib/task-events-client';
import { constrainFloatingPanelPosition, getFloatingPanelViewport, subscribeFloatingPanelViewport } from '@/lib/floating-panel-position';
import type { EffectReverseRegion, EffectReverseTaskRecord, EffectReverseTaskResult, NormalizedPoint, NormalizedQuad } from '@/lib/effect-reverse-engineering/types';
import { EffectReverseSourcePanel } from './effect-reverse-engineering/source-panel';
import { EffectReverseWorkspace } from './effect-reverse-engineering/workspace';
import { REVERSE_COPY } from './effect-reverse-engineering/i18n';

const STORAGE_KEY = 'wujie.effect-reverse.window.v1';
const MIN_WIDTH = 960;
const MIN_HEIGHT = 620;
const DEFAULT_GEOMETRY: WindowGeometry = { x: 24, y: 24, width: 1440, height: 900 };

interface WindowGeometry { x: number; y: number; width: number; height: number; }
export interface EffectReverseSource { projectId: string; imageId: string; versionId: string; imageUrl: string; label?: string; }
export interface EffectReverseAnalyzerOption { id: string; label: string; }
interface EffectReverseEngineeringPanelProps {
  initialSource: EffectReverseSource;
  analyzerOptions?: EffectReverseAnalyzerOption[];
  isMonochrome?: boolean;
  onClose: () => void;
  onCanvasResult: (result: EffectReverseTaskResult) => void;
  onUploadSource?: (file: File) => Promise<EffectReverseSource>;
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export function sanitizeGeometry(value: unknown, viewport = viewportSize()): WindowGeometry {
  const record = value && typeof value === 'object' ? value as Partial<WindowGeometry> : {};
  if (viewport.width < 960) return { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const width = Math.min(viewport.width - 32, Math.max(MIN_WIDTH, Number(record.width) || DEFAULT_GEOMETRY.width));
  const height = Math.min(viewport.height - 32, Math.max(MIN_HEIGHT, Number(record.height) || DEFAULT_GEOMETRY.height));
  return { width, height, x: Math.min(viewport.width - width - 16, Math.max(16, Number(record.x) || (viewport.width - width) / 2)), y: Math.min(viewport.height - height - 16, Math.max(16, Number(record.y) || (viewport.height - height) / 2)) };
}

function loadGeometry(): WindowGeometry {
  if (typeof window === 'undefined') return DEFAULT_GEOMETRY;
  try { return sanitizeGeometry(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); } catch { return sanitizeGeometry(null); }
}

function area(points: NormalizedPoint[]): number {
  return Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y; }, 0) / 2);
}

function isValidPerspective(points: NormalizedPoint[]): points is NormalizedQuad {
  return points.length === 4 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) && area(points) > 0.01;
}

export function EffectReverseEngineeringPanel({ initialSource, analyzerOptions = [], isMonochrome = false, onClose, onCanvasResult, onUploadSource }: EffectReverseEngineeringPanelProps) {
  const [geometry, setGeometry] = useState<WindowGeometry>(loadGeometry);
  const [viewport, setViewport] = useState(viewportSize);
  const [visibleViewport, setVisibleViewport] = useState(getFloatingPanelViewport);
  useEffect(() => {
    const update = (): void => setVisibleViewport(getFloatingPanelViewport());
    update(); return subscribeFloatingPanelViewport(update);
  }, []);
  const [source, setSource] = useState<EffectReverseSource>(initialSource);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [points, setPoints] = useState<NormalizedPoint[]>([]);
  const [regions, setRegions] = useState<EffectReverseRegion[]>([]);
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<'restore' | 'production' | 'construction'>('restore');
  const [geometryCorrection, setGeometryCorrection] = useState(true);
  const [horizontalCorrection, setHorizontalCorrection] = useState(0);
  const [verticalCorrection, setVerticalCorrection] = useState(0);
  const [perspectiveStrength, setPerspectiveStrength] = useState(62);
  const [basePart, setBasePart] = useState<string>(REVERSE_COPY.basePartOptions[0]);
  const [baseDimension, setBaseDimension] = useState('');
  const [dimensionUnit, setDimensionUnit] = useState('mm');
  const [task, setTask] = useState<EffectReverseTaskRecord | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [analysisSubmitted, setAnalysisSubmitted] = useState(false);
  const dragRef = useRef<{ x: number; y: number; origin: WindowGeometry } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; origin: WindowGeometry } | null>(null);
  const viewportRef = useRef(viewport);
  const desktopGeometryRef = useRef(geometry);
  const completedTaskRef = useRef<string | null>(null);
  const baseShellGeometry = maximized
    ? { x: 16, y: 16, width: viewport.width - 32, height: viewport.height - 32 }
    : viewport.width < 960
      ? { x: 0, y: 0, width: viewport.width, height: viewport.height }
      : geometry;
  const visibleWidth = Math.min(minimized ? 360 : baseShellGeometry.width, Math.max(0, visibleViewport.width - 16));
  const visibleHeight = Math.min(minimized ? 56 : baseShellGeometry.height, Math.max(0, visibleViewport.height - 16));
  const visiblePosition = constrainFloatingPanelPosition({
    x: baseShellGeometry.x - visibleViewport.left, y: baseShellGeometry.y - visibleViewport.top,
    viewportWidth: visibleViewport.width, viewportHeight: visibleViewport.height,
    panelWidth: visibleWidth, panelHeight: visibleHeight, margin: 8,
  });
  const shellGeometry = { x: visibleViewport.left + visiblePosition.x, y: visibleViewport.top + visiblePosition.y, width: visibleWidth, height: visibleHeight };
  const validPerspective = isValidPerspective(points);

  useEffect(() => { if (typeof window !== 'undefined' && !maximized) localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry)); }, [geometry, maximized]);
  useEffect(() => {
    if (viewport.width >= 960) desktopGeometryRef.current = geometry;
  }, [geometry, viewport.width]);
  useEffect(() => {
    const handleViewportResize = () => {
      const nextViewport = viewportSize();
      const previousViewport = viewportRef.current;
      viewportRef.current = nextViewport;
      setViewport(nextViewport);
      if (nextViewport.width < 960) return;
      setGeometry((current) => {
        const geometryBasis = previousViewport.width < 960
          ? desktopGeometryRef.current
          : current;
        const nextGeometry = sanitizeGeometry(geometryBasis, nextViewport);
        desktopGeometryRef.current = nextGeometry;
        return nextGeometry;
      });
    };
    handleViewportResize();
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

  const pollTask = useCallback(async (taskId: string): Promise<EffectReverseTaskRecord | null> => {
    try {
      const response = await fetch(`/api/effect-reverse-engineering?taskId=${encodeURIComponent(taskId)}`, { cache: 'no-store' });
      const payload = await response.json() as EffectReverseTaskRecord & { success?: boolean; message?: string };
      if (!response.ok) throw new Error(payload.message || `${REVERSE_COPY.taskStatusFailed} (${response.status})`);
      setTask(payload);
      if (payload.status === 'completed' && payload.result && completedTaskRef.current !== taskId) { completedTaskRef.current = taskId; onCanvasResult(payload.result); }
      if (['completed', 'failed', 'cancelled', 'timeout'].includes(payload.status)) setBusy(false);
      return payload;
    } catch (error) { setMessage(error instanceof Error ? error.message : REVERSE_COPY.taskStatusFailed); return null; }
  }, [onCanvasResult]);

  useEffect(() => {
    if (!task?.taskId || !busy) return;
    taskEventsClient.connect();
    const unsubscribe = taskEventsClient.onTaskEvent((event) => { if (event.taskId === task.taskId) void pollTask(task.taskId); });
    const timer = window.setInterval(() => void pollTask(task.taskId), 1_500);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [busy, pollTask, task?.taskId]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (dragRef.current && !maximized) { const { origin } = dragRef.current; setGeometry(sanitizeGeometry({ ...origin, x: origin.x + event.clientX - dragRef.current.x, y: origin.y + event.clientY - dragRef.current.y })); }
      if (resizeRef.current && !maximized) { const { origin } = resizeRef.current; setGeometry(sanitizeGeometry({ ...origin, width: origin.width + event.clientX - resizeRef.current.x, height: origin.height + event.clientY - resizeRef.current.y })); }
    };
    const handleUp = () => { dragRef.current = null; resizeRef.current = null; };
    window.addEventListener('pointermove', handleMove); window.addEventListener('pointerup', handleUp);
    return () => { window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp); };
  }, [maximized]);

  const runAnalyzer = () => {
    if (analyzerOptions.length === 0) {
      setMessage(REVERSE_COPY.analysisUnavailable);
      return;
    }
    setAnalysisSubmitted(true);
    setMessage(REVERSE_COPY.analyzerSubmitNotice);
  };
  const submit = async (action: 'correct' | 'export-png' | 'export-svg' | 'export-pdf' | 'export-zip') => {
    if (!validPerspective) { setMessage(REVERSE_COPY.invalidPerspective); return; }
    setBusy(true); setMessage(''); completedTaskRef.current = null;
    try {
      const response = await fetch('/api/effect-reverse-engineering', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, projectId: source.projectId, sourceImageId: source.imageId, sourceVersionId: source.versionId, imageUrl: source.imageUrl, perspective: points, regions, instruction }) });
      const payload = await response.json() as EffectReverseTaskRecord & { success?: boolean; message?: string };
      if (!response.ok || !payload.taskId) throw new Error(payload.message || `${REVERSE_COPY.submissionFailed} (${response.status})`);
      setTask({ ...payload, userId: '', progress: 0, label: REVERSE_COPY.queued, createdAt: Date.now(), updatedAt: Date.now() });
      void pollTask(payload.taskId);
    } catch (error) { setBusy(false); setMessage(error instanceof Error ? error.message : REVERSE_COPY.submissionFailed); }
  };
  const cancel = async () => {
    if (!task?.taskId) return;
    const response = await fetch(`/api/effect-reverse-engineering?taskId=${encodeURIComponent(task.taskId)}`, { method: 'DELETE' });
    if (!response.ok) setMessage(`${REVERSE_COPY.cancellationFailed} (${response.status})`);
    await pollTask(task.taskId);
  };

  return (
    <section data-popup="effect-reverse-engineering" data-testid="effect-reverse-engineering-panel" className={`fixed z-[220] flex overflow-hidden border shadow-2xl ${minimized ? 'rounded-lg' : 'rounded-xl'} ${isMonochrome ? 'border-neutral-300 bg-white text-neutral-950' : 'border-[#6e5a22] bg-[#111] text-neutral-100'}`} style={{ left: shellGeometry.x, top: shellGeometry.y, width: minimized ? Math.min(360, shellGeometry.width) : shellGeometry.width, height: minimized ? 56 : shellGeometry.height }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex shrink-0 cursor-move items-center gap-2 border-b border-white/10 ${minimized ? 'h-14 px-3' : 'h-14 px-3 lg:h-[84px] lg:px-5'}`} onDoubleClick={() => setMaximized((value) => !value)} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; dragRef.current = { x: event.clientX, y: event.clientY, origin: geometry }; }}>
          {minimized && <span data-testid="effect-reverse-minimized-chip" className="sr-only">{REVERSE_COPY.minimizedLabel}</span>}
          <GripVertical data-testid="effect-reverse-title-grip" className="hidden h-5 w-3 shrink-0 text-neutral-600 lg:block" aria-hidden="true" />
          <div data-testid="effect-reverse-skill-badge" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/10 text-base font-bold text-[#e2c35f]">拆</div>
          {!minimized && <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 lg:flex"><ScanLine className="h-5 w-5 text-[#d4af37]" /></div>}
          <div className="min-w-0 flex-1"><div className="truncate text-base font-semibold">{minimized ? REVERSE_COPY.minimizedLabel : REVERSE_COPY.title}</div>{!minimized && <div className="mt-1 truncate text-xs text-neutral-400">{REVERSE_COPY.subtitle}</div>}</div>
          <button type="button" title={minimized ? REVERSE_COPY.restore : REVERSE_COPY.minimize} onClick={() => setMinimized((value) => !value)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md p-2 text-neutral-400 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[#d4af37]"><Minimize2 className="h-4 w-4" /></button>
          {!minimized && <button type="button" title={maximized ? REVERSE_COPY.restore : REVERSE_COPY.maximize} onClick={() => setMaximized((value) => !value)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md p-2 text-neutral-400 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[#d4af37]"><Maximize2 className="h-4 w-4" /></button>}
          <button type="button" title={REVERSE_COPY.close} onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-md p-2 text-neutral-400 outline-none hover:bg-red-500/15 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-[#d4af37]"><X className="h-4 w-4" /></button>
        </header>
        {!minimized && <div className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] max-[960px]:grid-cols-1 max-[960px]:auto-rows-max max-[960px]:overflow-y-auto"><EffectReverseSourcePanel source={source} onSelect={setSource} onUploadSource={onUploadSource} mode={mode} geometryCorrection={geometryCorrection} analyzerAvailable={analyzerOptions.length > 0} analysisSubmitted={analysisSubmitted} regions={regions} busy={busy} hasRealResult={Boolean(task?.status === 'completed' && task.result)} horizontalCorrection={horizontalCorrection} verticalCorrection={verticalCorrection} perspectiveStrength={perspectiveStrength} basePart={basePart} baseDimension={baseDimension} dimensionUnit={dimensionUnit} onModeChange={setMode} onGeometryCorrectionChange={setGeometryCorrection} onAnalyze={runAnalyzer} onRegionsChange={setRegions} onHorizontalCorrectionChange={setHorizontalCorrection} onVerticalCorrectionChange={setVerticalCorrection} onPerspectiveStrengthChange={setPerspectiveStrength} onBasePartChange={setBasePart} onBaseDimensionChange={setBaseDimension} onDimensionUnitChange={setDimensionUnit} onResetPoints={() => { setPoints([]); setHorizontalCorrection(0); setVerticalCorrection(0); setPerspectiveStrength(62); }} onSubmit={(action) => void submit(action)} /><EffectReverseWorkspace imageUrl={source.imageUrl} points={points} regions={regions} task={task} busy={busy} instruction={instruction} onPointsChange={setPoints} onInstructionChange={setInstruction} onResetPoints={() => setPoints([])} onSubmit={(action) => void submit(action)} onCancel={() => void cancel()} /></div>}
        {!minimized && <footer data-testid="effect-reverse-status-bar" className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-xs lg:px-5" aria-live="polite"><div className="flex min-w-0 flex-wrap items-center gap-2 text-neutral-400 lg:gap-5"><span>{REVERSE_COPY.modeStatus}<b className="text-neutral-200">{mode === 'restore' ? REVERSE_COPY.restoreMode : mode === 'production' ? REVERSE_COPY.productionMode : REVERSE_COPY.constructionMode}</b></span><span>{REVERSE_COPY.structureStatus}<b className="text-neutral-200">{regions.length} / {regions.length}</b></span><span>{REVERSE_COPY.correctionStatus}<b className="text-neutral-200">{geometryCorrection ? REVERSE_COPY.enabled : REVERSE_COPY.disabled}</b></span></div><span className="min-w-0 flex-1 truncate text-right text-neutral-400"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${busy ? 'animate-pulse bg-amber-400' : 'bg-emerald-400'}`} />{message || task?.label || (source.imageUrl ? '图片已载入，等待结构分析' : '等待上传效果图')}</span>{task?.result?.exportUrl && <a href={task.result.exportUrl} download className="inline-flex min-h-11 min-w-11 shrink-0 items-center text-[#d4af37] underline underline-offset-2">{REVERSE_COPY.download}</a>}</footer>}
      </div>
      {!minimized && !maximized && <button type="button" aria-label={REVERSE_COPY.resize} className="absolute bottom-0 right-0 hidden cursor-nwse-resize p-1 text-neutral-500 lg:block" onPointerDown={(event) => { resizeRef.current = { x: event.clientX, y: event.clientY, origin: geometry }; }}><GripHorizontal className="h-4 w-4 rotate-[-45deg]" /></button>}
    </section>
  );
}
