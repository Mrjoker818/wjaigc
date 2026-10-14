import { beforeEach, afterEach, describe, expect, it as originalIt, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import sharp from 'sharp';
import { createWorkflowNode, type WorkflowNode, type WorkflowConnection } from '@/lib/workflow-engine';
import type { WorkflowSketchHost, WorkflowSketchIntent } from '@/lib/sketch-to-code/workflow';
import type { CloudTask, CreateCloudTaskInput, UpdateCloudTaskInput } from '@/lib/cloud-task-storage';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
const fixtureBridge = vi.hoisted(() => ({ resolve: undefined as undefined | ((name: string) => object), invoke: undefined as undefined | ((name: string, args: unknown[]) => unknown) }));
const mocks = vi.hoisted(() => { const templates = ({ auth: vi.fn(), headers: vi.fn(), get: vi.fn(), byKey: vi.fn(), create: vi.fn(), update: vi.fn(),
  bill: vi.fn(), setting: vi.fn(), authorize: vi.fn(), model: vi.fn(), provider: vi.fn(), after: vi.fn(), document: vi.fn(),
  recover: vi.fn(), worker: vi.fn(), terminate: vi.fn(), documentReference: vi.fn(), personalReference: vi.fn(), storageRead: vi.fn(), media: vi.fn(),
  claim: vi.fn(), renew: vi.fn(), release: vi.fn<(id: string, owner: string) => Promise<boolean>>(async () => true) });
  return Object.fromEntries(Object.entries(templates).map(([name, template]) => [name, new Proxy(template, {
    apply(target, receiver, args: unknown[]) { return fixtureBridge.invoke ? fixtureBridge.invoke(name, args) : Reflect.apply(target, receiver, args); },
    get(target, property) {
      const selected = fixtureBridge.resolve ? fixtureBridge.resolve(name) : target;
      const value = Reflect.get(selected, property);
      return typeof value === 'function' ? value.bind(selected) : value;
    },
  })])) as typeof templates;
});
vi.mock('server-only', () => ({}));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.auth, getInternalRequestHeaders: mocks.headers }));
vi.mock('@/lib/cloud-task-storage', async original => ({ ...await original<typeof import('@/lib/cloud-task-storage')>(),
  getCloudTaskForUser: mocks.get, getCloudTaskById: mocks.get, getCloudTaskForUserByIdempotencyKey: mocks.byKey,
  createCloudTask: mocks.create, updateCloudTask: mocks.update, terminateCloudTaskAndRefund: mocks.terminate,
  claimCloudTaskLease: mocks.claim, renewCloudTaskLease: mocks.renew, releaseCloudTaskLease: mocks.release }));
vi.mock('@/lib/collaboration/document-workspace-reference', () => ({ resolveDocumentWorkspaceReference: mocks.documentReference, resolvePersonalWorkspaceReference: mocks.personalReference }));
vi.mock('@/lib/asset-core/storage', () => ({ createPostgresAssetStorage: () => ({ read: mocks.storageRead }) }));
vi.mock('@/lib/asset-core/managed-media-read', () => ({ readManagedAssetVersionBytes: mocks.media }));
vi.mock('@/lib/task-core/billing-service', () => ({ createBillableTask: mocks.bill }));
vi.mock('@/lib/auth/auth-repository', () => ({ readSystemSettingStrict: mocks.setting }));
vi.mock('@/lib/collaboration/generation-project-access', async original => ({ ...await original<typeof import('@/lib/collaboration/generation-project-access')>(), authorizeGenerationProject: mocks.authorize }));
vi.mock('@/lib/task-core/model-catalog', () => ({ resolveTaskModel: mocks.model }));
vi.mock('@/lib/server-api-config', () => ({ findProviderById: mocks.provider, findProviderForModel: vi.fn(async () => null), findProviderForFeature: vi.fn(async () => null) }));
vi.mock('@/lib/sketch-to-code/execution', () => ({ executeSketchTask: mocks.worker, recoverExpiredSketchTask: mocks.recover }));
vi.mock('@/lib/sketch-to-code/document', () => ({ readSketchDocument: mocks.document }));
vi.mock('@/lib/op-log', () => ({ logError: vi.fn(), OP_ACTIONS: { WORKFLOW_EXECUTE: 'workflow' } }));
// Replay's original admission fence is mocked at its database port, not at the adapter or admission return.
vi.mock('@/lib/sketch-to-code/admission', async original => {
  const actual = await original<typeof import('@/lib/sketch-to-code/admission')>();
  return { ...actual, admitSketchTask: (value: unknown, context: Parameters<typeof actual.admitSketchTask>[1], deps: Parameters<typeof actual.admitSketchTask>[2]) =>
    actual.admitSketchTask(value, context, { ...deps, revalidateAccess: async () => undefined }) };
});
import { executeWorkflowSketch, cancelWorkflowSketch } from '@/lib/sketch-to-code/workflow';
import { POST as startSketch } from '@/app/api/sketch-to-code/route';
import { pollSketchTask, cancelSketchTask } from '@/lib/sketch-to-code/task-http';
import { POST as workflow } from '@/app/api/workflow/execute/route';
import { SketchClient, type SketchScope } from '@/lib/sketch-to-code/client';

const access = { kind: 'personal' as const, actorUserId: 'u1', ownerId: 'u1', projectId: 'project-a' };
const descriptor: TaskModelDescriptor = { providerId: 'p1', modelId: 'm1', kind: 'chat', sourceType: 'chat', protocol: 'chat-completions', executionMode: 'sync', supportsVision: true,
  allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: ['text'], capabilitySources: {} };
let png: string;
interface WorkflowTestFixture<T extends object> {
  mocks: T;
  tasks: Map<string, CloudTask>;
  requests: { url: string; body: Record<string, unknown>; headers: Headers }[];
  checkpoints: WorkflowSketchIntent[][];
  pending: Set<Promise<unknown>>;
  workers: Set<string>;
  gates: Set<() => void>;
  closing: boolean;
  cleanup?: Promise<void>;
  fetch?: typeof fetch;
}
function createWorkflowTestFixtureScope<T extends object>(makeMocks: () => T) {
  const context = new AsyncLocalStorage<WorkflowTestFixture<T>>();
  let current: WorkflowTestFixture<T> | undefined;
  function owner(): WorkflowTestFixture<T> {
    const value = context.getStore() || current;
    if (!value) throw new Error('WORKFLOW_TEST_FIXTURE_NOT_STARTED');
    return value;
  }
  function begin(): WorkflowTestFixture<T> {
    current = { mocks: makeMocks(), tasks: new Map(), requests: [], checkpoints: [], pending: new Set(), workers: new Set(), gates: new Set(), closing: false };
    return current;
  }
  function run<R>(fixture: WorkflowTestFixture<T>, operation: () => R): R { return context.run(fixture, operation); }
  function canInstallGlobals(fixture: WorkflowTestFixture<T>): boolean { return current === fixture && !fixture.closing; }
  function initialize<R>(operation: (fixture: WorkflowTestFixture<T>) => R): R {
    const fixture = begin();
    return run(fixture, () => operation(fixture));
  }
  function invoke(name: keyof T, args: unknown[]): unknown {
    const fixture = owner();
    const operation = fixture.mocks[name] as (...values: unknown[]) => unknown;
    const result = run(fixture, () => Reflect.apply(operation, undefined, args));
    if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') return result;
    const key = JSON.stringify(args.slice(0, 2));
    const observed: Promise<unknown> = (async () => {
      const value = await result;
      if (name === 'claim' && value) fixture.workers.add(key);
      return value;
    })().finally(() => {
      // No rejection handler is attached to the returned Promise: an unawaited
      // original port failure must remain visible to native/Vitest detection.
      if (name === 'release') fixture.workers.delete(key);
      fixture.pending.delete(observed);
    });
    fixture.pending.add(observed);
    return observed;
  }
  function gate(): { wait: () => Promise<void>; release: () => void } {
    const fixture = owner(); let resolve!: () => void;
    const waiting = new Promise<void>(done => { resolve = done; });
    const release = (): void => { resolve(); fixture.gates.delete(release); };
    fixture.gates.add(release);
    if (fixture.closing) release();
    return { wait: () => { if (fixture.closing) release(); return waiting; }, release };
  }
  function finish(fixture: WorkflowTestFixture<T>, cleanup: () => void = () => undefined): Promise<void> {
    if (fixture.cleanup) return fixture.cleanup;
    fixture.closing = true;
    for (const release of fixture.gates) release();
    fixture.cleanup = (async () => {
      // Track actual fixture operations and original claim/finally-release boundaries,
      // not every raw Promise (body-reader races intentionally retain losing promises).
      do { await new Promise<void>(resolve => setImmediate(resolve)); }
      while (fixture.pending.size || fixture.workers.size);
      // A timed-out old hook must never restore globals installed by a newer fixture.
      if (current === fixture) cleanup();
    })();
    return fixture.cleanup;
  }
  return { begin, owner, run, initialize, invoke, gate, finish, canInstallGlobals };
}
const fixtureScope = createWorkflowTestFixtureScope(() => Object.fromEntries(Object.keys(mocks).map(name => [name, vi.fn()])) as typeof mocks);
fixtureBridge.resolve = name => fixtureScope.owner().mocks[name as keyof typeof mocks];
fixtureBridge.invoke = (name, args) => fixtureScope.invoke(name as keyof typeof mocks, args);
function scopedRegistration(registration: typeof originalIt): typeof originalIt {
  return new Proxy(registration, {
    apply(target, thisArg, args: unknown[]) {
      const callbackIndex = args.findIndex(value => typeof value === 'function');
      if (callbackIndex >= 0) {
        const callback = args[callbackIndex] as (...values: unknown[]) => unknown;
        args[callbackIndex] = (...values: unknown[]) => fixtureScope.run(fixtureScope.owner(), () => Reflect.apply(callback, undefined, values));
      }
      return Reflect.apply(target, thisArg, args);
    },
    get(target, property, receiver) {
      if (property === 'each') return (...tables: unknown[]) => scopedRegistration(Reflect.apply(target.each, target, tables));
      return Reflect.get(target, property, receiver);
    },
  });
}
const it = scopedRegistration(originalIt);
function stubFixtureFetch(value: typeof fetch): void {
  const owner = fixtureScope.owner();
  owner.fetch = value;
  // Late initialization may update only its own local port, never a closed/foreign global.
  if (!fixtureScope.canInstallGlobals(owner)) return;
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const fixture = fixtureScope.owner();
    return fixtureScope.run(fixture, () => fixture.fetch!(input, init));
  });
}

