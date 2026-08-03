import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { EffectReverseSessionInput, NormalizedQuad } from '@/lib/effect-reverse-engineering/types';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  saved: new Map<string, Buffer>(),
}));

vi.mock('@/lib/safe-image-input', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/safe-image-input')>();
  return { ...actual, loadSafeImageInput: mocks.load };
});

vi.mock('@/lib/server-data-root', () => ({
  saveImageFile: vi.fn((buffer: Buffer, filename: string, subDir: string) => {
    const url = `/api/serve-upload/${subDir}/${filename}`;
    mocks.saved.set(url, Buffer.from(buffer));
    return url;
  }),
}));

const perspective: NormalizedQuad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function request(imageUrl = '/api/serve-upload/uploads/source.webp'): EffectReverseSessionInput {
  return {
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    imageUrl,
    perspective: perspective.map((point) => ({ ...point })) as NormalizedQuad,
    regions: [],
    instruction: '',
  };
}

async function waitForTerminal(taskId: string) {
  const { getEffectReverseTask } = await import('@/lib/effect-reverse-engineering/service');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await getEffectReverseTask({ taskId, userId: 'user-1', userRole: 'user' });
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Task did not reach a terminal state');
}

describe('effect reverse engineering service', () => {
  beforeEach(() => {
    mocks.load.mockReset();
    mocks.saved.clear();
  });

  it('normalizes a WebP source before building a real PDF export', async () => {
    const webp = await sharp({
      create: { width: 4, height: 3, channels: 4, background: '#d4af37' },
    }).webp().toBuffer();
    mocks.load.mockResolvedValue({ buffer: webp, mimeType: 'image/webp' });
    const { submitEffectReverseTask } = await import('@/lib/effect-reverse-engineering/service');

    const submitted = await submitEffectReverseTask({
      userId: 'user-1',
      action: 'export-pdf',
      request: request(),
    });
    const task = await waitForTerminal(submitted.taskId);

    expect(task.status).toBe('completed');
    expect(task.result?.exportUrl).toMatch(/\.pdf$/);
    const pdf = mocks.saved.get(task.result?.exportUrl || '');
    expect(pdf?.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('keeps cancellation terminal when source loading resolves late', async () => {
    let releaseLoad!: (value: { buffer: Buffer; mimeType: string }) => void;
    mocks.load.mockImplementation((_url: string, options: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        releaseLoad = resolve;
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
      }));
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#ffffff' },
    }).png().toBuffer();
    const { cancelEffectReverseTask, getEffectReverseTask, submitEffectReverseTask } =
      await import('@/lib/effect-reverse-engineering/service');

    const submitted = await submitEffectReverseTask({
      userId: 'user-1',
      action: 'correct',
      request: request('/api/serve-upload/uploads/source.png'),
    });
    await cancelEffectReverseTask({ taskId: submitted.taskId, userId: 'user-1', userRole: 'user' });
    releaseLoad({ buffer: png, mimeType: 'image/png' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const task = await getEffectReverseTask({
      taskId: submitted.taskId,
      userId: 'user-1',
      userRole: 'user',
    });
    expect(task.status).toBe('cancelled');
    expect(task.result).toBeUndefined();
  });
});
