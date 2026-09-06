import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { createAssetService } from '@/lib/asset-core/service';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL ? it : it.skip;

postgresIt('authorizes migrated Canvas placements with real storage while preserving isolation and data', async () => {
  await withIsolatedPostgres('agent-canvas-alias', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await query("INSERT INTO wujie_projects(id, owner_id, name) VALUES ('project-a', 'owner-a', 'Alias test')");
    const service = createAssetService();
    const { version } = await service.createAssetVersion({
      actorUserId: 'owner-a', projectId: 'project-a', kind: 'image',
      file: { url: '/api/serve-upload/product.png', availability: 'ready', mimeType: 'image/png' },
      idempotencyKey: 'alias-version', requestDigest: 'alias-digest',
    });
    const { placement } = await service.createWorkspacePlacement({
      actorUserId: 'owner-a', projectId: 'project-a', assetVersionId: version.id,
      workspace: 'canvas', workspaceId: 'project-a', entityType: 'canvas-image', entityId: 'image-a',
    });
    const request: AgentRunRequest = {
      projectId: 'project-a', workspace: 'canvas', workspaceId: 'canvas:project-a',
      mode: 'agent', providerId: 'provider-a', modelId: 'model-a', prompt: 'Keep product',
      sourceVersionIds: [version.id], allowedToolIds: [], idempotencyKey: 'alias-run',
      context: { selectedEntityIds: ['image-a'], visibleVersionIds: [], locale: 'zh-CN' },
    };
    const before = await query('SELECT * FROM wujie_workspace_placements WHERE id=$1', [placement.id]);
    const result = await authorizeAgentContext({ actorUserId: 'owner-a', request });
    expect(result.selectedEntityVersionIds['image-a']).toBe(version.id);
    expect(result.mediaByVersionId[version.id]).toBe('/api/serve-upload/product.png');
    for (const invalid of [
      { ...request, workspaceId: 'canvas:project-b' },
      { ...request, workspaceId: 'session-a' },
      { ...request, workspace: 'chat' as const },
      { ...request, workspace: 'workflow' as const },
    ]) {
      await expect(authorizeAgentContext({ actorUserId: 'owner-a', request: invalid }))
        .rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND' });
    }
    await expect(authorizeAgentContext({ actorUserId: 'other-owner', request }))
      .rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND' });
    const after = await query('SELECT * FROM wujie_workspace_placements WHERE id=$1', [placement.id]);
    expect(after.rows).toEqual(before.rows);
    await query("UPDATE wujie_workspace_placements SET status='trashed', deleted_at=NOW() WHERE id=$1", [placement.id]);
    await expect(authorizeAgentContext({ actorUserId: 'owner-a', request }))
      .rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND' });
  });
}, 60_000);
