'use client';

import { GripHorizontal, Maximize2, Minimize2, ScanLine, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { taskEventsClient } from '@/lib/task-events-client';
import type { EffectReverseRegion, EffectReverseTaskRecord, EffectReverseTaskResult, NormalizedPoint, NormalizedQuad } from '@/lib/effect-reverse-engineering/types';
import { EffectReverseSourcePanel } from './effect-reverse-engineering/source-panel';
import { EffectReverseWorkspace } from './effect-reverse-engineering/workspace';
import { EffectReverseLayerPanel } from './effect-reverse-engineering/layer-panel';
import { REVERSE_COPY } from './effect-reverse-engineering/i18n';

const STORAGE_KEY = 'wujie.effect-reverse.window.v1';
const MIN_WIDTH = 760;
const MIN_HEIGHT = 520;
const DEFAULT_GEOMETRY: WindowGeometry = { x: 80, y: 48, width: 1180, height: 760 };

interface WindowGeometry { x: number; y: number; width: number; height: number; }
export interface EffectReverseSource { projectId: string; imageId: string; versionId: string; imageUrl: string; label?: string; }
export interface EffectReverseAnalyzerOption { id: string; label: string; }
interface EffectReverseEngineeringPanelProps { initialSource: EffectReverseSource; analyzerOptions?: EffectReverseAnalyzerOption[]; isMonochrome?: boolean; onClose: () => void; onCanvasResult: (result: EffectReverseTaskResult) => void; }

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

export function EffectReverseEngineeringPanel({ initialSource, analyzerOptions = [], isMonochrome = false, onClose, onCanvasResult }: EffectReverseEngineeringPanelProps) {
  const [geometry, setGeometry] = useState<WindowGeometry>(loadGeometry);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [points, setPoints] = useState<NormalizedPoint[]>([]);
  const [regions, setRegions] = useState<EffectReverseRegion[]>([]);
  const [instruction, setInstruction] = useState('');
  const [task, setTask] = useState<EffectReverseTaskRecord | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ x: number; y: number; origin: WindowGeometry } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; origin: WindowGeometry } | null>(null);
  const completedTaskRef = useRef<string | null>(null);
  const shellGeometry = maximized ? { x: 16, y: 16, width: viewportSize().width - 32, height: viewportSize().height - 32 } : geometry;
  const validPerspective = isValidPerspective(points);

  useEffect(() => { if (typeof window !== 'undefined' && !maximized) localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry)); }, [geometry, maximized]);

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

  const runAnalyzer = () => { if (analyzerOptions.length > 0) setMessage(REVERSE_COPY.analyzerSubmitNotice); };
  const submit = async (action: 'correct' | 'export-png' | 'export-svg' | 'export-pdf' | 'export-zip') => {
    if (!validPerspective) { setMessage(REVERSE_COPY.invalidPerspective); return; }
    setBusy(true); setMessage(''); completedTaskRef.current = null;
    try {
      const response = await fetch('/api/effect-reverse-engineering', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, projectId: initialSource.projectId, sourceImageId: initialSource.imageId, sourceVersionId: initialSource.versionId, imageUrl: initialSource.imageUrl, perspective: points, regions, instruction }) });
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
    <section data-popup="effect-reverse-engineering" data-testid="effect-reverse-engineering-panel" className={`fixed z-[220] flex overflow-hidden border shadow-2xl ${isMonochrome ? 'border-neutral-300 bg-white text-neutral-950' : 'border-[#6e5a22] bg-[#111] text-neutral-100'}`} style={{ left: shellGeometry.x, top: shellGeometry.y, width: shellGeometry.width, height: minimized ? 48 : shellGeometry.height }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 cursor-move items-center gap-3 border-b border-white/10 px-4" onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; dragRef.current = { x: event.clientX, y: event.clientY, origin: geometry }; }}>
          <ScanLine className="h-4 w-4 text-[#d4af37]" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{REVERSE_COPY.title}</div><div className="truncate text-[11px] text-neutral-400">{REVERSE_COPY.subtitle}</div></div>
          <button type="button" title={minimized ? REVERSE_COPY.restore : REVERSE_COPY.minimize} onClick={() => setMinimized((value) => !value)} className="p-2"><Minimize2 className="h-4 w-4" /></button>
          <button type="button" title={maximized ? REVERSE_COPY.restore : REVERSE_COPY.maximize} onClick={() => setMaximized((value) => !value)} className="p-2"><Maximize2 className="h-4 w-4" /></button>
          <button type="button" title={REVERSE_COPY.close} onClick={onClose} className="p-2"><X className="h-4 w-4" /></button>
        </header>
        {!minimized && <div className="grid min-h-0 flex-1 grid-cols-[190px_minmax(0,1fr)_280px] max-[1100px]:grid-cols-[160px_minmax(0,1fr)_240px] max-[960px]:grid-cols-1 max-[960px]:overflow-y-auto"><EffectReverseSourcePanel source={initialSource} /><EffectReverseWorkspace imageUrl={initialSource.imageUrl} points={points} regions={regions} task={task} busy={busy} instruction={instruction} onPointsChange={setPoints} onInstructionChange={setInstruction} onResetPoints={() => setPoints([])} onSubmit={(action) => void submit(action)} onCancel={() => void cancel()} /><EffectReverseLayerPanel regions={regions} analyzerAvailable={analyzerOptions.length > 0} onChange={setRegions} onAnalyze={runAnalyzer} /></div>}
        {!minimized && (message || task?.result?.exportUrl) && <div data-testid="effect-reverse-message" className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 px-4 py-2 text-xs" aria-live="polite">{message && <span className="min-w-0 flex-1 truncate text-amber-300">{message}</span>}{task?.result?.exportUrl && <a href={task.result.exportUrl} download className="shrink-0 text-[#d4af37] underline underline-offset-2">{REVERSE_COPY.download}</a>}</div>}
      </div>
      {!minimized && !maximized && <button type="button" aria-label={REVERSE_COPY.resize} className="absolute bottom-0 right-0 cursor-nwse-resize p-1 text-neutral-500" onPointerDown={(event) => { resizeRef.current = { x: event.clientX, y: event.clientY, origin: geometry }; }}><GripHorizontal className="h-4 w-4 rotate-[-45deg]" /></button>}
    </section>
  );
}
