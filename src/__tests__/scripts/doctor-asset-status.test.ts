import { describe, expect, it } from 'vitest';

import {
  STAGE_2_MIGRATIONS,
  collectAssetGraphDoctorFacts,
  resolveDoctorDatabaseUrl,
  summarizeAssetGraphDoctor,
} from '../../../scripts/doctor-asset-status.mjs';

function migrationRows() {
  return STAGE_2_MIGRATIONS.map(version => ({ version, expectedChecksum: `${version}-sha`, recordedChecksum: `${version}-sha` }));
}

function healthyInput(mode: 'legacy' | 'shadow' | 'asset-v3' = 'asset-v3') {
  const transform = { x: 10, y: 20, width: 320, height: 240, originalWidth: 640, originalHeight: 480, rotation: 0, zIndex: 1 };
  return {
    mode,
    migrations: migrationRows(),
    legacyProjectRows: [{
      userId: 'user-a',
      projects: [{ id: 'project-a', userId: 'user-a', canvasImages: [{ id: 'image-a', url: '/uploads/image-a.png', ...transform, isProcessingPlaceholder: false }] }],
    }],
    graphProjects: [{ ownerId: 'user-a', projectId: 'project-a', status: 'active', schemaVersion: 3 }],
    placements: [{
      ownerId: 'user-a', projectId: 'project-a', entityId: 'image-a', status: 'active',
      placementId: 'placement-a', assetId: 'asset-a', assetVersionId: 'version-a',
      fileUrl: '/api/serve-upload/uploads/image-a.png', transform,
    }],
    checkpoints: [{
      ownerId: 'user-a', projectId: 'project-a', legacyProjectId: 'project-a', status: 'completed', errorCode: null,
      checkpoint: { sourceSchemaVersion: 1, legacyImageMappings: { 'image-a': { placementId: 'placement-a', assetId: 'asset-a', versionId: 'version-a' } } },
    }],
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
      checkpoints: [{ ownerId: 'user-a', projectId: 'project-a', legacyProjectId: 'project-a', status: 'failed', errorCode: 'LEGACY_MIGRATION_FAILED', checkpoint: {} }],
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

  it('accepts the supported v1 images alias but rejects missing URLs, duplicate IDs and unsupported schema versions', () => {
    const input = healthyInput();
    const aliasProject = {
      ...input.legacyProjectRows[0].projects[0],
      canvasImages: undefined,
      images: input.legacyProjectRows[0].projects[0].canvasImages,
    };
    expect(summarizeAssetGraphDoctor({
      ...input,
      legacyProjectRows: [{ userId: 'user-a', projects: [aliasProject] }],
    }).releaseReady).toBe(true);

    for (const project of [
      { ...input.legacyProjectRows[0].projects[0], canvasImages: [{ id: 'image-a' }] },
      { ...input.legacyProjectRows[0].projects[0], canvasImages: [
        input.legacyProjectRows[0].projects[0].canvasImages[0],
        input.legacyProjectRows[0].projects[0].canvasImages[0],
      ] },
      { ...input.legacyProjectRows[0].projects[0], schemaVersion: 99 },
    ]) {
      expect(summarizeAssetGraphDoctor({
        ...input,
        legacyProjectRows: [{ userId: 'user-a', projects: [project] }],
      }).releaseReady).toBe(false);
    }
  });

  it('requires a v3 graph project and a completed checkpoint for the exact legacy project identity', () => {
    const input = healthyInput();
    expect(summarizeAssetGraphDoctor({
      ...input,
      graphProjects: [{ ...input.graphProjects[0], schemaVersion: 2 }],
    }).releaseReady).toBe(false);
    expect(summarizeAssetGraphDoctor({
      ...input,
      checkpoints: [{ ...input.checkpoints[0], legacyProjectId: 'different-legacy-project' }],
    }).releaseReady).toBe(false);
    expect(summarizeAssetGraphDoctor({
      ...input,
      checkpoints: [{ ...input.checkpoints[0], checkpoint: { ...input.checkpoints[0].checkpoint, sourceSchemaVersion: 2 } }],
    }).releaseReady).toBe(false);
  });

  it('compares checkpoint mappings, placement identity, media URL and transform rather than entity IDs alone', () => {
    const input = healthyInput();
    for (const placement of [
      { ...input.placements[0], assetVersionId: 'wrong-version' },
      { ...input.placements[0], fileUrl: '/api/serve-upload/uploads/wrong.png' },
      { ...input.placements[0], transform: { ...input.placements[0].transform, x: 999 } },
    ]) {
      const summary = summarizeAssetGraphDoctor({ ...input, placements: [placement] });
      expect(summary.releaseReady).toBe(false);
      expect(summary.shadowComparison.mismatchedProjects).toBe(1);
    }
    const wrongMapping = {
      ...input.checkpoints[0],
      checkpoint: {
        ...input.checkpoints[0].checkpoint,
        legacyImageMappings: {
          'image-a': {
            ...input.checkpoints[0].checkpoint.legacyImageMappings['image-a'],
            placementId: 'wrong-placement',
          },
        },
      },
    };
    expect(summarizeAssetGraphDoctor({ ...input, checkpoints: [wrongMapping] }).releaseReady).toBe(false);
  });

  it('reports GC state without treating normal due or deferred physical purge as a permanent release blocker', () => {
    const input = healthyInput();
    const summary = summarizeAssetGraphDoctor({
      ...input,
      gcStatuses: [{ status: 'deferred', physicalPurgeStatus: 'deferred', due: true, count: 2 }],
      unregisteredGcCandidates: 0,
    });
    expect(summary.releaseReady).toBe(true);
    expect(summary.gc).toMatchObject({ deferred: 2, due: 2, physicalDeferred: 2, unregistered: 0 });
    expect(summarizeAssetGraphDoctor({ ...input, unregisteredGcCandidates: 1 }).releaseReady).toBe(false);
    expect(summarizeAssetGraphDoctor({
      ...input,
      gcStatuses: [{ status: 'deferred', physicalPurgeStatus: 'failed', due: true, count: 1 }],
    }).releaseReady).toBe(false);
  });

  it('keeps all migration checksums visible when the ledger or a Stage 2 fact table is unavailable', async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes('wujie_schema_migrations')) throw new Error('ledger missing');
        if (sql.includes('FROM wujie_projects')) throw new Error('projects missing');
        return { rows: [] };
      },
    };
    const facts = await collectAssetGraphDoctorFacts(client, { mode: 'asset-v3' });
    expect(facts.migrations).toHaveLength(STAGE_2_MIGRATIONS.length);
    expect(facts.migrations.every(row => row.recordedChecksum === null)).toBe(true);
    expect(facts.queryErrors).toEqual(expect.arrayContaining(['migration-ledger: ledger missing', 'graph-projects: projects missing']));
    const summary = summarizeAssetGraphDoctor(facts);
    expect(summary.releaseReady).toBe(false);
    expect(summary.assetV3Blockers).toContain('asset-facts-unavailable');
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
