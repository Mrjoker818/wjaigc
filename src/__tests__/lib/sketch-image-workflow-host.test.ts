import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { setTimeout as nativeDelay } from 'node:timers/promises';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import type { WorkflowNode, ExecutionResult } from '@/lib/workflow-engine';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { SketchImageInput } from '@/lib/sketch-to-code/image-contract';
import type { WorkflowSketchHost } from '@/lib/sketch-to-code/workflow';

const ports = vi.hoisted(() => ({ authorize: vi.fn(), lookup: vi.fn(), resolve: vi.fn(),
  analyze: vi.fn(), generate: vi.fn(), reference: vi.fn(), storage: vi.fn(), media: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cloud-task-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/cloud-task-storage')>(), getCloudTaskForUserByIdempotencyKey: ports.lookup }));
vi.mock('@/lib/collaboration/generation-project-access', () => ({ authorizeGenerationProject: ports.authorize }));
vi.mock('@/lib/collaboration/document-workspace-reference', () => ({
  resolveDocumentWorkspaceReference: ports.reference, resolvePersonalWorkspaceReference: ports.reference }));
vi.mock('@/lib/asset-core/storage', () => ({ createPostgresAssetStorage: (): unknown => ({ read: ports.storage }) }));
vi.mock('@/lib/asset-core/managed-media-read', () => ({ readManagedAssetVersionBytes: ports.media }));
vi.mock('@/lib/sketch-to-code/configured-dependencies', () => ({ createConfiguredSketchDependencies: vi.fn() }));
vi.mock('@/lib/sketch-to-code/task-http', () => ({ sketchTaskIdentity: vi.fn() }));
vi.mock('@/lib/sketch-to-code/configured-image-dependencies', () => ({
  createConfiguredSketchImageDependencies: (): unknown => ({ generation: {
    authorizeProject: (actorUserId: string, projectId: string): Promise<unknown> => ports.authorize({ actorUserId, projectId }),
    resolveTaskModel: ports.resolve, analyze: ports.analyze, generate: ports.generate } }) }));

import { executeWorkflowSketchImage, cancelWorkflowSketchImage, type WorkflowSketchImageIntent } from '@/lib/sketch-to-code/image-workflow';
import { prepareSketchImage } from '@/lib/sketch-to-code/image-generation';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';

const png = createCanvas(8, 8).toDataURL('image/png');
const access = { kind: 'personal' as const, actorUserId: 'actor-a', ownerId: 'actor-a', projectId: 'project-a' };
const vision: TaskModelDescriptor = { providerId: 'vision-p', modelId: 'same-model', kind: 'chat', sourceType: 'vlm',
  protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
  supportsVision: true, supportsReferenceImages: true, supportsMask: false, outputKinds: ['text'], capabilitySources: { supportsVision: 'admin' } };
const image: TaskModelDescriptor = { ...vision, providerId: 'image-p', kind: 'image', sourceType: 'image', protocol: 'images', executionMode: 'async',
  allowedRatios: ['4:3'], maxReferenceImages: 1, supportedOperations: ['image-to-image'], outputKinds: ['image'] };
const node: WorkflowNode = { id: 'node-a', type: 'ai-sketch-to-image', label: 'Sketch image', x: 0, y: 0, width: 240, height: 180, ports: [],
  config: { visionModel: 'vision-p::same-model', visionProviderId: 'vision-p', imageModel: 'image-p::same-model', imageProviderId: 'image-p',
    instruction: 'Make a new illustration', aspectRatio: '4:3' } };
const pricing = { version: 1, vision: { providerId: 'vision-p', modelId: 'same-model', calls: 1, mode: 'flat', reserveCredits: 7 },
  image: { providerId: 'image-p', modelId: 'same-model', calls: 1, credits: 11 }, totalReserveCredits: 18 };
const analysis = { summary: 'Original sketch', composition: 'Centered', prompt: 'A new illustration', negativePrompt: '' };
const reference = { kind: 'sketch-image-reference', taskId: 'skimg_host', projectId: 'project-a', visionProviderId: 'vision-p', visionModelId: 'same-model',
  imageProviderId: 'image-p', imageModelId: 'same-model', previewAssetId: 'source-asset', previewAssetVersionId: 'source-version',
  imageAssetId: 'generated-asset', imageAssetVersionId: 'generated-version' };

interface Fixture {
  host: WorkflowSketchHost<WorkflowSketchImageIntent>; checkpoints: WorkflowSketchImageIntent[][]; progress: ExecutionResult[];
  child: PersistedCloudTask | null; fetcher: ReturnType<typeof vi.fn<typeof fetch>>; requests: { endpoint: string; body: Record<string, unknown>; signal: AbortSignal }[];
  poll: Record<string, unknown>; admit?: (body: Record<string, unknown>) => Promise<Response>; pollResponse?: () => Promise<Response>;
}
function childFor(intent: WorkflowSketchImageIntent): PersistedCloudTask {
  return { id: 'skimg_host', userId: 'actor-a', projectId: 'project-a', type: 'sketch-to-image', providerId: 'image-p', model: 'same-model',
    status: 'processing', progress: 25, creditStatus: 'pending', creditCost: 18, createdAt: 1, updatedAt: 1, revision: 1,
    idempotencyKey: intent.input.idempotencyKey, requestDigest: intent.requestDigest,
    result: { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', input: structuredClone(intent.input), access: structuredClone(intent.access),
      requestDigest: intent.requestDigest, pricing: structuredClone(pricing) } } };
}
function setup(instanceId = 'instance-a'): Fixture {
  const f: Fixture = { child: null, requests: [], checkpoints: [], progress: [], poll: { success: true, ...reference, type: 'sketch-to-image',
    status: 'completed', progress: 100, pricing: structuredClone(pricing), reserveCredits: 18, actualCredits: 18,
    previewUrl: '/api/serve-upload/source.png', imageUrl: '/api/serve-upload/generated.png', analysis: structuredClone(analysis),
    apiKey: 'private-secret', imageDataUrl: png, html: '<script>private</script>' }, fetcher: vi.fn<typeof fetch>(),
    host: { ...access, parentExecutionId: 'parent-a', executionId: 'execution-a', nodeId: 'node-a', instanceId, attempt: 0,
      headers: { 'x-internal-user': 'actor-a', 'x-internal-secret': 'host-only' }, intents: {}, assertCurrent: vi.fn(async (): Promise<void> => {}),
      checkpoint: async (): Promise<void> => { f.checkpoints.push(structuredClone(Object.values(f.host.intents))); },
      progress: (result: ExecutionResult): void => { f.progress.push(result); } } };
  ports.lookup.mockImplementation(async (actor: string, nonce: string): Promise<PersistedCloudTask | null> => {
    if (actor !== 'actor-a') throw new Error('wrong actor lookup');
    return f.child?.idempotencyKey === nonce ? f.child : null;
  });
  f.fetcher.mockImplementation(async (url, options): Promise<Response> => {
    const endpoint = new URL(String(url)).pathname, body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    const signal = options?.signal;
    if (!(signal instanceof AbortSignal)) throw new Error('actual signal missing');
    f.requests.push({ endpoint, body, signal });
    expect(new Headers(options?.headers).get('x-internal-user')).toBe('actor-a');
    if (endpoint === '/api/sketch-to-image') {
      if (f.admit) return f.admit(body);
      f.child = childFor(f.host.intents[instanceId]);
      return Response.json({ success: true, taskId: 'skimg_host', status: 'processing' });
    }
    if (endpoint === '/api/poll-task') return f.pollResponse ? f.pollResponse() : Response.json(f.poll);
    return Response.json({ success: true, taskId: 'skimg_host', projectId: 'project-a', type: 'sketch-to-image', status: 'cancelled' });
  });
  vi.stubGlobal('fetch', f.fetcher);
  return f;
}
async function existing(f: Fixture, unknown = false): Promise<WorkflowSketchImageIntent> {
  const prepared = await prepareSketchImage({ projectId: 'project-a', imageDataUrl: png, instruction: 'Make a new illustration',
    visionProviderId: 'vision-p', visionModelId: 'same-model', imageProviderId: 'image-p', imageModelId: 'same-model',
    idempotencyKey: 'existing-nonce', aspectRatio: '4:3' }, { authorizeProject: async (): Promise<typeof access> => access,
    resolveTaskModel: async (providerId: string): Promise<TaskModelDescriptor> => structuredClone(providerId === 'vision-p' ? vision : image),
    analyze: ports.analyze, generate: ports.generate }, { actorUserId: 'actor-a', signal: new AbortController().signal });
  const intent: WorkflowSketchImageIntent = { version: 2, actorUserId: 'actor-a', projectId: 'project-a', parentExecutionId: 'parent-a',
    executionId: 'execution-a', nodeId: 'node-a', instanceId: f.host.instanceId, attempt: 0, input: prepared.input, access: prepared.access,
    requestDigest: sketchImageRequestDigest(prepared.input), ...(unknown ? { admissionUnknown: true } : { childTaskId: 'skimg_host' }) };
  f.host.intents[f.host.instanceId] = intent; return intent;
}
const execute = (f: Fixture, inputs: Record<string, unknown> = { imageDataUrl: png }): Promise<ExecutionResult> => executeWorkflowSketchImage(node, inputs, f.host);

beforeEach(() => {
  vi.clearAllMocks();
  ports.authorize.mockResolvedValue(access);
  ports.resolve.mockImplementation(async (providerId: string, modelId: string, actor: string): Promise<TaskModelDescriptor> => {
    if (actor !== 'actor-a' || modelId !== 'same-model') throw new Error('private catalog details');
    return structuredClone(providerId === 'vision-p' ? vision : image);
  });
  ports.reference.mockResolvedValue({ kind: 'image', assetId: 'source-asset', assetVersionId: 'managed-source' });
  // Only the storage port is controlled: run the original helper's callback and its owner/asset/MIME gates.
  ports.storage.mockImplementation(async (read: (transaction: {
    findVersion(owner: string, project: string, id: string): Promise<unknown>;
    findAsset(owner: string, project: string, id: string): Promise<unknown>;
  }) => Promise<unknown>): Promise<unknown> => read({
    findVersion: async (owner, project, id): Promise<unknown> => {
      expect([owner, project, id]).toEqual(['actor-a', 'project-a', 'managed-source']);
      return { id: 'managed-source', assetId: 'source-asset', file: { mimeType: 'image/png', url: '/api/serve-upload/source.png' } };
    },
    findAsset: async (owner, project, id): Promise<unknown> => {
      expect([owner, project, id]).toEqual(['actor-a', 'project-a', 'source-asset']); return { status: 'active', kind: 'image' };
    },
  }));
  ports.media.mockResolvedValue({ bytes: Buffer.from(png.split(',')[1], 'base64'), mimeType: 'image/png' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('image workflow host: original admission and frozen output', () => {
  it('persists exact two-role preflight before its sole original POST and outputs only the generated asset', async () => {
    const f = setup();
    const result = await execute(f, { imageDataUrl: png, projectId: 'attacker', idempotencyKey: 'attacker', visionModel: 'attacker',
      imageProviderId: 'attacker', skipCredits: true, apiKey: 'attacker' });
    expect(result.status).toBe('success');
    expect(f.requests.map(r => r.endpoint)).toEqual(['/api/sketch-to-image', '/api/poll-task']);
    const body = f.requests[0].body;
    expect(body).toEqual({ projectId: 'project-a', imageDataUrl: png, instruction: 'Make a new illustration', visionProviderId: 'vision-p',
      visionModelId: 'same-model', imageProviderId: 'image-p', imageModelId: 'same-model', aspectRatio: '4:3', idempotencyKey: expect.stringMatching(/^workflow-sketch-image:[a-f0-9]{64}$/) });
    expect(f.checkpoints[0][0].input).toEqual(body);
    expect(f.host.intents['instance-a'].requestDigest).toBe(sketchImageRequestDigest(body as unknown as SketchImageInput));
    expect(Object.isFrozen(f.host.intents['instance-a'].input)).toBe(true);
    expect(ports.resolve.mock.calls.map(args => args.slice(0, 3))).toEqual([['vision-p', 'same-model', 'actor-a'], ['image-p', 'same-model', 'actor-a']]);
    expect(ports.analyze).not.toHaveBeenCalled(); expect(ports.generate).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({ imageUrl: '/api/serve-upload/generated.png', assetId: 'generated-asset', imageAssetId: 'generated-asset',
      assetVersionId: 'generated-version', imageAssetVersionId: 'generated-version', sourceRole: 'generated-sketch-image', sketchImageReference: reference });
    const projected = JSON.stringify(result.output);
    expect(projected).not.toContain('private'); expect(projected).not.toContain(png); expect(projected).not.toContain('source.png');
  });
  it('uses different stable image nonces for different nested instances', async () => {
    const a = setup('loop-0'); await execute(a); const nonceA = a.requests[0]?.body.idempotencyKey;
    const b = setup('loop-1'); await execute(b); const nonceB = b.requests[0]?.body.idempotencyKey;
    expect(nonceA).toMatch(/^workflow-sketch-image:/); expect(nonceB).not.toBe(nonceA);
    const c = setup('loop-0'); await execute(c); expect(c.requests[0]?.body.idempotencyKey).toBe(nonceA);
  });
  it.each([0, 12, 18, 25])('allows legitimate settled actualCredits=%s without assuming reserve is a ceiling', async actualCredits => {
    const f = setup(); f.poll.actualCredits = actualCredits; expect((await execute(f)).status).toBe('success');
  });
  it('uses the shared original managed-PNG read instead of fetching an input URL', async () => {
    const f = setup(); expect((await execute(f, { imageUrl: 'https://untrusted.invalid/input', assetVersionId: 'managed-source' })).status).toBe('success');
    expect(ports.reference).toHaveBeenCalledWith('actor-a', { projectId: 'project-a', assetVersionId: 'managed-source' });
    expect(ports.storage).toHaveBeenCalled(); expect(ports.media).toHaveBeenCalled(); expect(f.requests[0].body.imageDataUrl).toBe(png);
    expect(f.requests.every(r => r.endpoint.startsWith('/api/'))).toBe(true);
  });
  it('rejects arbitrary external PNG input before admission', async () => {
    const f = setup(); expect((await execute(f, { imageUrl: 'https://untrusted.invalid/source.png' })).status).toBe('failed'); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('does not admit when access is revoked during original managed PNG download', async () => {
    const f = setup(); ports.media.mockImplementationOnce(async (): Promise<unknown> => { ports.authorize.mockRejectedValue(new Error('private grant')); return { bytes: Buffer.from(png.split(',')[1], 'base64'), mimeType: 'image/png' }; });
    const result = await execute(f, { assetVersionId: 'managed-source' }); expect(result.status).toBe('failed'); expect(f.fetcher).not.toHaveBeenCalled(); expect(result.error).not.toContain('private');
  });
  it('rejects a stale parent after CPU preflight and before child admission', async () => {
    const f = setup(); f.host.checkpoint = async (): Promise<void> => { f.host.assertCurrent = async (): Promise<void> => { throw new Error('private lease'); }; };
    const result = await execute(f); expect(result.status).not.toBe('success'); expect(f.fetcher).not.toHaveBeenCalled(); expect(result.error).not.toContain('private');
  });
});

describe('image workflow host: original child recovery', () => {
  it('lost admission receipt persists unknown and resumes only original child polling', async () => {
    const f = setup(); f.admit = async (): Promise<Response> => { f.child = childFor(f.host.intents['instance-a']); throw new Error('private receipt'); };
    const first = await execute(f); expect(first.status).toBe('running'); expect(first.output?.needsReconcile).toBe(true);
    expect(f.host.intents['instance-a'].admissionUnknown).toBe(true); expect(f.checkpoints.at(-1)?.[0].admissionUnknown).toBe(true);
    expect((await execute(f)).status).toBe('success'); expect(f.requests.filter(r => r.endpoint === '/api/sketch-to-image')).toHaveLength(1);
    expect(ports.resolve.mock.calls).toHaveLength(4); expect(ports.analyze).not.toHaveBeenCalled();
  });
  it.each([true, false])('a recovered saved preflight (unknown=%s) without an original child cannot POST again', async unknown => {
    const f = setup(); const intent = await existing(f, true); if (!unknown) delete intent.admissionUnknown;
    const result = await execute(f); expect(result.status).toBe('running'); expect(result.output?.needsReconcile).toBe(true); expect(f.fetcher).not.toHaveBeenCalled();
    expect(intent.input.idempotencyKey).toBe('existing-nonce'); expect(ports.resolve).toHaveBeenCalledTimes(2);
  });
  it('an existing child ignores changed upstream input and does not reprice or submit', async () => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent);
    expect((await execute(f, { imageDataUrl: 'invalid', instruction: 'changed' })).status).toBe('success');
    expect(f.requests.map(r => r.endpoint)).toEqual(['/api/poll-task']); expect(intent.input.instruction).toBe('Make a new illustration');
  });
  it('revalidates current dual catalog on recovery and refuses a withdrawn image capability', async () => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent);
    ports.resolve.mockImplementation(async (providerId: string): Promise<TaskModelDescriptor> => structuredClone(providerId === 'vision-p' ? vision : { ...image, supportsReferenceImages: false }));
    expect((await execute(f)).status).not.toBe('success'); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each(['userId', 'type', 'projectId', 'providerId', 'model', 'requestDigest', 'idempotencyKey', 'creditCost', 'input', 'access', 'quote', 'childTaskId'] as const)(
    'rejects an original child with mismatched %s before poll', async field => {
      const f = setup(); const intent = await existing(f); f.child = childFor(intent);
      const raw = f.child as unknown as Record<string, unknown>;
      const admission = f.child.result!.sketchImageAdmission as Record<string, unknown>;
      if (field === 'input') admission.input = { ...intent.input, instruction: 'changed' };
      else if (field === 'access') admission.access = { ...access, ownerId: 'another-owner' };
      else if (field === 'quote') admission.pricing = { ...pricing, totalReserveCredits: 19 };
      else if (field === 'childTaskId') intent.childTaskId = 'different-child';
      else raw[field] = field === 'creditCost' ? '18' : 'wrong';
      // Return a mismatched row even for a wrong stored key; lookup is only a port, never authority.
      ports.lookup.mockResolvedValue(f.child);
      expect((await execute(f)).status).not.toBe('success'); expect(f.fetcher).not.toHaveBeenCalled();
    });
});

describe('image workflow host: protected poll projection', () => {
  it.each(['taskId', 'projectId', 'type', 'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId', 'status', 'phase', 'progress',
    'pricing', 'reserveCredits', 'actualCredits', 'analysis', 'previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId', 'previewUrl', 'imageUrl'])(
    'rejects protected completed output with invalid %s', async field => {
      const f = setup();
      const replacements: Record<string, unknown> = { status: 'unexpected', phase: 'generation', progress: 101, pricing: { ...pricing, totalReserveCredits: 19 },
        reserveCredits: 19, actualCredits: -1, analysis: { ...analysis, prompt: '' }, previewAssetId: 'generated-asset', previewAssetVersionId: 'generated-version',
        imageAssetId: '', imageAssetVersionId: '', previewUrl: 'https://untrusted.invalid/source.png', imageUrl: png };
      f.poll[field] = replacements[field] ?? 'wrong'; expect((await execute(f)).status).not.toBe('success');
      expect(f.progress.some(r => r.status === 'success')).toBe(false);
    });
  it.each(['/api/serve-upload/../secret.png', '/api/serve-upload/%2e%2e/secret.png', '/api/serve-upload/%5csecret.png', '/api/serve-upload/a.png?key=secret',
    '/api/serve-upload//a.png', '/api/serve-upload/%00a.png', 'https://evil.invalid/api/serve-upload/a.png'])(
    'rejects unsafe managed result URL %s', async url => { const f = setup(); f.poll.imageUrl = url; expect((await execute(f)).status).not.toBe('success'); });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1, '18'])('rejects non-safe actual credits %s', async actualCredits => {
    const f = setup(); f.poll.actualCredits = actualCredits; expect((await execute(f)).status).not.toBe('success');
  });
  it('rejects a valid but changed quote even if the reserve total is unchanged', async () => {
    const f = setup(); f.poll.pricing = { ...pricing, vision: { ...pricing.vision, reserveCredits: 8 }, image: { ...pricing.image, credits: 10 } };
    expect((await execute(f)).status).not.toBe('success');
  });
  it('persists safe running progress through the original host without copying private upstream fields', async () => {
    const f = setup(); let polls = 0;
    f.pollResponse = async (): Promise<Response> => Response.json(polls++ ? f.poll : { ...f.poll, status: 'processing', progress: 43, phase: 'accepted', needsReconcile: false });
    expect((await execute(f)).status).toBe('success'); expect(f.progress[0]).toMatchObject({ status: 'running', output: { taskId: 'skimg_host', progress: 43 } });
    expect(f.checkpoints.length).toBeGreaterThan(1); expect(JSON.stringify(f.progress)).not.toContain('private');
  });
  it('bounded reader rejects actual oversized UTF8 bytes despite a small content-length', async () => {
    const f = setup(); f.pollResponse = async (): Promise<Response> => new Response(JSON.stringify({ ...f.poll, extra: '中'.repeat(400_000) }), { headers: { 'content-length': '10' } });
    expect((await execute(f)).status).not.toBe('success');
  });
  it('rejects malformed actual UTF8 rather than replacement-decoding JSON', async () => {
    const f = setup(); const prefix = Buffer.from('{"success":true,"extra":"'); const suffix = Buffer.from('"}');
    f.pollResponse = async (): Promise<Response> => new Response(Buffer.concat([prefix, Buffer.from([0xff]), suffix]));
    expect((await execute(f)).status).not.toBe('success');
  });
  it('abort reaches the actual hung HTTP consumer and a late receipt cannot publish output', async () => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent); vi.useFakeTimers();
    let release: ((value: Response) => void) | undefined;
    f.pollResponse = (): Promise<Response> => new Promise(resolve => { release = resolve; });
    const pending = execute(f);
    // Real killable PNG decoding must reach the HTTP latch before advancing the synthetic HTTP deadline.
    for (let n = 0; n < 300 && !release; n++) { await nativeDelay(10); await vi.advanceTimersByTimeAsync(0); }
    expect(release).toBeTypeOf('function'); await vi.advanceTimersByTimeAsync(30_001);
    const result = await pending; expect(result.status).not.toBe('success'); expect(f.requests.at(-1)?.signal.aborted).toBe(true);
    release!(Response.json(f.poll)); await vi.advanceTimersByTimeAsync(0); expect(f.progress.some(r => r.status === 'success')).toBe(false);
  });
  it('a permission change while poll is pending prevents a late result from escaping', async () => {
    const f = setup(); f.pollResponse = async (): Promise<Response> => { ports.authorize.mockRejectedValue(new Error('private revoked')); return Response.json(f.poll); };
    const result = await execute(f); expect(result.status).not.toBe('success'); expect(result.error).not.toContain('private');
  });
});

describe('image workflow host: explicit original-owner cancellation', () => {
  it('confirms only correct original cancelled HTTP ACK without asking for a new grant', async () => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent); ports.authorize.mockRejectedValue(new Error('revoked grant'));
    expect(await cancelWorkflowSketchImage(intent, f.host)).toBe('confirmed'); expect(ports.authorize).not.toHaveBeenCalled(); expect(ports.resolve).not.toHaveBeenCalled();
    expect(f.requests.map(r => r.endpoint)).toEqual(['/api/cancel-task']); expect(f.requests[0].body).toEqual({ taskId: 'skimg_host', projectId: 'project-a' });
  });
  it('only a 409 with a reread original completed child is a winner', async () => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent);
    f.fetcher.mockImplementation(async (): Promise<Response> => { f.child!.status = 'completed'; return Response.json({ success: false, code: 'SKETCH_IMAGE_TASK_NOT_ACTIVE' }, { status: 409 }); });
    expect(await cancelWorkflowSketchImage(intent, f.host)).toBe('winner');
  });
  it.each(['taskId', 'projectId', 'type', 'status', 'success'])('wrong %s in cancellation ACK remains unknown', async field => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent);
    f.fetcher.mockResolvedValue(Response.json({ success: true, taskId: 'skimg_host', projectId: 'project-a', type: 'sketch-to-image', status: 'cancelled', [field]: 'wrong' }));
    expect(await cancelWorkflowSketchImage(intent, f.host)).toBe('unknown');
  });
  it('arbitrary 409 while original child is still active is not a winner', async () => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent); f.fetcher.mockResolvedValue(Response.json({ success: false }, { status: 409 }));
    expect(await cancelWorkflowSketchImage(intent, f.host)).toBe('unknown');
  });
  it('unknown original child cannot be cancelled by its taskId string alone', async () => {
    const f = setup(); const intent = await existing(f); expect(await cancelWorkflowSketchImage(intent, f.host)).toBe('unknown'); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('a wrong original private identity blocks cancellation without a POST', async () => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent); f.child.userId = 'other-actor';
    expect(await cancelWorkflowSketchImage(intent, f.host)).toBe('unknown'); expect(f.fetcher).not.toHaveBeenCalled();
  });
});

