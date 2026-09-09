import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getServerDataRoot } from '@/lib/server-data-root';
import { uploadBinaryToS3 } from '@/lib/s3-storage';
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

export async function persistAssetBytes(input: PersistAssetBytesInput): Promise<AssetFile> {
  input.signal?.throwIfAborted();
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > MAX_BINARY_BYTES) {
    fail('ASSET_BYTES_INVALID');
  }
  if (typeof input.mimeType !== 'string' || !EXTENSION_BY_MIME.has(input.mimeType)) {
    fail('ASSET_MIME_TYPE_INVALID');
  }
  const filename = normalizeFilename(input.filename, input.mimeType);
  const checksum = createHash('sha256').update(input.bytes).digest('hex');
  const asciiFilename = filename.replace(/[^A-Za-z0-9._-]/gu, '_');
  const storedFilename = `${checksum.slice(0, 16)}-${asciiFilename}`;
  const root = path.resolve(getServerDataRoot());
  const directory = path.resolve(root, 'exports');
  const target = path.resolve(directory, storedFilename);
  if (!target.startsWith(`${directory}${path.sep}`)) fail('ASSET_FILENAME_INVALID');
  const temporary = path.resolve(directory, `.${storedFilename}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  input.signal?.throwIfAborted();
  let publishedByThisCall = false;
  try {
    await writeFile(temporary, input.bytes, { flag: 'wx', signal: input.signal });
    input.signal?.throwIfAborted();
    await link(temporary, target).then(() => { publishedByThisCall = true; }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    await rm(temporary, { force: true });
    const storageKey = await uploadBinaryToS3(
      input.bytes,
      storedFilename,
      input.mimeType,
      input.signal ?? new AbortController().signal,
    );
    input.signal?.throwIfAborted();
    return {
      url: `/api/serve-upload/exports/${storedFilename}`,
      availability: 'ready',
      ...(storageKey ? { storageKey } : {}),
      checksum,
      mimeType: input.mimeType,
      byteSize: input.bytes.length,
    };
  } catch (error) {
    await Promise.all([
      rm(temporary, { force: true }),
      ...(publishedByThisCall ? [rm(target, { force: true })] : []),
    ]).catch(() => undefined);
    throw error;
  }
}
