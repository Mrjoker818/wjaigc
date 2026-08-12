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
  for (const row of rows) {
    if (!Array.isArray(row.projects)) continue;
    for (const project of row.projects) {
      if (!project || typeof project !== 'object' || !project.id) continue;
      const ownerId = String(project.userId || row.userId || '');
      if (!ownerId || ownerId !== String(row.userId || '')) continue;
      const imageIds = Array.isArray(project.canvasImages)
        ? project.canvasImages
          .filter(image => image && typeof image === 'object' && image.id && image.isProcessingPlaceholder !== true)
          .map(image => String(image.id))
          .sort()
        : [];
      projects.set(projectKey(ownerId, String(project.id)), { ownerId, projectId: String(project.id), imageIds });
    }
  }
  return projects;
}

export function summarizeAssetGraphDoctor(input) {
  const migrationByVersion = new Map(input.migrations.map(row => [row.version, row]));
  const missing = STAGE_2_MIGRATIONS.filter(version => !migrationByVersion.get(version)?.recordedChecksum);
  const checksumMismatches = STAGE_2_MIGRATIONS.filter(version => {
    const row = migrationByVersion.get(version);
    return Boolean(row?.recordedChecksum && row.expectedChecksum !== row.recordedChecksum);
  });

  const legacyProjects = comparableLegacyProjects(input.legacyProjectRows);
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
  const failedCheckpoints = input.checkpoints.filter(row => row.status !== 'completed' || row.errorCode).length;
  const orphanGraphProjects = [...activeGraphProjects].filter(key => !legacyProjects.has(key)).length;

  const media = {
    ready: countRows(input.currentVersionAvailability, 'availability', 'ready'),
    pendingPersist: countRows(input.currentVersionAvailability, 'availability', 'pending-persist'),
    missing: countRows(input.currentVersionAvailability, 'availability', 'missing'),
    recovering: countRows(input.currentVersionAvailability, 'availability', 'recovering'),
    unrecoverable: countRows(input.currentVersionAvailability, 'availability', 'unrecoverable'),
  };
  const assets = {
    active: countRows(input.assetStatuses, 'status', 'active'),
    trashed: countRows(input.assetStatuses, 'status', 'trashed'),
  };
  const gc = {
    pending: countRows(input.gcStatuses, 'status', 'pending'),
    deferred: countRows(input.gcStatuses, 'status', 'deferred'),
    purged: countRows(input.gcStatuses, 'status', 'purged'),
  };

  const assetV3Blockers = [];
  if (missing.length > 0) assetV3Blockers.push('missing-migrations');
  if (checksumMismatches.length > 0) assetV3Blockers.push('migration-checksum-mismatch');
  if (unmigratedProjects > 0) assetV3Blockers.push('unmigrated-projects');
  if (mismatchedProjects > 0 || orphanGraphProjects > 0 || failedCheckpoints > 0) assetV3Blockers.push('shadow-projection-drift');
  if (media.pendingPersist > 0 || media.missing > 0 || media.recovering > 0 || media.unrecoverable > 0) {
    assetV3Blockers.push('non-ready-current-media');
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
    },
    media,
    assets,
    gc,
    assetV3Blockers,
    releaseReady: assetV3Blockers.length === 0,
  };
}

async function migrationFacts(client, migrationsDirectory) {
  let ledgerRows = [];
  try {
    ledgerRows = (await client.query(
      `SELECT version, checksum FROM wujie_schema_migrations WHERE version = ANY($1::text[])`,
      [STAGE_2_MIGRATIONS],
    )).rows;
  } catch {
    ledgerRows = [];
  }
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
    assetStatuses,
    gcStatuses,
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
    client.query(`SELECT status, COUNT(*)::int AS count FROM wujie_assets GROUP BY status`),
    client.query(`SELECT status, COUNT(*)::int AS count FROM wujie_media_gc_candidates GROUP BY status`),
  ]);
  return {
    mode: options.mode ?? 'legacy',
    migrations,
    legacyProjectRows: legacyProjectRows.rows,
    graphProjects: graphProjects.rows,
    placements: placements.rows,
    checkpoints: checkpoints.rows,
    currentVersionAvailability: currentVersionAvailability.rows,
    assetStatuses: assetStatuses.rows,
    gcStatuses: gcStatuses.rows,
  };
}
