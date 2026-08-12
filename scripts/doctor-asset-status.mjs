import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const STAGE_2_MIGRATIONS = Object.freeze([
  '20260810_wj_stable_s2_assets.sql',
  '20260810_wj_stable_s2_workspace_entity_pairs.sql',
  '20260811_wj_stable_s2_asset_transfer_idempotency.sql',
  '20260811_wj_stable_s2_cross_project_transfer.sql',
  '20260811_wj_stable_s2_transfer_lineage_invariants.sql',
  '20260812_wj_stable_s2_asset_lifecycle.sql',
]);

function countRows(rows, key, value) {
  return rows.filter(row => row[key] === value).reduce((total, row) => total + Number(row.count || 0), 0);
}

function projectKey(ownerId, projectId) {
  return `${ownerId}\u0000${projectId}`;
}

function comparableLegacyProjects(rows) {
  const projects = new Map();
  let invalidLegacyRecords = 0;
  for (const row of rows) {
    if (!Array.isArray(row.projects)) {
      invalidLegacyRecords += 1;
      continue;
    }
    for (const project of row.projects) {
      if (!project || typeof project !== 'object' || !project.id || !Array.isArray(project.canvasImages)) {
        invalidLegacyRecords += 1;
        continue;
      }
      const ownerId = String(project.userId || row.userId || '');
      if (!ownerId || ownerId !== String(row.userId || '')) {
        invalidLegacyRecords += 1;
        continue;
      }
      const imageIds = [];
      for (const image of project.canvasImages) {
        if (!image || typeof image !== 'object' || !image.id) {
          invalidLegacyRecords += 1;
          continue;
        }
        if (image.isProcessingPlaceholder !== true) imageIds.push(String(image.id));
      }
      imageIds.sort();
      projects.set(projectKey(ownerId, String(project.id)), { ownerId, projectId: String(project.id), imageIds });
    }
  }
  return { projects, invalidLegacyRecords };
}

export function resolveDoctorDatabaseUrl(environment) {
  return environment.DATABASE_URL || environment.PGDATABASE_URL || '';
}

