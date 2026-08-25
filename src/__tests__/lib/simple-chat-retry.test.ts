import { describe, expect, it } from 'vitest';
import {
  createSimpleChatRetryContext,
  readSimpleChatRetryContext,
  recoverInterruptedSimpleChatMessages,
} from '@/lib/simple-chat-retry';
import type { SimpleChatMessage } from '@/components/simple-chat/simple-chat-types';

function validContext() {
  return createSimpleChatRetryContext({
    kind: 'chat',
    projectId: 'project-a',
    taskId: 'task-a',
    userMessageId: 'user-a',
    assistantMessageId: 'assistant-a',
    idempotencyKey: 'simple-chat-retry:task-a:assistant-a',
    modelId: 'deepseek-v4-flash',
    providerId: 'provider-a',
    webSearch: false,
    sourceVersionIds: [],
    selectedEntityIds: [],
    historyMessageIds: ['history-a'],
    systemMessages: [],
    knowledgeItems: [],
    memories: [],
  });
}

describe('simple-chat deterministic retry contract', () => {
  it('converts persisted streaming messages into retryable failures', () => {
    const input: SimpleChatMessage[] = [{
      id: 'assistant-a',
      role: 'assistant',
      content: 'partial',
      createdAt: 1,
      status: 'streaming',
      retryContext: validContext(),
    }];
    const [message] = recoverInterruptedSimpleChatMessages(input);

    expect(message.status).toBe('failed');
    expect(message.error).toEqual({
      message: '上次请求中断，可重试。',
      retryable: true,
    });
  });

  it('keeps completed and failed messages unchanged', () => {
    const messages: SimpleChatMessage[] = [
      {
        id: 'assistant-a', role: 'assistant', content: 'done', createdAt: 1,
        status: 'completed',
      },
      {
        id: 'assistant-b', role: 'assistant', content: 'failed', createdAt: 2,
        status: 'failed',
        error: { message: 'supplier failed', retryable: true },
        retryContext: { ...validContext(), assistantMessageId: 'assistant-b' },
      },
    ];

    expect(recoverInterruptedSimpleChatMessages(messages)).toEqual(messages);
  });

  it('turns a streaming message without a valid context into a non-retryable failure', () => {
    const input: SimpleChatMessage[] = [{
      id: 'assistant-a',
      role: 'assistant',
      content: '',
      createdAt: 1,
      status: 'streaming',
    }];
    const [message] = recoverInterruptedSimpleChatMessages(input);

    expect(message.status).toBe('failed');
    expect(message.error).toEqual({
      message: '上次请求中断，缺少可恢复的请求信息。',
      retryable: false,
    });
  });

  it('rejects oversized retry context identifiers', () => {
    const context = { ...validContext(), projectId: 'x'.repeat(300) };
    expect(readSimpleChatRetryContext(context)).toBeNull();
  });

  it('rejects a retry context owned by a different assistant message', () => {
    expect(readSimpleChatRetryContext(validContext(), {
      assistantMessageId: 'assistant-b',
    })).toBeNull();
  });

  it('rejects oversized aggregate retry context payloads', () => {
    const context = {
      ...validContext(),
      systemMessages: Array.from({ length: 64 }, (_, index) => ({
        role: 'system' as const,
        content: `${index}:${'x'.repeat(10_000)}`,
      })),
    };

    expect(readSimpleChatRetryContext(context)).toBeNull();
  });
});
