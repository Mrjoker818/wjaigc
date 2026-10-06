import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

await vi.hoisted(async (): Promise<void> => {
  const database = new URL(process.env.POSTGRES_TEST_DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
    || !['postgres:', 'postgresql:'].includes(database.protocol)
    || !database.port || database.pathname.length < 2 || database.searchParams.has('options')) {
    throw new Error('Explicit loopback PostgreSQL test database without search_path required');
  }
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (!process.env.WUJIE_DATA_DIR) throw new Error('Explicit isolated media root required');
  process.env.WUJIE_DATA_DIR = fs.mkdtempSync(path.join(process.env.WUJIE_DATA_DIR, 'task-8cb3j4d-'));
  process.env.COZE_PROJECT_ENV = 'PROD'; // No development copy into public/uploads.
  process.env.LOCAL_AI_ENABLED = 'false';
  process.env.WUJIE_TASK_CORE_MODE = 'core-v2';
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
});

const boundary = vi.hoisted(() => ({
  media: vi.fn<(url: string) => Promise<Buffer>>(),
  config: vi.fn<() => Promise<ApiProvider[]>>(),
}));
vi.mock('server-only', () => ({}));
// Only the credential source is replaced. The actor and project policy read real SQL.
vi.mock('@/lib/server-auth', () => ({
  getAuthSecretForInternalRequests: async (): Promise<string> => 'isolated-postgres-image-edit-quote-signing-secret',
  getSessionUser: async (request?: Request): Promise<User | null> => {
    const { dbGetUserById } = await import('@/lib/db-storage');
    const user = await dbGetUserById(request?.headers.get('x-test-actor') || 'identity-owner');
    return user ? { id: user.id, name: user.name, role: user.role, status: user.status,
      createdAt: 1, updatedAt: 1 } as User : null;
  },
}));
vi.mock('@/lib/server-api-config', async original => ({
  ...await original<typeof import('@/lib/server-api-config')>(), getApiProviders: boundary.config,
}));
vi.mock('@/lib/fetch-image-buffer', () => ({ fetchImageBuffer: boundary.media }));
vi.mock('@/lib/s3-storage', () => ({ isS3Available: (): boolean => false }));

import { POST } from '@/app/api/image-edit/route';
import { GET as recoverGet } from '@/app/api/tasks/recover/route';
import { POST as cancelPost } from '@/app/api/cancel-task/route';
import { ensureCoreTables } from '@/lib/db-storage';
import { getPool } from '@/lib/db-client';
import { settleFailedTask } from '@/lib/task-core/billing-service';
import { isTaskCancelled } from '@/lib/task-registry';

const sourceUrl = 'https://media.invalid/identity-source.png';
const outputUrl = 'https://media.invalid/identity-output.png';
const projectA = 'identity-project-a';
const projectB = 'identity-project-b';
const sentRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
const body = { action: 'upscale', imageUrl: sourceUrl, projectId: projectA,
  upscaleModel: '302-esrgan', scale: 2 };
let releaseTransport: (() => void) | undefined;
let transportStarted: Promise<void>;

function makeRequest(payload: Record<string, unknown>, key: string, actor = 'identity-owner'): NextRequest {
  return new NextRequest('http://localhost/api/image-edit', { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key,
      'x-test-actor': actor }, body: JSON.stringify(payload) });
}

