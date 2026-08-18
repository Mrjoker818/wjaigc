import { describe, expect, it, vi } from 'vitest';
import {
  canvasEntityIdForTransferredReference,
  extractTaskAssetReferences,
  filterUniqueCanvasImageInsertions,
  mergeWorkspaceAssetReferences,
  parseCanvasAssetDragPayload,
  prepareWorkflowCanvasInsertions,
  serializeCanvasAssetDragPayload,
} from '@/lib/asset-core/workspace-transfer';

describe('managed workspace reference identity', () => {
  it('uses the transferred placement entity identity for the canvas node id', () => {
    expect(canvasEntityIdForTransferredReference({
      url: '/canonical.png',
      assetVersionId: 'version-a',
      placementId: 'placement-a',
      entityId: 'canvas-node-a',
    }, 'fallback-a')).toBe('canvas-node-a');
    expect(canvasEntityIdForTransferredReference({ url: '/legacy.png' }, 'fallback-a'))
      .toBe('fallback-a');
  });

  it('extracts aligned immutable version references from a completed task response', () => {
    expect(extractTaskAssetReferences({
      imageUrls: ['/a.png', '/b.png'],
      assetProjection: { versionIds: ['version-a', 'version-b'] },
    })).toEqual([
      { url: '/a.png', assetVersionId: 'version-a' },
      { url: '/b.png', assetVersionId: 'version-b' },
    ]);
  });

  it('prefers complete projected placement references over URL-only reconstruction', () => {
    expect(extractTaskAssetReferences({
      imageUrls: ['/legacy-order.png'],
      assetProjection: {
        versionIds: ['legacy-version'],
        references: [{
          url: '/canonical.png',
          assetId: 'asset-a',
          assetVersionId: 'version-a',
          placementId: 'placement-a',
          entityId: 'canvas-result-a',
        }],
      },
    })).toEqual([{
      url: '/canonical.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-a',
      entityId: 'canvas-result-a',
    }]);
  });

  it('merges progressive task references by immutable version identity', () => {
    expect(mergeWorkspaceAssetReferences(
      [{ url: '/old-a.png', assetVersionId: 'version-a' }],
      [
        { url: '/new-a.png', assetVersionId: 'version-a' },
        { url: '/b.png', assetVersionId: 'version-b' },
      ],
    )).toEqual([
      { url: '/new-a.png', assetVersionId: 'version-a' },
      { url: '/b.png', assetVersionId: 'version-b' },
    ]);
  });
});

describe('workflow output canvas insertion', () => {
  it('drops a concurrent duplicate that resolves to the same canvas placement', () => {
    const existing = [{ id: 'canvas-node-a', url: '/same.png', placementId: 'placement-a' }];

    expect(filterUniqueCanvasImageInsertions(existing, [
      { id: 'canvas-node-a', url: '/same.png', placementId: 'placement-a' },
      { id: 'different-node', url: '/same.png', placementId: 'placement-a' },
      { id: 'canvas-node-b', url: '/same.png', placementId: 'placement-b' },
    ])).toEqual([
      { id: 'canvas-node-b', url: '/same.png', placementId: 'placement-b' },
    ]);
  });

  it('keeps a managed output retryable when its transfer fails', async () => {
    const transfer = vi.fn().mockRejectedValue(new Error('transfer unavailable'));

    const result = await prepareWorkflowCanvasInsertions([
      {
        outputNodeId: 'managed-output',
        url: '/managed-source.png',
        managed: true,
        sourceReference: {
          url: '/managed-source.png',
          assetVersionId: 'version-a',
          placementId: 'workflow-placement-a',
        },
      },
      {
        outputNodeId: 'legacy-output',
        url: '/legacy.png',
        managed: false,
      },
    ], transfer);

    expect(transfer).toHaveBeenCalledOnce();
    expect(result.items).toEqual([{
      outputNodeId: 'legacy-output',
      url: '/legacy.png',
    }]);
    expect(result.failedOutputNodeIds).toEqual(['managed-output']);
  });

  it('inserts a managed output only after receiving its new placement', async () => {
    const transfer = vi.fn().mockResolvedValue({
      url: '/canonical-canvas.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'canvas-placement-a',
    });

    const result = await prepareWorkflowCanvasInsertions([{
      outputNodeId: 'managed-output',
      url: '/managed-source.png',
      managed: true,
      sourceReference: {
        url: '/managed-source.png',
        assetVersionId: 'version-a',
        placementId: 'workflow-placement-a',
      },
    }], transfer);

    expect(result.items).toEqual([{
      outputNodeId: 'managed-output',
      url: '/canonical-canvas.png',
      assetReference: expect.objectContaining({
        assetVersionId: 'version-a',
        placementId: 'canvas-placement-a',
      }),
    }]);
    expect(result.failedOutputNodeIds).toEqual([]);
  });

  it('preserves two managed outputs with the same canonical URL as distinct canvas items', async () => {
    const transfer = vi.fn(async (_reference, candidate) => ({
      url: '/same-canonical.png',
      assetId: `asset-${candidate.outputNodeId}`,
      assetVersionId: `version-${candidate.outputNodeId}`,
      placementId: `canvas-placement-${candidate.outputNodeId}`,
    }));

    const result = await prepareWorkflowCanvasInsertions([
      {
        outputNodeId: 'output-a',
        url: '/same-canonical.png',
        managed: true,
        sourceReference: { url: '/same-canonical.png', assetVersionId: 'version-output-a' },
      },
      {
        outputNodeId: 'output-b',
        url: '/same-canonical.png',
        managed: true,
        sourceReference: { url: '/same-canonical.png', assetVersionId: 'version-output-b' },
      },
    ], transfer);

    expect(result.items).toEqual([
      {
        outputNodeId: 'output-a',
        url: '/same-canonical.png',
        assetReference: expect.objectContaining({
          assetVersionId: 'version-output-a',
          placementId: 'canvas-placement-output-a',
        }),
      },
      {
        outputNodeId: 'output-b',
        url: '/same-canonical.png',
        assetReference: expect.objectContaining({
          assetVersionId: 'version-output-b',
          placementId: 'canvas-placement-output-b',
        }),
      },
    ]);
  });
});

describe('canvas asset drag identity', () => {
  it('round-trips structured identity without looking it up by URL', () => {
    const first = {
      id: 'canvas-a',
      url: '/same.png',
      name: 'First',
      projectId: 'project-a',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-a',
      width: 640,
      height: 480,
    };
    const second = { ...first, id: 'canvas-b', assetVersionId: 'version-b', placementId: 'placement-b' };

    expect(parseCanvasAssetDragPayload(serializeCanvasAssetDragPayload(first)))
      .toMatchObject({ id: 'canvas-a', assetVersionId: 'version-a', placementId: 'placement-a' });
    expect(parseCanvasAssetDragPayload(serializeCanvasAssetDragPayload(second)))
      .toMatchObject({ id: 'canvas-b', assetVersionId: 'version-b', placementId: 'placement-b' });
  });

  it('rejects malformed structured payloads', () => {
    expect(parseCanvasAssetDragPayload('{"url":"/missing-id.png"}')).toBeNull();
    expect(parseCanvasAssetDragPayload('not-json')).toBeNull();
  });
});
