import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { GenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import { prepareSketchImage, type SketchImagePreparation } from '@/lib/sketch-to-code/image-generation';
import { buildSketchImageGenerationBody, type SketchImageInput } from '@/lib/sketch-to-code/image-contract';
import type { SketchImageTaskIdentity } from '@/lib/sketch-to-code/image-task-state';
import { createConfiguredSketchImageDependencies, type ConfiguredSketchImagePorts } from '@/lib/sketch-to-code/configured-image-dependencies';
import { readSketchImageKnownFailure } from '@/lib/sketch-to-code/image-known-failure';
import { SketchProviderError } from '@/lib/sketch-to-code/provider';

vi.mock('server-only', () => ({}));

const actor = 'configured-actor', project = 'configured-project', modelId = 'gpt-image-2';
const visionKey = 'synthetic-vision-private-key', imageKey = 'synthetic-image-private-key';
const direct = 'https://configured-fixture.invalid/image.png';
const analysis = { summary: '原始草图', composition: '中心构图', prompt: '保留草图结构生成产品图', negativePrompt: '水印' };
const visionBinding = { providerId: 'vision-provider', modelId }, imageBinding = { providerId: 'image-provider', modelId };
const signal = (): AbortSignal => new AbortController().signal;
let server: Server, origin: string, png: string;
let providers: Record<string, ApiProvider>, models: Record<string, TaskModelDescriptor>;
let access: GenerationProjectAccess;
let events: string[], requests: Array<{ url: string; method: string; auth: string; body: Record<string, unknown> }>;
let authorizeHook: (() => Promise<void>) | undefined;
let resolveHook: ((id: string) => Promise<void>) | undefined;
let findHook: ((id: string) => Promise<void>) | undefined;

function descriptor(role: 'vision' | 'image'): TaskModelDescriptor {
  return { providerId: `${role}-provider`, modelId, kind: role === 'vision' ? 'chat' : 'image', sourceType: role === 'vision' ? 'chat' : 'image',
    protocol: role === 'vision' ? 'chat-completions' : 'images-generations', executionMode: 'sync',
    allowedRatios: ['1:1'], allowedSizes: ['1024x1024'], qualityOptions: ['high'], maxOutputs: 1,
    supportsVision: role === 'vision', supportsReferenceImages: role === 'image', maxReferenceImages: 1,
    supportsMask: false, supportedOperations: role === 'vision' ? [] : ['image-to-image'],
    outputKinds: role === 'vision' ? ['text'] : ['image'], capabilitySources: { protocol: 'admin', supportsVision: 'admin', supportsReferenceImages: 'admin' } };
}
function input(): SketchImageInput {
  return { projectId: project, imageDataUrl: png, instruction: '保留中文与原草图', visionProviderId: visionBinding.providerId,
    visionModelId: modelId, imageProviderId: imageBinding.providerId, imageModelId: modelId,
    idempotencyKey: 'configured-input-key', aspectRatio: '1:1', size: '1024x1024', quality: 'high' };
}
function identity(prepared: SketchImagePreparation): SketchImageTaskIdentity {
  return { taskId: 'configured-parent-task', actorUserId: actor, projectId: project, requestDigest: 'a'.repeat(64),
    input: prepared.input, access: prepared.access,
    pricing: { version: 1, vision: { ...visionBinding, calls: 1, mode: 'flat', reserveCredits: 0 },
      image: { ...imageBinding, calls: 1, credits: 0 }, totalReserveCredits: 0 } };
}
const localTransport: typeof fetch = async (target, options): Promise<Response> => {
  const url = new URL(typeof target === 'string' ? target : target instanceof URL ? target.href : target.url);
  if (url.origin !== origin) throw new Error('Fixture permits local HTTP only');
  return fetch(target, options);
};
function ports(): ConfiguredSketchImagePorts {
  return { requestId: 'configured-request', transport: localTransport,
    authorizeProject: async value => {
      events.push(`authorize:${value.actorUserId}:${String(value.projectId)}`); await authorizeHook?.(); return access;
    },
    resolveTaskModel: async (providerId, selectedModel, actorUserId) => {
      events.push(`resolve:${providerId}:${selectedModel}:${actorUserId}`); await resolveHook?.(providerId);
      const selected = models[providerId]; if (!selected) throw new Error('synthetic model authorization revoked'); return selected;
    },
    findProviderById: async providerId => {
      events.push(`provider:${providerId}`); await findHook?.(providerId); return providers[providerId] || null;
    } };
}
async function bound(deps = ports()): Promise<{ configured: ReturnType<typeof createConfiguredSketchImageDependencies>; prepared: SketchImagePreparation }> {
  const configured = createConfiguredSketchImageDependencies(deps);
  const prepared = await prepareSketchImage(input(), configured.generation, { actorUserId: actor, signal: signal() });
  return { configured, prepared };
}
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release };
}

