import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('CanvasWorkspace place-on-canvas', () => {
  it('clears the pending drama film inside the frame so the effect cleanup cannot cancel the insert', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
    const start = source.indexOf("if (appMode !== 'canvas' || !pendingCanvasFilm) return;");
    const effect = source.slice(start, source.indexOf('}, [appMode, pendingCanvasFilm', start));

    const frameStart = effect.indexOf('window.requestAnimationFrame(');
    expect(frameStart).toBeGreaterThan(0);
    expect(effect.indexOf('setPendingCanvasFilm(null)')).toBeGreaterThan(frameStart);
    expect(effect).toContain('handleStoryVideoComposed(film)');
  });
});
