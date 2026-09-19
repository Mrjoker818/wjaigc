import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { CanvasShareError } from '@/lib/canvas-share/errors';
import { readImageFromS3Bounded } from '@/lib/s3-storage';
import { getServerDataRoot } from '@/lib/server-data-root';

import type { AssetKind, AssetVersion } from './types';

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);
const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
]);
const IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const VIDEO_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_VIDEO_CONCURRENT_READS = 4;

let activeVideoReads = 0;

export interface ManagedAssetMediaDescriptor {
  assetVersionId: string;
  assetKind: 'image' | 'video';
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksum: string | null;
  source:
    | { kind: 'local'; absolutePath: string; dataRoot: string }
    | { kind: 's3'; storageKey: string };
}

export interface ManagedMediaByteRange {
  start: number;
  end?: number;
}

export interface ManagedMediaReadOptions {
  dataRoot?: string;
  range?: ManagedMediaByteRange;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ManagedMediaReadResult {
  bytes: Buffer;
  mimeType: string;
  totalBytes: number;
  range?: { start: number; end: number };
}

export interface ManagedMediaReadDependencies {
  readS3Exact?: (
    storageKey: string,
    maxBytes: number,
    timeoutMs: number,
    options: { signal?: AbortSignal; strict: true },
  ) => Promise<Buffer | null>;
}

function mediaNotReady(): never {
  throw new CanvasShareError('CANVAS_SHARE_MEDIA_NOT_READY');
}

function mediaUnavailable(): never {
  throw new CanvasShareError('CANVAS_SHARE_MEDIA_UNAVAILABLE');
}

function normalizeDimension(value: number | undefined): number | null {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value! : null;
}

function assertSupportedMime(assetKind: 'image' | 'video', value: string | undefined): string {
  const mimeType = value?.trim().toLowerCase();
  const supported = assetKind === 'image' ? IMAGE_MIME_TYPES : VIDEO_MIME_TYPES;
  if (!mimeType || !supported.has(mimeType)) return mediaNotReady();
  return mimeType;
}

function normalizeStorageKey(value: string | undefined): string | null {
  const key = value?.trim();
  if (!key || key !== value || key.length > 1_024 || key.includes('\\')) return null;
  if (!/^(?:images|exports)\/[A-Za-z0-9._/-]+$/u.test(key)) return null;
  if (key.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null;
  return key;
}

function controlledRelativePath(value: string): string | null {
  if (!value.startsWith('/api/serve-upload/') || value.includes('?') || value.includes('#')) {
    return null;
  }
  const encoded = value.slice('/api/serve-upload/'.length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (
    !decoded
    || decoded.includes('\\')
    || decoded.includes('\0')
    || !/^[A-Za-z0-9._/-]+$/u.test(decoded)
    || decoded.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    return null;
  }
  return decoded;
}

function resolveManagedLocalPath(relativePath: string, dataRoot: string): string {
  const root = path.resolve(dataRoot);
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return mediaNotReady();
  return candidate;
}

function supportedAssetKind(kind: AssetKind): 'image' | 'video' {
  if (kind === 'image' || kind === 'video') return kind;
  return mediaNotReady();
}

async function resolveVerifiedManagedLocalSource(
  relativePath: string,
  dataRoot: string,
  expectedByteSize: number,
): Promise<ManagedAssetMediaDescriptor['source']> {
  try {
    const absolutePath = resolveManagedLocalPath(relativePath, dataRoot);
    const [resolvedRoot, resolvedFile] = await Promise.all([
      realpath(dataRoot),
      realpath(absolutePath),
    ]);
    const relative = path.relative(resolvedRoot, resolvedFile);
    if (
      !relative
      || relative === '..'
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
    ) {
      return mediaNotReady();
    }
    const fileStat = await stat(resolvedFile);
    if (!fileStat.isFile() || fileStat.size !== expectedByteSize) return mediaNotReady();
    return { kind: 'local', absolutePath: resolvedFile, dataRoot: resolvedRoot };
  } catch (error) {
    if (error instanceof CanvasShareError) throw error;
    return mediaNotReady();
  }
}

export async function getManagedAssetMediaDescriptor(
  version: AssetVersion,
  kind: AssetKind,
  options: Pick<ManagedMediaReadOptions, 'dataRoot'> = {},
): Promise<ManagedAssetMediaDescriptor> {
  const assetKind = supportedAssetKind(kind);
  if (version.file.availability !== 'ready') return mediaNotReady();
  const mimeType = assertSupportedMime(assetKind, version.file.mimeType);
  const byteSize = version.file.byteSize;
  const maxBytes = assetKind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (!Number.isSafeInteger(byteSize) || (byteSize ?? 0) <= 0 || byteSize! > maxBytes) {
    return mediaNotReady();
  }

  const storageKey = normalizeStorageKey(version.file.storageKey);
  const relativePath = controlledRelativePath(version.file.url);
  if (!relativePath) return mediaNotReady();
  const source = storageKey
    ? { kind: 's3' as const, storageKey }
    : await resolveVerifiedManagedLocalSource(
        relativePath,
        path.resolve(options.dataRoot ?? getServerDataRoot()),
        byteSize!,
      );

  return {
    assetVersionId: version.id,
    assetKind,
    mimeType,
    byteSize: byteSize!,
    width: normalizeDimension(version.file.width),
    height: normalizeDimension(version.file.height),
    checksum: version.file.checksum?.trim() || null,
    source,
  };
}

function normalizeRange(
  range: ManagedMediaByteRange | undefined,
  totalBytes: number,
  maxBytes: number,
): { start: number; end: number } {
  const start = range?.start ?? 0;
  const requestedEnd = range?.end ?? totalBytes - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= totalBytes
  ) {
    return mediaUnavailable();
  }
  const end = Math.min(requestedEnd, totalBytes - 1);
  if (end - start + 1 > maxBytes) return mediaUnavailable();
  return { start, end };
}

async function readLocalRange(
  absolutePath: string,
  dataRoot: string,
  expectedTotalBytes: number,
  range: { start: number; end: number },
): Promise<{ bytes: Buffer; totalBytes: number }> {
  const [resolvedRoot, resolvedFile] = await Promise.all([
    realpath(dataRoot),
    realpath(absolutePath),
  ]);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (
    !relative
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    return mediaUnavailable();
  }
  const file = await open(resolvedFile, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== expectedTotalBytes || range.start >= stat.size) {
      return mediaUnavailable();
    }
    const end = Math.min(range.end, stat.size - 1);
    const bytes = Buffer.alloc(end - range.start + 1);
    const result = await file.read(bytes, 0, bytes.length, range.start);
    if (result.bytesRead !== bytes.length) return mediaUnavailable();
    return { bytes, totalBytes: stat.size };
  } finally {
    await file.close();
  }
}

async function readDescriptor(
  descriptor: ManagedAssetMediaDescriptor,
  range: { start: number; end: number },
  options: ManagedMediaReadOptions,
  dependencies: ManagedMediaReadDependencies,
): Promise<{ bytes: Buffer; totalBytes: number }> {
  if (descriptor.source.kind === 'local') {
    return readLocalRange(
      descriptor.source.absolutePath,
      descriptor.source.dataRoot,
      descriptor.byteSize,
      range,
    );
  }
  const readS3Exact = dependencies.readS3Exact ?? readImageFromS3Bounded;
  const complete = await readS3Exact(
    descriptor.source.storageKey,
    descriptor.byteSize,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    { signal: options.signal, strict: true },
  );
  if (!complete || complete.byteLength !== descriptor.byteSize) return mediaUnavailable();
  return {
    bytes: complete.subarray(range.start, range.end + 1),
    totalBytes: complete.byteLength,
  };
}

export async function readManagedAssetVersionBytes(
  version: AssetVersion,
  kind: AssetKind,
  options: ManagedMediaReadOptions = {},
  dependencies: ManagedMediaReadDependencies = {},
): Promise<ManagedMediaReadResult> {
  let descriptor: ManagedAssetMediaDescriptor;
  try {
    descriptor = await getManagedAssetMediaDescriptor(version, kind, options);
  } catch {
    return mediaUnavailable();
  }
  const maxBytes = options.maxBytes ?? DEFAULT_RESPONSE_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > DEFAULT_RESPONSE_MAX_BYTES) {
    return mediaUnavailable();
  }
  const range = normalizeRange(options.range, descriptor.byteSize, maxBytes);
  if (descriptor.assetKind === 'video') {
    if (activeVideoReads >= MAX_VIDEO_CONCURRENT_READS) return mediaUnavailable();
    activeVideoReads += 1;
  }
  try {
    const result = await readDescriptor(descriptor, range, options, dependencies);
    return {
      bytes: result.bytes,
      mimeType: descriptor.mimeType,
      totalBytes: result.totalBytes,
      ...(options.range ? { range } : {}),
    };
  } catch (error) {
    if (error instanceof CanvasShareError) throw error;
    throw new CanvasShareError('CANVAS_SHARE_MEDIA_UNAVAILABLE');
  } finally {
    if (descriptor.assetKind === 'video') activeVideoReads -= 1;
  }
}
