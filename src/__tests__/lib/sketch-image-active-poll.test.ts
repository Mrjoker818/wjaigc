/**
 * UNEXECUTED REGRESSION DRAFT. Kept outside the frozen original suite's includes.
 * Target: the actual pollSketchImageTask, identity reader and checkpoint parser.
 * Only external repositories/effects are replaced; no classifier is mocked.
 *
 * Worker protocol: claim precedes compute/beforePhase('analysis'); the first
 * claim is attempt 1 with owner `sketch-image:${randomUUID()}` and a 660000ms
 * lease. Intermediate checkpoints are analysis -> analysis-complete ->
 * generation. Only accepted carries a durable, binding-validated receipt.
 *
 * Expected regression: the four live first-attempt states currently return
 * needsReconcile=true just because their checkpoint is absent/nonaccepted.
 * Polling those states must remain observational, without recovery or POSTs.
 * Accepted recovery deliberately retains the original old-worker compatibility.
 *
 * Future execution: after authorization, make this file discoverable in an
 * isolated Vitest copy/config with the existing @ -> src alias, and select only
 * this file. No production, original-test, configuration, guard or pin edits
 * are part of this draft. No runtime RED/passing claim has been established.
 */
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import type { SketchImageInput } from '@/lib/sketch-to-code/image-contract';
import { readSketchImageCheckpoint } from '@/lib/sketch-to-code/image-execution';
import type { SketchImagePricing } from '@/lib/sketch-to-code/image-pricing';
import { pollSketchImageTask, type SketchImagePublicHttpDependencies } from '@/lib/sketch-to-code/image-public-http';
import { readSketchImageTaskIdentity } from '@/lib/sketch-to-code/image-task-state';

const forbidden = vi.hoisted(() => {
  const effects: string[] = [];
  const deny = (name: string): (() => never) => () => {
    effects.push(name);
    throw new Error(`Unexpected external effect: ${name}`);
  };
  return {
    effects,
    pool: deny('database-pool'), sql: deny('database-query'),
    taskRead: deny('unprovided-task-repository'), claim: deny('lease-claim'),
    bill: deny('billable-task'), settle: deny('failure-settlement'),
    readResult: deny('protected-result-read'), cancelTransaction: deny('cancellation-transaction'),
    abort: deny('memory-abort'), cancel: deny('memory-cancel'), update: deny('memory-update'),
    markDurable: deny('memory-mark-durable'), after: deny('uncaptured-background-schedule'),
    recover: deny('inline-worker-recovery'), transport: deny('provider-transport'),
  };
});
vi.mock('server-only', () => ({}));
vi.mock('next/server', async original => ({
  ...(await original<Record<string, unknown>>()), after: forbidden.after,
}));
vi.mock('@/lib/db-client', async original => ({
  ...(await original<Record<string, unknown>>()),
  getPool: forbidden.pool, getAdvisoryLockPool: forbidden.pool, execSql: forbidden.sql,
}));
vi.mock('@/lib/cloud-task-storage', async original => ({
  ...(await original<Record<string, unknown>>()),
  getCloudTaskById: forbidden.taskRead,
  getCloudTaskForUserByIdempotencyKey: forbidden.taskRead,
  claimCloudTaskLease: forbidden.claim,
  createBillableCloudTask: forbidden.bill,
  settleFailedCloudTask: forbidden.settle,
}));
vi.mock('@/lib/sketch-to-code/image-result', () => ({ readSketchImageResult: forbidden.readResult }));
vi.mock('@/lib/sketch-to-code/image-task-http', () => ({ cancelSketchImageTransaction: forbidden.cancelTransaction }));
vi.mock('@/lib/task-registry', () => ({
  abortTaskExecution: forbidden.abort, cancelTask: forbidden.cancel,
  updateTaskProgress: forbidden.update, markTaskDurable: forbidden.markDurable,
}));
vi.mock('@/lib/sketch-to-code/image-service', () => ({ recoverConfiguredSketchImageTask: forbidden.recover }));

