import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoTrySubmitImageTask, submitImageTask } from '@/lib/image-edit-provider';
import { autoTryChatVisionFallback, describeImageWithVision } from '@/lib/image-edit-vision-provider';
import { submit302aiUpscaleTask, submit302aiUpscaleV6Task, submit302aiImageUpscaleTask, submit302aiEsrganTask } from '@/lib/image-edit-upscale-provider';
import { ImageEditProviderBoundaryError, type ImageEditProviderExecution, type ImageEditProviderIdentity, type ImageEditProviderAccepted, type ImageEditProviderCallOptions } from '@/lib/image-edit-provider-boundary';
import type { ImageEditModelCandidate, ImageEditModelPlan } from '@/lib/task-core/image-edit-model-plan';
import { UpscaleProviderError } from '@/lib/upscale-provider-error';

const base = 'https://provider.invalid/v1';
const output = 'https://media.invalid/result.png';
const source = 'data:image/png;base64,aGVsbG8=';
const description = 'A red wooden house under a blue sky in a green field.';
const key = 'offline-secret-never-accepted';
const json = (value: unknown, status = 200): Response => Response.json(value, { status });
const direct = (): Response => json({ data: [{ url: output }] });
const chatImage = (): Response => json({ choices: [{ message: { content: '![image](' + output + ')' } }] });
const denied = (message = 'endpoint not found', status = 404): Response => json({ error: { message } }, status);

