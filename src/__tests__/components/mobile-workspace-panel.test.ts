import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageSource = readFileSync(resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
const nodeSource = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');

describe('mobile workspace panel and node controls', () => {
  it('keeps the open right workspace above canvas navigation and toolbars', () => {
    expect(pageSource).toContain('z-[70] flex transition-all');
    expect(pageSource).toContain('aria-label={panelCollapsed ? \'展开面板\' : \'收起面板\'}');
  });

  it('does not render an inert node property header button', () => {
    expect(nodeSource).not.toContain('节点属性</span>\n          <button className="text-muted-foreground hover:text-foreground cursor-pointer"><Maximize2 size={12} /></button>');
  });
});
