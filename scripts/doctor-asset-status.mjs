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

const TRANSFORM_KEYS = Object.freeze([
  'x', 'y', 'width', 'height', 'originalWidth', 'originalHeight', 'rotation', 'zIndex',
]);

function normalizeLegacyUrl(value) {
  return value.startsWith('/uploads/')
    ? `/api/serve-upload/uploads/${value.slice('/uploads/'.length)}`
    : value;
}

function comparableTransform(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(TRANSFORM_KEYS
    .filter(key => source[key] !== undefined)
    .map(key => [key, source[key]]));
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
      if (!project || typeof project !== 'object' || typeof project.id !== 'string' || !project.id) {
        invalidLegacyRecords += 1;
        continue;
      }
      const schemaVersion = Object.hasOwn(project, 'schemaVersion') ? project.schemaVersion : 1;
      if (![1, 2, 3].includes(schemaVersion)) {
        invalidLegacyRecords += 1;
        continue;
      }
      const images = schemaVersion === 3 ? project.canvasImages : project.canvasImages ?? project.images;
      if (!Array.isArray(images)) {
        invalidLegacyRecords += 1;
        continue;
      }
      const ownerId = String(Object.hasOwn(project, 'userId') ? project.userId : row.userId || '');
      if (!ownerId || ownerId !== String(row.userId || '')) {
        invalidLegacyRecords += 1;
        continue;
      }
      const imageIds = new Set();
      const comparableImages = [];
      let projectInvalid = false;
      for (const image of images) {
        if (!image || typeof image !== 'object' || typeof image.id !== 'string' || !image.id
          || typeof image.url !== 'string' || imageIds.has(image.id)) {
          invalidLegacyRecords += 1;
          projectInvalid = true;
          break;
        }
        imageIds.add(image.id);
        if (image.isProcessingPlaceholder !== true) {
          comparableImages.push({
            imageId: image.id,
            url: normalizeLegacyUrl(image.url),
            transform: comparableTransform(image),
          });
        }
      }
      if (projectInvalid) continue;
      comparableImages.sort((left, right) => left.imageId.localeCompare(right.imageId));
      projects.set(projectKey(ownerId, project.id), {
        ownerId,
        projectId: project.id,
        sourceSchemaVersion: schemaVersion,
        images: comparableImages,
      });
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
    .filter(row => row.status === 'active' && Number(row.schemaVersion) === 3)
    .map(row => projectKey(row.ownerId, row.projectId)));
  const nonV3GraphProjects = input.graphProjects
    .filter(row => row.status === 'active' && Number(row.schemaVersion) !== 3)
    .length;
  const placementsByProject = new Map();
  for (const row of input.placements.filter(row => row.status === 'active')) {
    const key = projectKey(row.ownerId, row.projectId);
    const placements = placementsByProject.get(key) ?? new Map();
    placements.set(String(row.entityId), row);
    placementsByProject.set(key, placements);
  }

  const validCheckpoints = new Map();
  for (const row of input.checkpoints) {
    if (row.status !== 'completed' || row.errorCode || row.legacyProjectId !== row.projectId) continue;
    validCheckpoints.set(projectKey(row.ownerId, row.projectId), row);
  }

  let matchingProjects = 0;
  let mismatchedProjects = 0;
  let unmigratedProjects = 0;
  for (const [key, project] of legacyProjects) {
    if (!activeGraphProjects.has(key)) {
      unmigratedProjects += 1;
      continue;
    }
    const placements = placementsByProject.get(key) ?? new Map();
    const checkpoint = validCheckpoints.get(key);
    const mappings = checkpoint?.checkpoint?.legacyImageMappings;
    const matches = Boolean(
      checkpoint
      && Number(checkpoint.checkpoint?.sourceSchemaVersion) === project.sourceSchemaVersion
      && mappings
      && typeof mappings === 'object'
      && !Array.isArray(mappings),
    )
      && placements.size === project.images.length
      && project.images.every(image => {
        const placement = placements.get(image.imageId);
        const mapping = mappings[image.imageId];
        if (!placement || !mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return false;
        const identityMatches = placement.placementId === mapping.placementId
          && placement.assetId === mapping.assetId
          && placement.assetVersionId === mapping.versionId;
        const urlMatches = image.url.startsWith('data:') || image.url.startsWith('blob:')
          || placement.fileUrl === image.url;
        return identityMatches && urlMatches
          && JSON.stringify(comparableTransform(placement.transform)) === JSON.stringify(image.transform);
      });
    if (matches) matchingProjects += 1;
    else mismatchedProjects += 1;
  }
  const failedCheckpoints = input.checkpoints.filter(row => row.status !== 'completed' || row.errorCode).length;
  const missingCheckpoints = [...legacyProjects.keys()].filter(key => activeGraphProjects.has(key) && !validCheckpoints.has(key)).length;
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
  if (mismatchedProjects > 0 || orphanGraphProjects > 0 || nonV3GraphProjects > 0 || failedCheckpoints > 0 || missingCheckpoints > 0 || legacyFacts.invalidLegacyRecords > 0) assetV3Blockers.push('shadow-projection-drift');
  if (
    media.pendingPersist > 0 || media.missing > 0 || media.recovering > 0 || media.unrecoverable > 0
    || media.activeAssetsMissingCurrentVersion > 0 || media.placementPendingPersist > 0
    || media.placementMissing > 0 || media.placementRecovering > 0 || media.placementUnrecoverable > 0
  ) {
    assetV3Blockers.push('non-ready-current-media');
  }
  if (gc.purged > 0 || gc.physicalFailed > 0 || gc.unregistered > 0) {
    assetV3Blockers.push('gc-governance-not-closed');
  }
  if ((input.queryErrors || []).length > 0) assetV3Blockers.push('asset-facts-unavailable');

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
      nonV3GraphProjects,
      failedCheckpoints,
      missingCheckpoints,
      invalidLegacyRecords: legacyFacts.invalidLegacyRecords,
    },
    media,
    assets,
    gc,
    queryErrors: input.queryErrors || [],
    assetV3Blockers,
    releaseReady: assetV3Blockers.length === 0,
  };
}

