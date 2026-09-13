import { getInternalRequestHeaders } from '@/lib/api-auth';
import {
  getCloudTaskForUser,
  type CloudTask,
  type CloudTaskStatus,
} from '@/lib/cloud-task-storage';
import { getPool } from '@/lib/db-client';
import type { GatewayPrincipal } from '@/lib/media-gateway/key-service';
import { GatewayError } from '@/lib/media-gateway/types';

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PUBLIC_TASK_STATUSES = new Set<CloudTaskStatus>([
  'queued', 'pending', 'processing', 'completed', 'failed', 'cancelled', 'timeout',
]);
const MAX_MEDIA_URL_BYTES = 2_048;
const MAX_MEDIA_URLS = 16;
const MAX_PROJECTED_RESULT_BYTES = 16_384;
const CONTROLLED_MEDIA_PATHS = ['/api/serve-upload/', '/uploads/'] as const;
const PUBLIC_MEDIA_HOSTS = new Set(['cdn.openai.com', 'media.openai.com']);
const MAX_PERCENT_DECODE_ROUNDS = 4;
const DANGEROUS_ENCODED_PATH = /%(?:0[0-9a-f]|1[0-9a-f]|2e|2f|5c|7f)/i;
const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i;
const VIDEO_EXTENSION = /\.(?:m4v|mkv|mov|mp4|webm)$/i;
const PUBLIC_MIME_TYPE = /^(?:image\/(?:avif|bmp|gif|jpeg|png|svg\+xml|tiff|webp)|video\/(?:mp4|quicktime|webm))$/;
const PUBLIC_FORMATS = new Set([
  'avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp',
  'm4v', 'mkv', 'mov', 'mp4', 'webm',
]);
const INTERNAL_CANCEL_TIMEOUT_MS = 30_000;

export interface GatewayTaskProjection {
  taskId: string;
  status: CloudTaskStatus;
  progress: number;
  providerId?: string;
  modelId?: string;
  result: Record<string, unknown>;
  error?: string;
  assetVersionId?: string;
  previewUrl?: string;
  downloadUrl?: string;
  thumbnailUrls?: Partial<Record<'256' | '512', string>>;
}

interface ThumbnailVariantRow {
  size: number;
  file_url: string;
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

function decodeMediaPath(pathname: string): string | undefined {
  let decoded = pathname;
  for (let round = 0; round < MAX_PERCENT_DECODE_ROUNDS; round += 1) {
    if (DANGEROUS_ENCODED_PATH.test(decoded)) return undefined;
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return undefined;
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  return DANGEROUS_ENCODED_PATH.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)
    ? undefined
    : decoded;
}

function safeMediaPath(pathname: string, kind: 'image' | 'video'): string | undefined {
  const decoded = decodeMediaPath(pathname);
  if (!decoded || decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) return undefined;
  const segments = decoded.split('/');
  if (segments.includes('.') || segments.includes('..')) return undefined;
  return (kind === 'image' ? IMAGE_EXTENSION : VIDEO_EXTENSION).test(decoded)
    ? decoded
    : undefined;
}

function safeMediaUrl(value: unknown, kind: 'image' | 'video'): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > MAX_MEDIA_URL_BYTES) {
    return undefined;
  }
  if (value.includes('?') || value.includes('#')) return undefined;
  const relative = value.startsWith('/') && !value.startsWith('//');
  if (relative) {
    const mediaPath = safeMediaPath(value, kind);
    return mediaPath && CONTROLLED_MEDIA_PATHS.some(prefix => mediaPath.startsWith(prefix))
      ? value
      : undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const mediaPath = safeMediaPath(url.pathname, kind);
  if (url.search || url.hash || url.username || url.password || !mediaPath) {
    return undefined;
  }
  return url.protocol === 'https:' && PUBLIC_MEDIA_HOSTS.has(url.hostname) ? value : undefined;
}

function safeMediaArray(value: unknown, kind: 'image' | 'video'): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_MEDIA_URLS) return undefined;
  const projected = value.map(entry => safeMediaUrl(entry, kind));
  return projected.every((entry): entry is string => entry !== undefined) ? projected : undefined;
}

function publicResult(result: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!result) return {};
  const projected: Record<string, unknown> = {};
  for (const field of ['imageUrl', 'videoThumbnailUrl', 'maskUrl', 'gridImageUrl'] as const) {
    const value = safeMediaUrl(result[field], 'image');
    if (value) projected[field] = value;
  }
  const videoUrl = safeMediaUrl(result.videoUrl, 'video');
  if (videoUrl) projected.videoUrl = videoUrl;
  for (const field of ['imageUrls', 'maskUrls'] as const) {
    const value = safeMediaArray(result[field], 'image');
    if (value) projected[field] = value;
  }
  if (result.mediaType === 'image' || result.mediaType === 'video') projected.mediaType = result.mediaType;
  if (typeof result.mimeType === 'string' && PUBLIC_MIME_TYPE.test(result.mimeType)) {
    projected.mimeType = result.mimeType;
  }
  if (typeof result.format === 'string' && PUBLIC_FORMATS.has(result.format.toLowerCase())) {
    projected.format = result.format.toLowerCase();
  }
  if (typeof result.aspectRatio === 'string' && /^\d{1,3}:\d{1,3}$/.test(result.aspectRatio)) {
    projected.aspectRatio = result.aspectRatio;
  }
  for (const field of ['width', 'height'] as const) {
    if (Number.isInteger(result[field]) && Number(result[field]) > 0 && Number(result[field]) <= 32_768) {
      projected[field] = result[field];
    }
  }
  if (typeof result.duration === 'number' && Number.isFinite(result.duration)
    && result.duration >= 0 && result.duration <= 86_400) {
    projected.duration = result.duration;
  }
  return Buffer.byteLength(JSON.stringify(projected)) <= MAX_PROJECTED_RESULT_BYTES ? projected : {};
}

