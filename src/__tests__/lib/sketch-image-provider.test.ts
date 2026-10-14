import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSketchImageAnalysisStage, SketchProviderError } from '@/lib/sketch-to-code/provider';
import type { ApiProvider } from '@/lib/universal-api-types';

vi.mock('server-only', () => ({}));

const image = createCanvas(8, 8).toDataURL('image/png');
const analysis = { summary: '青绿色小屋与星星', composition: '小屋居中，星星位于右上角',
  prompt: '水彩质感的小屋，柔和光线', negativePrompt: '模糊、水印' };
const binding = { providerId: 'vision-provider', modelId: 'same-name' };
const requestId = 'image-analysis-1';
const secret = 'image-analysis-fixture-secret';
interface CapturedRequest {
  method: string | undefined; url: string; authorization: string | undefined;
  requestId: string | string[] | undefined; contentType: string | undefined; body: Record<string, unknown>;
}
let server: Server;
let provider: ApiProvider;
let requests: CapturedRequest[];
let respond: (response: ServerResponse) => void;

function envelope(content = JSON.stringify(analysis), patch: Record<string, unknown> = {}): string {
  return JSON.stringify({ model: 'same-name', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], ...patch });
}
function createStage(dependencies: { transport?: typeof fetch } = {}): ReturnType<typeof createSketchImageAnalysisStage> {
  return createSketchImageAnalysisStage({ provider, modelId: 'same-name', requestId }, dependencies);
}
function respondWith(body: string, contentType = 'application/json', status = 200): void {
  respond = response => {
    response.writeHead(status, { 'content-type': contentType, 'x-request-id': 'upstream-analysis-42' });
    response.end(body);
  };
}

