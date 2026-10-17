import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { SketchPublicationInput } from '@/lib/sketch-to-code/execution';
import type { SketchRuntimeObserver } from '@/lib/sketch-to-code/runtime-observation';
import { createSketchRuntimeObserver } from '@/lib/sketch-to-code/runtime-observation';
import { publishSketchTask } from '@/lib/sketch-to-code/publication';
import { compileSketchHtml } from '@/lib/sketch-to-code/html';

vi.mock('server-only', () => ({}));
// These tests stop before external storage/SQL. A missed injected connection
// must fail, never discover a business database or migrate default file data.
vi.mock('@/lib/db-client', () => ({ getPool: (): never => { throw new Error('UNOWNED_DATABASE_FORBIDDEN'); } }));
vi.mock('@/lib/server-data-root', () => {
  const root = `${process.cwd()}/.superpowers/sdd/2026-10-09-sketch-to-code/publication-observation-owned`;
  const denied = (): never => { throw new Error('UNOWNED_FILE_PORT_FORBIDDEN'); };
  return { getServerDataRoot: (): string => root, getServerSystemDir: (): string => `${root}/system`,
    getServerUsersDir: (): string => `${root}/users`, isServerDataRootDurable: (): boolean => false,
    migrateLocalDataIfNeeded: denied, saveImageFile: denied, deleteImageFile: denied,
    getImageWriteDir: denied, filePathToPublicUrl: denied };
});