// Date.now is the public scheduling clock, not a substitute for the worker's
// post-lock DB clock. No timers, sleeps or timeout changes are needed here.
const NOW = 1_800_000_000_000;
const LEASE_EXPIRY = NOW + 660_000;
const ACTOR = 'actor';
const REQUEST_ID = 'active-poll-request';
const BODY = { taskId: 'skimg_active_poll', projectId: 'project-a' };
const WORKER_OWNER = 'sketch-image:01234567-89ab-4cde-8fab-0123456789ab';
const PNG = createCanvas(8, 8).toDataURL('image/png');
const ROUTING = { vision: '1'.repeat(64), image: '2'.repeat(64) };
const ANALYSIS = {
  summary: 'private-木屋', composition: 'private-木屋左海右',
  prompt: 'private-水彩海边木屋', negativePrompt: 'private-水印',
};
const USAGE = { inputTokens: 2, outputTokens: 3 };
const RECEIPT = {
  taskIds: ['private-remote'], directImageUrls: [], usedModel: 'im', usedProviderId: 'ip',
};
type Stage = 'claimed' | 'analysis' | 'analysis-complete' | 'generation' | 'accepted';
type PriceMode = 'flat' | 'token' | 'free';
type ScheduleMode = 'ack' | 'decline' | 'throw';
interface Fixture {
  task: PersistedCloudTask;
  deps: SketchImagePublicHttpDependencies;
  readTask: (taskId: string) => Promise<PersistedCloudTask | null>;
  scheduled: Array<{ task: PersistedCloudTask; requestId: string }>;
}

