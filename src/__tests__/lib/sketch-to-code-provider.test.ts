import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSketchImageAnalysisStage, createSketchProviderStages, SketchProviderError } from '@/lib/sketch-to-code/provider';
import { createConfiguredSketchDependencies } from '@/lib/sketch-to-code/configured-dependencies';
import { generateSketchCode, prepareSketchCode } from '@/lib/sketch-to-code/generation';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { ApiProvider } from '@/lib/universal-api-types';
import { compileSketchHtml } from '@/lib/sketch-to-code/html';
import { validateSketchDraft } from '@/lib/sketch-to-code/document';

vi.mock('server-only', () => ({}));

const analysis = { summary: '登录页', layout: '竖直排列', controls: ['名称', '确认'], text: ['欢迎'] };
const tree = { type: 'container', children: [{ type: 'heading', text: '欢迎' }, { type: 'button', text: '确认' }] };
const image = createCanvas(8, 8).toDataURL('image/png');
const model: TaskModelDescriptor = {
  providerId: 'p1', modelId: 'vision-1', kind: 'chat', sourceType: 'vlm', protocol: 'chat-completions', executionMode: 'sync',
  allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1, supportsVision: true,
  supportsReferenceImages: true, supportsMask: false, outputKinds: ['text'], capabilitySources: { supportsVision: 'admin' },
};
const binding = { providerId: 'p1', modelId: 'vision-1' };
let server: Server;
let baseUrl: string;
let provider: ApiProvider;
let requests: { url: string; authorization: string | undefined; body: Record<string, unknown> }[];
let respond: (response: ServerResponse, count: number) => void;

