import { describe, expect, it } from 'vitest';

import {
  buildWorkflowChatReturnIntentUrl,
  buildWorkflowChatReturnTransfer,
  createWorkflowChatReturnMessage,
  navigateToWorkflowChatAfterPersistence,
  parseWorkflowChatReturnIntent,
} from '@/lib/asset-core/workflow-chat-return';

const intent = {
  assetProjectId: 'canvas-project-1',
  sourceVersionId: 'version-1',
  workflowId: 'workflow:canvas-project-1',
  executionId: 'execution-1',
  outputNodeId: 'output-node-1',
  outputLabel: '最终效果图',
};

describe('workflow result return to standalone chat', () => {
  it('round-trips a bounded canonical return intent through the URL', () => {
    const url = buildWorkflowChatReturnIntentUrl(intent);
    expect(url.startsWith('/simple-chat?')).toBe(true);
    expect(parseWorkflowChatReturnIntent(url.split('?')[1])).toEqual(intent);
    expect(parseWorkflowChatReturnIntent('assetProjectId=x&sourceVersionId=')).toBeNull();
    expect(parseWorkflowChatReturnIntent(`assetProjectId=x&sourceVersionId=${'v'.repeat(300)}`)).toBeNull();
  });

  it('builds one stable chat placement for the active chat project', () => {
    expect(buildWorkflowChatReturnTransfer(intent, 'chat-project-1')).toEqual({
      sourceVersion: 'version-1',
      targetProject: 'canvas-project-1',
      targetWorkspace: 'standalone-chat:chat-project-1',
      entityType: 'chat-result',
      entityId: 'workflow-return:execution-1:output-node-1',
      idempotencyKey: 'workflow-chat:chat-project-1:execution-1:output-node-1:version-1',
      metadata: {
        source: 'workflow',
        workflowId: 'workflow:canvas-project-1',
        executionId: 'execution-1',
        outputNodeId: 'output-node-1',
        name: '最终效果图',
      },
    });
  });

  it('creates a distinct persisted message carrying the returned placement', () => {
    const message = createWorkflowChatReturnMessage(intent, {
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      placementId: 'chat-placement-1',
      entityId: 'workflow-return:execution-1:output-node-1',
      url: '/uploads/workflow-output.png',
    }, 1234);

    expect(message).toMatchObject({
      id: 'workflow-return:chat-placement-1',
      role: 'assistant',
      content: '工作流结果已返回：最终效果图',
      images: ['/uploads/workflow-output.png'],
      imageRefs: [{
        assetVersionId: 'version-1',
        placementId: 'chat-placement-1',
      }],
      createdAt: 1234,
    });
  });

  it('waits for workspace persistence before navigating to standalone chat', async () => {
    let releasePersistence!: () => void;
    const persistence = new Promise<void>(resolve => { releasePersistence = resolve; });
    const events: string[] = [];
    const operation = navigateToWorkflowChatAfterPersistence(
      '/simple-chat?workflowVersionId=version-1',
      async () => {
        events.push('persist-start');
        await persistence;
        events.push('persist-complete');
      },
      url => events.push(`navigate:${url}`),
    );

    await Promise.resolve();
    expect(events).toEqual(['persist-start']);

    releasePersistence();
    await operation;
    expect(events).toEqual([
      'persist-start',
      'persist-complete',
      'navigate:/simple-chat?workflowVersionId=version-1',
    ]);
  });
});
