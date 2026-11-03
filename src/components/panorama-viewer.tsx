'use client';

import NextImage from 'next/image';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Globe, Minus, Plus, RotateCcw, X } from 'lucide-react';

interface PanoramaViewerProps {
  imageUrl: string;
  onClose: () => void;
}

interface PanoramaView { scale: number; x: number; y: number }
interface Point { x: number; y: number }
interface Gesture { center: Point; distance: number; view: PanoramaView }

const INITIAL_VIEW: PanoramaView = { scale: 1, x: 0, y: 0 };

function geometry(points: Map<number, Point>): { center: Point; distance: number } | null {
  const [first, second] = [...points.values()];
  if (!first) return null;
  if (!second) return { center: first, distance: 1 };
  return { center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)) };
}

export default function PanoramaViewer({ imageUrl, onClose }: PanoramaViewerProps): React.ReactElement {
  const [view, setView] = useState<PanoramaView>(INITIAL_VIEW);
  const [failed, setFailed] = useState(false);
  const viewRef = useRef<PanoramaView>(INITIAL_VIEW);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  const pointsRef = useRef(new Map<number, Point>());
  const kindRef = useRef<string | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const helpId = useId();

  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  const rebase = useCallback((): void => {
    const current = geometry(pointsRef.current);
    gestureRef.current = current ? { ...current, view: viewRef.current } : null;
  }, []);

  const applyView = useCallback((requested: PanoramaView): void => {
    if (![requested.scale, requested.x, requested.y].every(Number.isFinite)) return;
    const next = { scale: Math.max(0.5, Math.min(3, requested.scale)), x: requested.x, y: Math.max(-200, Math.min(200, requested.y)) };
    viewRef.current = next;
    setView(next);
    const current = geometry(pointsRef.current);
    gestureRef.current = current ? { ...current, view: next } : null;
  }, []);

  const clearPointers = useCallback((): void => {
    const ids = [...pointsRef.current.keys()], stage = stageRef.current;
    pointsRef.current.clear();
    kindRef.current = null;
    gestureRef.current = null;
    for (const id of ids) {
      try { if (stage?.hasPointerCapture(id)) stage.releasePointerCapture(id); }
      catch { /* The browser may already have released capture during unmount. */ }
    }
  }, []);

  const reset = useCallback((): void => { clearPointers(); applyView(INITIAL_VIEW); }, [clearPointers, applyView]);

  useEffect(() => {
    const dialog = dialogRef.current, stage = stageRef.current, previousFocus = document.activeElement;
    if (!dialog || !stage) return;
    closeButtonRef.current?.focus({ preventScroll: true });
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!Number.isFinite(event.deltaY)) return;
      applyView({ ...viewRef.current, scale: viewRef.current.scale - event.deltaY * 0.001 });
    };
    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
        const first = focusable[0], last = focusable.at(-1), active = document.activeElement;
        if (!first || !last) return;
        if (!dialog.contains(active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      }
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keyboard, true);
    return (): void => {
      stage.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keyboard, true);
      clearPointers();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [applyView, clearPointers]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (failed || event.button !== 0 || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const points = pointsRef.current;
    if ((kindRef.current && kindRef.current !== event.pointerType) || points.size >= (event.pointerType === 'touch' ? 2 : 1)) return;
    event.preventDefault();
    event.stopPropagation();
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    kindRef.current = event.pointerType;
    try { event.currentTarget.setPointerCapture(event.pointerId); }
    catch { points.delete(event.pointerId); if (!points.size) kindRef.current = null; rebase(); return; }
    event.currentTarget.focus({ preventScroll: true });
    rebase();
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const points = pointsRef.current, start = gestureRef.current;
    if (!points.has(event.pointerId) || !start || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = geometry(points);
    if (!current) return;
    applyView({ scale: start.view.scale * current.distance / start.distance, x: start.view.x + current.center.x - start.center.x, y: start.view.y + current.center.y - start.center.y });
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointsRef.current.delete(event.pointerId)) return;
    event.stopPropagation();
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
    catch { /* Capture can be released by pointercancel before this handler. */ }
    if (!pointsRef.current.size) kindRef.current = null;
    rebase();
  };

  const keyboardView = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    const current = viewRef.current;
    const next: Record<string, PanoramaView> = {
      ArrowLeft: { ...current, x: current.x - 32 }, ArrowRight: { ...current, x: current.x + 32 },
      ArrowUp: { ...current, y: current.y - 32 }, ArrowDown: { ...current, y: current.y + 32 },
      '+': { ...current, scale: current.scale + 0.25 }, '=': { ...current, scale: current.scale + 0.25 }, '-': { ...current, scale: current.scale - 0.25 },
    };
    if (event.key === 'Home' || next[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Home') reset(); else applyView(next[event.key]);
    }
  };

  const buttonClass = 'flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 text-sm text-white transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#d4af37] disabled:opacity-40';

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="全景浏览" data-modal="panorama" className="fixed inset-0 z-[201] flex min-h-0 flex-col overflow-hidden bg-black text-white">
      <div className="shrink-0 space-y-2 border-b border-[#333] bg-[#111] p-2">
        <div className="flex min-w-0 items-center gap-2">
          <Globe size={18} className="shrink-0 text-[#d4af37]" />
          <h2 className="min-w-0 flex-1 text-sm font-medium">720° 全景浏览</h2>
          <button ref={closeButtonRef} type="button" aria-label="关闭全景浏览" className={buttonClass} onClick={onClose}><X size={20} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="缩小全景" disabled={view.scale <= 0.5} className={buttonClass} onClick={() => applyView({ ...viewRef.current, scale: viewRef.current.scale - 0.25 })}><Minus size={18} /></button>
          <output role="status" aria-label="全景缩放" className="min-w-11 text-center text-sm tabular-nums">{Math.round(view.scale * 100)}%</output>
          <button type="button" aria-label="放大全景" disabled={view.scale >= 3} className={buttonClass} onClick={() => applyView({ ...viewRef.current, scale: viewRef.current.scale + 0.25 })}><Plus size={18} /></button>
          <button type="button" aria-label="重置全景视图" className={buttonClass} onClick={reset}><RotateCcw size={16} />重置</button>
        </div>
      </div>
      <div ref={stageRef} role="region" aria-label="全景交互区" aria-describedby={helpId} tabIndex={0} data-panorama-stage className="relative min-h-0 flex-1 cursor-grab select-none overflow-hidden active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d4af37]" style={{ touchAction: 'none' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onLostPointerCapture={finishPointer} onKeyDown={keyboardView}>
        {failed ? <p role="alert" className="p-6 text-center text-sm text-white">图片加载失败，请关闭后重新打开。</p> : <NextImage fill unoptimized loading="eager" sizes="100vw" src={imageUrl} alt="全景图" draggable={false} className="panorama-img object-contain" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} data-scale={view.scale} data-offset-x={view.x} data-offset-y={view.y} onError={() => { clearPointers(); setFailed(true); }} />}
        <p id={helpId} className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg bg-black/70 px-3 py-2 text-center text-xs leading-5 text-white/90">拖动浏览 · 双指或滚轮缩放 · 方向键平移，Home重置</p>
      </div>
    </div>
  );
}
