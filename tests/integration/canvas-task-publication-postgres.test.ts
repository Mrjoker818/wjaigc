import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import { createBillableTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { grantDocumentEditor, revokeDocumentEditor } from '@/lib/collaboration/document-access';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { GenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import { ensureCoreTables } from '@/lib/db-storage';
import { createAgentRuntimeService } from '@/lib/agent-runtime/service';
import type { AgentEvent } from '@/lib/agent-runtime/types';
import { getPool } from '@/lib/db-client';
import type { PoolClient } from 'pg';
import { prepareCanvasTaskPublicationInTransaction, persistCanvasTaskPublicationInTransaction,
  type PreparedCanvasTaskPublication } from '@/lib/collaboration/task-publication';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const request: AgentRunRequest = {
  projectId: 'shared', workspace: 'canvas', workspaceId: 'canvas:shared',
  mode: 'agent', providerId: 'provider', modelId: 'model', prompt: 'Use shared image',
  sourceVersionIds: ['version-shared'], allowedToolIds: ['generate_image'], idempotencyKey: 'run',
  context: { selectedEntityIds: ['image-shared'], visibleVersionIds: [], locale: 'zh-CN' },
};

async function seed(query: QueryFn, databaseUrl: string): Promise<void> {
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  console.log('Full migrations:', migration.status, migration.stdout, migration.stderr);
  expect(migration.status, migration.stderr || migration.stdout).toBe(0);
  await ensureCoreTables();
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1), ('editor','Editor','test','active','user',1,1),
    ('admin','Admin','test','active','admin',1,1), ('presence','Presence','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  await query("INSERT INTO wujie_project_presence_members (project_id,owner_id,member_user_id) VALUES ('shared','owner','presence')");
  await query("INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('asset-shared','owner','shared','image')");
  await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,file_url,mime_type)
    VALUES ('version-shared','asset-shared','owner','shared','/api/serve-upload/shared.png','image/png')`);
  await query(`INSERT INTO wujie_workspace_placements
    (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
    VALUES ('placement-shared','owner','shared','asset-shared','version-shared','canvas','shared','canvas-image','image-shared')`);
  await query(`INSERT INTO wujie_project_canvas_documents (project_id,owner_id,projection)
    VALUES ('shared','owner',$1::jsonb)`, [JSON.stringify({ placements: { 'placement-shared': {
      assetVersionId: 'version-shared', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0,
    } } })]);
  await query(`INSERT INTO wujie_credits (id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    SELECT 'credits_' || id,id,100,100,0,1,1 FROM wujie_users`);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}

function billable(access: GenerationProjectAccess, id = 'task'): CreateBillableTaskInput {
  if (access.kind !== 'document') throw new Error('Fixture requires document access');
  return {
    userId: access.actorUserId, idempotencyKey: id, requestDigest: 'digest', creditCost: 7,
    task: { id, projectId: 'shared', type: 'agent', status: 'processing', progress: 0, createdAt: 1, updatedAt: 1 },
    canvasPublication: { access, workspace: 'canvas', workspaceId: 'canvas:shared' },
  };
}

async function publicationRows(query: QueryFn): Promise<unknown[]> {
  return (await query(`SELECT task_id,actor_id,owner_id,project_id,workspace_id,grant_generation::text
    FROM wujie_canvas_task_publications ORDER BY task_id`)).rows;
}

const editorAccess: Extract<GenerationProjectAccess, { kind: 'document' }> = {
  kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '1',
};
const forbidden = { status: 403, code: 'CANVAS_TASK_PUBLICATION_FORBIDDEN' };
const unavailable = { status: 503, code: 'CANVAS_TASK_PUBLICATION_UNAVAILABLE',
  message: '任务画布发布授权服务暂不可用，请稍后重试' };

async function snapshot(query: QueryFn, tables: string[] = [
  'wujie_users', 'wujie_projects', 'wujie_assets', 'wujie_asset_versions', 'wujie_workspace_placements',
  'wujie_project_canvas_documents', 'wujie_project_document_settings', 'wujie_project_document_editors',
  'cloud_tasks', 'wujie_credits', 'wujie_credit_transactions', 'wujie_canvas_task_publications',
]): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of tables) result[table] = (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}

it('real billing freezes one server-authorized editor intent and charges only the actor', async () => {
  await withIsolatedPostgres('publication-red', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const context = await authorizeAgentContext({ actorUserId: 'editor', request });
    const protectedTables = ['wujie_users', 'wujie_projects', 'wujie_assets', 'wujie_asset_versions',
      'wujie_workspace_placements', 'wujie_project_canvas_documents'];
    const before = await snapshot(query, protectedTables);
    const outcome = await createBillableTask(billable(context.projectAccess!));
    expect(outcome.charged).toBe(true);
    expect(await publicationRows(query)).toEqual([{ task_id: outcome.task.id, actor_id: 'editor', owner_id: 'owner',
      project_id: 'shared', workspace_id: 'shared', grant_generation: '1' }]);
    expect((await query('SELECT user_id,balance FROM wujie_credits WHERE user_id IN (\'editor\',\'owner\') ORDER BY user_id')).rows)
      .toEqual([{ user_id: 'editor', balance: 93 }, { user_id: 'owner', balance: 100 }]);
    expect(await snapshot(query, protectedTables)).toEqual(before);
    expect((await query("SELECT user_id,type,amount FROM wujie_credit_transactions")).rows)
      .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }]);
  });
}, 60_000);

it('rejects malformed scope, foreign identities, non-editors and every disabled authority without business writes', async () => {
  await withIsolatedPostgres('publication-denials', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const valid = billable(editorAccess);
    const shapes: unknown[] = [null, {}, { ...valid.canvasPublication, access: null },
      ...['personal', 'unscoped', 'admin'].map(kind => ({ ...valid.canvasPublication, access: { ...editorAccess, kind } })),
      ...['workflow', 'chat', null].map(workspace => ({ ...valid.canvasPublication, workspace })),
      ...['foreign', 'canvas:foreign', 'canvas:canvas:shared', ' shared', 'shared ', ''].map(workspaceId => ({ ...valid.canvasPublication, workspaceId })),
      ...[NaN, -1, 1, '', '01', '-1', '+1', '1.0', ' 1', '1 ', '1\n', '9223372036854775808', '0'].map(grantGeneration => (
        { ...valid.canvasPublication, access: { ...editorAccess, grantGeneration } })),
      ...[{ actorUserId: 'owner' }, { actorUserId: ' editor' }, { ownerId: 'editor' }, { ownerId: '' },
        { ownerId: ' owner' }, { ownerId: 'missing' }, { projectId: 'foreign' }].map(change => (
        { ...valid.canvasPublication, access: { ...editorAccess, ...change } })),
    ];
    for (const canvasPublication of shapes) {
      const before = await snapshot(query);
      await expect(createBillableTask({ ...valid, canvasPublication } as CreateBillableTaskInput)).rejects.toMatchObject(forbidden);
      expect(await snapshot(query)).toEqual(before);
    }
    for (const actorUserId of ['admin', 'presence']) {
      const before = await snapshot(query);
      await expect(createBillableTask(billable({ ...editorAccess, actorUserId }))).rejects.toMatchObject(forbidden);
      expect(await snapshot(query)).toEqual(before);
    }
    for (const [change, restore] of [
      ["UPDATE wujie_users SET status='disabled' WHERE id='editor'", "UPDATE wujie_users SET status='active' WHERE id='editor'"],
      ["UPDATE wujie_users SET status='disabled' WHERE id='owner'", "UPDATE wujie_users SET status='active' WHERE id='owner'"],
      ["UPDATE wujie_projects SET status='trashed'", "UPDATE wujie_projects SET status='active'"],
      ["UPDATE wujie_project_document_editors SET status='revoked'", "UPDATE wujie_project_document_editors SET status='active'"],
      ["UPDATE wujie_project_document_editors SET grant_generation=2", "UPDATE wujie_project_document_editors SET grant_generation=1"],
      ["UPDATE wujie_project_document_settings SET enabled=false", "UPDATE wujie_project_document_settings SET enabled=true"],
      ["DELETE FROM wujie_project_document_settings", "INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)"],
      ["DELETE FROM wujie_project_canvas_documents", "INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')"],
    ]) {
      await query(change);
      const before = await snapshot(query);
      await expect(createBillableTask(valid)).rejects.toMatchObject(forbidden);
      expect(await snapshot(query)).toEqual(before);
      await query(restore);
    }
    for (const flag of ['', 'false', 'TRUE', '1']) {
      vi.stubEnv('WUJIE_YJS_ENABLED', flag);
      const before = await snapshot(query);
      await expect(createBillableTask(valid)).rejects.toMatchObject(forbidden);
      expect(await snapshot(query)).toEqual(before);
    }
  });
}, 60_000);

it('keeps one charge and frozen generation across 20 concurrent calls, regrants, terminal replay and zero cost', async () => {
  await withIsolatedPostgres('publication-replay', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const attempts = await Promise.all(Array.from({ length: 20 }, (_, i) => {
      const input = billable(editorAccess, `attempt-${i}`);
      input.idempotencyKey = 'same-key';
      return createBillableTask(input);
    }));
    expect(new Set(attempts.map(value => value.task.id)).size).toBe(1);
    expect(attempts.filter(value => value.charged)).toHaveLength(1);
    expect(attempts.filter(value => !value.reused)).toHaveLength(1);
    const winner = attempts[0].task.id;
    expect(await publicationRows(query)).toEqual([{ task_id: winner, actor_id: 'editor', owner_id: 'owner',
      project_id: 'shared', workspace_id: 'shared', grant_generation: '1' }]);
    expect((await query('SELECT * FROM wujie_credit_transactions')).rows).toHaveLength(1);
    const legacy = billable(editorAccess, 'legacy'); delete legacy.canvasPublication;
    await createBillableTask(legacy);
    await revokeDocumentEditor('owner', 'shared', 'editor');
    await grantDocumentEditor('owner', 'shared', 'editor');
    const before = await snapshot(query);
    await expect(createBillableTask(billable(editorAccess, 'stale'))).rejects.toMatchObject(forbidden);
    expect(await snapshot(query)).toEqual(before);
    const fresh = { ...editorAccess, grantGeneration: '3' };
    const replay = { ...billable(fresh, 'discarded'), idempotencyKey: 'same-key' };
    for (const status of ['completed', 'failed', 'cancelled']) {
      await query('UPDATE cloud_tasks SET status=$1,result=$2 WHERE id=$3', [status, { imageUrl: '/original.png' }, winner]);
      const rows = await snapshot(query);
      await expect(createBillableTask(replay)).resolves.toMatchObject({ reused: true, charged: false,
        task: { id: winner, status, result: { imageUrl: '/original.png' } } });
      expect(await snapshot(query)).toEqual(rows);
    }
    await expect(createBillableTask({ ...replay, requestDigest: 'different' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    await expect(createBillableTask({ ...replay, canvasPublication: null } as unknown as CreateBillableTaskInput))
      .resolves.toMatchObject({ reused: true, charged: false });
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    await expect(createBillableTask(billable(fresh, 'legacy'))).resolves.toMatchObject({ reused: true, charged: false });
    expect(await publicationRows(query)).toHaveLength(1);
    const ownerInput = billable({ ...editorAccess, actorUserId: 'owner', grantGeneration: '0' }, 'owner-zero');
    ownerInput.creditCost = 0;
    ownerInput.canvasPublication!.workspaceId = 'shared';
    await expect(createBillableTask(ownerInput)).resolves.toMatchObject({ charged: false });
    await expect(createBillableTask(ownerInput)).resolves.toMatchObject({ reused: true, charged: false });
    expect(await publicationRows(query)).toContainEqual({ task_id: 'owner-zero', actor_id: 'owner', owner_id: 'owner',
      project_id: 'shared', workspace_id: 'shared', grant_generation: '0' });
    expect((await query("SELECT * FROM wujie_credit_transactions WHERE user_id='owner'")).rows).toEqual([]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='owner'")).rows).toEqual([{ balance: 100 }]);
    const insufficient = { ...billable(fresh, 'insufficient'), creditCost: 1000 };
    const rows = await snapshot(query);
    await expect(createBillableTask(insufficient)).rejects.toMatchObject({ name: 'InsufficientCreditsError' });
    expect(await snapshot(query)).toEqual(rows);
    await query("UPDATE wujie_project_document_editors SET grant_generation=9223372036854775807");
    await createBillableTask(billable({ ...fresh, grantGeneration: '9223372036854775807' }, 'max-generation'));
    expect(await publicationRows(query)).toContainEqual({ task_id: 'max-generation', actor_id: 'editor', owner_id: 'owner',
      project_id: 'shared', workspace_id: 'shared', grant_generation: '9223372036854775807' });
  });
}, 60_000);

it('rolls back SQL, insert, commit and connection failures; discards broken rollback and keeps the pool usable', async () => {
  await withIsolatedPostgres('publication-faults', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    // Initialize only existing runtime DDL before injecting faults in the billing transaction.
    const warm = billable(editorAccess, 'warm'); delete warm.canvasPublication; warm.creditCost = 0;
    await createBillableTask(warm);
    for (const failure of ['connect', 'BEGIN', 'permission', 'document', 'task-insert', 'consume-insert',
      'intent-insert', 'COMMIT', 'ROLLBACK', 'insufficient-rollback', 'conflict-rollback'] as const) {
      const before = await snapshot(query);
      const pool = getPool();
      const releases: Array<boolean | undefined> = [];
      const statements: string[] = [];
      if (failure === 'connect') vi.spyOn(pool, 'connect').mockRejectedValueOnce(new Error('secret connection URL'));
      else {
        const client = await pool.connect();
        const original = client.query.bind(client) as QueryFn;
        const release = client.release.bind(client);
        vi.spyOn(client, 'release').mockImplementation((discard?: Error | boolean) => {
          releases.push(typeof discard === 'boolean' ? discard : undefined); release(discard);
        });
        vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
          statements.push(sql);
          if ((failure === 'BEGIN' && sql === 'BEGIN')
            || (failure === 'permission' && sql.includes('SELECT p.owner_id'))
            || (failure === 'document' && sql.includes('SELECT 1 FROM wujie_project_canvas_documents'))
            || (failure === 'task-insert' && sql.includes('INSERT INTO cloud_tasks'))
            || (failure === 'consume-insert' && sql.includes('INSERT INTO wujie_credit_transactions'))
            || (failure === 'intent-insert' && sql.includes('INSERT INTO wujie_canvas_task_publications'))
            || (failure === 'COMMIT' && sql === 'COMMIT')
            || (failure === 'ROLLBACK' && (sql.includes('INSERT INTO wujie_canvas_task_publications') || sql === 'ROLLBACK'))
            || (failure.endsWith('-rollback') && sql === 'ROLLBACK')) {
            return original('SELECT secret_missing_column');
          }
          return original(sql, values);
        }) as typeof client.query);
        vi.spyOn(pool, 'connect').mockImplementationOnce(async (): Promise<PoolClient> => client);
      }
      try {
        const input = billable(editorAccess, `failure-${failure}`);
        if (failure === 'insufficient-rollback') input.creditCost = 1000;
        if (failure === 'conflict-rollback') { input.idempotencyKey = 'warm'; input.requestDigest = 'conflict'; }
        const error: unknown = await createBillableTask(input).catch((value: unknown) => value);
        expect(error, failure).toMatchObject(unavailable);
        expect(error).not.toHaveProperty('cause');
        expect(String(error)).not.toContain('secret');
        const broken = failure === 'ROLLBACK' || failure.endsWith('-rollback');
        expect(releases).toEqual(failure === 'connect' ? [] : [broken]);
        if (failure !== 'connect') expect(statements).toContain('ROLLBACK');
        expect(await snapshot(query)).toEqual(before);
      } finally { vi.restoreAllMocks(); }
      expect((await pool.query('SELECT 1 AS healthy')).rows).toEqual([{ healthy: 1 }]);
      expect(pool.idleCount).toBe(pool.totalCount);
    }
    await query('ALTER TABLE wujie_canvas_task_publications RENAME TO temporarily_hidden_publications');
    try {
      const before = await snapshot(query, ['cloud_tasks', 'wujie_credits', 'wujie_credit_transactions']);
      await expect(createBillableTask(billable(editorAccess, 'missing-table'))).rejects.toMatchObject(unavailable);
      expect(await snapshot(query, ['cloud_tasks', 'wujie_credits', 'wujie_credit_transactions'])).toEqual(before);
      const legacy = billable(editorAccess, 'legacy-without-table'); delete legacy.canvasPublication;
      await expect(createBillableTask(legacy)).resolves.toMatchObject({ charged: true });
      await expect(createBillableTask(billable(editorAccess, 'legacy-without-table'))).resolves.toMatchObject({ reused: true, charged: false });
    } finally { await query('ALTER TABLE temporarily_hidden_publications RENAME TO wujie_canvas_task_publications'); }
    expect((await query(`SELECT state FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND state LIKE 'idle in transaction%'`)).rows).toEqual([]);
  });
}, 60_000);

it('rejects forged or cross-client prepared handles, checks actual task identity and never overwrites a tuple', async () => {
  await withIsolatedPostgres('publication-handles', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    await createBillableTask(billable(editorAccess, 'existing'));
    const client = await getPool().connect();
    const other = await getPool().connect();
    try {
      await client.query('BEGIN');
      const prepared = await prepareCanvasTaskPublicationInTransaction(client, {
        actorUserId: 'editor', projectId: 'shared', publication: billable(editorAccess).canvasPublication!,
      });
      for (const forged of [{}, JSON.parse(JSON.stringify(prepared)), { ...prepared }]) {
        await expect(persistCanvasTaskPublicationInTransaction(client, { taskId: 'existing', publication: forged as PreparedCanvasTaskPublication }))
          .rejects.toMatchObject(forbidden);
      }
      await expect(persistCanvasTaskPublicationInTransaction(other, { taskId: 'existing', publication: prepared })).rejects.toMatchObject(forbidden);
      await expect(persistCanvasTaskPublicationInTransaction(client, { taskId: 'absent', publication: prepared })).rejects.toMatchObject(forbidden);
      await client.query("UPDATE cloud_tasks SET user_id='owner' WHERE id='existing'");
      await expect(persistCanvasTaskPublicationInTransaction(client, { taskId: 'existing', publication: prepared })).rejects.toMatchObject(forbidden);
      await client.query("UPDATE cloud_tasks SET user_id='editor',project_id='foreign' WHERE id='existing'");
      await expect(persistCanvasTaskPublicationInTransaction(client, { taskId: 'existing', publication: prepared })).rejects.toMatchObject(forbidden);
      await client.query('ROLLBACK');
      await revokeDocumentEditor('owner', 'shared', 'editor');
      await grantDocumentEditor('owner', 'shared', 'editor');
      await client.query('BEGIN');
      const fresh = await prepareCanvasTaskPublicationInTransaction(client, {
        actorUserId: 'editor', projectId: 'shared', publication: billable({ ...editorAccess, grantGeneration: '3' }).canvasPublication!,
      });
      await expect(persistCanvasTaskPublicationInTransaction(client, { taskId: 'existing', publication: fresh })).rejects.toMatchObject({
        code: 'CANVAS_TASK_PUBLICATION_CONFLICT', status: 409,
      });
      await client.query('ROLLBACK');
      expect(await publicationRows(query)).toEqual([{ task_id: 'existing', actor_id: 'editor', owner_id: 'owner',
        project_id: 'shared', workspace_id: 'shared', grant_generation: '1' }]);
    } finally { await client.query('ROLLBACK'); client.release(); other.release(); }
  });
}, 60_000);

it('holds editor authorization until the original billing COMMIT while revocation waits in another real session', async () => {
  await withIsolatedPostgres('publication-lock-race', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const context = await authorizeAgentContext({ actorUserId: 'editor', request });
    const warm = billable(editorAccess, 'warm'); delete warm.canvasPublication; warm.creditCost = 0;
    await createBillableTask(warm);
    const pool = getPool();
    const billingClient = await pool.connect();
    const revoker = await pool.connect();
    const pid = Number((await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    let reachCommit!: () => void;
    let allowCommit!: () => void;
    const reached = new Promise<void>(resolve => { reachCommit = resolve; });
    const allowed = new Promise<void>(resolve => { allowCommit = resolve; });
    const original = billingClient.query.bind(billingClient) as QueryFn;
    vi.spyOn(billingClient, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
      if (sql === 'COMMIT') { reachCommit(); await allowed; }
      return original(sql, values);
    }) as typeof billingClient.query);
    vi.spyOn(pool, 'connect').mockImplementationOnce(async (): Promise<PoolClient> => billingClient);
    const billing = createBillableTask(billable(context.projectAccess!, 'locked-task'));
    let revoke: Promise<unknown> | undefined;
    try {
      await reached;
      await revoker.query('BEGIN');
      revoke = revoker.query("UPDATE wujie_project_document_editors SET status='revoked',grant_generation=2 WHERE member_user_id='editor'");
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked = (await query<{ blocked: boolean }>('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      expect(await publicationRows(query)).toEqual([]);
      allowCommit();
      await expect(billing).resolves.toMatchObject({ charged: true });
      await revoke;
      await revoker.query('COMMIT');
      expect(await publicationRows(query)).toEqual([{ task_id: 'locked-task', actor_id: 'editor', owner_id: 'owner',
        project_id: 'shared', workspace_id: 'shared', grant_generation: '1' }]);
      await expect(createBillableTask(billable(context.projectAccess!, 'after-revoke'))).rejects.toMatchObject(forbidden);
    } finally {
      allowCommit(); await billing.catch(() => undefined); await revoke?.catch(() => undefined);
      await revoker.query('ROLLBACK'); revoker.release(); vi.restoreAllMocks();
    }
    expect(pool.idleCount).toBe(pool.totalCount);
  });
}, 60_000);

it('real billing refuses a revoked snapshot before task or charge', async () => {
  await withIsolatedPostgres('publication-revoked-red', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const context = await authorizeAgentContext({ actorUserId: 'editor', request });
    await revokeDocumentEditor('owner', 'shared', 'editor');
    await expect(createBillableTask(billable(context.projectAccess!))).rejects.toMatchObject({
      status: 403, code: 'CANVAS_TASK_PUBLICATION_FORBIDDEN',
    });
    expect((await query('SELECT * FROM cloud_tasks')).rows).toEqual([]);
    expect((await query('SELECT * FROM wujie_credit_transactions')).rows).toEqual([]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='editor'")).rows).toEqual([{ balance: 100 }]);
  });
}, 60_000);

it('real createRun carries the server context through real billing, ignoring forged request scope', async () => {
  await withIsolatedPostgres('publication-service', async ({ query, databaseUrl }) => {
    await seed(query, databaseUrl);
    const events: AgentEvent[] = [];
    const service = createAgentRuntimeService({
      randomUUID: () => 'service-task', now: () => 1,
      authorizeContext: authorizeAgentContext, createBillableTask,
      listRunEventStreams: async () => [],
      getTaskForUser: async () => { throw new Error('Unused boundary'); },
      transitionTask: async () => { throw new Error('Unused boundary'); },
      settleFailedTask: async () => { throw new Error('Unexpected event failure'); },
      abortTaskExecution: () => false,
      calculateCreditCost: async () => 7,
      resolveTaskModel: async () => ({
        providerId: 'provider', modelId: 'model', kind: 'chat', sourceType: 'chat',
        protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [],
        maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {},
      }),
      appendEvent: async input => {
        const event: AgentEvent = { eventId: input.eventId, runId: input.runId, sequence: 1,
          type: input.type, timestamp: new Date(1).toISOString(), payload: input.payload };
        events.push(event);
        return event;
      },
      listEvents: async () => events,
    });
    const forged = { ...request, canvasPublication: { access: { ownerId: 'attacker', grantGeneration: '99' } },
      projectAccess: { ownerId: 'attacker' }, ownerId: 'attacker' };
    const outcome = await service.createRun({
      actor: { id: 'editor', name: 'Editor', role: 'user', status: 'active', productType: 'canvas,chat', createdAt: 1, updatedAt: 1 },
      request: forged,
    });
    expect(outcome.charged).toBe(true);
    expect(await publicationRows(query)).toEqual([{ task_id: 'service-task', actor_id: 'editor', owner_id: 'owner',
      project_id: 'shared', workspace_id: 'shared', grant_generation: '1' }]);
    expect((await query("SELECT result FROM cloud_tasks WHERE id='service-task'")).rows[0].result)
      .not.toHaveProperty('canvasPublication');
  });
}, 60_000);
