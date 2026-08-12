import { describe, expect, it } from 'vitest';

import { shouldInitiallyCollapseWorkspacePanel } from '@/lib/workspace-panel-layout';

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
});