function candidate(id = 'A', model = 'dall-e-3', apiBaseUrl = base): ImageEditModelCandidate {
  return { providerId: id, model, apiBaseUrl, apiKey: key, source: 'admin-auto', providerType: 'image',
    advancedParams: { compatProfile: 'openai', secret: 'advanced-private' },
    provider: { id, name: id, baseUrl: apiBaseUrl, apiKey: key, type: 'image', isEnabled: true,
      createdAt: 1, updatedAt: 1, requestStyle: 'images-generations' } };
}
function plan(): ImageEditModelPlan {
  return { requestedModelId: 'dall-e-3', requestedProviderId: '', explicit: false,
    candidates: [candidate(), candidate('B')], dedicatedRemoveBgCandidates: [],
    visionCandidates: [candidate('V', 'vision-model'), candidate('V2', 'vision-model')] };
}
interface Step {
  url: string;
  identity?: ImageEditProviderIdentity;
  response: () => Response;
  check?: (body: Record<string, unknown> | FormData, init: RequestInit) => void;
}
function fixture(steps: Step[], accept?: ImageEditProviderExecution['onAccepted']): {
  execution: ImageEditProviderExecution;
  sent: Array<{ url: string; identity: ImageEditProviderIdentity; init: RequestInit }>;
  accepted: Array<{ identity: ImageEditProviderIdentity; result: ImageEditProviderAccepted }>;
} {
  const sent: Array<{ url: string; identity: ImageEditProviderIdentity; init: RequestInit }> = [];
  const accepted: Array<{ identity: ImageEditProviderIdentity; result: ImageEditProviderAccepted }> = [];
  const execution: ImageEditProviderExecution = {
    async transport(input, init, identity): Promise<Response> {
      const url = String(input);
      sent.push({ url, identity, init: init || {} });
      const step = steps[sent.length - 1];
      if (!step || step.url !== url) throw new Error('Undeclared offline request: ' + url);
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + key);
      expect(identity).toEqual(step.identity || { providerId: 'A', modelId: 'dall-e-3', kind: 'image' });
      expect(Object.isFrozen(identity)).toBe(true);
      expect(Reflect.set(identity, 'providerId', 'tampered')).toBe(false);
      const payload = init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (identity.kind !== 'upscale') {
        expect(payload instanceof FormData ? payload.get('model') : payload.model).toBe(identity.modelId);
      }
      if (identity.kind === 'vision') {
        expect(payload).toMatchObject({ messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: source } }, { type: 'text' },
        ] }], max_tokens: 2048, stream: false });
      }
      if (step.check && init) step.check(payload, init);
      return step.response();
    },
    async onAccepted(identity, result): Promise<void> {
      accepted.push({ identity, result });
      expect(identity).toBe(sent[sent.length - 1].identity);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Reflect.set(result, 'kind', 'tampered')).toBe(false);
      expect(JSON.stringify({ identity, result })).not.toContain(key);
      expect(JSON.stringify({ identity, result })).not.toContain('advanced-private');
      await accept?.(identity, result);
    },
  };
  return { execution, sent, accepted };
}
const imageStep = (response: () => Response = direct, url = base + '/images/generations'): Step => ({ url, response });
const body = (model: string): Record<string, unknown> => ({ model, prompt: 'paint a tree', size: '1024x1024' });
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (): Promise<never> => { throw new Error('Global network forbidden'); }));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Break caught: a real adapter bypasses transport, leaks credentials, returns before accept,
// or treats unknown/accept failure as permission to send the next request.
describe('request-local provider execution boundary', () => {
  it.each([
    ['direct', () => direct(), { kind: 'image', directUrl: output }],
    ['remote', () => json({ task_id: 'remote-17' }), { kind: 'image', taskId: 'remote-17' }],
  ] as const)('awaits readonly safe %s acceptance exactly once', async (_name, response, expected) => {
    const gate = deferred();
    const entered = deferred();
    const f = fixture([imageStep(response)], async () => { entered.resolve(); await gate.promise; });
    let settled = false;
    const pending = autoTrySubmitImageTask([candidate(), candidate('B')], body, 'mask', '/images/generations', f.execution)
      .finally(() => { settled = true; });
    // Attach rejection immediately so an old implementation is a business failure, not an unhandled rejection.
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(f.accepted).toHaveLength(1));
    await entered.promise;
    expect(settled).toBe(false);
    expect(f.sent).toHaveLength(1);
    expect(f.accepted[0].result).toEqual(expected);
    gate.resolve();
    const result = await outcome;
    expect(result).toHaveProperty('value');
    expect(result).toMatchObject({ value: { providerId: 'A', usedModel: 'dall-e-3', apiKey: key } });
    expect(f.sent).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an empty provider or model before any request', async () => {
    for (const [providerId, model] of [['', 'dall-e-3'], ['A', '  ']]) {
      const f = fixture([]);
      await expect(submitImageTask(base, key, body(model), '/images/generations', undefined,
        { providerId, boundary: f.execution })).rejects.toBeInstanceOf(ImageEditProviderBoundaryError);
      expect(f.sent).toHaveLength(0);
    }
  });

  it('stops on accepted rejection without callback reentry or next candidate', async () => {
    const cause = new Error('secret acceptance failure');
    const f = fixture([imageStep()], async () => { throw cause; });
    await expect(autoTrySubmitImageTask([candidate(), candidate('B')], body, 'mask', '/images/generations', f.execution))
      .rejects.toMatchObject({ name: 'ImageEditProviderBoundaryError', message: 'Image edit provider boundary stopped', cause });
    expect(f.sent).toHaveLength(1);
    expect(f.accepted).toHaveLength(1);
  });

  it.each(['transport', 'read', 'json', 'missing'] as const)('stops %s failure before the next candidate and clears timers', async mode => {
    const cause = new Error('secret unknown');
    const f = fixture([imageStep(() => {
      if (mode === 'transport') throw cause;
      if (mode === 'read') return new Response(new ReadableStream({ start(controller): void { controller.error(cause); } }));
      if (mode === 'json') return new Response('<html>unknown</html>', { headers: { 'content-type': 'application/json' } });
      return json({ data: [] });
    })]);
    await expect(autoTrySubmitImageTask([candidate(), candidate('B')], body, 'mask', '/images/generations', f.execution))
      .rejects.toBeInstanceOf(ImageEditProviderBoundaryError);
    expect(f.sent).toHaveLength(1);
    expect(f.accepted).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps explicit 404 → /v1 compatibility with exact identity', async () => {
    const host = 'https://provider.invalid';
    const f = fixture([imageStep(denied, host + '/images/generations'), imageStep()]);
    await expect(submitImageTask(host, key, body('dall-e-3'), '/images/generations', undefined,
      { providerId: 'A', boundary: f.execution })).resolves.toMatchObject({ directUrl: output });
    expect(f.sent).toHaveLength(2);
    expect(f.sent[0].identity).toBe(f.sent[1].identity);
    expect(f.accepted).toHaveLength(1);
    f.sent[0].init.signal?.throwIfAborted();
  });

  it('unversioned 2xx HTML stops without a second POST', async () => {
    const host = 'https://provider.invalid';
    const f = fixture([imageStep(() => new Response('<html>unknown</html>'), host + '/images/generations')]);
    await expect(submitImageTask(host, key, body('dall-e-3'), '/images/generations', undefined,
      { providerId: 'A', boundary: f.execution })).rejects.toBeInstanceOf(ImageEditProviderBoundaryError);
    expect(f.sent).toHaveLength(1);
  });

  it('Gemini chat uses the same image identity and accepts parsed image', async () => {
    const f = fixture([{ url: base + '/chat/completions', identity: { providerId: 'G', modelId: 'gemini-2.5-flash-image', kind: 'image' },
      response: chatImage, check(payload): void {
        expect(payload).toEqual({ model: 'gemini-2.5-flash-image',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'paint a tree\n\n[Image format: Aspect ratio 1:1 (square). Size: 1024x1024.]' }] }],
          generationConfig: { responseModalities: ['IMAGE'], image_size: '1024x1024' } });
      } }]);
    const gemini = candidate('G', 'gemini-2.5-flash-image');
    gemini.advancedParams = { compatProfile: 'gemini-image' };
    await expect(autoTrySubmitImageTask([gemini], body, 'generate', '/images/generations', f.execution))
      .resolves.toMatchObject({ directUrl: output });
    expect(f.accepted[0].result).toEqual({ kind: 'image', directUrl: output });
  });

  it('edits JSON → multipart keeps payload and identity', async () => {
    const f = fixture([
      { url: base + '/images/edits', response: () => denied('expected multipart', 400),
        check(payload): void { expect(payload).toMatchObject({ model: 'dall-e-3', prompt: 'paint a tree' }); } },
      { url: base + '/images/edits', response: direct, check(payload): void {
        expect(payload).toBeInstanceOf(FormData);
        const form = payload as FormData;
        expect(form.get('model')).toBe('dall-e-3');
        expect(form.get('image')).toBeInstanceOf(File);
      } },
    ]);
    await expect(autoTrySubmitImageTask([candidate()], m => ({ ...body(m), image: source }), 'mask', '/images/edits', f.execution))
      .resolves.toMatchObject({ directUrl: output });
    expect(f.sent).toHaveLength(2);
    expect(f.sent[0].identity).toBe(f.sent[1].identity);
  });

  it('edits → generations → chat crosses every HTTP boundary', async () => {
    const f = fixture([
      { url: base + '/images/edits', response: denied },
      imageStep(() => denied('no available channel', 503)),
      { url: base + '/chat/completions', response: chatImage },
    ]);
    await expect(autoTrySubmitImageTask([candidate()], m => ({ ...body(m), image: source }), 'mask', '/images/edits', f.execution))
      .resolves.toMatchObject({ directUrl: output });
    expect(f.sent).toHaveLength(3);
    expect(f.accepted).toHaveLength(1);
    expect(new Set(f.sent.map(s => s.identity)).size).toBe(1);
  });

  it('flat images compatibility sends image_urls and removes nested images', async () => {
    const f = fixture([
      { ...imageStep(() => denied('请上传参考图', 400)), identity: { providerId: 'A', modelId: 'gpt-image-1', kind: 'image' }, check(payload): void { expect(payload).toHaveProperty('images'); } },
      { ...imageStep(), identity: { providerId: 'A', modelId: 'gpt-image-1', kind: 'image' }, check(payload): void { expect(payload).toMatchObject({ image_urls: [source] }); expect(payload).not.toHaveProperty('images'); } },
    ]);
    await expect(autoTrySubmitImageTask([candidate('A', 'gpt-image-1')], m => ({ ...body(m), image: source }),
      'mask', '/images/generations', f.execution)).resolves.toMatchObject({ directUrl: output });
    expect(f.sent).toHaveLength(2);
  });

  it('ratio fallback uses the next exact provider/model at 1:1', async () => {
    const f = fixture([
      imageStep(() => denied('Unsupported aspect ratio', 503)),
      { ...imageStep(), identity: { providerId: 'B', modelId: 'dall-e-3', kind: 'image' },
        check(payload): void { expect(payload).toMatchObject({ size: '1024x1024' }); } },
    ]);
    await expect(autoTrySubmitImageTask([candidate(), candidate('B')], m => ({ ...body(m), size: '16:9' }), 'mask', '/images/generations', f.execution))
      .resolves.toMatchObject({ providerId: 'B', directUrl: output });
    expect(f.sent).toHaveLength(2);
  });

  it.each(['json', 'sse'] as const)('vision %s awaits acceptance before generating; unversioned SSE sends once', async format => {
    const gate = deferred();
    const host = 'https://vision.invalid';
    const p = plan();
    p.visionCandidates = [candidate('V', 'vision-model', host)];
    const f = fixture([
      { url: host + '/chat/completions', identity: { providerId: 'V', modelId: 'vision-model', kind: 'vision' },
        response: () => format === 'json' ? json({ choices: [{ message: { content: description } }] })
          : new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: description } }] }) + '\n\ndata: [DONE]\n',
            { headers: { 'content-type': 'text/event-stream' } }) },
      imageStep(),
    ], async (_identity, result) => { if (result.kind === 'vision') await gate.promise; });
    const pending = autoTryChatVisionFallback(source, null, 'make blue', 'mask', p, f.execution);
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(f.accepted).toHaveLength(1));
    expect(f.sent).toHaveLength(1);
    expect(f.accepted[0].result).toEqual({ kind: 'vision', text: description });
    gate.resolve();
    expect(await outcome).toMatchObject({ value: { directUrl: output } });
    expect(f.sent).toHaveLength(2);
    expect(f.accepted).toHaveLength(2);
  });

  it.each(['transport', 'read', 'json', 'missing', 'accepted', 'generate'] as const)('vision %s failure never advances or returns null', async mode => {
    const cause = new Error('vision unknown secret');
    const f = fixture([
      { url: base + '/chat/completions', identity: { providerId: 'V', modelId: 'vision-model', kind: 'vision' }, response: () => {
        if (mode === 'transport') throw cause;
        if (mode === 'read') return new Response(new ReadableStream({ start(controller): void { controller.error(cause); } }));
        if (mode === 'json') return new Response('not json');
        if (mode === 'missing') return json({ choices: [] });
        return json({ choices: [{ message: { content: description } }] });
      } },
      imageStep(() => { throw cause; }),
    ], async () => { if (mode === 'accepted') throw cause; });
    await expect(autoTryChatVisionFallback(source, null, 'change', 'mask', plan(), f.execution))
      .rejects.toBeInstanceOf(ImageEditProviderBoundaryError);
    expect(f.sent).toHaveLength(mode === 'generate' ? 2 : 1);
    expect(f.accepted).toHaveLength(mode === 'accepted' || mode === 'generate' ? 1 : 0);
  });

  it('legacy no-boundary normal and explicit refusal candidate fallback remain available', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
      urls.push(String(input));
      if (urls.length === 1) return denied('image editing unavailable', 400);
      if (urls.length <= 3) return direct();
      throw new Error('Undeclared legacy request');
    });
    await expect(autoTrySubmitImageTask([candidate(), candidate('B')], body, 'mask')).resolves.toMatchObject({ providerId: 'B', directUrl: output });
    await expect(submitImageTask(base, key, body('dall-e-3'))).resolves.toMatchObject({ directUrl: output });
    expect(urls).toEqual([base + '/images/generations', base + '/images/generations', base + '/images/generations']);
  });
});



