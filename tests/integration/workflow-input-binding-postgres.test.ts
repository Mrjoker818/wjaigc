import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { expect, it } from 'vitest';

import { createAssetService } from '@/lib/asset-core/service';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

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
