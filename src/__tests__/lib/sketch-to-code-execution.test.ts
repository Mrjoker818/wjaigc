import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSketchCode, type SketchGenerationDependencies } from '@/lib/sketch-to-code/generation';
import type { SketchTaskAdmission } from '@/lib/sketch-to-code/admission';
import type { PersistedCloudTask, CloudTaskLease } from '@/lib/cloud-task-storage';
import { abortTaskExecution } from '@/lib/task-core/task-abort';
import { SketchProviderError } from '@/lib/sketch-to-code/provider';
import { SketchTokenPublicationRejectedError } from '@/lib/sketch-to-code/token-billing';
import { terminateCloudTaskAndRefund, type SketchTaskSettlementFence } from '@/lib/cloud-task-storage';
import type { PoolClient } from 'pg';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { executeSketchTask, recoverExpiredSketchTask, type SketchExecutionDependencies,
  type SketchPublicationInput, type SketchRecoveryIdentity } from '@/lib/sketch-to-code/execution';

vi.mock('server-only', () => ({}));
// Original settlement validation runs here; only external SQL/schema access is
// replaced. Real SQL timing/locks/accounting are exercised by the PG fixture.
vi.mock('@/lib/db-client', () => ({ execSql: vi.fn(async () => ({ rows: [], rowCount: 0 })), getPool: vi.fn() }));
vi.mock('@/lib/db-storage', () => ({ ensureCoreTables: async (): Promise<void> => {} }));
const input = { projectId: 'project-a', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '还原草图',
  providerId: 'p1', modelId: 'vision-1', idempotencyKey: 'nonce-1' };
const digest = createHash('sha256').update(JSON.stringify({ version: 1, type: 'sketch-to-code', projectId: input.projectId,
  imageDataUrl: input.imageDataUrl, instruction: input.instruction, providerId: 'p1', modelId: 'vision-1' })).digest('hex');
const access = { kind: 'personal' as const, actorUserId: 'user-a', ownerId: 'user-a', projectId: 'project-a' };
const context = (): { actorUserId: string; projectId: string; signal: AbortSignal } => ({ actorUserId: 'user-a', projectId: 'project-a', signal: new AbortController().signal });
function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function harness(): Promise<{
  task: PersistedCloudTask; admission: SketchTaskAdmission; dep: SketchExecutionDependencies;
  generation: SketchGenerationDependencies; computeSignals: AbortSignal[]; stages: string[];
  publications: SketchPublicationInput[]; claims: Array<{ owner: string; ttl: number }>;
  settlements: Array<{ status: string; reason: string; owner?: string; requireActive?: boolean }>;
  updates: unknown[]; identity: SketchRecoveryIdentity;
}> {
  const stages: string[] = []; const computeSignals: AbortSignal[] = []; const publications: SketchPublicationInput[] = [];
  const claims: Array<{ owner: string; ttl: number }> = []; const settlements: Array<{ status: string; reason: string; owner?: string; requireActive?: boolean }> = [];
  const updates: unknown[] = [];
  const generation: SketchGenerationDependencies = {
    authorizeProject: async () => access,
    resolveTaskModel: async () => ({ providerId: 'p1', modelId: 'vision-1', kind: 'chat', sourceType: 'vlm', protocol: 'chat-completions', executionMode: 'sync', supportsVision: true, supportsMask: false, supportsReferenceImages: true, allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, outputKinds: ['text'], capabilitySources: {} }),
    analyze: async () => { stages.push('analysis'); return JSON.stringify({ summary: '登录', layout: '垂直', controls: [], text: [] }); },
    reconstruct: async () => { stages.push('reconstruction'); return JSON.stringify({ type: 'text', text: '欢迎' }); },
  };
  // prepare freezes adapters. These explicit seams let each test change the
  // remote behavior while exercising the original parsing/deadlines/cleanup.
  const prepared = await prepareSketchCode(input, { ...generation,
    analyze: (...args) => generation.analyze(...args), reconstruct: (...args) => generation.reconstruct(...args),
  }, { actorUserId: 'user-a', signal: new AbortController().signal });
  const task: PersistedCloudTask = { id: 'sketch-test', userId: 'user-a', projectId: 'project-a', type: 'sketch-to-code', status: 'processing',
    providerId: 'p1', model: 'vision-1', requestDigest: digest, idempotencyKey: 'nonce-1', creditCost: 14, creditStatus: 'pending',
    progress: 0, createdAt: Date.now(), updatedAt: Date.now(), revision: 0, leaseOwner: '', leaseExpiresAt: 0, attemptCount: 0,
    result: { sketchAdmission: { version: 1, route: '/api/sketch-to-code', requestDigest: digest, access: { ...access }, pricing: { calls: 2, perCallCredits: 7, totalCredits: 14 } } } };
  const admission: SketchTaskAdmission = { task: { ...structuredClone(task), status: 'processing' }, reused: false, charged: true,
    prepared: { ...prepared, compute: async signal => { computeSignals.push(signal); return prepared.compute(signal); } } };
  const dep: SketchExecutionDependencies = {
    getCloudTaskById: async () => structuredClone(task),
    claimCloudTaskLease: async (id, owner, ttl, now = Date.now()): Promise<CloudTaskLease | null> => {
      claims.push({ owner, ttl });
      if (id !== task.id || task.status !== 'processing' || (task.leaseExpiresAt || 0) >= now && task.leaseExpiresAt !== 0) return null;
      task.leaseOwner = owner; task.leaseExpiresAt = now + ttl; task.attemptCount = (task.attemptCount || 0) + 1;
      return { taskId: id, owner, expiresAt: now + ttl, attemptCount: task.attemptCount };
    },
    updateCloudTask: async (id, update) => {
      updates.push(update);
      if (id !== task.id || task.leaseOwner !== update.leaseOwner || task.status !== 'processing' || update.expectedRevision !== task.revision) return false;
      task.progress = update.progress ?? task.progress; task.label = update.label; task.revision += 1; return true;
    },
    terminateCloudTaskAndRefund: async (id, status, reason, owner, options) => {
      settlements.push({ status, reason, owner, requireActive: options?.requireActive });
      if (id !== task.id || owner !== task.leaseOwner || task.status !== 'processing') return { transitioned: false, refunded: false, creditCost: 0 };
      task.status = status; task.error = reason; task.creditStatus = 'refunded'; task.leaseOwner = ''; task.leaseExpiresAt = 0;
      return { status, transitioned: true, refunded: true, creditCost: 14 };
    },
    publisher: async publication => {
      publications.push(publication); publication.signal.throwIfAborted();
      if (task.leaseOwner !== publication.lease.owner || task.attemptCount !== publication.lease.attemptCount || (task.leaseExpiresAt || 0) <= Date.now() || task.status !== 'processing') return false;
      task.status = 'completed'; task.result = { ...task.result, ...publication.draft, previewAssetId: 'preview-1', htmlAssetId: 'html-1' };
      task.leaseOwner = ''; task.leaseExpiresAt = 0; return true;
    },
  };
  return { task, admission, dep, generation, computeSignals, stages, publications, claims, settlements, updates,
    identity: { actorUserId: 'user-a', projectId: 'project-a', providerId: 'p1', modelId: 'vision-1', requestDigest: digest, idempotencyKey: 'nonce-1', access } };
}
/** Explicit original SQL/permission/ledger fixture; never connects to a real DB.
 * Rows are staged privately until COMMIT, and discarded on confirmed ROLLBACK.
 */
