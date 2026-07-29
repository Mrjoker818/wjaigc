import { describe, expect, it } from 'vitest';

import { resolveActiveCanvasImage } from '@/lib/canvas-active-image';

interface TestImage {
  id: string;
  url: string;
}

const images: TestImage[] = [
  { id: 'stale-3d-preview', url: 'https://expired.example/preview.png' },
  { id: 'selected-paper-crane', url: '/api/serve-upload/generate/crane.png' },
];

describe('active canvas image resolution', () => {
  it('prefers the current single selection over a stale edit target', () => {
    expect(resolveActiveCanvasImage(
      images,
      images[1],
      'stale-3d-preview',
    )).toEqual(images[1]);
  });

  it('falls back to the locked edit target when selection is unavailable', () => {
    expect(resolveActiveCanvasImage(
      images,
      null,
      'stale-3d-preview',
    )).toEqual(images[0]);
  });
});
