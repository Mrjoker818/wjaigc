export interface FloatingPanelPositionInput {
  viewportWidth: number;
  viewportHeight: number;
  panelWidth: number;
  panelHeight: number;
  margin?: number;
}

export interface FloatingPanelPosition {
  x: number;
  y: number;
}

export function getCenteredFloatingPanelPosition({
  viewportWidth,
  viewportHeight,
  panelWidth,
  panelHeight,
  margin = 16,
}: FloatingPanelPositionInput): FloatingPanelPosition {
  const safeMargin = Math.max(0, margin);
  const visibleWidth = Math.max(0, viewportWidth - safeMargin * 2);
  const visibleHeight = Math.max(0, viewportHeight - safeMargin * 2);
  const effectiveWidth = Math.min(panelWidth, visibleWidth);
  const effectiveHeight = Math.min(panelHeight, visibleHeight);

  return {
    x: Math.max(safeMargin, Math.round((viewportWidth - effectiveWidth) / 2)),
    y: Math.max(safeMargin, Math.round((viewportHeight - effectiveHeight) / 2)),
  };
}
