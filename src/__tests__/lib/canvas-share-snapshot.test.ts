import { mkdir, mkdtemp, open, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Asset, AssetVersion, WorkspacePlacement } from '@/lib/asset-core/types';
import {
  getManagedAssetMediaDescriptor,
  readManagedAssetVersionBytes,
} from '@/lib/asset-core/managed-media-read';
import { createAssetStorageTransaction } from '@/lib/asset-core/storage';
import { canonicalJson, hashCanonicalJson } from '@/lib/canvas-share/canonical-json';
import { CanvasShareError } from '@/lib/canvas-share/errors';
import {
  computeCanvasShareSnapshotDigestForRead,
  createCanvasSharePublicItemRef,
} from '@/lib/canvas-share/public-projection';
import {
  createCanvasShare,
  listCanvasShares,
  patchCanvasSharePolicy,
  readPublicCanvasShare,
  revokeCanvasShare,
} from '@/lib/canvas-share/service';
import {
  buildCanvasShareSnapshot,
  type CanvasShareSnapshotSource,
} from '@/lib/canvas-share/snapshot';
import type { CanvasShareItemRecord, CanvasShareRecord } from '@/lib/canvas-share/types';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
});

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-authoritative',
    ownerId: 'owner-authoritative',
    projectId: 'project-authoritative',
    kind: 'image',
    status: 'active',
    currentVersionId: 'version-authoritative',
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeVersion(overrides: Partial<AssetVersion> = {}): AssetVersion {
  return {
    id: 'version-authoritative',
    assetId: 'asset-authoritative',
    ownerId: 'owner-authoritative',
    projectId: 'project-authoritative',
    file: {
      url: '/api/serve-upload/uploads/authoritative.png',
      storageKey: 'images/gateway/authoritative.png',
      availability: 'ready',
      mimeType: 'image/png',
      byteSize: 128,
      width: 640,
      height: 480,
      checksum: 'sha256:authoritative',
    },
    parentVersionIds: [],
    metadata: {
      prompt: 'private prompt',
      provider: 'private provider',
      apiKey: 'private key',
    },
    createdAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
  };
}

function makePlacement(overrides: Partial<WorkspacePlacement> = {}): WorkspacePlacement {
  return {
    id: 'placement-authoritative',
    ownerId: 'owner-authoritative',
    projectId: 'project-authoritative',
    assetId: 'asset-authoritative',
    assetVersionId: 'version-authoritative',
    workspace: 'canvas',
    workspaceId: 'project-authoritative',
    entityType: 'canvas-image',
    entityId: 'canvas-image-authoritative',
    status: 'active',
    deletedAt: null,
    transform: {
      x: 12.5,
      y: -8,
      width: 640,
      height: 480,
      rotation: 15,
      zIndex: 3,
    },
    metadata: {
      label: '  产品主图  ',
      altText: '白色背景上的产品',
      prompt: 'must stay private',
      provider: 'must stay private',
      sourceUrl: 'https://private.example/source.png',
    },
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
  } as WorkspacePlacement;
}

function makeSource(input: {
  revision?: number;
  placements?: WorkspacePlacement[];
  asset?: Asset | null;
  version?: AssetVersion | null;
} = {}): CanvasShareSnapshotSource & {
  calls: Array<{ method: string; values: string[] }>;
} {
  const calls: Array<{ method: string; values: string[] }> = [];
  const asset = input.asset === undefined ? makeAsset() : input.asset;
  const version = input.version === undefined ? makeVersion() : input.version;
  return {
    calls,
    async readProjectRevision(ownerId, projectId) {
      calls.push({ method: 'revision', values: [ownerId, projectId] });
      return input.revision ?? 41;
    },
    async listActiveCanvasPlacements(ownerId, projectId) {
      calls.push({ method: 'placements', values: [ownerId, projectId] });
      return input.placements ?? [makePlacement()];
    },
    async findAsset(ownerId, projectId, assetId) {
      calls.push({ method: 'asset', values: [ownerId, projectId, assetId] });
      return asset;
    },
    async findVersion(ownerId, projectId, versionId) {
      calls.push({ method: 'version', values: [ownerId, projectId, versionId] });
      return version;
    },
    async getMediaDescriptor(candidate, kind) {
      calls.push({ method: 'media', values: [candidate.id, kind] });
      return getManagedAssetMediaDescriptor(candidate, kind, {}, {
        inspectS3Exact: async () => ({
          byteSize: candidate.file.byteSize!,
          contentType: candidate.file.mimeType ?? null,
          eTag: '"test-etag"',
          versionId: null,
        }),
      } as never);
    },
  };
}

