export interface WorkspaceSourceTrace {
  source: 'simple-chat';
  chatProjectId: string;
  chatTaskId: string;
  messageId: string;
  modelId?: string;
  providerId?: string;
  generationTaskIds?: string[];
  agentRunId?: string;
  createdAt: string;
}

const TRACE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export function parseWorkspaceSourceTrace(value: unknown): WorkspaceSourceTrace | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const trace = value as Record<string, unknown>;
  if (
    trace.source !== 'simple-chat'
    || typeof trace.chatProjectId !== 'string' || !TRACE_ID.test(trace.chatProjectId)
    || typeof trace.chatTaskId !== 'string' || !TRACE_ID.test(trace.chatTaskId)
    || typeof trace.messageId !== 'string' || !TRACE_ID.test(trace.messageId)
    || typeof trace.createdAt !== 'string' || Number.isNaN(Date.parse(trace.createdAt))
  ) return undefined;
  const generationTaskIds = Array.isArray(trace.generationTaskIds)
    ? trace.generationTaskIds.filter((id): id is string => typeof id === 'string' && TRACE_ID.test(id)).slice(0, 16)
    : undefined;
  return {
    source: 'simple-chat',
    chatProjectId: trace.chatProjectId,
    chatTaskId: trace.chatTaskId,
    messageId: trace.messageId,
    ...(typeof trace.modelId === 'string' && TRACE_ID.test(trace.modelId) ? { modelId: trace.modelId } : {}),
    ...(typeof trace.providerId === 'string' && TRACE_ID.test(trace.providerId) ? { providerId: trace.providerId } : {}),
    ...(generationTaskIds?.length ? { generationTaskIds } : {}),
    ...(typeof trace.agentRunId === 'string' && TRACE_ID.test(trace.agentRunId) ? { agentRunId: trace.agentRunId } : {}),
    createdAt: new Date(trace.createdAt).toISOString(),
  };
}