async function seed(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  const database = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
    || !/^test_task_8cb3j4[bd]_/.test(schemaName)
    || !database.searchParams.get('options')?.includes(`search_path=${schemaName}`)) throw new Error('Isolated schema required');
  const started = new Date().toISOString();
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', timeout: 45_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  const prefix = resolve('.superpowers/sdd/2026-09-25-v588-yjs-canvas-collaboration', `task-8cb3j4d-migration-${schemaName}`);
  const hashes = ['src/app/api/image-edit/route.ts', 'src/lib/task-core/terminal-settlement.ts',
    'src/__tests__/api/provider-terminal-settlement-contract.test.ts', 'tests/integration/image-edit-302-identity-postgres.test.ts']
    .map(path => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(path))).digest('hex') }));
  writeFileSync(`${prefix}.stdout.log`, migration.stdout || '', { flag: 'wx' });
  writeFileSync(`${prefix}.stderr.log`, migration.stderr || '', { flag: 'wx' });
  writeFileSync(`${prefix}.json`, JSON.stringify({ command: 'node scripts/run-migrations.mjs', started,
    ended: new Date().toISOString(), exit: migration.status, before: hashes, after: hashes,
    error: String(migration.error || '') }), { flag: 'wx' });
  expect(migration.status, `Migration fixture: ${prefix}`).toBe(0);
  await ensureCoreTables();
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('identity-owner','Owner','test','active','user',1,1), ('identity-other','Other','test','active','user',1,1)`);
  await query(`INSERT INTO wujie_projects(id,owner_id,name) VALUES
    ($1,'identity-owner','A'), ($2,'identity-owner','B'), ('identity-foreign','identity-other','Foreign')`, [projectA, projectB]);
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    VALUES ('identity-credit','identity-owner',100,100,0,1,1)`);
  // Configure actual SQL-backed pricing; neither cost calculation nor billing is mocked.
  await query(`INSERT INTO wujie_system_settings(key,value,updated_at) VALUES
    ('credit_pricing_config',$1,1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
  [JSON.stringify({ modelCredits: { '302-esrgan': 7 } })]);
}

async function readTaskAndLedger(query: QueryFn, taskId: string): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {
    original: (await query('SELECT * FROM cloud_tasks WHERE id=$1', [taskId])).rows,
  };
  for (const table of ['cloud_tasks', 'wujie_credits', 'wujie_credit_transactions']) {
    snapshot[table] = (await query(`SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`)).rows;
  }
  return snapshot;
}

async function waitForSubmission(pending: ReturnType<typeof POST>): Promise<void> {
  await Promise.race([transportStarted, pending.then(async response => {
    throw new Error(`First POST did not reach transport: ${response.status} ${JSON.stringify(await response.clone().json())}`);
  })]);
}

async function assertConflict(query: QueryFn, taskId: string, payload: Record<string, unknown>, key: string): Promise<void> {
  const before = await readTaskAndLedger(query, taskId);
  const sends = sentRequests.length;
  const response = await POST(makeRequest(payload, key));
  expect.soft(response.status, JSON.stringify(payload)).toBe(409);
  expect.soft(await response.json()).toMatchObject({ success: false, code: 'IDEMPOTENCY_CONFLICT' });
  expect(await readTaskAndLedger(query, taskId)).toEqual(before);
  expect(sentRequests).toHaveLength(sends);
}

async function assertOriginalReplay(query: QueryFn, taskId: string, payload: Record<string, unknown>, key: string): Promise<void> {
  const before = await readTaskAndLedger(query, taskId);
  const sends = sentRequests.length;
  const reads = boundary.media.mock.calls.length;
  const response = await POST(makeRequest(payload, key));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, reused: true, taskId });
  expect(await readTaskAndLedger(query, taskId)).toEqual(before);
  expect(sentRequests).toHaveLength(sends);
  expect(boundary.media).toHaveBeenCalledTimes(reads);
}

beforeEach(async (): Promise<void> => {
  sentRequests.length = 0;
  boundary.config.mockResolvedValue([{ id: 'identity-native', name: '302 offline', type: 'upscaler', modelType: 'upscaler',
    isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-identity', selectedModels: ['302-esrgan'],
    createdAt: 1, updatedAt: 1 }]);
  const source = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#345678' } }).png().toBuffer();
  const output = await sharp(source).resize(64, 64).png().toBuffer();
  boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
    if (url === sourceUrl || url === 'https://media.invalid/identity-source-alternate.png') return source;
    if (url === outputUrl) return output;
    throw new Error(`Undeclared image read: ${url}`);
  });
  let started: () => void = (): void => {};
  transportStarted = new Promise<void>(done => { started = done; });
  const gate = new Promise<void>(done => { releaseTransport = done; });
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const actual = input instanceof Request ? input : new Request(input, init);
    const url = actual.url;
    if (url !== 'https://api.302.ai/302/submit/esrgan' || actual.method !== 'POST') throw new Error(`Undeclared network: ${url}`);
    expect(actual.headers.get('authorization')).toBe('Bearer offline-identity');
    const payload = JSON.parse(await actual.clone().text()) as Record<string, unknown>;
    expect(payload).toEqual({ image_url: sourceUrl, upscale_factor: 2 });
    sentRequests.push({ url, body: payload });
    started();
    await gate;
    return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
  });
});
afterEach((): void => { releaseTransport?.(); vi.unstubAllGlobals(); });

function cancelRequest(taskId: string, actor = 'identity-owner'): NextRequest {
  return new NextRequest('http://localhost/api/cancel-task', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'task-8cb3j4d-cancel', 'x-test-actor': actor },
    body: JSON.stringify({ taskId }) });
}

async function readProjections(query: QueryFn): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {};
  for (const table of ['wujie_assets', 'wujie_asset_versions', 'wujie_asset_version_parents', 'wujie_workspace_placements']) {
    snapshot[table] = (await query(`SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`)).rows;
  }
  return snapshot;
}

async function assertLateConflict(pending: ReturnType<typeof POST>, taskId: string, status = 'cancelled'): Promise<void> {
  releaseTransport?.();
  const response = await pending;
  expect.soft(response.status).toBe(409);
  const payload = await response.clone().json();
  expect.soft(payload).toEqual({ success: false, code: 'TASK_TERMINAL_CONFLICT', taskId, status });
  expect(payload).not.toHaveProperty('imageUrl');
}

describe('302 atomic terminal barrier', (): void => {
  it.each(['status', 'refund'] as const)('rolls back a real cancellation on %s write failure and permits retry', async (fault): Promise<void> => {
    await withIsolatedPostgres(`task-8cb3j4d-${fault}-fault`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const pending = POST(makeRequest(body, 'cancel-atomic'));
      try {
        await waitForSubmission(pending);
        const taskId = String((await query('SELECT id FROM cloud_tasks')).rows[0].id);
        const before = await readTaskAndLedger(query, taskId);
        const projections = await readProjections(query);
        const faultTable = fault === 'status' ? 'cloud_tasks' : 'wujie_credit_transactions';
        const predicate = fault === 'status' ? "NEW.status = 'cancelled'" : "NEW.type = 'refund'";
        await query(`CREATE FUNCTION reject_cancel() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF ${predicate} THEN RAISE EXCEPTION 'j4d ${fault} write fault'; END IF;
          RETURN NEW; END $$`);
        await query(`CREATE TRIGGER reject_cancel BEFORE ${fault === 'status' ? 'UPDATE' : 'INSERT'}
          ON ${faultTable} FOR EACH ROW EXECUTE FUNCTION reject_cancel()`);
        const errors = vi.spyOn(console, 'error'); // Call through: retain the original fault evidence.
        let cancelled: Awaited<ReturnType<typeof cancelPost>>;
        try {
          cancelled = await cancelPost(cancelRequest(taskId));
          expect.soft(errors.mock.calls).toEqual([
            [{ code: 'DB_SQL_QUERY_FAILED' }],
            ['[cancel-task] Error:', { requestId: 'task-8cb3j4d-cancel', source: 'wujie', errorName: 'error' }],
          ]);
        } finally { errors.mockRestore(); }
        expect.soft(cancelled.status).toBe(500);
        expect.soft(await cancelled.json()).toMatchObject({ success: false, code: 'TASK_CANCEL_FAILED' });
        expect.soft(await readTaskAndLedger(query, taskId)).toEqual(before);
        expect(isTaskCancelled(taskId)).toBe(false);
        expect(await readProjections(query)).toEqual(projections);
        // Remove only this test's injected trigger; then exercise the real retry.
        await query(`DROP TRIGGER reject_cancel ON ${faultTable}`);
        expect((await cancelPost(cancelRequest(taskId))).status).toBe(200);
        expect(isTaskCancelled(taskId)).toBe(true);
        expect((await query('SELECT status, credit_status FROM cloud_tasks')).rows)
          .toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
        expect((await query('SELECT type, amount::int FROM wujie_credit_transactions ORDER BY amount')).rows)
          .toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
        expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(100);
        const afterRetry = await readTaskAndLedger(query, taskId);
        await assertLateConflict(pending, taskId);
        expect(await readTaskAndLedger(query, taskId)).toEqual(afterRetry);
        expect(await readProjections(query)).toEqual(projections);
        expect(sentRequests).toHaveLength(1);
      } finally {
        releaseTransport?.();
        await pending;
      }
    });
  }, 60_000);

  it('does not return an uncommitted late image after successful cancellation', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4d-late', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const pending = POST(makeRequest(body, 'cancel-late'));
      try {
        await waitForSubmission(pending);
        const taskId = String((await query('SELECT id FROM cloud_tasks')).rows[0].id);
        expect((await cancelPost(cancelRequest(taskId))).status).toBe(200);
        const before = await readTaskAndLedger(query, taskId);
        const projections = await readProjections(query);
        releaseTransport?.();
        const response = await pending;
        expect.soft(response.status).toBe(409);
        const payload = await response.json();
        expect.soft(payload).toEqual({ success: false, code: 'TASK_TERMINAL_CONFLICT', taskId, status: 'cancelled' });
        expect.soft(payload).not.toHaveProperty('imageUrl');
        expect(await readTaskAndLedger(query, taskId)).toEqual(before);
        expect((await query('SELECT status, credit_status FROM cloud_tasks')).rows)
          .toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
        expect(await readProjections(query)).toEqual(projections);
        expect((await query('SELECT type, amount::int FROM wujie_credit_transactions ORDER BY amount')).rows)
          .toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
        expect(sentRequests).toHaveLength(1);
      } finally {
        releaseTransport?.();
        await pending;
      }
    });
  }, 60_000);

  it('concurrent and repeated real cancellations refund once and never publish the late result', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4d-repeat', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const pending = POST(makeRequest(body, 'cancel-repeat'));
      try {
        await waitForSubmission(pending);
        const taskId = String((await query('SELECT id FROM cloud_tasks')).rows[0].id);
        const projections = await readProjections(query);
        const responses = await Promise.all(Array.from({ length: 5 }, (): ReturnType<typeof cancelPost> => cancelPost(cancelRequest(taskId))));
        expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200]);
        for (const response of responses) expect(await response.json()).toMatchObject({ success: true });
        expect((await cancelPost(cancelRequest(taskId))).status).toBe(200);
        expect((await query('SELECT type, amount::int FROM wujie_credit_transactions ORDER BY amount')).rows)
          .toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
        expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(100);
        const beforeLate = await readTaskAndLedger(query, taskId);
        await assertLateConflict(pending, taskId);
        expect(await readTaskAndLedger(query, taskId)).toEqual(beforeLate);
        expect(await readProjections(query)).toEqual(projections);
        expect(sentRequests).toHaveLength(1);
      } finally { releaseTransport?.(); await pending; }
    });
  }, 60_000);

  it('completion wins: cancellation returns 409 without changing the committed result, projection or ledger', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4d-completed', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      releaseTransport?.();
      const response = await POST(makeRequest(body, 'complete-wins'));
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({ success: true, imageUrl: expect.any(String) });
      const task = (await query('SELECT * FROM cloud_tasks')).rows[0];
      const taskId = String(task.id);
      expect(task).toMatchObject({ status: 'completed', credit_status: 'charged', result: { imageUrl: payload.imageUrl } });
      const before = await readTaskAndLedger(query, taskId);
      const projections = await readProjections(query);
      expect(projections.wujie_asset_versions).toHaveLength(1);
      const cancelled = await cancelPost(cancelRequest(taskId));
      expect(cancelled.status).toBe(409);
      expect(await cancelled.json()).toMatchObject({ success: false, status: 'completed' });
      expect(await readTaskAndLedger(query, taskId)).toEqual(before);
      expect(await readProjections(query)).toEqual(projections);
      expect(isTaskCancelled(taskId)).toBe(false);
      expect((await query('SELECT type, amount::int FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }]);
      expect(sentRequests).toHaveLength(1);
    });
  }, 60_000);

  it('a different SQL-backed actor cannot cancel the in-flight task', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4d-actor', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const pending = POST(makeRequest(body, 'cancel-actor'));
      try {
        await waitForSubmission(pending);
        const taskId = String((await query('SELECT id FROM cloud_tasks')).rows[0].id);
        const before = await readTaskAndLedger(query, taskId);
        const response = await cancelPost(cancelRequest(taskId, 'identity-other'));
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ success: false });
        expect(await readTaskAndLedger(query, taskId)).toEqual(before);
        expect(isTaskCancelled(taskId)).toBe(false);
        releaseTransport?.();
        expect((await pending).status).toBe(200);
        expect((await query('SELECT type, amount::int FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }]);
      } finally { releaseTransport?.(); await pending; }
    });
  }, 60_000);

  it.each(['cancelled', 'completed'] as const)('configured free %s task has zero consume and refund rows', async (status): Promise<void> => {
    await withIsolatedPostgres(`task-8cb3j4d-free-${status}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'", [JSON.stringify({ modelCredits: { '302-esrgan': 0 } })]);
      const pending = POST(makeRequest(body, 'free'));
      try {
        await waitForSubmission(pending);
        const task = (await query('SELECT * FROM cloud_tasks')).rows[0];
        const taskId = String(task.id);
        expect(Number(task.credit_cost)).toBe(0);
        expect(task.credit_status).toBe('not-applicable');
        if (status === 'cancelled') {
          expect((await cancelPost(cancelRequest(taskId))).status).toBe(200);
          await assertLateConflict(pending, taskId);
          expect((await query('SELECT * FROM wujie_asset_versions')).rows).toEqual([]);
        } else {
          releaseTransport?.();
          expect((await pending).status).toBe(200);
          expect((await cancelPost(cancelRequest(taskId))).status).toBe(409);
        }
        expect((await query('SELECT status, credit_status FROM cloud_tasks')).rows).toEqual([{ status, credit_status: 'not-applicable' }]);
        expect((await query('SELECT * FROM wujie_credit_transactions')).rows).toEqual([]);
        expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(100);
      } finally { releaseTransport?.(); await pending; }
    });
  }, 60_000);

  it('ignores client-supplied admission markers and persists only the server marker', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4d-forged', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const forged = { version: 99, route: '/api/forged', kind: 'forged', requestDigest: 'b'.repeat(64), extra: 'client' };
      const pending = POST(makeRequest({ ...body, imageEditAdmission: forged, result: { imageEditAdmission: forged } }, 'forged'));
      try {
        await waitForSubmission(pending);
        const task = (await query('SELECT * FROM cloud_tasks')).rows[0];
        // Independent literal: fixture actor, input, selected pair and measured dimensions.
        expect(task.request_digest).toBe('25aaa6b2f0323fdbe06b8a3e6cd67edba4e90eaa430b161c403b231493ebd842');
        expect(task.result.imageEditAdmission).toEqual({ version: 1, route: '/api/image-edit', kind: 'requested-302-upscale',
          requestDigest: '25aaa6b2f0323fdbe06b8a3e6cd67edba4e90eaa430b161c403b231493ebd842',
          inputIdentityDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
        const before = await readTaskAndLedger(query, String(task.id));
        const replay = await POST(makeRequest(body, 'forged'));
        expect(replay.status).toBe(200);
        expect(await replay.json()).toMatchObject({ success: true, reused: true, taskId: task.id });
        expect(await readTaskAndLedger(query, String(task.id))).toEqual(before);
        expect(sentRequests).toHaveLength(1);
      } finally { releaseTransport?.(); await pending; }
    });
  }, 60_000);
});