describe('canonical canvas-share JSON', () => {
  it('sorts object keys, preserves array order, and normalizes JSON numbers', () => {
    expect(canonicalJson({ z: 1.2300, a: -0, nested: { y: 2, x: [3, 1] } })).toBe(
      '{"a":0,"nested":{"x":[3,1],"y":2},"z":1.23}',
    );
    expect(canonicalJson({ items: ['second', 'first'] })).toBe(
      '{"items":["second","first"]}',
    );
  });

  it('produces the same SHA-256 digest for equivalent key orderings', () => {
    expect(hashCanonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashCanonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(hashCanonicalJson({ value: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects non-finite values instead of silently converting them to null', () => {
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it('rejects sparse arrays instead of emitting invalid or collapsed JSON', () => {
    expect(() => canonicalJson(new Array(1))).toThrow(TypeError);
    expect(() => canonicalJson([, 'second'])).toThrow(TypeError);
    expect(canonicalJson([])).toBe('[]');
  });

  it('rejects a sparse array whose missing index is inherited from its prototype', () => {
    const inherited = new Array(1);
    Object.setPrototypeOf(inherited, { 0: 'inherited' });

    expect(() => canonicalJson(inherited)).toThrow(TypeError);
    expect(canonicalJson(['inherited'])).toBe('["inherited"]');
  });
});

describe('immutable canvas-share snapshot', () => {
  it('uses authoritative actor/project data, exact versions, normalized viewport, and frozen values', async () => {
    const placement = makePlacement();
    const version = makeVersion();
    const source = makeSource({ placements: [placement], version });

    const snapshot = await buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
      requestedViewport: {
        offsetX: Number.NaN,
        offsetY: -0,
        zoom: 99,
      },
    }, source);

    expect(source.calls).toEqual([
      { method: 'revision', values: ['owner-authoritative', 'project-authoritative'] },
      { method: 'placements', values: ['owner-authoritative', 'project-authoritative'] },
      { method: 'asset', values: ['owner-authoritative', 'project-authoritative', 'asset-authoritative'] },
      { method: 'version', values: ['owner-authoritative', 'project-authoritative', 'version-authoritative'] },
      { method: 'media', values: ['version-authoritative', 'image'] },
    ]);
    expect(snapshot).toMatchObject({
      projectRevision: 41,
      viewport: { offsetX: 0, offsetY: 0, zoom: 5 },
      snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      items: [{
        placementId: 'placement-authoritative',
        assetId: 'asset-authoritative',
        assetVersionId: 'version-authoritative',
        entityType: 'canvas-image',
        assetKind: 'image',
        transform: {
          x: 12.5,
          y: -8,
          width: 640,
          height: 480,
          rotation: 15,
          zIndex: 3,
        },
        displayMetadata: {
          label: '产品主图',
          altText: '白色背景上的产品',
        },
        mimeType: 'image/png',
        width: 640,
        height: 480,
        byteSize: 128,
        checksum: 'sha256:authoritative',
        availability: 'ready',
        sortOrder: 0,
      }],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
    expect(Object.isFrozen(snapshot.items[0]?.transform)).toBe(true);

    const frozenBeforeMutation = JSON.stringify(snapshot);
    (placement.transform as Record<string, unknown>).x = 999;
    version.file.url = 'https://attacker.example/replaced.png';
    version.metadata = { prompt: 'changed', provider: 'changed' };
    expect(JSON.stringify(snapshot)).toBe(frozenBeforeMutation);
    expect(frozenBeforeMutation).not.toContain('private prompt');
    expect(frozenBeforeMutation).not.toContain('private provider');
    expect(frozenBeforeMutation).not.toContain('private.example');
  });

  it('keeps the digest stable when raw URL and private metadata change', async () => {
    const first = await buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
      requestedViewport: { offsetX: 1, offsetY: 2, zoom: 1.25 },
    }, makeSource());
    const second = await buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
      requestedViewport: { zoom: 1.25, offsetY: 2, offsetX: 1 },
    }, makeSource({
      version: makeVersion({
        file: {
          ...makeVersion().file,
          url: '/api/serve-upload/uploads/another-private-name.png',
        },
        metadata: { prompt: 'different', provider: 'different', billing: 'private' },
      }),
    }));

    expect(second.snapshotDigest).toBe(first.snapshotDigest);
  });

  it.each([
    'pending-persist',
    'missing',
    'recovering',
    'unrecoverable',
  ] as const)('blocks the whole snapshot when media availability is %s', async availability => {
    const source = makeSource({
      version: makeVersion({ file: { ...makeVersion().file, availability } }),
    });
    await expect(buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
    }, source)).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
  });

  it.each([
    ['data URL', 'data:image/png;base64,AAAA', undefined],
    ['data URL even with an exact storage key', 'data:image/png;base64,AAAA', 'images/gateway/ready.png'],
    ['blob URL', 'blob:https://wujie.invalid/id', undefined],
    ['external URL', 'https://private.example/image.png', undefined],
    ['external URL even with an exact storage key', 'https://private.example/image.png', 'images/gateway/ready.png'],
    ['empty storage key without a controlled URL', 'https://private.example/image.png', '   '],
  ])('blocks the whole snapshot for %s', async (_label, url, storageKey) => {
    const source = makeSource({
      version: makeVersion({
        file: {
          ...makeVersion().file,
          url,
          ...(storageKey === undefined ? { storageKey: undefined } : { storageKey }),
        },
      }),
    });
    await expect(buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
    }, source)).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
  });

  it('rejects an unadapted canvas entity instead of silently omitting it', async () => {
    const unsupported = makePlacement({
      entityType: 'workflow-output',
    } as Partial<WorkspacePlacement>);
    await expect(buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
    }, makeSource({ placements: [makePlacement(), unsupported] }))).rejects.toMatchObject({
      code: 'CANVAS_SHARE_UNSUPPORTED_ELEMENT',
    });
  });

  it('returns no partial items when a later item is invalid', async () => {
    const source = makeSource({
      placements: [
        makePlacement(),
        makePlacement({
          id: 'placement-invalid',
          assetId: 'asset-missing',
          assetVersionId: 'version-missing',
        }),
      ],
    });
    await expect(buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
    }, source)).rejects.toBeInstanceOf(CanvasShareError);
  });

  it.each([
    {
      label: 'unsupported active placement',
      entityType: 'workflow-input',
      expectedCode: 'CANVAS_SHARE_UNSUPPORTED_ELEMENT',
      asset: makeAsset(),
      version: makeVersion(),
    },
    {
      label: 'active placement whose asset relationship is broken',
      entityType: 'canvas-image',
      expectedCode: 'CANVAS_SHARE_PROJECT_CONFLICT',
      asset: null,
      version: makeVersion(),
    },
  ])('does not let the production placement query hide $label', async ({
    entityType,
    expectedCode,
    asset,
    version,
  }) => {
    const placementRow = {
      id: 'placement-production-path',
      owner_id: 'owner-authoritative',
      project_id: 'project-authoritative',
      asset_id: 'asset-authoritative',
      asset_version_id: 'version-authoritative',
      workspace_kind: 'canvas',
      workspace_id: 'project-authoritative',
      entity_type: entityType,
      entity_id: 'entity-production-path',
      status: 'active',
      deleted_at: null,
      transform: {},
      metadata: {},
      created_at: new Date('2026-09-19T00:00:00.000Z'),
      updated_at: new Date('2026-09-19T00:00:00.000Z'),
    };
    const query = vi.fn(async (text: string) => {
      const legacyFilteringQuery = text.includes('JOIN wujie_assets')
        || text.includes("entity_type IN ('canvas-image', 'canvas-video')");
      return {
        rows: legacyFilteringQuery ? [] : [placementRow],
        rowCount: legacyFilteringQuery ? 0 : 1,
      };
    });
    const storage = createAssetStorageTransaction({ query } as never);

    await expect(buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
    }, {
      readProjectRevision: async () => 41,
      listActiveCanvasPlacements: (ownerId, projectId) => (
        storage.listActiveCanvasPlacements(ownerId, projectId)
      ),
      findAsset: async () => asset,
      findVersion: async () => version,
      getMediaDescriptor: async candidate => ({
        assetVersionId: candidate.id,
        assetKind: 'image',
        mimeType: 'image/png',
        byteSize: 128,
        width: 640,
        height: 480,
        checksum: null,
        source: {
          kind: 's3',
          storageKey: 'images/gateway/ready.png',
          eTag: '"test-etag"',
          versionId: null,
        },
      }),
    })).rejects.toMatchObject({ code: expectedCode });
  });

  it('keeps production placement enumeration stable for multiple active rows', async () => {
    const createdAt = new Date('2026-09-19T00:00:00.000Z');
    const placementRow = (id: string) => ({
      id,
      owner_id: 'owner-authoritative',
      project_id: 'project-authoritative',
      asset_id: `asset-${id}`,
      asset_version_id: `version-${id}`,
      workspace_kind: 'canvas',
      workspace_id: 'project-authoritative',
      entity_type: 'canvas-image',
      entity_id: `entity-${id}`,
      status: 'active',
      deleted_at: null,
      transform: {},
      metadata: {},
      created_at: createdAt,
      updated_at: createdAt,
    });
    const query = vi.fn(async (_text: string) => ({
      rows: [placementRow('a'), placementRow('b')],
      rowCount: 2,
    }));
    const storage = createAssetStorageTransaction({ query } as never);

    await expect(storage.listActiveCanvasPlacements(
      'owner-authoritative',
      'project-authoritative',
    )).resolves.toMatchObject([{ id: 'a' }, { id: 'b' }]);
    expect(query.mock.calls[0]?.[0]).toContain(
      'ORDER BY placement.created_at, placement.id',
    );
  });

  it.each([
    ['missing exact object', null],
    ['wrong exact object size', {
      byteSize: 127,
      contentType: 'image/png',
      eTag: '"wrong-size"',
      versionId: null,
    }],
    ['no usable exact object identity', {
      byteSize: 128,
      contentType: 'image/png',
      eTag: null,
      versionId: null,
    }],
  ])('blocks snapshot creation for an S3 object with %s', async (_label, inspected) => {
    const source = makeSource();
    source.getMediaDescriptor = (version, kind) => getManagedAssetMediaDescriptor(
      version,
      kind,
      {},
      { inspectS3Exact: async () => inspected } as never,
    );

    await expect(buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
    }, source)).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
  });

  it('blocks a ready local URL when the verified data-root file is missing', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-missing-'));
    temporaryDirectories.push(dataRoot);
    const source = makeSource({
      version: makeVersion({
        file: {
          url: '/api/serve-upload/uploads/missing.png',
          availability: 'ready',
          mimeType: 'image/png',
          byteSize: 10,
        },
      }),
    });
    source.getMediaDescriptor = (version, kind) => (
      getManagedAssetMediaDescriptor(version, kind, { dataRoot })
    );

    await expect(buildCanvasShareSnapshot({
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
    }, source)).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
  });
});

