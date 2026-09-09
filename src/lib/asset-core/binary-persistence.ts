import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';

import { getServerDataRoot } from '@/lib/server-data-root';
import { uploadBinaryToS3, type S3BinaryUploadResult } from '@/lib/s3-storage';
import type { AssetFile } from './types';
import { assetBinaryFileOps } from './binary-file-ops';

const MAX_BINARY_BYTES = 256 * 1024 * 1024;
const EXTENSION_BY_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpeg'],
  ['image/webp', '.webp'],
  ['application/json', '.json'],
  ['application/zip', '.zip'],
]);

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

function normalizeFilename(value: unknown, mimeType: string): string {
  if (typeof value !== 'string' || value !== value.normalize('NFC')) fail('ASSET_FILENAME_INVALID');
  if (
    value !== path.basename(value)
    || value.includes('/')
    || value.includes('\\')
    || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,199}$/u.test(value)
    || /[. ]$/u.test(value)
  ) fail('ASSET_FILENAME_INVALID');
  const expected = EXTENSION_BY_MIME.get(mimeType);
  if (!expected) fail('ASSET_MIME_TYPE_INVALID');
  const extension = path.extname(value).toLowerCase();
  if (!(mimeType === 'image/jpeg' && (extension === '.jpg' || extension === '.jpeg')) && extension !== expected) {
    fail('ASSET_FILENAME_MIME_MISMATCH');
  }
  return value;
}

export async function validateAssetBinaryFormat(bytes: Buffer, mimeType: string): Promise<void> {
  try {
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
  } catch (error) {
    if (error instanceof TypeError && error.message === 'ASSET_BINARY_FORMAT_INVALID') throw error;
    fail('ASSET_BINARY_FORMAT_INVALID');
  }
}

function exportTarget(filename: string): { directory: string; target: string } {
  const root = path.resolve(getServerDataRoot());
  const directory = path.resolve(root, 'exports');
  const target = path.resolve(directory, filename);
  if (!target.startsWith(`${directory}${path.sep}`)) fail('ASSET_FILENAME_INVALID');
  return { directory, target };
}

/** Atomically restore one content-addressed export without exposing partial bytes. */
export async function recoverExportAssetBytes(input: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
}): Promise<void> {
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > MAX_BINARY_BYTES) {
    fail('ASSET_BYTES_INVALID');
  }
  normalizeFilename(input.filename, input.mimeType);
  const match = input.filename.match(/^([a-f0-9]{16})-[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|json|zip)$/u);
  if (!match || createHash('sha256').update(input.bytes).digest('hex').slice(0, 16) !== match[1]) {
    fail('ASSET_RECOVERY_CHECKSUM_MISMATCH');
  }
  await validateAssetBinaryFormat(input.bytes, input.mimeType);
  const { directory, target } = exportTarget(input.filename);
  const temporary = path.resolve(directory, `.${input.filename}.${randomUUID()}.recover.tmp`);
  await assetBinaryFileOps.mkdir(directory, { recursive: true });
  try {
    await assetBinaryFileOps.writeFile(temporary, input.bytes, { flag: 'wx' });
    const staged = await assetBinaryFileOps.readFile(temporary);
    if (createHash('sha256').update(staged).digest('hex').slice(0, 16) !== match[1]) {
      fail('ASSET_RECOVERY_CHECKSUM_MISMATCH');
    }
    await validateAssetBinaryFormat(staged, input.mimeType);
    try {
      await assetBinaryFileOps.link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await assetBinaryFileOps.readFile(target);
      if (createHash('sha256').update(existing).digest('hex').slice(0, 16) !== match[1]) {
        fail('ASSET_RECOVERY_CHECKSUM_MISMATCH');
      }
      await validateAssetBinaryFormat(existing, input.mimeType);
    }
  } finally {
    await assetBinaryFileOps.rm(temporary, { force: true });
  }
}

export async function persistAssetBytes(input: PersistAssetBytesInput): Promise<PersistedAssetFile> {
  input.signal?.throwIfAborted();
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > MAX_BINARY_BYTES) {
    fail('ASSET_BYTES_INVALID');
  }
  if (typeof input.mimeType !== 'string' || !EXTENSION_BY_MIME.has(input.mimeType)) {
    fail('ASSET_MIME_TYPE_INVALID');
  }
  const filename = normalizeFilename(input.filename, input.mimeType);
  await validateAssetBinaryFormat(input.bytes, input.mimeType);
  input.signal?.throwIfAborted();
  const checksum = createHash('sha256').update(input.bytes).digest('hex');
  const asciiFilename = filename.replace(/[^A-Za-z0-9._-]/gu, '_');
  const storedFilename = `${checksum.slice(0, 16)}-${asciiFilename}`;
  const root = path.resolve(getServerDataRoot());
  const directory = path.resolve(root, 'exports');
  const temporary = path.resolve(directory, `.${storedFilename}.${randomUUID()}.tmp`);
  await assetBinaryFileOps.mkdir(directory, { recursive: true });
  input.signal?.throwIfAborted();
  let publishedByThisCall = false;
  let s3Upload: S3BinaryUploadResult | null = null;
  let target: string | undefined;
  try {
    await assetBinaryFileOps.writeFile(temporary, input.bytes, { flag: 'wx', signal: input.signal });
    input.signal?.throwIfAborted();
    s3Upload = await uploadBinaryToS3(
      input.bytes,
      storedFilename,
      input.mimeType,
      input.signal ?? new AbortController().signal,
    );
    input.signal?.throwIfAborted();
    const publicFilename = s3Upload ? path.posix.basename(s3Upload.storageKey) : storedFilename;
    if (!new RegExp(`^${checksum.slice(0, 16)}-[A-Za-z0-9._-]+\\.(?:png|jpe?g|webp|json|zip)$`, 'u').test(publicFilename)) {
      fail('ASSET_STORAGE_KEY_INVALID');
    }
    target = path.resolve(directory, publicFilename);
    if (!target.startsWith(`${directory}${path.sep}`)) fail('ASSET_FILENAME_INVALID');
    await assetBinaryFileOps.link(temporary, target).then(() => { publishedByThisCall = true; }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    await assetBinaryFileOps.rm(temporary, { force: true });
    const cleanupTarget = target;
    let cleaned = false;
    return {
      url: `/api/serve-upload/exports/${publicFilename}`,
      availability: 'ready',
      ...(s3Upload ? { storageKey: s3Upload.storageKey } : {}),
      checksum,
      mimeType: input.mimeType,
      byteSize: input.bytes.length,
      createdThisCall: publishedByThisCall || s3Upload?.createdThisCall === true,
      cleanup: async () => {
        if (cleaned) return;
        const failures: unknown[] = [];
        if (publishedByThisCall) await assetBinaryFileOps.rm(cleanupTarget, { force: true }).catch(error => failures.push(error));
        if (s3Upload?.createdThisCall) await s3Upload.cleanup().catch(error => failures.push(error));
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, 'ASSET_CLEANUP_FAILED');
        cleaned = true;
      },
    };
  } catch (error) {
    const failures: unknown[] = [];
    await assetBinaryFileOps.rm(temporary, { force: true }).catch(cleanupError => failures.push(cleanupError));
    if (publishedByThisCall && target) await assetBinaryFileOps.rm(target, { force: true }).catch(cleanupError => failures.push(cleanupError));
    if (s3Upload?.createdThisCall) await s3Upload.cleanup().catch(cleanupError => failures.push(cleanupError));
    if (failures.length > 0) throw new AggregateError([error, ...failures], 'ASSET_PERSISTENCE_COMPENSATION_FAILED');
    throw error;
  }
}
