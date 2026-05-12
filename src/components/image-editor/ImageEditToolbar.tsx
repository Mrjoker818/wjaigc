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
}

export default function ImageEditToolbar({
  mode,
  brushSize,
  onBrushSizeChange,
  onConfirm,
  onCancel,
}: ImageEditToolbarProps) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-[#1a1a1a] border border-[#d4af37]/30 rounded-xl px-5 py-3 shadow-2xl">
      <div className="flex items-center gap-2 text-[#d4af37]">
        {mode === 'erase' ? (
          <Eraser className="w-4 h-4" />
        ) : (
          <Brush className="w-4 h-4" />
        )}
        <span className="text-sm font-medium text-white">
          {mode === 'erase' ? '擦除模式' : '蒙版模式'}
        </span>
      </div>

      <div className="w-px h-6 bg-[#d4af37]/20" />

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">画笔大小</span>
        <input
          type="range"
          min={2}
          max={100}
          value={brushSize}
          onChange={e => onBrushSizeChange(Number(e.target.value))}
          className="w-24 accent-[#d4af37]"
        />
        <span className="text-xs text-gray-300 w-8">{brushSize}px</span>
      </div>

      <div className="w-px h-6 bg-[#d4af37]/20" />

      <span className="text-xs text-gray-500">ESC 退出</span>

      <div className="w-px h-6 bg-[#d4af37]/20" />

      <button
        onClick={onCancel}
        className="px-3 py-1.5 text-xs text-gray-300 hover:text-white transition-colors"
      >
        取消
      </button>
      <button
        onClick={onConfirm}
        className="px-4 py-1.5 bg-[#d4af37] text-black text-xs font-semibold rounded-lg hover:bg-[#e5c349] transition-all"
      >
        确认
      </button>
    </div>
  );
}
