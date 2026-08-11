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
    expect(editorSource).toContain('sourceVersion: image.assetVersionId');
    expect(editorSource).toContain('assetVersionId: transferred.assetVersionId');
    expect(editorSource).toContain('void onCanvasImageSelect(node.id, img)');
    expect(editorSource).toMatch(/transferCanvasImageToWorkflow[\s\S]*assetVersionId: undefined/);
    expect(editorSource).toMatch(/if \(!response\.ok\) \{\s*applyLegacyReference\(\)/);
  });

  it('transfers matching workflow outputs to canvas and forwards placement identity without re-uploading', () => {
    expect(editorSource).toContain("entityType: 'canvas-image'");
    expect(editorSource).toContain('sourceVersion: outputReference.assetVersionId');
    expect(editorSource).toContain('resolveWorkflowOutputAssetReference');
    expect(editorSource).toContain('assetReferences: transferredReferences');
    expect(workspaceSource).toContain('const transferredReference = meta?.assetReferences');
    expect(workspaceSource).toContain('...(transferredReference?.assetVersionId');
    expect(workspaceSource).not.toContain('?? meta?.assetReferences?.[i]');
  });
});