async function migrationFacts(client, migrationsDirectory, queryErrors) {
  let ledgerRows = [];
  try {
    ledgerRows = (await client.query(
      `SELECT version, checksum FROM wujie_schema_migrations WHERE version = ANY($1::text[])`,
      [STAGE_2_MIGRATIONS],
    )).rows;
  } catch (error) {
    queryErrors.push(`migration-ledger: ${error instanceof Error ? error.message : String(error)}`);
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
  const queryErrors = [];
  const query = async (label, sql, values) => {
    try {
      return await client.query(sql, values);
    } catch (error) {
      queryErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return { rows: [] };
    }
  };
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
    migrationFacts(client, migrationsDirectory, queryErrors),
    query('legacy-projects', `SELECT user_id AS "userId", data_value AS projects FROM wujie_user_data WHERE data_key = 'projects'`),
    query('graph-projects', `SELECT owner_id AS "ownerId", id AS "projectId", status, schema_version AS "schemaVersion" FROM wujie_projects`),
    query('canvas-placements', `SELECT placement.owner_id AS "ownerId", placement.project_id AS "projectId",
                         placement.id AS "placementId", placement.entity_id AS "entityId", placement.status,
                         placement.asset_id AS "assetId", placement.asset_version_id AS "assetVersionId",
                         placement.transform, version.file_url AS "fileUrl"
                  FROM wujie_workspace_placements placement
                  JOIN wujie_asset_versions version
                    ON version.id = placement.asset_version_id
                   AND version.asset_id = placement.asset_id
                   AND version.owner_id = placement.owner_id
                   AND version.project_id = placement.project_id
                  WHERE placement.workspace_kind = 'canvas' AND placement.entity_type = 'canvas-image'`),
    query('migration-checkpoints', `SELECT owner_id AS "ownerId", project_id AS "projectId", legacy_project_id AS "legacyProjectId",
                         status, checkpoint, error_code AS "errorCode"
                  FROM wujie_asset_migration_checkpoints`),
    query('current-version-availability', `SELECT version.availability, COUNT(*)::int AS count
                  FROM wujie_assets asset
                  JOIN wujie_asset_versions version
                    ON version.id = asset.current_version_id
                   AND version.asset_id = asset.id
                   AND version.owner_id = asset.owner_id
                   AND version.project_id = asset.project_id
                  WHERE asset.status = 'active'
                  GROUP BY version.availability`),
    query('active-assets-missing-current-version', `SELECT COUNT(*)::int AS count FROM wujie_assets WHERE status = 'active' AND current_version_id IS NULL`),
    query('active-placement-version-availability', `SELECT version.availability, COUNT(*)::int AS count
                  FROM wujie_workspace_placements placement
                  JOIN wujie_asset_versions version
                    ON version.id = placement.asset_version_id
                   AND version.asset_id = placement.asset_id
                   AND version.owner_id = placement.owner_id
                   AND version.project_id = placement.project_id
                  WHERE placement.status = 'active'
                  GROUP BY version.availability`),
    query('asset-statuses', `SELECT status, COUNT(*)::int AS count FROM wujie_assets GROUP BY status`),
    query('gc-statuses', `SELECT status, physical_purge_status AS "physicalPurgeStatus", (not_before <= now()) AS due, COUNT(*)::int AS count
                  FROM wujie_media_gc_candidates
                  GROUP BY status, physical_purge_status, (not_before <= now())`),
    query('unregistered-gc-candidates', `SELECT COUNT(*)::int AS count
                  FROM wujie_assets asset
                  WHERE asset.status = 'trashed'
                    AND EXISTS (
                      SELECT 1 FROM wujie_asset_versions version
                      WHERE version.asset_id = asset.id
                        AND version.owner_id = asset.owner_id
                        AND version.project_id = asset.project_id
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM wujie_asset_versions version
                      WHERE version.asset_id = asset.id
                        AND version.owner_id = asset.owner_id
                        AND version.project_id = asset.project_id
                        AND version.storage_key IS NULL
                        AND version.file_url NOT LIKE '/api/serve-upload/%'
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM wujie_workspace_placements placement
                      WHERE placement.asset_id = asset.id
                        AND placement.owner_id = asset.owner_id
                        AND placement.project_id = asset.project_id
                        AND placement.status = 'active'
                    )
                    AND EXISTS (
                      SELECT 1 FROM wujie_asset_migration_checkpoints checkpoint
                      WHERE checkpoint.owner_id = asset.owner_id
                        AND checkpoint.project_id = asset.project_id
                        AND checkpoint.legacy_project_id = asset.project_id
                        AND checkpoint.status = 'completed'
                        AND checkpoint.error_code IS NULL
                    )
                    AND EXISTS (
                      SELECT 1 FROM wujie_user_data ownership
                      CROSS JOIN LATERAL jsonb_array_elements(
                        CASE WHEN jsonb_typeof(ownership.data_value) = 'array' THEN ownership.data_value ELSE '[]'::jsonb END
                      ) legacy_project(value)
                      WHERE ownership.user_id = asset.owner_id
                        AND ownership.data_key = 'projects'
                        AND legacy_project.value->>'id' = asset.project_id
                        AND (
                          NOT legacy_project.value ? 'userId'
                          OR legacy_project.value->>'userId' = asset.owner_id
                        )
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM wujie_asset_versions version
                      JOIN wujie_user_data legacy_data
                        ON legacy_data.data_key IN ('projects', 'workflows', 'workflow', 'chat', 'chat-history', 'simple-chat')
                       AND legacy_data.data_value::text LIKE '%' || version.file_url || '%'
                      WHERE version.asset_id = asset.id
                        AND version.owner_id = asset.owner_id
                        AND version.project_id = asset.project_id
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM wujie_asset_versions version
                      JOIN wujie_asset_versions peer
                        ON (version.storage_key IS NOT NULL AND peer.storage_key = version.storage_key)
                        OR peer.file_url = version.file_url
                      WHERE version.asset_id = asset.id
                        AND version.owner_id = asset.owner_id
                        AND version.project_id = asset.project_id
                        AND (peer.asset_id, peer.owner_id, peer.project_id) <>
                            (version.asset_id, version.owner_id, version.project_id)
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
    queryErrors,
  };
}
