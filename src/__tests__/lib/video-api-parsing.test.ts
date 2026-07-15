import { describe, expect, it } from 'vitest';
import { parseVideoPollResponse } from '@/lib/video-api';

describe('video API response parsing', () => {
  it('extracts an APImart video URL from the nested result payload', () => {
    const result = parseVideoPollResponse('apimart-video', {
      data: {
        status: 'completed',
        result: {
          videos: [{ url: ['https://cdn.example/video.mp4'] }],
          duration: 8,
          cover_url: 'https://cdn.example/cover.jpg',
        },
      },
    });

    expect(result).toEqual({
      status: 'succeeded',
      progress: 100,
      videoUrl: 'https://cdn.example/video.mp4',
      duration: 8,
      thumbnailUrl: 'https://cdn.example/cover.jpg',
    });
  });

  it('accepts PearAPI string result entries without treating them as objects', () => {
    const result = parseVideoPollResponse('pearapi-video', {
      status: 'completed',
      output: { data: ['https://cdn.example/pear.mp4'], duration: 5 },
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      videoUrl: 'https://cdn.example/pear.mp4',
      duration: 5,
    });
  });

  it('keeps malformed generic progress values in a safe pending state', () => {
    expect(parseVideoPollResponse('rest-generic', { status: 'processing', progress: 'unknown' })).toEqual({
      status: 'running',
      progress: 50,
    });
  });
});
