import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { createAssetService } from '@/lib/asset-core/service';
import { resolveWorkflowInputImageForActor } from '@/lib/asset-core/workflow-resolver';
import { revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import * as Y from 'yjs';
import { createWorkflowNode } from '@/lib/workflow-engine';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.unstubAllEnvs(); });

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

postgresIt('serializes concurrent workflow input rebinds without restoring source assets', async () => {
  await withIsolatedPostgres('workflow-input-binding', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await query("INSERT INTO wujie_projects(id, owner_id, name) VALUES ('project-a', 'owner-a', 'Workflow binding')");
    const service = createAssetService();
    const first = await service.createAssetVersion({
      actorUserId: 'owner-a', projectId: 'project-a', kind: 'image',
      file: { url: '/api/serve-upload/first.png', availability: 'ready', mimeType: 'image/png' },
      idempotencyKey: 'workflow-first', requestDigest: 'workflow-first',
    });
    const second = await service.createAssetVersion({
      actorUserId: 'owner-a', projectId: 'project-a', kind: 'image',
      file: { url: '/api/serve-upload/second.png', availability: 'ready', mimeType: 'image/png' },
      idempotencyKey: 'workflow-second', requestDigest: 'workflow-second',
    });
    const bind = (assetVersionId: string) => service.bindWorkflowInputPlacement({
      actorUserId: 'owner-a', projectId: 'project-a', assetVersionId,
      workspace: 'workflow', workspaceId: 'workflow-a',
      entityType: 'workflow-input', entityId: 'input-a',
    });

    await Promise.all([bind(first.version.id), bind(second.version.id)]);

    const active = await query(
      `SELECT asset_version_id FROM wujie_workspace_placements
       WHERE owner_id='owner-a' AND project_id='project-a' AND workspace_kind='workflow'
         AND workspace_id='workflow-a' AND entity_type='workflow-input'
         AND entity_id='input-a' AND status='active'`,
    );
    expect(active.rows).toHaveLength(1);
    expect([first.version.id, second.version.id]).toContain(active.rows[0]?.asset_version_id);
    const assets = await query(
      'SELECT status FROM wujie_assets WHERE id = ANY($1::text[]) ORDER BY id',
      [[first.asset.id, second.asset.id]],
    );
    expect(assets.rows).toEqual([{ status: 'active' }, { status: 'active' }]);
  });
}, 60_000);

postgresIt('reads an editor’s document input without copying and rejects deleted versions or revoked access', async () => {
  await withIsolatedPostgres('workflow-editor-input', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1)`);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')");
    await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
    await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
    const doc = createCanvasDocument();
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
    const sourceBefore = (await query("SELECT * FROM wujie_workspace_placements WHERE id='placement-source'")).rows;
    const node = createWorkflowNode('input-image', 0, 0);
    node.id = 'workflow-input-a';
    node.config = {
      projectId: 'shared', assetVersionId: 'version-source', placementId: 'placement-source',
      imageUrl: 'https://attacker.invalid/replacement.png',
    };

    const output = await resolveWorkflowInputImageForActor('editor', node, {
      projectId: 'shared', workspaceId: 'workflow:shared', entityId: node.id,
    });

    expect(output).toMatchObject({
      projectId: 'shared', imageUrl: '/api/serve-upload/canonical.png',
      assetId: 'asset-source', assetVersionId: 'version-source',
    });
    expect((await query("SELECT * FROM wujie_workspace_placements WHERE id='placement-source'")).rows).toEqual(sourceBefore);
    expect(output.placementId).toBe('placement-source');
    expect((await query("SELECT id FROM wujie_workspace_placements WHERE workspace_kind='workflow'")).rows).toEqual([]);
    await expect(resolveWorkflowInputImageForActor('editor', { ...node,
      config: { ...node.config, assetVersionId: 'old-version' } })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    applyCanvasImagePatch(doc, { placementId: 'placement-source', deleted: true }, 'fixture-delete');
    await query(`UPDATE wujie_project_canvas_documents SET snapshot_bytes=$1,projection=$2::jsonb WHERE project_id='shared'`,
      [Buffer.from(Y.encodeStateAsUpdate(doc)), JSON.stringify(readCanvasDocument(doc))]);
    await expect(resolveWorkflowInputImageForActor('editor', node)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    expect((await query("SELECT * FROM wujie_workspace_placements WHERE id='placement-source'")).rows).toEqual(sourceBefore);
    await query(`UPDATE wujie_project_canvas_documents SET snapshot_bytes=$1,projection=$2::jsonb WHERE project_id='shared'`, [snapshot, projection]);

    await revokeDocumentEditor('owner', 'shared', 'editor');
    const revokedNode = { ...node, id: 'workflow-input-after-revoke' };
    await expect(resolveWorkflowInputImageForActor('editor', revokedNode, {
      projectId: 'shared', workspaceId: 'workflow:shared', entityId: revokedNode.id,
    })).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    expect((await query("SELECT id FROM wujie_workspace_placements WHERE entity_id='workflow-input-after-revoke'")).rows).toEqual([]);
  });
}, 60_000);
