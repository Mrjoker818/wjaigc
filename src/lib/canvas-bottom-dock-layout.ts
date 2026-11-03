export type CanvasBottomDockPanel = 'dock' | 'minimap';

export interface CanvasBottomDockLayoutInput {
  viewportHeight: number;
  canvasBottom: number;
  dockTop: number | null;
  toolbarHeight: number;
  minimapHeight: number;
  minimapOpen: boolean;
  dockEditing?: boolean;
  lastOpened: CanvasBottomDockPanel;
}

export interface CanvasBottomDockLayout {
  toolbarBottom: number;
  minimapBottom: number;
  dismissPanel: CanvasBottomDockPanel | null;
}

export function resolveCanvasBottomDockLayout({
  viewportHeight,
  canvasBottom,
  dockTop,
  toolbarHeight,
  minimapHeight,
  minimapOpen,
  dockEditing = false,
  lastOpened,
}: CanvasBottomDockLayoutInput): CanvasBottomDockLayout {
  const normal: CanvasBottomDockLayout = {
    toolbarBottom: 20,
    minimapBottom: 76,
    dismissPanel: null,
  };
  if (dockTop === null) return normal;
  if (![viewportHeight, canvasBottom, dockTop, toolbarHeight, minimapHeight].every(Number.isFinite)
    || viewportHeight <= 0 || toolbarHeight < 0 || minimapHeight < 0) return normal;

  const toolbarBottom = Math.max(20, canvasBottom - dockTop + 28);
  const minimapBottom = Math.max(0, viewportHeight - dockTop + 28);
  const toolbarTop = canvasBottom - toolbarBottom - toolbarHeight;
  const mapBottom = Math.max(minimapBottom, viewportHeight - toolbarTop + 8);
  const hasRoomForBoth = viewportHeight - mapBottom - minimapHeight >= 16;

  return {
    toolbarBottom,
    minimapBottom,
    dismissPanel: minimapOpen && !hasRoomForBoth
      ? !dockEditing && lastOpened === 'minimap' ? 'dock' : 'minimap'
      : null,
  };
}
