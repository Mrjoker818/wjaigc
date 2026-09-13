import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { AssetStorage } from '@/lib/asset-core/storage';
import { assertGatewayProjectAccess } from '@/lib/media-gateway/project-access';

const principal = {
  keyId: 'gwkey-1',
  userId: 'user-1',
  requestsPerMinute: 60,
  dailyQuota: 100,
};

function storageWithOwnership(owned: boolean): AssetStorage {
  return {
    read: vi.fn(async operation => operation({
      findProject: vi.fn().mockResolvedValue(owned),
    } as never)),
  } as unknown as AssetStorage;
}

describe('media gateway project access', () => {
  it('accepts a project owned by the authenticated gateway user', async () => {
    await expect(assertGatewayProjectAccess(
      principal,
      'project-1',
      storageWithOwnership(true),
    )).resolves.toBeUndefined();
  });

  it('rejects a missing or foreign project before task admission', async () => {
    await expect(assertGatewayProjectAccess(
      principal,
      'project-foreign',
      storageWithOwnership(false),
    )).rejects.toMatchObject({
      code: 'GATEWAY_INVALID_REQUEST',
      status: 400,
    });
  });
});
