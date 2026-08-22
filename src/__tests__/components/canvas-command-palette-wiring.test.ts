import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = resolve(process.cwd(), 'src/components/canvas/CanvasCommandPalette.tsx');
const zoomClusterPath = resolve(process.cwd(), 'src/components/canvas/CanvasZoomCluster.tsx');
const canvasPath = resolve(process.cwd(), 'src/components/infinite-canvas.tsx');

describe('V588-UI-002 command palette wiring', () => {
  it('introduces a leaf command palette without replacing the current canvas controller', () => {
    expect(existsSync(componentPath)).toBe(true);

    const component = readFileSync(componentPath, 'utf8');
    const zoomCluster = readFileSync(zoomClusterPath, 'utf8');
    const canvas = readFileSync(canvasPath, 'utf8');

    expect(component).toContain('export function CanvasCommandPalette');
    expect(component).toContain('export function filterCanvasCommands');
    expect(zoomCluster).toContain('onOpenCommandPalette: () => void;');
    expect(zoomCluster).toContain('title="命令面板 (Ctrl+K / Cmd+K)"');
    expect(canvas).toContain("from '@/components/canvas/CanvasCommandPalette';");
    expect(canvas).toContain('shouldToggleCanvasCommandPalette');
    expect(canvas).toContain('const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);');
    expect(canvas).toContain('if (shouldToggleCanvasCommandPalette(e))');
    expect(canvas).toContain('<CanvasCommandPalette');
    expect(canvas).toContain('activateCanvasToolSession');
    expect(canvas).toContain('closeCanvasToolPanels');
  });
});
