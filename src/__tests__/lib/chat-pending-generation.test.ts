import { describe, it, expect } from 'vitest';
import {
  getResumableChatGenerationTasks,
  mergeChatSessionMessages,
  type ChatPendingGenerationTask,
  type PendingGenerationMessage,
  type ChatSessionMessageSnapshot,
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

describe('mergeChatSessionMessages', () => {
  it('persists pendingGenerationTasks from stored messages into incoming messages', () => {
    const stored: ChatSessionMessageSnapshot[] = [
      {
        id: 'msg-1',
        content: 'test',
        isGeneratingImage: true,
        pendingGenerationTasks: [
          { taskIds: ['task-1'], model: 'gpt-4', providerId: 'p1', assistantMessageId: 'msg-1', timestamp: 1 },
        ],
      },
    ];
    const incoming: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1', content: 'test', isGeneratingImage: false },
    ];
    const result = mergeChatSessionMessages(stored, incoming);
    expect(result[0].pendingGenerationTasks).toHaveLength(1);
    expect(result[0].isGeneratingImage).toBe(true);
  });

  it('returns incoming if stored is empty', () => {
    const incoming: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1', content: 'test' },
    ];
    const result = mergeChatSessionMessages([], incoming);
    expect(result).toEqual(incoming);
  });

  it('returns incoming if stored is null', () => {
    const incoming: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1', content: 'test' },
    ];
    const result = mergeChatSessionMessages(null as unknown as ChatSessionMessageSnapshot[], incoming);
    expect(result).toEqual(incoming);
  });

  it('does not overwrite non-task fields with stored values', () => {
    const stored: ChatSessionMessageSnapshot[] = [
      {
        id: 'msg-1',
        content: 'old-content',
        isGeneratingImage: true,
        pendingGenerationTasks: [
          { taskIds: ['task-1'], model: 'gpt-4', providerId: 'p1', assistantMessageId: 'msg-1', timestamp: 1 },
        ],
      },
    ];
    const incoming: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1', content: 'new-content', isGeneratingImage: false },
    ];
    const result = mergeChatSessionMessages(stored, incoming);
    expect(result[0].content).toBe('new-content');
    expect(result[0].pendingGenerationTasks).toHaveLength(1);
  });
});
