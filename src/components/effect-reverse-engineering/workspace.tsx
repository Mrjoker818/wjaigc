'use client';

import { Download, RotateCcw } from 'lucide-react';
import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { EffectReverseRegion, EffectReverseTaskRecord, NormalizedPoint } from '@/lib/effect-reverse-engineering/types';
import type { ReverseTab } from './i18n';
import { REVERSE_COPY } from './i18n';

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
  const [tab, setTab] = useState<ReverseTab>('original');
  const [calibrationWidth, setCalibrationWidth] = useState('');
  const [unit, setUnit] = useState('mm');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const hasRealResult = task?.status === 'completed' && task.result;
  const tabs: ReadonlyArray<readonly [ReverseTab, string]> = [
    ['original', REVERSE_COPY.original],
    ['perspective', REVERSE_COPY.perspective],
    ['flat', REVERSE_COPY.flat],
    ...(hasRealResult ? [['result', REVERSE_COPY.result] as const] : []),
  ];

  const updatePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragIndex === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPointsChange(points.map((point, index) => index === dragIndex ? {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    } : point));
  };

  const addPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy || points.length >= 4) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPointsChange([...points, {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }]);
  };

  return (
    <main data-testid="effect-reverse-workspace" data-panel="workspace" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
      <div className="flex flex-wrap gap-1 border-b border-white/10" role="tablist" aria-label={REVERSE_COPY.workspaceLabel}>
        {tabs.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`border-b-2 px-3 py-2 text-xs ${tab === value ? 'border-[#d4af37] text-[#d4af37]' : 'border-transparent text-neutral-400'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {tab === 'original' && (
          <div className="flex min-h-[280px] flex-1 items-center justify-center bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={REVERSE_COPY.originalAlt} className="max-h-full max-w-full object-contain" draggable={false} />
          </div>
        )}
        {tab === 'perspective' && (
          <div className="relative min-h-[280px] flex-1 overflow-hidden bg-black" onPointerMove={updatePoint} onPointerUp={() => setDragIndex(null)} onPointerLeave={() => setDragIndex(null)} onPointerDown={addPoint}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={REVERSE_COPY.perspectiveAlt} className="h-full w-full object-contain" draggable={false} />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1">
              <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#d4af37" strokeWidth="0.004" />
            </svg>
            {points.map((point, index) => (
              <button key={`point-${index}`} type="button" aria-label={REVERSE_COPY.movePerspectivePoint(index + 1)} className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black bg-[#d4af37]" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setDragIndex(index); }} />
            ))}
          </div>
        )}
        {tab === 'flat' && <div className="flex min-h-[280px] flex-1 items-center justify-center border border-dashed border-white/15 text-sm text-neutral-400">{regions.length ? REVERSE_COPY.flatWithRegions : REVERSE_COPY.flatWithoutRegions}</div>}
        {tab === 'result' && hasRealResult && <div className="flex min-h-[280px] flex-1 items-center justify-center border border-dashed border-white/15 text-neutral-400">{hasRealResult.correctedImageUrl ? <img src={hasRealResult.correctedImageUrl} alt={REVERSE_COPY.result} className="max-h-full max-w-full object-contain" /> : `${REVERSE_COPY.unavailable}：${REVERSE_COPY.noVectorResult}`}</div>}
      </div>
      <div className="grid grid-cols-[1fr_90px] gap-2 text-xs">
        <label className="flex items-center gap-2 border border-white/10 px-2 py-1">
          {REVERSE_COPY.width}
          <input value={calibrationWidth} onChange={(event) => setCalibrationWidth(event.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="min-w-0 flex-1 bg-transparent outline-none" placeholder={REVERSE_COPY.unset} />
        </label>
        <select value={unit} onChange={(event) => setUnit(event.target.value)} className="border border-white/10 bg-[#111] px-2 py-1" aria-label={REVERSE_COPY.unit}>
          <option value="mm">mm</option><option value="cm">cm</option><option value="px">px</option>
        </select>
      </div>
      <div className="text-[11px] text-amber-300">{REVERSE_COPY.ratioOnly}</div>
      <textarea value={instruction} onChange={(event) => onInstructionChange(event.target.value)} maxLength={4000} placeholder={REVERSE_COPY.instruction} className="min-h-16 resize-y border border-white/10 bg-transparent p-2 text-xs outline-none" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => onSubmit('correct')} className="flex items-center gap-1 bg-[#d4af37] px-3 py-2 text-xs font-medium text-black disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />{REVERSE_COPY.correct}</button>
        {(['export-png', 'export-svg', 'export-pdf', 'export-zip'] as const).map((action) => {
          const format = action.replace('export-', '').toUpperCase();
          return <button key={action} type="button" disabled={busy} onClick={() => onSubmit(action)} className="flex items-center gap-1 border border-white/10 px-3 py-2 text-xs disabled:opacity-40"><Download className="h-3.5 w-3.5" />{REVERSE_COPY.downloadFormat(format)}</button>;
        })}
        <button type="button" onClick={onResetPoints} className="border border-white/10 px-3 py-2 text-xs">{REVERSE_COPY.resetPoints}</button>
        {busy && <button type="button" onClick={onCancel} className="border border-red-500/50 px-3 py-2 text-xs text-red-300">{REVERSE_COPY.cancel}</button>}
      </div>
      {task && <div data-testid="effect-reverse-task-progress" className="space-y-1 text-xs" aria-live="polite"><div className="flex justify-between"><span>{REVERSE_COPY.progress}：{task.label}</span><span>{task.progress}%</span></div><div className="h-1.5 bg-white/10"><div className="h-full bg-[#d4af37]" style={{ width: `${task.progress}%` }} /></div></div>}
    </main>
  );
}
