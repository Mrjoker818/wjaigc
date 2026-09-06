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
    const bindWorkflowInputPlacement = vi.fn().mockResolvedValue({
      placement: { id: 'placement-workflow-runtime' },
      reused: false,
    });

    const output = await resolveWorkflowInputImageForActor(
      'owner-a',
      inputNode({
        imageUrl: 'https://attacker.test/replacement.png',
        projectId: 'project-a',
        assetVersionId: 'version-a',
        placementId: 'placement-workflow-a',
      }),
      {
        projectId: 'project-a',
        workspaceId: 'workflow:workflow-a',
        entityId: 'input-a',
      },
      { resolveAssetReference, bindWorkflowInputPlacement },
    );

    expect(resolveAssetReference).toHaveBeenCalledWith({
      actorUserId: 'owner-a',
      projectId: 'project-a',
      assetVersionId: 'version-a',
      placementId: 'placement-workflow-a',
    });
    expect(bindWorkflowInputPlacement).toHaveBeenCalledWith({
      actorUserId: 'owner-a',
      projectId: 'project-a',
      assetVersionId: 'version-a',
      workspace: 'workflow',
      workspaceId: 'workflow:workflow-a',
      entityType: 'workflow-input',
      entityId: 'input-a',
    });
    expect(output).toMatchObject({
      imageUrl: '/api/serve-upload/canonical.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-workflow-runtime',
    });
    expect(output.imageUrl).not.toContain('attacker.test');
  });

  it('keeps URL-only workflow inputs without calling the asset resolver', async () => {
    const resolveAssetReference = vi.fn();
    const bindWorkflowInputPlacement = vi.fn();

    await expect(resolveWorkflowInputImageForActor(
      'owner-a',
      inputNode({ imageUrl: 'https://legacy.test/input.png' }),
      undefined,
      { resolveAssetReference, bindWorkflowInputPlacement },
    )).resolves.toMatchObject({
      imageUrl: 'https://legacy.test/input.png',
    });
    expect(resolveAssetReference).not.toHaveBeenCalled();
    expect(bindWorkflowInputPlacement).not.toHaveBeenCalled();
  });

  it('rejects URL-only input when a Skill workflow requires managed assets', async () => {
    const resolveAssetReference = vi.fn();
    const bindWorkflowInputPlacement = vi.fn();

    await expect(resolveWorkflowInputImageForActor(
      'owner-a',
      inputNode({ imageUrl: 'https://legacy.test/input.png' }),
      {
        projectId: 'project-a',
        workspaceId: 'workflow:workflow-a',
        entityId: 'input-a',
        requireManagedAsset: true,
      },
      { resolveAssetReference, bindWorkflowInputPlacement },
    )).rejects.toThrow('工作流 Skill 图片输入必须使用项目资产');
    expect(resolveAssetReference).not.toHaveBeenCalled();
    expect(bindWorkflowInputPlacement).not.toHaveBeenCalled();
  });

  it('rejects a versioned input whose client project differs from the execution project', async () => {
    const resolveAssetReference = vi.fn();
    const bindWorkflowInputPlacement = vi.fn();

    await expect(resolveWorkflowInputImageForActor(
      'owner-a',
      inputNode({ projectId: 'project-spoofed', assetVersionId: 'version-a' }),
      { projectId: 'project-real', workspaceId: 'workflow:workflow-a', entityId: 'input-a' },
      { resolveAssetReference, bindWorkflowInputPlacement },
    )).rejects.toThrow('工作流图片输入不属于当前项目');
    expect(resolveAssetReference).not.toHaveBeenCalled();
    expect(bindWorkflowInputPlacement).not.toHaveBeenCalled();
  });
});
