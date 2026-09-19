import { randomUUID } from 'node:crypto';

import {
  getManagedAssetMediaDescriptor,
  readManagedAssetVersionBytes,
  type ManagedAssetMediaDescriptor,
  type ManagedMediaReadOptions,
  type ManagedMediaReadResult,
} from '@/lib/asset-core/managed-media-read';
import type { Asset, AssetVersion } from '@/lib/asset-core/types';
import {
  lockCanvasProjectRevision,
  readCanvasProjectRevision,
} from '@/lib/asset-core/canvas-project-sync';
import {
  type AssetCoreSqlTransaction,
  createAssetStorageTransaction,
  lockAssetGraphWriteGate,
  withAssetCoreTransaction,
} from '@/lib/asset-core/storage';

import { CanvasShareError } from './errors';
import {
  buildCanvasShareSnapshot,
  inspectCanvasShareReadiness,
  type CanvasShareReadinessInspection,
  type CanvasShareSnapshotSource,
} from './snapshot';
import {
  findCanvasShareForOwner as findCanvasShareForOwnerInStorage,
  insertCanvasShare,
  listCanvasShares as listCanvasSharesInStorage,
  revokeCanvasShare as revokeCanvasShareInStorage,
  type CanvasSharePublicSnapshotContext,
  type StoredCanvasShareSnapshot,
  updateCanvasSharePolicyIfCurrent as updateCanvasSharePolicyIfCurrentInStorage,
  type CanvasShareExpectedPolicy,
  type CanvasShareOwnerRecord,
  withActiveCanvasShareMediaSnapshot,
  withActiveCanvasShareSnapshot,
} from './storage';
import {
  assertCanvasShareSnapshotIntegrity,
  computeCanvasShareSnapshotDigestForRead,
  createCanvasShareDownloadFileName,
  projectCanvasShareForPublic,
  resolveCanvasSharePublicItem,
} from './public-projection';
import { createCanvasShareToken, hashCanvasShareToken } from './token';
import type {
  CanvasShareItemRecord,
  CanvasSharePolicyPatch,
  CanvasSharePublicDocument,
  CanvasShareRecord,
  CanvasShareViewport,
} from './types';
import type { CanvasShareSnapshot } from './snapshot';

const DEFAULT_EXPIRY_DAYS = 30;

export interface CreateCanvasShareInput {
  actorUserId: string;
  projectId: string;
  title: string;
  requestedViewport?: Partial<CanvasShareViewport> | null;
  expiresAt?: string | null;
  allowDownload?: boolean;
}

export interface CanvasShareCreatePersistenceInput {
  id: string;
  ownerId: string;
  projectId: string;
  tokenHash: string;
  title: string;
  expiresAt: string | null;
  allowDownload: boolean;
  requestedViewport?: Partial<CanvasShareViewport> | null;
  createdAt: string;
}

export interface CreateCanvasShareDependencies {
  createToken(): string;
  hashToken(token: string): string;
  createId(): string;
  now(): Date;
  createSnapshotAndInsert(
    input: CanvasShareCreatePersistenceInput,
  ): Promise<StoredCanvasShareSnapshot>;
}

export interface CreateCanvasShareResult {
  share: CanvasShareRecord;
  token: string;
  itemCount: number;
}

export interface CanvasShareSnapshotInspectionInput {
  ownerId: string;
  projectId: string;
  requestedViewport?: Partial<CanvasShareViewport> | null;
}

function unauthorized(): never {
  throw new CanvasShareError('CANVAS_SHARE_UNAUTHORIZED');
}

function notFound(): never {
  throw new CanvasShareError('CANVAS_SHARE_NOT_FOUND');
}

function policyConflict(): never {
  throw new CanvasShareError('CANVAS_SHARE_POLICY_CONFLICT');
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (!title || title.length > 200) return policyConflict();
  return title;
}

function defaultExpiry(now: Date): string {
  return new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1_000).toISOString();
}

function normalizeExpiry(value: string | null | undefined, now: Date): string | null {
  if (value === null) return null;
  if (value === undefined) return defaultExpiry(now);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
    return policyConflict();
  }
  return parsed.toISOString();
}

