import { describe, expect, it } from 'vitest';

import { projectWorkflowSkillRun } from '@/lib/workflow-skill-execution';

const result = {
  schemaId: 'brief-to-video-result-v1',
  runId: 'run-video-1',
  planChecksum: 'a'.repeat(64),
  videoAssetVersionId: 'video-v1',
  sourceAssetVersionIds: ['start-v1'],
  providerId: 'pear-video',
  modelId: 'video-model',
  remoteTaskId: 'remote-video-1',
  durationSeconds: 10,
  aspectRatio: '16:9',
};

describe('Workflow Brief to video projection', () => {
  it('projects the structured result and authorized video reference without treating it as an image', () => {
    const projected = projectWorkflowSkillRun({
      runId: 'run-video-1', status: 'completed', assetVersionIds: ['video-v1'],
      outputs: [{
        stepId: 'generate-film', kind: 'json', schemaId: 'brief-to-video-result-v1',
        content: JSON.stringify(result),
      }],
    }, [{
      assetId: 'video-asset-1', assetVersionId: 'video-v1',
      url: '/api/serve-upload/videos/final.mp4', kind: 'video',
    }]);

    expect(projected).toMatchObject({
      videoAssetVersionId: 'video-v1',
      videoUrl: '/api/serve-upload/videos/final.mp4',
      briefToVideoResult: result,
    });
    expect(projected).not.toHaveProperty('imageUrl');
  });
});
