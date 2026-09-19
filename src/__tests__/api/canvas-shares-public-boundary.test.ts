import { createHash } from 'node:crypto';

import { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CanvasShareItemRecord,
  CanvasShareRecord,
} from '@/lib/canvas-share/types';

const database = vi.hoisted(() => {
  const state: {
    shareRow: Record<string, unknown> | null;
    itemRow: Record<string, unknown> | null;
    queries: string[];
    activeLeases: number;
    barrierTarget: number;
    barrierArrivals: number;
    barrierWaiters: Array<() => void>;
    globalPoolQueries: number;
  } = {
    shareRow: null,
    itemRow: null,
    queries: [],
    activeLeases: 0,
    barrierTarget: 0,
    barrierArrivals: 0,
    barrierWaiters: [],
    globalPoolQueries: 0,
  };
  const runQuery = async (queryText: string): Promise<{ rows: unknown[] }> => {
    const normalized = queryText.replace(/\s+/gu, ' ').trim();
    state.queries.push(normalized);
    if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
      return { rows: [] };
    }
    if (normalized.includes('FROM wujie_canvas_shares share_record')) {
      return { rows: state.shareRow ? [state.shareRow] : [] };
    }
    if (normalized.includes('FROM wujie_canvas_share_items')) {
      if (state.barrierTarget > 0) {
        state.barrierArrivals += 1;
        if (state.barrierArrivals === state.barrierTarget) {
          for (const releaseBarrier of state.barrierWaiters.splice(0)) releaseBarrier();
        } else {
          await new Promise<void>(resolve => state.barrierWaiters.push(resolve));
        }
      }
      return { rows: state.itemRow ? [state.itemRow] : [] };
    }
    if (normalized.includes('INSERT INTO wujie_canvas_share_rate_windows')) {
      return { rows: [{ attempt_count: 1 }] };
    }
    if (normalized.startsWith('UPDATE wujie_canvas_shares SET view_count')) {
      return {
        rows: state.shareRow ? [{ ...state.shareRow, view_count: 1 }] : [],
      };
    }
    throw new Error(`Unexpected boundary SQL: ${normalized}`);
  };
  const transactionQuery = vi.fn(runQuery);
  const release = vi.fn();
  const connect = vi.fn(async () => {
    if (state.activeLeases >= 5) throw new Error('BOUNDARY_POOL_MAX_EXCEEDED');
    state.activeLeases += 1;
    let released = false;
    return {
      query: transactionQuery,
      release: () => {
        if (released) return;
        released = true;
        state.activeLeases -= 1;
        release();
      },
    };
  });
  const poolQuery = vi.fn(async (queryText: string) => {
    state.globalPoolQueries += 1;
    if (state.activeLeases >= 5) throw new Error('BOUNDARY_POOL_STARVATION');
    return runQuery(queryText);
  });
  const pool = {
    connect,
    query: poolQuery,
  } as unknown as Pool;
  return { state, transactionQuery, poolQuery, release, connect, pool };
});

vi.mock('@/lib/db-client', () => ({
  getPool: () => database.pool,
}));

import { GET as getPublicShare } from '@/app/api/public/canvas-shares/[token]/route';
import {
  computeCanvasShareSnapshotDigestForRead,
} from '@/lib/canvas-share/service';
import { createCanvasSharePublicItemRef } from '@/lib/canvas-share/public-projection';
import { enforceCanvasSharePublicRateLimit } from '@/lib/canvas-share/public-rate-limit';
import { withActiveCanvasShareMediaSnapshot } from '@/lib/canvas-share/storage';

const rawToken = 'B'.repeat(43);
const tokenDigest = createHash('sha256').update(rawToken).digest('hex');
const createdAt = '2026-09-19T00:00:00.000Z';

function routeContext(): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token: rawToken }) };
}

