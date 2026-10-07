import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { getServerDataRoot } from '@/lib/server-data-root';
import { inspectS3ObjectExact, readS3ObjectRangeExact, S3BoundedReadError } from '@/lib/s3-storage';
import { downloadPublicImage, type DownloadPublicImageOptions, type DownloadedPublicImage } from '@/lib/safe-image-download';
import { downloadSafeVideoArtifact } from '@/lib/media-gateway/artifact-persistence';
import { persistAssetBytes, type PersistedAssetFile } from '@/lib/asset-core/binary-persistence';
import { validateBinaryImage } from '@/lib/asset-core/binary-image-validation';
import { binaryExtensions } from '@/lib/asset-core/binary-media-contract';
import { outputUrls, outputFileMetadata, type ProjectionTask } from '@/lib/asset-core/task-projector';
import { taskPublicationSnapshot, withoutAssetProjection, type PreparedTaskPublication } from './task-publication-output';
import { readBoundPrivateTaskVersion, type PreparedPrivateTaskVersion } from './document-task-version-adapter';
import { assertMediaActive, consumeMediaBody, DocumentMediaError, mediaImportLimit, IMAGE_IMPORT_LIMIT, VIDEO_IMPORT_LIMIT,
  type MediaAdoptionRequest, type MediaVersionImportRequest, type ReadMediaBody } from './document-media-request';

