import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { QueryFn } from '../helpers/postgres-test-database';
import { withOwnedSketchPostgres as withIsolatedPostgres, assertOwnedSketchSchema } from '../helpers/owned-sketch-postgres-fixture';
import { ensureCoreTables } from '@/lib/db-storage';
import { getPool } from '@/lib/db-client';
import { ensureCloudTaskTables, getCloudTaskById, claimCloudTaskLease, terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { admitSketchTask, type SketchTaskAdmission } from '@/lib/sketch-to-code/admission';
import { executeSketchTask, recoverExpiredSketchTask, type SketchPublicationInput } from '@/lib/sketch-to-code/execution';
import { publishSketchTask } from '@/lib/sketch-to-code/publication';
import { readSketchDocument } from '@/lib/sketch-to-code/document';
import { revokeDocumentEditor, grantDocumentEditorByName } from '@/lib/collaboration/document-access';
import { persistAssetBytes, type PersistedAssetFile } from '@/lib/asset-core/binary-persistence';
import { createTaskBillingTransactionId } from '@/lib/credits';
import type { SketchGenerationDependencies, SketchCodeInput } from '@/lib/sketch-to-code/generation';
import type { SketchCodeUsage } from '@/lib/sketch-to-code/usage';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.unstubAllEnvs(); });
vi.mock('@/lib/s3-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/s3-storage')>(), uploadBinaryToS3: async () => null,
}));
const fixture = resolve('output/sketch-token-pg-20261009-97af41');
const ownedFixture = await vi.hoisted(async (): Promise<import('../helpers/owned-sketch-postgres-fixture').OwnedSketchFixture | undefined> => {
  const { readOwnedSketchFixture } = await import('../helpers/owned-sketch-postgres-fixture');
  return readOwnedSketchFixture();
});
const png = createCanvas(2, 2).toDataURL('image/png');
const generation: SketchGenerationDependencies = {
  authorizeProject: (actorUserId, projectId) => authorizeGenerationProject({ actorUserId, projectId }),
  resolveTaskModel: async (providerId, modelId) => ({ providerId, modelId, kind: 'chat', sourceType: 'vlm',
    protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [],
    maxOutputs: 1, supportsVision: true, supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {} }),
  analyze: async () => JSON.stringify({ summary: '草图', layout: '单列', controls: [], text: ['结算'] }),
  reconstruct: async () => JSON.stringify({ type: 'text', text: '结算' }),
};
async function seed(query: QueryFn, databaseUrl: string): Promise<void> {
  if (ownedFixture) {
    assertOwnedSketchSchema(databaseUrl);
  } else {
  const manifest = JSON.parse(readFileSync(resolve(fixture, 'cluster.json'), 'utf8')) as {
    databaseUrl: string; systemIdentifier: string; data: string; started: boolean; stopped: boolean;
  };
  if (process.env.SKETCH_TOKEN_OWNED_FIXTURE !== '97af41'
    || process.env.POSTGRES_TEST_DATABASE_URL !== 'postgresql://sketch_token_test@127.0.0.1:53651/postgres?sslmode=disable'
    || manifest.databaseUrl !== process.env.POSTGRES_TEST_DATABASE_URL || manifest.systemIdentifier !== '7694645594810926408'
    || manifest.data !== resolve(fixture, 'cluster') || !manifest.started || manifest.stopped) throw new Error('Explicit owned Token fixture required');
  expect((await query<{ id: string }>('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id).toBe('7694645594810926408');
  }
  const migrations = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl }, timeout: 30_000,
  });
  expect(migrations.status, migrations.stdout + migrations.stderr).toBe(0);
  expect(migrations.signal).toBeNull(); expect(migrations.error).toBeUndefined();
  await ensureCoreTables(); await ensureCloudTaskTables();
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1),
    ('reader','Reader','test','active','user',1,1),('stranger','Stranger','test','active','admin',1,1),('viewer','Viewer','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('personal','owner','Personal'),('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor'),('shared','owner','reader')");
  await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) SELECT 'c_'||id,id,100,100,0,1,1 FROM wujie_users");
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}
function input(projectId = 'personal'): SketchCodeInput {
  return { projectId, providerId: 'p1', modelId: 'vision-1', imageDataUrl: png, instruction: '结算', idempotencyKey: randomUUID() };
}
function usage(a = 1, r = 1): SketchCodeUsage {
  return { analysis: { inputTokens: a, outputTokens: a }, reconstruction: { inputTokens: r, outputTokens: r }, total: { inputTokens: a + r, outputTokens: a + r } };
}
async function flatAdmission(projectId = 'personal', actorUserId = 'owner'): Promise<SketchTaskAdmission> {
  return admitSketchTask(input(projectId), { actorUserId, signal: new AbortController().signal }, {
    generation, loadPricingConfig: async () => ({ modelCredits: { 'p1::vision-1': 7 } }),
  });
}
// Initial behavior RED uses a real original charge/task, then changes only its
// frozen pricing projection to reach the missing publication behavior past 422.
async function frozenToken(query: QueryFn, rate = 1): Promise<SketchTaskAdmission> {
  const admission = await flatAdmission();
  await query(`UPDATE cloud_tasks SET result=jsonb_set(result,'{sketchAdmission,pricing}', $2::jsonb) WHERE id=$1`,
    [admission.task.id, JSON.stringify({ mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14, tokenPricing: { input: rate, output: rate } })]);
  // Only pricing changed on this originally processing fixture; the wider
  // persisted-task union also describes pending recovery tasks elsewhere.
  admission.task = (await getCloudTaskById(admission.task.id))! as SketchTaskAdmission['task'];
  return admission;
}
async function publication(admission: SketchTaskAdmission, metering: unknown = usage(), ttl = 60_000): Promise<SketchPublicationInput> {
  const prepared = admission.prepared!;
  const draft = await prepared.compute(new AbortController().signal);
  const lease = await claimCloudTaskLease(admission.task.id, 'token-test', ttl);
  const task = await getCloudTaskById(admission.task.id);
  if (!lease || !task) throw new Error('Real task/lease missing');
  return { task, lease, input: prepared.input, access: prepared.access,
    draft: { ...draft, ...(metering === undefined ? {} : { usage: metering as SketchCodeUsage }) }, signal: new AbortController().signal };
}
async function accounting(query: QueryFn): Promise<Record<string, unknown>> {
  const state: Record<string, unknown> = {};
  for (const table of ['cloud_tasks', 'wujie_credits', 'wujie_credit_transactions', 'wujie_refund_identity_claims', 'wujie_assets', 'wujie_asset_versions']) {
    state[table] = (await query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return state;
}
async function tokenAdmission(base = 7, rate = 1, projectId = 'personal', actorUserId = 'owner', value = input(projectId)): Promise<SketchTaskAdmission> {
  return admitSketchTask(value, { actorUserId, signal: new AbortController().signal }, {
    generation, loadPricingConfig: async () => ({ modelCredits: { 'p1::vision-1': { credits: base, tokenPricing: { input: rate, output: rate } } } }),
  });
}
function metered(admission: SketchTaskAdmission, metering: unknown): SketchTaskAdmission {
  const prepared = admission.prepared!;
  return { ...admission, prepared: { ...prepared, compute: async signal => ({ ...await prepared.compute(signal), usage: metering as SketchCodeUsage }) } };
}
function intercept(client: PoolClient, hook: (sql: string, values?: unknown[]) => Promise<void>, onRelease?: (discard: boolean) => void): PoolClient {
  return new Proxy(client, { get(target, key) {
    if (key === 'query') return async (sql: string, values?: unknown[]) => { await hook(sql, values); return target.query(sql, values); };
    if (key === 'release') return (discard = false): void => { onRelease?.(discard); target.release(discard); };
    const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
  } });
}
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void; const promise = new Promise<void>(resolveTurn => { open = resolveTurn; }); return { promise, open };
}
async function until(query: QueryFn, sql: string, values: unknown[] = []): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!(await query<{ ok: boolean }>(sql, values)).rows[0]?.ok) {
    if (Date.now() > deadline) throw new Error('Real PostgreSQL wait not observed');
    await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
  }
}
function filePath(saved: PersistedAssetFile): string { return resolve(ownedFixture?.mediaRoot || fixture, ownedFixture ? 'exports' : 'media/exports', saved.url.split('/').at(-1)!); }
async function assertSuccess(query: QueryFn, value: SketchPublicationInput, reserve: number, actual: number): Promise<void> {
  const task = (await getCloudTaskById(value.task.id))!;
  expect(task).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: reserve,
    chargedTransactionId: value.task.chargedTransactionId });
  expect(task.refundedTransactionId).toBeUndefined();
  const record = task.result!.sketchTokenSettlement as { adjustmentTransactionId: string | null };
  expect(record).toEqual({ version: 1, reserveCredits: reserve, actualCredits: actual, deltaCredits: actual - reserve,
    chargedTransactionId: task.chargedTransactionId, adjustmentTransactionId: record.adjustmentTransactionId, usage: value.draft.usage });
  const transactions = (await query<{ id: string; type: string; amount: number; user_id: string; model: string; task_id: string; reference_id: string }>(
    'SELECT id,type,amount,user_id,model,task_id,reference_id FROM wujie_credit_transactions ORDER BY id')).rows;
  expect(transactions).toHaveLength(actual === reserve ? 1 : 2);
  expect(transactions.find(row => row.id === task.chargedTransactionId)).toEqual({ id: task.chargedTransactionId, type: 'consume', amount: -reserve,
    user_id: value.task.userId, model: 'vision-1', task_id: task.id, reference_id: task.id });
  expect(transactions.reduce((sum, row) => sum + row.amount, 0)).toBe(-actual);
  if (actual === reserve) expect(record.adjustmentTransactionId).toBeNull();
  else {
    expect(record.adjustmentTransactionId).toMatch(actual < reserve ? /^ctx_refund_/ : /^ctx_token_/);
    if (actual < reserve) expect(record.adjustmentTransactionId).toBe(createTaskBillingTransactionId('refund', task.id));
    else expect(record.adjustmentTransactionId).toBe(`ctx_token_${createHash('sha256').update(`sketch-to-code-token-delta\0${task.id}`).digest('hex').slice(0, 32)}`);
    expect(transactions.find(row => row.id === record.adjustmentTransactionId)).toMatchObject({ amount: reserve - actual,
      type: actual < reserve ? 'refund' : 'consume', task_id: task.id, reference_id: task.id, user_id: value.task.userId, model: 'vision-1' });
  }
  const versions = (await query<{ owner_id: string; project_id: string; metadata: Record<string, unknown> }>('SELECT owner_id,project_id,metadata FROM wujie_asset_versions')).rows;
  expect(versions).toHaveLength(2);
  for (const version of versions) {
    expect(version.owner_id).toBe(value.access.ownerId); expect(version.project_id).toBe(value.input.projectId);
    expect(version.metadata.sketchTokenSettlement).toEqual(record);
  }
  expect((await readSketchDocument({ actorUserId: value.task.userId, projectId: value.input.projectId, taskId: task.id })).bytes).toEqual(Buffer.from(value.draft.html));
}

