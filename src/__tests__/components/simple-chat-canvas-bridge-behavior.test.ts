import { describe, expect, it, vi } from 'vitest';

import * as simpleChatTypes from '@/components/simple-chat/simple-chat-types';

type AssetReference = {
  url: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
};

type ConsumeBridge = (input: {
  payload: unknown;
  currentProjectId: string | null;
  resolveReference: (input: {
    projectId: string;
    assetVersionId: string;
    placementId: string;
  }) => Promise<AssetReference>;
  merge: (references: AssetReference[]) => boolean | void | Promise<boolean | void>;
  remove: () => void;
}) => Promise<{ status: 'waiting' | 'consumed'; references: AssetReference[] }>;

type ResolveBridgeReference = (
  input: { projectId: string; assetVersionId: string; placementId: string },
  fetcher?: typeof fetch,
) => Promise<AssetReference>;

function consumeBridge(): ConsumeBridge | undefined {
  return (simpleChatTypes as unknown as { consumeSimpleChatCanvasBridge?: ConsumeBridge })
    .consumeSimpleChatCanvasBridge;
}

function resolveBridgeReference(): ResolveBridgeReference | undefined {
  return (simpleChatTypes as unknown as {
    resolveSimpleChatCanvasReference?: ResolveBridgeReference;
  }).resolveSimpleChatCanvasReference;
}

function managedPayload(): Record<string, unknown> {
  return {
    projectId: 'canvas-a',
    images: [{
      url: '/client-controlled.png',
      assetVersionId: 'owned-version',
      placementId: 'owned-placement',
    }],
  };
}