function host(instanceId = 'exec-a:sketch-node', executionId = 'exec-a'): WorkflowSketchHost {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
  const intents: Record<string, WorkflowSketchIntent> = {};
  return { actorUserId: 'u1', projectId: 'project-a', parentExecutionId: 'exec-a', executionId, nodeId: 'sketch-node', instanceId, attempt: 0,
    headers: { 'x-test-actor': 'u1' }, intents, checkpoint: async () => { checkpoints.push(structuredClone(Object.values(intents))); }, assertCurrent: async () => undefined };
}
function node() { const result = createWorkflowNode('ai-sketch-to-code', 0, 0); result.id = 'sketch-node'; result.config = { model: 'p1::m1', providerId: 'p1', instruction: '中文布局', imageUrl: png }; return result; }
async function transport(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
  const url = String(input); const body = JSON.parse(String(init?.body)); const headers = new Headers(init?.headers);
  requests.push({ url, body, headers });
  if (url.endsWith('/api/sketch-to-code')) return startSketch(new NextRequest(url, { ...init, signal: init?.signal || undefined, headers }));
  if (url.endsWith('/api/poll-task')) return pollSketchTask(body, tasks.get(body.taskId), 'u1', 'request-1');
  if (url.endsWith('/api/cancel-task')) return cancelSketchTask(body, tasks.get(body.taskId), 'u1', 'request-1');
  throw new Error(`UNEXPECTED_NETWORK:${url}`);
}
beforeEach(() => fixtureScope.initialize(async fixture => {
  const { tasks, requests, checkpoints } = fixture;
  // Fresh per-case mocks retain the original defaults without clearing old in-flight owners.
  mocks.claim.mockResolvedValue({}); mocks.renew.mockResolvedValue(true); mocks.release.mockResolvedValue(true);
  png = `data:image/png;base64,${(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#fff' } }).png().toBuffer()).toString('base64')}`;
  mocks.auth.mockResolvedValue({ userId: 'u1', userRole: 'user', user: { id: 'u1', productType: 'all' } }); mocks.headers.mockResolvedValue({ 'x-test-actor': 'u1' });
  mocks.authorize.mockResolvedValue(access); mocks.model.mockResolvedValue(descriptor);
  mocks.provider.mockResolvedValue({ id: 'p1', apiKey: 'server-fixture-secret', baseUrl: 'https://fixture.invalid', isEnabled: true });
  mocks.setting.mockResolvedValue({ found: true, value: { modelCredits: { m1: 7 } } });
  mocks.byKey.mockImplementation(async (_actor: string, key: string) => [...tasks.values()].find(t => t.idempotencyKey === key) || null);
  mocks.get.mockImplementation(async (id: string) => tasks.get(id) || null);
  mocks.create.mockImplementation(async (t: CloudTask) => { tasks.set(t.id, { ...structuredClone(t), revision: 1 }); });
  mocks.update.mockImplementation(async (id: string, update: Partial<CloudTask>) => { const old = tasks.get(id); if (old) tasks.set(id, { ...old, ...structuredClone(update), revision: (old.revision || 0) + 1 }); return true; });
  mocks.bill.mockImplementation(async (input: { userId: string; idempotencyKey: string; requestDigest: string; creditCost: number; task: CloudTask }) => {
    const task = { ...input.task, userId: input.userId, idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest,
      creditCost: input.creditCost, creditStatus: 'charged' as const, revision: 1 }; tasks.set(task.id, task);
    return { task, reused: false, charged: true };
  });
  mocks.after.mockImplementation(() => undefined); mocks.recover.mockResolvedValue({ status: 'live' });
  mocks.documentReference.mockResolvedValue(null);
  mocks.personalReference.mockResolvedValue({ kind: 'image', assetId: 'input-asset', assetVersionId: 'input-version', url: '/api/serve-upload/input.png' });
  mocks.storageRead.mockImplementation(async callback => callback({ findVersion: async () => ({ id: 'input-version', assetId: 'input-asset', file: { mimeType: 'image/png' } }), findAsset: async () => ({ status: 'active', kind: 'image' }) }));
  mocks.media.mockResolvedValue({ mimeType: 'image/png', bytes: Buffer.from(png.split(',')[1], 'base64') });
  mocks.document.mockImplementation(async (input: { taskId: string }) => ({ ...input, projectId: 'project-a', providerId: 'p1', modelId: 'm1', reserveCredits: 14, actualCredits: 14,
    pricing: { calls: 2, perCallCredits: 7, totalCredits: 14 }, previewAssetId: 'png-asset', htmlAssetId: 'html-asset', previewAssetVersionId: 'png-version', htmlAssetVersionId: 'html-version',
    html: '<html>RAW_MUST_NOT_PERSIST</html>', analysis: { summary: '布局', layout: '容器与控件', controls: ['按钮'], text: ['中文'] }, documentUrl: '/api/sketch-to-code/document/original' }));
  mocks.terminate.mockImplementation(async (id: string) => { const t = tasks.get(id)!; t.status = 'cancelled'; t.creditStatus = 'refunded'; return { transitioned: true, status: 'cancelled', refunded: true }; });
  stubFixtureFetch(vi.fn(transport));
}));
afterEach(() => fixtureScope.finish(fixtureScope.owner(), () => vi.unstubAllGlobals()));
function completeOnPoll(): void {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
  mocks.recover.mockImplementation(async (id: string) => { tasks.get(id)!.status = 'completed'; return { status: 'live' }; });
}
describe('Task5 original admission through dedicated workflow adapter (isolated database ports)', () => {
  it('browser ACK-lost replay consumes the original completed summary through full authorized poll with token supplement', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const document = mocks.document.getMockImplementation()!;
    mocks.document.mockImplementation(async value => ({ ...await document(value), actualCredits: 20 }));
    let lost = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const response = await transport(new URL(String(url), 'http://localhost'), init);
      if (!lost && String(url).endsWith('/api/sketch-to-code')) {
        lost = true; [...tasks.values()].find(t => t.type === 'sketch-to-code')!.status = 'completed'; throw new Error('ACK_LOST');
      }
      return response;
    });
    const scope: SketchScope = { actorId: 'u1', projectId: 'project-a', key: 'u1:project-a', authority: 'legacy', assertCurrent: () => undefined };
    const client = new SketchClient(scope, fetcher);
    const input = { projectId: 'project-a', imageDataUrl: png, instruction: '中文布局', providerId: 'p1', modelId: 'm1', idempotencyKey: 'browser-original-nonce' };
    await expect(client.start(input)).rejects.toThrow('ACK_LOST');
    await expect(client.start(input, true)).resolves.toMatchObject({ status: 'completed', reserveCredits: 14, actualCredits: 20, htmlAssetVersionId: 'html-version' });
    expect(requests.map(r => new URL(r.url).pathname)).toEqual(['/api/sketch-to-code', '/api/sketch-to-code', '/api/poll-task']);
    expect(requests.slice(0, 2).map(r => r.body)).toEqual([input, input]);
    expect(mocks.bill).toHaveBeenCalledTimes(1); expect([...tasks.values()]).toHaveLength(1);
    expect(JSON.stringify(client.task)).not.toMatch(/RAW_MUST_NOT_PERSIST|server-fixture-secret|documentUrl|pricing/);
  });
  it('original completed admission and poll can be consumed by the approved browser helper before fresh document reads', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const h = host(); const result = await executeWorkflowSketch(node(), {}, h); expect(result.status).toBe('success');
    const taskId = Object.values(h.intents)[0].childTaskId!;
    const response = await pollSketchTask({ taskId, projectId: 'project-a' }, tasks.get(taskId), 'u1', 'request-1');
    const body = await response.json(); expect(body.analysis).toEqual({ summary: '布局', layout: '容器与控件', controls: ['按钮'], text: ['中文'] });
    const scope: SketchScope = { actorId: 'u1', projectId: 'project-a', key: 'u1:project-a', authority: 'legacy', assertCurrent: () => undefined };
    const client = new SketchClient(scope, async () => Response.json(body));
    await expect(client.poll(taskId)).resolves.toMatchObject({ status: 'completed', taskId, analysis: '摘要：布局\n布局：容器与控件\n控件：\n按钮\n文字：\n中文' });
  });
  it('checkpoints the frozen six-field intent before original billable admission, schedules original worker, and never persists poll HTML', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const h = host(); const result = await executeWorkflowSketch(node(), {}, h);
    expect(result.status).toBe('success'); expect(mocks.bill).toHaveBeenCalledTimes(1); expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(checkpoints[0][0]).toMatchObject({ actorUserId: 'u1', parentExecutionId: 'exec-a', nodeId: 'sketch-node', input: { projectId: 'project-a', imageDataUrl: png, providerId: 'p1', modelId: 'm1' } });
    expect(checkpoints[0][0].childTaskId).toBeUndefined(); expect(Object.keys(requests[0].body).sort()).toEqual(['projectId','imageDataUrl','instruction','providerId','modelId','idempotencyKey'].sort());
    expect(requests[0].headers.get('x-test-actor')).toBe('u1'); expect(JSON.stringify(result)).not.toMatch(/RAW_MUST_NOT_PERSIST|server-fixture-secret|documentUrl|pricing/);
    expect(result.output).toMatchObject({ documentReference: { kind: 'document-reference', projectId: 'project-a', previewAssetVersionId: 'png-version', htmlAssetVersionId: 'html-version' }, assetVersionId: 'png-version' });
  });
  it('unknown admission freezes nonce and input; retry reconciles original child without another charge or POST', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const h = host(); const base = transport; stubFixtureFetch(vi.fn(async (url, init) => { const response = await base(url, init); if (String(url).endsWith('/api/sketch-to-code')) throw new Error('ACK_LOST'); return response; }));
    const first = await executeWorkflowSketch(node(), {}, h); expect(first.status).toBe('running'); expect(first.output?.needsReconcile).toBe(true);
    const nonce = Object.values(h.intents)[0].input.idempotencyKey; completeOnPoll(); stubFixtureFetch(vi.fn(transport));
    const second = await executeWorkflowSketch(node(), { prompt: 'late changed input', projectId: 'foreign' }, h);
    expect(second.status).toBe('success'); expect(Object.values(h.intents)[0].input.idempotencyKey).toBe(nonce); expect(mocks.bill).toHaveBeenCalledTimes(1);
    expect(requests.filter(r => r.url.endsWith('/api/sketch-to-code'))).toHaveLength(1);
  });
  it.each(['digest','model','project'] as const)('reconciliation rejects mismatching original %s without re-admission', async variant => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const h = host();
    const input = { projectId: 'project-a', imageDataUrl: png, instruction: '中文布局', providerId: 'p1', modelId: 'm1', idempotencyKey: 'original-nonce' };
    const requestDigest = createHash('sha256').update(JSON.stringify({ version: 1, type: 'sketch-to-code', projectId: input.projectId, imageDataUrl: png, instruction: input.instruction, providerId: 'p1', modelId: 'm1' })).digest('hex');
    h.intents[h.instanceId] = { version: 1, actorUserId: 'u1', projectId: 'project-a', parentExecutionId: 'exec-a', executionId: 'exec-a', nodeId: 'sketch-node', instanceId: h.instanceId, attempt: 0, input, access, requestDigest, admissionUnknown: true };
    const task = { id: 'sketch_fixture', type: 'sketch-to-code', userId: 'u1', projectId: 'project-a', providerId: 'p1', model: 'm1', idempotencyKey: 'original-nonce', requestDigest,
      status: 'processing', progress: 0, creditCost: 14, creditStatus: 'charged', revision: 1, createdAt: 1, updatedAt: 1,
      result: { sketchAdmission: { version: 1, route: '/api/sketch-to-code', requestDigest, access, pricing: { calls: 2, perCallCredits: 7, totalCredits: 14 } } } } as CloudTask & { requestDigest: string };
    tasks.set(task.id, task);
    if (variant === 'digest') (task as CloudTask & { requestDigest: string }).requestDigest = 'f'.repeat(64);
    if (variant === 'model') task.model = 'different'; if (variant === 'project') task.projectId = 'other';
    const result = await executeWorkflowSketch(node(), {}, h); expect(result.error).toContain('WORKFLOW_SKETCH_CHILD_IDENTITY_MISMATCH'); expect(mocks.bill).not.toHaveBeenCalled(); expect(requests).toEqual([]);
  });
  it('lease/scope loss after admission observes no result and never issues a cancellation/refund', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const h = host(); let lost = false; h.assertCurrent = async () => { if (lost) throw new Error('WORKFLOW_EXECUTION_FENCE_LOST'); };
    stubFixtureFetch(vi.fn(async (url, init) => { const response = await transport(url, init); lost = true; return response; }));
    const result = await executeWorkflowSketch(node(), {}, h); expect(result.status).not.toBe('success'); expect(mocks.terminate).not.toHaveBeenCalled(); expect(requests).toHaveLength(1);
  });
  it.each(['remote','invalidPNG','nonvision','async'] as const)('rejects %s before any admission', async variant => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const n = node(); if (variant === 'remote') n.config.imageUrl = 'https://untrusted.invalid/a.png'; if (variant === 'invalidPNG') n.config.imageUrl = 'data:image/png;base64,bm90IGEgcG5n';
    if (variant === 'nonvision') mocks.model.mockResolvedValue({ ...descriptor, supportsVision: false }); if (variant === 'async') mocks.model.mockResolvedValue({ ...descriptor, executionMode: 'async' });
    expect((await executeWorkflowSketch(n, {}, host())).status).toBe('failed'); expect(mocks.bill).not.toHaveBeenCalled(); expect(requests).toEqual([]);
  });
  it('distinct loop and nested instances and explicit new parent have independent nonce identities', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const identities = ['exec-a:sketch-node:loop:1', 'exec-a:sketch-node:loop:2', 'exec-a:sub:sketch-node']; const nonces: string[] = [];
    for (const identity of identities) { const h = host(identity, identity.includes(':sub:') ? 'exec-a:sub' : 'exec-a'); expect((await executeWorkflowSketch(node(), {}, h)).status).toBe('success'); nonces.push(Object.values(h.intents)[0].input.idempotencyKey); }
    const fresh = host('exec-new:sketch-node', 'exec-new'); fresh.parentExecutionId = 'exec-new'; expect((await executeWorkflowSketch(node(), {}, fresh)).status).toBe('success'); nonces.push(Object.values(fresh.intents)[0].input.idempotencyKey);
    expect(new Set(nonces).size).toBe(4); expect(mocks.bill).toHaveBeenCalledTimes(4);
  });
  it('current grant generation change closes observation without cancelling the original child', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const h = host(); mocks.authorize.mockResolvedValue({ ...access, kind: 'document', grantGeneration: '1' });
    stubFixtureFetch(vi.fn(async (url, init) => { const response = await transport(url, init); mocks.authorize.mockResolvedValue({ ...access, kind: 'document', grantGeneration: '2' }); return response; }));
    const result = await executeWorkflowSketch(node(), {}, h); expect(result.status).not.toBe('success'); expect(mocks.terminate).not.toHaveBeenCalled();
  });
  it.each(['confirmed','winner','unknown'] as const)('original explicit cancel preserves %s outcome', async outcome => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const h = host(); stubFixtureFetch(vi.fn(async (url, init) => { const response = await transport(url, init); if (String(url).endsWith('/api/sketch-to-code')) throw new Error('ACK_LOST'); return response; }));
    await executeWorkflowSketch(node(), {}, h); const intent = Object.values(h.intents)[0]; expect(intent).toBeDefined();
    stubFixtureFetch(vi.fn(transport)); if (outcome === 'winner') [...tasks.values()][0].status = 'completed';
    if (outcome === 'unknown') mocks.terminate.mockRejectedValue(new Error('SQL_PRIVATE'));
    expect(await cancelWorkflowSketch(intent, h)).toBe(outcome); expect(mocks.bill).toHaveBeenCalledTimes(1);
  });
});
describe('Task5 actual workflow entry', () => {
  async function post(body: Record<string, unknown>) { return workflow(new NextRequest('http://localhost/api/workflow/execute', { method: 'POST', body: JSON.stringify(body) })); }
  it.each(['main', 'loop'] as const)('parent cancel visits the running second %s sketch after the first completed winner', async variant => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const first = node(); first.id = 'sketch-a'; const second = node(); second.id = 'sketch-b';
    const loop = createWorkflowNode('loop-for', 0, 0); loop.config.loopCount = 2; loop.loopCount = 2;
    const nodes = variant === 'loop' ? [loop, first] : [first, second];
    const connections = variant === 'loop' ? [{ id: 'body', fromNodeId: loop.id, toNodeId: first.id, fromPortId: 'out-loop', toPortId: 'in-prompt', type: 'prompt' }]
      : [];
    completeOnPoll(); let admissions = 0;
    stubFixtureFetch(vi.fn(async (url, init) => {
      const response = await transport(url, init);
      if (String(url).endsWith('/api/sketch-to-code') && ++admissions === 2) throw new Error('SECOND_ACK_LOST');
      return response;
    }));
    const started = await post({ action: 'start', projectId: 'project-a', nodes, connections }); const { executionId } = await started.json();
    await vi.waitFor(async () => expect((await (await post({ action: 'status', executionId })).json()).status).toBe('paused'), { timeout: 6000 });
    const sketches = [...tasks.values()].filter(t => t.type === 'sketch-to-code'); expect(sketches).toHaveLength(2);
    const originalResult = structuredClone(tasks.get(executionId)!.result!.results);
    const response = await post({ action: 'cancel', executionId }); expect(response.status).toBe(409);
    expect(requests.filter(r => r.url.endsWith('/api/cancel-task')).map(r => r.body.taskId)).toEqual(sketches.map(t => t.id));
    expect(tasks.get(sketches[0].id)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14 });
    expect(tasks.get(sketches[1].id)).toMatchObject({ status: 'cancelled', creditStatus: 'refunded' });
    expect(tasks.get(executionId)).toMatchObject({ status: 'processing', result: { workflowStatus: 'paused', results: originalResult, dispatchStopped: true } });
    await post({ action: 'cancel', executionId }); expect(mocks.terminate).toHaveBeenCalledTimes(1); expect(mocks.bill).toHaveBeenCalledTimes(2);
    const beforeRetry = requests.length;
    const retry = await post({ action: 'retry', executionId, nodeId: first.id, nodes, connections });
    expect(retry.status).toBe(409); expect(requests).toHaveLength(beforeRetry); expect(mocks.bill).toHaveBeenCalledTimes(2);
    expect(tasks.get(executionId)).toMatchObject({ status: 'processing', result: { workflowStatus: 'paused', results: originalResult, dispatchStopped: true } });
  });
  it.each(['main', 'loop'] as const)('parent cancellation fences an entered %s provider lookup before the next ordinary dispatch even when completion wins', async variant => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const sketch = node(); const ordinary = createWorkflowNode('ai-llm', 400, 0); ordinary.config = { providerId: 'p1', model: 'm1' };
    const loop = createWorkflowNode('loop-for', 0, 0); loop.config.loopCount = 1; loop.loopCount = 1;
    const nodes = variant === 'loop' ? [loop, sketch, ordinary] : [sketch, ordinary];
    const connections = variant === 'loop' ? [sketch, ordinary].map((n, index) => ({ id: `body-${index}`, fromNodeId: loop.id, toNodeId: n.id, fromPortId: 'out-loop', toPortId: 'in-prompt', type: 'prompt' }))
      : [];
    const manualGate = fixtureScope.gate(); const release = manualGate.release; let entered = false;
    const provider = mocks.provider.getMockImplementation()!;
    mocks.provider.mockImplementation(async (...args) => {
      if ([...tasks.values()].some(t => t.type === 'sketch-to-code' && t.status === 'completed')) {
        entered = true; await manualGate.wait();
      }
      return provider(...args);
    });
    stubFixtureFetch(vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/chat')) {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
        return Response.json({ success: true, content: 'late ordinary result' });
      }
      return transport(url, init);
    }));
    const started = await post({ action: 'start', projectId: 'project-a', nodes, connections }); const { executionId } = await started.json();
    await vi.waitFor(() => expect(entered).toBe(true));
    const cancelled = await post({ action: 'cancel', executionId }); expect(cancelled.status).toBe(409);
    release(); await vi.waitFor(() => expect(mocks.release.mock.calls.some(call => call[0] === executionId)).toBe(true));
    expect(requests.filter(r => r.url.endsWith('/api/chat'))).toEqual([]);
    expect(tasks.get(executionId)).toMatchObject({ status: 'processing', result: { workflowStatus: 'paused', dispatchStopped: true } });
    expect(mocks.bill).toHaveBeenCalledTimes(1); expect(mocks.terminate).not.toHaveBeenCalled();
  });
  it.each(['provider', 'lease'] as const)('cache-miss parent cancellation fences the original worker at %s before ordinary dispatch despite its still-live lease', async boundary => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const sketch = node(); const ordinary = createWorkflowNode('ai-llm', 400, 0); ordinary.config = { providerId: 'p1', model: 'm1' };
    const manualGate = fixtureScope.gate(); const release = manualGate.release; let entered = false; let ordinaryLookup = false;
    const provider = mocks.provider.getMockImplementation()!;
    mocks.provider.mockImplementation(async (...args) => {
      if ([...tasks.values()].some(t => t.type === 'sketch-to-code' && t.status === 'completed')) {
        ordinaryLookup = true;
        if (boundary === 'provider') { entered = true; await manualGate.wait(); }
      }
      return provider(...args);
    });
    if (boundary === 'lease') mocks.renew.mockImplementation(async () => {
      if (ordinaryLookup) { entered = true; await manualGate.wait(); }
      return true;
    });
    stubFixtureFetch(vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/chat')) {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
        return Response.json({ success: true, content: 'must not dispatch' });
      }
      return transport(url, init);
    }));
    const started = await post({ action: 'start', projectId: 'project-a', nodes: [sketch, ordinary], connections: [] });
    expect(started.status).toBe(200); const { executionId } = await started.json();
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 4000 });
    // An independent route instance has no cache entry but sees the original durable parent.
    vi.resetModules(); const { POST: otherInstance } = await import('@/app/api/workflow/execute/route');
    const response = await otherInstance(new NextRequest('http://localhost/api/workflow/execute', { method: 'POST', body: JSON.stringify({ action: 'cancel', executionId }) }));
    release(); await vi.waitFor(() => expect(mocks.release.mock.calls.some(call => call[0] === executionId)).toBe(true), { timeout: 4000 });
    expect(response.status).toBe(409); expect(mocks.renew).toHaveBeenCalled();
    expect(requests.filter(r => r.url.endsWith('/api/chat'))).toEqual([]);
    expect(tasks.get(executionId)).toMatchObject({ status: 'processing', result: { workflowStatus: 'paused', dispatchStopped: true } });
    expect(mocks.bill).toHaveBeenCalledTimes(1); expect(mocks.terminate).not.toHaveBeenCalled();
  });
  it('runs original parent and dedicated sketch branch without generic media billing fields', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const n = node(); const response = await post({ action: 'start', projectId: 'project-a', nodes: [n], connections: [] }); expect(response.status).toBe(200);
    const { executionId } = await response.json(); await vi.waitFor(async () => { const status = await (await post({ action: 'status', executionId })).json(); expect(status.status).toBe('completed'); expect(status.results[n.id].output.documentReference.kind).toBe('document-reference'); }, { timeout: 6000 });
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.bill).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tasks.get(executionId))).not.toContain('RAW_MUST_NOT_PERSIST');
    expect((mocks.bill.mock.calls[0][0] as { requestDigest: string }).requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(requests[0].body).not.toHaveProperty('sessionId'); expect(requests[0].body).not.toHaveProperty('messageId');
  });
  it('checks authentication before creating a workflow parent', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const { NextResponse } = await import('next/server'); mocks.auth.mockResolvedValue(NextResponse.json({ error: 'authentication required' }, { status: 401 }));
    expect((await post({ action: 'start', projectId: 'project-a', nodes: [node()], connections: [] })).status).toBe(401); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('persists unknown intent and retries the same frozen child through the original retry action', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const n = node(); let loseAck = true;
    stubFixtureFetch(vi.fn(async (url, init) => { const response = await transport(url, init); if (loseAck && String(url).endsWith('/api/sketch-to-code')) { loseAck = false; throw new Error('ACK_LOST'); } return response; }));
    const started = await post({ action: 'start', projectId: 'project-a', nodes: [n], connections: [] }); const { executionId } = await started.json();
    await vi.waitFor(async () => expect((await (await post({ action: 'status', executionId })).json()).status).toBe('paused'));
    const parent = tasks.get(executionId)!; const frozen = structuredClone(parent.result!.sketchIntents);
    expect(frozen).toBeDefined(); completeOnPoll();
    const retry = await post({ action: 'retry', executionId, nodeId: n.id, nodes: [n], connections: [], projectId: 'project-a' });
    expect((await retry.json()).success).toBe(true); expect(mocks.bill).toHaveBeenCalledTimes(1);
    expect(requests.filter(r => r.url.endsWith('/api/sketch-to-code'))).toHaveLength(1);
    expect(Object.values(parent.result!.sketchIntents as Record<string, WorkflowSketchIntent>)[0].input).toEqual(Object.values(frozen as Record<string, WorkflowSketchIntent>)[0].input);
  });
  it('executes two real loop instances and nested subgraph on the same parent without identity collision', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const loop = createWorkflowNode('loop-for', 0, 0); loop.config.loopCount = 2; loop.loopCount = 2; const n = node();
    const connections = [{ id: 'loop-body', fromNodeId: loop.id, toNodeId: n.id, fromPortId: 'out-loop', toPortId: 'in-prompt', type: 'prompt' }];
    const started = await post({ action: 'start', projectId: 'project-a', nodes: [loop, n], connections }); const { executionId } = await started.json();
    await vi.waitFor(async () => expect((await (await post({ action: 'status', executionId })).json()).status).toBe('completed'), { timeout: 6000 });
    const intents = Object.values(tasks.get(executionId)!.result!.sketchIntents as Record<string, WorkflowSketchIntent>);
    expect(intents).toHaveLength(2); expect(new Set(intents.map(i => i.input.idempotencyKey)).size).toBe(2);
    const sub = createWorkflowNode('subgraph', 0, 0); sub.config.inlineWorkflow = { nodes: [node()], connections: [] };
    const nested = await post({ action: 'start', projectId: 'project-a', nodes: [sub], connections: [] }); const nestedId = (await nested.json()).executionId;
    await vi.waitFor(async () => expect((await (await post({ action: 'status', executionId: nestedId })).json()).status).toBe('completed'), { timeout: 6000 });
    const nestedIntent = Object.values(tasks.get(nestedId)!.result!.sketchIntents as Record<string, WorkflowSketchIntent>)[0];
    expect(nestedIntent.parentExecutionId).toBe(nestedId); expect(nestedIntent.executionId).toBe(`${nestedId}:${sub.id}`); expect(mocks.bill).toHaveBeenCalledTimes(3);
  });
  it.each(['confirmed', 'winner', 'unknown'] as const)('parent cancel preserves original sketch %s outcome', async outcome => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const n = node(); stubFixtureFetch(vi.fn(async (url, init) => { const response = await transport(url, init); if (String(url).endsWith('/api/sketch-to-code')) throw new Error('ACK_LOST'); return response; }));
    const started = await post({ action: 'start', projectId: 'project-a', nodes: [n], connections: [] }); const { executionId } = await started.json();
    await vi.waitFor(async () => expect((await (await post({ action: 'status', executionId })).json()).status).toBe('paused'));
    stubFixtureFetch(vi.fn(transport)); if (outcome === 'winner') [...tasks.values()].find(t => t.type === 'sketch-to-code')!.status = 'completed';
    if (outcome === 'unknown') mocks.terminate.mockRejectedValue(new Error('PRIVATE_SQL'));
    const cancelled = await post({ action: 'cancel', executionId }); const value = await cancelled.json();
    expect(cancelled.status).toBe(outcome === 'confirmed' ? 200 : outcome === 'winner' ? 409 : 503);
    expect(value.status).toBe(outcome === 'confirmed' ? 'cancelled' : outcome === 'winner' ? 'paused' : 'unconfirmed');
    expect(mocks.bill).toHaveBeenCalledTimes(1);
    expect((await (await post({ action: 'status', executionId })).json()).status).toBe(outcome === 'confirmed' ? 'cancelled' : 'paused');
  });
  it('persists actual analysis and reconstruction progress on the same parent before completion', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    let polls = 0;
    mocks.recover.mockImplementation(async (id: string) => {
      const t = tasks.get(id)!; polls += 1; t.label = polls === 1 ? '草图转代码：分析中' : '草图转代码：重建中'; t.progress = polls === 1 ? 20 : 60;
      if (polls >= 3) t.status = 'completed'; return { status: 'live' };
    });
    const started = await post({ action: 'start', projectId: 'project-a', nodes: [node()], connections: [] }); const { executionId } = await started.json();
    await vi.waitFor(() => expect(tasks.get(executionId)?.result?.results).toMatchObject({ 'sketch-node': { status: 'running', output: { phase: 'analysis', progress: 20 } } }));
    await vi.waitFor(() => expect(tasks.get(executionId)?.result?.results).toMatchObject({ 'sketch-node': { status: 'running', output: { phase: 'reconstruction', progress: 60 } } }));
    await vi.waitFor(async () => expect((await (await post({ action: 'status', executionId })).json()).status).toBe('completed'));
  });
  it('releases the original parent lease after a same-intent retry', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    stubFixtureFetch(vi.fn(async (url, init) => { const response = await transport(url, init); if (String(url).endsWith('/api/sketch-to-code')) throw new Error('ACK_LOST'); return response; }));
    const n = node(); const started = await post({ action: 'start', projectId: 'project-a', nodes: [n], connections: [] }); const { executionId } = await started.json();
    await vi.waitFor(async () => expect((await (await post({ action: 'status', executionId })).json()).status).toBe('paused'));
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalled()); const released = mocks.release.mock.calls.length;
    completeOnPoll(); stubFixtureFetch(vi.fn(transport)); await post({ action: 'retry', executionId, nodeId: n.id, nodes: [n], connections: [] });
    expect(mocks.release.mock.calls.length).toBe(released + 1);
  });
  it.each(['loop', 'nested'] as const)('explicit %s retry continues original paused instance without a replacement nonce', async variant => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    let loseAck = true;
    stubFixtureFetch(vi.fn(async (url, init) => { const response = await transport(url, init); if (loseAck && String(url).endsWith('/api/sketch-to-code')) { loseAck = false; throw new Error('ACK_LOST'); } return response; }));
    const n = node(); const control = createWorkflowNode(variant === 'loop' ? 'loop-for' : 'subgraph', 0, 0);
    if (variant === 'loop') { control.loopCount = 1; control.config.loopCount = 1; }
    if (variant === 'nested') control.config.inlineWorkflow = { nodes: [n], connections: [] };
    const nodes = variant === 'loop' ? [control, n] : [control];
    const connections = variant === 'loop' ? [{ id: 'body', fromNodeId: control.id, toNodeId: n.id, fromPortId: 'out-loop', toPortId: 'in-prompt', type: 'prompt' }] : [];
    const started = await post({ action: 'start', projectId: 'project-a', nodes, connections }); expect(started.status).toBe(200); const { executionId } = await started.json();
    await vi.waitFor(async () => expect((await (await post({ action: 'status', executionId })).json()).status).toBe('paused'));
    const frozen = structuredClone(tasks.get(executionId)!.result!.sketchIntents); completeOnPoll(); stubFixtureFetch(vi.fn(transport));
    const retry = await post({ action: 'retry', executionId, nodeId: variant === 'loop' ? n.id : control.id, nodes, connections });
    expect((await retry.json()).success).toBe(true); expect(mocks.bill).toHaveBeenCalledTimes(1);
    expect(Object.values(tasks.get(executionId)!.result!.sketchIntents as Record<string, WorkflowSketchIntent>).map(i => i.input)).toEqual(Object.values(frozen as Record<string, WorkflowSketchIntent>).map(i => i.input));
  });
});