async function prepareCanvasShareSnapshotSource(
  input: CanvasShareSnapshotInspectionInput,
  client: AssetCoreSqlTransaction,
): Promise<{ source: CanvasShareSnapshotSource; projectName: string }> {
  await lockAssetGraphWriteGate(client, 'shared');
  await lockCanvasProjectRevision(client, input.ownerId);
  const assetStorage = createAssetStorageTransaction(client);
  const projectResult = await client.query(
    `SELECT name
       FROM wujie_projects
      WHERE id = $1 AND owner_id = $2 AND status = $3`,
    [input.projectId, input.ownerId, 'active'],
  );
  const project = projectResult.rows[0];
  if (!project) unauthorized();
  const projectName = typeof project.name === 'string' && project.name.trim()
    ? project.name.trim()
    : '未命名项目';
  return {
    projectName,
    source: {
      readProjectRevision: ownerId => readCanvasProjectRevision(ownerId, client),
      listActiveCanvasPlacements: (ownerId, projectId) => (
        assetStorage.listActiveCanvasPlacements(ownerId, projectId)
      ),
      findAsset: (ownerId, projectId, assetId) => (
        assetStorage.findAsset(ownerId, projectId, assetId)
      ),
      findVersion: (ownerId, projectId, versionId) => (
        assetStorage.findVersion(ownerId, projectId, versionId)
      ),
      getMediaDescriptor: (version, kind) => getManagedAssetMediaDescriptor(version, kind),
    },
  };
}

async function buildCanvasShareSnapshotInTransaction(
  input: CanvasShareSnapshotInspectionInput,
  client: AssetCoreSqlTransaction,
): Promise<Readonly<CanvasShareSnapshot>> {
  const { source } = await prepareCanvasShareSnapshotSource(input, client);
  return buildCanvasShareSnapshot(input, source);
}

async function createSnapshotAndInsertPostgres(
  input: CanvasShareCreatePersistenceInput,
): Promise<StoredCanvasShareSnapshot> {
  return withAssetCoreTransaction(async client => {
    const snapshot = await buildCanvasShareSnapshotInTransaction({
      ownerId: input.ownerId,
      projectId: input.projectId,
      requestedViewport: input.requestedViewport,
    }, client);
    const record: CanvasShareRecord = {
      id: input.id,
      ownerId: input.ownerId,
      projectId: input.projectId,
      projectRevision: snapshot.projectRevision,
      tokenHash: input.tokenHash,
      title: input.title,
      status: 'active',
      expiresAt: input.expiresAt,
      allowDownload: input.allowDownload,
      viewport: snapshot.viewport,
      snapshotDigest: snapshot.snapshotDigest,
      viewCount: 0,
      lastViewedAt: null,
      createdAt: input.createdAt,
      revokedAt: null,
    };
    const items: CanvasShareItemRecord[] = snapshot.items.map(item => ({
      ...item,
      id: randomUUID(),
      shareId: record.id,
      createdAt: record.createdAt,
      byteSize: item.byteSize,
    }));
    return insertCanvasShare(record, items, client);
  });
}

export async function inspectCanvasSharePreflightInTransaction(
  input: CanvasShareSnapshotInspectionInput,
  client: AssetCoreSqlTransaction,
): Promise<Readonly<CanvasSharePreflightResult>> {
  const { source, projectName } = await prepareCanvasShareSnapshotSource(input, client);
  return {
    projectName,
    ...await inspectCanvasShareReadiness(input, source),
  };
}

async function inspectCanvasSharePostgres(
  input: CanvasShareSnapshotInspectionInput,
): Promise<Readonly<CanvasSharePreflightResult>> {
  return withAssetCoreTransaction(client => (
    inspectCanvasSharePreflightInTransaction(input, client)
  ));
}

export interface PreflightCanvasShareInput {
  actorUserId: string;
  projectId: string;
  requestedViewport?: Partial<CanvasShareViewport> | null;
}

