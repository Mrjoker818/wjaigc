export const MOBILE_WORKSPACE_PANEL_BREAKPOINT = 768;

export function shouldInitiallyCollapseWorkspacePanel(viewportWidth: number): boolean {
  return viewportWidth < MOBILE_WORKSPACE_PANEL_BREAKPOINT;
}