describe('Task6 parent cancellation reconciles every original child before aggregating', () => {
  it.each(['identity', 'completed', 'failed', 'timeout', 'service', 'transport'] as const)('preserves ordinary-only 502 and early-return cancellation protections for %s', async outcome => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const executionId = `ordinary-only-${outcome}`;
    const source = `${executionId}:first`; const laterSource = `${executionId}:later`;
    const firstId = `${executionId}-first`; const laterId = `${executionId}-later`;
    const status = ['completed', 'failed', 'timeout'].includes(outcome) ? outcome : 'processing';
    for (const [id, sourceEntityId, childStatus] of [[firstId, source, status], [laterId, laterSource, 'processing']]) {
      tasks.set(id, { id, type: 'edit', userId: 'u1', projectId: 'project-a', status: childStatus, progress: 0,
        creditCost: 7, creditStatus: 'charged', messageId: outcome === 'identity' && id === firstId ? 'another-parent:first' : sourceEntityId,
        idempotencyKey: `workflow:${sourceEntityId}`, revision: 1, createdAt: 1, updatedAt: 1 } as CloudTask);
    }
    tasks.set(executionId, { id: executionId, type: 'workflow', userId: 'u1', projectId: 'project-a', status: 'processing', progress: 0,
      creditCost: 0, creditStatus: 'not-applicable', revision: 1, createdAt: 1, updatedAt: 1,
      result: { workflowStatus: 'running', results: {}, activeChildTasks: { [source]: firstId, [laterSource]: laterId } } } as CloudTask);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const { taskId } = JSON.parse(String(init?.body)) as { taskId: string };
      if (taskId === firstId && outcome === 'transport') throw new TypeError('fixture network unavailable');
      return Response.json({ success: taskId !== firstId }, { status: taskId === firstId ? 503 : 200 });
    });
    stubFixtureFetch(fetcher);
    const response = await workflow(new NextRequest('http://localhost/api/workflow/execute', { method: 'POST', body: JSON.stringify({ action: 'cancel', executionId }) }));
    expect(response.status).toBe(502); expect((await response.json()).status).toBe('paused');
    expect(fetcher.mock.calls.map(call => (JSON.parse(String(call[1]?.body)) as { taskId: string }).taskId)).toEqual(
      outcome === 'service' || outcome === 'transport' ? [firstId] : [],
    );
    expect(tasks.get(firstId)).toMatchObject({ status, creditStatus: 'charged' });
    expect(tasks.get(laterId)).toMatchObject({ status: 'processing', creditStatus: 'charged' });
    expect(tasks.get(executionId)).toMatchObject({ status: 'processing', result: { workflowStatus: 'paused' } });
    expect(tasks.get(executionId)!.result).not.toHaveProperty('dispatchStopped'); expect(mocks.bill).not.toHaveBeenCalled();
  });
  it.each(['winner', 'unknown', 'mixed'] as const)('durable parent preserves %s while visiting later sketches and ordinary children', async outcome => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const executionId = `cancel-all-${outcome}`;
    const intents: Record<string, WorkflowSketchIntent> = {};
    stubFixtureFetch(vi.fn(async (url, init) => {
      const response = await transport(url, init); if (String(url).endsWith('/api/sketch-to-code')) throw new Error('ACK_LOST'); return response;
    }));
    for (let index = 0; index < 3; index++) {
      const h = host(`${executionId}:sketch-${index}`, executionId); h.parentExecutionId = executionId;
      await executeWorkflowSketch(node(), {}, h); Object.assign(intents, h.intents);
    }
    const sketches = [...tasks.values()].filter(t => t.type === 'sketch-to-code');
    if (outcome !== 'unknown') sketches[0].status = 'completed';
    const activeChildTasks: Record<string, string> = {};
    for (const [index, status] of ['completed', 'processing', 'processing'].entries()) {
      const sourceEntityId = `${executionId}:ordinary-${index}`; const taskId = `ordinary-${outcome}-${index}`;
      activeChildTasks[sourceEntityId] = taskId;
      tasks.set(taskId, { id: taskId, type: 'generate', userId: 'u1', projectId: 'project-a', providerId: 'p1', model: 'm1', status,
        progress: status === 'completed' ? 100 : 0, creditCost: 7, creditStatus: 'charged', messageId: sourceEntityId,
        idempotencyKey: `workflow:${sourceEntityId}`, revision: 1, createdAt: 1, updatedAt: 1 } as CloudTask);
    }
    const completedResult = { 'sketch-0': { nodeId: 'sketch-0', status: 'success', durationMs: 1,
      output: { taskId: sketches[0].id, status: 'completed', actualCredits: 20 } } };
    tasks.set(executionId, { id: executionId, type: 'workflow', userId: 'u1', projectId: 'project-a', status: 'processing', progress: 40,
      creditCost: 0, creditStatus: 'not-applicable', revision: 1, createdAt: 1, updatedAt: 1,
      result: { workflowStatus: 'paused', results: completedResult, sketchIntents: structuredClone(intents), activeChildTasks } } as CloudTask);
    const update = mocks.update.getMockImplementation()!;
    mocks.update.mockImplementation(async (id: string, patch: UpdateCloudTaskInput) => {
      const current = tasks.get(id);
      if (!current || patch.expectedRevision !== current.revision || ['completed', 'failed', 'cancelled', 'timeout'].includes(current.status)) return false;
      return update(id, patch);
    });
    stubFixtureFetch(vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { taskId: string };
      if (String(url).endsWith('/api/cancel-task')) {
        if (body.taskId === sketches[outcome === 'mixed' ? 1 : 0].id && outcome !== 'winner') {
          requests.push({ url: String(url), body, headers: new Headers(init?.headers) });
          return Response.json({ error: 'unavailable' }, { status: 503 });
        }
        if (body.taskId.startsWith('ordinary-')) {
          requests.push({ url: String(url), body, headers: new Headers(init?.headers) });
          const child = tasks.get(body.taskId)!; child.status = 'cancelled'; child.creditStatus = 'refunded';
          return Response.json({ success: true, taskId: body.taskId, status: 'cancelled' });
        }
      }
      return transport(url, init);
    }));
    const response = await workflow(new NextRequest('http://localhost/api/workflow/execute', { method: 'POST', body: JSON.stringify({ action: 'cancel', executionId }) }));
    expect(response.status).toBe(outcome === 'winner' ? 409 : 503);
    expect(await response.json()).toMatchObject({ status: outcome === 'winner' ? 'paused' : 'unconfirmed', cancellationOutcomes:
      outcome === 'winner' ? { confirmed: 4, winner: 2, unknown: 0 } : outcome === 'unknown'
        ? { confirmed: 4, winner: 1, unknown: 1 } : { confirmed: 3, winner: 2, unknown: 1 } });
    expect(requests.filter(r => r.url.endsWith('/api/cancel-task')).map(r => r.body.taskId)).toEqual([
      ...sketches.map(t => t.id), `ordinary-${outcome}-1`, `ordinary-${outcome}-2`,
    ]);
    expect(tasks.get(sketches[2].id)).toMatchObject({ status: 'cancelled', creditStatus: 'refunded' });
    expect(tasks.get(`ordinary-${outcome}-0`)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 7 });
    for (const index of [1, 2]) expect(tasks.get(`ordinary-${outcome}-${index}`)).toMatchObject({ status: 'cancelled', creditStatus: 'refunded' });
    expect(tasks.get(executionId)).toMatchObject({ status: 'processing', creditCost: 0, creditStatus: 'not-applicable', result: {
      workflowStatus: 'paused', dispatchStopped: true, results: completedResult, sketchIntents: intents,
    } });
    expect(mocks.bill).toHaveBeenCalledTimes(3);
  });
});