describe('canvas-share public route/service/storage boundary', () => {
  beforeEach(() => {
    vi.stubEnv('WUJIE_CANVAS_SHARE_ENABLED', 'true');
    database.state.queries.length = 0;
    database.state.activeLeases = 0;
    database.state.barrierTarget = 0;
    database.state.barrierArrivals = 0;
    database.state.barrierWaiters.length = 0;
    database.state.globalPoolQueries = 0;
    database.transactionQuery.mockClear();
    database.poolQuery.mockClear();
    database.release.mockClear();
    database.connect.mockClear();

    const item: CanvasShareItemRecord = {
      id: 'boundary-item-private',
      shareId: 'boundary-share-private',
      placementId: 'boundary-placement-private',
      assetId: 'boundary-asset-private',
      assetVersionId: 'boundary-version-private',
      entityType: 'canvas-image',
      assetKind: 'image',
      transform: { x: 1, y: 2, width: 3, height: 4, rotation: 0, zIndex: 0 },
      displayMetadata: { label: '边界测试' },
      mimeType: 'image/png',
      width: 3,
      height: 4,
      byteSize: 4,
      checksum: 'boundary-checksum-private',
      availability: 'ready',
      sortOrder: 0,
      createdAt,
    };
    const baseRecord: CanvasShareRecord = {
      id: item.shareId,
      ownerId: 'boundary-owner-private',
      projectId: 'boundary-project-private',
      projectRevision: 9,
      tokenHash: tokenDigest,
      title: '真实边界画布',
      status: 'active',
      expiresAt: '2026-10-19T00:00:00.000Z',
      allowDownload: false,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      snapshotDigest: '',
      viewCount: 0,
      lastViewedAt: null,
      createdAt,
      revokedAt: null,
    };
    const record: CanvasShareRecord = {
      ...baseRecord,
      snapshotDigest: computeCanvasShareSnapshotDigestForRead(baseRecord, [item]),
    };
    database.state.shareRow = {
      id: record.id,
      owner_id: record.ownerId,
      project_id: record.projectId,
      project_revision: record.projectRevision,
      token_hash: record.tokenHash,
      title: record.title,
      status: record.status,
      expires_at: record.expiresAt,
      allow_download: record.allowDownload,
      viewport: record.viewport,
      snapshot_digest: record.snapshotDigest,
      view_count: record.viewCount,
      last_viewed_at: record.lastViewedAt,
      created_at: record.createdAt,
      revoked_at: record.revokedAt,
      item_count: 1,
    };
    database.state.itemRow = {
      id: item.id,
      share_id: item.shareId,
      placement_id: item.placementId,
      asset_id: item.assetId,
      asset_version_id: item.assetVersionId,
      entity_type: item.entityType,
      asset_kind: item.assetKind,
      transform: item.transform,
      display_metadata: item.displayMetadata,
      mime_type: item.mimeType,
      width: item.width,
      height: item.height,
      byte_size: item.byteSize,
      checksum: item.checksum,
      availability: item.availability,
      sort_order: item.sortOrder,
      created_at: item.createdAt,
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('crosses the real route, service, and storage boundary before rate limiting', async () => {
    const response = await getPublicShare(
      new NextRequest(`http://localhost/api/public/canvas-shares/${rawToken}`),
      routeContext(),
    );
    const body = await response.json() as Record<string, unknown>;
    const scopedItemRef = createCanvasSharePublicItemRef(
      tokenDigest,
      'boundary-item-private',
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      title: '真实边界画布',
      items: [{
        itemRef: scopedItemRef,
        mediaPath: `media/${scopedItemRef}`,
      }],
    });
    expect(JSON.stringify(body)).not.toContain(rawToken);
    expect(database.state.queries).toEqual(expect.arrayContaining([
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('FROM wujie_canvas_share_items'),
      expect.stringContaining('INSERT INTO wujie_canvas_share_rate_windows'),
      expect.stringContaining('UPDATE wujie_canvas_shares SET view_count'),
    ]));
    const lifecycleIndex = database.state.queries.findIndex(query => query.includes('FOR UPDATE'));
    const rateIndex = database.state.queries.findIndex(
      query => query.includes('INSERT INTO wujie_canvas_share_rate_windows'),
    );
    const viewIndex = database.state.queries.findIndex(
      query => query.startsWith('UPDATE wujie_canvas_shares SET view_count'),
    );
    expect(lifecycleIndex).toBeGreaterThan(-1);
    expect(rateIndex).toBeGreaterThan(lifecycleIndex);
    expect(viewIndex).toBeGreaterThan(rateIndex);
    expect(database.release).toHaveBeenCalledOnce();
  });

  it('reuses each locked transaction client at max pool concurrency', async () => {
    database.state.barrierTarget = 5;

    const responses = await Promise.all(Array.from({ length: 5 }, () => getPublicShare(
      new NextRequest(`http://localhost/api/public/canvas-shares/${rawToken}`),
      routeContext(),
    )));

    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(database.connect).toHaveBeenCalledTimes(5);
    expect(database.release).toHaveBeenCalledTimes(5);
    expect(database.state.globalPoolQueries).toBe(0);
  });

  it('rolls back the transaction-scoped rate write if locked media work later fails', async () => {
    const mediaFailure = new Error('managed media read failed');

    await expect(withActiveCanvasShareMediaSnapshot(
      tokenDigest,
      '2026-09-19T12:00:00.000Z',
      async context => {
        await enforceCanvasSharePublicRateLimit({
          tokenDigest,
          itemScope: 'media:boundary-item',
          ipAddress: 'unknown',
          routeBucket: 'media',
          now: new Date('2026-09-19T12:00:00.000Z'),
          database: context.database,
        });
        throw mediaFailure;
      },
      database.pool,
    )).rejects.toBe(mediaFailure);

    const lockIndex = database.state.queries.findIndex(query => query.includes('FOR SHARE'));
    const rateIndex = database.state.queries.findIndex(
      query => query.includes('INSERT INTO wujie_canvas_share_rate_windows'),
    );
    const rollbackIndex = database.state.queries.indexOf('ROLLBACK');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(rateIndex).toBeGreaterThan(lockIndex);
    expect(rollbackIndex).toBeGreaterThan(rateIndex);
    expect(database.state.queries).not.toContain('COMMIT');
    expect(database.state.globalPoolQueries).toBe(0);
    expect(database.release).toHaveBeenCalledOnce();
  });
});
