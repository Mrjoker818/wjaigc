import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { open, lstat, type FileHandle } from 'node:fs/promises';
import { constants as fileConstants } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';

import { getServerDataRoot } from '@/lib/server-data-root';
import { uploadBinaryToS3, type S3BinaryUploadResult } from '@/lib/s3-storage';
import type { AssetFile } from './types';
import { assetBinaryFileOps } from './binary-file-ops';
import { drainPendingAssetCleanup, recordAssetCleanupFailure } from './cleanup-outbox';
import { binaryExtensions, binaryByteLimit, EXPORT_FILENAME, EXPORT_KEY, MAX_ASSET_VIDEO_BYTES } from './binary-media-contract';
import { inspectNewBinaryMedia, type VerifiedMediaDimensions } from './binary-media-validation';
import {
  bindExportDirectory, assertExportDirectoryBinding, identityOfCreatedFile,
  assertExportFileIdentity, checkExportCleanupIdentity,
  type BinaryLocalIdentity, type ExportDirectoryBinding,
} from './binary-local-identity';

export { MAX_ASSET_BINARY_BYTES } from './binary-media-contract';

export interface PersistAssetBytesInput {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  signal?: AbortSignal;
}

export interface PersistedAssetFile extends AssetFile {
  createdThisCall: boolean;
  cleanup(): Promise<void>;
}

function fail(code: string): never {
  throw new TypeError(code);
}

let preparations = 0;
let preparationBytes = 0;
function reservePreparation(input: PersistAssetBytesInput): () => void {
  input.signal?.throwIfAborted();
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > binaryByteLimit(input.mimeType)) fail('ASSET_BYTES_INVALID');
  if (!binaryExtensions(input.mimeType)) fail('ASSET_MIME_TYPE_INVALID');
  const isNewMedia = input.mimeType.startsWith('video/') || ['image/gif', 'image/avif', 'image/bmp'].includes(input.mimeType);
  if (!isNewMedia) return () => undefined;
  if (preparations >= 2 || preparationBytes + input.bytes.length > MAX_ASSET_VIDEO_BYTES) fail('ASSET_MEDIA_BUSY');
  preparations++; preparationBytes += input.bytes.length;
  const length = input.bytes.length;
  return () => { preparations--; preparationBytes -= length; };
}

function normalizeFilename(value: unknown, mimeType: string): string {
  if (typeof value !== 'string' || value !== value.normalize('NFC')) fail('ASSET_FILENAME_INVALID');
  if (
    value !== path.basename(value)
    || value.includes('/')
    || value.includes('\\')
    || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,199}$/u.test(value)
    || /[. ]$/u.test(value)
  ) fail('ASSET_FILENAME_INVALID');
  const expected = binaryExtensions(mimeType);
  if (!expected) fail('ASSET_MIME_TYPE_INVALID');
  const extension = path.extname(value).toLowerCase();
  if (!expected.includes(extension.slice(1))) {
    fail('ASSET_FILENAME_MIME_MISMATCH');
  }
  return value;
}

async function inspectAssetBinaryFormat(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<VerifiedMediaDimensions | undefined> {
  try {
    if (mimeType.startsWith('video/') || ['image/gif', 'image/avif', 'image/bmp'].includes(mimeType)) {
      return await inspectNewBinaryMedia(bytes, mimeType, signal);
    }
    if (mimeType === 'application/json') {
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('ASSET_BINARY_FORMAT_INVALID');
      return;
    }
    if (mimeType === 'application/zip') {
      if (bytes.length < 4 || bytes.subarray(0, 4).toString('hex') !== '504b0304') fail('ASSET_BINARY_FORMAT_INVALID');
      const zip = await JSZip.loadAsync(bytes, { createFolders: false });
      const entries = Object.keys(zip.files);
      if (entries.length < 1 || entries.length > 101 || entries.some(name => (
        name.includes('/') || name.includes('\\') || name === '.' || name === '..' || zip.files[name].dir
      ))) fail('ASSET_BINARY_FORMAT_INVALID');
      return;
    }
    const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata();
    const expected = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpeg' : 'webp';
    if (metadata.format !== expected || !metadata.width || !metadata.height) fail('ASSET_BINARY_FORMAT_INVALID');
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof TypeError && error.message === 'ASSET_BINARY_FORMAT_INVALID') throw error;
    fail('ASSET_BINARY_FORMAT_INVALID');
  }
}

