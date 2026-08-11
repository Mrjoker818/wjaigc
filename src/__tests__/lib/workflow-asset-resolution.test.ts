import { describe, expect, it, vi } from 'vitest';

import { resolveWorkflowInputImageForActor } from '@/lib/asset-core/workflow-resolver';
import type { WorkflowNode } from '@/lib/workflow-engine';

function inputNode(config: Record<string, unknown>): WorkflowNode {
  return {
    id: 'input-a',
    type: 'input-image',
    label: 'Input',
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    ports: [],
    config,
  };
}

describe('workflow asset resolution', () => {
  it('resolves a versioned input with the authenticated executor actor and ignores the client URL', async () => {
    const resolveAssetReference = vi.fn().mockResolvedValue({
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-workflow-a',
      url: '/api/serve-upload/canonical.png',
      name: 'Canonical input',
    });

    const output = await resolveWorkflowInputImageForActor(
      'owner-a',
      inputNode({
        imageUrl: 'https://attacker.test/replacement.png',
        projectId: 'project-a',
        assetVersionId: 'version-a',
        placementId: 'placement-workflow-a',
      }),
      { resolveAssetReference },
    );

    expect(resolveAssetReference).toHaveBeenCalledWith({
      actorUserId: 'owner-a',
      projectId: 'project-a',
      assetVersionId: 'version-a',
      placementId: 'placement-workflow-a',
    });
    expect(output).toMatchObject({
      imageUrl: '/api/serve-upload/canonical.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-workflow-a',
    });
    expect(output.imageUrl).not.toContain('attacker.test');
  });

  it('keeps URL-only workflow inputs without calling the asset resolver', async () => {
    const resolveAssetReference = vi.fn();

    await expect(resolveWorkflowInputImageForActor(
      'owner-a',
      inputNode({ imageUrl: 'https://legacy.test/input.png' }),
      { resolveAssetReference },
    )).resolves.toMatchObject({
      imageUrl: 'https://legacy.test/input.png',
    });
    expect(resolveAssetReference).not.toHaveBeenCalled();
  });
});
