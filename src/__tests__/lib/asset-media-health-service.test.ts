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
});
