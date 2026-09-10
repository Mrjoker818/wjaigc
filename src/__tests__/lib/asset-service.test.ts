import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import type {
  Asset,
  AssetFile,
  AssetKind,
  AssetVersion,
  WorkspaceKind,
  WorkspacePlacement,
} from '@/lib/asset-core/types';
import type { WorkspaceSourceTrace } from '@/lib/asset-core/source-trace';

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
  metadata?: Record<string, unknown>;
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
  createAssetVersionsAtomically(inputs: readonly CreateAssetVersionInput[]): Promise<Array<{
    asset: Asset;
    version: AssetVersion;
    reused: boolean;
  }>>;
  findAssetVersionByIdempotency(input: {
    actorUserId: string; projectId: string; idempotencyKey: string; requestDigest: string;
  }): Promise<AssetVersion | null>;
  bindWorkflowInputPlacement(input: CreatePlacementInput): Promise<{
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
    sourceTrace?: WorkspaceSourceTrace;
  }>;
  resolveReadableAssetReference(input: {
    actorUserId: string;
    projectId: string;
    assetVersionId: string;
  }): Promise<{
    assetId: string;
    assetVersionId: string;
    kind: AssetKind;
    url: string;
    storageKey?: string;
    checksum?: string;
    mimeType?: string;
    byteSize?: number;
  }>;
  sendVersionToWorkspace(input: TransferVersionInput): Promise<{
    version: AssetVersion;
    placement: WorkspacePlacement;
    reused: boolean;
  }>;
  sendVersionsToWorkspace(
    inputs: readonly TransferVersionInput[],
    options?: { restoreDeletedPlacements?: boolean },
  ): Promise<Array<{
    version: AssetVersion;
    placement: WorkspacePlacement;
    reused: boolean;
    projectRevision?: number;
  }>>;
  trashPlacement(input: PlacementCommand): Promise<{
    placementTrashed: boolean;
    assetTrashed: boolean;
    projectRevision?: number;
  }>;
  restorePlacement(input: PlacementCommand): Promise<{
    placement: WorkspacePlacement;
    asset: Asset;
    projectRevision?: number;
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
  readonly findVersionCalls: Array<[string, string, string]> = [];
  readonly restoredCanvasSnapshots: WorkspacePlacement[] = [];
  readonly trashedCanvasSnapshots: WorkspacePlacement[] = [];
  canvasProjectRevision = 0;

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

  async read<T>(callback: (transaction: MemoryStorage) => Promise<T>): Promise<T> {
    return callback(this);
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
    this.lifecycleCalls.push('findVersion');
    this.findVersionCalls.push([ownerId, projectId, versionId]);
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

  async lockWorkspacePlacementSlot(): Promise<void> {
    this.lifecycleCalls.push('lockWorkspacePlacementSlot');
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
    this.lifecycleCalls.push('activateAsset');
    const asset = await this.findAsset(ownerId, projectId, assetId);
    if (!asset) return null;
    const active = { ...asset, status: 'active' as const };
    this.data.assets.set(assetId, active);
    return active;
  }

  async lockCanvasProjectSnapshot(): Promise<void> {
    this.lifecycleCalls.push('lockCanvasProjectSnapshot');
  }

  async readPlacementTrashProjectRevision(placement: WorkspacePlacement): Promise<number | undefined> {
    this.lifecycleCalls.push('readPlacementTrashProjectRevision');
    const value = placement.metadata?.canvasTrashProjectRevision;
    return Number.isSafeInteger(value) ? Number(value) : undefined;
  }

  async restorePlacement(
    ownerId: string,
    projectId: string,
    placementId: string,
  ): Promise<WorkspacePlacement | null> {
    this.lifecycleCalls.push('restorePlacement');
    const placement = await this.findPlacement(ownerId, projectId, placementId);
    if (!placement) return null;
    const active = { ...placement, status: 'active' as const, deletedAt: null } as WorkspacePlacement;
    this.data.placements.set(placementId, active);
    return active;
  }

  async restoreCanvasPlacementSnapshot(
    _ownerId: string,
    _projectId: string,
    placement: WorkspacePlacement,
  ): Promise<number> {
    this.lifecycleCalls.push('restoreCanvasPlacementSnapshot');
    this.restoredCanvasSnapshots.push(placement);
    this.canvasProjectRevision += 1;
    return this.canvasProjectRevision;
  }

  async trashCanvasPlacementSnapshot(
    _ownerId: string,
    _projectId: string,
    placement: WorkspacePlacement,
  ): Promise<number> {
    this.lifecycleCalls.push('trashCanvasPlacementSnapshot');
    this.trashedCanvasSnapshots.push(placement);
    this.canvasProjectRevision += 1;
    placement.metadata = {
      ...(placement.metadata ?? {}),
      canvasTrashProjectRevision: this.canvasProjectRevision,
    };
    return this.canvasProjectRevision;
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

describe('Canvas snapshot trash storage boundary', () => {
  it('delegates Canvas snapshot trash to the shared transaction helper', () => {
    const storageSource = readFileSync('src/lib/asset-core/storage.ts', 'utf8');
    expect(storageSource).toContain('trashCanvasPlacementSnapshotInTransaction(');
    expect(storageSource).not.toContain("project.canvasImages = canvasImages.filter(candidate => candidate.id !== placement.entityId)");
  });
});

describe('Asset Graph write gate coverage', () => {
  it('gates direct production write wrappers after BEGIN and before business work', () => {
    const orderedContracts = new Map([
      [
        'src/lib/asset-core/storage.ts',
        /async transaction<T>\([\s\S]*?return this\.runTransaction\(callback, true\);[\s\S]*?await client\.query\('BEGIN'\);\s+if \(write\) await lockAssetGraphWriteGate\(client, 'shared'\);\s+const result = await callback\(new PostgresAssetStorageTransaction\(client\)\)/,
      ],
      [
        'src/lib/asset-core/canvas-project-sync.ts',
        /await client\.query\('BEGIN'\);\s+await lockAssetGraphWriteGate\(client, 'shared'\);\s+const result = await callback\(/,
      ],
      [
        'src/lib/asset-core/task-projector.ts',
        /await client\.query\('BEGIN'\);\s+await lockAssetGraphWriteGate\(client, 'shared'\);\s+const result = await callback\(new PostgresTaskProjectionTransaction\(client\)\)/,
      ],
      [
        'src/lib/asset-core/legacy-migration.ts',
        /await client\.query\('BEGIN'\);\s+await lockAssetGraphWriteGate\(client, 'shared'\);\s+const result = await migrateLegacyProjectOnWriteInTransaction\(client, input\)/,
      ],
    ]);

    for (const [path, contract] of orderedContracts) {
      expect(readFileSync(path, 'utf8'), path).toMatch(contract);
    }
  });

  it('classifies every helper transaction explicitly as read-only or shared-write', () => {
    const expectedModes = new Map<string, string[]>([
      ['src/lib/asset-core/historical-media-remediation.ts', ["'none'", "'none'"]],
      ['src/lib/asset-core/media-health.ts', [
        "dryRun?'none':'shared'",
        "'shared'",
        "'shared'",
        "'none'",
        "'shared'",
        "'shared'",
        "'none'",
      ]],
      ['src/lib/asset-core/recovery-media.ts', ["'none'"]],
      ['src/lib/asset-core/thumbnail-backfill.ts', [
        "dryRun?'none':'shared'",
        "'shared'",
        "'shared'",
        "'shared'",
        "'none'",
      ]],
    ]);

    for (const [path, expected] of expectedModes) {
      const sourceText = readFileSync(path, 'utf8');
      const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
      const modes: string[] = [];
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === 'withAssetCoreTransaction'
        ) {
          modes.push(node.arguments[2]?.getText(sourceFile).replace(/\s+/g, '') ?? 'implicit');
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      expect(modes, path).toEqual(expected);
    }
  });
});

describe('asset graph service', () => {
  it('resolves an asset reference through the read-only storage boundary', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const versionId = randomUUID();
    const read = vi.fn(async (callback: (transaction: {
      findProject: () => Promise<boolean>;
      findAsset: () => Promise<Asset>;
      findVersion: () => Promise<AssetVersion>;
    }) => Promise<unknown>) => callback({
      findProject: async () => true,
      findAsset: async () => ({
        id: 'asset-read', ownerId, projectId, kind: 'document', status: 'active',
        currentVersionId: versionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      findVersion: async () => ({
        id: versionId,
        assetId: 'asset-read',
        ownerId,
        projectId,
        file: file('https://canonical.test/read.png'),
        parentVersionIds: [],
        createdAt: new Date().toISOString(),
      }),
    }));
    const transaction = vi.fn(async () => {
      throw new Error('write transaction must not serve resolveAssetReference');
    });
    const { createAssetService } = await loadService();
    const service = createAssetService({ read, transaction });

    await expect(service.resolveAssetReference({
      actorUserId: ownerId,
      projectId,
      assetVersionId: versionId,
    })).resolves.toMatchObject({
      assetId: 'asset-read',
      assetVersionId: versionId,
      kind: 'document',
      url: 'https://canonical.test/read.png',
    });
    expect(read).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });

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
      kind: 'image',
      placementId: placed.placement.id,
      entityId: 'input-a',
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

  it('locks the canvas snapshot before assets when an atomic batch may restore a deleted projection', async () => {
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
      targetWorkspaceId: `canvas:${projectId}`,
      entityType: 'canvas-image',
      entityId: 'canvas-result',
      idempotencyKey: 'canvas-result-transfer',
      requestDigest: 'canvas-result-transfer-digest',
    };
    const transferred = await service.sendVersionToWorkspace(input);
    await service.trashPlacement({
      actorUserId: ownerId,
      projectId,
      placementId: transferred.placement.id,
    });
    const trashedPlacement = storage.data.placements.get(transferred.placement.id);
    if (!trashedPlacement) throw new Error('missing trashed placement');
    storage.data.placements.set(transferred.placement.id, {
      ...trashedPlacement,
      deletedAt: new Date().toISOString(),
    });

    storage.lifecycleCalls.length = 0;
    await service.sendVersionsToWorkspace([input], { restoreDeletedPlacements: true });

    expect(storage.lifecycleCalls.indexOf('lockCanvasProjectSnapshot')).toBeLessThan(
      storage.lifecycleCalls.indexOf('lockAsset'),
    );
  });

  it('returns exact readable file metadata only after the normal ownership checks', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const versionId = randomUUID();
    const versionFile: AssetFile = {
      url: '/api/serve-upload/uploads/export-source.png',
      availability: 'ready',
      storageKey: 'images/owners/user-1/exact-source.png',
      checksum: `sha256:${'a'.repeat(64)}`,
      mimeType: 'image/png',
      byteSize: 1234,
      width: 640,
      height: 480,
    };
    const read = vi.fn(async (callback: (transaction: {
      findProject: () => Promise<boolean>;
      findAsset: () => Promise<Asset>;
      findVersion: () => Promise<AssetVersion>;
    }) => Promise<unknown>) => callback({
      findProject: async () => true,
      findAsset: async () => ({
        id: 'asset-readable', ownerId, projectId, kind: 'image', status: 'active',
        currentVersionId: versionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      findVersion: async () => ({
        id: versionId,
        assetId: 'asset-readable',
        ownerId,
        projectId,
        file: versionFile,
        parentVersionIds: [],
        createdAt: new Date().toISOString(),
      }),
    }));
    const transaction = vi.fn(async () => {
      throw new Error('write transaction must not serve readable references');
    });
    const { createAssetService } = await loadService();
    const service = createAssetService({ read, transaction });

    await expect(service.resolveReadableAssetReference({
      actorUserId: ownerId,
      projectId,
      assetVersionId: versionId,
    })).resolves.toEqual({
      assetId: 'asset-readable',
      assetVersionId: versionId,
      kind: 'image',
      url: versionFile.url,
      storageKey: versionFile.storageKey,
      checksum: versionFile.checksum,
      mimeType: versionFile.mimeType,
      byteSize: versionFile.byteSize,
      width: versionFile.width,
      height: versionFile.height,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('hides readable file metadata behind ASSET_NOT_FOUND when ownership fails', async () => {
    const read = vi.fn(async (callback: (transaction: {
      findProject: () => Promise<boolean>;
    }) => Promise<unknown>) => callback({ findProject: async () => false }));
    const { createAssetService } = await loadService();
    const service = createAssetService({ read, transaction: vi.fn() });

    await expect(service.resolveReadableAssetReference({
      actorUserId: 'other-user',
      projectId: 'other-project',
      assetVersionId: 'hidden-version',
    })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it.each(['pending-persist', 'missing', 'recovering', 'unrecoverable'] as const)(
    'hides a %s file behind ASSET_NOT_FOUND',
    async (availability) => {
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const versionId = randomUUID();
      const read = vi.fn(async (callback: (transaction: {
        findProject: () => Promise<boolean>;
        findAsset: () => Promise<Asset>;
        findVersion: () => Promise<AssetVersion>;
      }) => Promise<unknown>) => callback({
        findProject: async () => true,
        findAsset: async () => ({
          id: 'asset-unavailable', ownerId, projectId, kind: 'image', status: 'active',
          currentVersionId: versionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }),
        findVersion: async () => ({
          id: versionId,
          assetId: 'asset-unavailable',
          ownerId,
          projectId,
          file: { url: '/api/serve-upload/uploads/source.png', availability },
          parentVersionIds: [],
          createdAt: new Date().toISOString(),
        }),
      }));
      const { createAssetService } = await loadService();
      const service = createAssetService({ read, transaction: vi.fn() });

      await expect(service.resolveReadableAssetReference({
        actorUserId: ownerId,
        projectId,
        assetVersionId: versionId,
      })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    },
  );

  it('hides readable metadata when its asset is trashed', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const versionId = randomUUID();
    const read = vi.fn(async (callback: (transaction: {
      findProject: () => Promise<boolean>;
      findAsset: () => Promise<Asset>;
      findVersion: () => Promise<AssetVersion>;
    }) => Promise<unknown>) => callback({
      findProject: async () => true,
      findAsset: async () => ({
        id: 'asset-trashed', ownerId, projectId, kind: 'image', status: 'trashed',
        currentVersionId: versionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      findVersion: async () => ({
        id: versionId,
        assetId: 'asset-trashed',
        ownerId,
        projectId,
        file: { url: '/api/serve-upload/uploads/source.png', availability: 'ready' },
        parentVersionIds: [],
        createdAt: new Date().toISOString(),
      }),
    }));
    const { createAssetService } = await loadService();
    const service = createAssetService({ read, transaction: vi.fn() });

    await expect(service.resolveReadableAssetReference({
      actorUserId: ownerId,
      projectId,
      assetVersionId: versionId,
    })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('rebinds a workflow input atomically without changing either source asset status', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const first = await service.createAssetVersion(createVersionInput(ownerId, projectId, {
      idempotencyKey: 'workflow-input-first', requestDigest: 'workflow-input-first',
    }));
    const second = await service.createAssetVersion(createVersionInput(ownerId, projectId, {
      idempotencyKey: 'workflow-input-second', requestDigest: 'workflow-input-second',
    }));
    const binding = {
      actorUserId: ownerId, projectId, workspace: 'workflow' as const,
      workspaceId: 'workflow-a', entityType: 'workflow-input', entityId: 'input-a',
    };

    const firstPlacement = await service.bindWorkflowInputPlacement({
      ...binding, assetVersionId: first.version.id,
    });
    const secondPlacement = await service.bindWorkflowInputPlacement({
      ...binding, assetVersionId: second.version.id,
    });

    expect(storage.data.placements.get(firstPlacement.placement.id)?.status).toBe('trashed');
    expect(storage.data.placements.get(secondPlacement.placement.id)?.status).toBe('active');
    expect(storage.data.assets.get(first.asset.id)?.status).toBe('active');
    expect(storage.data.assets.get(second.asset.id)?.status).toBe('active');
    expect(storage.lifecycleCalls.indexOf('lockWorkspacePlacementSlot')).toBeLessThan(
      storage.lifecycleCalls.indexOf('lockAsset'),
    );
  });

  it('rejects binding a trashed workflow source without restoring the asset', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const created = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    storage.data.assets.set(created.asset.id, { ...created.asset, status: 'trashed' });
    storage.lifecycleCalls.length = 0;

    await expect(service.bindWorkflowInputPlacement({
      actorUserId: ownerId, projectId, assetVersionId: created.version.id,
      workspace: 'workflow', workspaceId: 'workflow-a',
      entityType: 'workflow-input', entityId: 'input-a',
    })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    expect(storage.data.assets.get(created.asset.id)?.status).toBe('trashed');
    expect(storage.lifecycleCalls).not.toContain('activateAsset');
  });


  it('round-trips Canvas Skill trace through a real transfer placement and asset resolve', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const created = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    const sourceTrace: WorkspaceSourceTrace = {
      source: 'canvas-skill', runId: 'run-1', skillId: 'preset-concept-art', skillVersion: 1,
      sourceVersionIds: ['source-a'], createdAt: '2026-09-02T00:00:00.000Z',
    };
    const transferred = await service.sendVersionToWorkspace({
      actorUserId: ownerId, sourceVersionId: created.version.id, targetProjectId: projectId,
      targetWorkspaceId: projectId, entityType: 'canvas-image', entityId: 'skill-output',
      idempotencyKey: 'canvas-skill:run-1:output', requestDigest: 'trace-transfer',
      metadata: { sourceTrace },
    });

    await expect(service.resolveAssetReference({
      actorUserId: ownerId, projectId, assetVersionId: created.version.id,
      placementId: transferred.placement.id,
    })).resolves.toMatchObject({ sourceTrace });
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

  it('authoritatively resolves a committed version by scope, idempotency key, and digest', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const input = createVersionInput(ownerId, projectId, {
      idempotencyKey: 'authoritative-key', requestDigest: 'authoritative-digest',
    });
    const created = await service.createAssetVersion(input);

    await expect(service.findAssetVersionByIdempotency(input)).resolves.toMatchObject({ id: created.version.id });
    await expect(service.findAssetVersionByIdempotency({ ...input, requestDigest: 'wrong-digest' }))
      .rejects.toMatchObject({ code: 'ASSET_IDEMPOTENCY_CONFLICT' });
    await expect(service.findAssetVersionByIdempotency({ ...input, idempotencyKey: 'missing-key' }))
      .resolves.toBeNull();
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

  it('allows a derived asset to reference a parent asset version in the same user project', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const source = await service.createAssetVersion(createVersionInput(ownerId, projectId));

    const derived = await service.createAssetVersion(createVersionInput(ownerId, projectId, {
      parentVersionIds: [source.version.id],
      idempotencyKey: 'derived-cross-asset',
    }));

    expect(derived.asset.id).not.toBe(source.asset.id);
    expect(derived.version.parentVersionIds).toEqual([source.version.id]);
  });

  it('keeps ordinary same-asset version lineage unchanged', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const first = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    const next = await service.createAssetVersion(createVersionInput(ownerId, projectId, {
      assetId: first.asset.id,
      parentVersionIds: [first.version.id],
      idempotencyKey: 'ordinary-next',
    }));

    expect(next.asset.id).toBe(first.asset.id);
    expect(next.version.parentVersionIds).toEqual([first.version.id]);
  });

  it('rolls back every version in an atomic batch when a later insert fails', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const originalInsert = storage.insertVersion.bind(storage);
    let inserts = 0;
    storage.insertVersion = async (...args) => {
      inserts += 1;
      if (inserts === 2) throw new Error('second insert failed');
      return originalInsert(...args);
    };
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);

    await expect(service.createAssetVersionsAtomically([
      createVersionInput(ownerId, projectId, { idempotencyKey: 'batch-a' }),
      createVersionInput(ownerId, projectId, { idempotencyKey: 'batch-b' }),
    ])).rejects.toThrow('second insert failed');
    expect(storage.data.versions.size).toBe(0);
    expect(storage.data.assets.size).toBe(0);
  });

  it('does not reveal or accept a cross-project parent version', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const foreign = createVersionInput(ownerId, randomUUID());
    const foreignVersion: AssetVersion = {
      id: randomUUID(), assetId: randomUUID(), ownerId, projectId: foreign.projectId,
      file: foreign.file, parentVersionIds: [], createdAt: new Date().toISOString(),
    };
    storage.data.versions.set(foreignVersion.id, foreignVersion);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    await expect(service.createAssetVersion(createVersionInput(ownerId, projectId, {
      parentVersionIds: [foreignVersion.id], idempotencyKey: 'foreign-parent',
    }))).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
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

    expect(result).toEqual({ placementTrashed: true, assetTrashed: false, projectRevision: 1 });
    expect(storage.data.assets.get(version.asset.id)?.status).toBe('active');
    expect(storage.trashedCanvasSnapshots).toEqual([
      expect.objectContaining({ id: first.placement.id, entityId: 'image-a' }),
    ]);
  });

  it('returns the committed canvas revision when a trashed placement is retried after a lost response', async () => {
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const storage = new MemoryStorage(ownerId, projectId);
    const { createAssetService } = await loadService();
    const service = createAssetService(storage);
    const version = await service.createAssetVersion(createVersionInput(ownerId, projectId));
    const placed = await service.createWorkspacePlacement({
      actorUserId: ownerId,
      projectId,
      assetVersionId: version.version.id,
      workspace: 'canvas',
      workspaceId: 'canvas-a',
      entityType: 'canvas-image',
      entityId: 'image-retry',
    });

    const first = await service.trashPlacement({ actorUserId: ownerId, projectId, placementId: placed.placement.id });
    storage.canvasProjectRevision = 2;
    const retried = await service.trashPlacement({ actorUserId: ownerId, projectId, placementId: placed.placement.id });

    expect(first.projectRevision).toBe(1);
    expect(retried).toEqual({ placementTrashed: false, assetTrashed: false, projectRevision: 1 });
    expect(storage.canvasProjectRevision).toBe(2);
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
      expect(restored.projectRevision).toBe(2);
      expect(storage.data.assets.get(version.asset.id)?.status).toBe('active');
      expect(storage.restoredCanvasSnapshots).toEqual([
        expect.objectContaining({
          id: first.placement.id,
          workspace: 'canvas',
          entityType: 'canvas-image',
          status: 'active',
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects restore when the selected version is unrecoverable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    try {
      const ownerId = randomUUID();
      const projectId = randomUUID();
      const storage = new MemoryStorage(ownerId, projectId);
      const { createAssetService } = await loadService();
      const service = createAssetService(storage);
      const historical = await service.createAssetVersion(createVersionInput(ownerId, projectId));
      const placed = await service.createWorkspacePlacement({
        actorUserId: ownerId,
        projectId,
        assetVersionId: historical.version.id,
        workspace: 'canvas',
        workspaceId: 'canvas-a',
        entityType: 'canvas-image',
        entityId: 'image-a',
      });
      const current = await service.createAssetVersion(createVersionInput(ownerId, projectId, {
        assetId: historical.asset.id,
        file: file('https://canonical.test/current-ready.png'),
        idempotencyKey: 'current-ready-version',
        requestDigest: 'current-ready-version-digest',
      }));
      await service.trashPlacement({
        actorUserId: ownerId,
        projectId,
        placementId: placed.placement.id,
      });
      storage.data.versions.set(historical.version.id, {
        ...historical.version,
        file: { ...historical.version.file, availability: 'unrecoverable' },
      });
      expect(current.asset.currentVersionId).toBe(current.version.id);
      expect(current.version.id).not.toBe(historical.version.id);
      expect(current.version.file.availability).toBe('ready');
      storage.lifecycleCalls.length = 0;
      storage.findVersionCalls.length = 0;

      await expect(service.restorePlacement({
        actorUserId: ownerId,
        projectId,
        placementId: placed.placement.id,
      })).rejects.toMatchObject({ code: 'ASSET_MEDIA_UNRECOVERABLE' });

      expect(storage.findVersionCalls).toEqual([
        [ownerId, projectId, historical.version.id],
      ]);
      expect(storage.lifecycleCalls.indexOf('lockPlacement')).toBeLessThan(
        storage.lifecycleCalls.indexOf('findVersion'),
      );
      expect(storage.lifecycleCalls).not.toContain('activateAsset');
      expect(storage.lifecycleCalls).not.toContain('restorePlacement');
      expect(storage.lifecycleCalls).not.toContain('restoreCanvasPlacementSnapshot');
      expect(storage.data.placements.get(placed.placement.id)?.status).toBe('trashed');
      expect(storage.data.assets.get(historical.asset.id)?.status).toBe('trashed');
      expect(storage.restoredCanvasSnapshots).toEqual([]);
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
      expect(storage.lifecycleCalls.indexOf('lockCanvasProjectSnapshot')).toBeLessThan(
        storage.lifecycleCalls.indexOf('lockAsset'),
      );
      expect(storage.lifecycleCalls.indexOf('lockAsset')).toBeLessThan(
        storage.lifecycleCalls.indexOf('lockPlacement'),
      );
      expect(storage.lifecycleCalls.indexOf('lockPlacement')).toBeLessThan(
        storage.lifecycleCalls.indexOf('trashCanvasPlacementSnapshot'),
      );

      storage.lifecycleCalls.length = 0;
      await service.restorePlacement({ actorUserId: ownerId, projectId, placementId: placement.placement.id });
      expect(storage.lifecycleCalls.slice(0, 4)).toEqual([
        'findPlacement',
        'lockCanvasProjectSnapshot',
        'lockAsset',
        'lockPlacement',
      ]);
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

    expect(result).toEqual({ placementTrashed: true, assetTrashed: true, projectRevision: 1 });
    expect(storage.data.assets.get(version.asset.id)?.status).toBe('trashed');
  });
});

describe('PostgresAssetStorage transaction recovery', () => {
  it('acquires the shared Asset Graph write gate before running business work', async () => {
    const events: string[] = [];
    const release = vi.fn();
    const query = vi.fn(async (...args: [string, unknown[]?]) => {
      const sql = args[0];
      events.push(sql);
      return { rows: [], rowCount: 0 };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    };
    const { PostgresAssetStorage } = await import('@/lib/asset-core/storage');
    const storage = new PostgresAssetStorage(pool as never);

    await expect(storage.transaction(async () => {
      events.push('BUSINESS_CALLBACK');
      return 'ok';
    })).resolves.toBe('ok');

    expect(events).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))',
      'BUSINESS_CALLBACK',
      'COMMIT',
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual(['wujie:asset-graph-write-gate:v1']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps the exclusive archive gate bounded and restores lock_timeout after acquisition', async () => {
    const events: string[] = [];
    const query = vi.fn(async (sql: string) => {
      events.push(sql);
      return { rows: [], rowCount: 0 };
    });
    const { lockAssetGraphWriteGate } = await import('@/lib/asset-core/storage');

    await expect(lockAssetGraphWriteGate({ query } as never, 'exclusive')).resolves.toBeUndefined();

    expect(events).toEqual([
      "SET LOCAL lock_timeout = '5000ms'",
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      "SET LOCAL lock_timeout = '0'",
    ]);
  });

  it('keeps read-only Asset Core helper transactions outside the write gate by default', async () => {
    const events: string[] = [];
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      events.push(sql);
      return { rows: [], rowCount: 0 };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    };
    const { withAssetCoreTransaction } = await import('@/lib/asset-core/storage');

    await expect(withAssetCoreTransaction(async () => {
      events.push('READ_CALLBACK');
      return 'read';
    }, pool as never)).resolves.toBe('read');

    expect(events).toEqual(['BEGIN', 'READ_CALLBACK', 'COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);
  });

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
