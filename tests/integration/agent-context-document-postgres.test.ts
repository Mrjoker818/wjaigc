import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { grantDocumentEditor, revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { admitAuthorizedAgentExecution } from '@/lib/agent-runtime/admission-gate';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const request: AgentRunRequest = {
  projectId: 'shared', workspace: 'canvas', workspaceId: 'canvas:shared',
  mode: 'agent', providerId: 'provider', modelId: 'model', prompt: 'Use shared image',
  sourceVersionIds: ['version-shared'], allowedToolIds: ['generate_image'], idempotencyKey: 'run',
  context: { selectedEntityIds: ['image-shared'], visibleVersionIds: [], locale: 'zh-CN' },
};
const projection = { placements: { 'placement-shared': {
  assetVersionId: 'version-shared', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0,
} } };

async function seed(query: QueryFn, databaseUrl: string): Promise<void> {
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  console.log('Full migrations:', migration.status, migration.stdout, migration.stderr);
  expect(migration.status, migration.stderr || migration.stdout).toBe(0);
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1), ('editor','Editor','test','active','user',1,1),
    ('other','Other','test','active','user',1,1), ('admin','Admin','test','active','admin',1,1),
    ('presence','Presence','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  await query("INSERT INTO wujie_project_presence_members (project_id,owner_id,member_user_id) VALUES ('shared','owner','presence')");
  await query(`INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('asset-shared','owner','shared','image')`);
  await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,file_url,mime_type)
    VALUES ('version-shared','asset-shared','owner','shared','/api/serve-upload/shared.png','image/png')`);
  await query(`INSERT INTO wujie_workspace_placements
    (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
    VALUES ('placement-shared','owner','shared','asset-shared','version-shared','canvas','shared','canvas-image','image-shared')`);
  await query(`INSERT INTO wujie_project_canvas_documents (project_id,owner_id,projection)
    VALUES ('shared','owner',$1::jsonb)`, [JSON.stringify(projection)]);
  await query("UPDATE wujie_users SET credits=100 WHERE id IN ('owner','editor')");
  await query(`INSERT INTO cloud_tasks (id,user_id,project_id,type,status,credit_status,credit_cost,created_at,updated_at)
    VALUES ('editor-task','editor','shared','agent','completed','charged',7,1,1),
    ('owner-task','owner','shared','image','completed','charged',9,1,1)`);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}

async function snapshot(query: QueryFn): Promise<Record<string, unknown>> {
  const tables = await query<{ name: string }>(`SELECT tablename AS name FROM pg_tables
    WHERE schemaname=current_schema() ORDER BY tablename`);
  const rows: Record<string, unknown> = {};
  for (const { name } of tables.rows) rows[name] = (await query(
    `SELECT to_jsonb(t) AS row FROM "${name.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`,
  )).rows;
  return rows;
}

it('authorizes a real shared editor without changing graph, document, task or credit rows', async () => {
  await withIsolatedPostgres('agent-document', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const before = await snapshot(query);
    const context = await authorizeAgentContext({ actorUserId: 'editor', request });
    expect(context.mediaByVersionId['version-shared']).toBe('/api/serve-upload/shared.png');
    expect(context.projectAccess).toEqual({
      kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '1',
    });
    expect(context.selectedEntityVersionIds).toEqual({ 'image-shared': 'version-shared' });
    expect(await snapshot(query)).toEqual(before);
  });
}, 60_000);

it('observes regrant generation on the next request without retaining authorization or placements', async () => {
  await withIsolatedPostgres('agent-regrant', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    await checkContext(query, 'editor', request, true);
    await revokeDocumentEditor('owner', 'shared', 'editor');
    await checkContext(query, 'editor', request, false);
    await grantDocumentEditor('owner', 'shared', 'editor');
    const before = await snapshot(query);
    const result = await authorizeAgentContext({ actorUserId: 'editor', request });
    expect(result.projectAccess).toEqual({ kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '3' });
    expect(result.mediaByVersionId).toEqual({ 'version-shared': '/api/serve-upload/shared.png' });
    expect(await snapshot(query)).toEqual(before);
    await query('UPDATE wujie_project_canvas_documents SET projection=$1', [JSON.stringify({ placements: {} })]);
    await checkContext(query, 'editor', request, false);
  });
}, 60_000);

