import 'server-only';

import { createHash } from 'node:crypto';

import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { getSafeMediaTypeFromResponse } from '@/lib/media-validation';
import { downloadPublicImage, type DownloadPublicImageOptions } from '@/lib/safe-image-download';
import { assertSafePixelDimensions, withSafeSharp } from '@/lib/safe-image-input';
import { isServerDataRootDurable, saveImageFile } from '@/lib/server-data-root';
import { uploadImageToS3Abortable } from '@/lib/s3-storage';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 12_000;
const S3_BACKUP_TIMEOUT_MS = 15_000;
const MANAGED_PREFIXES = ['/api/serve-upload/', '/uploads/'];

type Download = (
  input: string | URL,
  options?: DownloadPublicImageOptions,
) => Promise<{ buffer: Buffer; mimeType: string }>;
type Upload = (
  buffer: Buffer,
  fileName: string,
  contentType: string,
  signal?: AbortSignal,
) => Promise<string | null>;
type ReadManaged = (url: string) => Promise<{ buffer: Buffer; mimeType: string }>;
type Cleanup = (artifact: { url: string; storageKey?: string }) => Promise<void>;
type RecordCleanupFailure = (
  artifact: { url: string; storageKey?: string },
  error: unknown,
) => Promise<void>;

interface StabilizeGatewayImageResultInput {
  taskId: string;
  result: Record<string, unknown>;
  download?: Download;
  save?: typeof saveImageFile;
  upload?: Upload;
  readManaged?: ReadManaged;
  cleanup?: Cleanup;
  recordCleanupFailure?: RecordCleanupFailure;
  uploadTimeoutMs?: number;
  isDurable?: () => boolean;
}

export function isGatewayLocalStorageDurable(
  isDurable: () => boolean = isServerDataRootDurable,
  durabilityDeclaration: string | undefined = process.env.WUJIE_DATA_DIR_DURABLE,
): boolean {
  return durabilityDeclaration?.trim().toLowerCase() === 'true' && isDurable();
}

interface PersistGatewayVideoArtifactInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  upload?: Upload;
  uploadTimeoutMs?: number;
  isDurable?: () => boolean;
}

interface PersistDirectGatewayVideoResultInput {
  taskId: string;
  sourceUrl: string;
  download?: Download;
  save?: typeof saveImageFile;
  upload?: Upload;
  cleanup?: Cleanup;
  recordCleanupFailure?: RecordCleanupFailure;
  uploadTimeoutMs?: number;
  isDurable?: () => boolean;
  authorizationHeader?: string;
  authorizationHost?: string;
  allowJsonVideoUrlFallback?: boolean;
}

interface DownloadSafeVideoArtifactInput {
  sourceUrl: string;
  download?: Download;
  authorizationHeader?: string;
  authorizationHost?: string;
  allowJsonVideoUrlFallback?: boolean;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
}

const GATEWAY_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
] as const;

const MAX_VIDEO_JSON_BYTES = 1024 * 1024;

function extractVideoUrlFromJson(buffer: Buffer): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('GATEWAY_VIDEO_JSON_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GATEWAY_VIDEO_JSON_INVALID');
  }
  const record = parsed as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : undefined;
  const candidate = data?.video_url ?? data?.url ?? record.video_url ?? record.url;
  if (typeof candidate !== 'string' || candidate.length > 4_096) {
    throw new Error('GATEWAY_VIDEO_JSON_INVALID');
  }
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('GATEWAY_VIDEO_JSON_INVALID');
  }
  return url.toString();
}