export function summarizeAssetGraphDoctor(input) {
  const migrationByVersion = new Map(input.migrations.map(row => [row.version, row]));
  const missing = STAGE_2_MIGRATIONS.filter(version => !migrationByVersion.get(version)?.recordedChecksum);
  const checksumMismatches = STAGE_2_MIGRATIONS.filter(version => {
    const row = migrationByVersion.get(version);
    return Boolean(row?.recordedChecksum && row.expectedChecksum !== row.recordedChecksum);
  });

  const legacyFacts = comparableLegacyProjects(input.legacyProjectRows);
  const legacyProjects = legacyFacts.projects;
  const activeGraphProjects = new Set(input.graphProjects
    .filter(row => row.status === 'active')
    .map(row => projectKey(row.ownerId, row.projectId)));
  const placementsByProject = new Map();
  for (const row of input.placements.filter(row => row.status === 'active')) {
    const key = projectKey(row.ownerId, row.projectId);
    const ids = placementsByProject.get(key) ?? [];
    ids.push(String(row.entityId));
    placementsByProject.set(key, ids);
  }

  let matchingProjects = 0;
  let mismatchedProjects = 0;
  let unmigratedProjects = 0;
  for (const [key, project] of legacyProjects) {
    if (!activeGraphProjects.has(key)) {
      unmigratedProjects += 1;
      continue;
    }
    const placementIds = [...(placementsByProject.get(key) ?? [])].sort();
    if (JSON.stringify(placementIds) === JSON.stringify(project.imageIds)) matchingProjects += 1;
    else mismatchedProjects += 1;
  }
  const checkpointKeys = new Set(input.checkpoints
    .filter(row => row.status === 'completed' && !row.errorCode)
    .map(row => projectKey(row.ownerId, row.projectId)));
  const failedCheckpoints = input.checkpoints.filter(row => row.status !== 'completed' || row.errorCode).length;
  const missingCheckpoints = [...legacyProjects.keys()].filter(key => activeGraphProjects.has(key) && !checkpointKeys.has(key)).length;
  const orphanGraphProjects = [...activeGraphProjects].filter(key => !legacyProjects.has(key)).length;

  const media = {
    ready: countRows(input.currentVersionAvailability, 'availability', 'ready'),
    pendingPersist: countRows(input.currentVersionAvailability, 'availability', 'pending-persist'),
    missing: countRows(input.currentVersionAvailability, 'availability', 'missing'),
    recovering: countRows(input.currentVersionAvailability, 'availability', 'recovering'),
    unrecoverable: countRows(input.currentVersionAvailability, 'availability', 'unrecoverable'),
    activeAssetsMissingCurrentVersion: Number(input.activeAssetsMissingCurrentVersion || 0),
    placementPendingPersist: countRows(input.activePlacementVersionAvailability || [], 'availability', 'pending-persist'),
    placementMissing: countRows(input.activePlacementVersionAvailability || [], 'availability', 'missing'),
    placementRecovering: countRows(input.activePlacementVersionAvailability || [], 'availability', 'recovering'),
    placementUnrecoverable: countRows(input.activePlacementVersionAvailability || [], 'availability', 'unrecoverable'),
  };
  const assets = {
    active: countRows(input.assetStatuses, 'status', 'active'),
    trashed: countRows(input.assetStatuses, 'status', 'trashed'),
  };
  const gc = {
    pending: countRows(input.gcStatuses, 'status', 'pending'),
    deferred: countRows(input.gcStatuses, 'status', 'deferred'),
    purged: countRows(input.gcStatuses, 'status', 'purged'),
    due: input.gcStatuses.filter(row => row.due).reduce((total, row) => total + Number(row.count || 0), 0),
    physicalDeferred: countRows(input.gcStatuses, 'physicalPurgeStatus', 'deferred'),
    physicalFailed: countRows(input.gcStatuses, 'physicalPurgeStatus', 'failed'),
    unregistered: Number(input.unregisteredGcCandidates || 0),
  };

  const assetV3Blockers = [];
  if (missing.length > 0) assetV3Blockers.push('missing-migrations');
  if (checksumMismatches.length > 0) assetV3Blockers.push('migration-checksum-mismatch');
  if (unmigratedProjects > 0) assetV3Blockers.push('unmigrated-projects');
  if (mismatchedProjects > 0 || orphanGraphProjects > 0 || failedCheckpoints > 0 || missingCheckpoints > 0 || legacyFacts.invalidLegacyRecords > 0) assetV3Blockers.push('shadow-projection-drift');
  if (
    media.pendingPersist > 0 || media.missing > 0 || media.recovering > 0 || media.unrecoverable > 0
    || media.activeAssetsMissingCurrentVersion > 0 || media.placementPendingPersist > 0
    || media.placementMissing > 0 || media.placementRecovering > 0 || media.placementUnrecoverable > 0
  ) {
    assetV3Blockers.push('non-ready-current-media');
  }
  if (gc.purged > 0 || gc.due > 0 || gc.physicalDeferred > 0 || gc.physicalFailed > 0 || gc.unregistered > 0) {
    assetV3Blockers.push('gc-governance-not-closed');
  }

  return {
    mode: input.mode,
    migrations: {
      required: STAGE_2_MIGRATIONS.length,
      verified: STAGE_2_MIGRATIONS.length - missing.length - checksumMismatches.length,
      missing,
      checksumMismatches,
      entries: input.migrations,
    },
    shadowComparison: {
      legacyProjects: legacyProjects.size,
      graphProjects: activeGraphProjects.size,
      matchingProjects,
      mismatchedProjects,
      unmigratedProjects,
      orphanGraphProjects,
      failedCheckpoints,
      missingCheckpoints,
      invalidLegacyRecords: legacyFacts.invalidLegacyRecords,
    },
    media,
    assets,
    gc,
    assetV3Blockers,
    releaseReady: assetV3Blockers.length === 0,
  };
}

async function migrationFacts(client, migrationsDirectory) {
  const ledgerRows = (await client.query(
    `SELECT version, checksum FROM wujie_schema_migrations WHERE version = ANY($1::text[])`,
    [STAGE_2_MIGRATIONS],
  )).rows;
  const ledger = new Map(ledgerRows.map(row => [row.version, row.checksum]));
  return Promise.all(STAGE_2_MIGRATIONS.map(async version => {
    const bytes = await readFile(resolve(migrationsDirectory, version));
    return {
      version,
      expectedChecksum: createHash('sha256').update(bytes).digest('hex'),
      recordedChecksum: ledger.get(version) ?? null,
    };
  }));
}

