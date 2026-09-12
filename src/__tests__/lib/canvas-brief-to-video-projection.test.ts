import { describe, expect, it, vi } from 'vitest';

import { loadCompletedCanvasBriefVideoResult } from '@/lib/skill-runtime/canvas-client';

describe('Canvas Brief to video projection', () => {
  it('restores the same authorized video AssetVersion from the completed Run', async () => {
    const structured = {
      schemaId: 'brief-to-video-result-v1', runId: 'run-video-1',
      planChecksum: 'a'.repeat(64), videoAssetVersionId: 'video-v1',
      sourceAssetVersionIds: ['start-v1'], providerId: 'pear-video', modelId: 'video-model',
      remoteTaskId: 'remote-video-1', durationSeconds: 10, aspectRatio: '16:9',
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        run: {
          runId: 'run-video-1', status: 'completed', assetVersionIds: ['video-v1'],
          outputs: [{
            stepId: 'generate-film', kind: 'json', schemaId: 'brief-to-video-result-v1',
            content: JSON.stringify(structured),
          }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        assetId: 'video-asset-1', assetVersionId: 'video-v1', kind: 'video',
        url: '/api/serve-upload/videos/final.mp4',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const restored = await loadCompletedCanvasBriefVideoResult({
      projectId: 'project-1', runId: 'run-video-1', fetcher,
    });

    expect(restored).toEqual({
      result: structured,
      asset: {
        assetId: 'video-asset-1', assetVersionId: 'video-v1', kind: 'video',
        url: '/api/serve-upload/videos/final.mp4',
      },
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/assets?projectId=project-1&assetVersionId=video-v1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
