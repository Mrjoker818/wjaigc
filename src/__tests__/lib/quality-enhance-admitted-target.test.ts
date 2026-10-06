import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { ApiProvider } from '@/lib/universal-api-types';
const storage = vi.hoisted(() => ({ find: vi.fn(), download: vi.fn(), persist: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({ findProviderForModel: storage.find }));
vi.mock('@/lib/safe-image-download', async original => {
  const actual = await original<typeof import('@/lib/safe-image-download')>();
  return { ...actual, downloadPublicImage: async (input: string | URL,
    options?: Parameters<typeof actual.downloadPublicImage>[1]): Promise<{ buffer: Buffer; mimeType: string }> => {
    if (/\b(?:127\.0\.0\.1|localhost)\b/.test(String(input))) return actual.downloadPublicImage(input, options);
    return storage.download(String(input), options);
  } };
});
vi.mock('@/lib/asset-core/binary-persistence', () => ({ persistAssetBytes: storage.persist }));
import { enhanceViaAI } from '@/lib/quality-enhance';
const admitted: ApiProvider = { id: 'admitted', name: 'admitted', type: 'image', isEnabled: true,
  apiKey: 'offline-admitted', baseUrl: 'https://admitted.invalid/v1', createdAt: 1, updatedAt: 1 };
beforeEach(async (): Promise<void> => { vi.clearAllMocks(); storage.find.mockResolvedValue(null);
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#997744' } }).png().toBuffer();
  storage.download.mockResolvedValue({ buffer: png, mimeType: 'image/png' });
  storage.persist.mockResolvedValue({ url: '/api/serve-upload/exports/enhanced.png' }); });
afterEach((): void => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('rejects a private source before any source request or provider submission', async (): Promise<void> => {
  const source = 'http://127.0.0.1/private-source.png';
  const network = vi.fn(async (): Promise<never> => { throw new Error('Undeclared network'); });
  vi.stubGlobal('fetch', network);
  expect(await enhanceViaAI(source, 'gpt-image-1', admitted.id, {}, admitted))
    .toEqual({ url: source, enhanced: false });
  expect(network).not.toHaveBeenCalled();
  expect(storage.download).not.toHaveBeenCalled();
}, 10000);
it('reads a same-port managed upload locally without giving its private URL to the provider', async (): Promise<void> => {
  const source = 'http://localhost:5000/api/serve-upload/uploads/enhance-source.png';
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#997744' } }).png().toBuffer();
  let submittedImage: string | undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === source && (!init?.method || init.method === 'GET')) {
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    }
    if (url === 'https://admitted.invalid/v1/images/generations') {
      submittedImage = (JSON.parse(String(init?.body)) as { image_urls: string[] }).image_urls[0];
      return Response.json({ imageUrl: 'https://media.invalid/enhanced.png' });
    }
    throw new Error(`Undeclared network: ${url}`);
  }));
  expect(await enhanceViaAI(source, 'gpt-image-1', admitted.id, {}, admitted))
    .toEqual({ url: '/api/serve-upload/exports/enhanced.png', enhanced: true });
  expect(submittedImage).toMatch(/^data:image\/png;base64,/);
  expect(Buffer.from(submittedImage!.split(',')[1], 'base64')).toEqual(png);
  expect(storage.download).toHaveBeenCalledWith('https://media.invalid/enhanced.png', expect.anything());
}, 10000);
it('does not follow a local source redirect into an internal endpoint', async (): Promise<void> => {
  const source = '/api/serve-upload/source.png';
  const network = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    void _input; void _init;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  });
  vi.stubGlobal('fetch', network);
  expect(await enhanceViaAI(source, 'gpt-image-1', admitted.id, {}, admitted))
    .toEqual({ url: source, enhanced: false });
  expect(network).toHaveBeenCalledTimes(1);
  expect(network.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
}, 10000);
it.each([
  '/api/serve-upload/../../api/private-image',
  '/api/serve-upload/%2e%2e/%2e%2e/api/private-image',
  '/api/serve-upload/%252e%252e/private-image',
])('rejects a local source path that may normalize outside the media route: %s', async (source): Promise<void> => {
  const network = vi.fn(async (): Promise<never> => { throw new Error('Undeclared network'); });
  vi.stubGlobal('fetch', network);
  expect(await enhanceViaAI(source, 'gpt-image-1', admitted.id, {}, admitted))
    .toEqual({ url: source, enhanced: false });
  expect(network).not.toHaveBeenCalled();
}, 10000);
it('passes an overall deadline signal to the public source downloader', async (): Promise<void> => {
  const source = 'https://media.invalid/source.png';
  vi.stubGlobal('fetch', vi.fn(async (): Promise<never> => { throw new Error('Undeclared provider request'); }));
  await enhanceViaAI(source, 'gpt-image-1', admitted.id, {}, admitted);
  expect(storage.download).toHaveBeenCalledWith(source,
    expect.objectContaining({ maxBytes: 32 * 1024 * 1024, signal: expect.any(AbortSignal) }));
}, 10000);
it('stops reading an oversized local source before provider submission', async (): Promise<void> => {
  const source = '/api/serve-upload/oversized.png';
  const network = vi.fn(async (): Promise<Response> => new Response(new ReadableStream<Uint8Array>({
    start(controller): void { controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1)); controller.close(); },
  }), { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', network);
  expect(await enhanceViaAI(source, 'gpt-image-1', admitted.id, {}, admitted))
    .toEqual({ url: source, enhanced: false });
  expect(network).toHaveBeenCalledTimes(1);
}, 10000);
it('uses supplied provider snapshot for submit and polling without global provider lookup', async (): Promise<void> => {
  const requests: Array<{ url: string; authorization: string | null; model?: string }> = [];
  vi.stubEnv('INTERNAL_API_SECRET', 'offline-model-secret-at-least-32-characters');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === 'https://media.invalid/source.png') return new Response('', { status: 404 });
    requests.push({ url, authorization: new Headers(init?.headers).get('authorization'),
      ...(init?.body ? { model: (JSON.parse(String(init.body)) as { model: string }).model } : {}) });
    if (url === 'https://admitted.invalid/v1/images/generations') return Response.json({ taskId: 'enhance-task' });
    if (url === 'https://admitted.invalid/v1/tasks/enhance-task') return Response.json({ status: 'completed', imageUrl: 'https://media.invalid/enhanced.png' });
    throw new Error('Unmatched offline network');
  }));
  // Fifth server-only argument is the new contract; the old helper ignores it in RED.
  const result = await enhanceViaAI('https://media.invalid/source.png', 'gpt-image-1', 'admitted', {}, admitted);
  expect.soft(result).toEqual({ url: '/api/serve-upload/exports/enhanced.png', enhanced: true });
  expect.soft(storage.find).not.toHaveBeenCalled();
  expect(requests).toEqual([
    { url: 'https://admitted.invalid/v1/images/generations', authorization: 'Bearer offline-admitted', model: 'gpt-image-1' },
    { url: 'https://admitted.invalid/v1/tasks/enhance-task', authorization: 'Bearer offline-admitted' },
  ]);
}, 10000);
it('keeps the legacy lookup when no admitted snapshot was provided', async (): Promise<void> => {
  vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response('', { status: 404 })));
  expect(await enhanceViaAI('https://media.invalid/source.png', 'gpt-image-1', 'legacy')).toEqual({ url: 'https://media.invalid/source.png', enhanced: false });
  expect(storage.find).toHaveBeenCalledWith('gpt-image-1', 'image', 'legacy');
});
it('stops legacy async enhancement when the completed image is unsafe', async (): Promise<void> => {
  const source = 'https://media.invalid/source.png';
  storage.download.mockRejectedValue(new Error('unsafe private image result'));
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url === source) return new Response('', { status: 404 });
    if (url === 'https://admitted.invalid/v1/images/generations') return Response.json({ taskId: 'legacy-unsafe' });
    if (url === 'https://admitted.invalid/v1/tasks/legacy-unsafe') {
      return Response.json({ status: 'completed', imageUrl: 'http://127.0.0.1/private-image.png' });
    }
    throw new Error(`Undeclared network: ${url}`);
  }));
  expect(await enhanceViaAI(source, 'gpt-image-1', 'admitted', {}, admitted))
    .toEqual({ url: source, enhanced: false });
}, 6500);
it('does not publish a legacy provider URL when managed storage fails', async (): Promise<void> => {
  const source = 'https://media.invalid/source.png';
  const output = 'https://media.invalid/enhanced.png';
  storage.persist.mockRejectedValue(new Error('managed storage unavailable'));
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url === source) return new Response('', { status: 404 });
    if (url === 'https://admitted.invalid/v1/images/generations') return Response.json({ imageUrl: output });
    throw new Error(`Undeclared network: ${url}`);
  }));
  expect(await enhanceViaAI(source, 'gpt-image-1', 'admitted', {}, admitted))
    .toEqual({ url: source, enhanced: false });
}, 10000);