export type CanvasSharePreflightResult = CanvasShareReadinessInspection & {
  projectName: string;
};

export interface PreflightCanvasShareDependencies {
  inspect(
    input: CanvasShareSnapshotInspectionInput,
  ): Promise<Readonly<CanvasSharePreflightResult>>;
}

export async function preflightCanvasShare(
  input: PreflightCanvasShareInput,
  dependencies: PreflightCanvasShareDependencies = { inspect: inspectCanvasSharePostgres },
): Promise<CanvasSharePreflightResult> {
  return dependencies.inspect({
    ownerId: input.actorUserId,
    projectId: input.projectId,
    ...(input.requestedViewport === undefined
      ? {}
      : { requestedViewport: input.requestedViewport }),
  });
}

function defaultCreateDependencies(): CreateCanvasShareDependencies {
  return {
    createToken: createCanvasShareToken,
    hashToken: hashCanvasShareToken,
    createId: randomUUID,
    now: () => new Date(),
    createSnapshotAndInsert: createSnapshotAndInsertPostgres,
  };
}

export async function createCanvasShare(
  input: CreateCanvasShareInput,
  dependencies: CreateCanvasShareDependencies = defaultCreateDependencies(),
): Promise<CreateCanvasShareResult> {
  const now = dependencies.now();
  const token = dependencies.createToken();
  const stored = await dependencies.createSnapshotAndInsert({
    id: dependencies.createId(),
    ownerId: input.actorUserId,
    projectId: input.projectId,
    tokenHash: dependencies.hashToken(token),
    title: normalizeTitle(input.title),
    expiresAt: normalizeExpiry(input.expiresAt, now),
    allowDownload: input.allowDownload ?? false,
    ...(input.requestedViewport === undefined
      ? {}
      : { requestedViewport: input.requestedViewport }),
    createdAt: now.toISOString(),
  });
  return {
    share: stored.record,
    token,
    itemCount: stored.items.length,
  };
}

export interface ListCanvasSharesInput {
  actorUserId: string;
  projectId: string;
}

export interface ListCanvasSharesDependencies {
  now(): Date;
  list(
    ownerId: string,
    projectId: string,
  ): Promise<Array<CanvasShareRecord | CanvasShareOwnerRecord>>;
}

function effectiveRecord(record: CanvasShareRecord, now: Date): CanvasShareRecord {
  if (
    record.status === 'active'
    && record.expiresAt !== null
    && new Date(record.expiresAt).getTime() <= now.getTime()
  ) {
    return { ...record, status: 'expired' };
  }
  return record;
}

export async function listCanvasShares(
  input: ListCanvasSharesInput,
  dependencies: ListCanvasSharesDependencies = {
    now: () => new Date(),
    list: listCanvasSharesInStorage,
  },
): Promise<Array<CanvasShareRecord | CanvasShareOwnerRecord>> {
  const records = await dependencies.list(input.actorUserId, input.projectId);
  return records.map(record => effectiveRecord(record, dependencies.now()));
}

export interface PatchCanvasSharePolicyInput {
  actorUserId: string;
  shareId: string;
  patch: CanvasSharePolicyPatch;
}

export interface PatchCanvasSharePolicyDependencies {
  now(): Date;
  find(ownerId: string, shareId: string): Promise<StoredCanvasShareSnapshot | null>;
  update?(
    ownerId: string,
    shareId: string,
    patch: CanvasSharePolicyPatch,
  ): Promise<CanvasShareRecord | null>;
  updateIfCurrent?(
    ownerId: string,
    shareId: string,
    patch: CanvasSharePolicyPatch,
    expected: CanvasShareExpectedPolicy,
  ): Promise<CanvasShareRecord | null>;
}

