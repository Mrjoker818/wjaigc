export interface ToolbarRect { left: number; top: number; width: number; height: number; }

export interface BottomToolbarDrawerPlacementInput {
  viewport: { width: number; height: number };
  trigger: ToolbarRect;
  drawer: { width: number; height: number };
  occupiedRight?: number;
  margin?: number;
  gap?: number;
}

export interface BottomToolbarDrawerPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  side: 'above-left' | 'above-right' | 'below-left' | 'below-right';
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function getBottomToolbarDrawerPlacement({ viewport, trigger, drawer, occupiedRight = 0, margin = 8, gap = 8 }: BottomToolbarDrawerPlacementInput): BottomToolbarDrawerPlacement {
  const availableRight = Math.max(margin, viewport.width - Math.max(0, occupiedRight) - margin);
  const availableWidth = Math.max(0, availableRight - margin);
  const availableHeight = Math.max(0, viewport.height - margin * 2);
  const width = Math.min(drawer.width, availableWidth);
  const height = Math.min(drawer.height, availableHeight);
  const preferLeft = trigger.left + trigger.width > availableRight / 2;
  const leftCandidate = preferLeft ? trigger.left + trigger.width - width : trigger.left;
  const aboveTop = trigger.top - gap - height;
  const useAbove = aboveTop >= margin || trigger.top > viewport.height / 2;
  const topCandidate = useAbove ? aboveTop : trigger.top + trigger.height + gap;
  return {
    left: Math.round(clamp(leftCandidate, margin, availableRight - width)),
    top: Math.round(clamp(topCandidate, margin, viewport.height - margin - height)),
    width: Math.round(width),
    height: Math.round(height),
    side: `${useAbove ? 'above' : 'below'}-${preferLeft ? 'left' : 'right'}` as BottomToolbarDrawerPlacement['side'],
  };
}
