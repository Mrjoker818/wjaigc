import { afterEach, describe, expect, it, vi } from 'vitest';
import { importDocumentMediaBatch, assertDocumentMediaBatchProjection } from '@/lib/collaboration/document-media-batch-client';
import type { DocumentMediaBatchResult } from '@/lib/collaboration/document-media-batch-request';
import type { CanvasImage } from '@/lib/user-types';
vi.mock('server-only', () => ({}));
import { hydrateAssetV3Projects } from '@/lib/asset-core/canvas-project-sync';
const input = { projectId: 'target', idempotencyKey: 'intent', items: [{ sourceVersionId: 'source',
  command: { action: 'attach' as const, transform: { x: 1, y: 2, width: 20, height: 10, rotation: 0, zIndex: 1 } } }] };
const result: DocumentMediaBatchResult = { projectId: 'target', documentSequence: 3,
  items: [{ sourceVersionId: 'source', mode: 'import', childKey: 'batch-child:x:0',
    placementId: 'placement', assetVersionId: 'version', documentSequence: 3,
    assetReference: { assetId: 'asset', assetVersionId: 'version', placementId: 'placement',
      entityId: 'entity', url: '/api/serve-upload/result.png', kind: 'image' } }] };
const image: CanvasImage = { id: 'entity', assetId: 'asset', assetVersionId: 'version', placementId: 'placement',
  url: '/api/serve-upload/result.png', prompt: '', x: 1, y: 2, width: 20, height: 10, originalWidth: 20, originalHeight: 10,
  rotation: 0, zIndex: 1, createdAt: 1 };
afterEach(() => vi.unstubAllGlobals());
describe('1394 real HTTP client receipt and directory confirmation', () => {
  it('accepts real canonical video hydration with no poster, binding media to videoUrl not the empty image URL', () => {
    const receipt = structuredClone(result);
    receipt.items[0].assetReference.kind = 'video'; receipt.items[0].assetReference.url = '/api/serve-upload/video.mp4';
    const projects = hydrateAssetV3Projects([{ id: 'target', userId: 'owner', name: 'Target', createdAt: 1, updatedAt: 1,
      canvasImages: [], settings: {} }], { target: [{ entityId: 'entity', assetId: 'asset', assetVersionId: 'version',
        placementId: 'placement', kind: 'video', fileUrl: '/api/serve-upload/video.mp4', availability: 'ready',
        sourceWidth: 32, sourceHeight: 24, transform: input.items[0].command.transform, metadata: {} }] });
    expect(projects[0].canvasImages[0]).toMatchObject({ url: '', mediaType: 'video', videoUrl: '/api/serve-upload/video.mp4' });
    expect(() => assertDocumentMediaBatchProjection(receipt, projects[0].canvasImages)).not.toThrow();
    const forged = { ...projects[0].canvasImages[0], videoUrl: '/api/serve-upload/another.mp4' };
    expect(() => assertDocumentMediaBatchProjection(receipt, [forged])).toThrow('协作媒体目录');
  });
  it('sends only canonical batch fields with session credentials and expected actor comparison, not authorization claims', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, ...result }) }));
    vi.stubGlobal('fetch', fetcher);
    expect(await importDocumentMediaBatch(input, 'actor', undefined, () => undefined)).toEqual({ success: true, ...result });
    expect(fetcher.mock.calls[0]).toEqual(['/api/collaboration/document-assets/import-batch', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-wujie-expected-actor-id': 'actor' },
      body: JSON.stringify(input), signal: undefined }]);
    expect(() => assertDocumentMediaBatchProjection(result, [image])).not.toThrow();
  });
  it.each(['wrong scope','partial','wrong order','identity','partial reference','confirm copied','sequence'] as const)('refuses %s server ACK', async mutation => {
    const data = structuredClone(result);
    if (mutation === 'wrong scope') data.projectId = 'another';
    if (mutation === 'partial') data.items = [];
    if (mutation === 'wrong order') data.items[0].sourceVersionId = 'another';
    if (mutation === 'identity') data.items[0].assetReference.placementId = 'another';
    if (mutation === 'partial reference') data.items[0].assetReference.url = '';
    if (mutation === 'confirm copied') { data.items[0].mode = 'confirm'; data.items[0].childKey = null; }
    if (mutation === 'sequence') data.items[0].documentSequence = 4;
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ success: true, ...data }) }));
    await expect(importDocumentMediaBatch(input, 'actor', undefined, () => undefined)).rejects.toThrow();
  });
  it.each(['missing','duplicate','different version','different entity','wrong URL','no dimensions','wrong media kind'] as const)('does not treat directory %s as confirmed', mutation => {
    const images = [structuredClone(image)];
    if (mutation === 'missing') images.length = 0;
    if (mutation === 'duplicate') images.push(image);
    if (mutation === 'different version') images[0].assetVersionId = 'different';
    if (mutation === 'different entity') images[0].id = 'different';
    if (mutation === 'wrong URL') images[0].url = '/wrong.png';
    if (mutation === 'no dimensions') images[0].originalWidth = 0;
    if (mutation === 'wrong media kind') images[0].mediaType = 'video';
    expect(() => assertDocumentMediaBatchProjection(result, images)).toThrow('协作媒体目录');
  });
});
