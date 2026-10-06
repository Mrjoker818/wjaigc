import { constants, type BigIntStats } from 'node:fs';
import childProcess from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { CanvasShareError } from '@/lib/canvas-share/errors';
import {
  inspectS3ObjectExact,
  readS3ObjectRangeExact,
  type S3ExactObjectMetadata,
  type S3ExactRangeReadOptions,
  type S3ExactRangeReadResult,
} from '@/lib/s3-storage';
import { getServerDataRoot } from '@/lib/server-data-root';
import { detectImageMimeType } from '@/lib/safe-image-input';
import { inspectBinaryImage } from './binary-image-validation';

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
let activeLegacyImageReads = 0;
let legacyImageInputBytes = 0;

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
    | {
        kind: 's3';
        storageKey: string;
        eTag: string | null;
        versionId: string | null;
      };
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
  inspectS3Exact?: (
    storageKey: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<S3ExactObjectMetadata | null>;
  readS3RangeExact?: (
    storageKey: string,
    range: { start: number; end: number },
    options: S3ExactRangeReadOptions,
  ) => Promise<S3ExactRangeReadResult | null>;
  openLocal?: typeof open;
  realpathLocal?: typeof realpath;
  statLocal?: (filePath: string) => Promise<BigIntStats>;
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
  dependencies: ManagedMediaReadDependencies,
): Promise<ManagedAssetMediaDescriptor['source']> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const absolutePath = resolveManagedLocalPath(relativePath, dataRoot);
    const verified = await openVerifiedManagedLocalFile(
      absolutePath,
      dataRoot,
      expectedByteSize,
      dependencies,
    );
    file = verified.file;
    const { resolvedRoot, resolvedFile } = verified;
    return { kind: 'local', absolutePath: resolvedFile, dataRoot: resolvedRoot };
  } catch (error) {
    if (error instanceof CanvasShareError) throw error;
    return mediaNotReady();
  } finally {
    await file?.close().catch(() => undefined);
  }
}

