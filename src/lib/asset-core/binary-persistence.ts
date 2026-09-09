import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';

import { getServerDataRoot } from '@/lib/server-data-root';
import { uploadBinaryToS3, type S3BinaryUploadResult } from '@/lib/s3-storage';
import type { AssetFile } from './types';

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

async function validateBinaryFormat(bytes: Buffer, mimeType: string): Promise<void> {
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

export async function persistAssetBytes(input: PersistAssetBytesInput): Promise<PersistedAssetFile> {
  input.signal?.throwIfAborted();
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > MAX_BINARY_BYTES) {
    fail('ASSET_BYTES_INVALID');
  }
  if (typeof input.mimeType !== 'string' || !EXTENSION_BY_MIME.has(input.mimeType)) {
    fail('ASSET_MIME_TYPE_INVALID');
  }
  const filename = normalizeFilename(input.filename, input.mimeType);
  await validateBinaryFormat(input.bytes, input.mimeType);
  input.signal?.throwIfAborted();
  const checksum = createHash('sha256').update(input.bytes).digest('hex');
  const asciiFilename = filename.replace(/[^A-Za-z0-9._-]/gu, '_');
  const storedFilename = `${checksum.slice(0, 16)}-${asciiFilename}`;
  const root = path.resolve(getServerDataRoot());
  const directory = path.resolve(root, 'exports');
  const temporary = path.resolve(directory, `.${storedFilename}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  input.signal?.throwIfAborted();
  let publishedByThisCall = false;
  let s3Upload: S3BinaryUploadResult | null = null;
  try {
    await writeFile(temporary, input.bytes, { flag: 'wx', signal: input.signal });
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
    const target = path.resolve(directory, publicFilename);
    if (!target.startsWith(`${directory}${path.sep}`)) fail('ASSET_FILENAME_INVALID');
    await link(temporary, target).then(() => { publishedByThisCall = true; }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    await rm(temporary, { force: true });
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
        cleaned = true;
        await Promise.all([
          ...(publishedByThisCall ? [rm(target, { force: true })] : []),
          ...(s3Upload?.createdThisCall ? [s3Upload.cleanup()] : []),
        ]);
      },
    };
  } catch (error) {
    await Promise.all([
      rm(temporary, { force: true }),
      ...(s3Upload?.createdThisCall ? [s3Upload.cleanup()] : []),
    ]).catch(() => undefined);
    throw error;
  }
}
