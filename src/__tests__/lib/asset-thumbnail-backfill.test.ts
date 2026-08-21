import { describe, expect, it, vi } from 'vitest';

import {
  getAssetThumbnailBackfillStatus,
  previewAssetThumbnailBackfill,
  runAssetThumbnailBackfill,
  type ThumbnailBackfillDependencies,
  type ThumbnailBackfillStatus,
  type ThumbnailVariantTarget,
} from '@/lib/asset-core/thumbnail-backfill';

const target = (size: 256 | 512 = 512): ThumbnailVariantTarget => ({
  assetVersionId: 'version-a',
  assetId: 'asset-a',
  ownerId: 'owner-a',
  projectId: 'project-a',
  size,
  fileUrl: '/api/serve-upload/uploads/source.png',
  storageKey: null,
  recoverySourceUrl: null,
  leaseOwner: 'worker-a',
});

function dependencies(overrides: Partial<ThumbnailBackfillDependencies> = {}): ThumbnailBackfillDependencies {
  return {
    discover: vi.fn().mockResolvedValue(2),
    claim: vi.fn().mockResolvedValue([]),
    execute: vi.fn(),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
    status: vi.fn().mockResolvedValue({ pending: 0, processing: 0, ready: 0, failed: 0 }),
    createLeaseOwner: () => 'worker-a',
    now: () => new Date('2026-08-21T00:00:00.000Z'),
    ...overrides,
  };
}

describe('asset thumbnail backfill service', () => {
  it('previews missing variants without claiming or executing work', async () => {
    const deps = dependencies();

    const result = await previewAssetThumbnailBackfill({ limit: 25 }, deps);

    expect(deps.discover).toHaveBeenCalledWith({ dryRun: true, limit: 25 });
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      dryRun: true,
      discovered: 2,
      claimed: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it('claims a durable lease and settles each result through that lease owner', async () => {
    const targets = [target(256), { ...target(512), assetVersionId: 'version-b' }];
    const deps = dependencies({
      claim: vi.fn().mockResolvedValue(targets),
      execute: vi.fn()
        .mockResolvedValueOnce({
          fileUrl: '/api/serve-upload/thumbnails/version-a/256.webp',
          storageKey: 'thumbnails/version-a/256.webp',
          checksum: 'sha256:abc',
          mimeType: 'image/webp',
          byteSize: 123,
          width: 256,
          height: 192,
        })
        .mockRejectedValueOnce(new Error('storage unavailable')),
    });

    const result = await runAssetThumbnailBackfill({ limit: 2, leaseMs: 60_000 }, deps);

    expect(deps.discover).toHaveBeenCalledWith({ dryRun: false, limit: 2 });
    expect(deps.claim).toHaveBeenCalledWith({
      leaseOwner: 'worker-a',
      leaseExpiresAt: new Date('2026-08-21T00:01:00.000Z'),
      limit: 2,
    });
    expect(deps.complete).toHaveBeenCalledWith(targets[0], expect.objectContaining({ mimeType: 'image/webp' }));
    expect(deps.fail).toHaveBeenCalledWith(targets[1], 'storage unavailable');
    expect(result).toEqual({
      dryRun: false,
      discovered: 2,
      claimed: 2,
      completed: 1,
      failed: 1,
      skipped: 0,
    });
  });

  it('does not settle a late result after its lease has been replaced', async () => {
    const deps = dependencies({
      claim: vi.fn().mockResolvedValue([target()]),
      execute: vi.fn().mockResolvedValue({
        fileUrl: '/api/serve-upload/thumbnails/version-a/512.webp',
        storageKey: null,
        checksum: 'sha256:def',
        mimeType: 'image/webp',
        byteSize: 200,
        width: 512,
        height: 384,
      }),
      complete: vi.fn().mockResolvedValue(false),
    });

    const result = await runAssetThumbnailBackfill({ limit: 1 }, deps);

    expect(result.completed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('reports durable variant states from the repository', async () => {
    const status: ThumbnailBackfillStatus = { pending: 3, processing: 1, ready: 8, failed: 2 };
    const deps = dependencies({ status: vi.fn().mockResolvedValue(status) });

    await expect(getAssetThumbnailBackfillStatus(deps)).resolves.toEqual(status);
  });
});