function isInsideRoot(resolvedRoot: string, resolvedFile: string): boolean {
  const relative = path.relative(resolvedRoot, resolvedFile);
  return Boolean(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function sameFileIdentity(opened: BigIntStats, resolved: BigIntStats): boolean {
  return opened.ino > BigInt(0)
    && opened.dev === resolved.dev
    && opened.ino === resolved.ino;
}

async function openVerifiedManagedLocalFile(
  absolutePath: string,
  dataRoot: string,
  expectedByteSize: number,
  dependencies: ManagedMediaReadDependencies,
): Promise<{
  file: Awaited<ReturnType<typeof open>>;
  resolvedRoot: string;
  resolvedFile: string;
  fileStat: BigIntStats;
}> {
  const openLocal = dependencies.openLocal ?? open;
  const realpathLocal = dependencies.realpathLocal ?? realpath;
  const statLocal = dependencies.statLocal
    ?? ((filePath: string) => stat(filePath, { bigint: true }));
  const resolvedRoot = await realpathLocal(dataRoot);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const file = await openLocal(absolutePath, constants.O_RDONLY | noFollow);
  try {
    const [fileStat, resolvedFile] = await Promise.all([
      file.stat({ bigint: true }),
      realpathLocal(absolutePath),
    ]);
    if (!isInsideRoot(resolvedRoot, resolvedFile)) {
      throw new Error('MANAGED_LOCAL_MEDIA_OUTSIDE_ROOT');
    }
    const resolvedStat = await statLocal(resolvedFile);
    if (
      !fileStat.isFile()
      || !resolvedStat.isFile()
      || fileStat.size !== BigInt(expectedByteSize)
      || resolvedStat.size !== BigInt(expectedByteSize)
      || !sameFileIdentity(fileStat, resolvedStat)
    ) {
      throw new Error('MANAGED_LOCAL_MEDIA_IDENTITY_MISMATCH');
    }
    return { file, resolvedRoot, resolvedFile, fileStat };
  } catch (error) {
    await file.close().catch(() => undefined);
    throw error;
  }
}

async function resolveVerifiedS3Source(
  storageKey: string,
  mimeType: string | undefined,
  expectedByteSize: number,
  options: Pick<ManagedMediaReadOptions, 'timeoutMs' | 'signal'>,
  dependencies: ManagedMediaReadDependencies,
): Promise<{ source: ManagedAssetMediaDescriptor['source']; contentType: string | null }> {
  try {
    const inspectS3Exact = dependencies.inspectS3Exact ?? inspectS3ObjectExact;
    const inspected = await inspectS3Exact(
      storageKey,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.signal,
    );
    const eTag = inspected?.eTag?.trim() || null;
    const versionId = inspected?.versionId?.trim() || null;
    if (
      !inspected
      || inspected.byteSize !== expectedByteSize
      || (mimeType !== undefined && inspected.contentType !== null && inspected.contentType !== mimeType)
      || (mimeType === undefined && inspected.contentType !== null
        && inspected.contentType !== 'application/octet-stream' && !IMAGE_MIME_TYPES.has(inspected.contentType))
      || (!eTag && !versionId)
    ) {
      return mediaNotReady();
    }
    return { source: { kind: 's3', storageKey, eTag, versionId }, contentType: inspected.contentType };
  } catch (error) {
    if (error instanceof CanvasShareError) throw error;
    return mediaNotReady();
  }
}

interface PreparedManagedMedia {
  descriptor: ManagedAssetMediaDescriptor;
  verifiedBytes?: Buffer;
}

// MANAGED_LOCAL_READ: native filesystem operations may not honour AbortSignal.
// Isolate every root/fd/read/close operation, and never settle before child close.
const localReaderProgram = `
// MANAGED_LOCAL_READ
const fs = require('node:fs');
const path = require('node:path');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return Boolean(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
(async () => {
  const absolutePath = process.argv[1]; const dataRoot = process.argv[2];
  const expected = Number(process.argv[3]);
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > ${IMAGE_MAX_BYTES}) throw new Error('size');
  const root = fs.realpathSync(dataRoot);
  let fd;
  try {
    fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    const file = fs.realpathSync(absolutePath);
    if (!inside(root, file)) throw new Error('root');
    const resolved = fs.statSync(file, { bigint: true });
    if (!opened.isFile() || !resolved.isFile() || opened.size !== BigInt(expected)
      || resolved.size !== BigInt(expected) || opened.ino <= 0n
      || opened.dev !== resolved.dev || opened.ino !== resolved.ino) throw new Error('identity');
    // No full input allocation in the worker. Reuse only after pipe write completes.
    const chunk = Buffer.alloc(Math.min(expected, 65536));
    let offset = 0;
    while (offset < expected) {
      const length = fs.readSync(fd, chunk, 0, Math.min(chunk.length, expected - offset), offset);
      if (length < 1) throw new Error('short read');
      await new Promise((resolve, reject) => process.stdout.write(chunk.subarray(0, length), error => error ? reject(error) : resolve()));
      offset += length;
    }
    if (fs.fstatSync(fd, { bigint: true }).size !== BigInt(expected)) throw new Error('size changed');
    fs.closeSync(fd); fd = undefined;
    process.stderr.write(JSON.stringify({ dataRoot: root, absolutePath: file }));
  } finally { if (fd !== undefined) fs.closeSync(fd); }
})().catch(() => { process.exitCode = 1; });
`;

async function readLegacyLocalImage(
  relativePath: string,
  dataRoot: string,
  byteSize: number,
  signal: AbortSignal,
): Promise<{ source: ManagedAssetMediaDescriptor['source']; bytes: Buffer; totalBytes: number }> {
  signal.throwIfAborted();
  const absolutePath = resolveManagedLocalPath(relativePath, dataRoot);
  const bytes = Buffer.alloc(byteSize);
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath,
      ['--max-old-space-size=64', '-e', localReaderProgram, absolutePath, dataRoot, String(byteSize)],
      { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', UV_THREADPOOL_SIZE: '1' } });
    let failure: unknown;
    let received = 0;
    let metadata = '';
    let metadataBytes = 0;
    const metadataDecoder = new StringDecoder('utf8');
    const stop = (error: unknown): void => {
      failure ??= error ?? new Error('MANAGED_LOCAL_READ_ABORTED');
      child.kill('SIGKILL');
    };
    const abort = (): void => stop(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.on('error', error => { failure ??= error; });
    child.stdout.on('data', (chunk: Buffer): void => {
      if (failure) return;
      if (received + chunk.length > byteSize) { stop(new Error('MANAGED_LOCAL_READ_OUTPUT_LIMIT')); return; }
      chunk.copy(bytes, received); received += chunk.length;
    });
    child.stderr.on('data', (chunk: Buffer): void => {
      metadataBytes += chunk.length;
      if (metadataBytes > 8192) stop(new Error('MANAGED_LOCAL_READ_METADATA_LIMIT'));
      else metadata += metadataDecoder.write(chunk);
    });
    child.once('close', (code): void => {
      signal.removeEventListener('abort', abort);
      if (failure) { reject(failure); return; }
      try {
        signal.throwIfAborted();
        if (code !== 0 || received !== byteSize) throw new Error('MANAGED_LOCAL_READ_FAILED');
        const location: unknown = JSON.parse(metadata + metadataDecoder.end());
        if (typeof location !== 'object' || location === null
          || !('dataRoot' in location) || typeof location.dataRoot !== 'string'
          || !('absolutePath' in location) || typeof location.absolutePath !== 'string'
          || !path.isAbsolute(location.dataRoot) || !path.isAbsolute(location.absolutePath)
          || !isInsideRoot(location.dataRoot, location.absolutePath)) throw new Error('MANAGED_LOCAL_READ_ROOT');
        resolve({ source: { kind: 'local', dataRoot: location.dataRoot, absolutePath: location.absolutePath }, bytes, totalBytes: byteSize });
      } catch (error) { reject(error); }
    });
  });
}

/** A read-only byte proof, never an authorization or a writable version repair. */
async function prepareLegacyImage(
  originalVersion: AssetVersion,
  byteSize: number,
  relativePath: string,
  storageKey: string | null,
  options: Pick<ManagedMediaReadOptions, 'dataRoot' | 'timeoutMs' | 'signal'>,
  dependencies: ManagedMediaReadDependencies,
): Promise<PreparedManagedMedia> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (options.signal?.aborted || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS
    || activeLegacyImageReads >= 2 || legacyImageInputBytes + byteSize > 2 * IMAGE_MAX_BYTES) return mediaNotReady();
  const version = structuredClone(originalVersion);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('MANAGED_LEGACY_IMAGE_TIMEOUT')), timeoutMs);
  timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const bounded = { ...options, timeoutMs, signal };
  activeLegacyImageReads++; legacyImageInputBytes += byteSize;
  try {
    signal.throwIfAborted();
    let source: ManagedAssetMediaDescriptor['source'];
    let contentType: string | null = null;
    let result: { bytes: Buffer; totalBytes: number };
    if (storageKey) {
      const resolved = await resolveVerifiedS3Source(storageKey, undefined, byteSize, bounded, dependencies);
      source = resolved.source; contentType = resolved.contentType;
      const provisional: ManagedAssetMediaDescriptor = { assetVersionId: version.id, assetKind: 'image',
        mimeType: '', byteSize, width: null, height: null, checksum: null, source };
      result = await readDescriptor(provisional, { start: 0, end: byteSize - 1 }, bounded, dependencies);
    } else {
      const local = await readLegacyLocalImage(relativePath,
        path.resolve(options.dataRoot ?? getServerDataRoot()), byteSize, signal);
      source = local.source; result = local;
    }
    signal.throwIfAborted();
    const provisional: ManagedAssetMediaDescriptor = { assetVersionId: version.id, assetKind: 'image',
      mimeType: '', byteSize, width: null, height: null, checksum: null, source };
    if (result.totalBytes !== byteSize || result.bytes.length !== byteSize) return mediaNotReady();
    const checksum = createHash('sha256').update(result.bytes).digest('hex');
    const registeredChecksum = version.file.checksum;
    if (registeredChecksum !== undefined) {
      if (!/^(?:sha256:)?[a-fA-F0-9]{64}$/.test(registeredChecksum)
        || registeredChecksum.replace(/^sha256:/, '').toLowerCase() !== checksum) return mediaNotReady();
    }
    const detectedMime = detectImageMimeType(result.bytes);
    if (!detectedMime) return mediaNotReady();
    const mimeType = assertSupportedMime('image', detectedMime);
    if (contentType !== null && contentType !== 'application/octet-stream' && contentType !== mimeType) return mediaNotReady();
    const dimensions = mimeType === 'image/bmp'
      ? await (await import('./binary-media-validation')).inspectNewBinaryMedia(result.bytes, mimeType, signal)
      : await inspectBinaryImage(result.bytes, mimeType, signal);
    signal.throwIfAborted();
    if (!dimensions || (version.file.width !== undefined && version.file.width !== dimensions.width)
      || (version.file.height !== undefined && version.file.height !== dimensions.height)) return mediaNotReady();
    return { descriptor: { ...provisional, mimeType, checksum, ...dimensions }, verifiedBytes: result.bytes };
  } catch {
    return mediaNotReady();
  } finally {
    clearTimeout(timer); activeLegacyImageReads--; legacyImageInputBytes -= byteSize;
  }
}

