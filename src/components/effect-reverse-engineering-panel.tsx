'use client';

import {
  Download,
  GripHorizontal,
  Maximize2,
  Minimize2,
  Plus,
  ScanLine,
  Square,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { taskEventsClient } from '@/lib/task-events-client';
import type {
  EffectReverseRegion,
  EffectReverseTaskRecord,
  EffectReverseTaskResult,
  NormalizedPoint,
  NormalizedQuad,
} from '@/lib/effect-reverse-engineering/types';

const STORAGE_KEY = 'wujie.effect-reverse.window.v1';
const MIN_WIDTH = 760;
const MIN_HEIGHT = 520;
const DEFAULT_GEOMETRY: WindowGeometry = { x: 80, y: 48, width: 1180, height: 760 };

interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EffectReverseSource {
  projectId: string;
  imageId: string;
  versionId: string;
  imageUrl: string;
  label?: string;
}

export interface EffectReverseAnalyzerOption {
  id: string;
  label: string;
}

interface EffectReverseEngineeringPanelProps {
  initialSource: EffectReverseSource;
  analyzerOptions?: EffectReverseAnalyzerOption[];
  isMonochrome?: boolean;
  onClose: () => void;
  onCanvasResult: (result: EffectReverseTaskResult) => void;
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export function sanitizeGeometry(value: unknown, viewport = viewportSize()): WindowGeometry {
  const record = value && typeof value === 'object' ? value as Partial<WindowGeometry> : {};
  const mobile = viewport.width < 960;
  if (mobile) return { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const width = Math.min(viewport.width - 32, Math.max(MIN_WIDTH, Number(record.width) || DEFAULT_GEOMETRY.width));
  const height = Math.min(viewport.height - 32, Math.max(MIN_HEIGHT, Number(record.height) || DEFAULT_GEOMETRY.height));
  return {
    width,
    height,
    x: Math.min(viewport.width - width - 16, Math.max(16, Number(record.x) || (viewport.width - width) / 2)),
    y: Math.min(viewport.height - height - 16, Math.max(16, Number(record.y) || (viewport.height - height) / 2)),
  };
}

function loadGeometry(): WindowGeometry {
  if (typeof window === 'undefined') return DEFAULT_GEOMETRY;
  try {
    return sanitizeGeometry(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return sanitizeGeometry(null);
  }
}

function area(points: NormalizedPoint[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function isValidPerspective(points: NormalizedPoint[]): points is NormalizedQuad {
  return points.length === 4
    && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
    && area(points) > 0.01;
}

function inferredRegions(regions: EffectReverseRegion[]): EffectReverseRegion[] {
  return regions.map((region) => ({ ...region, inferred: true }));
}

export function EffectReverseEngineeringPanel({
  initialSource,
  analyzerOptions = [],
  isMonochrome = false,
  onClose,
  onCanvasResult,
}: EffectReverseEngineeringPanelProps) {
  const [geometry, setGeometry] = useState<WindowGeometry>(loadGeometry);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [points, setPoints] = useState<NormalizedPoint[]>([]);
  const [regions, setRegions] = useState<EffectReverseRegion[]>([]);
  const [instruction, setInstruction] = useState('');
  const [task, setTask] = useState<EffectReverseTaskRecord | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; origin: WindowGeometry } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; origin: WindowGeometry } | null>(null);
  const pointDragRef = useRef<number | null>(null);
  const completedTaskRef = useRef<string | null>(null);

  const shellGeometry = maximized
    ? { x: 16, y: 16, width: viewportSize().width - 32, height: viewportSize().height - 32 }
    : geometry;
  const validPerspective = isValidPerspective(points);

  useEffect(() => {
    if (typeof window !== 'undefined' && !maximized) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry));
    }
  }, [geometry, maximized]);

  const pollTask = useCallback(async (taskId: string): Promise<EffectReverseTaskRecord | null> => {
    try {
      const response = await fetch(`/api/effect-reverse-engineering?taskId=${encodeURIComponent(taskId)}`, {
        cache: 'no-store',
      });
      const payload = await response.json() as EffectReverseTaskRecord & {
        success?: boolean;
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message || `Task status failed (${response.status})`);
      setTask(payload);
      if (payload.status === 'completed' && payload.result && completedTaskRef.current !== taskId) {
        completedTaskRef.current = taskId;
        onCanvasResult(payload.result);
      }
      if (['completed', 'failed', 'cancelled', 'timeout'].includes(payload.status)) setBusy(false);
      return payload;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to read task status');
      return null;
    }
  }, [onCanvasResult]);

  useEffect(() => {
    if (!task?.taskId || !busy) return;
    taskEventsClient.connect();
    const unsubscribe = taskEventsClient.onTaskEvent((event) => {
      if (event.taskId === task.taskId) void pollTask(task.taskId);
    });
    const timer = window.setInterval(() => void pollTask(task.taskId), 1_500);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [busy, pollTask, task?.taskId]);

  useEffect(() => {
    const movePerspectivePoint = (index: number, clientX: number, clientY: number) => {
      const rect = previewRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const nextPoint = {
        x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
      };
      setPoints((current) => current.map((point, pointIndex) => (
        pointIndex === index ? nextPoint : point
      )));
    };
    const handleMove = (event: PointerEvent) => {
      if (pointDragRef.current !== null) {
        movePerspectivePoint(pointDragRef.current, event.clientX, event.clientY);
        return;
      }
      if (dragRef.current && !maximized) {
        const { origin } = dragRef.current;
        setGeometry(sanitizeGeometry({
          ...origin,
          x: origin.x + event.clientX - dragRef.current.x,
          y: origin.y + event.clientY - dragRef.current.y,
        }));
      }
      if (resizeRef.current && !maximized) {
        const { origin } = resizeRef.current;
        setGeometry(sanitizeGeometry({
          ...origin,
          width: origin.width + event.clientX - resizeRef.current.x,
          height: origin.height + event.clientY - resizeRef.current.y,
        }));
      }
    };
    const handleUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
      pointDragRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [maximized]);

  const startPointDrag = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (busy) return;
    event.preventDefault();
    event.stopPropagation();
    pointDragRef.current = index;
  };

  const addPerspectivePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy || points.length >= 4) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPoints((current) => [...current, {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }]);
  };

  const addManualRegion = () => {
    const id = `region-${Date.now()}`;
    setRegions((current) => [...current, {
      id,
      kind: 'custom',
      label: `Region ${current.length + 1}`,
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 },
      ],
      visible: true,
      locked: false,
      inferred: false,
    }]);
  };

  const runAnalyzer = () => {
    if (analyzerOptions.length === 0) return;
    setRegions((current) => inferredRegions(current));
    setMessage('Analyzer output is marked as inferred and requires review.');
  };

  const submit = async (action: 'correct' | 'export-png' | 'export-svg' | 'export-pdf' | 'export-zip') => {
    if (!validPerspective) {
      setMessage('Set four valid perspective points first');
      return;
    }
    setBusy(true);
    setMessage('');
    completedTaskRef.current = null;
    try {
      const response = await fetch('/api/effect-reverse-engineering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          projectId: initialSource.projectId,
          sourceImageId: initialSource.imageId,
          sourceVersionId: initialSource.versionId,
          imageUrl: initialSource.imageUrl,
          perspective: points,
          regions,
          instruction,
        }),
      });
      const payload = await response.json() as EffectReverseTaskRecord & {
        success?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.taskId) throw new Error(payload.message || `Submission failed (${response.status})`);
      setTask({ ...payload, userId: '', progress: 0, label: 'Queued', createdAt: Date.now(), updatedAt: Date.now() });
      void pollTask(payload.taskId);
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : 'Submission failed');
    }
  };

  const cancel = async () => {
    if (!task?.taskId) return;
    const response = await fetch(`/api/effect-reverse-engineering?taskId=${encodeURIComponent(task.taskId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) setMessage(`Cancellation failed (${response.status})`);
    await pollTask(task.taskId);
  };

  const exportActions = useMemo(() => [
    ['PNG', 'export-png'],
    ['SVG', 'export-svg'],
    ['PDF', 'export-pdf'],
    ['ZIP', 'export-zip'],
  ] as const, []);

  return (
    <section
      data-popup="effect-reverse-engineering"
      data-testid="effect-reverse-engineering-panel"
      className={`fixed z-[220] flex overflow-hidden border shadow-2xl ${isMonochrome ? 'border-neutral-300 bg-white text-neutral-950' : 'border-[#6e5a22] bg-[#111] text-neutral-100'}`}
      style={{
        left: shellGeometry.x,
        top: shellGeometry.y,
        width: shellGeometry.width,
        height: minimized ? 48 : shellGeometry.height,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-12 shrink-0 cursor-move items-center gap-3 border-b border-white/10 px-4"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button')) return;
            dragRef.current = { x: event.clientX, y: event.clientY, origin: geometry };
          }}
        >
          <ScanLine className="h-4 w-4 text-[#d4af37]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">Effect Reverse Engineering Pro</div>
            <div className="truncate text-[11px] text-neutral-400">Manual structure mode</div>
          </div>
          <button type="button" title="Minimize" onClick={() => setMinimized((value) => !value)} className="p-2"><Minimize2 className="h-4 w-4" /></button>
          <button type="button" title="Maximize" onClick={() => setMaximized((value) => !value)} className="p-2"><Maximize2 className="h-4 w-4" /></button>
          <button type="button" title="Close" onClick={onClose} className="p-2"><X className="h-4 w-4" /></button>
        </header>

        {!minimized && (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] max-[960px]:grid-cols-1">
            <main className="flex min-h-0 flex-col gap-3 overflow-auto p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="truncate text-xs text-neutral-400">Frozen source: {initialSource.label || initialSource.imageId}</div>
                <button type="button" onClick={() => setPoints([])} className="border border-white/15 px-3 py-1 text-xs">Reset points</button>
              </div>
              <div
                ref={previewRef}
                className="relative min-h-[320px] flex-1 overflow-hidden bg-black"
                onPointerDown={addPerspectivePoint}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={initialSource.imageUrl} alt="Frozen reverse engineering source" className="h-full w-full object-contain" draggable={false} />
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                  {points.length > 1 && <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#d4af37" strokeWidth="0.004" />}
                  {points.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="0.012" fill="#d4af37" />)}
                </svg>
                {points.map((point, index) => (
                  <button
                    key={`handle-${index}`}
                    type="button"
                    aria-label={`Move perspective point ${index + 1}`}
                    className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-black bg-[#d4af37] shadow"
                    style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                    onPointerDown={(event) => startPointDrag(event, index)}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => void submit('correct')} className="bg-[#d4af37] px-4 py-2 text-xs font-medium text-black disabled:opacity-40">Correct perspective</button>
                {exportActions.map(([label, action]) => (
                  <button key={action} type="button" disabled={busy} onClick={() => void submit(action)} className="flex items-center gap-1 border border-white/15 px-3 py-2 text-xs disabled:opacity-40">
                    <Download className="h-3.5 w-3.5" />{label}
                  </button>
                ))}
                {busy && <button type="button" onClick={() => void cancel()} className="border border-red-500/60 px-3 py-2 text-xs text-red-300">Cancel</button>}
              </div>
              {(task || message) && (
                <div className="space-y-1 text-xs" aria-live="polite">
                  {task && <><div className="flex justify-between"><span>{task.label}</span><span>{task.progress}%</span></div><div className="h-1.5 overflow-hidden bg-white/10"><div className="h-full bg-[#d4af37]" style={{ width: `${task.progress}%` }} /></div></>}
                  {message && <div className="text-amber-300">{message}</div>}
                  {task?.result?.exportUrl && <a href={task.result.exportUrl} download className="inline-flex text-[#d4af37] underline">Download export</a>}
                </div>
              )}
            </main>

            <aside className="min-h-0 overflow-y-auto border-l border-white/10 p-4 max-[960px]:border-l-0 max-[960px]:border-t">
              <div className="mb-5 space-y-2">
                <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Structure regions</h3><button type="button" onClick={addManualRegion} className="flex items-center gap-1 text-xs text-[#d4af37]"><Plus className="h-3.5 w-3.5" />Add manual region</button></div>
                <button type="button" disabled={analyzerOptions.length === 0} onClick={runAnalyzer} title={analyzerOptions.length === 0 ? 'Unavailable until an analyzer is configured' : 'Run configured analyzer'} className="w-full border border-white/15 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40">
                  {analyzerOptions.length === 0 ? 'Unavailable until an analyzer is configured' : 'Run AI analysis'}
                </button>
                <div className="space-y-2">
                  {regions.map((region) => (
                    <div key={region.id} className="flex items-center gap-2 border border-white/10 p-2 text-xs">
                      <Square className="h-3.5 w-3.5 text-[#d4af37]" />
                      <input value={region.label} maxLength={120} onChange={(event) => setRegions((items) => items.map((item) => item.id === region.id ? { ...item, label: event.target.value } : item))} className="min-w-0 flex-1 bg-transparent outline-none" />
                      {region.inferred && <span className="text-amber-300">Inferred</span>}
                      <button type="button" onClick={() => setRegions((items) => items.filter((item) => item.id !== region.id))}><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <label className="block space-y-2 text-xs"><span>Session instruction</span><textarea value={instruction} maxLength={4000} onChange={(event) => setInstruction(event.target.value)} className="min-h-28 w-full resize-y border border-white/15 bg-transparent p-2 outline-none" /></label>
            </aside>
          </div>
        )}
      </div>
      {!minimized && !maximized && (
        <button
          type="button"
          aria-label="Resize panel"
          className="absolute bottom-0 right-0 cursor-nwse-resize p-1 text-neutral-500"
          onPointerDown={(event) => {
            resizeRef.current = { x: event.clientX, y: event.clientY, origin: geometry };
          }}
        ><GripHorizontal className="h-4 w-4 rotate-[-45deg]" /></button>
      )}
    </section>
  );
}
