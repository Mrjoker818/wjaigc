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

  it('keeps resize pointer ownership until the history transaction commits', () => {
    const resizeStart = canvas.indexOf('// Check resize handle');
    const resizeEnd = canvas.indexOf('// Pointer-down routing must follow', resizeStart);
    const resizeBranch = canvas.slice(resizeStart, resizeEnd);
    expect(resizeBranch).toContain('e.currentTarget.setPointerCapture(e.pointerId)');

    const pointerLeaveStart = canvas.indexOf('const handlePointerLeave');
    const pointerLeaveEnd = canvas.indexOf('const handleWheel', pointerLeaveStart);
    const pointerLeave = canvas.slice(pointerLeaveStart, pointerLeaveEnd);
    expect(pointerLeave).toContain('if (e.currentTarget.hasPointerCapture(e.pointerId)) return;');
  });

  it('routes keyboard Space and the hand tool through pan before React state commits', () => {
    expect(canvas).toContain('const isSpacePressedRef = useRef(false)');
    expect(canvas).toContain("const activePointerToolRef = useRef<'select' | 'hand'>('select')");
    expect(canvas).toContain('beginCanvasSpacePan(e, inputFocused, isSpacePressedRef, canvasContainerRef.current)');
    expect(canvas).toContain('resetCanvasSpacePan(isSpacePressedRef, canvasContainerRef.current)');

    const pointerDownStart = canvas.indexOf('const handlePointerDown');
    const pointerMoveStart = canvas.indexOf('const handlePointerMove', pointerDownStart);
    const pointerDown = canvas.slice(pointerDownStart, pointerMoveStart);
    expect(pointerDown).toContain("if (activePointerToolRef.current === 'hand' || isSpacePressedRef.current)");
    expect(pointerDown.indexOf("if (activePointerToolRef.current === 'hand' || isSpacePressedRef.current)")).toBeLessThan(pointerDown.indexOf('// Check resize handle'));
  });

  it('routes active viewport pan before canvas coordinate conversion', () => {
    const pointerMoveStart = canvas.indexOf('const handlePointerMove');
    const pointerUpStart = canvas.indexOf('const handlePointerUp', pointerMoveStart);
    const pointerMove = canvas.slice(pointerMoveStart, pointerUpStart);
    const editModeBranch = pointerMove.indexOf("if (editMode !== 'none')");
    const coordinateConversion = pointerMove.indexOf('const canvasPos = screenToCanvas', editModeBranch);
    const middlePan = pointerMove.indexOf(
      'isMiddlePanning && viewportPanPointerIdRef.current === e.pointerId',
      editModeBranch,
    );
    const viewportPan = pointerMove.indexOf(
      '&& (isPanning || directPanPointerIdRef.current === e.pointerId)',
      middlePan,
    );

    expect(pointerMoveStart).toBeGreaterThan(-1);
    expect(editModeBranch).toBeGreaterThan(-1);
    expect(coordinateConversion).toBeGreaterThan(-1);
    expect(middlePan).toBeGreaterThan(-1);
    expect(viewportPan).toBeGreaterThan(-1);
    expect(middlePan).toBeLessThan(coordinateConversion);
    expect(viewportPan).toBeLessThan(coordinateConversion);
  });

  it('keeps a standard Space or hand-tool pan off React state until culling must synchronize', () => {
    const pointerDownStart = canvas.indexOf('const handlePointerDown');
    const pointerMoveStart = canvas.indexOf('const handlePointerMove', pointerDownStart);
    const pointerDown = canvas.slice(pointerDownStart, pointerMoveStart);
    const directPanStart = pointerDown.indexOf("if (activePointerToolRef.current === 'hand' || isSpacePressedRef.current)");
    const directPanEnd = pointerDown.indexOf('// Check resize handle', directPanStart);
    const directPan = pointerDown.slice(directPanStart, directPanEnd);
    const pointerMoveEnd = canvas.indexOf('const handlePointerUp', pointerMoveStart);
    const pointerMove = canvas.slice(pointerMoveStart, pointerMoveEnd);
    const pointerUpEnd = canvas.indexOf('const handlePointerCancel', pointerMoveEnd);
    const pointerUp = canvas.slice(pointerMoveEnd, pointerUpEnd);
    const directPanUpStart = pointerUp.indexOf(
      '&& (isPanning || directPanPointerIdRef.current === e.pointerId)',
    );
    const directPanUpEnd = pointerUp.indexOf('const activeBoxPreview', directPanUpStart);
    const directPanUp = pointerUp.slice(directPanUpStart, directPanUpEnd);

    expect(directPanStart).toBeGreaterThan(-1);
    expect(directPan).toContain('if (beginViewportPan(');
    expect(directPan).toContain('directPanPointerIdRef.current = e.pointerId');
    expect(directPan).toContain('e.currentTarget.setPointerCapture(e.pointerId)');
    expect(directPan).not.toContain('setIsPanning(true)');
    expect(pointerMove).toContain('directPanPointerIdRef.current === e.pointerId');
    expect(pointerUp).not.toContain('if (isPanning || directPanPointerIdRef.current === e.pointerId)');
    expect(pointerUp).toContain('viewportPanPointerIdRef.current === e.pointerId');
    expect(pointerUp).toContain('&& (isPanning || directPanPointerIdRef.current === e.pointerId)');
    expect(directPanUpStart).toBeGreaterThan(-1);
    expect(directPanUp).toContain('e.currentTarget.releasePointerCapture(e.pointerId)');
    expect(directPanUp).toContain('directPanPointerIdRef.current = null');
  });

  it('keeps temporary Space-pan feedback out of parent React state', () => {
    const keyDown = canvas.slice(
      canvas.indexOf('beginCanvasSpacePan(e, inputFocused'),
      canvas.indexOf("if (e.code === 'Escape')"),
    );
    const keyUp = canvas.slice(
      canvas.indexOf('const handleKeyUp'),
      canvas.indexOf('// Paste event:', canvas.indexOf('const handleKeyUp')),
    );

    expect(canvas).not.toContain('const [isSpacePressed, setIsSpacePressed]');
    expect(keyDown).toContain('beginCanvasSpacePan(e, inputFocused, isSpacePressedRef, canvasContainerRef.current)');
    expect(keyUp).toContain('resetCanvasSpacePan(isSpacePressedRef, canvasContainerRef.current)');
    expect(keyDown).not.toContain('setIsSpacePressed');
    expect(keyUp).not.toContain('setIsSpacePressed');
    expect(canvas).toContain('data-[space-pan=true]:!cursor-grab');
  });

  it('clears temporary Space-pan state on blur, page hiding and component cleanup', () => {
    const stableListenersStart = canvas.indexOf('// Stable Canvas keyboard listeners');
    const stableListenersEnd = canvas.indexOf('// Click outside to close menus', stableListenersStart);
    const stableListeners = canvas.slice(stableListenersStart, stableListenersEnd);

    expect(canvas).toContain('beginCanvasSpacePan(e, inputFocused, isSpacePressedRef, canvasContainerRef.current)');
    expect(canvas).toContain('resetCanvasSpacePan(isSpacePressedRef, canvasContainerRef.current)');
    expect(stableListeners).toContain("window.addEventListener('blur', stableResetSpacePan)");
    expect(stableListeners).toContain("document.addEventListener('visibilitychange', stableHandleVisibilityChange)");
    expect(stableListeners).toContain("window.removeEventListener('blur', stableResetSpacePan)");
    expect(stableListeners).toContain("document.removeEventListener('visibilitychange', stableHandleVisibilityChange)");
    expect(stableListeners).toMatch(/return \(\) => \{[\s\S]*stableResetSpacePan\(\);/);
  });

  it('does not hijack Space from focused toolbar controls', () => {
    const inputHelperStart = canvas.indexOf('const isInputFocused');
    const inputHelperEnd = canvas.indexOf('// Helper: check if a native event originates', inputHelperStart);
    const inputHelper = canvas.slice(inputHelperStart, inputHelperEnd);
    expect(inputHelper).toContain('button');
    expect(inputHelper).toContain('select');

    const helperStart = canvas.indexOf('const isKeyboardEventFromOverlay');
    const helperEnd = canvas.indexOf('// Sync selectedImage prop', helperStart);
    const keyboardOverlayHelper = canvas.slice(helperStart, helperEnd);
    expect(helperStart).toBeGreaterThan(-1);
    expect(keyboardOverlayHelper).not.toContain('[data-toolbar]');

    const keyboardEffectStart = canvas.indexOf('// Keyboard events');
    const keyboardEffectEnd = canvas.indexOf('// Click outside to close menus', keyboardEffectStart);
    const keyboardEffect = canvas.slice(keyboardEffectStart, keyboardEffectEnd);
    expect(keyboardEffect).toContain('if (isKeyboardEventFromOverlay(e)) return;');
  });

  it('routes undo and redo through the authoritative workspace lock before the render-state guard', () => {
    const keyboardEffectStart = canvas.indexOf('// Keyboard events');
    const keyboardEffectEnd = canvas.indexOf('// Click outside to close menus', keyboardEffectStart);
    const keyboardEffect = canvas.slice(keyboardEffectStart, keyboardEffectEnd);
    const undoShortcut = keyboardEffect.indexOf("e.code === 'KeyZ' && !e.shiftKey");
    const redoShortcut = keyboardEffect.indexOf("e.code === 'KeyZ' && e.shiftKey");
    const renderStateGuard = keyboardEffect.indexOf('if (isHistoryTransitionPending) return;');

    expect(undoShortcut).toBeGreaterThan(-1);
    expect(redoShortcut).toBeGreaterThan(undoShortcut);
    expect(renderStateGuard).toBeGreaterThan(redoShortcut);
  });

  it('reattaches Canvas keyboard shortcuts during commit so history input has no passive-effect gap', () => {
    const keyboardEffectStart = canvas.indexOf('// Keyboard events');
    const keyboardEffectEnd = canvas.indexOf('// Click outside to close menus', keyboardEffectStart);
    const keyboardEffect = canvas.slice(keyboardEffectStart, keyboardEffectEnd);

    expect(keyboardEffectStart).toBeGreaterThan(-1);
    expect(keyboardEffect).toMatch(/useLayoutEffect\(\(\) => \{/);
    expect(keyboardEffect).not.toMatch(/useEffect\(\(\) => \{/);
  });

  it('keeps one stable DOM keyboard listener while rendering the latest shortcut handlers', () => {
    expect(canvas).toContain('const canvasKeyboardHandlersRef = useRef');
    expect(canvas).toContain('canvasKeyboardHandlersRef.current = {');
    expect(canvas).toContain('const stableHandleKeyDown = (event: KeyboardEvent) =>');
    expect(canvas).toContain("window.addEventListener('keydown', stableHandleKeyDown)");
    expect(canvas).toContain("window.removeEventListener('keydown', stableHandleKeyDown)");
  });

  it('reserves native undo for text editors without blocking focused canvas controls', () => {
    const textEditingHelperStart = canvas.indexOf('const isTextEditingTarget');
    const textEditingHelperEnd = canvas.indexOf('// Helper: check if a native event originates', textEditingHelperStart);
    const textEditingHelper = canvas.slice(textEditingHelperStart, textEditingHelperEnd);
    expect(textEditingHelperStart).toBeGreaterThan(-1);
    expect(textEditingHelper).toContain('input');
    expect(textEditingHelper).toContain('textarea');
    expect(textEditingHelper).toContain('contenteditable');
    expect(textEditingHelper).not.toContain('button');

    const keyboardEffectStart = canvas.indexOf('// Keyboard events');
    const keyboardEffectEnd = canvas.indexOf('// Click outside to close menus', keyboardEffectStart);
    const keyboardEffect = canvas.slice(keyboardEffectStart, keyboardEffectEnd);
    expect(keyboardEffect).toContain('const textEditingTarget = isTextEditingTarget(e);');
    expect(keyboardEffect).toMatch(/e\.code === 'KeyZ' && !e\.shiftKey\)[\s\S]{0,120}if \(textEditingTarget\) return;/);
  });

  it('suppresses the synthetic image click emitted after a viewport pan', () => {
    const pointerUpStart = canvas.indexOf('const handlePointerUp');
    const pointerCancelStart = canvas.indexOf('const handlePointerCancel', pointerUpStart);
    const pointerUp = canvas.slice(pointerUpStart, pointerCancelStart);
    const panStart = pointerUp.indexOf(
      '&& (isPanning || directPanPointerIdRef.current === e.pointerId)',
    );
    const panEnd = pointerUp.indexOf('const activeBoxPreview', panStart);
    const panFinish = pointerUp.slice(panStart, panEnd);

    expect(panFinish).toContain('suppressSelectionClickRef.current = true');
    expect(panFinish).toContain('suppressSelectionClickRef.current = false');
    expect(panFinish).toContain('window.setTimeout');
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

  it('does not disable user history while applying a server snapshot', () => {
    const syncStart = workspace.indexOf('const unsubscribe = userMgr.onProjectsChanged');
    const syncEnd = workspace.indexOf('// ★ 异步持久化 data:/blob: URL', syncStart);
    const serverSync = workspace.slice(syncStart, syncEnd);

    expect(serverSync).toContain("{ history: 'skip' }");
    expect(serverSync).not.toContain('skipHistoryRef.current = true');
    expect(serverSync).not.toContain('skipHistoryRef.current = false');
  });

  it('finishes initial project hydration without a timer window that drops user history', () => {
    const projectResolution = workspace.indexOf('const projectId = initialProjectIdRef.current');
    const hydrationStart = workspace.indexOf('if (projectId) {', projectResolution);
    const hydrationEnd = workspace.indexOf('setAuthChecked(true);', hydrationStart);
    const hydration = workspace.slice(hydrationStart, hydrationEnd);

    expect(hydration).toContain("as CanvasImage[], { history: 'skip' });");
    expect(hydration).not.toContain('skipHistoryRef.current');
    expect(workspace).not.toContain('const skipHistoryRef = useRef(false)');
  });

  it('records user deletions during a server merge while excluding the snapshot itself', () => {
    expect(workspace).toContain("next.length < prev.length && historyIntent !== 'skip'");
    expect(workspace).not.toContain('next.length < prev.length && !serverSyncMergeRef.current');
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

  it('suppresses image hover state churn while a viewport pan is active', () => {
    const imageNodeStart = canvas.indexOf('data-canvas-image-id={image.id}');
    const imageNodeEnd = canvas.indexOf('onClick={(e) => {', imageNodeStart);
    const hoverHandlers = canvas.slice(imageNodeStart, imageNodeEnd);

    expect(hoverHandlers.match(/viewportPanPointerIdRef\.current !== null/g)?.length)
      .toBeGreaterThanOrEqual(2);
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

  it('commits undo and redo snapshots to the local project before rendering them', () => {
    const undoStart = workspace.indexOf('const handleUndo');
    const redoStart = workspace.indexOf('const handleRedo', undoStart);
    const undo = workspace.slice(undoStart, redoStart);
    const redoEnd = workspace.indexOf('const [activeGenerationCount', redoStart);
    const redo = workspace.slice(redoStart, redoEnd);

    for (const transition of [undo, redo]) {
      const localCommit = transition.indexOf('commitCanvasHistorySnapshot(committed)');
      const renderCommit = transition.indexOf('setImagesRaw(committed)');
      expect(localCommit).toBeGreaterThan(-1);
      expect(renderCommit).toBeGreaterThan(localCommit);
    }
  });

  it('supersedes queued persistence with the committed undo or redo snapshot', () => {
    const commitStart = workspace.indexOf('const commitCanvasHistorySnapshot');
    const undoStart = workspace.indexOf('const handleUndo', commitStart);
    const commit = workspace.slice(commitStart, undoStart);

    expect(commit).toContain('persistCanvasHistorySnapshotRef.current(nextImages)');
    expect(workspace).toContain('persistCanvasHistorySnapshotRef.current = persistCanvasImagesNow');
  });

  it('clears restored image tombstones before committing history snapshots in every canvas mode', () => {
    const undoStart = workspace.indexOf('const handleUndo');
    const redoStart = workspace.indexOf('const handleRedo', undoStart);
    const undo = workspace.slice(undoStart, redoStart);
    const redoEnd = workspace.indexOf('const [activeGenerationCount', redoStart);
    const redo = workspace.slice(redoStart, redoEnd);

    expect(workspace).toContain('const clearRestoredCanvasImageTombstones');
    for (const transition of [undo, redo]) {
      const clearTombstones = transition.indexOf('clearRestoredCanvasImageTombstones(previous, committed)');
      const localCommit = transition.indexOf('commitCanvasHistorySnapshot(committed)');
      expect(clearTombstones).toBeGreaterThan(-1);
      expect(localCommit).toBeGreaterThan(clearTombstones);
    }
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
