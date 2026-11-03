import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseUiSource, callbackInitializer, evaluateUi } from '../helpers/ui-source-contracts';
import { createWorkflowNode, type WorkflowNode } from '@/lib/workflow-engine';
import type { WorkflowEditorTransition } from '@/lib/workflow-renderer/commands';
import { createPendingWorkflowInputReference, createWorkflowInputTransferGuard } from '@/lib/asset-core/workspace-transfer';

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const editorSource = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');

describe('node editor asset references', () => {
  it('passes canvas asset versions into the editor and creates workflow-input placements', () => {
    expect(workspaceSource).toContain('assetVersionId: img.assetVersionId');
    expect(editorSource).toMatch(/interface CanvasImageRef[\s\S]*assetVersionId\?: string/);
    expect(editorSource).toContain("entityType: 'workflow-input'");
    expect(editorSource).toContain('sourceVersion: sourceReference.assetVersionId');
    expect(editorSource).toContain('assetVersionId: transferred.assetVersionId');
    expect(editorSource).toContain('void onCanvasImageSelect(node.id, img)');
    expect(editorSource).toContain('createPendingWorkflowInputReference(image)');
    expect(editorSource).toContain('createWorkflowInputTransferGuard()');
    expect(editorSource).toContain('runGuardedWorkflowInputTransfer({');
    expect(editorSource).toContain('workflowInputTransferGuardRef.current.invalidate(nodeId)');
    // Execute the real insertion callback: one transaction must own both history and transfer.
    const actual = parseUiSource(editorSource);
    const image = { id: 'source-image', url: '/synthetic.png', projectId: 'project-a',
      versionId: 'source-v', assetId: 'asset-a', assetVersionId: 'asset-v', placementId: 'canvas-p' };
    const guard = createWorkflowInputTransferGuard();
    const materialInsertionCentersRef = { current: new Map<string, {
      guard: typeof guard; transactionId: string; x: number; y: number; cx: number; cy: number;
      width: number; sourceImageId: string; geometryEpoch: number;
    }>() };
    const materialGeometryEpochRef = { current: new Map<string, number>() };
    const materialInsertionTransactionsRef = { current: new Map<string, { transactionId: string; guard: typeof guard; shadow: WorkflowNode; image: typeof image }>() };
    const abandonedMaterialOriginsRef = { current: new Map<string, { scope: string; actor: string; project: string; transactionId: string; guard: typeof guard; image: typeof image }>() };
    const wfRef = { current: { id: 'workflow-a', nodes: [] as Array<{ id: string; config: Record<string, unknown> }>, connections: [] } };
    const dispatchWorkflowEditorTransition = vi.fn<(transition: WorkflowEditorTransition) => void>();
    const transferCanvasImageToWorkflow = vi.fn<(nodeId: string, source: typeof image, transactionId: string) => Promise<void>>(async () => {});
    const setSelectedNodeIds = vi.fn<(ids: Set<string>) => void>();
    const add = evaluateUi(actual, callbackInitializer(actual, 'addCanvasImageNode'), {
      createWorkflowNode, createPendingWorkflowInputReference, workflowInputTransferGuardRef: { current: guard },
      materialInsertionCentersRef, materialGeometryEpochRef, materialInsertionTransactionsRef, abandonedMaterialOriginsRef, wfRef,
      editorTransactionCounterRef: { current: 0 }, userId: 'actor-a', projectId: 'project-a',
      workflowInputScope: 'scope-a', dispatchWorkflowEditorTransition, setSelectedNodeIds, transferCanvasImageToWorkflow,
    }) as (url: string, x: number, y: number, source: typeof image) => void;
    add(image.url, 200, 180, image);
    expect(transferCanvasImageToWorkflow).toHaveBeenCalledTimes(1);
    const [nodeId, source, transactionId] = transferCanvasImageToWorkflow.mock.calls[0];
    expect(source).toBe(image);
    expect(transactionId).toMatch(/^material-insert:/);
    expect(materialInsertionCentersRef.current.get(nodeId)).toEqual(expect.objectContaining({
      transactionId, guard, cx: 200, cy: 180, sourceImageId: image.id, geometryEpoch: 0,
    }));
    expect(dispatchWorkflowEditorTransition).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: 'user.update', transactionId }),
    );
    expect(materialInsertionTransactionsRef.current.get(nodeId)).toEqual(expect.objectContaining({
      transactionId, guard, image,
    }));
    expect(abandonedMaterialOriginsRef.current.get(nodeId)).toEqual(expect.objectContaining({
      transactionId, guard, actor: 'actor-a', project: 'project-a', image,
    }));
    expect(wfRef.current.nodes).toHaveLength(1);
    expect(wfRef.current.nodes[0]).toEqual(expect.objectContaining({ id: nodeId, config: expect.objectContaining({
      imageUrl: image.url, sourceImageId: image.id, sourceVersionId: image.versionId, assetTransferPending: true,
    }) }));
    expect(setSelectedNodeIds).toHaveBeenCalledWith(new Set([nodeId]));
  });

  it('adopts legacy canvas images before creating canonical workflow inputs', () => {
    expect(editorSource).toContain("fetch('/api/assets/adopt-canvas-image'");
    expect(editorSource).toMatch(
      /adopt-canvas-image[\s\S]*sourceVersion: sourceReference\.assetVersionId[\s\S]*entityType: 'workflow-input'/,
    );
    expect(workspaceSource).toContain('onCanvasImageAssetReferenceAdopted=');
    expect(workspaceSource).toContain('assetVersionId: reference.assetVersionId');
  });

  it('transfers matching workflow outputs to canvas and forwards placement identity without re-uploading', () => {
    expect(editorSource).toContain("entityType: 'canvas-image'");
    expect(editorSource).toContain('sourceVersion: outputReference.assetVersionId');
    expect(editorSource).toContain('resolveWorkflowOutputAssetReference');
    expect(editorSource).toContain('prepareWorkflowCanvasInsertions');
    expect(editorSource).toContain('if (!response.ok) throw new Error');
    expect(editorSource).toContain('onAddImages(insertion.items');
    expect(editorSource).not.toContain('new Set(insertion.urls)');
    expect(workspaceSource).toContain('const transferredReference = insertionItem?.assetReference');
    expect(workspaceSource).toContain('...(transferredReference?.assetVersionId');
    expect(workspaceSource).not.toContain('assetReferences?.find(reference => reference.url');
  });

  it('waits for workflow output canvas persistence before navigating back to chat', () => {
    expect(editorSource).toContain('workflowCanvasPersistenceRef');
    expect(editorSource).toContain('!canvasPersistence.settled');
    expect(editorSource).toContain('canvasPersistence.failedOutputNodeIds.has(nodeId)');
    expect(editorSource).toMatch(
      /workflowCanvasPersistenceRef\.current = \{\s*executionId: data\.executionId,\s*settled: false,\s*failedOutputNodeIds: new Set<string>\(\),\s*\};\s*setExecutionId\(data\.executionId\);/,
    );
    expect(editorSource).toContain('workflowCanvasPersistenceRef.current?.executionId === executionId');
    expect(editorSource.indexOf('const canvasPersistence = workflowCanvasPersistenceRef.current'))
      .toBeLessThan(editorSource.indexOf('buildWorkflowChatReturnIntentUrl({'));
  });

  it('uses the latest workflow snapshot when a fast execution completes', () => {
    expect(editorSource).toContain('const completedWorkflow = wfRef.current;');
    expect(editorSource).toMatch(/const outputCandidates = completedWorkflow\.nodes[\s\S]*completedWorkflow\.connections/);
    expect(editorSource).toContain('workflowId: completedWorkflow.id');
  });

  it('submits the latest workflow snapshot when execution follows a node insertion', () => {
    expect(editorSource).toMatch(
      /const handleRunWorkflow = useCallback\(async \(\) => \{\s*const latestWorkflow = wfRef\.current;\s*await startWorkflowExecution\(\{ nodes: latestWorkflow\.nodes, connections: latestWorkflow\.connections \}\);/,
    );
  });
});
