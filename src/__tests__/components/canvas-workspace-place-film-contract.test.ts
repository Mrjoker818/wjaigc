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

  it('places a drama image the same way, and says so when the canvas already shows it', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
    const start = source.indexOf("if (appMode !== 'canvas' || !pendingCanvasImage) return;");
    const effect = source.slice(start, source.indexOf('}, [appMode, pendingCanvasImage', start));

    const frameStart = effect.indexOf('window.requestAnimationFrame(');
    expect(frameStart).toBeGreaterThan(0);
    expect(effect.indexOf('setPendingCanvasImage(null)')).toBeGreaterThan(frameStart);
    expect(effect).toContain('handleAddImages([image.url])');
    expect(effect).toContain('画布上已经有这张图');
    // handleAddImages reports the insert itself; only a failure gets a toast here.
    expect(effect).not.toContain('toast.success');
  });

  it('offers placing only while a canvas project is loaded, and loads the drama\'s project when none is', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
    expect(source).toContain('onOpenDramaProject={setDramaProjectId}');
    expect(source).toContain("onPlaceImageOnCanvas={currentProject ? image => { setPendingCanvasImage(image); setAppMode('canvas'); } : undefined}");
    expect(source).toContain("onPlaceOnCanvas={currentProject ? film => { setPendingCanvasFilm(film); setAppMode('canvas'); } : undefined}");
    expect(source).toContain('void loadProjectById(dramaProjectId)');
  });
});
