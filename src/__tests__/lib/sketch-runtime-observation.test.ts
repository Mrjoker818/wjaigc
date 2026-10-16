import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSketchProviderStages } from '@/lib/sketch-to-code/provider';
import { createSketchImageQueryStage } from '@/lib/sketch-to-code/image-provider';
import { createSketchRuntimeObserver } from '@/lib/sketch-to-code/runtime-observation';
import type { ApiProvider } from '@/lib/universal-api-types';

vi.mock('server-only', () => ({}));
// The ordinary image adapter imports default configuration transitively. Keep
// that unused default directory discovery from probing/migrating business data.
vi.mock('@/lib/server-data-root', () => {
  const root = `${process.cwd()}/.superpowers/sdd/2026-10-09-sketch-to-code/runtime-observation-owned`;
  const denied = (): never => { throw new Error('OBSERVATION_DEFAULT_FILE_PORT_FORBIDDEN'); };
  return { getServerDataRoot: (): string => root, getServerSystemDir: (): string => `${root}/system`,
    getServerUsersDir: (): string => `${root}/users`, isServerDataRootDurable: (): boolean => false,
    migrateLocalDataIfNeeded: denied, saveImageFile: denied, deleteImageFile: denied,
    getImageWriteDir: denied, filePathToPublicUrl: denied };
});
const secret = 'runtime-fixture-key';
const privateImage = 'data:image/png;base64,PRIVATE_IMAGE';
const privateInstruction = 'PRIVATE_INSTRUCTION';
const provider: ApiProvider = { id: 'trace-provider', name: 'memory transport', type: 'vlm',
  baseUrl: 'https://fixture.invalid/v1', apiKey: secret, isEnabled: true,
  selectedModels: ['exact-vision'], createdAt: 1, updatedAt: 1 };