export async function patchCanvasSharePolicy(
  input: PatchCanvasSharePolicyInput,
  dependencies: PatchCanvasSharePolicyDependencies = {
    now: () => new Date(),
    find: findCanvasShareForOwnerInStorage,
    updateIfCurrent: updateCanvasSharePolicyIfCurrentInStorage,
  },
): Promise<CanvasShareRecord> {
  const stored = await dependencies.find(input.actorUserId, input.shareId);
  if (!stored) return notFound();
  const now = dependencies.now();
  const current = effectiveRecord(stored.record, now);
  if (current.status !== 'active') return policyConflict();
  const patch: CanvasSharePolicyPatch = {
    ...(input.patch.allowDownload === undefined
      ? {}
      : { allowDownload: input.patch.allowDownload }),
    ...(input.patch.expiresAt === undefined
      ? {}
      : { expiresAt: normalizeExpiry(input.patch.expiresAt, now) }),
  };
  if (Object.keys(patch).length === 0) return policyConflict();
  const updated = dependencies.updateIfCurrent
    ? await dependencies.updateIfCurrent(input.actorUserId, input.shareId, patch, {
      expiresAt: current.expiresAt,
      allowDownload: current.allowDownload,
    })
    : dependencies.update
      ? await dependencies.update(input.actorUserId, input.shareId, patch)
      : await updateCanvasSharePolicyIfCurrentInStorage(
        input.actorUserId,
        input.shareId,
        patch,
        { expiresAt: current.expiresAt, allowDownload: current.allowDownload },
      );
  return updated ?? policyConflict();
}

export interface RevokeCanvasShareInput {
  actorUserId: string;
  shareId: string;
}

export interface RevokeCanvasShareDependencies {
  now(): Date;
  find(ownerId: string, shareId: string): Promise<StoredCanvasShareSnapshot | null>;
  revoke(ownerId: string, shareId: string, revokedAt: string): Promise<CanvasShareRecord | null>;
}

export async function revokeCanvasShare(
  input: RevokeCanvasShareInput,
  dependencies: RevokeCanvasShareDependencies = {
    now: () => new Date(),
    find: findCanvasShareForOwnerInStorage,
    revoke: revokeCanvasShareInStorage,
  },
): Promise<CanvasShareRecord> {
  const stored = await dependencies.find(input.actorUserId, input.shareId);
  if (!stored) return notFound();
  const now = dependencies.now();
  const current = effectiveRecord(stored.record, now);
  if (current.status === 'revoked') return current;
  if (current.status !== 'active') return policyConflict();
  const revoked = await dependencies.revoke(
    input.actorUserId,
    input.shareId,
    now.toISOString(),
  );
  if (revoked) return revoked;
  const latest = await dependencies.find(input.actorUserId, input.shareId);
  if (latest?.record.status === 'revoked') return latest.record;
  return policyConflict();
}

export interface ReadPublicCanvasShareDependencies {
  now(): Date;
  hashToken(token: string): string;
  withActiveSnapshot<T>(
    tokenHash: string,
    accessedAt: string,
    operation: (context: CanvasSharePublicSnapshotContext) => Promise<T>,
  ): Promise<T>;
}

export interface ReadPublicCanvasShareOptions {
  onAuthorized?(database: CanvasSharePublicSnapshotContext['database']): Promise<void>;
}

export { computeCanvasShareSnapshotDigestForRead };

export async function readPublicCanvasShare(
  token: string,
  options: ReadPublicCanvasShareOptions = {},
  dependencies: ReadPublicCanvasShareDependencies = {
    now: () => new Date(),
    hashToken: hashCanvasShareToken,
    withActiveSnapshot: withActiveCanvasShareSnapshot,
  },
): Promise<CanvasSharePublicDocument> {
  const now = dependencies.now();
  if (!Number.isFinite(now.getTime())) return notFound();
  return dependencies.withActiveSnapshot(
    dependencies.hashToken(token),
    now.toISOString(),
    async context => {
      assertCanvasShareSnapshotIntegrity(
        context.snapshot.record,
        context.snapshot.items,
        context.expectedItemCount,
      );
      await options.onAuthorized?.(context.database);
      const viewed = await context.incrementView();
      if (!viewed) return notFound();
      return projectCanvasShareForPublic(viewed, context.snapshot.items);
    },
  );
}

const PUBLIC_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const PUBLIC_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const PUBLIC_VIDEO_RANGE_MAX_BYTES = 8 * 1024 * 1024;

