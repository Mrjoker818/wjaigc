import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('server-only', () => ({}));

import { stabilizeGatewayImageResult } from '@/lib/media-gateway/artifact-persistence';

describe('media gateway artifact persistence', () => {
  const validPng = () => sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();

  it('replaces temporary provider images with managed URLs and preserves recovery metadata', async () => {
    const image = await validPng();
    const download = vi.fn().mockResolvedValue({ buffer: image, mimeType: 'image/png' });
    const save = vi.fn().mockReturnValue('/api/serve-upload/gateway/task-1-0.png');
    const upload = vi.fn().mockResolvedValue('/images/gateway/task-1-0.png');

    const result = await stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: 'https://provider.example/temporary.png?expires=1',
        imageUrls: ['https://provider.example/temporary.png?expires=1'],
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download, save, upload,
      isDurable: () => true,
    });

    expect(result).toMatchObject({
      imageUrl: '/api/serve-upload/gateway/task-1-0.png',
      imageUrls: ['/api/serve-upload/gateway/task-1-0.png'],
      images: [{
        url: '/api/serve-upload/gateway/task-1-0.png',
        recoverySourceUrl: 'https://provider.example/temporary.png?expires=1',
        storageKey: 'images/gateway/task-1-0.png',
        mimeType: 'image/png',
        byteSize: image.byteLength,
      }],
    });
    expect(download).toHaveBeenCalledWith(
      'https://provider.example/temporary.png?expires=1',
      expect.objectContaining({ maxBytes: 25 * 1024 * 1024, timeoutMs: 12_000 }),
    );
  });

  it('leaves non-gateway results unchanged', async () => {
    const download = vi.fn();
    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: { imageUrl: '/api/serve-upload/generated/a.png', imageUrls: ['/api/serve-upload/generated/a.png'] },
      download,
    })).resolves.toMatchObject({ imageUrl: '/api/serve-upload/generated/a.png' });
    expect(download).not.toHaveBeenCalled();
  });

  it('validates managed gateway images and requires S3 when the local root is temporary', async () => {
    const image = await validPng();
    const readManaged = vi.fn().mockResolvedValue({ buffer: image, mimeType: 'image/png' });
    const upload = vi.fn().mockResolvedValue('/images/gateway/task-1-managed.png');

    const result = await stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: '/api/serve-upload/generated/a.png',
        imageUrls: ['/api/serve-upload/generated/a.png'],
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      readManaged,
      upload,
      isDurable: () => false,
    });

    expect(readManaged).toHaveBeenCalledWith('/api/serve-upload/generated/a.png');
    expect(upload).toHaveBeenCalledWith(
      image,
      expect.stringMatching(/^gateway\/task-1-0-/),
      'image/png',
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      imageUrl: '/api/serve-upload/generated/a.png',
      images: [{
        url: '/api/serve-upload/generated/a.png',
        storageKey: 'images/gateway/task-1-managed.png',
        mimeType: 'image/png',
      }],
    });
  });

  it('rejects an invalid managed gateway image instead of trusting its URL prefix', async () => {
    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: '/api/serve-upload/generated/not-image.png',
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      readManaged: vi.fn().mockResolvedValue({
        buffer: Buffer.from('<html>not image</html>'),
        mimeType: 'image/png',
      }),
      isDurable: () => true,
    })).rejects.toThrow('GATEWAY_ARTIFACT_PERSIST_FAILED');
  });

  it('fails closed when a gateway image cannot be persisted', async () => {
    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: 'https://provider.example/temporary.png',
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download: vi.fn().mockRejectedValue(new Error('download failed')),
    })).rejects.toThrow('GATEWAY_ARTIFACT_PERSIST_FAILED');
  });

  it('does not block durable local delivery when the optional S3 backup stalls', async () => {
    const image = await validPng();
    let uploadSignal: AbortSignal | undefined;
    const upload = vi.fn((
      _buffer: Buffer,
      _filename: string,
      _mimeType: string,
      signal?: AbortSignal,
    ) => new Promise<null>(resolve => {
      uploadSignal = signal;
      signal?.addEventListener('abort', () => resolve(null), { once: true });
    }));
    const result = await stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: 'https://provider.example/temporary.png',
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download: vi.fn().mockResolvedValue({ buffer: image, mimeType: 'image/png' }),
      save: vi.fn().mockReturnValue('/api/serve-upload/gateway/task-1-0.png'),
      upload,
      uploadTimeoutMs: 5,
      isDurable: () => true,
    });

    expect(uploadSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      imageUrl: '/api/serve-upload/gateway/task-1-0.png',
      images: [{ url: '/api/serve-upload/gateway/task-1-0.png' }],
    });
    expect(result.images).toEqual([expect.not.objectContaining({ storageKey: expect.anything() })]);
  });

  it('rejects a response whose declared image MIME does not match the bytes', async () => {
    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: 'https://provider.example/not-an-image.png',
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download: vi.fn().mockResolvedValue({
        buffer: Buffer.from('{"error":"not an image"}'),
        mimeType: 'image/png',
      }),
      isDurable: () => true,
    })).rejects.toThrow('GATEWAY_ARTIFACT_PERSIST_FAILED');
  });

  it('rejects an image whose decoded dimensions exceed the pixel budget', async () => {
    const oversized = await sharp({
      create: { width: 6500, height: 6500, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png({ compressionLevel: 9 }).toBuffer();

    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: 'https://provider.example/pixel-bomb.png',
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download: vi.fn().mockResolvedValue({ buffer: oversized, mimeType: 'image/png' }),
      isDurable: () => true,
    })).rejects.toThrow('GATEWAY_ARTIFACT_PERSIST_FAILED');
  });

  it('fails closed when local storage is temporary and S3 persistence fails', async () => {
    const image = await validPng();
    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: 'https://provider.example/temporary.png',
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download: vi.fn().mockResolvedValue({ buffer: image, mimeType: 'image/png' }),
      save: vi.fn().mockReturnValue('/api/serve-upload/gateway/task-1-0.png'),
      upload: vi.fn().mockResolvedValue(null),
      isDurable: () => false,
    })).rejects.toThrow('GATEWAY_ARTIFACT_PERSIST_FAILED');
  });

  it('allows temporary local storage only after S3 persistence succeeds', async () => {
    const image = await validPng();
    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: 'https://provider.example/temporary.png',
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download: vi.fn().mockResolvedValue({ buffer: image, mimeType: 'image/png' }),
      save: vi.fn().mockReturnValue('/api/serve-upload/gateway/task-1-0.png'),
      upload: vi.fn().mockResolvedValue('/images/gateway/task-1-0.png'),
      isDurable: () => false,
    })).resolves.toMatchObject({ images: [{ storageKey: 'images/gateway/task-1-0.png' }] });
  });

  it('cleans up already-written artifacts when a later image fails validation', async () => {
    const image = await validPng();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockReturnValue('/api/serve-upload/gateway/task-1-0.png');
    const upload = vi.fn().mockResolvedValue('/images/gateway/task-1-0.png');

    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrls: ['https://provider.example/one.png', 'https://provider.example/two.png'],
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download: vi.fn()
        .mockResolvedValueOnce({ buffer: image, mimeType: 'image/png' })
        .mockResolvedValueOnce({ buffer: Buffer.from('bad'), mimeType: 'image/png' }),
      save,
      upload,
      cleanup,
      isDurable: () => true,
    })).rejects.toThrow('GATEWAY_ARTIFACT_PERSIST_FAILED');

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith({
      url: '/api/serve-upload/gateway/task-1-0.png',
      storageKey: 'images/gateway/task-1-0.png',
    });
  });

  it('records cleanup failures for durable retry instead of swallowing them', async () => {
    const image = await validPng();
    const cleanupError = new Error('S3 delete unavailable');
    const recordCleanupFailure = vi.fn().mockResolvedValue(undefined);

    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrls: ['https://provider.example/one.png', 'https://provider.example/two.png'],
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download: vi.fn()
        .mockResolvedValueOnce({ buffer: image, mimeType: 'image/png' })
        .mockResolvedValueOnce({ buffer: Buffer.from('bad'), mimeType: 'image/png' }),
      save: vi.fn().mockReturnValue('/api/serve-upload/gateway/task-1-0.png'),
      upload: vi.fn().mockResolvedValue('/images/gateway/task-1-0.png'),
      cleanup: vi.fn().mockRejectedValue(cleanupError),
      recordCleanupFailure,
      isDurable: () => true,
    })).rejects.toThrow('GATEWAY_ARTIFACT_PERSIST_FAILED');

    expect(recordCleanupFailure).toHaveBeenCalledWith(
      {
        url: '/api/serve-upload/gateway/task-1-0.png',
        storageKey: 'images/gateway/task-1-0.png',
      },
      cleanupError,
    );
  });
});
