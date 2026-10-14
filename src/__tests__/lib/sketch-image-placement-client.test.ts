import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { SketchImageClient, type SketchImageTask } from '@/lib/sketch-to-code/image-client';
import { SketchImagePlacement } from '@/lib/sketch-to-code/image-placement-client';
import type { SketchScope } from '@/lib/sketch-to-code/client';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';

function scope(): SketchScope { return { actorId: 'actor', projectId: 'project', key: 'key', authority: 'legacy', assertCurrent: (): void => {} }; }
function task(): SketchImageTask {
  return { taskId: 'task', projectId: 'project', visionProviderId: 'vision', visionModelId: 'same', imageProviderId: 'image', imageModelId: 'same',
    status: 'completed', progress: 100, reserveCredits: 5, actualCredits: 3,
    pricing: { version: 1, vision: { providerId: 'vision', modelId: 'same', calls: 1, mode: 'flat', reserveCredits: 2 }, image: { providerId: 'image', modelId: 'same', calls: 1, credits: 3 }, totalReserveCredits: 5 },
    previewAssetId: 'input', previewAssetVersionId: 'input-version', imageAssetId: 'output', imageAssetVersionId: 'output-version',
    previewUrl: '/api/serve-upload/input.png', imageUrl: '/api/serve-upload/output.png',
    analysis: { summary: 'summary', composition: 'composition', prompt: 'prompt', negativePrompt: '' } };
}
interface Call { url: string; init: RequestInit }
interface Fixture { calls: Call[]; inserted: WorkspaceAssetReference[]; placement: SketchImagePlacement; current: SketchScope }
const placements: SketchImagePlacement[] = [];
function fixture(change?: (value: Record<string, unknown>, call: Call, index: number) => unknown, current = scope()): Fixture {
  const calls: Call[] = [], inserted: WorkspaceAssetReference[] = []; let transfer: Record<string, unknown> | undefined;
  const fetcher: typeof fetch = async (url, init): Promise<Response> => {
    const call = { url: String(url), init: init ?? {} }; calls.push(call);
    let value: Record<string, unknown>;
    if (call.url === '/api/poll-task') value = { success: true, type: 'sketch-to-image', ...task() };
    else if (call.url === '/api/assets/transfer') {
      const body = JSON.parse(String(call.init.body)) as Record<string, unknown>; transfer = body;
      value = { assetId: 'output', assetVersionId: 'output-version', entityId: body.entityId, placementId: 'placement', placementStatus: 'active', url: task().imageUrl, reused: false };
    } else value = { assetId: 'output', assetVersionId: 'output-version', kind: 'image', url: task().imageUrl,
      ...(call.url.includes('placementId=') ? { placementId: 'placement', entityId: transfer?.entityId } : {}) };
    const patched = change ? change(value, call, calls.length - 1) : value;
    return new Response(JSON.stringify(patched), { headers: { 'content-type': 'application/json' } });
  };
  const placement = new SketchImagePlacement(task(), current, async (reference): Promise<void> => { inserted.push(reference); }, fetcher);
  placements.push(placement); return { calls, inserted, placement, current };
}
afterEach((): void => { placements.forEach(value => value.stop()); placements.length = 0; });