it.each(['permission-mix', 'media-mix', 'revoke-and-replace'] as const)(
  'uses one read-only RR snapshot across two real sessions: %s', async scenario => {
    await withIsolatedPostgres(`agent-snapshot-${scenario}`, async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl);
      if (scenario === 'permission-mix') await query("UPDATE wujie_project_document_editors SET status='revoked'");
      if (scenario === 'media-mix') await query("UPDATE wujie_asset_versions SET availability='pending-persist'");
      const pool = getPool();
      const client = await pool.connect();
      const original = client.query.bind(client) as QueryFn;
      let interleaved = false;
      let externalRows: Record<string, unknown> | undefined;
      const statements: string[] = [];
      const clientSpy = vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
        statements.push(sql);
        const result = await original(sql, values);
        const boundary = scenario === 'permission-mix' ? 'SELECT status FROM wujie_users'
          : scenario === 'media-mix' ? 'SELECT projection' : 'SELECT grant_generation::text';
        if (!interleaved && sql.includes(boundary)) {
          interleaved = true;
          expect((await original('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('on');
          expect((await original('SHOW transaction_isolation')).rows[0].transaction_isolation).toBe('repeatable read');
          // The helper is a distinct real PG session. Its changes commit before the next application SELECT.
          await query('BEGIN');
          try {
            if (scenario === 'permission-mix') {
              await query("UPDATE wujie_users SET status='disabled' WHERE id='editor'");
              await query("UPDATE wujie_project_document_editors SET status='active'");
            } else if (scenario === 'media-mix') {
              await query("UPDATE wujie_asset_versions SET availability='ready'");
              await query('UPDATE wujie_project_canvas_documents SET projection=$1', [JSON.stringify({ placements: {} })]);
            } else {
              await query("UPDATE wujie_project_document_editors SET status='revoked',grant_generation=2");
              await query("UPDATE wujie_asset_versions SET file_url='/api/serve-upload/replaced.png'");
              await query('UPDATE wujie_project_canvas_documents SET projection=$1', [JSON.stringify({ placements: {} })]);
            }
            await query('COMMIT');
          } catch (error) { await query('ROLLBACK'); throw error; }
          externalRows = await snapshot(query);
        }
        return result;
      }) as typeof client.query);
      const connection = vi.spyOn(pool, 'connect').mockImplementationOnce(async (): Promise<PoolClient> => client);
      try {
        const result = authorizeAgentContext({ actorUserId: 'editor', request });
        if (scenario === 'revoke-and-replace') {
          await expect(result).resolves.toMatchObject({
            projectAccess: { actorUserId: 'editor', ownerId: 'owner', grantGeneration: '1' },
            mediaByVersionId: { 'version-shared': '/api/serve-upload/shared.png' },
          });
        } else await expect(result).rejects.toMatchObject(notFound);
        expect(interleaved).toBe(true);
        expect(connection).toHaveBeenCalledTimes(1);
        expect(statements.filter(sql => sql.startsWith('BEGIN'))).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY']);
        expect(statements.filter(sql => /^(COMMIT|ROLLBACK)$/.test(sql))).toHaveLength(1);
        expect(await snapshot(query)).toEqual(externalRows);
        expect(pool.idleCount).toBe(pool.totalCount);
      } finally { connection.mockRestore(); clientSpy.mockRestore(); }
      await checkContext(query, 'editor', request, false);
      expect((await query(`SELECT state FROM pg_stat_activity WHERE datname=current_database()
        AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`)).rows).toEqual([]);
    });
  }, 60_000,
);

