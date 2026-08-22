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
    renderCluster();

    expect(screen.getByText('125%')).toBeTruthy();
    expect(screen.getByTitle('缩小画布')).toBeTruthy();
    expect(screen.getByTitle('放大画布')).toBeTruthy();
    const resetView = screen.getByTitle('重置视图');
    const minimap = screen.queryByTitle('打开小地图');
    expect(minimap).not.toBeNull();
    if (!minimap) return;
    const commandPalette = screen.getByTitle('命令面板 (Ctrl+K / Cmd+K)');
    expect(resetView.nextElementSibling).toBe(minimap);
    expect(minimap.nextElementSibling).toBe(commandPalette);
    expect(screen.getByTitle('网格: 点阵')).toBeTruthy();
    expect(screen.getByTitle('显示连线')).toBeTruthy();
    expect(screen.getByTitle('打开图层')).toBeTruthy();
    expect(screen.getByTitle('版本历史')).toBeTruthy();
    expect(screen.getByTitle('AI 引擎设置 (放大/去背景/SVG/分层)')).toBeTruthy();
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
