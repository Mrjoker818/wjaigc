'use client';

import { Download, Expand, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';

interface SharedCanvasToolbarProps {
  scale: number;
  isFullscreen: boolean;
  downloadPath?: string;
  onFit(): void;
  onZoomOut(): void;
  onZoomIn(): void;
  onToggleFullscreen(): void;
}

const controlClassName = 'inline-flex h-11 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-transparent text-foreground outline-none transition-colors hover:border-border hover:bg-toolbar-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-toolbar-bg motion-reduce:transition-none';

export function SharedCanvasToolbar({
  scale,
  isFullscreen,
  downloadPath,
  onFit,
  onZoomOut,
  onZoomIn,
  onToggleFullscreen,
}: SharedCanvasToolbarProps): React.ReactElement {
  return (
    <nav
      data-toolbar="shared-canvas"
      aria-label="只读画布工具栏"
      className="pointer-events-auto flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-toolbar-bg/95 p-2 shadow-float backdrop-blur"
    >
      <button type="button" className={controlClassName} onClick={onFit} aria-label="适应画面" title="适应画面">
        <Expand className="h-5 w-5" aria-hidden="true" />
      </button>
      <button type="button" className={controlClassName} onClick={onZoomOut} aria-label="缩小画布" title="缩小画布">
        <Minus className="h-5 w-5" aria-hidden="true" />
      </button>
      <output
        aria-label="当前比例"
        className="flex h-11 min-w-16 items-center justify-center rounded-lg px-2 text-sm font-medium tabular-nums text-muted-foreground"
      >
        {Math.round(scale * 100)}%
      </output>
      <button type="button" className={controlClassName} onClick={onZoomIn} aria-label="放大画布" title="放大画布">
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={controlClassName}
        onClick={onToggleFullscreen}
        aria-label={isFullscreen ? '退出全屏' : '进入全屏'}
        title={isFullscreen ? '退出全屏' : '进入全屏'}
      >
        {isFullscreen
          ? <Minimize2 className="h-5 w-5" aria-hidden="true" />
          : <Maximize2 className="h-5 w-5" aria-hidden="true" />}
      </button>
      {downloadPath ? (
        <a
          href={downloadPath}
          className={controlClassName}
          aria-label="下载当前内容"
          title="下载当前内容"
        >
          <Download className="h-5 w-5" aria-hidden="true" />
        </a>
      ) : null}
    </nav>
  );
}
