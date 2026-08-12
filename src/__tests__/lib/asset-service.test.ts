import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

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

type CreateVersionWithPlacementInput = Omit<CreateAssetVersionInput, 'file'> & {
  resolveFile: () => Promise<AssetFile>;
  placement: Omit<CreatePlacementInput, 'actorUserId' | 'projectId' | 'assetVersionId'>;
};

type PlacementCommand = {
  actorUserId: string;
  projectId: string;
  placementId: string;
};

type TransferVersionInput = {
  actorUserId: string;
  sourceVersionId: string;
  targetProjectId: string;
  targetWorkspaceId: string;
  entityType: 'canvas-image' | 'workflow-input' | 'workflow-output' | 'chat-attachment';
  entityId: string;
  idempotencyKey: string;
  requestDigest: string;
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
  createVersionWithPlacement(input: CreateVersionWithPlacementInput): Promise<{
    asset: Asset;
    version: AssetVersion;
    placement: WorkspacePlacement;
    reused: boolean;
  }>;
  resolveAssetReference(input: {
    actorUserId: string;
    projectId: string;
    assetVersionId: string;
    placementId?: string;
  }): Promise<{
    assetId: string;
    assetVersionId: string;
    placementId?: string;
    url: string;
    name?: string;
  }>;
  sendVersionToWorkspace(input: TransferVersionInput): Promise<{
    version: AssetVersion;
    placement: WorkspacePlacement;
    reused: boolean;
  }>;
  trashPlacement(input: PlacementCommand): Promise<{
    placementTrashed: boolean;
    assetTrashed: boolean;
  }>;
  restorePlacement(input: PlacementCommand): Promise<{
    placement: WorkspacePlacement;
    asset: Asset;
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
  versionMetadata: Map<string, Record<string, unknown>>;
  parents: Map<string, string[]>;
  placements: Map<string, WorkspacePlacement>;
  transferDigests: Map<string, string>;
  transferSources: Map<string, string>;
};

function projectKey(ownerId: string, projectId: string): string {
  return `${ownerId}:${projectId}`;
}

class MemoryStorage {
  readonly data: MemoryRecord;
  readonly lifecycleCalls: string[] = [];

  constructor(ownerId: string, projectId: string) {
    this.data = {
      projects: new Set([projectKey(ownerId, projectId)]),
      assets: new Map(),
      versions: new Map(),
      versionDigests: new Map(),
      versionMetadata: new Map(),
      parents: new Map(),
      placements: new Map(),
      transferDigests: new Map(),
      transferSources: new Map(),
    };
  }

  async transaction<T>(callback: (transaction: MemoryStorage) => Promise<T>): Promise<T> {
    const snapshot: MemoryRecord = {
      projects: new Set(this.data.projects),
      assets: new Map(this.data.assets),
      versions: new Map(this.data.versions),
      versionDigests: new Map(this.data.versionDigests),
      versionMetadata: new Map(this.data.versionMetadata),
      parents: new Map([...this.data.parents].map(([key, value]) => [key, [...value]])),
      placements: new Map(this.data.placements),
      transferDigests: new Map(this.data.transferDigests),
      transferSources: new Map(this.data.transferSources),
    };
    try {
      return await callback(this);
    } catch (error) {
      this.data.projects = snapshot.projects;
      this.data.assets = snapshot.assets;
      this.data.versions = snapshot.versions;
      this.data.versionDigests = snapshot.versionDigests;
      this.data.versionMetadata = snapshot.versionMetadata;
      this.data.parents = snapshot.parents;
      this.data.placements = snapshot.placements;
      this.data.transferDigests = snapshot.transferDigests;
      this.data.transferSources = snapshot.transferSources;
      throw error;
    }
  }

  async findProject(ownerId: string, projectId: string): Promise<boolean> {
    return this.data.projects.has(projectKey(ownerId, projectId));
  }

  async findAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null> {
    const asset = this.data.assets.get(assetId);
    return asset?.ownerId === ownerId && asset.projectId === projectId ? asset : null;
  }

  async lockAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null> {
    this.lifecycleCalls.push('lockAsset');
    return this.findAsset(ownerId, projectId, assetId);
  }

  async insertAsset(asset: Asset): Promise<void> {
    this.data.assets.set(asset.id, asset);
  }

  async findVersion(ownerId: string, projectId: string, versionId: string): Promise<AssetVersion | null> {
    const version = this.data.versions.get(versionId);
    return version?.ownerId === ownerId && version.projectId === projectId ? version : null;
  }

  async resolveVersionProject(ownerId: string, versionId: string): Promise<string | null> {
    const version = this.data.versions.get(versionId);
    return version?.ownerId === ownerId ? version.projectId : null;
  }

  async lockVersionIdempotency(): Promise<void> {
    // In-memory tests execute serially; PostgreSQL coverage proves lock behavior.
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

  async insertVersion(
    version: AssetVersion,
    requestDigest: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    this.data.versions.set(version.id, version);
    this.data.versionDigests.set(version.id, requestDigest);
    this.data.versionMetadata.set(version.id, { ...metadata, requestDigest });
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
    this.lifecycleCalls.push('findPlacement');
    const placement = this.data.placements.get(placementId);
    return placement?.ownerId === ownerId && placement.projectId === projectId ? placement : null;
  }

  async lockPlacement(
    ownerId: string,
    projectId: string,
    placementId: string,
  ): Promise<WorkspacePlacement | null> {
    this.lifecycleCalls.push('lockPlacement');
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
    this.lifecycleCalls.push('insertPlacement');
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

  async lockTransferIdempotency(): Promise<void> {
    // In-memory tests execute serially; PostgreSQL coverage proves lock behavior.
  }

  async findTransfersByIdempotency(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<Array<{ placement: WorkspacePlacement; requestDigest: string; sourceVersionId: string }>> {
    return [...this.data.placements.values()]
      .filter(placement => placement.ownerId === ownerId && placement.metadata?.idempotencyKey === idempotencyKey)
      .map(placement => ({
        placement,
        requestDigest: this.data.transferDigests.get(placement.id) ?? '',
        sourceVersionId: this.data.transferSources.get(placement.id) ?? '',
      }));
  }

  async findTransfer(
    ownerId: string,
    sourceVersionId: string,
    targetProjectId: string,
    workspace: WorkspaceKind,
    workspaceId: string,
    entityType: string,
    entityId: string,
    idempotencyKey: string,
  ): Promise<{ placement: WorkspacePlacement; requestDigest: string; sourceVersionId: string } | null> {
    for (const placement of this.data.placements.values()) {
      if (
        placement.ownerId === ownerId
        && this.data.transferSources.get(placement.id) === sourceVersionId
        && placement.projectId === targetProjectId
        && placement.workspace === workspace
        && placement.workspaceId === workspaceId
        && placement.entityType === entityType
        && placement.entityId === entityId
        && placement.metadata?.idempotencyKey === idempotencyKey
      ) {
        return {
          placement,
          requestDigest: this.data.transferDigests.get(placement.id) ?? '',
          sourceVersionId: this.data.transferSources.get(placement.id) ?? '',
        };
      }
    }
    return null;
  }

  async insertTransferPlacement(
    placement: WorkspacePlacement,
    sourceVersionId: string,
    idempotencyKey: string,
    requestDigest: string,
  ): Promise<boolean> {
    const existing = await this.findTransfer(
      placement.ownerId,
      sourceVersionId,
      placement.projectId,
      placement.workspace,
      placement.workspaceId,
      placement.entityType,
      placement.entityId,
      idempotencyKey,
    );
    if (existing) return false;
    this.data.placements.set(placement.id, placement);
    this.data.transferSources.set(placement.id, sourceVersionId);
    this.data.transferDigests.set(placement.id, requestDigest);
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

  async activateAsset(ownerId: string, projectId: string, assetId: string): Promise<Asset | null> {
    const asset = await this.findAsset(ownerId, projectId, assetId);
    if (!asset) return null;
    const active = { ...asset, status: 'active' as const };
    this.data.assets.set(assetId, active);
    return active;
  }

  async restorePlacement(
    ownerId: string,
    projectId: string,
    placementId: string,
  ): Promise<WorkspacePlacement | null> {
    const placement = await this.findPlacement(ownerId, projectId, placementId);
    if (!placement) return null;
    const active = { ...placement, status: 'active' as const, deletedAt: null } as WorkspacePlacement;
    this.data.placements.set(placementId, active);
    return active;
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
  it('I4 atomically creates a version and placement and replays without persisting media twice', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    expect(service.createVersionWithPlacement).toBeTypeOf('function');
    if (typeof service.createVersionWithPlacement !== 'function') return;
    const resolveFile = vi.fn(async () => file('https://canonical.test/atomic.png'));
    const input: CreateVersionWithPlacementInput = {
      actorUserId: ownerId,
      projectId,
      kind: 'image',
      resolveFile,
      idempotencyKey: 'atomic-registration',
      requestDigest: 'stable-original-content-digest',
      metadata: { source: 'standalone-chat' },
      placement: {
        workspace: 'chat',
        workspaceId: 'standalone-chat:project-a',
        entityType: 'chat-result',
        entityId: 'message-a:0',
      },
    };

    const first = await service.createVersionWithPlacement(input);
    const replay = await service.createVersionWithPlacement(input);

    expect(first.reused).toBe(false);
    expect(replay.reused).toBe(true);
    expect(replay.version.id).toBe(first.version.id);
    expect(replay.placement.id).toBe(first.placement.id);
    expect(resolveFile).toHaveBeenCalledTimes(1);
    expect(storage.data.versions.size).toBe(1);
    expect(storage.data.placements.size).toBe(1);
  });

  it('locks a reused asset before creating a placement with a new version', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const existing = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    storage.lifecycleCalls.length = 0;

    await service.createVersionWithPlacement({
      actorUserId: ownerId,
      projectId,
      assetId: existing.asset.id,
      kind: 'image',
      resolveFile: async () => file('https://canonical.test/reused-asset.png'),
      idempotencyKey: 'reused-asset-placement',
      requestDigest: 'reused-asset-placement-digest',
      placement: {
        workspace: 'canvas',
        workspaceId: 'canvas-reused',
        entityType: 'canvas-image',
        entityId: 'image-reused',
      },
    });

    expect(storage.lifecycleCalls.indexOf('lockAsset')).toBeGreaterThanOrEqual(0);
    expect(storage.lifecycleCalls.indexOf('lockAsset')).toBeLessThan(storage.lifecycleCalls.indexOf('insertPlacement'));
  });

  it('locks the asset before repairing a missing idempotent placement', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const input: CreateVersionWithPlacementInput = {
      actorUserId: ownerId,
      projectId,
      kind: 'image',
      resolveFile: async () => file('https://canonical.test/idempotent-repair.png'),
      idempotencyKey: 'idempotent-placement-repair',
      requestDigest: 'idempotent-placement-repair-digest',
      placement: {
        workspace: 'canvas',
        workspaceId: 'canvas-repair',
        entityType: 'canvas-image',
        entityId: 'image-repair',
      },
    };
    const created = await service.createVersionWithPlacement(input);
    storage.data.placements.delete(created.placement.id);
    storage.lifecycleCalls.length = 0;

    await service.createVersionWithPlacement(input);

    expect(storage.lifecycleCalls.indexOf('lockAsset')).toBeGreaterThanOrEqual(0);
    expect(storage.lifecycleCalls.indexOf('lockAsset')).toBeLessThan(storage.lifecycleCalls.indexOf('insertPlacement'));
  });

  it('I4 rolls back a newly created version when its required placement cannot be inserted', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    expect(service.createVersionWithPlacement).toBeTypeOf('function');
    if (typeof service.createVersionWithPlacement !== 'function') return;
    const existing = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    await service.createWorkspacePlacement({
      actorUserId: ownerId,
      projectId,
      assetVersionId: existing.version.id,
      workspace: 'chat',
      workspaceId: 'standalone-chat:project-a',
      entityType: 'chat-result',
      entityId: 'message-a:0',
    });
    const before = {
      assets: storage.data.assets.size,
      versions: storage.data.versions.size,
      placements: storage.data.placements.size,
    };

    await expect(service.createVersionWithPlacement({
      actorUserId: ownerId,
      projectId,
      kind: 'image',
      resolveFile: async () => file('https://canonical.test/rolled-back.png'),
      idempotencyKey: 'conflicting-atomic-registration',
      requestDigest: 'conflicting-atomic-digest',
      placement: {
        workspace: 'chat',
        workspaceId: 'standalone-chat:project-a',
        entityType: 'chat-result',
        entityId: 'message-a:0',
      },
    })).rejects.toMatchObject({ code: 'ASSET_PLACEMENT_CONFLICT' });

    expect({
      assets: storage.data.assets.size,
      versions: storage.data.versions.size,
      placements: storage.data.placements.size,
    }).toEqual(before);
    expect([...storage.data.versions.values()]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ idempotencyKey: 'conflicting-atomic-registration' }),
    ]));
  });

  it('resolves a canonical actor-owned version and placement reference', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const created = await service.createAssetVersion(createVersionInput(ownerId, projectId, {
      file: file('https://canonical.test/owned.png'),
    }));
    const placed = await service.createWorkspacePlacement({
      actorUserId: ownerId,
      projectId,
      assetVersionId: created.version.id,
      workspace: 'workflow',
      workspaceId: 'workflow-a',
      entityType: 'workflow-input',
      entityId: 'input-a',
      metadata: { name: 'Owned input' },
    });

    await expect(service.resolveAssetReference({
      actorUserId: ownerId,
      projectId,
      assetVersionId: created.version.id,
      placementId: placed.placement.id,
    })).resolves.toEqual({
      assetId: created.asset.id,
      assetVersionId: created.version.id,
      placementId: placed.placement.id,
      url: 'https://canonical.test/owned.png',
      name: 'Owned input',
    });
  });

  it('treats a transfer idempotency key as actor-global across target semantics', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const created = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    const input: TransferVersionInput = {
      actorUserId: ownerId,
      sourceVersionId: created.version.id,
      targetProjectId: projectId,
      targetWorkspaceId: 'workflow-a',
      entityType: 'workflow-input',
      entityId: 'input-a',
      idempotencyKey: 'actor-global-key',
      requestDigest: 'digest-workflow-a',
    };

    const first = await service.sendVersionToWorkspace(input);
    const replay = await service.sendVersionToWorkspace(input);

    expect(first.reused).toBe(false);
    expect(replay.reused).toBe(true);
    expect(replay.placement.id).toBe(first.placement.id);
    await expect(service.sendVersionToWorkspace({
      ...input,
      targetWorkspaceId: 'workflow-b',
      entityId: 'input-b',
      requestDigest: 'digest-workflow-b',
    })).rejects.toMatchObject({ code: 'ASSET_IDEMPOTENCY_CONFLICT' });
  });

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

  it('persists caller metadata without allowing it to replace the internal request digest', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);

    const created = await service.createAssetVersion(createVersionInput(ownerId, projectId, {
      requestDigest: 'trusted-digest',
      metadata: {
        requestDigest: 'caller-spoof',
        provenance: 'unit-test',
      },
    }));

    expect(storage.data.versionMetadata.get(created.version.id)).toEqual({
      provenance: 'unit-test',
      requestDigest: 'trusted-digest',
    });
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

  it('restores a trashed placement while another placement keeps the shared asset active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    try {
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
      await service.trashPlacement({ actorUserId: ownerId, projectId, placementId: first.placement.id });

      const restored = await service.restorePlacement({
        actorUserId: ownerId,
        projectId,
        placementId: first.placement.id,
      });

      expect(restored.placement.status).toBe('active');
      expect(restored.asset.status).toBe('active');
      expect(storage.data.assets.get(version.asset.id)?.status).toBe('active');
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks the asset before re-reading the placement for trash and restore decisions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    try {
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

      storage.lifecycleCalls.length = 0;
      await service.trashPlacement({ actorUserId: ownerId, projectId, placementId: placement.placement.id });
      expect(storage.lifecycleCalls.slice(0, 3)).toEqual(['findPlacement', 'lockAsset', 'lockPlacement']);

      storage.lifecycleCalls.length = 0;
      await service.restorePlacement({ actorUserId: ownerId, projectId, placementId: placement.placement.id });
      expect(storage.lifecycleCalls.slice(0, 3)).toEqual(['findPlacement', 'lockAsset', 'lockPlacement']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-evaluates retention after the asset lock at the exact 30 day boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    try {
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
      await service.trashPlacement({ actorUserId: ownerId, projectId, placementId: placement.placement.id });
      vi.setSystemTime(new Date('2026-09-09T23:59:59.999Z'));
      const lockAsset = storage.lockAsset.bind(storage);
      storage.lockAsset = async (...args: Parameters<MemoryStorage['lockAsset']>) => {
        vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
        return lockAsset(...args);
      };

      await expect(service.restorePlacement({
        actorUserId: ownerId,
        projectId,
        placementId: placement.placement.id,
      })).rejects.toMatchObject({ code: 'ASSET_RESTORE_NOT_ALLOWED' });
      expect(storage.data.placements.get(placement.placement.id)?.status).toBe('trashed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed for foreign ownership and active placement restore requests', async () => {
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

    await expect(service.restorePlacement({
      actorUserId: randomUUID(),
      projectId,
      placementId: placement.placement.id,
    })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(service.restorePlacement({
      actorUserId: ownerId,
      projectId,
      placementId: placement.placement.id,
    })).rejects.toMatchObject({ code: 'ASSET_RESTORE_NOT_ALLOWED' });
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

describe('PostgresAssetStorage transaction recovery', () => {
  it('destroys a client when rollback fails while preserving the original error', async () => {
    const originalError = new Error('callback failed');
    const rollbackError = new Error('rollback failed');
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql === 'ROLLBACK') throw rollbackError;
      return { rows: [], rowCount: 0 };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    };
    const { PostgresAssetStorage } = await import('@/lib/asset-core/storage');
    const storage = new PostgresAssetStorage(pool as never);

    await expect(storage.transaction(async () => {
      throw originalError;
    })).rejects.toBe(originalError);

    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(rollbackError);
  });
});
