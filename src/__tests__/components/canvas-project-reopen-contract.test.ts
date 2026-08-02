import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const canvas = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

describe('canvas project reopen contract', () => {
  it('restores saved project viewport state on every project-load path', () => {
    const loadProjectStart = workspace.indexOf('const loadProjectById = useCallback');
    const loadProjectEnd = workspace.indexOf('const [appMode', loadProjectStart);
    const loadProject = workspace.slice(loadProjectStart, loadProjectEnd);

    expect(loadProject).toContain('normalizeCanvasViewState(targetProject.metadata?.viewState)');
    expect(loadProject).toContain('viewStateRef.current = restoredViewState');
  });

  it('persists the viewport state in immediate image-change saves', () => {
    const forceSaveStart = workspace.indexOf('onForceSave={(nextImages) => {');
    const forceSaveEnd = workspace.indexOf('onEditImage={handleEditImage}', forceSaveStart);
    const forceSave = workspace.slice(forceSaveStart, forceSaveEnd);

    expect(forceSave).toContain('viewState: viewStateRef.current');
  });

  it('uses content fitting rather than resetting every populated project to the origin', () => {
    expect(canvas).toContain("import { fitCanvasContent, normalizeCanvasViewState } from '@/lib/canvas-view-state';");
    expect(canvas).toContain('const resetViewToContent = useCallback');
    expect(canvas).toContain('imagesRef.current.filter((image) => !image.isProcessingPlaceholder)');
    expect(canvas).toContain('onClick={resetViewToContent}');
    expect(canvas).not.toContain('onClick={() => { setZoom(1); setViewOffset({ x: 0, y: 0 }); }}');
  });
});
