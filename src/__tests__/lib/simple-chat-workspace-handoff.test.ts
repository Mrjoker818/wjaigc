import { describe, expect, it } from 'vitest';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { createEmptyWorkflow, createWorkflowNode } from '@/lib/workflow-engine';
import {
  appendSimpleChatHandoffToWorkflow,
  buildSimpleChatWorkspaceHandoffUrl,
  parseSimpleChatWorkspaceHandoffBody,
  parseSimpleChatWorkspaceHandoffIntent,
  stableChatImportWorkflowId,
  stableChatImportNodeId,
} from '@/lib/simple-chat-workspace-handoff';

const intent = {
  targetProjectId: 'canvas-project-1',
  chatProjectId: 'chat-project-1',
  chatTaskId: 'task-1',
  chatMessageId: 'message-1',
};

describe('simple chat workspace handoff contracts', () => {
  it('round-trips bounded identifiers without embedding text or media URLs', () => {
    const url = buildSimpleChatWorkspaceHandoffUrl(intent);
    expect(url).toContain('mode=node');
    expect(url).not.toContain('prompt=');
    expect(url).not.toContain('imageUrl=');
    expect(parseSimpleChatWorkspaceHandoffIntent(url.split('?')[1])).toEqual(intent);
    expect(parseSimpleChatWorkspaceHandoffIntent(`projectId=x&mode=node&chatProjectId=${'x'.repeat(201)}`)).toBeNull();
    expect(parseSimpleChatWorkspaceHandoffBody(intent)).toEqual(intent);
    expect(parseSimpleChatWorkspaceHandoffBody({ ...intent, targetProjectId: undefined, projectId: 'canvas-project-1' })).toBeNull();
  });

  it('normalizes and bounds source trace metadata', () => {
    const sourceTrace = parseWorkspaceSourceTrace({
      source: 'simple-chat',
      chatProjectId: 'chat-project-1',
      chatTaskId: 'task-1',
      messageId: 'message-1',
      modelId: 'invalid model id',
      generationTaskIds: Array.from({ length: 20 }, (_, index) => `generation-${index}`),
      createdAt: '2026-08-27T08:00:00+08:00',
      secret: 'must-not-leak',
    });
    expect(sourceTrace).toEqual({
      source: 'simple-chat',
      chatProjectId: 'chat-project-1',
      chatTaskId: 'task-1',
      messageId: 'message-1',
      generationTaskIds: Array.from({ length: 16 }, (_, index) => `generation-${index}`),
      createdAt: '2026-08-27T00:00:00.000Z',
    });
  });

  it('creates stable workflow and node identities', () => {
    expect(stableChatImportWorkflowId('canvas-project-1')).toBe(stableChatImportWorkflowId('canvas-project-1'));
    expect(stableChatImportWorkflowId('canvas-project-1')).not.toBe(stableChatImportWorkflowId('canvas-project-2'));
    expect(stableChatImportNodeId(intent, 'text', 0)).toBe(stableChatImportNodeId(intent, 'text', 0));
    expect(stableChatImportNodeId(intent, 'image', 0)).not.toBe(stableChatImportNodeId(intent, 'image', 1));
  });

  it('creates a named workflow when absent and only appends to an existing workflow', () => {
    const existing = createEmptyWorkflow('已有工作流');
    existing.nodes.push({
      ...createWorkflowNode('input-text', 20, 40, '已有节点'),
      id: 'existing-node',
      config: { text: '不得覆盖' },
    });
    const handoff = {
      text: '保留品牌色并生成海报',
      images: [],
      warnings: [],
      sourceTrace: {
        source: 'simple-chat' as const,
        chatProjectId: 'chat-project-1',
        chatTaskId: 'task-1',
        messageId: 'message-1',
        createdAt: '2026-08-27T00:00:00.000Z',
      },
    };
    const created = appendSimpleChatHandoffToWorkflow(null, 'canvas-project-1', handoff, 1000);
    const appended = appendSimpleChatHandoffToWorkflow(existing, 'canvas-project-1', handoff, 1000);
    expect(created.workflow.name).toBe('智能对话导入');
    expect(created.workflow.id).toBe(stableChatImportWorkflowId('canvas-project-1'));
    expect(appended.workflow.id).toBe(existing.id);
    expect(appended.workflow.name).toBe('已有工作流');
    expect(appended.workflow.connections).toEqual(existing.connections);
  });

  it('places imported nodes on a stable grid and skips deterministic duplicates', () => {
    const existing = createEmptyWorkflow('已有工作流');
    existing.nodes = [{
      ...createWorkflowNode('input-text', 20, 40, '已有节点'),
      id: 'existing-node',
    }];
    const sourceTrace = {
      source: 'simple-chat' as const,
      chatProjectId: 'chat-project-1',
      chatTaskId: 'task-1',
      messageId: 'message-1',
      createdAt: '2026-08-27T00:00:00.000Z',
    };
    const handoff = {
      text: '保留品牌色并生成海报',
      images: [0, 1].map(imageIndex => ({
        imageIndex,
        assetRef: { url: `/managed-${imageIndex}.png`, assetVersionId: `version-${imageIndex}` },
        sourceTrace,
      })),
      warnings: [] as Array<'UNMANAGED_IMAGE_SKIPPED'>,
      sourceTrace,
    };
    const first = appendSimpleChatHandoffToWorkflow(existing, intent.targetProjectId, handoff, 1000);
    const second = appendSimpleChatHandoffToWorkflow(first.workflow, intent.targetProjectId, handoff, 2000);
    expect(first.workflow.nodes.slice(1).map(node => [node.x, node.y])).toEqual([
      [380, 40],
      [380, 280],
      [380, 520],
    ]);
    expect(first.pendingImages.map(image => image.nodeId)).toEqual(first.addedNodeIds.slice(1));
    expect(second.addedNodeIds).toEqual([]);
    expect(second.workflow.nodes).toHaveLength(first.workflow.nodes.length);
  });
});
