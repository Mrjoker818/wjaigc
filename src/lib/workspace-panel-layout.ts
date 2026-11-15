export const MOBILE_WORKSPACE_PANEL_BREAKPOINT = 768;
export const WORKSPACE_PANEL_RAIL_WIDTH = 44;
export const WORKSPACE_PANEL_MAX_WIDTH = 480;
/** Left toolbar (left-4 + 64px) plus a gap, so an expanded panel never covers it. */
export const WORKSPACE_PANEL_CANVAS_RESERVE = 96;
/** Expanded panel width that leaves the left toolbar reachable on narrow viewports. */
export const WORKSPACE_PANEL_EXPANDED_WIDTH =
  `min(${WORKSPACE_PANEL_MAX_WIDTH}px, calc(100vw - ${WORKSPACE_PANEL_CANVAS_RESERVE}px))`;

export function shouldInitiallyCollapseWorkspacePanel(viewportWidth: number): boolean {
  return viewportWidth < MOBILE_WORKSPACE_PANEL_BREAKPOINT;
}