export async function collectAssetGraphDoctorFacts(client, options = {}) {
  const migrationsDirectory = options.migrationsDirectory ?? resolve(process.cwd(), 'migrations');
  const [
    migrations,
    legacyProjectRows,
    graphProjects,
    placements,
    checkpoints,
    currentVersionAvailability,
    activeAssetsMissingCurrentVersion,
    activePlacementVersionAvailability,
    assetStatuses,
    gcStatuses,
    unregisteredGcCandidates,
  ] = await Promise.all([
    migrationFacts(client, migrationsDirectory),
    client.query(`SELECT user_id AS "userId", data_value AS projects FROM wujie_user_data WHERE data_key = 'projects'`),
    client.query(`SELECT owner_id AS "ownerId", id AS "projectId", status FROM wujie_projects`),
    client.query(`SELECT owner_id AS "ownerId", project_id AS "projectId", entity_id AS "entityId", status
                  FROM wujie_workspace_placements
                  WHERE workspace_kind = 'canvas' AND entity_type = 'canvas-image'`),
    client.query(`SELECT owner_id AS "ownerId", project_id AS "projectId", status, error_code AS "errorCode"
                  FROM wujie_asset_migration_checkpoints`),
    client.query(`SELECT version.availability, COUNT(*)::int AS count
                  FROM wujie_assets asset
                  JOIN wujie_asset_versions version
                    ON version.id = asset.current_version_id
                   AND version.asset_id = asset.id
                   AND version.owner_id = asset.owner_id
                   AND version.project_id = asset.project_id
                  WHERE asset.status = 'active'
                  GROUP BY version.availability`),
    client.query(`SELECT COUNT(*)::int AS count FROM wujie_assets WHERE status = 'active' AND current_version_id IS NULL`),
    client.query(`SELECT version.availability, COUNT(*)::int AS count
                  FROM wujie_workspace_placements placement
                  JOIN wujie_asset_versions version
                    ON version.id = placement.asset_version_id
                   AND version.asset_id = placement.asset_id
                   AND version.owner_id = placement.owner_id
                   AND version.project_id = placement.project_id
                  WHERE placement.status = 'active'
                  GROUP BY version.availability`),
    client.query(`SELECT status, COUNT(*)::int AS count FROM wujie_assets GROUP BY status`),
    client.query(`SELECT status, physical_purge_status AS "physicalPurgeStatus", (not_before <= now()) AS due, COUNT(*)::int AS count
                  FROM wujie_media_gc_candidates
                  GROUP BY status, physical_purge_status, (not_before <= now())`),
    client.query(`SELECT COUNT(*)::int AS count
                  FROM wujie_assets asset
                  WHERE asset.status = 'trashed'
                    AND NOT EXISTS (
                      SELECT 1 FROM wujie_workspace_placements placement
                      WHERE placement.asset_id = asset.id
                        AND placement.owner_id = asset.owner_id
                        AND placement.project_id = asset.project_id
                        AND placement.status = 'active'
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM wujie_media_gc_candidates candidate
                      WHERE candidate.asset_id = asset.id
                        AND candidate.owner_id = asset.owner_id
                        AND candidate.project_id = asset.project_id
                    )`),
  ]);
  return {
    mode: options.mode ?? 'legacy',
    migrations,
    legacyProjectRows: legacyProjectRows.rows,
    graphProjects: graphProjects.rows,
    placements: placements.rows,
    checkpoints: checkpoints.rows,
    currentVersionAvailability: currentVersionAvailability.rows,
    activeAssetsMissingCurrentVersion: Number(activeAssetsMissingCurrentVersion.rows[0]?.count || 0),
    activePlacementVersionAvailability: activePlacementVersionAvailability.rows,
    assetStatuses: assetStatuses.rows,
    gcStatuses: gcStatuses.rows,
    unregisteredGcCandidates: Number(unregisteredGcCandidates.rows[0]?.count || 0),
  };
}
