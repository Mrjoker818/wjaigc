import {
  createCloudTask,
  getCloudTaskById,
  getCloudTaskForUser,
  updateCloudTask,
  type CloudTask,
  type CloudTaskCreditStatus,
  type CloudTaskStatus,
} from '@/lib/cloud-task-storage';
import type { GenerationRouteAudit } from '@/lib/generation-route-audit';
import {
  transitionTask,
  type TransitionTaskResult,
} from '@/lib/task-core/task-service';
import type {
  DurableTaskStatus,
} from '@/lib/task-core/task-state';
import { parseWorkspaceSourceTrace, type WorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { normalizeTaskError } from '@/lib/task-core/task-error';
import type { TaskEntryAudit } from '@/lib/task-core/entry-migration';
import {
  recordTaskLateResultAudit,
  recordTaskProjectionPending,
  type ProjectCompletedTaskInput,
} from '@/lib/asset-core/task-projector';
import {
  agentWorkspaceProjectionIdempotencyKey,
  projectAgentResultToWorkspace,
} from '@/lib/agent-runtime/workspace-results';
import {
  verifyGeneratedImageAlphaSet,
  type GeneratedImageAlphaSetVerification,
} from '@/lib/generated-image-alpha';
import { enrichCompletedImageResult } from '@/lib/asset-core/image-result-metadata';

interface ImageTaskSubmission {
  skillBilling?: {
    context: import('@/lib/skill-runtime/billing-authorization').SkillBillingContext;
    idempotencyKey: string;
  };
  taskId: string;
  userId?: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  type?: string;
  providerId?: string;
  model?: string;
  label?: string;
  persist?: boolean;
  idempotencyKey?: string;
  submissionPayload?: Record<string, unknown>;
  creditCost?: number;
  creditStatus?: CloudTaskCreditStatus;
  batchId?: string;
  slotId?: string;
  slotIndex?: number;
  deferCreditCharge?: boolean;
  taskEntryAudit?: TaskEntryAudit;
}

interface ImageTaskTerminal {
  status: Extract<CloudTaskStatus, 'completed' | 'failed' | 'cancelled' | 'timeout'>;
  imageUrl?: string;
  imageUrls?: string[];
  maskUrl?: string;
  maskUrls?: string[];
  gridImageUrl?: string;
  buttons?: unknown[];
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
  generationRouteAudit?: GenerationRouteAudit | null;
  usedModel?: string;
  modelName?: string;
  providerId?: string;
  providerName?: string;
  alphaVerification?: GeneratedImageAlphaSetVerification;
  persist?: boolean;
}

interface VideoTaskSubmission {
  taskId: string;
  userId?: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  type?: string;
  providerId?: string;
  model?: string;
  label?: string;
  creditCost?: number;
  deferCreditCharge?: boolean;
  taskEntryAudit?: TaskEntryAudit;
  submissionPayload?: Record<string, unknown>;
}

interface VideoTaskTerminal {
  status: Extract<CloudTaskStatus, 'completed' | 'failed' | 'cancelled' | 'timeout'>;
  videoUrl?: string;
  imageUrl?: string;
  videoThumbnailUrl?: string;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
}

interface VideoTaskRemotePolling {
  remoteTaskId: string;
  usedImagesEndpoint?: boolean;
}

interface ThreeDTaskSubmission {
  taskId: string;
  userId?: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  providerId?: string;
  model?: string;
  label?: string;
  creditCost?: number;
  creditStatus?: CloudTaskCreditStatus;
  taskEntryAudit?: TaskEntryAudit;
  submissionPayload?: Record<string, unknown>;
}

interface ThreeDTaskTerminal {
  status: Extract<CloudTaskStatus, 'completed' | 'failed' | 'cancelled' | 'timeout'>;
  assetUrl?: string;
  previewImageUrl?: string;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
}

interface PersistTerminalTaskInput {
  status: Extract<CloudTaskStatus, 'completed' | 'failed' | 'cancelled' | 'timeout'>;
  result?: Record<string, unknown>;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
  currentResult?: Record<string, unknown>;
  currentResultLoaded?: boolean;
}

const FAILURE_TERMINAL_FROM: DurableTaskStatus[] = [
  'created',
  'queued',
  'submitting',
  'processing',
  'uploading',
];

async function persistTerminalTask(
  taskId: string,
  input: PersistTerminalTaskInput,
): Promise<TransitionTaskResult> {
  const currentResult = input.currentResultLoaded
    ? input.currentResult
    : (await getCloudTaskById(taskId))?.result;
  const creditStatus = input.creditStatus || 'pending';
  const error = input.error
    ? normalizeTaskError(
        { code: 'LEGACY_TASK_ERROR', message: input.error },
        {
          code: 'LEGACY_TASK_ERROR',
          message: input.error,
          source: 'wujie',
          retryable: false,
        },
      )
    : undefined;
  return transitionTask({
    taskId,
    from: input.status === 'completed'
      ? ['processing']
      : FAILURE_TERMINAL_FROM,
    to: input.status,
    result: input.result === undefined
      ? currentResult
      : { ...(currentResult || {}), ...input.result },
    error,
    creditStatus,
  });
}

interface ProjectableTask {
  id: string;
  userId: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  status: string;
  result?: Record<string, unknown>;
}

function taskProjectionTarget(task: ProjectableTask): {
  workspace: 'canvas' | 'workflow' | 'chat';
  workspaceId?: string;
  sourceEntityId: string;
  parentVersionIds: string[];
  projectionMode?: 'derived' | 'revision';
  sourceTrace?: WorkspaceSourceTrace;
} {
  const payload = task.result?.submissionPayload;
  const submission = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const explicitWorkspace = submission.assetWorkspace;
  const workspace = explicitWorkspace === 'workflow' || explicitWorkspace === 'chat'
    ? explicitWorkspace
    : task.sessionId?.startsWith('workflow:')
      ? 'workflow'
      : task.sessionId?.startsWith('standalone-chat:')
        ? 'chat'
        : 'canvas';
  const explicitWorkspaceId = typeof submission.assetWorkspaceId === 'string'
    ? submission.assetWorkspaceId
    : '';
  const workspaceId = explicitWorkspaceId
    || (workspace !== 'canvas' ? task.sessionId || '' : '');
  const sourceEntityId = typeof submission.assetSourceEntityId === 'string'
    && submission.assetSourceEntityId
    ? submission.assetSourceEntityId
    : task.messageId || task.id;
  const parentVersionIds = Array.isArray(submission.assetParentVersionIds)
    ? submission.assetParentVersionIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
    : [];
  const projectionMode = submission.assetProjectionMode === 'revision'
    ? 'revision' as const
    : undefined;
  const sourceTrace = parseWorkspaceSourceTrace(submission.assetSourceTrace);
  return {
    workspace,
    ...(workspaceId ? { workspaceId } : {}),
    sourceEntityId,
    parentVersionIds,
    ...(projectionMode ? { projectionMode } : {}),
    ...(sourceTrace ? { sourceTrace } : {}),
  };
}

async function recordProjectionPendingSafely(input: {
  actorUserId: string;
  taskId: string;
  reason: string;
  retry: Omit<ProjectCompletedTaskInput, 'actorUserId' | 'taskId'>;
}): Promise<void> {
  try {
    await recordTaskProjectionPending(input);
  } catch (pendingError) {
    console.error('[task-projection] Unable to persist projection_pending audit', pendingError);
  }
}

async function projectCompletedTask(task: ProjectableTask): Promise<void> {
  if (task.status !== 'completed' || !task.userId || !task.projectId) {
    return;
  }
  const target = taskProjectionTarget(task);
  try {
    const targetWorkspaceId = target.workspaceId
      || (target.workspace === 'canvas' ? task.projectId : `${target.workspace}:${task.projectId}`);
    await projectAgentResultToWorkspace({
      actorUserId: task.userId,
      taskId: task.id,
      targetProjectId: task.projectId,
      ...target,
      idempotencyKey: agentWorkspaceProjectionIdempotencyKey({
        taskId: task.id,
        workspace: target.workspace,
        workspaceId: targetWorkspaceId,
        sourceEntityId: target.sourceEntityId,
      }),
    });
  } catch (error) {
    await recordProjectionPendingSafely({
      actorUserId: task.userId,
      taskId: task.id,
      reason: error instanceof Error ? error.message : String(error),
      retry: {
        targetProjectId: task.projectId,
        ...target,
        projectionMode: target.projectionMode ?? 'derived',
      },
    });
  }
}

async function reconcileCompletedProjection(
  terminal: TransitionTaskResult,
  urls: string[],
): Promise<void> {
  if (terminal.transitioned) {
    await projectCompletedTask(terminal.task);
    return;
  }
  if (
    urls.length === 0
    || !['failed', 'cancelled', 'timeout'].includes(terminal.task.status)
  ) {
    return;
  }
  try {
    await recordTaskLateResultAudit({
      actorUserId: terminal.task.userId,
      taskId: terminal.task.id,
      terminalStatus: terminal.task.status as 'failed' | 'cancelled' | 'timeout',
      urls,
    });
  } catch (auditError) {
    console.error('[task-projection] Unable to persist late-result audit', auditError);
  }
}

export async function projectPersistedCompletedTask(
  taskId: string,
  actorUserId: string,
): Promise<void> {
  const task = await getCloudTaskForUser(taskId, actorUserId);
  if (!task || task.status !== 'completed') return;
  await projectCompletedTask(task);
}

export async function recordImageTaskSubmitted(input: ImageTaskSubmission): Promise<boolean> {
  if (input.persist === false) return true;

  const now = Date.now();
  const slotPayload = input.slotId ? {
    batchId: input.batchId,
    slotId: input.slotId,
    slotIndex: input.slotIndex,
  } : {};
  const submissionPayload = input.submissionPayload || input.slotId
    ? { ...input.submissionPayload, ...slotPayload }
    : undefined;
  const result = submissionPayload || input.taskEntryAudit
    ? {
        ...(submissionPayload ? { submissionPayload } : {}),
        ...(input.taskEntryAudit ? { taskEntryAudit: input.taskEntryAudit } : {}),
      }
    : undefined;

  const task: import('@/lib/cloud-task-storage').CreateCloudTaskInput = {
    id: input.taskId,
    userId: input.userId || 'anonymous',
    projectId: input.projectId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    type: input.type || 'generate',
    status: input.deferCreditCharge ? 'pending' : 'processing',
    providerId: input.providerId,
    model: input.model,
    remoteTaskId: input.taskId,
    progress: input.deferCreditCharge ? 0 : 5,
    label: input.label || '生成图片',
    result,
    creditStatus: input.deferCreditCharge ? 'not-applicable' : input.creditStatus,
    creditCost: input.deferCreditCharge ? 0 : input.creditCost,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
  if (input.skillBilling) {
    const { createSkillPrepaidGeneration } = await import('@/lib/skill-runtime/prepaid-generation');
    return createSkillPrepaidGeneration(task, input.skillBilling.context, input.skillBilling.idempotencyKey);
  }
  return createCloudTask(task);
}

export async function recordImageTaskTerminal(
  taskId: string,
  input: ImageTaskTerminal,
): Promise<TransitionTaskResult | undefined> {
  if (input.persist === false) return;

  const imageUrls = Array.from(new Set([
    ...(input.imageUrls || []),
    ...(input.imageUrl ? [input.imageUrl] : []),
  ].filter((url): url is string => typeof url === 'string' && url.length > 0)));
  const maskUrls = Array.from(new Set([
    ...(input.maskUrls || []),
    ...(input.maskUrl ? [input.maskUrl] : []),
  ].filter((url): url is string => typeof url === 'string' && url.length > 0)));
  const currentTask = input.status === 'completed' && imageUrls.length > 0
    ? await getCloudTaskById(taskId)
    : null;
  const currentResultLoaded = input.status === 'completed' && imageUrls.length > 0;
  const submissionPayload = currentTask?.result?.submissionPayload as Record<string, unknown> | undefined;
  let alphaVerification = input.alphaVerification;
  if (!alphaVerification && submissionPayload?.background === 'transparent') {
    alphaVerification = await verifyGeneratedImageAlphaSet(imageUrls);
  }
  const hasResultMetadata = Boolean(input.gridImageUrl) || Boolean(input.buttons?.length);
  const transparentResultWarning = alphaVerification
    && ['opaque', 'invalid'].includes(alphaVerification.status)
    ? {
        warning: {
          code: 'TRANSPARENT_RESULT_NOT_ALPHA',
          message: '模型未返回真实透明背景，原始结果已保留。可在图片工具栏中主动选择“移除背景”。',
        },
        nextAction: {
          type: 'remove-background',
          requiresConfirmation: true,
          separatelyBilled: true,
        },
      }
    : {};
  const resultBase: Record<string, unknown> | undefined = imageUrls.length > 0 || hasResultMetadata
    ? {
        imageUrl: imageUrls[0] || '',
        imageUrls,
        maskUrl: maskUrls[0] || '',
        maskUrls,
        ...(input.gridImageUrl ? { gridImageUrl: input.gridImageUrl } : {}),
        ...(input.buttons?.length ? { buttons: input.buttons } : {}),
        ...(input.generationRouteAudit ? { generationRouteAudit: input.generationRouteAudit } : {}),
        ...(input.usedModel ? { usedModel: input.usedModel } : {}),
        ...(input.modelName ? { modelName: input.modelName } : {}),
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.providerName ? { providerName: input.providerName } : {}),
        ...(alphaVerification ? { alphaVerification } : {}),
        ...transparentResultWarning,
      }
    : undefined;
  const result = input.status === 'completed' && resultBase && imageUrls.length > 0
    ? await enrichCompletedImageResult(resultBase)
    : resultBase;

  const terminal = await persistTerminalTask(taskId, {
    status: input.status,
    result,
    error: input.error,
    creditStatus: input.creditStatus,
    currentResult: currentTask?.result,
    currentResultLoaded,
  });
  if (input.status === 'completed') {
    await reconcileCompletedProjection(terminal, imageUrls);
  }
  return terminal;
}

export async function recordVideoTaskSubmitted(input: VideoTaskSubmission): Promise<void> {
  const now = Date.now();
  const result = input.taskEntryAudit || input.submissionPayload
    ? {
        ...(input.taskEntryAudit ? { taskEntryAudit: input.taskEntryAudit } : {}),
        ...(input.submissionPayload ? { submissionPayload: input.submissionPayload } : {}),
      }
    : undefined;
  await createCloudTask({
    id: input.taskId,
    userId: input.userId || 'anonymous',
    projectId: input.projectId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    type: input.type || 'video',
    status: input.deferCreditCharge ? 'pending' : 'processing',
    providerId: input.providerId,
    model: input.model,
    remoteTaskId: input.taskId,
    progress: input.deferCreditCharge ? 0 : 5,
    label: input.label || 'Video generation',
    result,
    creditStatus: input.deferCreditCharge ? 'not-applicable' : undefined,
    creditCost: input.deferCreditCharge ? 0 : input.creditCost,
    createdAt: now,
    updatedAt: now,
  });
}

/** Stores only the remote identifier and routing flag; credentials stay in provider config. */
export async function recordVideoTaskRemotePolling(
  taskId: string,
  input: VideoTaskRemotePolling,
): Promise<void> {
  await updateCloudTask(taskId, {
    remoteTaskId: input.remoteTaskId,
    progress: 10,
    result: {
      thirdPartyTaskId: input.remoteTaskId,
      usedImagesEndpoint: input.usedImagesEndpoint === true,
    },
    mergeResult: true,
  });
}

export async function recordVideoTaskTerminal(
  taskId: string,
  input: VideoTaskTerminal,
): Promise<TransitionTaskResult> {
  const result = input.videoUrl
    ? {
      videoUrl: input.videoUrl,
      imageUrl: input.imageUrl || '',
      ...(input.videoThumbnailUrl ? { videoThumbnailUrl: input.videoThumbnailUrl } : {}),
    }
    : undefined;

  const terminal = await persistTerminalTask(taskId, {
    status: input.status,
    result,
    error: input.error,
    creditStatus: input.creditStatus,
  });
  if (input.status === 'completed') {
    await reconcileCompletedProjection(terminal, input.videoUrl ? [input.videoUrl] : []);
  }
  return terminal;
}

export async function recordThreeDTaskSubmitted(input: ThreeDTaskSubmission): Promise<void> {
  const now = Date.now();
  const result = input.taskEntryAudit || input.submissionPayload
    ? {
        ...(input.taskEntryAudit ? { taskEntryAudit: input.taskEntryAudit } : {}),
        ...(input.submissionPayload ? { submissionPayload: input.submissionPayload } : {}),
      }
    : undefined;
  await createCloudTask({
    id: input.taskId,
    userId: input.userId || 'anonymous',
    projectId: input.projectId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    type: '3d-model',
    status: 'processing',
    providerId: input.providerId,
    model: input.model,
    remoteTaskId: input.taskId,
    progress: 5,
    label: input.label || '3D model generation',
    result,
    creditCost: input.creditCost,
    creditStatus: input.creditStatus,
    createdAt: now,
    updatedAt: now,
  });
}

export async function recordThreeDTaskTerminal(
  taskId: string,
  input: ThreeDTaskTerminal,
): Promise<TransitionTaskResult> {
  const result = input.assetUrl
    ? { assetUrl: input.assetUrl, previewImageUrl: input.previewImageUrl || '' }
    : undefined;

  const terminal = await persistTerminalTask(taskId, {
    status: input.status,
    result,
    error: input.error,
    creditStatus: input.creditStatus,
  });
  if (input.status === 'completed') {
    await reconcileCompletedProjection(terminal, input.assetUrl ? [input.assetUrl] : []);
  }
  return terminal;
}

export async function recordCloudTaskCancelled(
  taskId: string,
  refunded: boolean,
): Promise<TransitionTaskResult> {
  return persistTerminalTask(taskId, {
    status: 'cancelled',
    creditStatus: refunded ? 'refunded' : 'pending',
  });
}

export function buildRecoveredTaskContext(task: CloudTask): {
  taskId: string;
  remoteTaskId: string;
  providerId?: string;
  model?: string;
  type: string;
  progress: number;
  label?: string;
  userId: string;
} {
  const result = task.result && typeof task.result === 'object'
    ? task.result as Record<string, unknown>
    : undefined;
  const acceptedProviderId = typeof result?.providerId === 'string' && result.providerId.trim()
    ? result.providerId
    : task.providerId;
  const acceptedModel = typeof result?.usedModel === 'string' && result.usedModel.trim()
    ? result.usedModel
    : typeof result?.modelName === 'string' && result.modelName.trim()
      ? result.modelName
      : task.model;
  return {
    taskId: task.id,
    remoteTaskId: task.remoteTaskId || task.id,
    providerId: acceptedProviderId,
    model: acceptedModel,
    type: task.type,
    progress: task.progress,
    label: task.label,
    userId: task.userId,
  };
}