function envelope(content = JSON.stringify(analysis)): string {
  return JSON.stringify({ model: 'vision-1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] });
}
function usageDependencies(): ReturnType<typeof createConfiguredSketchDependencies> {
  return createConfiguredSketchDependencies({
    authorizeProject: async ({ actorUserId, projectId }) => ({ kind: 'personal', actorUserId, ownerId: actorUserId, projectId: String(projectId) }),
    resolveTaskModel: async () => structuredClone(model), findProviderById: async () => provider,
  });
}
const usageInput = { projectId: 'project-a', imageDataUrl: image, instruction: '', ...binding, idempotencyKey: 'usage-task' };

beforeEach(async () => {
  requests = [];
  respond = (response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(envelope()); };
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    requests.push({ url: request.url ?? '', authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> });
    respond(response, requests.length);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  provider = { id: 'p1', name: 'test provider', baseUrl, apiKey: 'server-fixture-secret', isEnabled: true, type: 'vlm', createdAt: 1, updatedAt: 1, selectedModels: ['vision-1'] };
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('configured sketch provider HTTP boundary', () => {
  it.each(['both-missing', 'analysis-missing', 'reconstruction-missing', 'zero'] as const)(
    'usage handles native %s without synthesizing missing counts', async variant => {
      respond = (response, count) => {
        const body = JSON.parse(envelope(JSON.stringify(count === 1 ? analysis : tree))) as Record<string, unknown>;
        if (variant === 'zero') body.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        else if (variant === 'analysis-missing' && count === 2 || variant === 'reconstruction-missing' && count === 1) body.usage = { prompt_tokens: 7, completion_tokens: 8 };
        response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
      };
      const draft = await generateSketchCode(usageInput, usageDependencies(), { actorUserId: 'user-a', signal: new AbortController().signal });
      if (variant === 'both-missing') expect(draft).not.toHaveProperty('usage');
      else expect(draft).toHaveProperty('usage', {
        analysis: variant === 'analysis-missing' ? null : { inputTokens: variant === 'zero' ? 0 : 7, outputTokens: variant === 'zero' ? 0 : 8 },
        reconstruction: variant === 'reconstruction-missing' ? null : { inputTokens: variant === 'zero' ? 0 : 7, outputTokens: variant === 'zero' ? 0 : 8 },
        total: variant === 'zero' ? { inputTokens: 0, outputTokens: 0 } : null,
      });
      expect(draft.html).toBe(compileSketchHtml(tree)); expect(requests).toHaveLength(2);
    },
  );
  it('usage returns owned frozen provider wrappers and omits missing stage usage', async () => {
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'usage-stage' });
    const missing = await stages.analyze(image, '', binding, new AbortController().signal);
    expect(missing).toEqual({ content: JSON.stringify(analysis) }); expect(Object.isFrozen(missing)).toBe(true);
    respond = response => {
      const body = JSON.parse(envelope()) as Record<string, unknown>; body.usage = { prompt_tokens: 101, completion_tokens: 17 };
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
    };
    const actual = await stages.analyze(image, '', binding, new AbortController().signal);
    expect(actual).toEqual({ content: JSON.stringify(analysis), usage: { inputTokens: 101, outputTokens: 17 } });
    expect(Object.isFrozen(actual)).toBe(true);
    expect(Object.isFrozen((actual as { usage: object }).usage)).toBe(true);
  });
  it.each([[1, 'error'], [2, 'error'], [1, 'invalid-usage'], [2, 'invalid-usage']] as const)(
    'usage rejects native phase%i %s without a draft or extra POST', async (phase, variant) => {
      respond = (response, count) => {
        const fail = count === phase;
        const body = JSON.parse(envelope(JSON.stringify(count === 1 ? analysis : tree))) as Record<string, unknown>;
        body.usage = fail && variant === 'invalid-usage' ? { prompt_tokens: 7, completion_tokens: 8, total_tokens: 99 } : { prompt_tokens: 7, completion_tokens: 8 };
        response.writeHead(fail && variant === 'error' ? 503 : 200, { 'content-type': 'application/json', 'x-request-id': 'usage-failed-42' });
        response.end(JSON.stringify(fail && variant === 'error' ? { error: { code: 'capacity', message: 'server-fixture-secret' } } : body));
      };
      const result = await generateSketchCode(usageInput, usageDependencies(), { actorUserId: 'user-a', signal: new AbortController().signal }).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(SketchProviderError);
      expect(result).toMatchObject({ code: variant === 'error' ? 'SKETCH_PROVIDER_REJECTED' : 'SKETCH_PROVIDER_RESPONSE_INVALID',
        phase: phase === 1 ? 'analysis' : 'reconstruction', requestId: 'usage-failed-42', providerStatus: variant === 'error' ? 503 : 200 });
      expect(JSON.stringify(result) + String(result)).not.toContain('server-fixture-secret');
      expect(result).not.toHaveProperty('usage'); expect(requests).toHaveLength(phase);
    },
  );
  it.each([1, 2])('usage cancels native phase%i and discards a late complete counted body', async phase => {
    const abort = new AbortController(); const reason = new Error('usage-native-cancel');
    let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
    let closed!: () => void; const closure = new Promise<void>(resolve => { closed = resolve; });
    let late!: () => void;
    respond = (response, count) => {
      const body = JSON.parse(envelope(JSON.stringify(count === 1 ? analysis : tree))) as Record<string, unknown>;
      body.usage = { prompt_tokens: 7, completion_tokens: 8, total_tokens: 15 };
      response.writeHead(200, { 'content-type': 'application/json' });
      if (count === phase) { response.on('close', closed); response.write('{'); late = () => response.end(JSON.stringify(body).slice(1)); ready(); }
      else response.end(JSON.stringify(body));
    };
    const pending = generateSketchCode(usageInput, usageDependencies(), { actorUserId: 'user-a', signal: abort.signal });
    const outcome = pending.then(draft => ({ draft }), (error: unknown) => ({ error }));
    await started; abort.abort(reason); const result = await outcome;
    expect(result).toEqual({ error: reason }); expect(result).not.toHaveProperty('draft');
    await closure; late(); expect(requests).toHaveLength(phase);
  });

  it('usage keeps distinct native HTTP phase counters in the server draft', async () => {
    respond = (response, count) => {
      const body = JSON.parse(envelope(JSON.stringify(count === 1 ? analysis : tree))) as Record<string, unknown>;
      body.usage = count === 1 ? { prompt_tokens: 101, completion_tokens: 17, total_tokens: 118, prompt_tokens_details: { cached_tokens: 99 } }
        : { prompt_tokens: 203, completion_tokens: 29, total_tokens: 232 };
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
    };
    const dependencies = createConfiguredSketchDependencies({
      authorizeProject: async ({ actorUserId, projectId }) => ({ kind: 'personal', actorUserId, ownerId: actorUserId, projectId: String(projectId) }),
      resolveTaskModel: async () => structuredClone(model), findProviderById: async () => provider,
    });
    const prepared = await prepareSketchCode({ projectId: 'project-a', imageDataUrl: image, instruction: '', ...binding, idempotencyKey: 'usage-task' }, dependencies,
      { actorUserId: 'user-a', signal: new AbortController().signal });
    expect(requests).toHaveLength(0);
    provider.apiKey = 'changed'; provider.baseUrl = 'http://127.0.0.1:1';
    const result = await prepared.compute(new AbortController().signal);
    expect(result).toHaveProperty('usage', { analysis: { inputTokens: 101, outputTokens: 17 }, reconstruction: { inputTokens: 203, outputTokens: 29 }, total: { inputTokens: 304, outputTokens: 46 } });
    const validated = validateSketchDraft(structuredClone(result));
    expect(validated.usage).toEqual(result.usage); expect(validated.html).toBe(result.html);
    expect(validated.usage).not.toBe(result.usage);
    expect([validated.usage, validated.usage?.analysis, validated.usage?.reconstruction, validated.usage?.total].every(Object.isFrozen)).toBe(true);
    expect(requests.map(r => [r.authorization, r.body.model])).toEqual([
      ['Bearer server-fixture-secret', 'vision-1'], ['Bearer server-fixture-secret', 'vision-1'],
    ]);
    expect(result.html).toContain('<h1>欢迎</h1>');
  });

  it.each([null, {}, { prompt_tokens: 1 }, { prompt_tokens: '1', completion_tokens: 2 },
    { prompt_tokens: 1, completion_tokens: 2, total_tokens: 4 }, { input_tokens: 1, output_tokens: 2 },
    { prompt_tokens: 1.5, completion_tokens: 2 }, { prompt_tokens: -1, completion_tokens: 2 },
    { prompt_tokens: 10_000_001, completion_tokens: 2 }, { prompt_tokens: 1, completion_tokens: 2, total_tokens: null }])(
    'usage rejects malformed native counters %j with original safe provider identity', async usage => {
      const body = JSON.parse(envelope()) as Record<string, unknown>; body.usage = usage;
      respond = response => { response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'usage-provider-42' }); response.end(JSON.stringify(body)); };
      const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'usage-task' });
      await expect(stages.analyze(image, '', binding, new AbortController().signal)).rejects.toMatchObject({
        code: 'SKETCH_PROVIDER_RESPONSE_INVALID', phase: 'analysis', providerId: 'p1', modelId: 'vision-1', requestId: 'usage-provider-42', providerStatus: 200,
      });
      expect(requests).toHaveLength(1);
    },
  );

  it('uses native HTTP for two phases, keeps one frozen server binding and compiles their output', async () => {
    respond = (response, count) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(envelope(JSON.stringify(count === 1 ? analysis : tree))); };
    const mutable = structuredClone(provider);
    const dependencies = createConfiguredSketchDependencies({
      authorizeProject: async ({ actorUserId, projectId }) => ({ kind: 'personal', actorUserId, ownerId: actorUserId, projectId: String(projectId) }),
      resolveTaskModel: async (providerId, modelId, actorUserId) => {
        expect([providerId, modelId, actorUserId]).toEqual(['p1', 'vision-1', 'user-a']); return structuredClone(model);
      },
      findProviderById: async providerId => { expect(providerId).toBe('p1'); return mutable; },
    });
    const result = await generateSketchCode({ projectId: 'project-a', imageDataUrl: image, instruction: '保留中文', ...binding, idempotencyKey: 'task-1' }, dependencies, { actorUserId: 'user-a', signal: new AbortController().signal });
    expect(result.html).toContain('<h1>欢迎</h1>');
    expect(requests).toHaveLength(2);
    expect(requests.map(request => [request.url, request.authorization, request.body.model, request.body.stream])).toEqual([
      ['/v1/chat/completions', 'Bearer server-fixture-secret', 'vision-1', false],
      ['/v1/chat/completions', 'Bearer server-fixture-secret', 'vision-1', false],
    ]);
    const first = JSON.stringify(requests[0].body.messages);
    const second = JSON.stringify(requests[1].body.messages);
    expect(first).toContain(image); expect(first).toContain('保留中文');
    expect(second).toContain('竖直排列'); expect(second).not.toContain(image);
    expect(requests[0].body.response_format).toEqual({ type: 'json_object' });
    expect(requests[1].body.response_format).toEqual({ type: 'json_object' });
    expect(second).toContain('rawHTML'); expect(second).toContain('gridColumns');
    expect(second).toContain('heading/text/button/label的text为必填字符串');
    expect(second).toContain('value和placeholder仅可为字符串');
  });

  it('prepares without HTTP, then runs both phases with the pre-admission configured binding', async () => {
    respond = (response, count) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(envelope(JSON.stringify(count === 1 ? analysis : tree))); };
    const dependencies = createConfiguredSketchDependencies({
      authorizeProject: async ({ actorUserId, projectId }) => ({ kind: 'personal', actorUserId, ownerId: actorUserId, projectId: String(projectId) }),
      resolveTaskModel: async () => structuredClone(model), findProviderById: async () => provider,
    });
    const prepared = await prepareSketchCode({ projectId: 'project-a', imageDataUrl: image, instruction: '保留中文', ...binding, idempotencyKey: 'task-1' }, dependencies, { actorUserId: 'user-a', signal: new AbortController().signal });
    expect(requests).toHaveLength(0);
    provider.apiKey = 'changed-after-preparation'; provider.baseUrl = 'http://127.0.0.1:1';
    expect((await prepared.compute(new AbortController().signal)).html).toContain('欢迎');
    expect(requests).toHaveLength(2);
    expect(requests.map(request => [request.authorization, request.body.model])).toEqual([
      ['Bearer server-fixture-secret', 'vision-1'], ['Bearer server-fixture-secret', 'vision-1'],
    ]);
  });

  it('freezes credentials and rejects a swapped stage binding before any network call', async () => {
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    provider.apiKey = 'new-secret'; provider.baseUrl = 'http://127.0.0.1:1';
    await stages.analyze(image, '', binding, new AbortController().signal);
    expect(requests[0].authorization).toBe('Bearer server-fixture-secret');
    await expect(stages.analyze(image, '', { ...binding, providerId: 'p2' }, new AbortController().signal)).rejects.toThrow('SKETCH_PROVIDER_BINDING_MISMATCH');
    await expect(stages.reconstruct(analysis, { ...binding, modelId: 'other' }, new AbortController().signal)).rejects.toThrow('SKETCH_PROVIDER_BINDING_MISMATCH');
    expect(requests).toHaveLength(1);
  });

  it.each([401, 403, 404, 429, 503])('preserves HTTP %i, provider request identity and safe original error, without retry', async (status) => {
    respond = response => { response.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'provider-42' }); response.end(JSON.stringify({ error: { code: 'capacity', message: `原错误 ${status}; key=server-fixture-secret` } })); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    const error = await stages.analyze(image, '', binding, new AbortController().signal).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SketchProviderError);
    expect(error).toMatchObject({ code: 'SKETCH_PROVIDER_REJECTED', providerId: 'p1', modelId: 'vision-1', phase: 'analysis', requestId: 'provider-42', providerStatus: status, providerCode: 'capacity' });
    expect((error as Error).message).toContain(`原错误 ${status}`);
    expect(JSON.stringify(error) + (error as Error).message).not.toContain('server-fixture-secret');
    expect(requests).toHaveLength(1);
  });

  it('does not resend POST or disclose credentials on an HTTP redirect', async () => {
    respond = response => { response.writeHead(307, { location: `${baseUrl}/redirected` }); response.end(); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    await expect(stages.analyze(image, '', binding, new AbortController().signal)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it.each([
    ['text/html', '<html>wrong</html>'], ['text/event-stream', 'data: {"choices":[]}'],
    ['application/json', '{broken'], ['application/json', JSON.stringify({ choices: [{ message: { content: [{ text: 'not-string' }] } }] })],
    ['application/json', JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })],
  ])('rejects malformed, streaming or truncated envelope %s %s', async (type, body) => {
    respond = response => { response.writeHead(200, { 'content-type': type }); response.end(body); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    await expect(stages.analyze(image, '', binding, new AbortController().signal)).rejects.toThrow('SKETCH_PROVIDER_RESPONSE_INVALID');
    expect(requests).toHaveLength(1);
  });

  it('bounds streamed bytes without trusting content-length and closes the response', async () => {
    let closed!: () => void; const closure = new Promise<void>(resolve => { closed = resolve; });
    respond = response => { response.on('close', closed); response.writeHead(200, { 'content-type': 'application/json' }); response.write('x'.repeat(1024 * 1024 + 1)); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    await expect(stages.analyze(image, '', binding, new AbortController().signal)).rejects.toThrow('SKETCH_PROVIDER_RESPONSE_LIMIT');
    await closure; expect(requests).toHaveLength(1);
  });

  it('rejects non-JSON headers immediately and closes an unfinished response', async () => {
    let closed!: () => void; const closure = new Promise<void>(resolve => { closed = resolve; });
    respond = response => { response.on('close', closed); response.writeHead(200, { 'content-type': 'text/html' }); response.write('<html>'); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    await expect(stages.analyze(image, '', binding, new AbortController().signal)).rejects.toThrow('SKETCH_PROVIDER_RESPONSE_INVALID');
    await closure; expect(requests).toHaveLength(1);
  });

  it('refuses an oversized declared body before waiting for the rest of it', async () => {
    let closed!: () => void; const closure = new Promise<void>(resolve => { closed = resolve; });
    respond = response => { response.on('close', closed); response.writeHead(200, { 'content-type': 'application/json', 'content-length': 1024 * 1024 + 1 }); response.write('{'); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    await expect(stages.analyze(image, '', binding, new AbortController().signal)).rejects.toThrow('SKETCH_PROVIDER_RESPONSE_LIMIT');
    await closure; expect(requests).toHaveLength(1);
  });

  it('refuses invalid UTF-8 rather than replacing corrupt model bytes', async () => {
    respond = response => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(Buffer.from([0xc3, 0x28])); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    await expect(stages.analyze(image, '', binding, new AbortController().signal)).rejects.toThrow('SKETCH_PROVIDER_RESPONSE_INVALID');
  });

  it('rejects provider-reported model substitution without starting reconstruction', async () => {
    respond = response => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(envelope().replace('vision-1', 'other-model')); };
    const dependencies = createConfiguredSketchDependencies({
      authorizeProject: async ({ actorUserId, projectId }) => ({ kind: 'personal', actorUserId, ownerId: actorUserId, projectId: String(projectId) }),
      resolveTaskModel: async () => structuredClone(model), findProviderById: async () => provider,
    });
    await expect(generateSketchCode({ projectId: 'project-a', imageDataUrl: image, instruction: '', ...binding, idempotencyKey: 'task-1' }, dependencies, { actorUserId: 'user-a', signal: new AbortController().signal }))
      .rejects.toThrow('SKETCH_PROVIDER_BINDING_MISMATCH');
    expect(requests).toHaveLength(1);
  });

  it.each(['html-analysis', 'html-reconstruction', 'image-analysis'] as const)(
    'preserves safe requested and reported model identities when rejecting %s', async phase => {
      respond = response => {
        response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'identity-provider-42' });
        response.end(envelope().replace('vision-1', 'reported-vision-2026-01-01'));
      };
      const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'identity-task' });
      const pending = phase === 'image-analysis'
        ? createSketchImageAnalysisStage({ provider, modelId: 'vision-1', requestId: 'identity-task' })(image, '', binding, new AbortController().signal)
        : phase === 'html-analysis' ? stages.analyze(image, '', binding, new AbortController().signal)
          : stages.reconstruct(analysis, binding, new AbortController().signal);
      const error: unknown = await pending.catch((value: unknown) => value);
      expect(error).toBeInstanceOf(SketchProviderError);
      expect(error).toMatchObject({ code: 'SKETCH_PROVIDER_BINDING_MISMATCH', providerId: 'p1', modelId: 'vision-1',
        phase: phase === 'html-reconstruction' ? 'reconstruction' : 'analysis', requestId: 'identity-provider-42', providerStatus: 200 });
      expect((error as Error).message).toContain('requested=vision-1');
      expect((error as Error).message).toContain('reported=reported-vision-2026-01-01');
      expect(requests).toHaveLength(1);
      expect(requests[0].body.model).toBe('vision-1');
      expect(requests[0].url).toBe('/v1/chat/completions');
    },
  );

  it.each(['bad\nmodel', 'x'.repeat(257), '<script>private</script>', 'https://example.invalid/?key=private'])(
    'omits unsafe or overlong reported identity %j while retaining rejection', async reported => {
      respond = response => {
        const body = JSON.parse(envelope()) as Record<string, unknown>; body.model = reported;
        response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
      };
      const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'identity-task' });
      const error: unknown = await stages.analyze(image, '', binding, new AbortController().signal).catch((value: unknown) => value);
      expect(error).toMatchObject({ code: 'SKETCH_PROVIDER_BINDING_MISMATCH', providerStatus: 200 });
      expect((error as Error).message).toContain('requested=vision-1');
      expect((error as Error).message).toContain('reported=[invalid-model-id]');
      expect((error as Error).message).not.toContain(reported);
      expect((error as Error).message.length).toBeLessThan(600);
      expect(requests).toHaveLength(1);
    },
  );

  it('redacts the configured credential from an otherwise valid reported identity', async () => {
    respond = response => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(envelope().replace('vision-1', 'prefix-server-fixture-secret-suffix'));
    };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'identity-task' });
    const error: unknown = await stages.analyze(image, '', binding, new AbortController().signal).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'SKETCH_PROVIDER_BINDING_MISMATCH', modelId: 'vision-1', providerStatus: 200 });
    expect((error as Error).message).toContain('reported=prefix-[REDACTED]-suffix');
    expect(JSON.stringify(error) + String(error)).not.toContain('server-fixture-secret');
    expect(requests).toHaveLength(1);
  });

  it.each(['model', 'finish_reason'] as const)('refuses a successful envelope missing %s', async field => {
    const incomplete = JSON.parse(envelope()) as { model?: string; choices: { finish_reason?: string; message: { content: string } }[] };
    if (field === 'model') delete incomplete.model;
    else delete incomplete.choices[0].finish_reason;
    respond = response => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(incomplete)); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    await expect(stages.analyze(image, '', binding, new AbortController().signal)).rejects.toThrow('SKETCH_PROVIDER_RESPONSE_INVALID');
    expect(requests).toHaveLength(1);
  });

  it('cancels an ignored transport late response before reading any body', async () => {
    const abort = new AbortController(); const reason = new Error('late-cancelled');
    let deliver!: (response: Response) => void;
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    let bodyCancelled = false;
    const transport: typeof fetch = async () => { started(); return new Promise(resolve => { deliver = resolve; }); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' }, { transport });
    const pending = stages.analyze(image, '', binding, abort.signal);
    const assertion = expect(pending).rejects.toBe(reason);
    await ready; abort.abort(reason);
    deliver(new Response(new ReadableStream<Uint8Array>({ cancel: () => { bodyCancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
    await assertion; expect(bodyCancelled).toBe(true); expect(requests).toHaveLength(0);
  });

  it('cancels an in-flight native response stream and preserves the exact cancellation reason', async () => {
    const abort = new AbortController(); const reason = new Error('cancelled-request');
    let markReady!: () => void; const ready = new Promise<void>(resolve => { markReady = resolve; });
    let closed!: () => void; const closure = new Promise<void>(resolve => { closed = resolve; });
    respond = response => { response.on('close', closed); response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); markReady(); };
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    const pending = stages.analyze(image, '', binding, abort.signal);
    const assertion = expect(pending).rejects.toBe(reason);
    await ready; abort.abort(reason); await assertion; await closure;
    expect(requests).toHaveLength(1);
  });

  it('does not invoke native transport for pre-cancellation', async () => {
    const abort = new AbortController(); const reason = new Error('pre-cancelled'); abort.abort(reason);
    const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' });
    await expect(stages.analyze(image, '', binding, abort.signal)).rejects.toBe(reason);
    expect(requests).toHaveLength(0);
  });

  it.each([
    { ...model, providerId: 'other' }, { ...model, modelId: 'other' }, { ...model, supportsVision: false },
    { ...model, protocol: 'unsupported-native-protocol' }, { ...model, executionMode: 'async' as const },
  ])('refuses an unavailable catalog binding before sending credentials: %j', async descriptor => {
    const dependencies = createConfiguredSketchDependencies({ resolveTaskModel: async () => descriptor, findProviderById: async () => provider });
    await expect(dependencies.resolveTaskModel('p1', 'vision-1', 'user-a')).rejects.toThrow('SKETCH_MODEL_UNAVAILABLE');
    expect(requests).toHaveLength(0);
  });

  it('preserves catalog permission refusal and never loads a provider or sends HTTP', async () => {
    const reason = new Error('MODEL_NOT_AUTHORIZED');
    const dependencies = createConfiguredSketchDependencies({ resolveTaskModel: async () => { throw reason; }, findProviderById: async () => { throw new Error('unexpected credentials read'); } });
    await expect(dependencies.resolveTaskModel('p1', 'vision-1', 'user-a')).rejects.toBe(reason);
    expect(requests).toHaveLength(0);
  });

  it.each([
    null, { id: 'p2' }, { isEnabled: false }, { apiKey: '' }, { baseUrl: 'https://example.invalid/?apiKey=credential' },
  ])('rejects unavailable or unsafe server configuration before HTTP: %j', async change => {
    const dependencies = createConfiguredSketchDependencies({ resolveTaskModel: async () => structuredClone(model), findProviderById: async () => change === null ? null : { ...provider, ...change } });
    await expect(dependencies.resolveTaskModel('p1', 'vision-1', 'user-a')).rejects.toThrow('SKETCH_PROVIDER_UNAVAILABLE');
    expect(requests).toHaveLength(0);
  });

  it('cannot reuse one logical-task dependency instance to silently rebind a model', async () => {
    const dependencies = createConfiguredSketchDependencies({ resolveTaskModel: async () => structuredClone(model), findProviderById: async () => provider });
    await dependencies.resolveTaskModel('p1', 'vision-1', 'user-a');
    await expect(dependencies.resolveTaskModel('p2', 'other', 'user-a')).rejects.toThrow('SKETCH_DEPENDENCIES_ALREADY_BOUND');
    expect(requests).toHaveLength(0);
  });

  it('replaces invalid URL exceptions with a credential-free configuration error', () => {
    const unsafeUrl = 'not-a-url?key=server-fixture-secret';
    let error: unknown;
    try { createSketchProviderStages({ provider: { ...provider, baseUrl: unsafeUrl }, modelId: 'vision-1', requestId: 'request-1' }); }
    catch (value) { error = value; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('SKETCH_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(error) + String(error)).not.toContain(unsafeUrl);
    expect(JSON.stringify(error) + String(error)).not.toContain(provider.apiKey);
    expect(requests).toHaveLength(0);
  });

  it.each(['non-json', 'declared-limit', 'stream-limit', 'late-abort'] as const)(
    'rejects %s without waiting for stalled stream cancellation cleanup', async variant => {
      const abort = new AbortController(); const reason = new Error('late-cancelled');
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start: controller => {
          if (variant === 'stream-limit') controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel: () => { cancelled = true; return new Promise<void>(() => undefined); },
      });
      const headers = { 'content-type': variant === 'non-json' ? 'text/html' : 'application/json',
        ...(variant === 'declared-limit' ? { 'content-length': String(1024 * 1024 + 1) } : {}) };
      const transport: typeof fetch = async () => {
        if (variant === 'late-abort') abort.abort(reason);
        return new Response(body, { headers });
      };
      const stages = createSketchProviderStages({ provider, modelId: 'vision-1', requestId: 'request-1' }, { transport });
      const pending = stages.analyze(image, '', binding, abort.signal);
      if (variant === 'late-abort') await expect(pending).rejects.toBe(reason);
      else await expect(pending).rejects.toThrow(variant === 'non-json' ? 'SKETCH_PROVIDER_RESPONSE_INVALID' : 'SKETCH_PROVIDER_RESPONSE_LIMIT');
      expect(cancelled).toBe(true); expect(requests).toHaveLength(0);
    }, 1000,
  );
});
