import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import type { QueryFn } from '../helpers/postgres-test-database';
import { withOwnedSketchPostgres as withIsolatedPostgres, readOwnedSketchFixture, assertOwnedSketchSchema } from '../helpers/owned-sketch-postgres-fixture';
import { ensureCoreTables } from '@/lib/db-storage';
import { getPool } from '@/lib/db-client';
import { claimCloudTaskLease, ensureCloudTaskTables, getCloudTaskById, terminateCloudTaskAndRefund,
  type SketchTaskSettlementFence } from '@/lib/cloud-task-storage';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { admitSketchTask, type SketchTaskAdmission } from '@/lib/sketch-to-code/admission';
import { executeSketchTask, recoverExpiredSketchTask, type SketchRecoveryIdentity } from '@/lib/sketch-to-code/execution';
import type { SketchGenerationDependencies } from '@/lib/sketch-to-code/generation';

// SQL, billing, leases, auth and terminal settlement are real. Only the import
// sentinel is replaced; no provider HTTP is dispatched by this fixture.
vi.mock('server-only', () => ({}));
const ownedFixture = await vi.hoisted(async (): Promise<import('../helpers/owned-sketch-postgres-fixture').OwnedSketchFixture | undefined> => {
  const { readOwnedSketchFixture } = await import('../helpers/owned-sketch-postgres-fixture');
  return readOwnedSketchFixture();
});
const input = { projectId: 'project-a', imageDataUrl: createCanvas(2, 2).toDataURL('image/png'), instruction: '还原草图',
  providerId: 'p1', modelId: 'vision-1', idempotencyKey: 'nonce-1' };
const access = { kind: 'personal' as const, actorUserId: 'user-a', ownerId: 'user-a', projectId: 'project-a' };

