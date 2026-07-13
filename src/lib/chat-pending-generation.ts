export interface ChatPendingGenerationTask {
  taskIds: string[];
  model: string;
  providerId: string;
  assistantMessageId: string;
  timestamp: number;
  messageContent?: string;
}

interface PendingGenerationMessage {
  id?: string;
  isGeneratingImage?: boolean;
  content?: string;
  pendingGenerationTasks?: ChatPendingGenerationTask[];
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
