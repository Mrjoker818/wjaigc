import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);
const workspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

describe('managed canvas image deletion wiring', () => {
  it('routes keyboard, context-menu, hover-toolbar, and layer-panel deletes through one coordinator', () => {
    expect(canvasSource).toContain('onDeleteImages?: (imageIds: string[]) => Promise<string[]>');

    const coordinatorStart = canvasSource.indexOf('const requestDeleteImages = useCallback');
    const keyboardStart = canvasSource.indexOf("if (e.code === 'Delete' || e.code === 'Backspace')");
    const contextMenuStart = canvasSource.indexOf("{ label: '删除', shortcut: 'Delete'");
    const hoverToolbarStart = canvasSource.indexOf('title="删除"');
    const layerPanelStart = canvasSource.indexOf('<LayerPanel');

    expect(coordinatorStart).toBeGreaterThan(-1);
    expect(canvasSource.slice(keyboardStart, keyboardStart + 700)).toContain('void requestDeleteImages(');
    expect(canvasSource.slice(contextMenuStart, contextMenuStart + 500)).toContain('void requestDeleteImages(');
    expect(canvasSource.slice(hoverToolbarStart - 650, hoverToolbarStart + 100)).toContain('void requestDeleteImages(');
    expect(canvasSource.slice(layerPanelStart, layerPanelStart + 1800)).toContain('void requestDeleteImages(');
  });

  it('deletes managed placements before removing and immediately persisting canvas images', () => {
    const coordinatorStart = workspaceSource.indexOf('const handleDeleteCanvasImages = useCallback');
    const coordinatorEnd = workspaceSource.indexOf('\n  };', coordinatorStart);
    const coordinator = workspaceSource.slice(coordinatorStart, coordinatorEnd);

    expect(coordinatorStart).toBeGreaterThan(-1);
    expect(coordinator).toContain('reconcileImageBatchDeletion(');
    expect(coordinator).toContain("method: 'DELETE'");
    expect(coordinator.indexOf("method: 'DELETE'")).toBeLessThan(coordinator.indexOf('setImages('));
    expect(coordinator).toContain('persistCanvasImagesNow(remainingImages)');
    expect(coordinator).toContain("if ('error' in result)");
    expect(coordinator).toContain('toast.error(');
    expect(coordinator).toContain('return result.deletedIds');
    expect(coordinator).not.toContain('throw result.error');
    expect(workspaceSource).toContain('onDeleteImages={handleDeleteCanvasImages}');
  });
});
