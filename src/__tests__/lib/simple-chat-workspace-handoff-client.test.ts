import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import {
  executeSimpleChatWorkspaceHandoff,
  type ExecuteSimpleChatWorkspaceHandoffInput,
} from '@/lib/simple-chat-workspace-handoff-client';

const intent = {
  targetProjectId: 'canvas-project-1',
  chatProjectId: 'chat-project-1',
  chatTaskId: 'task-1',
  chatMessageId: 'message-1',
};

const sourceTrace = {
  source: 'simple-chat' as const,
  chatProjectId: intent.chatProjectId,
  chatTaskId: intent.chatTaskId,
  messageId: intent.chatMessageId,
  createdAt: '2026-08-27T00:00:00.000Z',
};

const handoffFixture = {
  text: '保留品牌色并生成海报',
  images: [{
    imageIndex: 0,
    assetRef: {
      url: '/source.png',
      name: '品牌参考图',
      assetVersionId: 'version-1',
      placementId: 'chat-placement-1',
    },
    sourceTrace,
  }],
  sourceTrace,
  warnings: [] as Array<'UNMANAGED_IMAGE_SKIPPED'>,
};

const managedReference: WorkspaceAssetReference = {
  url: '/canonical-workflow.png',
  name: '品牌参考图',
  assetId: 'asset-1',
  assetVersionId: 'version-1',
  placementId: 'workflow-placement-1',
  sourceTrace,
};

function createDependencies(): ExecuteSimpleChatWorkspaceHandoffInput {
  return {
    intent,
    currentWorkflow: null,
    resolve: async () => handoffFixture,
    transfer: async request => ({ ...managedReference, entityId: request.entityId }),
    persist: async () => undefined,
    cleanUrl: () => undefined,
    now: () => 1000,
  };
}

describe('simple chat workspace handoff client', () => {
  it('transfers canonical image references before persisting and cleaning the URL', async () => {
    const events: string[] = [];
    const transfer = vi.fn(async (request: Parameters<ExecuteSimpleChatWorkspaceHandoffInput['transfer']>[0]) => {
      events.push('transfer');
      return { ...managedReference, entityId: request.entityId };
    });
    const result = await executeSimpleChatWorkspaceHandoff({
      ...createDependencies(),
      transfer,
      persist: async () => { events.push('persist'); },
      cleanUrl: () => { events.push('clean'); },
    });

    expect(events).toEqual(['transfer', 'persist', 'clean']);
    expect(result.status).toBe('success');
    expect(transfer).toHaveBeenCalledWith({
      sourceVersion: 'version-1',
      targetProject: intent.targetProjectId,
      targetWorkspace: result.workflow.id,
      entityType: 'workflow-input',
      entityId: result.addedNodeIds[1],
      idempotencyKey: expect.any(String),
      metadata: {
        sourceTrace,
        imageIndex: 0,
        name: '品牌参考图',
      },
    });
    expect(result.workflow.nodes[1].config).toMatchObject({
      imageUrl: '/canonical-workflow.png',
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      placementId: 'workflow-placement-1',
      sourceTrace,
    });
  });

  it('keeps the URL and exposes the persistence error when saving fails', async () => {
    const cleanUrl = vi.fn();

    await expect(executeSimpleChatWorkspaceHandoff({
      ...createDependencies(),
      persist: async () => { throw new Error('save failed'); },
      cleanUrl,
    })).rejects.toThrow('save failed');
    expect(cleanUrl).not.toHaveBeenCalled();
  });

  it('does not persist or clean when an image transfer fails', async () => {
    const persist = vi.fn();
    const cleanUrl = vi.fn();

    await expect(executeSimpleChatWorkspaceHandoff({
      ...createDependencies(),
      transfer: async () => { throw new Error('transfer failed'); },
      persist,
      cleanUrl,
    })).rejects.toThrow('transfer failed');
    expect(persist).not.toHaveBeenCalled();
    expect(cleanUrl).not.toHaveBeenCalled();
  });

  it('reuses deterministic nodes and transfers on repeated consumption', async () => {
    const transfer = vi.fn(createDependencies().transfer);
    const dependencies = { ...createDependencies(), transfer };
    const first = await executeSimpleChatWorkspaceHandoff(dependencies);
    const firstRequest = transfer.mock.calls[0][0];
    const second = await executeSimpleChatWorkspaceHandoff({
      ...dependencies,
      currentWorkflow: first.workflow,
    });

    expect(second.addedNodeIds).toEqual([]);
    expect(second.workflow.nodes).toHaveLength(first.workflow.nodes.length);
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(firstRequest.idempotencyKey).toEqual(expect.any(String));
  });

  it('returns partial-success when the resolver skipped unmanaged images', async () => {
    const result = await executeSimpleChatWorkspaceHandoff({
      ...createDependencies(),
      resolve: async () => ({
        ...handoffFixture,
        warnings: ['UNMANAGED_IMAGE_SKIPPED'],
      }),
    });

    expect(result.status).toBe('partial-success');
    expect(result.warnings).toEqual(['UNMANAGED_IMAGE_SKIPPED']);
  });
});
