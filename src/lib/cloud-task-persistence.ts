import {
  createCloudTask,
  updateCloudTask,
  type CloudTaskCreditStatus,
  type CloudTaskStatus,
  type CloudTask,
} from '@/lib/cloud-task-storage';
import type { GenerationRouteAudit } from '@/lib/generation-route-audit';

interface ImageTaskSubmission {
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
  batchId?: string;
  slotId?: string;
  slotIndex?: number;
  deferCreditCharge?: boolean;
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
  persist?: boolean;
}

interface VideoTaskSubmission {
  taskId: string;
  userId?: string;
  projectId?: string;
  type?: string;
  providerId?: string;
  model?: string;
  label?: string;
  creditCost?: number;
}

interface VideoTaskTerminal {
  status: Extract<CloudTaskStatus, 'completed' | 'failed' | 'cancelled' | 'timeout'>;
  videoUrl?: string;
  imageUrl?: string;
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
  providerId?: string;
  model?: string;
  label?: string;
}

interface ThreeDTaskTerminal {
  status: Extract<CloudTaskStatus, 'completed' | 'failed' | 'cancelled' | 'timeout'>;
  assetUrl?: string;
  previewImageUrl?: string;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
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

  return createCloudTask({
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
    result: submissionPayload ? { submissionPayload } : undefined,
    creditStatus: input.deferCreditCharge ? 'not-applicable' : undefined,
    creditCost: input.deferCreditCharge ? 0 : input.creditCost,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  });
}

export async function recordImageTaskTerminal(taskId: string, input: ImageTaskTerminal): Promise<void> {
  if (input.persist === false) return;

  const imageUrls = Array.from(new Set([
    ...(input.imageUrls || []),
    ...(input.imageUrl ? [input.imageUrl] : []),
  ].filter((url): url is string => typeof url === 'string' && url.length > 0)));
  const maskUrls = Array.from(new Set([
    ...(input.maskUrls || []),
    ...(input.maskUrl ? [input.maskUrl] : []),
  ].filter((url): url is string => typeof url === 'string' && url.length > 0)));
  const hasResultMetadata = Boolean(input.gridImageUrl) || Boolean(input.buttons?.length);
  const result = imageUrls.length > 0 || hasResultMetadata
    ? {
        imageUrl: imageUrls[0] || '',
        imageUrls,
        maskUrl: maskUrls[0] || '',
        maskUrls,
        ...(input.gridImageUrl ? { gridImageUrl: input.gridImageUrl } : {}),
        ...(input.buttons?.length ? { buttons: input.buttons } : {}),
        ...(input.generationRouteAudit ? { generationRouteAudit: input.generationRouteAudit } : {}),
      }
    : undefined;

  await updateCloudTask(taskId, {
    status: input.status,
    progress: input.status === 'completed' ? 100 : 0,
    result,
    error: input.error,
    creditStatus: input.creditStatus || 'pending',
  });
}

export async function recordVideoTaskSubmitted(input: VideoTaskSubmission): Promise<void> {
  const now = Date.now();
  await createCloudTask({
    id: input.taskId,
    userId: input.userId || 'anonymous',
    projectId: input.projectId,
    type: input.type || 'video',
    status: 'processing',
    providerId: input.providerId,
    model: input.model,
    remoteTaskId: input.taskId,
    progress: 5,
    label: input.label || 'Video generation',
    creditCost: input.creditCost,
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
  });
}

export async function recordVideoTaskTerminal(taskId: string, input: VideoTaskTerminal): Promise<void> {
  const result = input.videoUrl
    ? { videoUrl: input.videoUrl, imageUrl: input.imageUrl || '' }
    : undefined;

  await updateCloudTask(taskId, {
    status: input.status,
    progress: input.status === 'completed' ? 100 : 0,
    result,
    error: input.error,
    creditStatus: input.creditStatus || 'pending',
  });
}

export async function recordThreeDTaskSubmitted(input: ThreeDTaskSubmission): Promise<void> {
  const now = Date.now();
  await createCloudTask({
    id: input.taskId,
    userId: input.userId || 'anonymous',
    type: '3d-model',
    status: 'processing',
    providerId: input.providerId,
    model: input.model,
    remoteTaskId: input.taskId,
    progress: 5,
    label: input.label || '3D model generation',
    createdAt: now,
    updatedAt: now,
  });
}

export async function recordThreeDTaskTerminal(taskId: string, input: ThreeDTaskTerminal): Promise<void> {
  const result = input.assetUrl
    ? { assetUrl: input.assetUrl, previewImageUrl: input.previewImageUrl || '' }
    : undefined;

  await updateCloudTask(taskId, {
    status: input.status,
    progress: input.status === 'completed' ? 100 : 0,
    result,
    error: input.error,
    creditStatus: input.creditStatus || 'pending',
  });
}

export async function recordCloudTaskCancelled(taskId: string, refunded: boolean): Promise<void> {
  await updateCloudTask(taskId, {
    status: 'cancelled',
    progress: 0,
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
  return {
    taskId: task.id,
    remoteTaskId: task.remoteTaskId || task.id,
    providerId: task.providerId,
    model: task.model,
    type: task.type,
    progress: task.progress,
    label: task.label,
    userId: task.userId,
  };
}