it('redacts SQL, COMMIT, connection and ROLLBACK failures and discards only a broken transaction client', async () => {
  await withIsolatedPostgres('agent-failures', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    for (const failure of ['BEGIN', 'permission', 'projection', 'asset', 'COMMIT', 'connect', 'ROLLBACK'] as const) {
      const before = await snapshot(query);
      const pool = getPool();
      let client: PoolClient | undefined;
      const released: Array<boolean | undefined> = [];
      const statements: string[] = [];
      if (failure === 'connect') vi.spyOn(pool, 'connect').mockRejectedValueOnce(new Error('secret connection credentials'));
      else {
        client = await pool.connect();
        const original = client.query.bind(client) as QueryFn;
        const release = client.release.bind(client);
        vi.spyOn(client, 'release').mockImplementation((discard?: Error | boolean) => {
          released.push(typeof discard === 'boolean' ? discard : undefined);
          release(discard);
        });
        vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
          statements.push(sql);
          if ((failure === 'BEGIN' && sql.startsWith('BEGIN'))
            || (failure === 'permission' && sql.includes('SELECT status'))
            || (failure === 'projection' && sql.includes('SELECT projection'))
            || (failure === 'asset' && sql.includes('FROM wujie_asset_versions'))
            || (failure === 'COMMIT' && sql === 'COMMIT')
            || (failure === 'ROLLBACK' && (sql.includes('SELECT status') || sql === 'ROLLBACK'))) {
            return original('SELECT secret_missing_column');
          }
          return original(sql, values);
        }) as typeof client.query);
        const leasedClient = client;
        vi.spyOn(pool, 'connect').mockImplementationOnce(async (): Promise<PoolClient> => leasedClient);
      }
      try {
        const error = await authorizeAgentContext({ actorUserId: 'editor', request }).catch((value: unknown) => value);
        expect(error, failure).toMatchObject(unavailable);
        expect(error).not.toHaveProperty('cause');
        expect(String(error)).not.toContain('secret');
        expect(released).toEqual(failure === 'connect' ? [] : [failure === 'ROLLBACK']);
        if (failure !== 'connect') expect(statements).toContain('ROLLBACK');
        if (failure === 'ROLLBACK') expect(pool.totalCount).toBe(0);
        expect(pool.idleCount).toBe(pool.totalCount);
        expect(await snapshot(query)).toEqual(before);
      } finally { vi.restoreAllMocks(); }
      await checkContext(query, 'editor', request, true);
    }
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('PGDATABASE_URL', '');
    try {
      await expect(authorizeAgentContext({ actorUserId: 'editor', request })).rejects.toMatchObject(unavailable);
    } finally { vi.unstubAllEnvs(); }
  });
}, 60_000);

it('runs real context and tool admission before admit, preserves editor actor and ends the transaction before model work', async () => {
  await withIsolatedPostgres('agent-real-gate', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const actor = { id: 'editor', name: 'Editor', role: 'user' as const, status: 'active' as const,
      productType: 'canvas,chat', createdAt: 1, updatedAt: 1 };
    const model: TaskModelDescriptor = {
      providerId: 'provider', modelId: 'model', kind: 'image', sourceType: 'image', protocol: 'images', executionMode: 'async',
      allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false,
      supportsMask: false, supportedOperations: ['text-to-image'], outputKinds: ['png'], capabilitySources: {},
    };
    const resolveModel = vi.fn(async (): Promise<TaskModelDescriptor> => model);
    const admitted: Array<{ actor: string; owner: string | undefined; url: string }> = [];
    const admit = vi.fn(async (context: Awaited<ReturnType<typeof authorizeAgentContext>>): Promise<string> => {
      admitted.push({ actor: actor.id, owner: context.projectAccess?.ownerId, url: context.mediaByVersionId['version-shared'] });
      expect(context.projectAccess).toEqual({ kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '3' });
      return 'admitted-editor';
    });
    const dependencies = { authorizeContext: authorizeAgentContext, resolveTaskModel: resolveModel };
    const beforeFailure = await snapshot(query);
    const failedConnect = vi.spyOn(getPool(), 'connect').mockRejectedValueOnce(new Error('secret DB outage'));
    try {
      await expect(admitAuthorizedAgentExecution({ actor, request, toolId: 'generate_image', admit }, dependencies)).rejects.toMatchObject(unavailable);
      expect(resolveModel).not.toHaveBeenCalled();
      expect(admit).not.toHaveBeenCalled();
      expect(await snapshot(query)).toEqual(beforeFailure);
    } finally { failedConnect.mockRestore(); }
    for (const invalid of [
      { ...request, sourceVersionIds: ['private-version'] },
      { ...request, context: { ...request.context, visibleVersionIds: ['private-version'] } },
      { ...emptyRequest, workspace: 'chat' as const },
    ]) {
      const before = await snapshot(query);
      await expect(admitAuthorizedAgentExecution({ actor, request: invalid, toolId: 'generate_image', admit }, dependencies)).rejects.toMatchObject(notFound);
      expect(resolveModel).not.toHaveBeenCalled();
      expect(admit).not.toHaveBeenCalled();
      expect(await snapshot(query)).toEqual(before);
    }
    await revokeDocumentEditor('owner', 'shared', 'editor');
    const revokedRows = await snapshot(query);
    await expect(admitAuthorizedAgentExecution({ actor, request, toolId: 'generate_image', admit }, dependencies)).rejects.toMatchObject(notFound);
    expect(resolveModel).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(await snapshot(query)).toEqual(revokedRows);
    await grantDocumentEditor('owner', 'shared', 'editor');
    const before = await snapshot(query);
    // A valid context still cannot bypass the real tool registry.
    await expect(admitAuthorizedAgentExecution({ actor, request: { ...request, allowedToolIds: [] }, toolId: 'generate_image', admit }, dependencies))
      .rejects.toMatchObject({ code: 'AGENT_TOOL_AUTHORIZATION_DENIED' });
    expect(admit).not.toHaveBeenCalled();
    expect(await snapshot(query)).toEqual(before);
    resolveModel.mockClear();
    let afterRevocation: Record<string, unknown> | undefined;
    resolveModel.mockImplementationOnce(async (): Promise<TaskModelDescriptor> => {
      expect(getPool().idleCount).toBe(getPool().totalCount);
      await revokeDocumentEditor('owner', 'shared', 'editor');
      afterRevocation = await snapshot(query);
      return model;
    });
    await expect(admitAuthorizedAgentExecution({ actor, request, toolId: 'generate_image', admit }, dependencies)).resolves.toBe('admitted-editor');
    expect(resolveModel).toHaveBeenCalledExactlyOnceWith('provider', 'model', 'editor');
    expect(admitted).toEqual([{ actor: 'editor', owner: 'owner', url: '/api/serve-upload/shared.png' }]);
    expect(await snapshot(query)).toEqual(afterRevocation);
    resolveModel.mockClear();
    admit.mockClear();
    await expect(admitAuthorizedAgentExecution({ actor, request, toolId: 'generate_image', admit }, dependencies)).rejects.toMatchObject(notFound);
    expect(resolveModel).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });
}, 60_000);

