import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';

import { getPool } from '@/lib/db-client';

import type {
  AssetFile,
  AssetKind,
  AssetVersion,
  WorkspaceAssetReference,
  WorkspaceEntityType,
  WorkspaceKind,
} from './types';

export type ProjectionTerminalStatus = 'completed' | 'failed' | 'cancelled' | 'timeout';
export type TaskProjectionMode = 'derived' | 'revision';

export interface ProjectionTask {
  id: string;
  userId: string;
  projectId?: string;
  type?: string;
  status: ProjectionTerminalStatus;
  providerId?: string;
  modelId?: string;
  result: Record<string, unknown>;
  billingTransactionId?: string;
}

export interface ProjectCompletedTaskInput {
  actorUserId: string;
  taskId: string;
  targetProjectId: string;
  workspace: WorkspaceKind;
  workspaceId?: string;
  sourceEntityId?: string;
  parentVersionIds: string[];
  projectionMode?: TaskProjectionMode;
  idempotencyKey?: string;
}

export interface TaskProjectionPendingInput {
  actorUserId: string;
  taskId: string;
  reason: string;
  retry?: Omit<ProjectCompletedTaskInput, 'actorUserId' | 'taskId'>;
}

export interface TaskLateResultAuditInput {
  actorUserId: string;
  taskId: string;
  terminalStatus: Exclude<ProjectionTerminalStatus, 'completed'>;
  urls: string[];
}

export interface TaskProjectionCompletedInput {
  actorUserId: string;
  taskId: string;
  versionIds: string[];
  references?: WorkspaceAssetReference[];
}

export interface TaskProjectionCreateInput {
  actorUserId: string;
  projectId: string;
  taskId: string;
  outputIndex: number;
  kind: AssetKind;
  file: AssetFile;
  workspace: WorkspaceKind;
  workspaceId: string;
  entityType: WorkspaceEntityType;
  entityId: string;
  idempotencyKey: string;
  requestDigest: string;
  placementIdempotencyKey?: string;
  placementRequestDigest?: string;
  providerId?: string;
  modelId?: string;
  parameters: Record<string, unknown>;
  billingTransactionId?: string;
  parentVersionIds: string[];
  projectionMode: TaskProjectionMode;
}

export interface TaskProjectionPlacementReference {
  id: string;
  entityId: string;
}

export interface LateResultAuditInput {
  actorUserId: string;
  taskId: string;
  terminalStatus: Exclude<ProjectionTerminalStatus, 'completed'>;
  urls: string[];
  digest: string;
}

export interface TaskProjectionTransaction {
  findTaskForUpdate(actorUserId: string, taskId: string): Promise<ProjectionTask | null>;
  findProject(actorUserId: string, projectId: string): Promise<boolean>;
  findSourceVersions(
    actorUserId: string,
    projectId: string,
    versionIds: string[],
  ): Promise<Array<{ id: string; assetId: string }>>;
  createProjection(input: TaskProjectionCreateInput): Promise<{
    version: AssetVersion;
    placement: TaskProjectionPlacementReference;
    reused: boolean;
  }>;
  recordLateResultAudit(input: LateResultAuditInput): Promise<void>;
}

export interface TaskProjectionRepository {
  transaction<T>(callback: (transaction: TaskProjectionTransaction) => Promise<T>): Promise<T>;
}

export interface TaskAssetProjector {
  projectCompletedTaskToAssets(input: ProjectCompletedTaskInput): Promise<{
    versions: AssetVersion[];
    placements: TaskProjectionPlacementReference[];
    reused: boolean;
  }>;
}

export class TaskProjectionError extends Error {
  constructor(readonly code:
    | 'TASK_PROJECTION_NOT_FOUND'
    | 'TASK_PROJECTION_CONFLICT'
    | 'TASK_PROJECTION_MISSING_RESULT'
  ) {
    super(code);
    this.name = 'TaskProjectionError';
  }
}

