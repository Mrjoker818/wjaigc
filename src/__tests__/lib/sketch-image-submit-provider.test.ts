import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createSketchImageGenerationStage, createSketchImageQueryStage, getSketchImageRoutingFingerprint } from '@/lib/sketch-to-code/image-provider';
import { buildSketchImageGenerationBody } from '@/lib/sketch-to-code/image-contract';
import type { ApiProvider } from '@/lib/universal-api-types';
import * as imageProvider from '@/lib/sketch-to-code/image-provider';
import { readSketchImageKnownFailure } from '@/lib/sketch-to-code/image-known-failure';

vi.mock('server-only', () => ({}));

const requestId = 'image-submit-8c';
const secret = 'local-image-fixture-secret';
const direct = 'http://127.0.0.1:1/unpublished.png';
const binding = { providerId: 'image-provider', modelId: 'gpt-image-2' };
let image: string;
let largeImage: string;
let server: Server;
let provider: ApiProvider;
let requests: { method?: string; url: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[];
let respond: (response: ServerResponse) => void;

type Body = ReturnType<typeof buildSketchImageGenerationBody>;
function body(patch: Partial<Body> = {}): Body {
  return { ...buildSketchImageGenerationBody({ projectId: 'project', imageDataUrl: image, instruction: '原关键词：青绿小屋',
    visionProviderId: 'vision', visionModelId: 'vision-model', imageProviderId: binding.providerId,
    imageModelId: binding.modelId, idempotencyKey: 'admission-key', aspectRatio: '4:3', size: '1024x768', quality: 'high' },
  { summary: '小屋和星星', composition: '居中', prompt: '保留草图构图', negativePrompt: '不要水印与模糊' }), ...patch };
}
function stage(transport?: typeof fetch): ReturnType<typeof createSketchImageGenerationStage> {
  return createSketchImageGenerationStage({ provider, modelId: binding.modelId, requestId }, { transport });
}
function reply(value: unknown, status = 200, contentType = 'application/json'): void {
  respond = response => { response.writeHead(status, { 'content-type': contentType }); response.end(JSON.stringify(value)); };
}
function invoke(value: Body = body(), transport?: typeof fetch): ReturnType<ReturnType<typeof createSketchImageGenerationStage>> {
  return stage(transport)(value, binding, new AbortController().signal);
}
function countTransport(counter: { value: number }): typeof fetch {
  return async (url, options): Promise<Response> => { counter.value++; return fetch(url, options); };
}

beforeAll(async () => {
  image = `data:image/png;base64,${(await sharp({ create: { width: 4, height: 3, channels: 4, background: '#20aa88' } }).png().toBuffer()).toString('base64')}`;
  largeImage = `data:image/png;base64,${(await sharp(randomBytes(512 * 512 * 4), { raw: { width: 512, height: 512, channels: 4 } }).png().toBuffer()).toString('base64')}`;
});
beforeEach(async () => {
  requests = []; reply({ data: [{ url: direct }] });
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    requests.push({ method: request.method, url: request.url ?? '', headers: request.headers,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {} });
    respond(response);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  provider = { id: binding.providerId, name: 'local fixture', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    apiKey: secret, isEnabled: true, type: 'image', selectedModels: [binding.modelId], createdAt: 1, updatedAt: 1,
    advancedParams: { compatProfile: 'openai' } };
});

describe('Task8C original single GET query and routing fingerprint', () => {
  function query(transport?: typeof fetch): ReturnType<typeof createSketchImageQueryStage> {
    provider.advancedParams = { compatProfile: 'apimart' };
    return createSketchImageQueryStage({ provider, modelId: binding.modelId, requestId }, { transport });
  }
  it('uses the original completed GET parser, encodes the exact remote ID and returns a deeply frozen single image', async () => {
    const remote = 'remote/../?x=#百分比%';
    reply({ data: { status: 'completed', task_id: remote, model: binding.modelId, result: { images: [{ url: [direct] }] } } });
    let redirect: RequestRedirect | undefined;
    const result = await query(async (url, options): Promise<Response> => { redirect = options?.redirect; return fetch(url, options); })(remote, binding, new AbortController().signal);
    expect(result).toEqual({ status: 'completed', imageUrls: [direct] }); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.imageUrls)).toBe(true);
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ method: 'GET',
      url: '/v1/tasks/remote%2F..%2F%3Fx%3D%23%E7%99%BE%E5%88%86%E6%AF%94%25?language=zh',
      headers: { authorization: `Bearer ${secret}`, 'x-request-id': requestId } }); expect(redirect).toBe('error');
  });
  it.each(['processing', 'queued', 'pending'])('returns frozen pending only for query status %s', async status => {
    reply({ data: { status } }); const result = await query()('remote-42', binding, new AbortController().signal);
    expect(result).toEqual({ status: 'pending', imageUrls: [] }); expect(Object.isFrozen(result.imageUrls)).toBe(true); expect(requests).toHaveLength(1);
  });
  it.each(['failed', 'cancelled'])('returns failed only from a legal native task status %s', async status => {
    reply({ data: { status, task_id: 'remote-42', error: `${secret} private detail` } });
    const result = await query()('remote-42', binding, new AbortController().signal);
    expect(result).toEqual({ status: 'failed', imageUrls: [] }); expect(JSON.stringify(result)).not.toContain(secret); expect(Object.isFrozen(result)).toBe(true);
    const conflicts: unknown[] = [];
    for (const innerStatus of [status, 'completed']) {
      for (const innerId of ['remote-42', undefined]) {
        reply({ task_id: 'other-task', data: { status: innerStatus, ...(innerId ? { task_id: innerId } : {}),
          ...(innerStatus === 'completed' ? { images: [{ id: 'image-metadata', url: direct }] } : {}) } });
        conflicts.push(await query()('remote-42', binding, new AbortController().signal).catch((error: unknown) => error));
      }
      reply({ id: 'other-task', status: innerStatus, data: { status: innerStatus, task_id: 'remote-42',
        ...(innerStatus === 'completed' ? { url: direct } : {}) } });
      conflicts.push(await query()('remote-42', binding, new AbortController().signal).catch((error: unknown) => error));
    }
    expect(conflicts).toEqual(Array.from({ length: 6 }, () => expect.objectContaining({ code: 'SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH' })));
    reply({ id: 'response-metadata', task_id: 'remote-42', data: { status, task_id: 'remote-42' } });
    expect(await query()('remote-42', binding, new AbortController().signal)).toEqual({ status: 'failed', imageUrls: [] });
    reply({ id: 'response-metadata', data: { status: 'completed', task_id: 'remote-42', images: [{ id: 'image-metadata', url: direct }] } });
    expect(await query()('remote-42', binding, new AbortController().signal)).toEqual({ status: 'completed', imageUrls: [direct] });
  });
  it('treats HTTP GET failure as pending, never definite generation failure or another POST', async () => {
    reply({ error: { message: secret } }, 503);
    expect(await query()('remote-42', binding, new AbortController().signal)).toEqual({ status: 'pending', imageUrls: [] });
    expect(requests).toHaveLength(1); expect(requests[0].method).toBe('GET');
  });
  it.each([{ data: { status: 'completed', url: direct, task_id: 'another' } },
    { data: { status: 'completed', model: 'another', url: direct } },
    { data: { status: 'completed', images: [{ url: direct }, { url: direct }] } },
    { data: { status: 'completed', url: 'file:///private/image.png' } },
    { data: { status: 'completed' } }, { data: { status: { toString: 'failed' } } }])(
    'blocks mismatched or unsafe native query receipt %j', async envelope => {
      reply(envelope); await expect(query()('remote-42', binding, new AbortController().signal)).rejects.toHaveProperty('code');
      expect(requests).toHaveLength(1); expect(requests[0].method).toBe('GET');
    });
  it('snapshots query routes and keys, and permits separate one-GET observations of the same remote task', async () => {
    const observe = query(); provider.baseUrl = 'http://127.0.0.1:1'; provider.apiKey = 'changed'; provider.advancedParams!.compatProfile = 'openai';
    reply({ data: { status: 'processing' } }); await observe('remote-42', binding, new AbortController().signal); await observe('remote-42', binding, new AbortController().signal);
    expect(requests).toHaveLength(2); expect(requests.every(request => request.method === 'GET' && request.headers.authorization === `Bearer ${secret}`)).toBe(true);
  });
  it('rejects query binding swaps and invalid remote IDs with zero fetch', async () => {
    const counter = { value: 0 }; const observe = query(countTransport(counter));
    await expect(observe('remote-42', { ...binding, providerId: 'other' }, new AbortController().signal)).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH');
    await expect(observe('bad\nID', binding, new AbortController().signal)).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_INPUT_INVALID');
    expect(counter.value).toBe(0);
    const dotResults: unknown[] = []; reply({ data: { status: 'processing' } });
    for (const remoteId of ['.', '..']) dotResults.push(await observe(remoteId, binding, new AbortController().signal).catch((error: unknown) => error));
    provider.baseUrl = provider.baseUrl.replace('/v1', '/v1/../v1');
    const normalizedRoute = await query(countTransport(counter))('remote-42', binding, new AbortController().signal).catch((error: unknown) => error);
    expect({ results: dotResults, normalizedRoute, sends: counter.value, paths: requests.map(request => request.url) }).toEqual({
      results: Array.from({ length: 2 }, () => expect.objectContaining({ code: 'SKETCH_IMAGE_PROVIDER_INPUT_INVALID' })),
      normalizedRoute: expect.objectContaining({ code: 'SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED' }), sends: 0, paths: [],
    });
  });
  it('preserves query pre-cancellation and cancellation after an ignored transport signal', async () => {
    const controller = new AbortController(), reason = new Error('query original cancel'); const counter = { value: 0 }; controller.abort(reason);
    await expect(query(countTransport(counter))('remote-42', binding, controller.signal)).rejects.toBe(reason); expect(counter.value).toBe(0);
    const late = new AbortController(); reply({ data: { status: 'processing' } });
    const transport: typeof fetch = async (url, options): Promise<Response> => { const response = await fetch(url, { ...options, signal: undefined }); late.abort(reason); return response; };
    await expect(query(transport)('remote-42', binding, late.signal)).rejects.toBe(reason); expect(requests).toHaveLength(1);
  });
  it('applies the same unfinished native body byte budget to query GETs', async () => {
    respond = response => { response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(32 * 1024 * 1024 + 1) }); response.write('{'); };
    await expect(query()('remote-42', binding, new AbortController().signal)).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_LIMIT'); expect(requests).toHaveLength(1);
  });
  it('hashes exact route/model/protocol/key drift without returning or persisting cleartext credentials', () => {
    const fingerprint = (): string => getSketchImageRoutingFingerprint({ provider, modelId: binding.modelId });
    const initial = fingerprint(); expect(initial).toMatch(/^[a-f0-9]{64}$/); expect(initial).not.toContain(secret);
    expect(getSketchImageRoutingFingerprint({ provider: { ...provider, advancedParams: { ...provider.advancedParams } }, modelId: binding.modelId })).toBe(initial);
    provider.apiKey = 'changed'; expect(fingerprint()).not.toBe(initial); provider.apiKey = secret;
    provider.baseUrl += '/changed'; expect(fingerprint()).not.toBe(initial); provider.baseUrl = provider.baseUrl.replace('/changed', '');
    provider.advancedParams = { compatProfile: 'apimart' }; expect(fingerprint()).not.toBe(initial);
    provider.selectedModels = ['gpt-image-1']; expect(getSketchImageRoutingFingerprint({ provider, modelId: 'gpt-image-1' })).not.toBe(initial);
    expect(requests).toHaveLength(0);
  });
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('Task8C original adapter single submission over native local HTTP', () => {
  // Breaks caught: dropping PNG/settings, wrong route, any fetch for assets, mutable receipt.
  it('reuses OpenAI generations with one original PNG, negative prompt and exact settings and returns a frozen draft', async () => {
    const value = body(); let redirect: RequestRedirect | undefined;
    const result = await invoke(value, async (url, options): Promise<Response> => { redirect = options?.redirect; return fetch(url, options); });
    expect(result).toEqual({ taskIds: [], directImageUrls: [direct], usedModel: binding.modelId, usedProviderId: binding.providerId });
    expect([result, result.taskIds, result.directImageUrls].every(Object.isFrozen)).toBe(true);
    expect(requests).toHaveLength(1); expect(redirect).toBe('error');
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/v1/images/generations', headers: {
      authorization: `Bearer ${secret}`, 'idempotency-key': requestId, 'x-request-id': requestId }, body: {
      model: 'gpt-image-2', n: 1, size: '1024x768', quality: 'high', images: [{ image_url: { url: image } }] } });
    expect(requests[0].body.prompt).toContain(value.prompt); expect(requests[0].body.prompt).toContain(value.negativePrompt);
    expect(requests[0].body.prompt).toContain('4:3'); expect(result).not.toHaveProperty('assetId');
  });
  it('reuses Gemini chat image builder/parser with a single PNG and retains negative/size/quality/aspect instructions', async () => {
    const modelId = 'gemini-2.5-flash-image'; provider.selectedModels = [modelId]; provider.advancedParams = { compatProfile: 'gemini-image' };
    reply({ model: modelId, choices: [{ message: { content: [{ type: 'image_url', image_url: { url: image } }] } }] });
    const result = await createSketchImageGenerationStage({ provider, modelId, requestId })(body({ model: modelId }),
      { providerId: provider.id, modelId }, new AbortController().signal);
    expect(result.directImageUrls).toEqual([image]); expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/v1/chat/completions');
    const messages = requests[0].body.messages as { content: { type: string; text?: string; image_url?: { url: string } }[] }[];
    expect(messages[0].content.filter(part => part.type === 'image_url')).toEqual([{ type: 'image_url', image_url: { url: image } }]);
    const prompt = messages[0].content.find(part => part.type === 'text')?.text;
    for (const text of [body().prompt, '不要水印与模糊', '4:3', '1024x768', 'high']) expect(prompt).toContain(text);
    expect(requests[0].body.generationConfig).toMatchObject({ image_size: '1024x768', responseModalities: ['IMAGE'] });
  });
  it('reuses APImart async profile/parser and returns one remote task without polling or downloading', async () => {
    provider.advancedParams = { compatProfile: 'apimart' }; reply({ model: binding.modelId, data: [{ task_id: 'remote-42' }] });
    expect(await invoke(body({ size: undefined }))).toEqual({ taskIds: ['remote-42'], directImageUrls: [], usedModel: binding.modelId, usedProviderId: binding.providerId });
    expect(requests).toHaveLength(1); expect(requests[0].body).toMatchObject({ image_urls: [image], n: 1, size: '4:3', quality: 'high' });
  });
  it('blocks APImart explicit pixel sizes because its existing profile strips pixel hints', async () => {
    provider.advancedParams = { compatProfile: 'apimart' }; const counter = { value: 0 };
    await expect(invoke(body(), countTransport(counter))).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED');
    expect(counter.value).toBe(0); expect(requests).toHaveLength(0);
  });
  it('freezes provider, credential, profile, model and request ID before the factory inputs are changed', async () => {
    const config = { provider, modelId: binding.modelId, requestId }; const submit = createSketchImageGenerationStage(config);
    provider.id = 'other'; provider.apiKey = 'changed'; provider.baseUrl = 'http://127.0.0.1:1'; provider.isEnabled = false;
    provider.advancedParams!.compatProfile = 'gemini-image'; provider.selectedModels![0] = 'changed'; config.modelId = 'changed'; config.requestId = 'changed';
    expect((await submit(body(), binding, new AbortController().signal)).usedModel).toBe('gpt-image-2');
    expect(requests).toHaveLength(1); expect(requests[0].headers.authorization).toBe(`Bearer ${secret}`);
    expect(requests[0].headers['idempotency-key']).toBe(requestId);
  });
  it('fences concurrent reuse of the same stage before a second transport send', async () => {
    const submit = stage(); const outcomes = await Promise.allSettled([submit(body(), binding, new AbortController().signal), submit(body(), binding, new AbortController().signal)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'SKETCH_IMAGE_PROVIDER_EXTRA_REQUEST' } });
    expect(requests).toHaveLength(1);
  });
  it.each([404, 429, 500, 503])('blocks all retry/fallback POST paths after HTTP %i', async status => {
    provider.baseUrl = provider.baseUrl.replace('/v1', '');
    reply({ error: { message: `No available channel model_not_found try nano-banana ${secret} ${image}`, code: secret } }, status);
    const counter = { value: 0 };
    await expect(invoke(body(), countTransport(counter))).rejects.toMatchObject({ code: 'SKETCH_IMAGE_PROVIDER_REJECTED', providerStatus: status });
    expect(counter.value).toBe(1); expect(requests).toHaveLength(1);
  });
  it('rejects redirects without sending to the redirect target', async () => {
    respond = response => { response.writeHead(307, { location: '/v1/redirect-target' }); response.end(); };
    await expect(invoke()).rejects.toMatchObject({ code: 'SKETCH_IMAGE_PROVIDER_TRANSPORT_FAILED' });
    expect(requests).toHaveLength(1);
  });
  it.each([{ providerId: 'other', modelId: binding.modelId }, { ...binding, modelId: 'other' }])('rejects binding swaps %j before any I/O', async changed => {
    const counter = { value: 0 };
    await expect(stage(countTransport(counter))(body(), changed, new AbortController().signal)).rejects.toMatchObject({ code: 'SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH' });
    expect(counter.value).toBe(0); expect(requests).toHaveLength(0);
  });
  it.each([{ providerId: 'other' }, { model: 'other' }, { outputCount: 2 }, { submitOnly: false },
    { referenceImages: [] }, { referenceImages: ['http://127.0.0.1:1/source.png'] }, { imageUrl: 'data:image/png;base64,AA==' },
    { referenceImages: ['data:image/jpeg;base64,AA=='] }])('rejects invalid generation body %j before I/O', async patch => {
    const counter = { value: 0 };
    await expect(invoke({ ...body(), ...patch } as Body, countTransport(counter))).rejects.toHaveProperty('code');
    expect(counter.value).toBe(0); expect(requests).toHaveLength(0);
  });
  it('preserves a pre-cancelled original reason with zero fetch', async () => {
    const controller = new AbortController(), reason = new Error('caller cancelled'); controller.abort(reason);
    const counter = { value: 0 };
    await expect(stage(countTransport(counter))(body(), binding, controller.signal)).rejects.toBe(reason); expect(counter.value).toBe(0);
  });
  it('combines caller and adapter signal and preserves cancellation after a transport ignores the signal', async () => {
    const controller = new AbortController(), reason = new Error('late original cancellation');
    let combined: AbortSignal | null | undefined;
    const transport: typeof fetch = async (url, options): Promise<Response> => {
      combined = options?.signal; const response = await fetch(url, { ...options, signal: undefined }); controller.abort(reason); return response;
    };
    await expect(stage(transport)(body(), binding, controller.signal)).rejects.toBe(reason);
    expect(combined).not.toBe(controller.signal); expect(combined?.aborted).toBe(true); expect(requests).toHaveLength(1);
  });
  it('cancels an unfinished native HTTP body and throws original cancellation', async () => {
    const controller = new AbortController(), reason = new Error('cancel body');
    respond = response => { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); setTimeout(() => controller.abort(reason), 25); };
    await expect(stage()(body(), binding, controller.signal)).rejects.toBe(reason); expect(requests).toHaveLength(1);
  });
  it('rejects declared Content-Length above 32MiB before waiting for unfinished body', async () => {
    respond = response => { response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(32 * 1024 * 1024 + 1) }); response.write('{'); };
    await expect(invoke()).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_LIMIT'); expect(requests).toHaveLength(1);
  });
  it('counts actual streamed UTF-8 bytes above 32MiB and closes an unfinished native HTTP stream', async () => {
    let closed!: () => void; const closure = new Promise<void>(resolve => { closed = resolve; });
    respond = response => {
      response.once('close', closed); response.writeHead(200, { 'content-type': 'application/json' });
      response.write(Buffer.alloc(32 * 1024 * 1024, 0x61)); response.write(Buffer.from('界'));
    };
    await expect(invoke()).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_LIMIT'); await closure; expect(requests).toHaveLength(1);
  }, 15_000);
  it.each([{ model: 'other', data: [{ url: direct }] }, { model: null, data: [{ url: direct }] },
    { model: binding.modelId, data: { model: 'other', task_id: 'remote' } }])('rejects upstream self-reported wrong model %j even when adapter usedModel is local', async envelope => {
    reply(envelope); await expect(invoke()).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH'); expect(requests).toHaveLength(1);
  });
  it.each([{ data: [{ url: direct }, { url: direct }] }, { data: [{ task_id: 'a' }, { task_id: 'b' }] },
    { data: { url: direct, task_id: 'a' } }, { data: [{ url: 'javascript:alert(1)' }] }, { data: { task_id: 'bad\nID' } }, {}])(
    'rejects ambiguous/invalid draft receipts %j', async envelope => {
      reply(envelope); await expect(invoke()).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID'); expect(requests).toHaveLength(1);
      if (Object.keys(envelope).length === 0) {
        const dotResults: unknown[] = [];
        for (const task_id of ['.', '..']) {
          reply({ data: [{ task_id }] }); dotResults.push(await invoke().catch((error: unknown) => error));
        }
        expect(dotResults).toEqual(Array.from({ length: 2 }, () => expect.objectContaining({ code: 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID' })));
        expect(requests).toHaveLength(3);
      }
    });
  it('rejects a task and direct image in the same array item even if the original parser chooses only the URL', async () => {
    reply({ data: [{ url: direct, task_id: 'hidden-remote-task' }] });
    await expect(invoke()).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID');
    expect(requests).toHaveLength(1);
  });
  it('rejects URL and base64 in one item instead of trusting the original parser preference', async () => {
    reply({ data: [{ url: direct, b64_json: image.split(',')[1] }] });
    await expect(invoke()).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID');
    expect(requests).toHaveLength(1);
  });
  it('rejects a second output hidden behind the original parser data preference', async () => {
    reply({ data: [{ url: direct }], output: { image_url: direct } });
    await expect(invoke()).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID');
  });
  it('rejects multiple Gemini choices instead of accepting only the first image', async () => {
    const modelId = 'gemini-2.5-flash-image'; provider.selectedModels = [modelId]; provider.advancedParams = { compatProfile: 'gemini-image' };
    const choice = { message: { content: [{ type: 'image_url', image_url: { url: image } }] } };
    reply({ model: modelId, choices: [choice, choice] });
    await expect(createSketchImageGenerationStage({ provider, modelId, requestId })(body({ model: modelId }),
      { providerId: provider.id, modelId }, new AbortController().signal)).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID');
  });
  it('blocks Gemini prose extraction because its original parser accepts only the first Markdown image', async () => {
    const modelId = 'gemini-2.5-flash-image'; provider.selectedModels = [modelId]; provider.advancedParams = { compatProfile: 'gemini-image' };
    reply({ model: modelId, choices: [{ message: { content: `![first](${direct}) ![second](${direct})` } }] });
    await expect(createSketchImageGenerationStage({ provider, modelId, requestId })(body({ model: modelId }),
      { providerId: provider.id, modelId }, new AbortController().signal)).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID');
  });
  it.each([{ isEnabled: false }, { apiKey: '' }, { baseUrl: 'ftp://127.0.0.1' },
    { baseUrl: 'http://user:password@127.0.0.1' }, { selectedModels: ['other'] }, { type: 'chat' as const }])(
    'rejects unavailable factory configuration %j before any network', patch => {
      provider = { ...provider, ...patch }; const counter = { value: 0 };
      expect(() => stage(countTransport(counter))).toThrow('SKETCH_IMAGE_PROVIDER_UNAVAILABLE');
      expect(counter.value).toBe(0); expect(requests).toHaveLength(0);
    });
  it('snapshots the caller body before asynchronous adapter execution can observe mutation', async () => {
    const value = body(); const pending = invoke(value);
    value.referenceImages[0] = 'http://127.0.0.1:1/changed'; value.prompt = 'changed'; value.negativePrompt = 'changed'; value.size = '2048x2048';
    await pending;
    expect(requests[0].body).toMatchObject({ images: [{ image_url: { url: image } }], size: '1024x768' });
    expect(requests[0].body.prompt).toContain('保留草图构图'); expect(requests[0].body.prompt).toContain('不要水印与模糊');
  });
  it('keeps upstream text, secret, PNG and transport error causes out of the safe returned error', async () => {
    reply({ error: { message: `${secret} ${image}`, code: secret } }, 401);
    const error: unknown = await invoke().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'SKETCH_IMAGE_PROVIDER_REJECTED', providerId: binding.providerId, modelId: binding.modelId, requestId, providerStatus: 401 });
    expect(String(error) + JSON.stringify(error)).not.toContain(secret); expect(String(error) + JSON.stringify(error)).not.toContain(image);
    expect(error).not.toHaveProperty('cause');
    const privateText = 'synthetic-upstream-private-text';
    // Observe real console calls without suppressing/replacing the old adapter logger.
    const logged = vi.spyOn(console, 'log'), errored = vi.spyOn(console, 'error');
    try {
      reply({ error: { message: `${secret} ${image} ${privateText}` } });
      const okError: unknown = await invoke().catch((caught: unknown) => caught);
      expect(okError).toMatchObject({ code: 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID' });
      expect(String(okError) + JSON.stringify(okError)).not.toContain(secret);
      expect(String(okError) + JSON.stringify(okError)).not.toContain(image);
      expect(String(okError) + JSON.stringify(okError)).not.toContain(privateText);
      reply({ data: [{ url: direct }], privateNote: `${secret} ${image} ${privateText}` });
      expect((await invoke()).directImageUrls).toEqual([direct]);
      reply({ data: [{ url: image }], privateNote: `${secret} ${privateText}` });
      expect((await invoke()).directImageUrls).toEqual([image]);
      reply({ data: [{ task_id: 'remote-42' }], privateNote: `${secret} ${image} ${privateText}` });
      expect((await invoke()).taskIds).toEqual(['remote-42']);
      const transcript = JSON.stringify([...logged.mock.calls, ...errored.mock.calls]);
      for (const sensitive of [secret, image, privateText]) expect(transcript).not.toContain(sensitive);
    } finally { logged.mockRestore(); errored.mockRestore(); }
  });
  it('blocks adapter JPEG recompression of a large original PNG before the first send', async () => {
    const counter = { value: 0 }; expect(largeImage.length).toBeGreaterThan(800_000);
    await expect(invoke(body({ imageUrl: largeImage, referenceImages: [largeImage] }), countTransport(counter)))
      .rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED');
    expect(counter.value).toBe(0); expect(requests).toHaveLength(0);
  });
  it('blocks the 4SAPI profile when its native adapter drops the requested quality before any send', async () => {
    provider.advancedParams = { compatProfile: '4sapi' }; const counter = { value: 0 };
    await expect(invoke(body(), countTransport(counter))).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED');
    expect(counter.value).toBe(0);
  });
  it('safely rejects non-JSON and invalid UTF-8 native responses without V1 or protocol retries', async () => {
    respond = response => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(Buffer.from([0xff])); };
    await expect(invoke()).rejects.toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_RESPONSE_INVALID'); expect(requests).toHaveLength(1);
  });
});

describe('Task8 bounded private provider failure proof', () => {
  // Breaks caught: treating an adapter attempt as an actual send, or reusing its proof.
  it.each(['apimart-size', '4sapi-quality', 'large-png'] as const)('proves only the first zero-send preflight %s', async condition => {
    if (condition === 'apimart-size') provider.advancedParams = { compatProfile: 'apimart' };
    if (condition === '4sapi-quality') provider.advancedParams = { compatProfile: '4sapi' };
    const counter = { value: 0 }, submit = stage(countTransport(counter));
    const value = condition === 'large-png' ? body({ imageUrl: largeImage, referenceImages: [largeImage] }) : body();
    const error: unknown = await submit(value, binding, new AbortController().signal).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'SKETCH_IMAGE_PROVIDER_PROTOCOL_UNSUPPORTED' });
    expect(readSketchImageKnownFailure(error)).toEqual({ phase: 'generation', ...binding, kind: 'not-submitted' });
    expect(error).not.toHaveProperty('kind'); expect(error).not.toHaveProperty('phase');
    expect(readSketchImageKnownFailure(JSON.parse(JSON.stringify(error)))).toBeUndefined();
    const repeated: unknown = await submit(value, binding, new AbortController().signal).catch((caught: unknown) => caught);
    expect(repeated).toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_EXTRA_REQUEST');
    expect(readSketchImageKnownFailure(repeated)).toBeUndefined(); expect(counter.value).toBe(0); expect(requests).toHaveLength(0);
  });
  // Breaks caught: broad 4xx guessing, marker serialization or a second paid POST.
  it.each([400, 401, 403, 404, 405, 413, 415, 422])('proves fully consumed selected POST rejection %i', async status => {
    reply({ error: { message: `${secret} ${image}` } }, status);
    const counter = { value: 0 }, error: unknown = await invoke(body(), countTransport(counter)).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'SketchImageProviderError', code: 'SKETCH_IMAGE_PROVIDER_REJECTED', providerStatus: status });
    expect(readSketchImageKnownFailure(error)).toEqual({ phase: 'generation', ...binding, kind: 'rejected' });
    expect(Object.keys(error as Error).sort()).toEqual(['code', 'modelId', 'name', 'providerId', 'providerStatus', 'requestId']);
    expect(JSON.stringify(error)).not.toContain(secret); expect(readSketchImageKnownFailure({ ...(error as Error) })).toBeUndefined();
    expect(counter.value).toBe(1); expect(requests).toHaveLength(1);
  });
  it.each([302, 307, 408, 409, 429, 500, 503, 599])('never proves ambiguous HTTP %i', async status => {
    const counter = { value: 0 };
    const error: unknown = await invoke(body(), async (): Promise<Response> => {
      counter.value++; return new Response('explicit-looking rejection', { status });
    }).catch((caught: unknown) => caught);
    expect(error).toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_REJECTED');
    expect(readSketchImageKnownFailure(error)).toBeUndefined(); expect(counter.value).toBe(1); expect(requests).toHaveLength(0);
  });
  it.each(['transport', 'invalid-utf8', 'broken-body', 'oversize', 'redirected', 'invalid-receipt'] as const)(
    'never proves uncertain selected transport or receipt %s', async condition => {
      let sends = 0;
      const error: unknown = await invoke(body(), async (): Promise<Response> => {
        sends++;
        if (condition === 'transport') throw new Error('SKETCH_IMAGE_PROVIDER_REJECTED');
        if (condition === 'invalid-utf8') return new Response(new Uint8Array([255]), { status: 401 });
        if (condition === 'broken-body') return new Response(new ReadableStream({ start(controller): void { controller.error(new Error('body failed')); } }), { status: 401 });
        if (condition === 'oversize') return new Response('unfinished', { status: 401, headers: { 'content-length': String(32 * 1024 * 1024 + 1) } });
        if (condition === 'redirected') { const response = new Response('rejected', { status: 401 }); Object.defineProperty(response, 'redirected', { value: true }); return response; }
        return Response.json({ data: [{ task_id: 'accepted', url: direct }] });
      }).catch((caught: unknown) => caught);
      expect(error).toHaveProperty('code'); expect(readSketchImageKnownFailure(error)).toBeUndefined(); expect(sends).toBe(1);
    });
  it('never marks mismatched bindings or cancellation, even before an outbound call', async () => {
    const submit = stage(), controller = new AbortController(), reason = new Error('original cancelled'); controller.abort(reason);
    const mismatch: unknown = await submit(body(), { ...binding, modelId: 'other' }, new AbortController().signal).catch((caught: unknown) => caught);
    expect(mismatch).toHaveProperty('code', 'SKETCH_IMAGE_PROVIDER_BINDING_MISMATCH'); expect(readSketchImageKnownFailure(mismatch)).toBeUndefined();
    await expect(submit(body(), binding, controller.signal)).rejects.toBe(reason); expect(readSketchImageKnownFailure(reason)).toBeUndefined(); expect(requests).toHaveLength(0);
  });
  it('does not prove rejection until the entire bounded response body is read', async () => {
    let release!: () => void;
    const entered = new Promise<void>(resolve => { release = resolve; }); let finish!: () => void;
    const complete = new Promise<void>(resolve => { finish = resolve; }); let settled = false;
    const pending = invoke(body(), async (): Promise<Response> => new Response(new ReadableStream<Uint8Array>({
      async start(controller): Promise<void> { controller.enqueue(new TextEncoder().encode('rejected')); release(); await complete; controller.close(); },
    }), { status: 422 })).catch((caught: unknown) => { settled = true; return caught; });
    await entered; await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
    finish(); const error = await pending; expect(readSketchImageKnownFailure(error)).toEqual({ phase: 'generation', ...binding, kind: 'rejected' });
  });
  // Breaks caught: confusing ordinary failed output with validated native provenance.
  const readQueryFailure = (value: unknown): unknown => (imageProvider as unknown as {
    readConfirmedSketchImageQueryFailure?: (result: unknown) => unknown;
  }).readConfirmedSketchImageQueryFailure?.(value);
  it.each(['failed', 'cancelled'])('preserves the ordinary contract and privately proves original remote %s', async status => {
    provider.advancedParams = { compatProfile: 'apimart' };
    reply({ model: binding.modelId, data: { status, task_id: 'remote-42', error: secret } });
    const result = await createSketchImageQueryStage({ provider, modelId: binding.modelId, requestId })('remote-42', binding, new AbortController().signal);
    expect(result).toEqual({ status: 'failed', imageUrls: [] }); expect(Object.isFrozen(result)).toBe(true);
    expect(readQueryFailure(result)).toEqual({ ...binding, remoteId: 'remote-42' });
    expect(readQueryFailure({ ...result })).toBeUndefined(); expect(readQueryFailure(JSON.parse(JSON.stringify(result)))).toBeUndefined();
    expect(requests).toHaveLength(1); expect(requests[0].method).toBe('GET');
  });
  it.each([{ data: { status: 'failed' } }, { status: 'completed', data: { status: 'failed', task_id: 'remote-42' } },
    { data: { status: 'failed', task_id: 'remote-42' }, output: { status: 'completed', task_id: 'other' } },
    { data: { status: 'failed', task_id: 'remote-42' }, output: { id: 'other-task' } },
    { data: { status: 'failed', task_id: 'remote-42', output: { id: 'other-task' } } },
    { data: { status: 'failed', task_id: 'remote-42', url: direct } },
    { data: { status: 'failed', task_id: 'other' } }, { data: [{ status: 'failed', task_id: 'remote-42' }], status: 'failed', task_id: 'remote-42' }])(
    'never proves a missing, mixed or mismatched native terminal envelope %j', async envelope => {
      provider.advancedParams = { compatProfile: 'apimart' }; reply(envelope);
      const result: unknown = await createSketchImageQueryStage({ provider, modelId: binding.modelId, requestId })('remote-42', binding, new AbortController().signal).catch((caught: unknown) => caught);
      expect(readQueryFailure(result)).toBeUndefined(); expect(readSketchImageKnownFailure(result)).toBeUndefined(); expect(requests).toHaveLength(1); expect(requests[0].method).toBe('GET');
    });
});
