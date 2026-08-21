import { randomUUID } from 'node:crypto';

import { DEFAULT_TRASH_RETENTION_DAYS } from './media-health';
import {
  createPostgresAssetStorage,
  type AssetStorage,
  type StoredTransfer,
} from './storage';
import {
  assertWorkspaceEntityType,
  type Asset,
  type AssetFile,
  type AssetKind,
  type AssetVersion,
  type WorkspaceEntityType,
  type WorkspaceAssetReference,
  type WorkspaceKind,
  type WorkspacePlacement,
} from './types';

export type AssetServiceErrorCode =
  | 'ASSET_NOT_FOUND'
  | 'ASSET_IDEMPOTENCY_CONFLICT'
  | 'ASSET_PLACEMENT_CONFLICT'
  | 'ASSET_RESTORE_NOT_ALLOWED'
  | 'ASSET_MEDIA_UNRECOVERABLE';

export class AssetServiceError extends Error {
  constructor(readonly code: AssetServiceErrorCode) {
    super(code);
    this.name = 'AssetServiceError';
  }
}

export interface CreateAssetVersionInput {
  actorUserId: string;
  projectId: string;
  assetId?: string;
  kind: AssetKind;
  file: AssetFile;
  parentVersionIds?: string[];
  idempotencyKey: string;
  requestDigest: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePlacementInput {
  actorUserId: string;
  projectId: string;
  assetVersionId: string;
  workspace: WorkspaceKind;
  workspaceId: string;
  entityType: WorkspaceEntityType;
  entityId: string;
  transform?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CreateVersionWithPlacementInput extends Omit<CreateAssetVersionInput, 'file'> {
  resolveFile: () => Promise<AssetFile>;
  placement: Omit<CreatePlacementInput, 'actorUserId' | 'projectId' | 'assetVersionId'>;
}

export interface TransferVersionInput {
  actorUserId: string;
  sourceVersionId: string;
  targetProjectId: string;
  targetWorkspaceId: string;
  entityType: WorkspaceEntityType;
  entityId: string;
  idempotencyKey: string;
  requestDigest: string;
  transform?: WorkspaceTransform;
  metadata?: Record<string, unknown>;
}

export interface ResolveAssetReferenceInput {
  actorUserId: string;
  projectId: string;
  assetVersionId: string;
  placementId?: string;
}

export type WorkspaceTransform = Record<string, unknown>;

export interface PlacementCommand {
  actorUserId: string;
  projectId: string;
  placementId: string;
  assetId?: string;
}

function notFound(): never {
  throw new AssetServiceError('ASSET_NOT_FOUND');
}

function conflict(): never {
  throw new AssetServiceError('ASSET_IDEMPOTENCY_CONFLICT');
}

function placementConflict(): never {
  throw new AssetServiceError('ASSET_PLACEMENT_CONFLICT');
}

function restoreNotAllowed(): never {
  throw new AssetServiceError('ASSET_RESTORE_NOT_ALLOWED');
}

function mediaUnrecoverable(): never {
  throw new AssetServiceError('ASSET_MEDIA_UNRECOVERABLE');
}

function isDatabaseConflict(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const databaseError = error as { code?: unknown; constraint?: unknown };
  return databaseError.code === '23505' && databaseError.constraint === constraint;
}

function now(): string {
  return new Date().toISOString();
}

function workspaceForEntityType(entityType: WorkspaceEntityType): WorkspaceKind {
  if (entityType === 'canvas-image') return 'canvas';
  if (entityType === 'workflow-input' || entityType === 'workflow-output') return 'workflow';
  return 'chat';
}

function hasTransferIdempotencyConflict(
  transfers: StoredTransfer[],
  input: TransferVersionInput,
): boolean {
  const expectedWorkspace = workspaceForEntityType(input.entityType);
  return transfers.some(candidate => (
    candidate.requestDigest !== input.requestDigest
    || candidate.sourceVersionId !== input.sourceVersionId
    || candidate.placement.projectId !== input.targetProjectId
    || candidate.placement.workspace !== expectedWorkspace
    || candidate.placement.workspaceId !== input.targetWorkspaceId
    || candidate.placement.entityType !== input.entityType
    || candidate.placement.entityId !== input.entityId
  ));
}

function createPlacement(
  ownerId: string,
  projectId: string,
  version: AssetVersion,
  workspace: WorkspaceKind,
  workspaceId: string,
  entityType: WorkspaceEntityType,
  entityId: string,
  transform?: WorkspaceTransform,
  metadata?: Record<string, unknown>,
): WorkspacePlacement {
  const timestamp = now();
  return {
    id: randomUUID(),
    ownerId,
    projectId,
    assetId: version.assetId,
    assetVersionId: version.id,
    workspace,
    workspaceId,
    entityType: assertWorkspaceEntityType(workspace, entityType),
    entityId,
    status: 'active',
    deletedAt: null,
    ...(transform ? { transform } : {}),
    ...(metadata ? { metadata } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  } as WorkspacePlacement;
}

export class AssetService {
  constructor(private readonly storage: AssetStorage) {}

  async resolveAssetReference(input: ResolveAssetReferenceInput): Promise<WorkspaceAssetReference> {
    return this.storage.transaction(async transaction => {
      if (!await transaction.findProject(input.actorUserId, input.projectId)) notFound();
      const version = await transaction.findVersion(
        input.actorUserId,
        input.projectId,
        input.assetVersionId,
      );
      if (!version) notFound();

      let placement: WorkspacePlacement | null = null;
      if (input.placementId) {
        placement = await transaction.findPlacement(
          input.actorUserId,
          input.projectId,
          input.placementId,
        );
        if (!placement || placement.assetVersionId !== version.id || placement.status !== 'active') notFound();
      }
      const name = placement?.metadata && typeof placement.metadata.name === 'string'
        ? placement.metadata.name
        : undefined;
      return {
        assetId: version.assetId,
        assetVersionId: version.id,
        ...(placement ? { placementId: placement.id } : {}),
        ...(placement ? { entityId: placement.entityId } : {}),
        url: version.file.url,
        ...(name ? { name } : {}),
      };
    });
  }

  async createAssetVersion(input: CreateAssetVersionInput): Promise<{
    asset: Asset;
    version: AssetVersion;
    reused: boolean;
  }> {
    return this.storage.transaction(async (transaction) => {
      if (!await transaction.findProject(input.actorUserId, input.projectId)) notFound();
      await transaction.lockVersionIdempotency(
        input.actorUserId,
        input.projectId,
        input.idempotencyKey,
      );

      const existing = await transaction.findVersionByIdempotency(
        input.actorUserId,
        input.projectId,
        input.idempotencyKey,
      );
      if (existing) {
        if (existing.requestDigest !== input.requestDigest) conflict();
        const asset = await transaction.findAsset(input.actorUserId, input.projectId, existing.version.assetId);
        if (!asset) notFound();
        return { asset, version: existing.version, reused: true };
      }

      let asset: Asset;
      if (input.assetId) {
        const existingAsset = await transaction.findAsset(input.actorUserId, input.projectId, input.assetId);
        if (!existingAsset) notFound();
        asset = existingAsset;
      } else {
        asset = {
          id: randomUUID(),
          ownerId: input.actorUserId,
          projectId: input.projectId,
          kind: input.kind,
          status: 'active',
          currentVersionId: null,
          createdAt: now(),
          updatedAt: now(),
        };
        await transaction.insertAsset(asset);
      }

      const parentVersionIds = input.parentVersionIds ?? [];
      for (const parentVersionId of parentVersionIds) {
        const parent = await transaction.findVersion(input.actorUserId, input.projectId, parentVersionId);
        if (!parent || parent.assetId !== asset.id) notFound();
      }

      const version: AssetVersion = {
        id: randomUUID(),
        assetId: asset.id,
        ownerId: input.actorUserId,
        projectId: input.projectId,
        file: input.file,
        parentVersionIds: [...parentVersionIds],
        idempotencyKey: input.idempotencyKey,
        createdAt: now(),
      };
      await transaction.insertVersion(version, input.requestDigest, input.metadata);
      await transaction.insertParents(version, parentVersionIds);
      const updatedAsset = await transaction.updateAssetCurrentVersion(
        input.actorUserId,
        input.projectId,
        asset.id,
        version.id,
      );
      return { asset: updatedAsset, version, reused: false };
    });
  }

  async createVersionWithPlacement(input: CreateVersionWithPlacementInput): Promise<{
    asset: Asset;
    version: AssetVersion;
    placement: WorkspacePlacement;
    reused: boolean;
  }> {
    return this.storage.transaction(async (transaction) => {
      if (!await transaction.findProject(input.actorUserId, input.projectId)) notFound();
      await transaction.lockVersionIdempotency(
        input.actorUserId,
        input.projectId,
        input.idempotencyKey,
      );

      const existing = await transaction.findVersionByIdempotency(
        input.actorUserId,
        input.projectId,
        input.idempotencyKey,
      );
      if (existing) {
        if (existing.requestDigest !== input.requestDigest) conflict();
        const lockedAsset = await transaction.lockAsset(
          input.actorUserId,
          input.projectId,
          existing.version.assetId,
        );
        if (!lockedAsset) notFound();
        const asset = lockedAsset.status === 'trashed'
          ? await transaction.activateAsset(input.actorUserId, input.projectId, lockedAsset.id)
          : lockedAsset;
        if (!asset) notFound();
        const existingPlacement = await transaction.findActivePlacement(
          input.actorUserId,
          input.projectId,
          input.placement.workspace,
          input.placement.workspaceId,
          input.placement.entityType,
          input.placement.entityId,
        );
        if (existingPlacement) {
          if (existingPlacement.assetVersionId !== existing.version.id) placementConflict();
          return {
            asset,
            version: existing.version,
            placement: existingPlacement,
            reused: true,
          };
        }
        const repairedPlacement = createPlacement(
          input.actorUserId,
          input.projectId,
          existing.version,
          input.placement.workspace,
          input.placement.workspaceId,
          input.placement.entityType,
          input.placement.entityId,
          input.placement.transform,
          input.placement.metadata,
        );
        if (!await transaction.insertPlacement(repairedPlacement)) placementConflict();
        return {
          asset,
          version: existing.version,
          placement: repairedPlacement,
          reused: true,
        };
      }

      let asset: Asset | null = null;
      if (input.assetId) {
        const lockedAsset = await transaction.lockAsset(
          input.actorUserId,
          input.projectId,
          input.assetId,
        );
        if (!lockedAsset) notFound();
        asset = lockedAsset.status === 'trashed'
          ? await transaction.activateAsset(input.actorUserId, input.projectId, lockedAsset.id)
          : lockedAsset;
        if (!asset) notFound();
      }

      const occupiedPlacement = await transaction.findActivePlacement(
        input.actorUserId,
        input.projectId,
        input.placement.workspace,
        input.placement.workspaceId,
        input.placement.entityType,
        input.placement.entityId,
      );
      if (occupiedPlacement) placementConflict();

      const file = await input.resolveFile();
      if (!asset) {
        const timestamp = now();
        asset = {
          id: randomUUID(),
          ownerId: input.actorUserId,
          projectId: input.projectId,
          kind: input.kind,
          status: 'active',
          currentVersionId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await transaction.insertAsset(asset);
      }

      const parentVersionIds = input.parentVersionIds ?? [];
      for (const parentVersionId of parentVersionIds) {
        const parent = await transaction.findVersion(
          input.actorUserId,
          input.projectId,
          parentVersionId,
        );
        if (!parent || parent.assetId !== asset.id) notFound();
      }

      const version: AssetVersion = {
        id: randomUUID(),
        assetId: asset.id,
        ownerId: input.actorUserId,
        projectId: input.projectId,
        file,
        parentVersionIds: [...parentVersionIds],
        idempotencyKey: input.idempotencyKey,
        createdAt: now(),
      };
      await transaction.insertVersion(version, input.requestDigest, input.metadata);
      await transaction.insertParents(version, parentVersionIds);
      const updatedAsset = await transaction.updateAssetCurrentVersion(
        input.actorUserId,
        input.projectId,
        asset.id,
        version.id,
      );
      const placement = createPlacement(
        input.actorUserId,
        input.projectId,
        version,
        input.placement.workspace,
        input.placement.workspaceId,
        input.placement.entityType,
        input.placement.entityId,
        input.placement.transform,
        input.placement.metadata,
      );
      if (!await transaction.insertPlacement(placement)) placementConflict();
      return { asset: updatedAsset, version, placement, reused: false };
    });
  }

  async createWorkspacePlacement(input: CreatePlacementInput): Promise<{
    placement: WorkspacePlacement;
    reused: boolean;
  }> {
    return this.storage.transaction(async (transaction) => {
      if (!await transaction.findProject(input.actorUserId, input.projectId)) notFound();
      const version = await transaction.findVersion(input.actorUserId, input.projectId, input.assetVersionId);
      if (!version) notFound();
      const asset = await transaction.lockAsset(input.actorUserId, input.projectId, version.assetId);
      if (!asset) notFound();
      if (asset.status === 'trashed'
        && !await transaction.activateAsset(input.actorUserId, input.projectId, asset.id)) notFound();

      const existing = await transaction.findActivePlacement(
        input.actorUserId, input.projectId, input.workspace, input.workspaceId, input.entityType, input.entityId,
      );
      if (existing) {
        if (existing.assetVersionId !== version.id) placementConflict();
        return { placement: existing, reused: true };
      }

      const placement = createPlacement(
        input.actorUserId, input.projectId, version, input.workspace, input.workspaceId,
        input.entityType, input.entityId, input.transform, input.metadata,
      );
      if (!await transaction.insertPlacement(placement)) {
        const raced = await transaction.findActivePlacement(
          input.actorUserId, input.projectId, input.workspace, input.workspaceId, input.entityType, input.entityId,
        );
        if (raced?.assetVersionId === version.id) return { placement: raced, reused: true };
        placementConflict();
      }
      return { placement, reused: false };
    });
  }

  async sendVersionToWorkspace(input: TransferVersionInput): Promise<{
    version: AssetVersion;
    placement: WorkspacePlacement;
    reused: boolean;
  }> {
    return this.storage.transaction(async (transaction) => {
      if (!await transaction.findProject(input.actorUserId, input.targetProjectId)) notFound();
      const sourceProjectId = await transaction.resolveVersionProject(
        input.actorUserId,
        input.sourceVersionId,
      );
      if (!sourceProjectId) notFound();
      const sourceVersion = await transaction.findVersion(
        input.actorUserId,
        sourceProjectId,
        input.sourceVersionId,
      );
      if (!sourceVersion) notFound();
      const sourceAsset = await transaction.lockAsset(
        input.actorUserId,
        sourceProjectId,
        sourceVersion.assetId,
      );
      if (!sourceAsset) notFound();

      await transaction.lockTransferIdempotency(input.actorUserId, input.idempotencyKey);
      const existingTransfers = await transaction.findTransfersByIdempotency(
        input.actorUserId,
        input.idempotencyKey,
      );
      if (existingTransfers.length > 0) {
        const existing = existingTransfers[0];
        if (hasTransferIdempotencyConflict(existingTransfers, input)) conflict();
        const targetVersion = await transaction.findVersion(
          input.actorUserId,
          existing.placement.projectId,
          existing.placement.assetVersionId,
        );
        if (!targetVersion) notFound();
        return { version: targetVersion, placement: existing.placement, reused: true };
      }

      let targetVersion = sourceVersion;
      if (sourceProjectId === input.targetProjectId) {
        if (sourceAsset.status === 'trashed'
          && !await transaction.activateAsset(input.actorUserId, sourceProjectId, sourceAsset.id)) notFound();
      } else {
        const timestamp = now();
        const targetAsset: Asset = {
          id: randomUUID(),
          ownerId: input.actorUserId,
          projectId: input.targetProjectId,
          kind: sourceAsset.kind,
          status: 'active',
          currentVersionId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await transaction.insertAsset(targetAsset);
        targetVersion = {
          id: randomUUID(),
          assetId: targetAsset.id,
          ownerId: input.actorUserId,
          projectId: input.targetProjectId,
          file: { ...sourceVersion.file },
          parentVersionIds: [],
          createdAt: timestamp,
        };
        await transaction.insertVersion(targetVersion, input.requestDigest, {
          ...input.metadata,
          sourceProjectId,
          sourceVersionId: sourceVersion.id,
          transferIdempotencyKey: input.idempotencyKey,
        });
        await transaction.updateAssetCurrentVersion(
          input.actorUserId,
          input.targetProjectId,
          targetAsset.id,
          targetVersion.id,
        );
      }

      const placement = createPlacement(
        input.actorUserId,
        input.targetProjectId,
        targetVersion,
        workspaceForEntityType(input.entityType),
        input.targetWorkspaceId,
        input.entityType,
        input.entityId,
        input.transform,
        { ...input.metadata, idempotencyKey: input.idempotencyKey },
      );
      if (await transaction.insertTransferPlacement(
        placement,
        sourceVersion.id,
        input.idempotencyKey,
        input.requestDigest,
      )) {
        return { version: targetVersion, placement, reused: false };
      }

      const racedTransfers = await transaction.findTransfersByIdempotency(
        input.actorUserId,
        input.idempotencyKey,
      );
      if (racedTransfers.length > 0) {
        const raced = racedTransfers[0];
        if (hasTransferIdempotencyConflict(racedTransfers, input)) conflict();
        const racedVersion = await transaction.findVersion(
          input.actorUserId,
          raced.placement.projectId,
          raced.placement.assetVersionId,
        );
        if (!racedVersion) notFound();
        return { version: racedVersion, placement: raced.placement, reused: true };
      }
      placementConflict();
    });
  }

  async trashPlacement(input: PlacementCommand): Promise<{
    placementTrashed: boolean;
    assetTrashed: boolean;
    projectRevision?: number;
  }> {
    return this.storage.transaction(async (transaction) => {
      const locatedPlacement = await transaction.findPlacement(input.actorUserId, input.projectId, input.placementId);
      if (!locatedPlacement) notFound();
      if (locatedPlacement.workspace === 'canvas' && locatedPlacement.entityType === 'canvas-image') {
        await transaction.lockCanvasProjectSnapshot(input.actorUserId);
      }
      if (!await transaction.lockAsset(input.actorUserId, input.projectId, locatedPlacement.assetId)) notFound();
      const placement = await transaction.lockPlacement(input.actorUserId, input.projectId, input.placementId);
      if (!placement || placement.assetId !== locatedPlacement.assetId) notFound();
      if (placement.status === 'trashed') {
        const projectRevision = placement.workspace === 'canvas' && placement.entityType === 'canvas-image'
          ? await transaction.readPlacementTrashProjectRevision(placement)
          : undefined;
        return {
          placementTrashed: false,
          assetTrashed: false,
          ...(projectRevision === undefined ? {} : { projectRevision }),
        };
      }
      const trashed = await transaction.trashPlacement(input.actorUserId, input.projectId, placement.id);
      if (!trashed) return { placementTrashed: false, assetTrashed: false };
      const projectRevision = trashed.workspace === 'canvas' && trashed.entityType === 'canvas-image'
        ? await transaction.trashCanvasPlacementSnapshot(input.actorUserId, input.projectId, trashed)
        : undefined;
      const assetTrashed = await transaction.countActivePlacements(
        input.actorUserId,
        input.projectId,
        placement.assetId,
      ) === 0
        ? await transaction.trashAsset(input.actorUserId, input.projectId, placement.assetId)
        : false;
      return {
        placementTrashed: true,
        assetTrashed,
        ...(projectRevision === undefined ? {} : { projectRevision }),
      };
    });
  }

  async restorePlacement(input: PlacementCommand): Promise<{
    placement: WorkspacePlacement;
    asset: Asset;
    projectRevision?: number;
  }> {
    try {
      return await this.storage.transaction(async (transaction) => {
        const locatedPlacement = await transaction.findPlacement(input.actorUserId, input.projectId, input.placementId);
        if (!locatedPlacement) notFound();
        if (input.assetId && locatedPlacement.assetId !== input.assetId) notFound();
        if (locatedPlacement.workspace === 'canvas' && locatedPlacement.entityType === 'canvas-image') {
          await transaction.lockCanvasProjectSnapshot(input.actorUserId);
        }
        const lockedAsset = await transaction.lockAsset(
          input.actorUserId,
          input.projectId,
          locatedPlacement.assetId,
        );
        if (!lockedAsset) notFound();
        const placement = await transaction.lockPlacement(input.actorUserId, input.projectId, input.placementId);
        if (!placement || placement.assetId !== locatedPlacement.assetId) notFound();
        if (input.assetId && placement.assetId !== input.assetId) notFound();
        if (placement.status !== 'trashed' || !placement.deletedAt) restoreNotAllowed();
        const retentionEndsAt = new Date(placement.deletedAt).getTime()
          + DEFAULT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        if (!Number.isFinite(retentionEndsAt) || Date.now() >= retentionEndsAt) restoreNotAllowed();
        const occupied = await transaction.findActivePlacement(
          input.actorUserId,
          input.projectId,
          placement.workspace,
          placement.workspaceId,
          placement.entityType,
          placement.entityId,
        );
        if (occupied && occupied.id !== placement.id) placementConflict();
        const version = await transaction.findVersion(
          input.actorUserId,
          input.projectId,
          placement.assetVersionId,
        );
        if (!version || version.assetId !== placement.assetId) notFound();
        if (version.file.availability === 'unrecoverable') mediaUnrecoverable();
        const asset = lockedAsset.status === 'trashed'
          ? await transaction.activateAsset(input.actorUserId, input.projectId, placement.assetId)
          : lockedAsset;
        if (!asset) notFound();
        const restored = await transaction.restorePlacement(
          input.actorUserId,
          input.projectId,
          placement.id,
        );
        if (!restored) placementConflict();
        const projectRevision = restored.workspace === 'canvas' && restored.entityType === 'canvas-image'
          ? await transaction.restoreCanvasPlacementSnapshot(
            input.actorUserId,
            input.projectId,
            restored,
          )
          : undefined;
        return {
          placement: restored,
          asset,
          ...(projectRevision === undefined ? {} : { projectRevision }),
        };
      });
    } catch (error) {
      if (isDatabaseConflict(error, 'wujie_workspace_placements_active_entity_unique')) {
        placementConflict();
      }
      throw error;
    }
  }
}

export function createAssetService(storage: AssetStorage = createPostgresAssetStorage()): AssetService {
  return new AssetService(storage);
}
