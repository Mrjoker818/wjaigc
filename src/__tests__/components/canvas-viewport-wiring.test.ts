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
    expect(hookSource).toContain('onPanViewportSync?.(active.preview)');
    expect(canvasSource).toContain('onPanViewportSync: handlePanViewportSync');
    expect(hookSource).toContain('shouldSyncCanvasPanViewport');
    expect(hookSource).toContain('resolveCanvasCullingBounds');
  });

  it('begins panning without publishing React viewport state', () => {
    const hookSource = readFileSync(hookPath, 'utf8').replace(/\r\n/g, '\n');
    const beginStart = hookSource.indexOf('const beginPan = useCallback');
    const beginEnd = hookSource.indexOf('const previewPan = useCallback', beginStart);
    const beginSource = hookSource.slice(beginStart, beginEnd);

    expect(beginStart).toBeGreaterThan(-1);
    expect(beginSource).toContain('return true');
    expect(beginSource).not.toContain('publish(');
    expect(beginSource).not.toContain('setPanViewportOffset(');
    expect(beginSource).not.toContain('setLegacyState(');
    expect(beginSource).not.toContain('setKernelState(');
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

  it('clips the viewport without creating an auto-scrollable overflow container', () => {
    const viewportStart = canvasSource.indexOf('data-canvas-viewport');
    const viewportEnd = canvasSource.indexOf('onPointerDown={handlePointerDown}', viewportStart);
    const viewport = canvasSource.slice(viewportStart, viewportEnd);

    expect(viewport).toContain('overflow-clip');
    expect(viewport).not.toContain('overflow-hidden');
  });

  it('clips the workspace shell without allowing mobile edge resize to scroll it', () => {
    expect(workspaceSource).toContain('h-screen w-screen relative overflow-clip');
    expect(workspaceSource).not.toContain('h-screen w-screen relative overflow-hidden');
  });

  it('does not call preventDefault from React passive wheel dispatch', () => {
    const wheelHandlerStart = canvasSource.indexOf('const handleWheel = useCallback');
    const wheelHandlerEnd = canvasSource.indexOf('const handleContextMenu = useCallback', wheelHandlerStart);
    const wheelHandler = canvasSource.slice(wheelHandlerStart, wheelHandlerEnd);

    expect(wheelHandler).not.toContain('preventDefault');
  });
});