const notFound = { code: 'AGENT_CONTEXT_NOT_FOUND', status: 404, message: 'Agent context not found' };
const unavailable = { code: 'GENERATION_PROJECT_UNAVAILABLE', status: 503, message: '项目权限服务暂不可用，请稍后重试' };
const emptyRequest: AgentRunRequest = { ...request, sourceVersionIds: [],
  context: { ...request.context, selectedEntityIds: [], visibleVersionIds: [] } };

/** Every context invocation is surrounded by real rows, including task charges and user credits. */
async function checkContext(query: QueryFn, actorUserId: string, input: AgentRunRequest, allowed: boolean): Promise<void> {
  const before = await snapshot(query);
  if (allowed) {
    const result = await authorizeAgentContext({ actorUserId, request: input });
    expect(result.projectAccess).toEqual({ kind: 'document', actorUserId, ownerId: 'owner', projectId: 'shared',
      grantGeneration: actorUserId === 'owner' ? '0' : '1' });
    for (const id of [...input.sourceVersionIds, ...input.context.visibleVersionIds]) {
      expect(result.mediaByVersionId[id]).toBe('/api/serve-upload/shared.png');
    }
  } else {
    const error = await authorizeAgentContext({ actorUserId, request: input }).catch((value: unknown) => value);
    expect(error).toMatchObject(notFound);
    expect(error).not.toHaveProperty('cause');
  }
  expect(await snapshot(query)).toEqual(before);
  expect(getPool().idleCount).toBe(getPool().totalCount);
}

