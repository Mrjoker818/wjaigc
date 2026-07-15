import { describe, expect, it } from 'vitest';

import { parseVideoPollResponse } from '@/lib/video-api';

describe('video API poll response parsing', () => {
  it('keeps the APImart nested video URL contract', () => {
    expect(parseVideoPollResponse('apimart-video', {
      data: {
        status: 'completed',
        result: { videos: [{ url: ['https://cdn.example.com/result.mp4'] }] },
      },
    })).toMatchObject({
      status: 'succeeded',
      videoUrl: 'https://cdn.example.com/result.mp4',
    });
  });

  it('falls back to a valid running progress when a provider returns malformed progress', () => {
    expect(parseVideoPollResponse('rest-generic', {
      status: 'running',
      progress: 'not-a-number',
    })).toEqual({ status: 'running', progress: 50 });
  });

  it('handles null and non-object provider responses without throwing', () => {
    expect(parseVideoPollResponse('dashscope', null)).toEqual({ status: 'pending', progress: 0 });
    expect(parseVideoPollResponse('pearapi-video', 'invalid')).toEqual({ status: 'pending', progress: 5 });
  });
});