interface TaskRow { id: string; user_id: string; project_id: string; type: string; status: string; result: Record<string, unknown> }
interface SourceRow {
  id: string; asset_id: string; owner_id: string; project_id: string; task_id: string | null;
  file_url: string; storage_key: string | null; checksum: string | null; mime_type: string;
  byte_size: string | null; recovery_source_url: string | null;
  kind: 'image' | 'video'; version_record: Record<string, unknown>; asset_record: Record<string, unknown>;
}
interface TaskSnapshot { sourceKind: 'task'; task: TaskRow; source?: SourceRow; url: string; kind: 'image' | 'video'; parents?: SourceRow[]; outputIndex?: number }
interface VersionSnapshot { sourceKind: 'version'; source: SourceRow; project: Record<string, unknown>; url: string; kind: 'image' | 'video' }
type SourceSnapshot = TaskSnapshot | VersionSnapshot;
type MediaTaskSourceIdentity = Pick<MediaAdoptionRequest, 'projectId' | 'taskId' | 'outputIndex' | 'sourceVersionId'>;
declare const sourceBrand: unique symbol;
export interface MediaTaskSource { readonly [sourceBrand]: true }
declare const versionSourceBrand: unique symbol;
interface MediaVersionSource { readonly [versionSourceBrand]: true }
type MediaSource = MediaTaskSource | MediaVersionSource;
const sources = new WeakMap<MediaSource, SourceSnapshot>();
const automaticSources = new WeakMap<MediaSource, PreparedTaskPublication>();
const privateSources = new WeakMap<MediaSource, PreparedPrivateTaskVersion>();
function forbidden(): never { throw new DocumentMediaError('DOCUMENT_MEDIA_SOURCE_FORBIDDEN'); }
function conflict(): never { throw new DocumentMediaError('DOCUMENT_MEDIA_CONFLICT'); }
async function loadSource(actorId: string, input: MediaTaskSourceIdentity, client?: PoolClient,
  publication?: PreparedTaskPublication, privateVersion?: PreparedPrivateTaskVersion): Promise<TaskSnapshot> {
  if (privateVersion) {
    if (publication) forbidden();
    const bound = await readBoundPrivateTaskVersion(actorId, input, privateVersion, client);
    // image_edit must still enter via its exact prepared-publication contract.
    if (bound.task.id.startsWith('image_edit_')) forbidden();
    return { sourceKind: 'task', task: bound.task, source: bound.source,
      url: outputUrls({ ...bound.task, userId: bound.task.user_id, status: 'completed' } as ProjectionTask)[bound.outputIndex],
      kind: bound.source.kind, outputIndex: bound.outputIndex };
  }
  const db = client ?? getPool();
  const task = (await db.query<TaskRow>(`SELECT id,user_id,project_id,type,status,result FROM cloud_tasks
    WHERE id=$1 AND user_id=$2`, [input.taskId, actorId])).rows[0];
  if (!task || task.status !== 'completed' || !task.project_id || !task.result
    || typeof task.result !== 'object' || Array.isArray(task.result)) forbidden();
  const type = task.type.toLowerCase();
  if (task.id.startsWith('image_edit_') && !publication) forbidden();
  if (!type.includes('video') && (type.includes('3d') || type.includes('model'))) forbidden();
  const frozen = publication ? taskPublicationSnapshot(publication) : undefined;
  const output = frozen?.outputs[input.outputIndex];
  if (frozen && (!output || !isDeepStrictEqual(input, frozen.requests[input.outputIndex]))) forbidden();
  const url = frozen ? output!.url : outputUrls({ ...task, userId: task.user_id, status: 'completed' } as ProjectionTask)[input.outputIndex];
  if (!url) forbidden();
  const kind = type.includes('video') || (publication && task.result.videoUrl === url
    && outputUrls({ ...task, userId: task.user_id, status: 'completed', result: { ...task.result, videoUrl: undefined } } as ProjectionTask).length === 0) ? 'video' : 'image';
  if (publication) {
    const frozen = taskPublicationSnapshot(publication);
    if (frozen.access.actorId !== actorId || frozen.access.taskId !== input.taskId || frozen.access.projectId !== input.projectId) forbidden();
    const parents: SourceRow[] = [];
    for (const versionId of output!.intent.parentVersionIds) {
      const parent = (await db.query<SourceRow>(`SELECT version.*,asset.kind,
        to_jsonb(version) AS version_record,to_jsonb(asset) AS asset_record
        FROM wujie_asset_versions version JOIN wujie_assets asset
          ON asset.id=version.asset_id AND asset.owner_id=version.owner_id AND asset.project_id=version.project_id
        WHERE version.id=$1 AND version.owner_id=$2 AND version.project_id=$3
          AND version.availability='ready' AND asset.status='active' AND asset.kind IN ('image','video')
          ${client ? 'FOR SHARE OF version,asset' : ''}`, [versionId, frozen.access.ownerId, input.projectId])).rows[0];
      if (!parent) forbidden();
      parents.push(parent);
    }
    if (output!.intent.projectionMode === 'revision' && (parents.length !== 1 || parents[0].kind !== kind)) forbidden();
    return { sourceKind: 'task', task: { ...task, result: withoutAssetProjection(task.result) }, url, kind, parents, outputIndex: input.outputIndex };
  }
  if (!input.sourceVersionId) {
    if (task.project_id !== input.projectId) forbidden();
    return { sourceKind: 'task', task, url, kind };
  }
  const source = (await db.query<SourceRow>(`SELECT version.*,asset.kind,to_jsonb(version) AS version_record,to_jsonb(asset) AS asset_record
    FROM wujie_asset_versions version JOIN wujie_assets asset ON asset.id=version.asset_id
    JOIN wujie_projects project ON project.id=version.project_id AND project.owner_id=version.owner_id
    WHERE version.id=$1 AND version.owner_id=$2 AND version.task_id=$3 AND version.project_id=$4
      AND version.availability='ready' AND asset.status='active' AND project.status='active'
      AND asset.kind IN ('image','video') ${client ? 'FOR SHARE OF version,asset' : ''}`,
  [input.sourceVersionId, actorId, input.taskId, task.project_id])).rows[0];
  if (!source || source.kind !== kind || (source.file_url !== url && source.recovery_source_url !== url)) forbidden();
  return { sourceKind: 'task', task, source, url, kind };
}
async function loadVersionSource(actorId: string, input: MediaVersionImportRequest, client?: PoolClient): Promise<VersionSnapshot> {
  const db = client ?? getPool();
  const row = (await db.query<SourceRow & { project_record: Record<string, unknown> }>(`SELECT version.*,asset.kind,
    to_jsonb(version) AS version_record,to_jsonb(asset) AS asset_record,to_jsonb(project) AS project_record
    FROM wujie_asset_versions version
    JOIN wujie_assets asset ON asset.id=version.asset_id AND asset.owner_id=version.owner_id AND asset.project_id=version.project_id
    JOIN wujie_projects project ON project.id=version.project_id AND project.owner_id=version.owner_id
    WHERE version.id=$1 AND version.owner_id=$2 AND version.task_id IS NULL
      AND version.availability='ready' AND asset.status='active' AND project.status='active'
      AND asset.kind IN ('image','video') ${client ? 'FOR SHARE OF version,asset,project' : ''}`,
  [input.sourceVersionId, actorId])).rows[0];
  if (!row) forbidden();
  const { project_record: project, ...source } = row;
  return { sourceKind: 'version', source, project, url: source.file_url, kind: source.kind };
}
export async function prepareMediaVersionSource(actorId: string, input: MediaVersionImportRequest): Promise<MediaVersionSource> {
  const snapshot = await loadVersionSource(actorId, input);
  const capability = Object.freeze({}) as MediaVersionSource;
  sources.set(capability, snapshot);
  return capability;
}
export async function assertMediaVersionSource(client: PoolClient, actorId: string, input: MediaVersionImportRequest, capability: MediaSource): Promise<void> {
  const previous = sources.get(capability);
  if (!previous || previous.sourceKind !== 'version') forbidden();
  let current: VersionSnapshot;
  try { current = await loadVersionSource(actorId, input, client); }
  catch (error) { if (error instanceof DocumentMediaError) conflict(); throw error; }
  if (!isDeepStrictEqual(previous, current)) conflict();
}
export async function prepareMediaTaskSource(actorId: string, input: MediaTaskSourceIdentity,
  publication?: PreparedTaskPublication, privateVersion?: PreparedPrivateTaskVersion): Promise<MediaTaskSource> {
  const snapshot = await loadSource(actorId, input, undefined, publication, privateVersion);
  const capability = Object.freeze({}) as MediaTaskSource;
  sources.set(capability, snapshot);
  if (publication) automaticSources.set(capability, publication);
  if (privateVersion) privateSources.set(capability, privateVersion);
  return capability;
}
export function mediaSourceProject(capability: MediaSource): string {
  const snapshot = sources.get(capability);
  if (!snapshot) forbidden();
  return snapshot.sourceKind === 'task' ? snapshot.task.project_id : snapshot.source.project_id;
}
export function mediaSourceKind(capability: MediaSource): 'image' | 'video' {
  const snapshot = sources.get(capability);
  if (!snapshot) forbidden();
  return snapshot.kind;
}
/** The same trusted source capability determines both admission and read ceilings. */
export function mediaSourceLimit(capability: MediaSource): number {
  return mediaSourceKind(capability) === 'video' ? VIDEO_IMPORT_LIMIT : IMAGE_IMPORT_LIMIT;
}
/** Caller has task SHARE and both project locks; this performs only SQL reads. */
export async function assertMediaTaskSource(client: PoolClient, actorId: string, input: MediaTaskSourceIdentity, capability: MediaSource): Promise<void> {
  const previous = sources.get(capability);
  if (!previous || previous.sourceKind !== 'task') forbidden();
  let current: SourceSnapshot;
  try { current = await loadSource(actorId, input, client, automaticSources.get(capability), privateSources.get(capability)); }
  catch (error) { if (error instanceof DocumentMediaError) conflict(); throw error; }
  if (!isDeepStrictEqual(previous, current)) conflict();
}

