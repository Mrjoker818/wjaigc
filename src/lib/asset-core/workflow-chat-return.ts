import type { WorkspaceAssetReference } from './types';

export interface WorkflowChatReturnIntent {
  assetProjectId: string;
  sourceVersionId: string;
  workflowId: string;
  executionId: string;
  outputNodeId: string;
  outputLabel: string;
}

export interface WorkflowChatReturnMessage {
  id: string;
  role: 'assistant';
  content: string;
  images: string[];
  imageRefs: WorkspaceAssetReference[];
  attachments: Array<{
    id: string;
    type: 'image';
    name: string;
    mimeType: string;
    url: string;
    assetId?: string;
    assetVersionId?: string;
    placementId?: string;
  }>;
  createdAt: number;
}

const LIMITS = {
  id: 256,
  label: 160,
} as const;

function bounded(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : '';
}

export function buildWorkflowChatReturnIntentUrl(
  intent: WorkflowChatReturnIntent,
  targetChatProjectId?: string,
): string {
  const params = new URLSearchParams({
    assetProjectId: intent.assetProjectId,
    workflowVersionId: intent.sourceVersionId,
    workflowId: intent.workflowId,
    workflowExecutionId: intent.executionId,
    workflowOutputNodeId: intent.outputNodeId,
    workflowOutputLabel: intent.outputLabel,
  });
  if (targetChatProjectId) params.set('projectId', targetChatProjectId);
  return `/simple-chat?${params.toString()}`;
}

export async function navigateToWorkflowChatAfterPersistence(
  url: string,
  persist: () => Promise<void>,
  navigate: (target: string) => void,
): Promise<void> {
  await persist();
  navigate(url);
}

export function parseWorkflowChatReturnIntent(search: string): WorkflowChatReturnIntent | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const intent: WorkflowChatReturnIntent = {
    assetProjectId: bounded(params.get('assetProjectId'), LIMITS.id),
    sourceVersionId: bounded(params.get('workflowVersionId') || params.get('sourceVersionId'), LIMITS.id),
    workflowId: bounded(params.get('workflowId'), LIMITS.id),
    executionId: bounded(params.get('workflowExecutionId'), LIMITS.id),
    outputNodeId: bounded(params.get('workflowOutputNodeId'), LIMITS.id),
    outputLabel: bounded(params.get('workflowOutputLabel'), LIMITS.label),
  };
  return Object.values(intent).every(Boolean) ? intent : null;
}

export function buildWorkflowChatReturnTransfer(
  intent: WorkflowChatReturnIntent,
  chatProjectId: string,
): Record<string, unknown> {
  return {
    sourceVersion: intent.sourceVersionId,
    targetProject: intent.assetProjectId,
    targetWorkspace: `standalone-chat:${chatProjectId}`,
    entityType: 'chat-result',
    entityId: `workflow-return:${intent.executionId}:${intent.outputNodeId}`,
    idempotencyKey: `workflow-chat:${chatProjectId}:${intent.executionId}:${intent.outputNodeId}:${intent.sourceVersionId}`,
    metadata: {
      source: 'workflow',
      workflowId: intent.workflowId,
      executionId: intent.executionId,
      outputNodeId: intent.outputNodeId,
      name: intent.outputLabel,
    },
  };
}

export function createWorkflowChatReturnMessage(
  intent: WorkflowChatReturnIntent,
  reference: WorkspaceAssetReference,
  createdAt = Date.now(),
): WorkflowChatReturnMessage {
  const attachmentId = `workflow-return-attachment:${reference.placementId || reference.assetVersionId || intent.outputNodeId}`;
  return {
    id: `workflow-return:${reference.placementId || reference.assetVersionId || intent.outputNodeId}`,
    role: 'assistant',
    content: `工作流结果已返回：${intent.outputLabel}`,
    images: [reference.url],
    imageRefs: [reference],
    attachments: [{
      id: attachmentId,
      type: 'image',
      name: `${intent.outputLabel}.png`,
      mimeType: 'image/png',
      url: reference.url,
      ...(reference.assetId ? { assetId: reference.assetId } : {}),
      ...(reference.assetVersionId ? { assetVersionId: reference.assetVersionId } : {}),
      ...(reference.placementId ? { placementId: reference.placementId } : {}),
    }],
    createdAt,
  };
}
