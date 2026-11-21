import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  configuredProvider, doubles, IMAGE, request, requestBody, resetOfflineRoute, SECOND_IMAGE,
} from '../fixtures/image-to-3d-offline';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadSafeImageInput } from '@/lib/safe-image-input';

const io = vi.hoisted(() => ({
  lookup: vi.fn(), request: vi.fn(), realpath: vi.fn(), stat: vi.fn(), readFile: vi.fn(),
  response: { status: 200, mime: 'image/png', location: '', length: 0, bytes: Buffer.alloc(0) },
}));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));
vi.mock('node:http', async original => ({ ...await original<typeof import('node:http')>(), request: io.request }));
vi.mock('node:https', async original => ({ ...await original<typeof import('node:https')>(), request: io.request }));
vi.mock('node:fs/promises', async original => ({
  ...await original<typeof import('node:fs/promises')>(),
  realpath: io.realpath, stat: io.stat, readFile: io.readFile,
}));

import { POST } from '@/app/api/image-to-3d/route';

function expectNoAdmission(): void {
  expect(doubles.calculateConfiguredCreditCost).not.toHaveBeenCalled();
  expect(doubles.consumeCredits).not.toHaveBeenCalled();
  expect(doubles.createBillableTask).not.toHaveBeenCalled();
  expect(doubles.recordThreeDTaskSubmitted).not.toHaveBeenCalled();
  expect(doubles.updateCloudTask).not.toHaveBeenCalled();
  expect(doubles.completeCloudTask).not.toHaveBeenCalled();
  expect(doubles.settleFailedTask).not.toHaveBeenCalled();
  expect(doubles.refundCredits).not.toHaveBeenCalled();
  expect(doubles.fetch).not.toHaveBeenCalled();
}

function useHunyuan(): void {
  doubles.providers = [configuredProvider({
    name: 'Hunyuan3D', displayName: 'Hunyuan3D', providerPreset: 'hunyuan3d', selectedModels: ['hunyuan3d-pro'],
  })];
  doubles.user!.imageModels = ['provider-a::hunyuan3d-pro'];
}

function multiImageBody(auxiliary: string): Record<string, unknown> {
  return requestBody({
    mode: 'multi-image', provider: { model: 'hunyuan3d-pro' },
    images: [{ url: IMAGE, view: 'front' }, { url: auxiliary, view: 'back' }],
  });
}

function configureWorker(): void {
  vi.stubEnv('WUJIE_3D_LOCAL_WORKER_URL', 'http://127.0.0.1:7860/trusted-3d');
  vi.stubEnv('WUJIE_3D_LOCAL_WORKER_MODEL', 'trusted-local-model');
}

function localBody(local: Record<string, unknown> = {}): Record<string, unknown> {
  return requestBody({ backend: 'local', providerId: undefined, provider: undefined, local });
}

beforeEach(() => {
  resetOfflineRoute();
  vi.stubEnv('COZE_PROJECT_ENV', '');
  vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
  io.response = { status: 200, mime: 'image/png', location: '', length: 0, bytes: Buffer.from(IMAGE.split(',')[1], 'base64') };
  io.lookup.mockImplementation(async (host: string) => [{ address: host === '127.0.0.1' ? host : '8.8.8.8', family: 4 }]);
  io.realpath.mockRejectedValue(new Error('Unexpected filesystem access'));
  io.stat.mockRejectedValue(new Error('Unexpected filesystem access'));
  io.readFile.mockRejectedValue(new Error('Unexpected filesystem access'));
  io.request.mockImplementation((_url: URL, _options: unknown, callback: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void; destroy: (error?: Error) => void;
      setTimeout: () => ClientRequest;
    };
    req.destroy = error => { if (error) queueMicrotask(() => req.emit('error', error)); };
    req.setTimeout = () => req as unknown as ClientRequest;
    req.end = () => {
      const response = new PassThrough() as PassThrough & IncomingMessage;
      response.statusCode = io.response.status;
      response.headers = { 'content-type': io.response.mime, location: io.response.location, 'content-length': String(io.response.length) };
      callback(response);
      response.end(io.response.bytes);
    };
    return req as unknown as ClientRequest;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('P2 actual pixel decode before admission', () => {
  it.each([
    { admission: 'legacy', target: 'main' }, { admission: 'core-v2', target: 'main' },
    { admission: 'legacy', target: 'auxiliary' }, { admission: 'core-v2', target: 'auxiliary' },
  ])('rejects damaged PNG pixels with readable metadata: $admission / $target', async ({ admission, target }) => {
    vi.stubEnv('WUJIE_TASK_CORE_MODE', admission);
    const bytes = Buffer.from(IMAGE.split(',')[1], 'base64');
    const pixelStream = bytes.indexOf(Buffer.from('IDAT')) + 4;
    bytes.fill(0, pixelStream, pixelStream + 8);
    const damaged = 'data:image/png;base64,' + bytes.toString('base64');
    // The existing real safe loader accepts the metadata; full pixel decode fails.
    expect((await loadSafeImageInput(damaged)).mimeType).toBe('image/png');
    await expect(sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).raw().toBuffer()).rejects.toThrow();
    const response = await POST(request(requestBody(target === 'main'
      ? { imageUrl: damaged }
      : { mode: 'multi-image', images: [{ url: IMAGE, view: 'front' }, { url: damaged, view: 'back' }] })));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: 'UNSAFE_IMAGE_INPUT' });
    expectNoAdmission();
    expect(io.request).not.toHaveBeenCalled();
  });
});