async function readLocal(url: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  const relative = url.slice('/api/serve-upload/'.length);
  if (!/^[A-Za-z0-9._/-]+$/u.test(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) forbidden();
  const root = await realpath(getServerDataRoot());
  const filename = path.resolve(root, relative);
  const resolved = await realpath(filename);
  const inside = path.relative(root, resolved);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) forbidden();
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    const named = await lstat(filename, { bigint: true });
    if (!before.isFile() || !named.isFile() || before.ino !== named.ino || before.dev !== named.dev) conflict();
    if (before.size < BigInt(1) || before.size > BigInt(limit)) throw new DocumentMediaError('DOCUMENT_MEDIA_TOO_LARGE');
    const bytes = Buffer.allocUnsafe(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      assertMediaActive(signal);
      const { bytesRead } = await file.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset);
      if (!bytesRead) conflict();
      offset += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    const namedAfter = await lstat(filename, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || after.ino !== namedAfter.ino || after.dev !== namedAfter.dev || await realpath(filename) !== resolved) conflict();
    assertMediaActive(signal);
    return bytes;
  } finally { await file.close(); }
}
async function readS3(key: string, mimeType: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  try { return await readFixedS3Object(key, mimeType, limit, signal); }
  catch (error) {
    assertMediaActive(signal);
    if (error instanceof S3BoundedReadError) conflict();
    throw error;
  }
}
async function readFixedS3Object(key: string, mimeType: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  const initial = await inspectS3ObjectExact(key, 30_000, signal);
  if (!initial || initial.contentType !== mimeType || initial.byteSize < 1) conflict();
  if (initial.byteSize > limit) throw new DocumentMediaError('DOCUMENT_MEDIA_TOO_LARGE');
  const bytes = Buffer.allocUnsafe(initial.byteSize);
  for (let offset = 0; offset < bytes.length;) {
    assertMediaActive(signal);
    const end = Math.min(offset + 16 * 1024 * 1024, bytes.length) - 1;
    const chunk = await readS3ObjectRangeExact(key, { start: offset, end }, {
      expectedTotalBytes: initial.byteSize, maxBytes: end - offset + 1, timeoutMs: 30_000,
      eTag: initial.eTag, versionId: initial.versionId, contentType: mimeType, signal,
    });
    if (!chunk || chunk.bytes.length !== end - offset + 1) conflict();
    chunk.bytes.copy(bytes, offset); offset = end + 1;
  }
  return bytes;
}
function mimeFromUrl(url: string): string | undefined {
  const extension = url.split(/[?#]/u, 1)[0].split('.').pop()?.toLowerCase();
  return Object.keys({ 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1, 'image/avif': 1,
    'image/bmp': 1, 'video/mp4': 1, 'video/webm': 1, 'video/quicktime': 1, 'video/x-m4v': 1 })
    .find(mime => binaryExtensions(mime)?.includes(extension ?? ''));
}

declare const preparedBrand: unique symbol;
export interface PreparedImportedMedia { readonly [preparedBrand]: true }
export interface PreparedMediaIdentity {
  readonly actorId: string; readonly ownerId: string; readonly projectId: string;
  readonly assetId: string; readonly versionId: string; readonly kind: 'image' | 'video'; readonly file: Readonly<PersistedAssetFile>;
}
const prepared = new WeakMap<PreparedImportedMedia, PreparedMediaIdentity>();
const revisions = new WeakMap<PreparedImportedMedia, Record<string, unknown>>();
export function importedMediaRevision(capability: PreparedImportedMedia): Record<string, unknown> | undefined {
  importedMediaIdentity(capability);
  const original = revisions.get(capability);
  return original ? structuredClone(original) : undefined;
}
export function importedMediaIdentity(capability: PreparedImportedMedia): PreparedMediaIdentity {
  const identity = prepared.get(capability);
  if (!identity) conflict();
  return identity;
}
async function persist(bytes: Buffer, mimeType: string, filename: string, actorId: string, ownerId: string,
  projectId: string, signal: AbortSignal, source?: MediaSource): Promise<PreparedImportedMedia> {
  // Only the original source WeakMap and DB-minted publication capability may
  // select a revision family. No assetId override or structural permission input.
  const publication = source ? automaticSources.get(source) : undefined;
  const frozen = publication ? taskPublicationSnapshot(publication) : undefined;
  const snapshot = source ? sources.get(source) : undefined;
  const output = frozen && snapshot?.sourceKind === 'task' ? frozen.outputs[snapshot.outputIndex!] : undefined;
  if (frozen && !output) forbidden();
  const parent = output?.intent.projectionMode === 'revision' && snapshot?.sourceKind === 'task' ? snapshot.parents?.[0] : undefined;
  if (frozen && (frozen.access.actorId !== actorId || frozen.access.ownerId !== ownerId || frozen.access.projectId !== projectId)) forbidden();
  if (output?.intent.projectionMode === 'revision' && (!parent || parent.kind !== (mimeType.startsWith('video/') ? 'video' : 'image'))) forbidden();
  if (bytes.length > mediaImportLimit(mimeType)) throw new DocumentMediaError('DOCUMENT_MEDIA_TOO_LARGE');
  // B2a persistence handles GIF/AVIF/BMP/video strictly. Decode the three legacy
  // image formats as well; their persistence path otherwise checks only metadata.
  if (['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) await validateBinaryImage(bytes, mimeType, signal);
  const file = await persistAssetBytes({ bytes, mimeType, filename, signal });
  const capability = Object.freeze({}) as PreparedImportedMedia;
  prepared.set(capability, Object.freeze({ actorId, ownerId, projectId, assetId: parent?.asset_id ?? randomUUID(), versionId: randomUUID(),
    kind: mimeType.startsWith('video/') ? 'video' : 'image', file: Object.freeze(file) }));
  if (parent) revisions.set(capability, structuredClone(parent.asset_record));
  return capability;
}
export async function prepareUploadedMedia(body: ReadMediaBody, mimeType: string, filename: string,
  actorId: string, ownerId: string, projectId: string, signal: AbortSignal): Promise<PreparedImportedMedia> {
  const data = consumeMediaBody(body);
  if (!data.bytes) throw new DocumentMediaError('DOCUMENT_MEDIA_INVALID');
  return persist(data.bytes, mimeType, filename, actorId, ownerId, projectId, signal);
}
export async function prepareAdoptedMedia(capability: MediaSource, actorId: string, ownerId: string,
  projectId: string, signal: AbortSignal): Promise<PreparedImportedMedia> {
  const snapshot = sources.get(capability);
  if (!snapshot || (snapshot.sourceKind === 'task' ? snapshot.task.user_id : snapshot.source.owner_id) !== actorId) forbidden();
  const result = snapshot.sourceKind === 'task' ? snapshot.task.result : {};
  const metadata = outputFileMetadata(result, snapshot.url);
  const selectedMetadata = [...(Array.isArray(result.images) ? result.images : []),
    result.image, result.video].find((value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).url === snapshot.url);
  const source = snapshot.source;
  let mimeType = source?.mime_type ?? metadata.mimeType ?? mimeFromUrl(snapshot.url);
  const storageKey = source?.storage_key ?? metadata.storageKey;
  const url = source?.file_url ?? snapshot.url;
  const limit = mediaSourceLimit(capability);
  // Reject contradictory server metadata before opening a file, HEAD/range IO,
  // or allocating a body. A MIME cannot enlarge the source's admitted budget.
  if (mimeType && (!mimeType.startsWith(`${snapshot.kind}/`) || mediaImportLimit(mimeType) !== limit)) forbidden();
  let bytes: Buffer;
  if (storageKey) {
    if (!mimeType) forbidden();
    bytes = await readS3(storageKey, mimeType, limit, signal);
  } else if (url.startsWith('/api/serve-upload/')) {
    if (!mimeType) forbidden();
    bytes = await readLocal(url, limit, signal);
  } else if (snapshot.kind === 'video') {
    const download = await downloadSafeVideoArtifact({ sourceUrl: url, signal,
      download: (sourceUrl: string | URL, options: DownloadPublicImageOptions = {}): Promise<DownloadedPublicImage> =>
        downloadPublicImage(sourceUrl, { ...options, maxBytes: Math.min(limit, options.maxBytes ?? limit) }) });
    bytes = download.buffer; mimeType = download.mediaType.mimeType;
  } else {
    const download = await downloadPublicImage(url, { maxBytes: limit, timeoutMs: 120_000, signal,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'] });
    bytes = download.buffer; mimeType = download.mimeType;
  }
  if (!mimeType || !mimeType.startsWith(`${snapshot.kind}/`)) forbidden();
  if (bytes.length > limit) throw new DocumentMediaError('DOCUMENT_MEDIA_TOO_LARGE');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const expectedChecksum = source?.checksum ?? selectedMetadata?.checksum;
  const expectedSize = source?.byte_size ?? metadata.byteSize;
  if ((expectedChecksum !== undefined && expectedChecksum !== null && checksum !== expectedChecksum)
    || (expectedSize !== undefined && expectedSize !== null && Number(expectedSize) !== bytes.length)) conflict();
  return persist(bytes, mimeType, `adopted.${binaryExtensions(mimeType)?.[0]}`, actorId, ownerId, projectId, signal, capability);
}
