import 'server-only';

import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import type { PoolClient } from 'pg';
import { AssetService, AssetServiceError } from '@/lib/asset-core/service';
import { createAssetStorageTransaction, lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { PROJECT_REVISION_DATA_KEY } from '@/lib/asset-core/canvas-project-sync';
import { getPool } from '@/lib/db-client';
import { readCollaborativeProject, type CollaborativeProjectRead } from '@/lib/collaboration/document-project-bridge';

export interface DocumentWorkspaceReferenceInput {
  projectId: string;
  assetVersionId: string;
  placementId?: string;
}

export class DocumentWorkspaceReferenceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'DocumentWorkspaceReferenceError';
  }
}

async function isDocumentProject(
  client: Pick<PoolClient, 'query'>, actorUserId: string, projectId: string,
): Promise<boolean> {
  const result = await client.query<{
    actor_status: string; owner_id: string | null; status: string | null;
    owner_status: string | null; enabled: boolean | null; has_document: boolean;
  }>(`SELECT actor.status AS actor_status, p.owner_id, p.status,
      owner_user.status AS owner_status, settings.enabled,
      EXISTS (SELECT 1 FROM wujie_project_canvas_documents doc WHERE doc.project_id = $2) AS has_document
    FROM wujie_users actor
    LEFT JOIN wujie_projects p ON p.id = $2
    LEFT JOIN wujie_users owner_user ON owner_user.id = p.owner_id
    LEFT JOIN wujie_project_document_settings settings ON settings.project_id = p.id AND settings.owner_id = p.owner_id
    WHERE actor.id = $1 FOR SHARE OF actor`, [actorUserId, projectId]);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row.actor_status !== 'active') {
    throw new DocumentWorkspaceReferenceError('DOCUMENT_FORBIDDEN', 403);
  }
  if (row.has_document || row.enabled === true) return true;
  if (row.owner_id !== null && (row.owner_id !== actorUserId
    || row.status !== 'active' || row.owner_status !== 'active')) {
    throw new DocumentWorkspaceReferenceError('DOCUMENT_FORBIDDEN', 403);
  }
  return false;
}

/** null is a mode result, not an authorization-error fallback. Legacy callers still verify actor ownership. */
export async function readDocumentWorkspaceProject(
  actorUserId: string, projectId: string,
): Promise<CollaborativeProjectRead | null> {
  if (!actorUserId || !projectId || projectId.length > 256 || projectId.trim() !== projectId
    || /\p{Cc}/u.test(projectId)) {
    throw new DocumentWorkspaceReferenceError('ASSET_REQUEST_INVALID', 400);
  }
  try {
    // Classification does not require the global write flag. A retained document, including a
    // closed one, can never fall through to owner/private asset reads. The bridge reauthorizes
    // and reads the canonical graph in its own single repeatable-read transaction.
    if (await isDocumentProject(getPool(), actorUserId, projectId)) {
      return await readCollaborativeProject(actorUserId, projectId);
    }
    return null;
  } catch (error) {
    if (error instanceof DocumentWorkspaceReferenceError) throw error;
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'DOCUMENT_FORBIDDEN' || code === 'DOCUMENT_PROJECT_NOT_ENABLED' || code === 'DOCUMENT_DISABLED') {
      throw new DocumentWorkspaceReferenceError(code, 403);
    }
    if (code === 'DOCUMENT_AUTHORITY_CONFLICT') throw new DocumentWorkspaceReferenceError(code, 409);
    throw new DocumentWorkspaceReferenceError('ASSET_REFERENCE_UNAVAILABLE', 503);
  }
}

export async function resolveDocumentWorkspaceReference(
  actorUserId: string,
  input: DocumentWorkspaceReferenceInput,
): Promise<WorkspaceAssetReference | null> {
  const read = await readDocumentWorkspaceProject(actorUserId, input.projectId);
  if (!read) return null;
  if (!input.assetVersionId || !input.placementId) {
    throw new DocumentWorkspaceReferenceError('ASSET_REQUEST_INVALID', 400);
  }
  const placement = read.projection.placements[input.placementId];
  const matches = read.canvasImages.filter(image => image.placementId === input.placementId
    && image.assetVersionId === input.assetVersionId);
  const image = matches[0];
  if (read.projectId !== input.projectId || !placement || placement.deleted
    || placement.assetVersionId !== input.assetVersionId || matches.length !== 1
    || !image.assetId || !image.id || image.mediaAvailability !== 'ready') {
    throw new DocumentWorkspaceReferenceError('ASSET_NOT_FOUND', 404);
  }
  const kind = image.mediaType === 'video' ? 'video' : image.threeDModelUrl ? 'model-3d' : 'image';
  const url = kind === 'video' ? image.videoUrl : kind === 'model-3d' ? image.threeDModelUrl : image.url;
  if (!url) throw new DocumentWorkspaceReferenceError('ASSET_NOT_FOUND', 404);
  return { assetId: image.assetId, assetVersionId: input.assetVersionId, placementId: input.placementId,
    entityId: image.id, kind, url };
}

export async function resolvePersonalWorkspaceReference(
  actorUserId: string, input: DocumentWorkspaceReferenceInput,
  workflowBinding?: { workspaceId: string; entityId: string },
): Promise<WorkspaceAssetReference> {
  if (workflowBinding && (Object.keys(workflowBinding).some(key => key !== 'workspaceId' && key !== 'entityId')
    || [workflowBinding.workspaceId, workflowBinding.entityId].some(value => typeof value !== 'string'
      || !value || value.length > 256 || value.trim() !== value || /\p{Cc}/u.test(value)))) {
    throw new DocumentWorkspaceReferenceError('ASSET_REQUEST_INVALID', 400);
  }
  let client: PoolClient | undefined;
  let discardClient = false;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    // Match enable's graph -> owner revision -> project ordering. The shared revision fence
    // also covers a legacy project whose graph row does not exist yet. No second connection.
    await lockAssetGraphWriteGate(client, 'shared');
    await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1), hashtext($2))',
      [actorUserId, PROJECT_REVISION_DATA_KEY]);
    await client.query('SELECT id FROM wujie_projects WHERE id = $1 AND owner_id = $2 FOR SHARE',
      [input.projectId, actorUserId]);
    if (await isDocumentProject(client, actorUserId, input.projectId)) {
      throw new DocumentWorkspaceReferenceError('ASSET_REFERENCE_AUTHORITY_CHANGED', 409);
    }
    const transaction = createAssetStorageTransaction(client);
    const service = new AssetService({
      read: async callback => callback(transaction),
      transaction: async callback => {
        if (!workflowBinding) throw new DocumentWorkspaceReferenceError('ASSET_REQUEST_INVALID', 400);
        return callback(transaction);
      },
    });
    let reference = await service.resolveAssetReference({ actorUserId, ...input });
    if (workflowBinding) {
      const { placement } = await service.bindWorkflowInputPlacement({
        actorUserId, projectId: input.projectId, assetVersionId: input.assetVersionId,
        workspace: 'workflow', workspaceId: workflowBinding.workspaceId,
        entityType: 'workflow-input', entityId: workflowBinding.entityId,
      });
      reference = { ...reference, placementId: placement.id, entityId: placement.entityId };
    }
    await client.query('COMMIT');
    return reference;
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); }
      catch { discardClient = true; }
    }
    if (error instanceof DocumentWorkspaceReferenceError || error instanceof AssetServiceError) throw error;
    throw new DocumentWorkspaceReferenceError('ASSET_REFERENCE_UNAVAILABLE', 503);
  } finally {
    client?.release(discardClient);
  }
}