describe('controlled managed-media reader', () => {
  it('reads only a resolved data-root file and enforces an inclusive byte range', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-media-'));
    temporaryDirectories.push(dataRoot);
    const filePath = path.join(dataRoot, 'uploads', 'sample.png');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from([0, 1, 2, 3, 4, 5]));
    const version = makeVersion({
      file: {
        url: '/api/serve-upload/uploads/sample.png',
        availability: 'ready',
        mimeType: 'image/png',
        byteSize: 6,
      },
    });

    const result = await readManagedAssetVersionBytes(version, 'image', {
      dataRoot,
      range: { start: 2, end: 4 },
    });

    expect([...result.bytes]).toEqual([2, 3, 4]);
    expect(result).toMatchObject({
      mimeType: 'image/png',
      totalBytes: 6,
      range: { start: 2, end: 4 },
    });
  });

  it('rejects traversal, MIME mismatches, oversized files, and invalid ranges', async () => {
    await expect(getManagedAssetMediaDescriptor(makeVersion({
      file: {
        url: '/api/serve-upload/uploads/%2e%2e/private.png',
        availability: 'ready',
        mimeType: 'image/png',
        byteSize: 10,
      },
    }), 'image')).rejects.toBeInstanceOf(CanvasShareError);
    await expect(getManagedAssetMediaDescriptor(makeVersion({
      file: {
        url: '/api/serve-upload/uploads/file.txt',
        storageKey: 'images/gateway/file.txt',
        availability: 'ready',
        mimeType: 'text/plain',
        byteSize: 10,
      },
    }), 'image')).rejects.toBeInstanceOf(CanvasShareError);
    await expect(getManagedAssetMediaDescriptor(makeVersion({
      file: {
        url: '/api/serve-upload/uploads/huge.png',
        storageKey: 'images/gateway/huge.png',
        availability: 'ready',
        mimeType: 'image/png',
        byteSize: 33 * 1024 * 1024,
      },
    }), 'image')).rejects.toBeInstanceOf(CanvasShareError);
    await expect(readManagedAssetVersionBytes(makeVersion(), 'image', {
      range: { start: 5, end: 4 },
    })).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
  });

  it('rejects a managed local symlink that resolves outside the data root', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-root-'));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-outside-'));
    temporaryDirectories.push(dataRoot, outsideRoot);
    const outsideFile = path.join(outsideRoot, 'private.png');
    const linkedFile = path.join(dataRoot, 'uploads', 'linked.png');
    await writeFile(outsideFile, Buffer.from([1, 2, 3]));
    await mkdir(path.dirname(linkedFile), { recursive: true });
    await symlink(outsideFile, linkedFile, 'file');

    await expect(readManagedAssetVersionBytes(makeVersion({
      file: {
        url: '/api/serve-upload/uploads/linked.png',
        availability: 'ready',
        mimeType: 'image/png',
        byteSize: 3,
      },
    }), 'image', { dataRoot })).rejects.toMatchObject({
      code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE',
    });
  });

  it('rejects a local file when the opened handle identity differs from the verified path', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-identity-root-'));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-identity-outside-'));
    temporaryDirectories.push(dataRoot, outsideRoot);
    const managedFile = path.join(dataRoot, 'uploads', 'identity.png');
    const racedFile = path.join(outsideRoot, 'replacement.png');
    await mkdir(path.dirname(managedFile), { recursive: true });
    await writeFile(managedFile, Buffer.from([1, 2, 3]));
    await writeFile(racedFile, Buffer.from([4, 5, 6]));

    await expect(readManagedAssetVersionBytes(makeVersion({
      file: {
        url: '/api/serve-upload/uploads/identity.png',
        availability: 'ready',
        mimeType: 'image/png',
        byteSize: 3,
      },
    }), 'image', { dataRoot }, {
      openLocal: () => open(racedFile, 'r'),
      realpathLocal: realpath,
      statLocal: (filePath: string) => stat(filePath, { bigint: true }),
    } as never)).rejects.toMatchObject({
      code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE',
    });
  });

  it('uses an exact S3 byte range and permits a bounded full image above 16 MiB', async () => {
    const byteSize = 20 * 1024 * 1024;
    const bytes = Buffer.alloc(byteSize, 7);
    const inspectS3Exact = vi.fn(async () => ({
      byteSize,
      contentType: 'image/png',
      eTag: '"image-etag"',
      versionId: 'image-version',
    }));
    const readS3RangeExact = vi.fn(async () => ({ bytes, totalBytes: byteSize }));

    const result = await readManagedAssetVersionBytes(makeVersion({
      file: {
        url: '/api/serve-upload/uploads/large.png',
        storageKey: 'images/gateway/large.png',
        availability: 'ready',
        mimeType: 'image/png',
        byteSize,
      },
    }), 'image', {}, {
      inspectS3Exact,
      readS3RangeExact,
    } as never);

    expect(result.bytes.byteLength).toBe(byteSize);
    expect(readS3RangeExact).toHaveBeenCalledWith(
      'images/gateway/large.png',
      { start: 0, end: byteSize - 1 },
      expect.objectContaining({
        expectedTotalBytes: byteSize,
        maxBytes: byteSize,
        eTag: '"image-etag"',
        versionId: 'image-version',
      }),
    );
  });

  it('caps concurrent video reads before calling the exact-key reader', async () => {
    let releaseReads: (() => void) | undefined;
    const blocked = new Promise<void>(resolve => { releaseReads = resolve; });
    const inspectS3Exact = vi.fn(async () => ({
      byteSize: 1,
      contentType: 'video/mp4',
      eTag: '"video-etag"',
      versionId: null,
    }));
    const readS3RangeExact = vi.fn(async () => {
      await blocked;
      return { bytes: Buffer.from([1]), totalBytes: 1 };
    });
    const version = makeVersion({
      file: {
        url: '/api/serve-upload/video/task/result.mp4',
        storageKey: 'images/video/task/result.mp4',
        availability: 'ready',
        mimeType: 'video/mp4',
        byteSize: 1,
      },
    });
    const reads = Array.from({ length: 4 }, () => readManagedAssetVersionBytes(
      version,
      'video',
      {},
      { inspectS3Exact, readS3RangeExact } as never,
    ));
    await vi.waitFor(() => expect(readS3RangeExact).toHaveBeenCalledTimes(4));

    await expect(readManagedAssetVersionBytes(version, 'video', {}, {
      inspectS3Exact,
      readS3RangeExact,
    } as never)).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_UNAVAILABLE' });
    releaseReads?.();
    await expect(Promise.all(reads)).resolves.toHaveLength(4);
  });
});

