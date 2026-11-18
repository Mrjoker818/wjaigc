/**
 * Expiring signed links that let a model provider download one managed media file.
 *
 * Providers only fetch public http(s) URLs. A self-hosted deployment that listens on loopback
 * exposes just `/api/public/media/<expires>/<signature>/<path>` through its public origin, so a
 * link opens one file until it expires and nothing else on the site becomes reachable.
 */
import crypto from 'crypto';
import path from 'path';
import { isAllowedPublicMediaPath } from '@/lib/media-validation';

export const PUBLIC_MEDIA_ROUTE = '/api/public/media';
export const DEFAULT_PUBLIC_MEDIA_TTL_SEC = 2 * 60 * 60;
/** Upper bound for a link's remaining lifetime, so a leaked secret cannot mint permanent links. */
export const MAX_PUBLIC_MEDIA_TTL_SEC = 24 * 60 * 60;

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
};

/** Raster images and videos only: providers never need SVG or 3D files, which carry more risk. */
export function publicMediaContentType(relativePath: string): string | null {
  return MEDIA_TYPES[path.extname(relativePath).toLowerCase()] ?? null;
}

function secret(): string | null {
  const configured = process.env.WUJIE_PUBLIC_MEDIA_SECRET?.trim();
  return configured && configured.length >= 32 ? configured : null;
}

function signature(key: string, expires: number, relativePath: string): string {
  return crypto.createHmac('sha256', key).update(`${expires}:${relativePath}`).digest('base64url');
}

function isSignablePath(relativePath: string): boolean {
  const parts = relativePath.split('/');
  return isAllowedPublicMediaPath(parts) && parts[0] !== 'exports' && parts[0] !== 'recovery'
    && parts[0] !== 'generated-audio' && publicMediaContentType(relativePath) !== null;
}

/** Returns the signed route path, or null when signing is not configured or the path is not shareable. */
export function signPublicMediaPath(
  relativePath: string,
  options: { now?: number; ttlSec?: number } = {},
): string | null {
  const key = secret();
  if (!key || !isSignablePath(relativePath)) return null;
  const ttl = Math.min(Math.max(1, Math.floor(options.ttlSec ?? DEFAULT_PUBLIC_MEDIA_TTL_SEC)), MAX_PUBLIC_MEDIA_TTL_SEC);
  const expires = Math.floor((options.now ?? Date.now()) / 1000) + ttl;
  return `${PUBLIC_MEDIA_ROUTE}/${expires}/${signature(key, expires, relativePath)}/${relativePath}`;
}

/** Checks the route segments `[expires, signature, ...path]` and returns the media path they grant. */
export function verifyPublicMediaParts(parts: readonly string[], now: number = Date.now()): string | null {
  const key = secret();
  if (!key || parts.length < 3) return null;
  const [expiresText, given, ...pathParts] = parts;
  if (!/^\d{1,12}$/.test(expiresText)) return null;
  const expires = Number(expiresText);
  const nowSec = Math.floor(now / 1000);
  if (expires <= nowSec || expires - nowSec > MAX_PUBLIC_MEDIA_TTL_SEC) return null;
  const relativePath = pathParts.join('/');
  if (!isSignablePath(relativePath)) return null;
  const expected = Buffer.from(signature(key, expires, relativePath));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return relativePath;
}

/** Public origin that forwards the signed route, e.g. `https://206-119-173-178.sslip.io`. */
export function publicMediaOrigin(): string | null {
  const configured = process.env.WUJIE_PUBLIC_MEDIA_ORIGIN?.trim().replace(/\/+$/, '');
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || isLoopbackHostname(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host === '::1' || /^127\./.test(host);
}