async function prepareManagedAssetMedia(
  version: AssetVersion,
  kind: AssetKind,
  options: Pick<ManagedMediaReadOptions, 'dataRoot' | 'timeoutMs' | 'signal'> = {},
  dependencies: ManagedMediaReadDependencies = {},
): Promise<PreparedManagedMedia> {
  const assetKind = supportedAssetKind(kind);
  if (version.file.availability !== 'ready') return mediaNotReady();
  const byteSize = version.file.byteSize;
  const maxBytes = assetKind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (!Number.isSafeInteger(byteSize) || (byteSize ?? 0) <= 0 || byteSize! > maxBytes) {
    return mediaNotReady();
  }

  const storageKey = normalizeStorageKey(version.file.storageKey);
  const relativePath = controlledRelativePath(version.file.url);
  if (!relativePath) return mediaNotReady();
  if (assetKind === 'image' && version.file.mimeType === undefined) {
    return prepareLegacyImage(version, byteSize!, relativePath, storageKey, options, dependencies);
  }
  const mimeType = assertSupportedMime(assetKind, version.file.mimeType);
  const source = storageKey
    ? (await resolveVerifiedS3Source(storageKey, mimeType, byteSize!, options, dependencies)).source
    : await resolveVerifiedManagedLocalSource(
        relativePath,
        path.resolve(options.dataRoot ?? getServerDataRoot()),
        byteSize!,
        dependencies,
      );

  return { descriptor: {
    assetVersionId: version.id,
    assetKind,
    mimeType,
    byteSize: byteSize!,
    width: normalizeDimension(version.file.width),
    height: normalizeDimension(version.file.height),
    checksum: version.file.checksum?.trim() || null,
    source,
  } };
}

