import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const hookPath = resolve(process.cwd(), 'src/components/canvas/use-canvas-viewport.ts');
const workspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('infinite canvas viewport controller wiring', () => {
  it('delegates viewport state and coordinate transforms to the hook', () => {
    expect(canvasSource).toContain("import { useCanvasViewport } from '@/components/canvas/use-canvas-viewport'");
    expect(canvasSource).toContain('useCanvasViewport({');
    expect(canvasSource).toContain('screenToCanvas: viewportScreenToCanvas');
    expect(canvasSource).not.toContain('const [viewOffset, setViewOffset] = useState(');
  });

  it('moves rAF pan preview ownership out of the main canvas component', () => {
    const hookSource = readFileSync(hookPath, 'utf8').replace(/\r\n/g, '\n');

    expect(canvasSource).not.toContain('const panRafRef = useRef<number | null>(null)');
    expect(hookSource).toContain('requestAnimationFrame');
    expect(hookSource).toContain('PAN_VIEWPORT_SYNC_INTERVAL_MS');
    expect(hookSource).toContain('resolveCanvasCullingBounds');
  });

  it('keeps legacy authoritative, compares shadow, and gates canvas-v2', () => {
    const hookSource = readFileSync(hookPath, 'utf8').replace(/\r\n/g, '\n');

    expect(canvasSource).toContain('getCanvasKernelMode()');
    expect(hookSource).toContain("mode === 'canvas-v2'");
    expect(hookSource).toContain("mode === 'shadow'");
    expect(hookSource).toContain("recordCanvasKernelDiff('viewport'");
  });

  it('publishes the fixed workspace occlusion used by browser continuity checks', () => {
    expect(canvasSource).toContain('data-canvas-occupied-right={canvasOccupiedRight}');
    expect(workspaceSource).toContain('data-workspace-right-panel');
  });
});
