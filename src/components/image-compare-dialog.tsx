'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Columns2, SplitSquareHorizontal, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

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
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Slider drag handler
  const handleSliderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPos(pct);
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Reset slider on mode change
  useEffect(() => {
    setSliderPos(50);
  }, [mode]);

  // Keyboard: ESC to close, 1/2 switch mode, +/- zoom
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '1') setMode('slider');
      if (e.key === '2') setMode('sideBySide');
      if (e.key === '+' || e.key === '=') setZoomPercent(prev => Math.min(300, prev + 10));
      if (e.key === '-' || e.key === '_') setZoomPercent(prev => Math.max(10, prev - 10));
      if (e.key === '0') setZoomPercent(100);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Zoom handler with preset values
  const handleZoomChange = useCallback((value: number) => {
    setZoomPercent(Math.max(10, Math.min(300, value)));
  }, []);

  // Zoom preset buttons
  const zoomPresets = [25, 50, 75, 100, 150, 200];

  // Theme helpers
  const textPrimary = isMonochrome ? 'text-gray-900' : 'text-white';
  const textSecondary = isMonochrome ? 'text-gray-500' : 'text-[#999]';
  const accentColor = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';
  const btnActiveBg = isMonochrome ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40';
  const borderCls = isMonochrome ? 'border-gray-200' : 'border-[#333]';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`relative rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#333]'}`}
        style={{ width: '90vw', maxWidth: 1200, height: '85vh', maxHeight: 900 }}
        onClick={(e) => e.stopPropagation()}
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

        {/* Body — takes remaining space between header and footer */}
        <div className="relative flex-1 overflow-hidden min-h-0">
          {mode === 'slider' ? (
            /* Slider comparison mode */
            <div
              ref={containerRef}
              className="relative w-full h-full select-none overflow-hidden"
              style={{ cursor: isDragging ? 'col-resize' : 'default' }}
            >
              {/* Right image (full) */}
              <img
                src={rightImage.url}
                alt="B"
                className="absolute inset-0 w-full h-full object-contain"
                style={{ transform: `scale(${zoomPercent / 100})` }}
                draggable={false}
              />

              {/* Left image (clipped by slider via clip-path) */}
              <img
                src={leftImage.url}
                alt="A"
                className="absolute inset-0 w-full h-full object-contain"
                style={{
                  clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
                  transform: `scale(${zoomPercent / 100})`,
                }}
                draggable={false}
              />

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
            </div>
          ) : (
            /* Side-by-side comparison mode */
            <div className="flex w-full h-full select-none">
              {/* Left panel */}
              <div className="w-1/2 h-full flex flex-col items-center justify-center p-4 border-r overflow-hidden" style={{ borderColor: isMonochrome ? '#e5e7eb' : '#333' }}>
                <div className={`mb-2 text-xs font-medium ${textSecondary}`}>
                  A - {leftImage.modelName || '图片1'}
                </div>
                <div className="flex-1 flex items-center justify-center overflow-hidden w-full">
                  <img
                    src={leftImage.url}
                    alt="A"
                    className="object-contain"
                    style={{ maxWidth: '100%', maxHeight: '100%', transform: `scale(${zoomPercent / 100})` }}
                    draggable={false}
                  />
                </div>
              </div>

              {/* Right panel */}
              <div className="w-1/2 h-full flex flex-col items-center justify-center p-4 overflow-hidden">
                <div className={`mb-2 text-xs font-medium ${textSecondary}`}>
                  B - {rightImage.modelName || '图片2'}
                </div>
                <div className="flex-1 flex items-center justify-center overflow-hidden w-full">
                  <img
                    src={rightImage.url}
                    alt="B"
                    className="object-contain"
                    style={{ maxWidth: '100%', maxHeight: '100%', transform: `scale(${zoomPercent / 100})` }}
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
              onClick={() => setZoomPercent(100)}
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

          {/* Keyboard hints — inline with footer */}
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
