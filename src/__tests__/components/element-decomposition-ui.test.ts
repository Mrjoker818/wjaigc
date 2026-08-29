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

  it('supports cancelling the active parent task', () => {
    expect(canvasSource).toContain('handleCancelElementDecomposition');
    expect(canvasSource).toContain('cancelElementDecomposition(elementDecomposeTask.taskId)');
  });

  it('reuses the completed layers branch instead of submitting a second layer task', () => {
    expect(canvasSource).toContain('setPsdEditorInitialResult(layerResult)');
    expect(canvasSource).toContain('initialResult={psdEditorInitialResult || undefined}');
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