describe('fix1 vision SSE frame integrity', () => {
  const prefixes = ['data: ', 'data : '] as const;
  const entries = ['describe', 'fallback'] as const;
  function sse(prefix: string, position?: 'before' | 'after', preamble = ''): string {
    const valid = prefix + JSON.stringify({ choices: [{ delta: { content: description } }] });
    const broken = prefix + '{"choices":';
    const frames = position === 'before' ? [broken, valid] : position === 'after' ? [valid, broken] : [valid];
    return preamble + [...frames, prefix + '[DONE]'].join('\n\n') + '\n';
  }
  function visionStep(stream: string): Step {
    return { url: base + '/chat/completions', identity: { providerId: 'V', modelId: 'vision-model', kind: 'vision' },
      response: () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }) };
  }

  // Break caught: a malformed data frame must invalidate earlier/later valid text before acceptance.
  describe.each(entries)('%s entry', entry => {
    it.each(prefixes.flatMap(prefix => (['before', 'after'] as const).flatMap(position =>
      ['', ': keepalive\n\n'].map(preamble => ({ prefix, position, preamble })))))
    ('rejects $prefix bad frame $position valid text (preamble=$preamble)', async ({ prefix, position, preamble }) => {
      const f = fixture([visionStep(sse(prefix, position, preamble)), imageStep()]);
      const pending = entry === 'describe'
        ? describeImageWithVision(source, 'describe', plan().visionCandidates, f.execution)
        : autoTryChatVisionFallback(source, null, 'change', 'mask', plan(), f.execution);
      await expect.soft(pending).rejects.toMatchObject({
        name: 'ImageEditProviderBoundaryError', message: 'Image edit provider boundary stopped', cause: expect.any(SyntaxError),
      });
      expect.soft(f.accepted).toHaveLength(0);
      expect.soft(f.sent.map(request => request.url)).toEqual([base + '/chat/completions']);
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each(prefixes.flatMap(prefix => (['before', 'after'] as const).map(position => ({ prefix, position }))))
    ('keeps legacy tolerance for $prefix bad frame $position valid text', async ({ prefix, position }) => {
      const sent: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        sent.push(url);
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + key);
        if (sent.length === 1 && url === base + '/chat/completions') {
          expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'vision-model', stream: false });
          return new Response(sse(prefix, position), { headers: { 'content-type': 'text/event-stream' } });
        }
        if (entry === 'fallback' && sent.length === 2 && url === base + '/images/generations') {
          expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'dall-e-3' });
          return direct();
        }
        throw new Error('Undeclared legacy SSE request');
      });
      if (entry === 'describe') {
        await expect(describeImageWithVision(source, 'describe', plan().visionCandidates)).resolves.toBe(description);
        expect(sent).toEqual([base + '/chat/completions']);
      } else {
        await expect(autoTryChatVisionFallback(source, null, 'change', 'mask', plan())).resolves.toMatchObject({ directUrl: output });
        expect(sent).toEqual([base + '/chat/completions', base + '/images/generations']);
      }
    });
  });

  it.each(prefixes.flatMap(prefix => prefixes.map(donePrefix => ({ prefix, donePrefix }))))
  ('accepts valid $prefix frames with $donePrefix[DONE] and then generates', async ({ prefix, donePrefix }) => {
    const stream = prefix + JSON.stringify({ choices: [{ delta: { content: description } }] })
      + '\n\n' + donePrefix + '[DONE]\n';
    const f = fixture([visionStep(stream), imageStep()]);
    await expect(autoTryChatVisionFallback(source, null, 'change', 'mask', plan(), f.execution))
      .resolves.toMatchObject({ directUrl: output });
    expect(f.accepted.map(accepted => accepted.result)).toEqual([
      { kind: 'vision', text: description }, { kind: 'image', directUrl: output },
    ]);
    expect(f.sent.map(request => request.url)).toEqual([base + '/chat/completions', base + '/images/generations']);
    expect(fetch).not.toHaveBeenCalled();
  });
});

