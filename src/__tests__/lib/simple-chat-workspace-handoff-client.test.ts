import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import {
  executeSimpleChatWorkspaceHandoff,
  type ExecuteSimpleChatWorkspaceHandoffInput,
  type SimpleChatWorkflowTransferRequest,
} from '@/lib/simple-chat-workspace-handoff-client';
import { createEmptyWorkflow, createWorkflowNode, type Workflow } from '@/lib/workflow-engine';

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
    let persistedWorkflow: Workflow | undefined;
    const transfer = vi.fn(async (request: Parameters<ExecuteSimpleChatWorkspaceHandoffInput['transfer']>[0]) => {
      events.push('transfer');
      return { ...managedReference, entityId: request.entityId };
    });
    const result = await executeSimpleChatWorkspaceHandoff({
      ...createDependencies(),
      transfer,
      persist: async workflow => {
        persistedWorkflow = workflow;
        events.push('persist');
      },
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
    expect(persistedWorkflow?.nodes[1].config).toMatchObject({
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

  it('retries a failed persistence from the original workflow with stable nodes and transfers', async () => {
    const originalWorkflow = createEmptyWorkflow('已有工作流');
    originalWorkflow.nodes = [{
      ...createWorkflowNode('input-text', 20, 40, '已有节点'),
      id: 'existing-node',
      config: { text: '不得覆盖' },
    }];
    const events: string[] = [];
    const transferRequests: SimpleChatWorkflowTransferRequest[] = [];
    const persistedWorkflows: Workflow[] = [];
    const cleanUrl = vi.fn(() => { events.push('clean'); });
    let persistAttempt = 0;
    const dependencies: ExecuteSimpleChatWorkspaceHandoffInput = {
      ...createDependencies(),
      currentWorkflow: originalWorkflow,
      transfer: async request => {
        transferRequests.push(request);
        events.push('transfer');
        return { ...managedReference, entityId: request.entityId };
      },
      persist: async workflow => {
        persistedWorkflows.push(workflow);
        persistAttempt += 1;
        events.push(`persist-${persistAttempt}`);
        if (persistAttempt === 1) throw new Error('save failed');
      },
      cleanUrl,
    };

    await expect(executeSimpleChatWorkspaceHandoff(dependencies)).rejects.toThrow('save failed');
    expect(cleanUrl).not.toHaveBeenCalled();

    const recovered = await executeSimpleChatWorkspaceHandoff(dependencies);

    expect(events).toEqual(['transfer', 'persist-1', 'transfer', 'persist-2', 'clean']);
    expect(persistedWorkflows).toHaveLength(2);
    expect(persistedWorkflows[1].nodes.map(node => node.id))
      .toEqual(persistedWorkflows[0].nodes.map(node => node.id));
    expect(persistedWorkflows[1].nodes).toHaveLength(persistedWorkflows[0].nodes.length);
    expect(originalWorkflow.nodes).toHaveLength(1);
    expect(recovered.workflow.nodes).toHaveLength(3);
    expect(transferRequests).toHaveLength(2);
    expect(transferRequests[1]).toEqual(transferRequests[0]);
    expect(transferRequests[0].idempotencyKey).toEqual(expect.any(String));
    expect(persistedWorkflows[1].nodes[2].config).toMatchObject({
      imageUrl: '/canonical-workflow.png',
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      placementId: 'workflow-placement-1',
      sourceTrace,
    });
    expect(cleanUrl).toHaveBeenCalledOnce();
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