function tokenFailureClient(h: Awaited<ReturnType<typeof harness>>, hook?: (sql: string) => Promise<void>): {
  client: PoolClient; queries: string[]; releases: boolean[];
} {
  const pricing = { mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14, tokenPricing: { input: 1, output: 1 } };
  (h.task.result!.sketchAdmission as Record<string, unknown>).pricing = pricing;
  h.task.chargedTransactionId = createTaskBillingTransactionId('charge', h.task.id);
  h.admission.task = structuredClone(h.task) as SketchTaskAdmission['task'];
  const queries: string[] = [], releases: boolean[] = []; let settled = false;
  const row = (): Record<string, unknown> => ({ id: h.task.id, type: h.task.type, user_id: h.task.userId,
    project_id: h.task.projectId, provider_id: h.task.providerId, model: h.task.model, request_digest: h.task.requestDigest,
    idempotency_key: h.task.idempotencyKey, lease_owner: settled ? '' : h.task.leaseOwner,
    attempt_count: h.task.attemptCount, lease_expires_at: settled ? '0' : String(h.task.leaseExpiresAt),
    status: settled ? 'failed' : h.task.status, credit_status: settled ? 'refunded' : h.task.creditStatus,
    credit_cost: String(h.task.creditCost), charged_transaction_id: h.task.chargedTransactionId,
    refunded_transaction_id: settled ? 'original-refund' : '', result: structuredClone(h.task.result) });
  const client = { query: async (sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    queries.push(sql); await hook?.(sql);
    let rows: Record<string, unknown>[] = [];
    if (sql === 'ROLLBACK') settled = false;
    else if (sql === 'COMMIT' && settled) {
      h.task.status = 'failed'; h.task.creditStatus = 'refunded'; h.task.leaseOwner = ''; h.task.leaseExpiresAt = 0;
    } else if (sql.includes('WITH candidate AS')) {
      settled = true; rows = [{ status: 'failed', transitioned: true, refunded: true, credit_cost: 14, balance: 100, user_id: h.task.userId }];
    } else if (sql.includes('FROM cloud_tasks WHERE id=$1')) rows = [{ ...row(), now: String(Date.now()) }];
    else if (sql.includes('SELECT status FROM wujie_users')) rows = [{ status: 'active' }];
    else if (sql.includes('SELECT p.owner_id')) rows = [{ owner_id: 'user-a', status: 'active', owner_status: 'active', enabled: false, has_document: false }];
    else if (sql.includes('SELECT balance,total_used')) rows = [{ balance: 86, total_used: 14 }];
    else if (sql.includes('FROM wujie_credit_transactions')) rows = [{ id: h.task.chargedTransactionId, user_id: h.task.userId,
      type: 'consume', amount: -14, balance_after: 86, model: h.task.model, task_id: h.task.id, reference_id: h.task.id }];
    return { rows, rowCount: rows.length };
  }, release: (discard = false): void => { releases.push(discard); } } as unknown as PoolClient;
  h.dep.connect = async () => client;
  h.dep.terminateCloudTaskAndRefund = async (...args) => {
    expect(args[4]?.client).toBeDefined(); expect(args[4]?.client).not.toBe(client);
    h.settlements.push({ status: args[1], reason: args[2], owner: args[3], requireActive: args[4]?.requireActive });
    return terminateCloudTaskAndRefund(...args);
  };
  return { client, queries, releases };
}
function rejectToken(h: Awaited<ReturnType<typeof harness>>): void {
  h.dep.publisher = async value => { throw new SketchTokenPublicationRejectedError({ taskId: value.task.id,
    requestDigest: value.task.requestDigest!, leaseOwner: value.lease.owner, attemptCount: value.lease.attemptCount,
    leaseExpiresAt: value.lease.expiresAt }, 'SKETCH_TOKEN_USAGE_INVALID'); };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(() => { expect(vi.getTimerCount()).toBe(0); expect(abortTaskExecution('sketch-test')).toBe(false); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('HTTP integration execution projection and phase fences', () => {
  it('retains trusted bounded provider message/code on the original terminal task', async () => {
    const h = await harness();
    h.generation.analyze = async () => { throw new SketchProviderError('SKETCH_PROVIDER_REJECTED',
      { providerId: 'p1', modelId: 'vision-1', baseUrl: 'https://fixture.invalid', apiKey: 'secret', requestId: 'safe-req' },
      'analysis', 'safe-req', 429, 'quota_exceeded', 'safe bounded explanation'); };
    const outcome = await executeSketchTask(h.admission, context(), h.dep);
    expect(outcome.providerError).toMatchObject({ message: 'safe bounded explanation', providerCode: 'quota_exceeded' });
    expect(JSON.parse(h.task.error!)).toMatchObject({ message: 'safe bounded explanation', providerCode: 'quota_exceeded' });
  });
  it('writes phases under the original lease before adapters, not by elapsed time', async () => {
    const h = await harness(); const observed: number[] = [];
    const prepared = await prepareSketchCode(input, { ...h.generation,
      analyze: async (...args) => { observed.push(h.task.progress); return h.generation.analyze(...args); },
      reconstruct: async (...args) => { observed.push(h.task.progress); return h.generation.reconstruct(...args); },
    }, { actorUserId: 'user-a', signal: context().signal });
    h.admission.prepared = prepared;
    expect(await executeSketchTask(h.admission, context(), h.dep)).toEqual({ status: 'completed' });
    expect(observed).toEqual([10, 55]);
  });
  it.each(['unknown', 'lost'] as const)('phase %s cannot trigger a paid adapter or blind refund', async variant => {
    const h = await harness(); h.admission.prepared = await prepareSketchCode(input, h.generation, { actorUserId: 'user-a', signal: context().signal });
    const update = h.dep.updateCloudTask!;
    h.dep.updateCloudTask = async (...args) => {
      if (args[1].progress === 10) { if (variant === 'unknown') throw new Error('SQL secret'); return false; }
      return update(...args);
    };
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred');
    expect(h.stages).toEqual([]); expect(h.settlements).toEqual([]);
  });
});

describe('Token fix1 rejection query lifecycle', () => {
  it.each(['type', 'userId', 'projectId', 'providerId', 'model', 'requestDigest', 'idempotencyKey', 'leaseOwner',
    'attemptCount', 'leaseExpiresAt', 'access', 'version', 'route', 'pricing', 'creditCost'])(
    'rechecks locked %s rather than using the old trusted rejection as refund permission', async field => {
      const h = await harness(); const f = tokenFailureClient(h);
      h.dep.publisher = async value => {
        const rejection = new SketchTokenPublicationRejectedError({ taskId: value.task.id, requestDigest: value.task.requestDigest!,
          leaseOwner: value.lease.owner, attemptCount: value.lease.attemptCount, leaseExpiresAt: value.lease.expiresAt }, 'SKETCH_TOKEN_USAGE_INVALID');
        const meta = h.task.result!.sketchAdmission as Record<string, unknown>;
        if (field === 'access') meta.access = { ...access, ownerId: 'wrong' };
        else if (['version', 'route'].includes(field)) meta[field] = 'wrong';
        else if (field === 'pricing') meta.pricing = { mode: 'token' };
        else if (['attemptCount', 'leaseExpiresAt', 'creditCost'].includes(field)) Object.assign(h.task, { [field]: 2 });
        else Object.assign(h.task, { [field]: 'wrong' });
        throw rejection;
      };
      expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred');
      expect(h.settlements).toEqual([]); expect(h.task.creditStatus).toBe('pending');
      expect(f.queries.at(-1)).toBe('ROLLBACK'); expect(f.releases).toEqual([false]);
    });
  it.each(['BEGIN', 'SELECT * FROM cloud_tasks', 'SELECT p.owner_id', 'SELECT balance,total_used', 'FROM wujie_credit_transactions'])(
    'drains late %s to one terminal result before rollback/release and never sends a late refund', async blocked => {
      const h = await harness(); const entered = pending<void>(), finish = pending<void>(); let active = false;
      const f = tokenFailureClient(h, async sql => {
        expect(active).toBe(false);
        if (sql.includes(blocked)) { active = true; entered.resolve(); await finish.promise; active = false; }
      });
      rejectToken(h); const run = executeSketchTask(h.admission, context(), h.dep);
      await entered.promise; await vi.advanceTimersByTimeAsync(1001);
      expect(f.queries.at(-1)).toContain(blocked); expect(f.releases).toEqual([]); expect(h.settlements).toEqual([]);
      finish.resolve(); expect((await run).status).toBe('deferred');
      expect(f.queries.at(-1)).toBe('ROLLBACK'); expect(f.releases).toEqual([false]);
      expect(h.task.status).toBe('processing'); expect(h.task.creditStatus).toBe('pending');
    });
  it('disposes a late connection without starting BEGIN', async () => {
    const h = await harness(); const f = tokenFailureClient(h); const connection = pending<PoolClient>();
    h.dep.connect = () => connection.promise; rejectToken(h);
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(1001);
    expect(f.releases).toEqual([]); connection.resolve(f.client);
    expect((await run).status).toBe('deferred'); expect(f.queries).toEqual([]); expect(f.releases).toEqual([false]);
  });
  it.each(['COMMIT', 'ROLLBACK'])('discards on unknown %s without another settlement', async unknown => {
    const h = await harness(); const f = tokenFailureClient(h, async sql => {
      if (unknown === 'ROLLBACK' && sql.includes('SELECT balance,total_used')) throw new Error('Unknown credit read');
      if (sql === unknown) throw new Error('Unknown transaction acknowledgment');
    });
    rejectToken(h); expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred');
    expect(f.releases).toEqual([true]); expect(f.queries.at(-1)).toBe(unknown);
    expect(f.queries.filter(sql => sql.includes('WITH candidate AS'))).toHaveLength(unknown === 'COMMIT' ? 1 : 0);
    expect(h.task.creditStatus).toBe('pending');
  });
  it('rolls back a staged refund if abort arrives before the final DB-time fence', async () => {
    const h = await harness(), controller = new AbortController();
    const f = tokenFailureClient(h, async sql => { if (sql.includes('WITH candidate AS')) controller.abort(); });
    rejectToken(h); expect((await executeSketchTask(h.admission, { ...context(), signal: controller.signal }, h.dep)).status).toBe('deferred');
    expect(f.queries.at(-1)).toBe('ROLLBACK'); expect(f.queries).not.toContain('COMMIT');
    expect(h.task.creditStatus).toBe('pending'); expect(f.releases).toEqual([false]);
  });
});

describe('sketch guarded execution (storage/publisher seams, real computation and AbortScope)', () => {
  it('settles only a trusted confirmed Token rejection matching the full current lease', async () => {
    const h = await harness();
    const client = tokenFailureClient(h);
    h.dep.publisher = async value => { throw new SketchTokenPublicationRejectedError({ taskId: value.task.id,
      requestDigest: value.task.requestDigest!, leaseOwner: value.lease.owner, attemptCount: value.lease.attemptCount,
      leaseExpiresAt: value.lease.expiresAt }, 'SKETCH_TOKEN_USAGE_INVALID'); };
    const outcome = await executeSketchTask(h.admission, context(), h.dep);
    expect(outcome).toEqual({ status: 'failed', reason: 'SKETCH_TOKEN_USAGE_INVALID' });
    expect(h.task.status).toBe('failed'); expect(h.task.creditStatus).toBe('refunded');
    expect(h.settlements).toHaveLength(1);
    expect(client.queries.at(-1)).toBe('COMMIT'); expect(client.releases).toEqual([false]);
  });
  it.each(['taskId', 'requestDigest', 'leaseOwner', 'attemptCount', 'leaseExpiresAt', 'plain', 'code', 'read-unknown'] as const)(
    'never refunds a Token rejection with %s ambiguity or forged authority', async variant => {
      const h = await harness();
      const fixture = tokenFailureClient(h);
      const readTask = h.dep.getCloudTaskById!; let unknownRead = false;
      h.dep.getCloudTaskById = async taskId => { if (unknownRead) throw new Error('Unknown read'); return readTask(taskId); };
      h.dep.connect = async () => { if (unknownRead) throw new Error('Unknown locked read connection'); return fixture.client; };
      h.dep.publisher = async value => {
        const identity = { taskId: value.task.id, requestDigest: value.task.requestDigest!, leaseOwner: value.lease.owner,
          attemptCount: value.lease.attemptCount, leaseExpiresAt: value.lease.expiresAt };
        if (variant === 'taskId' || variant === 'leaseOwner') identity[variant] = 'different';
        if (variant === 'requestDigest') identity.requestDigest = 'a'.repeat(64);
        if (variant === 'attemptCount' || variant === 'leaseExpiresAt') identity[variant]++;
        if (variant === 'read-unknown') unknownRead = true;
        if (variant === 'plain') throw { ...identity, name: 'SketchTokenPublicationRejectedError', reason: 'SKETCH_TOKEN_USAGE_INVALID' };
        if (variant === 'code') throw { code: 'SKETCH_TOKEN_USAGE_INVALID', ...identity };
        throw new SketchTokenPublicationRejectedError(identity, 'SKETCH_TOKEN_USAGE_INVALID');
      };
      expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred');
      expect(h.settlements).toEqual([]); expect(h.task.creditStatus).toBe('pending');
    });
  it('publishes the real two-stage safe draft under a 180s random first lease', async () => {
    const h = await harness(); const result = await executeSketchTask(h.admission, context(), h.dep);
    expect(result.status).toBe('completed'); expect(h.stages).toEqual(['analysis', 'reconstruction']);
    expect(h.claims).toEqual([{ owner: expect.any(String), ttl: 180_000 }]); expect(h.claims[0].owner).not.toBe(h.task.id);
    expect(h.publications[0].draft.html).toContain('欢迎'); expect(h.publications[0].lease.attemptCount).toBe(1);
    expect(h.publications[0].input).toEqual(input); expect(h.publications[0].access).toEqual(access);
    expect(Object.isFrozen(h.publications[0].task.result?.sketchAdmission)).toBe(true);
    expect(h.task.result).toMatchObject({ previewAssetId: 'preview-1', htmlAssetId: 'html-1' }); expect(h.settlements).toEqual([]);
  });
  it('refuses a missing publisher before claim or compute', async () => {
    const h = await harness(); delete h.dep.publisher;
    expect(await executeSketchTask(h.admission, context(), h.dep)).toMatchObject({ status: 'deferred', reason: 'SKETCH_PUBLISHER_REQUIRED' });
    expect(h.claims).toEqual([]); expect(h.stages).toEqual([]); expect(h.settlements).toEqual([]);
  });
  it('does not execute a same-nonce replay even if a caller supplies a compute closure', async () => {
    const h = await harness(); h.admission.reused = true;
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('skipped');
    expect(h.claims).toEqual([]); expect(h.stages).toEqual([]);
  });
  it('refuses a new admission without a prepared compute closure', async () => {
    const h = await harness(); delete h.admission.prepared;
    expect(await executeSketchTask(h.admission, context(), h.dep)).toMatchObject({ status: 'deferred', reason: 'SKETCH_PREPARATION_REQUIRED' }); expect(h.claims).toEqual([]);
  });
  it.each(['completed', 'failed', 'cancelled', 'timeout'] as const)('does not touch a previously %s task', async status => {
    const h = await harness(); h.task.status = status; const snapshot = structuredClone(h.task);
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('skipped');
    expect(h.stages).toEqual([]); expect(h.claims).toEqual([]); expect(h.task).toEqual(snapshot);
  });
  it('refuses an absent persisted task', async () => {
    const h = await harness(); h.dep.getCloudTaskById = async () => null;
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('skipped'); expect(h.claims).toEqual([]);
  });
  it.each(['type', 'userId', 'projectId', 'providerId', 'model', 'requestDigest', 'idempotencyKey'] as const)('rejects durable %s drift before claiming', async field => {
    const h = await harness(); Object.assign(h.task, { [field]: 'other' });
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('skipped');
    expect(h.claims).toEqual([]); expect(h.stages).toEqual([]); expect(h.settlements).toEqual([]);
  });
  it.each(['actorUserId', 'ownerId', 'projectId', 'kind', 'grantGeneration', 'version', 'route', 'requestDigest'] as const)('rejects persisted admission access/metadata %s drift', async field => {
    const h = await harness(); const metadata = h.task.result!.sketchAdmission as Record<string, unknown>;
    if (['version', 'route', 'requestDigest'].includes(field)) metadata[field] = 'other';
    else (metadata.access as Record<string, unknown>)[field] = 'other';
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('skipped'); expect(h.claims).toEqual([]); expect(h.stages).toEqual([]);
  });
  it.each(['actorUserId', 'projectId'] as const)('requires the trusted dispatch %s to match the admission', async field => {
    const h = await harness(); expect((await executeSketchTask(h.admission, { ...context(), [field]: 'other' }, h.dep)).status).toBe('skipped');
    expect(h.claims).toEqual([]); expect(h.stages).toEqual([]);
  });
  it('freezes input/task/metadata before the first asynchronous read', async () => {
    const h = await harness(); const read = pending<PersistedCloudTask | null>(); let count = 0;
    h.dep.getCloudTaskById = async () => ++count === 1 ? read.promise : structuredClone(h.task);
    const run = executeSketchTask(h.admission, context(), h.dep);
    h.admission.task.userId = 'attacker'; (h.admission.task.result!.sketchAdmission as { access: { ownerId: string } }).access.ownerId = 'attacker';
    read.resolve(structuredClone(h.task)); expect((await run).status).toBe('completed'); expect(h.publications[0].access.ownerId).toBe('user-a');
  });
  it('lets concurrent executions claim only one compute without aborting the winner', async () => {
    const h = await harness(); const runs = await Promise.all([executeSketchTask(h.admission, context(), h.dep), executeSketchTask(h.admission, context(), h.dep)]);
    expect(runs.map(r => r.status).sort()).toEqual(['completed', 'skipped']); expect(h.computeSignals).toHaveLength(1); expect(h.publications).toHaveLength(1);
    expect(new Set(h.claims.map(c => c.owner)).size).toBe(h.claims.length);
  });
  it('does not claim an active lease or change its scope', async () => {
    const h = await harness(); h.task.leaseOwner = 'old-worker'; h.task.leaseExpiresAt = Date.now() + 180_000;
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('skipped'); expect(h.claims).toEqual([]); expect(h.computeSignals).toEqual([]);
  });
  it('rechecks task identity after claim before computing', async () => {
    const h = await harness(); const claim = h.dep.claimCloudTaskLease!;
    h.dep.claimCloudTaskLease = async (...args) => { const lease = await claim(...args); h.task.model = 'changed'; return lease; };
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred'); expect(h.claims).toHaveLength(1); expect(h.stages).toEqual([]); expect(h.settlements).toEqual([]);
  });
  it.each([1, 2])('never re-sends compute for a task with %i prior attempts', async count => {
    const h = await harness(); h.task.attemptCount = count;
    expect(await executeSketchTask(h.admission, context(), h.dep)).toMatchObject({ status: 'deferred', reason: 'SKETCH_EXECUTION_ALREADY_ATTEMPTED' }); expect(h.stages).toEqual([]);
  });
  it('refuses a claim that reports a second attempt even if the initial read was first', async () => {
    const h = await harness(); const claim = h.dep.claimCloudTaskLease!;
    h.dep.claimCloudTaskLease = async (...args) => { h.task.attemptCount = 1; return claim(...args); };
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred'); expect(h.claims).toHaveLength(1); expect(h.stages).toEqual([]);
  });
  it('settles a caller cancelled before computation only after acquiring its own lease', async () => {
    const h = await harness(); const controller = new AbortController(); controller.abort(new Error('secret'));
    expect((await executeSketchTask(h.admission, { ...context(), signal: controller.signal }, h.dep)).status).toBe('cancelled');
    expect(h.stages).toEqual([]); expect(h.settlements).toEqual([{ status: 'cancelled', reason: 'SKETCH_EXECUTION_CANCELLED', owner: h.claims[0].owner, requireActive: true }]);
  });
  it.each(['cancelled', 'failed'] as const)('observes cross-process %s during remote analysis, blocks late reconstruction', async status => {
    const h = await harness(); const remote = pending<unknown>(); h.generation.analyze = async () => { h.stages.push('analysis'); return remote.promise; };
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(0);
    h.task.status = status; await vi.advanceTimersByTimeAsync(1000);
    expect((await run).status).toBe('deferred'); expect(h.computeSignals[0].aborted).toBe(true);
    remote.resolve(JSON.stringify({ summary: 'late', layout: 'late', controls: [], text: [] })); await vi.advanceTimersByTimeAsync(0);
    expect(h.stages).toEqual(['analysis']); expect(h.publications).toEqual([]); expect(h.settlements).toEqual([]);
  });
  it.each(['owner', 'attempt', 'expiry', 'expiry-extended'] as const)('aborts computation after lease %s changes', async change => {
    const h = await harness(); h.generation.analyze = async () => new Promise(() => {});
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(0);
    if (change === 'owner') h.task.leaseOwner = 'other';
    if (change === 'attempt') h.task.attemptCount = 2;
    if (change === 'expiry') h.task.leaseExpiresAt = Date.now();
    if (change === 'expiry-extended') h.task.leaseExpiresAt! += 1;
    await vi.advanceTimersByTimeAsync(1000); expect((await run).status).toBe('deferred');
    expect(h.computeSignals[0].aborted).toBe(true); expect(h.publications).toEqual([]); expect(h.settlements).toEqual([]);
  });
  it.each(['reject', 'hang'] as const)('stops on a %s monitoring read without stacking or publishing', async failure => {
    const h = await harness(); h.generation.analyze = async () => new Promise(() => {}); let reads = 0;
    h.dep.getCloudTaskById = async () => { reads += 1; if (reads > 2) { if (failure === 'reject') throw new Error('private-db'); return new Promise(() => {}); } return structuredClone(h.task); };
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(2000);
    expect((await run).status).toBe('deferred'); expect(reads).toBe(3); expect(h.computeSignals[0].aborted).toBe(true); expect(h.settlements).toEqual([]);
  });
  it('returns from an initial hung read with no lease, compute or leftover timer', async () => {
    const h = await harness(); h.dep.getCloudTaskById = async () => new Promise(() => {});
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(1000);
    expect(await run).toMatchObject({ status: 'deferred', reason: 'SKETCH_TASK_UNAVAILABLE' }); expect(h.claims).toEqual([]); expect(h.stages).toEqual([]);
  });
  it('does not retry a lease claim whose commit acknowledgement is lost', async () => {
    const h = await harness(); const claim = h.dep.claimCloudTaskLease!;
    h.dep.claimCloudTaskLease = async (...args) => { await claim(...args); throw new Error('commit-secret'); };
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred'); expect(h.claims).toHaveLength(1); expect(h.stages).toEqual([]); expect(h.settlements).toEqual([]);
  });
  it('settles the real 60s remote-stage timeout via the owner-conditional unique refund port', async () => {
    const h = await harness(); h.generation.analyze = async () => new Promise(() => {});
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(60_000);
    expect((await run).status).toBe('timeout'); expect(h.task.creditStatus).toBe('refunded');
    expect(h.settlements).toEqual([{ status: 'timeout', reason: 'SKETCH_EXECUTION_TIMEOUT', owner: h.claims[0].owner, requireActive: true }]); expect(h.publications).toEqual([]);
  });
  it('bounds a compute ignoring its signal at 120s and ignores late rejection', async () => {
    const h = await harness(); const compute = pending<Awaited<ReturnType<NonNullable<SketchTaskAdmission['prepared']>['compute']>>>();
    h.admission.prepared = { ...h.admission.prepared!, compute: async signal => { h.computeSignals.push(signal); return compute.promise; } };
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(120_000);
    expect((await run).status).toBe('timeout'); expect(h.computeSignals[0].aborted).toBe(true); compute.reject(new Error('late secret')); await vi.advanceTimersByTimeAsync(0);
    expect(h.publications).toEqual([]); expect(h.settlements).toHaveLength(1);
  });
  it('uses the original local AbortScope and removes inherited listeners on cancellation', async () => {
    const h = await harness(); h.generation.analyze = async () => new Promise(() => {});
    const ctx = context(); const add = vi.spyOn(ctx.signal, 'addEventListener'); const remove = vi.spyOn(ctx.signal, 'removeEventListener');
    const run = executeSketchTask(h.admission, ctx, h.dep); await vi.advanceTimersByTimeAsync(0);
    expect(abortTaskExecution('sketch-test', 'cancelled')).toBe(true);
    expect((await run).status).toBe('cancelled'); expect(h.task.creditStatus).toBe('refunded'); expect(add.mock.calls.length).toBe(remove.mock.calls.length);
  });
  it('keeps unknown errors out of storage and the returned outcome', async () => {
    const h = await harness(); h.generation.analyze = async () => { throw new Error(`credential-secret ${input.imageDataUrl} ${input.instruction}`); };
    const result = await executeSketchTask(h.admission, context(), h.dep);
    expect(result).toMatchObject({ status: 'failed', reason: 'SKETCH_EXECUTION_FAILED' }); expect(h.settlements[0].reason).toBe('SKETCH_EXECUTION_FAILED');
    expect(JSON.stringify(result)).not.toContain('credential-secret'); expect(JSON.stringify(h.settlements)).not.toContain(input.imageDataUrl);
  });
  it('retains trusted safe provider message/code with phase/status/request/model diagnostics', async () => {
    const h = await harness(); h.generation.analyze = async () => { throw new SketchProviderError('SKETCH_PROVIDER_REJECTED',
      { providerId: 'p1', modelId: 'vision-1', apiKey: 'secret', baseUrl: 'https://invalid', requestId: 'req-local' }, 'analysis', 'req-safe', 429, 'quota', 'safe provider message'); };
    const result = await executeSketchTask(h.admission, context(), h.dep);
    expect(result).toMatchObject({ status: 'failed', providerError: { code: 'SKETCH_PROVIDER_REJECTED', phase: 'analysis', providerStatus: 429, requestId: 'req-safe', providerId: 'p1', modelId: 'vision-1' } });
    expect(h.settlements[0].reason).toContain('req-safe');
    expect(JSON.parse(h.settlements[0].reason)).toMatchObject({ message: 'safe provider message', providerCode: 'quota' });
  });
  it('defers if progress update is rejected rather than computing without its fence', async () => {
    const h = await harness(); h.dep.updateCloudTask = async () => false;
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred'); expect(h.claims).toHaveLength(1); expect(h.stages).toEqual([]); expect(h.settlements).toEqual([]);
  });
  it('does not label a declined publisher completed or write a draft as a result', async () => {
    const h = await harness(); h.dep.publisher = async publication => { h.publications.push(publication); return false; };
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred'); expect(h.publications).toHaveLength(1); expect(h.task.status).toBe('processing');
    expect(h.settlements).toEqual([]); expect(h.updates.every(u => !(u as { result?: unknown }).result)).toBe(true);
  });
  it('bounds a hung publisher at the 150s global deadline without refunding an unknown commit', async () => {
    const h = await harness(); const publish = pending<boolean>(); h.dep.publisher = async publication => { h.publications.push(publication); return publish.promise; };
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(149_999);
    expect(h.publications).toHaveLength(1); expect(h.publications[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect((await run).status).toBe('deferred'); expect(h.publications[0].signal.aborted).toBe(true);
    publish.resolve(true); await vi.advanceTimersByTimeAsync(0); expect(h.settlements).toEqual([]); expect(h.task.status).toBe('processing');
  });
  it('preserves a publisher commit when its acknowledgement throws', async () => {
    const h = await harness(); const publish = h.dep.publisher!;
    h.dep.publisher = async publication => { await publish(publication); throw new Error('commit-secret'); };
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred'); expect(h.task.status).toBe('completed'); expect(h.task.creditStatus).toBe('pending'); expect(h.settlements).toEqual([]);
  });
  it('requires durable asset-backed completion after publisher true', async () => {
    const h = await harness(); h.dep.publisher = async publication => { h.publications.push(publication); return true; };
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred'); expect(h.publications).toHaveLength(1); expect(h.settlements).toEqual([]);
  });
  it('preserves completed if the final confirmation read fails', async () => {
    const h = await harness(); h.dep.getCloudTaskById = async () => { if (h.task.status === 'completed') throw new Error('db-secret'); return structuredClone(h.task); };
    expect((await executeSketchTask(h.admission, context(), h.dep)).status).toBe('deferred'); expect(h.task.status).toBe('completed'); expect(h.settlements).toEqual([]);
  });
  it('does not accept a late publisher after a lease replacement', async () => {
    const h = await harness(); const publish = pending<boolean>(); h.dep.publisher = async publication => { h.publications.push(publication); return publish.promise; };
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(0); h.task.leaseOwner = 'new-worker';
    await vi.advanceTimersByTimeAsync(1000); expect((await run).status).toBe('deferred'); expect(h.publications).toHaveLength(1); expect(h.publications[0].signal.aborted).toBe(true); publish.resolve(true); await vi.advanceTimersByTimeAsync(0); expect(h.settlements).toEqual([]);
  });
  it('does not hang or retry when the unique refund acknowledgement is lost', async () => {
    const h = await harness(); h.generation.analyze = async () => { throw new Error('secret'); };
    const settle = h.dep.terminateCloudTaskAndRefund!;
    h.dep.terminateCloudTaskAndRefund = async (...args) => { await settle(...args); return new Promise(() => {}); };
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(1000);
    expect((await run).status).toBe('deferred'); expect(h.settlements).toHaveLength(1); expect(h.task.creditStatus).toBe('refunded');
  });
  it('settles caller cancellation in the compute-to-publication read window', async () => {
    const h = await harness(); const controller = new AbortController(); let reads = 0;
    h.dep.getCloudTaskById = async () => {
      reads += 1; if (reads === 3) controller.abort('cancelled'); return structuredClone(h.task);
    };
    const result = await executeSketchTask(h.admission, { ...context(), signal: controller.signal }, h.dep);
    expect(result.status).toBe('cancelled'); expect(h.task.status).toBe('cancelled'); expect(h.task.creditStatus).toBe('refunded');
    expect(h.publications).toEqual([]); expect(h.settlements).toHaveLength(1);
  });
  it('takes no refund authority from a replaced local AbortScope', async () => {
    const h = await harness(); h.generation.analyze = async () => new Promise(() => {});
    const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(0);
    abortTaskExecution(h.task.id, 'replaced');
    expect((await run).status).toBe('deferred'); expect(h.task.status).toBe('processing'); expect(h.settlements).toEqual([]);
  });
  it('keeps the native publisher signal cancellable and cleans the original scope', async () => {
    const h = await harness(); const publish = pending<boolean>(); const controller = new AbortController();
    h.dep.publisher = async publication => { h.publications.push(publication); return publish.promise; };
    const run = executeSketchTask(h.admission, { ...context(), signal: controller.signal }, h.dep); await vi.advanceTimersByTimeAsync(0);
    expect(h.publications).toHaveLength(1);
    expect(() => abortTaskExecution(h.task.id, 'cancelled')).not.toThrow();
    expect(Object.isFrozen(h.publications[0].signal)).toBe(false);
    expect((await run).status).toBe('deferred'); expect(h.publications[0].signal.aborted).toBe(true);
    publish.resolve(false); await vi.advanceTimersByTimeAsync(0);
    expect(abortTaskExecution(h.task.id)).toBe(false); expect(h.settlements).toEqual([]);
  });
  it.each(['caller', 'local'] as const)('fix1 I2 keeps the underlying shared monitor/publication read unknown on %s cancellation', async source => {
    const h = await harness(); const controller = new AbortController(); const remote = pending<unknown>();
    const databaseRead = pending<PersistedCloudTask | null>(); let reads = 0;
    h.generation.analyze = async () => remote.promise;
    h.dep.getCloudTaskById = async () => { reads += 1; return reads === 3 ? databaseRead.promise : structuredClone(h.task); };
    const run = executeSketchTask(h.admission, { ...context(), signal: controller.signal }, h.dep);
    await vi.advanceTimersByTimeAsync(1000); expect(reads).toBe(3);
    remote.resolve(JSON.stringify({ summary: '登录', layout: '垂直', controls: [], text: [] }));
    await vi.advanceTimersByTimeAsync(0); expect(h.stages).toEqual(['reconstruction']); expect(h.publications).toEqual([]);
    if (source === 'caller') controller.abort('cancelled'); else abortTaskExecution(h.task.id, 'cancelled');
    await vi.advanceTimersByTimeAsync(1000);
    const result = await run;
    expect(result.status).toBe('deferred'); expect(reads).toBe(3); expect(h.settlements).toEqual([]); expect(h.task.creditStatus).toBe('pending');
    databaseRead.resolve(structuredClone(h.task)); await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(3); expect(h.publications).toEqual([]); expect(h.settlements).toEqual([]);
  });
  it.each(['execution', 'recovery'] as const)('fix1 I1 sends complete opt-in settlement eligibility for %s', async entry => {
    const h = await harness(); let options: Parameters<typeof terminateCloudTaskAndRefund>[4];
    const settle = h.dep.terminateCloudTaskAndRefund!;
    h.dep.terminateCloudTaskAndRefund = async (...args) => { options = args[4]; return settle(...args); };
    h.generation.analyze = async () => { throw new Error('safe fixture failure'); };
    if (entry === 'recovery') h.task.createdAt -= 180_001;
    const started = Date.now();
    const result = entry === 'execution' ? await executeSketchTask(h.admission, context(), h.dep)
      : await recoverExpiredSketchTask(h.task.id, h.identity, h.dep);
    expect(result.status).toBe(entry === 'execution' ? 'failed' : 'timeout');
    expect(options).toMatchObject({ requireActive: true, expectedSketchExecution: {
      actorUserId: 'user-a', projectId: 'project-a', providerId: 'p1', modelId: 'vision-1', requestDigest: digest,
      idempotencyKey: 'nonce-1', access, leaseOwner: h.claims[0].owner, attemptCount: 1,
      leaseExpiresAt: started + 180_000, settleBefore: started + 1000,
    } });
  });
  it.each(['deadline', 'expiry', 'attempt', 'owner', 'actor', 'project', 'model', 'digest', 'nonce', 'access'] as const)(
    'fix1 I1 delayed settlement cannot act after %s changes', async change => {
      const h = await harness(); const delayed = pending<void>(); let fence: SketchTaskSettlementFence | undefined;
      const settle = h.dep.terminateCloudTaskAndRefund!;
      h.generation.analyze = async () => { throw new Error('safe fixture failure'); };
      h.dep.terminateCloudTaskAndRefund = async (...args) => {
        fence = args[4]?.expectedSketchExecution; await delayed.promise;
        if (fence && (Date.now() >= fence.settleBefore || h.task.leaseExpiresAt !== fence.leaseExpiresAt
          || Date.now() >= fence.leaseExpiresAt || h.task.leaseOwner !== fence.leaseOwner || h.task.attemptCount !== fence.attemptCount
          || h.task.userId !== fence.actorUserId || h.task.projectId !== fence.projectId || h.task.model !== fence.modelId
          || h.task.requestDigest !== fence.requestDigest || h.task.idempotencyKey !== fence.idempotencyKey
          || JSON.stringify((h.task.result!.sketchAdmission as { access: unknown }).access) !== JSON.stringify(fence.access))) {
          return { transitioned: false, refunded: false, creditCost: 0 };
        }
        return settle(...args);
      };
      const run = executeSketchTask(h.admission, context(), h.dep); await vi.advanceTimersByTimeAsync(0);
      if (change === 'expiry') h.task.leaseExpiresAt = Date.now();
      if (change === 'attempt') h.task.attemptCount = 2;
      if (change === 'owner') h.task.leaseOwner = 'another';
      if (change === 'actor') h.task.userId = 'another';
      if (change === 'project') h.task.projectId = 'another';
      if (change === 'model') h.task.model = 'another';
      if (change === 'digest') h.task.requestDigest = 'a'.repeat(64);
      if (change === 'nonce') h.task.idempotencyKey = 'another';
      if (change === 'access') (h.task.result!.sketchAdmission as { access: { ownerId: string } }).access.ownerId = 'another';
      const before = structuredClone(h.task);
      await vi.advanceTimersByTimeAsync(1000); expect((await run).status).toBe('deferred');
      delayed.resolve(undefined); await vi.advanceTimersByTimeAsync(0);
      expect(h.task).toEqual(before); expect(fence).toBeDefined(); expect(h.publications).toEqual([]);
    });
});

describe('fix1 I1 original settlement opt-in validation', () => {
  const validFence = (): SketchTaskSettlementFence => ({ actorUserId: 'user-a', projectId: 'project-a', providerId: 'p1',
    modelId: 'vision-1', requestDigest: digest, idempotencyKey: 'nonce-1', access, leaseOwner: 'worker-safe', attemptCount: 1,
    leaseExpiresAt: Date.now() + 180_000, settleBefore: Date.now() + 1000 });
  it.each(['undefined', 'null', 'actor', 'project', 'provider', 'model', 'digest', 'nonce', 'owner', 'attempt', 'expiry', 'deadline', 'access', 'scope-actor'] as const)(
    'rejects explicitly requested but invalid %s fence before any SQL settlement', async invalid => {
      const query = vi.fn(async () => ({ rows: [{ transitioned: true, refunded: true, status: 'failed', credit_cost: 14 }] }));
      const fence: Record<string, unknown> = { ...validFence() };
      const fields = { actor: 'actorUserId', project: 'projectId', provider: 'providerId', model: 'modelId', digest: 'requestDigest', nonce: 'idempotencyKey', owner: 'leaseOwner', attempt: 'attemptCount', expiry: 'leaseExpiresAt', deadline: 'settleBefore', access: 'access' };
      if (invalid in fields) fence[fields[invalid as keyof typeof fields]] = '';
      if (invalid === 'scope-actor') fence.access = { ...access, actorUserId: 'another' };
      const option = invalid === 'undefined' ? undefined : invalid === 'null' ? null : fence;
      const result = await terminateCloudTaskAndRefund('sketch-test', 'failed', 'safe', 'worker-safe', {
        requireActive: true, client: { query } as unknown as PoolClient, expectedSketchExecution: option as unknown as SketchTaskSettlementFence,
      });
      expect(result).toMatchObject({ transitioned: false, refunded: false }); expect(query).not.toHaveBeenCalled();
    });
});

describe('expired sketch reclamation (no compute recovery or provider dispatch)', () => {
  it('competes for an expired lease and settles timeout once for the exact identity', async () => {
    const h = await harness(); h.task.createdAt -= 180_001; h.task.attemptCount = 1; h.task.leaseOwner = 'old'; h.task.leaseExpiresAt = Date.now() - 1;
    const results = await Promise.all([recoverExpiredSketchTask(h.task.id, h.identity, h.dep), recoverExpiredSketchTask(h.task.id, h.identity, h.dep)]);
    expect(results.filter(r => r.status === 'timeout')).toHaveLength(1); expect(h.task.creditStatus).toBe('refunded'); expect(h.settlements).toHaveLength(1); expect(h.stages).toEqual([]);
  });
  it.each(['active', 'young', 'boundary', 'terminal', 'other-user', 'other-project', 'other-type', 'other-model', 'other-access', 'other-digest'] as const)('leaves %s task unchanged', async kind => {
    const h = await harness(); h.task.createdAt -= 180_001;
    if (kind === 'active') h.task.leaseExpiresAt = Date.now() + 1;
    if (kind === 'young') h.task.createdAt = Date.now() - 179_999;
    if (kind === 'boundary') h.task.createdAt = Date.now() - 180_000;
    if (kind === 'terminal') h.task.status = 'completed';
    if (kind === 'other-user') h.task.userId = 'other';
    if (kind === 'other-project') h.task.projectId = 'other';
    if (kind === 'other-type') h.task.type = 'generate';
    if (kind === 'other-model') h.task.model = 'other';
    if (kind === 'other-digest') h.task.requestDigest = 'other';
    if (kind === 'other-access') (h.task.result!.sketchAdmission as { access: { ownerId: string } }).access.ownerId = 'other';
    const before = structuredClone(h.task); expect((await recoverExpiredSketchTask(h.task.id, h.identity, h.dep)).status).toBe('skipped');
    expect(h.task).toEqual(before); expect(h.claims).toEqual([]); expect(h.settlements).toEqual([]);
  });
  it('returns safely from a hung recovery read', async () => {
    const h = await harness(); h.dep.getCloudTaskById = async () => new Promise(() => {});
    const run = recoverExpiredSketchTask(h.task.id, h.identity, h.dep); await vi.advanceTimersByTimeAsync(1000);
    expect(await run).toMatchObject({ status: 'deferred', reason: 'SKETCH_TASK_UNAVAILABLE' }); expect(h.claims).toEqual([]);
  });
});
