import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { createAssetService } from '@/lib/asset-core/service';
import { resolveWorkflowInputImageForActor } from '@/lib/asset-core/workflow-resolver';
import { revokeDocumentEditor } from '@/lib/collaboration/document-access';
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

postgresIt('resolves an active editor’s canonical workflow input but denies new binding after revocation', async () => {
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
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-source','owner','shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-source','asset-source','owner','shared','/api/serve-upload/canonical.png','image/png')`);
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
    const bound = (await query(`SELECT owner_id,project_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id,status
      FROM wujie_workspace_placements WHERE id=$1`, [output.placementId])).rows;
    expect(bound).toEqual([{
      owner_id: 'owner', project_id: 'shared', asset_version_id: 'version-source',
      workspace_kind: 'workflow', workspace_id: 'workflow:shared', entity_type: 'workflow-input',
      entity_id: node.id, status: 'active',
    }]);

    await revokeDocumentEditor('owner', 'shared', 'editor');
    const revokedNode = { ...node, id: 'workflow-input-after-revoke' };
    await expect(resolveWorkflowInputImageForActor('editor', revokedNode, {
      projectId: 'shared', workspaceId: 'workflow:shared', entityId: revokedNode.id,
    })).rejects.toMatchObject({ code: 'GENERATION_PROJECT_FORBIDDEN' });
    expect((await query("SELECT id FROM wujie_workspace_placements WHERE entity_id='workflow-input-after-revoke'")).rows).toEqual([]);
  });
}, 60_000);