export async function getManagedAssetMediaDescriptor(
  version: AssetVersion,
  kind: AssetKind,
  options: Pick<ManagedMediaReadOptions, 'dataRoot' | 'timeoutMs' | 'signal'> = {},
  dependencies: ManagedMediaReadDependencies = {},
): Promise<ManagedAssetMediaDescriptor> {
  return (await prepareManagedAssetMedia(version, kind, options, dependencies)).descriptor;
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
  dependencies: ManagedMediaReadDependencies,
): Promise<{ bytes: Buffer; totalBytes: number }> {
  const verified = await openVerifiedManagedLocalFile(
    absolutePath,
    dataRoot,
    expectedTotalBytes,
    dependencies,
  );
  const { file } = verified;
  try {
    if (range.start >= expectedTotalBytes) return mediaUnavailable();
    const end = Math.min(range.end, expectedTotalBytes - 1);
    const bytes = Buffer.alloc(end - range.start + 1);
    const result = await file.read(bytes, 0, bytes.length, range.start);
    if (result.bytesRead !== bytes.length) return mediaUnavailable();
    return { bytes, totalBytes: expectedTotalBytes };
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
      dependencies,
    );
  }
  const readS3RangeExact = dependencies.readS3RangeExact ?? readS3ObjectRangeExact;
  const result = await readS3RangeExact(
    descriptor.source.storageKey,
    range,
    {
      expectedTotalBytes: descriptor.byteSize,
      maxBytes: range.end - range.start + 1,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      eTag: descriptor.source.eTag,
      versionId: descriptor.source.versionId,
      signal: options.signal,
    },
  );
  if (!result || result.totalBytes !== descriptor.byteSize) return mediaUnavailable();
  return result;
}

export async function readManagedAssetVersionBytes(
  version: AssetVersion,
  kind: AssetKind,
  options: ManagedMediaReadOptions = {},
  dependencies: ManagedMediaReadDependencies = {},
): Promise<ManagedMediaReadResult> {
  let descriptor: ManagedAssetMediaDescriptor;
  let verifiedBytes: Buffer | undefined;
  try {
    ({ descriptor, verifiedBytes } = await prepareManagedAssetMedia(version, kind, options, dependencies));
  } catch {
    return mediaUnavailable();
  }
  const responseMaxBytes = descriptor.assetKind === 'image'
    ? IMAGE_MAX_BYTES
    : DEFAULT_RESPONSE_MAX_BYTES;
  const maxBytes = options.maxBytes ?? responseMaxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > responseMaxBytes) {
    return mediaUnavailable();
  }
  const range = normalizeRange(options.range, descriptor.byteSize, maxBytes);
  if (descriptor.assetKind === 'video') {
    if (activeVideoReads >= MAX_VIDEO_CONCURRENT_READS) return mediaUnavailable();
    activeVideoReads += 1;
  }
  try {
    options.signal?.throwIfAborted();
    const result = verifiedBytes
      ? { bytes: verifiedBytes.subarray(range.start, range.end + 1), totalBytes: descriptor.byteSize }
      : await readDescriptor(descriptor, range, options, dependencies);
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
