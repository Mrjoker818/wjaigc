import { describe, expect, it } from 'vitest';

import { WORKSPACE_PANEL_EXPANDED_WIDTH, shouldInitiallyCollapseWorkspacePanel } from '@/lib/workspace-panel-layout';

describe('workspace panel layout', () => {
  it('keeps the canvas operable by initially collapsing the panel on phone viewports', () => {
    expect(shouldInitiallyCollapseWorkspacePanel(320)).toBe(true);
    expect(shouldInitiallyCollapseWorkspacePanel(412)).toBe(true);
    expect(shouldInitiallyCollapseWorkspacePanel(767)).toBe(true);
  });

  it('preserves the existing expanded desktop workspace', () => {
    expect(shouldInitiallyCollapseWorkspacePanel(768)).toBe(false);
    expect(shouldInitiallyCollapseWorkspacePanel(1920)).toBe(false);
  });

  it('keeps the left toolbar clear of an expanded panel on narrow viewports', () => {
    // The left toolbar spans 16px + 64px; the panel must leave that column uncovered.
    expect(WORKSPACE_PANEL_EXPANDED_WIDTH).toBe('min(480px, calc(100vw - 96px))');
  });
});
