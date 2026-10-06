import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const mocks = vi.hoisted(() => ({
  fetchImageBuffer: vi.fn(),
  uploadImageToS3: vi.fn(),
  uploadImageToS3Abortable: vi.fn(),
}));

vi.mock('@/lib/fetch-image-buffer', () => ({ fetchImageBuffer: mocks.fetchImageBuffer }));
vi.mock('@/lib/s3-storage', () => ({
  isS3Available: (): boolean => true,
  uploadImageToS3: mocks.uploadImageToS3,
  uploadImageToS3Abortable: mocks.uploadImageToS3Abortable,
}));

import { persistOutpaintDirectResult } from '@/lib/task-core/outpaint-direct-result';

afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

it('bounds a hung S3 persistence attempt so the accepted result can be recovered later', async () => {
  mocks.fetchImageBuffer.mockResolvedValue(await sharp({ create: {
    width: 2, height: 2, channels: 3, background: '#ffffff',
  } }).png().toBuffer());
  mocks.uploadImageToS3.mockImplementation(() => new Promise(() => undefined));
  mocks.uploadImageToS3Abortable.mockImplementation(() => new Promise(() => undefined));
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    setTimeout(() => controller.abort(new Error('persistence deadline')), 20);
    return controller.signal;
  });

  const outcome = await Promise.race([
    persistOutpaintDirectResult('https://provider.example/result', {
      targetW: 2, targetH: 2, genW: 2, genH: 2,
    }).then(() => 'completed', () => 'rejected'),
    new Promise<string>(resolve => setTimeout(() => resolve('stuck'), 300)),
  ]);

  expect(outcome).toBe('rejected');
  expect(mocks.uploadImageToS3Abortable).toHaveBeenCalledWith(
    expect.any(Buffer), expect.stringMatching(/^outpaint_.*\.jpg$/), 'image/jpeg', controller.signal,
  );
});

it('bounds a hung accepted-result download without starting an upload later', async () => {
  let finishFetch: ((bytes: Buffer) => void) | undefined;
  mocks.fetchImageBuffer.mockImplementation(() => new Promise<Buffer>(resolve => {
    finishFetch = resolve;
  }));
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    setTimeout(() => controller.abort(new Error('result deadline')), 20);
    return controller.signal;
  });

  const outcome = await Promise.race([
    persistOutpaintDirectResult('https://provider.example/result', {
      targetW: 2, targetH: 2, genW: 2, genH: 2,
    }).then(() => 'completed', () => 'rejected'),
    new Promise<string>(resolve => setTimeout(() => resolve('stuck'), 300)),
  ]);

  expect(outcome).toBe('rejected');
  finishFetch?.(await sharp({ create: {
    width: 2, height: 2, channels: 3, background: '#ffffff',
  } }).png().toBuffer());
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(mocks.uploadImageToS3Abortable).not.toHaveBeenCalled();
});

it('uses distinct durable keys for concurrent results in the same millisecond', async () => {
  const source = await sharp({ create: {
    width: 2, height: 2, channels: 3, background: '#ffffff',
  } }).png().toBuffer();
  mocks.fetchImageBuffer.mockResolvedValue(source);
  mocks.uploadImageToS3Abortable.mockImplementation(async (_bytes: Buffer, filename: string) =>
    `/images/${filename}`);
  vi.spyOn(Date, 'now').mockReturnValue(1_000);

  const output = await Promise.all(Array.from({ length: 2 }, () =>
    persistOutpaintDirectResult('https://provider.example/result', {
      targetW: 2, targetH: 2, genW: 2, genH: 2,
    })));

  expect(output[0]).not.toBe(output[1]);
  expect(mocks.uploadImageToS3Abortable).toHaveBeenCalledTimes(2);
});
