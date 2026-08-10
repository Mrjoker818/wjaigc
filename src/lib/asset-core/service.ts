import { randomUUID } from 'node:crypto';

import {
  createPostgresAssetStorage,
  type AssetStorage,
} from './storage';
import {
  assertWorkspaceEntityType,
  type Asset,
  type AssetFile,
  type AssetKind,
  type AssetVersion,
  type WorkspaceEntityType,
  type WorkspaceKind,
  type WorkspacePlacement,
} from './types';

export type AssetServiceErrorCode =
  | 'ASSET_NOT_FOUND'
  | 'ASSET_IDEMPOTENCY_CONFLICT'
  | 'ASSET_PLACEMENT_CONFLICT';

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

export type WorkspaceTransform = Record<string, unknown>;

export interface PlacementCommand {
  actorUserId: string;
  projectId: string;
  placementId: string;
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

function now(): string {
  return new Date().toISOString();
}

function workspaceForEntityType(entityType: WorkspaceEntityType): WorkspaceKind {
  if (entityType === 'canvas-image') return 'canvas';
  if (entityType === 'workflow-input' || entityType === 'workflow-output') return 'workflow';
  return 'chat';
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

  async createAssetVersion(input: CreateAssetVersionInput): Promise<{
    asset: Asset;
    version: AssetVersion;
    reused: boolean;
  }> {
    return this.storage.transaction(async (transaction) => {
      if (!await transaction.findProject(input.actorUserId, input.projectId)) notFound();

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
        const parent = await transaction.findVersion(input.actorUserId, parentVersionId);
        if (!parent || parent.projectId !== input.projectId || parent.assetId !== asset.id) notFound();
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
      await transaction.insertVersion(version, input.requestDigest);
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

  async createWorkspacePlacement(input: CreatePlacementInput): Promise<{
    placement: WorkspacePlacement;
    reused: boolean;
  }> {
    return this.storage.transaction(async (transaction) => {
      if (!await transaction.findProject(input.actorUserId, input.projectId)) notFound();
      const version = await transaction.findVersion(input.actorUserId, input.assetVersionId);
      if (!version || version.projectId !== input.projectId) notFound();

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
      const version = await transaction.findVersion(input.actorUserId, input.sourceVersionId);
      if (!version || version.projectId !== input.targetProjectId) notFound();

      const existing = await transaction.findTransfer(
        input.actorUserId, input.sourceVersionId, input.targetProjectId, workspaceForEntityType(input.entityType), input.targetWorkspaceId,
        input.entityType, input.entityId, input.idempotencyKey,
      );
      if (existing) {
        if (existing.requestDigest !== input.requestDigest) conflict();
        return { version, placement: existing.placement, reused: true };
      }

      const placement = createPlacement(
        input.actorUserId,
        input.targetProjectId,
        version,
        workspaceForEntityType(input.entityType),
        input.targetWorkspaceId,
        input.entityType,
        input.entityId,
        input.transform,
        { ...input.metadata, idempotencyKey: input.idempotencyKey },
      );
      if (await transaction.insertTransferPlacement(placement, input.requestDigest)) {
        return { version, placement, reused: false };
      }

      const raced = await transaction.findTransfer(
        input.actorUserId, input.sourceVersionId, input.targetProjectId, workspaceForEntityType(input.entityType), input.targetWorkspaceId,
        input.entityType, input.entityId, input.idempotencyKey,
      );
      if (raced) {
        if (raced.requestDigest !== input.requestDigest) conflict();
        return { version, placement: raced.placement, reused: true };
      }
      placementConflict();
    });
  }

  async trashPlacement(input: PlacementCommand): Promise<{
    placementTrashed: boolean;
    assetTrashed: boolean;
  }> {
    return this.storage.transaction(async (transaction) => {
      const placement = await transaction.findPlacement(input.actorUserId, input.projectId, input.placementId);
      if (!placement) notFound();
      if (!await transaction.lockAsset(input.actorUserId, input.projectId, placement.assetId)) notFound();
      if (placement.status === 'trashed') return { placementTrashed: false, assetTrashed: false };
      const trashed = await transaction.trashPlacement(input.actorUserId, input.projectId, placement.id);
      if (!trashed) return { placementTrashed: false, assetTrashed: false };
      const assetTrashed = await transaction.countActivePlacements(
        input.actorUserId,
        input.projectId,
        placement.assetId,
      ) === 0
        ? await transaction.trashAsset(input.actorUserId, input.projectId, placement.assetId)
        : false;
      return { placementTrashed: true, assetTrashed };
    });
  }

  async restorePlacement(input: PlacementCommand): Promise<{
    placement: WorkspacePlacement;
    asset: Asset;
  }> {
    return this.storage.transaction(async (transaction) => {
      const placement = await transaction.findPlacement(input.actorUserId, input.projectId, input.placementId);
      if (!placement) notFound();
      const asset = await transaction.activateAsset(input.actorUserId, input.projectId, placement.assetId);
      if (!asset) notFound();
      const restored = placement.status === 'active'
        ? placement
        : await transaction.restorePlacement(input.actorUserId, input.projectId, placement.id);
      if (!restored) placementConflict();
      return { placement: restored, asset };
    });
  }
}

export function createAssetService(storage: AssetStorage = createPostgresAssetStorage()): AssetService {
  return new AssetService(storage);
}
