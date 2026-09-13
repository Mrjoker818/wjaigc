import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { stabilizeGatewayImageResult } from '@/lib/media-gateway/artifact-persistence';

describe('media gateway artifact persistence', () => {
  it('replaces temporary provider images with managed URLs and preserves recovery metadata', async () => {
    const download = vi.fn().mockResolvedValue({
      buffer: Buffer.from('image-bytes'),
      mimeType: 'image/png',
    });
    const save = vi.fn().mockReturnValue('/api/serve-upload/gateway/task-1-0.png');
    const upload = vi.fn().mockResolvedValue('/images/gateway/task-1-0.png');

    const result = await stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: 'https://provider.example/temporary.png?expires=1',
        imageUrls: ['https://provider.example/temporary.png?expires=1'],
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download,
      save,
      upload,
    });

    expect(result).toMatchObject({
      imageUrl: '/api/serve-upload/gateway/task-1-0.png',
      imageUrls: ['/api/serve-upload/gateway/task-1-0.png'],
      images: [{
        url: '/api/serve-upload/gateway/task-1-0.png',
        recoverySourceUrl: 'https://provider.example/temporary.png?expires=1',
        storageKey: 'images/gateway/task-1-0.png',
        mimeType: 'image/png',
        byteSize: 11,
      }],
    });
    expect(download).toHaveBeenCalledWith(
      'https://provider.example/temporary.png?expires=1',
      expect.objectContaining({ maxBytes: 25 * 1024 * 1024, timeoutMs: 12_000 }),
    );
  });

  it('leaves non-gateway and already managed results unchanged', async () => {
    const download = vi.fn();
    await expect(stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: { imageUrl: '/api/serve-upload/generated/a.png', imageUrls: ['/api/serve-upload/generated/a.png'] },
      download,
    })).resolves.toMatchObject({ imageUrl: '/api/serve-upload/generated/a.png' });
    expect(download).not.toHaveBeenCalled();
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

  it('does not block managed delivery when the optional S3 backup stalls', async () => {
    const result = await stabilizeGatewayImageResult({
      taskId: 'task-1',
      result: {
        imageUrl: 'https://provider.example/temporary.png',
        submissionPayload: { sourceChannel: 'gateway', projectId: 'project-1' },
      },
      download: vi.fn().mockResolvedValue({
        buffer: Buffer.from('image-bytes'),
        mimeType: 'image/png',
      }),
      save: vi.fn().mockReturnValue('/api/serve-upload/gateway/task-1-0.png'),
      upload: vi.fn().mockReturnValue(new Promise(() => undefined)),
      uploadTimeoutMs: 5,
    });

    expect(result).toMatchObject({
      imageUrl: '/api/serve-upload/gateway/task-1-0.png',
      images: [{ url: '/api/serve-upload/gateway/task-1-0.png' }],
    });
    expect(result.images).toEqual([
      expect.not.objectContaining({ storageKey: expect.anything() }),
    ]);
  });
});
