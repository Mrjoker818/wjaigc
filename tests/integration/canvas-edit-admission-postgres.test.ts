import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
vi.mock('server-only', () => ({}));
import { loseCanvasCommitReply } from '../helpers/canvas-generation-fixture';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedCanvasEdit, editBody, lockEditAdmission } from '../helpers/canvas-edit-fixture';
import { canvasBilling } from '../helpers/canvas-generation-fixture';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { parseCanvasEditPublication } from '@/lib/collaboration/canvas-edit-admission';
import { createBillableTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { revokeDocumentEditor, grantDocumentEditor } from '@/lib/collaboration/document-access';

beforeEach((): void => { vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Unconfigured provider boundary'); }); });
afterEach((): void => { vi.unstubAllGlobals(); });

async function admission(key: string = 'single'): Promise<CreateBillableTaskInput> {
  const access = await authorizeGenerationProject({ actorUserId: 'editor', projectId: 'shared' });
  if (access.kind !== 'document') throw new Error('Expected real document access');
  return { userId: 'editor', idempotencyKey: key, requestDigest: 'full-body-digest', creditCost: 7,
    canvasPublication: parseCanvasEditPublication(access, editBody()), task: { id: `task-${key}`, type: 'edit', projectId: 'shared',
      status: 'processing', providerId: 'provider', model: 'gpt-image-1', progress: 0, createdAt: 1, updatedAt: 1 } };
}

// A real loopback listener observes that invalid database names never reach the network.
it('D: fault proxy rejects a third database and non-127 host before networking', async (): Promise<void> => {
  let connections = 0;
  const listener = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  try {
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Missing local listener');
    for (const url of [
      `postgresql://postgres@127.0.0.1:${address.port}/third_database`,
      `postgresql://postgres@localhost:${address.port}/wujie_yjs_task8cb3g_20260927`,
    ]) await expect(loseCanvasCommitReply(url)).rejects.toThrow('Dedicated loopback PG required');
    expect(connections).toBe(0);
  } finally { await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); }
});

it('D: fault proxy accepts the exact task8cb3g database', async (): Promise<void> => {
  const proxy = await loseCanvasCommitReply(process.env.POSTGRES_TEST_DATABASE_URL!);
  try { expect(proxy.dropped()).toBe(false); } finally { await proxy.close(); }
});

it.each(['revoke', 'regrant', 'owner', 'actor', 'archive', 'disable', 'global', 'delete', 'version', 'video'])('C: core lock wait revalidates %s atomically', async mutation => {
  await withIsolatedPostgres('task8cb3g_lock', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const input = await admission();
    const lock = await lockEditAdmission('single');
    const running = createBillableTask(input).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    try {
      await lock.wait(query);
      if (mutation === 'revoke' || mutation === 'regrant') await revokeDocumentEditor('owner', 'shared', 'editor');
      if (mutation === 'regrant') await grantDocumentEditor('owner', 'shared', 'editor');
      if (mutation === 'owner' || mutation === 'actor') await query("UPDATE wujie_users SET status='disabled' WHERE id=$1", [mutation === 'actor' ? 'editor' : 'owner']);
      if (mutation === 'archive') await query("UPDATE wujie_projects SET status='trashed'");
      if (mutation === 'disable') await query('UPDATE wujie_project_document_settings SET enabled=false');
      if (mutation === 'global') process.env.WUJIE_YJS_ENABLED = 'false';
      if (mutation === 'delete') await query("DELETE FROM wujie_workspace_placements WHERE id='placement-shared'");
      if (mutation === 'version') await query("UPDATE wujie_workspace_placements SET asset_id='asset-second',asset_version_id='version-second' WHERE id='placement-shared'");
      if (mutation === 'video') {
        await query("UPDATE wujie_assets SET kind='video' WHERE id='asset-shared'");
        await query("UPDATE wujie_asset_versions SET mime_type='video/mp4' WHERE id='version-shared'");
        await query("UPDATE wujie_workspace_placements SET entity_type='canvas-video' WHERE id='placement-shared'");
      }
    } finally { await lock.release(); }
    const result = await running;
    expect(result.error).toBeDefined();
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(0); expect(state.publications).toHaveLength(0); expect(state.transactions).toHaveLength(0);
    expect(state.credits.map(row => Number(row.balance))).toEqual([100, 100]);
  });
}, 60_000);

it.each(['before-commit', 'zero', 'mixed', 'wrong-type'])('A/D: core atomic case %s', async scenario => {
  await withIsolatedPostgres('task8cb3g_core_atomic', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const input = await admission();
    if (scenario === 'zero') input.creditCost = 0;
    if (scenario === 'mixed') input.canvasPublication!.batchAdmission = true;
    if (scenario === 'wrong-type') input.task.type = 'generate';
    if (scenario === 'before-commit') {
      await query("CREATE FUNCTION reject_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture private SQL detail'; END $$");
      await query('CREATE TRIGGER reject_intent BEFORE INSERT ON wujie_canvas_task_publications FOR EACH ROW EXECUTE FUNCTION reject_intent()');
    }
    if (scenario === 'zero') {
      const result = await createBillableTask(input); expect(result.charged).toBe(false);
      expect((await canvasBilling(query)).tasks).toHaveLength(1);
      expect((await canvasBilling(query)).publications).toHaveLength(1);
    } else await expect(createBillableTask(input)).rejects.toThrow();
    const state = await canvasBilling(query);
    expect(state.transactions).toHaveLength(0); expect(state.credits.map(row => Number(row.balance))).toEqual([100, 100]);
    if (scenario !== 'zero') { expect(state.tasks).toHaveLength(0); expect(state.publications).toHaveLength(0); }
  });
}, 60_000);

