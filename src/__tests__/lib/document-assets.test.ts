import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { assertProjectAssetVersion } from '@/lib/collaboration/document-assets';

vi.mock('server-only', () => ({}));

describe('canvas document asset reference input', () => {
  it.each([
    [' ', 'project-a', 'version-a'],
    ['owner-a', '\t', 'version-a'],
    ['owner-a', 'project-a', '   '],
  ])('rejects whitespace-only identifiers before querying the asset graph', async (
    ownerId, projectId, versionId,
  ) => {
    const noDatabaseAccess = {
      query: async () => { throw new Error('UNEXPECTED_DB_QUERY'); },
    } as unknown as PoolClient;
    await expect(assertProjectAssetVersion(ownerId, projectId, versionId, noDatabaseAccess))
      .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
  });
});
