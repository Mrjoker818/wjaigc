import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Route, pipeline, adapters, decoder and download policy remain real. No storage
// or network boundary can escape these doubles; no old 43/41 suite is imported.
const io = vi.hoisted(() => ({ provider: vi.fn(), providers: vi.fn(), lookup: vi.fn(), request: vi.fn(), fetch: vi.fn(), consume: vi.fn(), refund: vi.fn(), db: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({ findProviderForFeature: io.provider, getApiProviders: io.providers, findProviderById: vi.fn(), normalizeApiBaseUrl: (url: string) => url.replace(/\/+$/, '') }));
vi.mock('@/lib/db-client', () => ({ getPool: io.db, execSql: io.db, isDatabaseConfigured: () => false }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => ({ id: 'followup-user', name: 'Synthetic', status: 'active', apiPermissions: { vectorize: true } }) }));
vi.mock('@/lib/credits', () => ({ consumeCredits: io.consume, refundCredits: io.refund }));
vi.mock('@/lib/op-log', () => ({ logOperation: vi.fn(), logError: vi.fn(), OP_ACTIONS: {}, startTimer: () => () => 0 }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => '/synthetic-data' }));
vi.mock('@/lib/s3-storage', () => ({ readManagedImageFromS3Bounded: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));
vi.mock('node:http', () => ({ request: io.request }));
vi.mock('node:https', () => ({ request: io.request }));
// RED must expose an incorrectly reached local engine without running it.
vi.mock('wasm_vtracer', () => ({ init: vi.fn(async () => { throw new Error('Unexpected WASM after cancellation'); }) }));

import { POST } from '@/app/api/design/vectorize/route';
import { vectorizePipeline } from '@/lib/vectorize-pipeline';
import { recraftVectorize } from '@/lib/vectorize-recraft';
import { downloadVectorizeResultSvg } from '@/lib/vectorize-result-download';
import { downloadPublicImage } from '@/lib/safe-image-download';

const BASE = 'http://127.0.0.1:9999/trusted/api';
const RESULT = 'https://public-result.invalid/result.svg';
const ERROR_XML = '<?xml version="1.0"?><error>not an SVG</error>';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0H1V1H0Z"/></svg>';
const VLM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">' + '<path d="M0 0H1V1H0Z" fill="#ff0000"/>'.repeat(8) + '</svg>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC', 'base64');
let reply: 'url' | 'direct' | 'image-svg' | 'data-svg' | 'svg' | 'http-error';
let content: string;
let remote: { status: number; mime: string; length: number; open: boolean };
let cancelVlm: boolean;
let vlmFailure: boolean;
let controller: AbortController;
let reason: DOMException;
let receipts: Array<{ response: PassThrough; destroy: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.spyOn> }>;

function run(engine?: 'recraft' | 'vlm') {
  return vectorizePipeline({ imageUrl: '/api/serve-upload/synthetic.png', imageBuffer: PNG,
    imageDataUrl: `data:image/png;base64,${PNG.toString('base64')}`, engine, signal: controller.signal });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('COZE_PROJECT_ENV', ''); vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', ''); vi.stubEnv('PY_VECTORIZE_ENDPOINT', '');
  for (const key of ['log', 'warn', 'debug', 'error'] as const) vi.spyOn(console, key).mockImplementation(() => {});
  io.db.mockImplementation(() => { throw new Error('DB FORBIDDEN'); });
  io.consume.mockResolvedValue({ success: true, cost: 7 });
  controller = new AbortController(); reason = new DOMException('synthetic cancelled', 'AbortError');
  reply = 'url'; content = ERROR_XML; cancelVlm = false; vlmFailure = false; receipts = [];
  remote = { status: 200, mime: 'application/xml', length: 0, open: false };
  const provider = { id: 'synthetic-vector', baseUrl: BASE, apiKey: 'synthetic-key', type: 'vectorize', modelType: 'vectorize', isEnabled: true, selectedModels: ['offline-vector'], discoveredModels: [] };
  const vlm = { ...provider, id: 'synthetic-vlm', type: 'vlm', modelType: 'vlm', selectedModels: ['qwen-vl-offline'] };
  io.provider.mockImplementation(async (feature: string) => feature === 'vectorize' ? provider : feature === 'vlm' ? vlm : null);
  io.providers.mockResolvedValue([provider, vlm]);
  io.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  io.fetch.mockImplementation(async (input: string, init: RequestInit) => {
    if (init?.method !== 'POST' || !String(input).startsWith(BASE + '/')) throw new Error('Unexpected native fetch');
    if (String(input).endsWith('/chat/completions')) {
      if (cancelVlm) controller.abort(reason);
      return Response.json({ choices: [{ message: { content: vlmFailure ? 'No SVG available' : VLM_SVG } }] });
    }
    if (reply === 'http-error') return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
    if (reply === 'direct') return new Response(content, { headers: { 'content-type': 'image/svg+xml' } });
    if (reply === 'image-svg') return Response.json({ image: { svg: content } });
    if (reply === 'data-svg') return Response.json({ data: [{ svg: content }] });
    if (reply === 'svg') return Response.json({ svg: content });
    return Response.json({ data: [{ url: RESULT }] });
  });
  vi.stubGlobal('fetch', io.fetch);
  io.request.mockImplementation((_url: URL, _options: unknown, callback: (response: IncomingMessage) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: ReturnType<typeof vi.fn>; setTimeout: () => ClientRequest };
    let response: PassThrough;
    request.destroy = vi.fn((error?: Error) => { response?.destroy(); if (error) queueMicrotask(() => request.emit('error', error)); });
    request.setTimeout = () => request as unknown as ClientRequest;
    request.end = () => {
      const message = new PassThrough() as PassThrough & IncomingMessage;
      response = message; message.statusCode = remote.status;
      message.headers = { 'content-type': remote.mime, ...(remote.length ? { 'content-length': String(remote.length) } : {}), location: 'http://127.0.0.1/private' };
      receipts.push({ response, destroy: request.destroy, resume: vi.spyOn(response, 'resume') });
      callback(message);
      if (!remote.open && !response.destroyed) message.end(content);
    };
    return request;
  });
});
afterEach(() => {
  expect(io.db).not.toHaveBeenCalled();
  for (const receipt of receipts) receipt.response.destroy();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe('real pipeline to route normalization: XML validity', () => {
  it('does not label an error XML as final SVG success and instead uses an independent legitimate fallback', async () => {
    const response = await POST(new NextRequest('http://offline.invalid/api/design/vectorize', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageUrl: `data:image/png;base64,${PNG.toString('base64')}` }),
    }));
    const body = await response.json();
    console.info('FOLLOWUP_ROUTE_OBSERVATION', JSON.stringify({ status: response.status, success: body.success, engine: body.engine, svg: body.svg }));
    expect(response.status).toBe(200);
    expect(body.engine).toBe('vlm');
    expect(body.svg).not.toContain('<error>');
    expect(body.svg).toMatch(/^<svg\b/);
    expect(body.enginesTried).toEqual(['recraft', 'vectorize-api', 'vlm']);
  });
});

