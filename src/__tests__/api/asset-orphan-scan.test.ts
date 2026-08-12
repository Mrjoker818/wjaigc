import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  scanMediaHealth: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/asset-core/media-health', () => ({ scanMediaHealth: mocks.scanMediaHealth }));

import { GET as scanOrphans, POST as persistOrphanCandidates } from '@/app/api/admin/assets/orphans/route';

describe('asset orphan scan API', () => {
  beforeEach(() => {
    mocks.getRequestUser.mockReset();
    mocks.scanMediaHealth.mockReset();
  });

  it('denies non-admin orphan scans before invoking the media health service', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'user-a', role: 'user' } });
    const response = await scanOrphans(new NextRequest('http://localhost/api/admin/assets/orphans'));
    expect(response.status).toBe(403);
    expect(mocks.scanMediaHealth).not.toHaveBeenCalled();
  });

  it('runs admin scans as dry-run by default and returns protected candidates', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'admin-a', role: 'admin' } });
    mocks.scanMediaHealth.mockResolvedValue({
      dryRun: true,
      candidates: [],
      protected: [{ assetId: 'asset-a', reasons: ['LEGACY_REFERENCE'], estimatedBytes: 64 }],
      estimatedBytes: 0,
    });
    const response = await scanOrphans(new NextRequest('http://localhost/api/admin/assets/orphans'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ dryRun: true, protected: [{ assetId: 'asset-a' }] });
    expect(mocks.scanMediaHealth).toHaveBeenCalledWith({ dryRun: true });
  });

  it('keeps GET dry-run even when the request asks to persist candidates', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'admin-a', role: 'admin' } });
    mocks.scanMediaHealth.mockResolvedValue({ dryRun: true, candidates: [], protected: [], estimatedBytes: 0 });

    const response = await scanOrphans(new NextRequest('http://localhost/api/admin/assets/orphans?dryRun=false'));

    expect(response.status).toBe(200);
    expect(mocks.scanMediaHealth).toHaveBeenCalledWith({ dryRun: true });
  });

  it('allows an administrator to persist orphan candidates through POST', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'admin-a', role: 'admin' } });
    mocks.scanMediaHealth.mockResolvedValue({ dryRun: false, candidates: [], protected: [], estimatedBytes: 0 });

    const response = await persistOrphanCandidates(new NextRequest(
      'http://localhost/api/admin/assets/orphans?dryRun=false',
      { method: 'POST' },
    ));

    expect(response.status).toBe(200);
    expect(mocks.scanMediaHealth).toHaveBeenCalledWith({ dryRun: false });
  });
});
