export interface ChatPendingGenerationTask {
  taskId: string;
  model: string;
  providerId: string;
  type: 'image' | 'video';
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
 * A browser refresh can happen after the UI shows a generation placeholder but
 * before the provider returns a task ID. That placeholder cannot be resumed,
 * so it must not remain in the restored session indefinitely.
 */
export function clearUnrecoverableChatGenerationStates<T extends ChatSessionMessageSnapshot>(
  messages: T[],
): T[] {
  let changed = false;
  const normalizedMessages = messages.map(message => {
    if (!message.isGeneratingImage || getResumableChatGenerationTasks(message).length > 0) {
      return message;
    }

    changed = true;
    return {
      ...message,
      isGeneratingImage: false,
      pendingGenerationTasks: undefined,
    } as T;
  });

  return changed ? normalizedMessages : messages;
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

    if (persistedTasks.length > 0 && incomingTasks.length === 0) {
      return {
        ...persisted,
        ...incoming,
        isGeneratingImage: true,
        pendingGenerationTasks: persistedTasks,
      } as T;
    }

    return incoming;
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
