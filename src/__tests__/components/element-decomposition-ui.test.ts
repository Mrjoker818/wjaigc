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

  it('keeps branch progress, retry, and cancel controls visible after submission', () => {
    expect(canvasSource).toContain('{(showDisplayDecomposePanel || elementDecomposeTask) && (');
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

  it('consumes a retried board result and opens retried layers from the frozen source', () => {
    expect(canvasSource).toContain('completeElementBoardResult(finalTask, branch)');
    expect(canvasSource).toContain('setPsdEditorImageUrl(elementDecomposeTask.source.managedUrl');
  });
});
