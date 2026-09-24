import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { DocumentAccessError, assertDocumentEditor } from '@/lib/collaboration/document-access';
import { DocumentAssetError } from '@/lib/collaboration/document-assets';
import { getAdvisoryLockPool, getPool } from '@/lib/db-client';

import { persistAssetBytes, type PersistedAssetFile } from './binary-persistence';
import { readManagedAssetVersionBytes } from './managed-media-read';
import { lockAssetGraphWriteGate } from './storage';
import type { AssetVersion } from './types';

export interface AdoptCompletedResultInput {
  actorId: string;
  ownerId: string;
  projectId: string;
  taskId: string;
  sourceVersionId: string;
  idempotencyKey: string;
}

export interface AdoptCompletedResult {
  assetVersionId: string;
  placementId: string;
}

interface AdoptionRow {
  actor_id: string;
  target_owner_id: string;
  target_project_id: string;
  task_id: string;
  source_version_id: string;
  target_version_id: string;
  placement_id: string;
  idempotency_key: string;
}

interface SourceVersionRow {
  id: string;
  asset_id: string;
  owner_id: string;
  project_id: string;
  kind: string;
  file_url: string;
  storage_key: string | null;
  checksum: string | null;
  mime_type: string | null;
  byte_size: string | null;
  width: number | null;
  height: number | null;
  availability: string;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

async function acquireAdoptionLocks(
  pool: Pool,
  keys: string[],
  onError: (error: Error) => void,
): Promise<PoolClient> {
  const deadline = Date.now() + 30_000;
  while (true) {
    const candidate = await pool.connect();
    candidate.on('error', onError);
    const acquired: string[] = [];
    try {
      for (const key of keys) {
        const result = await candidate.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
          [key],
        );
        if (result.rows[0]?.acquired !== true) break;
        acquired.push(key);
      }
      if (acquired.length === keys.length) return candidate;
      for (const key of [...acquired].reverse()) {
        const released = await candidate.query<{ released: boolean }>(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released',
          [key],
        );
        if (released.rows[0]?.released !== true) throw new Error('CANVAS_ADOPTION_LOCK_RELEASE_FAILED');
      }
      candidate.release();
      candidate.off('error', onError);
    } catch (error) {
      // A query error can occur after PostgreSQL took a session lock but
      // before the acknowledgement arrived. Never reuse that session.
      candidate.release(true);
      candidate.off('error', onError);
      throw error;
    }
    if (Date.now() >= deadline) throw new Error('CANVAS_ADOPTION_LOCK_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function findExistingAdoption(
  client: PoolClient,
  input: AdoptCompletedResultInput,
): Promise<AdoptCompletedResult | null> {
  const existing = await client.query<AdoptionRow>(
    `SELECT actor_id, target_owner_id, target_project_id, task_id,
            source_version_id, target_version_id, placement_id, idempotency_key
       FROM wujie_canvas_asset_adoptions
      WHERE actor_id = $1 AND target_project_id = $2
        AND (idempotency_key = $3 OR (task_id = $4 AND source_version_id = $5))
      FOR SHARE`,
    [input.actorId, input.projectId, input.idempotencyKey, input.taskId, input.sourceVersionId],
  );
  for (const row of existing.rows) {
    if (
      row.target_owner_id !== input.ownerId
      || (row.idempotency_key === input.idempotencyKey
        && (row.task_id !== input.taskId || row.source_version_id !== input.sourceVersionId))
    ) throw new DocumentAssetError();
  }
  const row = existing.rows[0];
  return row ? { assetVersionId: row.target_version_id, placementId: row.placement_id } : null;
}

function mapSourceVersion(row: SourceVersionRow): AssetVersion {
  return {
    id: row.id,
    assetId: row.asset_id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    file: {
      url: row.file_url,
      availability: 'ready',
      ...(row.storage_key ? { storageKey: row.storage_key } : {}),
      ...(row.checksum ? { checksum: row.checksum } : {}),
      ...(row.mime_type ? { mimeType: row.mime_type } : {}),
      ...(row.byte_size ? { byteSize: Number(row.byte_size) } : {}),
      ...(row.width !== null ? { width: row.width } : {}),
      ...(row.height !== null ? { height: row.height } : {}),
    },
    parentVersionIds: [],
    createdAt: new Date(0).toISOString(),
  };
}

async function loadCompletedSource(
  client: PoolClient,
  input: AdoptCompletedResultInput,
  lockRows: boolean,
): Promise<SourceVersionRow> {
  const task = await client.query<{ project_id: string; status: string }>(
    `SELECT project_id, status FROM cloud_tasks
      WHERE id = $1 AND user_id = $2 ${lockRows ? 'FOR SHARE' : ''}`,
    [input.taskId, input.actorId],
  );
  if (task.rows[0]?.status !== 'completed') throw new DocumentAssetError();

  const source = await client.query<SourceVersionRow>(
    `SELECT version.id, version.asset_id, version.owner_id, version.project_id,
            version.file_url, version.storage_key, version.checksum,
            version.mime_type, version.byte_size, version.width, version.height,
            version.availability, asset.kind
       FROM wujie_asset_versions version
       JOIN wujie_assets asset
         ON asset.id = version.asset_id AND asset.owner_id = version.owner_id
        AND asset.project_id = version.project_id
       JOIN wujie_projects project
         ON project.id = asset.project_id AND project.owner_id = asset.owner_id
      WHERE version.id = $1 AND version.owner_id = $2 AND version.task_id = $3
        AND version.availability = 'ready' AND asset.status = 'active'
        AND asset.kind = 'image' AND project.status = 'active'
      ${lockRows ? 'FOR SHARE OF version, asset, project' : ''}`,
    [input.sourceVersionId, input.actorId, input.taskId],
  );
  const sourceRow = source.rows[0];
  if (!sourceRow || (task.rows[0].project_id
    && sourceRow.project_id !== task.rows[0].project_id)) {
    throw new DocumentAssetError();
  }
  return sourceRow;
}

export async function adoptCompletedResultIntoProject(
  input: AdoptCompletedResultInput,
): Promise<AdoptCompletedResult> {
  if (![input.actorId, input.ownerId, input.projectId, input.taskId,
    input.sourceVersionId, input.idempotencyKey].every(validId)) {
    throw new DocumentAssetError();
  }
  const pool = getPool();
  const lockPool = getAdvisoryLockPool();
  let client: PoolClient | null = null;
  let lockClient: PoolClient | null = null;
  let lockFailure: Error | null = null;
  const onLockError = (error: Error): void => { lockFailure = error; };
  let persisted: PersistedAssetFile | null = null;
  let commitAttempted = false;
  let commitAcked = false;
  const lockKeys = [
    `canvas-adoption-key:${input.actorId}:${input.projectId}:${input.idempotencyKey}`,
    `canvas-adoption-source:${input.actorId}:${input.projectId}:${input.taskId}:${input.sourceVersionId}`,
  ].sort();
  const acquiredLocks: string[] = [];
  try {
    // Reject unauthorized callers before occupying the per-adoption session lock.
    const preflightAccess = await assertDocumentEditor(input.actorId, input.projectId);
    if (preflightAccess.ownerId !== input.ownerId) throw new DocumentAccessError();
    lockClient = await acquireAdoptionLocks(lockPool, lockKeys, onLockError);
    if (lockFailure) throw new Error('CANVAS_ADOPTION_LOCK_LOST', { cause: lockFailure });
    acquiredLocks.push(...lockKeys);
    client = await pool.connect();

    // A short transaction checks current authorization and completed replay.
    // It ends before any media I/O, so revocation never waits for an upload.
    await client.query('BEGIN');
    const firstAccess = await assertDocumentEditor(input.actorId, input.projectId, client);
    if (firstAccess.ownerId !== input.ownerId) throw new DocumentAccessError();
    const existing = await findExistingAdoption(client, input);
    await client.query('COMMIT');
    if (existing) return existing;

    const preflightSource = await loadCompletedSource(client, input, false);
    client.release();
    client = null;
    const mimeType = preflightSource.mime_type;
    const extension = mimeType === 'image/png' ? '.png'
      : mimeType === 'image/jpeg' ? '.jpg'
        : mimeType === 'image/webp' ? '.webp' : null;
    if (!mimeType || !extension) throw new DocumentAssetError();
    try {
      const media = await readManagedAssetVersionBytes(mapSourceVersion(preflightSource), 'image');
      if (preflightSource.checksum
        && createHash('sha256').update(media.bytes).digest('hex') !== preflightSource.checksum) {
        throw new DocumentAssetError();
      }
      persisted = await persistAssetBytes({
        bytes: media.bytes, filename: `adopted${extension}`, mimeType,
      });
    } catch {
      throw new DocumentAssetError();
    }

    if (lockFailure) throw new Error('CANVAS_ADOPTION_LOCK_LOST', { cause: lockFailure });
    try {
      await lockClient.query('SELECT 1');
    } catch (error) {
      lockFailure = error instanceof Error ? error : new Error(String(error));
      throw new Error('CANVAS_ADOPTION_LOCK_LOST', { cause: error });
    }
    client = await pool.connect();
    await client.query('BEGIN');
    await lockAssetGraphWriteGate(client, 'shared');
    const access = await assertDocumentEditor(input.actorId, input.projectId, client);
    if (access.ownerId !== input.ownerId) throw new DocumentAccessError();

    const sourceRow = await loadCompletedSource(client, input, true);
    if (JSON.stringify(sourceRow) !== JSON.stringify(preflightSource)) {
      throw new DocumentAssetError();
    }

    const assetId = randomUUID();
    const versionId = randomUUID();
    const placementId = randomUUID();
    const adoptionId = randomUUID();
    const digest = createHash('sha256').update(JSON.stringify([
      input.actorId, input.projectId, input.taskId, input.sourceVersionId,
    ])).digest('hex');
    await client.query(
      `INSERT INTO wujie_assets
         (id, owner_id, project_id, kind, status, current_version_id, metadata)
       VALUES ($1, $2, $3, 'image', 'active', NULL, $4::jsonb)`,
      [assetId, input.ownerId, input.projectId, JSON.stringify({ source: 'canvas-adoption' })],
    );
    await client.query(
      `INSERT INTO wujie_asset_versions
         (id, asset_id, owner_id, project_id, file_url, storage_key, checksum,
          mime_type, byte_size, width, height, availability, idempotency_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ready', $12, $13::jsonb)`,
      [
        versionId, assetId, input.ownerId, input.projectId, persisted.url,
        persisted.storageKey ?? null, persisted.checksum ?? null,
        persisted.mimeType ?? null, persisted.byteSize ?? null,
        sourceRow.width, sourceRow.height, `canvas-adoption:${digest}`,
        JSON.stringify({ source: 'canvas-adoption', sourceVersionId: input.sourceVersionId }),
      ],
    );
    await client.query(
      `UPDATE wujie_assets SET current_version_id = $2, updated_at = now()
        WHERE id = $1`,
      [assetId, versionId],
    );
    await client.query(
      `INSERT INTO wujie_workspace_placements
         (id, owner_id, project_id, asset_id, asset_version_id,
          workspace_kind, workspace_id, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, 'canvas', $3, 'canvas-image', $1, $6::jsonb)`,
      [placementId, input.ownerId, input.projectId, assetId, versionId,
        JSON.stringify({ source: 'canvas-adoption', adoptionId })],
    );
    await client.query(
      `INSERT INTO wujie_canvas_asset_adoptions
         (id, actor_id, target_owner_id, target_project_id, task_id,
          source_owner_id, source_project_id, source_version_id,
          target_version_id, placement_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $2, $6, $7, $8, $9, $10)`,
      [adoptionId, input.actorId, input.ownerId, input.projectId, input.taskId,
        sourceRow.project_id, input.sourceVersionId, versionId, placementId, input.idempotencyKey],
    );
    if (lockFailure) throw new Error('CANVAS_ADOPTION_LOCK_LOST', { cause: lockFailure });
    commitAttempted = true;
    await client.query('COMMIT');
    commitAcked = true;
    return { assetVersionId: versionId, placementId };
  } catch (error) {
    if (commitAttempted && !commitAcked) {
      // A lost COMMIT acknowledgement is not proof of rollback. Never delete
      // the persisted copy until the committed adoption has been ruled out.
      client?.release(true);
      client = null;
      try {
        const resolved = await pool.query<AdoptionRow>(
          `SELECT actor_id, target_owner_id, target_project_id, task_id,
                  source_version_id, target_version_id, placement_id, idempotency_key
             FROM wujie_canvas_asset_adoptions
            WHERE actor_id = $1 AND target_project_id = $2 AND idempotency_key = $3`,
          [input.actorId, input.projectId, input.idempotencyKey],
        );
        const row = resolved.rows[0];
        if (row && row.target_owner_id === input.ownerId && row.task_id === input.taskId
          && row.source_version_id === input.sourceVersionId) {
          return { assetVersionId: row.target_version_id, placementId: row.placement_id };
        }
      } catch {
        // The database outcome remains unknown; retain media rather than risk
        // deleting an object already referenced by committed rows.
      }
      throw error;
    }
    if (client && !commitAcked) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // An unacknowledged rollback may leave a live transaction. Never
        // return that session to the business pool after media cleanup.
        client.release(true);
        client = null;
      }
    }
    if (persisted) {
      await persisted.cleanup().catch(cleanupError => {
        throw new AggregateError([error, cleanupError], 'CANVAS_ADOPTION_CLEANUP_FAILED');
      });
    }
    throw error;
  } finally {
    client?.release();
    if (lockClient) {
      let discard = lockFailure !== null;
      if (!discard) {
        for (const key of [...acquiredLocks].reverse()) {
          try {
            await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
          } catch {
            discard = true;
            break;
          }
        }
      }
      lockClient.release(discard);
      lockClient.off('error', onLockError);
    }
  }
}