describe('Token atomic settlement on original full PostgreSQL schema', () => {
  it('token RED valid pricing admits with frozen reserve and zero provider work', async () => {
    await withIsolatedPostgres('token_admit', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl);
      const admission = await admitSketchTask(input(), { actorUserId: 'owner', signal: new AbortController().signal }, {
        generation, loadPricingConfig: async () => ({ modelCredits: { 'p1::vision-1': { credits: 7, tokenPricing: { input: 1, output: 1 } } } }),
      });
      expect(admission.task.creditCost).toBe(14);
      expect(admission.task.result?.sketchAdmission).toMatchObject({ pricing: { mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14, tokenPricing: { input: 1, output: 1 } } });
      expect((await query('SELECT amount FROM wujie_credit_transactions')).rows).toEqual([{ amount: -14 }]);
    });
  }, 30_000);
  it.each([{ rate: 1, metering: usage(), actual: 1, balance: 99, type: 'refund', amount: 13 },
    { rate: 1_000_000, metering: usage(5, 5), actual: 20, balance: 80, type: 'consume', amount: -6 }])(
    'token RED successful $type adjusts the original ledger with both assets', async example => {
      await withIsolatedPostgres('token_delta', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl); const admission = await frozenToken(query, example.rate);
        const value = await publication(admission, example.metering);
        expect(await publishSketchTask(value)).toBe(true);
        const task = (await getCloudTaskById(value.task.id))!;
        expect(task.result?.sketchTokenSettlement).toMatchObject({ version: 1, reserveCredits: 14, actualCredits: example.actual, deltaCredits: example.actual - 14 });
        expect((await query('SELECT balance,total_used FROM wujie_credits WHERE user_id=$1', ['owner'])).rows).toEqual([{ balance: example.balance, total_used: example.actual }]);
        expect((await query('SELECT type,amount FROM wujie_credit_transactions WHERE id<>$1', [task.chargedTransactionId])).rows).toEqual([{ type: example.type, amount: example.amount }]);
        expect((await query('SELECT count(*)::int n FROM wujie_asset_versions')).rows).toEqual([{ n: 2 }]);
      });
    }, 30_000);
  it('token RED missing true usage refuses publication after known rollback', async () => {
    await withIsolatedPostgres('token_missing', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const admission = await frozenToken(query);
      const value = await publication(admission); delete (value.draft as { usage?: unknown }).usage;
      const before = await accounting(query);
      await expect(publishSketchTask(value)).rejects.toMatchObject({ name: 'SketchTokenPublicationRejectedError', taskId: value.task.id });
      expect(await accounting(query)).toEqual(before);
    });
  }, 30_000);
  it('token RED confirmed publication rejection reaches original failed full refund exactly once', async () => {
    await withIsolatedPostgres('token_known_rollback', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const admission = await frozenToken(query);
      const outcome = await executeSketchTask(admission, { actorUserId: 'owner', projectId: 'personal' }, { publisher: publishSketchTask });
      expect(outcome.status).toBe('failed');
      expect((await getCloudTaskById(admission.task.id))?.creditStatus).toBe('refunded');
      expect((await query("SELECT amount FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([{ amount: 14 }]);
      expect((await query('SELECT count(*)::int n FROM wujie_asset_versions')).rows).toEqual([{ n: 0 }]);
      expect((await query('SELECT count(*)::int n FROM wujie_refund_identity_claims')).rows).toEqual([{ n: 1 }]);
    });
  }, 30_000);
  it('token boundary defers only when both delta refund and full reserve exceed original INTEGER capacity', async () => {
    await withIsolatedPostgres('token_balance_overflow', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const admission = await frozenToken(query);
      // reserve14, actual1 => refund13. This legal INTEGER balance leaves room
      // for12, so both refund13 and the required original full refund14 overflow.
      await query("UPDATE wujie_credits SET balance=2147483635 WHERE user_id='owner'");
      let confirmed = false; let originalCode: unknown; let beforePublication: Record<string, unknown> | undefined;
      const outcome = await executeSketchTask(admission, { actorUserId: 'owner', projectId: 'personal' }, {
        publisher: async value => {
          beforePublication = await accounting(query);
          try { return await publishSketchTask({ ...value, draft: { ...value.draft, usage: usage() } }); }
          catch (error) {
            confirmed = error instanceof Error && error.name === 'SketchTokenPublicationRejectedError';
            expect(await accounting(query)).toEqual(beforePublication);
            throw error;
          }
        },
        terminateCloudTaskAndRefund: async (...args) => {
          try { return await terminateCloudTaskAndRefund(...args); }
          catch (error) { originalCode = (error as { code?: unknown }).code; throw error; }
        },
      });
      expect(confirmed).toBe(true); expect(originalCode).toBe('22003');
      expect(await accounting(query)).toEqual(beforePublication);
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='owner'")).rows).toEqual([{ balance: 2147483635, total_used: 14 }]);
      expect((await query('SELECT count(*)::int n FROM wujie_refund_identity_claims')).rows).toEqual([{ n: 0 }]);
      expect((await query('SELECT count(*)::int n FROM wujie_asset_versions')).rows).toEqual([{ n: 0 }]);
      const queries = [
        "SELECT id,status,credit_status,credit_cost,charged_transaction_id,refunded_transaction_id,lease_owner,attempt_count,lease_expires_at,result->'sketchTokenSettlement' AS settlement FROM cloud_tasks",
        'SELECT id,user_id,type,amount,balance_after,model,task_id,reference_id FROM wujie_credit_transactions ORDER BY id',
        'SELECT identity FROM wujie_refund_identity_claims',
        'SELECT count(*)::int AS n FROM wujie_asset_versions',
      ];
      const rows = [];
      for (const sql of queries) rows.push({ sql, rows: (await query(sql)).rows });
      console.info('Token boundary context:', JSON.stringify({ reserve: 14, actual: 1, delta: -13,
        balance: 2147483635, confirmedRollback: confirmed, originalRefundSqlState: originalCode, outcome,
        publicationRollbackExact: true, fullRefundStatementRollbackExact: true, queries: rows }));
      // Master ruling after the preserved r2/r3 native1 evidence. This does not
      // authorize other failures to evade their possible original full refund.
      expect(outcome).toEqual({ status: 'deferred', reason: 'SKETCH_TASK_UNAVAILABLE' });
      expect((await getCloudTaskById(admission.task.id))?.status).toBe('processing');
      expect((await getCloudTaskById(admission.task.id))?.creditStatus).toBe('pending');
    });
  }, 30_000);
  it('token capacity recovery uses original expired recovery for one real timeout refund with zero compute or HTTP', async () => {
    await withIsolatedPostgres('token_capacity_recovery', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const admission = await frozenToken(query);
      const prepared = admission.prepared!;
      const compute = vi.fn(async (signal: AbortSignal) => prepared.compute(signal));
      admission.prepared = { ...prepared, compute };
      await query("UPDATE wujie_credits SET balance=2147483635 WHERE user_id='owner'");
      const deferred = await executeSketchTask(admission, { actorUserId: 'owner', projectId: 'personal' }, {
        publisher: value => publishSketchTask({ ...value, draft: { ...value.draft, usage: usage() } }),
      });
      expect(deferred).toEqual({ status: 'deferred', reason: 'SKETCH_TASK_UNAVAILABLE' });
      expect(compute).toHaveBeenCalledOnce(); compute.mockClear();
      // Capacity is now exactly sufficient for the original full14 refund.
      await query("UPDATE wujie_credits SET balance=2147483633 WHERE user_id='owner'");
      // Recovery checks application time, not PostgreSQL's rounded millisecond clock.
      const recoveryNow = Date.now();
      await query('UPDATE cloud_tasks SET created_at=$2, lease_expires_at=$3 WHERE id=$1',
        [admission.task.id, recoveryNow - 180001, recoveryNow - 1]);
      const identity = { actorUserId: 'owner', projectId: 'personal', providerId: 'p1', modelId: 'vision-1',
        requestDigest: (admission.task.result!.sketchAdmission as { requestDigest: string }).requestDigest,
        idempotencyKey: prepared.input.idempotencyKey, access: prepared.access };
      const http = vi.spyOn(globalThis, 'fetch');
      try {
        const recoveryFixture = (await query('SELECT created_at,lease_expires_at FROM cloud_tasks WHERE id=$1', [admission.task.id])).rows[0];
        const recoveryObservedBefore = Date.now();
        const recoveryOutcome = await recoverExpiredSketchTask(admission.task.id, identity);
        console.info('Token recovery clock context:', JSON.stringify({ applicationBaseline: recoveryNow,
          fixture: recoveryFixture, observedBefore: recoveryObservedBefore, observedAfter: Date.now(), outcome: recoveryOutcome }));
        expect(recoveryOutcome).toEqual({ status: 'timeout', reason: 'SKETCH_EXECUTION_TIMEOUT' });
        const after = await getCloudTaskById(admission.task.id);
        expect(after?.status).toBe('timeout'); expect(after?.creditStatus).toBe('refunded'); expect(after?.creditCost).toBe(14);
        expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='owner'")).rows).toEqual([{ balance: 2147483647, total_used: 0 }]);
        expect((await query("SELECT amount,task_id,reference_id FROM wujie_credit_transactions WHERE type='refund'")).rows)
          .toEqual([{ amount: 14, task_id: admission.task.id, reference_id: admission.task.id }]);
        expect((await query('SELECT identity FROM wujie_refund_identity_claims')).rows).toEqual([{ identity: admission.task.id }]);
        const ledger = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
        expect((await recoverExpiredSketchTask(admission.task.id, identity)).status).toBe('skipped');
        const cancel = await terminateCloudTaskAndRefund(admission.task.id, 'cancelled', 'repeat after recovered timeout');
        expect(cancel.transitioned).toBe(false); expect(cancel.refunded).toBe(false);
        expect((await getCloudTaskById(admission.task.id))?.status).toBe('timeout');
        expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(ledger);
        expect((await query('SELECT count(*)::int n FROM wujie_asset_versions')).rows).toEqual([{ n: 0 }]);
        expect(compute).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
      } finally { http.mockRestore(); }
    });
  }, 30_000);
  it.each([
    { name: 'delta0', base: 7, rate: 1_000_000, u: usage(3, 4), actual: 14, funds: 100 },
    { name: 'zero usage', base: 7, rate: 1, u: usage(0, 0), actual: 1, funds: 100 },
    { name: 'base0 minimum', base: 0, rate: 1, u: usage(0, 0), actual: 1, funds: 100 },
    { name: 'base0 full refund on invalid usage', base: 0, rate: 1, u: null, actual: 0, funds: 100 },
    { name: 'maximum400M', base: 100_000, rate: 10_000_000, u: usage(10_000_000, 10_000_000), actual: 400_000_000, funds: 500_000_000 },
    { name: 'aggregate ceil once', base: 7, rate: 1, u: usage(250_000, 250_000), actual: 1, funds: 100 },
  ])('token matrix $name uses original ledger net cost and exact document bytes', async example => {
    await withIsolatedPostgres('token_matrix', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl);
      await query("UPDATE wujie_credits SET balance=$1,total_recharged=$1 WHERE user_id='owner'", [example.funds]);
      const admission = await tokenAdmission(example.base, example.rate);
      if (example.u === null) {
        expect(await executeSketchTask(metered(admission, null), { actorUserId: 'owner', projectId: 'personal' }, { publisher: publishSketchTask }))
          .toEqual({ status: 'failed', reason: 'SKETCH_TOKEN_USAGE_INVALID' });
        expect((await query("SELECT type,amount FROM wujie_credit_transactions ORDER BY amount")).rows)
          .toEqual([{ type: 'consume', amount: -1 }, { type: 'refund', amount: 1 }]);
        expect((await getCloudTaskById(admission.task.id))?.creditStatus).toBe('refunded');
      } else {
        const value = await publication(admission, example.u);
        expect(await publishSketchTask(value)).toBe(true);
        await assertSuccess(query, value, Math.max(1, 2 * example.base), example.actual);
      }
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='owner'")).rows)
        .toEqual([{ balance: example.funds - example.actual, total_used: example.actual }]);
    });
  }, 30_000);
  it('token nonce concurrency freezes price and replays through outage or flat switching without compute', async () => {
    await withIsolatedPostgres('token_nonce_freeze', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = input();
      const http = vi.spyOn(globalThis, 'fetch');
      try {
        const results = await Promise.all([tokenAdmission(7, 1, 'personal', 'owner', value), tokenAdmission(7, 1, 'personal', 'owner', value)]);
        expect(new Set(results.map(row => row.task.id)).size).toBe(1);
        expect(results.filter(row => row.charged)).toHaveLength(1); expect(results.filter(row => row.prepared)).toHaveLength(1);
        const first = results.find(row => row.prepared)!;
        const before = await accounting(query);
        for (const loadPricingConfig of [async () => ({ modelCredits: { 'p1::vision-1': 20 } }),
          async (): Promise<never> => { throw new Error('Current quote unavailable'); }]) {
          const loader = vi.fn(loadPricingConfig);
          const replay = await admitSketchTask(value, { actorUserId: 'owner', signal: new AbortController().signal }, { generation, loadPricingConfig: loader });
          expect(replay).toMatchObject({ reused: true, charged: false, task: { id: first.task.id, creditCost: 14 } });
          expect(replay.prepared).toBeUndefined(); expect(loader).not.toHaveBeenCalled(); expect(await accounting(query)).toEqual(before);
        }
        await expect(tokenAdmission(7, 1, 'personal', 'owner', { ...value, instruction: 'different' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
        expect(await accounting(query)).toEqual(before);
        const second = await tokenAdmission(10, 2, 'personal', 'owner', { ...value, idempotencyKey: randomUUID() });
        expect(second.task.id).not.toBe(first.task.id);
        const rows = (await query<{ request_digest: string; result: { sketchAdmission: { pricing: unknown } } }>('SELECT request_digest,result FROM cloud_tasks ORDER BY credit_cost')).rows;
        expect(rows[0].request_digest).toBe(rows[1].request_digest);
        expect(rows.map(row => row.result.sketchAdmission.pricing)).toEqual([
          { mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14, tokenPricing: { input: 1, output: 1 } },
          { mode: 'token', calls: 2, perCallCredits: 10, totalCredits: 20, tokenPricing: { input: 2, output: 2 } },
        ]);
        expect((await query('SELECT amount FROM wujie_credit_transactions ORDER BY amount')).rows).toEqual([{ amount: -20 }, { amount: -14 }]);
        expect(http).not.toHaveBeenCalled();
      } finally { http.mockRestore(); }
    });
  }, 30_000);
  it.each(['partial', 'malformed', 'phase-overflow', 'insufficient', 'total-used-overflow', 'total-used-underflow'] as const)(
    'token confirmed %s rejection retains rollback then original single full refund', async scenario => {
      await withIsolatedPostgres('token_possible_refund', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl); const admission = await tokenAdmission(7, scenario === 'partial' || scenario === 'malformed' ? 1 : 1_000_000);
        let u: unknown = usage(5, 5);
        if (scenario === 'partial') u = { ...usage(), reconstruction: null, total: null };
        if (scenario === 'malformed') u = { ...usage(), total: { inputTokens: 3, outputTokens: 2 } };
        if (scenario === 'phase-overflow') u = usage(10_000_001, 0);
        if (scenario === 'insufficient') await query("UPDATE wujie_credits SET balance=5 WHERE user_id='owner'");
        if (scenario === 'total-used-overflow') await query("UPDATE wujie_credits SET total_used=2147483645 WHERE user_id='owner'");
        if (scenario === 'total-used-underflow') { u = usage(0, 0); await query("UPDATE wujie_credits SET total_used=0 WHERE user_id='owner'"); }
        let rollback = false;
        const outcome = await executeSketchTask(metered(admission, u), { actorUserId: 'owner', projectId: 'personal' }, { publisher: async value => {
          const before = await accounting(query);
          try { return await publishSketchTask(value); } catch (error) {
            expect(error).toMatchObject({ name: 'SketchTokenPublicationRejectedError' });
            expect(await accounting(query)).toEqual(before); rollback = true; throw error;
          }
        } });
        expect(rollback).toBe(true); expect(outcome.status).toBe('failed');
        expect(outcome.reason).toBe(scenario === 'partial' || scenario === 'malformed' || scenario === 'phase-overflow' ? 'SKETCH_TOKEN_USAGE_INVALID'
          : scenario === 'insufficient' ? 'SKETCH_TOKEN_INSUFFICIENT_CREDITS' : 'SKETCH_TOKEN_INTEGER_OVERFLOW');
        expect((await getCloudTaskById(admission.task.id))?.creditStatus).toBe('refunded');
        expect((await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY amount')).rows).toEqual([{ type: 'consume', amount: -14 }, { type: 'refund', amount: 14 }]);
        expect((await query('SELECT identity FROM wujie_refund_identity_claims')).rows).toEqual([{ identity: admission.task.id }]);
        expect((await query('SELECT count(*)::int n FROM wujie_asset_versions')).rows).toEqual([{ n: 0 }]);
        const ledger = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
        expect(await terminateCloudTaskAndRefund(admission.task.id, 'cancelled', 'repeat')).toMatchObject({ transitioned: false, refunded: false });
        expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(ledger);
      });
    }, 30_000);
  it('token shared editor pays own ledger while owner and another current editor read with inactive old lease', async () => {
    await withIsolatedPostgres('token_editor_read', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await publication(await tokenAdmission(7, 1, 'shared', 'editor'));
      expect(await publishSketchTask(value)).toBe(true); await assertSuccess(query, value, 14, 1);
      await query('UPDATE cloud_tasks SET lease_expires_at=1 WHERE id=$1', [value.task.id]);
      for (const actorUserId of ['owner', 'editor', 'reader']) expect((await readSketchDocument({ actorUserId, projectId: 'shared', taskId: value.task.id })).bytes).toEqual(Buffer.from(value.draft.html));
      expect((await query("SELECT user_id,balance,total_used FROM wujie_credits WHERE user_id IN ('owner','editor') ORDER BY user_id")).rows)
        .toEqual([{ user_id: 'editor', balance: 99, total_used: 1 }, { user_id: 'owner', balance: 100, total_used: 0 }]);
      await revokeDocumentEditor('owner', 'shared', 'editor');
      for (const actorUserId of ['editor', 'stranger', 'viewer']) await expect(readSketchDocument({ actorUserId, projectId: 'shared', taskId: value.task.id })).rejects.toMatchObject({ status: 404 });
      expect((await readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: value.task.id })).bytes).toEqual(Buffer.from(value.draft.html));
    });
  }, 30_000);
  it.each(['task-record', 'preview-record', 'html-record', 'charge', 'adjustment', 'frozen-rate'] as const)(
    'token tamper %s refuses read and replay without new ledger entries', async field => {
      await withIsolatedPostgres('token_tamper', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl); const value = await publication(await tokenAdmission()); expect(await publishSketchTask(value)).toBe(true);
        const completed = (await getCloudTaskById(value.task.id))!;
        if (field === 'task-record') await query("UPDATE cloud_tasks SET result=jsonb_set(result,'{sketchTokenSettlement,actualCredits}','2') WHERE id=$1", [value.task.id]);
        if (field === 'preview-record' || field === 'html-record') await query("UPDATE wujie_asset_versions SET metadata=jsonb_set(metadata,'{sketchTokenSettlement,deltaCredits}','0') WHERE id=$1",
          [field === 'preview-record' ? completed.result!.previewAssetVersionId : completed.result!.htmlAssetVersionId]);
        if (field === 'charge') await query('UPDATE wujie_credit_transactions SET amount=-13 WHERE id=$1', [completed.chargedTransactionId]);
        if (field === 'adjustment') await query("UPDATE wujie_credit_transactions SET model='tampered' WHERE type='refund'");
        if (field === 'frozen-rate') await query("UPDATE cloud_tasks SET result=jsonb_set(result,'{sketchAdmission,pricing,tokenPricing,input}','1000000') WHERE id=$1", [value.task.id]);
        const before = await accounting(query);
        await expect(readSketchDocument({ actorUserId: 'owner', projectId: 'personal', taskId: value.task.id })).rejects.toMatchObject({ status: 404 });
        expect(await publishSketchTask(value)).toBe(false); expect(await accounting(query)).toEqual(before);
      });
    }, 30_000);
  it('token original charge tampering refuses pre-publication without a trusted refund permission', async () => {
    await withIsolatedPostgres('token_bad_charge', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await publication(await tokenAdmission());
      await query('UPDATE wujie_credit_transactions SET amount=-13 WHERE id=$1', [value.task.chargedTransactionId]);
      const before = await accounting(query); expect(await publishSketchTask(value)).toBe(false); expect(await accounting(query)).toEqual(before);
    });
  }, 30_000);
  it.each(['preview', 'html', 'complete', 'after-complete'] as const)('token fault %s rolls back delta claim assets and task together', async point => {
    await withIsolatedPostgres('token_atomic_fault', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await publication(await tokenAdmission()); const before = await accounting(query);
      let saved: PersistedAssetFile | undefined; let reached = false; let inserts = 0; let clocks = 0;
      expect(await publishSketchTask(value, { persistBytes: async data => { saved = await persistAssetBytes(data); return saved; },
        connect: async () => intercept(await getPool().connect(), async sql => {
          if (sql.includes('INSERT INTO wujie_asset_versions')) { inserts++;
            if (point === 'preview' && inserts === 1 || point === 'html' && inserts === 2) { reached = true; throw new Error('Asset write fault'); }
          }
          if (point === 'complete' && sql.includes("status = 'completed'")) { reached = true; throw new Error('Completion write fault'); }
          if (sql.includes('clock_timestamp()') && sql.includes('FROM cloud_tasks')) clocks++;
          if (point === 'after-complete' && clocks === 3 && sql.includes('clock_timestamp()') && sql.includes('FROM cloud_tasks')) {
            reached = true; throw new Error('Post-completion fence failed before COMMIT');
          }
        }) })).toBe(false);
      expect(reached).toBe(true); expect(await accounting(query)).toEqual(before);
      if (saved) expect(existsSync(filePath(saved))).toBe(false);
    });
  }, 30_000);
  it('token uncommitted adjustment and both assets are invisible before actual COMMIT', async () => {
    await withIsolatedPostgres('token_visibility', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await publication(await tokenAdmission()); const before = await accounting(query);
      const ready = gate(), resume = gate();
      const pending = publishSketchTask(value, { connect: async () => intercept(await getPool().connect(), async sql => {
        if (sql === 'COMMIT') { ready.open(); await resume.promise; }
      }) });
      await ready.promise;
      try { expect(await accounting(query)).toEqual(before); } finally { resume.open(); }
      expect(await pending).toBe(true); await assertSuccess(query, value, 14, 1);
    });
  }, 30_000);
  it.each(['committed-ack-lost', 'not-committed-unknown', 'rollback-unknown', 'read-unknown'] as const)(
    'token executor %s never invents refund or cleans potentially committed bytes', async scenario => {
      await withIsolatedPostgres('token_unknown', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl); const admission = metered(await tokenAdmission(), usage());
        let saved: PersistedAssetFile | undefined; let unknownRead = false; let discarded = false; let publicationValue: SketchPublicationInput | undefined;
        const outcome = await executeSketchTask(admission, { actorUserId: 'owner', projectId: 'personal' }, {
          getCloudTaskById: async id => { if (unknownRead) throw new Error('Unknown read'); return getCloudTaskById(id); },
          publisher: async value => {
            publicationValue = value;
            const result = await publishSketchTask(value, { persistBytes: async data => { saved = await persistAssetBytes(data); return saved; },
              connect: async () => {
                const client = await getPool().connect();
                return intercept(client, async sql => {
                  if (scenario === 'rollback-unknown') {
                    if (sql.includes("status = 'completed'")) throw new Error('Pre-completion failure');
                    if (sql === 'ROLLBACK') { await client.query('ROLLBACK'); throw new Error('Rollback acknowledgement unknown'); }
                  }
                  if (sql === 'COMMIT' && scenario === 'committed-ack-lost') { await client.query('COMMIT'); throw new Error('Actual COMMIT acknowledged only by DB'); }
                  if (sql === 'COMMIT' && scenario === 'not-committed-unknown') { await client.query('ROLLBACK'); throw new Error('COMMIT was not sent, transport unknown to caller'); }
                }, flag => { discarded = flag; });
              } });
            if (scenario === 'read-unknown') unknownRead = true;
            return result;
          },
        });
        expect(outcome.status).toBe('deferred');
        const task = (await getCloudTaskById(admission.task.id))!;
        expect(task.refundedTransactionId).toBeUndefined();
        const committed = scenario === 'committed-ack-lost' || scenario === 'read-unknown';
        expect(task.status).toBe(committed ? 'completed' : 'processing'); expect(task.creditStatus).toBe(committed ? 'charged' : 'pending');
        expect((await query('SELECT count(*)::int n FROM wujie_credit_transactions')).rows).toEqual([{ n: committed ? 2 : 1 }]);
        expect((await query('SELECT count(*)::int n FROM wujie_asset_versions')).rows).toEqual([{ n: committed ? 2 : 0 }]);
        expect((await query('SELECT count(*)::int n FROM wujie_refund_identity_claims')).rows).toEqual([{ n: committed ? 1 : 0 }]);
        expect(saved).toBeDefined(); expect(existsSync(filePath(saved!))).toBe(true);
        if (scenario !== 'read-unknown') expect(discarded).toBe(true);
        if (committed) {
          const before = await accounting(query);
          expect((await readSketchDocument({ actorUserId: 'owner', projectId: 'personal', taskId: task.id })).bytes).toEqual(Buffer.from(publicationValue!.draft.html));
          // execution closes its original signal; replay uses a new server scope.
          expect(await publishSketchTask({ ...publicationValue!, signal: new AbortController().signal })).toBe(true);
          expect(await accounting(query)).toEqual(before);
          expect(await terminateCloudTaskAndRefund(task.id, 'cancelled', 'late')).toMatchObject({ transitioned: false, refunded: false });
        }
      });
    }, 30_000);
  it.each(['task', 'grant', 'version', 'credit'] as const)('token real %s lock crosses lease then DB-time gate forbids late settlement', async lock => {
    await withIsolatedPostgres('token_lock_expiry', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await publication(await tokenAdmission(7, 1, 'shared', 'editor'), usage(), 1500);
      if (lock === 'version') expect(await publishSketchTask(value)).toBe(true);
      const before = await accounting(query); const blocker = await getPool().connect(); await blocker.query('BEGIN');
      if (lock === 'task') await blocker.query('SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE', [value.task.id]);
      if (lock === 'grant') await blocker.query("SELECT project_id FROM wujie_project_document_editors WHERE member_user_id='editor' FOR UPDATE");
      if (lock === 'version') await blocker.query('SELECT id FROM wujie_asset_versions WHERE task_id=$1 FOR UPDATE', [value.task.id]);
      if (lock === 'credit') await blocker.query("SELECT id FROM wujie_credits WHERE user_id='editor' FOR UPDATE");
      let pid = 0; const statements: string[] = [];
      const pending = publishSketchTask(value, { connect: async () => {
        const client = await getPool().connect(); pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid;
        return intercept(client, async sql => { statements.push(sql); });
      } });
      try {
        while (!pid) await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
        await until(query, 'SELECT cardinality(pg_blocking_pids($1::int))>0 ok', [pid]);
        await until(query, 'SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint >= $1::bigint ok', [value.lease.expiresAt]);
      } finally { await blocker.query('ROLLBACK'); blocker.release(); }
      expect(await pending).toBe(false); expect(await accounting(query)).toEqual(before);
      if (lock === 'credit') {
        const creditIndex = statements.findIndex(sql => sql.includes('FROM wujie_credits') && sql.includes('FOR UPDATE'));
        const clockIndex = statements.findIndex(sql => sql.includes('clock_timestamp()') && sql.includes('FROM cloud_tasks'));
        expect(creditIndex).toBeGreaterThan(-1); expect(clockIndex).toBeGreaterThan(creditIndex);
      }
    });
  }, 30_000);
  it('token native publication 30s deadline after preparation rolls back ledger claim and files', async () => {
    await withIsolatedPostgres('token_deadline', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await publication(await tokenAdmission()); const before = await accounting(query);
      let saved: PersistedAssetFile | undefined;
      expect(await publishSketchTask(value, { persistBytes: async data => {
        saved = await persistAssetBytes({ ...data, signal: undefined });
        await new Promise<void>(resolveTurn => data.signal!.addEventListener('abort', () => resolveTurn(), { once: true }));
        return saved;
      } })).toBe(false);
      expect(await accounting(query)).toEqual(before); expect(existsSync(filePath(saved!))).toBe(false);
    });
  }, 45_000);
  it.each(['cancel-first', 'complete-first', 'simultaneous'] as const)('token cancel vs complete %s has one financial terminal and unique refund identity', async order => {
    await withIsolatedPostgres('token_cancel_race', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await publication(await tokenAdmission());
      let published: boolean;
      if (order === 'cancel-first') {
        expect(await terminateCloudTaskAndRefund(value.task.id, 'cancelled', 'first')).toMatchObject({ transitioned: true, refunded: true });
        published = await publishSketchTask(value);
      } else if (order === 'complete-first') {
        published = await publishSketchTask(value);
        expect(await terminateCloudTaskAndRefund(value.task.id, 'cancelled', 'late')).toMatchObject({ transitioned: false, refunded: false });
      } else {
        const blocker = await getPool().connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE', [value.task.id]);
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid;
        const pending = Promise.all([publishSketchTask(value), terminateCloudTaskAndRefund(value.task.id, 'cancelled', 'race')]);
        // PostgreSQL may queue the second waiter behind the first waiter rather
        // than list our blocker directly; include the actual blocking chain.
        try { await until(query, `WITH RECURSIVE waits(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
          UNION SELECT a.pid FROM pg_stat_activity a JOIN waits w ON w.pid=ANY(pg_blocking_pids(a.pid)))
          SELECT count(*)>=2 ok FROM waits`, [pid]); }
        finally { await blocker.query('ROLLBACK'); blocker.release(); }
        published = (await pending)[0];
      }
      const task = (await getCloudTaskById(value.task.id))!;
      expect(task.status).toBe(published ? 'completed' : 'cancelled'); expect(task.creditStatus).toBe(published ? 'charged' : 'refunded');
      expect((await query("SELECT amount FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([{ amount: published ? 13 : 14 }]);
      expect((await query('SELECT identity FROM wujie_refund_identity_claims')).rows).toEqual([{ identity: task.id }]);
      expect((await query('SELECT count(*)::int n FROM wujie_asset_versions')).rows).toEqual([{ n: published ? 2 : 0 }]);
      const ledger = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
      expect(await terminateCloudTaskAndRefund(task.id, 'cancelled', 'repeat')).toMatchObject({ transitioned: false, refunded: false });
      expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(ledger);
    });
  }, 30_000);
  it('token real topup uses deterministic delta ID and completed concurrent replay ignores changed stored rates', async () => {
    await withIsolatedPostgres('token_topup_replay', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const admission = await tokenAdmission(7, 1_000_000);
      const value = await publication(admission, usage(5, 5)); expect(await publishSketchTask(value)).toBe(true);
      await assertSuccess(query, value, 14, 20);
      await query("INSERT INTO wujie_system_settings(key,value,updated_at) VALUES ('credit_pricing_config',$1::jsonb,1)",
        [JSON.stringify({ modelCredits: { 'p1::vision-1': { credits: 20, tokenPricing: { input: 1, output: 1 } } } })]);
      const loader = vi.fn(async (): Promise<never> => { throw new Error('Unavailable current quote'); });
      const before = await accounting(query);
      const replay = await admitSketchTask(value.input, { actorUserId: 'owner', signal: new AbortController().signal }, { generation, loadPricingConfig: loader });
      expect(replay).toMatchObject({ reused: true, charged: false, task: { id: value.task.id, status: 'completed' } });
      expect(replay.prepared).toBeUndefined(); expect(loader).not.toHaveBeenCalled();
      expect(await Promise.all([publishSketchTask(value), publishSketchTask(value)])).toEqual([true, true]);
      expect(await accounting(query)).toEqual(before);
    });
  }, 30_000);
  it('token topup SQL rolls back with both assets when original completion fails', async () => {
    await withIsolatedPostgres('token_topup_fault', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await publication(await tokenAdmission(7, 1_000_000), usage(5, 5));
      const before = await accounting(query); let adjustmentReached = false;
      expect(await publishSketchTask(value, { connect: async () => intercept(await getPool().connect(), async sql => {
        if (sql.includes('INSERT INTO wujie_credit_transactions')) adjustmentReached = true;
        if (sql.includes("status = 'completed'")) throw new Error('Original completion failure after topup');
      }) })).toBe(false);
      expect(adjustmentReached).toBe(true); expect(await accounting(query)).toEqual(before);
    });
  }, 30_000);
});