describe('Task5 original managed PNG and durable recovery boundaries', () => {
  it('rejects a grant-generation change during managed PNG reading before admission', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll();
    const grant = { ...access, kind: 'document', grantGeneration: '1' }; mocks.authorize.mockResolvedValue(grant);
    mocks.documentReference.mockImplementation(async () => { mocks.authorize.mockResolvedValue({ ...grant, grantGeneration: '2' }); return { kind: 'image', assetId: 'input-asset', assetVersionId: 'input-version' }; });
    const n = node(); n.config.imageUrl = '/api/serve-upload/input.png'; n.config.assetVersionId = 'input-version'; n.config.placementId = 'placement-input';
    const result = await executeWorkflowSketch(n, {}, host()); expect(result.status).toBe('failed'); expect(mocks.bill).not.toHaveBeenCalled(); expect(mocks.media).not.toHaveBeenCalled();
  });
  it('reads an authorized managed PNG through original reference and bounded media ports', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const n = node(); n.config.imageUrl = 'https://arbitrary.invalid/ignored'; n.config.assetVersionId = 'input-version';
    const result = await executeWorkflowSketch(n, {}, host()); expect(result.status).toBe('success'); expect(requests[0].body.imageDataUrl).toBe(png);
    expect(mocks.personalReference).toHaveBeenCalledWith('u1', { projectId: 'project-a', assetVersionId: 'input-version' });
    expect(mocks.media.mock.calls[0][2].maxBytes).toBe(4194304);
  });
  it('bound managed version wins over a stale inline PNG cache instead of bypassing original asset authorization', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const n = node(); n.config.assetVersionId = 'input-version';
    n.config.imageUrl = `data:image/png;base64,${(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#000' } }).png().toBuffer()).toString('base64')}`;
    const result = await executeWorkflowSketch(n, {}, host()); expect(result.status).toBe('success'); expect(requests[0].body.imageDataUrl).toBe(png);
    expect(mocks.personalReference).toHaveBeenCalledTimes(1);
  });
  it.each(['personal', 'document'] as const)('denied %s managed reference never falls back to an inline PNG or charges', async kind => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const n = node(); n.config.assetVersionId = 'input-version';
    mocks.authorize.mockResolvedValue({ ...access, kind, ...(kind === 'document' ? { documentId: 'doc-a', grantGeneration: '1' } : {}) });
    mocks.personalReference.mockResolvedValue(null); mocks.documentReference.mockResolvedValue(null);
    expect((await executeWorkflowSketch(n, {}, host())).status).toBe('failed');
    expect(kind === 'document' ? mocks.documentReference : mocks.personalReference).toHaveBeenCalledTimes(1);
    expect(mocks.media).not.toHaveBeenCalled(); expect(mocks.bill).not.toHaveBeenCalled(); expect(requests).toEqual([]);
  });
  it('managed upstream version never borrows a stale configured placement identity', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    completeOnPoll(); const n = node(); n.config.assetVersionId = 'stale-version'; n.config.placementId = 'stale-placement';
    const result = await executeWorkflowSketch(n, { imageUrl: png, assetVersionId: 'input-version' }, host());
    expect(result.status).toBe('success');
    expect(mocks.personalReference).toHaveBeenCalledWith('u1', { projectId: 'project-a', assetVersionId: 'input-version' });
    expect(requests[0].body.imageDataUrl).toBe(png);
  });
  it.each(['main', 'loop', 'nested'] as const)('cache-miss %s resumes the frozen original child on the original durable parent', async variant => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const executionId = `restored-${variant}`; const n = node(); const loop = createWorkflowNode('loop-for', 0, 0); loop.id = 'loop'; loop.config.loopCount = 1; loop.loopCount = 1;
    const sub = createWorkflowNode('subgraph', 0, 0); sub.id = 'sub'; sub.config.inlineWorkflow = { nodes: [n], connections: [] };
    const graphNodes = variant === 'nested' ? [sub] : variant === 'loop' ? [loop, n] : [n];
    const graphConnections = variant === 'loop' ? [{ id: 'loop-body', fromNodeId: 'loop', toNodeId: n.id, fromPortId: 'out-loop', toPortId: 'in-prompt', type: 'prompt' }] : [];
    const h = host(variant === 'loop' ? `${executionId}:${n.id}:loop:loop:1` : variant === 'nested' ? `${executionId}:sub:${n.id}` : `${executionId}:${n.id}`, variant === 'nested' ? `${executionId}:sub` : executionId); h.parentExecutionId = executionId;
    stubFixtureFetch(vi.fn(async (url, init) => { const response = await transport(url, init); if (String(url).endsWith('/api/sketch-to-code')) throw new Error('ACK_LOST'); return response; }));
    await executeWorkflowSketch(n, {}, h); const frozen = structuredClone(h.intents); completeOnPoll(); stubFixtureFetch(vi.fn(transport));
    tasks.set(executionId, { id: executionId, userId: 'u1', type: 'workflow', status: 'processing', creditStatus: 'not-applicable', projectId: 'project-a', progress: 0, revision: 1, createdAt: 1, updatedAt: 1,
      result: { workflowStatus: 'running', projectId: 'project-a', totalNodes: graphNodes.length, results: {}, currentNodeId: variant === 'loop' ? 'loop' : variant === 'nested' ? 'sub' : n.id,
        executionGraph: { nodes: graphNodes, connections: graphConnections }, sketchIntents: frozen, ...(variant === 'loop' ? { loopResume: { loopNodeId: 'loop', iterationIndex: 1, nextNodeIndex: 0 } } : {}) } } as CloudTask);
    const post = async () => workflow(new NextRequest('http://localhost/api/workflow/execute', { method: 'POST', body: JSON.stringify({ action: 'status', executionId }) }));
    await vi.waitFor(async () => expect((await (await post()).json()).status).toBe('completed'), { timeout: 6000 });
    expect(mocks.bill).toHaveBeenCalledTimes(1); expect(requests.filter(r => r.url.endsWith('/api/sketch-to-code'))).toHaveLength(1);
    const restored = tasks.get(executionId)!.result!.sketchIntents as Record<string, WorkflowSketchIntent>;
    expect(Object.values(restored)[0].input).toEqual(Object.values(frozen)[0].input);
  });
});

