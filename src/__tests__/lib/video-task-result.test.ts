import { describe, expect, it } from 'vitest';

import { getCompletedVideoTaskResult } from '@/lib/video-task-result';

describe('completed video task result', () => {
  it('preserves the playable URL and provider thumbnail while removing provider secrets', () => {
    const completed = getCompletedVideoTaskResult({
      videoUrl: '/media/video/result.mp4',
      videoThumbnailUrl: '/media/video/poster.jpg',
      apiKey: 'secret-key',
      apiBaseUrl: 'https://provider.example',
      providerId: 'pear-video',
    });

    expect(completed).toEqual({
      videoUrl: '/media/video/result.mp4',
      videoThumbnailUrl: '/media/video/poster.jpg',
      result: {
        videoUrl: '/media/video/result.mp4',
        videoThumbnailUrl: '/media/video/poster.jpg',
        providerId: 'pear-video',
      },
    });
  });
});
