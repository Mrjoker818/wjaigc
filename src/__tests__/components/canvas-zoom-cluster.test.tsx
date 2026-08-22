// @vitest-environment jsdom

import type { ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CanvasZoomCluster } from '@/components/canvas/CanvasZoomCluster';

type CanvasZoomClusterMinimapContract = Parameters<typeof CanvasZoomCluster>[0] & {
  minimapOpen: boolean;
  minimapAvailable: boolean;
  onToggleMinimap: () => void;
};

const TestCanvasZoomCluster: ComponentType<CanvasZoomClusterMinimapContract> = CanvasZoomCluster;

const renderCluster = (overrides: Partial<CanvasZoomClusterMinimapContract> = {}) => render(
  <TestCanvasZoomCluster
    zoom={1.25}
    isMonochrome={false}
    iconClasses={{ zoomIn: 'zoom-in-theme', zoomOut: 'zoom-out-theme' }}
    separatorClassName="separator-theme"
    gridMode="dots"
    showConnections={false}
    showLayerPanel={false}
    showVersionHistory={false}
    minimapOpen={false}
    minimapAvailable
    isGenerating={false}
    generationProgress={undefined}
    onZoomOut={vi.fn()}
    onZoomIn={vi.fn()}
    onResetView={vi.fn()}
    onOpenCommandPalette={vi.fn()}
    onCycleGridMode={vi.fn()}
    onToggleConnections={vi.fn()}
    onToggleLayerPanel={vi.fn()}
    onToggleVersionHistory={vi.fn()}
    onToggleMinimap={vi.fn()}
    onOpenEngineDialog={vi.fn()}
    {...overrides}
  />,
);

describe('CanvasZoomCluster', () => {
  it('preserves every command and places the minimap between reset and command palette', () => {
    const { container } = renderCluster();

    expect(screen.getByText('125%')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('button'), button => button.getAttribute('title'))).toEqual([
      '缩小画布',
      '放大画布',
      '重置视图',
      '打开小地图',
      '命令面板 (Ctrl+K / Cmd+K)',
      '网格: 点阵',
      '显示连线',
      '打开图层',
      '版本历史',
      'AI 引擎设置 (放大/去背景/SVG/分层)',
    ]);
  });

  it('projects active panel state and generation progress without owning controller state', () => {
    const { container } = renderCluster({
      showConnections: true,
      showLayerPanel: true,
      showVersionHistory: true,
      minimapOpen: true,
      isGenerating: true,
      generationProgress: { current: 2, total: 4 },
    });

    expect(screen.getByTitle('隐藏连线')).toBeTruthy();
    expect(screen.getByTitle('关闭图层')).toBeTruthy();
    expect(screen.getByTitle('关闭版本历史')).toBeTruthy();
    expect(screen.queryByTitle('关闭小地图')).not.toBeNull();
    expect(Array.from(container.querySelectorAll('div')).some(element => element.style.width === '50%')).toBe(true);
    expect(screen.getByText('生成中')).toBeTruthy();
  });

  it('invokes the parent minimap toggle exactly once', () => {
    const onToggleMinimap = vi.fn();
    renderCluster({ onToggleMinimap });

    const minimap = screen.queryByTitle('打开小地图');
    expect(minimap).not.toBeNull();
    if (!minimap) return;
    fireEvent.click(minimap);

    expect(onToggleMinimap).toHaveBeenCalledTimes(1);
  });

  it('hides the minimap command when the viewport is unavailable', () => {
    renderCluster({ minimapAvailable: false });

    expect(screen.queryByTitle('打开小地图')).toBeNull();
    expect(screen.queryByTitle('关闭小地图')).toBeNull();
    expect(screen.getByTitle('缩小画布')).toBeTruthy();
    expect(screen.getByTitle('放大画布')).toBeTruthy();
    expect(screen.getByTitle('重置视图')).toBeTruthy();
  });
});