describe('real POST + PostgreSQL 302 request identity', (): void => {
  it('exact read-only recovery returns only the owned confirmed quote task', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-exact-recover', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const taskKey = 'k'.repeat(256);
      const preview = await (await POST(makeRequest({ ...body, quoteOnly: true }, 'recover-preview'))).json();
      const pending = POST(makeRequest({ ...body, quoteToken: preview.quote.token }, taskKey));
      const recover = (projectId: string, key: string, actor = 'identity-owner'): NextRequest =>
        new NextRequest(`http://localhost/api/tasks/recover?projectId=${encodeURIComponent(projectId)}&idempotencyKey=${encodeURIComponent(key)}`,
          { headers: { 'x-test-actor': actor } });
      try {
        await waitForSubmission(pending);
        const taskId = String((await query('SELECT id FROM cloud_tasks')).rows[0].id);
        await query(`INSERT INTO cloud_tasks(id,user_id,project_id,type,status,idempotency_key,result,created_at,updated_at)
          VALUES ('recover-other-kind','identity-owner',$1,'generate','processing','recover-other-kind',$2,1,1),
            ('recover-unquoted','identity-owner',$1,'upscale','processing','recover-unquoted',$3,1,1)`,
        [projectA, JSON.stringify({ imageEditAdmission: { route: '/api/image-edit', kind: 'requested-302-upscale' },
          imageEditQuote: { confirmed: true, total: 7, upscale: 7, enhance: 0 } }),
        JSON.stringify({ imageEditAdmission: { route: '/api/image-edit', kind: 'requested-302-upscale' },
          imageEditQuote: { total: 7, upscale: 7, enhance: 0 } })]);
        const before = await readTaskAndLedger(query, taskId);
        const sends = sentRequests.length;
        const own = await recoverGet(recover(projectA, taskKey));
        expect(own.status).toBe(200);
        expect(own.headers.get('Cache-Control')).toBe('no-store');
        expect(await own.json()).toEqual({ success: true, found: true, taskId,
          status: 'processing', quote: { total: 7, components: { upscale: 7, enhance: 0 } } });
        expect((await recoverGet(recover(projectA, `${taskKey}x`))).status).toBe(400);
        for (const [projectId, key, actor] of [
          [projectA, taskKey, 'identity-other'],
          [projectB, taskKey, 'identity-owner'],
          [projectA, 'different-key', 'identity-owner'],
          [projectA, 'recover-other-kind', 'identity-owner'],
          [projectA, 'recover-unquoted', 'identity-owner'],
        ]) {
          const response = await recoverGet(recover(projectId, key, actor));
          expect(response.status).toBe(200);
          expect(response.headers.get('Cache-Control')).toBe('no-store');
          expect(await response.json()).toEqual({ success: true, found: false });
        }
        expect(await readTaskAndLedger(query, taskId)).toEqual(before);
        expect(sentRequests).toHaveLength(sends);
      } finally { releaseTransport?.(); await pending; }
    });
  }, 60_000);

  it('previews a 7+4 composite service and rejects 70+40 repricing before billing', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-quote-composite', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const providers = await boundary.config();
      boundary.config.mockResolvedValue([...providers, { id: 'enhance', name: 'Offline enhancement',
        type: 'image', modelType: 'image', isEnabled: true, baseUrl: 'https://enhance.invalid/v1',
        apiKey: 'offline-enhance', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
      await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
        [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'enhance::gpt-image-1': 4 } })]);
      const requestBody = { ...body, enableQualityEnhance: true, enhanceModel: 'enhance::gpt-image-1' };
      const response = await POST(makeRequest({ ...requestBody, quoteOnly: true }, 'composite-preview'));
      expect(response.status).toBe(200);
      const preview = await response.json();
      expect(preview).toMatchObject({ success: true, quote: { total: 11,
        components: { upscale: 7, enhance: 4 },
        targets: [{ phase: 'upscale', providerId: 'identity-native', modelId: '302-esrgan' },
          { phase: 'enhance', providerId: 'enhance', modelId: 'gpt-image-1' }] } });
      await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
        [JSON.stringify({ modelCredits: { '302-esrgan': 70, 'enhance::gpt-image-1': 40 } })]);
      const stale = await POST(makeRequest({ ...requestBody, quoteToken: preview.quote.token }, 'composite-submit'));
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_QUOTE_CHANGED' });
      expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
      expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
      expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(100);
      expect(sentRequests).toHaveLength(0);
    });
  }, 60_000);

  it.each(['forged', 'expired', 'cross-user'] as const)
    ('rejects %s quote identity before any task, charge or provider request', async (caseName): Promise<void> => {
      await withIsolatedPostgres(`task-8cb3j4b-quote-${caseName}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
        await seed(query, databaseUrl, schemaName);
        const requestBody = { ...body, projectId: undefined };
        const previewResponse = await POST(makeRequest({ ...requestBody, quoteOnly: true }, 'security-preview'));
        expect(previewResponse.status).toBe(200);
        const preview = await previewResponse.json();
        let token = preview.quote.token as string;
        let actor = 'identity-owner';
        let clock: ReturnType<typeof vi.spyOn> | undefined;
        if (caseName === 'forged') {
          const [payload, signature] = token.split('.');
          token = `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
        } else if (caseName === 'expired') {
          const expiredAt = Date.now() + 5 * 60_000 + 1;
          clock = vi.spyOn(Date, 'now').mockReturnValue(expiredAt);
        } else {
          actor = 'identity-other';
        }
        try {
          const response = await POST(makeRequest({ ...requestBody, quoteToken: token },
            'security-submit', actor));
          expect(response.status).toBe(409);
          expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_QUOTE_CHANGED' });
        } finally {
          clock?.mockRestore();
        }
        expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
        expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
        expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(100);
        expect(sentRequests).toHaveLength(0);
      });
    }, 60_000);

  it('keeps preview read-only, rejects repricing, and replays the confirmed original quote once', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-quote', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const previewResponse = await POST(makeRequest({ ...body, quoteOnly: true }, 'preview-quote'));
      expect(previewResponse.status).toBe(200);
      const preview = await previewResponse.json();
      expect(preview).toMatchObject({ success: true, quote: { total: 7,
        components: { upscale: 7, enhance: 0 }, token: expect.any(String) } });
      expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
      expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
      expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(100);
      expect(sentRequests).toHaveLength(0);

      await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
        [JSON.stringify({ modelCredits: { '302-esrgan': 70 } })]);
      const stale = await POST(makeRequest({ ...body, quoteToken: preview.quote.token }, 'confirmed-quote'));
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_QUOTE_CHANGED' });
      expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
      expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
      expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(100);
      expect(sentRequests).toHaveLength(0);

      await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
        [JSON.stringify({ modelCredits: { '302-esrgan': 7 } })]);
      const refreshed = await (await POST(makeRequest({ ...body, quoteOnly: true }, 'preview-quote'))).json();
      const submitted = POST(makeRequest({ ...body, quoteToken: refreshed.quote.token }, 'confirmed-quote'));
      try {
        await waitForSubmission(submitted);
        const tasks = (await query('SELECT id, credit_cost, result FROM cloud_tasks')).rows;
        expect(tasks).toHaveLength(1);
        expect(Number(tasks[0].credit_cost)).toBe(7);
        expect(tasks[0].result.imageEditQuote).toMatchObject({ confirmed: true, total: 7,
          upscale: 7, enhance: 0 });
        expect((await query('SELECT type, amount::int FROM wujie_credit_transactions')).rows)
          .toEqual([{ type: 'consume', amount: -7 }]);
        expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(93);
        expect(sentRequests).toHaveLength(1);
      } finally {
        releaseTransport?.();
      }
      const completed = await submitted;
      expect(completed.status).toBe(200);
      await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
        [JSON.stringify({ modelCredits: { '302-esrgan': 70 } })]);
      const replay = await POST(makeRequest(body, 'confirmed-quote'));
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ success: true, reused: true,
        quote: { total: 7, components: { upscale: 7, enhance: 0 } } });
      expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(1);
      expect((await query('SELECT type, amount::int FROM wujie_credit_transactions')).rows)
        .toEqual([{ type: 'consume', amount: -7 }]);
      expect(sentRequests).toHaveLength(1);
    });
  }, 60_000);

  it('rejects same key switched between two owned projects without task or ledger mutation', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-project-red', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const first = POST(makeRequest(body, 'project-key'));
      try {
        await waitForSubmission(first);
        const tasks = await query('SELECT * FROM cloud_tasks');
        expect(tasks.rows).toHaveLength(1);
        const firstTaskId = tasks.rows[0].id as string;
        expect(tasks.rows[0]).toMatchObject({ status: 'processing', credit_status: 'pending' });
        expect(Number(tasks.rows[0].credit_cost)).toBe(7);
        expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(93);
        const beforeReplay = await readTaskAndLedger(query, firstTaskId);
        const second = await POST(makeRequest({ ...body, projectId: projectB }, 'project-key'));
        expect.soft(second.status).toBe(409);
        expect.soft(await second.json()).toMatchObject({ success: false, code: 'IDEMPOTENCY_CONFLICT' });
        expect(await readTaskAndLedger(query, firstTaskId)).toEqual(beforeReplay);
        expect(sentRequests).toHaveLength(1);
      } finally {
        releaseTransport?.();
        expect((await first).status).toBe(200);
      }
    });
  }, 60_000);

  it.each(['processing', 'completed', 'failed', 'cancelled', 'timeout'] as const)
    ('preserves %s task/result/revision, balance and every ledger row across changed inputs and identical replay', async (status): Promise<void> => {
      await withIsolatedPostgres(`task-8cb3j4b-${status}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
        await seed(query, databaseUrl, schemaName);
        const requestBody = { ...body, sessionId: 'session-a', messageId: 'message-a',
          assetParentVersionIds: ['parent-a', 'parent-b'], assetProjectionMode: 'derived' };
        const first = POST(makeRequest(requestBody, 'matrix-key'));
        try {
          await waitForSubmission(first);
          const taskId = (await query('SELECT id FROM cloud_tasks')).rows[0].id as string;
          if (status === 'completed') {
            releaseTransport?.();
            expect((await first).status).toBe(200);
          } else if (status !== 'processing') {
            expect(await settleFailedTask({ taskId, status, error: { code: 'TEST_TERMINAL', message: status } }))
              .toMatchObject({ transitioned: true, refunded: true });
          }
          const persisted = (await query('SELECT status, result, revision, credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows[0];
          expect(persisted.status).toBe(status);
          expect(persisted.credit_status).toBe(status === 'processing' ? 'pending' : status === 'completed' ? 'charged' : 'refunded');
          const changes: Array<Record<string, unknown>> = [
            { projectId: projectB }, { sessionId: 'session-b' }, { messageId: 'message-b' },
            { imageUrl: 'https://media.invalid/identity-source-alternate.png' },
            { assetParentVersionIds: ['parent-a', 'parent-c'] }, { assetParentVersionIds: ['parent-b', 'parent-a'] },
            { assetProjectionMode: 'revision' }, { prompt: 'preserve texture' }, { maskImage: 'mask-input' },
            { editMode: 'mask' }, { expandRatio: '4:3' }, { expandScale: 2 },
            { expandPadding: { top: 1, right: 0, bottom: 0, left: 0 } },
            { targetWidth: 96, targetHeight: 96 }, { targetPreset: '4k' }, { aspectRatio: '4:3' },
            { angleMode: 'camera' }, { rotation: 30 }, { tilt: 5 }, { zoom: 2 },
            { originalWidth: 999 }, { originalHeight: 888 }, { scale: 3 },
            { model: '302-esrgan' }, { providerId: 'identity-native' }, { upscaleModel: 'esrgan' },
            { eraseModel: 'lama' }, { removeBgModel: 'u2net' }, { originalPrompt: 'source texture' },
            { upscaleMode: 'ai-only' }, { outputFormat: 'webp' }, { compression: 75 },
            { engine: 'ai-only' }, { displayBackground: 'transparent' },
          ];
          for (const change of changes) await assertConflict(query, taskId, { ...requestBody, ...change }, 'matrix-key');
          const before = await readTaskAndLedger(query, taskId);
          const replay = await POST(makeRequest(requestBody, 'matrix-key'));
          const success = status === 'processing' || status === 'completed';
          expect(replay.status).toBe(success ? 200 : 409);
          expect(await replay.json()).toMatchObject({ success, reused: true, taskId,
            ...(status === 'completed' ? { imageUrl: (persisted.result as { imageUrl: string }).imageUrl } : { status }) });
          expect(await readTaskAndLedger(query, taskId)).toEqual(before);
          expect(sentRequests).toHaveLength(1);
          const ledger = (await query('SELECT type, amount::int FROM wujie_credit_transactions ORDER BY amount')).rows;
          expect(ledger).toEqual(success ? [{ type: 'consume', amount: -7 }]
            : [{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
        } finally {
          releaseTransport?.();
          const initialResponse = await first;
          if (status === 'failed' || status === 'cancelled' || status === 'timeout') {
            expect(initialResponse.status).toBe(409);
            const initialPayload = await initialResponse.json();
            expect(initialPayload).toMatchObject({ success: false, code: 'TASK_TERMINAL_CONFLICT', status });
            expect(initialPayload).not.toHaveProperty('imageUrl');
          } else {
            expect(initialResponse.status).toBe(200);
          }
        }
      });
    }, 60_000);

  it('replays the original task when catalog or current URL bytes change but the request stays identical', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-actual', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const providers = await boundary.config();
      const source = await boundary.media(sourceUrl);
      const output = await boundary.media(outputUrl);
      const first = POST(makeRequest(body, 'actual-key'));
      try {
        await waitForSubmission(first);
        const taskId = (await query('SELECT id FROM cloud_tasks')).rows[0].id as string;
        boundary.config.mockResolvedValue([{ ...providers[0], id: 'different-native' }]);
        await assertOriginalReplay(query, taskId, body, 'actual-key');
        boundary.config.mockResolvedValue([{ ...providers[0], selectedModels: ['302-super-upscale-v2'] }]);
        await assertOriginalReplay(query, taskId, body, 'actual-key');
        boundary.config.mockResolvedValue(providers);
        for (const [width, height] of [[48, 32], [32, 48]]) {
          const resized = await sharp(source).resize(width, height).png().toBuffer();
          boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
            if (url === sourceUrl) return resized;
            if (url === outputUrl) return output;
            throw new Error(`Undeclared image read: ${url}`);
          });
          await assertOriginalReplay(query, taskId, body, 'actual-key');
        }
      } finally { releaseTransport?.(); expect((await first).status).toBe(200); }
    });
  }, 60_000);

  it('concurrent identical POSTs admit one task/consume/send; a new key admits a second task', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-concurrent', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      releaseTransport?.();
      const responses = await Promise.all(Array.from({ length: 5 }, (): ReturnType<typeof POST> => POST(makeRequest(body, 'concurrent-key'))));
      expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200]);
      const results = await Promise.all(responses.map(response => response.json()));
      const tasks = (await query('SELECT id FROM cloud_tasks')).rows;
      expect(tasks).toHaveLength(1);
      expect(results.filter(result => result.reused)).toHaveLength(4);
      for (const result of results.filter(result => result.reused)) expect(result.taskId).toBe(tasks[0].id);
      expect(sentRequests).toHaveLength(1);
      expect((await query('SELECT type, amount::int FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }]);
      const beforeIgnoredFields = await readTaskAndLedger(query, tasks[0].id as string);
      const ignoredFields = await POST(makeRequest({ ...body, apiKey: 'must-not-enter-identity', role: 'admin',
        prepaid: true, taskEntryAudit: { actualProviderId: 'forged' } }, 'concurrent-key'));
      expect(ignoredFields.status).toBe(200);
      expect(await ignoredFields.json()).toMatchObject({ success: true, reused: true, taskId: tasks[0].id });
      expect(await readTaskAndLedger(query, tasks[0].id as string)).toEqual(beforeIgnoredFields);
      expect(sentRequests).toHaveLength(1);
      const next = await POST(makeRequest(body, 'different-key'));
      expect(next.status).toBe(200);
      expect((await next.json()).success).toBe(true);
      expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(2);
      expect((await query('SELECT type, amount::int FROM wujie_credit_transactions')).rows)
        .toEqual([{ type: 'consume', amount: -7 }, { type: 'consume', amount: -7 }]);
      expect(Number((await query('SELECT balance FROM wujie_credits')).rows[0].balance)).toBe(86);
      expect(sentRequests).toHaveLength(2);
    });
  }, 60_000);

  it('different keys while original 302 attempt is active cannot charge or send twice', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-active-different-keys', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const preview = await (await POST(makeRequest({ ...body, quoteOnly: true }, 'active-preview'))).json();
      const quotedBody = { ...body, quoteToken: preview.quote.token };
      const first = POST(makeRequest(quotedBody, 'active-first'));
      let second: ReturnType<typeof POST> | undefined;
      try {
        await waitForSubmission(first);
        const original = (await query('SELECT id FROM cloud_tasks')).rows[0].id as string;
        second = POST(makeRequest(quotedBody, 'active-second'));
        await Promise.race([second.then((): void => {}), new Promise<void>(resolve => setTimeout(resolve, 1_500))]);
        expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(1);
        expect((await query('SELECT amount::int FROM wujie_credit_transactions')).rows).toEqual([{ amount: -7 }]);
        expect(sentRequests).toHaveLength(1);
        releaseTransport?.();
        const duplicate = await second;
        expect(duplicate.status).toBe(409);
        const duplicatePayload = await duplicate.json();
        expect(duplicatePayload).toMatchObject({ success: false, code: 'IMAGE_EDIT_ACTIVE_ATTEMPT',
          taskId: original, idempotencyKey: 'active-first' });
        expect(duplicatePayload).not.toHaveProperty('imageUrl');
        expect(duplicatePayload).not.toHaveProperty('quoteToken');
      } finally {
        releaseTransport?.();
        await first;
        if (second) await second;
      }
      const next = await POST(makeRequest(quotedBody, 'active-third'));
      expect(next.status).toBe(200);
      expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(2);
      expect(sentRequests).toHaveLength(2);
    });
  }, 60_000);

  it('simultaneous different-key first admissions serialize before the first charge commits', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-first-admission-race', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const preview = await (await POST(makeRequest({ ...body, quoteOnly: true }, 'race-preview'))).json();
      const quotedBody = { ...body, quoteToken: preview.quote.token };
      const blocker = await getPool().connect();
      let first: ReturnType<typeof POST> | undefined;
      let second: ReturnType<typeof POST> | undefined;
      let blockingTransactionOpen = false;
      try {
        await blocker.query('BEGIN');
        blockingTransactionOpen = true;
        await blocker.query("SELECT balance FROM wujie_credits WHERE user_id = 'identity-owner' FOR UPDATE");
        const blockerPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        first = POST(makeRequest(quotedBody, 'race-first'));
        const deadline = Date.now() + 15_000;
        let firstPid = 0;
        while (!firstPid && Date.now() < deadline) {
          const waiting = await query(`SELECT pid, query FROM pg_stat_activity
            WHERE $1 = ANY(pg_blocking_pids(pid)) AND pid <> $1`, [blockerPid]);
          const candidate = waiting.rows.find(row => String(row.query).includes('wujie_credits'));
          firstPid = Number(candidate?.pid || 0);
          if (!firstPid) await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(firstPid, 'first admission must reach the pre-commit credit row lock').toBeGreaterThan(0);
        second = POST(makeRequest(quotedBody, 'race-second'));
        let secondPid = 0;
        while (!secondPid && Date.now() < deadline) {
          const waiting = await query(`SELECT pid FROM pg_stat_activity
            WHERE pid NOT IN ($1,$2) AND ($1 = ANY(pg_blocking_pids(pid))
              OR $2 = ANY(pg_blocking_pids(pid)))`, [blockerPid, firstPid]);
          secondPid = Number(waiting.rows[0]?.pid || 0);
          if (!secondPid) await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(secondPid, 'second admission must reach a real transaction lock before first commit').toBeGreaterThan(0);
        expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
        expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
        expect(sentRequests).toHaveLength(0);
        await blocker.query('COMMIT');
        blockingTransactionOpen = false;
        await waitForSubmission(first);
        let secondFinished = false;
        void second.then(() => { secondFinished = true; }, () => { secondFinished = true; });
        const outcomeDeadline = Date.now() + 5_000;
        while (!secondFinished && sentRequests.length < 2 && Date.now() < outcomeDeadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(secondFinished || sentRequests.length >= 2,
          'second admission must settle or reach transport while first provider is held').toBe(true);
        expect(sentRequests).toHaveLength(1);
        const rejected = await second;
        expect(rejected.status).toBe(409);
        expect(await rejected.json()).toMatchObject({ code: 'IMAGE_EDIT_ACTIVE_ATTEMPT',
          idempotencyKey: 'race-first' });
        expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(1);
        expect((await query('SELECT amount::int FROM wujie_credit_transactions')).rows)
          .toEqual([{ amount: -7 }]);
        expect(sentRequests).toHaveLength(1);
      } finally {
        if (blockingTransactionOpen) await blocker.query('ROLLBACK');
        blocker.release();
        releaseTransport?.();
        await Promise.allSettled([first, second].filter(Boolean));
      }
    });
  }, 60_000);

  it('keeps different request, project and actor attempts independent while one 302 task is active', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-active-controls', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        VALUES ('identity-other-credit','identity-other',100,100,0,1,1)`);
      const unscoped = { ...body, projectId: undefined };
      const variants = [
        { payload: unscoped, actor: 'identity-owner', key: 'control-original' },
        { payload: { ...unscoped, prompt: 'different intent' }, actor: 'identity-owner', key: 'control-prompt' },
        { payload: { ...unscoped, projectId: projectB }, actor: 'identity-owner', key: 'control-project' },
        { payload: unscoped, actor: 'identity-other', key: 'control-actor' },
      ];
      const quoted = await Promise.all(variants.map(async variant => {
        const response = await POST(makeRequest({ ...variant.payload, quoteOnly: true },
          `${variant.key}-preview`, variant.actor));
        expect(response.status).toBe(200);
        const preview = await response.json();
        return { ...variant, payload: { ...variant.payload, quoteToken: preview.quote.token } };
      }));
      const first = POST(makeRequest(quoted[0].payload, quoted[0].key, quoted[0].actor));
      const others: Array<ReturnType<typeof POST>> = [];
      let responses: Awaited<ReturnType<typeof POST>>[] = [];
      try {
        await waitForSubmission(first);
        for (const variant of quoted.slice(1)) {
          others.push(POST(makeRequest(variant.payload, variant.key, variant.actor)));
        }
        const deadline = Date.now() + 10_000;
        while (sentRequests.length < 4 && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(sentRequests).toHaveLength(4);
        const tasks = (await query('SELECT user_id, project_id, idempotency_key FROM cloud_tasks ORDER BY idempotency_key')).rows;
        expect(tasks).toEqual([
          { user_id: 'identity-other', project_id: '', idempotency_key: 'control-actor' },
          { user_id: 'identity-owner', project_id: '', idempotency_key: 'control-original' },
          { user_id: 'identity-owner', project_id: projectB, idempotency_key: 'control-project' },
          { user_id: 'identity-owner', project_id: '', idempotency_key: 'control-prompt' },
        ]);
        expect((await query('SELECT type, amount::int FROM wujie_credit_transactions')).rows)
          .toEqual(Array.from({ length: 4 }, () => ({ type: 'consume', amount: -7 })));
      } finally {
        releaseTransport?.();
        responses = await Promise.all([first, ...others]);
      }
      expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200]);
    });
  }, 60_000);

  it('fails closed for an old eight-field digest without upgrading or changing its original row', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-old-digest', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      releaseTransport?.();
      expect((await POST(makeRequest(body, 'old-key'))).status).toBe(200);
      const taskId = (await query('SELECT id FROM cloud_tasks')).rows[0].id as string;
      const oldDigest = createHash('sha256').update(JSON.stringify({ action: 'upscale', imageUrl: sourceUrl,
        providerId: 'identity-native', model: '302-esrgan', sourceWidth: 32, sourceHeight: 32, targetWidth: 64, targetHeight: 64 })).digest('hex');
      await query('UPDATE cloud_tasks SET request_digest=$1 WHERE id=$2', [oldDigest, taskId]);
      await assertConflict(query, taskId, body, 'old-key');
      expect((await query('SELECT request_digest FROM cloud_tasks WHERE id=$1', [taskId])).rows[0].request_digest).toBe(oldDigest);
    });
  }, 60_000);

  it('rejects a foreign project with 403 before task, charge, refund or transport, including an existing key', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4b-foreign', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      releaseTransport?.();
      expect((await POST(makeRequest(body, 'owned-key'))).status).toBe(200);
      const taskId = (await query('SELECT id FROM cloud_tasks')).rows[0].id as string;
      const before = await readTaskAndLedger(query, taskId);
      for (const key of ['owned-key', 'new-foreign-key']) {
        const response = await POST(makeRequest({ ...body, projectId: 'identity-foreign' }, key));
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ success: false, code: 'GENERATION_PROJECT_FORBIDDEN' });
        expect(await readTaskAndLedger(query, taskId)).toEqual(before);
        expect(sentRequests).toHaveLength(1);
      }
    });
  }, 60_000);
});
