import { describe, it, expect } from 'vitest';
import {
  collectChatGenerationSlotResults,
  settleChatGenerationSlots,
  upsertChatGenerationSlotImage,
  getResumableChatGenerationTasks,
  mergeChatSessionMessages,
  mergeRecoveredChatTasks,
  type ChatPendingGenerationTask,
  type ChatSessionMessageSnapshot,
  type RecoverableChatCloudTask,
} from '@/lib/chat-pending-generation';

describe('chat progressive generation slots', () => {
  it('starts every slot concurrently, emits each completion immediately, and returns stable slot order', async () => {
    const resolvers = new Map<number, (value: string) => void>();
    const started: number[] = [];
    const completed: number[] = [];
    const slots = [2, 0, 1].map(slotIndex => ({
      taskId: `task-${slotIndex}`,
      slotIndex,
    }));

    const pending = collectChatGenerationSlotResults(
      slots,
      slot => new Promise<string>((resolve) => {
        started.push(slot.slotIndex);
        resolvers.set(slot.slotIndex, resolve);
      }),
      slot => completed.push(slot.slotIndex),
    );

    await Promise.resolve();
    expect(started).toEqual([2, 0, 1]);

    resolvers.get(2)?.('url-2');
    await Promise.resolve();
    expect(completed).toEqual([2]);

    resolvers.get(0)?.('url-0');
    await Promise.resolve();
    expect(completed).toEqual([2, 0]);

    resolvers.get(1)?.('url-1');
    await expect(pending).resolves.toEqual([
      { slot: { taskId: 'task-0', slotIndex: 0 }, result: 'url-0' },
      { slot: { taskId: 'task-1', slotIndex: 1 }, result: 'url-1' },
      { slot: { taskId: 'task-2', slotIndex: 2 }, result: 'url-2' },
    ]);
  });
  it('does not resolve the batch until slower siblings settle after an early failure', async () => {
    let resolveSlow: ((value: string) => void) | undefined;
    let settled = false;
    const pending = collectChatGenerationSlotResults(
      [
        { taskId: 'failed-fast', slotIndex: 0 },
        { taskId: 'slow-success', slotIndex: 1 },
      ],
      slot => (
        slot.slotIndex === 0
          ? Promise.resolve(undefined)
          : new Promise<string>(resolve => { resolveSlow = resolve; })
      ),
    ).then(result => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSlow?.('url-1');
    await expect(pending).resolves.toEqual([
      { slot: { taskId: 'slow-success', slotIndex: 1 }, result: 'url-1' },
    ]);
  });

  it('records an early failure without preventing slower sibling recovery', async () => {
    let resolveSlow: ((value: string) => void) | undefined;
    let settled = false;
    const pending = settleChatGenerationSlots(
      [
        { taskId: 'failed-fast', slotIndex: 0 },
        { taskId: 'slow-success', slotIndex: 1 },
      ],
      slot => (
        slot.slotIndex === 0
          ? Promise.reject(new Error('provider rejected slot 0'))
          : new Promise<string>(resolve => { resolveSlow = resolve; })
      ),
    ).then(result => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSlow?.('url-1');
    await expect(pending).resolves.toEqual([
      {
        slot: { taskId: 'failed-fast', slotIndex: 0 },
        error: 'provider rejected slot 0',
      },
      {
        slot: { taskId: 'slow-success', slotIndex: 1 },
        result: 'url-1',
      },
    ]);
  });

  it('publishes recovered images immediately while keeping stable slot order', async () => {
    const resolvers = new Map<number, {
      resolve: (value: string) => void;
      reject: (error: Error) => void;
    }>();
    let visibleImages: Array<{ slotIndex: number; url: string }> = [];
    const snapshots: string[][] = [];
    const pending = settleChatGenerationSlots(
      [0, 1, 2].map(slotIndex => ({ taskId: `task-${slotIndex}`, slotIndex })),
      slot => new Promise<string>((resolve, reject) => {
        resolvers.set(slot.slotIndex, { resolve, reject });
      }),
      settlement => {
        if (!settlement.result) return;
        visibleImages = upsertChatGenerationSlotImage(
          visibleImages,
          settlement.slot.slotIndex,
          settlement.result,
        );
        snapshots.push(visibleImages.map(image => image.url));
      },
    );

    await Promise.resolve();
    resolvers.get(2)?.resolve('url-2');
    await Promise.resolve();
    expect(snapshots).toEqual([['url-2']]);

    resolvers.get(0)?.resolve('url-0');
    await Promise.resolve();
    expect(snapshots).toEqual([['url-2'], ['url-0', 'url-2']]);

    resolvers.get(1)?.reject(new Error('slot 1 failed'));
    const settlements = await pending;
    expect(settlements.map(item => item.slot.slotIndex)).toEqual([0, 1, 2]);
    expect(visibleImages.map(image => image.url)).toEqual(['url-0', 'url-2']);
  });
});

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