interface CatchScenario {
  name: string;
  candidates: ImageEditModelCandidate[];
  prefix: Step[];
  target: Step;
  endpoint: '/images/edits' | '/images/generations';
  build: (model: string) => Record<string, unknown>;
}
function catchScenarios(): CatchScenario[] {
  const withImage = (model: string): Record<string, unknown> => ({ ...body(model), image: source });
  const gemini = candidate('G', 'gemini-2.5-flash-image');
  gemini.advancedParams = { compatProfile: 'gemini-image' };
  return [
    { name: '/v1 retry', candidates: [candidate('A', 'dall-e-3', 'https://provider.invalid'), candidate('B')],
      prefix: [imageStep(denied, 'https://provider.invalid/images/generations')], target: imageStep(),
      endpoint: '/images/generations', build: body },
    { name: 'multipart retry', candidates: [candidate(), candidate('B')],
      prefix: [{ url: base + '/images/edits', response: () => denied('expected multipart', 400) }],
      target: { url: base + '/images/edits', response: direct }, endpoint: '/images/edits', build: withImage },
    { name: 'generations fallback catch', candidates: [candidate(), candidate('B')],
      prefix: [{ url: base + '/images/edits', response: denied }],
      target: imageStep(), endpoint: '/images/edits', build: withImage },
    { name: 'nested chat catch', candidates: [candidate(), candidate('B')],
      prefix: [{ url: base + '/images/edits', response: denied }, imageStep(() => denied('no available channel', 503))],
      target: { url: base + '/chat/completions', response: chatImage }, endpoint: '/images/edits', build: withImage },
    { name: '5xx chat catch', candidates: [candidate(), candidate('B')],
      prefix: [imageStep(() => denied('failover unavailable', 503))],
      target: { url: base + '/chat/completions', response: chatImage }, endpoint: '/images/generations', build: body },
    { name: 'flat catch', candidates: [candidate('A', 'gpt-image-1'), candidate('B')],
      prefix: [{ ...imageStep(() => denied('请上传参考图', 400)), identity: { providerId: 'A', modelId: 'gpt-image-1', kind: 'image' } }],
      target: { ...imageStep(), identity: { providerId: 'A', modelId: 'gpt-image-1', kind: 'image' } },
      endpoint: '/images/generations', build: withImage },
    { name: 'ratio inner catch', candidates: [candidate(), candidate('B'), candidate('C')],
      prefix: [imageStep(() => denied('Unsupported aspect ratio', 503))],
      target: { ...imageStep(), identity: { providerId: 'B', modelId: 'dall-e-3', kind: 'image' },
        check(payload): void { expect(payload).toMatchObject({ size: '1024x1024' }); } },
      endpoint: '/images/generations', build: model => ({ ...body(model), size: '16:9' }) },
    { name: 'Gemini chat', candidates: [gemini, candidate('B')], prefix: [],
      target: { url: base + '/chat/completions', response: chatImage, identity: { providerId: 'G', modelId: gemini.model, kind: 'image' } },
      endpoint: '/images/generations', build: body },
  ];
}
// Break caught: any inner catch demotes a stop into compatibility/ratio/candidate retry.
describe.each(catchScenarios())('$name propagation', scenario => {
  it.each(['transport', 'read', 'error-read', 'json', 'missing', 'accepted'] as const)('stops %s with no later POST', async mode => {
    const cause = new Error('private transport/accept reason');
    const target = { ...scenario.target, response: (): Response => {
      if (mode === 'transport') throw cause;
      if (mode === 'read' || mode === 'error-read') return new Response(new ReadableStream({
        start(controller): void { controller.error(cause); },
      }), { status: mode === 'error-read' ? 400 : 200 });
      if (mode === 'json') return new Response('<html>unknown</html>', { headers: { 'content-type': 'application/json' } });
      if (mode === 'missing') return json({});
      return scenario.target.response();
    } };
    const f = fixture([...scenario.prefix, target], async () => { throw cause; });
    const pending = autoTrySubmitImageTask(scenario.candidates, scenario.build, 'mask', scenario.endpoint, f.execution);
    await expect(pending).rejects.toBeInstanceOf(ImageEditProviderBoundaryError);
    if (mode === 'transport' || mode === 'read' || mode === 'error-read' || mode === 'accepted') {
      await expect(pending).rejects.toMatchObject({ cause });
    }
    expect(f.sent).toHaveLength(scenario.prefix.length + 1);
    expect(f.accepted).toHaveLength(mode === 'accepted' ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('additional compatibility controls', () => {
  it('5xx explicitly allowed channel rejection reaches chat successfully', async () => {
    const f = fixture([imageStep(() => denied('failover unavailable', 503)), { url: base + '/chat/completions', response: chatImage }]);
    await expect(autoTrySubmitImageTask([candidate()], body, 'mask', '/images/generations', f.execution)).resolves.toMatchObject({ directUrl: output });
    expect(f.sent).toHaveLength(2);
    expect(f.accepted).toHaveLength(1);
  });
  it('legacy timeout fallback still reaches chat', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input); urls.push(url);
      if (urls.length === 1 && url === base + '/images/edits') return denied();
      if (urls.length === 2 && url === base + '/images/generations') throw new Error('timeout');
      if (urls.length === 3 && url === base + '/chat/completions') return chatImage();
      throw new Error('Undeclared legacy URL');
    });
    await expect(autoTrySubmitImageTask([candidate()], m => ({ ...body(m), image: source }), 'mask', '/images/edits'))
      .resolves.toMatchObject({ directUrl: output });
    expect(urls).toEqual([base + '/images/edits', base + '/images/generations', base + '/chat/completions']);
  });
  it('vision rejection switches candidate with exact identity; text arrays are accepted', async () => {
    const f = fixture([
      { url: base + '/chat/completions', identity: { providerId: 'V', modelId: 'vision-model', kind: 'vision' }, response: denied },
      { url: base + '/chat/completions', identity: { providerId: 'V2', modelId: 'vision-model', kind: 'vision' },
        response: () => json({ choices: [{ message: { content: [{ type: 'text', text: description }] } }] }) },
    ]);
    await expect(describeImageWithVision(source, 'describe', plan().visionCandidates, f.execution)).resolves.toBe(description);
    expect(f.accepted).toHaveLength(1);
    expect(f.accepted[0].identity.providerId).toBe('V2');
  });
  it('vision /v1 transport rejection cannot advance to another vision model', async () => {
    const cause = new Error('unknown at v1');
    const host = 'https://vision.invalid';
    const f = fixture([
      { url: host + '/chat/completions', identity: { providerId: 'V', modelId: 'vision-model', kind: 'vision' }, response: denied },
      { url: host + '/v1/chat/completions', identity: { providerId: 'V', modelId: 'vision-model', kind: 'vision' }, response: () => { throw cause; } },
    ]);
    await expect(describeImageWithVision(source, 'describe', [candidate('V', 'vision-model', host), candidate('V2', 'vision-model')], f.execution))
      .rejects.toMatchObject({ name: 'ImageEditProviderBoundaryError', cause });
    expect(f.sent).toHaveLength(2);
  });
  it.each(['https://provider.invalid/v2', 'https://provider.invalid/api', 'https://provider.invalid/proxy'])('respects skip-v1 base rules for %s', async host => {
    const f = fixture([imageStep(denied, host + '/images/generations')]);
    await expect(submitImageTask(host, key, body('dall-e-3'), '/images/generations', undefined,
      { providerId: 'A', boundary: f.execution })).rejects.toBeInstanceOf(Error);
    expect(f.sent).toHaveLength(1);
    expect(f.accepted).toHaveLength(0);
  });
  it('retry keeps the original abort signal linked', async () => {
    const f = fixture([imageStep(denied, 'https://provider.invalid/images/generations'), {
      ...imageStep(), check(_payload, init): void {
        const original = f.sent[0].init.signal;
        expect(init.signal).not.toBe(original);
        vi.advanceTimersByTime(600_000);
        expect(original?.aborted).toBe(true);
        expect(init.signal?.aborted).toBe(true);
      },
    }]);
    await expect(submitImageTask('https://provider.invalid', key, body('dall-e-3'), '/images/generations', undefined,
      { providerId: 'A', boundary: f.execution })).resolves.toMatchObject({ directUrl: output });
  });
});
const natives: Array<{ name: string; endpoint: string; expected: Record<string, unknown>; call: (options?: ImageEditProviderCallOptions) => Promise<unknown> }> = [
  { name: '302-super-upscale-v2', endpoint: '/302/submit/super-upscale-v2',
    expected: { model_type: 'SDXL', image_url: source, scale: 3, creativity: 0.2, detail: 2, shape_preservation: 0.1,
      prompt_suffix: ' high quality, highly detailed, high resolution, sharp',
      negative_prompt: 'blurry, low resolution, bad, ugly, low quality, pixelated, interpolated, compression artifacts, noisey, grainy',
      guidance_scale: 7.5, num_inference_steps: 20, override_size_limits: true },
    call: options => submit302aiUpscaleTask(base, key, source, undefined, undefined, undefined, undefined, undefined, undefined, options) },
  { name: '302-upscale-v6', endpoint: '/302/submit/upscale-v6', expected: { image_url: source, upscale_factor: 4 },
    call: options => submit302aiUpscaleV6Task(base, key, source, 9, options) },
  { name: '302-image-upscale', endpoint: '/302/submit/image-upscale', expected: { image_url: source, upscale_factor: 3 },
    call: options => submit302aiImageUpscaleTask(base, key, source, 2.6, options) },
  { name: '302-esrgan', endpoint: '/302/submit/esrgan', expected: { image_url: source, upscale_factor: 2 },
    call: options => submit302aiEsrganTask(base, key, source, 1, options) },
];
describe.each(natives)('real native $name', native => {
  it('sends exact payload/scale and awaits safe image acceptance', async () => {
    const gate = deferred();
    const f = fixture([{ url: base + native.endpoint, identity: { providerId: 'N', modelId: native.name, kind: 'upscale' },
      response: () => json({ image: { url: output, width: 300, height: 200 } }),
      check(payload): void { expect(payload).toEqual(native.expected); } }], async () => gate.promise);
    let done = false;
    const pending = native.call({ providerId: 'N', boundary: f.execution }).finally(() => { done = true; });
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(f.accepted).toHaveLength(1));
    expect(done).toBe(false);
    expect(f.accepted[0].result).toEqual({ kind: 'image', directUrl: output, width: 300, height: 200 });
    gate.resolve();
    expect(await outcome).toEqual({ value: { directUrl: output, width: 300, height: 200, usedModel: native.name } });
    expect(f.sent).toHaveLength(1);
  });
  it('keeps the typed provider error from an explicitly returned rejection', async () => {
    const f = fixture([{ url: base + native.endpoint, identity: { providerId: 'N', modelId: native.name, kind: 'upscale' },
      response: () => json({ error: { message: 'rate limited', code: 'quota-17' } }, 429) }]);
    const result = native.call({ providerId: 'N', boundary: f.execution });
    await expect(result).rejects.toBeInstanceOf(UpscaleProviderError);
    await expect(result).rejects.toMatchObject({ status: 429, providerCode: 'quota-17', retryable: true });
    expect(f.accepted).toHaveLength(0);
  });
  it.each(['transport', 'read', 'json', 'missing', 'accepted'] as const)('stops %s safely', async mode => {
    const cause = new Error('private-native-unknown');
    const f = fixture([{ url: base + native.endpoint, identity: { providerId: 'N', modelId: native.name, kind: 'upscale' }, response: () => {
      if (mode === 'transport') throw cause;
      if (mode === 'read') return new Response(new ReadableStream({ start(controller): void { controller.error(cause); } }));
      if (mode === 'json') return new Response('<bad>');
      if (mode === 'missing') return json({ image: {} });
      return json({ output });
    } }], async () => { throw cause; });
    await expect(native.call({ providerId: 'N', boundary: f.execution })).rejects.toBeInstanceOf(ImageEditProviderBoundaryError);
    expect(f.sent).toHaveLength(1);
    expect(f.accepted).toHaveLength(mode === 'accepted' ? 1 : 0);
  });
});
