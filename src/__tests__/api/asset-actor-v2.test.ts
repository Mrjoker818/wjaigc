import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  actor: '用户甲',
  signedIn: true,
  trashed: false,
  single: vi.fn(),
  batch: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  getSessionUser: async () => mocks.signedIn ? { id: mocks.actor } : null,
}));
vi.mock('@/lib/api-auth', () => ({
  getRequestUser: async () => mocks.signedIn ? { user: { id: mocks.actor } } : null,
}));
vi.mock('@/lib/asset-core/service', () => ({
  AssetServiceError: class AssetServiceError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  createAssetService: () => ({
    sendVersionToWorkspace: mocks.single,
    sendVersionsToWorkspace: mocks.batch,
    restorePlacement: mocks.restore,
  }),
}));

import { POST as transfer } from '@/app/api/assets/actor-v2/transfer/route';
import { POST as batchTransfer } from '@/app/api/assets/actor-v2/batch-transfer/route';
import { POST as restore } from '@/app/api/assets/actor-v2/[assetId]/restore/route';
import { POST as legacyTransfer } from '@/app/api/assets/transfer/route';
import { transferCanvasSkillAsset, transferCanvasSkillAssets } from '@/lib/skill-runtime/canvas-client';

const actor = '用户甲';
const collision = encodeURIComponent(actor);
const routeContext = { params: Promise.resolve({ assetId: 'asset-a' }) };
const transferInput = {
  sourceVersion: 'version-a', targetProject: 'project-a', targetWorkspace: 'canvas:project-a',
  entityType: 'canvas-image', entityId: 'entity-a', idempotencyKey: 'stable-key',
};
const reference = { assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a', url: '/synthetic.png' };
const cases = [
  { name: 'single', handle: (request: NextRequest) => transfer(request), body: transferInput },
  { name: 'batch', handle: (request: NextRequest) => batchTransfer(request), body: { transfers: [transferInput] } },
  { name: 'restore', handle: (request: NextRequest) => restore(request, routeContext), body: { projectId: 'project-a', placementId: 'placement-a', expectedPlacementRevision: '5' } },
];

function result() {
  return {
    version: { id: 'version-a', assetId: 'asset-a', file: { url: '/synthetic.png' }, metadata: {} },
    placement: { id: 'placement-a', entityId: 'entity-a', status: mocks.trashed ? 'trashed' : 'active',
      ...(mocks.trashed ? { lifecycleRevision: '5' } : {}), metadata: {} },
    reused: false,
  };
}

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://synthetic.invalid/api/assets/actor-v2/transfer', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.actor = actor;
  mocks.signedIn = true;
  mocks.trashed = false;
  mocks.single.mockReset().mockImplementation(async () => result());
  mocks.batch.mockReset().mockImplementation(async (inputs: unknown[]) => inputs.map(() => result()));
  mocks.restore.mockReset().mockResolvedValue({
    placement: { id: 'placement-a', assetId: 'asset-a', assetVersionId: 'version-a', status: 'active' },
  });
});