type Observation = Parameters<SketchRuntimeObserver>[0];
function input(): SketchPublicationInput {
  const prepared = { projectId: 'observation-project', providerId: 'observation-provider', modelId: 'vision-exact',
    idempotencyKey: 'observation-nonce', imageDataUrl: createCanvas(2, 2).toDataURL('image/png'), instruction: 'PRIVATE_INSTRUCTION' };
  const digest = createHash('sha256').update(JSON.stringify({ version: 1, type: 'sketch-to-code', projectId: prepared.projectId,
    imageDataUrl: prepared.imageDataUrl, instruction: prepared.instruction, providerId: prepared.providerId, modelId: prepared.modelId })).digest('hex');
  const access = { kind: 'personal' as const, actorUserId: 'observation-owner', ownerId: 'observation-owner', projectId: prepared.projectId };
  const lease = { taskId: 'observation-task', owner: 'observation-worker', attemptCount: 1, expiresAt: 8_000_000_000_000 };
  const tree = { type: 'text', text: 'PRIVATE_DRAFT' };
  return { input: prepared, access, lease, signal: new AbortController().signal,
    draft: { uiTree: tree, html: compileSketchHtml(tree), analysis: { summary: 'PRIVATE_ANALYSIS', layout: 'single', controls: [], text: [] } },
    task: { id: lease.taskId, userId: access.actorUserId, projectId: prepared.projectId, type: 'sketch-to-code', status: 'processing',
      providerId: prepared.providerId, model: prepared.modelId, idempotencyKey: prepared.idempotencyKey, requestDigest: digest,
      leaseOwner: lease.owner, leaseExpiresAt: lease.expiresAt, attemptCount: 1, creditCost: 16, creditStatus: 'pending',
      createdAt: 1, updatedAt: 1, progress: 55, revision: 0,
      result: { sketchAdmission: { version: 1, route: '/api/sketch-to-code', requestDigest: digest, access,
        pricing: { calls: 2, perCallCredits: 8, totalCredits: 16 } } } } };
}
function observations(): { rows: Observation[]; observe: SketchRuntimeObserver } {
  const rows: Observation[] = [];
  return { rows, observe: (row): void => { rows.push(row); } };
}
function refusingSql(): { client: PoolClient; queries: string[]; released: boolean[] } {
  const queries: string[] = [], released: boolean[] = [];
  const client = { query: async (sql: string): Promise<{ rows: never[] }> => {
    queries.push(sql);
    if (sql.startsWith('SELECT * FROM cloud_tasks')) return { rows: [] };
    if (sql !== 'BEGIN' && sql !== 'ROLLBACK' && sql !== "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'") {
      throw new Error('UNEXPECTED_SQL_FORBIDDEN');
    }
    return { rows: [] };
  }, release: (discard = false): void => { released.push(discard); } } as unknown as PoolClient;
  return { client, queries, released };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('publication diagnostics observe the original refusal without changing authority', () => {
  it('reports draft validation separately and never opens SQL for invalid HTML', async () => {
    const value = input(), seen = observations(), connect = vi.fn(async (): Promise<PoolClient> => { throw new Error('MUST_NOT_CONNECT'); });
    const result = await publishSketchTask({ ...value, draft: { ...value.draft, html: '<script>PRIVATE_INVALID</script>' } }, { ...seen, connect });
    expect(result).toBe(false); expect(connect).not.toHaveBeenCalled();
    expect(seen.rows).toEqual([expect.objectContaining({ event: 'publication-refused', phase: 'publication', reason: 'SKETCH_PUBLICATION_DRAFT_VALIDATION_ERROR' })]);
    expect(JSON.stringify(seen.rows)).not.toMatch(/PRIVATE_|<script>|imageDataUrl|sketchAdmission/);
  });

  it('names the original input identity guard without logging the conflicting values', async () => {
    const value = input(), seen = observations(), connect = vi.fn(async (): Promise<PoolClient> => { throw new Error('MUST_NOT_CONNECT'); });
    expect(await publishSketchTask({ ...value, task: { ...value.task, model: 'PRIVATE_WRONG_MODEL' } }, { ...seen, connect })).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(seen.rows).toEqual([expect.objectContaining({ event: 'publication-refused', reason: 'SKETCH_PUBLICATION_INPUT_IDENTITY_REFUSED' })]);
    expect(JSON.stringify(seen.rows)).not.toContain('PRIVATE_WRONG_MODEL');
  });

  it('distinguishes a real connection rejection after valid PNG inspection and does not retry', async () => {
    const value = input(), seen = observations(), connect = vi.fn(async (): Promise<PoolClient> => { throw new Error('PRIVATE_CONNECTION_CREDENTIAL'); });
    expect(await publishSketchTask(value, { ...seen, connect })).toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(seen.rows).toEqual([expect.objectContaining({ event: 'publication-refused', reason: 'SKETCH_PUBLICATION_CONNECT_ERROR' })]);
    expect(JSON.stringify(seen.rows)).not.toContain('PRIVATE_CONNECTION_CREDENTIAL');
  });

  it('reports the locked task guard while preserving the exact rollback and release path', async () => {
    const value = input(), seen = observations(), sql = refusingSql();
    expect(await publishSketchTask(value, { ...seen, connect: async () => sql.client })).toBe(false);
    expect(sql.queries).toEqual(['BEGIN', "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'",
      'SELECT * FROM cloud_tasks WHERE id=$1 FOR UPDATE', 'ROLLBACK']);
    expect(sql.released).toEqual([false]);
    expect(seen.rows).toEqual([expect.objectContaining({ event: 'publication-refused', reason: 'SKETCH_PUBLICATION_TASK_IDENTITY_REFUSED' })]);
  });

  it('a throwing diagnostic callback cannot skip rollback, retry or change the false result', async () => {
    const value = input(), sql = refusingSql(); let diagnosticCalls = 0;
    expect(await publishSketchTask(value, { connect: async () => sql.client, observe: (): void => {
      diagnosticCalls++; throw new Error('PRIVATE_SINK');
    } })).toBe(false);
    expect(sql.queries.at(-1)).toBe('ROLLBACK'); expect(sql.released).toEqual([false]); expect(diagnosticCalls).toBe(1);
  });

  it('does not execute private error getters while reporting an external connection failure', async () => {
    let getters = 0; const error = new Error('PRIVATE_ERROR'), seen = observations();
    Object.defineProperty(error, 'code', { get: (): string => { getters++; return 'PRIVATE_CODE'; } });
    expect(await publishSketchTask(input(), { ...seen, connect: async (): Promise<PoolClient> => { throw error; } })).toBe(false);
    expect(getters).toBe(0);
    expect(seen.rows).toEqual([expect.objectContaining({ reason: 'SKETCH_PUBLICATION_CONNECT_ERROR' })]);
    expect(JSON.stringify(seen.rows)).not.toMatch(/PRIVATE_ERROR|PRIVATE_CODE/);
  });

  it('keeps abort capabilities live and reports the original pre-SQL abort without connecting', async () => {
    const value = input(), controller = new AbortController(), seen = observations(); controller.abort(new Error('PRIVATE_ABORT'));
    const connect = vi.fn(async (): Promise<PoolClient> => { throw new Error('MUST_NOT_CONNECT'); });
    expect(await publishSketchTask({ ...value, signal: controller.signal }, { ...seen, connect })).toBe(false);
    expect(connect).not.toHaveBeenCalled(); expect(Object.isFrozen(controller.signal)).toBe(false);
    expect(seen.rows).toEqual([expect.objectContaining({ reason: 'SKETCH_PUBLICATION_PRE_SQL_ERROR' })]);
    expect(JSON.stringify(seen.rows)).not.toContain('PRIVATE_ABORT');
  });

  it('production observations retain only bounded identity, reason and elapsed time', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {}), value = input();
    const observe = createSketchRuntimeObserver({ requestId: 'observation-request', taskId: value.task.id,
      providerId: value.input.providerId, modelId: value.input.modelId });
    expect(await publishSketchTask(value, { observe, connect: async (): Promise<PoolClient> => { throw new Error('PRIVATE_DATABASE_URL'); } })).toBe(false);
    const rows = log.mock.calls.filter(call => call[0] === '[SketchRuntime]').map(call => JSON.parse(String(call[1])) as Record<string, unknown>);
    expect(rows).toEqual([expect.objectContaining({ version: 1, event: 'publication-refused', phase: 'publication',
      taskId: 'observation-task', reason: 'SKETCH_PUBLICATION_CONNECT_ERROR', elapsedMs: expect.any(Number) })]);
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_|imageDataUrl|analysis|sketchAdmission|stack|password/);
  });

  it('the unchanged direct publisher call records a default task-correlated refusal', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await publishSketchTask(input(), { connect: async (): Promise<PoolClient> => { throw new Error('PRIVATE_CONNECT'); } })).toBe(false);
    const rows = log.mock.calls.filter(call => call[0] === '[SketchRuntime]').map(call => JSON.parse(String(call[1])) as Record<string, unknown>);
    expect(rows).toEqual([expect.objectContaining({ taskId: 'observation-task', providerId: 'observation-provider',
      modelId: 'vision-exact', event: 'publication-refused', reason: 'SKETCH_PUBLICATION_CONNECT_ERROR' })]);
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_|imageDataUrl|sketchAdmission/);
  });

  it('default diagnostic identity extraction never invokes a task getter on rejected content', async () => {
    const value = input(), log = vi.spyOn(console, 'info').mockImplementation(() => {}); let getters = 0;
    Object.defineProperty(value.task, 'id', { enumerable: true, get: (): string => { getters++; return 'PRIVATE_GETTER'; } });
    expect(await publishSketchTask({ ...value, draft: { ...value.draft, html: '<script>PRIVATE_INVALID</script>' } })).toBe(false);
    expect(getters).toBe(0);
    const rows = log.mock.calls.filter(call => call[0] === '[SketchRuntime]').map(call => JSON.parse(String(call[1])) as Record<string, unknown>);
    expect(rows).toEqual([expect.objectContaining({ event: 'publication-refused', reason: 'SKETCH_PUBLICATION_DRAFT_VALIDATION_ERROR' })]);
    expect(rows[0]).not.toHaveProperty('taskId'); expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_/);
  });
});
