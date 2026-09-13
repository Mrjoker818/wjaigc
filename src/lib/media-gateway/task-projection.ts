import { getInternalRequestHeaders } from '@/lib/api-auth';
import {
  getCloudTaskForUser,
  type CloudTask,
  type CloudTaskStatus,
} from '@/lib/cloud-task-storage';
import type { GatewayPrincipal } from '@/lib/media-gateway/key-service';
import { GatewayError } from '@/lib/media-gateway/types';

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PUBLIC_TASK_STATUSES = new Set<CloudTaskStatus>([
  'queued', 'pending', 'processing', 'completed', 'failed', 'cancelled', 'timeout',
]);
const PUBLIC_STRING_RESULT_FIELDS = [
  'imageUrl',
  'videoUrl',
  'videoThumbnailUrl',
  'maskUrl',
  'gridImageUrl',
  'mediaType',
  'mimeType',
  'format',
  'aspectRatio',
] as const;
const PUBLIC_STRING_ARRAY_RESULT_FIELDS = ['imageUrls', 'maskUrls'] as const;
const PUBLIC_NUMBER_RESULT_FIELDS = ['width', 'height', 'duration'] as const;
const INTERNAL_CANCEL_TIMEOUT_MS = 30_000;

export interface GatewayTaskProjection {
  taskId: string;
  status: CloudTaskStatus;
  progress: number;
  providerId?: string;
  modelId?: string;
  result: Record<string, unknown>;
  error?: string;
  previewUrl?: string;
  thumbnailUrls: Record<string, string>;
}

export type GatewayTaskCancellation =
  | { kind: 'cancelled'; task: GatewayTaskProjection }
  | { kind: 'conflict'; status: CloudTaskStatus };

function taskNotFound(): GatewayError {
  return new GatewayError('GATEWAY_TASK_NOT_FOUND', 404, 'Gateway task was not found');
}

function unavailable(): GatewayError {
  return new GatewayError(
    'GATEWAY_INTERNAL_UNAVAILABLE',
    503,
    'Media gateway task service is unavailable',
    true,
  );
}

function publicResult(result: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!result) return {};
  const projected: Record<string, unknown> = {};
  for (const field of PUBLIC_STRING_RESULT_FIELDS) {
    if (typeof result[field] === 'string') projected[field] = result[field];
  }
  for (const field of PUBLIC_STRING_ARRAY_RESULT_FIELDS) {
    if (Array.isArray(result[field]) && result[field].every(value => typeof value === 'string')) {
      projected[field] = [...result[field]];
    }
  }
  for (const field of PUBLIC_NUMBER_RESULT_FIELDS) {
    if (typeof result[field] === 'number' && Number.isFinite(result[field])) {
      projected[field] = result[field];
    }
  }
  return projected;
}

function publicError(status: CloudTaskStatus): string | undefined {
  if (status === 'failed') return 'Task failed';
  if (status === 'cancelled') return 'Task was cancelled';
  if (status === 'timeout') return 'Task timed out';
  return undefined;
}

function projectTask(task: CloudTask): GatewayTaskProjection {
  const result = publicResult(task.result);
  const previewUrl = [result.videoThumbnailUrl, result.imageUrl, result.videoUrl]
    .find(value => typeof value === 'string' && value.length > 0) as string | undefined;
  return {
    taskId: task.id,
    status: task.status,
    progress: Math.max(0, Math.min(100, Number.isFinite(task.progress) ? task.progress : 0)),
    ...(task.providerId ? { providerId: task.providerId } : {}),
    ...(task.model ? { modelId: task.model } : {}),
    result,
    ...(publicError(task.status) ? { error: publicError(task.status) } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    thumbnailUrls: {},
  };
}

function validStatus(value: unknown): value is CloudTaskStatus {
  return typeof value === 'string' && PUBLIC_TASK_STATUSES.has(value as CloudTaskStatus);
}

export async function getGatewayTaskProjection(
  principal: GatewayPrincipal,
  taskId: string,
): Promise<GatewayTaskProjection> {
  if (!TASK_ID_PATTERN.test(taskId)) throw taskNotFound();
  const task = await getCloudTaskForUser(taskId, principal.userId);
  if (!task) throw taskNotFound();
  return projectTask(task);
}

export async function cancelGatewayTask(
  principal: GatewayPrincipal,
  taskId: string,
): Promise<GatewayTaskCancellation> {
  const current = await getGatewayTaskProjection(principal, taskId);
  let response: Response;
  try {
    response = await fetch(
      `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/cancel-task`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(await getInternalRequestHeaders(principal.userId, 'user')),
        },
        body: JSON.stringify({ taskId }),
        signal: AbortSignal.timeout(INTERNAL_CANCEL_TIMEOUT_MS),
      },
    );
  } catch {
    throw unavailable();
  }

  if (response.status === 404) throw taskNotFound();
  if (response.status === 409) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const status = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).status
      : undefined;
    return { kind: 'conflict', status: validStatus(status) ? status : current.status };
  }
  if (!response.ok) throw unavailable();
  return { kind: 'cancelled', task: await getGatewayTaskProjection(principal, taskId) };
}
