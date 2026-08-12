import { describe, expect, it } from 'vitest';

import {
  STAGE_2_MIGRATIONS,
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
    assetStatuses: [{ status: 'active', count: 1 }, { status: 'trashed', count: 0 }],
    gcStatuses: [{ status: 'pending', count: 0 }, { status: 'deferred', count: 0 }, { status: 'purged', count: 0 }],
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

  it('reports shadow drift without treating shadow mode as an asset-v3 release', () => {
    const input = healthyInput('shadow');
    const summary = summarizeAssetGraphDoctor({ ...input, placements: [] });
    expect(summary.releaseReady).toBe(false);
    expect(summary.assetV3Blockers).toContain('shadow-projection-drift');
  });
});
