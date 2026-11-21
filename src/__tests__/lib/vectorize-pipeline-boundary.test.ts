import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, IncomingHttpHeaders } from 'node:http';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scope inherited DB bindings before imports and module-level guard snapshots.
await vi.hoisted(async () => {
  const { afterAll } = await import('vitest');
  const { scopeOfflineDatabaseEnvironment } = await import('../helpers/isolated-child-database-env');
  const restore = scopeOfflineDatabaseEnvironment(process.env);
  try {
    afterAll(restore);
  } catch (error) {
    restore();
    throw error;
  }
});

// Keep the pipeline, adapters, API helper, URL policy and safe downloader real.
// Only configuration storage and the lowest DNS/HTTP/fetch transports are synthetic.
vi.mock('server-only', () => ({}));
const io = vi.hoisted(() => ({ provider: vi.fn(), providers: vi.fn(), lookup: vi.fn(), request: vi.fn(), db: vi.fn() }));
vi.mock('@/lib/server-api-config', () => ({ findProviderForFeature: io.provider, getApiProviders: io.providers, findProviderById: vi.fn() }));
vi.mock('@/lib/db-client', () => ({ getPool: io.db, execSql: io.db, isDatabaseConfigured: () => false }));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));
vi.mock('node:http', () => ({ request: io.request }));
vi.mock('node:https', () => ({ request: io.request }));

import { vectorizePipeline } from '@/lib/vectorize-pipeline';
import { recraftVectorize } from '@/lib/vectorize-recraft';

const DB_KEYS = Object.keys(process.env).filter(key =>
  /^(PG|DATABASE|POSTGRES|TEST_POSTGRES|COZE_SUPABASE)|^WUJIE_.*DB|^WUJIE_AUTH_PERSISTENCE_MODE$/.test(key));
const BASE = 'http://127.0.0.1:9999/admin-configured';
const RESULT = 'https://public-result.invalid/output.svg';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8"><path d="M0 0H12V8H0Z" fill="#e11d48"/></svg>';
const FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8"><rect width="12" height="8" fill="#14b8a6"/><!-- independent legitimate VLM fallback, not the rejected result URL content --></svg>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const MAX_BYTES = 25 * 1024 * 1024;
type Engine = 'recraft' | 'vectorize-api';
let resultUrl: string;
let remote: { status: number; headers: IncomingHttpHeaders; body: Buffer };
let posts: string[];
let rawReads: string[];
let pinnedReads: string[];
let requestHeaders: Record<string, string>[];
let controller: AbortController;
let cancellation: DOMException;
let cancelAt: 'none' | 'provider' | 'dns' | 'stream';
let fallback: boolean;
let reply: 'result' | 'inline' | 'endpoint-fallback' | 'provider-error';

function abort(): void { controller.abort(cancellation); }
function run(engine?: Engine) {
  return vectorizePipeline({ imageUrl: '/api/serve-upload/synthetic.png', imageBuffer: PNG,
    imageDataUrl: `data:image/png;base64,${PNG.toString('base64')}`, engine, ...{ signal: controller.signal } });
}