describe('P2 pixel decode normal neighbors', () => {
  it.each(['jpeg', 'webp'] as const)('keeps valid %s source bytes unchanged for the supplier', async format => {
    const bytes = await sharp(Buffer.from(IMAGE.split(',')[1], 'base64')).toFormat(format).toBuffer();
    const source = `data:image/${format};base64,${bytes.toString('base64')}`;
    const response = await POST(request(requestBody({ imageUrl: source })));
    expect(response.status).toBe(200);
    expect(doubles.consumeCredits).toHaveBeenCalledOnce();
    expect(doubles.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(doubles.fetch.mock.calls[0][1].body).image_url).toBe(source);
  });

  it('does not admit a canceled image request', async () => {
    const controller = new AbortController();
    const pendingRequest = new NextRequest(request(requestBody()), { signal: controller.signal });
    controller.abort(new Error('P2_SYNTHETIC_CANCEL'));
    const response = await POST(pendingRequest);
    expect(response.status).toBe(400);
    expectNoAdmission();
  });
});

describe('known three media/local endpoint findings now reject before admission', () => {
  it.each(['legacy', 'core-v2'])('evidence 1: rejects an auxiliary loopback URL (%s)', async admission => {
    vi.stubEnv('WUJIE_TASK_CORE_MODE', admission);
    useHunyuan();
    const input = 'http://127.0.0.1:8123/synthetic-private.png';
    doubles.fetch.mockImplementation(async (url: string) => url === input
      ? new Response('SYNTHETIC_LOOPBACK_BYTES_NOT_AN_IMAGE')
      : Response.json({ Response: { JobId: 'synthetic-task' } }));
    const response = await POST(request(multiImageBody(input)));
    expect(response.status).toBe(400);
    expectNoAdmission();
    expect(io.request).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'core-v2'])('evidence 2: rejects auxiliary path traversal without reading a private file (%s)', async admission => {
    vi.stubEnv('WUJIE_TASK_CORE_MODE', admission);
    useHunyuan();
    const workspace = path.resolve('/synthetic-workspace');
    const escapedPath = path.join(workspace, 'system', 'synthetic-private.png');
    vi.stubEnv('COZE_WORKSPACE_PATH', workspace);
    vi.spyOn(fs, 'existsSync').mockImplementation(candidate => String(candidate) === escapedPath);
    const read = vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('SYNTHETIC_OUTSIDE_PUBLIC_BYTES'));
    const response = await POST(request(multiImageBody('/uploads/../../system/synthetic-private.png')));
    expect(response.status).toBe(400);
    expectNoAdmission();
    expect(read).not.toHaveBeenCalled();
    expect(io.realpath).not.toHaveBeenCalled();
    expect(io.request).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'core-v2'])('evidence 3: rejects a caller local endpoint without server configuration (%s)', async admission => {
    vi.stubEnv('WUJIE_TASK_CORE_MODE', admission);
    doubles.providers = [];
    doubles.user!.imageModels = [];
    const response = await POST(request(localBody({ endpoint: 'http://127.0.0.1:7860/synthetic-3d', model: 'synthetic-local-model' })));
    expect(response.status).toBe(403);
    expectNoAdmission();
    expect(io.lookup).not.toHaveBeenCalled();
  });
});

