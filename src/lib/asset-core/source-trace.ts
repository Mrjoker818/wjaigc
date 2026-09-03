export interface SimpleChatWorkspaceSourceTrace {
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

export interface CanvasSkillWorkspaceSourceTrace {
  source: 'canvas-skill';
  runId: string;
  skillId: string;
  skillVersion: number;
  readonly sourceVersionIds: readonly string[];
  readonly modelBindings?: Readonly<Partial<Record<
    'orchestrator' | 'image' | 'video' | 'vision' | 'edit' | 'three-d',
    Readonly<{ providerId: string; modelId: string }>
  >>>;
  createdAt: string;
}

export type WorkspaceSourceTrace = SimpleChatWorkspaceSourceTrace | CanvasSkillWorkspaceSourceTrace;

const TRACE_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const TRACE_LABEL_MAX_LENGTH = 200;

function isBoundedTraceLabel(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= TRACE_LABEL_MAX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function parseWorkspaceSourceTrace(value: unknown): WorkspaceSourceTrace | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const trace = value as Record<string, unknown>;
  if (trace.source === 'canvas-skill') {
    if (
      typeof trace.runId !== 'string' || !TRACE_ID.test(trace.runId)
      || typeof trace.skillId !== 'string' || !TRACE_ID.test(trace.skillId)
      || !Number.isSafeInteger(trace.skillVersion) || (trace.skillVersion as number) < 1
      || !Array.isArray(trace.sourceVersionIds) || trace.sourceVersionIds.length > 64
      || trace.sourceVersionIds.some(id => typeof id !== 'string' || !TRACE_ID.test(id))
      || typeof trace.createdAt !== 'string' || Number.isNaN(Date.parse(trace.createdAt))
    ) return undefined;
    const roles = ['orchestrator', 'image', 'video', 'vision', 'edit', 'three-d'] as const;
    const bindings = trace.modelBindings;
    const modelBindings: CanvasSkillWorkspaceSourceTrace['modelBindings'] = bindings === undefined
      ? undefined
      : (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)
          || Object.keys(bindings).some(role => !roles.includes(role as typeof roles[number])))
        ? undefined
        : Object.freeze(Object.fromEntries(Object.entries(bindings).flatMap(([role, binding]) => {
            if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return [];
            const candidate = binding as Record<string, unknown>;
            return isBoundedTraceLabel(candidate.providerId) && isBoundedTraceLabel(candidate.modelId)
              ? [[role, Object.freeze({ providerId: candidate.providerId, modelId: candidate.modelId })]]
              : [];
          }))) as CanvasSkillWorkspaceSourceTrace['modelBindings'];
    if (bindings !== undefined && (!modelBindings || Object.keys(modelBindings).length !== Object.keys(bindings as object).length)) {
      return undefined;
    }
    return Object.freeze({
      source: 'canvas-skill',
      runId: trace.runId,
      skillId: trace.skillId,
      skillVersion: trace.skillVersion as number,
      sourceVersionIds: Object.freeze([...new Set(trace.sourceVersionIds as string[])]),
      ...(modelBindings ? { modelBindings } : {}),
      createdAt: new Date(trace.createdAt).toISOString(),
    });
  }
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
    ...(isBoundedTraceLabel(trace.modelId) ? { modelId: trace.modelId } : {}),
    ...(isBoundedTraceLabel(trace.providerId) ? { providerId: trace.providerId } : {}),
    ...(generationTaskIds?.length ? { generationTaskIds } : {}),
    ...(typeof trace.agentRunId === 'string' && TRACE_ID.test(trace.agentRunId) ? { agentRunId: trace.agentRunId } : {}),
    createdAt: new Date(trace.createdAt).toISOString(),
  };
}

export function bindWorkspaceSourceTraceToChat(
  value: unknown,
  chatTrace: SimpleChatWorkspaceSourceTrace,
): SimpleChatWorkspaceSourceTrace | undefined {
  if (value === undefined) return chatTrace;
  const imageTrace = parseWorkspaceSourceTrace(value);
  const bound = parseWorkspaceSourceTrace({
    source: 'simple-chat',
    chatProjectId: chatTrace.chatProjectId,
    chatTaskId: chatTrace.chatTaskId,
    messageId: chatTrace.messageId,
    ...(imageTrace?.source === 'simple-chat' && imageTrace.modelId ? { modelId: imageTrace.modelId } : {}),
    ...(imageTrace?.source === 'simple-chat' && imageTrace.providerId ? { providerId: imageTrace.providerId } : {}),
    ...(imageTrace?.source === 'simple-chat' && imageTrace.generationTaskIds ? { generationTaskIds: imageTrace.generationTaskIds } : {}),
    ...((imageTrace?.source === 'simple-chat' && imageTrace.agentRunId) || chatTrace.agentRunId
      ? { agentRunId: imageTrace?.source === 'simple-chat' ? imageTrace.agentRunId || chatTrace.agentRunId : chatTrace.agentRunId }
      : {}),
    createdAt: imageTrace?.source === 'simple-chat' ? imageTrace.createdAt : chatTrace.createdAt,
  });
  return bound?.source === 'simple-chat' ? bound : undefined;
}