interface ProjectionVersionRow extends QueryResultRow {
  id: string;
  asset_id: string;
  owner_id: string;
  project_id: string;
  file_url: string;
  storage_key: string | null;
  checksum: string | null;
  mime_type: string | null;
  byte_size: string | null;
  width: number | null;
  height: number | null;
  availability: AssetFile['availability'];
  recovery_source_url: string | null;
  task_id: string | null;
  idempotency_key: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function outputUrls(task: ProjectionTask): string[] {
  const result = task.result;
  const kind = kindForTask(task);
  const primaryKey = kind === 'video' ? 'videoUrl' : kind === 'model-3d' ? 'assetUrl' : '';
  if (primaryKey) {
    const primary = result[primaryKey];
    if (typeof primary === 'string' && primary.length > 0) return [primary];
  }
  const list = Array.isArray(result.imageUrls)
    ? result.imageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
    : [];
  if (list.length > 0) return list;
  const nestedImages = Array.isArray(result.images)
    ? result.images.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const url = (item as Record<string, unknown>).url;
        return typeof url === 'string' && url.length > 0 ? [url] : [];
      })
    : [];
  if (nestedImages.length > 0) return nestedImages;
  if (result.image && typeof result.image === 'object') {
    const nestedUrl = (result.image as Record<string, unknown>).url;
    if (typeof nestedUrl === 'string' && nestedUrl.length > 0) return [nestedUrl];
  }
  for (const key of ['imageUrl', 'videoUrl', 'assetUrl']) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0) return [value];
  }
  return [];
}

function workspaceId(input: ProjectCompletedTaskInput): string {
  if (input.workspaceId) return input.workspaceId;
  if (input.workspace === 'workflow') return `workflow:${input.targetProjectId}`;
  if (input.workspace === 'chat') return `standalone-chat:${input.targetProjectId}`;
  return input.targetProjectId;
}

function entityType(workspace: WorkspaceKind): WorkspaceEntityType {
  if (workspace === 'workflow') return 'workflow-output';
  if (workspace === 'chat') return 'chat-result';
  return 'canvas-image';
}

function kindForTask(task: ProjectionTask): AssetKind {
  const type = (task.type || '').toLowerCase();
  if (type.includes('video')) return 'video';
  if (type.includes('3d') || type.includes('model')) return 'model-3d';
  return 'image';
}

