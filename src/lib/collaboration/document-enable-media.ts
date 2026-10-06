import 'server-only';

import { lstat, mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getServerDataRoot } from '@/lib/server-data-root';
import { inspectManagedImageMetadata } from '@/lib/asset-core/image-result-metadata';
import { readManagedAssetVersionBytes } from '@/lib/asset-core/managed-media-read';
import { validateRecoveredSourceMedia } from '@/lib/asset-core/binary-media-validation';
import { inspectPersistedVideoFile, mimeTypeForVideoPath } from '@/lib/asset-core/video-file-metadata';
import type { InspectManagedLegacyMedia, VerifiedLegacyMedia } from '@/lib/asset-core/legacy-migration';
import type { AssetVersion } from '@/lib/asset-core/types';
import { deriveS3Key, inspectS3ObjectExact, readS3ObjectRangeExact } from '@/lib/s3-storage';

let activeBytes = 0;
let activeInspections = 0;
const MAX_BYTES = 200 * 1024 * 1024;
const READ_CHUNK = 16 * 1024 * 1024;
const sourceChecks = new WeakMap<VerifiedLegacyMedia, () => Promise<void>>();

async function assertUnlinkedSource(root: string, relative: string): Promise<void> {
  let current = root;
  for (const part of ['', ...relative.split('/')]) {
    if (part) current = path.join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink !== 1)) {
      throw new Error('DOCUMENT_MEDIA_SOURCE_CHANGED');
    }
  }
}

export async function assertDocumentEnableMediaUnchanged(
  media: Readonly<Record<string, VerifiedLegacyMedia>>,
): Promise<void> {
  for (const inspected of Object.values(media)) {
    if (!inspected.mimeType.startsWith('video/')) continue;
    const check = sourceChecks.get(inspected);
    if (!check) throw new Error('DOCUMENT_MEDIA_SOURCE_CHANGED');
    await check();
  }
}

export const inspectDocumentEnableMedia: InspectManagedLegacyMedia = async ({ url, kind }) => {
  if (kind === 'image') return { url, ...await inspectManagedImageMetadata(url) };
  const relative = url.startsWith('/api/serve-upload/') ? url.slice('/api/serve-upload/'.length)
    : url.startsWith('/uploads/') ? url.slice(1) : '';
  if (!relative.startsWith('uploads/') || !/^[A-Za-z0-9._/-]+$/u.test(relative)
    || relative.split('/').some(part => !part || part === '.' || part === '..')
    || !/\.(mp4|webm|mov|m4v)$/iu.test(relative)) throw new Error('DOCUMENT_MEDIA_SOURCE_INVALID');
  const root = getServerDataRoot();
  const filename = path.resolve(root, relative);
  const stats = await lstat(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stats && (!stats.isFile() || stats.nlink !== 1 || stats.size < 1 || stats.size > MAX_BYTES)) {
    throw new Error('DOCUMENT_MEDIA_SOURCE_INVALID');
  }
  const mimeType = mimeTypeForVideoPath(filename);
  const storageKey = stats ? undefined : deriveS3Key(relative);
  const inspectedObject = storageKey ? await inspectS3ObjectExact(storageKey, 30_000) : null;
  const object = inspectedObject ? Object.freeze({ ...inspectedObject }) : null;
  const size = stats?.size ?? object?.byteSize ?? 0;
  if (!stats && (!object || object.contentType !== mimeType || (!object.eTag && !object.versionId)
    || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES)) throw new Error('DOCUMENT_MEDIA_SOURCE_INVALID');
  if (activeInspections >= 2 || activeBytes + size > 256 * 1024 * 1024) throw new Error('ASSET_MEDIA_BUSY');
  activeInspections++; activeBytes += size;
  try {
    if (stats) await assertUnlinkedSource(root, relative);
    const version: AssetVersion = { id: 'enable-preflight', assetId: 'enable-preflight', ownerId: '', projectId: '',
      file: { url, availability: 'ready', mimeType, byteSize: size }, parentVersionIds: [], createdAt: '' };
    const bytes = Buffer.alloc(size);
    for (let start = 0; start < size; start += READ_CHUNK) {
      const end = Math.min(start + READ_CHUNK, size) - 1;
      const chunk = storageKey && object
        ? await readS3ObjectRangeExact(storageKey, { start, end }, {
          expectedTotalBytes: size, maxBytes: READ_CHUNK, timeoutMs: 30_000,
          eTag: object.eTag, versionId: object.versionId,
        })
        : await readManagedAssetVersionBytes(version, 'video', {
          dataRoot: root, maxBytes: READ_CHUNK, range: { start, end },
        });
      if (!chunk || chunk.totalBytes !== size || chunk.bytes.length !== end - start + 1) throw new Error('DOCUMENT_MEDIA_SOURCE_CHANGED');
      chunk.bytes.copy(bytes, start);
    }
    await validateRecoveredSourceMedia(bytes, mimeType);
    const directory = await mkdtemp(path.join(tmpdir(), 'wujie-enable-video-metadata-'));
    const snapshotPath = path.join(directory, `input${path.extname(filename).toLowerCase()}`);
    let metadata;
    try {
      await writeFile(snapshotPath, bytes, { flag: 'wx' });
      metadata = await inspectPersistedVideoFile(snapshotPath, bytes.length);
    } finally { await rm(snapshotPath, { force: true }); await rmdir(directory); }
    const checkSource = async (): Promise<void> => {
      if (stats) {
        await assertUnlinkedSource(root, relative);
        const after = await lstat(filename);
        if (!after.isFile() || after.nlink !== 1 || stats.ino !== after.ino || stats.dev !== after.dev || stats.size !== after.size
          || stats.mtimeMs !== after.mtimeMs || stats.ctimeMs !== after.ctimeMs) throw new Error('DOCUMENT_MEDIA_SOURCE_CHANGED');
      } else if (storageKey && object) {
        const current = await inspectS3ObjectExact(storageKey, 30_000);
        if (!current || current.byteSize !== object.byteSize || current.contentType !== object.contentType
          || current.eTag !== object.eTag || current.versionId !== object.versionId) throw new Error('DOCUMENT_MEDIA_SOURCE_CHANGED');
      } else throw new Error('DOCUMENT_MEDIA_SOURCE_CHANGED');
    };
    await checkSource();
    const result = { url, ...metadata, ...(storageKey ? { storageKey } : {}) };
    sourceChecks.set(result, checkSource);
    return result;
  } finally { activeInspections--; activeBytes -= size; }
};
