import {
  createCloudTask,
  updateCloudTask,
  type CloudTaskCreditStatus,
  type CloudTaskStatus,
  type CloudTask,
} from '@/lib/cloud-task-storage';

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
}

interface ImageTaskTerminal {
  status: Extract<CloudTaskStatus, 'completed' | 'failed' | 'cancelled' | 'timeout'>;
  imageUrl?: string;
  maskUrl?: string;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
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

export async function recordImageTaskSubmitted(input: ImageTaskSubmission): Promise<void> {
  if (input.persist === false) return;

  const now = Date.now();
  await createCloudTask({
    id: input.taskId,
    userId: input.userId || 'anonymous',
    projectId: input.projectId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    type: input.type || 'generate',
    status: 'processing',
    providerId: input.providerId,
    model: input.model,
    remoteTaskId: input.taskId,
    progress: 5,
    label: input.label || '生成图片',
    createdAt: now,
    updatedAt: now,
  });
}

export async function recordImageTaskTerminal(taskId: string, input: ImageTaskTerminal): Promise<void> {
  if (input.persist === false) return;

  const result = input.imageUrl
    ? { imageUrl: input.imageUrl, maskUrl: input.maskUrl || '' }
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
