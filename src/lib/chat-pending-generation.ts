export interface ChatPendingGenerationTask {
  taskIds: string[];
  model: string;
  providerId: string;
  assistantMessageId: string;
  timestamp: number;
  messageContent?: string;
}

export interface PendingGenerationMessage {
  id?: string;
  isGeneratingImage?: boolean;
  content?: string;
  pendingGenerationTasks?: ChatPendingGenerationTask[];
}

export interface ChatSessionMessageSnapshot extends PendingGenerationMessage {
  id: string;
}

export function mergeChatSessionMessages<T extends ChatSessionMessageSnapshot>(
  persistedMessages: T[],
  incomingMessages: T[],
): T[] {
  const persistedById = new Map(persistedMessages.map(message => [message.id, message]));

  return incomingMessages.map(incoming => {
    const persisted = persistedById.get(incoming.id);
    const persistedTasks = persisted ? getResumableChatGenerationTasks([persisted]) : [];
    const incomingTasks = getResumableChatGenerationTasks([incoming]);

    if (persistedTasks.length > 0 && incomingTasks.length === 0 && incoming.isGeneratingImage !== false) {
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

export function getResumableChatGenerationTasks(
  messages: PendingGenerationMessage[],
  resumedKeys?: Set<string>,
): ChatPendingGenerationTask[] {
  const tasks: ChatPendingGenerationTask[] = [];
  for (const msg of messages) {
    if (!msg.isGeneratingImage) continue;
    if (!msg.pendingGenerationTasks?.length) continue;
    for (const task of msg.pendingGenerationTasks) {
      if (resumedKeys?.has(task.assistantMessageId)) continue;
      if (!task.taskIds?.length) continue;
      if (!task.model?.trim()) continue;
      tasks.push({
        ...task,
        messageContent: msg.content,
      });
    }
  }
  return tasks;
}
