import 'server-only';

import { createHash } from 'node:crypto';

import { downloadPublicImage, type DownloadPublicImageOptions } from '@/lib/safe-image-download';
import { saveImageFile } from '@/lib/server-data-root';
import { uploadImageToS3 } from '@/lib/s3-storage';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 12_000;
const S3_BACKUP_TIMEOUT_MS = 2_000;
const MANAGED_PREFIXES = ['/api/serve-upload/', '/uploads/'];

type Download = (
  input: string | URL,
  options?: DownloadPublicImageOptions,
) => Promise<{ buffer: Buffer; mimeType: string }>;

interface StabilizeGatewayImageResultInput {
  taskId: string;
  result: Record<string, unknown>;
  download?: Download;
  save?: typeof saveImageFile;
  upload?: typeof uploadImageToS3;
  uploadTimeoutMs?: number;
}

async function bestEffortUpload(
  upload: typeof uploadImageToS3,
  buffer: Buffer,
  filename: string,
  mimeType: string,
  timeoutMs: number,
): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      upload(buffer, filename, mimeType).catch(() => null),
      new Promise<null>(resolve => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isGatewayResult(result: Record<string, unknown>): boolean {
  const payload = result.submissionPayload;
  return Boolean(
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && (payload as Record<string, unknown>).sourceChannel === 'gateway',
  );
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/avif') return 'avif';
  return 'png';
}

function managedUrl(url: string): boolean {
  return MANAGED_PREFIXES.some(prefix => url.startsWith(prefix));
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
  if (!isGatewayResult(input.result)) return structuredClone(input.result);
  const urls = imageUrls(input.result);
  if (urls.length === 0 || urls.every(managedUrl)) return structuredClone(input.result);

  const download = input.download ?? downloadPublicImage;
  const save = input.save ?? saveImageFile;
  const upload = input.upload ?? uploadImageToS3;
  const uploadTimeoutMs = input.uploadTimeoutMs ?? S3_BACKUP_TIMEOUT_MS;
  try {
    const images = await Promise.all(urls.map(async (sourceUrl, index) => {
      if (managedUrl(sourceUrl)) return { url: sourceUrl };
      const downloaded = await download(sourceUrl, {
        maxBytes: MAX_IMAGE_BYTES,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      });
      const digest = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 12);
      const filename = `${input.taskId}-${index}-${digest}.${extensionForMime(downloaded.mimeType)}`;
      const url = save(downloaded.buffer, filename, 'gateway');
      const storageKey = await bestEffortUpload(
        upload,
        downloaded.buffer,
        `gateway/${filename}`,
        downloaded.mimeType,
        uploadTimeoutMs,
      );
      return {
        url,
        recoverySourceUrl: sourceUrl,
        ...(storageKey ? { storageKey: storageKey.replace(/^\/+/, '') } : {}),
        mimeType: downloaded.mimeType,
        byteSize: downloaded.buffer.byteLength,
      };
    }));
    const stableUrls = images.map(image => image.url);
    return {
      ...structuredClone(input.result),
      imageUrl: stableUrls[0],
      imageUrls: stableUrls,
      images,
    };
  } catch (error) {
    throw new Error('GATEWAY_ARTIFACT_PERSIST_FAILED', { cause: error });
  }
}
