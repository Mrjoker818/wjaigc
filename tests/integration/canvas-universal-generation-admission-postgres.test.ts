import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createIsolatedPostgresConnectionString, withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedCanvasUniversal, universalBody, universalSnapshot } from '../helpers/canvas-universal-generation-fixture';
import { canvasBilling, loseCanvasCommitReply } from '../helpers/canvas-generation-fixture';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { parseCanvasUniversalPublication, canvasUniversalRequestDigest } from '@/lib/collaboration/canvas-universal-generation-admission';
import { createBillableTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { getPool } from '@/lib/db-client';

beforeEach((): void => { vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('No network allowed'); }); });
afterEach((): void => { vi.unstubAllGlobals(); });
async function input(): Promise<CreateBillableTaskInput> {
  const access = await authorizeGenerationProject({ actorUserId: 'editor', projectId: 'shared' });
  if (access.kind !== 'document') throw new Error('Document fixture required');
  return { userId: 'editor', idempotencyKey: 'one', requestDigest: canvasUniversalRequestDigest(universalBody()), creditCost: 7,
    canvasPublication: parseCanvasUniversalPublication(access, universalBody()), task: { id: 'universal_core', type: 'universal-generate',
      status: 'processing', projectId: 'shared', providerId: 'provider', model: 'gpt-image-1', progress: 0, label: 'Generate', createdAt: 1, updatedAt: 1 } };
}
it.each(['postgresql://postgres@localhost:55492/wujie_yjs_task8cb3h_20260927',
  'postgresql://postgres@127.0.0.1:55492/wujie_yjs_task8cb3h_fourth'])('B: PG fault proxy rejects forbidden target %s before network', async url => {
  await expect(loseCanvasCommitReply(url)).rejects.toThrow('Dedicated loopback PG required');
});
it('B: PG fault proxy accepts only the active four-alias offline bridge database', async () => {
  const active = process.env.POSTGRES_TEST_DATABASE_URL!;
  const proxy = await loseCanvasCommitReply(active);
  try { expect(proxy.dropped()).toBe(false); } finally { await proxy.close(); }
  const changed = new URL(active);
  changed.pathname = '/wujie_bridge_test_wrong';
  await expect(loseCanvasCommitReply(changed.toString())).rejects.toThrow('Dedicated loopback PG required');
});
it('B: PG fault proxy accepts the helper-bound isolated schema URL only while both runtime aliases match', async () => {
  const active = process.env.POSTGRES_TEST_DATABASE_URL!;
  const bound = createIsolatedPostgresConnectionString(active, 'test_bridge_guard_0123456789ab');
  const previousDatabase = process.env.DATABASE_URL;
  const previousPgDatabase = process.env.PGDATABASE_URL;
  try {
    process.env.DATABASE_URL = bound;
    process.env.PGDATABASE_URL = bound;
    const proxy = await loseCanvasCommitReply(bound);
    await proxy.close();
    process.env.PGDATABASE_URL = active;
    await expect(loseCanvasCommitReply(bound)).rejects.toThrow('Dedicated loopback PG required');
  } finally {
    if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
    if (previousPgDatabase === undefined) delete process.env.PGDATABASE_URL; else process.env.PGDATABASE_URL = previousPgDatabase;
  }
});
it.each(['type', 'both-markers', 'edit-empty'])('B: original core rejects %s without consuming or freezing', async scenario => {
  await withIsolatedPostgres('task8cb3h_marker', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const proposal = await input();
    if (scenario === 'type') proposal.task.type = 'edit';
    if (scenario === 'both-markers') proposal.canvasPublication!.batchAdmission = true;
    if (scenario === 'edit-empty') { proposal.task.type = 'edit'; proposal.canvasPublication!.singleAdmission = 'edit'; }
    const before = await canvasBilling(query); await expect(createBillableTask(proposal)).rejects.toBeDefined();
    expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);
it.each(['wrong-type', 'missing-digest', 'fake-payload-digest', 'missing-intent'])('B: core rejects historical %s using actual row', async scenario => {
  await withIsolatedPostgres('task8cb3h_core_identity', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const proposal = await input(); await createBillableTask(proposal);
    if (scenario === 'wrong-type') await query("UPDATE cloud_tasks SET type='edit'");
    if (scenario === 'missing-digest' || scenario === 'fake-payload-digest') await query("UPDATE cloud_tasks SET request_digest=NULL,result=$1", [JSON.stringify({ submissionPayload: { requestDigest: proposal.requestDigest } })]);
    if (scenario === 'missing-intent') await query('DELETE FROM wujie_canvas_task_publications');
    const before = await universalSnapshot(query); await expect(createBillableTask(proposal)).rejects.toBeDefined();
    expect(await universalSnapshot(query)).toEqual(before);
  });
}, 60_000);
it('A: core replay freezes intent and does not advance a batch compensation revision', async () => {
  await withIsolatedPostgres('task8cb3h_core_replay', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const proposal = await input(); const first = await createBillableTask(proposal);
    const second = await createBillableTask({ ...proposal, creditCost: 99, task: { ...proposal.task, id: 'universal_other' } });
    expect(second.reused).toBe(true); expect(second.task.id).toBe(first.task.id); expect(second.task.revision).toBe(first.task.revision);
    expect(second.task.creditCost).toBe(7); expect((await canvasBilling(query)).transactions).toHaveLength(1);
    expect(getPool().idleCount).toBe(getPool().totalCount);
  });
}, 60_000);
it('C: actual PG COMMIT ACK loss retains one charge/intent and key recovery', async () => {
  await withIsolatedPostgres('task8cb3h_core_ack', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const proposal = await input();
    const proxy = await loseCanvasCommitReply(databaseUrl);
    try { await expect(createBillableTask(proposal)).rejects.toMatchObject({ status: 503 }); expect(proxy.dropped()).toBe(true); }
    finally { await proxy.close(); }
    expect((await canvasBilling(query)).transactions).toHaveLength(1);
    const replay = await createBillableTask(proposal); expect(replay.reused).toBe(true); expect(replay.task.id).toBe('universal_core');
    const state = await canvasBilling(query); expect(state.tasks).toHaveLength(1); expect(state.publications).toHaveLength(1); expect(state.transactions).toHaveLength(1);
  });
}, 60_000);
it('C: failure before COMMIT rolls back the real task, charge and publication', async () => {
  await withIsolatedPostgres('task8cb3h_core_rollback', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const proposal = await input();
    await query("ALTER TABLE wujie_canvas_task_publications ADD CONSTRAINT test_reject_publication CHECK (task_id <> 'universal_core')");
    await expect(createBillableTask(proposal)).rejects.toBeDefined();
    const state = await canvasBilling(query); expect(state.tasks).toHaveLength(0); expect(state.publications).toHaveLength(0); expect(state.transactions).toHaveLength(0);
    expect(state.credits.map(row => Number(row.balance))).toEqual([100, 100]);
  });
}, 60_000);