describe('header refusal releases the actual download transport', () => {
  it.each(['redirect', 'http-error', 'wrong-mime', 'declared-oversize', 'range-status'])(
    'destroys without draining after %s headers', async kind => {
      remote.open = true;
      if (kind === 'redirect') remote.status = 302;
      if (kind === 'http-error') remote.status = 503;
      if (kind === 'wrong-mime') remote.mime = 'text/html';
      if (kind === 'declared-oversize') remote.length = 25 * 1024 * 1024 + 1;
      const promise = kind === 'range-status'
        ? downloadPublicImage(RESULT, { allowedMimeTypes: ['application/xml'], rangeChunkBytes: 4, signal: controller.signal })
        : downloadVectorizeResultSvg(RESULT, controller.signal);
      await expect(promise).rejects.toThrow();
      expect(receipts).toHaveLength(1);
      expect(receipts[0].destroy).toHaveBeenCalledOnce();
      expect(receipts[0].response.destroyed).toBe(true);
      expect(receipts[0].resume).not.toHaveBeenCalled();
      controller.abort(reason);
      expect(receipts[0].destroy).toHaveBeenCalledOnce();
    },
  );

  it('preserves a successful bounded response without prematurely destroying it', async () => {
    content = SVG; remote.mime = 'image/svg+xml';
    expect(await downloadVectorizeResultSvg(RESULT)).toBe(SVG);
    expect(receipts[0].destroy).not.toHaveBeenCalled();
  });
});

