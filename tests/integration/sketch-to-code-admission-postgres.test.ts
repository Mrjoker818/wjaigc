import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { ensureCoreTables } from '@/lib/db-storage';
import { getPool } from '@/lib/db-client';
import {
  claimCloudTaskLease, completeCloudTask, ensureCloudTaskTables,
  terminateCloudTaskAndRefund,
} from '@/lib/cloud-task-storage';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { grantDocumentEditor, revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { createIdempotencyLockKey } from '@/lib/task-core/idempotency';
import { admitSketchTask, type SketchAdmissionDependencies } from '@/lib/sketch-to-code/admission';
import type { SketchCodeInput, SketchGenerationDependencies } from '@/lib/sketch-to-code/generation';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

// Only the server-only import sentinel is replaced. SQL, billing, authorization,
// beforeCharge fencing, replay revalidation, leases and terminal settlement are real.
vi.mock('server-only', () => ({}));
afterEach((): void => { vi.unstubAllEnvs(); });

const png = createCanvas(2, 2).toDataURL('image/png');
const differentPng = createCanvas(3, 2).toDataURL('image/png');
const access = { kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '1' } as const;

function input(overrides: Partial<SketchCodeInput> = {}): SketchCodeInput {
  return { projectId: 'shared', imageDataUrl: png, instruction: '还原草图',
    providerId: 'provider', modelId: 'vision', idempotencyKey: 'sketch-request', ...overrides };
}
function dependencies(onResolve?: () => Promise<void>, perCallCredits = 7): SketchAdmissionDependencies {
  const generation: SketchGenerationDependencies = {
    authorizeProject: (actorUserId: string, projectId: string) => authorizeGenerationProject({ actorUserId, projectId }),
    resolveTaskModel: async (providerId: string, modelId: string): Promise<TaskModelDescriptor> => {
      await onResolve?.();
      return { providerId, modelId, kind: 'chat', sourceType: 'chat', protocol: 'chat-completions',
        executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
        supportsVision: true, supportsReferenceImages: false, supportsMask: false,
        outputKinds: ['text'], capabilitySources: {} };
    },
    analyze: async (): Promise<never> => { throw new Error('Admission must not execute a model stage'); },
    reconstruct: async (): Promise<never> => { throw new Error('Admission must not execute a model stage'); },
  };
  return { generation, loadPricingConfig: async () => ({ modelCredits: {
    'provider::vision': perCallCredits, 'provider::vision-other': perCallCredits, 'provider-other::vision': perCallCredits,
  } }) };
}
function context(actorUserId = 'editor'): { actorUserId: string; signal: AbortSignal } {
  return { actorUserId, signal: new AbortController().signal };
}

async function seed(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  // Run every original migration plus the full runtime ensure functions. Never
  // replace the business schema with a hand-built miniature billing database.
  const migrations = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(migrations.status, migrations.stderr || migrations.stdout).toBe(0);
  await ensureCoreTables();
  await ensureCloudTaskTables();
  console.info('Sketch admission real PG schema:', schemaName, 'full migrations native:', migrations.status);
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1),
      ('stranger','Stranger','test','active','admin',1,1),('presence','Presence','test','active','user',1,1)`);
  await query(`INSERT INTO wujie_projects(id,owner_id,name)
    VALUES ('shared','owner','Shared'),('personal','editor','Personal'),('personal-other','editor','Other')`);
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  await query("INSERT INTO wujie_project_presence_members(project_id,owner_id,member_user_id) VALUES ('shared','owner','presence')");
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    SELECT 'credits_'||id,id,100,100,0,1,1 FROM wujie_users`);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}

