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

export interface FloatingPanelViewport {
  width: number;
  height: number;
  left: number;
  top: number;
}

export function getFloatingPanelViewport(): FloatingPanelViewport {
  if (typeof window === 'undefined') return { width: 1056, height: 776, left: 0, top: 0 };
  const viewport = window.visualViewport;
  return viewport
    ? { width: viewport.width, height: viewport.height, left: viewport.offsetLeft, top: viewport.offsetTop }
    : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
}

export function subscribeFloatingPanelViewport(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const target = window;
  const viewport = target.visualViewport;
  target.addEventListener('resize', listener);
  viewport?.addEventListener('resize', listener);
  viewport?.addEventListener('scroll', listener);
  return () => {
    target.removeEventListener('resize', listener);
    viewport?.removeEventListener('resize', listener);
    viewport?.removeEventListener('scroll', listener);
  };
}

export interface ConstrainFloatingPanelPositionInput extends FloatingPanelPositionInput {
  x: number;
  y: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function constrainFloatingPanelPosition({
  x,
  y,
  viewportWidth,
  viewportHeight,
  panelWidth,
  panelHeight,
  margin = 16,
}: ConstrainFloatingPanelPositionInput): FloatingPanelPosition {
  const safeMargin = Math.max(0, margin);
  const visibleWidth = Math.max(0, viewportWidth - safeMargin * 2);
  const visibleHeight = Math.max(0, viewportHeight - safeMargin * 2);
  const effectiveWidth = Math.min(Math.max(0, panelWidth), visibleWidth);
  const effectiveHeight = Math.min(Math.max(0, panelHeight), visibleHeight);
  const maximumX = Math.max(safeMargin, viewportWidth - safeMargin - effectiveWidth);
  const maximumY = Math.max(safeMargin, viewportHeight - safeMargin - effectiveHeight);

  return {
    x: clamp(x, safeMargin, maximumX),
    y: clamp(y, safeMargin, maximumY),
  };
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
