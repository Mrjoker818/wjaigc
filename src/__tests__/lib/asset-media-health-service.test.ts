import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withAssetCoreTransaction: vi.fn(),
}));

vi.mock('@/lib/asset-core/storage', () => ({
  withAssetCoreTransaction: mocks.withAssetCoreTransaction,
}));

import {
  recordLegacyRecoveryOutcome,
  recoverAssetMedia,
  scanMediaHealth,
} from '@/lib/asset-core/media-health';

describe('asset media health transactional service', () => {
  beforeEach(() => {
    mocks.withAssetCoreTransaction.mockReset();
  });

  it('persists unrecoverable availability and attempt atomically when no source or storage key exists', async () => {
    const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      void params;
      if (sql.includes('FROM wujie_assets')) {
        return { rows: [{ id: 'asset-a' }], rowCount: 1 };
      }
      if (sql.includes('SELECT version.id')) {
        return {
          rows: [{
            id: 'version-a',
            asset_id: 'asset-a',
            recovery_source_url: null,
            storage_key: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM wujie_workspace_placements')) {
        return { rows: [{ id: 'placement-a' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));

    await expect(recoverAssetMedia({
      actorUserId: 'owner-a',
      projectId: 'project-a',
      assetVersionId: 'version-a',
      assetId: 'asset-a',
      placementId: 'placement-a',
    })).resolves.toEqual({ recovered: false, availability: 'unrecoverable', deferred: false });

    const availabilityWrite = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE wujie_asset_versions'));
    const attemptWrite = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO wujie_asset_media_recovery_attempts'));
    expect(availabilityWrite?.[1]).toContain('unrecoverable');
    expect(attemptWrite?.[1]).toContain('unrecoverable');
    expect(mocks.withAssetCoreTransaction).toHaveBeenCalledOnce();
  });

  it('locks asset then version then placement before deciding recovery state', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM wujie_assets')) {
        return { rows: [{ id: 'asset-a' }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_asset_versions version')) {
        return {
          rows: [{
            id: 'version-a',
            asset_id: 'asset-a',
            recovery_source_url: 'https://source.test/a.png',
            storage_key: 'uploads/a.png',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM wujie_workspace_placements')) {
        return { rows: [{ id: 'placement-a' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));

    await expect(recoverAssetMedia({
      actorUserId: 'owner-a',
      projectId: 'project-a',
      assetVersionId: 'version-a',
      assetId: 'asset-a',
      placementId: 'placement-a',
    })).resolves.toEqual({ recovered: false, availability: 'recovering', deferred: true });

    const lockOrder = query.mock.calls
      .filter(([sql]) => String(sql).includes('FOR UPDATE'))
      .map(([sql]) => String(sql).includes('FROM wujie_assets')
        ? 'asset'
        : String(sql).includes('FROM wujie_asset_versions')
          ? 'version'
          : 'placement');
    expect(lockOrder).toEqual(['asset', 'version', 'placement']);
  });

  it('returns deterministic candidate identity during dry-run without writing the candidate table', async () => {
    const query = vi.fn(async (sql: string) => {
      void sql;
      return {
        rows: [{
          asset_id: 'asset-a',
          status: 'trashed',
          updated_at: new Date('2026-06-01T00:00:00.000Z'),
          trashed_at: new Date('2026-06-01T00:00:00.000Z'),
          active_placements: '0',
          version_count: '1',
          managed_versions: '1',
          estimated_bytes: '64',
          migration_confirmed: true,
          legacy_references: false,
          shared_media: false,
          unknown_legacy_ownership: false,
          version_facts: [{
            id: 'version-a',
            storageKey: 'images/a.png',
            fileUrl: '/api/serve-upload/a.png',
            availability: 'ready',
            byteSize: '64',
          }],
          placement_facts: [{
            id: 'placement-a',
            status: 'trashed',
            deletedAt: '2026-06-01T00:00:00.000Z',
          }],
          migration_checkpoint_facts: [{
            id: 'checkpoint-a',
            legacyProjectId: 'project-a',
            status: 'completed',
            updatedAt: '2026-06-01T00:00:00.000Z',
          }],
          legacy_reference_facts: [],
          shared_physical_reference_facts: [],
        }],
        rowCount: 1,
      };
    });
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));

    const first = await scanMediaHealth();
    const second = await scanMediaHealth({ dryRun: true });

    expect(first.candidates[0]).toMatchObject({
      assetId: 'asset-a',
      candidateId: expect.stringMatching(/^gc_[a-f0-9]{24}$/),
      confirmationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      estimatedBytes: 64,
    });
    expect(second.candidates[0]).toEqual(first.candidates[0]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO wujie_media_gc_candidates'))).toBe(false);
  });

  it('records legacy recovery success as ready and preserves retryable failure as missing', async () => {
    const lockedRows = [{
      id: 'version-a',
      asset_id: 'asset-a',
      owner_id: 'owner-a',
      project_id: 'project-a',
      recovery_source_url: 'https://source.test/a.png',
      storage_key: 'uploads/a.png',
    }];
    const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      void params;
      if (sql.includes('FROM wujie_asset_versions version')) return { rows: lockedRows, rowCount: 1 };
      if (sql.includes('FROM wujie_assets')) return { rows: [{ id: 'asset-a' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));

    await recordLegacyRecoveryOutcome({ localPath: 'uploads/a.png', success: true, method: 's3' });
    await recordLegacyRecoveryOutcome({
      localPath: 'uploads/a.png',
      success: false,
      method: 'sourceUrl',
      error: 'HTTP 503',
    });

    const availabilityWrites = query.mock.calls.filter(([sql]) => String(sql).includes('UPDATE wujie_asset_versions'));
    const attemptWrites = query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO wujie_asset_media_recovery_attempts'));
    expect(availabilityWrites[0]?.[1]).toContain('ready');
    expect(attemptWrites[0]?.[1]).toContain('succeeded');
    expect(availabilityWrites[1]?.[1]).toContain('missing');
    expect(attemptWrites[1]?.[1]).toContain('failed');
  });

  it('matches only the exact normalized managed path and locks asset then version then placement', async () => {
    const exact = {
      id: 'version-exact',
      asset_id: 'asset-exact',
      owner_id: 'owner-a',
      project_id: 'project-a',
      recovery_source_url: null,
      storage_key: 'users/a/same.png',
    };
    const guessedAlias = {
      id: 'version-alias',
      asset_id: 'asset-alias',
      owner_id: 'owner-b',
      project_id: 'project-b',
      recovery_source_url: null,
      storage_key: 'images/same.png',
    };
    const rowsById = new Map([
      [exact.id, exact],
      [guessedAlias.id, guessedAlias],
    ]);
    const query = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
      if (sql.includes('FROM wujie_asset_versions version') && !sql.includes('FOR UPDATE')) {
        const pathInput = params[1];
        const includesGuessedAlias = Array.isArray(pathInput) && pathInput.includes('images/same.png');
        return { rows: includesGuessedAlias ? [exact, guessedAlias] : [exact], rowCount: includesGuessedAlias ? 2 : 1 };
      }
      if (sql.includes('FROM wujie_assets')) return { rows: [{ id: exact.asset_id }], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_versions version') && sql.includes('FOR UPDATE')) {
        const ids = Array.isArray(params[0]) ? params[0] as string[] : [];
        const rows = ids.flatMap(id => rowsById.get(id) ?? []);
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('FROM wujie_workspace_placements')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));

    const result = await recordLegacyRecoveryOutcome({
      localPath: 'users\\a\\same.png',
      success: true,
      method: 's3',
    });

    expect(result).toEqual({ matchedVersions: 1, ready: 1, missing: 0, unrecoverable: 0 });
    const reads = query.mock.calls.filter(([sql]) => String(sql).includes('FROM wujie_asset_versions version'));
    expect(reads[0]?.[1]).toEqual(['/api/serve-upload/users/a/same.png', 'users/a/same.png']);
    expect(reads[1]?.[1]).toEqual([
      ['version-exact'],
      '/api/serve-upload/users/a/same.png',
      'users/a/same.png',
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain('images/same.png');
    const lockOrder = query.mock.calls
      .filter(([sql]) => String(sql).includes('FOR UPDATE'))
      .map(([sql]) => String(sql).includes('FROM wujie_assets')
        ? 'asset'
        : String(sql).includes('FROM wujie_asset_versions')
          ? 'version'
          : 'placement');
    expect(lockOrder).toEqual(['asset', 'version', 'placement']);
  });
});
