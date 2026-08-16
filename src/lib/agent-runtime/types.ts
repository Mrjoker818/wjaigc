export type AgentWorkspace = 'canvas' | 'workflow' | 'chat';

export type AgentMode = 'conversation' | 'vision' | 'agent';

export type AgentRunStatus =
  | 'created'
  | 'queued'
  | 'planning'
  | 'awaiting-confirmation'
  | 'executing'
  | 'uploading'
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
  | 'run.timeout';

export interface AgentContextSnapshot {
  selectedEntityIds: string[];
  visibleVersionIds: string[];
  workflowNodeId?: string;
  conversationId?: string;
  locale: 'zh-CN' | 'en-US';
}

export interface AgentRunRequest {
  projectId: string;
  workspace: AgentWorkspace;
  workspaceId: string;
  mode: AgentMode;
  providerId: string;
  modelId: string;
  prompt: string;
  sourceVersionIds: string[];
  allowedToolIds: string[];
  idempotencyKey: string;
  context: AgentContextSnapshot;
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
}