export async function validateAssetBinaryFormat(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<void> {
  await inspectAssetBinaryFormat(bytes, mimeType, signal);
}

export async function validateExportAssetBytes(input: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  signal?: AbortSignal;
}): Promise<void> {
  input.signal?.throwIfAborted();
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > binaryByteLimit(input.mimeType)) {
    fail('ASSET_BYTES_INVALID');
  }
  normalizeFilename(input.filename, input.mimeType);
  const match = input.filename.match(EXPORT_FILENAME);
  if (!match || createHash('sha256').update(input.bytes).digest('hex').slice(0, 16) !== match[1]) {
    fail('ASSET_RECOVERY_CHECKSUM_MISMATCH');
  }
  await validateAssetBinaryFormat(input.bytes, input.mimeType, input.signal);
}

function exportTarget(filename: string): { directory: string; target: string } {
  const root = path.resolve(getServerDataRoot());
  const directory = path.resolve(root, 'exports');
  const target = path.resolve(directory, filename);
  if (!target.startsWith(`${directory}${path.sep}`)) fail('ASSET_FILENAME_INVALID');
  return { directory, target };
}

type OwnedFiles = Map<string, BinaryLocalIdentity>;

async function assertStagedChecksum(
  target: string, expected: Buffer, signal?: AbortSignal, identity?: BinaryLocalIdentity, held?: FileHandle,
): Promise<void> {
  const handle = held ?? await open(target, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0));
  try {
    if (identity) await assertExportFileIdentity(target, identity, handle);
    const before = await handle.stat({ bigint: true });
    const namedBefore = await lstat(target, { bigint: true });
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.dev !== before.dev || namedBefore.ino !== before.ino) fail('ASSET_FILE_IDENTITY_CHANGED');
    if (!before.isFile() || before.size !== BigInt(expected.length)) fail('ASSET_RECOVERY_CHECKSUM_MISMATCH');
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(Math.min(expected.length, 1024 * 1024));
    let position = 0;
    while (position < expected.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, expected.length - position), position);
      signal?.throwIfAborted();
      if (bytesRead === 0) fail('ASSET_RECOVERY_CHECKSUM_MISMATCH');
      hash.update(chunk.subarray(0, bytesRead)); position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const namedAfter = await lstat(target, { bigint: true });
    if (!namedAfter.isFile() || namedAfter.isSymbolicLink() || namedAfter.dev !== after.dev || namedAfter.ino !== after.ino) fail('ASSET_FILE_IDENTITY_CHANGED');
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || hash.digest('hex') !== createHash('sha256').update(expected).digest('hex')) fail('ASSET_RECOVERY_CHECKSUM_MISMATCH');
    if (identity) await assertExportFileIdentity(target, identity, handle);
  } finally { if (!held) await handle.close(); }
}

