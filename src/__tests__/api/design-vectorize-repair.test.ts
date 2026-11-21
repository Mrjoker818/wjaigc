import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';

// Only authentication, billing, providers and network transport are replaced.
// The route, validator, safe media loader/downloader, filesystem and sharp run for real.
const mocks = vi.hoisted(() => ({
  session: vi.fn(), consume: vi.fn(), refund: vi.fn(), pipeline: vi.fn(),
  provider: vi.fn(), compatFetch: vi.fn(), fetch: vi.fn(), lookup: vi.fn(), request: vi.fn(),
  s3: vi.fn(), dataRoot: '',
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.session }));
vi.mock('@/lib/credits', () => ({ consumeCredits: mocks.consume, refundCredits: mocks.refund }));
vi.mock('@/lib/vectorize-pipeline', () => ({ vectorizePipeline: mocks.pipeline }));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForFeature: mocks.provider, normalizeApiBaseUrl: (value: string) => value,
}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: mocks.compatFetch }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => mocks.dataRoot }));
vi.mock('@/lib/s3-storage', () => ({ readManagedImageFromS3Bounded: mocks.s3 }));
vi.mock('@/lib/op-log', () => ({
  logOperation: vi.fn(), logError: vi.fn(), OP_ACTIONS: { IMAGE_VECTORIZE: 'vectorize' }, startTimer: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
vi.mock('node:http', () => ({ request: mocks.request }));

import { POST } from '@/app/api/design/vectorize/route';

const user: User = {
  id: 'vectorize-test-user', name: 'offline-test', role: 'user', status: 'active',
  createdAt: 1, updatedAt: 1,
  apiPermissions: {
    image: true, chat: true, threeD: true, imageEdit: true, vectorize: true,
    vlm: true, layer: true, video: true, upscaler: true, removebg: true, audio: true,
  },
};
const basicSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8"><rect width="12" height="8" fill="#ff0000"/></svg>';
let png: Buffer;
let dataPng: string;
let managedPath: string;
let remote: { statusCode: number; headers: IncomingMessage['headers']; body: Buffer };

async function submit(imageUrl = dataPng) {
  return POST(new NextRequest('http://localhost/api/design/vectorize', {
    method: 'POST', body: JSON.stringify({ imageUrl }), headers: { 'content-type': 'application/json' },
  }));
}

function expectNoPaidWork() {
  expect(mocks.consume).not.toHaveBeenCalled();
  expect(mocks.pipeline).not.toHaveBeenCalled();
  expect(mocks.provider).not.toHaveBeenCalled();
  expect(mocks.compatFetch).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.refund).not.toHaveBeenCalled();
}

beforeAll(async () => {
  const evidence = path.resolve('output/canvas-chat-audit/ci-20261121/vectorize-repair');
  await mkdir(evidence, { recursive: true });
  mocks.dataRoot = await mkdtemp(path.join(evidence, 'media-fixture-'));
  await mkdir(path.join(mocks.dataRoot, 'uploads'));
  png = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#ff0000' } }).png().toBuffer();
  dataPng = `data:image/png;base64,${png.toString('base64')}`;
  managedPath = '/api/serve-upload/source.png';
  await writeFile(path.join(mocks.dataRoot, 'uploads/source.png'), png);
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ['debug', 'warn', 'error'] as const) vi.spyOn(console, name).mockImplementation(() => {});
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('COZE_WORKSPACE_PATH', mocks.dataRoot);
  vi.stubEnv('COZE_PROJECT_ENV', '');
  vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
  vi.stubEnv('PY_VECTORIZE_ENDPOINT', '');
  mocks.session.mockResolvedValue(user);
  mocks.consume.mockResolvedValue({ success: true, cost: 7 });
  mocks.refund.mockResolvedValue({ success: true });
  mocks.pipeline.mockResolvedValue({ success: true, svg: basicSvg, engine: 'offline-pipeline', enginesTried: [] });
  mocks.provider.mockResolvedValue(null);
  mocks.s3.mockResolvedValue(null);
  mocks.compatFetch.mockImplementation(async () => new Response('{}', { status: 404 }));
  // Legacy fetch is also intercepted, so RED cannot touch the network.
  mocks.fetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    return new Response('{}', { status: 404 });
  });
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  remote = { statusCode: 200, headers: { 'content-type': 'image/png' }, body: png };
  mocks.request.mockImplementation((_url: URL, _options: unknown, callback: (res: IncomingMessage) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (e?: Error) => void; setTimeout: () => ClientRequest };
    request.destroy = error => { if (error) queueMicrotask(() => request.emit('error', error)); };
    request.setTimeout = () => request as unknown as ClientRequest;
    request.end = () => {
      const response = new PassThrough() as PassThrough & IncomingMessage;
      response.statusCode = remote.statusCode;
      response.headers = remote.headers;
      callback(response);
      if (!response.destroyed) response.end(remote.body);
    };
    return request;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('vectorize authentication before paid work or media reads', () => {
  it.each(['anonymous', 'auth-error', 'disabled', 'denied', 'admin-denied', 'missing-permission'])(
    'rejects %s without reading media, billing or invoking providers', async state => {
      if (state === 'anonymous') mocks.session.mockResolvedValue(null);
      else if (state === 'auth-error') mocks.session.mockRejectedValue(new Error('offline auth failure'));
      else if (state === 'disabled') mocks.session.mockResolvedValue({ ...user, status: 'disabled' });
      else if (state === 'missing-permission') mocks.session.mockResolvedValue({ ...user, apiPermissions: undefined });
      else mocks.session.mockResolvedValue({ ...user, role: state === 'admin-denied' ? 'admin' : 'user', apiPermissions: { ...user.apiPermissions, vectorize: false } });
      const response = await submit('https://input.example.test/source.png');
      expect(response.status).toBe(state === 'anonymous' || state === 'auth-error' ? 401 : 403);
      expectNoPaidWork();
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it('keeps insufficient-credit rejection ahead of providers', async () => {
    mocks.consume.mockResolvedValue({ success: false, message: 'insufficient', cost: 0 });
    expect((await submit()).status).toBe(402);
    expect(mocks.pipeline).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});

describe('vectorize bounded real media input', () => {
  it('keeps PNG bytes and MIME in the legacy fetch transport', async () => {
    const response = await mocks.fetch('https://input.example.test/source.png');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });
  it.each([
    '/api/vectorize-repair-canary', '/api/serve-upload/../source.png',
    '/api/serve-upload/%2e%2e/source.png', '/uploads/../source.png',
    '/api/serve-upload/users/source.png', '/api/serve-upload/missing.png',
    'data:image/png;base64,bm90LWFuLWltYWdl',
  ])('rejects unsafe or unreadable input %s before billing', async input => {
    expect((await submit(input)).status).toBe(400);
    expectNoPaidWork();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('rejects a magic-byte-only PNG instead of producing a 0x0 SVG', async () => {
    const response = await submit('data:image/png;base64,iVBORw0KGgo=');
    expect(response.status).toBe(400);
    expectNoPaidWork();
  });
  it.each(['private-dns', 'redirect', 'oversized-header', 'oversized-stream', 'wrong-mime', 'invalid-bytes'])(
    'rejects remote %s without entering paid work', async kind => {
      if (kind === 'private-dns') mocks.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      if (kind === 'redirect') remote = { statusCode: 302, headers: { location: 'http://127.0.0.1/private' }, body: Buffer.alloc(0) };
      if (kind === 'oversized-header') remote.headers['content-length'] = String(26 * 1024 * 1024);
      if (kind === 'oversized-stream') remote.body = Buffer.alloc(25 * 1024 * 1024 + 1);
      if (kind === 'wrong-mime') remote.headers['content-type'] = 'text/html';
      if (kind === 'invalid-bytes') remote.body = Buffer.from('not an image');
      expect((await submit('https://input.example.test/source.png')).status).toBe(400);
      expectNoPaidWork();
      expect(mocks.request).toHaveBeenCalledTimes(kind === 'private-dns' ? 0 : 1);
    },
  );
  it.each(['data-png', 'managed-upload', 'uploads-alias', 'public-url'])(
    'preserves authorized %s using validated bytes and positive dimensions', async kind => {
      const input = kind === 'data-png' ? dataPng : kind === 'managed-upload' ? managedPath
        : kind === 'uploads-alias' ? '/uploads/source.png' : 'https://input.example.test/source.png';
      const response = await submit(input);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      const dimensions = await sharp(Buffer.from(body.svg)).metadata();
      expect([dimensions.width, dimensions.height]).toEqual([12, 8]);
      expect(mocks.pipeline).toHaveBeenCalledWith(expect.objectContaining({ imageBuffer: png, imageDataUrl: dataPng, width: 12, height: 8 }));
      expect(mocks.consume).toHaveBeenCalledExactlyOnceWith(user.id, 'vectorize');
      expect(mocks.refund).not.toHaveBeenCalled();
    },
  );
});

describe('vectorize SVG root-only normalization', () => {
  it('preserves child geometry, nested SVG coordinate systems and data attributes', async () => {
    const nested = '<svg x="2" y="1" width="5" height="4" viewBox="10 20 50 40"><rect width="50" height="40"/></svg>';
    const image = `<image href="${dataPng}" width="3" height="2"/>`;
    mocks.pipeline.mockResolvedValue({ success: true, engine: 'offline-pipeline', svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height='80' viewBox="0 0 120 80" data-width="keep" data-height="keep" data-viewBox="keep" aria-label="width='keep' > height='keep'">${nested}${image}<rect width="120" height="80"/></svg>` });
    const body = await (await submit()).json();
    expect(body.svg).toContain(nested);
    expect(body.svg).toContain(image);
    expect(body.svg).toContain('data-width="keep" data-height="keep" data-viewBox="keep"');
    expect(body.svg).toContain('aria-label="width=\'keep\' > height=\'keep\'"');
    expect(body.svg).toContain('width="12" height="8" viewBox="0 0 120 80"');
    expect(body.svg).toContain('<rect width="120" height="80"/>');
  });
  it('does not borrow the viewBox from a nested SVG when the root has none', async () => {
    mocks.pipeline.mockResolvedValue({ success: true, engine: 'offline-pipeline', svg:
      '<svg xmlns="http://www.w3.org/2000/svg"><svg width="5" height="4" viewBox="10 20 50 40"><rect width="50" height="40"/></svg></svg>' });
    const body = await (await submit()).json();
    expect(body.svg).toMatch(/^<svg\b[^>]*viewBox="0 0 12 8"/);
    expect(body.svg).toContain('viewBox="10 20 50 40"');
  });
  it('does not infer the root viewBox from a child rectangle size', async () => {
    mocks.pipeline.mockResolvedValue({ success: true, engine: 'offline-pipeline', svg:
      '<svg><rect width="50" height="40"/></svg>' });
    const body = await (await submit()).json();
    expect(body.svg).toMatch(/^<svg\b[^>]*viewBox="0 0 12 8"/);
    expect(body.svg).toContain('<rect width="50" height="40"/>');
  });
  it('keeps child units, nested aspect ratio and data dimensions intact', async () => {
    const nested = '<svg width="5pt" height="4pt" preserveAspectRatio="xMinYMin meet"><rect width="50pt" height="40pt"/></svg>';
    mocks.pipeline.mockResolvedValue({ success: true, engine: 'offline-pipeline', svg:
      `<svg xmlns="http://www.w3.org/2000/svg" data-width="7pt" data-height="6pt">${nested}</svg>` });
    const body = await (await submit()).json();
    expect(body.svg).toContain(nested);
    expect(body.svg).toContain('data-width="7pt" data-height="6pt"');
  });
  it('adds a root namespace even if a nested SVG already declares one', async () => {
    mocks.pipeline.mockResolvedValue({ success: true, engine: 'offline-pipeline', svg:
      '<svg><svg xmlns="http://www.w3.org/2000/svg" width="5" height="4"><rect width="5" height="4"/></svg></svg>' });
    const body = await (await submit()).json();
    expect(body.svg).toMatch(/^<svg\b[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  });
  it.each(['0 0 0 0', '0 0 -5 8', 'NaN 0 12 8', 'bad'])(
    'replaces invalid root viewBox %s with real media dimensions', async viewBox => {
      mocks.pipeline.mockResolvedValue({ success: true, engine: 'offline-pipeline', svg: `<svg viewBox="${viewBox}"><rect width="12" height="8"/></svg>` });
      const body = await (await submit()).json();
      expect(body.svg).toMatch(/^<svg\b[^>]*viewBox="0 0 12 8"/);
    },
  );
  it('retains rendered child pixels after normalization', async () => {
    const body = await (await submit()).json();
    const { data, info } = await sharp(Buffer.from(body.svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([12, 8]);
    expect([...data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });
});

describe('vectorize supplier result URLs and refunds', () => {
  function useLegacySupplier(format: 'multipart' | 'openai', resultUrl: string) {
    mocks.pipeline.mockResolvedValue({ success: false });
    mocks.provider.mockImplementation(async feature => feature === 'vectorize' ? {
      baseUrl: 'http://127.0.0.1:9999/trusted-admin', apiKey: 'offline-key', selectedModels: ['offline-vector-model'],
    } : null);
    mocks.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') return format === 'multipart'
        ? Response.json({ data: [{ url: resultUrl }] }) : new Response('{}', { status: 404 });
      return new Response(basicSvg, { headers: { 'content-type': 'image/svg+xml' } });
    });
    mocks.compatFetch.mockImplementation(async (_base: string, endpoint: string) => endpoint === '/images/generations' && format === 'openai'
      ? Response.json({ data: [{ url: resultUrl }] }) : new Response('{}', { status: 404 }));
    remote = { statusCode: 200, headers: { 'content-type': 'image/svg+xml' }, body: Buffer.from(basicSvg) };
  }

  it.each(['multipart', 'openai'] as const)('blocks private %s result URL reads and keeps trusted configured POSTs', async format => {
    useLegacySupplier(format, 'https://result.example.test/output.svg');
    mocks.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const body = await (await submit()).json();
    expect(body.engine).toBe('raster-svg-wrapper');
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.filter(([, init]) => !init?.method || init.method === 'GET')).toHaveLength(0);
    expect(mocks.fetch.mock.calls.some(([url, init]) => String(url).startsWith('http://127.0.0.1:9999/trusted-admin') && init?.method === 'POST')).toBe(true);
  });
  it.each(['multipart', 'openai'] as const)('accepts bounded public %s result SVG reads', async format => {
    useLegacySupplier(format, 'https://result.example.test/output.svg');
    const body = await (await submit()).json();
    expect(body.engine).toBe(format === 'multipart' ? 'vectorize-api' : 'openai-vectorize');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(body.svg).toContain('<rect width="12" height="8"');
  });
  it('retains configured PY private endpoint support', async () => {
    mocks.pipeline.mockResolvedValue({ success: false });
    vi.stubEnv('PY_VECTORIZE_ENDPOINT', 'http://127.0.0.1:9999/trusted-vectorize');
    mocks.fetch.mockResolvedValue(Response.json({ svg: basicSvg }));
    const body = await (await submit()).json();
    expect(body.engine).toBe('py-vectorize');
    expect(mocks.fetch).toHaveBeenCalledWith('http://127.0.0.1:9999/trusted-vectorize', expect.objectContaining({ method: 'POST' }));
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it('refunds a post-debit fatal error once, using a unique reference per request', async () => {
    mocks.pipeline.mockResolvedValue({ success: false });
    mocks.provider.mockRejectedValue(new Error('offline provider lookup failed'));
    expect((await submit()).status).toBe(500);
    expect((await submit()).status).toBe(500);
    expect(mocks.consume).toHaveBeenCalledTimes(2);
    expect(mocks.refund).toHaveBeenCalledTimes(2);
    for (const args of mocks.refund.mock.calls) {
      expect(args[0]).toBe(user.id);
      expect(args[1]).toBe(7);
      expect(args[3]).toMatch(/^refund-vectorize-/);
    }
    expect(new Set(mocks.refund.mock.calls.map(args => args[3])).size).toBe(2);
  });
});