function requireOwnedLoopback(): void {
  if (ownedFixture) {
    if (!readOwnedSketchFixture()) throw new Error('Explicit owned sketch fixture mode lost');
    return;
  }
  const value = process.env.POSTGRES_TEST_DATABASE_URL;
  if (process.env.SKETCH_TOKEN_OWNED_FIXTURE === '97af41') {
    const fixture = resolve('output/sketch-token-pg-20261009-97af41');
    const manifest = JSON.parse(readFileSync(resolve(fixture, 'cluster.json'), 'utf8')) as { databaseUrl: string; systemIdentifier: string };
    if (fixture !== resolve('J:/无界本地版/projects/_upstream-wjaigc-restore/output/sketch-token-pg-20261009-97af41')
      || value !== 'postgresql://sketch_token_test@127.0.0.1:53651/postgres?sslmode=disable'
      || manifest.databaseUrl !== value || manifest.systemIdentifier !== '7694645594810926408') throw new Error('Explicit owned Token fixture required');
    return;
  }
  if (!value) throw new Error('Explicit master-provided POSTGRES_TEST_DATABASE_URL required');
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '53649'
    || url.username !== 'sketch_exec_test' || url.pathname !== '/postgres') throw new Error('Only the master-provided fix1 loopback fixture is allowed');
}
async function seed(query: QueryFn, databaseUrl: string, schemaName: string): Promise<SketchTaskAdmission> {
  if (ownedFixture) assertOwnedSketchSchema(databaseUrl);
  if (!ownedFixture && process.env.SKETCH_TOKEN_OWNED_FIXTURE === '97af41') {
    requireOwnedLoopback();
    expect((await query<{ id: string }>('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id).toBe('7694645594810926408');
  }
  const migrations = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(migrations.status, migrations.stderr || migrations.stdout).toBe(0);
  await ensureCoreTables(); await ensureCloudTaskTables();
  console.info('Sketch execution PG schema:', schemaName, 'full migrations native:', migrations.status);
  await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('user-a','Owner','test','active','user',1,1)");
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-a','user-a','Personal')");
  await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('credits-a','user-a',100,100,0,1,1)");
  const generation: SketchGenerationDependencies = {
    authorizeProject: (actorUserId, projectId) => authorizeGenerationProject({ actorUserId, projectId }),
    resolveTaskModel: async (providerId, modelId) => ({ providerId, modelId, kind: 'chat', sourceType: 'vlm', protocol: 'chat-completions',
      executionMode: 'sync', supportsVision: true, supportsMask: false, supportsReferenceImages: false, allowedRatios: [], allowedSizes: [],
      qualityOptions: [], maxOutputs: 1, outputKinds: ['text'], capabilitySources: {} }),
    analyze: async (): Promise<never> => { throw new Error('Safe fixture compute failure'); },
    reconstruct: async (): Promise<never> => { throw new Error('Failed analysis must not reconstruct'); },
  };
  return admitSketchTask(input, { actorUserId: 'user-a', signal: new AbortController().signal }, {
    generation, loadPricingConfig: async () => ({ modelCredits: { 'p1::vision-1': 7 } }),
  });
}
async function snapshot(query: QueryFn): Promise<Record<string, unknown>> {
  const rows: Record<string, unknown> = {};
  for (const table of ['cloud_tasks', 'wujie_credits', 'wujie_credit_transactions', 'wujie_refund_identity_claims',
    'wujie_assets', 'wujie_asset_versions', 'wujie_workspace_placements']) {
    rows[table] = (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return rows;
}
async function fenceFor(taskId: string, ttl = 180_000): Promise<SketchTaskSettlementFence> {
  const lease = await claimCloudTaskLease(taskId, 'fixture-owner', ttl);
  const task = await getCloudTaskById(taskId);
  if (!task || !lease) throw new Error('Real admission/lease fixture failed');
  return { actorUserId: 'user-a', projectId: 'project-a', providerId: 'p1', modelId: 'vision-1',
    requestDigest: task.requestDigest!, idempotencyKey: 'nonce-1', access, leaseOwner: lease.owner,
    attemptCount: lease.attemptCount, leaseExpiresAt: lease.expiresAt, settleBefore: Date.now() + 1000 };
}
async function rowLock(taskId: string, balance = false): Promise<{ wait(query: QueryFn): Promise<void>; release(): Promise<void>; mutate(sql: string, values?: unknown[]): Promise<void> }> {
  const client = await getPool().connect(); let released = false;
  try {
    await client.query('BEGIN');
    await client.query(balance ? 'SELECT user_id FROM wujie_credits WHERE user_id=(SELECT user_id FROM cloud_tasks WHERE id=$1) FOR UPDATE'
      : 'SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE', [taskId]);
    const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    return {
      wait: async query => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const blocked = (await query<{ count: number }>('SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows[0].count;
          if (blocked > 0) return;
          await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
        }
        throw new Error('Settlement did not reach the real PostgreSQL row lock');
      },
      mutate: async (sql, values) => { await client.query(sql, values); },
      release: async () => { if (released) return; released = true; try { await client.query('COMMIT'); } finally { client.release(); } },
    };
  } catch (error) { await client.query('ROLLBACK'); client.release(); throw error; }
}
async function waitDatabasePast(query: QueryFn, timestamp: number): Promise<void> {
  await query('SELECT pg_sleep(GREATEST(0, ($1::numeric - EXTRACT(EPOCH FROM clock_timestamp()) * 1000) / 1000) + 0.05)', [timestamp]);
  const time = (await query<{ now: string }>('SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint::text AS now')).rows[0].now;
  expect(Number(time)).toBeGreaterThan(timestamp);
}
async function accounting(query: QueryFn, refunded: boolean): Promise<void> {
  expect((await query('SELECT balance,total_used FROM wujie_credits')).rows).toEqual([{ balance: refunded ? 100 : 86, total_used: refunded ? 0 : 14 }]);
  expect((await query("SELECT type,amount,count(*)::int AS count FROM wujie_credit_transactions GROUP BY type,amount ORDER BY type")).rows)
    .toEqual(refunded ? [{ type: 'consume', amount: -14, count: 1 }, { type: 'refund', amount: 14, count: 1 }] : [{ type: 'consume', amount: -14, count: 1 }]);
}
describe('fix1 sketch execution against the owned real PostgreSQL fixture', () => {
  it.each(['lease-expiry', 'settlement-deadline'] as const)('refuses a row-lock waiter after DB %s without task/accounting writes', async change => {
    requireOwnedLoopback();
    await withIsolatedPostgres('sketch_execution_lock_time', async ({ query, databaseUrl, schemaName }) => {
      const admitted = await seed(query, databaseUrl, schemaName);
      const fence = await fenceFor(admitted.task.id, change === 'lease-expiry' ? 1500 : 180_000);
      // Isolate DB lease expiry from the executor's shorter response deadline.
      if (change === 'lease-expiry') fence.settleBefore = Date.now() + 10_000;
      const before = await snapshot(query); const lock = await rowLock(admitted.task.id);
      const running = Promise.allSettled([terminateCloudTaskAndRefund(admitted.task.id, 'failed', 'safe', fence.leaseOwner,
        { requireActive: true, expectedSketchExecution: fence })]);
      try { await lock.wait(query); await waitDatabasePast(query, change === 'lease-expiry' ? fence.leaseExpiresAt : fence.settleBefore); }
      finally { await lock.release(); }
      expect((await running)[0]).toMatchObject({ status: 'fulfilled', value: { transitioned: false, refunded: false } });
      expect(await snapshot(query)).toEqual(before); await accounting(query, false);
    });
  }, 60_000);
  it.each(['lease-expiry', 'settlement-deadline'] as const)('refuses a balance-lock waiter after DB %s without task/accounting writes', async change => {
    requireOwnedLoopback();
    await withIsolatedPostgres('sketch_execution_credit_lock', async ({ query, databaseUrl, schemaName }) => {
      const admitted = await seed(query, databaseUrl, schemaName);
      const fence = await fenceFor(admitted.task.id, change === 'lease-expiry' ? 1500 : 180_000);
      if (change === 'lease-expiry') fence.settleBefore = Date.now() + 10_000;
      const before = await snapshot(query); const lock = await rowLock(admitted.task.id, true);
      const running = Promise.allSettled([terminateCloudTaskAndRefund(admitted.task.id, 'failed', 'safe', fence.leaseOwner,
        { requireActive: true, expectedSketchExecution: fence })]);
      try { await lock.wait(query); await waitDatabasePast(query, change === 'lease-expiry' ? fence.leaseExpiresAt : fence.settleBefore); }
      finally { await lock.release(); }
      expect((await running)[0]).toMatchObject({ status: 'fulfilled', value: { transitioned: false, refunded: false } });
      expect(await snapshot(query)).toEqual(before); await accounting(query, false);
    });
  }, 60_000);
  it.each(['unchanged', 'owner', 'grant'] as const)('fences frozen document admission scope: %s', async change => {
    requireOwnedLoopback();
    await withIsolatedPostgres('sketch_execution_document_scope', async ({ query, databaseUrl, schemaName }) => {
      const admitted = await seed(query, databaseUrl, schemaName); const fence = await fenceFor(admitted.task.id);
      // Direct settlement fixture: document identity is persisted explicitly;
      // this does not claim to implement current document authorization.
      fence.access = { kind: 'document', actorUserId: 'user-a', projectId: 'project-a', ownerId: 'document-owner', grantGeneration: 'grant-1' };
      fence.settleBefore = Date.now() + 10_000;
      await query("UPDATE cloud_tasks SET result=jsonb_set(result,'{sketchAdmission,access}',$2::jsonb) WHERE id=$1", [admitted.task.id, JSON.stringify(fence.access)]);
      const lock = await rowLock(admitted.task.id);
      const running = Promise.allSettled([terminateCloudTaskAndRefund(admitted.task.id, 'failed', 'safe', fence.leaseOwner,
        { requireActive: true, expectedSketchExecution: fence })]);
      try {
        await lock.wait(query);
        if (change !== 'unchanged') await lock.mutate('UPDATE cloud_tasks SET result=jsonb_set(result,$2::text[],$3::jsonb) WHERE id=$1',
          [admitted.task.id, change === 'owner' ? '{sketchAdmission,access,ownerId}' : '{sketchAdmission,access,grantGeneration}', JSON.stringify('changed')]);
      } finally { await lock.release(); }
      expect((await running)[0]).toMatchObject({ status: 'fulfilled', value: { transitioned: change === 'unchanged', refunded: change === 'unchanged' } });
      await accounting(query, change === 'unchanged');
      const before = await snapshot(query);
      expect(await terminateCloudTaskAndRefund(admitted.task.id, 'failed', 'repeat', fence.leaseOwner,
        { requireActive: true, expectedSketchExecution: fence })).toMatchObject({ transitioned: false, refunded: false });
      expect(await snapshot(query)).toEqual(before);
    });
  }, 60_000);
  it.each(['owner', 'attempt', 'expiry', 'actor', 'project', 'provider', 'model', 'digest', 'nonce', 'scope', 'kind', 'route', 'version'] as const)(
    'refuses stale atomic %s eligibility after a row-lock wait', async change => {
      requireOwnedLoopback();
      await withIsolatedPostgres('sketch_execution_identity', async ({ query, databaseUrl, schemaName }) => {
        const admitted = await seed(query, databaseUrl, schemaName); const fence = await fenceFor(admitted.task.id);
        fence.settleBefore = Date.now() + 10_000;
        const lock = await rowLock(admitted.task.id);
        const running = Promise.allSettled([terminateCloudTaskAndRefund(admitted.task.id, 'failed', 'safe', fence.leaseOwner,
          { requireActive: true, expectedSketchExecution: fence })]);
        try {
          await lock.wait(query);
          const fields = { owner: 'lease_owner', attempt: 'attempt_count', expiry: 'lease_expires_at', actor: 'user_id', project: 'project_id',
            provider: 'provider_id', model: 'model', digest: 'request_digest', nonce: 'idempotency_key', kind: 'type' };
          if (change in fields) {
            const field = fields[change as keyof typeof fields];
            const value = change === 'attempt' ? 2 : change === 'expiry' ? fence.leaseExpiresAt + 1 : 'another';
            await lock.mutate(`UPDATE cloud_tasks SET ${field}=$2 WHERE id=$1`, [admitted.task.id, value]);
          } else {
            const path = change === 'scope' ? '{sketchAdmission,access,ownerId}' : `{sketchAdmission,${change}}`;
            await lock.mutate('UPDATE cloud_tasks SET result=jsonb_set(result,$2::text[],$3::jsonb) WHERE id=$1', [admitted.task.id, path, JSON.stringify('another')]);
          }
        } finally { await lock.release(); }
        expect((await running)[0]).toMatchObject({ status: 'fulfilled', value: { transitioned: false, refunded: false } });
        await accounting(query, false);
        expect((await query('SELECT status,credit_status,error,refunded_transaction_id FROM cloud_tasks')).rows)
          .toEqual([{ status: 'processing', credit_status: 'pending', error: '', refunded_transaction_id: '' }]);
      });
    }, 60_000);
  it('settles valid concurrent failures once using the original transaction and refund ledger', async () => {
    requireOwnedLoopback();
    await withIsolatedPostgres('sketch_execution_unique', async ({ query, databaseUrl, schemaName }) => {
      const admitted = await seed(query, databaseUrl, schemaName); const fence = await fenceFor(admitted.task.id);
      const outcomes = await Promise.all(Array.from({ length: 3 }, () => terminateCloudTaskAndRefund(admitted.task.id, 'failed', 'safe', fence.leaseOwner,
        { requireActive: true, expectedSketchExecution: fence })));
      expect(outcomes.filter(result => result.transitioned)).toHaveLength(1); expect(outcomes.filter(result => result.refunded)).toHaveLength(1);
      await accounting(query, true);
      const before = await snapshot(query);
      expect(await terminateCloudTaskAndRefund(admitted.task.id, 'failed', 'late', fence.leaseOwner,
        { requireActive: true, expectedSketchExecution: fence })).toMatchObject({ transitioned: false, refunded: false });
      expect(await snapshot(query)).toEqual(before);
    });
  }, 60_000);
  it('preserves the old cancellation contract when no opt-in fence is supplied', async () => {
    requireOwnedLoopback();
    await withIsolatedPostgres('sketch_execution_legacy', async ({ query, databaseUrl, schemaName }) => {
      const admitted = await seed(query, databaseUrl, schemaName);
      expect(await terminateCloudTaskAndRefund(admitted.task.id, 'cancelled', 'legacy')).toMatchObject({ transitioned: true, refunded: true });
      expect(await terminateCloudTaskAndRefund(admitted.task.id, 'cancelled', 'repeat')).toMatchObject({ transitioned: false, refunded: false });
      await accounting(query, true);
      expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows).toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
    });
  }, 60_000);
  it.each(['execution', 'recovery'] as const)('routes %s through real opt-in unique settlement without HTTP or assets', async entry => {
    requireOwnedLoopback();
    await withIsolatedPostgres('sketch_execution_ports', async ({ query, databaseUrl, schemaName }) => {
      const admitted = await seed(query, databaseUrl, schemaName); let publications = 0;
      const publisher = async (): Promise<boolean> => { publications += 1; throw new Error('No publication expected'); };
      if (entry === 'recovery') await query('UPDATE cloud_tasks SET created_at=$2 WHERE id=$1', [admitted.task.id, Date.now() - 180_001]);
      const task = await getCloudTaskById(admitted.task.id);
      if (!task) throw new Error('Missing original admitted task');
      const identity: SketchRecoveryIdentity = { actorUserId: 'user-a', projectId: 'project-a', providerId: 'p1', modelId: 'vision-1',
        requestDigest: task.requestDigest!, idempotencyKey: 'nonce-1', access };
      const result = entry === 'execution' ? await executeSketchTask(admitted, { actorUserId: 'user-a', projectId: 'project-a' }, { publisher })
        : await recoverExpiredSketchTask(admitted.task.id, identity);
      expect(result.status).toBe(entry === 'execution' ? 'failed' : 'timeout'); expect(publications).toBe(0); await accounting(query, true);
      expect((await query('SELECT count(*)::int AS count FROM wujie_assets')).rows).toEqual([{ count: 0 }]);
    });
  }, 60_000);
  it('keeps a delayed real settlement side-effect-free after execute returns deferred', async () => {
    requireOwnedLoopback();
    await withIsolatedPostgres('sketch_execution_late_query', async ({ query, databaseUrl, schemaName }) => {
      const admitted = await seed(query, databaseUrl, schemaName); let releaseLock: (() => Promise<void>) | undefined;
      let late: Promise<unknown> | undefined; let blocked: Promise<void> | undefined;
      const publisher = async (): Promise<boolean> => { throw new Error('Unexpected publisher'); };
      const run = executeSketchTask(admitted, { actorUserId: 'user-a', projectId: 'project-a' }, { publisher,
        terminateCloudTaskAndRefund: async (...args) => {
          const lock = await rowLock(admitted.task.id); releaseLock = lock.release;
          const operation = terminateCloudTaskAndRefund(...args); late = operation;
          blocked = lock.wait(query); return operation;
        },
      });
      try {
        const result = await run; expect(result.status).toBe('deferred');
        if (!blocked || !releaseLock || !late) throw new Error('Real settlement did not start');
        await blocked; const before = await snapshot(query);
        await releaseLock(); await late;
        expect(await snapshot(query)).toEqual(before); await accounting(query, false);
      } finally { await releaseLock?.(); await late?.catch(() => undefined); }
    });
  }, 60_000);
});
