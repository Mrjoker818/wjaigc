import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { resolveDocumentWorkspaceReference, resolvePersonalWorkspaceReference } from '@/lib/collaboration/document-workspace-reference';
import { resolveSimpleChatWorkspaceHandoff } from '@/lib/simple-chat-workspace-handoff-server';
import { enableCollaborativeProject } from '@/lib/collaboration/document-project-bridge';
import { createAssetService } from '@/lib/asset-core/service';
import { getPool } from '@/lib/db-client';
import { PROJECT_REVISION_DATA_KEY } from '@/lib/asset-core/canvas-project-sync';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.unstubAllEnvs(); });
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

postgresIt('reads canonical editor references and actor-only chat without copies, rejects old/deleted/revoked and concurrent enable fallback', async () => {
  await withIsolatedPostgres('document-workspace-reference', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false'); // Read-only canonical access must not require a write flag.
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared'),('personal','editor','Personal')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    const doc = createCanvasDocument();
    try {
      applyCanvasImagePatch(doc, { placementId: 'placement-source', assetVersionId: 'version-source',
        x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 }, 'fixture');
      const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
      const projection = JSON.stringify(readCanvasDocument(doc));
      await query(`INSERT INTO wujie_project_canvas_documents(project_id,owner_id,snapshot_bytes,projection)
        VALUES ('shared','owner',$1,$2::jsonb)`, [snapshot, projection]);
      await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ('owner','projects',$1::jsonb,1)`,
        [JSON.stringify([{ id: 'shared', userId: 'owner', name: 'Shared', createdAt: 1, updatedAt: 1,
          settings: {}, canvasImages: [{ id: 'image-source', url: '/api/serve-upload/canonical.png',
            x: 0, y: 0, width: 100, height: 100, originalWidth: 100, originalHeight: 100,
            rotation: 0, zIndex: 1, createdAt: 1 }] }])]);
      await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-source','owner','shared','image')");
      await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,availability)
        VALUES ('version-source','asset-source','owner','shared','/api/serve-upload/canonical.png','image/png','ready')`);
      await query("UPDATE wujie_assets SET current_version_id='version-source' WHERE id='asset-source'");
      await query(`INSERT INTO wujie_workspace_placements
        (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
        VALUES ('placement-source','owner','shared','asset-source','version-source','canvas','shared','canvas-image','image-source')`);
      const tuple = { projectId: 'shared', assetVersionId: 'version-source', placementId: 'placement-source' };
      const before = (await query('SELECT * FROM wujie_workspace_placements ORDER BY id')).rows;
      await expect(resolveDocumentWorkspaceReference('editor', tuple)).resolves.toMatchObject({
        url: '/api/serve-upload/canonical.png', assetId: 'asset-source',
        assetVersionId: tuple.assetVersionId, placementId: tuple.placementId,
      });
      await expect(resolveDocumentWorkspaceReference('owner', { ...tuple, assetVersionId: 'old-version' }))
        .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
      await expect(resolveDocumentWorkspaceReference('editor', { ...tuple, assetVersionId: '', placementId: '' }))
        .rejects.toMatchObject({ code: 'ASSET_REQUEST_INVALID' });
      const intent = { actorUserId: 'editor', targetProjectId: 'shared', chatProjectId: 'chat', chatTaskId: 'task', chatMessageId: 'message' };
      const chat = [{ id: 'chat', name: 'Private chat', createdAt: 1, updatedAt: 1, agents: [], knowledgeItems: [], tasks: [{
        id: 'task', projectId: 'chat', name: 'Task', model: 'model', providerId: 'provider', createdAt: 1, updatedAt: 1,
        messages: [{ id: 'message', role: 'assistant', content: 'Private message', createdAt: 1,
          images: ['/api/serve-upload/canonical.png'], imageRefs: [{ url: '/api/serve-upload/canonical.png',
            assetVersionId: tuple.assetVersionId, placementId: tuple.placementId }] }],
      }] }];
      await query("INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ('owner','chat_simple_projects',$1::jsonb,1)", [JSON.stringify(chat)]);
      await expect(resolveSimpleChatWorkspaceHandoff(intent)).rejects.toMatchObject({ code: 'HANDOFF_SOURCE_NOT_FOUND' });
      await query("INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ('editor','chat_simple_projects',$1::jsonb,1)", [JSON.stringify(chat)]);
      await expect(resolveSimpleChatWorkspaceHandoff(intent)).resolves.toMatchObject({ text: 'Private message', images: [{ assetRef: { url: '/api/serve-upload/canonical.png' } }] });
      expect((await query('SELECT * FROM wujie_workspace_placements ORDER BY id')).rows).toEqual(before);
      expect((await query("SELECT * FROM wujie_user_data WHERE user_id='editor' AND data_key='projects'")).rows).toEqual([]);
      applyCanvasImagePatch(doc, { placementId: tuple.placementId, deleted: true }, 'fixture-delete');
      await query("UPDATE wujie_project_canvas_documents SET snapshot_bytes=$1,projection=$2::jsonb WHERE project_id='shared'", [Buffer.from(Y.encodeStateAsUpdate(doc)), JSON.stringify(readCanvasDocument(doc))]);
      await expect(resolveDocumentWorkspaceReference('owner', tuple)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
      await query("UPDATE wujie_project_canvas_documents SET snapshot_bytes=$1,projection=$2::jsonb WHERE project_id='shared'", [snapshot, projection]);
      await revokeDocumentEditor('owner', 'shared', 'editor');
      await expect(resolveDocumentWorkspaceReference('editor', tuple)).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN', status: 403 });
      await expect(resolveDocumentWorkspaceReference('editor', { projectId: 'personal', assetVersionId: '', placementId: '' })).resolves.toBeNull();
      await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('personal','editor',true)");
      await expect(resolvePersonalWorkspaceReference('editor', { ...tuple, projectId: 'personal' }))
        .rejects.toMatchObject({ code: 'ASSET_REFERENCE_AUTHORITY_CHANGED', status: 409 });
      expect((await query('SELECT * FROM wujie_workspace_placements ORDER BY id')).rows).toEqual(before);
    } finally { doc.destroy(); }
  });
}, 60_000);

