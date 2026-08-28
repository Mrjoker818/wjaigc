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
    expect(canvasSource).toContain('{showDisplayDecomposePanel && (');
    expect(canvasSource).not.toContain('{(showDisplayDecomposePanel || elementDecomposeTask) && (');
    expect(canvasSource).toContain('{elementDecomposeTask && (');
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
    expect(openBlock).toMatch(
      /setPsdEditorImageUrl\(img\.url\);\s*setPsdEditorInitialResult\(null\);\s*setPsdEditorMode\('studio'\);/,
    );
  });

  it('consumes a retried board result and opens retried layers from the frozen source', () => {
    expect(canvasSource).toContain('completeElementBoardResult(finalTask, branch)');
    expect(canvasSource).toContain('setPsdEditorImageUrl(elementDecomposeTask.source.managedUrl');
  });
});
