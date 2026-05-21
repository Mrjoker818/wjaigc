'use client';

import React from 'react';
import { Brush, Eraser } from 'lucide-react';
import type { ImageEditMode } from '@/types/image-tools';

export interface ImageEditToolbarProps {
  mode: ImageEditMode;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isMonochrome?: boolean;
}

export default function ImageEditToolbar({
  mode,
  brushSize,
  onBrushSizeChange,
  onConfirm,
  onCancel,
  isMonochrome = false,
}: ImageEditToolbarProps) {
  const accent = isMonochrome ? 'blue' : 'gold';
  const accentColor = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';
  const accentBg = isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]';
  const accentBgHover = isMonochrome ? 'hover:bg-blue-600' : 'hover:bg-[#e5c349]';
  const accentText = isMonochrome ? 'text-white' : 'text-black';
  const dividerColor = isMonochrome ? 'bg-blue-200' : 'bg-[#d4af37]/20';
  const panelBg = isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#d4af37]/30';
  const inputAccent = isMonochrome ? 'accent-blue-500' : 'accent-[#d4af37]';

  return (
    <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 border rounded-xl px-5 py-3 shadow-2xl ${panelBg}`}>
      <div className={`flex items-center gap-2 ${accentColor}`}>
        {mode === 'erase' ? (
          <Eraser className="w-4 h-4" />
        ) : (
          <Brush className="w-4 h-4" />
        )}
        <span className={`text-sm font-medium ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>
          {mode === 'erase' ? '擦除模式' : '蒙版模式'}
        </span>
      </div>

      <div className={`w-px h-6 ${dividerColor}`} />

      <div className="flex items-center gap-2">
        <span className={`text-xs ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>画笔大小</span>
        <input
          type="range"
          min={2}
          max={100}
          value={brushSize}
          onChange={e => onBrushSizeChange(Number(e.target.value))}
          className={`w-24 ${inputAccent}`}
        />
        <span className={`text-xs w-8 ${isMonochrome ? 'text-gray-600' : 'text-gray-300'}`}>{brushSize}px</span>
      </div>

      <div className={`w-px h-6 ${dividerColor}`} />

      <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gray-500'}`}>ESC 退出</span>

      <div className={`w-px h-6 ${dividerColor}`} />

      <button
        onClick={onCancel}
        className={`px-3 py-1.5 text-xs transition-colors ${isMonochrome ? 'text-gray-600 hover:text-gray-900' : 'text-gray-300 hover:text-white'}`}
      >
        取消
      </button>
      <button
        onClick={onConfirm}
        className={`px-4 py-1.5 ${accentBg} ${accentText} text-xs font-semibold rounded-lg ${accentBgHover} transition-all`}
      >
        确认
      </button>
    </div>
  );
}
