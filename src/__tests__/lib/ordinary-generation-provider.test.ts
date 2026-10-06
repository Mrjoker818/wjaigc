import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { tryChatCompletionsImageFallback, PROFILE_OPENAI, PROFILE_GEMINI_IMAGE } from '@/lib/api-compatibility';
vi.mock('server-only', () => ({}));
import { createOrdinaryProvider, type OrdinaryProviderOptions } from '@/lib/task-core/ordinary-generation-provider';
import type { ModelConfig } from '@/lib/task-core/ordinary-generation-request';

const model: ModelConfig = { name: 'Offline', modelId: 'gpt-image-1', paramType: 'none', supportedSizes: [], qualityOptions: [],
  resolutionOptions: [], supportsImageToImage: true, maxN: 4, estimatedTime: 30 };
function providerOptions(transport: typeof fetch, extra: Partial<OrdinaryProviderOptions> = {}): OrdinaryProviderOptions {
  return { requestedSize: '1:1', enhancedPrompt: 'blue cup', agentProviderIdempotencyKey: 'offline-request',
    accessibleReferenceImages: [], aspectRatio: '1:1', strictAgentRouting: false, isPrivateIp: (): boolean => false,
    downloadAndSaveImage: async (): Promise<null> => null, controlled: true, transport, responsesApiEnabled: false,
    providerFetch: (base, path, options, retry, timeout) => fetchWithV1Retry(base, path, { ...options, transport, propagateErrors: true }, retry, timeout), ...extra };
}

