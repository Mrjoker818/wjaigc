import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

describe('human repair entry wiring', () => {
  it('exposes the panel from the selected image toolbar, context menu and bottom toolbar', () => {
    expect(source).toContain("lazy(() => import('@/components/human-repair-panel'))");
    expect(source).toContain("label: '人物精修大师'");
    expect(source).toContain("aria-label=\"人物精修大师\"");
    expect(source).toContain('<HumanRepairPanel');
  });
});
