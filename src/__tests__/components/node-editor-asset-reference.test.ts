import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(editorSource).toMatch(/createPendingWorkflowInputReference\(refImage\)[\s\S]*transferCanvasImageToWorkflow\(node\.id, refImage\)/);
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
});
