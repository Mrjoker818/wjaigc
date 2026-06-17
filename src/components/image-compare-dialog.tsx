'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Columns2, SplitSquareHorizontal, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Move } from 'lucide-react';

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
  const [zoomPercent, setZoomPercent] = useState(100); // 10-300 percentage
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Slider drag handler
  const handleSliderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingSlider(true);
  }, []);

  // Pan drag handler (for zoomed images)
  const handlePanMouseDown = useCallback((e: React.MouseEvent) => {
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

  // Global mouse move
  const handleMouseMove = useCallback((e: MouseEvent) => {
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

  // Global mouse up
  const handleMouseUp = useCallback(() => {
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

  // Block all pointer events from reaching the canvas behind
  useEffect(() => {
    const blockEvent = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-compare-dialog]')) {
        e.stopPropagation();
      }
    };

    const events = ['mousedown', 'mousemove', 'mouseup', 'wheel', 'touchstart', 'touchmove', 'touchend'];
    events.forEach(evt => {
      document.addEventListener(evt, blockEvent, true);
    });

    return () => {
      events.forEach(evt => {
        document.removeEventListener(evt, blockEvent, true);
      });
    };
  }, []);

  // Keyboard: ESC to close, 1/2 switch mode, +/- zoom
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === '1') { e.stopPropagation(); setMode('slider'); }
      if (e.key === '2') { e.stopPropagation(); setMode('sideBySide'); }
      if (e.key === '+' || e.key === '=') { e.stopPropagation(); setZoomPercent(prev => Math.min(300, prev + 10)); }
      if (e.key === '-' || e.key === '_') { e.stopPropagation(); setZoomPercent(prev => Math.max(10, prev - 10)); }
      if (e.key === '0') { e.stopPropagation(); setZoomPercent(100); }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [onClose]);

  // Zoom handler
  const handleZoomChange = useCallback((value: number) => {
    setZoomPercent(Math.max(10, Math.min(300, value)));
  }, []);

  const zoomPresets = [25, 50, 75, 100, 150, 200];

  // Theme helpers
  const textPrimary = isMonochrome ? 'text-gray-900' : 'text-white';
  const textSecondary = isMonochrome ? 'text-gray-500' : 'text-[#999]';
  const accentColor = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';
  const btnActiveBg = isMonochrome ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40';
  const borderCls = isMonochrome ? 'border-gray-200' : 'border-[#333]';

  // Cursor for slider area
  const sliderCursor = isPanning ? 'grabbing' : isDraggingSlider ? 'col-resize' : zoomPercent > 100 ? 'grab' : 'default';

  // Common image transform (scale + pan, with pan in pixel space)
  const imageTransform = `scale(${zoomPercent / 100}) translate(${panOffset.x}px, ${panOffset.y}px)`;

  return (
    <div
      data-compare-dialog
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className={`relative rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#333]'}`}
        style={{ width: '90vw', maxWidth: 1200, height: '85vh', maxHeight: 900 }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex-shrink-0 flex items-center justify-between px-5 py-3 border-b ${borderCls}`}>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${textPrimary}`}>图片对比</span>

            {/* Mode toggle */}
            <div className={`flex items-center gap-1 p-0.5 rounded-lg ${isMonochrome ? 'bg-gray-100' : 'bg-[#252525]'}`}>
              <button
                onClick={() => setMode('slider')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${
                  mode === 'slider' ? btnActiveBg : `${textSecondary} border-transparent`
                }`}
              >
                <SplitSquareHorizontal size={14} />
                滑动对比
              </button>
              <button
                onClick={() => setMode('sideBySide')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${
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
              onClick={onClose}
              className={`p-1.5 rounded-lg transition-colors ${textSecondary} hover:${isMonochrome ? 'text-gray-700 bg-gray-100' : 'text-white bg-[#2a2a2a]'}`}
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
              style={{ cursor: sliderCursor }}
              onMouseDown={(e) => {
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
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 cursor-col-resize"
                style={{ left: `${sliderPos}%` }}
                onMouseDown={handleSliderMouseDown}
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
                style={{ borderColor: isMonochrome ? '#e5e7eb' : '#333', cursor: zoomPercent > 100 ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
                onMouseDown={handlePanMouseDown}
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
                style={{ cursor: zoomPercent > 100 ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
                onMouseDown={handlePanMouseDown}
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
        <div className={`flex-shrink-0 flex items-center justify-center gap-3 px-5 py-2 border-t ${borderCls}`}>
          <button
            onClick={() => handleZoomChange(zoomPercent - 10)}
            className={`p-1 rounded transition-colors ${textSecondary} hover:${isMonochrome ? 'text-gray-700 bg-gray-100' : 'text-white bg-[#2a2a2a]'}`}
          >
            <ZoomOut size={14} />
          </button>

          {/* Zoom preset buttons */}
          <div className={`flex items-center gap-1 p-0.5 rounded-lg ${isMonochrome ? 'bg-gray-100' : 'bg-[#252525]'}`}>
            {zoomPresets.map(pct => (
              <button
                key={pct}
                onClick={() => handleZoomChange(pct)}
                className={`px-2 py-1 rounded text-xs font-medium transition-all ${
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
            max={300}
            value={zoomPercent}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            className={`w-24 h-1 rounded-full appearance-none cursor-pointer ${
              isMonochrome ? 'accent-blue-500' : 'accent-[#d4af37]'
            }`}
          />

          {/* Current zoom display */}
          <span className={`text-xs font-medium min-w-[3rem] text-center ${accentColor}`}>
            {zoomPercent}%
          </span>

          <button
            onClick={() => handleZoomChange(zoomPercent + 10)}
            className={`p-1 rounded transition-colors ${textSecondary} hover:${isMonochrome ? 'text-gray-700 bg-gray-100' : 'text-white bg-[#2a2a2a]'}`}
          >
            <ZoomIn size={14} />
          </button>

          {/* Reset zoom */}
          {zoomPercent !== 100 && (
            <button
              onClick={() => { setZoomPercent(100); setPanOffset({ x: 0, y: 0 }); }}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                isMonochrome ? 'text-blue-500 hover:bg-blue-50' : 'text-[#d4af37] hover:bg-[#d4af37]/10'
              }`}
            >
              重置
            </button>
          )}
        </div>

        {/* Footer: Prompt info */}
        <div className={`flex-shrink-0 flex items-center gap-4 px-5 py-2.5 border-t ${borderCls}`}>
          <div className="flex-1 min-w-0">
            <div className={`text-xs ${accentColor} font-medium mb-0.5`}>A</div>
            <div className={`text-xs ${textSecondary} truncate`}>{leftImage.prompt || '无描述'}</div>
          </div>
          <div className={`w-px h-6 ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`} />
          <div className="flex-1 min-w-0">
            <div className={`text-xs ${accentColor} font-medium mb-0.5`}>B</div>
            <div className={`text-xs ${textSecondary} truncate`}>{rightImage.prompt || '无描述'}</div>
          </div>

          {/* Keyboard hints */}
          <div className={`flex items-center gap-2 text-xs ${textSecondary} opacity-50 flex-shrink-0`}>
            <span>ESC 关闭</span>
            <span>1 滑动</span>
            <span>2 并排</span>
          </div>
        </div>
      </div>
    </div>
  );
}
