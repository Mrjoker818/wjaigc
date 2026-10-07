import { beforeEach, describe, expect, it, vi } from 'vitest';

const document = vi.hoisted(() => ({ resolve: vi.fn(), personal: vi.fn() }));
vi.mock('@/lib/collaboration/document-workspace-reference', () => ({
  resolveDocumentWorkspaceReference: document.resolve,
  resolvePersonalWorkspaceReference: document.personal,
}));

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
  beforeEach(() => {
    document.resolve.mockReset().mockResolvedValue(null);
    document.personal.mockReset();
  });

  it('uses the fenced personal resolver for the production workflow binding', async () => {
    document.personal.mockResolvedValue({ url: '/personal.png', assetId: 'asset-a',
      assetVersionId: 'version-a', placementId: 'workflow-placement-a' });
    const output = await resolveWorkflowInputImageForActor('owner-a',
      inputNode({ projectId: 'project-a', assetVersionId: 'version-a', placementId: 'canvas-placement-a' }),
      { projectId: 'project-a', workspaceId: 'workflow-a', entityId: 'input-a' });
    expect(document.personal).toHaveBeenCalledWith('owner-a',
      { projectId: 'project-a', assetVersionId: 'version-a', placementId: 'canvas-placement-a' },
      { workspaceId: 'workflow-a', entityId: 'input-a' });
    expect(output).toMatchObject({ imageUrl: '/personal.png', placementId: 'workflow-placement-a' });
  });

  it('does not retry through a private resolver if collaboration is enabled between reads', async () => {
    document.personal.mockRejectedValue(Object.assign(new Error('changed'), { code: 'ASSET_REFERENCE_AUTHORITY_CHANGED' }));
    await expect(resolveWorkflowInputImageForActor('owner-a',
      inputNode({ projectId: 'project-a', assetVersionId: 'version-a', placementId: 'canvas-placement-a' }),
      { projectId: 'project-a', workspaceId: 'workflow-a', entityId: 'input-a' }))
      .rejects.toMatchObject({ code: 'ASSET_REFERENCE_AUTHORITY_CHANGED' });
  });

  it.each(['owner-a', 'editor-a'])('reads document input canonically without binding or owner impersonation (%s)', async actor => {
    document.resolve.mockResolvedValue({ url: '/canonical-doc.png', assetId: 'asset-a',
      assetVersionId: 'version-a', placementId: 'document-placement-a' });
    const resolveAssetReference = vi.fn().mockResolvedValue({ url: '/old-private.png' });
    const bindWorkflowInputPlacement = vi.fn().mockResolvedValue({ placement: { id: 'copy' } });
    const output = await resolveWorkflowInputImageForActor(actor,
      inputNode({ projectId: 'project-a', assetVersionId: 'version-a', placementId: 'document-placement-a', imageUrl: '/forged.png' }),
      { projectId: 'project-a', workspaceId: 'workflow-a', entityId: 'input-a' },
      { resolveAssetReference, bindWorkflowInputPlacement });
    expect(document.resolve).toHaveBeenCalledWith(actor, { projectId: 'project-a', assetVersionId: 'version-a', placementId: 'document-placement-a' });
    expect(output).toMatchObject({ imageUrl: '/canonical-doc.png', placementId: 'document-placement-a', assetVersionId: 'version-a' });
    expect(resolveAssetReference).not.toHaveBeenCalled();
    expect(bindWorkflowInputPlacement).not.toHaveBeenCalled();
  });

  it('rejects a revoked document reference before any private asset read or write', async () => {
    document.resolve.mockRejectedValue(Object.assign(new Error('revoked'), { code: 'DOCUMENT_FORBIDDEN' }));
    const resolveAssetReference = vi.fn().mockResolvedValue({ url: '/old-private.png' });
    const bindWorkflowInputPlacement = vi.fn();
    await expect(resolveWorkflowInputImageForActor('editor-a',
      inputNode({ projectId: 'project-a', assetVersionId: 'version-a', placementId: 'document-placement-a' }),
      undefined, { resolveAssetReference, bindWorkflowInputPlacement })).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    expect(resolveAssetReference).not.toHaveBeenCalled();
    expect(bindWorkflowInputPlacement).not.toHaveBeenCalled();
  });

  it('does not allow URL-only document inputs to bypass canonical validation', async () => {
    document.resolve.mockRejectedValue(Object.assign(new Error('missing tuple'), { code: 'ASSET_REQUEST_INVALID' }));
    const resolveAssetReference = vi.fn();
    const bindWorkflowInputPlacement = vi.fn();
    await expect(resolveWorkflowInputImageForActor('editor-a', inputNode({ imageUrl: '/untrusted.png' }),
      { projectId: 'project-a', workspaceId: 'workflow-a', entityId: 'input-a' },
      { resolveAssetReference, bindWorkflowInputPlacement })).rejects.toMatchObject({ code: 'ASSET_REQUEST_INVALID' });
    expect(document.resolve).toHaveBeenCalledWith('editor-a', { projectId: 'project-a', assetVersionId: '', placementId: '' });
    expect(resolveAssetReference).not.toHaveBeenCalled();
  });
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