beforeEach(() => {
  forbidden.effects.length = 0;
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubGlobal('fetch', forbidden.transport);
});
afterEach(() => {
  try { expect(forbidden.effects).toEqual([]); }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

function checkpoint(stage: Exclude<Stage, 'claimed'>): Record<string, unknown> {
  if (stage === 'analysis') return { version: 1, phase: 'analysis', routing: structuredClone(ROUTING) };
  return {
    version: 1, phase: stage, routing: structuredClone(ROUTING),
    analysis: structuredClone(ANALYSIS), usage: structuredClone(USAGE),
    ...(stage === 'accepted' ? { receipt: structuredClone(RECEIPT) } : {}),
  };
}
function fixture(stage: Stage, priceMode: PriceMode = 'flat', scheduleMode: ScheduleMode = 'ack'): Fixture {
  const input: SketchImageInput = {
    projectId: BODY.projectId, imageDataUrl: PNG, instruction: 'private-original-keywords',
    visionProviderId: 'vp', visionModelId: 'vm', imageProviderId: 'ip', imageModelId: 'im',
    idempotencyKey: 'private-nonce', aspectRatio: '1:1',
  };
  const pricing: SketchImagePricing = {
    version: 1,
    vision: {
      providerId: 'vp', modelId: 'vm', calls: 1,
      mode: priceMode === 'token' ? 'token' : 'flat', reserveCredits: priceMode === 'free' ? 0 : 7,
      ...(priceMode === 'token' ? { tokenPricing: { input: 1000, output: 2000 } } : {}),
    },
    image: { providerId: 'ip', modelId: 'im', calls: 1, credits: priceMode === 'free' ? 0 : 11 },
    totalReserveCredits: priceMode === 'free' ? 0 : 18,
  };
  const digest = sketchImageRequestDigest(input);
  const progress = { claimed: 0, analysis: 10, 'analysis-complete': 35, generation: 55, accepted: 70 }[stage];
  const task: PersistedCloudTask = {
    id: BODY.taskId, type: 'sketch-to-image', userId: ACTOR, projectId: BODY.projectId,
    providerId: 'ip', model: 'im', status: 'processing', progress, revision: 1,
    createdAt: NOW - 1000, updatedAt: NOW,
    leaseOwner: WORKER_OWNER, leaseExpiresAt: LEASE_EXPIRY, attemptCount: 1,
    creditCost: pricing.totalReserveCredits, creditStatus: priceMode === 'free' ? 'not-applicable' : 'pending',
    chargedTransactionId: priceMode === 'free' ? undefined : createTaskBillingTransactionId('charge', BODY.taskId),
    idempotencyKey: input.idempotencyKey, requestDigest: digest,
    label: 'private-worker-label',
    result: {
      sketchImageAdmission: {
        version: 1, route: '/api/sketch-to-image', requestDigest: digest, input, pricing,
        access: { kind: 'document', actorUserId: ACTOR, projectId: BODY.projectId, ownerId: 'owner', grantGeneration: '1' },
      },
      ...(stage === 'claimed' ? {} : { sketchImageExecution: checkpoint(stage) }),
    },
  };
  const scheduled: Fixture['scheduled'] = [];
  // Match the real repository contract: a cloned durable candidate or null;
  // no worker/classification/authorization behavior lives in this fake.
  const readTask: Fixture['readTask'] = async taskId => taskId === task.id ? structuredClone(task) : null;
  const deps: SketchImagePublicHttpDependencies = {
    getTask: readTask,
    readResult: forbidden.readResult, cancelTransaction: forbidden.cancelTransaction,
    abortMemory: forbidden.abort, cancelMemory: forbidden.cancel, updateMemory: forbidden.update,
    scheduleRecovery: (candidate, requestId): boolean => {
      scheduled.push({ task: structuredClone(candidate), requestId });
      if (scheduleMode === 'throw') throw new Error('private-scheduling-ack-lost');
      return scheduleMode === 'ack';
    },
  };
  return { task, deps, readTask, scheduled };
}
function execution(f: Fixture): Record<string, unknown> {
  return f.task.result!.sketchImageExecution as Record<string, unknown>;
}
async function poll(f: Fixture, body: unknown = BODY, actorUserId: string = ACTOR): Promise<{
  status: number; json: Record<string, unknown>;
}> {
  const stored = structuredClone(f.task);
  const candidate = await f.readTask(BODY.taskId);
  const response = await pollSketchImageTask(body, candidate, actorUserId, REQUEST_ID, f.deps);
  expect(f.task).toEqual(stored);
  expect(candidate).toEqual(stored);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-request-id')).toBe(REQUEST_ID);
  const json = await response.json() as Record<string, unknown>;
  // Same privacy boundary as the original public HTTP tests. The intermediate
  // analysis, original PNG/keywords, routing, owner and receipt stay private.
  expect(JSON.stringify(json)).not.toMatch(/private-|imageDataUrl|instruction|idempotencyKey|requestDigest|grantGeneration|sketchImageAdmission|sketchImageExecution|receipt|routing|remoteTaskId|chargedTransactionId|refundedTransactionId|inputTokens|leaseOwner|leaseExpiresAt|attemptCount/);
  expect(json).not.toHaveProperty('phase');
  return { status: response.status, json };
}
function expectPending(result: Awaited<ReturnType<typeof poll>>, needsReconcile: boolean, recoveryPending = false): void {
  expect(result.status).toBe(202);
  expect(result.json).toMatchObject({
    success: true, taskId: BODY.taskId, projectId: BODY.projectId, type: 'sketch-to-image', status: 'processing',
    visionProviderId: 'vp', visionModelId: 'vm', imageProviderId: 'ip', imageModelId: 'im',
    needsReconcile, recoveryPending,
  });
  expect(result.json).not.toHaveProperty('error');
  expect(result.json).not.toHaveProperty('imageUrl');
  expect(result.json).not.toHaveProperty('previewUrl');
  expect(result.json).not.toHaveProperty('actualCredits');
  expect(result.json).not.toHaveProperty('refunded');
}

describe('original active first-attempt polling stays observable through every worker phase', () => {
  // Break caught: classifying a valid original worker as uncertain solely because
  // it has not yet persisted an accepted provider receipt freezes client polling.
  it.each(['claimed', 'analysis', 'analysis-complete', 'generation', 'accepted'] as const)(
    '%s with the original live lease remains pending without reconciliation', async stage => {
      const f = fixture(stage);
      const parsed = readSketchImageCheckpoint(f.task.result!.sketchImageExecution, readSketchImageTaskIdentity(f.task, ACTOR));
      if (stage === 'claimed') expect(parsed).toBeUndefined();
      else expect(parsed?.phase).toBe(stage);
      const result = await poll(f);
      expectPending(result, false);
      expect(result.json.progress).toBe({ claimed: 0, analysis: 10, 'analysis-complete': 35, generation: 55, accepted: 70 }[stage]);
      expect(result.json.reserveCredits).toBe(18);
      expect(f.scheduled).toEqual([]);
    },
  );
  it.each(['analysis-complete', 'generation'] as const)('real token usage keeps live %s observable', async stage => {
    const f = fixture(stage, 'token');
    expect(() => readSketchImageCheckpoint(execution(f), readSketchImageTaskIdentity(f.task))).not.toThrow();
    expectPending(await poll(f), false);
    expect(f.scheduled).toEqual([]);
  });
  it('a free original generation remains observable without financial initialization', async () => {
    const f = fixture('generation', 'free'), result = await poll(f);
    expectPending(result, false); expect(result.json.reserveCredits).toBe(0);
    expect(f.scheduled).toEqual([]);
  });
  it('the same generation snapshot changes to reconciliation at exact lease expiry', async () => {
    const f = fixture('generation');
    vi.spyOn(Date, 'now').mockReturnValue(LEASE_EXPIRY - 1);
    expectPending(await poll(f), false);
    vi.spyOn(Date, 'now').mockReturnValue(LEASE_EXPIRY);
    expectPending(await poll(f), true);
    expect(f.scheduled).toEqual([]);
  });
});

describe('unknown attempts, invalid leases and expired intermediate work stay uncertain', () => {
  it.each(['claimed', 'analysis', 'analysis-complete', 'generation'] as const)(
    'expired %s cannot authorize recovery or another paid attempt', async stage => {
      const f = fixture(stage); f.task.leaseExpiresAt = NOW - 1;
      expectPending(await poll(f), true); expect(f.scheduled).toEqual([]);
    },
  );
  // Malformed values deliberately cross the public unknown boundary; they must
  // not become valid merely because status=processing or a lease is in future.
  const invalidLeases: ReadonlyArray<{ name: string; changes: Record<string, unknown> }> = [
    { name: 'undispatched attempt 0', changes: { leaseOwner: '', leaseExpiresAt: 0, attemptCount: 0 } },
    { name: 'foreign worker owner', changes: { leaseOwner: 'old-worker' } },
    { name: 'missing worker owner', changes: { leaseOwner: undefined } },
    { name: 'empty worker owner', changes: { leaseOwner: '' } },
    { name: 'non-UUID original-worker suffix', changes: { leaseOwner: 'sketch-image:foreign-worker' } },
    { name: 'non-hex UUID suffix', changes: { leaseOwner: 'sketch-image:01234567-89ab-4cde-8fab-0123456789az' } },
    { name: 'worker owner trailing data', changes: { leaseOwner: `${WORKER_OWNER}:extra` } },
    { name: 'future attempt 0', changes: { attemptCount: 0 } },
    { name: 'attempt 2 without accepted receipt', changes: { attemptCount: 2 } },
    { name: 'missing attempt', changes: { attemptCount: undefined } },
    { name: 'fractional attempt', changes: { attemptCount: 1.5 } },
    { name: 'string attempt', changes: { attemptCount: '1' } },
    { name: 'missing expiry', changes: { leaseExpiresAt: undefined } },
    { name: 'nonfinite expiry', changes: { leaseExpiresAt: NaN } },
    { name: 'unsafe expiry', changes: { leaseExpiresAt: Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'negative expiry', changes: { leaseExpiresAt: -1 } },
    { name: 'string expiry', changes: { leaseExpiresAt: String(LEASE_EXPIRY) } },
  ];
  describe.each(['claimed', 'generation'] as const)('%s', stage => {
    it.each(invalidLeases)('$name remains reconciliation with no recovery', async ({ changes }) => {
      const f = fixture(stage); Object.assign(f.task, changes);
      expectPending(await poll(f), true); expect(f.scheduled).toEqual([]);
    });
  });
  it('a loose remoteTaskId is not a durable accepted receipt after generation expiry', async () => {
    const f = fixture('generation');
    f.task.remoteTaskId = 'private-orphan-provider-task'; f.task.leaseExpiresAt = NOW - 1;
    expectPending(await poll(f), true); expect(f.scheduled).toEqual([]);
  });
});

describe('checkpoint validation continues to protect uncertain receipt and usage states', () => {
  const invalidCheckpoints: ReadonlyArray<{ name: string; value: unknown }> = [
    { name: 'unknown phase', value: { ...checkpoint('analysis'), phase: 'uploading' } },
    { name: 'unsupported version', value: { ...checkpoint('analysis'), version: 2 } },
    { name: 'invalid routing hash', value: { ...checkpoint('analysis'), routing: { ...ROUTING, image: 'invalid' } } },
    { name: 'routing with extra fields', value: { ...checkpoint('analysis'), routing: { ...ROUTING, extra: true } } },
    { name: 'analysis missing in analysis-complete', value: { version: 1, phase: 'analysis-complete', routing: ROUTING, usage: USAGE } },
    { name: 'analysis missing in generation', value: { version: 1, phase: 'generation', routing: ROUTING, usage: USAGE } },
    { name: 'invalid generation analysis', value: { ...checkpoint('generation'), analysis: { ...ANALYSIS, prompt: '' } } },
    { name: 'receipt in analysis', value: { ...checkpoint('analysis'), receipt: RECEIPT } },
    { name: 'receipt in analysis-complete', value: { ...checkpoint('analysis-complete'), receipt: RECEIPT } },
    { name: 'receipt in generation', value: { ...checkpoint('generation'), receipt: RECEIPT } },
    { name: 'accepted without receipt', value: { ...checkpoint('generation'), phase: 'accepted' } },
    { name: 'accepted wrong provider', value: { ...checkpoint('accepted'), receipt: { ...RECEIPT, usedProviderId: 'other' } } },
    { name: 'accepted wrong model', value: { ...checkpoint('accepted'), receipt: { ...RECEIPT, usedModel: 'other' } } },
    { name: 'accepted ambiguous remote IDs', value: { ...checkpoint('accepted'), receipt: { ...RECEIPT, taskIds: ['private-remote', 'private-other'] } } },
    { name: 'accepted empty receipt', value: { ...checkpoint('accepted'), receipt: { ...RECEIPT, taskIds: [] } } },
    { name: 'accepted both remote and direct result', value: { ...checkpoint('accepted'), receipt: { ...RECEIPT, directImageUrls: ['https://private.invalid/image.png'] } } },
  ];
  it.each(invalidCheckpoints)('$name remains reconciliation even under a live original lease', async ({ value }) => {
    const f = fixture('analysis'); f.task.result!.sketchImageExecution = structuredClone(value);
    expectPending(await poll(f), true); expect(f.scheduled).toEqual([]);
  });
  it('an explicitly null checkpoint is malformed, not the legitimate absent-checkpoint gap', async () => {
    const f = fixture('claimed'); f.task.result!.sketchImageExecution = null;
    expectPending(await poll(f), true); expect(f.scheduled).toEqual([]);
  });
  it.each(['analysis-complete', 'generation', 'accepted'] as const)('token-priced %s with no real usage stays uncertain', async stage => {
    const f = fixture(stage, 'token'); delete execution(f).usage;
    expectPending(await poll(f), true); expect(f.scheduled).toEqual([]);
  });
  it('an expired accepted receipt with the wrong image binding never reaches recovery', async () => {
    const f = fixture('accepted'); f.task.leaseExpiresAt = NOW - 1;
    execution(f).receipt = { ...RECEIPT, usedProviderId: 'vp' };
    expectPending(await poll(f), true); expect(f.scheduled).toEqual([]);
  });
});

describe('accepted recovery retains its original behavior and cannot restart generation', () => {
  it.each([WORKER_OWNER, 'old-worker'])('a live accepted receipt owned by %s remains pending', async owner => {
    const f = fixture('accepted'); f.task.leaseOwner = owner; f.task.attemptCount = 2;
    // The original public fixture is flat-priced and omits optional usage.
    if (owner === 'old-worker') delete execution(f).usage;
    expectPending(await poll(f), false); expect(f.scheduled).toEqual([]);
  });
  it.each([WORKER_OWNER, 'old-worker'])('an expired accepted receipt owned by %s queues only original recovery', async owner => {
    const f = fixture('accepted'); f.task.leaseOwner = owner; f.task.leaseExpiresAt = NOW - 1;
    if (owner === 'old-worker') delete execution(f).usage;
    expectPending(await poll(f), true, true);
    expect(f.scheduled).toEqual([{ task: f.task, requestId: REQUEST_ID }]);
  });
  it('a durable direct-image receipt still queues accepted-only recovery without exposing its URL', async () => {
    const f = fixture('accepted'); f.task.leaseExpiresAt = NOW - 1;
    execution(f).receipt = { ...RECEIPT, taskIds: [], directImageUrls: ['https://private.invalid/output.png'] };
    expectPending(await poll(f), true, true);
    expect(f.scheduled).toEqual([{ task: f.task, requestId: REQUEST_ID }]);
  });
  it('accepted at exact expiry retains the original public scheduling boundary', async () => {
    const f = fixture('accepted'); f.task.leaseOwner = 'old-worker'; f.task.leaseExpiresAt = NOW;
    expectPending(await poll(f), true, true); expect(f.scheduled).toHaveLength(1);
  });
  it.each(['decline', 'throw'] as const)('a %s recovery ACK remains uncertain without retry or refund', async mode => {
    const f = fixture('accepted', 'flat', mode); f.task.leaseExpiresAt = NOW - 1;
    expectPending(await poll(f), true); expect(f.scheduled).toHaveLength(1);
  });
  it.each([
    { leaseExpiresAt: undefined }, { leaseExpiresAt: NaN }, { leaseExpiresAt: -1 },
    { attemptCount: undefined }, { attemptCount: 0 },
  ])('accepted with invalid original lease metadata %j cannot queue recovery', async changes => {
    const f = fixture('accepted'); Object.assign(f.task, changes);
    expectPending(await poll(f), true); expect(f.scheduled).toEqual([]);
  });
});

describe('active classification grants no new identity, cancellation or accounting authority', () => {
  it.each([
    { creditStatus: 'charged' }, { creditStatus: 'refunded' },
    { refundedTransactionId: 'original-refund' }, { refundedTransactionId: false },
  ])('non-executable processing finance metadata %j remains uncertain', async changes => {
    const f = fixture('generation'); Object.assign(f.task, changes);
    expectPending(await poll(f), true); expect(f.scheduled).toEqual([]);
  });
  it('an unknown durable candidate stays unavailable', async () => {
    const f = fixture('claimed');
    const response = await pollSketchImageTask(BODY, null, ACTOR, REQUEST_ID, f.deps);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, code: 'SKETCH_IMAGE_TASK_UNAVAILABLE', retryable: false });
    expect(f.scheduled).toEqual([]);
  });
  it('a live worker lease never authorizes a foreign actor', async () => {
    const f = fixture('generation'), result = await poll(f, BODY, 'other-actor');
    expect(result.status).toBe(404);
    expect(result.json).toMatchObject({ success: false, code: 'SKETCH_IMAGE_TASK_UNAVAILABLE', retryable: false });
    expect(f.scheduled).toEqual([]);
  });
  it.each([
    { ...BODY, projectId: 'other-project' }, { ...BODY, providerId: 'vp' },
    { ...BODY, imageProviderId: 'vp' }, { ...BODY, model: 'vp::vm' },
    { ...BODY, phase: 'generation' },
  ])('the original strict poll body rejects %j', async body => {
    const f = fixture('generation'), result = await poll(f, body);
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ success: false, code: 'SKETCH_INPUT_INVALID', retryable: false });
    expect(f.scheduled).toEqual([]);
  });
  it('changed original keywords cannot be blessed by a live lease or checkpoint', async () => {
    const f = fixture('generation');
    const admission = f.task.result!.sketchImageAdmission as { input: SketchImageInput };
    admission.input.instruction = 'private-changed-keywords';
    const result = await poll(f);
    expect(result.status).toBe(404);
    expect(result.json).toMatchObject({ success: false, code: 'SKETCH_IMAGE_TASK_UNAVAILABLE' });
    expect(f.scheduled).toEqual([]);
  });
  it('a durably cancelled task keeps its terminal projection without recovery or financial effects', async () => {
    const f = fixture('accepted'); f.task.status = 'cancelled'; f.task.progress = 0;
    f.task.creditStatus = 'refunded'; f.task.refundedTransactionId = createTaskBillingTransactionId('refund', BODY.taskId);
    f.task.leaseOwner = undefined; f.task.leaseExpiresAt = undefined;
    const result = await poll(f);
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ success: true, status: 'cancelled', error: { code: 'SKETCH_IMAGE_EXECUTION_CANCELLED', retryable: false } });
    expect(result.json).not.toHaveProperty('needsReconcile');
    expect(result.json).not.toHaveProperty('recoveryPending');
    expect(f.scheduled).toEqual([]);
  });
});