export async function downloadSafeVideoArtifact(
  input: DownloadSafeVideoArtifactInput,
): Promise<{
  buffer: Buffer;
  mediaType: NonNullable<ReturnType<typeof getSafeMediaTypeFromResponse>>;
  resolvedSourceUrl: string;
}> {
  const download = input.download ?? downloadPublicImage;
  const deadlineController = new AbortController();
  const abortFromCaller = () => deadlineController.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (input.signal?.aborted) abortFromCaller();
  const deadline = setTimeout(
    () => deadlineController.abort(new Error('Gateway video download deadline exceeded')),
    input.totalTimeoutMs ?? 300_000,
  );
  const allowedMimeTypes = [
    ...GATEWAY_VIDEO_MIME_TYPES,
    ...(input.allowJsonVideoUrlFallback ? ['application/json'] as const : []),
  ];
  try {
    let resolvedSourceUrl = input.sourceUrl;
    let downloaded = await download(resolvedSourceUrl, {
      maxBytes: MAX_VIDEO_BYTES,
      timeoutMs: 120_000,
      allowedMimeTypes,
      authorizationHeader: input.authorizationHeader,
      authorizationHost: input.authorizationHost,
      maxBytesByMimeType: input.allowJsonVideoUrlFallback
        ? { 'application/json': MAX_VIDEO_JSON_BYTES }
        : undefined,
      signal: deadlineController.signal,
    });
    if (downloaded.mimeType === 'application/json') {
      resolvedSourceUrl = extractVideoUrlFromJson(downloaded.buffer);
      downloaded = await download(resolvedSourceUrl, {
        maxBytes: MAX_VIDEO_BYTES,
        timeoutMs: 120_000,
        allowedMimeTypes: [...GATEWAY_VIDEO_MIME_TYPES],
        signal: deadlineController.signal,
      });
    }
    const mediaType = getSafeMediaTypeFromResponse(downloaded.mimeType, downloaded.buffer, true);
    if (
      !mediaType
      || mediaType.kind !== 'video'
      || !GATEWAY_VIDEO_MIME_TYPES.includes(mediaType.mimeType as typeof GATEWAY_VIDEO_MIME_TYPES[number])
    ) {
      throw new Error('Gateway video MIME does not match its bytes');
    }
    return { buffer: downloaded.buffer, mediaType, resolvedSourceUrl };
  } finally {
    clearTimeout(deadline);
    input.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function persistGatewayVideoArtifact(
  input: PersistGatewayVideoArtifactInput,
): Promise<{ storageKey?: string }> {
  if (
    input.buffer.byteLength === 0
    || input.buffer.byteLength > MAX_VIDEO_BYTES
    || !/^video\/(?:mp4|webm|quicktime|x-m4v)$/u.test(input.mimeType)
    || !/^video\/[A-Za-z0-9._/-]+\.(?:m4v|mov|mp4|webm)$/u.test(input.fileName)
    || input.fileName.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('GATEWAY_ARTIFACT_PERSIST_FAILED');
  }
  const storageKey = await bestEffortUpload(
    input.upload ?? uploadImageToS3Abortable,
    input.buffer,
    input.fileName,
    input.mimeType,
    input.uploadTimeoutMs ?? S3_BACKUP_TIMEOUT_MS,
  );
  if (!storageKey && !(input.isDurable ?? isGatewayLocalStorageDurable)()) {
    throw new Error('GATEWAY_ARTIFACT_PERSIST_FAILED');
  }
  return storageKey
    ? { storageKey: storageKey.replace(/^\/+/, '') }
    : {};
}

async function cleanupDirectGatewayVideoArtifact(
  artifact: { url: string; storageKey?: string },
): Promise<void> {
  const match = artifact.url.match(
    /^\/api\/serve-upload\/(video\/([A-Za-z0-9_-]{1,128})\/([^/?#]+))$/u,
  );
  if (match) {
    const { deleteImageFile } = await import('@/lib/server-data-root');
    if (!deleteImageFile(match[3], `video/${match[2]}`)) {
      throw new Error('Gateway video local artifact cleanup failed');
    }
  }
  if (artifact.storageKey) {
    const { deleteGatewayVideoFromS3Exact } = await import('@/lib/s3-storage');
    await deleteGatewayVideoFromS3Exact(artifact.storageKey);
  }
}

export async function cleanupPersistedGatewayVideoResult(input: {
  videoUrl: string;
  storageKey?: string;
}): Promise<void> {
  const artifact = {
    url: input.videoUrl,
    ...(input.storageKey ? { storageKey: input.storageKey } : {}),
  };
  try {
    await cleanupDirectGatewayVideoArtifact(artifact);
  } catch (error) {
    await recordGatewayCleanupFailure(artifact, error);
  }
}

export async function persistDirectGatewayVideoResult(
  input: PersistDirectGatewayVideoResultInput,
): Promise<{
  videoUrl: string;
  video: {
    url: string;
    recoverySourceUrl: string;
    storageKey?: string;
    mimeType: string;
    byteSize: number;
  };
}> {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.taskId)) {
    throw new Error('GATEWAY_ARTIFACT_PERSIST_FAILED');
  }
  const download = input.download ?? downloadPublicImage;
  const save = input.save ?? saveImageFile;
  const cleanup = input.cleanup ?? cleanupDirectGatewayVideoArtifact;
  const recordCleanupFailure = input.recordCleanupFailure ?? recordGatewayCleanupFailure;
  let artifact: { url: string; storageKey?: string } | undefined;
  try {
    const downloaded = await downloadSafeVideoArtifact({
      sourceUrl: input.sourceUrl,
      download,
      authorizationHeader: input.authorizationHeader,
      authorizationHost: input.authorizationHost,
      allowJsonVideoUrlFallback: input.allowJsonVideoUrlFallback,
    });
    const { mediaType } = downloaded;
    const digest = createHash('sha256').update(input.sourceUrl).digest('hex').slice(0, 12);
    const filename = `direct-${digest}.${mediaType.extension}`;
    const videoUrl = save(downloaded.buffer, filename, `video/${input.taskId}`);
    artifact = { url: videoUrl };
    const persisted = await persistGatewayVideoArtifact({
      buffer: downloaded.buffer,
      fileName: `video/${input.taskId}/${filename}`,
      mimeType: mediaType.mimeType,
      upload: input.upload,
      uploadTimeoutMs: input.uploadTimeoutMs,
      isDurable: input.isDurable,
    });
    if (persisted.storageKey) artifact.storageKey = persisted.storageKey;
    return {
      videoUrl,
      video: {
        url: videoUrl,
        recoverySourceUrl: downloaded.resolvedSourceUrl,
        ...(persisted.storageKey ? { storageKey: persisted.storageKey } : {}),
        mimeType: mediaType.mimeType,
        byteSize: downloaded.buffer.byteLength,
      },
    };
  } catch (error) {
    if (artifact) {
      try {
        await cleanup(artifact);
      } catch (cleanupError) {
        await recordCleanupFailure(artifact, cleanupError).catch(recordError => {
          console.error('[media-gateway] Unable to record direct video cleanup failure', {
            taskId: input.taskId,
            error: recordError instanceof Error ? recordError.message : String(recordError),
          });
        });
      }
    }
    throw new Error('GATEWAY_ARTIFACT_PERSIST_FAILED', { cause: error });
  }
}

async function bestEffortUpload(
  upload: Upload,
  buffer: Buffer,
  filename: string,
  mimeType: string,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      upload(buffer, filename, mimeType, controller.signal).catch(() => null),
      new Promise<null>(resolve => {
        timeout = setTimeout(() => {
          controller.abort(new Error('S3 artifact upload timed out'));
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function isGatewayImageResult(result: Record<string, unknown>): boolean {
  const payload = result.submissionPayload;
  return Boolean(
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && (payload as Record<string, unknown>).sourceChannel === 'gateway',
  );
}

async function validateDownloadedImage(
  buffer: Buffer,
  declaredMimeType: string,
): Promise<{ mimeType: string; extension: string }> {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Gateway image exceeds the byte budget');
  }
  const mediaType = getSafeMediaTypeFromResponse(declaredMimeType, buffer, false);
  if (!mediaType || mediaType.kind !== 'image') {
    throw new Error('Gateway image MIME does not match its bytes');
  }
  const metadata = await withSafeSharp(
    buffer,
    { maxPixels: MAX_IMAGE_PIXELS },
    pipeline => pipeline.metadata(),
  );
  assertSafePixelDimensions(metadata.width, metadata.height, MAX_IMAGE_PIXELS);
  return { mimeType: mediaType.mimeType, extension: mediaType.extension };
}

function managedUrl(url: string): boolean {
  return MANAGED_PREFIXES.some(prefix => url.startsWith(prefix));
}

function mimeTypeFromManagedUrl(url: string): string {
  const pathname = url.split(/[?#]/, 1)[0].toLowerCase();
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.bmp')) return 'image/bmp';
  if (pathname.endsWith('.avif')) return 'image/avif';
  return 'image/png';
}

async function readManagedImage(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  return {
    buffer: await fetchImageBuffer(url),
    mimeType: mimeTypeFromManagedUrl(url),
  };
}

async function cleanupGatewayArtifact(artifact: { url: string; storageKey?: string }): Promise<void> {
  const match = artifact.url.match(/^\/api\/serve-upload\/gateway\/([^/?#]+)$/u);
  if (match) {
    const { deleteImageFile } = await import('@/lib/server-data-root');
    if (!deleteImageFile(match[1], 'gateway')) {
      throw new Error('Gateway local artifact cleanup failed');
    }
  }
  if (artifact.storageKey) {
    const { deleteGatewayImageFromS3Exact } = await import('@/lib/s3-storage');
    await deleteGatewayImageFromS3Exact(artifact.storageKey);
  }
}

async function recordGatewayCleanupFailure(
  artifact: { url: string; storageKey?: string },
  error: unknown,
): Promise<void> {
  const match = artifact.url.match(
    /^\/api\/serve-upload\/((?:gateway\/[^/?#]+)|(?:video\/[A-Za-z0-9_-]{1,128}\/[^/?#]+))$/u,
  );
  const { recordAssetCleanupFailure } = await import('@/lib/asset-core/cleanup-outbox');
  await recordAssetCleanupFailure({
    rootId: 'server-data',
    ...(match ? { localPath: match[1] } : {}),
    ...(artifact.storageKey ? { storageKey: artifact.storageKey } : {}),
    lastError: error instanceof Error ? error.message : String(error),
  });
}

function imageUrls(result: Record<string, unknown>): string[] {
  return Array.from(new Set([
    ...(Array.isArray(result.imageUrls) ? result.imageUrls : []),
    result.imageUrl,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

export async function stabilizeGatewayImageResult(
  input: StabilizeGatewayImageResultInput,
): Promise<Record<string, unknown>> {
  if (!isGatewayImageResult(input.result)) return structuredClone(input.result);
  const urls = imageUrls(input.result);
  if (urls.length === 0) return structuredClone(input.result);

  const download = input.download ?? downloadPublicImage;
  const readManaged = input.readManaged ?? readManagedImage;
  const save = input.save ?? saveImageFile;
  const upload = input.upload ?? uploadImageToS3Abortable;
  const cleanup = input.cleanup ?? cleanupGatewayArtifact;
  const recordCleanupFailure = input.recordCleanupFailure ?? recordGatewayCleanupFailure;
  const uploadTimeoutMs = input.uploadTimeoutMs ?? S3_BACKUP_TIMEOUT_MS;
  const isDurable = input.isDurable ?? isGatewayLocalStorageDurable;
  const createdArtifacts: Array<{ url: string; storageKey?: string }> = [];
  try {
    const images: Array<{
      url: string;
      recoverySourceUrl?: string;
      storageKey?: string;
      mimeType: string;
      byteSize: number;
    }> = [];
    for (const [index, sourceUrl] of urls.entries()) {
      const isManaged = managedUrl(sourceUrl);
      const downloaded = isManaged
        ? await readManaged(sourceUrl)
        : await download(sourceUrl, {
            maxBytes: MAX_IMAGE_BYTES,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
          });
      const imageType = await validateDownloadedImage(downloaded.buffer, downloaded.mimeType);
      const digest = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 12);
      const filename = `${input.taskId}-${index}-${digest}.${imageType.extension}`;
      const url = isManaged ? sourceUrl : save(downloaded.buffer, filename, 'gateway');
      const cleanupTarget = { url } as { url: string; storageKey?: string };
      if (!isManaged) createdArtifacts.push(cleanupTarget);
      const storageKey = await bestEffortUpload(
        upload,
        downloaded.buffer,
        `gateway/${filename}`,
        imageType.mimeType,
        uploadTimeoutMs,
      );
      if (!storageKey && !isDurable()) {
        throw new Error('Gateway image could not be persisted durably');
      }
      if (storageKey) {
        cleanupTarget.storageKey = storageKey.replace(/^\/+/, '');
        if (isManaged) createdArtifacts.push(cleanupTarget);
      }
      const artifact = {
        url,
        ...(!isManaged ? { recoverySourceUrl: sourceUrl } : {}),
        ...(storageKey ? { storageKey: storageKey.replace(/^\/+/, '') } : {}),
        mimeType: imageType.mimeType,
        byteSize: downloaded.buffer.byteLength,
      };
      images.push(artifact);
    }
    const stableUrls = images.map(image => image.url);
    return {
      ...structuredClone(input.result),
      imageUrl: stableUrls[0],
      imageUrls: stableUrls,
      images,
    };
  } catch (error) {
    const cleanupResults = await Promise.allSettled(
      createdArtifacts.map(artifact => cleanup(artifact)),
    );
    await Promise.all(cleanupResults.map(async (result, index) => {
      if (result.status !== 'rejected') return;
      try {
        await recordCleanupFailure(createdArtifacts[index], result.reason);
      } catch (recordError) {
        console.error('[media-gateway] Unable to record artifact cleanup failure', {
          taskId: input.taskId,
          error: recordError instanceof Error ? recordError.message : String(recordError),
        });
      }
    }));
    throw new Error('GATEWAY_ARTIFACT_PERSIST_FAILED', { cause: error });
  }
}