describe('same safe image boundary for every supplied input', () => {
  it.each([
    { imageUrl: 'http://127.0.0.1:8123/synthetic.png' },
    { imageUrl: '/uploads/../../system/synthetic.png' },
    { images: [{ url: 'file:///synthetic-private.png' }] },
    { images: [{ url: '/api/admin/synthetic-private.png' }] },
    { images: [{ url: 'blob:synthetic' }] },
    { images: [{ url: 123 }] },
    { images: [null] },
    { images: 'not-an-array' },
    { images: Array.from({ length: 9 }, () => ({ url: IMAGE })) },
  ])('rejects unsafe or malformed media %j', async media => {
    const response = await POST(request(requestBody(media)));
    expect(response.status).toBe(400);
    expectNoAdmission();
    expect(io.request).not.toHaveBeenCalled();
  });

  it.each([
    'data:text/plain;base64,c2VjcmV0',
    IMAGE.replace('image/png', 'image/jpeg'),
    'data:image/png;base64,iVBORw0KGgo=',
  ])('rejects undecodable or mismatched data URL before billing: %s', async imageUrl => {
    const response = await POST(request(requestBody({ imageUrl })));
    expect(response.status).toBe(400);
    expectNoAdmission();
  });

  it('loads a public image through the real safe downloader and sends only validated bytes to the supplier', async () => {
    const response = await POST(request(requestBody({ imageUrl: 'https://cdn.invalid/synthetic.png' })));
    expect(response.status).toBe(200);
    expect(io.request).toHaveBeenCalledOnce();
    const [url, options] = io.request.mock.calls[0];
    expect(url.href).toBe('https://cdn.invalid/synthetic.png');
    const resolve = vi.fn();
    options.lookup('cdn.invalid', {}, resolve);
    expect(resolve).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(doubles.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(doubles.fetch.mock.calls[0][1].body).image_url).toBe(IMAGE);
  });

  it.each([
    { status: 302, location: 'http://127.0.0.1/private.png' },
    { mime: 'text/plain' },
    { mime: 'image/png', bytes: Buffer.from('SYNTHETIC_NOT_A_PNG') },
    { length: 26 * 1024 * 1024 },
  ])('fails closed on a bad remote image response %j', async remote => {
    Object.assign(io.response, remote);
    const response = await POST(request(requestBody({ imageUrl: 'https://cdn.invalid/synthetic.png' })));
    expect(response.status).toBe(400);
    expectNoAdmission();
    expect(io.request).toHaveBeenCalledOnce();
    expect(io.lookup).toHaveBeenCalledOnce();
  });

  it('reads an allowed managed image with real path/size/decode checks and no raw fetch fallback', async () => {
    const root = path.resolve(process.cwd(), 'public', 'uploads');
    const filename = path.join(root, 'synthetic.png');
    io.realpath.mockImplementation(async (candidate: string) => candidate);
    io.stat.mockResolvedValue({ isFile: () => true, size: io.response.bytes.length });
    io.readFile.mockResolvedValue(io.response.bytes);
    const response = await POST(request(requestBody({ imageUrl: '/uploads/synthetic.png' })));
    expect(response.status).toBe(200);
    expect(io.readFile).toHaveBeenCalledWith(filename, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(doubles.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(doubles.fetch.mock.calls[0][1].body).image_url).toBe(IMAGE);
  });

  it('rejects a managed symlink escape before any file read or billable task', async () => {
    io.realpath.mockImplementation(async (candidate: string) => candidate.endsWith('synthetic.png') ? path.resolve('/outside/synthetic.png') : candidate);
    const response = await POST(request(requestBody({ imageUrl: '/uploads/synthetic.png' })));
    expect(response.status).toBe(400);
    expectNoAdmission();
    expect(io.readFile).not.toHaveBeenCalled();
  });

  it('validates an extra image even when text-to-3d would ignore it', async () => {
    const response = await POST(request(requestBody({ mode: 'text-to-3d', imageUrl: '', prompt: 'Synthetic', images: [{ url: '/uploads/../../system/private.png' }] })));
    expect(response.status).toBe(400);
    expectNoAdmission();
  });

  it('enforces the shared byte budget across multiple otherwise valid public images', async () => {
    io.response.bytes = Buffer.concat([io.response.bytes, Buffer.alloc(9 * 1024 * 1024)]);
    io.response.length = io.response.bytes.length;
    const response = await POST(request(requestBody({
      mode: 'multi-image', images: ['a', 'b', 'c'].map(name => ({ url: `https://cdn.invalid/${name}.png` })),
    })));
    expect(response.status).toBe(400);
    expectNoAdmission();
    expect(io.request).toHaveBeenCalledTimes(3);
  });

  it('rejects excessive pixel dimensions without creating a charge or task', async () => {
    const bmp = Buffer.alloc(58);
    bmp.write('BM'); bmp.writeUInt32LE(58, 2); bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(10000, 18); bmp.writeInt32LE(10000, 22);
    bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
    const response = await POST(request(requestBody({ imageUrl: `data:image/bmp;base64,${bmp.toString('base64')}` })));
    expect(response.status).toBe(400);
    expectNoAdmission();
  });

  it('uses the first safe view as the main image when multi-image has no separate main URL', async () => {
    useHunyuan();
    const response = await POST(request({ ...multiImageBody(SECOND_IMAGE), imageUrl: '' }));
    expect(response.status).toBe(200);
    const payload = JSON.parse(doubles.fetch.mock.calls[0][1].body);
    expect(payload.ImageBase64).toBe(IMAGE.split(',')[1]);
    expect(payload.MultiViewImages).toEqual([{ ViewType: 'back', ViewImageBase64: SECOND_IMAGE.split(',')[1] }]);
  });
});

describe('affected 302.ai Tripo upload adapter', () => {
  it.each(['single-image', 'multi-image'])('uploads only validated bytes for %s', async mode => {
    doubles.providers = [configuredProvider({
      name: 'Tripo', displayName: 'Tripo', providerPreset: 'tripo', baseUrl: 'https://api.302.ai', selectedModels: ['tripo-v2'],
    })];
    doubles.user!.imageModels = ['provider-a::tripo-v2'];
    doubles.fetch.mockImplementation(async (url: string) => url.endsWith('/upload')
      ? Response.json({ code: 0, data: { image_token: 'synthetic-file-token' } })
      : Response.json({ code: 0, data: { task_id: 'synthetic-tripo-task' } }));
    const response = await POST(request(requestBody({
      mode, provider: { model: 'tripo-v2' },
      images: mode === 'multi-image' ? [{ url: IMAGE, view: 'front' }, { url: SECOND_IMAGE, view: 'back' }] : undefined,
    })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, taskId: 'synthetic-tripo-task' });
    const uploads = doubles.fetch.mock.calls.filter(([url]) => url.endsWith('/upload'));
    expect(uploads.length).toBe(mode === 'multi-image' ? 2 : 1);
    for (const [index, [url, init]] of uploads.entries()) {
      expect(url).toBe('https://api.302.ai/tripo3d/v2/openapi/upload');
      expect(init.redirect).toBe('error');
      const file = init.body.get('file') as File;
      expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from((index === 0 ? IMAGE : SECOND_IMAGE).split(',')[1], 'base64'));
    }
    expect(io.request).not.toHaveBeenCalled();
  });
});

