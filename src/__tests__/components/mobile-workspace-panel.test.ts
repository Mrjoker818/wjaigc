import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const nodeSource = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');

describe('mobile workspace panel and node controls', () => {
  it('initially collapses the right panel on narrow viewports without changing desktop behavior', () => {
    expect(workspaceSource).toContain('shouldInitiallyCollapseWorkspacePanel(window.innerWidth)');
  });

  it('keeps the open right workspace above canvas navigation and toolbars', () => {
    expect(workspaceSource).toContain('z-[70] flex transition-all');
    expect(workspaceSource).toContain(
      "aria-label={panelCollapsed ? '展开面板' : '收起面板'}",
    );
  });

  it('does not render an inert node property header button', () => {
    expect(nodeSource).not.toContain('节点属性</span>\n          <button className="text-muted-foreground hover:text-foreground cursor-pointer"><Maximize2 size={12} /></button>');
  });

  it('opens selected node properties as a closable overlay on narrow viewports', () => {
    expect(nodeSource).toContain("selectedNode ? 'absolute inset-y-0 right-0 z-50 flex");
    expect(nodeSource).toContain('aria-label="关闭节点属性"');
    expect(nodeSource).toContain('md:relative md:inset-auto md:z-auto md:flex md:w-72');
  });
});
