/**
 * Turns a managed media reference into something a model provider can download.
 *
 * Order: an S3 presigned URL when object storage is configured (Coze), then a signed public link
 * when a public media origin is configured (self-hosted VPS), then the public project domain when
 * it is not loopback, and finally an inline data URL as the last resort.
 */
import { fetchImageBuffer, normalizeLocalImagePath } from '@/lib/fetch-image-buffer';
import { getSafeMediaTypeFromResponse } from '@/lib/media-validation';
import {
  DEFAULT_PUBLIC_MEDIA_TTL_SEC,
  isLoopbackHostname,
  publicMediaContentType,
  publicMediaOrigin,
  signPublicMediaPath,
} from '@/lib/public-media-link';

const DEFAULT_INLINE_LIMIT = 20 * 1024 * 1024;

/** The project domain with a protocol, or '' when it is unset or only reachable from this host. */
export function publicProjectDomain(): string {
  const raw = (process.env.COZE_PROJECT_DOMAIN_DEFAULT || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  const base = raw.startsWith('http') ? raw : `https://${raw}`;
  try {
    return isLoopbackHostname(new URL(base).hostname) ? '' : base;
  } catch {
    return '';
  }
}

/**
 * Local path for a managed reference: `/api/serve-upload/...`, `/uploads/...`, or the same paths
 * on a loopback URL (what a loopback project domain produced before). Returns null otherwise.
 */
export function managedMediaPath(url: string): string | null {
  let pathname = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (!isLoopbackHostname(parsed.hostname) || parsed.username || parsed.password) return null;
      pathname = parsed.pathname;
    } catch {
      return null;
    }
  }
  if (!pathname.startsWith('/api/serve-upload/') && !pathname.startsWith('/uploads/')) return null;
  return pathname.split(/[?#]/, 1)[0];
}

async function presignFromStorage(relativePath: string, ttlSec: number): Promise<string | null> {
  try {
    const storage = await import('@/lib/s3-storage');
    if (!storage.isS3Available()) return null;
    const key = storage.deriveS3Key(relativePath);
    const existing = await storage.resolveS3Key(key);
    if (existing) return await storage.getS3PresignedUrl(existing, ttlSec);
    const contentType = publicMediaContentType(relativePath);
    if (!contentType) return null;
    const bytes = await fetchImageBuffer(`/${relativePath}`);
    const uploaded = await storage.uploadImageToS3(bytes, relativePath, contentType);
    return uploaded ? await storage.getS3PresignedUrl(uploaded.replace(/^\/+/, ''), ttlSec) : null;
  } catch {
    return null;
  }
}

async function inlineDataUrl(relativePath: string, maxBytes: number): Promise<string | undefined> {
  const contentType = publicMediaContentType(relativePath);
  if (!contentType) return undefined;
  try {
    const bytes = await fetchImageBuffer(`/${relativePath}`, { maxBytes });
    const media = getSafeMediaTypeFromResponse(contentType, bytes, contentType.startsWith('video/'));
    if (!media) return undefined;
    return `data:${media.mimeType};base64,${bytes.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** Whether a local file can be turned into a downloadable URL (not just an inline data URL). */
export async function canPublishProviderMedia(): Promise<boolean> {
  if (publicMediaOrigin() && signPublicMediaPath('probe.png')) return true;
  if (publicProjectDomain()) return true;
  try {
    const storage = await import('@/lib/s3-storage');
    return storage.isS3Available();
  } catch {
    return false;
  }
}

/**
 * Provider-reachable URL for a media reference. Public http(s) URLs and data URLs pass through.
 * Returns undefined when a managed file cannot be published or read.
 */
export async function toProviderMediaUrl(
  url: string | undefined | null,
  options: { ttlSec?: number; maxInlineBytes?: number } = {},
): Promise<string | undefined> {
  if (!url || typeof url !== 'string' || !url.trim()) return undefined;
  const value = url.trim();
  if (value.startsWith('data:')) return value;
  const managed = managedMediaPath(value);
  if (!managed) return /^https?:\/\//i.test(value) ? value : undefined;

  let relativePath: string;
  try {
    relativePath = normalizeLocalImagePath(managed);
  } catch {
    return undefined;
  }
  const ttlSec = options.ttlSec ?? DEFAULT_PUBLIC_MEDIA_TTL_SEC;

  const presigned = await presignFromStorage(relativePath, ttlSec);
  if (presigned) return presigned;

  const origin = publicMediaOrigin();
  const signed = origin ? signPublicMediaPath(relativePath, { ttlSec }) : null;
  if (origin && signed) return `${origin}${signed}`;

  const domain = publicProjectDomain();
  if (domain) return `${domain}${managed}`;

  return inlineDataUrl(relativePath, options.maxInlineBytes ?? DEFAULT_INLINE_LIMIT);
}
