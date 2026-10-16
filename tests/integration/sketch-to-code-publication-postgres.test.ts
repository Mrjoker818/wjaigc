import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import { admitSketchTask } from '@/lib/sketch-to-code/admission';
import type { SketchGenerationDependencies, SketchCodeInput } from '@/lib/sketch-to-code/generation';
import type { SketchPublicationInput } from '@/lib/sketch-to-code/execution';
import { executeSketchTask } from '@/lib/sketch-to-code/execution';
import { publishSketchTask } from '@/lib/sketch-to-code/publication';
import { readSketchDocument } from '@/lib/sketch-to-code/document';
import { validateSketchDraft } from '@/lib/sketch-to-code/document';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { persistAssetBytes, type PersistedAssetFile } from '@/lib/asset-core/binary-persistence';
import { createAssetService } from '@/lib/asset-core/service';
import { revokeDocumentEditor, grantDocumentEditor } from '@/lib/collaboration/document-access';
vi.mock('server-only', () => ({}));
afterEach(() => { vi.unstubAllEnvs(); });
// Only external S3 transport is disabled. Original local persistence, CPU
// decode, SQL, asset service, migrations, auth, billing and leases remain real.
vi.mock('@/lib/s3-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/s3-storage')>(), uploadBinaryToS3: async () => null,
}));
const tokenOwnedFixture = process.env.SKETCH_TOKEN_OWNED_FIXTURE === '97af41';
const ownedFixture = await vi.hoisted(async (): Promise<import('../helpers/owned-sketch-postgres-fixture').OwnedSketchFixture | undefined> => {
  const { readOwnedSketchFixture } = await import('../helpers/owned-sketch-postgres-fixture');
  return readOwnedSketchFixture();
});
const fixture = resolve(tokenOwnedFixture ? 'output/sketch-token-pg-20261009-97af41' : 'output/sketch-publication-pg-20261009-6bd1c9');
const png = createCanvas(2, 2).toDataURL('image/png');
const generation: SketchGenerationDependencies = {
  authorizeProject: (actorUserId, projectId) => authorizeGenerationProject({ actorUserId, projectId }),
  resolveTaskModel: async (providerId, modelId) => ({ providerId, modelId, kind: 'chat', sourceType: 'vlm',
    protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [],
    maxOutputs: 1, supportsVision: true, supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {} }),
  analyze: async () => JSON.stringify({ summary: '草图', layout: '单列', controls: [], text: ['原子交付'] }),
  reconstruct: async () => JSON.stringify({ type: 'text', text: '原子交付' }),
};
async function seed(query: QueryFn, databaseUrl: string): Promise<void> {
  if (ownedFixture) {
    assertOwnedSketchSchema(databaseUrl);
  } else {
  const manifest = JSON.parse(readFileSync(resolve(fixture, 'cluster.json'), 'utf8')) as { databaseUrl: string; systemIdentifier: string };
  if (tokenOwnedFixture) {
    if (fixture !== resolve('J:/无界本地版/projects/_upstream-wjaigc-restore/output/sketch-token-pg-20261009-97af41')
      || process.env.POSTGRES_TEST_DATABASE_URL !== manifest.databaseUrl
      || manifest.databaseUrl !== 'postgresql://sketch_token_test@127.0.0.1:53651/postgres?sslmode=disable'
      || manifest.systemIdentifier !== '7694645594810926408') throw new Error('Explicit owned Token fixture required');
    expect((await query<{ id: string }>('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id).toBe('7694645594810926408');
  } else {
  if (process.env.POSTGRES_TEST_DATABASE_URL !== manifest.databaseUrl || manifest.databaseUrl !== 'postgresql://sketch_publish_test@127.0.0.1:53650/postgres?sslmode=disable'
    || manifest.systemIdentifier !== '7694623034021489612') throw new Error('Explicit owned publication fixture required');
  expect((await query<{ id: string }>('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id).toBe('7694623034021489612');
  }
  }
  const migrations = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl }, timeout: 30_000,
  });
  expect(migrations.status, migrations.stdout + migrations.stderr).toBe(0);
  await ensureCoreTables(); await ensureCloudTaskTables();
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1),
    ('reader','Current editor','test','active','user',1,1),('stranger','Stranger','test','active','admin',1,1),
    ('viewer','No project grant','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('personal','owner','Personal'),('shared','owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor'),('shared','owner','reader')");
  await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) SELECT 'c_'||id,id,100,100,0,1,1 FROM wujie_users");
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}
async function accepted(projectId = 'personal', actorUserId = 'owner', ttl = 60_000,
  dependencies: SketchGenerationDependencies = generation): Promise<SketchPublicationInput> {
  const input: SketchCodeInput = { projectId, providerId: 'p1', modelId: 'vision-1', imageDataUrl: png,
    instruction: '交付', idempotencyKey: randomUUID() };
  const admission = await admitSketchTask(input, { actorUserId, signal: new AbortController().signal }, {
    generation: dependencies, loadPricingConfig: async () => ({ modelCredits: { 'p1::vision-1': 1 } }),
  });
  const prepared = admission.prepared!;
  const draft = await prepared.compute(new AbortController().signal);
  const lease = await claimCloudTaskLease(admission.task.id, 'publication-test', ttl);
  const task = await getCloudTaskById(admission.task.id);
  if (!lease || !task) throw new Error('Real task/lease fixture missing');
  return { task, lease, input: prepared.input, access: prepared.access, draft, signal: new AbortController().signal };
}
async function counts(query: QueryFn): Promise<{ assets: number; versions: number; completed: number; refunds: number }> {
  return (await query<{ assets: number; versions: number; completed: number; refunds: number }>(`SELECT
    (SELECT count(*)::int FROM wujie_assets) assets,(SELECT count(*)::int FROM wujie_asset_versions) versions,
    (SELECT count(*)::int FROM cloud_tasks WHERE status='completed') completed,
    (SELECT count(*)::int FROM wujie_credit_transactions WHERE type='refund') refunds`)).rows[0];
}
function tracedClient(client: PoolClient, statements: string[]): PoolClient {
  return new Proxy(client, { get(target, key) {
    if (key === 'query') return async (sql: string, values?: unknown[]) => {
      statements.push(sql);
      try { return await target.query(sql, values); }
      catch (error) { statements.push(String(error)); throw error; }
    };
    const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
  } });
}
function interceptedClient(client: PoolClient, hook: (sql: string, values?: unknown[]) => Promise<void>, release?: (discard: boolean) => void): PoolClient {
  return new Proxy(client, { get(target, key) {
    if (key === 'query') return async (sql: string, values?: unknown[]) => { await hook(sql, values); return target.query(sql, values); };
    if (key === 'release') return (discard = false): void => { release?.(discard); target.release(discard); };
    const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
  } });
}
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open };
}
function filePath(file: PersistedAssetFile): string { return resolve(ownedFixture?.mediaRoot || fixture, ownedFixture ? 'exports' : 'media/exports', file.url.split('/').at(-1)!); }
async function until(query: QueryFn, sql: string, values: unknown[] = []): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!(await query<{ ok: boolean }>(sql, values)).rows[0]?.ok) {
    if (Date.now() > deadline) throw new Error('Condition did not become true');
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}
describe('original atomic sketch publication on the owned real PostgreSQL fixture', () => {
  it('fix1 depth12 styled leaf publishes and reads exact default compiler bytes', async () => {
    await withIsolatedPostgres('sketch_fix1_depth', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl);
      let tree: unknown = { type: 'text', text: '边界<&>', style: { color: '#111827' } };
      for (let depth = 1; depth < 12; depth++) tree = { type: 'container', children: [tree] };
      const value = await accepted('shared', 'editor', 60_000, { ...generation, reconstruct: async () => JSON.stringify(tree) });
      expect(value.draft.html).toContain('<p style="color:#111827">边界&lt;&amp;&gt;</p>');
      expect(await publishSketchTask(value)).toBe(true);
      const content = await readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: value.task.id });
      expect(content.bytes.equals(Buffer.from(value.draft.html))).toBe(true);
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
    });
  }, 30_000);
  it('fix1 completed replay requires live DB lease while current editor read survives expiry', async () => {
    await withIsolatedPostgres('sketch_fix1_replay_expired', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted('shared', 'editor');
      expect(await publishSketchTask(value)).toBe(true);
      const before = (await query('SELECT * FROM cloud_tasks WHERE id=$1', [value.task.id])).rows;
      const charges = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
      expect(await publishSketchTask(value)).toBe(true);
      expect((await query('SELECT * FROM cloud_tasks WHERE id=$1', [value.task.id])).rows).toEqual(before);
      expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(charges);
      // 正向重放不依赖机器在两秒内完成；负向状态由真实数据库时钟建立。
      const expiredRows = (await query(`UPDATE cloud_tasks
        SET lease_expires_at=(FLOOR(EXTRACT(EPOCH FROM clock_timestamp())*1000)-1)::bigint
        WHERE id=$1 AND status='completed' AND lease_owner=$2 AND attempt_count=$3 AND lease_expires_at=$4
        RETURNING *`, [value.task.id, value.lease.owner, value.lease.attemptCount, value.lease.expiresAt])).rows;
      expect(expiredRows).toHaveLength(1);
      const expiredAt = Number(expiredRows[0].lease_expires_at);
      expect(Number.isSafeInteger(expiredAt)).toBe(true);
      expect(expiredRows).toEqual(before.map(row => ({ ...row, lease_expires_at: String(expiredAt) })));
      // 两份输入与数据库使用同一过期值，防止身份不匹配冒充时钟拒绝。
      const expiredValue = { ...value, task: { ...value.task, leaseExpiresAt: expiredAt },
        lease: { ...value.lease, expiresAt: expiredAt } };
      const replay = await publishSketchTask(expiredValue);
      expect((await query('SELECT * FROM cloud_tasks WHERE id=$1', [value.task.id])).rows).toEqual(expiredRows);
      expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(charges);
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
      expect((await readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: value.task.id })).bytes.equals(Buffer.from(value.draft.html))).toBe(true);
      expect(replay).toBe(false);
    });
  }, 30_000);
  it('fix1 completed replay rechecks DB time after real version lock wait crosses expiry', async () => {
    await withIsolatedPostgres('sketch_fix1_replay_lock', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted('personal', 'owner', 2000);
      expect(await publishSketchTask(value)).toBe(true);
      const task = (await getCloudTaskById(value.task.id))!;
      const before = (await query('SELECT * FROM cloud_tasks WHERE id=$1', [value.task.id])).rows;
      const charges = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
      const blocker = await getPool().connect(); await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM wujie_asset_versions WHERE id=$1 FOR UPDATE', [task.result!.htmlAssetVersionId]);
      let pid = 0; const connected = gate();
      const pending = publishSketchTask(value, { connect: async () => {
        const client = await getPool().connect(); pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid;
        connected.open(); return client;
      } });
      try {
        await connected.promise;
        await until(query, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') ok", [pid]);
        await until(query, 'SELECT EXTRACT(EPOCH FROM clock_timestamp())*1000 >= $1::bigint ok', [value.lease.expiresAt]);
      } finally { await blocker.query('ROLLBACK'); blocker.release(); }
      const replay = await pending;
      expect((await query('SELECT * FROM cloud_tasks WHERE id=$1', [value.task.id])).rows).toEqual(before);
      expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(charges);
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
      expect((await readSketchDocument({ actorUserId: 'owner', projectId: 'personal', taskId: value.task.id })).html).toBe(value.draft.html);
      expect(replay).toBe(false);
    });
  }, 30_000);
  it('creates same-project PNG/HTML versions and completes the original charged task once', async () => {
    await withIsolatedPostgres('sketch_publish_atomic', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted();
      expect(() => validateSketchDraft(value.draft)).not.toThrow();
      const statements: string[] = [];
      expect(await publishSketchTask(value, { connect: async () => tracedClient(await getPool().connect(), statements) }), statements.join('\n')).toBe(true);
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
      const task = (await getCloudTaskById(value.task.id))!;
      expect(task.userId).toBe('owner'); expect(task.creditCost).toBe(2); expect(task.status).toBe('completed');
      const output = await readSketchDocument({ actorUserId: 'owner', projectId: 'personal', taskId: task.id });
      expect(output.bytes.equals(Buffer.from(value.draft.html))).toBe(true);
      expect(await publishSketchTask(value)).toBe(true);
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
    });
  }, 30_000);
  it('publishes in the project owner namespace for a current editor and reads with a different current editor', async () => {
    await withIsolatedPostgres('sketch_publish_editor', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted('shared', 'editor');
      expect(await publishSketchTask(value)).toBe(true);
      expect((await query<{ owner_id: string }>('SELECT DISTINCT owner_id FROM wujie_asset_versions')).rows).toEqual([{ owner_id: 'owner' }]);
      expect((await readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: value.task.id })).html).toBe(value.draft.html);
    });
  }, 30_000);
  it.each(['revoked', 'regranted', 'personal-to-document', 'owner-disabled', 'foreign-owner'])('refuses changed current authority: %s', async change => {
    await withIsolatedPostgres('sketch_publish_access', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl);
      const value = await accepted(change === 'revoked' || change === 'regranted' ? 'shared' : 'personal', change === 'revoked' || change === 'regranted' ? 'editor' : 'owner');
      if (change === 'revoked' || change === 'regranted') {
        await revokeDocumentEditor('owner', 'shared', 'editor');
        if (change === 'regranted') await grantDocumentEditor('owner', 'shared', 'editor');
      } else if (change === 'personal-to-document') {
        await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('personal','owner',true)");
        await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('personal','owner')");
      } else if (change === 'owner-disabled') await query("UPDATE wujie_users SET status='disabled' WHERE id='owner'");
      else await query("UPDATE wujie_projects SET owner_id='stranger' WHERE id='personal'");
      expect(await publishSketchTask(value)).toBe(false);
      expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 });
    });
  }, 30_000);
  it.each(['lease_owner', 'attempt_count', 'lease_expires_at', 'request_digest', 'idempotency_key', 'provider_id', 'model', 'user_id', 'project_id'])('rejects original full identity changes: %s', async field => {
    await withIsolatedPostgres('sketch_publish_identity', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted();
      const replacement = field === 'attempt_count' ? 2 : field === 'lease_expires_at' ? value.lease.expiresAt + 1 : field === 'user_id' ? 'stranger' : field === 'project_id' ? 'shared' : 'different';
      await query(`UPDATE cloud_tasks SET ${field}=$2 WHERE id=$1`, [value.task.id, replacement]);
      expect(await publishSketchTask(value)).toBe(false);
      expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 });
    });
  }, 30_000);
  it('rejects terminal cancellation and refunds without issuing another refund', async () => {
    await withIsolatedPostgres('sketch_publish_cancelled', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted();
      const terminal = await terminateCloudTaskAndRefund(value.task.id, 'cancelled', 'fixture cancelled');
      expect(terminal.refunded).toBe(true);
      expect(await publishSketchTask(value)).toBe(false);
      expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 1 });
    });
  }, 30_000);
  it('uses DB clock after actual task lock wait, not a pre-lock JS lease check', async () => {
    await withIsolatedPostgres('sketch_publish_db_clock', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted('personal', 'owner', 1000);
      const blocker = await getPool().connect(); await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE', [value.task.id]);
      let pid = 0; const connected = gate();
      const pending = publishSketchTask(value, { connect: async () => {
        const client = await getPool().connect(); pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid;
        connected.open(); return client;
      } });
      try {
        await connected.promise;
        await until(query, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') ok", [pid]);
        await until(query, 'SELECT EXTRACT(EPOCH FROM clock_timestamp())*1000 >= $1::bigint ok', [value.lease.expiresAt]);
      } finally { await blocker.query('ROLLBACK'); blocker.release(); }
      expect(await pending).toBe(false);
      expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 });
    });
  }, 30_000);
  it('detaches mutable identity before first await and holds atomic visibility through COMMIT', async () => {
    await withIsolatedPostgres('sketch_publish_visibility', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const source = await accepted(); const value = structuredClone({ ...source, signal: undefined });
      const ready = gate(), resume = gate(); const pending = publishSketchTask({ ...value, signal: source.signal }, { connect: async () => {
        const client = await getPool().connect(); return interceptedClient(client, async sql => {
          if (sql === 'COMMIT') { ready.open(); await resume.promise; }
        });
      } });
      Object.assign(value.task, { userId: 'stranger' }); Object.assign(value.input, { projectId: 'shared' });
      Object.assign(value.lease, { owner: 'changed' }); Object.assign(value.draft, { html: '<script>bad</script>' });
      await ready.promise;
      try { expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 }); }
      finally { resume.open(); }
      expect(await pending).toBe(true);
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
    });
  }, 30_000);
  it('rolls back and cleans only its late prepared PNG after native abort', async () => {
    await withIsolatedPostgres('sketch_publish_late_abort', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const source = await accepted(); const controller = new AbortController(); let saved!: PersistedAssetFile;
      expect(await publishSketchTask({ ...source, signal: controller.signal }, { persistBytes: async input => {
        saved = await persistAssetBytes({ ...input, signal: undefined }); controller.abort(); return saved;
      } })).toBe(false);
      expect(controller.signal.aborted).toBe(true); expect(existsSync(filePath(saved))).toBe(false);
      expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 });
    });
  }, 30_000);
  it('keeps unrelated original asset references when cleaning its rollback-owned PNG', async () => {
    await withIsolatedPostgres('sketch_publish_referenced', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted(); let saved!: PersistedAssetFile;
      expect(await publishSketchTask(value, { persistBytes: async input => {
        saved = await persistAssetBytes(input);
        await createAssetService().createAssetVersion({ actorUserId: 'owner', projectId: 'personal', kind: 'image',
          file: saved, idempotencyKey: randomUUID(), requestDigest: value.task.requestDigest! });
        return saved;
      }, connect: async () => interceptedClient(await getPool().connect(), async sql => {
        if (sql.includes("status = 'completed'")) throw new Error('Injected pre-completion failure');
      }) })).toBe(false);
      expect(existsSync(filePath(saved))).toBe(true);
      expect(await counts(query)).toEqual({ assets: 1, versions: 1, completed: 0, refunds: 0 });
    });
  }, 30_000);
  it('does not clean borrowed files or refund after confirmed rollback', async () => {
    await withIsolatedPostgres('sketch_publish_borrowed', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted(); const saved = await persistAssetBytes({ bytes: Buffer.from(png.split(',')[1], 'base64'), mimeType: 'image/png', filename: 'borrowed.png' });
      expect(await publishSketchTask(value, { persistBytes: async () => ({ ...saved, createdThisCall: false }),
        connect: async () => interceptedClient(await getPool().connect(), async sql => {
          if (sql.includes("status = 'completed'")) throw new Error('Injected pre-completion failure');
        }) })).toBe(false);
      expect(existsSync(filePath(saved))).toBe(true);
      expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 });
    });
  }, 30_000);
  it('drains original ROLLBACK before deleting unreferenced owned file', async () => {
    await withIsolatedPostgres('sketch_publish_rollback', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted(); let saved!: PersistedAssetFile;
      expect(await publishSketchTask(value, { persistBytes: async input => { saved = await persistAssetBytes(input); return saved; },
        connect: async () => interceptedClient(await getPool().connect(), async sql => {
          if (sql.includes("status = 'completed'")) throw new Error('Injected pre-completion failure');
        }) })).toBe(false);
      expect(existsSync(filePath(saved))).toBe(false);
      expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 });
    });
  }, 30_000);
  it('discards unknown COMMIT acknowledgement, preserves possibly committed bytes, recovers without refund', async () => {
    await withIsolatedPostgres('sketch_publish_unknown_commit', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted(); let saved!: PersistedAssetFile, discarded = false;
      await expect(publishSketchTask(value, { persistBytes: async input => { saved = await persistAssetBytes(input); return saved; },
        connect: async () => { const client = await getPool().connect(); return interceptedClient(client, async sql => {
          if (sql === 'COMMIT') { await client.query('COMMIT'); throw new Error('Lost original COMMIT acknowledgement'); }
        }, flag => { discarded = flag; }); } })).rejects.toMatchObject({ code: 'SKETCH_PUBLICATION_UNCONFIRMED' });
      expect(discarded).toBe(true); expect(existsSync(filePath(saved))).toBe(true);
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
      expect((await readSketchDocument({ actorUserId: 'owner', projectId: 'personal', taskId: value.task.id })).bytes).toEqual(Buffer.from(value.draft.html));
      expect(await publishSketchTask(value)).toBe(true);
    });
  }, 30_000);
  it('refuses preparation failure without task completion or publication-side refund', async () => {
    await withIsolatedPostgres('sketch_publish_prepare_fail', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted();
      expect(await publishSketchTask(value, { persistBytes: async () => { throw new Error('Preparation failed'); } })).toBe(false);
      expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 });
    });
  }, 30_000);
  it.each(['task_id', 'mime_type', 'checksum', 'byte_size', 'schema', 'source', 'preview-mime', 'preview-owner', 'preview-checksum', 'result-reference'])('fails closed on persisted identity/content conflict: %s', async field => {
    await withIsolatedPostgres('sketch_publish_conflict', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted(); expect(await publishSketchTask(value)).toBe(true);
      const task = (await getCloudTaskById(value.task.id))!; const id = task.result!.htmlAssetVersionId;
      if (field === 'schema' || field === 'source') await query(`UPDATE wujie_asset_versions SET metadata=jsonb_set(metadata,$2::text[],$3::jsonb) WHERE id=$1`,
        [id, [field === 'schema' ? 'schemaId' : 'uiTree'], JSON.stringify(field === 'schema' ? 'foreign' : { type: 'text', text: 'different' })]);
      else if (field === 'preview-mime') await query("UPDATE wujie_asset_versions SET mime_type='image/jpeg' WHERE id=$1", [task.result!.previewAssetVersionId]);
      else if (field === 'preview-owner') await query("UPDATE wujie_asset_versions SET metadata=jsonb_set(metadata,'{ownerId}','\"stranger\"'::jsonb) WHERE id=$1", [task.result!.previewAssetVersionId]);
      else if (field === 'preview-checksum') await query("UPDATE wujie_asset_versions SET checksum=$2 WHERE id=$1", [task.result!.previewAssetVersionId, 'b'.repeat(64)]);
      else if (field === 'result-reference') await query("UPDATE cloud_tasks SET result=jsonb_set(result,'{htmlAssetId}','\"wrong\"'::jsonb) WHERE id=$1", [value.task.id]);
      else await query(`UPDATE wujie_asset_versions SET ${field}=$2 WHERE id=$1`, [id, field === 'byte_size' ? 1 : 'wrong']);
      expect(await publishSketchTask(value)).toBe(false);
      await expect(readSketchDocument({ actorUserId: 'owner', projectId: 'personal', taskId: value.task.id })).rejects.toMatchObject({ code: 'SKETCH_DOCUMENT_UNAVAILABLE', status: 404 });
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
    });
  }, 30_000);
  it('uses only current download permission, never the old author grant or admin status', async () => {
    await withIsolatedPostgres('sketch_read_permission', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted('shared', 'editor'); expect(await publishSketchTask(value)).toBe(true);
      await revokeDocumentEditor('owner', 'shared', 'editor');
      // Literal viewer identity has no canonical project grant. This does not
      // implement or simulate public-share/viewer-only HTML permission.
      for (const actorUserId of ['editor', 'stranger', 'viewer', 'missing']) await expect(readSketchDocument({ actorUserId, projectId: 'shared', taskId: value.task.id })).rejects.toMatchObject({ code: 'SKETCH_DOCUMENT_UNAVAILABLE', status: 404 });
      expect((await readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: value.task.id })).html).toBe(value.draft.html);
      await revokeDocumentEditor('owner', 'shared', 'reader');
      await expect(readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: value.task.id })).rejects.toMatchObject({ status: 404 });
      await grantDocumentEditor('owner', 'shared', 'reader');
      expect((await readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: value.task.id })).bytes.toString()).toBe(value.draft.html);
    });
  }, 30_000);
  it.each(['absent', 'presence'])('uses original verified legacy migration: %s graph', async graph => {
    await withIsolatedPostgres('sketch_publish_legacy', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl);
      // Seed the old snapshot before any document authority for this owner;
      // never disable the original snapshot-authority trigger.
      await query("UPDATE wujie_project_document_settings SET enabled=false WHERE project_id='shared'");
      await query("DELETE FROM wujie_project_canvas_documents WHERE project_id='shared'");
      const legacy = [{ id: 'legacy', userId: 'owner', name: 'Legacy', canvasImages: [{ id: 'old', url: png,
        x: 0, y: 0, width: 2, height: 2, originalWidth: 2, originalHeight: 2 }], createdAt: 1, updatedAt: 1 }];
      await query("INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ('owner','projects',$1::jsonb,1)", [JSON.stringify(legacy)]);
      if (graph === 'presence') await query("INSERT INTO wujie_projects(id,owner_id,name,metadata) VALUES ('legacy','owner','Presence','{\"presenceProjection\":true}')");
      const value = await accepted('legacy'); expect(await publishSketchTask(value)).toBe(true);
      expect(await counts(query)).toEqual({ assets: 3, versions: 3, completed: 1, refunds: 0 });
      expect((await query<{ status: string }>("SELECT status FROM wujie_asset_migration_checkpoints WHERE project_id='legacy'")).rows).toEqual([{ status: 'completed' }]);
      expect((await query("SELECT data_value FROM wujie_user_data WHERE user_id='owner' AND data_key='projects'")).rows[0].data_value).toEqual(legacy);
      expect((await readSketchDocument({ actorUserId: 'owner', projectId: 'legacy', taskId: value.task.id })).html).toBe(value.draft.html);
    });
  }, 30_000);
  it('serializes concurrent duplicate publications without partial visibility or extra versions', async () => {
    await withIsolatedPostgres('sketch_publish_duplicate', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted();
      expect(await Promise.all([publishSketchTask(value), publishSketchTask(value)])).toEqual([true, true]);
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
    });
  }, 30_000);
  it('rechecks the live lease after grant lock wait', async () => {
    await withIsolatedPostgres('sketch_publish_grant_wait', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted('shared', 'editor', 1000);
      const blocker = await getPool().connect(); await blocker.query('BEGIN');
      await blocker.query("SELECT project_id FROM wujie_project_document_editors WHERE member_user_id='editor' FOR UPDATE");
      const connected = gate(); let pid = 0;
      const pending = publishSketchTask(value, { connect: async () => {
        const client = await getPool().connect(); pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0].pid; connected.open(); return client;
      } });
      try {
        await connected.promise;
        await until(query, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') ok", [pid]);
        await until(query, 'SELECT EXTRACT(EPOCH FROM clock_timestamp())*1000 >= $1::bigint ok', [value.lease.expiresAt]);
      } finally { await blocker.query('ROLLBACK'); blocker.release(); }
      expect(await pending).toBe(false); expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 });
    });
  }, 30_000);
  it('keeps current authorization locked through logical document read and commit', async () => {
    await withIsolatedPostgres('sketch_read_lock', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl); const value = await accepted('shared', 'editor'); expect(await publishSketchTask(value)).toBe(true);
      const blocker = await getPool().connect(); await blocker.query('BEGIN');
      const task = (await getCloudTaskById(value.task.id))!;
      await blocker.query('SELECT id FROM wujie_asset_versions WHERE id=$1 FOR UPDATE', [task.result!.htmlAssetVersionId]);
      const pending = readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: value.task.id });
      try {
        await until(query, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query LIKE '%WHERE v.id=ANY%' AND wait_event_type='Lock') ok");
        await query('BEGIN'); await query("SET LOCAL lock_timeout='150ms'");
        await expect(query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='reader'")).rejects.toMatchObject({ code: '55P03' });
      } finally { await query('ROLLBACK'); await blocker.query('ROLLBACK'); blocker.release(); }
      expect((await pending).html).toBe(value.draft.html);
      await revokeDocumentEditor('owner', 'shared', 'reader');
      await expect(readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: value.task.id })).rejects.toMatchObject({ status: 404 });
    });
  }, 30_000);
  it('runs the original guarded executor with this production publisher callback and current authorized read', async () => {
    await withIsolatedPostgres('sketch_publish_executor', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl);
      const input: SketchCodeInput = { projectId: 'shared', providerId: 'p1', modelId: 'vision-1', imageDataUrl: png,
        instruction: '真实执行交付', idempotencyKey: randomUUID() };
      const admission = await admitSketchTask(input, { actorUserId: 'editor', signal: new AbortController().signal }, {
        generation, loadPricingConfig: async () => ({ modelCredits: { 'p1::vision-1': 1 } }),
      });
      expect(await executeSketchTask(admission, { actorUserId: 'editor', projectId: 'shared' }, { publisher: publishSketchTask })).toMatchObject({ status: 'completed' });
      expect(await counts(query)).toEqual({ assets: 2, versions: 2, completed: 1, refunds: 0 });
      expect((await readSketchDocument({ actorUserId: 'reader', projectId: 'shared', taskId: admission.task.id })).html).toContain('原子交付');
    });
  }, 30_000);
  it('keeps legacy graph migration and both versions rolled back on preparation failure', async () => {
    await withIsolatedPostgres('sketch_publish_legacy_rollback', async ({ query, databaseUrl }) => {
      await seed(query, databaseUrl);
      await query("UPDATE wujie_project_document_settings SET enabled=false WHERE project_id='shared'");
      const legacy = [{ id: 'legacy', userId: 'owner', name: 'Legacy', canvasImages: [{ id: 'old', url: png,
        x: 0, y: 0, width: 2, height: 2, originalWidth: 2, originalHeight: 2 }], createdAt: 1, updatedAt: 1 }];
      await query("INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at) VALUES ('owner','projects',$1::jsonb,1)", [JSON.stringify(legacy)]);
      const value = await accepted('legacy'); let saved!: PersistedAssetFile, calls = 0;
      expect(await publishSketchTask(value, { persistBytes: async input => {
        if (++calls === 2) throw new Error('Preview prepare failed after legacy media');
        saved = await persistAssetBytes(input); return saved;
      } })).toBe(false);
      expect(calls).toBe(2); expect(existsSync(filePath(saved))).toBe(false);
      expect((await query("SELECT id FROM wujie_projects WHERE id='legacy'")).rows).toHaveLength(0);
      expect((await query('SELECT id FROM wujie_asset_migration_checkpoints')).rows).toHaveLength(0);
      expect(await counts(query)).toEqual({ assets: 0, versions: 0, completed: 0, refunds: 0 });
    });
  }, 30_000);
});