beforeEach(() => {
  vi.clearAllMocks();
  expect(DB_KEYS, 'offline launcher must clear inherited database bindings').toEqual([]);
  for (const method of ['log', 'debug', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  vi.stubEnv('COZE_PROJECT_ENV', ''); vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
  resultUrl = RESULT; remote = { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: Buffer.from(SVG) };
  posts = []; rawReads = []; pinnedReads = []; requestHeaders = [];
  controller = new AbortController(); cancellation = new DOMException('synthetic caller cancelled', 'AbortError');
  cancelAt = 'none'; fallback = false; reply = 'result';
  io.db.mockImplementation(() => { throw Error('DATABASE ACCESS FORBIDDEN'); });
  const provider = { id: 'synthetic-vector', baseUrl: BASE, apiKey: 'synthetic-not-a-key', type: 'vectorize', modelType: 'vectorize',
    isEnabled: true, selectedModels: ['offline-vector'], discoveredModels: [] };
  const vlm = { ...provider, id: 'synthetic-vlm', type: 'vlm', selectedModels: ['qwen-vl-offline'] };
  io.provider.mockImplementation(async (feature: string) => feature === 'vectorize' ? provider : fallback && feature === 'vlm' ? vlm : null);
  io.providers.mockImplementation(async () => fallback ? [provider, vlm] : [provider]);
  io.lookup.mockImplementation(async (host: string) => {
    if (cancelAt === 'dns') { abort(); return new Promise(() => {}); }
    return [{ address: host === '127.0.0.1' || host === 'private-result.invalid' ? '127.0.0.1' : '8.8.8.8', family: 4 }];
  });
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (init?.method === 'POST') {
      // Admin-configured private endpoints remain usable; request.imageUrl is not an endpoint.
      expect(url.startsWith(BASE + '/')).toBe(true);
      posts.push(url);
      if (cancelAt === 'provider') abort();
      if (url.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: FALLBACK_SVG } }] });
      if (reply === 'provider-error') return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
      if (reply === 'endpoint-fallback' && /\/(?:recraft\/v1\/images|vectorizer\/api\/v1)\/vectorize$/.test(url)) {
        return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
      }
      return Response.json(reply === 'inline' || reply === 'endpoint-fallback' ? { svg: SVG } : { data: [{ url: resultUrl }] });
    }
    // RED intercepts the old unsafe native fetch. Simulate native redirect following, without sockets.
    rawReads.push(url);
    if (cancelAt === 'dns' || cancelAt === 'stream') abort();
    if (remote.status >= 300 && remote.status < 400) {
      rawReads.push(String(remote.headers.location));
      return new Response(new Uint8Array(remote.body), { headers: { 'content-type': 'image/svg+xml' } });
    }
    return new Response(new Uint8Array(remote.body), { status: remote.status,
      headers: { 'content-type': String(remote.headers['content-type'] || ''),
        ...(remote.headers['content-length'] ? { 'content-length': String(remote.headers['content-length']) } : {}) } });
  }));
  io.request.mockImplementation((url: URL, options: {
    headers: Record<string, string>;
    lookup: (host: string, options: { all?: boolean }, callback: (error: Error | null, address: unknown, family?: number) => void) => void;
  }, callback: (response: IncomingMessage) => void) => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void; destroy: (error?: Error) => void; setTimeout: () => ClientRequest;
    };
    let response: PassThrough | undefined;
    options.lookup(url.hostname, {}, (error, address, family) => {
      expect(error).toBeNull(); expect(address).toBe('8.8.8.8'); expect(family).toBe(4);
    });
    pinnedReads.push(url.href); requestHeaders.push(options.headers);
    request.setTimeout = () => request as unknown as ClientRequest;
    request.destroy = error => { response?.destroy(); if (error) queueMicrotask(() => request.emit('error', error)); };
    request.end = () => {
      const message = new PassThrough() as PassThrough & IncomingMessage;
      response = message; message.statusCode = remote.status; message.headers = remote.headers;
      callback(message);
      if (cancelAt === 'stream') { queueMicrotask(abort); return; }
      if (!message.destroyed) message.end(remote.body);
    };
    return request;
  });
});

afterEach(context => {
  expect(io.db).not.toHaveBeenCalled();
  const receipt = { test: context.task.name, posts: posts.length, unsafeNativeReads: rawReads,
    pinnedReads, dnsLookups: io.lookup.mock.calls.length, cancelled: controller.signal.aborted };
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  if (process.env.VECTORIZE_BOUNDARY_EVIDENCE === '1') console.info('VECTORIZE_BOUNDARY_EVIDENCE', JSON.stringify(receipt));
});