describe('Recraft accepts only a real SVG document root', () => {
  it.each([
    ['url', ERROR_XML],
    ['direct', '<error><svg xmlns="http://www.w3.org/2000/svg"/></error>'],
    ['image-svg', '<!-- <svg/> --><error/>'],
    ['data-svg', '<svg><path></svg>'],
    ['svg', '<svg xmlns="urn:other"/>'],
    ['svg', '<x:svg/>'],
    ['svg', '<svg xmlns=""/>'],
    ['svg', '<svg/><error/>'],
  ] as const)('rejects %s invalid root/structure: %s', async (format, value) => {
    reply = format; content = value;
    expect(await recraftVectorize({ imageUrl: '/synthetic.png', imageBuffer: PNG })).toMatchObject({ success: false, engine: 'recraft' });
  });

  it.each([
    ['url', SVG],
    ['direct', '<?xml version="1.0"?><!-- header -->' + SVG],
    ['image-svg', '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'],
    ['data-svg', '<v:svg xmlns:v="http://www.w3.org/2000/svg"><v:path d="M0 0H1V1Z"/></v:svg>'],
    ['svg', SVG],
  ] as const)('preserves valid SVG from %s', async (format, value) => {
    reply = format; content = value;
    expect(await recraftVectorize({ imageUrl: '/synthetic.png', imageBuffer: PNG })).toMatchObject({ success: true, engine: 'recraft', svg: value });
    expect(io.fetch.mock.calls.every(([url, init]) => String(url).startsWith(BASE + '/') && init.method === 'POST')).toBe(true);
  });

  it('keeps ordinary provider failure fallback to an independent VLM SVG', async () => {
    reply = 'http-error';
    expect(await run()).toMatchObject({ success: true, engine: 'vlm', svg: VLM_SVG, enginesTried: ['recraft', 'vectorize-api', 'vlm'] });
  });

  it('keeps safe URL refusal fallback while releasing every rejected response', async () => {
    remote.status = 302; remote.open = true;
    expect(await run()).toMatchObject({ success: true, engine: 'vlm', svg: VLM_SVG });
    expect(receipts.length).toBeGreaterThan(0);
    for (const item of receipts) { expect(item.destroy).toHaveBeenCalledOnce(); expect(item.resume).not.toHaveBeenCalled(); }
  });
});

describe('pipeline cancellation after VLM await', () => {
  it('does not return success if the VLM completion callback cancels the caller', async () => {
    const pending = vectorizePipeline({ imageUrl: '/synthetic.png', imageBuffer: PNG,
      imageDataUrl: `data:image/png;base64,${PNG.toString('base64')}`, engine: 'vlm', signal: controller.signal,
      onProgress: (_engine, status) => { if (status.includes('成功')) controller.abort(reason); },
    });
    await expect(pending).rejects.toBe(reason);
  });

  it.each([false, true])('throws the caller reason after VLM returns (failure=%s), without success or another engine', async failure => {
    reply = 'http-error'; cancelVlm = true; vlmFailure = failure;
    const progress: string[] = [];
    const pending = vectorizePipeline({ imageUrl: '/synthetic.png', imageBuffer: PNG,
      imageDataUrl: `data:image/png;base64,${PNG.toString('base64')}`, signal: controller.signal,
      onProgress: (engine, status) => progress.push(`${engine}: ${status}`),
    });
    await expect(pending).rejects.toBe(reason);
    expect(controller.signal.aborted).toBe(true);
    expect(progress.some(item => item.includes('成功'))).toBe(false);
    expect(progress.some(item => item.startsWith('wasm-vtracer:') || item.startsWith('vtracer:'))).toBe(false);
  });

  it('does not start any provider if cancelled before pipeline entry', async () => {
    controller.abort(reason);
    await expect(run()).rejects.toBe(reason);
    expect(io.provider).not.toHaveBeenCalled(); expect(io.fetch).not.toHaveBeenCalled();
  });
});
