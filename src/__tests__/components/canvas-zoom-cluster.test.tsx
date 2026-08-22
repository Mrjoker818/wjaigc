import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CanvasZoomCluster } from '@/components/canvas/CanvasZoomCluster';

const renderCluster = (overrides: Partial<Parameters<typeof CanvasZoomCluster>[0]> = {}) => renderToStaticMarkup(createElement(
  CanvasZoomCluster,
  {
    zoom: 1.25,
    isMonochrome: false,
    iconClasses: { zoomIn: 'zoom-in-theme', zoomOut: 'zoom-out-theme' },
    separatorClassName: 'separator-theme',
    gridMode: 'dots',
    showConnections: false,
    showLayerPanel: false,
    showVersionHistory: false,
    minimapOpen: false,
    minimapAvailable: true,
    isGenerating: false,
    generationProgress: undefined,
    onZoomOut: vi.fn(),
    onZoomIn: vi.fn(),
    onResetView: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onCycleGridMode: vi.fn(),
    onToggleConnections: vi.fn(),
    onToggleLayerPanel: vi.fn(),
    onToggleVersionHistory: vi.fn(),
    onToggleMinimap: vi.fn(),
    onOpenEngineDialog: vi.fn(),
    ...overrides,
  },
));

describe('CanvasZoomCluster', () => {
  it('preserves every current auxiliary-toolbar command and zoom readout', () => {
    const markup = renderCluster();

    expect(markup).toContain('125%');
    expect(markup).toContain('title="缩小画布"');
    expect(markup).toContain('title="放大画布"');
    expect(markup).toContain('title="重置视图"');
    expect(markup).toContain('title="命令面板 (Ctrl+K / Cmd+K)"');
    expect(markup).toContain('title="网格: 点阵"');
    expect(markup).toContain('title="显示连线"');
    expect(markup).toContain('title="打开图层"');
    expect(markup).toContain('title="版本历史"');
    expect(markup).toContain('title="打开小地图"');
    expect(markup).toContain('title="AI 引擎设置 (放大/去背景/SVG/分层)"');
  });

  it('projects active panel state and generation progress without owning controller state', () => {
    const markup = renderCluster({
      showConnections: true,
      showLayerPanel: true,
      showVersionHistory: true,
      isGenerating: true,
      generationProgress: { current: 2, total: 4 },
    });

    expect(markup).toContain('title="隐藏连线"');
    expect(markup).toContain('title="关闭图层"');
    expect(markup).toContain('title="关闭版本历史"');
    expect(renderCluster({ minimapOpen: true })).toContain('title="关闭小地图"');
    expect(markup).toContain('width:50%');
    expect(markup).toContain('生成中');
  });

  it('hides the minimap command when the viewport is unavailable', () => {
    const markup = renderCluster({ minimapAvailable: false });

    expect(markup).not.toContain('小地图');
    expect(markup).toContain('title="缩小画布"');
    expect(markup).toContain('title="放大画布"');
    expect(markup).toContain('title="重置视图"');
  });
});