describe('standalone chat Canvas bridge behavior', () => {
  it.each([
    ['permission denied', 403, { success: false }, []],
    ['wrong version', 200, { success: true, placementId: 'doc-placement', assetVersionId: 'wrong', documentSequence: 7 }, []],
    ['missing media readback', 200, { success: true, placementId: 'doc-placement', assetVersionId: 'owned-version', documentSequence: 7 }, []],
  ])('keeps pending bridge data after document %s', async (_label, status, reply, images) => {
    let bridgePresent = true;
    await expect(simpleChatTypes.consumeSimpleChatCanvasBridge({
      payload: managedPayload(), currentProjectId: 'canvas-a',
      resolveReference: async () => ({ url: '/canonical.png', assetVersionId: 'owned-version', placementId: 'owned-placement' }),
      merge: async references => {
        await simpleChatTypes.attachSimpleChatCanvasDocumentReference({
          projectId: 'canvas-a', reference: references[0], index: 0,
          isCurrent: () => true, refreshMedia: async () => images,
        }, async () => new Response(JSON.stringify(reply), { status }));
      },
      remove: () => { bridgePresent = false; },
    })).rejects.toThrow();
    expect(bridgePresent).toBe(true);
  });

  it('does not refresh another project after an in-flight document attach completes', async () => {
    let current = true;
    let refreshed = false;
    await expect(simpleChatTypes.attachSimpleChatCanvasDocumentReference({
      projectId: 'canvas-a', index: 0,
      reference: { url: '/canonical.png', assetVersionId: 'owned-version', placementId: 'source-placement' },
      isCurrent: () => current,
      refreshMedia: async () => { refreshed = true; return []; },
    }, async () => {
      current = false;
      return new Response(JSON.stringify({ success: true, placementId: 'doc-placement', assetVersionId: 'owned-version', documentSequence: 7 }));
    })).rejects.toThrow('BRIDGE_CONSUMPTION_CANCELLED');
    expect(refreshed).toBe(false);
  });

  it('replays an unchanged document attach with the same key and transform', async () => {
    const requests: string[] = [];
    const input = {
      projectId: 'canvas-a', index: 0, isCurrent: () => true,
      reference: { url: '/canonical.png', assetVersionId: 'owned-version', placementId: 'source-placement' },
      refreshMedia: async () => [{ placementId: 'doc-placement', assetVersionId: 'owned-version' }],
    };
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push(String(init?.body));
      return new Response(JSON.stringify({ success: true, placementId: 'doc-placement', assetVersionId: 'owned-version', documentSequence: 7 }));
    };
    await simpleChatTypes.attachSimpleChatCanvasDocumentReference(input, fetcher);
    await simpleChatTypes.attachSimpleChatCanvasDocumentReference(input, fetcher);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
    expect(JSON.parse(requests[0]).idempotencyKey).toMatch(/^chat-bridge:[a-f0-9]{64}$/);
  });

  it('attaches the same version through the document command and requires authoritative readback', async () => {
    const attach = (simpleChatTypes as unknown as { attachSimpleChatCanvasDocumentReference?: (
      input: { projectId: string; reference: AssetReference; index: number;
        isCurrent: () => boolean; refreshMedia: (input: { projectId: string; documentSequence: number }) => Promise<Array<{ placementId?: string; assetVersionId?: string }>> },
      fetcher?: typeof fetch,
    ) => Promise<void> }).attachSimpleChatCanvasDocumentReference;
    expect(attach).toBeTypeOf('function');
    if (!attach) return;
    let request: Record<string, unknown> | undefined;
    let readback = false;
    await attach({
      projectId: 'canvas-a', index: 0, isCurrent: () => true,
      reference: { url: '/canonical.png', assetVersionId: 'owned-version', placementId: 'source-placement' },
      refreshMedia: async input => {
        expect(input).toEqual({ projectId: 'canvas-a', documentSequence: 7 });
        readback = true;
        return [{ placementId: 'document-placement', assetVersionId: 'owned-version' }];
      },
    }, async (url, init) => {
      expect(url).toBe('/api/collaboration/document-assets');
      request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ success: true, placementId: 'document-placement', assetVersionId: 'owned-version', documentSequence: 7 }));
    });
    expect(request).toMatchObject({ projectId: 'canvas-a', command: { action: 'attach', assetVersionId: 'owned-version' } });
    expect(readback).toBe(true);
  });

  it('retains the bridge when the canvas authority rejects a resolved merge', async () => {
    const consume = consumeBridge()!;
    let bridgePresent = true;
    const result = await consume({
      payload: managedPayload(), currentProjectId: 'canvas-a',
      resolveReference: async () => ({ url: '/canonical.png', assetVersionId: 'owned-version', placementId: 'owned-placement' }),
      merge: () => false,
      remove: () => { bridgePresent = false; },
    });
    expect(bridgePresent).toBe(true);
    expect(result.status).toBe('waiting');
  });

  it('I5 waits for matching project hydration and preserves old project images during merge', async () => {
    const consume = consumeBridge();
    expect(consume).toBeTypeOf('function');
    if (!consume) return;
    const resolveReference = vi.fn();
    const merge = vi.fn();
    const remove = vi.fn();
    const payload = { projectId: 'canvas-a', images: ['/legacy.png'] };

    await expect(consume({
      payload,
      currentProjectId: null,
      resolveReference,
      merge,
      remove,
    })).resolves.toEqual({ status: 'waiting', references: [] });
    await expect(consume({
      payload,
      currentProjectId: 'canvas-b',
      resolveReference,
      merge,
      remove,
    })).resolves.toEqual({ status: 'waiting', references: [] });
    expect(merge).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    const oldImages = [{ url: '/old-project-image.png' }];
    let merged = oldImages;
    const matched = await consume({
      payload,
      currentProjectId: 'canvas-a',
      resolveReference,
      merge: references => { merged = [...merged, ...references]; },
      remove,
    });

    expect(matched).toEqual({ status: 'consumed', references: [] });
    expect(merged).toEqual([{ url: '/old-project-image.png' }]);
    expect(resolveReference).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('I5 deletes localStorage only after a successful merge', async () => {
    const consume = consumeBridge();
    expect(consume).toBeTypeOf('function');
    if (!consume) return;
    const remove = vi.fn();

    await expect(consume({
      payload: { projectId: 'canvas-a', images: ['/legacy.png'] },
      currentProjectId: 'canvas-a',
      resolveReference: vi.fn(),
      merge: () => { throw new Error('merge failed'); },
      remove,
    })).rejects.toThrow('merge failed');
    expect(remove).not.toHaveBeenCalled();
  });

  it('I6 re-resolves managed references for the hydrated target and drops foreign or partial identity', async () => {
    const consume = consumeBridge();
    expect(consume).toBeTypeOf('function');
    if (!consume) return;
    const resolveReference = vi.fn(async (input: {
      projectId: string;
      assetVersionId: string;
      placementId: string;
    }) => {
      if (input.assetVersionId === 'foreign-version') {
        throw Object.assign(new Error('ASSET_NOT_FOUND'), {
          code: 'ASSET_NOT_FOUND',
          status: 404,
        });
      }
      return {
        url: '/canonical.png',
        assetId: 'canonical-asset',
        assetVersionId: input.assetVersionId,
        placementId: input.placementId,
      };
    });
    const merge = vi.fn();

    const result = await consume({
      payload: {
        projectId: 'canvas-a',
        images: [
          { url: '/client-controlled.png', assetVersionId: 'owned-version', placementId: 'owned-placement' },
          { url: '/foreign-secret.png', assetVersionId: 'foreign-version', placementId: 'foreign-placement' },
          { url: '/partial-secret.png', assetVersionId: 'partial-version' },
        ],
      },
      currentProjectId: 'canvas-a',
      resolveReference,
      merge,
      remove: vi.fn(),
    });

    expect(resolveReference).toHaveBeenCalledWith({
      projectId: 'canvas-a',
      assetVersionId: 'owned-version',
      placementId: 'owned-placement',
    });
    expect(result.references).toEqual([{
      url: '/canonical.png',
      assetId: 'canonical-asset',
      assetVersionId: 'owned-version',
      placementId: 'owned-placement',
    }]);
    expect(JSON.stringify(result.references)).not.toContain('foreign-secret');
    expect(JSON.stringify(result.references)).not.toContain('partial-secret');
  });

  it('consumes an ID-only bridge by resolving its canonical reference', async () => {
    const consume = consumeBridge();
    expect(consume).toBeTypeOf('function');
    if (!consume) return;
    const resolveReference = vi.fn().mockResolvedValue({
      url: '/canonical.png',
      assetVersionId: 'owned-version',
      placementId: 'owned-placement',
      entityId: 'entity-1',
    });
    const merge = vi.fn();

    const result = await consume({
      payload: {
        projectId: 'canvas-a',
        images: [{
          assetVersionId: 'owned-version',
          placementId: 'owned-placement',
          entityId: 'entity-1',
        }],
      },
      currentProjectId: 'canvas-a',
      resolveReference,
      merge,
      remove: vi.fn(),
    });

    expect(resolveReference).toHaveBeenCalledWith({
      projectId: 'canvas-a',
      assetVersionId: 'owned-version',
      placementId: 'owned-placement',
    });
    expect(result.references).toEqual([expect.objectContaining({ url: '/canonical.png' })]);
    expect(merge).toHaveBeenCalledWith(result.references);
  });

  it.each([
    ['/legacy-array.png'],
    ['https://example.invalid/tracker.png'],
    ['data:image/png;base64,AAAA'],
    ['blob:https://example.test/legacy-image'],
  ])('I6 drops URL-only legacy media without resolving or merging %s', async legacyUrl => {
    const consume = consumeBridge();
    expect(consume).toBeTypeOf('function');
    if (!consume) return;
    const resolveReference = vi.fn();
    const merge = vi.fn();

    const result = await consume({
      payload: [legacyUrl],
      currentProjectId: 'canvas-a',
      resolveReference,
      merge,
      remove: vi.fn(),
    });

    expect(result.references).toEqual([]);
    expect(resolveReference).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalledWith([]);
  });

  it.each([
    ['503', Object.assign(new Error('ASSET_RESOLVE_FAILED'), { status: 503 })],
    ['network error', new TypeError('fetch failed')],
  ])('I1 preserves the entire bridge when structured resolution has a %s', async (_label, failure) => {
    const consume = consumeBridge();
    expect(consume).toBeTypeOf('function');
    if (!consume) return;
    const merge = vi.fn();
    const remove = vi.fn();

    await expect(consume({
      payload: managedPayload(),
      currentProjectId: 'canvas-a',
      resolveReference: vi.fn().mockRejectedValue(failure),
      merge,
      remove,
    })).rejects.toBe(failure);
    expect(merge).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('I1 preserves the entire bridge when structured resolution returns malformed 200 data', async () => {
    const consume = consumeBridge();
    expect(consume).toBeTypeOf('function');
    if (!consume) return;
    const merge = vi.fn();
    const remove = vi.fn();

    await expect(consume({
      payload: managedPayload(),
      currentProjectId: 'canvas-a',
      resolveReference: vi.fn().mockResolvedValue({
        url: '/canonical.png',
        assetVersionId: 'owned-version',
      }),
      merge,
      remove,
    })).rejects.toThrow('ASSET_REFERENCE_INVALID');
    expect(merge).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('I1 maps only an explicit 404 ASSET_NOT_FOUND response to a droppable bridge error', async () => {
    const resolve = resolveBridgeReference();
    expect(resolve).toBeTypeOf('function');
    if (!resolve) return;
    const input = {
      projectId: 'canvas-a',
      assetVersionId: 'absent-version',
      placementId: 'absent-placement',
    };

    await expect(resolve(input, vi.fn(async () => new Response(
      JSON.stringify({ error: 'ASSET_NOT_FOUND' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )))).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND', status: 404 });

    await expect(resolve(input, vi.fn(async () => new Response(
      JSON.stringify({ error: 'UPSTREAM_UNAVAILABLE' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )))).rejects.toMatchObject({ status: 503 });

    await expect(resolve(input, vi.fn(async () => new Response(
      JSON.stringify({ url: '/incomplete.png', assetVersionId: 'absent-version' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))).rejects.toThrow('ASSET_REFERENCE_INVALID');
  });
});