describe('Task9 generated-image legacy placement', (): void => {
  it('rechecks protected task then GET/transfer/readback of output only', async (): Promise<void> => {
    const f = fixture(); await f.placement.add();
    expect(f.calls.map(call => call.url)).toEqual(['/api/poll-task', '/api/assets?projectId=project&assetVersionId=output-version', '/api/assets/transfer', '/api/assets?projectId=project&assetVersionId=output-version&placementId=placement']);
    const body = JSON.parse(String(f.calls[2].init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ sourceVersion: 'output-version', targetProject: 'project', targetWorkspace: 'canvas:project', entityType: 'canvas-image', entityId: f.placement.entityId });
    expect(body.entityId).not.toBe('input'); expect(f.inserted).toHaveLength(1);
    expect(f.inserted[0]).toMatchObject({ assetId: 'output', assetVersionId: 'output-version', placementId: 'placement', entityId: f.placement.entityId });
    expect(f.calls.every(call => call.init.credentials === 'same-origin' && call.init.cache === 'no-store' && call.init.redirect === 'error')).toBe(true);
  });
  it('simultaneous add coalesces and later add does not duplicate insertion', async (): Promise<void> => {
    const f = fixture(); await Promise.all([f.placement.add(), f.placement.add()]); await f.placement.add();
    expect(f.inserted).toHaveLength(1); expect(f.calls.filter(call => call.url === '/api/assets/transfer')).toHaveLength(1);
  });
  it.each(['needsReconcile', 'dispatchPending', 'recoveryPending'] as const)('fresh completed %s blocks asset reads, transfer and insertion', async flag => {
    const f = fixture((value, call) => call.url === '/api/poll-task' ? { ...value, [flag]: true } : value);
    await expect(f.placement.add()).rejects.toThrow();
    expect(f.calls.map(call => call.url)).toEqual(['/api/poll-task']); expect(f.inserted).toHaveLength(0);
  });
  it.each(['needsReconcile', 'dispatchPending', 'recoveryPending'] as const)('initial completed %s cannot place before original reconciliation', async flag => {
    let calls = 0, inserted = 0;
    const fetcher: typeof fetch = async (): Promise<Response> => { calls++; return new Response(JSON.stringify({ success: true, type: 'sketch-to-image', ...task() }), { headers: { 'content-type': 'application/json' } }); };
    const placement = new SketchImagePlacement({ ...task(), [flag]: true }, scope(), async (): Promise<void> => { inserted++; }, fetcher);
    placements.push(placement); await expect(placement.add()).rejects.toThrow(); expect(calls).toBe(0); expect(inserted).toBe(0);
  });
  it('unknown transfer retries unchanged entity/nonce/transform, not insert', async (): Promise<void> => {
    let lost = false;
    const f = fixture((value, call) => { if (call.url === '/api/assets/transfer' && !lost) { lost = true; throw new Error('unknown commit'); } return value; });
    await expect(f.placement.add()).rejects.toThrow(); expect(f.inserted).toHaveLength(0);
    await f.placement.add(); const submissions = f.calls.filter(call => call.url === '/api/assets/transfer');
    expect(submissions).toHaveLength(2); expect(submissions[0].init.body).toBe(submissions[1].init.body); expect(f.inserted).toHaveLength(1);
  });
  it.each(['document', 'unknown'] as const)('does not enable %s placement', async (authority): Promise<void> => {
    const current = scope(); current.authority = authority; const f = fixture(undefined, current);
    await expect(f.placement.add()).rejects.toThrow(); expect(f.calls).toHaveLength(0); expect(f.inserted).toHaveLength(0);
  });
  it.each([
    ['poll', { imageAssetVersionId: 'input-version' }], ['poll', { imageProviderId: 'other' }], ['poll', { actualCredits: 99 }],
    ['poll', { imageUrl: '/api/serve-upload/new.png' }], ['asset', { assetVersionId: 'input-version' }], ['asset', { kind: 'document' }],
    ['asset', { url: '/private/output.png' }], ['transfer', { placementStatus: 'trashed' }], ['transfer', { reused: undefined }],
    ['transfer', { entityId: 'input' }], ['transfer', { assetVersionId: 'input-version' }], ['readback', { placementId: 'other' }],
    ['readback', { entityId: 'input' }], ['readback', { url: '/api/serve-upload/other.png' }], ['readback', { kind: 'document' }],
  ])('blocks conflicting %s receipt %# before insert', async (stage, patch): Promise<void> => {
    const f = fixture((value, call) => {
      const actual = call.url === '/api/poll-task' ? 'poll' : call.url === '/api/assets/transfer' ? 'transfer' : call.url.includes('placementId=') ? 'readback' : 'asset';
      return actual === stage ? { ...value, ...(patch as object) } : value;
    });
    await expect(f.placement.add()).rejects.toThrow(); expect(f.inserted).toHaveLength(0);
  });
  it('project invalidation after accepted transfer prevents readback/insertion', async (): Promise<void> => {
    const current = scope(), f = fixture((value, call) => { if (call.url === '/api/assets/transfer') current.projectId = 'other'; return value; }, current);
    await expect(f.placement.add()).rejects.toThrow(); expect(f.inserted).toHaveLength(0); expect(f.calls).toHaveLength(3);
  });
  it('stop while reading rejects late transfer without losing original placement intent', async (): Promise<void> => {
    let resolve!: (value: Response) => void; let calls = 0;
    const fetcher: typeof fetch = async (): Promise<Response> => { calls++; if (calls === 1) return new Promise<Response>(done => { resolve = done; }); throw new Error('unexpected'); };
    let inserted = 0; const placement = new SketchImagePlacement(task(), scope(), async (): Promise<void> => { inserted++; }, fetcher); placements.push(placement);
    const pending = placement.add(), rejected = expect(pending).rejects.toThrow(); placement.stop();
    if (resolve) resolve(new Response(JSON.stringify({ success: true, type: 'sketch-to-image', ...task() }), { headers: { 'content-type': 'application/json' } }));
    await rejected; expect(inserted).toBe(0); expect(calls).toBe(1);
  });
  it('client-validated completed result supports the placement constructor without new backend ports', async (): Promise<void> => {
    const fetcher: typeof fetch = async (): Promise<Response> => new Response(JSON.stringify({ success: true, type: 'sketch-to-image', ...task() }), { headers: { 'content-type': 'application/json' } });
    const c = new SketchImageClient(scope(), fetcher); try { const completed = await c.poll('task'); expect(new SketchImagePlacement(completed, scope(), async (): Promise<void> => {}, fetcher).entityId).not.toBe(completed.previewAssetId); }
    finally { c.stop(); }
  });
  it('native loopback HTTP exercises GET/transfer/readback without a business database', async (): Promise<void> => {
    const seen: string[] = []; let entityId = '';
    const server = createServer((request, response): void => {
      seen.push(`${request.method} ${request.url}`); response.setHeader('content-type', 'application/json');
      if (request.url === '/api/poll-task') { response.end(JSON.stringify({ success: true, type: 'sketch-to-image', ...task() })); return; }
      if (request.url === '/api/assets/transfer') {
        const chunks: Buffer[] = []; request.on('data', (chunk: Buffer): void => { chunks.push(chunk); });
        request.on('end', (): void => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; entityId = String(body.entityId);
          response.end(JSON.stringify({ assetId: 'output', assetVersionId: 'output-version', placementId: 'placement', entityId, url: task().imageUrl, reused: false, placementStatus: 'active' }));
        }); return;
      }
      response.end(JSON.stringify({ assetId: 'output', assetVersionId: 'output-version', kind: 'image', url: task().imageUrl,
        ...(request.url?.includes('placementId=') ? { placementId: 'placement', entityId } : {}) }));
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address();
    if (!address || typeof address === 'string') throw new Error('local fixture address');
    const fetcher: typeof fetch = (url, init): Promise<Response> => fetch(`http://127.0.0.1:${address.port}${String(url)}`, init);
    let inserted = 0; const placement = new SketchImagePlacement(task(), scope(), async (): Promise<void> => { inserted++; }, fetcher); placements.push(placement);
    try { await placement.add(); expect(inserted).toBe(1); expect(seen.map(value => value.split(' ')[0])).toEqual(['POST', 'GET', 'POST', 'GET']); }
    finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
  });
});