describe('Task5 I1 ordinary sketch retry resumes the fenced parent DAG', () => {
  beforeEach(() => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    // These are the original storage ports, with the revision/lease predicates enforced locally.
    // The parent status/results are produced only by the actual workflow route.
    mocks.create.mockImplementation(async (input: CreateCloudTaskInput) => {
      tasks.set(input.id, { ...structuredClone(input), creditStatus: input.creditStatus || 'pending', creditCost: input.creditCost || 0, revision: 1 });
      return true;
    });
    mocks.claim.mockImplementation(async (id: string, owner: string) => {
      const task = tasks.get(id);
      if (!task || task.status !== 'processing' || task.leaseOwner) return null;
      task.leaseOwner = owner;
      return structuredClone(task);
    });
    mocks.renew.mockImplementation(async (id: string, owner: string) => tasks.get(id)?.leaseOwner === owner);
    mocks.release.mockImplementation(async (id: string, owner: string) => {
      const task = tasks.get(id);
      if (!task || task.leaseOwner !== owner) return false;
      delete task.leaseOwner;
      return true;
    });
    mocks.update.mockImplementation(async (id: string, input: UpdateCloudTaskInput) => {
      const task = tasks.get(id);
      if (!task || (input.expectedRevision !== undefined && input.expectedRevision !== task.revision)
        || (input.leaseOwner && input.leaseOwner !== task.leaseOwner)
        || ['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) return false;
      const patch = structuredClone(input); delete patch.expectedRevision; delete patch.leaseOwner;
      tasks.set(id, { ...task, ...patch, revision: (task.revision || 0) + 1 });
      return true;
    });
  });

  async function post(body: Record<string, unknown>, entry: typeof workflow = workflow): Promise<Response> {
    return entry(new NextRequest('http://localhost/api/workflow/execute', { method: 'POST', body: JSON.stringify(body) }));
  }

  async function pausedGraph(withSync = false): Promise<{ executionId: string; nodes: WorkflowNode[]; connections: WorkflowConnection[];
    intent: WorkflowSketchIntent; childId: string; upstreamResult: unknown }> {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const upstream = createWorkflowNode('input-text', 0, 0); upstream.id = 'already-finished'; upstream.config.text = '冻结的上游布局';
    const sketch = node(); const exported = createWorkflowNode('output-export', 600, 0); exported.id = 'safe-export';
    const nodes = [upstream, sketch, exported];
    const connections: WorkflowConnection[] = [
      { id: 'original-prompt', fromNodeId: upstream.id, toNodeId: sketch.id, fromPortId: 'out-prompt', toPortId: 'in-prompt', type: 'prompt' },
      { id: 'safe-code', fromNodeId: sketch.id, toNodeId: exported.id, fromPortId: 'out-document', toPortId: 'in-document', type: 'document-reference' },
    ];
    if (withSync) {
      const sync = createWorkflowNode('ai-llm', 300, 0); sync.id = 'sync-copy'; sync.config.model = 'p1::m1';
      nodes.splice(1, 0, sync);
      connections.splice(0, 1,
        { id: 'sync-input', fromNodeId: upstream.id, toNodeId: sync.id, fromPortId: 'out-prompt', toPortId: 'in-prompt', type: 'prompt' },
        { id: 'sync-prompt', fromNodeId: sync.id, toNodeId: sketch.id, fromPortId: 'out-text', toPortId: 'in-prompt', type: 'prompt' });
    }
    let loseAck = true;
    stubFixtureFetch(vi.fn(async (url, init) => {
      if (withSync && String(url).endsWith('/api/chat')) {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
        // The original non-stream chat response shape, at the isolated network port only.
        return Response.json({ id: 'chatcmpl-sync-fixture', object: 'chat.completion', created: 1, model: 'm1',
          choices: [{ index: 0, message: { role: 'assistant', content: '合法同步文案' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      const response = await transport(url, init);
      if (loseAck && String(url).endsWith('/api/sketch-to-code')) { loseAck = false; throw new Error('ACK_LOST'); }
      return response;
    }));
    const response = await post({ action: 'start', projectId: 'project-a', nodes, connections }); expect(response.status).toBe(200);
    const { executionId } = await response.json();
    await vi.waitFor(async () => expect((await (await post({ action: 'status', executionId })).json()).status).toBe('paused'));
    await vi.waitFor(() => expect(tasks.get(executionId)?.leaseOwner).toBeUndefined());
    const parent = tasks.get(executionId)!;
    expect(parent).toMatchObject({ type: 'workflow', status: 'processing', creditCost: 0, result: { workflowStatus: 'paused' } });
    expect(parent.creditStatus).not.toBe('charged');
    expect(parent.result!.results).not.toHaveProperty('safe-export');
    const frozen = structuredClone(parent.result!.sketchIntents as Record<string, WorkflowSketchIntent>);
    const intent = frozen[`${executionId}:${sketch.id}`];
    expect(intent.admissionUnknown).toBe(true); expect(intent.childTaskId).toBeUndefined();
    const child = [...tasks.values()].find(task => task.type === 'sketch-to-code')!;
    expect(child.idempotencyKey).toBe(intent.input.idempotencyKey);
    return { executionId: executionId as string, nodes, connections, intent, childId: child.id,
      upstreamResult: structuredClone((parent.result!.results as Record<string, unknown>)[upstream.id]) };
  }

  function useJsonResultStorage(): Record<string, unknown>[] {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const storedCreate = mocks.create.getMockImplementation()!;
    const storedUpdate = mocks.update.getMockImplementation()!;
    const syncResults: Record<string, unknown>[] = [];
    function codec<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
    mocks.create.mockImplementation(async (input: CreateCloudTaskInput) => storedCreate({ ...input,
      ...(input.result ? { result: codec(input.result) } : {}) }));
    mocks.update.mockImplementation(async (id: string, input: UpdateCloudTaskInput) => {
      const sync = (input.result?.results as Record<string, Record<string, unknown>> | undefined)?.['sync-copy'];
      if (sync?.status === 'success') syncResults.push(structuredClone(sync));
      // Preserve the original revision/lease/terminal predicates, but use the actual result JSON codec.
      return storedUpdate(id, { ...input, ...(input.result ? { result: codec(input.result) } : {}) });
    });
    mocks.get.mockImplementation(async (id: string) => {
      const task = tasks.get(id);
      return task ? { ...structuredClone(task), ...(task.result ? { result: codec(task.result) } : {}) } : null;
    });
    return syncResults;
  }

  it.each(['cached', 'cache-miss'] as const)('I3 JSON codec %s ACK-lost retry confirms the original successful sync result and durable safe export', async variant => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const syncResults = useJsonResultStorage(); const graph = await pausedGraph(true);
    expect(syncResults.length).toBeGreaterThan(0);
    expect(syncResults[0]).toMatchObject({ nodeId: 'sync-copy', status: 'success', durationMs: expect.any(Number) });
    expect(Object.hasOwn(syncResults[0], 'error')).toBe(true); expect(syncResults[0].error).toBeUndefined();
    const pausedSync = (tasks.get(graph.executionId)!.result!.results as Record<string, Record<string, unknown>>)['sync-copy'];
    expect(pausedSync.status).toBe('success'); expect(Object.hasOwn(pausedSync, 'error')).toBe(false);
    expect(requests.filter(request => request.url.endsWith('/api/chat'))).toHaveLength(1);
    expect(requests.find(request => request.url.endsWith('/api/chat'))!.body).toMatchObject({ model: 'm1', stream: false,
      messages: [{ role: 'system', content: expect.any(String) }, { role: 'user', content: '冻结的上游布局' }] });
    completeOnPoll(); let entry = workflow;
    if (variant === 'cache-miss') { vi.resetModules(); entry = (await import('@/app/api/workflow/execute/route')).POST; }
    const retry = await (await post({ action: 'retry', executionId: graph.executionId, nodeId: 'sketch-node', nodes: graph.nodes, connections: graph.connections }, entry)).json();
    expect(retry.success).toBe(true);
    const current = await (await post({ action: 'status', executionId: graph.executionId }, entry)).json();
    const durable = tasks.get(graph.executionId)!;
    expect(current).toMatchObject({ status: 'completed', results: { 'sync-copy': pausedSync,
      'sketch-node': { status: 'success', output: { documentReference: { taskId: graph.childId, htmlAssetVersionId: 'html-version' } } },
      'safe-export': { status: 'success', output: { _type: 'output-export', documentReference: { taskId: graph.childId } } } } });
    expect(durable).toMatchObject({ type: 'workflow', projectId: 'project-a', status: 'completed', creditCost: 0,
      result: { workflowStatus: 'completed', results: current.results } });
    expect(durable.creditStatus).not.toBe('charged'); expect(durable.leaseOwner).toBeUndefined();
    expect(current.results['already-finished']).toEqual(graph.upstreamResult);
    expect((durable.result!.sketchIntents as Record<string, WorkflowSketchIntent>)[graph.intent.instanceId]).toMatchObject({
      input: graph.intent.input, childTaskId: graph.childId, requestDigest: graph.intent.requestDigest, attempt: 0 });
    vi.resetModules(); const fresh = (await import('@/app/api/workflow/execute/route')).POST;
    expect(await (await post({ action: 'status', executionId: graph.executionId }, fresh)).json()).toMatchObject({ status: 'completed', results: current.results });
    expect(requests.filter(request => request.url.endsWith('/api/chat'))).toHaveLength(1);
    expect(requests.filter(request => request.url.endsWith('/api/sketch-to-code'))).toHaveLength(1);
    expect(requests.filter(request => request.url.endsWith('/api/poll-task')).map(request => request.body.taskId)).toEqual([graph.childId]);
    expect([...tasks.values()].filter(task => task.type === 'sketch-to-code')).toHaveLength(1);
    expect(tasks.get(graph.childId)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14, idempotencyKey: graph.intent.input.idempotencyKey });
    expect(mocks.bill).toHaveBeenCalledTimes(1); expect(mocks.terminate).not.toHaveBeenCalled();
  });

  it.each(['sync-duration', 'sketch-version', 'extra-field'] as const)('I3 JSON codec still rejects meaningful completed result tampering: %s', async field => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    useJsonResultStorage(); const graph = await pausedGraph(true); completeOnPoll();
    const storedUpdate = mocks.update.getMockImplementation()!; let tampered = false;
    mocks.update.mockImplementation(async (id: string, input: UpdateCloudTaskInput) => {
      const accepted = await storedUpdate(id, input);
      if (accepted && id === graph.executionId && input.status === 'completed') {
        const results = tasks.get(id)!.result!.results as Record<string, Record<string, unknown>>;
        if (field === 'sync-duration') results['sync-copy'].durationMs = Number(results['sync-copy'].durationMs) + 1;
        if (field === 'sketch-version') {
          const output = results['sketch-node'].output as Record<string, unknown>;
          (output.documentReference as Record<string, unknown>).htmlAssetVersionId = 'different-version';
        }
        if (field === 'extra-field') results['safe-export'].unexpectedMeaningfulField = 'not-submitted';
        tampered = true;
      }
      return accepted;
    });
    const retry = await (await post({ action: 'retry', executionId: graph.executionId, nodeId: 'sketch-node', nodes: graph.nodes, connections: graph.connections })).json();
    expect(tampered).toBe(true); expect(tasks.get(graph.executionId)!.status).toBe('completed');
    expect(retry).toMatchObject({ success: false, error: 'WORKFLOW_EXECUTION_FENCE_LOST' }); expect(retry.output).toBeUndefined();
    expect((tasks.get(graph.executionId)!.result!.sketchIntents as Record<string, WorkflowSketchIntent>)[graph.intent.instanceId]).toMatchObject({ input: graph.intent.input, childTaskId: graph.childId });
    expect(tasks.get(graph.childId)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14, idempotencyKey: graph.intent.input.idempotencyKey });
    expect([...tasks.values()].filter(task => task.type === 'sketch-to-code')).toHaveLength(1);
    expect(requests.filter(request => request.url.endsWith('/api/chat'))).toHaveLength(1);
    expect(requests.filter(request => request.url.endsWith('/api/sketch-to-code'))).toHaveLength(1);
    expect(mocks.bill).toHaveBeenCalledTimes(1); expect(mocks.terminate).not.toHaveBeenCalled();
  });

  it.each(['cached', 'cache-miss'] as const)('ordinary ACK-lost %s retry completes the same parent and safe export with durable readback and one net charge', async variant => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const graph = await pausedGraph(); completeOnPoll();
    let entry = workflow;
    if (variant === 'cache-miss') { vi.resetModules(); entry = (await import('@/app/api/workflow/execute/route')).POST; }
    const retry = await post({ action: 'retry', executionId: graph.executionId, nodeId: 'sketch-node', nodes: graph.nodes, connections: graph.connections }, entry);
    expect((await retry.json()).success).toBe(true);
    const current = await (await post({ action: 'status', executionId: graph.executionId }, entry)).json();
    expect(current.status).toBe('completed');
    const reference = { kind: 'document-reference', taskId: graph.childId, projectId: 'project-a', providerId: 'p1', modelId: 'm1',
      previewAssetId: 'png-asset', htmlAssetId: 'html-asset', previewAssetVersionId: 'png-version', htmlAssetVersionId: 'html-version' };
    expect(current.results['sketch-node']).toMatchObject({ status: 'success', output: { imageUrl: png, documentReference: reference } });
    expect(current.results['safe-export']).toMatchObject({ status: 'success', output: { _type: 'output-export', documentReference: reference } });
    expect(current.results['already-finished']).toEqual(graph.upstreamResult);
    const durable = tasks.get(graph.executionId)!;
    expect(durable).toMatchObject({ status: 'completed', creditCost: 0, result: { workflowStatus: 'completed', results: current.results } });
    expect(durable.creditStatus).not.toBe('charged');
    const restoredIntent = (durable.result!.sketchIntents as Record<string, WorkflowSketchIntent>)[graph.intent.instanceId];
    expect(restoredIntent).toMatchObject({ childTaskId: graph.childId, input: graph.intent.input, requestDigest: graph.intent.requestDigest,
      parentExecutionId: graph.executionId, instanceId: graph.intent.instanceId, attempt: 0 });
    expect(restoredIntent.admissionUnknown).toBeUndefined();
    expect(mocks.bill).toHaveBeenCalledTimes(1);
    expect(mocks.terminate).not.toHaveBeenCalled();
    expect([...tasks.values()].filter(task => task.type === 'sketch-to-code')).toHaveLength(1);
    expect(tasks.get(graph.childId)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14, idempotencyKey: graph.intent.input.idempotencyKey });
    expect(requests.filter(request => request.url.endsWith('/api/sketch-to-code'))).toHaveLength(1);
    expect(requests.filter(request => request.url.endsWith('/api/poll-task')).map(request => request.body.taskId)).toEqual([graph.childId]);
    expect(JSON.stringify(durable)).not.toMatch(/RAW_MUST_NOT_PERSIST|server-fixture-secret|documentUrl|pricing/);
    expect(durable.leaseOwner).toBeUndefined();
    // Evict the process-local route cache; completed status now comes from the original durable parent port.
    vi.resetModules(); const fresh = (await import('@/app/api/workflow/execute/route')).POST;
    const reread = await (await post({ action: 'status', executionId: graph.executionId }, fresh)).json();
    expect(reread).toMatchObject({ executionId: graph.executionId, status: 'completed', results: current.results });
    expect(mocks.get).toHaveBeenCalledWith(graph.executionId, 'u1'); expect(mocks.bill).toHaveBeenCalledTimes(1);
    expect(requests.filter(request => request.url.endsWith('/api/sketch-to-code'))).toHaveLength(1);
  });

  it.each(['lease-denied', 'missing-revision', 'revision-race', 'cancelled', 'cancel-race', 'lease-lost'] as const)('%s cannot unlock the ordinary paused sketch downstream without its original parent fence', async boundary => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const graph = await pausedGraph(); completeOnPoll(); const storedUpdate = mocks.update.getMockImplementation()!;
    if (boundary === 'lease-denied') mocks.claim.mockResolvedValueOnce(null);
    if (boundary === 'missing-revision') delete tasks.get(graph.executionId)!.revision;
    if (boundary === 'cancelled') tasks.get(graph.executionId)!.status = 'cancelled';
    if (boundary === 'lease-lost') mocks.renew.mockResolvedValueOnce(false);
    if (boundary === 'revision-race' || boundary === 'cancel-race') mocks.update.mockImplementation(async (id: string, input: UpdateCloudTaskInput) => {
      if (id === graph.executionId && input.result?.workflowStatus === 'running') {
        const parent = tasks.get(id)!;
        if (boundary === 'revision-race') parent.revision = (parent.revision || 0) + 1;
        else { parent.status = 'cancelled'; parent.result = { ...parent.result, workflowStatus: 'cancelled' }; }
      }
      return storedUpdate(id, input);
    });
    const response = await post({ action: 'retry', executionId: graph.executionId, nodeId: 'sketch-node', nodes: graph.nodes, connections: graph.connections });
    expect((await response.json()).success).not.toBe(true);
    const parent = tasks.get(graph.executionId)!;
    expect(parent.result!.results).not.toHaveProperty('safe-export'); expect(parent.status).not.toBe('completed');
    expect(requests.filter(request => request.url.endsWith('/api/poll-task'))).toEqual([]);
    expect(mocks.bill).toHaveBeenCalledTimes(1); expect(tasks.get(graph.childId)!.idempotencyKey).toBe(graph.intent.input.idempotencyKey);
    expect(requests.filter(request => request.url.endsWith('/api/sketch-to-code'))).toHaveLength(1);
    expect(mocks.terminate).not.toHaveBeenCalled(); expect(parent.leaseOwner).toBeUndefined();
  });

  it('still-unknown ordinary retry stays paused with the original intent and no downstream or new admission', async () => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const graph = await pausedGraph(); mocks.byKey.mockRejectedValue(new Error('ORIGINAL_ADMISSION_READ_UNAVAILABLE'));
    const retry = await post({ action: 'retry', executionId: graph.executionId, nodeId: 'sketch-node', nodes: graph.nodes, connections: graph.connections });
    expect((await retry.json()).success).toBe(false);
    const parent = tasks.get(graph.executionId)!;
    expect(parent).toMatchObject({ status: 'processing', result: { workflowStatus: 'paused' } });
    expect(parent.result!.results).not.toHaveProperty('safe-export');
    expect((parent.result!.sketchIntents as Record<string, WorkflowSketchIntent>)[graph.intent.instanceId].input).toEqual(graph.intent.input);
    expect(mocks.bill).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(parent.leaseOwner).toBeUndefined();
  });

  it.each(['revision-race', 'lease-lost', 'cancel-winner', 'storage-error'] as const)('I2 final completed %s fails closed on retry, cached status and fresh durable read without another child or charge', async boundary => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const graph = await pausedGraph(); completeOnPoll(); const storedUpdate = mocks.update.getMockImplementation()!;
    const finalAttempts: UpdateCloudTaskInput[] = [];
    mocks.update.mockImplementation(async (id: string, input: UpdateCloudTaskInput) => {
      if (id === graph.executionId && input.status === 'completed') {
        finalAttempts.push(structuredClone(input));
        const parent = tasks.get(id)!;
        if (boundary === 'storage-error') throw new Error('FINAL_CHECKPOINT_STORAGE_UNAVAILABLE');
        if (boundary === 'revision-race') parent.revision = (parent.revision || 0) + 1;
        if (boundary === 'lease-lost') parent.leaseOwner = 'original-storage-lease-winner';
        if (boundary === 'cancel-winner') {
          parent.status = 'cancelled'; parent.revision = (parent.revision || 0) + 1;
          parent.result = { ...parent.result, workflowStatus: 'cancelled', completedAt: null };
        }
      }
      return storedUpdate(id, input);
    });
    const response = await post({ action: 'retry', executionId: graph.executionId, nodeId: 'sketch-node', nodes: graph.nodes, connections: graph.connections });
    const acknowledgement = await response.json();
    // The failure is the final durable commit, not the initial running transition or child execution.
    expect(finalAttempts).toHaveLength(1);
    expect(finalAttempts[0]).toMatchObject({ expectedRevision: expect.any(Number), leaseOwner: expect.any(String),
      result: { workflowStatus: 'completed', results: { 'sketch-node': { status: 'success' }, 'safe-export': { status: 'success' } } } });
    expect(acknowledgement.success).toBe(false);
    expect(acknowledgement.output).toBeUndefined();
    expect(acknowledgement.error).toBe('WORKFLOW_EXECUTION_FENCE_LOST');
    expect(JSON.stringify(acknowledgement)).not.toMatch(/refunded|refundAmount|completedAt/);

    async function readUnconfirmed(entry: typeof workflow): Promise<void> {
      const current = await (await post({ action: 'status', executionId: graph.executionId }, entry)).json();
      expect(current.status).not.toBe('completed');
      if (boundary === 'cancel-winner') expect(current.status).toBe('cancelled');
      else expect(current.completedAt).toBeNull();
      // Status may safely resume the original frozen DAG; wait for that original lease to settle.
      if (boundary !== 'lease-lost') await vi.waitFor(() => expect(tasks.get(graph.executionId)?.leaseOwner).toBeUndefined());
    }
    await readUnconfirmed(workflow);
    vi.resetModules(); const fresh = (await import('@/app/api/workflow/execute/route')).POST;
    await readUnconfirmed(fresh);
    const durable = tasks.get(graph.executionId)!;
    expect(durable.status).toBe(boundary === 'cancel-winner' ? 'cancelled' : 'processing');
    expect(durable.result!.workflowStatus).not.toBe('completed');
    expect(durable.creditStatus).not.toBe('charged'); expect(durable.creditCost).toBe(0);
    expect((durable.result!.results as Record<string, unknown>)['already-finished']).toEqual(graph.upstreamResult);
    const intent = (durable.result!.sketchIntents as Record<string, WorkflowSketchIntent>)[graph.intent.instanceId];
    expect(intent).toMatchObject({ input: graph.intent.input, requestDigest: graph.intent.requestDigest,
      parentExecutionId: graph.executionId, instanceId: graph.intent.instanceId, childTaskId: graph.childId, attempt: 0 });
    expect(mocks.bill).toHaveBeenCalledTimes(1); expect(mocks.terminate).not.toHaveBeenCalled();
    expect([...tasks.values()].filter(task => task.type === 'sketch-to-code')).toHaveLength(1);
    expect(tasks.get(graph.childId)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14,
      idempotencyKey: graph.intent.input.idempotencyKey });
    expect(requests.filter(request => request.url.endsWith('/api/sketch-to-code'))).toHaveLength(1);
    expect(requests.filter(request => request.url.endsWith('/api/poll-task')).map(request => request.body.taskId)).toEqual([graph.childId]);
  });
});

