import { describe, expect, it, vi } from 'vitest';

import type { Asset, AssetVersion, WorkspacePlacement } from '@/lib/asset-core/types';
import {
  inspectCanvasSharePreflightInTransaction,
  patchCanvasSharePolicy,
  preflightCanvasShare,
} from '@/lib/canvas-share/service';
import type { AssetCoreSqlTransaction } from '@/lib/asset-core/storage';
import {
  buildCanvasShareSnapshot,
  inspectCanvasShareReadiness,
  type CanvasShareSnapshotSource,
} from '@/lib/canvas-share/snapshot';
import { listCanvasShares as listCanvasSharesFromStorage } from '@/lib/canvas-share/storage';
import type { CanvasShareRecord } from '@/lib/canvas-share/types';

const active: CanvasShareRecord = {
  id: 'share-policy',
  ownerId: 'owner-1',
  projectId: 'project-1',
  projectRevision: 1,
  tokenHash: 'a'.repeat(64),
  title: 'Policy race',
  status: 'active',
  expiresAt: '2099-10-19T00:00:00.000Z',
  allowDownload: false,
  viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
  snapshotDigest: 'b'.repeat(64),
  viewCount: 0,
  lastViewedAt: null,
  createdAt: '2026-09-19T00:00:00.000Z',
  revokedAt: null,
};

function asset(): Asset {
  return {
    id: 'asset-private',
    ownerId: 'owner-1',
    projectId: 'project-1',
    kind: 'image',
    status: 'active',
    currentVersionId: 'version-private',
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
  };
}

function version(availability: AssetVersion['file']['availability'] = 'ready'): AssetVersion {
  return {
    id: 'version-private',
    assetId: 'asset-private',
    ownerId: 'owner-1',
    projectId: 'project-1',
    file: {
      url: 'https://private.example/media.png',
      storageKey: 'private/path/media.png',
      availability,
      mimeType: 'image/png',
      byteSize: 128,
      width: 640,
      height: 480,
      checksum: 'private-checksum',
    },
    parentVersionIds: [],
    metadata: { providerError: 'private provider failure' },
    createdAt: '2026-09-19T00:00:00.000Z',
  };
}

function placement(overrides: Partial<WorkspacePlacement> = {}): WorkspacePlacement {
  return {
    id: 'placement-private',
    ownerId: 'owner-1',
    projectId: 'project-1',
    assetId: 'asset-private',
    assetVersionId: 'version-private',
    workspace: 'canvas',
    workspaceId: 'project-1',
    entityType: 'canvas-image',
    entityId: 'entity-private',
    status: 'active',
    deletedAt: null,
    transform: { x: 1, y: 2, width: 640, height: 480, rotation: 0, zIndex: 0 },
    metadata: {
      label: '  安全显示名  ',
      sourceUrl: 'https://private.example/source.png',
      internalId: 'private-metadata-id',
    },
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
  } as WorkspacePlacement;
}

function source(input: {
  placements?: WorkspacePlacement[];
  availability?: AssetVersion['file']['availability'];
} = {}): CanvasShareSnapshotSource {
  return {
    readProjectRevision: async () => 12,
    listActiveCanvasPlacements: async () => input.placements ?? [placement()],
    findAsset: async () => asset(),
    findVersion: async () => version(input.availability),
    getMediaDescriptor: async candidate => ({
      assetVersionId: candidate.id,
      assetKind: 'image',
      mimeType: 'image/png',
      byteSize: 128,
      width: 640,
      height: 480,
      checksum: 'private-checksum',
      source: {
        kind: 's3',
        storageKey: 'private/path/media.png',
        eTag: 'private-etag',
        versionId: null,
      },
    }),
  };
}

