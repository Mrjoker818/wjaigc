export interface ChatPendingGenerationTask {
  taskId: string;
  model: string;
  providerId: string;
  type: 'image' | 'video';
  batchId?: string;
  slotId?: string;
  slotIndex?: number;
}

export interface ChatGenerationSlot {
  taskId: string;
  slotIndex: number;
  batchId?: string;
  slotId?: string;
}

export interface ChatGenerationSlotResult<T> {
  slot: ChatGenerationSlot;
  result: T;
}

export interface ChatGenerationSlotSettlement<T> {
  slot: ChatGenerationSlot;
  result?: T;
  error?: string;
}

export interface ChatGenerationSlotImage {
  slotIndex: number;
  url: string;
}

export function upsertChatGenerationSlotImage(
  images: ChatGenerationSlotImage[],
  slotIndex: number,
  url: string,
): ChatGenerationSlotImage[] {
  const bySlot = new Map(images.map(image => [image.slotIndex, image]));
  bySlot.set(slotIndex, { slotIndex, url });
  return [...bySlot.values()].sort((left, right) => left.slotIndex - right.slotIndex);
}

export function mergeRecoveredImages(
  existing: string[] | undefined,
  recovered: string[],
): string[] {
  return [...new Set([...(existing || []), ...recovered])];
}

export async function collectChatGenerationSlotResults<T>(
  slots: ChatGenerationSlot[],
  resolveSlot: (slot: ChatGenerationSlot) => Promise<T | undefined>,
  onSlotResult?: (slot: ChatGenerationSlot, result: T) => void,
): Promise<Array<ChatGenerationSlotResult<T>>> {
  const completed: Array<ChatGenerationSlotResult<T>> = [];
  await Promise.all(slots.map(async (slot) => {
    const result = await resolveSlot(slot);
    if (result === undefined) return;
    onSlotResult?.(slot, result);
    completed.push({ slot, result });
  }));

  return completed.sort((left, right) => left.slot.slotIndex - right.slot.slotIndex);
}

export async function settleChatGenerationSlots<T>(
  slots: ChatGenerationSlot[],
  resolveSlot: (slot: ChatGenerationSlot) => Promise<T>,
  onSlotSettled?: (settlement: ChatGenerationSlotSettlement<T>) => void,
): Promise<Array<ChatGenerationSlotSettlement<T>>> {
  const settlements = await Promise.all(slots.map(async (slot) => {
    let settlement: ChatGenerationSlotSettlement<T>;
    try {
      settlement = { slot, result: await resolveSlot(slot) };
    } catch (error) {
      settlement = {
        slot,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    onSlotSettled?.(settlement);
    return settlement;
  }));

  return settlements.sort((left, right) => left.slot.slotIndex - right.slot.slotIndex);
}

export interface RecoverableChatCloudTask {
  id: string;
  messageId?: string;
  model?: string;
  providerId?: string;
  type: string;
  status: string;
  progress?: number;
}

interface PendingGenerationMessage {
  isGeneratingImage?: boolean;
  pendingGenerationTasks?: ChatPendingGenerationTask[];
}

export interface ChatSessionMessageSnapshot extends PendingGenerationMessage {
  id: string;
  agentRunId?: string;
}

export function getResumableChatGenerationTasks(
  message: PendingGenerationMessage,
): ChatPendingGenerationTask[] {
  if (!message.isGeneratingImage) return [];

  return (message.pendingGenerationTasks || []).filter(task => (
    Boolean(task.taskId?.trim())
    && Boolean(task.model?.trim())
    && (task.type === 'image' || task.type === 'video')
  ));
}

/**
 * A streamed assistant reply can save an older message snapshot after an
 * async tool has already persisted its provider task. Preserve that task
 * until an explicit terminal update is saved for the same message.
 */
export function mergeChatSessionMessages<T extends ChatSessionMessageSnapshot>(
  persistedMessages: T[] | null | undefined,
  incomingMessages: T[],
): T[] {
  const persistedById = new Map((persistedMessages || []).map(message => [message.id, message]));

  return incomingMessages.map(incoming => {
    const persisted = persistedById.get(incoming.id);
    const persistedTasks = persisted ? getResumableChatGenerationTasks(persisted) : [];
    const incomingTasks = getResumableChatGenerationTasks(incoming);
    let merged = incoming;

    if (persistedTasks.length > 0 && incomingTasks.length === 0) {
      merged = {
        ...persisted,
        ...incoming,
        isGeneratingImage: true,
        pendingGenerationTasks: persistedTasks,
      } as T;
    }

    if (persisted?.agentRunId && !merged.agentRunId) {
      return { ...merged, agentRunId: persisted.agentRunId } as T;
    }

    return merged;
  });
}

export function updateChatSessionMessage<T extends { id: string }>(
  messages: T[],
  messageId: string,
  update: (message: T) => T,
): T[] {
  return messages.map(message => message.id === messageId ? update(message) : message);
}

export function mergeRecoveredChatTasks<T extends ChatSessionMessageSnapshot>(
  messages: T[],
  cloudTasks: RecoverableChatCloudTask[],
): T[] {
  const pendingStatuses = new Set(['queued', 'pending', 'processing']);
  const tasksByMessage = new Map<string, RecoverableChatCloudTask[]>();

  for (const task of cloudTasks) {
    if (!task.messageId || !task.id || !pendingStatuses.has(task.status)) continue;
    const mediaType = task.type.includes('video') ? 'video' : 'image';
    if (!task.model || (mediaType !== 'image' && mediaType !== 'video')) continue;
    const tasks = tasksByMessage.get(task.messageId) || [];
    tasks.push(task);
    tasksByMessage.set(task.messageId, tasks);
  }

  return messages.map(message => {
    const recoveredTasks = tasksByMessage.get(message.id);
    if (!recoveredTasks || recoveredTasks.length === 0) return message;

    const existing = getResumableChatGenerationTasks(message);
    const byTaskId = new Map(existing.map(task => [task.taskId, task]));
    for (const task of recoveredTasks) {
      byTaskId.set(task.id, {
        taskId: task.id,
        model: task.model || '',
        providerId: task.providerId || '',
        type: task.type.includes('video') ? 'video' : 'image',
      });
    }
    const firstTask = recoveredTasks[0];
    const messageState = message as T & {
      generateProgress?: number;
      generateModelName?: string;
      generateProviderId?: string;
    };
    const recoveredProgress = Math.max(
      typeof messageState.generateProgress === 'number' ? messageState.generateProgress : 0,
      ...recoveredTasks.map(task => Number(task.progress || 0)),
    );

    return {
      ...message,
      isGeneratingImage: true,
      generateModelName: messageState.generateModelName || firstTask.model || '图像生成',
      generateProviderId: messageState.generateProviderId || firstTask.providerId || '',
      generateProgress: recoveredProgress,
      pendingGenerationTasks: [...byTaskId.values()],
    } as T;
  });
}
