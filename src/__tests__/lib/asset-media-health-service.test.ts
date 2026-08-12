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

  it('takes an exact-path advisory lock and rechecks all current versions without snapshot version IDs', async () => {
    const currentVersions = [
      {
        id: 'version-initial',
        asset_id: 'asset-z',
        owner_id: 'owner-a',
        project_id: 'project-a',
        recovery_source_url: null,
        storage_key: 'users/a/recovery.png',
      },
      {
        id: 'version-arrived',
        asset_id: 'asset-a',
        owner_id: 'owner-a',
        project_id: 'project-a',
        recovery_source_url: null,
        storage_key: 'users/a/recovery.png',
      },
    ];
    const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      void params;
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('SELECT DISTINCT version.asset_id')) {
        return { rows: [{ asset_id: 'asset-z' }, { asset_id: 'asset-a' }], rowCount: 2 };
      }
      if (sql.includes('FROM wujie_assets')) {
        return { rows: [{ id: 'asset-a' }, { id: 'asset-z' }], rowCount: 2 };
      }
      if (sql.includes('FROM wujie_asset_versions version') && sql.includes('FOR UPDATE')) {
        return { rows: currentVersions, rowCount: currentVersions.length };
      }
      if (sql.includes('FROM wujie_workspace_placements')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => callback({ query }));

    const result = await recordLegacyRecoveryOutcome({
      localPath: 'users/a/recovery.png',
      success: true,
      method: 's3',
    });

    expect(result).toEqual({ matchedVersions: 2, ready: 2, missing: 0, unrecoverable: 0 });
    const calls = query.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));
    const serializableIndex = calls.findIndex(({ sql }) => sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'));
    const advisoryIndex = calls.findIndex(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    const snapshotIndex = calls.findIndex(({ sql }) => sql.includes('SELECT DISTINCT version.asset_id'));
    const assetLockIndex = calls.findIndex(({ sql }) => sql.includes('FROM wujie_assets') && sql.includes('FOR UPDATE'));
    const stableRecheckIndex = calls.findLastIndex(({ sql }) => sql.includes('SELECT DISTINCT version.asset_id'));
    const finalRequeryIndex = calls.findIndex(({ sql }) => (
      sql.includes('FROM wujie_asset_versions version') && sql.includes('FOR UPDATE')
    ));
    expect([
      serializableIndex,
      advisoryIndex,
      snapshotIndex,
      assetLockIndex,
      stableRecheckIndex,
      finalRequeryIndex,
    ]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(calls[1]?.params).toEqual(['asset-media-recovery:users/a/recovery.png']);
    expect(calls[3]?.params).toEqual([['asset-a', 'asset-z']]);
    expect(calls[5]?.sql).not.toMatch(/version\.id\s*=\s*ANY/i);
    expect(calls[5]?.params).toEqual([
      '/api/serve-upload/users/a/recovery.png',
      'users/a/recovery.png',
    ]);
  });

  it('retries before any version lock when a different exact-path asset arrives after the asset snapshot', async () => {
    const versions = [
      {
        id: 'version-a',
        asset_id: 'asset-a',
        owner_id: 'owner-a',
        project_id: 'project-a',
        recovery_source_url: null,
        storage_key: 'users/a/racing.png',
      },
      {
        id: 'version-b',
        asset_id: 'asset-b',
        owner_id: 'owner-b',
        project_id: 'project-b',
        recovery_source_url: null,
        storage_key: 'users/a/racing.png',
      },
    ];
    const firstAttemptQuery = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      void params;
      if (sql.includes('SELECT DISTINCT version.asset_id')) {
        const discoveryCount = firstAttemptQuery.mock.calls
          .filter(([querySql]) => String(querySql).includes('SELECT DISTINCT version.asset_id'))
          .length;
        return discoveryCount === 1
          ? { rows: [{ asset_id: 'asset-a' }], rowCount: 1 }
          : { rows: [{ asset_id: 'asset-a' }, { asset_id: 'asset-b' }], rowCount: 2 };
      }
      if (sql.includes('FROM wujie_assets')) return { rows: [{ id: 'asset-a' }], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_versions version') && sql.includes('FOR UPDATE')) {
        return { rows: versions, rowCount: versions.length };
      }
      return { rows: [], rowCount: 1 };
    });
    const secondAttemptQuery = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      void params;
      if (sql.includes('SELECT DISTINCT version.asset_id')) {
        return { rows: [{ asset_id: 'asset-b' }, { asset_id: 'asset-a' }], rowCount: 2 };
      }
      if (sql.includes('FROM wujie_assets')) {
        return { rows: [{ id: 'asset-a' }, { id: 'asset-b' }], rowCount: 2 };
      }
      if (sql.includes('FROM wujie_asset_versions version') && sql.includes('FOR UPDATE')) {
        return { rows: versions, rowCount: versions.length };
      }
      if (sql.includes('FROM wujie_workspace_placements')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const attemptQueries = [firstAttemptQuery, secondAttemptQuery];
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => {
      const query = attemptQueries[mocks.withAssetCoreTransaction.mock.calls.length - 1];
      if (!query) throw new Error('unexpected recovery transaction attempt');
      return callback({ query });
    });

    await expect(recordLegacyRecoveryOutcome({
      localPath: 'users/a/racing.png',
      success: true,
      method: 's3',
    })).resolves.toEqual({ matchedVersions: 2, ready: 2, missing: 0, unrecoverable: 0 });

    expect(mocks.withAssetCoreTransaction).toHaveBeenCalledTimes(2);
    expect(firstAttemptQuery.mock.calls[0]?.[0]).toMatch(/SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/i);
    expect(firstAttemptQuery.mock.calls.filter(([sql]) => String(sql).includes('SELECT DISTINCT version.asset_id'))).toHaveLength(2);
    expect(firstAttemptQuery.mock.calls.some(([sql]) => (
      String(sql).includes('FROM wujie_asset_versions version') && String(sql).includes('FOR UPDATE')
    ))).toBe(false);
    expect(firstAttemptQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE wujie_asset_versions'))).toBe(false);

    const secondCalls = secondAttemptQuery.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));
    expect(secondCalls[0]?.sql).toMatch(/SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/i);
    const assetLockIndex = secondCalls.findIndex(({ sql }) => sql.includes('FROM wujie_assets') && sql.includes('FOR UPDATE'));
    const stableRecheckIndex = secondCalls.findLastIndex(({ sql }) => sql.includes('SELECT DISTINCT version.asset_id'));
    const versionLockIndex = secondCalls.findIndex(({ sql }) => (
      sql.includes('FROM wujie_asset_versions version') && sql.includes('FOR UPDATE')
    ));
    const placementLockIndex = secondCalls.findIndex(({ sql }) => sql.includes('FROM wujie_workspace_placements'));
    expect(secondCalls[assetLockIndex]?.params).toEqual([['asset-a', 'asset-b']]);
    expect(assetLockIndex).toBeLessThan(stableRecheckIndex);
    expect(stableRecheckIndex).toBeLessThan(versionLockIndex);
    expect(versionLockIndex).toBeLessThan(placementLockIndex);
  });

  it('bounds PostgreSQL 40001 retries to three serializable transactions', async () => {
    const serializationFailure = Object.assign(new Error('could not serialize access'), { code: '40001' });
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    mocks.withAssetCoreTransaction.mockRejectedValue(serializationFailure);

    await expect(recordLegacyRecoveryOutcome({
      localPath: 'users/a/retry-limit.png',
      success: true,
      method: 's3',
    })).rejects.toBe(serializationFailure);

    expect(mocks.withAssetCoreTransaction).toHaveBeenCalledTimes(3);
    expect(query).not.toHaveBeenCalled();
  });

  it('performs the lock-time exact-path requery when the initial asset snapshot is empty', async () => {
    const arrived = {
      id: 'version-arrived',
      asset_id: 'asset-arrived',
      owner_id: 'owner-a',
      project_id: 'project-a',
      recovery_source_url: null,
      storage_key: 'users/a/late.png',
    };
    const firstAttemptQuery = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      void params;
      if (sql.includes('SELECT DISTINCT version.asset_id')) {
        const discoveryCount = firstAttemptQuery.mock.calls
          .filter(([querySql]) => String(querySql).includes('SELECT DISTINCT version.asset_id'))
          .length;
        return discoveryCount === 1
          ? { rows: [], rowCount: 0 }
          : { rows: [{ asset_id: arrived.asset_id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const secondAttemptQuery = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      void params;
      if (sql.includes('SELECT DISTINCT version.asset_id')) {
        return { rows: [{ asset_id: arrived.asset_id }], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_assets')) return { rows: [{ id: arrived.asset_id }], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_versions version') && sql.includes('FOR UPDATE')) {
        return { rows: [arrived], rowCount: 1 };
      }
      if (sql.includes('FROM wujie_workspace_placements')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const attemptQueries = [firstAttemptQuery, secondAttemptQuery];
    mocks.withAssetCoreTransaction.mockImplementation(async (callback) => {
      const query = attemptQueries[mocks.withAssetCoreTransaction.mock.calls.length - 1];
      if (!query) throw new Error('unexpected recovery transaction attempt');
      return callback({ query });
    });

    await expect(recordLegacyRecoveryOutcome({
      localPath: 'users/a/late.png',
      success: true,
      method: 's3',
    })).resolves.toEqual({ matchedVersions: 1, ready: 1, missing: 0, unrecoverable: 0 });

    expect(firstAttemptQuery.mock.calls.some(([sql]) => (
      String(sql).includes('FROM wujie_asset_versions version') && String(sql).includes('FOR UPDATE')
    ))).toBe(false);
    const finalRequery = secondAttemptQuery.mock.calls.find(([sql]) => (
      String(sql).includes('FROM wujie_asset_versions version') && String(sql).includes('FOR UPDATE')
    ));
    expect(finalRequery?.[1]).toEqual([
      '/api/serve-upload/users/a/late.png',
      'users/a/late.png',
    ]);
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
    const query = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
      if (sql.includes('FROM wujie_asset_versions version') && !sql.includes('FOR UPDATE')) {
        const pathInput = params[1];
        const includesGuessedAlias = Array.isArray(pathInput) && pathInput.includes('images/same.png');
        return { rows: includesGuessedAlias ? [exact, guessedAlias] : [exact], rowCount: includesGuessedAlias ? 2 : 1 };
      }
      if (sql.includes('FROM wujie_assets')) return { rows: [{ id: exact.asset_id }], rowCount: 1 };
      if (sql.includes('FROM wujie_asset_versions version') && sql.includes('FOR UPDATE')) {
        const pathInput = params[1];
        const includesGuessedAlias = Array.isArray(pathInput) && pathInput.includes('images/same.png');
        return { rows: includesGuessedAlias ? [exact, guessedAlias] : [exact], rowCount: includesGuessedAlias ? 2 : 1 };
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
    expect(reads[1]?.[1]).toEqual(['/api/serve-upload/users/a/same.png', 'users/a/same.png']);
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
