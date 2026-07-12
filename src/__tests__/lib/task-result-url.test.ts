import { describe, expect, it } from 'vitest';
import { extractTaskResultImageUrl } from '@/lib/task-result-url';

describe('extractTaskResultImageUrl', () => {
  it('extracts an APIMart nested URL array from a completed task result', () => {
    expect(extractTaskResultImageUrl({
      status: 'completed',
      result: {
        images: [{ url: ['https://cdn.example.com/result.png'] }],
      },
    })).toBe('https://cdn.example.com/result.png');
  });

  it('extracts a normalized poll-task directImageUrls result', () => {
    expect(extractTaskResultImageUrl({
      status: 'completed',
      result: {
        directImageUrls: ['https://cdn.example.com/hex-cube.png'],
      },
    })).toBe('https://cdn.example.com/hex-cube.png');
  });

  it('extracts a scene-studio image_urls payload', () => {
    expect(extractTaskResultImageUrl({
      status: 'completed',
      result: {
        output: {
          image_urls: ['https://cdn.example.com/scene-studio.png'],
        },
      },
    })).toBe('https://cdn.example.com/scene-studio.png');
  });
});
