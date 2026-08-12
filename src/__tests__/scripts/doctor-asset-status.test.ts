import { describe, expect, it } from 'vitest';

import {
  STAGE_2_MIGRATIONS,
  resolveDoctorDatabaseUrl,
  summarizeAssetGraphDoctor,
} from '../../../scripts/doctor-asset-status.mjs';

function migrationRows() {
  return STAGE_2_MIGRATIONS.map(version => ({ version, expectedChecksum: `${version}-sha`, recordedChecksum: `${version}-sha` }));
}

function healthyInput(mode: 'legacy' | 'shadow' | 'asset-v3' = 'asset-v3') {
  return {
    mode,
    migrations: migrationRows(),
    legacyProjectRows: [{
      userId: 'user-a',
      projects: [{ id: 'project-a', userId: 'user-a', canvasImages: [{ id: 'image-a', isProcessingPlaceholder: false }] }],
    }],
    graphProjects: [{ ownerId: 'user-a', projectId: 'project-a', status: 'active' }],
    placements: [{ ownerId: 'user-a', projectId: 'project-a', entityId: 'image-a', status: 'active' }],
    checkpoints: [{ ownerId: 'user-a', projectId: 'project-a', status: 'completed', errorCode: null }],
    currentVersionAvailability: [{ availability: 'ready', count: 1 }],
    activeAssetsMissingCurrentVersion: 0,
    activePlacementVersionAvailability: [{ availability: 'ready', count: 1 }],
    assetStatuses: [{ status: 'active', count: 1 }, { status: 'trashed', count: 0 }],
    gcStatuses: [{ status: 'pending', physicalPurgeStatus: 'disabled', due: false, count: 0 }],
    unregisteredGcCandidates: 0,
  } as const;
}

describe('Stage 2 Doctor asset graph release gate', () => {
  it('allows asset-v3 only when migrations, projections and media are consistent', () => {
    const summary = summarizeAssetGraphDoctor(healthyInput());
    expect(summary.releaseReady).toBe(true);
    expect(summary.shadowComparison).toMatchObject({
      legacyProjects: 1,
      matchingProjects: 1,
      mismatchedProjects: 0,
      unmigratedProjects: 0,
    });
  });

  it('blocks asset-v3 when a migration is missing or has the wrong checksum', () => {
    const input = healthyInput();
    const migrations = [...input.migrations.slice(0, -1)];
    migrations[0] = { ...migrations[0], recordedChecksum: 'wrong' };
    const summary = summarizeAssetGraphDoctor({ ...input, migrations });
    expect(summary.releaseReady).toBe(false);
    expect(summary.migrations.missing).toEqual([STAGE_2_MIGRATIONS.at(-1)]);
    expect(summary.migrations.checksumMismatches).toEqual([STAGE_2_MIGRATIONS[0]]);
  });

  it('blocks asset-v3 when legacy images and active placements differ or migration is incomplete', () => {
    const input = healthyInput();
    const summary = summarizeAssetGraphDoctor({
      ...input,
      placements: [],
      checkpoints: [{ ownerId: 'user-a', projectId: 'project-a', status: 'failed', errorCode: 'LEGACY_MIGRATION_FAILED' }],
    });
    expect(summary.releaseReady).toBe(false);
    expect(summary.shadowComparison).toMatchObject({ mismatchedProjects: 1, failedCheckpoints: 1 });
  });

  it('blocks asset-v3 when a project checkpoint is missing', () => {
    const input = healthyInput();
    const summary = summarizeAssetGraphDoctor({ ...input, checkpoints: [] });
    expect(summary.releaseReady).toBe(false);
    expect(summary.shadowComparison.missingCheckpoints).toBe(1);
  });

  it('blocks asset-v3 while an active current version is not ready', () => {
    const input = healthyInput();
    const summary = summarizeAssetGraphDoctor({
      ...input,
      currentVersionAvailability: [
        { availability: 'ready', count: 1 },
        { availability: 'missing', count: 2 },
        { availability: 'unrecoverable', count: 1 },
      ],
    });
    expect(summary.releaseReady).toBe(false);
    expect(summary.media).toMatchObject({ ready: 1, missing: 2, unrecoverable: 1 });
  });

  it('blocks an active asset without a current version and an active placement bound to missing media', () => {
    const input = healthyInput();
    const summary = summarizeAssetGraphDoctor({
      ...input,
      activeAssetsMissingCurrentVersion: 1,
      activePlacementVersionAvailability: [{ availability: 'missing', count: 1 }],
    });
    expect(summary.releaseReady).toBe(false);
    expect(summary.media).toMatchObject({ activeAssetsMissingCurrentVersion: 1, placementMissing: 1 });
  });

  it('blocks malformed legacy project data instead of treating it as an empty database', () => {
    const input = healthyInput();
    const summary = summarizeAssetGraphDoctor({
      ...input,
      legacyProjectRows: [{ userId: 'user-a', projects: { id: 'not-an-array' } }],
      graphProjects: [],
      placements: [],
      checkpoints: [],
    });
    expect(summary.releaseReady).toBe(false);
    expect(summary.shadowComparison.invalidLegacyRecords).toBeGreaterThan(0);
  });

  it('reports unregistered, due and non-disabled physical purge candidates', () => {
    const input = healthyInput();
    const summary = summarizeAssetGraphDoctor({
      ...input,
      gcStatuses: [{ status: 'deferred', physicalPurgeStatus: 'failed', due: true, count: 2 }],
      unregisteredGcCandidates: 1,
    });
    expect(summary.releaseReady).toBe(false);
    expect(summary.gc).toMatchObject({ deferred: 2, due: 2, physicalFailed: 2, unregistered: 1 });
  });

  it('uses the same database precedence as the application runtime', () => {
    expect(resolveDoctorDatabaseUrl({ DATABASE_URL: 'database-url', PGDATABASE_URL: 'pgdatabase-url' })).toBe('database-url');
    expect(resolveDoctorDatabaseUrl({ PGDATABASE_URL: 'pgdatabase-url' })).toBe('pgdatabase-url');
  });

  it('reports shadow drift without treating shadow mode as an asset-v3 release', () => {
    const input = healthyInput('shadow');
    const summary = summarizeAssetGraphDoctor({ ...input, placements: [] });
    expect(summary.releaseReady).toBe(false);
    expect(summary.assetV3Blockers).toContain('shadow-projection-drift');
  });
});
