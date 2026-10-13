import { describe, expect, it, vi } from 'vitest';
import { SketchPlacement } from '@/lib/sketch-to-code/placement-client';
import type { SketchScope, SketchTask } from '@/lib/sketch-to-code/client';
import { hydrateAssetV3Projects, type AssetV3CanvasPlacement } from '@/lib/asset-core/canvas-project-sync';
import type { Project } from '@/lib/user-types';

const task: SketchTask = { taskId: 't1', projectId: 'p1', providerId: 'provider-1', modelId: 'model-1', status: 'completed', progress: 100, reserveCredits: 20, actualCredits: 12, previewAssetId: 'a1', htmlAssetId: 'a2', previewAssetVersionId: 'v1', htmlAssetVersionId: 'v2' };
const scope = (authority: SketchScope['authority'] = 'legacy'): SketchScope => ({ actorId: 'u1', projectId: 'p1', key: 'scope1', authority, assertCurrent: vi.fn() });
const json = (value: unknown): Response => new Response(JSON.stringify(value));
const reference = { kind: 'image', url: '/sketch.png', assetId: 'a1', assetVersionId: 'v1' };

describe('sketch personal result placement', () => {
  it('replays one frozen transfer after ACK loss, coalesces double click and restores PNG/source trace through the original refresh hydrator', async () => {
    const insert = vi.fn(async () => {});
    let body: Record<string, unknown>;
    let posts = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url) === '/api/assets/transfer') {
        posts++; body = JSON.parse(String(init?.body));
        if (posts === 1) throw new Error('lost ACK');
        return json({ ...reference, entityId: body.entityId, placementId: 'pl1', placementStatus: 'active', reused: true, sourceTrace: (body.metadata as Record<string, unknown>).sourceTrace });
      }
      if (String(url).includes('placementId=')) return json({ ...reference, entityId: body!.entityId, placementId: 'pl1', sourceTrace: (body!.metadata as Record<string, unknown>).sourceTrace });
      return json(reference);
    });
    const placement = new SketchPlacement(task, scope(), insert, fetcher);
    await expect(placement.add()).rejects.toThrow('lost ACK');
    await Promise.all([placement.add(), placement.add()]);
    const bodies = fetcher.mock.calls.filter(call => call[0] === '/api/assets/transfer').map(call => JSON.parse(String(call[1]?.body)));
    expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
    expect(insert).toHaveBeenCalledTimes(1);
    const [placed, transform] = insert.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, number>];
    const project = { id: 'p1', canvasImages: [], schemaVersion: 3 } as unknown as Project;
    const graph = { assetId: 'a1', assetVersionId: 'v1', placementId: 'pl1', entityId: String(placed.entityId), fileUrl: '/sketch.png', kind: 'image', availability: 'ready', transform, metadata: { sourceTrace: placed.sourceTrace } } as AssetV3CanvasPlacement;
    const restored = hydrateAssetV3Projects([project], { p1: [graph] })[0].canvasImages[0];
    expect(restored).toMatchObject({ url: '/sketch.png', assetVersionId: 'v1', placementId: 'pl1', sourceTrace: { source: 'sketch-to-code', taskId: 't1', previewAssetVersionId: 'v1', htmlAssetVersionId: 'v2' } });
    expect(JSON.stringify(restored)).not.toContain('<html');
  });
  it.each(['document', 'unknown'] as const)('disables %s placement before all network or legacy writes', async authority => {
    const fetcher = vi.fn<typeof fetch>(); const insert = vi.fn(async () => {});
    await expect(new SketchPlacement(task, scope(authority), insert, fetcher).add()).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it('rejects cross-project results and a mismatched receipt, without inserting', async () => {
    const insert = vi.fn(async () => {}); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...reference, assetVersionId: 'other' }));
    await expect(new SketchPlacement(task, scope(), insert, fetcher).add()).rejects.toThrow();
    await expect(new SketchPlacement({ ...task, projectId: 'other' }, scope(), insert, fetcher).add()).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });
  it.each(['fetch', 'json', 'refresh', 'insertion'] as const)('fences actor/project/epoch/authority after the real %s await boundary', async stage => {
    for (const field of ['actor', 'project', 'epoch', 'authority'] as const) {
      const current = { actor: 'u1', project: 'p1', epoch: 1, authority: 'legacy' };
      const frozen = JSON.stringify(current); const context = scope(); context.assertCurrent = (): void => { if (JSON.stringify(current) !== frozen) throw new Error('scope changed'); };
      let release!: () => void; const entered = new Promise<void>(resolve => {
        release = (): void => { resolve(); };
      });
      let arrive!: () => void; const arrived = new Promise<void>(resolve => { arrive = resolve; });
      let transfer: Record<string, unknown> | undefined; let commits = 0;
      const insert = vi.fn(async () => { if (stage === 'insertion') { arrive(); await entered; } context.assertCurrent(); commits++; });
      const fetcher = vi.fn<typeof fetch>(async (url, init) => {
        if (String(url) === '/api/assets/transfer') { transfer = JSON.parse(String(init?.body)); return json({ ...reference, placementId: 'pl1', placementStatus: 'active', entityId: transfer!.entityId, sourceTrace: (transfer!.metadata as Record<string, unknown>).sourceTrace, reused: false }); }
        const readback = String(url).includes('placementId=');
        const value = readback ? { ...reference, placementId: 'pl1', entityId: transfer!.entityId, sourceTrace: (transfer!.metadata as Record<string, unknown>).sourceTrace } : reference;
        if (stage === 'fetch' && !readback || stage === 'refresh' && readback) { arrive(); await entered; }
        if (stage === 'json' && !readback) return { ok: true, json: async () => { arrive(); await entered; return value; } } as Response;
        return json(value);
      });
      const placement = new SketchPlacement(task, context, insert, fetcher); const pending = placement.add();
      await arrived;
      if (field === 'epoch') current.epoch++; else current[field] = 'changed';
      release(); await expect(pending).rejects.toThrow('scope changed'); expect(commits).toBe(0);
      if (stage === 'fetch' || stage === 'json') expect(transfer).toBeUndefined();
    }
  });
  it.each(['assetId', 'assetVersionId', 'entityId', 'placementId', 'placementStatus', 'sourceTrace', 'reused'] as const)('rejects incomplete or mismatched %s from transfer ACK', async field => {
    const insert = vi.fn(async () => {});
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url) !== '/api/assets/transfer') return json(reference);
      const body = JSON.parse(String(init?.body)); const value = { ...reference, entityId: body.entityId, placementId: 'pl1', placementStatus: 'active', reused: false, sourceTrace: body.metadata.sourceTrace };
      delete value[field]; return json(value);
    });
    await expect(new SketchPlacement(task, scope(), insert, fetcher).add()).rejects.toThrow(); expect(insert).not.toHaveBeenCalled();
  });
});