postgresIt('serializes real enable before personal workflow bind and rejects the stale personal admission without a copy', async () => {
  await withIsolatedPostgres('document-workflow-enable-race', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('personal','owner','Personal')");
    await query("INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ('owner','projects',$1::jsonb,1)",
      [JSON.stringify([{ id: 'personal', userId: 'owner', name: 'Personal', schemaVersion: 3,
        createdAt: 1, updatedAt: 1, settings: {}, canvasImages: [] }])]);
    const { version } = await createAssetService().createAssetVersion({
      actorUserId: 'owner', projectId: 'personal', kind: 'image',
      file: { url: '/api/serve-upload/private.png', availability: 'ready', mimeType: 'image/png' },
      idempotencyKey: 'private-source', requestDigest: 'private-source',
    });
    const input = { projectId: 'personal', assetVersionId: version.id };
    await expect(resolveDocumentWorkspaceReference('owner', input)).resolves.toBeNull();
    const blocker = await getPool().connect();
    let enable: Promise<void> | undefined;
    let bind: Promise<unknown> | undefined;
    const waitForWaiter = async (sql: string): Promise<void> => {
      const deadline = Date.now() + 1_000;
      do {
        const waiting = await query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_stat_activity
          WHERE datname = current_database() AND query = $1 AND wait_event_type = 'Lock'`, [sql]);
        if (Number(waiting.rows[0]?.count) > 0) return;
        await new Promise<void>(resolveWait => setTimeout(resolveWait, 5));
      } while (Date.now() < deadline);
      throw new Error('Expected real production revision-lock waiter was not observed');
    };
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['owner', PROJECT_REVISION_DATA_KEY]);
      enable = enableCollaborativeProject('owner', 'personal', 0);
      void enable.catch(() => undefined); // Observe immediately; assertions remain outside production awaits.
      await waitForWaiter('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))');
      bind = resolvePersonalWorkspaceReference('owner', input, { workspaceId: 'workflow', entityId: 'node' });
      void bind.catch(() => undefined);
      await waitForWaiter('SELECT pg_advisory_xact_lock_shared(hashtext($1), hashtext($2))');
      await blocker.query('COMMIT');
      await expect(enable).resolves.toBeUndefined();
      await expect(bind).rejects.toMatchObject({ code: 'ASSET_REFERENCE_AUTHORITY_CHANGED', status: 409 });
      expect((await query("SELECT id FROM wujie_workspace_placements WHERE workspace_kind='workflow'")).rows).toEqual([]);
      expect((await query("SELECT enabled FROM wujie_project_document_settings WHERE project_id='personal'")).rows).toEqual([{ enabled: true }]);
      expect((await query('SELECT id, file_url FROM wujie_asset_versions WHERE id=$1', [version.id])).rows)
        .toEqual([{ id: version.id, file_url: '/api/serve-upload/private.png' }]);
    } finally {
      let rollbackFailed = false;
      try {
        await blocker.query('ROLLBACK');
      } catch (error) {
        rollbackFailed = true;
        throw error;
      } finally {
        try { blocker.release(rollbackFailed); }
        finally {
          await Promise.allSettled([enable, bind].filter((promise): promise is Promise<unknown> => promise !== undefined));
        }
      }
    }
  });
}, 60_000);
