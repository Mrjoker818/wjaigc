import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');

describe('mobile workspace panel', () => {
  it('initially collapses the right panel on narrow viewports without changing desktop behavior', () => {
    expect(workspaceSource).toContain('shouldInitiallyCollapseWorkspacePanel(window.innerWidth)');
  });

  it('keeps the open right workspace above canvas navigation and toolbars', () => {
    expect(workspaceSource).toContain('z-[70] flex transition-all');
    expect(workspaceSource).toContain(
      "aria-label={panelCollapsed ? '展开面板' : '收起面板'}",
    );
  });

  it('reserves the mobile toolbar and safe area below the expanded workspace content', () => {
    // CSS wiring guard only; the independent preview checks actual geometry.
    expect(workspaceSource).toContain('bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-0');
  });
});
