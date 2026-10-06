import type { PoolClient } from 'pg';
import { getPool, isDatabaseConfigured } from '@/lib/db-client';
import { createAssetStorageTransaction } from '@/lib/asset-core/storage';
import type { WorkspacePlacement } from '@/lib/asset-core/types';
import { validateCanvasDocumentProjection, type CanvasDocumentProjection } from '@/lib/collaboration/canvas-document';
import { GenerationProjectAccessError, readGenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import { AgentContextNotFoundError, type AgentContextStorage } from './context-adapters';
import type { AgentRunRequest } from './types';

/** Permission, projection and asset reads share one short, read-only snapshot. */
export function createPostgresAgentContextStorage(request: AgentRunRequest): AgentContextStorage {
  return {
    async transaction(callback) {
      let client: PoolClient | undefined;
      let discardClient = false;
      try {
        if (!isDatabaseConfigured()) throw new GenerationProjectAccessError('GENERATION_PROJECT_UNAVAILABLE');
        client = await getPool().connect();
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const sql = client;
        const assets = createAssetStorageTransaction(sql);
        let canvasPlacements: WorkspacePlacement[] | undefined;
        const result = await callback({
          async authorizeProject(actorUserId, projectId) {
            const access = await readGenerationProjectAccess(sql, actorUserId, projectId);
            if (access.kind === 'document') {
              const canvasScope = request.workspace === 'canvas'
                && (request.workspaceId === projectId || request.workspaceId === `canvas:${projectId}`);
              if (!canvasScope && access.ownerId !== actorUserId) throw new AgentContextNotFoundError();
              if (request.workspace === 'canvas') {
                if (!canvasScope) throw new AgentContextNotFoundError();
                const row = await sql.query<{ projection: unknown }>(
                  'SELECT projection FROM wujie_project_canvas_documents WHERE project_id=$1 AND owner_id=$2',
                  [projectId, access.ownerId],
                );
                let projection: CanvasDocumentProjection;
                try { projection = validateCanvasDocumentProjection(row.rows[0]?.projection); }
                catch { throw new AgentContextNotFoundError(); }
                canvasPlacements = (await assets.listActiveCanvasPlacements(access.ownerId, projectId))
                  .filter(placement => {
                    const canonical = projection.placements[placement.id];
                    return canonical && !canonical.deleted && canonical.assetVersionId === placement.assetVersionId
                      && (placement.entityType === 'canvas-image' || placement.entityType === 'canvas-video')
                      && placement.deletedAt === null;
                  });
              }
            }
            return access;
          },
          findProject: assets.findProject.bind(assets),
          findAsset: assets.findAsset.bind(assets),
          async findVersion(ownerId, projectId, versionId) {
            const version = await assets.findVersion(ownerId, projectId, versionId);
            if (canvasPlacements !== undefined && version) {
              const asset = await assets.findAsset(ownerId, projectId, version.assetId);
              if (!asset || asset.status !== 'active' || version.file.availability !== 'ready') return null;
            }
            return version;
          },
          async findVersionPlacement(ownerId, projectId, workspace, workspaceId, versionId) {
            if (canvasPlacements !== undefined) return canvasPlacements.find(placement =>
              placement.ownerId === ownerId && placement.projectId === projectId && placement.workspace === workspace
              && placement.workspaceId === workspaceId && placement.assetVersionId === versionId) ?? null;
            return assets.findActivePlacementForVersion(ownerId, projectId, workspace, workspaceId, versionId);
          },
          async findEntityPlacement(ownerId, projectId, workspace, workspaceId, entityId) {
            if (canvasPlacements !== undefined) return canvasPlacements.find(placement =>
              placement.ownerId === ownerId && placement.projectId === projectId && placement.workspace === workspace
              && placement.workspaceId === workspaceId && placement.entityId === entityId) ?? null;
            const entityTypes = workspace === 'canvas' ? ['canvas-image']
              : workspace === 'workflow' ? ['workflow-input', 'workflow-output'] : ['chat-attachment', 'chat-result'];
            for (const entityType of entityTypes) {
              const placement = await assets.findActivePlacement(ownerId, projectId, workspace, workspaceId, entityType, entityId);
              if (placement) return placement;
            }
            return null;
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        if (client) {
          try { await client.query('ROLLBACK'); }
          catch { discardClient = true; }
        }
        if (!discardClient) {
          if (error instanceof AgentContextNotFoundError) throw error;
          if (error instanceof GenerationProjectAccessError && error.code !== 'GENERATION_PROJECT_UNAVAILABLE') {
            throw new AgentContextNotFoundError();
          }
        }
        throw new GenerationProjectAccessError('GENERATION_PROJECT_UNAVAILABLE');
      } finally { client?.release(discardClient); }
    },
  };
}
