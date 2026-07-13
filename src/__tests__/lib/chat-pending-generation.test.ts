import { describe, it, expect } from 'vitest';
import {
  getResumableChatGenerationTasks,
  type ChatPendingGenerationTask,
} from '@/lib/chat-pending-generation';

describe('getResumableChatGenerationTasks', () => {
  it('returns tasks from messages with isGeneratingImage=true and pendingGenerationTasks', () => {
    const task: ChatPendingGenerationTask = {
      taskIds: ['task-1'],
      model: 'gpt-4',
      providerId: 'provider-1',
      assistantMessageId: 'msg-1',
      timestamp: Date.now(),
    };
    const messages = [
      { id: 'msg-1', role: 'assistant' as const, content: 'test', isGeneratingImage: true, pendingGenerationTasks: [task] },
    ];
    const result = getResumableChatGenerationTasks(messages);
    expect(result).toHaveLength(1);
    expect(result[0].taskIds).toEqual(['task-1']);
  });

  it('skips messages without isGeneratingImage', () => {
    const task: ChatPendingGenerationTask = {
      taskIds: ['task-1'],
      model: 'gpt-4',
      providerId: 'provider-1',
      assistantMessageId: 'msg-1',
      timestamp: Date.now(),
    };
    const messages = [
      { id: 'msg-1', role: 'assistant' as const, content: 'test', pendingGenerationTasks: [task] },
    ];
    const result = getResumableChatGenerationTasks(messages);
    expect(result).toHaveLength(0);
  });

  it('skips tasks with empty taskIds', () => {
    const task: ChatPendingGenerationTask = {
      taskIds: [],
      model: 'gpt-4',
      providerId: 'provider-1',
      assistantMessageId: 'msg-1',
      timestamp: Date.now(),
    };
    const messages = [
      { id: 'msg-1', role: 'assistant' as const, content: 'test', isGeneratingImage: true, pendingGenerationTasks: [task] },
    ];
    const result = getResumableChatGenerationTasks(messages);
    expect(result).toHaveLength(0);
  });

  it('skips tasks with empty model', () => {
    const task: ChatPendingGenerationTask = {
      taskIds: ['task-1'],
      model: '',
      providerId: 'provider-1',
      assistantMessageId: 'msg-1',
      timestamp: Date.now(),
    };
    const messages = [
      { id: 'msg-1', role: 'assistant' as const, content: 'test', isGeneratingImage: true, pendingGenerationTasks: [task] },
    ];
    const result = getResumableChatGenerationTasks(messages);
    expect(result).toHaveLength(0);
  });

  it('skips already-resumed tasks', () => {
    const task: ChatPendingGenerationTask = {
      taskIds: ['task-1'],
      model: 'gpt-4',
      providerId: 'provider-1',
      assistantMessageId: 'msg-1',
      timestamp: Date.now(),
    };
    const messages = [
      { id: 'msg-1', role: 'assistant' as const, content: 'test', isGeneratingImage: true, pendingGenerationTasks: [task] },
    ];
    const resumedKeys = new Set(['msg-1']);
    const result = getResumableChatGenerationTasks(messages, resumedKeys);
    expect(result).toHaveLength(0);
  });
});
