import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const canvasPath = path.join(process.cwd(), 'src/components/infinite-canvas.tsx');
const canvasSource = fs.readFileSync(canvasPath, 'utf8');

describe('dual-output element decomposition canvas wiring', () => {
  it('defaults to both outputs and captures an immutable source snapshot', () => {
    expect(canvasSource).toContain("useState<ElementDecomposeOutputMode>('both')");
    expect(canvasSource).toContain('const sourceSnapshot = Object.freeze({');
    expect(canvasSource).toContain('sourceImageId: img.id');
    expect(canvasSource).toContain('sourceVersionId: img.annotationVersionId || buildAnnotationSourceVersionId(');
  });

  it('submits through the parent API client and shows independent branch progress', () => {
    expect(canvasSource).toContain('await createResolvedElementDecompositionRequest(sourceSnapshot');
    expect(canvasSource).toContain('submitElementDecomposition(elementRequest, idempotencyKey, controller.signal)');
    expect(canvasSource).toContain('pollElementDecomposition(parent.taskId');
    expect(canvasSource).toContain("{(['board', 'layers'] as const).map((branch) => {");
    expect(canvasSource).toContain('data-element-branch={branch}');
  });

  it('labels the submit action from the selected output mode', () => {
    expect(canvasSource).toContain('data-action="submit-element-decompose"');
    expect(canvasSource).toContain("elementDecomposeOutputMode === 'layers'");
    expect(canvasSource).toContain("? '生成可编辑图层'");
    expect(canvasSource).toContain("? '生成拆解板与图层'");
    expect(canvasSource).toContain("? '图层拆解中...'");
    expect(canvasSource).toContain("? '双输出拆解中...'");
  });

  it('renders partial success and retries only the failed branch', () => {
    expect(canvasSource).toContain("elementDecomposeTask.overallStatus === 'partial'");
    expect(canvasSource).toContain('handleRetryElementBranch');
    expect(canvasSource).toContain("retryElementDecompositionBranch(elementDecomposeTask.taskId, branch)");
  });

  it('keeps task controls in the panel without forcing a completed panel to stay open', () => {
    expect(canvasSource).toContain("{showDisplayDecomposePanel && typeof document !== 'undefined' && createPortal(");
    expect(canvasSource).not.toContain('{(showDisplayDecomposePanel || elementDecomposeTask) && (');
    expect(canvasSource).toContain('{elementDecomposeTask && (');
  });

  it('portals the panel outside the clipped Canvas viewport stacking context', () => {
    const panelStart = canvasSource.indexOf('/* 元素拆解面板 — 独立 fixed 浮层，不依赖 toolbar 条件 */');
    const panelEnd = canvasSource.indexOf('{showAspectRecomposePanel && (', panelStart);
    const panelBlock = canvasSource.slice(panelStart, panelEnd);

    expect(panelStart).toBeGreaterThanOrEqual(0);
    expect(panelEnd).toBeGreaterThan(panelStart);
    expect(panelBlock).toContain("{showDisplayDecomposePanel && typeof document !== 'undefined' && createPortal(");
    expect(panelBlock).toMatch(/<\/div>,\s*document\.body,\s*\)}/);
  });

  it('preserves the latest task when reopening the panel and resets it only for a new submission', () => {
    const openStart = canvasSource.indexOf('const handleOpenDisplayDecompose = useCallback');
    const openEnd = canvasSource.indexOf('const handleDisplayDecomposeLegacy = useCallback', openStart);
    const openBlock = canvasSource.slice(openStart, openEnd);
    const submitStart = canvasSource.indexOf('const handleDisplayDecomposeConfirm = useCallback');
    const submitEnd = canvasSource.indexOf('const handleCancelElementDecomposition = useCallback', submitStart);
    const submitBlock = canvasSource.slice(submitStart, submitEnd);

    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);
    expect(openBlock).not.toContain('setElementDecomposeTask(null)');
    expect(submitStart).toBeGreaterThanOrEqual(0);
    expect(submitEnd).toBeGreaterThan(submitStart);
    expect(submitBlock).toContain('setElementDecomposeTask(null)');
  });

  it('lazily restores one owned project task, resumes an active task, and rejects stale project responses', () => {
    const recoveryStart = canvasSource.indexOf('const elementDecomposeRecoveryRef = useRef');
    const recoveryEnd = canvasSource.indexOf('const handleDisplayDecomposeLegacy = useCallback', recoveryStart);
    const recoveryBlock = canvasSource.slice(recoveryStart, recoveryEnd);

    expect(recoveryStart).toBeGreaterThanOrEqual(0);
    expect(recoveryEnd).toBeGreaterThan(recoveryStart);
    expect(recoveryBlock).toContain('if (!showDisplayDecomposePanel || elementDecomposeTask || !activeCanvasToolProjectId) return;');
    expect(recoveryBlock).toContain('recoverElementDecomposition(recoveryProjectId, controller.signal)');
    expect(recoveryBlock).toContain('elementDecomposeRecoveryRef.current.requestId !== requestId');
    expect(recoveryBlock).toContain('activeCanvasToolProjectIdRef.current !== recoveryProjectId');
    expect(recoveryBlock).toContain('setElementDecomposeProjectId(recoveryProjectId)');
    expect(recoveryBlock).not.toContain('submitElementDecomposition(');
    expect(recoveryBlock).toContain("['pending', 'processing'].includes(recovered.overallStatus)");
    expect(recoveryBlock).toContain('pollElementDecomposition(recovered.taskId');
    expect(recoveryBlock).not.toContain('retryElementDecompositionBranch(');
  });

  it('invalidates and aborts an older recovery before starting a new decomposition', () => {
    const submitStart = canvasSource.indexOf('const handleDisplayDecomposeConfirm = useCallback');
    const submitEnd = canvasSource.indexOf('const handleOpenAspectRecompose = useCallback', submitStart);
    const submitBlock = canvasSource.slice(submitStart, submitEnd);
    const invalidateIndex = submitBlock.indexOf('elementDecomposeRecoveryRef.current = { projectId: null, requestId:');
    const abortIndex = submitBlock.indexOf('elementDecomposeRecoveryControllerRef.current?.abort()');
    const submitIndex = submitBlock.indexOf('submitElementDecomposition(elementRequest, idempotencyKey, controller.signal)');

    expect(canvasSource).toContain('const elementDecomposeRecoveryControllerRef = useRef<AbortController | null>(null)');
    expect(invalidateIndex).toBeGreaterThanOrEqual(0);
    expect(abortIndex).toBeGreaterThan(invalidateIndex);
    expect(submitIndex).toBeGreaterThan(abortIndex);
  });

  it('aborts recovery and submit polling on project change and unmount', () => {
    const lifecycleStart = canvasSource.indexOf('const abortElementDecomposeRequests = useCallback');
    const lifecycleEnd = canvasSource.indexOf('const handleOpenDisplayDecompose = useCallback', lifecycleStart);
    const lifecycleBlock = canvasSource.slice(lifecycleStart, lifecycleEnd);

    expect(lifecycleStart).toBeGreaterThanOrEqual(0);
    expect(lifecycleBlock).toContain('elementDecomposeRecoveryControllerRef.current?.abort()');
    expect(lifecycleBlock).toContain('elementDecomposeControllerRef.current?.abort()');
    expect(lifecycleBlock).toContain('if (previousProjectId !== activeCanvasToolProjectId)');
    expect(lifecycleBlock).toMatch(/useEffect\(\(\) => \(\) => \{\s*abortElementDecomposeRequests\(\);\s*\}, \[abortElementDecomposeRequests\]\)/);
  });

  it('prevents aborted or stale submit callbacks from mutating the current project', () => {
    const submitStart = canvasSource.indexOf('const handleDisplayDecomposeConfirm = useCallback');
    const submitEnd = canvasSource.indexOf('const handleOpenAspectRecompose = useCallback', submitStart);
    const submitBlock = canvasSource.slice(submitStart, submitEnd);

    expect(submitBlock).toContain('controller.signal.throwIfAborted()');
    expect(submitBlock).toContain('if (activeCanvasToolProjectIdRef.current !== sourceSnapshot.projectId) return;');
    expect(submitBlock).toContain('if (elementDecomposeControllerRef.current === controller) {');
    expect(submitBlock).not.toMatch(/finally \{\s*if \(elementDecomposeControllerRef\.current === controller\) elementDecomposeControllerRef\.current = null;\s*setDisplayDecomposeProcessing/);
  });

  it('supports cancelling the active parent task', () => {
    expect(canvasSource).toContain('handleCancelElementDecomposition');
    expect(canvasSource).toContain('cancelElementDecomposition(elementDecomposeTask.taskId)');
  });

  it('reuses the completed layers branch instead of submitting a second layer task', () => {
    expect(canvasSource).toContain('setPsdEditorInitialResult(layerResult)');
    expect(canvasSource).toContain('initialResult={psdEditorInitialResult || undefined}');
  });

  it('reopens a completed editable-layer result from the frozen parent task without resubmitting', () => {
    const openStart = canvasSource.indexOf('const handleOpenCompletedElementLayers = useCallback');
    const openEnd = canvasSource.indexOf('const handleCancelElementDecomposition = useCallback', openStart);
    const openBlock = canvasSource.slice(openStart, openEnd);

    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);
    expect(openBlock).toContain('resolveCompletedElementLayersEditorPayload(');
    expect(openBlock).toContain('elementDecomposeTask,');
    expect(openBlock).toContain('elementDecomposeProjectId,');
    expect(openBlock).toContain('setPsdEditorImageUrl(editorPayload.imageUrl)');
    expect(openBlock).toContain('setPsdEditorInitialResult(editorPayload.initialResult)');
    expect(openBlock).toContain('setPsdEditorSource(editorPayload.source)');
    expect(openBlock).toContain('setPsdEditorMode(editorPayload.mode)');
    expect(openBlock).toContain('setShowPsdEditor(true)');
    expect(openBlock).not.toContain('submitElementDecomposition(');
    expect(canvasSource).toContain('data-action="open-layer-editor"');
    expect(canvasSource).toContain('onClick={handleOpenCompletedElementLayers}');
    expect(canvasSource).toContain('打开编辑器');
  });

  it('clears a previous decomposition before hiding or directly reopening the PSD editor', () => {
    const closeStart = canvasSource.indexOf('const closeCanvasToolPanels = useCallback');
    const closeEnd = canvasSource.indexOf('const activateCanvasToolSession = useCallback', closeStart);
    const closeBlock = canvasSource.slice(closeStart, closeEnd);
    const openStart = canvasSource.indexOf('const handleEditElements = useCallback');
    const openEnd = canvasSource.indexOf('const handleOpen3D = useCallback', openStart);
    const openBlock = canvasSource.slice(openStart, openEnd);

    expect(closeBlock).toMatch(/setShowPsdEditor\(false\);\s*setPsdEditorInitialResult\(null\);/);
    expect(closeBlock).toContain('setPsdEditorSource(null)');
    expect(openBlock).toContain('setPsdEditorImageUrl(img.url)');
    expect(openBlock).toContain('setPsdEditorInitialResult(null)');
    expect(openBlock).toContain('setPsdEditorSource(effectiveProjectId ? {');
    expect(openBlock).toContain("setPsdEditorMode('studio')");
  });

  it('consumes a retried board result and opens retried layers from the frozen source', () => {
    const retryStart = canvasSource.indexOf('const handleRetryElementBranch = useCallback');
    const retryEnd = canvasSource.indexOf('const handleCancelElementDecomposition = useCallback', retryStart);
    const retryBlock = canvasSource.slice(retryStart, retryEnd);

    expect(canvasSource).toContain('completeElementBoardResult(finalTask, branch)');
    expect(canvasSource).toContain('const [elementDecomposeProjectId, setElementDecomposeProjectId] = useState<string | null>(null)');
    expect(canvasSource).toContain('setElementDecomposeProjectId(sourceSnapshot.projectId)');
    expect(retryBlock).toContain('const effectiveProjectId = elementDecomposeProjectId');
    expect(retryBlock).toContain('const sourceVersionId = finalTask.source.sourceVersionId');
    expect(retryBlock).toContain('setPsdEditorImageUrl(finalTask.source.canonicalUrl)');
    expect(retryBlock).not.toContain('imagesRef.current.find');
    expect(retryBlock).not.toContain('projectId || brandProject?.id');
  });

  it('discloses refunded local fallback consistently for initial, retry, and status paths', () => {
    const submitStart = canvasSource.indexOf('const handleDisplayDecomposeConfirm = useCallback');
    const retryStart = canvasSource.indexOf('const handleRetryElementBranch = useCallback');
    const retryEnd = canvasSource.indexOf('const handleCancelElementDecomposition = useCallback', retryStart);
    const submitBlock = canvasSource.slice(submitStart, retryStart);
    const retryBlock = canvasSource.slice(retryStart, retryEnd);

    expect(canvasSource).toContain('getRefundedLocalLayerFallbackMessage');
    expect(submitBlock).toContain('getRefundedLocalLayerFallbackMessage(layerBranch)');
    expect(submitBlock).toContain('toast.warning(`${layerFallbackMessage}；其他分支未完成，可在状态面板重试`)');
    expect(retryBlock).toContain('getRefundedLocalLayerFallbackMessage(finalTask.branches.layers)');
    expect(retryBlock).toContain('toast.warning(layerFallbackMessage)');
    expect(retryBlock).toContain('toast.warning(`${layerFallbackMessage}；拆解板分支重试完成`)');
    expect(canvasSource).not.toContain('Pear 未通过质量门禁，已退款并使用本地分层');
    expect(canvasSource).toContain('data-layer-fallback="refunded-local"');
  });
});
