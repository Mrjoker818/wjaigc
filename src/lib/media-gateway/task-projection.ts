import { isIP } from 'node:net';

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
const MAX_MEDIA_URL_BYTES = 2_048;
const MAX_MEDIA_URLS = 16;
const MAX_PROJECTED_RESULT_BYTES = 16_384;
const CONTROLLED_MEDIA_PATHS = ['/api/serve-upload/', '/uploads/'] as const;
const SENSITIVE_QUERY_MARKERS = [
  'auth', 'credential', 'password', 'passwd', 'policy', 'secret', 'signature',
  'signed', 'token', 'apikey', 'accesskey', 'xamz', 'xgoog',
] as const;
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

function isPublicIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value))) return false;
  const [a, b] = octets;
  return !(
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0)
    || a >= 224
  );
}

function ipv6Words(hostname: string): number[] | null {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    .map(value => Number.parseInt(value, 16));
  return words.length === 8 && words.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)
    ? words
    : null;
}

function isPublicIpv6(hostname: string): boolean {
  const words = ipv6Words(hostname);
  if (!words) return false;
  if ((words[0] & 0xe000) !== 0x2000) return false;
  return !(words[0] === 0x2001 && words[1] === 0x0db8);
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPublicIpv4(normalized);
  if (ipVersion === 6) return isPublicIpv6(normalized);
  return normalized.includes('.')
    && !normalized.endsWith('.localhost')
    && !normalized.endsWith('.local')
    && !normalized.endsWith('.internal')
    && !normalized.endsWith('.home')
    && !normalized.endsWith('.lan')
    && !normalized.endsWith('.test')
    && !normalized.endsWith('.example')
    && !normalized.endsWith('.invalid');
}

function hasSafeQuery(url: URL): boolean {
  return [...url.searchParams.keys()].every((key) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized !== 'sig'
      && !SENSITIVE_QUERY_MARKERS.some(marker => normalized.includes(marker));
  });
}

function isMediaPath(pathname: string, kind: 'image' | 'video'): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return false;
  const segments = decoded.split('/');
  if (segments.includes('.') || segments.includes('..')) return false;
  return (kind === 'image' ? IMAGE_EXTENSION : VIDEO_EXTENSION).test(decoded);
}

function safeMediaUrl(value: unknown, kind: 'image' | 'video'): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > MAX_MEDIA_URL_BYTES) {
    return undefined;
  }
  const relative = value.startsWith('/') && !value.startsWith('//');
  let url: URL;
  try {
    url = new URL(value, 'https://gateway.invalid');
  } catch {
    return undefined;
  }
  if (url.hash || url.username || url.password || !hasSafeQuery(url) || !isMediaPath(url.pathname, kind)) {
    return undefined;
  }
  if (relative) {
    return CONTROLLED_MEDIA_PATHS.some(prefix => url.pathname.startsWith(prefix)) ? value : undefined;
  }
  return url.protocol === 'https:' && isPublicHostname(url.hostname) ? value : undefined;
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
  await getGatewayTaskProjection(principal, taskId);
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
    confirmed = await getGatewayTaskProjection(principal, taskId);
  } catch {
    throw unavailable();
  }
  if (confirmed.status === 'cancelled') return { kind: 'cancelled', task: confirmed };
  if (['completed', 'failed', 'timeout'].includes(confirmed.status)) {
    return { kind: 'conflict', status: confirmed.status };
  }
  throw unavailable();
}
