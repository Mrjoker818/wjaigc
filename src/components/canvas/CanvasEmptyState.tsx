'use client';

import { ImagePlus, Keyboard } from 'lucide-react';

export interface CanvasEmptyStateProps {
  isMonochrome: boolean;
  onUploadClick: () => void;
  onHelpClick: () => void;
}

export function CanvasEmptyState({
  isMonochrome,
  onUploadClick,
  onHelpClick,
}: CanvasEmptyStateProps) {
  return (
    <div
      data-canvas-empty-state
      data-theme={isMonochrome ? 'mono' : 'dark'}
      className="pointer-events-none absolute inset-0 flex items-center justify-center px-4"
    >
      <div className="max-w-sm text-center">
        <h2 className={`text-xl font-medium ${isMonochrome ? 'text-gray-800' : 'text-gray-100'}`}>
          无限画布
        </h2>
        <div className={`mt-3 space-y-1 text-xs leading-relaxed ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>
          <p>拖入图片 / 上传图片 / AI 生成图片到画布</p>
          <p>左键选择 · 滚轮缩放 · 空格+拖动平移 · 右键菜单</p>
          <p>底部工具栏：图像生成 · 图转3D工厂 · 修图 · Agent编排 · 字境大师 · 精修引擎 · 品牌电商</p>
        </div>
        <div
          role="group"
          aria-label="空画布快捷操作"
          className="pointer-events-auto mt-5 flex items-center justify-center gap-2"
        >
          <button
            type="button"
            onClick={onUploadClick}
            className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors motion-reduce:transition-none ${
              isMonochrome
                ? 'bg-gray-900 text-white hover:bg-gray-700'
                : 'bg-gold text-black hover:bg-gold-light'
            }`}
          >
            <ImagePlus size={15} aria-hidden />
            上传图片
          </button>
          <button
            type="button"
            onClick={onHelpClick}
            className={`flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors motion-reduce:transition-none ${
              isMonochrome
                ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                : 'border-white/15 bg-[#1a1a1a] text-gray-200 hover:bg-white/10'
            }`}
          >
            <Keyboard size={15} aria-hidden />
            使用说明
          </button>
        </div>
      </div>
    </div>
  );
}