describe('canvas-share owner lifecycle service', () => {
  it('reads the canonical project name through the owner-scoped preflight transaction', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        if (sql.includes('SELECT name') && sql.includes('FROM wujie_projects')) {
          return { rows: [{ name: '服务端规范项目名' }], rowCount: 1 };
        }
        if (sql.includes('FROM wujie_user_data')) {
          return { rows: [{ data_value: 12 }], rowCount: 1 };
        }
        if (sql.includes('FROM wujie_workspace_placements placement')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as AssetCoreSqlTransaction;

    const result = await inspectCanvasSharePreflightInTransaction({
      ownerId: 'owner-1',
      projectId: 'project-1',
      requestedViewport: { offsetX: 3, offsetY: 4, zoom: 2 },
    }, client);

    expect(result).toEqual({
      projectName: '服务端规范项目名',
      projectRevision: 12,
      itemCount: 0,
      viewport: { offsetX: 3, offsetY: 4, zoom: 2 },
      readiness: { ready: true, failures: [] },
    });
    expect(queries).toContainEqual(expect.objectContaining({
      sql: expect.stringMatching(/SELECT name[\s\S]*FROM wujie_projects/iu),
      values: ['project-1', 'owner-1', 'active'],
    }));
  });

  it('keeps an authorized empty-name project shareable with a safe server fallback', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT name') && sql.includes('FROM wujie_projects')) {
          return { rows: [{ name: '' }], rowCount: 1 };
        }
        if (sql.includes('FROM wujie_user_data')) {
          return { rows: [{ data_value: 12 }], rowCount: 1 };
        }
        if (sql.includes('FROM wujie_workspace_placements placement')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as AssetCoreSqlTransaction;

    await expect(inspectCanvasSharePreflightInTransaction({
      ownerId: 'owner-1',
      projectId: 'project-empty-name',
    }, client)).resolves.toEqual({
      projectName: '未命名项目',
      projectRevision: 12,
      itemCount: 0,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      readiness: { ready: true, failures: [] },
    });
  });

  it('runs production preflight service through real snapshot readiness inspection', async () => {
    const authoritativeSource = source();

    const result = await preflightCanvasShare({
      actorUserId: 'owner-1',
      projectId: 'project-1',
      requestedViewport: { offsetX: Number.NaN, offsetY: -0, zoom: 999 },
    }, {
      inspect: async input => ({
        projectName: '服务端规范项目名',
        ...await inspectCanvasShareReadiness(input, authoritativeSource),
      }),
    });

    expect(result).toEqual({
      projectName: '服务端规范项目名',
      projectRevision: 12,
      itemCount: 1,
      viewport: { offsetX: 0, offsetY: 0, zoom: 5 },
      readiness: { ready: true, failures: [] },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /asset-private|version-private|placement-private|private\.example|private\/path/iu,
    );
  });

  it('returns safe non-ready details while creation remains independently fail-closed', async () => {
    const pendingSource = source({
      availability: 'pending-persist',
      placements: [
        placement(),
        placement({
          id: 'unsupported-placement-private',
          entityType: 'canvas-shape' as WorkspacePlacement['entityType'],
          metadata: {
            label: '不支持元素',
            sourceUrl: 'https://private.example/unsupported.png',
          },
        }),
      ],
    });

    const result = await preflightCanvasShare({
      actorUserId: 'owner-1',
      projectId: 'project-1',
    }, {
      inspect: async input => ({
        projectName: '服务端规范项目名',
        ...await inspectCanvasShareReadiness(input, pendingSource),
      }),
    });

    expect(result).toEqual({
      projectName: '服务端规范项目名',
      projectRevision: 12,
      itemCount: 2,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      readiness: {
        ready: false,
        failures: [{
          itemIndex: 0,
          display: { label: '安全显示名' },
          code: 'CANVAS_SHARE_MEDIA_NOT_READY',
          message: '画布中有媒体尚未就绪',
        }, {
          itemIndex: 1,
          display: { label: '不支持元素' },
          code: 'CANVAS_SHARE_UNSUPPORTED_ELEMENT',
          message: '画布包含暂不支持分享的内容',
        }],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /asset-private|version-private|placement-private|private\.example|provider|private\/path/iu,
    );
    await expect(buildCanvasShareSnapshot({
      ownerId: 'owner-1',
      projectId: 'project-1',
    }, pendingSource)).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
  });

  it('loads the authoritative snapshot item count in the owner list query', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: active.id,
        owner_id: active.ownerId,
        project_id: active.projectId,
        project_revision: active.projectRevision,
        token_hash: active.tokenHash,
        title: active.title,
        status: active.status,
        expires_at: active.expiresAt,
        allow_download: active.allowDownload,
        viewport: active.viewport,
        snapshot_digest: active.snapshotDigest,
        view_count: active.viewCount,
        last_viewed_at: active.lastViewedAt,
        created_at: active.createdAt,
        revoked_at: active.revokedAt,
        item_count: '2',
      }],
    });

    const result = await listCanvasSharesFromStorage(
      active.ownerId,
      active.projectId,
      { query } as never,
    );

    expect(result).toEqual([expect.objectContaining({ id: active.id, itemCount: 2 })]);
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/count\(item\.id\)/iu), [
      active.ownerId,
      active.projectId,
    ]);
  });

  it('reports an explicit conflict when two policy updates race from the same state', async () => {
    let persisted = active;
    let reads = 0;
    let releaseReads: (() => void) | undefined;
    const bothRead = new Promise<void>(resolve => { releaseReads = resolve; });
    const find = async () => {
      const snapshot = persisted;
      reads += 1;
      if (reads === 2) releaseReads?.();
      await bothRead;
      return { record: snapshot, items: [] };
    };
    const updateIfCurrent = async (
      _ownerId: string,
      _shareId: string,
      patch: { expiresAt?: string | null; allowDownload?: boolean },
      expected: { expiresAt: string | null; allowDownload: boolean },
    ) => {
      if (
        persisted.expiresAt !== expected.expiresAt
        || persisted.allowDownload !== expected.allowDownload
      ) return null;
      persisted = { ...persisted, ...patch };
      return persisted;
    };
    const dependencies = {
      now: () => new Date('2026-09-19T01:00:00.000Z'),
      find,
      updateIfCurrent,
    };

    const results = await Promise.allSettled([
      patchCanvasSharePolicy({
        actorUserId: active.ownerId,
        shareId: active.id,
        patch: { allowDownload: true },
      }, dependencies as never),
      patchCanvasSharePolicy({
        actorUserId: active.ownerId,
        shareId: active.id,
        patch: { expiresAt: '2099-11-19T00:00:00.000Z' },
      }, dependencies as never),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'CANVAS_SHARE_POLICY_CONFLICT' },
    });
  });
});
