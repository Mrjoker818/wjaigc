import { describe, expect, it, vi } from 'vitest';
import {
  parseCanvasAssetDragPayload,
  prepareWorkflowCanvasInsertions,
  serializeCanvasAssetDragPayload,
} from '@/lib/asset-core/workspace-transfer';

describe('workflow output canvas insertion', () => {
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
    expect(result.urls).toEqual(['/legacy.png']);
    expect(result.assetReferences).toEqual([]);
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

    expect(result.urls).toEqual(['/canonical-canvas.png']);
    expect(result.assetReferences).toEqual([expect.objectContaining({
      assetVersionId: 'version-a',
      placementId: 'canvas-placement-a',
    })]);
    expect(result.failedOutputNodeIds).toEqual([]);
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
