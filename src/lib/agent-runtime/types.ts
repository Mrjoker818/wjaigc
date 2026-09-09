export type AgentWorkspace = 'canvas' | 'workflow' | 'chat';

export type AgentMode = 'conversation' | 'vision' | 'agent';

export type AgentRunStatus =
  | 'created'
  | 'queued'
  | 'planning'
  | 'awaiting-confirmation'
  | 'executing'
  | 'uploading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type AgentEventType =
  | 'run.created'
  | 'plan.updated'
  | 'tool.started'
  | 'tool.progress'
  | 'tool.completed'
  | 'asset.created'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.timeout'
  | 'run.paused'
  | 'run.resumed'
  | 'step.retrying'
  | 'quality.checked';

export interface AgentSkillInvocation {
  skillId: string;
  skillVersion: number;
  inputValues: Record<string, unknown>;
  modelBindings: Record<string, { providerId: string; modelId: string }>;
}

export type AgentAdmittedExecution =
  | { kind: 'generation'; taskIds: string[]; userId: string; userRole: 'user' | 'admin' }
  | {
      kind: 'edit'; requestBody: Record<string, unknown>; idempotencyKey: string;
      userId: string; userRole: 'user' | 'admin';
    };

export interface AgentContextSnapshot {
  selectedEntityIds: string[];
  visibleVersionIds: string[];
  workflowNodeId?: string;
  conversationId?: string;
  locale: 'zh-CN' | 'en-US';
}

export interface AgentRunRequestBase {
  projectId: string;
  workspace: AgentWorkspace;
  workspaceId: string;
  mode: AgentMode;
  prompt: string;
  sourceVersionIds: string[];
  allowedToolIds: string[];
  idempotencyKey: string;
  context: AgentContextSnapshot;
  skill?: AgentSkillInvocation;
  retryLineage?: import('@/lib/multi-platform-export/manifest').MultiPlatformExportRetryLineage;
}

export type ModelAgentRunRequest = AgentRunRequestBase & {
  executionRuntime?: 'model';
  providerId: string;
  modelId: string;
};

export type LocalAgentRunRequest = AgentRunRequestBase & {
  executionRuntime: 'local';
  providerId?: never;
  modelId?: never;
};

export type AgentRunRequest = ModelAgentRunRequest | LocalAgentRunRequest;

export class AgentModelRuntimeRequiredError extends Error {
  readonly code = 'AGENT_MODEL_RUNTIME_REQUIRED';
  readonly status = 400;

  constructor() {
    super('This Agent boundary requires model execution');
    this.name = 'AgentModelRuntimeRequiredError';
  }
}

export function requireModelAgentRunRequest(
  request: AgentRunRequest,
): ModelAgentRunRequest {
  if (request.executionRuntime === 'local') {
    throw new AgentModelRuntimeRequiredError();
  }
  return request;
}

export interface AgentRunBillingQuote {
  creditCost: number;
  label: string;
}

export interface AgentEvent {
  eventId: string;
  runId: string;
  sequence: number;
  type: AgentEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface AgentPlanStep {
  id: string;
  label: string;
  status: string;
}

export interface AgentRunError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface AgentRunProjection {
  runId: string;
  status: AgentRunStatus;
  lastSequence: number;
  plan: AgentPlanStep[];
  assetVersionIds: string[];
  result?: Record<string, unknown>;
  error?: AgentRunError;
  ignoredEventIds: string[];
  missingSequences: number[];
  currentStepId?: string;
  resumeFromStepId?: string;
  progress?: number;
  qualityChecks: Array<{ stepId: string; gateId: string; passed: boolean }>;
}