beforeEach(async () => {
  requests = [];
  respondWith(envelope());
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    requests.push({ method: request.method, url: request.url ?? '', authorization: request.headers.authorization,
      requestId: request.headers['x-request-id'], contentType: request.headers['content-type'],
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> });
    respond(response);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  provider = { id: 'vision-provider', name: 'local analysis fixture',
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: secret,
    isEnabled: true, type: 'vlm', selectedModels: ['same-name'], createdAt: 1, updatedAt: 1 };
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('sketch image analysis native HTTP stage', () => {
  it('sends one exact analysis POST with the original PNG and keywords and returns only frozen analysis and real usage', async () => {
    respondWith(envelope(JSON.stringify(analysis), { usage: { prompt_tokens: 101, completion_tokens: 17, total_tokens: 118,
      prompt_tokens_details: { cached_tokens: 99 } } }));
    const configuration = { provider, modelId: 'same-name', requestId, systemPrompt: 'injected arbitrary system rules' };
    const stage = createSketchImageAnalysisStage(configuration);
    expect(stage).toBeTypeOf('function'); expect(stage).not.toHaveProperty('reconstruct');
    const result = await stage(image, '保留原图\n青绿色\t小屋\r和星星', binding, new AbortController().signal);
    expect(result).toEqual({ analysis, usage: { inputTokens: 101, outputTokens: 17 } });
    expect(Object.keys(result)).toEqual(['analysis', 'usage']);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/v1/chat/completions', authorization: `Bearer ${secret}`,
      requestId: 'image-analysis-1:analysis', contentType: 'application/json',
      body: { model: 'same-name', stream: false, response_format: { type: 'json_object' } } });
    const messages = requests[0].body.messages as { role: string; content: unknown }[];
    expect(messages).toHaveLength(2); expect(messages[0].role).toBe('system');
    const system = messages[0].content as string;
    for (const field of ['summary', 'composition', 'prompt', 'negativePrompt']) expect(system).toContain(field);
    expect(system).toContain('前三'); expect(system).toContain('negativePrompt可空');
    expect(system).toContain('64KiB'); expect(system).toContain('UTF-8'); expect(system).toContain('素材');
    expect(system).not.toMatch(/layout|controls|控件树|还原静态界面|节点type|injected arbitrary/);
    expect(messages[1]).toEqual({ role: 'user', content: [
      { type: 'text', text: JSON.stringify({ instruction: '保留原图\n青绿色\t小屋\r和星星' }) },
      { type: 'image_url', image_url: { url: image } },
    ] });
    expect([result, result.analysis, result.usage].every(Object.isFrozen)).toBe(true);
  });
  it('keeps absent native usage absent instead of inventing zero counters', async () => {
    const result = await createStage()(image, '', binding, new AbortController().signal);
    expect(result).toEqual({ analysis }); expect(result).not.toHaveProperty('usage');
    expect(Object.isFrozen(result.analysis)).toBe(true); expect(requests).toHaveLength(1);
  });
  it('preserves actual zero counters and an empty negative prompt', async () => {
    const actual = { ...analysis, negativePrompt: '' };
    respondWith(envelope(JSON.stringify(actual), { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
    const result = await createStage()(image, '', binding, new AbortController().signal);
    expect(result).toEqual({ analysis: actual, usage: { inputTokens: 0, outputTokens: 0 } });
    expect(Object.isFrozen(result.usage)).toBe(true); expect(requests).toHaveLength(1);
  });
  it.each(['summary', 'composition', 'prompt', 'negativePrompt'] as const)('preserves native LF/Tab/CR in %s', async field => {
    const actual = { ...analysis, [field]: '第一行\n第二行\t列\r第三行' };
    respondWith(envelope(JSON.stringify(actual)));
    expect((await createStage()(image, '', binding, new AbortController().signal)).analysis[field])
      .toBe('第一行\n第二行\t列\r第三行');
    expect(requests).toHaveLength(1);
  });
  it.each([{ providerId: 'another-provider', modelId: 'same-name' }, { ...binding, modelId: 'other-model' }])(
    'rejects a swapped exact binding %j with zero transport I/O', async changed => {
      let calls = 0;
      const transport: typeof fetch = async (url, options) => { calls++; return fetch(url, options); };
      await expect(createStage({ transport })(image, '', changed, new AbortController().signal)).rejects.toMatchObject({
        code: 'SKETCH_PROVIDER_BINDING_MISMATCH', providerId: 'vision-provider', modelId: 'same-name', phase: 'analysis', requestId,
      });
      expect(calls).toBe(0); expect(requests).toHaveLength(0);
    },
  );
  it('snapshots the provider route, key and identity at factory creation', async () => {
    const stage = createStage();
    provider.id = 'changed-provider'; provider.baseUrl = 'http://127.0.0.1:1'; provider.apiKey = 'changed-key';
    provider.isEnabled = false; provider.selectedModels = ['changed-model'];
    expect(await stage(image, '原关键词', binding, new AbortController().signal)).toEqual({ analysis });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: '/v1/chat/completions', authorization: `Bearer ${secret}`, body: { model: 'same-name' } });
  });
  it.each([
    ['substituted-model', { model: 'other-model' }, 'SKETCH_PROVIDER_BINDING_MISMATCH'],
    ['missing-model', { model: undefined }, 'SKETCH_PROVIDER_RESPONSE_INVALID'],
    ['empty-choices', { choices: [] }, 'SKETCH_PROVIDER_RESPONSE_INVALID'],
    ['truncated', { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(analysis) } }] }, 'SKETCH_PROVIDER_RESPONSE_INVALID'],
    ['missing-finish', { choices: [{ message: { content: JSON.stringify(analysis) } }] }, 'SKETCH_PROVIDER_RESPONSE_INVALID'],
    ['refusal', { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis), refusal: 'refused' } }] }, 'SKETCH_PROVIDER_RESPONSE_INVALID'],
    ['tool-call', { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis), tool_calls: [] } }] }, 'SKETCH_PROVIDER_RESPONSE_INVALID'],
    ['non-string-content', { choices: [{ finish_reason: 'stop', message: { content: analysis } }] }, 'SKETCH_PROVIDER_RESPONSE_INVALID'],
  ] as const)('rejects %s receipt with safe identity and one POST', async (_label, patch, code) => {
    respondWith(envelope(JSON.stringify(analysis), patch));
    await expect(createStage()(image, '', binding, new AbortController().signal)).rejects.toMatchObject({
      code, providerId: 'vision-provider', modelId: 'same-name', phase: 'analysis', requestId: 'upstream-analysis-42', providerStatus: 200,
    });
    expect(requests).toHaveLength(1);
  });
  it.each([
    ['HTML', '<html>untrusted</html>'], ['prose', `raw provider prose ${secret}`], ['broken JSON', '{broken'],
    ['Markdown fence', '```json\n{}\n```'], ['unknown analysis field', JSON.stringify({ ...analysis, extra: 'unknown' })],
    ['legacy HTML analysis', JSON.stringify({ summary: '页面', layout: '竖直', controls: [], text: [] })],
    ['missing negative', JSON.stringify({ summary: '摘要', composition: '构图', prompt: '提示词' })],
    ['non-string negative', JSON.stringify({ ...analysis, negativePrompt: 1 })],
    ['aggregate UTF-8 limit', JSON.stringify({ ...analysis, prompt: '字'.repeat(21845) })],
    ['serialized analysis limit', JSON.stringify(analysis) + ' '.repeat(256 * 1024)],
  ])('rejects %s analysis content without exposing provider text', async (_label, content) => {
    respondWith(envelope(content));
    const error: unknown = await createStage()(image, '', binding, new AbortController().signal).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SketchProviderError);
    expect(error).toMatchObject({ code: 'SKETCH_PROVIDER_RESPONSE_INVALID', providerId: 'vision-provider', modelId: 'same-name',
      phase: 'analysis', requestId: 'upstream-analysis-42', providerStatus: 200 });
    expect(JSON.stringify(error) + String(error)).not.toContain(secret); expect(requests).toHaveLength(1);
  });
  it.each(['summary', 'composition', 'prompt'] as const)('rejects empty native %s', async field => {
    respondWith(envelope(JSON.stringify({ ...analysis, [field]: ' \n\t\r' })));
    await expect(createStage()(image, '', binding, new AbortController().signal)).rejects.toMatchObject({ code: 'SKETCH_PROVIDER_RESPONSE_INVALID' });
    expect(requests).toHaveLength(1);
  });
  it.each(['summary', 'composition', 'prompt', 'negativePrompt'] as const)('rejects native NUL in %s through the approved image contract', async field => {
    respondWith(envelope(JSON.stringify({ ...analysis, [field]: 'before\u0000after' })));
    await expect(createStage()(image, '', binding, new AbortController().signal)).rejects.toMatchObject({ code: 'SKETCH_PROVIDER_RESPONSE_INVALID' });
    expect(requests).toHaveLength(1);
  });
  it.each(['text/html', 'text/event-stream', 'application/octet-stream'])('rejects Content-Type %s', async contentType => {
    respondWith(envelope(), contentType);
    await expect(createStage()(image, '', binding, new AbortController().signal)).rejects.toMatchObject({ code: 'SKETCH_PROVIDER_RESPONSE_INVALID' });
    expect(requests).toHaveLength(1);
  });
  it.each([null, {}, { prompt_tokens: 1 }, { prompt_tokens: '1', completion_tokens: 2 },
    { prompt_tokens: 1, completion_tokens: 2, total_tokens: 4 }, { input_tokens: 1, output_tokens: 2 },
    { prompt_tokens: 1.5, completion_tokens: 2 }, { prompt_tokens: -1, completion_tokens: 2 },
    { prompt_tokens: 10_000_001, completion_tokens: 2 }, { prompt_tokens: 1, completion_tokens: 2, total_tokens: null }])(
    'rejects malformed native usage %j', async usage => {
      respondWith(envelope(JSON.stringify(analysis), { usage }));
      await expect(createStage()(image, '', binding, new AbortController().signal)).rejects.toMatchObject({
        code: 'SKETCH_PROVIDER_RESPONSE_INVALID', requestId: 'upstream-analysis-42', providerStatus: 200,
      });
      expect(requests).toHaveLength(1);
    },
  );
  it.each([401, 403, 404, 429, 503])('preserves safe native HTTP %i error identity without retry', async status => {
    respondWith(JSON.stringify({ error: { code: `capacity-${secret}`, message: `原错误 ${status}; key=${secret}` } }), 'application/json', status);
    const error: unknown = await createStage()(image, '', binding, new AbortController().signal).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SketchProviderError);
    expect(error).toMatchObject({ code: 'SKETCH_PROVIDER_REJECTED', providerId: 'vision-provider', modelId: 'same-name',
      phase: 'analysis', requestId: 'upstream-analysis-42', providerStatus: status, providerCode: 'capacity-[REDACTED]' });
    expect((error as Error).message).toContain(`原错误 ${status}`);
    expect(JSON.stringify(error) + String(error)).not.toContain(secret); expect(requests).toHaveLength(1);
  });
  it('sanitizes unsafe upstream request IDs and preserves the local phase ID', async () => {
    respond = response => {
      response.writeHead(503, { 'content-type': 'application/json', 'x-request-id': `request-${secret}` });
      response.end(JSON.stringify({ error: { message: secret } }));
    };
    const error: unknown = await createStage()(image, '', binding, new AbortController().signal).catch((value: unknown) => value);
    expect(error).toMatchObject({ requestId: 'image-analysis-1:analysis', providerStatus: 503 });
    expect(JSON.stringify(error) + String(error)).not.toContain(secret); expect(requests).toHaveLength(1);
  });
  it('does not resend an analysis POST across an HTTP redirect', async () => {
    respond = response => { response.writeHead(307, { location: `${provider.baseUrl}/redirected` }); response.end(); };
    await expect(createStage()(image, '', binding, new AbortController().signal)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it.each(['declared', 'streamed'] as const)('rejects a %s body above 1 MiB and closes the unfinished native response', async variant => {
    let closed!: () => void; const closure = new Promise<void>(resolve => { closed = resolve; });
    respond = response => {
      response.on('close', closed);
      response.writeHead(200, { 'content-type': 'application/json', ...(variant === 'declared' ? { 'content-length': 1024 * 1024 + 1 } : {}) });
      response.write(variant === 'declared' ? '{' : 'x'.repeat(1024 * 1024 + 1));
    };
    await expect(createStage()(image, '', binding, new AbortController().signal)).rejects.toMatchObject({ code: 'SKETCH_PROVIDER_RESPONSE_LIMIT' });
    await closure; expect(requests).toHaveLength(1);
  });
  it('accepts a complete native envelope at exactly 1 MiB', async () => {
    const json = envelope(); const body = json + ' '.repeat(1024 * 1024 - Buffer.byteLength(json, 'utf8'));
    respondWith(body);
    expect(await createStage()(image, '', binding, new AbortController().signal)).toEqual({ analysis });
    expect(requests).toHaveLength(1);
  });
  it.each(['outer JSON', 'UTF-8'] as const)('rejects malformed native %s', async variant => {
    respond = response => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(variant === 'outer JSON' ? '{broken' : Buffer.from([0xc3, 0x28])); };
    await expect(createStage()(image, '', binding, new AbortController().signal)).rejects.toMatchObject({ code: 'SKETCH_PROVIDER_RESPONSE_INVALID' });
    expect(requests).toHaveLength(1);
  });
  it('honors pre-cancellation with zero native transport I/O', async () => {
    const abort = new AbortController(); const reason = new Error('image-analysis-pre-cancelled'); abort.abort(reason);
    let calls = 0;
    const transport: typeof fetch = async (url, options) => { calls++; return fetch(url, options); };
    await expect(createStage({ transport })(image, '', binding, abort.signal)).rejects.toBe(reason);
    expect(calls).toBe(0); expect(requests).toHaveLength(0);
  });
  it('cancels after native response headers arrive and discards a late complete counted body', async () => {
    const abort = new AbortController(); const reason = new Error('image-analysis-body-cancelled');
    let ready!: () => void; const headersReceived = new Promise<void>(resolve => { ready = resolve; });
    let closed!: () => void; const closure = new Promise<void>(resolve => { closed = resolve; });
    let late!: () => void; let calls = 0;
    const complete = envelope(JSON.stringify(analysis), { usage: { prompt_tokens: 7, completion_tokens: 8 } });
    respond = response => {
      response.on('close', closed); response.writeHead(200, { 'content-type': 'application/json' }); response.write('{');
      late = () => response.end(complete.slice(1));
    };
    const transport: typeof fetch = async (url, options) => { calls++; const response = await fetch(url, options); ready(); return response; };
    const outcome = createStage({ transport })(image, '', binding, abort.signal).then(result => ({ result }), (error: unknown) => ({ error }));
    await headersReceived; abort.abort(reason);
    expect(await outcome).toEqual({ error: reason }); await closure; late();
    expect(calls).toBe(1); expect(requests).toHaveLength(1);
  });
  it('discards a late native HTTP response even when an injected transport ignores cancellation', async () => {
    const abort = new AbortController(); const reason = new Error('image-analysis-late-cancelled');
    let ready!: () => void; const headersReceived = new Promise<void>(resolve => { ready = resolve; });
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    respondWith(envelope(JSON.stringify(analysis), { usage: { prompt_tokens: 7, completion_tokens: 8 } }));
    const transport: typeof fetch = async (url, options) => {
      calls++; const response = await fetch(url, { ...options, signal: undefined }); ready(); await held; return response;
    };
    const outcome = createStage({ transport })(image, '', binding, abort.signal).then(result => ({ result }), (error: unknown) => ({ error }));
    await headersReceived; abort.abort(reason); release();
    expect(await outcome).toEqual({ error: reason }); expect(calls).toBe(1); expect(requests).toHaveLength(1);
  });
});