async function writeStage(
  directory: ExportDirectoryBinding, temporary: string, input: PersistAssetBytesInput, owners: OwnedFiles,
): Promise<FileHandle> {
  await assertExportDirectoryBinding(directory);
  const handle = await open(temporary, 'wx+');
  try {
    owners.set(temporary, await identityOfCreatedFile(handle, directory));
    await assertExportFileIdentity(temporary, owners.get(temporary)!, handle);
    await assetBinaryFileOps.writeFile(handle, input.bytes, { signal: input.signal });
    await assertStagedChecksum(temporary, input.bytes, input.signal, owners.get(temporary), handle);
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

const UNSUPPORTED_HARD_LINK_CODES = new Set(['EPERM', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP']);

async function publishStagedFileExclusive(input: {
  directory: ExportDirectoryBinding; temporary: string; target: string;
  bytes: Buffer; signal?: AbortSignal; owners: OwnedFiles; stage: FileHandle;
}): Promise<boolean> {
  const stageIdentity = input.owners.get(input.temporary)!;
  await assertExportDirectoryBinding(input.directory);
  await assertStagedChecksum(input.temporary, input.bytes, input.signal, stageIdentity, input.stage);
  try {
    await assetBinaryFileOps.link(input.temporary, input.target);
    // Ownership is the original descriptor identity, NOT the current target pathname.
    input.owners.set(input.target, stageIdentity);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    if (!code || !UNSUPPORTED_HARD_LINK_CODES.has(code)) throw error;
  }
  input.signal?.throwIfAborted();
  await assertExportDirectoryBinding(input.directory);
  await assertStagedChecksum(input.temporary, input.bytes, input.signal, stageIdentity, input.stage);
  let handle: FileHandle;
  try { handle = await open(input.target, 'wx+'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  try {
    input.owners.set(input.target, await identityOfCreatedFile(handle, input.directory));
    await assertExportFileIdentity(input.target, input.owners.get(input.target)!, handle);
    await assetBinaryFileOps.writeFile(handle, input.bytes, { signal: input.signal });
    await assertStagedChecksum(input.target, input.bytes, input.signal, input.owners.get(input.target), handle);
    return true;
  } finally { await handle.close(); }
}

async function removeOwnedExport(target: string, owners: OwnedFiles): Promise<void> {
  const identity = owners.get(target);
  if (!identity || !await checkExportCleanupIdentity(target, identity)) return;
  try { await assetBinaryFileOps.rm(target, { force: true }); }
  catch (error) {
    await recordAssetCleanupFailure({
      rootId: 'server-data', localPath: `exports/${path.basename(target)}`, localIdentity: identity,
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function cleanupOwned(owners: OwnedFiles, s3Upload?: S3BinaryUploadResult | null): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const target of owners.keys()) {
    await removeOwnedExport(target, owners).catch(error => failures.push(error));
  }
  if (s3Upload?.createdThisCall) {
    await s3Upload.cleanup().catch(async error => {
      failures.push(error);
      await recordAssetCleanupFailure({
        rootId: 'server-data', storageKey: s3Upload.storageKey,
        lastError: error instanceof Error ? error.message : String(error),
      }).catch(failure => failures.push(failure));
    });
  }
  return failures;
}

/** Atomically restore one content-addressed export without exposing partial bytes. */
export async function recoverExportAssetBytes(input: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  signal?: AbortSignal;
}): Promise<void> {
  const release = reservePreparation(input);
  try { await recoverExportSnapshot({ ...input, bytes: Buffer.from(input.bytes) }); }
  finally { release(); }
}

async function recoverExportSnapshot(input: PersistAssetBytesInput): Promise<void> {
  await validateExportAssetBytes(input);
  const match = input.filename.match(EXPORT_FILENAME);
  if (!match) fail('ASSET_RECOVERY_CHECKSUM_MISMATCH');
  const { directory, target } = exportTarget(input.filename);
  const temporary = path.resolve(directory, `.${input.filename}.${randomUUID()}.recover.tmp`);
  await assetBinaryFileOps.mkdir(directory, { recursive: true });
  const binding = await bindExportDirectory(directory);
  const owners: OwnedFiles = new Map();
  let stage: FileHandle | undefined;
  try {
    stage = await writeStage(binding, temporary, input, owners);
    await publishStagedFileExclusive({ directory: binding, temporary, target, bytes: input.bytes, signal: input.signal, owners, stage });
    input.signal?.throwIfAborted();
    await assertExportDirectoryBinding(binding);
    await assertStagedChecksum(target, input.bytes, input.signal, owners.get(target));
    await removeOwnedExport(temporary, owners);
    await assertExportDirectoryBinding(binding);
    await assertStagedChecksum(target, input.bytes, input.signal, owners.get(target));
  } catch (error) {
    const failures = await cleanupOwned(owners);
    if (failures.length) throw new AggregateError([error, ...failures], 'ASSET_PERSISTENCE_COMPENSATION_FAILED');
    throw error;
  } finally { await stage?.close(); }
}

export async function persistAssetBytes(input: PersistAssetBytesInput): Promise<PersistedAssetFile> {
  const release = reservePreparation(input);
  try { return await persistAssetSnapshot({ ...input, bytes: Buffer.from(input.bytes) }); }
  finally { release(); }
}

async function persistAssetSnapshot(input: PersistAssetBytesInput): Promise<PersistedAssetFile> {
  input.signal?.throwIfAborted();
  await drainPendingAssetCleanup({ limit: 2 }).catch(() => {
    console.warn({ code: 'ASSET_CLEANUP_OPPORTUNISTIC_DRAIN_FAILED' });
  });
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > binaryByteLimit(input.mimeType)) {
    fail('ASSET_BYTES_INVALID');
  }
  if (typeof input.mimeType !== 'string' || !binaryExtensions(input.mimeType)) {
    fail('ASSET_MIME_TYPE_INVALID');
  }
  const filename = normalizeFilename(input.filename, input.mimeType);
  const verifiedDimensions = await inspectAssetBinaryFormat(input.bytes, input.mimeType, input.signal);
  input.signal?.throwIfAborted();
  const checksum = createHash('sha256').update(input.bytes).digest('hex');
  const asciiFilename = filename.replace(/[^A-Za-z0-9._-]/gu, '_');
  const storedFilename = `${checksum.slice(0, 16)}-${randomUUID()}-${asciiFilename}`;
  const root = path.resolve(getServerDataRoot());
  const directory = path.resolve(root, 'exports');
  const temporary = path.resolve(directory, `.${storedFilename}.${randomUUID()}.tmp`);
  await assetBinaryFileOps.mkdir(directory, { recursive: true });
  const binding = await bindExportDirectory(directory);
  input.signal?.throwIfAborted();
  const owners: OwnedFiles = new Map();
  let stage: FileHandle | undefined;
  let s3Upload: S3BinaryUploadResult | null = null;
  try {
    stage = await writeStage(binding, temporary, input, owners);
    input.signal?.throwIfAborted();
    s3Upload = await uploadBinaryToS3(input.bytes, storedFilename, input.mimeType, input.signal ?? new AbortController().signal);
    input.signal?.throwIfAborted();
    const publicFilename = s3Upload ? path.posix.basename(s3Upload.storageKey) : storedFilename;
    if (!EXPORT_FILENAME.test(publicFilename) || !publicFilename.startsWith(`${checksum.slice(0, 16)}-`)
      || (s3Upload && !EXPORT_KEY.test(s3Upload.storageKey))) fail('ASSET_STORAGE_KEY_INVALID');
    const target = path.resolve(directory, publicFilename);
    if (!target.startsWith(`${directory}${path.sep}`)) fail('ASSET_FILENAME_INVALID');
    const published = await publishStagedFileExclusive({
      directory: binding, temporary, target, bytes: input.bytes, signal: input.signal, owners, stage,
    });
    input.signal?.throwIfAborted();
    await assertExportDirectoryBinding(binding);
    await assertStagedChecksum(target, input.bytes, input.signal, owners.get(target));
    await removeOwnedExport(temporary, owners);
    await assertExportDirectoryBinding(binding);
    await assertStagedChecksum(target, input.bytes, input.signal, owners.get(target));
    let cleaned = false;
    return {
      url: `/api/serve-upload/exports/${publicFilename}`, availability: 'ready',
      ...(s3Upload ? { storageKey: s3Upload.storageKey } : {}),
      checksum, mimeType: input.mimeType, byteSize: input.bytes.length,
      ...verifiedDimensions,
      createdThisCall: published || s3Upload?.createdThisCall === true,
      cleanup: async () => {
        if (cleaned) return;
        const failures = await cleanupOwned(owners, s3Upload);
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, 'ASSET_CLEANUP_FAILED');
        cleaned = true;
      },
    };
  } catch (error) {
    const failures = await cleanupOwned(owners, s3Upload);
    if (failures.length) throw new AggregateError([error, ...failures], 'ASSET_PERSISTENCE_COMPENSATION_FAILED');
    throw error;
  } finally { await stage?.close(); }
}
