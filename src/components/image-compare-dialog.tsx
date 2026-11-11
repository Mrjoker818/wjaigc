'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Columns2, SplitSquareHorizontal, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Move } from 'lucide-react';
import { useModalFocus } from './canvas/use-modal-focus';

interface ImageCompareDialogProps {
  /** 左侧图片（对比前/A图） */
  leftImage: { url: string; prompt?: string; modelName?: string };
  /** 右侧图片（对比后/B图） */
  rightImage: { url: string; prompt?: string; modelName?: string };
  /** 主题风格 */
  isMonochrome?: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

type CompareMode = 'slider' | 'sideBySide';

export function ImageCompareDialog({
  leftImage,
  rightImage,
  isMonochrome = false,
  onClose,
}: ImageCompareDialogProps) {
  const [mode, setMode] = useState<CompareMode>('slider');
  const [sliderPos, setSliderPos] = useState(50); // 0-100 percentage
  const [zoomPercent, setZoomPercent] = useState(100); // 10-500 percentage
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchOwnerRef = useRef<{ pointerId: number; kind: 'slider' | 'pan'; target: HTMLDivElement } | null>(null);
  const closeTouchRef = useRef<{ id: number; x: number; y: number; invalid: boolean } | null>(null);
  useModalFocus(dialogRef, closeRef, onClose);

  useEffect(() => {
    const invalidateMulti = (event: TouchEvent): void => {
      if (closeTouchRef.current && event.touches.length > 1) closeTouchRef.current.invalid = true;
    };
    const invalidate = (): void => { if (closeTouchRef.current) closeTouchRef.current.invalid = true; };
    const visibility = (): void => { if (document.visibilityState !== 'visible') invalidate(); };
    document.addEventListener('touchstart', invalidateMulti, { capture: true, passive: true });
    window.addEventListener('blur', invalidate);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      closeTouchRef.current = null;
      document.removeEventListener('touchstart', invalidateMulti, true);
      window.removeEventListener('blur', invalidate);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);


  const finishTouchGesture = useCallback((event?: React.PointerEvent<HTMLDivElement>): void => {
    const owner = touchOwnerRef.current;
    if (!owner || event && event.pointerId !== owner.pointerId) return;
    event?.stopPropagation();
    touchOwnerRef.current = null;
    if (owner.target.hasPointerCapture(owner.pointerId)) owner.target.releasePointerCapture(owner.pointerId);
    setIsDraggingSlider(false);
    setIsPanning(false);
  }, []);

  const beginTouchGesture = useCallback((event: React.PointerEvent<HTMLDivElement>, kind: 'slider' | 'pan'): void => {
    if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0
      || touchOwnerRef.current || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)
      || kind === 'pan' && zoomPercent <= 100) return;
    event.preventDefault();
    event.stopPropagation();
    touchOwnerRef.current = { pointerId: event.pointerId, kind, target: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === 'slider') setIsDraggingSlider(true);
    else {
      panStartRef.current = { x: event.clientX, y: event.clientY, ox: panOffset.x, oy: panOffset.y };
      setIsPanning(true);
    }
  }, [zoomPercent, panOffset]);

