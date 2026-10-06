import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db-client', () => ({
  getPool: () => ({ query: mocks.query }),
}));

import { readAssetV3Projects } from '@/lib/asset-core/canvas-project-sync';
import type { Project } from '@/lib/user-types';

const project: Project = {
  id: 'project-1',
  userId: 'user-1',
  name: 'Project',
  createdAt: 1,
  updatedAt: 1,
  canvasImages: [],
  settings: {},
};

describe('asset thumbnail projection rollout', () => {
  beforeEach(() => mocks.query.mockReset());

  it.each(['image', 'video'] as const)('reads immutable %s pixels instead of placement or stale legacy dimensions', async kind => {
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: false }] }).mockResolvedValueOnce({ rows: [{
      project_id: 'project-1', entity_id: 'media-1', asset_id: 'asset-1', asset_version_id: 'version-1',
      placement_id: 'placement-1', asset_kind: kind, file_url: `/media/source.${kind === 'video' ? 'mp4' : 'png'}`,
      availability: 'ready', width: 720, height: 480,
      transform: { x: 10, y: 20, width: 420, height: 280, originalWidth: 999, originalHeight: 999 },
      metadata: { legacyImage: { originalWidth: 111, originalHeight: 111 } },
    }] });
    const [hydrated] = await readAssetV3Projects('user-1', [project]);
    expect(hydrated.canvasImages[0]).toMatchObject({
      width: 420, height: 280, originalWidth: 720, originalHeight: 480,
      assetVersionId: 'version-1', mediaType: kind,
    });
    expect(mocks.query.mock.calls[1][0]).toContain('version.width');
    expect(mocks.query.mock.calls[1][0]).toContain('version.height');
  });

  it('keeps the existing fallback for a legacy version with unknown source pixels', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: true }] }).mockResolvedValueOnce({ rows: [{
      project_id: 'project-1', entity_id: 'media-1', asset_id: 'asset-1', asset_version_id: 'version-1',
      placement_id: 'placement-1', asset_kind: 'video', file_url: '/media/source.mp4', availability: 'ready',
      width: null, height: null, transform: { width: 420, height: 280 }, metadata: {},
    }] });
    const [hydrated] = await readAssetV3Projects('user-1', [project]);
    expect(hydrated.canvasImages[0]).toMatchObject({ width: 420, height: 280, originalWidth: 420, originalHeight: 280 });
  });

  it('keeps project loading available while only the new thumbnail table migration is pending', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(readAssetV3Projects('user-1', [project])).resolves.toEqual([project]);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0][0]).toContain('wujie_asset_thumbnail_variants');
    expect(mocks.query.mock.calls[1][0]).not.toContain('wujie_asset_thumbnail_variants');
  });

  it('does not hide unrelated database failures', async () => {
    const failure = Object.assign(new Error('database connection lost'), { code: '08006' });
    mocks.query.mockRejectedValueOnce(failure);

    await expect(readAssetV3Projects('user-1', [project])).rejects.toBe(failure);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});
