import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  collectFacts: vi.fn(),
  summarize: vi.fn(),
}));

vi.mock('@/lib/db-client', () => ({ getPool: mocks.getPool }));
vi.mock('../../../scripts/doctor-asset-status.mjs', () => ({
  collectAssetGraphDoctorFacts: mocks.collectFacts,
  summarizeAssetGraphDoctor: mocks.summarize,
}));

import {
  collectAssetGraphReleaseReadiness,
  projectAssetGraphReleaseReadiness,
} from '@/lib/asset-core/asset-release-readiness';

const readySummary = {
  mode: 'legacy' as const,
  releaseReady: true,
  assetV3Blockers: [],
  migrations: {
    required: 6,
    verified: 6,
    missing: [],
    checksumMismatches: [],
    entries: [{ version: 'secret.sql', expectedChecksum: 'expected', recordedChecksum: 'recorded' }],
  },
  shadowComparison: {
    legacyProjects: 2,
    graphProjects: 2,
    matchingProjects: 2,
    mismatchedProjects: 0,
    unmigratedProjects: 0,
    orphanGraphProjects: 0,
    nonV3GraphProjects: 0,
    failedCheckpoints: 0,
    missingCheckpoints: 0,
    invalidLegacyRecords: 0,
  },
  media: {
    ready: 4,
    pendingPersist: 0,
    missing: 0,
    recovering: 0,
    unrecoverable: 0,
    activeAssetsMissingCurrentVersion: 0,
    placementPendingPersist: 0,
    placementMissing: 0,
    placementRecovering: 0,
    placementUnrecoverable: 0,
    falseReadyCurrentVersions: 0,
    falseReadyActivePlacements: 0,
  },
  assets: { active: 4, trashed: 0 },
  gc: {
    pending: 0,
    deferred: 0,
    purged: 0,
    due: 0,
    physicalDeferred: 0,
    physicalFailed: 0,
    unregistered: 0,
  },
  queryErrors: ['must-not-leak: owner=user-1 url=https://private.example'],
};

afterEach(() => {
  vi.resetAllMocks();
});

describe('asset release readiness', () => {
  it('projects a ready doctor summary without raw operational data', () => {
    const result = projectAssetGraphReleaseReadiness({ ...readySummary, queryErrors: [] });

    expect(result).toMatchObject({
      mode: 'legacy',
      status: 'pass',
      releaseReady: true,
      switchAuthorized: true,
      blockingCurrentRelease: false,
      blockers: [],
      queryErrorCount: 0,
      collectionUnavailable: false,
    });
    expect(JSON.stringify(result)).not.toContain('entries');
    expect(JSON.stringify(result)).not.toContain('Checksum');
    expect(result.media).toMatchObject({
      falseReadyCurrentVersions: 0,
      falseReadyActivePlacements: 0,
    });
  });

  it('warns without blocking the active legacy release when blockers exist', () => {
    expect(projectAssetGraphReleaseReadiness({
      ...readySummary,
      releaseReady: false,
      assetV3Blockers: ['unmigrated-projects'],
      shadowComparison: { ...readySummary.shadowComparison, unmigratedProjects: 1 },
      queryErrors: [],
    })).toMatchObject({
      status: 'warn',
      switchAuthorized: false,
      blockingCurrentRelease: false,
      blockers: ['unmigrated-projects'],
    });
  });

  it('blocks the active asset-v3 release when blockers exist', () => {
    expect(projectAssetGraphReleaseReadiness({
      ...readySummary,
      mode: 'asset-v3',
      releaseReady: false,
      assetV3Blockers: ['non-ready-current-media'],
      queryErrors: [],
    })).toMatchObject({ status: 'fail', blockingCurrentRelease: true });
  });

  it('collapses collector-reported partial failures to the unavailable blocker', async () => {
    const client = { query: vi.fn().mockResolvedValue(undefined), release: vi.fn() };
    mocks.getPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) });
    mocks.collectFacts.mockResolvedValue({ facts: true });
    mocks.summarize.mockReturnValue({
      ...readySummary,
      releaseReady: false,
      assetV3Blockers: ['asset-facts-unavailable', 'missing-migrations'],
    });

    const result = await collectAssetGraphReleaseReadiness();

    expect(result).toMatchObject({
      blockers: ['asset-facts-unavailable'],
      collectionUnavailable: true,
      releaseReady: false,
      switchAuthorized: false,
      status: 'fail',
    });
    expect(result.blockers).toEqual(['asset-facts-unavailable']);
  });

  it('collects facts inside a bounded read-only transaction and releases the client', async () => {
    const client = { query: vi.fn().mockResolvedValue(undefined), release: vi.fn() };
    mocks.getPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) });
    mocks.collectFacts.mockResolvedValue({ facts: true });
    mocks.summarize.mockReturnValue({ ...readySummary, queryErrors: [] });

    await expect(collectAssetGraphReleaseReadiness()).resolves.toMatchObject({ status: 'pass' });
    expect(client.query.mock.calls.map(call => call[0])).toEqual([
      'BEGIN READ ONLY',
      'SET LOCAL statement_timeout = 30000',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back, releases and redacts collection failures', async () => {
    const client = { query: vi.fn().mockResolvedValue(undefined), release: vi.fn() };
    mocks.getPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) });
    mocks.collectFacts.mockRejectedValue(new Error('password=secret owner=user-1'));

    const result = await collectAssetGraphReleaseReadiness();

    expect(result).toMatchObject({
      releaseReady: false,
      switchAuthorized: false,
      blockers: ['asset-facts-unavailable'],
      collectionUnavailable: true,
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('user-1');
  });
});