async function snapshot(query: QueryFn, ignoreTaskTouch = false): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of ['cloud_tasks', 'wujie_credits', 'wujie_credit_transactions',
    'wujie_refund_identity_claims', 'wujie_projects', 'wujie_users',
    'wujie_project_document_settings', 'wujie_project_document_editors',
    'wujie_project_canvas_documents', 'wujie_assets', 'wujie_asset_versions', 'wujie_workspace_placements']) {
    const projection = ignoreTaskTouch && table === 'cloud_tasks' ? "to_jsonb(t) - 'updated_at'" : 'to_jsonb(t)';
    result[table] = (await query(`SELECT ${projection} AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
async function expectAccounting(query: QueryFn, tasks: number, consumes: number, refunds: number, balance: number): Promise<void> {
  const counts = (await query<{ tasks: number; consumes: number; refunds: number; assets: number }>(`SELECT
    (SELECT count(*)::int FROM cloud_tasks) AS tasks,
    (SELECT count(*)::int FROM wujie_credit_transactions WHERE type='consume') AS consumes,
    (SELECT count(*)::int FROM wujie_credit_transactions WHERE type='refund') AS refunds,
    (SELECT count(*)::int FROM wujie_assets) AS assets`)).rows[0];
  expect(counts).toEqual({ tasks, consumes, refunds, assets: 0 });
  const credits = (await query<{ user_id: string; balance: number }>('SELECT user_id,balance FROM wujie_credits ORDER BY user_id')).rows;
  expect(credits).toEqual([{ user_id: 'editor', balance }, { user_id: 'owner', balance: 100 },
    { user_id: 'presence', balance: 100 }, { user_id: 'stranger', balance: 100 }]);
}

async function billingLock(key: string): Promise<{ wait(query: QueryFn, count?: number): Promise<void>; release(): Promise<void> }> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [createIdempotencyLockKey('editor', key)]);
    const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    let released = false;
    return {
      wait: async (query: QueryFn, count = 1): Promise<void> => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const blocked = (await query<{ count: number }>(
            'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows[0].count;
          if (blocked >= count) return;
          await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
        }
        throw new Error('Admission never reached the real PostgreSQL idempotency lock');
      },
      release: async (): Promise<void> => {
        if (released) return;
        released = true;
        try { await client.query('ROLLBACK'); } finally { client.release(); }
      },
    };
  } catch (error) {
    await client.query('ROLLBACK'); client.release(); throw error;
  }
}

describe('sketch durable admission against real PostgreSQL', () => {
  it.each(['shared', 'personal'])('concurrent identical %s admissions create one active task and one original 14-credit charge', async projectId => {
    await withIsolatedPostgres('sketch-concurrent', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const value = input({ projectId });
      const lock = await billingLock(value.idempotencyKey);
      const running = Promise.allSettled([admitSketchTask(value, context(), dependencies()), admitSketchTask(value, context(), dependencies())]);
      try { await lock.wait(query, 2); } finally { await lock.release(); await running; }
      const outcomes = await running;
      expect(outcomes.every(outcome => outcome.status === 'fulfilled'), JSON.stringify(outcomes)).toBe(true);
      const admissions = outcomes.map(outcome => {
        if (outcome.status === 'rejected') throw outcome.reason;
        return outcome.value;
      });
      expect(new Set(admissions.map(outcome => outcome.task.id)).size).toBe(1);
      expect(admissions.map(outcome => [outcome.reused, outcome.charged, Boolean(outcome.prepared)]).sort()).toEqual(
        [[false, true, true], [true, false, false]].sort());
      const prepared = admissions.find(outcome => !outcome.reused)?.prepared;
      expect(prepared).toBeDefined();
      expect([prepared, prepared?.input, prepared?.access, prepared?.binding].every(Object.isFrozen)).toBe(true);
      const task = admissions[0].task;
      expect(task).toMatchObject({ type: 'sketch-to-code', projectId, userId: 'editor', status: 'processing', creditStatus: 'pending', creditCost: 14 });
      const row = (await query<{ request_digest: string; result: Record<string, unknown> }>('SELECT request_digest,result FROM cloud_tasks')).rows[0];
      expect(row.request_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.result.sketchAdmission).toEqual({ version: 1, route: '/api/sketch-to-code', requestDigest: row.request_digest,
        access: projectId === 'shared' ? access : { kind: 'personal', actorUserId: 'editor', ownerId: 'editor', projectId: 'personal' },
        pricing: { calls: 2, perCallCredits: 7, totalCredits: 14 } });
      await expectAccounting(query, 1, 1, 0, 86);
      const charge = (await query('SELECT user_id,task_id,reference_id,amount,balance_after FROM wujie_credit_transactions')).rows;
      expect(charge).toEqual([{ user_id: 'editor', task_id: task.id, reference_id: task.id, amount: -14, balance_after: 86 }]);
    });
  }, 60_000);

  it('binds one nonce to the original instructions, provider, model, PNG and project without a second charge', async () => {
    await withIsolatedPostgres('sketch-conflict', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      await admitSketchTask(input(), context(), dependencies());
      const before = await snapshot(query);
      for (const changed of [{ instruction: 'different' }, { modelId: 'vision-other' }, { providerId: 'provider-other' },
        { imageDataUrl: differentPng }, { projectId: 'personal' }]) {
        await expect(admitSketchTask(input(changed), context(), dependencies())).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
        expect(await snapshot(query)).toEqual(before);
      }
      await expect(admitSketchTask({ ...input(), apiKey: 'forbidden-client-key' }, context(), dependencies())).rejects.toThrow('SKETCH_INPUT_INVALID');
      expect(await snapshot(query)).toEqual(before);
      await expectAccounting(query, 1, 1, 0, 86);
    });
  }, 60_000);

  it('uses the original authorizer to refuse admin strangers and presence-only users before a charge', async () => {
    await withIsolatedPostgres('sketch-no-authority', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const before = await snapshot(query);
      for (const actor of ['stranger', 'presence', 'missing-user']) {
        await expect(admitSketchTask(input(), context(actor), dependencies())).rejects.toMatchObject({ code: 'GENERATION_PROJECT_FORBIDDEN', status: 403 });
        expect(await snapshot(query)).toEqual(before);
      }
      await expectAccounting(query, 0, 0, 0, 100);
    });
  }, 60_000);

  it('rolls back admission when permission is revoked after prepare but before the real billing transaction', async () => {
    await withIsolatedPostgres('sketch-revoked-before-bill', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const lock = await billingLock('sketch-request');
      const running = Promise.allSettled([admitSketchTask(input(), context(), dependencies())]);
      let before: Record<string, unknown> | undefined;
      try {
        await lock.wait(query);
        await revokeDocumentEditor('owner', 'shared', 'editor');
        before = await snapshot(query);
      } finally { await lock.release(); await running; }
      expect((await running)[0]).toMatchObject({ status: 'rejected', reason: { code: 'SKETCH_PROJECT_CHANGED', status: 403 } });
      expect(await snapshot(query)).toEqual(before);
      await expectAccounting(query, 0, 0, 0, 100);
    });
  }, 60_000);

  it('revalidates stale replay access with the original locked read and adds no charge after revocation', async () => {
    await withIsolatedPostgres('sketch-revoked-replay', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      await admitSketchTask(input(), context(), dependencies());
      let before: Record<string, unknown> | undefined;
      await expect(admitSketchTask(input(), context(), dependencies(async (): Promise<void> => {
        await revokeDocumentEditor('owner', 'shared', 'editor');
        before = await snapshot(query);
      }))).rejects.toMatchObject({ code: 'SKETCH_PROJECT_CHANGED', status: 403 });
      expect(await snapshot(query)).toEqual(before);
      await expectAccounting(query, 1, 1, 0, 86);
    });
  }, 60_000);

  it('refunds repeated original cancellation once and discards late completion without result or asset writes', async () => {
    await withIsolatedPostgres('sketch-cancel-refund', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const admitted = await admitSketchTask(input(), context(), dependencies());
      const cancelled = await Promise.all(Array.from({ length: 3 }, () => terminateCloudTaskAndRefund(admitted.task.id, 'cancelled', 'cancel-test')));
      console.info('Original cancellation results:', cancelled, 'persisted:',
        (await query('SELECT status,credit_status,credit_cost FROM cloud_tasks')).rows);
      expect(cancelled.filter(outcome => outcome.refunded)).toHaveLength(1);
      expect(cancelled.filter(outcome => outcome.transitioned)).toHaveLength(1);
      const before = await snapshot(query);
      expect(await completeCloudTask(admitted.task.id, { html: '<h1>late</h1>', previewAssetId: 'late-png', htmlAssetId: 'late-html' })).toBe(false);
      expect(await snapshot(query)).toEqual(before);
      // Legacy atomic settlement may touch the terminal row's updated_at on a repeat.
      // Its business result, terminal identity, all credits, assets and placements must stay identical.
      const beforeRepeat = await snapshot(query, true);
      expect(await terminateCloudTaskAndRefund(admitted.task.id, 'cancelled', 'again')).toMatchObject({ transitioned: false, refunded: false });
      expect(await snapshot(query, true)).toEqual(beforeRepeat);
      await expectAccounting(query, 1, 1, 1, 100);
      expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows).toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
      expect((await query("SELECT amount,balance_after,task_id FROM wujie_credit_transactions WHERE type='refund'")).rows)
        .toEqual([{ amount: 14, balance_after: 100, task_id: admitted.task.id }]);
    });
  }, 60_000);

  it('grants only one original execution lease, including repeated claims by the same worker', async () => {
    await withIsolatedPostgres('sketch-single-lease', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const admitted = await admitSketchTask(input(), context(), dependencies());
      const now = Date.now();
      const claims = await Promise.all(['worker-a', 'worker-a', 'worker-b'].map(owner => claimCloudTaskLease(admitted.task.id, owner, 60_000, now)));
      expect(claims.filter(Boolean)).toHaveLength(1);
      const lease = claims.find(claim => claim !== null);
      if (!lease) throw new Error('No worker acquired the real lease');
      expect(await claimCloudTaskLease(admitted.task.id, lease.owner, 60_000, now + 1)).toBeNull();
      expect(await completeCloudTask(admitted.task.id, { html: 'foreign worker' }, 'worker-foreign')).toBe(false);
      expect(await completeCloudTask(admitted.task.id, { html: '<h1>one worker</h1>' }, lease.owner)).toBe(true);
      const before = await snapshot(query);
      expect(await completeCloudTask(admitted.task.id, { html: '<h1>duplicate</h1>' }, lease.owner)).toBe(false);
      expect(await snapshot(query)).toEqual(before);
      await expectAccounting(query, 1, 1, 0, 86);
      expect((await query('SELECT attempt_count,lease_owner FROM cloud_tasks')).rows).toEqual([{ attempt_count: 1, lease_owner: lease.owner }]);
    });
  }, 60_000);

  it.each(['grant-generation', 'personal-to-document'] as const)('rejects a %s change between prepare and billing with no task or charge', async mutation => {
    await withIsolatedPostgres('sketch-fence-change', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const value = input({ projectId: mutation === 'grant-generation' ? 'shared' : 'personal' });
      const lock = await billingLock(value.idempotencyKey);
      const running = Promise.allSettled([admitSketchTask(value, context(), dependencies())]);
      let before: Record<string, unknown> | undefined;
      try {
        await lock.wait(query);
        if (mutation === 'grant-generation') {
          await revokeDocumentEditor('owner', 'shared', 'editor');
          await grantDocumentEditor('owner', 'shared', 'editor');
          expect((await query("SELECT grant_generation::text FROM wujie_project_document_editors WHERE project_id='shared'")).rows)
            .toEqual([{ grant_generation: '3' }]);
        } else {
          await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('personal','editor',true)");
          await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('personal','editor')");
        }
        before = await snapshot(query);
      } finally { await lock.release(); await running; }
      expect((await running)[0]).toMatchObject({ status: 'rejected', reason: { code: 'SKETCH_PROJECT_CHANGED', status: 403 } });
      expect(await snapshot(query)).toEqual(before);
      await expectAccounting(query, 0, 0, 0, 100);
    });
  }, 60_000);

  it.each(['grant-generation', 'personal-to-document'] as const)('rejects a %s change during replay through the original access fence', async mutation => {
    await withIsolatedPostgres('sketch-replay-change', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const value = input({ projectId: mutation === 'grant-generation' ? 'shared' : 'personal' });
      await admitSketchTask(value, context(), dependencies());
      let before: Record<string, unknown> | undefined;
      await expect(admitSketchTask(value, context(), dependencies(async (): Promise<void> => {
        if (mutation === 'grant-generation') {
          await revokeDocumentEditor('owner', 'shared', 'editor');
          await grantDocumentEditor('owner', 'shared', 'editor');
        } else {
          await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('personal','editor',true)");
          await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('personal','editor')");
        }
        before = await snapshot(query);
      }))).rejects.toMatchObject({ code: 'SKETCH_PROJECT_CHANGED', status: 403 });
      expect(await snapshot(query)).toEqual(before);
      await expectAccounting(query, 1, 1, 0, 86);
    });
  }, 60_000);

  it('replays the persisted price despite current token pricing or a failed pricing loader without another charge or computation', async () => {
    await withIsolatedPostgres('sketch-replay-pricing', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const first = await admitSketchTask(input(), context(), dependencies());
      const before = await snapshot(query);
      const changed = dependencies(undefined, 20);
      const token = dependencies();
      token.loadPricingConfig = async () => ({ modelCredits: { 'provider::vision': { credits: 7, tokenPricing: { input: 5, output: 10 } } } });
      const unavailable = dependencies();
      unavailable.loadPricingConfig = async (): Promise<never> => { throw new Error('A replay must not load the current quote'); };
      for (const dep of [changed, token, unavailable]) {
        const replay = await admitSketchTask(input(), context(), dep);
        expect(replay).toMatchObject({ reused: true, charged: false, task: { id: first.task.id, creditCost: 14 } });
        expect(replay.prepared).toBeUndefined();
        expect(await snapshot(query)).toEqual(before);
      }
      await expectAccounting(query, 1, 1, 0, 86);
    });
  }, 60_000);

  it('keeps price and nonce outside the identity digest while charging each new nonce at its own two-call price', async () => {
    await withIsolatedPostgres('sketch-nonce-pricing', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const first = await admitSketchTask(input(), context(), dependencies());
      const second = await admitSketchTask(input({ idempotencyKey: 'new-request' }), context(), dependencies(undefined, 20));
      expect(first.task.id).not.toBe(second.task.id);
      expect(second).toMatchObject({ reused: false, charged: true, task: { creditCost: 40 } });
      const rows = (await query<{ request_digest: string; result: { sketchAdmission: { pricing: unknown } } }>('SELECT request_digest,result FROM cloud_tasks ORDER BY credit_cost')).rows;
      expect(rows[0].request_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(rows[0].request_digest).toBe(rows[1].request_digest);
      expect(rows.map(row => row.result.sketchAdmission.pricing)).toEqual([
        { calls: 2, perCallCredits: 7, totalCredits: 14 }, { calls: 2, perCallCredits: 20, totalCredits: 40 },
      ]);
      await expectAccounting(query, 2, 2, 0, 46);
    });
  }, 60_000);

  it('admits a valid token-priced task with one original SQL reserve and frozen rates', async () => {
    await withIsolatedPostgres('sketch-token-refusal', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const dep = dependencies();
      dep.loadPricingConfig = async () => ({ modelCredits: { 'provider::vision': { credits: 7, tokenPricing: { input: 5, output: 10 } } } });
      const admitted = await admitSketchTask(input(), context(), dep);
      expect(admitted).toMatchObject({ reused: false, charged: true, task: { creditCost: 14, creditStatus: 'pending', status: 'processing' } });
      if (!('chargedTransactionId' in admitted.task) || typeof admitted.task.chargedTransactionId !== 'string') throw new Error('Original charge receipt missing');
      const chargeId = admitted.task.chargedTransactionId;
      const rows = (await query('SELECT credit_cost::int AS credit_cost,charged_transaction_id,result FROM cloud_tasks')).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].credit_cost).toBe(14);
      expect(rows[0].charged_transaction_id).toBe(chargeId);
      expect(rows[0].result.sketchAdmission.pricing).toEqual({ mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14,
        tokenPricing: { input: 5, output: 10 } });
      expect((await query('SELECT id,user_id,task_id,reference_id,model,amount,balance_after FROM wujie_credit_transactions')).rows)
        .toEqual([{ id: chargeId, user_id: 'editor', task_id: admitted.task.id, reference_id: admitted.task.id,
          model: 'vision', amount: -14, balance_after: 86 }]);
      await expectAccounting(query, 1, 1, 0, 86);
    });
  }, 60_000);

  it.each(['invalid-config', 'token-config'] as const)('uses %s from the original system settings authority without fallback prices', async scenario => {
    await withIsolatedPostgres('sketch-stored-pricing', async ({ query, databaseUrl, schemaName }) => {
      await seed(query, databaseUrl, schemaName);
      const stored = scenario === 'invalid-config' ? 'not-valid-json' : {
        modelCredits: { 'provider::vision': { credits: 7, tokenPricing: { input: 5, output: 10 } } },
      };
      await query("INSERT INTO wujie_system_settings(key,value,updated_at) VALUES ('credit_pricing_config',$1::jsonb,1)", [JSON.stringify(stored)]);
      const before = await snapshot(query);
      if (scenario === 'invalid-config') {
        await expect(admitSketchTask(input(), context(), { generation: dependencies().generation })).rejects.toMatchObject({
          code: 'SKETCH_PRICING_INVALID', status: 503,
        });
        expect(await snapshot(query)).toEqual(before);
        await expectAccounting(query, 0, 0, 0, 100);
      } else {
        const admitted = await admitSketchTask(input(), context(), { generation: dependencies().generation });
        expect(admitted).toMatchObject({ reused: false, charged: true, task: { creditCost: 14, creditStatus: 'pending', status: 'processing' } });
        if (!('chargedTransactionId' in admitted.task) || typeof admitted.task.chargedTransactionId !== 'string') throw new Error('Original charge receipt missing');
        const chargeId = admitted.task.chargedTransactionId;
        const rows = (await query('SELECT credit_cost::int AS credit_cost,charged_transaction_id,result FROM cloud_tasks')).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0].credit_cost).toBe(14);
        expect(rows[0].charged_transaction_id).toBe(chargeId);
        expect(rows[0].result.sketchAdmission.pricing).toEqual({ mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14,
          tokenPricing: { input: 5, output: 10 } });
        expect((await query('SELECT id,user_id,task_id,reference_id,model,amount,balance_after FROM wujie_credit_transactions')).rows)
          .toEqual([{ id: chargeId, user_id: 'editor', task_id: admitted.task.id, reference_id: admitted.task.id,
            model: 'vision', amount: -14, balance_after: 86 }]);
        await expectAccounting(query, 1, 1, 0, 86);
      }
    });
  }, 60_000);
});
