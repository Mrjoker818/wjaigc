import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

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

  it('keeps project loading available while only the new thumbnail table migration is pending', async () => {
    mocks.query
      .mockRejectedValueOnce(Object.assign(
        new Error('relation "wujie_asset_thumbnail_variants" does not exist'),
        { code: '42P01' },
      ))
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
