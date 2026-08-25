export interface SimpleChatMenuRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SimpleChatMenuViewport {
  width: number;
  height: number;
}

export interface SimpleChatModelMenuLayout {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const MENU_GUTTER = 12;
const MENU_GAP = 4;
const MENU_WIDTH = 320;
const MENU_MAX_HEIGHT = 384;
const MENU_MIN_HEIGHT = 160;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function resolveSimpleChatModelMenuLayout(
  trigger: SimpleChatMenuRect,
  viewport: SimpleChatMenuViewport,
): SimpleChatModelMenuLayout {
  const width = Math.max(0, Math.min(MENU_WIDTH, viewport.width - (MENU_GUTTER * 2)));
  const maximumViewportLeft = Math.max(MENU_GUTTER, viewport.width - MENU_GUTTER - width);
  const viewportLeft = clamp(trigger.right - width, MENU_GUTTER, maximumViewportLeft);
  const availableBelow = Math.max(0, viewport.height - trigger.bottom - MENU_GAP - MENU_GUTTER);
  const availableAbove = Math.max(0, trigger.top - MENU_GAP - MENU_GUTTER);
  const openBelow = availableBelow >= Math.min(MENU_MIN_HEIGHT, MENU_MAX_HEIGHT)
    || availableBelow >= availableAbove;
  const maxHeight = Math.min(MENU_MAX_HEIGHT, openBelow ? availableBelow : availableAbove);

  return {
    left: viewportLeft - trigger.left,
    top: openBelow ? trigger.height + MENU_GAP : -(maxHeight + MENU_GAP),
    width,
    maxHeight,
  };
}