describe('image workflow host: pending flags before completed consumption or winner', () => {
  const counterexamples = [
    ['needsReconcile', true], ['recoveryPending', true], ['dispatchStopped', true], ['refundPending', true],
    ['needsReconcile', 'true'], ['recoveryPending', 1], ['dispatchStopped', null], ['refundPending', 'false'],
    ['dispatchPending', true], ['dispatchPending', 'false'],
  ] as const;
  it.each(counterexamples)('completed poll with %s=%s remains unconfirmed without generated output or a second admission', async (field, value) => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent); f.poll[field] = value;
    const result = await execute(f);
    expect(result.status).toBe('running');
    expect(result.output).toEqual({ taskId: 'skimg_host', status: 'unconfirmed', needsReconcile: true });
    expect(f.progress).toEqual([]);
    expect(f.requests.map(r => r.endpoint)).toEqual(['/api/poll-task']);
    expect(ports.lookup.mock.calls.every(args => args[0] === 'actor-a' && args[1] === 'existing-nonce')).toBe(true);
    expect(intent.input.idempotencyKey).toBe('existing-nonce');
    expect(ports.analyze).not.toHaveBeenCalled(); expect(ports.generate).not.toHaveBeenCalled();
  });
  it.each(counterexamples)('409 reply with %s=%s cannot declare the reread completed child a winner', async (field, value) => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent);
    f.fetcher.mockImplementation(async (url, options): Promise<Response> => {
      expect(new URL(String(url)).pathname).toBe('/api/cancel-task');
      expect(JSON.parse(String(options?.body))).toEqual({ taskId: 'skimg_host', projectId: 'project-a' });
      f.child!.status = 'completed';
      return Response.json({ success: false, code: 'SKETCH_IMAGE_TASK_NOT_ACTIVE', [field]: value }, { status: 409 });
    });
    expect(await cancelWorkflowSketchImage(intent, f.host)).toBe('unknown');
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.progress).toEqual([]);
    expect(ports.authorize).not.toHaveBeenCalled(); expect(ports.resolve).not.toHaveBeenCalled();
  });
  it.each(counterexamples)('409 completed original-child reread with %s=%s remains unknown despite a clean reply', async (field, value) => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent);
    f.fetcher.mockImplementation(async (url): Promise<Response> => {
      expect(new URL(String(url)).pathname).toBe('/api/cancel-task');
      f.child!.status = 'completed';
      (f.child as unknown as Record<string, unknown>)[field] = value;
      return Response.json({ success: false, code: 'SKETCH_IMAGE_TASK_NOT_ACTIVE' }, { status: 409 });
    });
    expect(await cancelWorkflowSketchImage(intent, f.host)).toBe('unknown');
    expect(ports.lookup).toHaveBeenCalledTimes(2); expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.progress).toEqual([]); expect(ports.authorize).not.toHaveBeenCalled(); expect(ports.resolve).not.toHaveBeenCalled();
  });
  it.each([['absent', 12], ['absent', 25], ['false', 12], ['false', 25]] as const)(
    'normal %s flags still consume legal actualCredits=%s with the original frozen reserve', async (flags, actualCredits) => {
      const f = setup(); const intent = await existing(f); f.child = childFor(intent); f.poll.actualCredits = actualCredits;
      if (flags === 'false') {
        const clear = { needsReconcile: false, recoveryPending: false, dispatchStopped: false, refundPending: false, dispatchPending: false };
        Object.assign(f.poll, clear); Object.assign(f.child, clear);
      }
      const result = await execute(f);
      expect(result.status).toBe('success');
      expect(result.output).toMatchObject({ actualCredits, reserveCredits: 18, pricing, imageUrl: '/api/serve-upload/generated.png',
        assetId: 'generated-asset', assetVersionId: 'generated-version', sketchImageReference: reference });
      expect(f.requests.map(r => r.endpoint)).toEqual(['/api/poll-task']);
    });
  it.each(['absent', 'false'] as const)('409 winner accepts normal %s flags only after original completed-child reread', async flags => {
    const f = setup(); const intent = await existing(f); f.child = childFor(intent);
    f.fetcher.mockImplementation(async (url): Promise<Response> => {
      expect(new URL(String(url)).pathname).toBe('/api/cancel-task'); f.child!.status = 'completed';
      const clear = flags === 'false' ? { needsReconcile: false, recoveryPending: false, dispatchStopped: false, refundPending: false, dispatchPending: false } : {};
      Object.assign(f.child!, clear);
      return Response.json({ success: false, code: 'SKETCH_IMAGE_TASK_NOT_ACTIVE', ...clear }, { status: 409 });
    });
    expect(await cancelWorkflowSketchImage(intent, f.host)).toBe('winner');
    expect(ports.lookup).toHaveBeenCalledTimes(2); expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(ports.authorize).not.toHaveBeenCalled(); expect(ports.resolve).not.toHaveBeenCalled();
  });
});
