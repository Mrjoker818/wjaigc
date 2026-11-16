export const MOBILE_WORKSPACE_PANEL_BREAKPOINT = 768;
export const WORKSPACE_PANEL_RAIL_WIDTH = 44;
export const WORKSPACE_PANEL_MAX_WIDTH = 480;
/**
 * Phones open the expanded panel as a full-width sheet that the rail collapses again.
 * Reserving the left toolbar column there would squeeze it to ~224px at 320px wide.
 */
export const WORKSPACE_PANEL_EXPANDED_WIDTH = `min(${WORKSPACE_PANEL_MAX_WIDTH}px, 100vw)`;

export function shouldInitiallyCollapseWorkspacePanel(viewportWidth: number): boolean {
  return viewportWidth < MOBILE_WORKSPACE_PANEL_BREAKPOINT;
}