beforeAll(async () => {
  png = `data:image/png;base64,${(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer()).toString('base64')}`;
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
      requests.push({ url: request.url || '', method: request.method || '', auth: request.headers.authorization || '', body });
      response.setHeader('content-type', 'application/json');
      if (request.url === '/vision/v1/chat/completions') {
        response.end(JSON.stringify({ model: modelId, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] }));
      } else if (request.url === '/image/v1/images/generations') {
        response.end(JSON.stringify({ model: modelId, data: [{ task_id: 'remote/42' }] }));
      } else if (request.method === 'GET' && request.url === '/image/v1/tasks/remote%2F42?language=zh') {
        response.end(JSON.stringify({ model: modelId, data: { status: 'completed', task_id: 'remote/42', url: direct } }));
      } else { response.statusCode = 404; response.end(JSON.stringify({ error: { message: 'Unexpected local route' } })); }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

describe('Task8 configured original response failure classification', () => {
  // Breaks caught: trusting exception strings/classes without observing an actual selected response.
  it.each([400, 401, 403, 404, 405, 413, 415, 422])('privately proves original analysis rejection %i behind the same safe outward error', async status => {
    let sends = 0;
    const { configured } = await bound({ ...ports(), transport: async (url, options): Promise<Response> => {
      sends++; expect(url).toBe(`${origin}/vision/v1/chat/completions`); expect(options?.method).toBe('POST');
      const headers = new Headers(options?.headers); expect(headers.get('authorization')).toBe(`Bearer ${visionKey}`);
      expect(headers.get('x-request-id')).toBe('configured-request:analysis'); expect(options?.redirect).toBe('error');
      return Response.json({ error: { message: `${visionKey} ${png}`, code: 'private-code' } }, { status });
    } });
    const error: unknown = await configured.generation.analyze(png, '', visionBinding, signal()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error); expect(error).toHaveProperty('message', 'SKETCH_IMAGE_ANALYSIS_UNAVAILABLE');
    expect(readSketchImageKnownFailure(error)).toEqual({ phase: 'analysis', ...visionBinding, kind: 'rejected' });
    expect(Object.keys(error as Error)).toEqual([]); expect(error).not.toHaveProperty('cause');
    expect(String(error) + JSON.stringify(error)).not.toContain(visionKey); expect(String(error) + JSON.stringify(error)).not.toContain(png);
    expect(readSketchImageKnownFailure(new Error((error as Error).message))).toBeUndefined();
    const repeated: unknown = await configured.generation.analyze(png, '', visionBinding, signal()).catch((caught: unknown) => caught);
    expect(repeated).toHaveProperty('message', 'SKETCH_IMAGE_DEPENDENCIES_ALREADY_BOUND'); expect(readSketchImageKnownFailure(repeated)).toBeUndefined();
    expect(sends).toBe(1); expect(requests).toEqual([]);
  });
  it.each([302, 307, 408, 409, 429, 500, 503])('never proves analysis HTTP %i', async status => {
    let sends = 0;
    const { configured } = await bound({ ...ports(), transport: async (): Promise<Response> => { sends++; return new Response('rejection', { status }); } });
    const error: unknown = await configured.generation.analyze(png, '', visionBinding, signal()).catch((caught: unknown) => caught);
    expect(error).toHaveProperty('message', 'SKETCH_IMAGE_ANALYSIS_UNAVAILABLE'); expect(readSketchImageKnownFailure(error)).toBeUndefined(); expect(sends).toBe(1);
  });
  it.each(['forged-error', 'invalid-utf8', 'broken-body', 'oversize', 'redirected', 'invalid-200'] as const)(
    'never proves analysis uncertainty %s', async condition => {
      let sends = 0;
      const { configured } = await bound({ ...ports(), transport: async (): Promise<Response> => {
        sends++;
        if (condition === 'forged-error') throw new SketchProviderError('SKETCH_PROVIDER_REJECTED',
          { ...visionBinding, baseUrl: `${origin}/vision/v1`, apiKey: visionKey, requestId: 'configured-request' }, 'analysis', 'configured-request:analysis', 401);
        if (condition === 'invalid-utf8') return new Response(new Uint8Array([255]), { status: 401 });
        if (condition === 'broken-body') return new Response(new ReadableStream({ start(controller): void { controller.error(new Error('private body failure')); } }), { status: 401 });
        if (condition === 'oversize') return new Response('unfinished', { status: 401, headers: { 'content-length': String(1024 * 1024 + 1) } });
        if (condition === 'redirected') { const response = new Response('rejected', { status: 401 }); Object.defineProperty(response, 'redirected', { value: true }); return response; }
        return Response.json({ model: modelId, error: { message: 'failed' } });
      } });
      const error: unknown = await configured.generation.analyze(png, '', visionBinding, signal()).catch((caught: unknown) => caught);
      expect(error).toHaveProperty('message', 'SKETCH_IMAGE_ANALYSIS_UNAVAILABLE'); expect(readSketchImageKnownFailure(error)).toBeUndefined(); expect(sends).toBe(1);
    });
  it('waits for the original analysis reader to consume the complete rejection body', async () => {
    const entered = deferred(), finish = deferred(); let settled = false;
    const { configured } = await bound({ ...ports(), transport: async (): Promise<Response> => new Response(new ReadableStream<Uint8Array>({
      async start(controller): Promise<void> { controller.enqueue(new TextEncoder().encode('rejected')); entered.release(); await finish.promise; controller.close(); },
    }), { status: 403 }) });
    const pending = configured.generation.analyze(png, '', visionBinding, signal()).catch((caught: unknown) => { settled = true; return caught; });
    await entered.promise; await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
    finish.release(); expect(readSketchImageKnownFailure(await pending)).toEqual({ phase: 'analysis', ...visionBinding, kind: 'rejected' });
  });
  it('does not classify a wrong analysis binding or a response arriving after original cancellation', async () => {
    let sends = 0;
    const first = await bound({ ...ports(), transport: async (): Promise<Response> => { sends++; return new Response('rejected', { status: 401 }); } });
    const error: unknown = await first.configured.generation.analyze(png, '', imageBinding, signal()).catch((caught: unknown) => caught);
    expect(readSketchImageKnownFailure(error)).toBeUndefined(); expect(sends).toBe(0);
    const entered = deferred(), finish = deferred(), controller = new AbortController(), reason = new Error('original abort');
    const second = await bound({ ...ports(), transport: async (): Promise<Response> => { entered.release(); await finish.promise; return new Response('rejected', { status: 401 }); } });
    const pending = second.configured.generation.analyze(png, '', visionBinding, controller.signal); const rejected = expect(pending).rejects.toBe(reason);
    await entered.promise; controller.abort(reason); await rejected; finish.release(); await new Promise<void>(resolve => setImmediate(resolve));
    expect(readSketchImageKnownFailure(reason)).toBeUndefined();
  });
  it.each(['failed', 'cancelled'])('converts only privately confirmed original remote %s into a marked fixed error after current checks', async status => {
    let sends = 0;
    const { configured, prepared } = await bound({ ...ports(), transport: async (url, options): Promise<Response> => {
      sends++; expect(url).toBe(`${origin}/image/v1/tasks/remote%2F42?language=zh`); expect(options?.method || 'GET').toBe('GET');
      expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${imageKey}`);
      return Response.json({ model: modelId, data: { status, task_id: 'remote/42', error: `${imageKey} private` } });
    } });
    events = [];
    const error: unknown = await configured.query('remote/42', identity(prepared), signal()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error); expect(error).toHaveProperty('message', 'SKETCH_IMAGE_RESULT_UNAVAILABLE');
    expect(readSketchImageKnownFailure(error)).toEqual({ phase: 'result', ...imageBinding, kind: 'remote-failed', remoteId: 'remote/42' });
    expect(Object.keys(error as Error)).toEqual([]); expect(String(error) + JSON.stringify(error)).not.toContain(imageKey);
    expect(sends).toBe(1); expect(events).toEqual([`authorize:${actor}:${project}`, `resolve:vision-provider:${modelId}:${actor}`, `resolve:image-provider:${modelId}:${actor}`, 'provider:vision-provider', 'provider:image-provider']);
  });
  it.each([{ data: { status: 'failed' } }, { status: 'completed', data: { status: 'failed', task_id: 'remote/42' } },
    { data: { status: 'failed', task_id: 'remote/42' }, output: { status: 'failed', task_id: 'other' } },
    { data: { status: 'failed', task_id: 'remote/42' }, output: { id: 'other-task' } },
    { data: { status: 'failed', task_id: 'remote/42', output: { id: 'other-task' } } },
    { data: { status: 'failed', task_id: 'remote/42', url: direct } }, { data: { status: 'failed', task_id: 'other' } }])(
    'never converts unknown or mixed query failure %j into definitive proof', async value => {
      let sends = 0;
      const { configured, prepared } = await bound({ ...ports(), transport: async (): Promise<Response> => { sends++; return Response.json(value); } });
      const result: unknown = await configured.query('remote/42', identity(prepared), signal()).catch((caught: unknown) => caught);
      expect(readSketchImageKnownFailure(result)).toBeUndefined(); expect(sends).toBe(1);
    });
  it.each([401, 404, 429, 503])('retains pending for query HTTP %i without a failure proof or POST', async status => {
    let sends = 0;
    const { configured, prepared } = await bound({ ...ports(), transport: async (_url, options): Promise<Response> => {
      sends++; expect(options?.method || 'GET').toBe('GET'); return Response.json({ status: 'failed', task_id: 'remote/42' }, { status });
    } });
    const result = await configured.query('remote/42', identity(prepared), signal());
    expect(result).toEqual({ status: 'pending', imageUrls: [] }); expect(readSketchImageKnownFailure(result)).toBeUndefined(); expect(sends).toBe(1);
  });
  it('retains current routing and model permission checks before terminal query classification', async () => {
    let sends = 0;
    const { configured, prepared } = await bound({ ...ports(), transport: async (): Promise<Response> => { sends++; return Response.json({ data: { status: 'failed', task_id: 'remote/42' } }); } });
    providers['image-provider'].apiKey += '-rotated';
    const drift: unknown = await configured.query('remote/42', identity(prepared), signal()).catch((caught: unknown) => caught);
    expect(drift).toHaveProperty('message', 'SKETCH_IMAGE_ROUTING_CHANGED'); expect(readSketchImageKnownFailure(drift)).toBeUndefined();
    providers['image-provider'].apiKey = imageKey; delete models['vision-provider'];
    const revoked: unknown = await configured.query('remote/42', identity(prepared), signal()).catch((caught: unknown) => caught);
    expect(readSketchImageKnownFailure(revoked)).toBeUndefined(); expect(sends).toBe(0);
  });
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  events = []; requests = []; authorizeHook = undefined; resolveHook = undefined; findHook = undefined;
  access = { kind: 'document', actorUserId: actor, ownerId: 'configured-owner', projectId: project, grantGeneration: '7' };
  providers = Object.fromEntries(['vision', 'image'].map(role => [`${role}-provider`, { id: `${role}-provider`, name: `${role} fixture`,
    baseUrl: `${origin}/${role}/v1`, apiKey: role === 'vision' ? visionKey : imageKey, isEnabled: true,
    type: role === 'vision' ? 'chat' : 'image', modelType: role === 'vision' ? 'chat' : 'image',
    selectedModels: [modelId], requestStyle: role === 'vision' ? 'chat-completions' : 'images-generations',
    advancedParams: { compatProfile: 'openai' }, createdAt: 0, updatedAt: 0 }])) as Record<string, ApiProvider>;
  models = { 'vision-provider': descriptor('vision'), 'image-provider': descriptor('image') };
});

describe('Task8 explicit per-task configured image dependencies', () => {
  it('blocks routing and all provider operations before both roles are resolved', async () => {
    const configured = createConfiguredSketchImageDependencies(ports());
    expect(() => configured.routing()).toThrow('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
    await expect(configured.generation.analyze(png, '', visionBinding, signal())).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
    await expect(configured.generation.generate(buildSketchImageGenerationBody(input(), analysis), imageBinding, signal())).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
    await expect(configured.query('remote/42', {} as SketchImageTaskIdentity, signal())).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
    expect(events).toEqual([]); expect(requests).toEqual([]);
  });
  it('does not expose routing after only the vision role or a still-pending image provider lookup', async () => {
    const configured = createConfiguredSketchImageDependencies(ports()), gate = deferred(), entered = deferred();
    await configured.generation.authorizeProject(actor, project);
    await configured.generation.resolveTaskModel(visionBinding.providerId, modelId, actor);
    expect(() => configured.routing()).toThrow('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
    findHook = async id => { if (id === imageBinding.providerId) { entered.release(); await gate.promise; } };
    const pending = configured.generation.resolveTaskModel(imageBinding.providerId, modelId, actor); await entered.promise;
    expect(() => configured.routing()).toThrow('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
    await expect(configured.generation.analyze(png, '', visionBinding, signal())).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
    gate.release(); await pending; expect(configured.routing().image).toMatch(/^[a-f0-9]{64}$/); expect(requests).toEqual([]);
  });
  it('requires project authorization before any initial role resolution', async () => {
    const configured = createConfiguredSketchImageDependencies(ports());
    await expect(configured.generation.resolveTaskModel(visionBinding.providerId, modelId, actor)).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_NOT_READY');
    expect(events).toEqual([]); expect(requests).toEqual([]);
  });
  it('rejects duplicate authorization and a duplicate or third role resolution without more lookups', async () => {
    const { configured } = await bound(), count = events.length;
    await expect(configured.generation.authorizeProject(actor, project)).rejects.toThrow('SKETCH_IMAGE_DEPENDENCIES_ALREADY_BOUND');
    await expect(configured.generation.resolveTaskModel(imageBinding.providerId, modelId, actor)).rejects.toThrow('SKETCH_IMAGE_DEPENDENCIES_ALREADY_BOUND');
    await expect(configured.generation.resolveTaskModel(visionBinding.providerId, modelId, actor)).rejects.toThrow('SKETCH_IMAGE_DEPENDENCIES_ALREADY_BOUND');
    expect(events).toHaveLength(count); expect(requests).toEqual([]);
  });
  it('rejects concurrent initial resolution instead of interpreting the second call as image', async () => {
    const configured = createConfiguredSketchImageDependencies(ports()), entered = deferred(), gate = deferred();
    await configured.generation.authorizeProject(actor, project);
    resolveHook = async () => { entered.release(); await gate.promise; };
    const first = configured.generation.resolveTaskModel(visionBinding.providerId, modelId, actor); await entered.promise;
    await expect(configured.generation.resolveTaskModel(imageBinding.providerId, modelId, actor)).rejects.toThrow('SKETCH_IMAGE_DEPENDENCIES_ALREADY_BOUND');
    gate.release(); await first;
    await expect(configured.generation.resolveTaskModel(visionBinding.providerId, modelId, actor)).rejects.toThrow('SKETCH_IMAGE_DEPENDENCIES_ALREADY_BOUND');
    expect(events.filter(event => event.startsWith('resolve:'))).toHaveLength(1); expect(requests).toEqual([]);
  });
  it('freezes descriptors returned by role resolution so caller mutation cannot widen admission', async () => {
    const configured = createConfiguredSketchImageDependencies(ports()); await configured.generation.authorizeProject(actor, project);
    const vision = await configured.generation.resolveTaskModel(visionBinding.providerId, modelId, actor);
    models[visionBinding.providerId].supportsVision = false;
    expect(vision.supportsVision).toBe(true); expect(Object.isFrozen(vision)).toBe(true); expect(Object.isFrozen(vision.allowedRatios)).toBe(true);
    expect(() => vision.allowedRatios.push('16:9')).toThrow(); expect(requests).toEqual([]);
  });
  it('uses both exact same-name model bindings over one real analysis POST, image POST and query GET', async () => {
    const { configured, prepared } = await bound(), task = identity(prepared), route = configured.routing();
    expect(Object.keys(route).sort()).toEqual(['image', 'vision']); expect(Object.isFrozen(route)).toBe(true);
    expect(route.vision).toMatch(/^[a-f0-9]{64}$/); expect(route.image).toMatch(/^[a-f0-9]{64}$/); expect(route.vision).not.toBe(route.image);
    expect(JSON.stringify(route)).not.toContain(visionKey); expect(JSON.stringify(route)).not.toContain(imageKey);
    const draft = await prepared.compute(signal(), { beforePhase: async () => { expect(await configured.checkCurrent(task, signal())).toEqual(route); }, afterAnalysis: async () => undefined });
    expect(draft.analysis).toEqual(analysis); expect(draft.receipt).toEqual({ taskIds: ['remote/42'], directImageUrls: [], usedModel: modelId, usedProviderId: imageBinding.providerId });
    expect(await configured.query('remote/42', task, signal())).toEqual({ status: 'completed', imageUrls: [direct] });
    expect(requests.map(item => [item.method, item.url, item.auth])).toEqual([
      ['POST', '/vision/v1/chat/completions', `Bearer ${visionKey}`], ['POST', '/image/v1/images/generations', `Bearer ${imageKey}`],
      ['GET', '/image/v1/tasks/remote%2F42?language=zh', `Bearer ${imageKey}`],
    ]);
    const visionText = JSON.stringify(requests[0].body); expect(visionText).toContain(png); expect(visionText).toContain('保留中文与原草图');
    const imageText = JSON.stringify(requests[1].body); expect(imageText).toContain(png); expect(imageText).toContain('中心构图'); expect(imageText).toContain('水印');
    expect(requests[1].body).toMatchObject({ model: modelId, n: 1, size: '1024x1024', quality: 'high' });
    expect(events.slice(0, 5)).toEqual([`authorize:${actor}:${project}`, `resolve:vision-provider:${modelId}:${actor}`, 'provider:vision-provider', `resolve:image-provider:${modelId}:${actor}`, 'provider:image-provider']);
  });
  it('does not rebind factories after provider, descriptor or ports objects are mutated', async () => {
    const deps = ports(), { configured, prepared } = await bound(deps), original = configured.routing();
    providers[visionBinding.providerId].apiKey = 'changed-vision'; providers[imageBinding.providerId].apiKey = 'changed-image';
    providers[visionBinding.providerId].baseUrl = `${origin}/wrong`; providers[imageBinding.providerId].advancedParams = { compatProfile: '4sapi' };
    models[imageBinding.providerId].allowedSizes.push('4096x4096'); deps.transport = async () => { throw new Error('mutated ports must not run'); };
    const draft = await prepared.compute(signal(), { beforePhase: async () => undefined, afterAnalysis: async () => undefined });
    expect(draft.receipt.taskIds).toEqual(['remote/42']); expect(configured.routing()).toEqual(original);
    expect(requests.map(item => item.auth)).toEqual([`Bearer ${visionKey}`, `Bearer ${imageKey}`]);
  });
  it('consumes a single analysis attempt and preserves the original single-use image stage', async () => {
    const { configured } = await bound(); await configured.generation.analyze(png, '', visionBinding, signal());
    await expect(configured.generation.analyze(png, '', visionBinding, signal())).rejects.toThrow('SKETCH_IMAGE_DEPENDENCIES_ALREADY_BOUND');
    const body = buildSketchImageGenerationBody(input(), analysis); await configured.generation.generate(body, imageBinding, signal());
    await expect(configured.generation.generate(body, imageBinding, signal())).rejects.toThrow(); expect(requests).toHaveLength(2);
  });
  it.each(['vision', 'image'] as const)('rejects exact descriptor identity mismatch for %s without payment', async role => {
    models[`${role}-provider`].providerId = 'wrong-provider'; await expect(bound()).rejects.toThrow('SKETCH_IMAGE_MODEL_UNAVAILABLE'); expect(requests).toEqual([]);
  });
  it.each(['vision', 'image'] as const)('rejects missing role capabilities for %s without fallback', async role => {
    if (role === 'vision') models['vision-provider'].supportsVision = false; else models['image-provider'].supportsReferenceImages = false;
    await expect(bound()).rejects.toThrow('SKETCH_IMAGE_MODEL_UNAVAILABLE'); expect(requests).toEqual([]);
  });
  it.each(['vision', 'image'] as const)('rejects an unavailable explicit %s model without a default model lookup', async role => {
    delete models[`${role}-provider`]; await expect(bound()).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_UNAVAILABLE');
    expect(events.filter(event => event.startsWith('resolve:')).every(event => event.includes(modelId))).toBe(true); expect(requests).toEqual([]);
  });
  it.each(['missing', 'wrong-id', 'unselected', 'disabled'] as const)('rejects a %s provider before factories become ready', async failure => {
    if (failure === 'missing') delete providers['image-provider'];
    else if (failure === 'wrong-id') providers['image-provider'].id = 'other';
    else if (failure === 'unselected') providers['image-provider'].selectedModels = ['other-model'];
    else providers['image-provider'].isEnabled = false;
    const configured = createConfiguredSketchImageDependencies(ports());
    await expect(prepareSketchImage(input(), configured.generation, { actorUserId: actor, signal: signal() })).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_UNAVAILABLE');
    expect(() => configured.routing()).toThrow('SKETCH_IMAGE_CONFIGURATION_NOT_READY'); expect(requests).toEqual([]);
  });
  it('sanitizes denied project and resolver/provider failures without exposing keys, PNG or causes', async () => {
    for (const failingPort of ['authorizeProject', 'resolveTaskModel', 'findProviderById'] as const) {
      const deps = ports(), detail = `${visionKey} ${imageKey} ${png}`;
      const failure = async (): Promise<never> => { throw new Error(detail); }; deps[failingPort] = failure;
      const error: unknown = await bound(deps).catch((caught: unknown) => caught);
      expect(error).toHaveProperty('message', 'SKETCH_IMAGE_CONFIGURATION_UNAVAILABLE'); expect(error).not.toHaveProperty('cause');
      for (const secret of [visionKey, imageKey, png]) expect(String(error) + JSON.stringify(error)).not.toContain(secret);
    }
    expect(requests).toEqual([]);
  });
  it('rechecks current permission and both exact model selections without any provider call', async () => {
    const { configured, prepared } = await bound(); events = [];
    expect(await configured.checkCurrent(identity(prepared), signal())).toEqual(configured.routing());
    expect(events).toEqual([`authorize:${actor}:${project}`, `resolve:vision-provider:${modelId}:${actor}`, `resolve:image-provider:${modelId}:${actor}`, 'provider:vision-provider', 'provider:image-provider']);
    expect(requests).toEqual([]);
  });
  it.each(['denied', 'grant', 'owner', 'unscoped'] as const)('blocks changed current project access %s before query', async change => {
    const { configured, prepared } = await bound();
    if (change === 'denied') authorizeHook = async () => { throw new Error('synthetic revoked grant'); };
    else if (change === 'grant' && access.kind === 'document') access.grantGeneration = '8';
    else if (change === 'owner' && access.kind === 'document') access.ownerId = 'other-owner';
    else access = { kind: 'unscoped', actorUserId: actor };
    await expect(configured.query('remote/42', identity(prepared), signal())).rejects.toThrow(); expect(requests).toEqual([]);
  });
  it.each(['vision', 'image'] as const)('detects current %s model authorization revocation', async role => {
    const { configured, prepared } = await bound(); delete models[`${role}-provider`];
    await expect(configured.checkCurrent(identity(prepared), signal())).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_UNAVAILABLE'); expect(requests).toEqual([]);
  });
  it.each(['vision', 'image', 'quality', 'size'] as const)('revalidates current %s capabilities against the original frozen input', async change => {
    const { configured, prepared } = await bound();
    if (change === 'vision') models['vision-provider'].supportsVision = false;
    else if (change === 'image') models['image-provider'].supportsReferenceImages = false;
    else if (change === 'quality') models['image-provider'].qualityOptions = ['low'];
    else models['image-provider'].allowedSizes = ['512x512'];
    await expect(configured.checkCurrent(identity(prepared), signal())).rejects.toThrow(); expect(requests).toEqual([]);
  });
  it.each(['vision-key', 'vision-base', 'vision-protocol', 'image-key', 'image-base', 'image-profile'] as const)(
    'detects %s routing drift while retaining original routing hashes', async change => {
      const { configured, prepared } = await bound(), route = configured.routing();
      const provider = providers[change.startsWith('vision') ? 'vision-provider' : 'image-provider'];
      if (change.endsWith('key')) provider.apiKey += '-rotated';
      else if (change.endsWith('base')) provider.baseUrl += '/changed';
      else if (change.endsWith('protocol')) provider.requestStyle = 'custom';
      else provider.advancedParams = { compatProfile: 'apimart' };
      await expect(configured.query('remote/42', identity(prepared), signal())).rejects.toThrow('SKETCH_IMAGE_ROUTING_CHANGED');
      expect(configured.routing()).toEqual(route); expect(requests).toEqual([]);
    });
  it('canonicalizes provider object key order without treating it as routing drift', async () => {
    providers['vision-provider'].advancedParams = { compatProfile: 'openai', marker: 'stable' };
    const { configured, prepared } = await bound(); providers['vision-provider'].advancedParams = { marker: 'stable', compatProfile: 'openai' };
    expect(await configured.checkCurrent(identity(prepared), signal())).toEqual(configured.routing()); expect(requests).toEqual([]);
  });
  it.each(['actor', 'project', 'vision', 'image', 'task'] as const)('rejects %s identity swaps with no current lookup or GET', async change => {
    const { configured, prepared } = await bound(), task = identity(prepared); await configured.checkCurrent(task, signal()); events = [];
    const swapped = structuredClone(task);
    if (change === 'actor') Object.assign(swapped, { actorUserId: 'other' });
    else if (change === 'project') Object.assign(swapped, { projectId: 'other' });
    else if (change === 'vision') Object.assign(swapped.input, { visionProviderId: 'other' });
    else if (change === 'image') Object.assign(swapped.input, { imageModelId: 'other' });
    else Object.assign(swapped, { taskId: 'other-task' });
    await expect(configured.query('remote/42', swapped, signal())).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_IDENTITY_MISMATCH');
    expect(events).toEqual([]); expect(requests).toEqual([]);
  });
  it('never shares per-task credential or resolution state across configured instances', async () => {
    const first = await bound(), firstRoute = first.configured.routing(); providers['vision-provider'].apiKey += '-second';
    providers['image-provider'].apiKey += '-second'; const second = await bound();
    expect(second.configured.routing().vision).not.toBe(firstRoute.vision); expect(second.configured.routing().image).not.toBe(firstRoute.image);
    expect(events.filter(event => event.startsWith('resolve:'))).toHaveLength(4); expect(first.configured.routing()).toEqual(firstRoute); expect(requests).toEqual([]);
  });
  it('preserves pre-cancellation and performs zero current lookup or provider operation', async () => {
    const { configured, prepared } = await bound(), controller = new AbortController(), reason = new Error('configured original cancel'); events = []; controller.abort(reason);
    await expect(configured.checkCurrent(identity(prepared), controller.signal)).rejects.toBe(reason);
    await expect(configured.query('remote/42', identity(prepared), controller.signal)).rejects.toBe(reason);
    await expect(configured.generation.analyze(png, '', visionBinding, controller.signal)).rejects.toBe(reason);
    expect(events).toEqual([]); expect(requests).toEqual([]);
    const outcomes: unknown[] = [];
    for (const operation of ['analysis', 'generation', 'query'] as const) {
      const entered = deferred(), gate = deferred(), late = new AbortController(), lateReason = new Error('ignored transport original cancel');
      const second = await bound({ ...ports(), transport: async (): Promise<Response> => {
        entered.release(); await gate.promise;
        return new Response(JSON.stringify({ model: modelId, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }],
          data: operation === 'generation' ? [{ task_id: 'remote/42' }] : { status: 'completed', task_id: 'remote/42', url: direct } }), { headers: { 'content-type': 'application/json' } });
      } });
      let settled = false;
      const pending = operation === 'analysis' ? second.configured.generation.analyze(png, '', visionBinding, late.signal)
        : operation === 'generation' ? second.configured.generation.generate(buildSketchImageGenerationBody(input(), analysis), imageBinding, late.signal)
          : second.configured.query('remote/42', identity(second.prepared), late.signal);
      const observed = pending.then(value => { settled = true; return value; }, (error: unknown) => { settled = true; return error; });
      await entered.promise; late.abort(lateReason); await new Promise<void>(resolve => setImmediate(resolve));
      const settledBeforeLateResponse = settled; gate.release(); const outcome = await observed;
      outcomes.push({ operation, settledBeforeLateResponse, originalReason: outcome === lateReason });
    }
    expect(outcomes).toEqual(['analysis', 'generation', 'query'].map(operation => ({ operation, settledBeforeLateResponse: true, originalReason: true })));
    expect(requests).toEqual([]);
  });
  it.each(['authorize', 'resolve', 'provider'] as const)('rejects cancellation during ignored-signal %s lookup and never advances a late result', async port => {
    const { configured, prepared } = await bound(), entered = deferred(), gate = deferred(), controller = new AbortController(), reason = new Error('configured late cancel');
    const wait = async (): Promise<void> => { entered.release(); await gate.promise; };
    if (port === 'authorize') authorizeHook = wait; else if (port === 'resolve') resolveHook = wait; else findHook = wait;
    events = []; const pending = configured.query('remote/42', identity(prepared), controller.signal); const rejected = expect(pending).rejects.toBe(reason);
    await entered.promise; controller.abort(reason); await rejected; const count = events.length;
    gate.release(); await new Promise<void>(resolve => setImmediate(resolve)); expect(events).toHaveLength(count); expect(requests).toEqual([]);
  });
  it('rejects unknown dependency configuration and getters without evaluating them', () => {
    const deps = ports(); let reads = 0;
    Object.defineProperty(deps, 'unknown', { enumerable: true, get: () => { reads++; return visionKey; } });
    expect(() => createConfiguredSketchImageDependencies(deps)).toThrow('SKETCH_IMAGE_CONFIGURATION_UNAVAILABLE');
    expect(reads).toBe(0); expect(requests).toEqual([]);
  });
});
