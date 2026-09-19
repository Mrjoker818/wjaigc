import { describe, expect, it, vi } from 'vitest';

import { patchCanvasSharePolicy } from '@/lib/canvas-share/service';
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

describe('canvas-share owner lifecycle service', () => {
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