it.each(['regrant', 'delete', 'version', 'digest', 'type'])('C: existing task locked replay rejects changed %s without mutation or consumption', async mutation => {
  await withIsolatedPostgres('task8cb3g_pending_lock', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const input = await admission(); await createBillableTask(input);
    const lock = await lockEditAdmission('single');
    const running = createBillableTask(input).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    let before: Awaited<ReturnType<typeof canvasBilling>>;
    try {
      await lock.wait(query);
      if (mutation === 'regrant') { await revokeDocumentEditor('owner', 'shared', 'editor'); await grantDocumentEditor('owner', 'shared', 'editor'); }
      if (mutation === 'delete') await query("DELETE FROM wujie_workspace_placements WHERE id='placement-shared'");
      if (mutation === 'version') await query("UPDATE wujie_workspace_placements SET asset_id='asset-second',asset_version_id='version-second' WHERE id='placement-shared'");
      if (mutation === 'digest') await query("UPDATE cloud_tasks SET request_digest=''");
      if (mutation === 'type') await query("UPDATE cloud_tasks SET type='generate'");
      before = await canvasBilling(query);
    } finally { await lock.release(); }
    expect((await running).error).toBeDefined();
    expect(await canvasBilling(query)).toEqual(before!);
  });
}, 60_000);

it('D: real core COMMIT ACK loss keeps one task charge intent and retry returns its actual ID', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_core_ack', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const input = await admission();
    const proxy = await loseCanvasCommitReply(databaseUrl);
    try { await expect(createBillableTask(input)).rejects.toMatchObject({ status: 503 }); expect(proxy.dropped()).toBe(true); }
    finally { await proxy.close(); }
    const before = await canvasBilling(query); expect(before.tasks).toHaveLength(1); expect(before.publications).toHaveLength(1); expect(before.transactions).toHaveLength(1);
    const retry = await createBillableTask({ ...input, task: { ...input.task, id: 'random-retry-candidate' } });
    expect(retry.task.id).toBe('task-single'); expect(retry.reused).toBe(true);
    expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);
