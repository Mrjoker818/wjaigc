// @vitest-environment jsdom

import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildSimpleChatMessageSourceTrace,
  canSendSimpleChatMessageToNodeMode,
  type SimpleChatMessage,
  type SimpleChatProject,
  type SimpleChatTask,
} from '@/components/simple-chat/simple-chat-types';
import {
  hasSimpleChatAssistantOperationPayload,
  shouldRenderSimpleChatWorkspaceActions,
  SimpleChatWorkspaceActionEntry,
  SimpleChatWorkspaceActions,
} from '@/components/simple-chat/chat-area';
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires an actual image aligned with its managed reference', () => {
    expect(canSendSimpleChatMessageToNodeMode(message({ content: '  ' }))).toBe(false);
    expect(canSendSimpleChatMessageToNodeMode(message({ content: '可发送文本' }))).toBe(true);
    expect(canSendSimpleChatMessageToNodeMode(message({
      images: ['/legacy.png'],
      imageRefs: [{ url: '/legacy.png' }],
    }))).toBe(false);
    expect(canSendSimpleChatMessageToNodeMode(message({
      images: ['/actual.png'],
      imageRefs: [
        { url: '/orphan.png' },
        {
          url: '/managed-but-orphaned.png',
          assetVersionId: 'version-orphaned',
          placementId: 'placement-orphaned',
        },
      ],
    }))).toBe(false);
    expect(canSendSimpleChatMessageToNodeMode(message({
      images: ['/actual.png'],
      imageRefs: [
        {
          url: '/wrong-image.png',
          assetVersionId: 'version-wrong',
          placementId: 'placement-wrong',
        },
      ],
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

  it('keeps the workspace guidance reachable for a completed empty assistant message', () => {
    const emptyCompletedMessage = message({
      content: '',
      images: undefined,
      imageRefs: undefined,
      status: 'completed',
    });

    expect(shouldRenderSimpleChatWorkspaceActions(emptyCompletedMessage, false)).toBe(true);
    expect(hasSimpleChatAssistantOperationPayload(emptyCompletedMessage)).toBe(false);

    render(createElement(SimpleChatWorkspaceActionEntry, {
      message: emptyCompletedMessage,
      project,
      task,
      isStreaming: false,
      selectedCanvasProjectId: 'canvas-project-a',
      canvasTransferPending: false,
      onSendToCanvas: vi.fn(),
      onNotice: vi.fn(),
      navigate: vi.fn(),
    }));

    const nodeAction = screen.getByRole('button', { name: '发送到节点模式' }) as HTMLButtonElement;
    expect(nodeAction.disabled).toBe(true);
    expect(nodeAction.title).toBe('仅非空文本或已登记图片可发送到节点模式');
    expect(screen.queryByTitle('添加到画布')).toBeNull();
  });

  it('renders the node action beside Canvas and guides empty or targetless messages', () => {
    const onNotice = vi.fn();
    const { rerender } = render(createElement(SimpleChatWorkspaceActions, {
      message: message({
        images: ['/managed.png'],
        imageRefs: [{
          url: '/managed.png',
          assetVersionId: 'version-a',
          placementId: 'placement-a',
        }],
      }),
      project,
      task,
      selectedCanvasProjectId: '',
      canvasTransferPending: false,
      onSendToCanvas: vi.fn(),
      onNotice,
      navigate: vi.fn(),
    }));

    const actions = screen.getByTestId('simple-chat-workspace-actions');
    expect(actions.children[0]).toBe(screen.getByTitle('添加到画布'));
    expect(actions.children[1]).toBe(screen.getByRole('button', { name: '发送到节点模式' }));
    fireEvent.click(screen.getByRole('button', { name: '发送到节点模式' }));
    expect(onNotice).toHaveBeenCalledWith('请先选择目标画布项目');

    rerender(createElement(SimpleChatWorkspaceActions, {
      message: message({ content: '  ' }),
      project,
      task,
      selectedCanvasProjectId: 'canvas-project-a',
      canvasTransferPending: false,
      onSendToCanvas: vi.fn(),
      onNotice,
      navigate: vi.fn(),
    }));
    const emptyAction = screen.getByRole('button', { name: '发送到节点模式' }) as HTMLButtonElement;
    expect(emptyAction.disabled).toBe(true);
    expect(emptyAction.getAttribute('title')).toBe('仅非空文本或已登记图片可发送到节点模式');
  });

  it('clicks through the selected target with an identifier-only URL', () => {
    const navigate = vi.fn();
    render(createElement(SimpleChatWorkspaceActions, {
      message: message({ content: '可发送文本' }),
      project,
      task,
      selectedCanvasProjectId: 'canvas-selected-only',
      canvasTransferPending: false,
      onSendToCanvas: vi.fn(),
      onNotice: vi.fn(),
      navigate,
    }));

    fireEvent.click(screen.getByRole('button', { name: '发送到节点模式' }));

    expect(navigate).toHaveBeenCalledOnce();
    const url = new URL(String(navigate.mock.calls[0]?.[0]), 'https://example.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      projectId: 'canvas-selected-only',
      mode: 'node',
      chatProjectId: project.id,
      chatTaskId: task.id,
      chatMessageId: 'message-a',
    });
    expect(url.toString()).not.toContain('可发送文本');
    expect(url.toString()).not.toContain('/managed.png');
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

  it('defaults production navigation to same-tab assign without a node bridge side channel', () => {
    expect(chatAreaSource).toContain('buildSimpleChatWorkspaceHandoffUrl');
    expect(chatAreaSource).toContain('发送到节点模式');
    expect(chatAreaSource).toMatch(/window\.location\.assign\(/);
    expect(chatAreaSource).not.toContain('wujie_node_bridge');
    expect(chatAreaSource).not.toMatch(/localStorage\.setItem\([^)]*node_bridge/);
  });
});