export class CanvasSharePublicRangeError extends Error {
  readonly code = 'CANVAS_SHARE_RANGE_NOT_SATISFIABLE';
  readonly status = 416;

  constructor() {
    super('媒体范围请求无效');
    this.name = 'CanvasSharePublicRangeError';
  }
}

export interface ReadPublicCanvasShareMediaInput {
  token: string;
  itemRef: string;
  download: boolean;
  rangeHeader: string | null;
  headOnly?: boolean;
  onAuthorized?(database: CanvasSharePublicSnapshotContext['database']): Promise<void>;
}

export interface CanvasSharePublicMediaResult {
  bytes: Buffer | null;
  mimeType: string;
  totalBytes: number;
  contentLength: number;
  range?: { start: number; end: number };
  fileName: string;
}

const CANVAS_SHARE_DEFERRED_RANGE_ERROR = Symbol('CANVAS_SHARE_DEFERRED_RANGE_ERROR');
type CanvasSharePublicMediaTransactionResult =
  | CanvasSharePublicMediaResult
  | typeof CANVAS_SHARE_DEFERRED_RANGE_ERROR;

export interface ReadPublicCanvasShareMediaDependencies {
  now(): Date;
  hashToken(token: string): string;
  withActiveSnapshot<T>(
    tokenHash: string,
    accessedAt: string,
    operation: (context: CanvasSharePublicSnapshotContext) => Promise<T>,
  ): Promise<T>;
  getMediaDescriptor(
    version: AssetVersion,
    kind: Asset['kind'],
  ): Promise<ManagedAssetMediaDescriptor>;
  readMedia(
    version: AssetVersion,
    kind: Asset['kind'],
    options: ManagedMediaReadOptions,
  ): Promise<ManagedMediaReadResult>;
}

function mediaUnavailable(): never {
  throw new CanvasShareError('CANVAS_SHARE_MEDIA_UNAVAILABLE');
}

function invalidRange(): never {
  throw new CanvasSharePublicRangeError();
}

interface PublicMediaRangeDecision {
  valid: boolean;
  range?: { start: number; end: number };
}

function invalidRangeDecision(): PublicMediaRangeDecision {
  return { valid: false };
}

function resolvePublicMediaRange(
  rangeHeader: string | null,
  kind: 'image' | 'video',
  totalBytes: number,
): PublicMediaRangeDecision {
  if (rangeHeader === null) {
    if (kind === 'video' && totalBytes > PUBLIC_VIDEO_MAX_BYTES) return invalidRangeDecision();
    return { valid: true };
  }
  if (kind !== 'video') return invalidRangeDecision();
  const match = /^bytes=(\d+)-(\d*)$/u.exec(rangeHeader.trim());
  if (!match) return invalidRangeDecision();
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : start + PUBLIC_VIDEO_RANGE_MAX_BYTES - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= totalBytes
  ) return invalidRangeDecision();
  const end = Math.min(requestedEnd, totalBytes - 1);
  if (end - start + 1 > PUBLIC_VIDEO_RANGE_MAX_BYTES) return invalidRangeDecision();
  return { valid: true, range: { start, end } };
}

function descriptorMatchesSnapshot(
  descriptor: ManagedAssetMediaDescriptor,
  version: AssetVersion,
  item: CanvasShareItemRecord,
): boolean {
  return descriptor.assetVersionId === version.id
    && descriptor.assetKind === item.assetKind
    && descriptor.mimeType === item.mimeType
    && descriptor.byteSize === item.byteSize
    && descriptor.width === item.width
    && descriptor.height === item.height
    && descriptor.checksum === item.checksum;
}

function assetMatchesSnapshot(
  asset: Asset | null,
  version: AssetVersion | null,
  context: CanvasSharePublicSnapshotContext,
  item: CanvasShareItemRecord,
): asset is Asset {
  const { record } = context.snapshot;
  return Boolean(
    asset
    && version
    && asset.id === item.assetId
    && asset.ownerId === record.ownerId
    && asset.projectId === record.projectId
    && asset.kind === item.assetKind
    && version.id === item.assetVersionId
    && version.assetId === item.assetId
    && version.ownerId === record.ownerId
    && version.projectId === record.projectId
    && version.file.availability === 'ready',
  );
}