describe('Task6 N1 ordinary retry uses the original parent dispatch fence', () => {
  beforeEach(() => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    mocks.claim.mockImplementation(async (id: string, owner: string) => {
      const task = tasks.get(id);
      if (!task || task.status !== 'processing' || task.leaseOwner) return null;
      task.leaseOwner = owner; return structuredClone(task);
    });
    mocks.renew.mockImplementation(async (id: string, owner: string) => tasks.get(id)?.leaseOwner === owner);
    mocks.release.mockImplementation(async (id: string, owner: string) => {
      const task = tasks.get(id);
      if (!task || task.leaseOwner !== owner) return false;
      delete task.leaseOwner; return true;
    });
    mocks.update.mockImplementation(async (id: string, patch: UpdateCloudTaskInput) => {
      const task = tasks.get(id);
      if (!task || patch.expectedRevision !== task.revision || patch.leaseOwner && patch.leaseOwner !== task.leaseOwner
        || ['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) return false;
      const update = structuredClone(patch); delete update.expectedRevision; delete update.leaseOwner;
      tasks.set(id, { ...task, ...update, revision: (task.revision || 0) + 1 }); return true;
    });
  });
  async function post(body: Record<string, unknown>, entry: typeof workflow = workflow): Promise<Response> {
    return entry(new NextRequest('http://localhost/api/workflow/execute', { method: 'POST', body: JSON.stringify(body) }));
  }
  async function retryParent(kind: 'ai-llm' | 'ai-edit', hasSketch = true): Promise<{
    executionId: string; nodes: WorkflowNode[]; ordinary: WorkflowNode; sketches: CloudTask[];
    paid: { url: string; body: Record<string, unknown>; headers: Headers }[];
  }> {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const first = node(); first.id = 'retry-fence-sketch-a'; const second = node(); second.id = 'retry-fence-sketch-b';
    const ordinary = createWorkflowNode(kind, 600, 0); ordinary.id = 'retry-fence-ordinary';
    ordinary.config = { providerId: 'p1', model: 'm1', prompt: '原合法重试', imageUrl: '/api/serve-upload/input.png' };
    const nodes = hasSketch ? [first, second, ordinary] : [ordinary];
    const paid: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
    let admissions = 0;
    completeOnPoll();
    stubFixtureFetch(vi.fn<typeof fetch>(async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (pathname === '/api/chat' || pathname === '/api/edit') {
        paid.push({ url: pathname, body, headers: new Headers(init?.headers) });
        if (pathname === '/api/chat') return Response.json({ id: 'chatcmpl-retry', object: 'chat.completion', created: 1, model: 'm1',
          choices: [{ index: 0, message: { role: 'assistant', content: '合法重试结果' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        const childId = `paid-edit-${crypto.randomUUID()}`;
        tasks.set(childId, { id: childId, type: 'edit', userId: 'u1', projectId: 'project-a', providerId: 'p1', model: 'm1', status: 'processing',
          progress: 0, creditCost: 7, creditStatus: 'charged', messageId: String(body.messageId),
          idempotencyKey: new Headers(init?.headers).get('idempotency-key') || '', revision: 1, createdAt: 1, updatedAt: 1 });
        return Response.json({ success: true, taskId: childId });
      }
      if (pathname === '/api/poll-task' && tasks.get(String(body.taskId))?.type === 'edit') {
        tasks.get(String(body.taskId))!.status = 'completed';
        return Response.json({ success: true, taskId: body.taskId, status: 'completed', result: { imageUrl: '/api/serve-upload/edited.png' } });
      }
      const response = await transport(url, init);
      if (pathname === '/api/sketch-to-code' && ++admissions === 2) throw new Error('SECOND_ACK_LOST');
      return response;
    }));
    const started = await post({ action: 'start', projectId: 'project-a', nodes, connections: [] });
    expect(started.status).toBe(200); const { executionId } = await started.json();
    await vi.waitFor(() => expect(tasks.get(executionId)?.result?.workflowStatus).toBe(hasSketch ? 'paused' : 'completed'), { timeout: 4000 });
    await vi.waitFor(() => expect(tasks.get(executionId)?.leaseOwner).toBeUndefined(), { timeout: 4000 });
    const sketches = [...tasks.values()].filter(t => t.type === 'sketch-to-code');
    if (hasSketch) {
      expect(sketches).toHaveLength(2); expect(sketches[0]).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14 });
      expect(sketches[1]).toMatchObject({ status: 'processing', creditStatus: 'charged', creditCost: 14 });
      expect(paid).toEqual([]); expect(mocks.bill).toHaveBeenCalledTimes(2);
    }
    return { executionId: executionId as string, nodes, ordinary, sketches, paid };
  }
  const stoppedCases = (['ai-llm', 'ai-edit'] as const).flatMap(kind =>
    (['same-provider', 'same-headers', 'other-stopped', 'other-headers'] as const).map(boundary => ({ kind, boundary })));
  it.each(stoppedCases)('blocks $kind paid retry after $boundary parent cancellation, preserving completed charges and the durable stop', async ({ kind, boundary }) => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const graph = await retryParent(kind);
    const originalResults = structuredClone(tasks.get(graph.executionId)!.result!.results);
    let entry = workflow;
    if (boundary.startsWith('other-')) { vi.resetModules(); entry = (await import('@/app/api/workflow/execute/route')).POST; }
    const manualGate = fixtureScope.gate(); const release = manualGate.release; let entered = false;
    const retry = (): Promise<Response> => post({ action: 'retry', executionId: graph.executionId, nodeId: graph.ordinary.id, nodes: graph.nodes, connections: [] });
    let pending: Promise<Response> | undefined;
    try {
      if (boundary !== 'other-stopped') {
        const port = boundary === 'same-provider' ? mocks.provider : mocks.headers;
        const original = port.getMockImplementation()!;
        port.mockImplementation(async (...args) => {
          if (!entered) { entered = true; await manualGate.wait(); }
          return original(...args);
        });
        pending = retry(); await vi.waitFor(() => expect(entered).toBe(true), { timeout: 4000 });
      }
      const cancelled = await post({ action: 'cancel', executionId: graph.executionId }, entry);
      expect(cancelled.status).toBe(409);
      expect(tasks.get(graph.executionId)).toMatchObject({ status: 'processing', result: { workflowStatus: 'paused', dispatchStopped: true, results: originalResults } });
      if (release) release();
      const acknowledgement = await (await (pending || retry())).json();
      expect(graph.paid).toEqual([]); expect(acknowledgement.success).not.toBe(true);
      expect(acknowledgement.error).toBe('WORKFLOW_EXECUTION_FENCE_LOST');
      expect(tasks.get(graph.executionId)).toMatchObject({ status: 'processing', result: { workflowStatus: 'paused', dispatchStopped: true, results: originalResults } });
      expect(tasks.get(graph.sketches[0].id)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14 });
      expect(tasks.get(graph.sketches[1].id)).toMatchObject({ status: 'cancelled', creditStatus: 'refunded' });
      expect([...tasks.values()].filter(t => t.type === 'edit')).toEqual([]);
      expect(mocks.bill).toHaveBeenCalledTimes(2); expect(mocks.terminate).toHaveBeenCalledTimes(1);
      expect(tasks.get(graph.executionId)!.leaseOwner).toBeUndefined();
    } finally { if (release) release(); if (pending) await pending; }
  });
  it.each([{ kind: 'ai-llm' as const, hasSketch: true }, { kind: 'ai-edit' as const, hasSketch: true }, { kind: 'ai-llm' as const, hasSketch: false }])(
    'executes a lawful uncancelled $kind retry with hasSketch=$hasSketch using the original paid endpoint', async ({ kind, hasSketch }) => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const graph = await retryParent(kind, hasSketch); const before = graph.paid.length;
    const response = await post({ action: 'retry', executionId: graph.executionId, nodeId: graph.ordinary.id, nodes: graph.nodes, connections: [] });
    const result = await response.json(); expect(result.success).toBe(true);
    expect(graph.paid.slice(before).map(call => call.url)).toEqual([kind === 'ai-llm' ? '/api/chat' : '/api/edit']);
    expect(graph.paid.at(-1)!.headers.get('x-test-actor')).toBe('u1');
    if (kind === 'ai-edit') {
      const source = `${graph.executionId}:${graph.ordinary.id}:attempt:1`;
      expect(graph.paid.at(-1)!.body).toMatchObject({ projectId: 'project-a', messageId: source, image: '/api/serve-upload/input.png' });
      expect(graph.paid.at(-1)!.headers.get('idempotency-key')).toBe(`workflow:${source}`);
      expect(result.output).toMatchObject({ imageUrl: '/api/serve-upload/edited.png' });
    } else expect(result.output.choices[0].message.content).toBe('合法重试结果');
    if (hasSketch) {
      expect(tasks.get(graph.executionId)).toMatchObject({ status: 'processing', result: { workflowStatus: 'paused' } });
      expect(tasks.get(graph.executionId)!.result).not.toHaveProperty('dispatchStopped'); expect(mocks.bill).toHaveBeenCalledTimes(2);
    } else expect(tasks.get(graph.executionId)).toMatchObject({ status: 'completed', result: { workflowStatus: 'completed' } });
    expect(mocks.terminate).not.toHaveBeenCalled();
  });
  it.each(['project', 'actor', 'type', 'terminal', 'unavailable'] as const)('fails closed before ordinary retry dispatch when the original parent %s is unverified', async boundary => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const graph = await retryParent('ai-llm');
    const parent = tasks.get(graph.executionId)!;
    if (boundary === 'project') parent.projectId = 'other-project';
    if (boundary === 'actor') parent.userId = 'other-actor';
    if (boundary === 'type') parent.type = 'edit';
    if (boundary === 'terminal') parent.status = 'cancelled';
    if (boundary === 'unavailable') {
      const get = mocks.get.getMockImplementation()!;
      mocks.get.mockImplementation(async (...args) => { if (args[0] === graph.executionId) throw new Error('PARENT_READ_UNAVAILABLE'); return get(...args); });
    }
    const response = await post({ action: 'retry', executionId: graph.executionId, nodeId: graph.ordinary.id, nodes: graph.nodes, connections: [] });
    expect(graph.paid).toEqual([]); expect((await response.json()).success).not.toBe(true);
    expect(mocks.bill).toHaveBeenCalledTimes(2); expect(mocks.terminate).not.toHaveBeenCalled();
    expect(tasks.get(graph.sketches[0].id)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14 });
  });
  it.each(['ai-llm', 'ai-edit'] as const)('N2 rejects cached %s retry after a failed parent read recovers until original status restores it', async kind => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const graph = await retryParent(kind);
    const originalParent = structuredClone(tasks.get(graph.executionId)!);
    const get = mocks.get.getMockImplementation()!;
    let unavailable = true;
    mocks.get.mockImplementation(async (...args) => {
      if (args[0] === graph.executionId && unavailable) throw new Error('PARENT_READ_UNAVAILABLE');
      return get(...args);
    });
    const retry = (): Promise<Response> => post({ action: 'retry', executionId: graph.executionId,
      nodeId: graph.ordinary.id, nodes: graph.nodes, connections: [] });
    const first = await (await retry()).json();
    expect(first).toMatchObject({ success: false, error: 'WORKFLOW_EXECUTION_FENCE_LOST' });
    expect(graph.paid).toEqual([]); expect(tasks.get(graph.executionId)).toEqual(originalParent);

    unavailable = false;
    // No status call or new route instance between the failed read and this retry.
    const second = await retry(); const secondResult = await second.json();
    expect(graph.paid).toEqual([]);
    expect(second.status).toBe(409); expect(secondResult.success).not.toBe(true);
    expect(secondResult.error).toBe('WORKFLOW_EXECUTION_FENCE_LOST');
    expect(tasks.get(graph.executionId)).toEqual(originalParent);
    expect([...tasks.values()].filter(task => task.type === 'edit')).toEqual([]);
    expect(mocks.bill).toHaveBeenCalledTimes(2); expect(mocks.terminate).not.toHaveBeenCalled();

    // Existing authorized status recovery must replace, not clear and reuse, the lost object.
    const status = await post({ action: 'status', executionId: graph.executionId });
    expect(status.status).toBe(200); expect((await status.json()).status).toBe('paused');
    expect(graph.paid).toEqual([]);
    const restored = await (await retry()).json(); expect(restored.success).toBe(true);
    expect(graph.paid.map(call => call.url)).toEqual([kind === 'ai-llm' ? '/api/chat' : '/api/edit']);
    const parent = tasks.get(graph.executionId)!;
    expect(parent.result!.results).toMatchObject({ ...(originalParent.result!.results as Record<string, unknown>),
      [graph.ordinary.id]: { nodeId: graph.ordinary.id, status: 'success', output: restored.output } });
    expect(parent.result).toMatchObject({ workflowStatus: 'paused', retryAttempts: { [graph.ordinary.id]: 1 } });
    expect(parent.result).not.toHaveProperty('dispatchStopped');
    if (kind === 'ai-edit') {
      const child = [...tasks.values()].find(task => task.type === 'edit')!;
      const source = `${graph.executionId}:${graph.ordinary.id}:attempt:1`;
      expect(parent.result!.activeChildTasks).toMatchObject({ [source]: child.id });
      expect(child).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 7,
        userId: 'u1', projectId: 'project-a', messageId: source, idempotencyKey: `workflow:${source}` });
    }
    expect(tasks.get(graph.sketches[0].id)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14 });
    expect(tasks.get(graph.sketches[1].id)).toMatchObject({ status: 'processing', creditStatus: 'charged', creditCost: 14 });
    expect(mocks.bill).toHaveBeenCalledTimes(2); expect(mocks.terminate).not.toHaveBeenCalled();
    expect(parent.leaseOwner).toBeUndefined();
  });
  const lateLossCases = (['ai-llm', 'ai-edit'] as const).flatMap(kind =>
    (['provider', 'headers', 'parent-read'] as const).map(boundary => ({ kind, boundary })));
  it.each(lateLossCases)('N2 late loss fences in-flight $kind retry at $boundary after another retry loses the shared parent', async ({ kind, boundary }) => {
    const { tasks, requests, checkpoints } = fixtureScope.owner();
    const graph = await retryParent(kind);
    const originalParent = structuredClone(tasks.get(graph.executionId)!);
    const get = mocks.get.getMockImplementation()!;
    const manualGate = fixtureScope.gate(); const release = manualGate.release; let entered = false; let failed = false;
    const waiting = manualGate.wait();
    if (boundary !== 'parent-read') {
      const port = boundary === 'provider' ? mocks.provider : mocks.headers;
      const original = port.getMockImplementation()!;
      port.mockImplementation(async (...args) => {
        if (!entered) { entered = true; await waiting; }
        return original(...args);
      });
    }
    mocks.get.mockImplementation(async (...args) => {
      if (args[0] !== graph.executionId) return get(...args);
      if (boundary === 'parent-read' && !entered) {
        const snapshot = structuredClone(await get(...args));
        entered = true; await waiting; return snapshot;
      }
      if (!failed) { failed = true; throw new Error('PARENT_READ_UNAVAILABLE'); }
      return get(...args);
    });
    const retry = (): Promise<Response> => post({ action: 'retry', executionId: graph.executionId,
      nodeId: graph.ordinary.id, nodes: graph.nodes, connections: [] });
    const pending = retry();
    try {
      await vi.waitFor(() => expect(entered).toBe(true), { timeout: 4000 });
      const failedResult = await (await retry()).json();
      expect(failed).toBe(true);
      expect(failedResult).toMatchObject({ success: false, error: 'WORKFLOW_EXECUTION_FENCE_LOST' });
      expect(graph.paid).toEqual([]); expect(tasks.get(graph.executionId)).toEqual(originalParent);

      // Parent reads now succeed, but the earlier request still owns the same lost cache/root.
      release(); const inFlightResult = await (await pending).json();
      expect(graph.paid).toEqual([]);
      expect(inFlightResult).toMatchObject({ success: false, error: 'WORKFLOW_EXECUTION_FENCE_LOST' });
      const next = await retry(); expect(next.status).toBe(409);
      expect((await next.json()).error).toBe('WORKFLOW_EXECUTION_FENCE_LOST');
      expect(tasks.get(graph.executionId)).toEqual(originalParent);
      expect(tasks.get(graph.executionId)!.result).not.toHaveProperty('dispatchStopped');
      expect([...tasks.values()].filter(task => task.type === 'edit')).toEqual([]);
      expect(tasks.get(graph.sketches[0].id)).toMatchObject({ status: 'completed', creditStatus: 'charged', creditCost: 14 });
      expect(tasks.get(graph.sketches[1].id)).toMatchObject({ status: 'processing', creditStatus: 'charged', creditCost: 14 });
      expect(mocks.bill).toHaveBeenCalledTimes(2); expect(mocks.terminate).not.toHaveBeenCalled();
      expect(tasks.get(graph.executionId)!.leaseOwner).toBeUndefined();
    } finally { release(); await pending; }
  });
});
