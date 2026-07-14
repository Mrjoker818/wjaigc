import { describe, expect, it } from 'vitest';
import { applyCanvasGenerationResults } from '@/lib/canvas-generation-results';

interface TestImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  processing?: boolean;
}

const placeholder: TestImage = {
  id: 'frame', url: '', x: 100, y: 200, width: 300, height: 300, processing: true,
};

describe('canvas generation results', () => {
  it('atomically replaces the processing frame and preserves every completed URL', () => {
    const updated = applyCanvasGenerationResults<TestImage>(
      [placeholder, { ...placeholder, id: 'existing', url: 'existing.png' }],
      'frame',
      ['one.png', 'two.png', 'three.png'],
      (frame, url) => ({ ...frame, url, processing: false }),
      (frame, url, index) => ({
        id: `result-${index}`,
        url,
        x: (frame?.x ?? 0) + (index + 1) * 320,
        y: frame?.y ?? 0,
        width: frame?.width ?? 300,
        height: frame?.height ?? 300,
      }),
    );

    expect(updated.map(image => image.url)).toEqual(['one.png', 'existing.png', 'two.png', 'three.png']);
    expect(updated.find(image => image.id === 'frame')?.processing).toBe(false);
  });
});
