'use client';

import { ImagePlus, Keyboard } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

export interface CanvasEmptyStateProps {
  isMonochrome: boolean;
  onUploadClick: () => void;
  onHelpClick: () => void;
  rightInset?: number;
  isCovered?: boolean;
}

export function CanvasEmptyState({
  isMonochrome,
  onUploadClick,
  onHelpClick,
  rightInset = 0,
  isCovered = false,
}: CanvasEmptyStateProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const syncScrollable = (): void => {
      setIsScrollable(content.scrollHeight > content.clientHeight + 1);
    };
    syncScrollable();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncScrollable);
    observer?.observe(content);
    window.addEventListener('resize', syncScrollable);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncScrollable);
    };
  }, [rightInset, isCovered]);

  return (
    <div
      data-canvas-empty-state
      data-theme={isMonochrome ? 'mono' : 'dark'}
      className={`pointer-events-none absolute top-4 items-center justify-center px-4 max-md:bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-[var(--canvas-bottom-toolbar-offset,80px)] ${isCovered ? 'hidden' : 'flex'}`}
      style={{ left: 'var(--canvas-empty-left-inset, 88px)', right: rightInset }}
    >
      <div
        ref={contentRef}
        data-toolbar="empty-canvas-content"
        role={isScrollable ? 'region' : undefined}
        aria-label={isScrollable ? '画布入门说明' : undefined}
        tabIndex={isScrollable ? 0 : undefined}
        className={`max-h-full w-full min-w-0 max-w-sm overflow-y-auto overscroll-contain text-center [touch-action:pan-y] ${isScrollable ? 'pointer-events-auto' : 'pointer-events-none'}`}
      >
        <h2 className={`text-xl font-medium ${isMonochrome ? 'text-gray-800' : 'text-gray-100'}`}>
          无限画布
        </h2>
        <div className={`mt-3 space-y-1 text-xs leading-relaxed ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>
          <p>拖入图片 / 上传图片 / AI 生成图片到画布</p>
          <p>左键选择 · 滚轮缩放 · 空格+拖动平移 · 右键菜单</p>
          <p>底部工具栏：图像生成 · 图转3D工厂 · 修图 · Agent编排 · 字境大师 · 精修引擎 · 品牌电商</p>
        </div>
        <div
          data-toolbar="empty-canvas-actions"
          role="group"
          aria-label="空画布快捷操作"
          className="pointer-events-auto mt-5 flex flex-wrap items-center justify-center gap-2"
        >
          <button
            type="button"
            onClick={onUploadClick}
            className={`flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors motion-reduce:transition-none ${
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
            className={`flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors motion-reduce:transition-none ${
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
