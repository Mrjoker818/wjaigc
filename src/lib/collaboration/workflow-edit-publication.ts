import 'server-only';
import type { Pool, PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';
import { assertDocumentEditor, assertDocumentProjectEnabled, DocumentAccessError,
  DocumentFeatureDisabledError, DocumentProjectNotEnabledError } from './document-access';
import { readCanvasDocument } from './canvas-document';
import { loadDocumentInTransaction } from './document-store';
import type { GenerationProjectAccess } from './generation-project-access';

export interface WorkflowEditPublicationInput {
  access: Extract<GenerationProjectAccess, { kind: 'document' }>;
  workflowId: string;
  nodeId: string;
  sourceEntityId: string;
  sourceVersionId: string;
  sourcePlacementId: string;
  imageUrl: string;
  origin: string;
  legacySourceLookup?: true;
}

export class WorkflowEditSourceError extends Error {
  readonly status: 400 | 403 | 503;
  constructor(readonly code: 'WORKFLOW_EDIT_SOURCE_INVALID' | 'WORKFLOW_EDIT_SOURCE_FORBIDDEN'
    | 'WORKFLOW_EDIT_SOURCE_MISMATCH' | 'WORKFLOW_EDIT_SOURCE_UNAVAILABLE') {
    super(code === 'WORKFLOW_EDIT_SOURCE_UNAVAILABLE'
      ? '工作流图片来源验证暂不可用，请稍后重试'
      : '工作流图片来源与项目资产版本不匹配');
    this.name = 'WorkflowEditSourceError';
    this.status = code === 'WORKFLOW_EDIT_SOURCE_INVALID' ? 400
      : code === 'WORKFLOW_EDIT_SOURCE_UNAVAILABLE' ? 503 : 403;
  }
}

export class WorkflowEditIntentConflictError extends Error {
  readonly code = 'WORKFLOW_EDIT_INTENT_CONFLICT';
  readonly status = 409;
  constructor() {
    super('工作流编辑任务身份与原任务不一致');
    this.name = 'WorkflowEditIntentConflictError';
  }
}

function comparableUrl(value: string, origin: string): string {
  if (!value || value.trim() !== value || value.includes('\\') || value.startsWith('//')) {
    throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_INVALID');
  }
  let url: URL;
  try { url = new URL(value, origin); }
  catch { throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_INVALID');
  }
  return url.href;
}

export interface PreparedWorkflowEditSource {
  assetId: string;
  sourceVersionId: string;
  sourcePlacementId: string;
  canonicalUrl: string;
}

interface LegacyWorkflowSourceRow {
  id: string;
  workspace_id: string;
  entity_id: string;
  asset_version_id: string;
}

async function findLegacyWorkflowSources(
  db: Pool | PoolClient, access: Extract<GenerationProjectAccess, { kind: 'document' }>,
  imageUrl: string, lock: boolean,
): Promise<LegacyWorkflowSourceRow[]> {
  const result = await db.query<LegacyWorkflowSourceRow>(`SELECT p.id,p.workspace_id,p.entity_id,p.asset_version_id
    FROM wujie_workspace_placements p
    JOIN wujie_asset_versions v ON v.id=p.asset_version_id
      AND v.asset_id=p.asset_id AND v.owner_id=p.owner_id AND v.project_id=p.project_id
    JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
    WHERE p.owner_id=$1 AND p.project_id=$2 AND p.workspace_kind='workflow'
      AND p.entity_type='workflow-input' AND p.status='active' AND p.deleted_at IS NULL
      AND v.file_url=$3 AND v.availability='ready' AND a.kind='image' AND a.status='active'
    LIMIT 2 ${lock ? 'FOR SHARE OF p,v,a' : ''}`,
  [access.ownerId, access.projectId, imageUrl]);
  return result.rows;
}

/** Legacy document callers provide only the source URL; ambiguity is never billed. */
export async function resolveLegacyWorkflowEditSource(input: {
  access: Extract<GenerationProjectAccess, { kind: 'document' }>;
  imageUrl: string;
  origin: string;
  nodeId: string;
  sourceVersionIds?: string[];
}): Promise<WorkflowEditPublicationInput> {
  if (typeof input.imageUrl !== 'string') throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_INVALID');
  comparableUrl(input.imageUrl, input.origin);
  if (input.sourceVersionIds !== undefined
    && (!Array.isArray(input.sourceVersionIds) || input.sourceVersionIds.length > 1
      || (input.sourceVersionIds.length === 1 && typeof input.sourceVersionIds[0] !== 'string'))) {
    throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_INVALID');
  }
  try {
    const matches = await findLegacyWorkflowSources(getPool(), input.access, input.imageUrl, false);
    if (matches.length !== 1) throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_INVALID');
    const source = matches[0];
    if (input.sourceVersionIds?.length === 1 && source.asset_version_id !== input.sourceVersionIds[0]) {
      throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_INVALID');
    }
    return { access: input.access, workflowId: source.workspace_id, nodeId: input.nodeId,
      sourceEntityId: source.entity_id, sourceVersionId: source.asset_version_id,
      sourcePlacementId: source.id, imageUrl: input.imageUrl, origin: input.origin,
      legacySourceLookup: true };
  } catch (error) {
    if (error instanceof WorkflowEditSourceError) throw error;
    throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_UNAVAILABLE');
  }
}

/** Caller must hold the billing transaction until task admission commits. */
export async function prepareWorkflowEditSourceInTransaction(
  client: PoolClient, input: WorkflowEditPublicationInput,
): Promise<PreparedWorkflowEditSource> {
  const { access } = input;
  if (!input.workflowId || !input.nodeId || !input.sourceEntityId
    || !input.sourceVersionId || !input.sourcePlacementId
    || [input.workflowId, input.nodeId, input.sourceEntityId, input.sourceVersionId, input.sourcePlacementId]
      .some(value => value.length > 256 || value.trim() !== value || /\p{Cc}/u.test(value))
    || !input.origin || typeof input.imageUrl !== 'string') {
    throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_INVALID');
  }
  try {
    const editor = await assertDocumentEditor(access.actorUserId, access.projectId,
      client, access.grantGeneration);
    if (editor.ownerId !== access.ownerId) throw new DocumentAccessError();
    await assertDocumentProjectEnabled(client, editor.ownerId, access.projectId);
    if (input.legacySourceLookup) {
      const matches = await findLegacyWorkflowSources(client, access, input.imageUrl, true);
      if (matches.length !== 1 || matches[0].id !== input.sourcePlacementId
        || matches[0].workspace_id !== input.workflowId
        || matches[0].entity_id !== input.sourceEntityId
        || matches[0].asset_version_id !== input.sourceVersionId) {
        throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_INVALID');
      }
    }
    const source = await client.query<{
      asset_id: string; file_url: string; mime_type: string | null; availability: string;
      kind: string; asset_status: string; workspace_kind: string;
    }>(`SELECT v.asset_id,v.file_url,v.mime_type,v.availability,a.kind,a.status AS asset_status,
              p.workspace_kind
       FROM wujie_workspace_placements p
       JOIN wujie_asset_versions v ON v.id=p.asset_version_id
         AND v.asset_id=p.asset_id AND v.owner_id=p.owner_id AND v.project_id=p.project_id
       JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
       WHERE p.id=$1 AND p.owner_id=$2 AND p.project_id=$3
         AND ((p.workspace_kind='workflow' AND p.workspace_id=$4
               AND p.entity_type='workflow-input' AND p.entity_id=$6)
           OR (p.workspace_kind='canvas' AND p.workspace_id IN ($3,'canvas:' || $3)
               AND p.entity_type='canvas-image'))
         AND p.status='active' AND p.deleted_at IS NULL AND p.asset_version_id=$5
       FOR SHARE OF p,v,a`, [input.sourcePlacementId, editor.ownerId, access.projectId,
      input.workflowId, input.sourceVersionId, input.sourceEntityId]);
    const row = source.rows[0];
    const mime = row?.mime_type?.trim().toLowerCase();
    if (!row || row.kind !== 'image' || row.asset_status !== 'active'
      || row.availability !== 'ready' || (mime && !new Set([
        'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif',
      ]).has(mime))) throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_FORBIDDEN');
    if (row.workspace_kind === 'canvas') {
      const document = await client.query(
        'SELECT 1 FROM wujie_project_canvas_documents WHERE project_id=$1 AND owner_id=$2 FOR SHARE',
        [access.projectId, editor.ownerId]);
      if (document.rowCount !== 1) throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_FORBIDDEN');
      const loaded = await loadDocumentInTransaction(client, access.projectId);
      try {
        const canonical = readCanvasDocument(loaded.doc).placements[input.sourcePlacementId];
        if (!canonical || canonical.deleted === true || canonical.assetVersionId !== input.sourceVersionId) {
          throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_FORBIDDEN');
        }
      } finally { loaded.doc.destroy(); }
    }
    // A database-relative managed URL must remain relative in the request. Otherwise
    // an attacker-controlled Host/origin could make an absolute foreign URL compare equal.
    if ((row.file_url.startsWith('/') && !row.file_url.startsWith('//')
      && (!input.imageUrl.startsWith('/') || input.imageUrl.startsWith('//')))
      || comparableUrl(input.imageUrl, input.origin) !== comparableUrl(row.file_url, input.origin)) {
      throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_MISMATCH');
    }
    return { assetId: row.asset_id, sourceVersionId: input.sourceVersionId,
      sourcePlacementId: input.sourcePlacementId, canonicalUrl: row.file_url };
  } catch (error) {
    if (error instanceof WorkflowEditSourceError) throw error;
    if (error instanceof DocumentAccessError || error instanceof DocumentProjectNotEnabledError
      || error instanceof DocumentFeatureDisabledError) {
      throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_FORBIDDEN');
    }
    throw new WorkflowEditSourceError('WORKFLOW_EDIT_SOURCE_UNAVAILABLE');
  }
}

interface WorkflowEditIntentIdentity {
  taskId: string;
  requestDigest: string;
  providerId: string;
  modelId: string;
}

export async function persistWorkflowEditIntentInTransaction(client: PoolClient, input: {
  publication: WorkflowEditPublicationInput;
  source: PreparedWorkflowEditSource;
  identity: WorkflowEditIntentIdentity;
}): Promise<void> {
  const { publication, source, identity } = input;
  await client.query(
    `INSERT INTO wujie_workflow_edit_publications
      (task_id,actor_id,owner_id,project_id,workflow_id,node_id,source_entity_id,grant_generation,
       source_asset_id,source_version_id,source_placement_id,canonical_url,
       request_digest,provider_id,model_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [identity.taskId, publication.access.actorUserId, publication.access.ownerId,
      publication.access.projectId, publication.workflowId, publication.nodeId, publication.sourceEntityId,
      publication.access.grantGeneration, source.assetId, source.sourceVersionId,
      source.sourcePlacementId, source.canonicalUrl, identity.requestDigest,
      identity.providerId, identity.modelId],
  );
}

export async function assertWorkflowEditIntentReplayInTransaction(client: PoolClient, input: {
  publication: WorkflowEditPublicationInput;
  source: PreparedWorkflowEditSource;
  identity: WorkflowEditIntentIdentity;
}): Promise<void> {
  const { publication, source, identity } = input;
  const row = await client.query<{
    actor_id: string; owner_id: string; project_id: string; workflow_id: string; node_id: string;
    source_entity_id: string;
    grant_generation: string; source_asset_id: string; source_version_id: string;
    source_placement_id: string; canonical_url: string; request_digest: string;
    provider_id: string; model_id: string;
    }>(`SELECT actor_id,owner_id,project_id,workflow_id,node_id,source_entity_id,grant_generation,
      source_asset_id,source_version_id,source_placement_id,canonical_url,
      request_digest,provider_id,model_id
     FROM wujie_workflow_edit_publications WHERE task_id=$1 FOR SHARE`, [identity.taskId]);
  const intent = row.rows[0];
  if (!intent || intent.actor_id !== publication.access.actorUserId
    || intent.owner_id !== publication.access.ownerId || intent.project_id !== publication.access.projectId
    || intent.workflow_id !== publication.workflowId || intent.node_id !== publication.nodeId
    || intent.source_entity_id !== publication.sourceEntityId
    || intent.grant_generation !== publication.access.grantGeneration
    || intent.source_asset_id !== source.assetId || intent.source_version_id !== source.sourceVersionId
    || intent.source_placement_id !== source.sourcePlacementId || intent.canonical_url !== source.canonicalUrl
    || intent.request_digest !== identity.requestDigest || intent.provider_id !== identity.providerId
    || intent.model_id !== identity.modelId) throw new WorkflowEditIntentConflictError();
}
