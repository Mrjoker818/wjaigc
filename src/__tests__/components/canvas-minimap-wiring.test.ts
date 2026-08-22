import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = resolve(process.cwd(), 'src/components/canvas/CanvasMinimap.tsx');
const clusterPath = resolve(process.cwd(), 'src/components/canvas/CanvasZoomCluster.tsx');
const canvasPath = resolve(process.cwd(), 'src/components/infinite-canvas.tsx');

describe('V588-UI-003 canvas minimap wiring', () => {
  it('requires the minimap leaf and parent/tool-cluster wiring contract', () => {
    expect(existsSync(componentPath)).toBe(true);

    const component = readFileSync(componentPath, 'utf8');
    const cluster = readFileSync(clusterPath, 'utf8');
    const canvas = readFileSync(canvasPath, 'utf8');

    expect(component).toContain('export function CanvasMinimap');
    expect(component).toContain('data-canvas-minimap');
    expect(cluster).toContain('minimapOpen: boolean;');
    expect(cluster).toContain('onToggleMinimap: () => void;');
    expect(cluster).toContain('title={minimapOpen ? \'关闭小地图\' : \'打开小地图\'}');
    expect(canvas).toContain("from '@/components/canvas/CanvasMinimap';");
    expect(canvas).toContain('const [minimapOpen, setMinimapOpen] = useState(false);');
    expect(canvas).toContain('const minimapAvailable = isCanvasMinimapAvailable(');
    expect(canvas).toContain("id: 'toggle-minimap'");
    expect(canvas).toContain('<CanvasMinimap');
    expect(canvas).toContain('setViewOffset({');
  });
});
