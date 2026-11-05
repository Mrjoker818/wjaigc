// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { canvasTransferContractFixture, contractReference } from '../helpers/canvas-chat-transfer-contract-fixture';

afterEach(() => vi.unstubAllGlobals());

it('keeps the scoped workspace transfer on the versioned path when an old server returns 404', async () => {
  const fixture = canvasTransferContractFixture();
  fixture.actor.current.id = '用户甲';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetcher);

  await expect(fixture.single(contractReference)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/assets/actor-v2/transfer');
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).expectedActorId).toBe('用户甲');
  expect(fixture.writes).toHaveLength(0);
});

it('preserves the scoped workspace transfer and image insertion on success', async () => {
  const fixture = canvasTransferContractFixture();
  fixture.actor.current.id = '用户甲';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...contractReference, projectRevision: 6 }));
  vi.stubGlobal('fetch', fetcher);

  await fixture.single(contractReference);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/assets/actor-v2/transfer');
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
    expectedActorId: '用户甲', sourceVersion: 'version-a', targetProject: 'project-a', entityType: 'canvas-image',
  });
  expect(fixture.images.current.some(image => image.assetVersionId === 'version-a')).toBe(true);
});