async function assertOriginalRepeat(query: QueryFn, before: Record<string, unknown>): Promise<void> {
  const after = await accounting(query);
  const tasks = after.cloud_tasks as Array<{ row: Record<string, unknown> }>;
  const prior = before.cloud_tasks as Array<{ row: Record<string, unknown> }>;
  expect(tasks).toHaveLength(prior.length);
  for (let i = 0; i < tasks.length; i++) {
    // Original reconcile deliberately refreshes updated_at on a terminal repeat.
    expect(Number(tasks[i].row.updated_at)).toBeGreaterThanOrEqual(Number(prior[i].row.updated_at));
    expect(tasks[i].row).toEqual({ ...prior[i].row, updated_at: tasks[i].row.updated_at });
  }
  for (const table of ['wujie_credits', 'wujie_credit_transactions', 'wujie_refund_identity_claims', 'wujie_assets', 'wujie_asset_versions']) {
    expect(after[table]).toEqual(before[table]);
  }
}

describe('Token fix1 post-rollback refund authority', () => {
  it.each(['current editor revoked', 'original consume amount tampered'])(
    'fix1 RED %s after actual publisher rollback must defer without refund', async variant => {
      await withIsolatedPostgres('token_fix1_red', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl);
        const admission = await tokenAdmission(7, 1, 'shared', 'editor');
        let postMutation: Record<string, unknown> | undefined; let confirmed = false;
        const outcome = await executeSketchTask(metered(admission, null), { actorUserId: 'editor', projectId: 'shared' }, {
          publisher: async value => {
            try { return await publishSketchTask(value); }
            catch (error) {
              confirmed = error instanceof Error && error.name === 'SketchTokenPublicationRejectedError';
              if (variant === 'current editor revoked') await revokeDocumentEditor('owner', 'shared', 'editor');
              else await query('UPDATE wujie_credit_transactions SET amount=-13 WHERE id=$1', [value.task.chargedTransactionId]);
              postMutation = await accounting(query);
              throw error;
            }
          },
        });
        const after = await accounting(query);
        console.info('Token fix1 real rollback window:', JSON.stringify({ variant, confirmed, outcome, postMutation, after }));
        expect(confirmed).toBe(true); expect(postMutation).toBeDefined();
        expect(outcome.status).toBe('deferred'); expect(after).toEqual(postMutation);
      });
    }, 30_000);
  it.each(['regrant', 'model', 'user_id', 'task_id', 'reference_id', 'id', 'extra-adjustment', 'settlement', 'status', 'credit-status', 'refunded-id'])(
    'fix1 rejects post-rollback %s drift using the new locked authority', async variant => {
      await withIsolatedPostgres('token_fix1_drift', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl); const admission = await tokenAdmission(7, 1, 'shared', 'editor');
        const source = metered(admission, null), compute = vi.fn(source.prepared!.compute), http = vi.spyOn(globalThis, 'fetch');
        source.prepared = { ...source.prepared!, compute };
        let before: Record<string, unknown> | undefined;
        try {
          const result = await executeSketchTask(source, { actorUserId: 'editor', projectId: 'shared' }, {
            publisher: async value => {
              try { return await publishSketchTask(value); } catch (error) {
                expect(error).toMatchObject({ name: 'SketchTokenPublicationRejectedError' });
                if (variant === 'regrant') {
                  await revokeDocumentEditor('owner', 'shared', 'editor'); await grantDocumentEditorByName('owner', 'shared', 'Editor');
                  expect((await query('SELECT grant_generation::text FROM wujie_project_document_editors WHERE member_user_id=$1', ['editor'])).rows)
                    .toEqual([{ grant_generation: '3' }]);
                } else if (['model', 'user_id', 'task_id', 'reference_id', 'id'].includes(variant)) {
                  const replacements: Record<string, string> = { model: 'wrong-model', user_id: 'reader', task_id: 'wrong-task', reference_id: 'wrong-ref', id: 'wrong-charge' };
                  await query(`UPDATE wujie_credit_transactions SET ${variant}=$2 WHERE id=$1`, [value.task.chargedTransactionId, replacements[variant]]);
                } else if (variant === 'extra-adjustment') {
                  await query(`INSERT INTO wujie_credit_transactions(id,user_id,type,amount,balance_after,model,task_id,reference_id,created_at)
                    VALUES ('extra','editor','consume',-1,85,'vision-1',$1,$1,1)`, [value.task.id]);
                } else if (variant === 'settlement') await query("UPDATE cloud_tasks SET result=result||'{\"sketchTokenSettlement\":{}}'::jsonb WHERE id=$1", [value.task.id]);
                else if (variant === 'status') await query("UPDATE cloud_tasks SET status='pending' WHERE id=$1", [value.task.id]);
                else if (variant === 'credit-status') await query("UPDATE cloud_tasks SET credit_status='charged' WHERE id=$1", [value.task.id]);
                else await query("UPDATE cloud_tasks SET refunded_transaction_id='unconfirmed-refund' WHERE id=$1", [value.task.id]);
                before = await accounting(query); throw error;
              }
            },
          });
          expect(before).toBeDefined(); expect(result.status).toBe('deferred'); expect(await accounting(query)).toEqual(before);
          expect(compute).toHaveBeenCalledOnce(); expect(http).not.toHaveBeenCalled();
        } finally { http.mockRestore(); }
      });
    }, 30_000);
  it('fix1 holds current grant and original consume locks through same-client refund COMMIT with no dirty visibility or duplicate refund', async () => {
    await withIsolatedPostgres('token_fix1_commit_locks', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const admission = await tokenAdmission(7, 1, 'shared', 'editor');
      const grantWriter = await getPool().connect(), chargeWriter = await getPool().connect();
      const grantPid = (await grantWriter.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid;
      const chargePid = (await chargeWriter.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid;
      const entered = gate(), release = gate(); let raw: PoolClient | undefined;
      const trace: string[] = [];
      let postRollback: Record<string, unknown> | undefined; let rejectValue: SketchPublicationInput | undefined;
      let grantWork: Promise<unknown> | undefined, chargeWork: Promise<unknown> | undefined;
      try {
        const run = executeSketchTask(metered(admission, null), { actorUserId: 'editor', projectId: 'shared' }, {
          connect: async () => { raw = await getPool().connect(); return intercept(raw, async sql => { trace.push(sql); }); },
          publisher: async value => {
            rejectValue = value;
            try { return await publishSketchTask(value); } catch (error) { postRollback = await accounting(query); throw error; }
          },
          terminateCloudTaskAndRefund: async (...args) => {
            expect(args[4]?.client).toBeDefined(); expect(args[4]?.client).not.toBe(raw);
            const result = await terminateCloudTaskAndRefund(...args);
            expect(result).toMatchObject({ transitioned: true, refunded: true });
            // Same guarded client sees original task/refund atomically before COMMIT.
            expect((await args[4]!.client!.query("SELECT status,credit_status FROM cloud_tasks WHERE id=$1", [admission.task.id])).rows)
              .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
            entered.open(); await release.promise; return result;
          },
        });
        await entered.promise;
        expect(await accounting(query)).toEqual(postRollback);
        grantWork = grantWriter.query("UPDATE wujie_project_document_editors SET updated_at=updated_at WHERE member_user_id='editor'");
        chargeWork = chargeWriter.query('UPDATE wujie_credit_transactions SET amount=amount WHERE id=$1', [rejectValue!.task.chargedTransactionId]);
        await until(query, "SELECT count(*)=2 ok FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [[grantPid, chargePid]]);
        console.info('Token fix1 refund locks:', JSON.stringify({ grantPid, chargePid, blockedWriters: 2, outsideUnchanged: true, sameClientStagedRefund: true }));
        release.open(); expect(await run).toEqual({ status: 'failed', reason: 'SKETCH_TOKEN_USAGE_INVALID' });
        const clockQueries = trace.map((sql, i) => sql.includes('clock_timestamp())*1000)::bigint AS now') ? i : -1).filter(i => i >= 0);
        expect(clockQueries).toHaveLength(2);
        expect(clockQueries[0]).toBeGreaterThan(trace.findIndex(sql => sql.includes('FROM wujie_credit_transactions')));
        expect(trace.findIndex(sql => sql.includes('WITH candidate AS'))).toBeGreaterThan(clockQueries[0]);
        expect(trace.at(-1)).toBe('COMMIT'); expect(clockQueries[1]).toBeGreaterThan(trace.findIndex(sql => sql.includes('WITH candidate AS')));
        await Promise.all([grantWork, chargeWork]);
        const after = await accounting(query);
        await expect(publishSketchTask(rejectValue!)).resolves.toBe(false);
        expect(await terminateCloudTaskAndRefund(admission.task.id, 'cancelled', 'repeat')).toMatchObject({ transitioned: false, refunded: false });
        await assertOriginalRepeat(query, after);
        expect((await query("SELECT amount FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([{ amount: 14 }]);
        expect((await query('SELECT identity FROM wujie_refund_identity_claims')).rows).toEqual([{ identity: admission.task.id }]);
        expect((await query('SELECT count(*)::int n FROM wujie_asset_versions')).rows).toEqual([{ n: 0 }]);
      } finally {
        release.open(); await Promise.allSettled([grantWork, chargeWork].filter(Boolean)); grantWriter.release(); chargeWriter.release();
      }
    });
  }, 30_000);
  it.each(['commit-ack-lost', 'commit-not-sent', 'rollback-unknown', 'connect-unknown', 'permission-read-unknown'])(
    'fix1 refund transaction %s defers without repeat refund or provider work', async variant => {
      await withIsolatedPostgres('token_fix1_unknown', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl); const admission = await tokenAdmission(7, 1, 'shared', 'editor');
        let before: Record<string, unknown> | undefined; let pid: number | undefined; const statements: string[] = [], releases: boolean[] = [];
        const source = metered(admission, null), compute = vi.fn(source.prepared!.compute), http = vi.spyOn(globalThis, 'fetch');
        source.prepared = { ...source.prepared!, compute };
        try {
          const result = await executeSketchTask(source, { actorUserId: 'editor', projectId: 'shared' }, {
            publisher: async value => { try { return await publishSketchTask(value); } catch (error) { before = await accounting(query); throw error; } },
            connect: async () => {
              if (variant === 'connect-unknown') throw new Error('Unknown connection');
              const client = await getPool().connect(); pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid;
              return intercept(client, async sql => {
                statements.push(sql);
                if (sql === 'COMMIT' && variant === 'commit-ack-lost') { await client.query('COMMIT'); throw new Error('Actual COMMIT, acknowledgment lost'); }
                if (sql === 'COMMIT' && variant === 'commit-not-sent') throw new Error('COMMIT not sent, unknown to caller');
                if (sql.includes('FROM wujie_project_document_editors') && (variant === 'rollback-unknown' || variant === 'permission-read-unknown')) {
                  throw new Error('Current grant read unknown');
                }
                if (sql === 'ROLLBACK' && variant === 'rollback-unknown') throw new Error('ROLLBACK acknowledgment unknown');
              }, discard => releases.push(discard));
            },
          });
          expect(result.status).toBe('deferred'); expect(before).toBeDefined();
          if (releases[0] && pid) await until(query, 'SELECT NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1) ok', [pid]);
          const after = await accounting(query);
          if (variant === 'commit-ack-lost') {
            expect((await getCloudTaskById(admission.task.id))).toMatchObject({ status: 'failed', creditStatus: 'refunded' });
            expect((await query("SELECT amount FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([{ amount: 14 }]);
            expect((await query('SELECT identity FROM wujie_refund_identity_claims')).rows).toEqual([{ identity: admission.task.id }]);
            expect(await terminateCloudTaskAndRefund(admission.task.id, 'cancelled', 'repeat after unknown commit')).toMatchObject({ transitioned: false, refunded: false });
            await assertOriginalRepeat(query, after);
          } else expect(after).toEqual(before);
          expect(statements.filter(sql => sql.includes('WITH candidate AS'))).toHaveLength(variant.startsWith('commit-') ? 1 : 0);
          expect(releases).toEqual(variant === 'connect-unknown' ? [] : [variant !== 'permission-read-unknown']);
          expect(statements.at(-1)).toBe(variant === 'connect-unknown' ? undefined : variant.startsWith('commit-') ? 'COMMIT' : 'ROLLBACK');
          expect(compute).toHaveBeenCalledOnce(); expect(http).not.toHaveBeenCalled();
          console.info('Token fix1 refund ambiguity:', JSON.stringify({ variant, result, releases, refundStatements: statements.filter(sql => sql.includes('WITH candidate AS')).length, actualCommitted: variant === 'commit-ack-lost' }));
        } finally { http.mockRestore(); }
      });
    }, 30_000);
  it('fix1 leaves original explicit cancellation authorized after current editor revocation', async () => {
    await withIsolatedPostgres('token_fix1_cancel', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const admission = await tokenAdmission(7, 1, 'shared', 'editor');
      const controller = new AbortController(); const prepared = admission.prepared!;
      const result = await executeSketchTask({ ...admission, prepared: { ...prepared, compute: async () => {
        await revokeDocumentEditor('owner', 'shared', 'editor'); controller.abort({ code: 'USER_CANCELLED' });
        throw new Error('Explicit cancellation after revoke');
      } } }, { actorUserId: 'editor', projectId: 'shared', signal: controller.signal }, { publisher: publishSketchTask });
      expect(result.status).toBe('cancelled'); expect((await getCloudTaskById(admission.task.id))?.creditStatus).toBe('refunded');
      expect((await query("SELECT amount FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([{ amount: 14 }]);
    });
  }, 30_000);
  it.each(['task', 'grant', 'credit', 'ledger'])(
    'fix1 real %s lock crosses fixed deadline: drain terminal query before rollback/release, no late refund', async kind => {
      await withIsolatedPostgres('token_fix1_deadline', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl); const admission = await tokenAdmission(7, 1, 'shared', 'editor');
        const blocker = await getPool().connect(); await blocker.query('BEGIN');
        let before: Record<string, unknown> | undefined; let pid = 0, active = false, released = false;
        const connected = gate();
        const trace: string[] = []; let run: ReturnType<typeof executeSketchTask> | undefined;
        try {
          run = executeSketchTask(metered(admission, null), { actorUserId: 'editor', projectId: 'shared' }, {
            publisher: async value => {
              try { return await publishSketchTask(value); } catch (error) {
                expect(error).toMatchObject({ name: 'SketchTokenPublicationRejectedError' });
                const sql = kind === 'task' ? 'SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE'
                  : kind === 'grant' ? "SELECT member_user_id FROM wujie_project_document_editors WHERE member_user_id='editor' FOR UPDATE"
                    : kind === 'credit' ? "SELECT user_id FROM wujie_credits WHERE user_id='editor' FOR UPDATE"
                      : 'SELECT id FROM wujie_credit_transactions WHERE id=$1 FOR UPDATE';
                await blocker.query(sql, kind === 'task' ? [value.task.id] : kind === 'ledger' ? [value.task.chargedTransactionId] : []);
                before = await accounting(query); throw error;
              }
            },
            connect: async () => {
              const client = await getPool().connect(); pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid;
              connected.open();
              return new Proxy(client, { get(target, key) {
                if (key === 'query') return async (sql: string, values?: unknown[]): Promise<unknown> => {
                  expect(active).toBe(false); trace.push(sql); active = true;
                  try { return await target.query(sql, values); } finally { active = false; }
                };
                if (key === 'release') return (discard = false): void => { expect(active).toBe(false); released = true; target.release(discard); };
                const value: unknown = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
              } });
            },
          });
          await connected.promise;
          await until(query, "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') ok", [pid]);
          // Driver-owned wait, not an application race: permission can wait 5/10s,
          // whereas the other new locks use 1s. Both must observe the SAME deadline.
          await query('SELECT pg_sleep(1.1)');
          if (kind === 'grant') { expect(active).toBe(true); expect(released).toBe(false); }
          await blocker.query('ROLLBACK');
          expect((await run).status).toBe('deferred'); expect(await accounting(query)).toEqual(before);
          expect(trace.at(-1)).toBe('ROLLBACK'); expect(trace.some(sql => sql.includes('WITH candidate AS'))).toBe(false);
          expect(released).toBe(true);
          console.info('Token fix1 drained lock:', JSON.stringify({ kind, pid, queries: trace, noConcurrentQuery: true, terminalBeforeRelease: true }));
        } finally { await blocker.query('ROLLBACK'); blocker.release(); await run; }
      });
    }, 30_000);
  it.each([{ kind: 'grant', wait: 1.1, ttl: 180_000, expiry: 'deadline' }, { kind: 'credit', wait: 0.8, ttl: 700, expiry: 'lease' }])(
    'fix1 lock-after-clock $kind proves real DB-time $expiry despite frozen application time', async example => {
      await withIsolatedPostgres('token_fix1_dbtime', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl); const admission = await tokenAdmission(7, 1, 'shared', 'editor');
        const blocker = await getPool().connect(); await blocker.query('BEGIN');
        const stamp = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(stamp);
        const trace: string[] = []; let before: Record<string, unknown> | undefined; let pid = 0;
        let run: ReturnType<typeof executeSketchTask> | undefined;
        try {
          run = executeSketchTask(metered(admission, null), { actorUserId: 'editor', projectId: 'shared' }, {
            claimCloudTaskLease: (id, owner) => claimCloudTaskLease(id, owner, example.ttl),
            publisher: async value => {
              try { return await publishSketchTask(value); } catch (error) {
                expect(error).toMatchObject({ name: 'SketchTokenPublicationRejectedError' });
                await blocker.query(example.kind === 'grant'
                  ? "SELECT member_user_id FROM wujie_project_document_editors WHERE member_user_id='editor' FOR UPDATE"
                  : "SELECT user_id FROM wujie_credits WHERE user_id='editor' FOR UPDATE");
                before = await accounting(query); throw error;
              }
            },
            connect: async () => {
              const client = await getPool().connect(); pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid;
              return intercept(client, async sql => { trace.push(sql); });
            },
          });
          const waitStarted = performance.now();
          while (!(await query<{ ok: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') ok", [pid])).rows[0]?.ok) {
            if (performance.now() - waitStarted > 8000) throw new Error('Fix1 real lock not observed');
            await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
          }
          await query('SELECT pg_sleep($1)', [example.wait]); await blocker.query('ROLLBACK');
          expect((await run).status).toBe('deferred'); expect(await accounting(query)).toEqual(before);
          const afterLedger = trace.findIndex(sql => sql.includes('FROM wujie_credit_transactions'));
          const dbClock = trace.findIndex(sql => sql.includes('clock_timestamp())*1000)::bigint AS now'));
          expect(afterLedger).toBeGreaterThan(-1); expect(dbClock).toBeGreaterThan(afterLedger);
          expect(trace.some(sql => sql.includes('WITH candidate AS'))).toBe(false); expect(trace.at(-1)).toBe('ROLLBACK');
          console.info('Token fix1 locked DB-time:', JSON.stringify({ ...example, stamp, pid, clockAfterLedger: true, noRefund: true }));
        } finally { clock.mockRestore(); await blocker.query('ROLLBACK'); blocker.release(); await run; }
      });
    }, 30_000);
  it.each(['abort', 'deadline', 'lease'])(
    'fix1 pre-COMMIT %s rolls back a real staged original full refund and identity claim', async variant => {
      await withIsolatedPostgres('token_fix1_precommit', async ({ query, databaseUrl }) => {
        await seed(query, databaseUrl); const admission = await tokenAdmission(7, 1, 'shared', 'editor');
        const controller = new AbortController(), stamp = Date.now();
        const clock = variant === 'abort' ? undefined : vi.spyOn(Date, 'now').mockReturnValue(stamp);
        const trace: string[] = []; let before: Record<string, unknown> | undefined; let staged = false;
        try {
          const result = await executeSketchTask(metered(admission, null), { actorUserId: 'editor', projectId: 'shared', signal: controller.signal }, {
            claimCloudTaskLease: (id, owner) => claimCloudTaskLease(id, owner, variant === 'lease' ? 700 : 180_000),
            publisher: async value => { try { return await publishSketchTask(value); } catch (error) { before = await accounting(query); throw error; } },
            connect: async () => intercept(await getPool().connect(), async sql => { trace.push(sql); }),
            terminateCloudTaskAndRefund: async (...args) => {
              const value = await terminateCloudTaskAndRefund(...args);
              expect(value).toMatchObject({ transitioned: true, refunded: true, status: 'failed' });
              expect((await args[4]!.client!.query('SELECT identity FROM wujie_refund_identity_claims')).rows).toEqual([{ identity: admission.task.id }]);
              staged = true;
              if (variant === 'abort') controller.abort({ code: 'USER_CANCELLED' });
              else await query('SELECT pg_sleep($1)', [variant === 'lease' ? 0.8 : 1.1]);
              return value;
            },
          });
          expect(staged).toBe(true); expect(result.status).toBe('deferred'); expect(before).toBeDefined();
          expect(await accounting(query)).toEqual(before); expect(trace.at(-1)).toBe('ROLLBACK'); expect(trace).not.toContain('COMMIT');
          expect(trace.filter(sql => sql.includes('WITH candidate AS'))).toHaveLength(1);
          expect(trace.filter(sql => sql.includes('clock_timestamp())*1000)::bigint AS now'))).toHaveLength(variant === 'abort' ? 1 : 2);
          console.info('Token fix1 original refund precommit rollback:', JSON.stringify({ variant, stagedOriginalRefund: true, stagedClaim: true,
            result, outsideUnchanged: true, commitSent: false }));
        } finally { clock?.mockRestore(); }
      });
    }, 30_000);
});