function publicError(status: CloudTaskStatus): string | undefined {
  if (status === 'failed') return 'Task failed';
  if (status === 'cancelled') return 'Task was cancelled';
  if (status === 'timeout') return 'Task timed out';
  return undefined;
}

function publicIdentifier(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value) <= 200
    && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

function projectedAssetVersionId(result: Record<string, unknown> | undefined): string | undefined {
  const assetProjection = result?.assetProjection;
  if (assetProjection && typeof assetProjection === 'object' && !Array.isArray(assetProjection)) {
    const versionIds = (assetProjection as Record<string, unknown>).versionIds;
    const projected = Array.isArray(versionIds) ? publicIdentifier(versionIds[0]) : undefined;
    if (projected) return projected;
  }
  return publicIdentifier(result?.assetVersionId);
}

async function ownsAssetVersion(
  assetVersionId: string,
  ownerId: string,
  projectId: string | undefined,
): Promise<boolean> {
  if (!projectId) return false;
  try {
    const result = await getPool().query(
      `SELECT id
       FROM wujie_asset_versions
       WHERE id = $1 AND owner_id = $2 AND project_id = $3`,
      [assetVersionId, ownerId, projectId],
    );
    return (result.rowCount ?? result.rows.length) === 1;
  } catch {
    return false;
  }
}

function projectTask(task: CloudTask): GatewayTaskProjection {
  if (!validStatus(task.status)) throw unavailable();
  const result = publicResult(task.result);
  const previewUrl = [result.videoThumbnailUrl, result.imageUrl, result.videoUrl]
    .find(value => typeof value === 'string' && value.length > 0) as string | undefined;
  const providerId = publicIdentifier(task.providerId);
  const modelId = publicIdentifier(task.model);
  return {
    taskId: task.id,
    status: task.status,
    progress: Math.max(0, Math.min(100, Number.isFinite(task.progress) ? task.progress : 0)),
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
    result,
    ...(publicError(task.status) ? { error: publicError(task.status) } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    thumbnailUrls: {},
  };
}

async function readyThumbnailUrls(
  assetVersionId: string,
  ownerId: string,
): Promise<GatewayTaskProjection['thumbnailUrls']> {
  try {
    const result = await getPool().query<ThumbnailVariantRow>(
      `SELECT size, file_url
       FROM wujie_asset_thumbnail_variants
       WHERE asset_version_id = $1
         AND owner_id = $2
         AND status = 'ready'
         AND size IN (256, 512)`,
      [assetVersionId, ownerId],
    );
    const thumbnailUrls: NonNullable<GatewayTaskProjection['thumbnailUrls']> = {};
    for (const row of result.rows) {
      if (row.size !== 256 && row.size !== 512) continue;
      const url = safeMediaUrl(row.file_url, 'image');
      if (url) thumbnailUrls[String(row.size) as '256' | '512'] = url;
    }
    return Object.keys(thumbnailUrls).length > 0 ? thumbnailUrls : undefined;
  } catch {
    return undefined;
  }
}

function validStatus(value: unknown): value is CloudTaskStatus {
  return typeof value === 'string' && PUBLIC_TASK_STATUSES.has(value as CloudTaskStatus);
}

export async function getGatewayTaskProjection(
  principal: GatewayPrincipal,
  taskId: string,
): Promise<GatewayTaskProjection> {
  const { task, projection } = await readGatewayTaskWithoutThumbnails(principal, taskId);
  if (projection.status !== 'completed') return projection;
  const assetVersionId = projectedAssetVersionId(task.result);
  if (!assetVersionId) return projection;
  if (!await ownsAssetVersion(assetVersionId, principal.userId, task.projectId)) return projection;
  const downloadUrl = [projection.result.imageUrl, projection.result.videoUrl]
    .find(value => typeof value === 'string' && value.length > 0) as string | undefined;
  const thumbnailUrls = await readyThumbnailUrls(assetVersionId, principal.userId);
  if (!thumbnailUrls) {
    return {
      ...projection,
      assetVersionId,
      ...(downloadUrl ? { downloadUrl } : {}),
      thumbnailUrls: undefined,
    };
  }
  const previewUrl = thumbnailUrls?.['512'] || thumbnailUrls?.['256'] || projection.previewUrl;
  return {
    ...projection,
    assetVersionId,
    ...(previewUrl ? { previewUrl } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    thumbnailUrls,
  };
}

async function readGatewayTaskWithoutThumbnails(
  principal: GatewayPrincipal,
  taskId: string,
): Promise<{ task: CloudTask; projection: GatewayTaskProjection }> {
  if (!TASK_ID_PATTERN.test(taskId)) throw taskNotFound();
  const task = await getCloudTaskForUser(taskId, principal.userId);
  if (!task) throw taskNotFound();
  return { task, projection: projectTask(task) };
}

export async function cancelGatewayTask(
  principal: GatewayPrincipal,
  taskId: string,
): Promise<GatewayTaskCancellation> {
  await readGatewayTaskWithoutThumbnails(principal, taskId);
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
  if (!response.ok && response.status !== 409) throw unavailable();

  let confirmed: GatewayTaskProjection;
  try {
    confirmed = (await readGatewayTaskWithoutThumbnails(principal, taskId)).projection;
  } catch {
    throw unavailable();
  }
  if (confirmed.status === 'cancelled') return { kind: 'cancelled', task: confirmed };
  if (['completed', 'failed', 'timeout'].includes(confirmed.status)) {
    return { kind: 'conflict', status: confirmed.status };
  }
  throw unavailable();
}
