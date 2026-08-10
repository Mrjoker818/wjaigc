import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  Asset,
  AssetFile,
  AssetKind,
  AssetVersion,
  WorkspaceKind,
  WorkspacePlacement,
} from '@/lib/asset-core/types';

type CreateAssetVersionInput = {
  actorUserId: string;
  projectId: string;
  assetId?: string;
  kind: AssetKind;
  file: AssetFile;
  parentVersionIds?: string[];
  idempotencyKey: string;
  requestDigest: string;
  metadata?: Record<string, unknown>;
};

type CreatePlacementInput = {
  actorUserId: string;
  projectId: string;
  assetVersionId: string;
  workspace: WorkspaceKind;
  workspaceId: string;
  entityType: string;
  entityId: string;
  transform?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type PlacementCommand = {
  actorUserId: string;
  projectId: string;
  placementId: string;
};

type AssetService = {
  createAssetVersion(input: CreateAssetVersionInput): Promise<{
    asset: Asset;
    version: AssetVersion;
    reused: boolean;
  }>;
  createWorkspacePlacement(input: CreatePlacementInput): Promise<{
    placement: WorkspacePlacement;
    reused: boolean;
  }>;
  trashPlacement(input: PlacementCommand): Promise<{
    placementTrashed: boolean;
    assetTrashed: boolean;
  }>;
};

type AssetServiceModule = {
  createAssetService(storage: unknown): AssetService;
};

type MemoryRecord = {
  projects: Set<string>;
  assets: Map<string, Asset>;
  versions: Map<string, AssetVersion>;
  versionDigests: Map<string, string>;
  parents: Map<string, string[]>;
  placements: Map<string, WorkspacePlacement>;
};

function projectKey(ownerId: string, projectId: string): string {
  return `${ownerId}:${projectId}`;
}

class MemoryStorage {
  readonly data: MemoryRecord;

  constructor(ownerId: string, projectId: string) {
    this.data = {
      projects: new Set([projectKey(ownerId, projectId)]),
      assets: new Map(),
      versions: new Map(),
      versionDigests: new Map(),
      parents: new Map(),
      placements: new Map(),
    };
  }

  async transaction<T>(callback: (transaction: MemoryStorage) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async findProject(ownerId: string, projectId: string): Promise<boolean> {
    return this.data.projects.has(projectKey(ownerId, projectId));
  }

  async findAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null> {
    const asset = this.data.assets.get(assetId);
    return asset?.ownerId === ownerId && asset.projectId === projectId ? asset : null;
  }

  async lockAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null> {
    return this.findAsset(ownerId, projectId, assetId);
  }

  async insertAsset(asset: Asset): Promise<void> {
    this.data.assets.set(asset.id, asset);
  }

  async findVersion(ownerId: string, versionId: string): Promise<AssetVersion | null> {
    const version = this.data.versions.get(versionId);
    return version?.ownerId === ownerId ? version : null;
  }

  async findVersionByIdempotency(
    ownerId: string,
    projectId: string,
    idempotencyKey: string,
  ): Promise<{ version: AssetVersion; requestDigest: string } | null> {
    for (const version of this.data.versions.values()) {
      if (
        version.ownerId === ownerId
        && version.projectId === projectId
        && version.idempotencyKey === idempotencyKey
      ) {
        return { version, requestDigest: this.data.versionDigests.get(version.id) ?? '' };
      }
    }
    return null;
  }

  async insertVersion(version: AssetVersion, requestDigest: string): Promise<void> {
    this.data.versions.set(version.id, version);
    this.data.versionDigests.set(version.id, requestDigest);
  }

  async insertParents(version: AssetVersion, parentVersionIds: string[]): Promise<void> {
    this.data.parents.set(version.id, [...parentVersionIds]);
  }

  async updateAssetCurrentVersion(
    ownerId: string,
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<Asset> {
    if (!await this.findAsset(ownerId, projectId, assetId)) throw new Error('missing asset');
    const asset = this.data.assets.get(assetId);
    if (!asset) throw new Error('missing asset');
    const next = { ...asset, currentVersionId: versionId };
    this.data.assets.set(assetId, next);
    return next;
  }

  async findPlacement(
    ownerId: string,
    projectId: string,
    placementId: string,
  ): Promise<WorkspacePlacement | null> {
    const placement = this.data.placements.get(placementId);
    return placement?.ownerId === ownerId && placement.projectId === projectId ? placement : null;
  }

  async findActivePlacement(
    ownerId: string,
    projectId: string,
    workspace: WorkspaceKind,
    workspaceId: string,
    entityType: string,
    entityId: string,
  ): Promise<WorkspacePlacement | null> {
    for (const placement of this.data.placements.values()) {
      if (
        placement.ownerId === ownerId
        && placement.projectId === projectId
        && placement.workspace === workspace
        && placement.workspaceId === workspaceId
        && placement.entityType === entityType
        && placement.entityId === entityId
        && placement.status === 'active'
      ) return placement;
    }
    return null;
  }

  async insertPlacement(placement: WorkspacePlacement): Promise<boolean> {
    const existing = await this.findActivePlacement(
      placement.ownerId,
      placement.projectId,
      placement.workspace,
      placement.workspaceId,
      placement.entityType,
      placement.entityId,
    );
    if (existing) return false;
    this.data.placements.set(placement.id, placement);
    return true;
  }

  async trashPlacement(ownerId: string, projectId: string, placementId: string): Promise<WorkspacePlacement> {
    if (!await this.findPlacement(ownerId, projectId, placementId)) throw new Error('missing placement');
    const placement = this.data.placements.get(placementId);
    if (!placement) throw new Error('missing placement');
    const next = {
      ...placement,
      status: 'trashed' as const,
      deletedAt: '2026-08-11T00:00:00.000Z',
    };
    this.data.placements.set(placementId, next);
    return next;
  }

  async countActivePlacements(ownerId: string, projectId: string, assetId: string): Promise<number> {
    return [...this.data.placements.values()].filter(
      (placement) => placement.ownerId === ownerId
        && placement.projectId === projectId
        && placement.assetId === assetId
        && placement.status === 'active',
    ).length;
  }

  async trashAsset(ownerId: string, projectId: string, assetId: string): Promise<boolean> {
    const asset = this.data.assets.get(assetId);
    if (!asset || asset.ownerId !== ownerId || asset.projectId !== projectId || asset.status === 'trashed') return false;
    this.data.assets.set(assetId, { ...asset, status: 'trashed' });
    return true;
  }
}

async function loadService(): Promise<AssetServiceModule> {
  return import('@/lib/asset-core/service') as Promise<AssetServiceModule>;
}

function file(url: string): AssetFile {
  return { url, availability: 'ready', checksum: `sha256:${url}` };
}

function createVersionInput(ownerId: string, projectId: string, overrides: Partial<CreateAssetVersionInput> = {}): CreateAssetVersionInput {
  return {
    actorUserId: ownerId,
    projectId,
    kind: 'image',
    file: file(`https://example.test/${randomUUID()}.png`),
    idempotencyKey: randomUUID(),
    requestDigest: randomUUID(),
    ...overrides,
  };
}

describe('asset graph service', () => {
  it('reuses the same version for the same idempotency key and request digest', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const input = createVersionInput(ownerId, projectId, {
      idempotencyKey: 'same-key',
      requestDigest: 'same-digest',
    });

    const first = await service.createAssetVersion(input);
    const replay = await service.createAssetVersion(input);

    expect(first.reused).toBe(false);
    expect(replay.reused).toBe(true);
    expect(replay.asset.id).toBe(first.asset.id);
    expect(replay.version.id).toBe(first.version.id);
  });

  it('rejects an idempotency key reused with a different request digest', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const input = createVersionInput(ownerId, projectId, {
      idempotencyKey: 'same-key',
      requestDigest: 'digest-a',
    });

    await service.createAssetVersion(input);

    await expect(service.createAssetVersion({ ...input, requestDigest: 'digest-b' }))
      .rejects.toMatchObject({ code: 'ASSET_IDEMPOTENCY_CONFLICT' });
  });

  it('preserves parent version order', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const first = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    const assetId = first.asset.id;
    const second = await service.createAssetVersion(createVersionInput(ownerId, projectId, { assetId }));

    const child = await service.createAssetVersion(createVersionInput(ownerId, projectId, {
      assetId,
      parentVersionIds: [second.version.id, first.version.id],
    }));

    expect(child.version.parentVersionIds).toEqual([second.version.id, first.version.id]);
    expect(storage.data.parents.get(child.version.id)).toEqual([second.version.id, first.version.id]);
  });

  it('trashes only the placement while the shared asset remains actively placed', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const version = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    const first = await service.createWorkspacePlacement({
      actorUserId: ownerId,
      projectId,
      assetVersionId: version.version.id,
      workspace: 'canvas',
      workspaceId: 'canvas-a',
      entityType: 'canvas-image',
      entityId: 'image-a',
    });
    await service.createWorkspacePlacement({
      actorUserId: ownerId,
      projectId,
      assetVersionId: version.version.id,
      workspace: 'canvas',
      workspaceId: 'canvas-b',
      entityType: 'canvas-image',
      entityId: 'image-b',
    });

    const result = await service.trashPlacement({ actorUserId: ownerId, projectId, placementId: first.placement.id });

    expect(result).toEqual({ placementTrashed: true, assetTrashed: false });
    expect(storage.data.assets.get(version.asset.id)?.status).toBe('active');
  });

  it('trashes the asset after its final active placement is trashed', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const version = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    const placement = await service.createWorkspacePlacement({
      actorUserId: ownerId,
      projectId,
      assetVersionId: version.version.id,
      workspace: 'canvas',
      workspaceId: 'canvas-a',
      entityType: 'canvas-image',
      entityId: 'image-a',
    });

    const result = await service.trashPlacement({ actorUserId: ownerId, projectId, placementId: placement.placement.id });

    expect(result).toEqual({ placementTrashed: true, assetTrashed: true });
    expect(storage.data.assets.get(version.asset.id)?.status).toBe('trashed');
  });
});
