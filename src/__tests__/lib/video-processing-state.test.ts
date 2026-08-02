import { describe, expect, it } from 'vitest';
import {
  buildVideoFailureProcessing,
  createVideoRetryPayload,
} from '@/lib/video-processing-state';

describe('video processing state', () => {
  it('retains the task and retry payload when a video task reaches a terminal failure', () => {
    const retryPayload = createVideoRetryPayload({
      prompt: 'A cinematic city at night',
      model: 'video-model',
      mode: 'text2video',
      aspectRatio: '16:9',
      duration: 10,
      quality: 'high',
      providerId: 'provider-1',
    });

    expect(buildVideoFailureProcessing({
      label: '视频生成中',
      status: 'processing',
      progress: 10,
      taskId: 'task-1',
      startTime: 100,
      retryPayload,
    }, '上游模型超时', '视频生成超时')).toEqual({
      label: '视频生成超时',
      status: 'failed',
      progress: 100,
      taskId: 'task-1',
      startTime: 100,
      retryPayload,
      error: '上游模型超时',
      retryable: true,
    });
  });

  it('keeps only serializable retry inputs and does not depend on a stale canvas node', () => {
    expect(createVideoRetryPayload({
      prompt: 'animate the product',
      model: 'video-model',
      mode: 'image2video-first',
      aspectRatio: '1:1',
      duration: 5,
      quality: 'standard',
      imageUrl: '/api/serve-upload/uploads/source.png',
      referenceImages: ['/api/serve-upload/uploads/reference.png'],
      providerId: 'provider-1',
    })).toMatchObject({
      prompt: 'animate the product',
      mode: 'image2video-first',
      imageUrl: '/api/serve-upload/uploads/source.png',
      referenceImages: ['/api/serve-upload/uploads/reference.png'],
    });
  });
});