it('enforces actor, owner, project, editor, settings, document and global authority for populated and empty lists', async () => {
  await withIsolatedPostgres('agent-authority', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    for (const actor of ['owner', 'editor', 'presence', 'admin', 'other', 'missing-user']) {
      for (const input of [request, emptyRequest]) await checkContext(query, actor, input, ['owner', 'editor'].includes(actor));
    }
    for (const [change, restore] of [
      ["UPDATE wujie_users SET status='disabled' WHERE id='editor'", "UPDATE wujie_users SET status='active' WHERE id='editor'"],
      ["UPDATE wujie_users SET status='disabled' WHERE id='owner'", "UPDATE wujie_users SET status='active' WHERE id='owner'"],
      ["UPDATE wujie_projects SET status='trashed' WHERE id='shared'", "UPDATE wujie_projects SET status='active' WHERE id='shared'"],
      ["UPDATE wujie_project_document_editors SET status='revoked'", "UPDATE wujie_project_document_editors SET status='active'"],
      ["UPDATE wujie_project_document_settings SET enabled=false", "UPDATE wujie_project_document_settings SET enabled=true"],
      ["DELETE FROM wujie_project_document_settings", "INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)"],
    ]) {
      await query(change);
      for (const input of [request, emptyRequest]) await checkContext(query, 'editor', input, false);
      await query(restore);
    }
    await query('DELETE FROM wujie_project_canvas_documents');
    for (const actor of ['owner', 'editor']) await checkContext(query, actor, emptyRequest, false);
    await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id,projection) VALUES ('shared','owner',$1)", [JSON.stringify(projection)]);
    for (const flag of ['false', '']) {
      vi.stubEnv('WUJIE_YJS_ENABLED', flag);
      for (const actor of ['owner', 'editor']) for (const input of [request, emptyRequest]) await checkContext(query, actor, input, false);
    }
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('editor','projects','[{"id":"legacy","userId":"editor"}]',1)`);
    for (const input of [request, emptyRequest]) await checkContext(query, 'editor', { ...input, projectId: 'legacy', workspaceId: 'legacy' }, false);
  });
}, 60_000);

it('accepts only the two canvas aliases and keeps owner private scopes separate from editor access', async () => {
  await withIsolatedPostgres('agent-scope', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    for (const stored of ['shared', 'canvas:shared']) {
      await query('UPDATE wujie_workspace_placements SET workspace_id=$1', [stored]);
      for (const workspaceId of ['shared', 'canvas:shared']) await checkContext(query, 'editor', { ...request, workspaceId }, true);
    }
    for (const input of [request, emptyRequest]) {
      for (const workspaceId of ['canvas:foreign', 'foreign', 'canvas:canvas:shared', '']) {
        await checkContext(query, 'editor', { ...input, workspaceId }, false);
      }
      for (const workspace of ['workflow', 'chat'] as const) await checkContext(query, 'editor', { ...input, workspace }, false);
    }
    for (const [workspace, entityType] of [['chat', 'chat-attachment'], ['workflow', 'workflow-input']] as const) {
      await query('UPDATE wujie_workspace_placements SET workspace_kind=$1, workspace_id=$2, entity_type=$3', [workspace, 'private', entityType]);
      const privateRequest = { ...request, workspace, workspaceId: 'private' };
      await checkContext(query, 'owner', privateRequest, true);
      await checkContext(query, 'editor', privateRequest, false);
      await checkContext(query, 'owner', { ...privateRequest, workspaceId: 'another' }, false);
      await checkContext(query, 'editor', request, false);
    }
  });
}, 60_000);

it('blocks source and visible orphan, private, tombstoned, mismatched and inactive media without altering rows', async () => {
  await withIsolatedPostgres('agent-placement', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const visible: AgentRunRequest = { ...emptyRequest, context: { ...emptyRequest.context, visibleVersionIds: ['version-shared'] } };
    for (const [change, restore] of [
      ["UPDATE wujie_workspace_placements SET id='orphan'", "UPDATE wujie_workspace_placements SET id='placement-shared'"],
      ["UPDATE wujie_workspace_placements SET workspace_id='private'", "UPDATE wujie_workspace_placements SET workspace_id='shared'"],
      ["UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now()", "UPDATE wujie_workspace_placements SET status='active',deleted_at=NULL"],
      ["UPDATE wujie_assets SET status='trashed'", "UPDATE wujie_assets SET status='active'"],
      ["UPDATE wujie_asset_versions SET availability='pending-persist'", "UPDATE wujie_asset_versions SET availability='ready'"],
      ["UPDATE wujie_workspace_placements SET workspace_kind='chat',entity_type='chat-attachment'", "UPDATE wujie_workspace_placements SET workspace_kind='canvas',entity_type='canvas-image'"],
      ["UPDATE wujie_workspace_placements SET workspace_kind='workflow',entity_type='workflow-input'", "UPDATE wujie_workspace_placements SET workspace_kind='canvas',entity_type='canvas-image'"],
    ]) {
      await query(change);
      for (const actor of ['owner', 'editor']) for (const input of [request, visible]) await checkContext(query, actor, input, false);
      await query(restore);
    }
    for (const invalidProjection of [
      { placements: {} },
      { placements: { 'placement-shared': { ...projection.placements['placement-shared'], deleted: true } } },
      { placements: { 'placement-shared': { ...projection.placements['placement-shared'], assetVersionId: 'version-other' } } },
      { ...projection, annotationRecords: { bad: { id: 'bad' } } },
      { placements: { ...projection.placements, invalid: { assetVersionId: 'version-shared' } } },
    ]) {
      await query('UPDATE wujie_project_canvas_documents SET projection=$1', [JSON.stringify(invalidProjection)]);
      for (const input of [request, visible]) await checkContext(query, 'editor', input, false);
      if ('annotationRecords' in invalidProjection || 'invalid' in invalidProjection.placements) {
        await checkContext(query, 'editor', emptyRequest, false);
      }
    }
    await query('UPDATE wujie_project_canvas_documents SET projection=$1', [JSON.stringify(projection)]);
    await checkContext(query, 'editor', visible, true);
    await query("UPDATE wujie_workspace_placements SET entity_id='renamed-entity'");
    for (const actor of ['owner', 'editor']) {
      await checkContext(query, actor, request, false);
      await checkContext(query, actor, visible, true);
      await checkContext(query, actor, { ...emptyRequest, sourceVersionIds: ['version-shared'] }, true);
    }
    await query("UPDATE wujie_workspace_placements SET entity_id='image-shared'");
    // A non-null deleted_at on an active row cannot be fabricated under the real schema.
    await expect(query('UPDATE wujie_workspace_placements SET deleted_at=now()')).rejects.toMatchObject({ code: '23514' });
    // Earlier orphan of the SAME version must not mask the later canonical match.
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id,created_at)
      VALUES ('earlier-orphan','owner','shared','asset-shared','version-shared','canvas','shared','canvas-image','orphan','2000-01-01')`);
    await checkContext(query, 'editor', request, true);
    await checkContext(query, 'editor', visible, true);
  });
}, 60_000);