describe('canvas-share service creation boundary', () => {
  it('ignores body-supplied authority and returns the raw token only in the create result', async () => {
    const rawToken = 'raw-token-only-for-success-result';
    const tokenHash = 'a'.repeat(64);
    const createSnapshotAndInsert = vi.fn(async (input) => {
      const record: CanvasShareRecord = {
        id: input.id,
        ownerId: input.ownerId,
        projectId: input.projectId,
        projectRevision: 7,
        tokenHash: input.tokenHash,
        title: input.title,
        status: 'active',
        expiresAt: input.expiresAt,
        allowDownload: input.allowDownload,
        viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
        snapshotDigest: 'd'.repeat(64),
        viewCount: 0,
        lastViewedAt: null,
        createdAt: input.createdAt,
        revokedAt: null,
      };
      const items: CanvasShareItemRecord[] = [];
      return { record, items };
    });

    const result = await createCanvasShare({
      actorUserId: 'owner-authoritative',
      projectId: 'project-authoritative',
      title: '  发布快照  ',
      requestedViewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      ownerId: 'owner-from-body',
      projectRevision: 999,
      assetVersionId: 'version-from-body',
      url: 'https://attacker.example/file.png',
    } as Parameters<typeof createCanvasShare>[0], {
      createToken: () => rawToken,
      hashToken: () => tokenHash,
      createId: () => 'share-id',
      now: () => new Date('2026-09-19T00:00:00.000Z'),
      createSnapshotAndInsert,
    });

    expect(createSnapshotAndInsert).toHaveBeenCalledWith({
      id: 'share-id',
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
      tokenHash,
      title: '发布快照',
      expiresAt: '2026-10-19T00:00:00.000Z',
      allowDownload: false,
      requestedViewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      createdAt: '2026-09-19T00:00:00.000Z',
    });
    expect(result).toMatchObject({ token: rawToken, itemCount: 0 });
    expect(JSON.stringify(createSnapshotAndInsert.mock.calls)).not.toContain(
      'https://attacker.example',
    );
    expect(JSON.stringify(result.share)).not.toContain(rawToken);
  });

  it('owns expiry and immutable policy lifecycle without changing snapshot fields', async () => {
    const active: CanvasShareRecord = {
      id: 'share-active',
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
      projectRevision: 7,
      tokenHash: 'a'.repeat(64),
      title: '发布快照',
      status: 'active',
      expiresAt: '2026-09-20T00:00:00.000Z',
      allowDownload: false,
      viewport: { offsetX: 1, offsetY: 2, zoom: 1 },
      snapshotDigest: 'd'.repeat(64),
      viewCount: 0,
      lastViewedAt: null,
      createdAt: '2026-09-19T00:00:00.000Z',
      revokedAt: null,
    };
    const expired = await listCanvasShares({
      actorUserId: active.ownerId,
      projectId: active.projectId,
    }, {
      now: () => new Date('2026-09-21T00:00:00.000Z'),
      list: async () => [active],
    });
    expect(expired[0]).toMatchObject({ status: 'expired', snapshotDigest: active.snapshotDigest });
    expect(active.status).toBe('active');

    const update = vi.fn(async (_ownerId, _shareId, patch) => ({
      ...active,
      ...patch,
    }));
    const patched = await patchCanvasSharePolicy({
      actorUserId: active.ownerId,
      shareId: active.id,
      patch: { allowDownload: true },
    }, {
      now: () => new Date('2026-09-19T12:00:00.000Z'),
      find: async () => ({ record: active, items: [] }),
      update,
    });
    expect(update).toHaveBeenCalledWith(active.ownerId, active.id, { allowDownload: true });
    expect(patched).toMatchObject({
      allowDownload: true,
      projectRevision: active.projectRevision,
      viewport: active.viewport,
      snapshotDigest: active.snapshotDigest,
    });
  });

  it('never reactivates expired shares and makes revocation one-way and idempotent', async () => {
    const record: CanvasShareRecord = {
      id: 'share-lifecycle',
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
      projectRevision: 7,
      tokenHash: 'b'.repeat(64),
      title: '生命周期',
      status: 'active',
      expiresAt: '2026-09-20T00:00:00.000Z',
      allowDownload: false,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      snapshotDigest: 'e'.repeat(64),
      viewCount: 0,
      lastViewedAt: null,
      createdAt: '2026-09-19T00:00:00.000Z',
      revokedAt: null,
    };
    const update = vi.fn();
    await expect(patchCanvasSharePolicy({
      actorUserId: record.ownerId,
      shareId: record.id,
      patch: { expiresAt: null },
    }, {
      now: () => new Date('2026-09-21T00:00:00.000Z'),
      find: async () => ({ record, items: [] }),
      update,
    })).rejects.toMatchObject({ code: 'CANVAS_SHARE_POLICY_CONFLICT' });
    expect(update).not.toHaveBeenCalled();

    const revokedRecord: CanvasShareRecord = {
      ...record,
      status: 'revoked',
      revokedAt: '2026-09-19T12:00:00.000Z',
    };
    const revoke = vi.fn();
    await expect(revokeCanvasShare({
      actorUserId: record.ownerId,
      shareId: record.id,
    }, {
      now: () => new Date('2026-09-19T13:00:00.000Z'),
      find: async () => ({ record: revokedRecord, items: [] }),
      revoke,
    })).resolves.toEqual(revokedRecord);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('returns the revoked record to both concurrent revoke callers', async () => {
    const active: CanvasShareRecord = {
      id: 'share-concurrent-revoke',
      ownerId: 'owner-authoritative',
      projectId: 'project-authoritative',
      projectRevision: 7,
      tokenHash: 'b'.repeat(64),
      title: '并发撤销',
      status: 'active',
      expiresAt: null,
      allowDownload: false,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      snapshotDigest: 'e'.repeat(64),
      viewCount: 0,
      lastViewedAt: null,
      createdAt: '2026-09-19T00:00:00.000Z',
      revokedAt: null,
    };
    const revoked: CanvasShareRecord = {
      ...active,
      status: 'revoked',
      revokedAt: '2026-09-19T13:00:00.000Z',
    };
    let persisted = active;
    let initialReads = 0;
    let releaseInitialReads: (() => void) | undefined;
    const bothReadActive = new Promise<void>(resolve => { releaseInitialReads = resolve; });
    const find = vi.fn(async () => {
      if (initialReads < 2) {
        initialReads += 1;
        if (initialReads === 2) releaseInitialReads?.();
        await bothReadActive;
        return { record: active, items: [] };
      }
      return { record: persisted, items: [] };
    });
    let revokeCalls = 0;
    const revoke = vi.fn(async () => {
      revokeCalls += 1;
      if (revokeCalls === 1) {
        persisted = revoked;
        return revoked;
      }
      return null;
    });
    const dependencies = {
      now: () => new Date('2026-09-19T13:00:00.000Z'),
      find,
      revoke,
    };

    await expect(Promise.all([
      revokeCanvasShare({ actorUserId: active.ownerId, shareId: active.id }, dependencies),
      revokeCanvasShare({ actorUserId: active.ownerId, shareId: active.id }, dependencies),
    ])).resolves.toEqual([revoked, revoked]);
    expect(find).toHaveBeenCalledTimes(3);
  });

  it('returns only controlled public paths and safe frozen fields after lifecycle checks', async () => {
    const token = 'A'.repeat(43);
    const record: CanvasShareRecord = {
      id: 'share-public',
      ownerId: 'owner-private',
      projectId: 'project-private',
      projectRevision: 7,
      tokenHash: 'c'.repeat(64),
      title: '公开快照',
      status: 'active',
      expiresAt: null,
      allowDownload: false,
      viewport: { offsetX: 1, offsetY: 2, zoom: 1 },
      snapshotDigest: 'f'.repeat(64),
      viewCount: 0,
      lastViewedAt: null,
      createdAt: '2026-09-19T00:00:00.000Z',
      revokedAt: null,
    };
    const item: CanvasShareItemRecord = {
      id: 'item-public',
      shareId: record.id,
      placementId: 'placement-private',
      assetId: 'asset-private',
      assetVersionId: 'version-private',
      entityType: 'canvas-image',
      assetKind: 'image',
      transform: { x: 1, y: 2, width: 3, height: 4, rotation: 0, zIndex: 0 },
      displayMetadata: { label: '安全名称' },
      mimeType: 'image/png',
      width: 3,
      height: 4,
      byteSize: 10,
      checksum: 'checksum-private',
      availability: 'ready',
      sortOrder: 0,
      createdAt: record.createdAt,
    };
    const validRecord = {
      ...record,
      snapshotDigest: computeCanvasShareSnapshotDigestForRead(record, [item]),
    };
    const incrementView = vi.fn(async () => ({ ...validRecord, viewCount: 1 }));
    const result = await readPublicCanvasShare(token, {
      now: () => new Date('2026-09-19T12:00:00.000Z'),
      hashToken: () => record.tokenHash,
      withActiveSnapshot: async (_tokenHash, _accessedAt, operation) => operation({
        snapshot: { record: validRecord, items: [item] },
        expectedItemCount: 1,
        incrementView,
        findAsset: vi.fn(),
        findVersion: vi.fn(),
      }),
    });

    const scopedItemRef = createCanvasSharePublicItemRef(record.tokenHash, item.id);
    expect(result.items[0]).toMatchObject({
      itemRef: scopedItemRef,
      mediaPath: `/api/public/canvas-shares/${token}/media/${scopedItemRef}`,
    });
    expect(result.items[0]).not.toHaveProperty('downloadPath');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(record.ownerId);
    expect(serialized).not.toContain(record.projectId);
    expect(serialized).not.toContain(item.assetId);
    expect(serialized).not.toContain(item.assetVersionId);
    expect(serialized).not.toContain(item.placementId);
    expect(serialized).not.toContain(item.checksum!);
    expect(incrementView).toHaveBeenCalledWith();
  });
});
