import { describe, expect, it } from 'vitest';

import { hasProjectSyncResponsePatches } from '@/lib/user-manager';

describe('UserManager project sync response patches', () => {
  it('recognizes the empty success response used by ordinary coordinate saves', () => {
    expect(hasProjectSyncResponsePatches({
      projectIdMap: {},
      assetGraphMappings: {},
      assetGraphUpdates: {},
    })).toBe(false);
  });

  it.each([
    { projectIdMap: { temporary: 'persisted' } },
    { assetGraphMappings: { project: { image: { assetId: 'asset-1' } } } },
    { assetGraphUpdates: { project: { image: { url: '/updated.png' } } } },
  ])('recognizes a response that must patch client projects', response => {
    expect(hasProjectSyncResponsePatches(response)).toBe(true);
  });
});
