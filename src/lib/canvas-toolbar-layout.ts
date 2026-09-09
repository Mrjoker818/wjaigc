export interface ToolbarRect { left: number; top: number; width: number; height: number; }

export interface BottomToolbarDrawerPlacementInput {
  viewport: { width: number; height: number };
  trigger: ToolbarRect;
  drawer: { width: number; height: number };
  occupiedRight?: number;
  minWidth?: number;
  margin?: number;
  gap?: number;
}

export interface BottomToolbarDrawerPlacement {
  left: number;
  top: number;
  bottom?: number;
  width: number;
  height: number;
  side: 'above-center' | 'above-left' | 'above-right' | 'below-center' | 'below-left' | 'below-right';
}

export type CanvasToolHostPlacement = 'none' | 'floating' | 'bottom-drawer' | 'canvas-overlay';

interface ToolbarTransitionFrameOptions {
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
}

export function trackToolbarTransitionFrames(
  target: EventTarget,
  measure: () => void,
  options: ToolbarTransitionFrameOptions = {},
): () => void {
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  let frameId: number | undefined;

  const stopFrames = (): void => {
    if (frameId === undefined) return;
    cancelFrame(frameId);
    frameId = undefined;
  };
  const measureFrame: FrameRequestCallback = () => {
    measure();
    frameId = requestFrame(measureFrame);
  };
  const isToolbarPositionTransition = (event: Event): boolean => {
    const propertyName = 'propertyName' in event ? String(event.propertyName) : '';
    return propertyName === '' || propertyName === 'all' || propertyName === 'bottom';
  };
  const handleTransitionRun = (event: Event): void => {
    if (!isToolbarPositionTransition(event)) return;
    if (frameId !== undefined) return;
    measure();
    frameId = requestFrame(measureFrame);
  };
  const handleTransitionComplete = (event: Event): void => {
    if (!isToolbarPositionTransition(event)) return;
    stopFrames();
    measure();
  };

  target.addEventListener('transitionrun', handleTransitionRun);
  target.addEventListener('transitionend', handleTransitionComplete);
  target.addEventListener('transitioncancel', handleTransitionComplete);
  return () => {
    stopFrames();
    target.removeEventListener('transitionrun', handleTransitionRun);
    target.removeEventListener('transitionend', handleTransitionComplete);
    target.removeEventListener('transitioncancel', handleTransitionComplete);
  };
}

export function getCanvasToolHostPlacementClassName(
  placement: CanvasToolHostPlacement,
): string {
  switch (placement) {
    case 'floating':
      return 'fixed inset-0 z-[205] pointer-events-none';
    case 'canvas-overlay':
      return 'absolute inset-0 z-[205] pointer-events-none';
    case 'bottom-drawer':
    case 'none':
      return 'contents';
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

function horizontalAnchor(left: number, width: number, triggerCenter: number): 'left' | 'center' | 'right' {
  const drawerCenter = left + width / 2;
  if (Math.abs(drawerCenter - triggerCenter) <= 8) return 'center';
  return drawerCenter < triggerCenter ? 'left' : 'right';
}

export function getBottomToolbarDrawerPlacement({ viewport, trigger, drawer, occupiedRight = 0, minWidth = 0, margin = 8, gap = 8 }: BottomToolbarDrawerPlacementInput): BottomToolbarDrawerPlacement {
  const safeMinWidth = Math.max(0, Math.min(minWidth, viewport.width - margin * 2));
  const maxReservedRight = Math.max(0, viewport.width - margin * 2 - safeMinWidth);
  const effectiveOccupiedRight = Math.min(Math.max(0, occupiedRight), maxReservedRight);
  const availableRight = Math.max(margin + safeMinWidth, viewport.width - effectiveOccupiedRight - margin);
  const availableWidth = Math.max(0, availableRight - margin);
  const availableHeight = Math.max(0, viewport.height - margin * 2);
  const width = Math.min(drawer.width, Math.max(safeMinWidth, availableWidth));
  const height = Math.min(drawer.height, availableHeight);
  const triggerCenter = trigger.left + trigger.width / 2;
  const preferredLeft = triggerCenter - width / 2;
  const maxLeft = Math.max(margin, availableRight - width);
  const left = Math.round(clamp(preferredLeft, margin, maxLeft));
  const aboveTop = trigger.top - gap - height;
  const useAbove = aboveTop >= margin || trigger.top > viewport.height / 2;
  const topCandidate = useAbove ? aboveTop : trigger.top + trigger.height + gap;
  return {
    left,
    top: Math.round(clamp(topCandidate, margin, viewport.height - margin - height)),
    bottom: useAbove ? viewport.height - trigger.top + gap : undefined,
    width: Math.round(width),
    height: Math.round(height),
    side: `${useAbove ? 'above' : 'below'}-${horizontalAnchor(left, width, triggerCenter)}` as BottomToolbarDrawerPlacement['side'],
  };
}
