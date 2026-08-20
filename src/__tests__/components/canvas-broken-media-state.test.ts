import { describe, expect, it, vi } from 'vitest';

import * as canvasAdapter from '@/lib/asset-core/canvas-adapter';
import {
  getCanvasMediaRecoveryIdentityState,
  recoverCanvasMedia,
  recoverCanvasMediaUntilTerminal,
} from '@/lib/asset-core/canvas-media-recovery-client';
import type { CanvasImage } from '@/lib/user-types';
import fs from 'node:fs';
import path from 'node:path';

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
      expect(canvasAdapter.getCanvasMediaRenderDecision(hydrated)).toBe('broken-media');
    },
  );

  it('marks a failed unmanaged blob as missing instead of exhausting a transparent fallback', () => {
    const image = missingImage('blob:expired-session-media');
    const markMissing = (imageId: string, errorCode: string): void => {
      expect(imageId).toBe(image.id);
      expect(errorCode).toBe('MEDIA_LOAD_FAILED');
    };

    expect(canvasAdapter.handleCanvasMediaElementFailure({
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

  it('does not persist a cancelled generation placeholder as broken media', () => {
    const image: CanvasImage = {
      ...missingImage(''),
      isProcessingPlaceholder: true,
      processing: {
        label: '任务已取消',
        status: 'cancelled',
        progress: 1,
        taskId: 'cancelled-task',
      },
    };

    expect(canvasAdapter.shouldPersistCanvasPlacement(image)).toBe(false);
    expect(canvasAdapter.serializeCanvasWorkspacePlacements([image])).toEqual([]);
  });

  it('recovers managed broken media through the durable recovery endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      recovered: true,
      availability: 'ready',
      url: '/api/serve-upload/uploads/recovered.png',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(recoverCanvasMedia({
      projectId: 'project-a',
      image: {
        ...missingImage('/api/serve-upload/uploads/missing.png'),
        assetId: 'asset-a',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
        mediaAvailability: 'missing',
      },
      fetcher,
    })).resolves.toEqual({
      recovered: true,
      availability: 'ready',
      url: '/api/serve-upload/uploads/recovered.png',
    });

    expect(fetcher).toHaveBeenCalledWith('/api/assets/media/recover', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-a',
        assetId: 'asset-a',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
      }),
    }));
  });

  it('preserves a concurrent recovery lease as an in-progress result', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      recovered: false,
      availability: 'recovering',
      deferred: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(recoverCanvasMedia({
      projectId: 'project-a',
      image: {
        ...missingImage('/api/serve-upload/uploads/missing.png'),
        assetId: 'asset-a',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
      },
      fetcher,
    })).resolves.toMatchObject({
      recovered: false,
      availability: 'recovering',
      deferred: true,
    });
  });

  it('polls a shared recovery lease until the durable terminal result is visible', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        recovered: false,
        availability: 'recovering',
        deferred: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        recovered: true,
        availability: 'ready',
        deferred: false,
        url: '/api/serve-upload/recovery/version-a/attempt-a.png',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const wait = vi.fn(async () => undefined);

    await expect(recoverCanvasMediaUntilTerminal({
      projectId: 'project-a',
      image: {
        ...missingImage('/api/serve-upload/uploads/missing.png'),
        assetId: 'asset-a',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
      },
      fetcher,
      wait,
      pollIntervalMs: 1,
      maxAttempts: 2,
    })).resolves.toMatchObject({
      recovered: true,
      availability: 'ready',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(fetcher.mock.calls[1][0]).toContain('/api/assets/media/recover?');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'GET' });
    expect(wait).toHaveBeenCalledOnce();
  });

  it('distinguishes unmanaged legacy media from incomplete managed identity', () => {
    expect(getCanvasMediaRecoveryIdentityState(missingImage('blob:legacy'))).toBe('legacy');
    expect(getCanvasMediaRecoveryIdentityState({
      ...missingImage('/api/serve-upload/uploads/incomplete.png'),
      assetId: 'asset-a',
    })).toBe('incomplete');
    expect(getCanvasMediaRecoveryIdentityState({
      ...missingImage('/api/serve-upload/uploads/complete.png'),
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-a',
    })).toBe('complete');
  });

  it('keeps unrecoverable media terminal without another image-load recovery cycle', () => {
    const image = {
      ...missingImage('/api/assets/media/content/version-a'),
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-a',
      mediaAvailability: 'unrecoverable' as const,
    };

    expect(canvasAdapter.getCanvasMediaRenderDecision(image)).toBe('broken-media');
    expect(canvasAdapter.getCanvasMediaFailureAction(image, {
      failedSource: 'original',
      legacyRetryAttempted: false,
    })).toBe('ignore');
  });

  it('does not allow the Canvas retry action to promote media directly to ready', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');
    const brokenStart = source.indexOf("getCanvasMediaRenderDecision(image) === 'broken-media'");
    const brokenEnd = source.indexOf(') : image.url ?', brokenStart);
    const brokenMediaUi = source.slice(brokenStart, brokenEnd);

    expect(source).not.toContain('const retryMissingMedia');
    expect(brokenStart).toBeGreaterThan(-1);
    expect(brokenMediaUi.match(/void recoverMissingMedia\(image\)/g)).toHaveLength(2);
    expect(brokenMediaUi).toContain("image.mediaAvailability !== 'unrecoverable'");
  });

  it('shares one polling loop for simultaneous recovery calls and enforces a wall-clock deadline', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }));
    const image = {
      ...missingImage('/api/serve-upload/uploads/missing.png'),
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-a',
    };
    const first = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', image, fetcher, maxAttempts: 1 });
    const second = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', image, fetcher, maxAttempts: 1 });
    resolveFirst?.(new Response(JSON.stringify({
      recovered: false,
      availability: 'recovering',
      deferred: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ availability: 'recovering' }),
      expect.objectContaining({ availability: 'recovering' }),
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('stops deferred polling at the wall-clock deadline', async () => {
    const fetcher = vi.fn(async (...request: Parameters<typeof fetch>) => {
      void request;
      return new Response(JSON.stringify({
        recovered: false,
        availability: 'recovering',
        deferred: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const wait = vi.fn(async () => undefined);
    const now = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(2);

    await expect(recoverCanvasMediaUntilTerminal({
      projectId: 'project-a',
      image: {
        ...missingImage('/api/serve-upload/uploads/deadline.png'),
        assetId: 'asset-a',
        assetVersionId: 'version-deadline',
        placementId: 'placement-a',
      },
      fetcher,
      wait,
      now,
      maxDurationMs: 1,
    })).resolves.toMatchObject({ availability: 'recovering', deferred: true });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