export async function readPublicCanvasShareMedia(
  input: ReadPublicCanvasShareMediaInput,
  dependencies: ReadPublicCanvasShareMediaDependencies = {
    now: () => new Date(),
    hashToken: hashCanvasShareToken,
    withActiveSnapshot: withActiveCanvasShareMediaSnapshot,
    getMediaDescriptor: getManagedAssetMediaDescriptor,
    readMedia: readManagedAssetVersionBytes,
  },
): Promise<CanvasSharePublicMediaResult> {
  const accessedAt = dependencies.now();
  if (!Number.isFinite(accessedAt.getTime())) return notFound();
  const transactionResult = await dependencies.withActiveSnapshot<
    CanvasSharePublicMediaTransactionResult
  >(
    dependencies.hashToken(input.token),
    accessedAt.toISOString(),
    async context => {
      const { record, items } = context.snapshot;
      assertCanvasShareSnapshotIntegrity(record, items, context.expectedItemCount);
      if (input.download && !record.allowDownload) {
        throw new CanvasShareError('CANVAS_SHARE_DOWNLOAD_DISABLED');
      }
      const item = resolveCanvasSharePublicItem(record, items, input.itemRef);
      const [asset, version] = await Promise.all([
        context.findAsset(record.ownerId, record.projectId, item.assetId),
        context.findVersion(record.ownerId, record.projectId, item.assetVersionId),
      ]);
      if (!assetMatchesSnapshot(asset, version, context, item) || !version) {
        return mediaUnavailable();
      }
      let descriptor: ManagedAssetMediaDescriptor;
      try {
        descriptor = await dependencies.getMediaDescriptor(version, item.assetKind);
      } catch (error) {
        if (error instanceof CanvasShareError) return mediaUnavailable();
        throw error;
      }
      if (!descriptorMatchesSnapshot(descriptor, version, item)) return mediaUnavailable();
      await input.onAuthorized?.(context.database);
      const rangeDecision = resolvePublicMediaRange(
        input.rangeHeader,
        item.assetKind,
        descriptor.byteSize,
      );
      if (!rangeDecision.valid) return CANVAS_SHARE_DEFERRED_RANGE_ERROR;
      const { range } = rangeDecision;
      const expectedBytes = range
        ? range.end - range.start + 1
        : descriptor.byteSize;
      const fileName = createCanvasShareDownloadFileName(record, item);
      if (input.headOnly) {
        return {
          bytes: null,
          mimeType: descriptor.mimeType,
          totalBytes: descriptor.byteSize,
          contentLength: expectedBytes,
          ...(range ? { range } : {}),
          fileName,
        };
      }
      const maxBytes = item.assetKind === 'image'
        ? PUBLIC_IMAGE_MAX_BYTES
        : range
          ? PUBLIC_VIDEO_RANGE_MAX_BYTES
          : PUBLIC_VIDEO_MAX_BYTES;
      let result: ManagedMediaReadResult;
      try {
        result = await dependencies.readMedia(version, item.assetKind, {
          maxBytes,
          ...(range ? { range } : {}),
        });
      } catch (error) {
        if (error instanceof CanvasShareError) return mediaUnavailable();
        throw error;
      }
      if (
        result.mimeType !== descriptor.mimeType
        || result.totalBytes !== descriptor.byteSize
        || result.bytes.byteLength !== expectedBytes
        || (range && (
          result.range?.start !== range.start
          || result.range.end !== range.end
        ))
      ) return mediaUnavailable();
      return {
        bytes: result.bytes,
        mimeType: result.mimeType,
        totalBytes: result.totalBytes,
        contentLength: expectedBytes,
        ...(range ? { range } : {}),
        fileName,
      };
    },
  );
  if (transactionResult === CANVAS_SHARE_DEFERRED_RANGE_ERROR) return invalidRange();
  return transactionResult;
}