function mimeTypeForUrl(url: string, kind: AssetKind): string | undefined {
  const path = url.split(/[?#]/, 1)[0].toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.glb')) return 'model/gltf-binary';
  if (path.endsWith('.gltf')) return 'model/gltf+json';
  return kind === 'image' ? 'image/png' : undefined;
}

function parametersForTask(task: ProjectionTask): Record<string, unknown> {
  const payload = task.result.submissionPayload;
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? structuredClone(payload as Record<string, unknown>)
    : {};
}

function mapVersion(row: ProjectionVersionRow, parentVersionIds: string[]): AssetVersion {
  return {
    id: row.id,
    assetId: row.asset_id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    file: {
      url: row.file_url,
      availability: row.availability,
      ...(row.storage_key ? { storageKey: row.storage_key } : {}),
      ...(row.checksum ? { checksum: row.checksum } : {}),
      ...(row.mime_type ? { mimeType: row.mime_type } : {}),
      ...(row.byte_size === null ? {} : { byteSize: Number(row.byte_size) }),
      ...(row.width === null ? {} : { width: row.width }),
      ...(row.height === null ? {} : { height: row.height }),
      ...(row.recovery_source_url ? { recoverySourceUrl: row.recovery_source_url } : {}),
    },
    parentVersionIds,
    ...(row.task_id ? { taskId: row.task_id } : {}),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

class PostgresTaskProjectionTransaction implements TaskProjectionTransaction {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async findTaskForUpdate(actorUserId: string, taskId: string): Promise<ProjectionTask | null> {
    const result = await this.client.query<{
      id: string;
      user_id: string;
      project_id: string | null;
      type: string;
      status: ProjectionTerminalStatus;
      provider_id: string | null;
      model: string | null;
      result: Record<string, unknown>;
      charged_transaction_id: string | null;
    }>(
      `SELECT id, user_id, project_id, type, status, provider_id, model, result,
              charged_transaction_id
       FROM cloud_tasks
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [taskId, actorUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      type: row.type,
      status: row.status,
      ...(row.provider_id ? { providerId: row.provider_id } : {}),
      ...(row.model ? { modelId: row.model } : {}),
      result: row.result || {},
      ...(row.charged_transaction_id
        ? { billingTransactionId: row.charged_transaction_id }
        : {}),
    };
  }

  async findProject(actorUserId: string, projectId: string): Promise<boolean> {
    const result = await this.client.query(
      `SELECT 1 FROM wujie_projects
       WHERE id = $1 AND owner_id = $2 AND status = 'active'`,
      [projectId, actorUserId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async findSourceVersions(
    actorUserId: string,
    projectId: string,
    versionIds: string[],
  ): Promise<Array<{ id: string; assetId: string }>> {
    if (versionIds.length === 0) return [];
    const result = await this.client.query<{ id: string; asset_id: string }>(
      `SELECT id, asset_id FROM wujie_asset_versions
       WHERE owner_id = $1 AND project_id = $2 AND id = ANY($3::text[])`,
      [actorUserId, projectId, versionIds],
    );
    const byId = new Map(result.rows.map(row => [row.id, row.asset_id]));
    return versionIds.flatMap(id => {
      const assetId = byId.get(id);
      return assetId ? [{ id, assetId }] : [];
    });
  }

  async createProjection(input: TaskProjectionCreateInput): Promise<{
    version: AssetVersion;
    placement: TaskProjectionPlacementReference;
    reused: boolean;
  }> {
    await this.client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`task-asset-projection:${input.actorUserId}:${input.idempotencyKey}`],
    );

    const existingResult = await this.client.query<ProjectionVersionRow>(
      `SELECT * FROM wujie_asset_versions
       WHERE owner_id = $1 AND project_id = $2 AND idempotency_key = $3
       FOR UPDATE`,
      [input.actorUserId, input.projectId, input.idempotencyKey],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      if (
        existing.task_id !== input.taskId
        || existing.metadata?.projectionDigest !== input.requestDigest
      ) {
        throw new TaskProjectionError('TASK_PROJECTION_CONFLICT');
      }
      const placement = await this.ensurePlacement(input, existing.asset_id, existing.id);
      const parents = Array.isArray(existing.metadata?.sourceVersionIds)
        ? existing.metadata.sourceVersionIds.filter((id): id is string => typeof id === 'string')
        : [];
      return { version: mapVersion(existing, parents), placement, reused: true };
    }

    const sources = await this.findSourceVersions(
      input.actorUserId,
      input.projectId,
      input.parentVersionIds,
    );
    if (sources.length !== input.parentVersionIds.length) {
      throw new TaskProjectionError('TASK_PROJECTION_NOT_FOUND');
    }
    const sourceAssetIds = Array.from(new Set(sources.map(source => source.assetId)));
    const revisesSource = input.projectionMode === 'revision';
    const lineageParentIds = revisesSource ? input.parentVersionIds : [];
    const assetId = revisesSource ? sourceAssetIds[0] : randomUUID();
    const createdAt = new Date().toISOString();

    if (revisesSource) {
      const locked = await this.client.query(
        `SELECT 1 FROM wujie_assets
         WHERE id = $1 AND owner_id = $2 AND project_id = $3
         FOR UPDATE`,
        [assetId, input.actorUserId, input.projectId],
      );
      if ((locked.rowCount ?? 0) !== 1) throw new TaskProjectionError('TASK_PROJECTION_NOT_FOUND');
    } else {
      await this.client.query(
        `INSERT INTO wujie_assets(
          id, owner_id, project_id, kind, status, current_version_id, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'active', NULL, $5::jsonb, $6, $6)`,
        [assetId, input.actorUserId, input.projectId, input.kind, JSON.stringify({ source: 'task-projection' }), createdAt],
      );
    }

    const versionId = randomUUID();
    const metadata = {
      source: 'task-projection',
      projectionDigest: input.requestDigest,
      outputIndex: input.outputIndex,
      outputDigest: stableDigest(input.file.url),
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      parameters: input.parameters,
      billingTransactionId: input.billingTransactionId ?? null,
      sourceVersionIds: input.parentVersionIds,
      projectionMode: input.projectionMode,
      lineageMode: lineageParentIds.length === input.parentVersionIds.length
        ? 'asset-parent'
        : 'ordered-source-metadata',
    };
    const inserted = await this.client.query<ProjectionVersionRow>(
      `INSERT INTO wujie_asset_versions(
        id, asset_id, owner_id, project_id, file_url, storage_key, checksum, mime_type,
        byte_size, width, height, availability, recovery_source_url, task_id, provider_id,
        model_id, idempotency_key, metadata, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18::jsonb, $19
      ) RETURNING *`,
      [
        versionId, assetId, input.actorUserId, input.projectId, input.file.url,
        input.file.storageKey ?? null, input.file.checksum ?? null, input.file.mimeType ?? null,
        input.file.byteSize ?? null, input.file.width ?? null, input.file.height ?? null,
        input.file.availability, input.file.recoverySourceUrl ?? null, input.taskId,
        input.providerId ?? null, input.modelId ?? null, input.idempotencyKey,
        JSON.stringify(metadata), createdAt,
      ],
    );

    for (const [parentOrder, parentVersionId] of lineageParentIds.entries()) {
      await this.client.query(
        `INSERT INTO wujie_asset_version_parents(
          asset_id, owner_id, project_id, version_id, parent_version_id, parent_order
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [assetId, input.actorUserId, input.projectId, versionId, parentVersionId, parentOrder],
      );
    }
    await this.client.query(
      `UPDATE wujie_assets
       SET current_version_id = $4, status = 'active', updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND project_id = $3`,
      [assetId, input.actorUserId, input.projectId, versionId],
    );
    const placement = await this.ensurePlacement(input, assetId, versionId);
    return {
      version: mapVersion(inserted.rows[0], input.parentVersionIds),
      placement,
      reused: false,
    };
  }

  async recordLateResultAudit(input: LateResultAuditInput): Promise<void> {
    const audit = {
      status: 'isolated',
      terminalStatus: input.terminalStatus,
      urls: input.urls,
      digest: input.digest,
      recordedAt: new Date().toISOString(),
    };
    await this.client.query(
      `UPDATE cloud_tasks
       SET result = jsonb_set(COALESCE(result, '{}'::jsonb), '{assetProjectionLateAudit}', $3::jsonb, true)
       WHERE id = $1 AND user_id = $2
         AND status IN ('failed', 'cancelled', 'timeout')
         AND COALESCE(result->'assetProjectionLateAudit'->>'digest', '') <> $4`,
      [input.taskId, input.actorUserId, JSON.stringify(audit), input.digest],
    );
  }

  private async ensurePlacement(
    input: TaskProjectionCreateInput,
    assetId: string,
    versionId: string,
  ): Promise<TaskProjectionPlacementReference> {
    if (input.placementIdempotencyKey) {
      await this.client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`task-placement:${input.actorUserId}:${input.placementIdempotencyKey}`],
      );
      const bound = await this.client.query<{
        id: string;
        project_id: string;
        asset_version_id: string;
        workspace_kind: WorkspaceKind;
        workspace_id: string;
        entity_type: WorkspaceEntityType;
        entity_id: string;
        request_digest: string | null;
      }>(
        `SELECT id, project_id, asset_version_id, workspace_kind, workspace_id,
                entity_type, entity_id, request_digest
         FROM wujie_workspace_placements
         WHERE owner_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.actorUserId, input.placementIdempotencyKey],
      );
      const existingBinding = bound.rows[0];
      if (existingBinding) {
        if (
          existingBinding.project_id !== input.projectId
          || existingBinding.asset_version_id !== versionId
          || existingBinding.workspace_kind !== input.workspace
          || existingBinding.workspace_id !== input.workspaceId
          || existingBinding.entity_type !== input.entityType
          || existingBinding.entity_id !== input.entityId
          || existingBinding.request_digest !== input.placementRequestDigest
        ) {
          throw new TaskProjectionError('TASK_PROJECTION_CONFLICT');
        }
        return { id: existingBinding.id, entityId: existingBinding.entity_id };
      }
    }

    const existing = await this.client.query<{
      id: string;
      asset_version_id: string;
      entity_id: string;
      idempotency_key: string | null;
    }>(
      `SELECT id, asset_version_id, entity_id, idempotency_key
       FROM wujie_workspace_placements
       WHERE owner_id = $1 AND project_id = $2 AND workspace_kind = $3
         AND workspace_id = $4 AND entity_type = $5 AND entity_id = $6
         AND status = 'active'
       FOR UPDATE`,
      [
        input.actorUserId, input.projectId, input.workspace, input.workspaceId,
        input.entityType, input.entityId,
      ],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].asset_version_id !== versionId) {
        throw new TaskProjectionError('TASK_PROJECTION_CONFLICT');
      }
      if (input.placementIdempotencyKey) {
        if (
          existing.rows[0].idempotency_key
          && existing.rows[0].idempotency_key !== input.placementIdempotencyKey
        ) {
          throw new TaskProjectionError('TASK_PROJECTION_CONFLICT');
        }
        await this.client.query(
          `UPDATE wujie_workspace_placements
           SET idempotency_key = $4, request_digest = $5, source_version_id = $6,
               metadata = metadata || $7::jsonb, updated_at = now()
           WHERE id = $1 AND owner_id = $2 AND project_id = $3
             AND (idempotency_key IS NULL OR idempotency_key = $4)`,
          [
            existing.rows[0].id,
            input.actorUserId,
            input.projectId,
            input.placementIdempotencyKey,
            input.placementRequestDigest,
            versionId,
            JSON.stringify({
              resultProjectionIdempotencyKey: input.placementIdempotencyKey,
            }),
          ],
        );
      }
      return { id: existing.rows[0].id, entityId: existing.rows[0].entity_id };
    }
    const timestamp = new Date().toISOString();
    const placementId = randomUUID();
    await this.client.query(
      `INSERT INTO wujie_workspace_placements(
        id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
        workspace_id, entity_type, entity_id, status, deleted_at, transform,
        metadata, idempotency_key, request_digest, source_version_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NULL, '{}'::jsonb,
        $10::jsonb, $11, $12, $13, $14, $14
      )`,
      [
        placementId, input.actorUserId, input.projectId, assetId, versionId,
        input.workspace, input.workspaceId, input.entityType, input.entityId,
        JSON.stringify({
          source: 'task-projection',
          taskId: input.taskId,
          outputIndex: input.outputIndex,
          ...(input.placementIdempotencyKey
            ? { resultProjectionIdempotencyKey: input.placementIdempotencyKey }
            : {}),
        }),
        input.placementIdempotencyKey ?? null,
        input.placementRequestDigest ?? null,
        input.placementIdempotencyKey ? versionId : null,
        timestamp,
      ],
    );
    return { id: placementId, entityId: input.entityId };
  }
}

class PostgresTaskProjectionRepository implements TaskProjectionRepository {
  async transaction<T>(callback: (transaction: TaskProjectionTransaction) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await callback(new PostgresTaskProjectionTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createTaskAssetProjector(
  repository: TaskProjectionRepository = new PostgresTaskProjectionRepository(),
): TaskAssetProjector {
  return {
    async projectCompletedTaskToAssets(input) {
      if (
        !input.actorUserId
        || !input.taskId
        || !input.targetProjectId
        || input.parentVersionIds.length > 32
      ) {
        throw new TaskProjectionError('TASK_PROJECTION_NOT_FOUND');
      }
      return repository.transaction(async (transaction) => {
        const task = await transaction.findTaskForUpdate(input.actorUserId, input.taskId);
        if (
          !task
          || (task.projectId && task.projectId !== input.targetProjectId)
          || !await transaction.findProject(input.actorUserId, input.targetProjectId)
        ) {
          throw new TaskProjectionError('TASK_PROJECTION_NOT_FOUND');
        }
        const urls = outputUrls(task);
        if (task.status !== 'completed') {
          if (urls.length > 0) {
            const terminalStatus = task.status as Exclude<ProjectionTerminalStatus, 'completed'>;
            await transaction.recordLateResultAudit({
              actorUserId: input.actorUserId,
              taskId: task.id,
              terminalStatus,
              urls,
              digest: stableDigest({ terminalStatus, urls }),
            });
          }
          return { versions: [], placements: [], reused: false };
        }
        if (urls.length === 0) {
          throw new TaskProjectionError('TASK_PROJECTION_MISSING_RESULT');
        }
        const projectionMode = input.projectionMode ?? 'derived';
        if (
          projectionMode === 'revision'
          && (input.parentVersionIds.length !== 1 || urls.length !== 1)
        ) {
          throw new TaskProjectionError('TASK_PROJECTION_CONFLICT');
        }

        const sources = await transaction.findSourceVersions(
          input.actorUserId,
          input.targetProjectId,
          input.parentVersionIds,
        );
        if (
          sources.length !== input.parentVersionIds.length
          || sources.some((source, index) => source.id !== input.parentVersionIds[index])
        ) {
          throw new TaskProjectionError('TASK_PROJECTION_NOT_FOUND');
        }

        const projected: AssetVersion[] = [];
        const placements: TaskProjectionPlacementReference[] = [];
        let allReused = true;
        const targetWorkspaceId = workspaceId(input);
        const targetEntityType = entityType(input.workspace);
        const sourceEntityId = input.sourceEntityId || input.taskId;
        const parameters = parametersForTask(task);
        const kind = kindForTask(task);

        for (const [outputIndex, url] of urls.entries()) {
          const outputDigest = stableDigest(url);
          const requestDigest = stableDigest({
            actorUserId: input.actorUserId,
            taskId: task.id,
            targetProjectId: input.targetProjectId,
            outputIndex,
            outputDigest,
            parentVersionIds: input.parentVersionIds,
            projectionMode,
          });
          const placementIdempotencyKey = input.idempotencyKey
            ? `agent-result:${input.idempotencyKey}:${outputIndex}`
            : undefined;
          const placementRequestDigest = placementIdempotencyKey
            ? stableDigest({
                actorUserId: input.actorUserId,
                taskId: task.id,
                targetProjectId: input.targetProjectId,
                workspace: input.workspace,
                workspaceId: targetWorkspaceId,
                sourceEntityId,
                entityType: targetEntityType,
                entityId: `${sourceEntityId}:${outputIndex}`,
                callerIdempotencyKey: input.idempotencyKey,
                outputIndex,
                outputDigest,
              })
            : undefined;
          const created = await transaction.createProjection({
            actorUserId: input.actorUserId,
            projectId: input.targetProjectId,
            taskId: task.id,
            outputIndex,
            kind,
            file: {
              url,
              availability: 'ready',
              ...(mimeTypeForUrl(url, kind) ? { mimeType: mimeTypeForUrl(url, kind) } : {}),
              ...(/^https?:\/\//.test(url) ? { recoverySourceUrl: url } : {}),
            },
            workspace: input.workspace,
            workspaceId: targetWorkspaceId,
            entityType: targetEntityType,
            entityId: `${sourceEntityId}:${outputIndex}`,
            idempotencyKey: `task-result:${task.id}:${outputIndex}:${outputDigest}`,
            requestDigest,
            ...(placementIdempotencyKey ? { placementIdempotencyKey } : {}),
            ...(placementRequestDigest ? { placementRequestDigest } : {}),
            ...(task.providerId ? { providerId: task.providerId } : {}),
            ...(task.modelId ? { modelId: task.modelId } : {}),
            parameters,
            ...(task.billingTransactionId
              ? { billingTransactionId: task.billingTransactionId }
              : {}),
            parentVersionIds: [...input.parentVersionIds],
            projectionMode,
          });
          projected.push(created.version);
          placements.push(created.placement);
          if (!created.reused) allReused = false;
        }
        return { versions: projected, placements, reused: allReused };
      });
    },
  };
}

const defaultProjector = createTaskAssetProjector();

export function projectCompletedTaskToAssets(input: ProjectCompletedTaskInput): Promise<{
  versions: AssetVersion[];
  placements: TaskProjectionPlacementReference[];
  reused: boolean;
}> {
  return defaultProjector.projectCompletedTaskToAssets(input);
}

export async function recordTaskProjectionPending(
  input: TaskProjectionPendingInput,
): Promise<void> {
  const pending = {
    lastError: input.reason.slice(0, 500),
    lastAttemptAt: new Date().toISOString(),
    retry: input.retry ?? null,
  };
  await getPool().query(
    `UPDATE cloud_tasks
     SET result = jsonb_set(
       COALESCE(result, '{}'::jsonb),
       '{assetProjection}',
       jsonb_build_object(
         'status', 'projection_pending',
         'attemptCount', (
           CASE
             WHEN COALESCE(result->'assetProjection'->>'attemptCount', '') ~ '^[0-9]+$'
             THEN (result->'assetProjection'->>'attemptCount')::integer
             ELSE 0
           END
         ) + 1,
         'lastError', $3::jsonb->'lastError',
         'lastAttemptAt', $3::jsonb->'lastAttemptAt',
         'retry', $3::jsonb->'retry'
       ),
       true
     )
     WHERE id = $1 AND user_id = $2 AND status = 'completed'`,
    [input.taskId, input.actorUserId, JSON.stringify(pending)],
  );
}

export async function recordTaskLateResultAudit(
  input: TaskLateResultAuditInput,
): Promise<void> {
  const digest = stableDigest({
    terminalStatus: input.terminalStatus,
    urls: input.urls,
  });
  const audit = {
    status: 'isolated',
    terminalStatus: input.terminalStatus,
    urls: input.urls,
    digest,
    recordedAt: new Date().toISOString(),
  };
  await getPool().query(
    `UPDATE cloud_tasks
     SET result = jsonb_set(
       COALESCE(result, '{}'::jsonb),
       '{assetProjectionLateAudit}',
       $3::jsonb,
       true
     )
     WHERE id = $1 AND user_id = $2
       AND status IN ('failed', 'cancelled', 'timeout')
       AND COALESCE(result->'assetProjectionLateAudit'->>'digest', '') <> $4`,
    [input.taskId, input.actorUserId, JSON.stringify(audit), digest],
  );
}

export async function recordTaskProjectionCompleted(
  input: TaskProjectionCompletedInput,
): Promise<void> {
  const completed = {
    status: 'completed',
    versionIds: [...input.versionIds],
    ...(input.references ? { references: structuredClone(input.references) } : {}),
    completedAt: new Date().toISOString(),
  };
  await getPool().query(
    `UPDATE cloud_tasks
     SET result = jsonb_set(
       COALESCE(result, '{}'::jsonb),
       '{assetProjection}',
       $3::jsonb,
       true
     )
     WHERE id = $1 AND user_id = $2 AND status = 'completed'`,
    [input.taskId, input.actorUserId, JSON.stringify(completed)],
  );
}
