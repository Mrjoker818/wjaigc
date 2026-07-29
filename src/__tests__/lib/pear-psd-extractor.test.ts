import { describe, expect, it, vi } from 'vitest';
import { writePsd } from 'ag-psd';

import { extractEditableLayersFromPsd } from '@/lib/layer-decomposition/psd-extractor';

function minimalLayeredPsd(): Buffer {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255,
    255, 0, 0, 180,
    255, 0, 0, 180,
    255, 0, 0, 255,
  ]);
  return Buffer.from(writePsd({
    width: 8,
    height: 7,
    children: [{
      name: '主体组',
      opened: true,
      children: [{
        name: '产品主体',
        left: 3,
        top: 2,
        right: 5,
        bottom: 4,
        opacity: 0.65,
        blendMode: 'multiply',
        hidden: false,
        imageData: { width: 2, height: 2, data: pixels },
      }],
    }],
  }, { noBackground: true }));
}

describe('Pear PSD extraction', () => {
  it('serializes concurrent PSD decodes to protect process memory', async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstPersist = vi.fn(async () => {
      markFirstStarted();
      await firstBlocked;
      return '/api/serve-upload/first.png';
    });
    const secondPersist = vi.fn(async () => '/api/serve-upload/second.png');

    const first = extractEditableLayersFromPsd(minimalLayeredPsd(), {
      persistLayer: firstPersist,
    });
    await firstStarted;
    const second = extractEditableLayersFromPsd(minimalLayeredPsd(), {
      persistLayer: secondPersist,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(secondPersist).not.toHaveBeenCalled();
    releaseFirst();
    await Promise.all([first, second]);
    expect(secondPersist).toHaveBeenCalledTimes(1);
  });

  it('removes a cancelled extraction from the process queue', async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = extractEditableLayersFromPsd(minimalLayeredPsd(), {
      persistLayer: async () => {
        markFirstStarted();
        await firstBlocked;
        return '/api/serve-upload/first.png';
      },
    });
    await firstStarted;
    const controller = new AbortController();
    const queued = extractEditableLayersFromPsd(minimalLayeredPsd(), {
      signal: controller.signal,
      persistLayer: vi.fn(),
    });
    controller.abort(new Error('cancelled while queued'));

    await expect(queued).rejects.toThrow('cancelled while queued');
    releaseFirst();
    await first;
  });

  it('accepts a valid PSD above the previous 80 MiB limit', async () => {
    const minimal = minimalLayeredPsd();
    const pearSized = Buffer.allocUnsafe(80 * 1024 * 1024 + 1);
    pearSized.fill(0);
    minimal.copy(pearSized);

    const result = await extractEditableLayersFromPsd(pearSized, {
      persistLayer: vi.fn(async () => '/api/serve-upload/layer.png'),
    });

    expect(result.layers).toHaveLength(1);
  });

  it('rejects a fake PSD and a header pixel bomb', async () => {
    await expect(extractEditableLayersFromPsd(Buffer.from('not-a-psd'), {
      persistLayer: vi.fn(),
    })).rejects.toThrow(/signature/i);

    const bomb = Buffer.alloc(26);
    bomb.write('8BPS', 0, 'ascii');
    bomb.writeUInt16BE(1, 4);
    bomb.writeUInt32BE(20_000, 14);
    bomb.writeUInt32BE(20_000, 18);
    bomb.writeUInt16BE(8, 22);
    await expect(extractEditableLayersFromPsd(bomb, {
      persistLayer: vi.fn(),
    })).rejects.toThrow(/pixel|dimension/i);
  });

  it('preserves offsets, opacity, blend mode, visibility, and hierarchy', async () => {
    const persistLayer = vi.fn(async (_buffer: Buffer, filename: string) => (
      `/api/serve-upload/layer-decomposition/${filename}`
    ));
    const result = await extractEditableLayersFromPsd(minimalLayeredPsd(), {
      persistLayer,
      taskId: 'layer-task-1',
    });

    expect(result).toMatchObject({ width: 8, height: 7 });
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toMatchObject({
      parentId: 'group-1',
      name: '产品主体',
      role: 'subject',
      width: 2,
      height: 2,
      offsetX: 3,
      offsetY: 2,
      opacity: 0.65,
      blendMode: 'multiply',
      visible: true,
      source: 'pear-psd',
    });
    expect(persistLayer).toHaveBeenCalledTimes(1);
    expect(persistLayer.mock.calls[0][0].subarray(1, 4).toString('ascii')).toBe('PNG');
  });
});
