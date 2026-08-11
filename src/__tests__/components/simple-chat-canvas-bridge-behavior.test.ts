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
  merge: (references: AssetReference[]) => void | Promise<void>;
  remove: () => void;
}) => Promise<{ status: 'waiting' | 'consumed'; references: AssetReference[] }>;

function consumeBridge(): ConsumeBridge | undefined {
  return (simpleChatTypes as unknown as { consumeSimpleChatCanvasBridge?: ConsumeBridge })
    .consumeSimpleChatCanvasBridge;
}

describe('standalone chat Canvas bridge behavior', () => {
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

    expect(matched).toEqual({ status: 'consumed', references: [{ url: '/legacy.png' }] });
    expect(merged).toEqual([{ url: '/old-project-image.png' }, { url: '/legacy.png' }]);
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
      if (input.assetVersionId === 'foreign-version') throw new Error('ASSET_NOT_FOUND');
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

  it('I6 imports legacy URLs without resolving or granting managed identity', async () => {
    const consume = consumeBridge();
    expect(consume).toBeTypeOf('function');
    if (!consume) return;
    const resolveReference = vi.fn();
    const merge = vi.fn();

    const result = await consume({
      payload: ['/legacy-array.png'],
      currentProjectId: 'canvas-a',
      resolveReference,
      merge,
      remove: vi.fn(),
    });

    expect(result.references).toEqual([{ url: '/legacy-array.png' }]);
    expect(result.references[0]).not.toHaveProperty('assetVersionId');
    expect(resolveReference).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalledWith([{ url: '/legacy-array.png' }]);
  });
});
