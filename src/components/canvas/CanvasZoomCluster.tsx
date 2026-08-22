'use client';

import {
  Command,
  GitBranch,
  GitMerge,
  Grip,
  Layers,
  Map as MapIcon,
  Maximize2,
  Settings,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface CanvasZoomClusterProps {
  zoom: number;
  isMonochrome: boolean;
  iconClasses: { zoomIn: string; zoomOut: string };
  separatorClassName: string;
  gridMode: 'dots' | 'lines' | 'blank';
  showConnections: boolean;
  showLayerPanel: boolean;
  showVersionHistory: boolean;
  minimapOpen: boolean;
  minimapAvailable: boolean;
  isGenerating: boolean;
  generationProgress?: { current: number; total: number };
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetView: () => void;
  onToggleMinimap: () => void;
  onOpenCommandPalette: () => void;
  onCycleGridMode: () => void;
  onToggleConnections: () => void;
  onToggleLayerPanel: () => void;
  onToggleVersionHistory: () => void;
  onOpenEngineDialog: () => void;
}

const buttonClassName = 'p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0';
const tooltipClassName = 'absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white';

export function CanvasZoomCluster({
  zoom,
  isMonochrome,
  iconClasses,
  separatorClassName,
  gridMode,
  showConnections,
  showLayerPanel,
  showVersionHistory,
  minimapOpen,
  minimapAvailable,
  isGenerating,
  generationProgress,
  onZoomOut,
  onZoomIn,
  onResetView,
  onToggleMinimap,
  onOpenCommandPalette,
  onCycleGridMode,
  onToggleConnections,
  onToggleLayerPanel,
  onToggleVersionHistory,
  onOpenEngineDialog,
}: CanvasZoomClusterProps) {
  const idleClassName = isMonochrome
    ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
    : 'text-gold-muted hover:text-text-bright hover:bg-white/10';
  const inactiveToggleClassName = isMonochrome
    ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
    : 'text-gold-muted hover:text-gold-light hover:bg-gold/10';
  const activeToggleClassName = isMonochrome
    ? 'text-blue-500 bg-blue-50 ring-1 ring-blue-500/30'
    : 'text-gold bg-gold/20 ring-1 ring-gold/40';

  return (
    <>
      <div className={`w-px h-5 ml-1.5 ${separatorClassName}`} />

      <button type="button" onClick={onZoomOut} className={`${buttonClassName} ${idleClassName}`} title="缩小画布">
        <ZoomOut className={`h-3.5 w-3.5 ${iconClasses.zoomOut}`} />
        <span className={tooltipClassName}>缩小</span>
      </button>

      <span className={`text-xs font-mono w-10 text-center select-none shrink-0 ${isMonochrome ? 'text-gray-500' : 'text-gold'}`}>
        {Math.round(zoom * 100)}%
      </span>

      <button type="button" onClick={onZoomIn} className={`${buttonClassName} ${idleClassName}`} title="放大画布">
        <ZoomIn className={`h-3.5 w-3.5 ${iconClasses.zoomIn}`} />
        <span className={tooltipClassName}>放大</span>
      </button>

      <div className={`w-px h-5 mx-1 ${separatorClassName} shrink-0`} />

      <button type="button" onClick={onResetView} className={`${buttonClassName} ${idleClassName}`} title="重置视图">
        <Maximize2 className="h-4 w-4" />
        <span className={tooltipClassName}>重置视图</span>
      </button>

      {minimapAvailable && (
        <button
          type="button"
          onClick={onToggleMinimap}
          aria-pressed={minimapOpen}
          className={`${buttonClassName} ${minimapOpen ? activeToggleClassName : inactiveToggleClassName}`}
          title={minimapOpen ? '关闭小地图' : '打开小地图'}
        >
          <MapIcon className="h-4 w-4" />
          <span className={tooltipClassName}>{minimapOpen ? '关闭小地图' : '打开小地图'}</span>
        </button>
      )}

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className={`${buttonClassName} ${idleClassName}`}
        title="命令面板 (Ctrl+K / Cmd+K)"
      >
        <Command className="h-4 w-4" />
        <span className={tooltipClassName}>命令面板 Ctrl+K</span>
      </button>

      <button
        type="button"
        onClick={onCycleGridMode}
        className={`${buttonClassName} ${idleClassName}`}
        title={`网格: ${gridMode === 'dots' ? '点阵' : gridMode === 'lines' ? '线条' : '空白'}`}
      >
        <Grip className="h-4 w-4" />
        <span className={tooltipClassName}>{gridMode === 'dots' ? '点阵' : gridMode === 'lines' ? '线条' : '空白'}</span>
      </button>

      <button
        type="button"
        onClick={onToggleConnections}
        className={`${buttonClassName} ${showConnections ? activeToggleClassName : inactiveToggleClassName}`}
        title={showConnections ? '隐藏连线' : '显示连线'}
      >
        <GitMerge className="h-4 w-4" />
        <span className={tooltipClassName}>{showConnections ? '隐藏连线' : '显示连线'}</span>
      </button>

      <button
        type="button"
        onClick={onToggleLayerPanel}
        className={`${buttonClassName} ${showLayerPanel ? activeToggleClassName : inactiveToggleClassName}`}
        title={showLayerPanel ? '关闭图层' : '打开图层'}
      >
        <Layers className="h-4 w-4" />
        <span className={tooltipClassName}>{showLayerPanel ? '关闭图层' : '图层面板'}</span>
      </button>

      <button
        type="button"
        onClick={onToggleVersionHistory}
        className={`${buttonClassName} ${showVersionHistory ? activeToggleClassName : inactiveToggleClassName}`}
        title={showVersionHistory ? '关闭版本历史' : '版本历史'}
      >
        <GitBranch className="h-4 w-4" />
        <span className={tooltipClassName}>{showVersionHistory ? '关闭历史' : '版本历史'}</span>
      </button>

      <div className={`w-px h-5 mx-1 ${separatorClassName} shrink-0`} />

      <button
        type="button"
        onClick={onOpenEngineDialog}
        className={`${buttonClassName} ${idleClassName}`}
        title="AI 引擎设置 (放大/去背景/SVG/分层)"
      >
        <Settings className="h-4 w-4" />
        <span className={tooltipClassName}>AI引擎设置</span>
      </button>

      {isGenerating && (
        <>
          <div className={`w-px h-5 mx-1 ${separatorClassName}`} />
          <div className="flex items-center gap-1.5">
            <div className="w-14 h-1.5 rounded-full overflow-hidden bg-[#333]">
              <div
                className="h-full rounded-full progress-bar shimmer"
                style={{
                  width: `${generationProgress ? (generationProgress.current / generationProgress.total * 100) : 0}%`,
                  background: 'linear-gradient(90deg, #C8A45C, #E8D5A3, #C8A45C)',
                }}
              />
            </div>
            <span className="text-xs text-gold/80">生成中</span>
          </div>
        </>
      )}
    </>
  );
}