it('preserves source image/MIME validation, permits legacy missing MIME and rejects foreign asset splicing and selected mismatches', async () => {
  await withIsolatedPostgres('agent-media', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    for (const mime of ['video/mp4', 'image/svg+xml', 'application/octet-stream']) {
      await query('UPDATE wujie_asset_versions SET mime_type=$1', [mime]);
      await checkContext(query, 'editor', request, false);
    }
    for (const mime of [null, '', ' IMAGE/PNG ']) {
      await query('UPDATE wujie_asset_versions SET mime_type=$1', [mime]);
      await checkContext(query, 'editor', request, true);
    }
    await query("UPDATE wujie_assets SET kind='video'");
    await query("UPDATE wujie_asset_versions SET mime_type='video/mp4'");
    await query("UPDATE wujie_workspace_placements SET entity_type='canvas-video'");
    await checkContext(query, 'editor', request, false);
    await checkContext(query, 'editor', { ...emptyRequest, context: { ...request.context, visibleVersionIds: ['version-shared'] } }, true);
    await query("UPDATE wujie_assets SET kind='image'");
    await query("UPDATE wujie_asset_versions SET mime_type='image/png'");
    await query("UPDATE wujie_workspace_placements SET entity_type='canvas-image'");
    for (const input of [
      { ...request, context: { ...request.context, selectedEntityIds: ['missing'] } },
      { ...emptyRequest, context: request.context },
    ]) await checkContext(query, 'editor', input, false);
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url)
      VALUES ('version-private','asset-shared','owner','shared','/api/serve-upload/private.png')`);
    await query("UPDATE wujie_workspace_placements SET asset_version_id='version-private'");
    await checkContext(query, 'editor', request, false);
    await query("UPDATE wujie_workspace_placements SET asset_version_id='version-shared'");
    await query(`INSERT INTO wujie_projects(id,owner_id,name) VALUES ('foreign','other','Foreign'),('owner-private','owner','Private')`);
    await query(`INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES
      ('asset-foreign','other','foreign','image'), ('asset-private','owner','owner-private','image')`);
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url) VALUES
      ('version-foreign','asset-foreign','other','foreign','/foreign.png'), ('version-other-project','asset-private','owner','owner-private','/private.png')`);
    for (const id of ['version-private', 'version-foreign', 'version-other-project']) {
      await checkContext(query, 'editor', { ...emptyRequest, sourceVersionIds: [id] }, false);
      await checkContext(query, 'editor', { ...emptyRequest, context: { ...emptyRequest.context, visibleVersionIds: [id] } }, false);
    }
    await expect(query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url)
      VALUES ('spliced','asset-foreign','owner','shared','/forged.png')`)).rejects.toMatchObject({ code: '23503' });
    const forged = { ...request, ownerId: 'editor', url: '/forged.png', projectAccess: {
      kind: 'document', actorUserId: 'owner', ownerId: 'editor', projectId: 'foreign', grantGeneration: '999',
    } };
    await checkContext(query, 'editor', forged, true);
    await checkContext(query, 'other', forged, false);
  });
}, 60_000);
