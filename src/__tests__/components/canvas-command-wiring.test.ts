import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const workspace = fs.readFileSync(path.join(root, 'src/components/canvas-workspace.tsx'), 'utf8');
const canvas = fs.readFileSync(path.join(root, 'src/components/infinite-canvas.tsx'), 'utf8');
const incremental = fs.readFileSync(path.join(root, 'src/lib/canvas-incremental-history.ts'), 'utf8');

describe('canvas command and explicit history wiring', () => {
  it('removes the 500ms history guess and uses explicit transaction callbacks', () => {
    expect(workspace).not.toContain('markTimerRef');
    expect(workspace).not.toMatch(/setTimeout\([\s\S]{0,240}incrementalHistoryRef\.current\.mark/);
    expect(workspace).toContain('beginCanvasHistoryTransaction');
    expect(workspace).toContain('commitCanvasHistoryTransaction');
    expect(workspace).toContain('rollbackCanvasHistoryTransaction');
    expect(workspace).toContain('new IncrementalHistoryManager<CanvasImage>(50)');
    expect(workspace).toContain('onHistoryTransactionBegin={beginCanvasHistoryTransaction}');
    expect(workspace).toContain('onHistoryTransactionCommit={commitCanvasHistoryTransaction}');
    expect(workspace).toContain('onHistoryTransactionRollback={rollbackCanvasHistoryTransaction}');
  });

  it('begins on pointerdown, commits on pointerup and rolls back on pointercancel', () => {
    expect(canvas).toContain("beginHistoryTransaction('resize', e.pointerId)");
    expect(canvas).toContain("beginHistoryTransaction('drag', e.pointerId)");
    expect(canvas).toContain("beginHistoryTransaction('group-drag', e.pointerId)");
    expect(canvas).toContain('commitHistoryTransaction(e.pointerId)');
    expect(canvas).toContain('rollbackHistoryTransaction(e.pointerId)');
    expect(canvas.indexOf('rollbackHistoryTransaction(e.pointerId)')).toBeLessThan(canvas.indexOf('finishCanvasPointerGesture(e.pointerId, true)'));
  });

  it('rolls back an unfinished history transaction when the pointer leaves without capture', () => {
    const leaveStart = canvas.indexOf('const handlePointerLeave');
    const wheelStart = canvas.indexOf('const handleWheel', leaveStart);
    const leaveHandler = canvas.slice(leaveStart, wheelStart);

    expect(leaveHandler).toContain('rollbackHistoryTransaction(e.pointerId)');
  });

  it('keeps hydration and task progress out of user history', () => {
    expect(workspace).toContain("type CanvasHistoryIntent = 'record' | 'skip'");
    expect(workspace).toContain("historyIntent === 'skip'");
    expect(workspace).toContain("{ history: 'skip' }");
    expect(workspace).toContain('incrementalHistoryRef.current.clear()');
  });

  it('locks user gestures while placement history is synchronizing', () => {
    expect(workspace).toContain('isHistoryTransitionPending={historyTransitionPending}');
    expect(workspace).toContain('setHistoryTransitionPending(true)');
    expect(workspace).toContain('rebaseCanvasSnapshotChanges(');
    expect(canvas).toContain('isHistoryTransitionPending?: boolean');
    expect(canvas).toContain('if (isHistoryTransitionPending) return;');
    expect(canvas).toContain('if (isHistoryTransitionPending) return []');
    expect(workspace).toContain('queuedCanvasHistoryChangeRef');
    expect(workspace).toContain('flushQueuedCanvasHistoryChange');
    expect(workspace).not.toContain("if (historyLifecyclePendingRef.current && historyIntent === 'record') return;");
  });

  it('invalidates in-flight undo and redo work when the project changes', () => {
    expect(workspace).toContain('historyTransitionEpochRef.current += 1');
    expect(workspace).toContain('activeHistoryTransitionRef.current = null');
    expect(workspace).toContain('isActiveCanvasHistoryTransition(transition)');

    const undoStart = workspace.indexOf('const handleUndo');
    const redoStart = workspace.indexOf('const handleRedo', undoStart);
    const undo = workspace.slice(undoStart, redoStart);
    const redoEnd = workspace.indexOf('const [activeGenerationCount', redoStart);
    const redo = workspace.slice(redoStart, redoEnd);
    expect(undo.match(/isActiveCanvasHistoryTransition\(transition\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(redo.match(/isActiveCanvasHistoryTransition\(transition\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('adds explicit transaction support to the incremental compatibility layer', () => {
    expect(incremental).toContain('beginTransaction(id: string)');
    expect(incremental).toContain('commitTransaction(id: string)');
    expect(incremental).toContain('rollbackTransaction(id: string, currentImages: T[])');
    expect(incremental).toContain('private activeTransactionId: string | null = null');
  });

  it('routes layer reordering through the reorder command', () => {
    const layerPanelStart = canvas.indexOf('<LayerPanel');
    const layerPanel = canvas.slice(layerPanelStart, layerPanelStart + 1800);
    expect(layerPanel).toContain("type: 'reorder'");
    expect(layerPanel).toContain('applyCanvasCommand(images,');
  });

  it('captures generation-group anchors at every membership entry point', () => {
    expect(canvas).toContain('sourcePositions: captureGenerationGroupSourcePositions([firstImage.id], [firstImage])');
    expect(canvas.match(/sourcePositions: \{ \.\.\.g\.sourcePositions, \[image\.id\]: \{ x: image\.x, y: image\.y \} \}/g)?.length).toBe(2);
    expect(canvas).toContain('[imgId]: { x: draggedImg.x, y: draggedImg.y }');
    expect(canvas).toContain('delete newSourcePositions[imageId]');
  });
});
