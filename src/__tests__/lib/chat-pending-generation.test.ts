import { describe, it, expect } from 'vitest';
import {
  getResumableChatGenerationTasks,
  mergeChatSessionMessages,
  mergeRecoveredChatTasks,
  type ChatPendingGenerationTask,
  type ChatSessionMessageSnapshot,
  type RecoverableChatCloudTask,
} from '@/lib/chat-pending-generation';

describe('getResumableChatGenerationTasks', () => {
  it('returns tasks from a message with isGeneratingImage=true and pendingGenerationTasks', () => {
    const task: ChatPendingGenerationTask = {
      taskId: 'task-1',
      model: 'gpt-4',
      providerId: 'provider-1',
      type: 'image',
    };
    const message = {
      id: 'msg-1',
      role: 'assistant' as const,
      isGeneratingImage: true,
      pendingGenerationTasks: [task],
    };
    const result = getResumableChatGenerationTasks(message);
    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe('task-1');
  });

  it('returns empty for message without isGeneratingImage', () => {
    const task: ChatPendingGenerationTask = {
      taskId: 'task-1',
      model: 'gpt-4',
      providerId: 'provider-1',
      type: 'image',
    };
    const message = {
      id: 'msg-1',
      role: 'assistant' as const,
      pendingGenerationTasks: [task],
    };
    const result = getResumableChatGenerationTasks(message);
    expect(result).toHaveLength(0);
  });

  it('skips tasks with empty taskId', () => {
    const task: ChatPendingGenerationTask = {
      taskId: '',
      model: 'gpt-4',
      providerId: 'provider-1',
      type: 'image',
    };
    const message = {
      id: 'msg-1',
      role: 'assistant' as const,
      isGeneratingImage: true,
      pendingGenerationTasks: [task],
    };
    const result = getResumableChatGenerationTasks(message);
    expect(result).toHaveLength(0);
  });

  it('skips tasks with empty model', () => {
    const task: ChatPendingGenerationTask = {
      taskId: 'task-1',
      model: '',
      providerId: 'provider-1',
      type: 'image',
    };
    const message = {
      id: 'msg-1',
      role: 'assistant' as const,
      isGeneratingImage: true,
      pendingGenerationTasks: [task],
    };
    const result = getResumableChatGenerationTasks(message);
    expect(result).toHaveLength(0);
  });

  it('skips tasks with unsupported type', () => {
    const task: ChatPendingGenerationTask = {
      taskId: 'task-1',
      model: 'gpt-4',
      providerId: 'provider-1',
      type: 'audio' as unknown as ChatPendingGenerationTask['type'],
    };
    const message = {
      id: 'msg-1',
      role: 'assistant' as const,
      isGeneratingImage: true,
      pendingGenerationTasks: [task],
    };
    const result = getResumableChatGenerationTasks(message);
    expect(result).toHaveLength(0);
  });
});

describe('mergeChatSessionMessages', () => {
  it('persists pendingGenerationTasks from stored messages into incoming messages', () => {
    const stored: ChatSessionMessageSnapshot[] = [
      {
        id: 'msg-1',
        isGeneratingImage: true,
        pendingGenerationTasks: [
          { taskId: 'task-1', model: 'gpt-4', providerId: 'p1', type: 'image' as const },
        ],
      },
    ];
    const incoming: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1', isGeneratingImage: false },
    ];
    const result = mergeChatSessionMessages(stored, incoming);
    expect(result[0].pendingGenerationTasks).toHaveLength(1);
    expect(result[0].isGeneratingImage).toBe(true);
  });

  it('returns incoming if stored is empty', () => {
    const incoming: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1' },
    ];
    const result = mergeChatSessionMessages([], incoming);
    expect(result).toEqual(incoming);
  });

  it('returns incoming if stored is null', () => {
    const incoming: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1' },
    ];
    const result = mergeChatSessionMessages(null as unknown as ChatSessionMessageSnapshot[], incoming);
    expect(result).toEqual(incoming);
  });

  it('does not overwrite non-task fields with stored values', () => {
    const stored: ChatSessionMessageSnapshot[] = [
      {
        id: 'msg-1',
        isGeneratingImage: true,
        pendingGenerationTasks: [
          { taskId: 'task-1', model: 'gpt-4', providerId: 'p1', type: 'image' as const },
        ],
      },
    ];
    const incoming: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1', isGeneratingImage: false },
    ];
    const result = mergeChatSessionMessages(stored, incoming);
    expect(result[0].isGeneratingImage).toBe(true);
    expect(result[0].pendingGenerationTasks).toHaveLength(1);
  });
});

describe('mergeRecoveredChatTasks', () => {
  it('merges recovered cloud tasks into messages', () => {
    const messages: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1', isGeneratingImage: false },
    ];
    const cloudTasks: RecoverableChatCloudTask[] = [
      {
        id: 'task-1',
        messageId: 'msg-1',
        model: 'gpt-4',
        providerId: 'p1',
        type: 'image',
        status: 'processing',
        progress: 50,
      },
    ];
    const result = mergeRecoveredChatTasks(messages, cloudTasks);
    expect(result[0].isGeneratingImage).toBe(true);
    expect(result[0].pendingGenerationTasks).toBeDefined();
    expect(result[0].pendingGenerationTasks![0].taskId).toBe('task-1');
    expect(result[0].pendingGenerationTasks![0].model).toBe('gpt-4');
  });

  it('skips completed/cancelled cloud tasks', () => {
    const messages: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1' },
    ];
    const cloudTasks: RecoverableChatCloudTask[] = [
      {
        id: 'task-1',
        messageId: 'msg-1',
        model: 'gpt-4',
        providerId: 'p1',
        type: 'image',
        status: 'completed',
        progress: 100,
      },
    ];
    const result = mergeRecoveredChatTasks(messages, cloudTasks);
    expect(result[0].isGeneratingImage).toBeUndefined();
    expect(result[0].pendingGenerationTasks).toBeUndefined();
  });

  it('skips cloud tasks without messageId', () => {
    const messages: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1' },
    ];
    const cloudTasks: RecoverableChatCloudTask[] = [
      {
        id: 'task-1',
        model: 'gpt-4',
        providerId: 'p1',
        type: 'image',
        status: 'processing',
        progress: 50,
      },
    ];
    const result = mergeRecoveredChatTasks(messages, cloudTasks);
    expect(result[0].isGeneratingImage).toBeUndefined();
  });

  it('handles video type cloud tasks', () => {
    const messages: ChatSessionMessageSnapshot[] = [
      { id: 'msg-1', isGeneratingImage: false },
    ];
    const cloudTasks: RecoverableChatCloudTask[] = [
      {
        id: 'task-v-1',
        messageId: 'msg-1',
        model: 'seedance',
        providerId: 'p1',
        type: 'video',
        status: 'processing',
        progress: 30,
      },
    ];
    const result = mergeRecoveredChatTasks(messages, cloudTasks);
    expect(result[0].isGeneratingImage).toBe(true);
    expect(result[0].pendingGenerationTasks![0].type).toBe('video');
  });
});
