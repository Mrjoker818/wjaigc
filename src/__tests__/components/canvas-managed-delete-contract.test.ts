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
    expect(canvasSource).toContain('pendingDeleteIdsRef');
    expect(canvasSource).toContain('filter((id) => !pendingDeleteIdsRef.current.has(id))');

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
    const coordinatorEnd = workspaceSource.indexOf('\n  const initialCanvasAnnotations', coordinatorStart);
    const coordinator = workspaceSource.slice(coordinatorStart, coordinatorEnd);

    expect(coordinatorStart).toBeGreaterThan(-1);
    expect(coordinator).toContain('reconcileImageBatchDeletion(');
    expect(coordinator).toContain("type: 'delete'");
    expect(coordinator).toContain('executeCanvasCommand(');
    expect(coordinator.indexOf('deletedIds = result.deletedIds')).toBeLessThan(coordinator.indexOf('setImages(remainingImages)'));
    expect(workspaceSource).toContain('pendingCanvasDeleteIdsRef');
    expect(coordinator).toContain('.filter((id) => !pendingCanvasDeleteIdsRef.current.has(id))');
    expect(coordinator).toContain("method: 'DELETE'");
    expect(coordinator.indexOf("method: 'DELETE'")).toBeLessThan(coordinator.indexOf('setImages('));
    expect(coordinator).toContain('persistCanvasImagesNow(remainingImages)');
    expect(coordinator).not.toContain('await UserManagerCore.getInstance().flushProjectsToServer()');
    expect(coordinator).toContain("if ('error' in result)");
    expect(coordinator).toContain('toast.error(');
    expect(coordinator).toContain('return result.deletedIds');
    expect(coordinator).toContain('let deletedIds: string[] = []');
    expect(coordinator).toContain('deletedIds = result.deletedIds');
    expect(coordinator).toMatch(/catch \(error\)[\s\S]*return deletedIds;/);
    expect(coordinator).toContain('finally {');
    expect(coordinator).toContain('uniqueImageIds.forEach((id) => pendingCanvasDeleteIdsRef.current.delete(id));');
    expect(coordinator).not.toContain('throw result.error');
    expect(workspaceSource).toContain('onDeleteImages={handleDeleteCanvasImages}');
  });

  it('reconciles managed placement lifecycle before committing asset-v3 undo and redo', () => {
    const lifecycleStart = workspaceSource.indexOf('const syncAssetV3HistoryTransition = useCallback');
    const undoStart = workspaceSource.indexOf('const handleUndo = useCallback');
    const redoStart = workspaceSource.indexOf('const handleRedo = useCallback');
    const lifecycle = workspaceSource.slice(lifecycleStart, undoStart);
    const undo = workspaceSource.slice(undoStart, redoStart);
    const redo = workspaceSource.slice(redoStart, workspaceSource.indexOf('const [activeGenerationCount', redoStart));

    expect(lifecycle).toContain('await reconcileManagedPlacementHistoryTransition(');
    expect(lifecycle).toContain('canvasImages: serializeCanvasWorkspacePlacements([...items])');
    expect(lifecycle).toContain('commitSnapshot,');
    expect(lifecycle).toContain('clearRecentlyDeletedImageIds(restoredIds)');
    expect(undo).toContain("getAssetGraphMode() === 'asset-v3'");
    expect(undo).toContain('await syncAssetV3HistoryTransition(previous, result)');
    expect(undo.indexOf('await syncAssetV3HistoryTransition(previous, result)')).toBeLessThan(undo.indexOf('setImagesRaw(committed)'));

    expect(redo).toContain("getAssetGraphMode() === 'asset-v3'");
    expect(redo).toContain('await syncAssetV3HistoryTransition(previous, result)');
    expect(redo.indexOf('await syncAssetV3HistoryTransition(previous, result)')).toBeLessThan(redo.indexOf('setImagesRaw(committed)'));
  });
});
