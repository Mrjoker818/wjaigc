import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildSimpleChatMessageSourceTrace,
  canSendSimpleChatMessageToNodeMode,
  type SimpleChatMessage,
  type SimpleChatProject,
  type SimpleChatTask,
} from '@/components/simple-chat/simple-chat-types';
import { buildSimpleChatWorkspaceHandoffUrl } from '@/lib/simple-chat-workspace-handoff';

const chatAreaSource = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/chat-area.tsx'),
  'utf8',
);

const project: SimpleChatProject = {
  id: 'chat-project-a',
  name: 'Chat',
  createdAt: 1,
  updatedAt: 1,
  tasks: [],
  agents: [],
  knowledgeItems: [],
};

const task: SimpleChatTask = {
  id: 'chat-task-a',
  projectId: project.id,
  name: 'Task',
  messages: [],
  model: 'chat-model-a',
  providerId: 'chat-provider-a',
  createdAt: 1,
  updatedAt: 1,
};

function message(overrides: Partial<SimpleChatMessage> = {}): SimpleChatMessage {
  return {
    id: 'message-a',
    role: 'assistant',
    content: '',
    createdAt: Date.parse('2026-08-27T08:00:00.000Z'),
    ...overrides,
  };
}

describe('Simple Chat workspace entry', () => {
  it('enables node-mode handoff only for non-empty text or a managed image', () => {
    expect(canSendSimpleChatMessageToNodeMode(message({ content: '  ' }))).toBe(false);
    expect(canSendSimpleChatMessageToNodeMode(message({ content: '可发送文本' }))).toBe(true);
    expect(canSendSimpleChatMessageToNodeMode(message({
      images: ['/legacy.png'],
      imageRefs: [{ url: '/legacy.png' }],
    }))).toBe(false);
    expect(canSendSimpleChatMessageToNodeMode(message({
      images: ['/managed.png'],
      imageRefs: [{
        url: '/managed.png',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
      }],
    }))).toBe(true);
  });

  it('builds a validated message-level source trace from chat identifiers', () => {
    expect(buildSimpleChatMessageSourceTrace({
      project,
      task,
      message: message({
        model: 'message-model-a',
        providerId: 'message-provider-a',
        agentRunId: 'agent-run-a',
        imageRefs: [{
          url: '/managed.png',
          assetVersionId: 'version-a',
          placementId: 'placement-a',
          sourceTrace: {
            source: 'simple-chat',
            chatProjectId: 'chat-project-a',
            chatTaskId: 'chat-task-a',
            messageId: 'message-a',
            generationTaskIds: ['generation-task-a'],
            createdAt: '2026-08-27T08:00:00.000Z',
          },
        }],
      }),
    })).toEqual({
      source: 'simple-chat',
      chatProjectId: 'chat-project-a',
      chatTaskId: 'chat-task-a',
      messageId: 'message-a',
      modelId: 'message-model-a',
      providerId: 'message-provider-a',
      generationTaskIds: ['generation-task-a'],
      agentRunId: 'agent-run-a',
      createdAt: '2026-08-27T08:00:00.000Z',
    });
  });

  it('builds node-mode navigation from identifiers only', () => {
    const url = buildSimpleChatWorkspaceHandoffUrl({
      targetProjectId: 'canvas-project-a',
      chatProjectId: project.id,
      chatTaskId: task.id,
      chatMessageId: 'message-a',
    });
    const params = new URL(url, 'https://example.test').searchParams;

    expect(Object.fromEntries(params)).toEqual({
      projectId: 'canvas-project-a',
      mode: 'node',
      chatProjectId: 'chat-project-a',
      chatTaskId: 'chat-task-a',
      chatMessageId: 'message-a',
    });
    expect(url).not.toContain('可发送文本');
  });

  it('wires the action to same-tab navigation without a node bridge side channel', () => {
    expect(chatAreaSource).toContain('buildSimpleChatWorkspaceHandoffUrl');
    expect(chatAreaSource).toContain('发送到节点模式');
    expect(chatAreaSource).toMatch(/window\.location\.assign\(/);
    expect(chatAreaSource).not.toContain('wujie_node_bridge');
    expect(chatAreaSource).not.toMatch(/localStorage\.setItem\([^)]*node_bridge/);
  });
});
