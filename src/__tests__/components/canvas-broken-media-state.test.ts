import { describe, expect, it } from 'vitest';

import * as canvasAdapter from '@/lib/asset-core/canvas-adapter';
import {
  getCanvasMediaRenderDecision,
  handleCanvasMediaElementFailure,
} from '@/lib/asset-core/canvas-media-render';
import type { CanvasImage } from '@/lib/user-types';

const missingImage = (url: string): CanvasImage => ({
  id: `missing-${url || 'empty'}`,
  url,
  x: 10,
  y: 20,
  width: 320,
  height: 240,
  originalWidth: 640,
  originalHeight: 480,
  rotation: 0,
  zIndex: 1,
  createdAt: 1,
});

describe('canvas broken managed media state', () => {
  it.each(['', 'blob:expired-session-media'])(
    'renders an unmanaged %s placement as visible broken media after hydrate',
    (url) => {
      const [hydrated] = canvasAdapter.hydrateCanvasPlacements([missingImage(url)]);

      expect(hydrated).toMatchObject({
        url,
        width: 320,
        height: 240,
        mediaAvailability: 'missing',
      });
      expect(getCanvasMediaRenderDecision(hydrated)).toBe('broken-media');
    },
  );

  it('marks a failed unmanaged blob as missing instead of exhausting a transparent fallback', () => {
    const image = missingImage('blob:expired-session-media');
    const markMissing = (imageId: string, errorCode: string): void => {
      expect(imageId).toBe(image.id);
      expect(errorCode).toBe('MEDIA_LOAD_FAILED');
    };

    expect(handleCanvasMediaElementFailure({
      image,
      element: { src: image.url, dataset: { retried: '1', canvasMediaSource: 'original' } },
      markMissing,
    })).toBe('mark-missing');
  });

  it('keeps broken media eligible for both retry and source recovery', () => {
    const image = {
      ...missingImage(''),
      sourceUrl: 'https://recovery.test/original.png',
      mediaAvailability: 'missing' as const,
      mediaErrorCode: 'MEDIA_LOAD_FAILED',
    };

    expect(canvasAdapter.getCanvasMediaFilename(image)).toBe('original.png');
    expect(canvasAdapter.shouldPersistCanvasPlacement(image)).toBe(true);
  });
});