describe('server-configured local worker is an explicit admin capability', () => {
  it.each([
    { endpoint: 'http://127.0.0.1:7860/other-3d' },
    { endpoint: 'http://127.0.0.1:9999/trusted-3d' },
    { endpoint: 'http://127.0.0.1:7860/trusted-3d?url=http://169.254.169.254/' },
    { model: 'another-local-model' },
  ])('rejects request-side worker overrides %j', async local => {
    configureWorker();
    doubles.user!.role = 'admin';
    const response = await POST(request(localBody(local)));
    expect(response.status).toBe(403);
    expectNoAdmission();
  });

  it('rejects an ordinary caller even when the server worker is configured', async () => {
    configureWorker();
    const response = await POST(request(localBody({ endpoint: 'http://127.0.0.1:7860/trusted-3d', model: 'trusted-local-model' })));
    expect(response.status).toBe(403);
    expectNoAdmission();
  });

  it.each(['file:///worker', 'http://user:password@127.0.0.1/worker', 'http://127.0.0.1/worker?target=other', 'http://127.0.0.1/worker#other'])(
    'rejects an invalid server worker configuration: %s', async endpoint => {
      configureWorker();
      doubles.user!.role = 'admin';
      vi.stubEnv('WUJIE_3D_LOCAL_WORKER_URL', endpoint);
      const response = await POST(request(localBody()));
      expect(response.status).toBe(403);
      expectNoAdmission();
    },
  );

  it.each(['legacy', 'core-v2'])('keeps the configured worker success path for admin (%s), without redirects', async admission => {
    vi.stubEnv('WUJIE_TASK_CORE_MODE', admission);
    configureWorker();
    doubles.user!.role = 'admin';
    doubles.providers = [];
    const response = await POST(request(localBody()));
    expect(response.status).toBe(200);
    expect(doubles.fetch).toHaveBeenCalledWith('http://127.0.0.1:7860/trusted-3d', expect.objectContaining({ redirect: 'error' }));
    expect(JSON.parse(doubles.fetch.mock.calls[0][1].body)).toMatchObject({ image_url: IMAGE, model: 'trusted-local-model' });
    if (admission === 'core-v2') {
      expect(doubles.createBillableTask).toHaveBeenCalledWith(expect.objectContaining({ task: expect.objectContaining({ providerId: 'local-3d-worker', model: 'trusted-local-model' }) }));
    } else expect(doubles.consumeCredits).toHaveBeenCalledOnce();
  });
});
