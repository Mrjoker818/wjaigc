import { randomUUID } from 'node:crypto';

import {
  getManagedAssetMediaDescriptor,
} from '@/lib/asset-core/managed-media-read';
import {
  lockCanvasProjectRevision,
  readCanvasProjectRevision,
} from '@/lib/asset-core/canvas-project-sync';
import {
  createAssetStorageTransaction,
  lockAssetGraphWriteGate,
  withAssetCoreTransaction,
} from '@/lib/asset-core/storage';

import { CanvasShareError } from './errors';
import { buildCanvasShareSnapshot } from './snapshot';
import {
  findCanvasShareByTokenHash as findCanvasShareByTokenHashInStorage,
  findCanvasShareForOwner as findCanvasShareForOwnerInStorage,
  incrementCanvasShareView as incrementCanvasShareViewInStorage,
  insertCanvasShare,
  listCanvasShares as listCanvasSharesInStorage,
  revokeCanvasShare as revokeCanvasShareInStorage,
  type StoredCanvasShareSnapshot,
  updateCanvasSharePolicy as updateCanvasSharePolicyInStorage,
} from './storage';
import { createCanvasShareToken, hashCanvasShareToken } from './token';
import type {
  CanvasShareItemRecord,
  CanvasSharePolicyPatch,
  CanvasSharePublicDocument,
  CanvasShareRecord,
  CanvasShareViewport,
} from './types';

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

async function createSnapshotAndInsertPostgres(
  input: CanvasShareCreatePersistenceInput,
): Promise<StoredCanvasShareSnapshot> {
  return withAssetCoreTransaction(async client => {
    await lockAssetGraphWriteGate(client, 'shared');
    await lockCanvasProjectRevision(client, input.ownerId);
    const assetStorage = createAssetStorageTransaction(client);
    if (!await assetStorage.findProject(input.ownerId, input.projectId)) unauthorized();
    const snapshot = await buildCanvasShareSnapshot({
      ownerId: input.ownerId,
      projectId: input.projectId,
      requestedViewport: input.requestedViewport,
    }, {
      readProjectRevision: (ownerId) => readCanvasProjectRevision(ownerId, client),
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
    });
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
  list(ownerId: string, projectId: string): Promise<CanvasShareRecord[]>;
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
): Promise<CanvasShareRecord[]> {
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
  update(
    ownerId: string,
    shareId: string,
    patch: CanvasSharePolicyPatch,
  ): Promise<CanvasShareRecord | null>;
}

export async function patchCanvasSharePolicy(
  input: PatchCanvasSharePolicyInput,
  dependencies: PatchCanvasSharePolicyDependencies = {
    now: () => new Date(),
    find: findCanvasShareForOwnerInStorage,
    update: updateCanvasSharePolicyInStorage,
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
  const updated = await dependencies.update(input.actorUserId, input.shareId, patch);
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
  findByTokenHash(tokenHash: string): Promise<StoredCanvasShareSnapshot | null>;
  incrementView(shareId: string, viewedAt: string): Promise<CanvasShareRecord | null>;
}

export async function readPublicCanvasShare(
  token: string,
  dependencies: ReadPublicCanvasShareDependencies = {
    now: () => new Date(),
    hashToken: hashCanvasShareToken,
    findByTokenHash: findCanvasShareByTokenHashInStorage,
    incrementView: incrementCanvasShareViewInStorage,
  },
): Promise<CanvasSharePublicDocument> {
  const stored = await dependencies.findByTokenHash(dependencies.hashToken(token));
  if (!stored) return notFound();
  const now = dependencies.now();
  if (effectiveRecord(stored.record, now).status !== 'active') return notFound();
  const viewed = await dependencies.incrementView(stored.record.id, now.toISOString());
  if (!viewed) return notFound();
  return {
    title: viewed.title,
    revisionLabel: `修订 ${viewed.projectRevision}`,
    createdAt: viewed.createdAt,
    allowDownload: viewed.allowDownload,
    viewport: viewed.viewport,
    items: stored.items.map(item => {
      const mediaPath = `/api/public/canvas-shares/${token}/media/${item.id}`;
      return {
        itemRef: item.id,
        entityType: item.entityType,
        assetKind: item.assetKind,
        transform: item.transform,
        display: item.displayMetadata,
        mimeType: item.mimeType,
        width: item.width,
        height: item.height,
        mediaPath,
        ...(viewed.allowDownload ? { downloadPath: `${mediaPath}/download` } : {}),
      };
    }),
  };
}