describe('versioned asset actor binding', () => {
  it.each(cases)('$name rejects missing, empty or mismatched body identity without service calls', async ({ handle, body }) => {
    mocks.actor = collision;
    const stripped = { 'x-wujie-expected-actor-id': collision };
    expect((await handle(request(body, stripped))).status).toBe(400);
    expect((await handle(request({ ...body, expectedActorId: '' }, stripped))).status).toBe(400);
    expect((await handle(request({ ...body, expectedActorId: actor }, stripped))).status).toBe(409);
    expect(mocks.single).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it.each(cases)('$name accepts its Chinese account without identity headers', async ({ handle, body }) => {
    expect((await handle(request({ ...body, expectedActorId: actor }))).status).toBe(200);
    const calls = [...mocks.single.mock.calls.map(args => args[0]),
      ...mocks.batch.mock.calls.flatMap(args => args[0]), ...mocks.restore.mock.calls.map(args => args[0])];
    expect(calls).toHaveLength(1);
    expect(calls[0].actorUserId).toBe(actor);
  });

  it.each(cases)('$name keeps the original authentication requirement', async ({ handle, body }) => {
    mocks.signedIn = false;
    expect((await handle(request({ ...body, expectedActorId: actor }))).status).toBe(401);
    expect(mocks.single).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it('preserves the legacy single-transfer digest and stable idempotency key', async () => {
    expect((await legacyTransfer(request(transferInput))).status).toBe(200);
    expect((await transfer(request({ ...transferInput, expectedActorId: actor }))).status).toBe(200);
    expect(mocks.single).toHaveBeenCalledTimes(2);
    expect(mocks.single.mock.calls[0][0].requestDigest).toBe(mocks.single.mock.calls[1][0].requestDigest);
    expect(mocks.single.mock.calls[1][0].idempotencyKey).toBe('stable-key');
  });

  it('connects the real client and all three routes without relying on identity headers', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      const headers = new Headers(init?.headers);
      headers.delete('x-wujie-expected-actor-id');
      headers.delete('x-wujie-expected-actor-id-encoding');
      const incoming = new NextRequest(`http://synthetic.invalid${url}`, { ...init, headers, signal: init?.signal ?? undefined });
      if (url === '/api/assets/actor-v2/transfer') return transfer(incoming);
      if (url === '/api/assets/actor-v2/batch-transfer') return batchTransfer(incoming);
      if (url === '/api/assets/actor-v2/asset-a/restore') return restore(incoming, routeContext);
      throw new Error(`Unexpected request: ${url}`);
    };
    const input = { reference, projectId: 'project-a', expectedActorId: actor, runId: 'run-a', sourceVersionIds: [], fetcher };
    await transferCanvasSkillAsset(input);
    await transferCanvasSkillAssets({ ...input, references: [reference] });
    mocks.trashed = true;
    await transferCanvasSkillAsset({ ...input, restoreDeletedPlacement: true });
    expect(calls).toEqual(['/api/assets/actor-v2/transfer', '/api/assets/actor-v2/batch-transfer',
      '/api/assets/actor-v2/transfer', '/api/assets/actor-v2/asset-a/restore']);
    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(mocks.restore.mock.calls[0][0]).toMatchObject({ actorUserId: actor, assetId: 'asset-a', expectedPlacementRevision: '5' });
  });

  it.each(['single', 'batch', 'restore'] as const)('%s does not retry an old endpoint after a 404', async mode => {
    const fetcher = vi.fn<typeof fetch>();
    if (mode === 'restore') {
      fetcher.mockResolvedValueOnce(Response.json({ ...reference, placementStatus: 'trashed', placementRevision: '5' }));
    }
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const input = { reference, projectId: 'project-a', expectedActorId: actor, runId: 'run-a', sourceVersionIds: [], fetcher };
    if (mode === 'batch') await expect(transferCanvasSkillAssets({ ...input, references: [reference] })).rejects.toThrow();
    else await expect(transferCanvasSkillAsset({ ...input, restoreDeletedPlacement: mode === 'restore' })).rejects.toThrow();
    const urls = fetcher.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(mode === 'restore' ? ['/api/assets/actor-v2/transfer', '/api/assets/actor-v2/asset-a/restore']
      : [mode === 'single' ? '/api/assets/actor-v2/transfer' : '/api/assets/actor-v2/batch-transfer']);
    for (const [, init] of fetcher.mock.calls) expect(JSON.parse(String(init?.body)).expectedActorId).toBe(actor);
  });
});

function oversizedStream(limit: number): { stream: ReadableStream<Uint8Array>; reads: () => number; cancelled: () => boolean } {
  const chunkSize = 64 * 1024;
  const chunk = new Uint8Array(chunkSize);
  let bytes = 0;
  let count = 0;
  let didCancel = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      count += 1;
      // End a broken implementation's extra read so a failing test cannot spin forever.
      if (bytes > limit) { controller.close(); return; }
      const size = Math.min(chunkSize, limit + 1 - bytes);
      bytes += size;
      controller.enqueue(chunk.subarray(0, size));
    },
    cancel() { didCancel = true; },
  }, { highWaterMark: 0 });
  return { stream, reads: () => count, cancelled: () => didCancel };
}

it.each([
  { name: 'single', handle: (r: NextRequest) => transfer(r), limit: 50 * 1024 * 1024 },
  { name: 'batch', handle: (r: NextRequest) => batchTransfer(r), limit: 256 * 1024 },
  { name: 'restore', handle: (r: NextRequest) => restore(r, routeContext), limit: 50 * 1024 * 1024 },
])('$name cancels an oversized stream despite a falsely small length', async ({ handle, limit }) => {
  const source = oversizedStream(limit);
  const incoming = new NextRequest('http://synthetic.invalid/api/assets/actor-v2/transfer', {
    method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1' },
    body: source.stream, duplex: 'half',
  } as ConstructorParameters<typeof NextRequest>[1] & { duplex: 'half' });
  expect((await handle(incoming)).status).toBe(413);
  expect(source.cancelled()).toBe(true);
  expect(source.reads()).toBe(Math.floor(limit / (64 * 1024)) + 1);
  expect(mocks.single).not.toHaveBeenCalled();
  expect(mocks.batch).not.toHaveBeenCalled();
  expect(mocks.restore).not.toHaveBeenCalled();
}, 15000);
it('returns 413 even when cancellation of an oversized batch source is delayed', async () => {
  let releaseCancel: (() => void) | undefined;
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); },
    cancel() {
      cancelled = true;
      return new Promise<void>(resolve => { releaseCancel = resolve; });
    },
  }, { highWaterMark: 0 });
  const incoming = new NextRequest('http://synthetic.invalid/api/assets/actor-v2/batch-transfer', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: source, duplex: 'half',
  } as ConstructorParameters<typeof NextRequest>[1] & { duplex: 'half' });
  const pending = batchTransfer(incoming);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([pending, new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), 1000); })]);
    expect(outcome).not.toBe('timeout');
    expect((outcome as Response).status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.batch).not.toHaveBeenCalled();
  } finally {
    if (timer) clearTimeout(timer);
    releaseCancel?.();
    await pending;
  }
});
