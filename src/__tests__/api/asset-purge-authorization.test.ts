import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  purgeEligibleAsset: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/asset-core/media-health', () => ({
  MediaHealthError: class MediaHealthError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  purgeEligibleAsset: mocks.purgeEligibleAsset,
}));

import { POST } from '@/app/api/assets/[assetId]/purge/route';

describe('asset purge authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } });
    mocks.purgeEligibleAsset.mockResolvedValue({
      eligible: false,
      physicalPurgeDisabled: true,
      reasons: ['ASSET_NOT_TRASHED'],
    });
  });

  it('returns 403 for a non-administrator without invoking purge eligibility', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/assets/asset-a/purge', {
        method: 'POST',
        body: JSON.stringify({ candidateId: 'gc_candidate', confirmationDigest: 'digest-a' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ assetId: 'asset-a' }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Administrator session required' });
    expect(mocks.purgeEligibleAsset).not.toHaveBeenCalled();
  });
});