describe.each(['recraft', 'vectorize-api'] as const)('%s real default-pipeline result URL boundary', engine => {
  it.each(['image/svg+xml', 'application/xml', 'text/xml'])('accepts bounded public %s SVG via pinned transport', async mime => {
    remote.headers['content-type'] = mime;
    const result = await run(engine);
    expect(result).toMatchObject({ success: true, engine, svg: SVG });
    expect(pinnedReads).toEqual([RESULT]); expect(rawReads).toEqual([]);
    expect(io.lookup).toHaveBeenCalledExactlyOnceWith('public-result.invalid', { all: true, verbatim: true });
    expect(requestHeaders[0].Authorization).toBeUndefined();
  });

  it.each(['private-literal', 'private-dns', 'redirect-private', 'redirect-public', 'wrong-mime', 'declared-large', 'stream-large', 'empty', 'credentials', 'file-protocol'])(
    'rejects %s without returning untrusted bytes or using native URL reads', async kind => {
      if (kind === 'private-literal') resultUrl = 'http://127.0.0.1:9/private.svg';
      if (kind === 'private-dns') resultUrl = 'https://private-result.invalid/output.svg';
      if (kind.startsWith('redirect-')) { remote.status = 302; remote.headers.location = kind === 'redirect-private' ? 'http://127.0.0.1/private.svg' : 'https://second-public.invalid/output.svg'; }
      if (kind === 'wrong-mime') remote.headers['content-type'] = 'text/html';
      if (kind === 'declared-large') remote.headers['content-length'] = String(MAX_BYTES + 1);
      if (kind === 'stream-large') remote.body = Buffer.concat([Buffer.from(SVG), Buffer.alloc(MAX_BYTES)]);
      if (kind === 'empty') remote.body = Buffer.alloc(0);
      if (kind === 'credentials') resultUrl = 'https://user:synthetic-password@public-result.invalid/output.svg';
      if (kind === 'file-protocol') resultUrl = 'file:///synthetic-private.svg';
      const result = await run(engine);
      expect(result.success).toBe(false); expect(result.svg).toBeUndefined(); expect(rawReads).toEqual([]);
      if (['private-literal', 'private-dns', 'credentials', 'file-protocol'].includes(kind)) expect(pinnedReads).toEqual([]);
      if (kind.startsWith('redirect-')) expect(pinnedReads.every(url => url === RESULT)).toBe(true);
      expect(posts.every(url => url.startsWith(BASE + '/'))).toBe(true);
    },
  );

  it('retains administrator private POST endpoints and inline SVG replies', async () => {
    reply = 'inline';
    expect(await run(engine)).toMatchObject({ success: true, engine, svg: SVG });
    expect(posts.length).toBe(1); expect(rawReads).toEqual([]); expect(pinnedReads).toEqual([]);
  });

  it('retains the original configured endpoint fallback after provider HTTP failure', async () => {
    reply = 'endpoint-fallback';
    expect(await run(engine)).toMatchObject({ success: true, engine, svg: SVG });
    expect(posts.length).toBeGreaterThan(1); expect(rawReads).toEqual([]);
  });

  it.each(['before', 'provider', 'dns', 'stream'] as const)('stops without further endpoint/engine attempts on %s cancellation', async stage => {
    if (stage === 'before') abort(); else cancelAt = stage;
    const outcome = run(engine);
    await expect(outcome).rejects.toBe(cancellation);
    expect(rawReads).toEqual([]);
    expect(posts.length).toBe(stage === 'before' ? 0 : 1);
    expect(pinnedReads.length).toBe(stage === 'stream' ? 1 : 0);
  });
});

describe('real fallback and direct Recraft cancellation', () => {
  it.each(['private-result', 'redirect', 'provider-error'])('keeps the original legitimate VLM fallback for %s', async failure => {
    fallback = true;
    if (failure === 'private-result') resultUrl = 'https://private-result.invalid/output.svg';
    if (failure === 'redirect') { remote.status = 302; remote.headers.location = 'http://127.0.0.1/private.svg'; }
    if (failure === 'provider-error') reply = 'provider-error';
    const result = await run();
    expect(result).toMatchObject({ success: true, engine: 'vlm', svg: FALLBACK_SVG,
      enginesTried: ['recraft', 'vectorize-api', 'vlm'] });
    expect(rawReads).toEqual([]); expect(posts.some(url => url.endsWith('/chat/completions'))).toBe(true);
  });

  it('does not reach another engine when cancelled during the first result download', async () => {
    fallback = true; cancelAt = 'stream';
    await expect(run()).rejects.toBe(cancellation);
    expect(posts.length).toBe(1); expect(posts.some(url => url.endsWith('/chat/completions'))).toBe(false);
  });

  it('honors direct Recraft caller cancellation before provider lookup or transport', async () => {
    abort();
    await expect(recraftVectorize({ imageUrl: '/api/serve-upload/synthetic.png', imageBuffer: PNG,
      ...{ signal: controller.signal } })).rejects.toBe(cancellation);
    expect(io.provider).not.toHaveBeenCalled(); expect(posts).toEqual([]); expect(rawReads).toEqual([]);
  });
});