const binding = { providerId: provider.id, modelId: 'exact-vision' };
function response(): Response {
  return Response.json({ model: binding.modelId, choices: [{ finish_reason: 'stop',
    message: { content: '{"summary":"private-response"}' } }] }, { headers: { 'x-request-id': 'upstream-42' } });
}
function capture(): { rows: () => Record<string, unknown>[]; output: () => string } {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  return { rows: () => log.mock.calls.filter(call => call[0] === '[SketchRuntime]')
    .map(call => JSON.parse(String(call[1])) as Record<string, unknown>),
  output: () => JSON.stringify(log.mock.calls) };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('sketch runtime observations use the original HTTP boundary', () => {
  it('separates both exact-model HTTP phases without logging material or credentials', async () => {
    const logs = capture(), transport = vi.fn(async (): Promise<Response> => response());
    const stages = createSketchProviderStages({ provider, modelId: binding.modelId, requestId: 'root-42' }, { transport });
    await stages.analyze(privateImage, privateInstruction, binding, new AbortController().signal);
    await stages.reconstruct({ summary: 'private-analysis', layout: 'private-layout', controls: [], text: [] }, binding, new AbortController().signal);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(logs.rows().map(row => [row.phase, row.event])).toEqual([
      ['analysis', 'request-start'], ['analysis', 'response-headers'], ['analysis', 'body-complete'],
      ['reconstruction', 'request-start'], ['reconstruction', 'response-headers'], ['reconstruction', 'body-complete'],
    ]);
    expect(logs.rows()[1]).toMatchObject({ requestId: 'root-42', providerId: provider.id,
      modelId: binding.modelId, httpStatus: 200, responseId: 'upstream-42' });
    expect(logs.output()).not.toMatch(/PRIVATE_IMAGE|PRIVATE_INSTRUCTION|private-analysis|private-layout|private-response|runtime-fixture-key|authorization|baseUrl/);
  });

  it('does not mistake received headers for a finished body and preserves cancellation', async () => {
    const logs = capture(), controller = new AbortController(), reason = new Error('private-cancel-reason');
    let bodyCancelled = false;
    const transport = vi.fn(async (): Promise<Response> => new Response(new ReadableStream<Uint8Array>({
      start(stream): void { stream.enqueue(new TextEncoder().encode('{"private-body":')); },
      cancel(): void { bodyCancelled = true; },
    }), { headers: { 'content-type': 'application/json' } }));
    const stages = createSketchProviderStages({ provider, modelId: binding.modelId, requestId: 'body-42' }, { transport });
    const running = stages.analyze(privateImage, privateInstruction, binding, controller.signal);
    const outcome = running.catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(logs.rows().some(row => row.event === 'response-headers')).toBe(true));
      expect(logs.rows().some(row => row.event === 'body-complete')).toBe(false);
      controller.abort(reason);
      expect(await outcome).toBe(reason); expect(bodyCancelled).toBe(true);
      expect(logs.rows().at(-1)).toMatchObject({ event: 'attempt-error', phase: 'analysis', aborted: true });
      expect(logs.output()).not.toMatch(/private-body|private-cancel-reason|runtime-fixture-key/);
    } finally { controller.abort(reason); await outcome; }
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('preserves the original transport error without logging its message or retrying', async () => {
    const logs = capture(), error = new Error(`private-network ${secret}`);
    const transport = vi.fn(async (): Promise<Response> => { throw error; });
    const stages = createSketchProviderStages({ provider, modelId: binding.modelId, requestId: 'transport-42' }, { transport });
    await expect(stages.analyze(privateImage, privateInstruction, binding, new AbortController().signal)).rejects.toBe(error);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(logs.rows().map(row => row.event)).toEqual(['request-start', 'attempt-error']);
    expect(logs.output()).not.toMatch(/private-network|runtime-fixture-key/);
  });

  it('a throwing log sink cannot reject a successful provider response or add a POST', async () => {
    const sink = vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('private-sink'); });
    const transport = vi.fn(async (): Promise<Response> => response());
    const stage = createSketchProviderStages({ provider, modelId: binding.modelId, requestId: 'sink-42' }, { transport });
    await expect(stage.analyze(privateImage, privateInstruction, binding, new AbortController().signal))
      .resolves.toEqual({ content: '{"summary":"private-response"}' });
    expect(transport).toHaveBeenCalledTimes(1); expect(sink).toHaveBeenCalledTimes(3);
  });

  it('binding rejection stays before any HTTP or request-start observation', async () => {
    const logs = capture(), transport = vi.fn(async (): Promise<Response> => response());
    const stage = createSketchProviderStages({ provider, modelId: binding.modelId, requestId: 'binding-42' }, { transport });
    await expect(stage.analyze(privateImage, privateInstruction, { ...binding, providerId: 'other' }, new AbortController().signal)).rejects.toThrow('SKETCH_PROVIDER_BINDING_MISMATCH');
    expect(transport).not.toHaveBeenCalled(); expect(logs.rows()).toEqual([]);
  });

  it('redacts the actual configured key even if a supplier copies it into a response ID', async () => {
    const logs = capture();
    const transport = vi.fn(async (): Promise<Response> => {
      const value = response(); value.headers.set('x-request-id', `upstream-${secret}`); return value;
    });
    const stage = createSketchProviderStages({ provider, modelId: binding.modelId, requestId: 'redact-42' }, { transport });
    await stage.analyze(privateImage, privateInstruction, binding, new AbortController().signal);
    expect(logs.rows()).toHaveLength(3); expect(logs.output()).not.toContain(secret);
  });

  it.each(['https://private-image.invalid/private-credential', 'https:private-image.invalid',
    'HTTPS:private-image.invalid', 'data:private-credential', 'file:private-credential'])(
    'does not accept resource URL %s as a supplier response identifier', async responseId => {
    const logs = capture(), imageProvider: ApiProvider = { ...provider, id: 'image-provider', type: 'image',
      selectedModels: ['gemini-3.1-flash-lite-image'], advancedParams: { compatProfile: 'apimart' } };
    const selected = { providerId: imageProvider.id, modelId: 'gemini-3.1-flash-lite-image' };
    const transport = vi.fn(async (): Promise<Response> => Response.json({ code: 200, data: { id: 'remote-42', status: 'pending' } },
      { headers: { 'x-request-id': responseId } }));
    const query = createSketchImageQueryStage({ provider: imageProvider, modelId: selected.modelId, requestId: 'url-id-42' }, { transport });
    await query('remote-42', selected, new AbortController().signal);
    expect(transport).toHaveBeenCalledTimes(1); expect(logs.rows()).toHaveLength(4);
    expect(logs.output()).not.toMatch(/private-image|private-credential/);
  });

  it('observer construction failure cannot escape into task scheduling', () => {
    const logs = capture();
    const identity = { get requestId(): string { throw new Error('private-getter'); } };
    expect(() => {
      const observe = createSketchRuntimeObserver(identity);
      observe({ event: 'worker-start', phase: 'code-worker' });
    }).not.toThrow();
    expect(logs.rows()).toEqual([]);
  });

  it('caps each observer instance at 32 events and preserves legitimate colon correlation IDs', () => {
    const logs = capture(), observe = createSketchRuntimeObserver({ requestId: 'root-42:analysis' });
    for (let index = 0; index < 33; index++) observe({ event: 'attempt-error', phase: 'analysis' });
    expect(logs.rows()).toHaveLength(32);
    expect(logs.rows().every(row => row.requestId === 'root-42:analysis')).toBe(true);
  });

  it('observes the first image GET and normalized status changes, not every pending poll or native image URL', async () => {
    const logs = capture(), imageProvider: ApiProvider = { ...provider, id: 'image-provider', type: 'image',
      selectedModels: ['gemini-3.1-flash-lite-image'], advancedParams: { compatProfile: 'apimart' } };
    const selected = { providerId: imageProvider.id, modelId: 'gemini-3.1-flash-lite-image' };
    let count = 0;
    const transport = vi.fn(async (_url: Parameters<typeof fetch>[0], options?: RequestInit): Promise<Response> => {
      expect(options?.method || 'GET').toBe('GET'); expect(options?.body).toBeUndefined(); count++;
      return Response.json({ code: 200, data: { id: 'remote-42', status: count <= 6 ? 'pending' : 'completed',
        ...(count > 6 ? { result: { images: [{ url: ['https://private-image.invalid/private-output.png'] }] } } : {}) } });
    });
    const query = createSketchImageQueryStage({ provider: imageProvider, modelId: selected.modelId, requestId: 'query-42' }, { transport });
    for (let index = 0; index < 6; index++) expect(await query('remote-42', selected, new AbortController().signal)).toEqual({ status: 'pending', imageUrls: [] });
    expect(await query('remote-42', selected, new AbortController().signal)).toEqual({ status: 'completed', imageUrls: ['https://private-image.invalid/private-output.png'] });
    expect(transport).toHaveBeenCalledTimes(7);
    expect(logs.rows().map(row => row.event)).toEqual(['request-start', 'response-headers', 'body-complete', 'query-result', 'query-result']);
    expect(logs.rows().filter(row => row.event === 'query-result').map(row => row.status)).toEqual(['pending', 'completed']);
    expect(logs.output()).not.toMatch(/private-image|private-output|runtime-fixture-key/);
  });
});