  const moveTouchGesture = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const owner = touchOwnerRef.current;
    if (!owner || event.pointerId !== owner.pointerId || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    if (owner.kind === 'slider' && containerRef.current) {
      const bounds = containerRef.current.getBoundingClientRect();
      if (bounds.width > 0) setSliderPos(Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)));
    } else if (owner.kind === 'pan') {
      setPanOffset({ x: panStartRef.current.ox + event.clientX - panStartRef.current.x,
        y: panStartRef.current.oy + event.clientY - panStartRef.current.y });
    }
  }, []);

  useEffect(() => () => {
    const owner = touchOwnerRef.current;
    touchOwnerRef.current = null;
    if (owner?.target.hasPointerCapture(owner.pointerId)) owner.target.releasePointerCapture(owner.pointerId);
  }, []);

  useEffect(() => {
    finishTouchGesture();
    const onBlur = (): void => finishTouchGesture();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [mode, zoomPercent, finishTouchGesture]);

  // Slider drag handler
  const handleSliderMouseDown = useCallback((e: React.MouseEvent) => {
    if (touchOwnerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingSlider(true);
  }, []);

  // Pan drag handler (for zoomed images)
  const handlePanMouseDown = useCallback((e: React.MouseEvent) => {
    if (touchOwnerRef.current) return;
    if (zoomPercent <= 100) return;
    e.preventDefault();
    e.stopPropagation();
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      ox: panOffset.x,
      oy: panOffset.y,
    };
  }, [zoomPercent, panOffset]);

  // Global mouse move — runs when slider dragging or panning
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (touchOwnerRef.current) return;
    if (isDraggingSlider && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPos(pct);
    }
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanOffset({
        x: panStartRef.current.ox + dx,
        y: panStartRef.current.oy + dy,
      });
    }
  }, [isDraggingSlider, isPanning]);

  // Global mouse up — stop dragging/panning
  const handleMouseUp = useCallback(() => {
    if (touchOwnerRef.current) return;
    setIsDraggingSlider(false);
    setIsPanning(false);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Reset slider and pan on mode change
  useEffect(() => {
    setSliderPos(50);
    setPanOffset({ x: 0, y: 0 });
  }, [mode]);

  // Reset pan on zoom reset
  useEffect(() => {
    if (zoomPercent === 100) {
      setPanOffset({ x: 0, y: 0 });
    }
  }, [zoomPercent]);

  const handleShortcuts = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    switch (event.key) {
      case '1': setMode('slider'); break;
      case '2': setMode('sideBySide'); break;
      case '+':
      case '=': setZoomPercent(previous => Math.min(500, previous + 10)); break;
      case '-':
      case '_': setZoomPercent(previous => Math.max(10, previous - 10)); break;
      case '0': setZoomPercent(100); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  // Zoom handler
  const handleZoomChange = useCallback((value: number) => {
    setZoomPercent(Math.max(10, Math.min(500, value)));
  }, []);

  const zoomPresets = [25, 50, 75, 100, 150, 200, 300, 500];

  // Theme helpers
  const textPrimary = isMonochrome ? 'text-gray-900' : 'text-white';
  const textSecondary = isMonochrome ? 'text-gray-600' : 'text-[#999]';
  const accentColor = isMonochrome ? 'text-blue-600' : 'text-[#d4af37]';
  const btnActiveBg = isMonochrome ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40';
  const borderCls = isMonochrome ? 'border-gray-200' : 'border-[#333]';

  // Cursor for slider area
  const sliderCursor = isPanning ? 'grabbing' : isDraggingSlider ? 'col-resize' : zoomPercent > 100 ? 'grab' : 'default';

  // Common image transform (scale + pan, with pan in pixel space)
  const imageTransform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomPercent / 100})`;

  return (
    <div
      data-compare-dialog
      data-modal="image-compare"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="图片对比"
        tabIndex={-1}
        onKeyDown={handleShortcuts}
        className={`relative rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#333]'}`}
        style={{ width: 'min(1200px, calc(100vw - max(8px, env(safe-area-inset-left, 0px)) - max(8px, env(safe-area-inset-right, 0px))))', height: 'min(900px, calc(100dvh - max(8px, env(safe-area-inset-top, 0px)) - max(8px, env(safe-area-inset-bottom, 0px))))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b [@media(max-height:480px)]:gap-1 [@media(max-height:480px)]:px-2 [@media(max-height:480px)]:py-0.5 ${borderCls}`}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 [@media(max-height:480px)]:flex-nowrap [@media(max-height:480px)]:gap-1">
            <span className={`whitespace-nowrap text-sm font-semibold ${textPrimary}`}>图片对比</span>

            {/* Mode toggle */}
            <div className={`flex items-center gap-1 p-0.5 rounded-lg ${isMonochrome ? 'bg-gray-100' : 'bg-[#252525]'}`}>
              <button
                onClick={() => setMode('slider')}
                aria-pressed={mode === 'slider'}
                className={`flex min-h-11 min-w-11 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 [@media(max-height:480px)]:gap-1 [@media(max-height:480px)]:px-1.5 rounded-md text-xs font-medium transition-all border ${
                  mode === 'slider' ? btnActiveBg : `${textSecondary} border-transparent`
                }`}
              >
                <SplitSquareHorizontal size={14} />
                滑动对比
              </button>
              <button
                onClick={() => setMode('sideBySide')}
                aria-pressed={mode === 'sideBySide'}
                className={`flex min-h-11 min-w-11 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 [@media(max-height:480px)]:gap-1 [@media(max-height:480px)]:px-1.5 rounded-md text-xs font-medium transition-all border ${
                  mode === 'sideBySide' ? btnActiveBg : `${textSecondary} border-transparent`
                }`}
              >
                <Columns2 size={14} />
                并排对比
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              ref={closeRef}
              type="button"
              onTouchStart={event => {
                if (closeTouchRef.current && event.touches.length > 1) { closeTouchRef.current.invalid = true; return; }
                if (!event.isTrusted || event.touches.length !== 1 || event.changedTouches.length !== 1) { closeTouchRef.current = null; return; }
                const touch = event.changedTouches[0];
                closeTouchRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, invalid: false };
              }}
              onTouchMove={event => {
                const start = closeTouchRef.current;
                if (!start) return;
                const touch = Array.from(event.changedTouches).find(item => item.identifier === start.id);
                if (event.touches.length !== 1 || touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) >= 8) start.invalid = true;
              }}
              onTouchCancel={() => { closeTouchRef.current = null; }}
              onTouchEnd={event => {
                const start = closeTouchRef.current;
                if (!start) return;
                const touch = Array.from(event.changedTouches).find(item => item.identifier === start.id);
                if (!touch) return;
                closeTouchRef.current = null;
                if (!event.isTrusted || !event.cancelable) return;
                event.preventDefault();
                if (!event.nativeEvent.defaultPrevented || start.invalid || event.touches.length !== 0 || event.changedTouches.length !== 1
                  || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) >= 8) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                if (touch.clientX < bounds.left || touch.clientX > bounds.right || touch.clientY < bounds.top || touch.clientY > bounds.bottom) return;
                const hit = event.currentTarget.ownerDocument.elementFromPoint(touch.clientX, touch.clientY);
                if (!hit || !event.currentTarget.contains(hit)) return;
                onClose();
              }}
              onClick={onClose}
              aria-label="关闭图片对比"
              className={`flex h-11 w-11 shrink-0 items-center justify-center p-1.5 rounded-lg transition-colors ${textSecondary} hover:${isMonochrome ? 'text-gray-700 bg-gray-100' : 'text-white bg-[#2a2a2a]'}`}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="relative flex-1 overflow-hidden min-h-0">
          {mode === 'slider' ? (
            /* Slider comparison mode
             * Uses clip-path on the left image's container div.
             * Both images are full-size with the same transform so they stay aligned.
             * The left container clips from the right edge to the slider position.
             */
            <div
              ref={containerRef}
              className="relative w-full h-full select-none overflow-hidden"
              style={{ cursor: sliderCursor, touchAction: 'none' }}
              onPointerDown={(event) => beginTouchGesture(event, 'pan')}
              onPointerMove={moveTouchGesture}
              onPointerUp={finishTouchGesture}
              onPointerCancel={finishTouchGesture}
              onLostPointerCapture={finishTouchGesture}
              onMouseDown={(e) => {
                e.stopPropagation();
                // Don't start panning if clicking the slider handle
                if ((e.target as HTMLElement).closest('[data-slider-handle]')) return;
                if (zoomPercent > 100) {
                  handlePanMouseDown(e);
                }
              }}
            >
              {/* Right image (full, rendered first = behind) */}
              <div className="absolute inset-0">
                <img
                  src={rightImage.url}
                  alt="B"
                  className="absolute inset-0 w-full h-full object-contain"
                  style={{ transform: imageTransform }}
                  draggable={false}
                />
              </div>

              {/* Left image (clipped via container div) */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
                }}
              >
                <img
                  src={leftImage.url}
                  alt="A"
                  className="absolute inset-0 w-full h-full object-contain"
                  style={{ transform: imageTransform }}
                  draggable={false}
                />
              </div>

              {/* Slider line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 z-10 pointer-events-none"
                style={{
                  left: `${sliderPos}%`,
                  background: isMonochrome ? '#3b82f6' : '#d4af37',
                  boxShadow: `0 0 8px ${isMonochrome ? 'rgba(59,130,246,0.5)' : 'rgba(212,175,55,0.5)'}`,
                }}
              />

              {/* Slider handle */}
              <div
                data-slider-handle
                role="slider"
                aria-label="对比分界"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(sliderPos)}
                tabIndex={0}
                className="absolute top-1/2 flex h-11 w-11 -translate-y-1/2 -translate-x-1/2 items-center justify-center z-20 cursor-col-resize"
                style={{ left: `${sliderPos}%` }}
                onMouseDown={handleSliderMouseDown}
                onPointerDown={(event) => beginTouchGesture(event, 'slider')}
                onPointerMove={moveTouchGesture}
                onPointerUp={finishTouchGesture}
                onPointerCancel={finishTouchGesture}
                onLostPointerCapture={finishTouchGesture}
                onKeyDown={(event) => {
                  const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -5
                    : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 5 : null;
                  if (delta === null && event.key !== 'Home' && event.key !== 'End') return;
                  event.preventDefault(); event.stopPropagation();
                  setSliderPos(current => event.key === 'Home' ? 0 : event.key === 'End' ? 100 : Math.max(0, Math.min(100, current + (delta ?? 0))));
                }}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg border-2 ${
                  isMonochrome ? 'bg-white border-blue-400' : 'bg-[#1a1a1a] border-[#d4af37]'
                }`}>
                  <div className="flex gap-0.5">
                    <ChevronLeft size={10} className={accentColor} />
                    <ChevronRight size={10} className={accentColor} />
                  </div>
                </div>
              </div>

              {/* Labels */}
              <div className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg text-xs font-medium z-10 ${
                isMonochrome ? 'bg-white/90 text-gray-700 shadow' : 'bg-black/70 text-[#d4af37]'
              }`}>
                A - {leftImage.modelName || '图片1'}
              </div>
              <div className={`absolute top-3 right-3 px-2.5 py-1 rounded-lg text-xs font-medium z-10 ${
                isMonochrome ? 'bg-white/90 text-gray-700 shadow' : 'bg-black/70 text-[#d4af37]'
              }`}>
                B - {rightImage.modelName || '图片2'}
              </div>

              {/* Pan hint when zoomed */}
              {zoomPercent > 100 && !isPanning && !isDraggingSlider && (
                <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg text-xs font-medium z-10 pointer-events-none ${
                  isMonochrome ? 'bg-white/90 text-gray-500 shadow' : 'bg-black/70 text-[#999]'
                }`}>
                  <Move size={12} className="inline mr-1.5 -mt-0.5" />
                  拖拽平移查看细节
                </div>
              )}
            </div>
          ) : (
            /* Side-by-side comparison mode */
            <div className="flex w-full h-full select-none">
              {/* Left panel */}
              <div
                className="w-1/2 h-full flex flex-col items-center justify-center p-4 border-r overflow-hidden"
                style={{ borderColor: isMonochrome ? '#e5e7eb' : '#333', cursor: zoomPercent > 100 ? (isPanning ? 'grabbing' : 'grab') : 'default', touchAction: zoomPercent > 100 ? 'none' : 'auto' }}
                onMouseDown={handlePanMouseDown}
                onPointerDown={(event) => beginTouchGesture(event, 'pan')}
                onPointerMove={moveTouchGesture}
                onPointerUp={finishTouchGesture}
                onPointerCancel={finishTouchGesture}
                onLostPointerCapture={finishTouchGesture}
              >
                <div className={`mb-2 text-xs font-medium ${textSecondary}`}>
                  A - {leftImage.modelName || '图片1'}
                </div>
                <div className="flex-1 flex items-center justify-center overflow-hidden w-full">
                  <img
                    src={leftImage.url}
                    alt="A"
                    className="object-contain"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      transform: imageTransform,
                    }}
                    draggable={false}
                  />
                </div>
              </div>

              {/* Right panel */}
              <div
                className="w-1/2 h-full flex flex-col items-center justify-center p-4 overflow-hidden"
                style={{ cursor: zoomPercent > 100 ? (isPanning ? 'grabbing' : 'grab') : 'default', touchAction: zoomPercent > 100 ? 'none' : 'auto' }}
                onMouseDown={handlePanMouseDown}
                onPointerDown={(event) => beginTouchGesture(event, 'pan')}
                onPointerMove={moveTouchGesture}
                onPointerUp={finishTouchGesture}
                onPointerCancel={finishTouchGesture}
                onLostPointerCapture={finishTouchGesture}
              >
                <div className={`mb-2 text-xs font-medium ${textSecondary}`}>
                  B - {rightImage.modelName || '图片2'}
                </div>
                <div className="flex-1 flex items-center justify-center overflow-hidden w-full">
                  <img
                    src={rightImage.url}
                    alt="B"
                    className="object-contain"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      transform: imageTransform,
                    }}
                    draggable={false}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Zoom controls bar */}
        <div className={`flex-shrink-0 flex flex-wrap items-center justify-center gap-2 px-2 py-2 border-t [@media(max-height:480px)]:grid [@media(max-height:480px)]:grid-cols-[44px_minmax(44px,1fr)_48px_44px_44px] [@media(max-height:480px)]:gap-x-1 [@media(max-height:480px)]:gap-y-0 [@media(max-height:480px)]:py-0.5 ${borderCls}`}>
          <button
            onClick={() => handleZoomChange(zoomPercent - 10)}
            aria-label="缩小对比图片"
            className={`flex h-11 w-11 items-center justify-center p-1 rounded transition-colors ${textSecondary} hover:${isMonochrome ? 'text-gray-700 bg-gray-100' : 'text-white bg-[#2a2a2a]'}`}
          >
            <ZoomOut size={14} />
          </button>

          {/* Zoom preset buttons */}
          <div className={`grid w-full grid-cols-4 min-[600px]:w-auto min-[600px]:grid-cols-8 gap-1 p-0.5 rounded-lg [@media(max-height:480px)]:order-first [@media(max-height:480px)]:col-span-full [@media(max-height:480px)]:w-full [@media(max-height:480px)]:gap-0 [@media(max-height:480px)]:p-0 ${isMonochrome ? 'bg-gray-100' : 'bg-[#252525]'}`}>
            {zoomPresets.map(pct => (
              <button
                key={pct}
                onClick={() => handleZoomChange(pct)}
                aria-pressed={zoomPercent === pct}
                className={`min-h-11 min-w-11 whitespace-nowrap px-2 py-1 rounded text-xs font-medium transition-all ${
                  zoomPercent === pct
                    ? btnActiveBg
                    : `${textSecondary} hover:${isMonochrome ? 'text-gray-700' : 'text-white'}`
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>

          {/* Zoom slider */}
          <input
            type="range"
            min={10}
            max={500}
            value={zoomPercent}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            aria-label="对比图片缩放"
            style={{ minHeight: 44, touchAction: 'pan-y', background: 'linear-gradient(rgba(128,128,128,0.35), rgba(128,128,128,0.35)) center / 100% 4px no-repeat' }}
            className={`w-24 h-11 [@media(max-height:480px)]:w-full rounded-full cursor-pointer ${
              isMonochrome ? 'accent-blue-500' : 'accent-[#d4af37]'
            }`}
          />

          {/* Current zoom display */}
          <span className={`text-xs font-medium min-w-[3rem] text-center ${accentColor}`}>
            {zoomPercent}%
          </span>

          <button
            onClick={() => handleZoomChange(zoomPercent + 10)}
            aria-label="放大对比图片"
            className={`flex h-11 w-11 items-center justify-center p-1 rounded transition-colors ${textSecondary} hover:${isMonochrome ? 'text-gray-700 bg-gray-100' : 'text-white bg-[#2a2a2a]'}`}
          >
            <ZoomIn size={14} />
          </button>

          {/* Reset zoom */}
          {zoomPercent !== 100 && (
            <button
              onClick={() => { setZoomPercent(100); setPanOffset({ x: 0, y: 0 }); }}
              className={`min-h-11 min-w-11 whitespace-nowrap px-2 py-1 rounded text-xs transition-colors ${
                isMonochrome ? 'text-blue-600 hover:bg-blue-50' : 'text-[#d4af37] hover:bg-[#d4af37]/10'
              }`}
            >
              重置
            </button>
          )}
        </div>

        {/* Footer: Prompt info */}
        <div className={`flex-shrink-0 flex items-center gap-3 px-3 py-2 border-t [@media(max-height:480px)]:gap-2 [@media(max-height:480px)]:px-2 [@media(max-height:480px)]:py-1 ${borderCls}`}>
          <div className="flex-1 min-w-0 [@media(max-height:480px)]:flex [@media(max-height:480px)]:items-center [@media(max-height:480px)]:gap-1">
            <div className={`text-xs ${accentColor} font-medium mb-0.5 [@media(max-height:480px)]:mb-0 [@media(max-height:480px)]:shrink-0`}>A</div>
            <div className={`text-xs ${textSecondary} truncate`}>{leftImage.prompt || '无描述'}</div>
          </div>
          <div className={`w-px h-6 [@media(max-height:480px)]:h-4 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} />
          <div className="flex-1 min-w-0 [@media(max-height:480px)]:flex [@media(max-height:480px)]:items-center [@media(max-height:480px)]:gap-1">
            <div className={`text-xs ${accentColor} font-medium mb-0.5 [@media(max-height:480px)]:mb-0 [@media(max-height:480px)]:shrink-0`}>B</div>
            <div className={`text-xs ${textSecondary} truncate`}>{rightImage.prompt || '无描述'}</div>
          </div>

          {/* Keyboard hints */}
          <div className={`hidden min-[900px]:flex items-center gap-2 text-xs ${textSecondary} flex-shrink-0`}>
            <span>ESC 关闭</span>
            <span>1 滑动</span>
            <span>2 并排</span>
          </div>
        </div>
      </div>
    </div>
  );
}