beforeEach((): void => { vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared IO'); }); });
afterEach((): void => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('extracted ordinary protocols', () => {
  it.each(['direct', 'remote', 'mixed', 'gemini'])('retains all accepted %s results through the actual provider', async kind => {
    const calls: string[] = [];
    const transport: typeof fetch = async (input, options): Promise<Response> => {
      const url = String(input); calls.push(url);
      expect(options?.method).toBe('POST');
      const expected = kind === 'gemini' ? '/chat/completions' : '/images/generations';
      expect(url).toBe(`https://offline.invalid/v1${expected}`);
      if (kind === 'gemini') return Response.json({ choices: [{ message: { content: [
        { type: 'image_url', image_url: { url: 'https://offline.invalid/a.png' } },
        { type: 'image_url', image_url: { url: 'https://offline.invalid/b.png' } },
      ] } }] });
      return Response.json({ data: [
        ...(kind !== 'remote' ? [{ url: 'https://offline.invalid/a.png' }, { url: 'https://offline.invalid/b.png' }] : []),
        ...(kind !== 'direct' ? [{ task_id: 'remote-a' }, { task_id: 'remote-b' }] : []),
      ] });
    };
    const submit = createOrdinaryProvider(providerOptions(transport, { profile: kind === 'gemini' ? PROFILE_GEMINI_IMAGE : PROFILE_OPENAI }));
    const result = await submit(model, 'test-only', 'https://offline.invalid/v1', 'provider', 1);
    expect(result.directImageUrls).toEqual(kind === 'remote' ? [] : ['https://offline.invalid/a.png', 'https://offline.invalid/b.png']);
    expect(result.taskIds).toEqual(kind === 'remote' || kind === 'mixed' ? ['remote-a', 'remote-b'] : []);
    expect(calls).toHaveLength(1);
  });
  it.each(['endpoint', 'multipart'])('retains the explicit JSON edits rejection fallback: %s', async kind => {
    const calls: Array<{ url: string; contentType: string }> = [];
    const transport: typeof fetch = async (input, options): Promise<Response> => {
      const url = String(input); const contentType = new Headers(options?.headers).get('content-type') || '';
      calls.push({ url, contentType });
      expect(options?.method).toBe('POST');
      if (calls.length === 1) return Response.json({ error: { message: kind === 'endpoint' ? 'endpoint not found' : 'expected multipart form-data' } }, { status: kind === 'endpoint' ? 404 : 415 });
      if (kind === 'endpoint') expect(url).toBe('https://offline.invalid/v1/images/generations');
      else { expect(url).toBe('https://offline.invalid/v1/images/edits'); expect(contentType).toContain('multipart/form-data'); }
      return Response.json({ data: [{ url: 'https://offline.invalid/a.png' }] });
    };
    const submit = createOrdinaryProvider(providerOptions(transport, { profile: PROFILE_OPENAI, accessibleReferenceImages: ['data:image/png;base64,aGVsbG8='] }));
    const result = await submit({ ...model, modelId: 'dall-e-2' }, 'test-only', 'https://offline.invalid/v1', 'provider', 1);
    expect(result.directImageUrls).toEqual(['https://offline.invalid/a.png']);
    expect(calls).toHaveLength(2); expect(calls[0].url).toBe('https://offline.invalid/v1/images/edits');
  });
});

describe('ordinary shared transport boundaries', () => {
  it('releases its local timeout after a controlled generation transport fails', async () => {
    vi.useFakeTimers();
    try {
      const transport: typeof fetch = async (resource, options): Promise<never> => {
        expect(String(resource)).toBe('https://offline.invalid/v1/images/generations'); expect(options?.method).toBe('POST');
        throw new Error('offline submission acknowledgement lost');
      };
      const submit = createOrdinaryProvider(providerOptions(transport, { profile: PROFILE_OPENAI }));
      await expect(submit(model, 'test-only', 'https://offline.invalid/v1', 'provider', 1)).rejects.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('controlled Responses preserves all final tool outputs in response order', async () => {
    const transport: typeof fetch = async (resource, options): Promise<Response> => {
      expect(String(resource)).toBe('https://offline.invalid/v1/responses'); expect(options?.method).toBe('POST');
      const outputs = [{ type: 'image_generation_call', id: 'image-a', result: 'YQ==' },
        { type: 'image_generation_call', id: 'image-b', result: 'Yg==' }, { type: 'image_generation_call', id: 'image-c', result: 'YQ==' }];
      return new Response([
        { type: 'response.output_item.done', output_index: 1, item: outputs[1] },
        { type: 'response.output_item.done', output_index: 0, item: outputs[0] },
        { type: 'response.completed', response: { output: outputs } },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    };
    const submit = createOrdinaryProvider(providerOptions(transport, { profile: PROFILE_OPENAI, responsesApiEnabled: true }));
    expect((await submit(model, 'test-only', 'https://offline.invalid', 'provider', 1)).directImageUrls)
      .toEqual(['data:image/png;base64,YQ==', 'data:image/png;base64,Yg==', 'data:image/png;base64,YQ==']);
  });

  it.each(['repeat', 'distinct', 'snapshot-before', 'snapshot-after'])('fix1 I3 completed event identity: %s', async mode => {
    const red = { type: 'image_generation.completed', item_id: 'red-a', output_index: 0, b64_json: 'YQ==' };
    const snapshot = { type: 'response.completed', response: { output: [
      { type: 'image_generation_call', id: 'blue', result: 'Yg==' }, { type: 'image_generation_call', id: 'red-a', result: 'YQ==' },
    ] } };
    const events = mode === 'repeat' ? [red, red] : mode === 'distinct' ? [red, { ...red, item_id: 'red-b', output_index: 1 }]
      : mode === 'snapshot-before' ? [snapshot, red, red] : [red, red, snapshot];
    const transport: typeof fetch = async (resource, options): Promise<Response> => {
      expect(String(resource)).toBe('https://offline.invalid/v1/responses'); expect(options?.method).toBe('POST');
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    };
    const submit = createOrdinaryProvider(providerOptions(transport, { profile: PROFILE_OPENAI, responsesApiEnabled: true }));
    const result = await submit(model, 'test-only', 'https://offline.invalid', 'provider', 1);
    expect(result.taskIds).toEqual([]);
    expect(result.directImageUrls).toEqual(mode === 'repeat' ? ['data:image/png;base64,YQ==']
      : mode === 'distinct' ? ['data:image/png;base64,YQ==', 'data:image/png;base64,YQ==']
        : ['data:image/png;base64,Yg==', 'data:image/png;base64,YQ==']);
  });

  it('controlled Responses never promotes a partial image from an unfinished stream to accepted completion', async () => {
    const transport: typeof fetch = async (resource, options): Promise<Response> => {
      expect(String(resource)).toBe('https://offline.invalid/v1/responses'); expect(options?.method).toBe('POST');
      return new Response(`data: ${JSON.stringify({ type: 'response.image_generation_call.partial_image', partial_image_b64: 'YQ==' })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } });
    };
    const submit = createOrdinaryProvider(providerOptions(transport, { profile: PROFILE_OPENAI, responsesApiEnabled: true }));
    await expect(submit(model, 'test-only', 'https://offline.invalid', 'provider', 1)).rejects.toThrow();
  });

  it.each([false, true])('uses only the declared transport for both /v1 attempts, propagate=%s', async propagateErrors => {
    const calls: string[] = [];
    const original = Response.json({ error: 'endpoint not found' }, { status: 404 });
    const lost = new Error('second attempt acknowledgement lost');
    const transport: typeof fetch = async (input, options): Promise<Response> => {
      calls.push(String(input));
      expect(options?.method).toBe('POST');
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options).not.toHaveProperty('transport');
      expect(options).not.toHaveProperty('propagateErrors');
      if (String(input) === 'https://offline.invalid/images/generations') return original;
      if (String(input) === 'https://offline.invalid/v1/images/generations') throw lost;
      throw new Error('Undeclared IO');
    };
    const result = fetchWithV1Retry('https://offline.invalid', '/images/generations', { method: 'POST', transport, propagateErrors });
    if (propagateErrors) await expect(result).rejects.toBe(lost);
    else expect(await result).toBe(original);
    expect(calls).toEqual(['https://offline.invalid/images/generations', 'https://offline.invalid/v1/images/generations']);
  });

  it('default transport retains the original /v1 fallback and original response after retry error', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<Response> => {
      calls.push(String(input));
      if (String(input) === 'https://offline.invalid/images/generations') return Response.json({ error: 'not found' }, { status: 404 });
      if (String(input) === 'https://offline.invalid/v1/images/generations') throw new Error('offline');
      throw new Error('Undeclared IO');
    });
    expect((await fetchWithV1Retry('https://offline.invalid', '/images/generations', { method: 'POST' })).status).toBe(404);
    expect(calls).toEqual(['https://offline.invalid/images/generations', 'https://offline.invalid/v1/images/generations']);
  });

  it.each([false, true])('chat fallback retains default catch or propagates controlled failure, propagate=%s', async propagateErrors => {
    const calls: string[] = [];
    const lost = new Error('chat submission uncertain');
    const transport: typeof fetch = async (input, options): Promise<never> => {
      calls.push(String(input));
      expect(options?.method).toBe('POST');
      expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'gemini-image' });
      throw lost;
    };
    const result = tryChatCompletionsImageFallback({ baseUrl: 'https://offline.invalid', apiKey: 'test-only',
      model: 'gemini-image', prompt: 'cup', originalError: 'no available channel', transport, propagateErrors });
    if (propagateErrors) await expect(result).rejects.toBe(lost);
    else expect(await result).toBeNull();
    expect(calls).toEqual(['https://offline.invalid/chat/completions']);
  });

  it('default chat fallback still uses global transport and returns all image results', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://offline.invalid/chat/completions' || options?.method !== 'POST') throw new Error('Undeclared IO');
      calls.push(String(input));
      return Response.json({ choices: [{ message: { content: [
        { type: 'image_url', image_url: { url: 'https://offline.invalid/a.png' } },
        { type: 'image_url', image_url: { url: 'https://offline.invalid/b.png' } },
      ] } }] });
    });
    expect(await tryChatCompletionsImageFallback({ baseUrl: 'https://offline.invalid', apiKey: 'test-only',
      model: 'gemini-image', prompt: 'cup', originalError: 'no available channel' })).toEqual(['https://offline.invalid/a.png', 'https://offline.invalid/b.png']);
    expect(calls).toHaveLength(1);
  });
});
