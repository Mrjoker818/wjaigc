import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const uploadImageToS3Mock = vi.hoisted(() => vi.fn());
const isS3AvailableMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/lib/s3-storage', () => ({
  uploadImageToS3: uploadImageToS3Mock,
  isS3Available: isS3AvailableMock,
}));

describe('saveImageFile S3 write-through retry', () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    uploadImageToS3Mock.mockReset();
    isS3AvailableMock.mockReset();
    isS3AvailableMock.mockImplementation(() => true);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wujie-data-root-test-'));
    process.env.WUJIE_DATA_DIR = dataDir;
  });

  afterEach(() => {
    vi.useRealTimers();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.WUJIE_DATA_DIR;
  });

  /**
   * 在真实 timers 下预加载 s3-storage（mock 模块），使 saveImageFile 内部的
   * 动态 import 命中缓存（微任务级 resolve）——fake timers 会阻塞模块加载 IO，
   * 不预载则重试链永远不会执行。
   */
  async function primeS3Module(): Promise<void> {
    await import('@/lib/s3-storage');
  }

  it('writes the file locally and returns the serve-upload URL synchronously', async () => {
    uploadImageToS3Mock.mockResolvedValue('/images/test-sync.png');
    const { saveImageFile } = await import('@/lib/server-data-root');
    await primeS3Module();

    const url = saveImageFile(Buffer.from('hello'), 'test-sync.png', 'uploads');

    expect(url).toBe('/api/serve-upload/uploads/test-sync.png');
    // 本地写盘是同步完成的 — 返回即可读
    expect(fs.existsSync(path.join(dataDir, 'uploads', 'test-sync.png'))).toBe(true);
  });

  it('retries transient S3 failures and succeeds on a later attempt', async () => {
    uploadImageToS3Mock
      .mockResolvedValueOnce(null) // attempt 1 failed
      .mockResolvedValueOnce(null) // attempt 2 failed
      .mockResolvedValueOnce('/images/test-retry.png'); // attempt 3 OK
    const { saveImageFile } = await import('@/lib/server-data-root');
    await primeS3Module();

    vi.useFakeTimers();
    saveImageFile(Buffer.from('data'), 'test-retry.png', 'uploads');
    // 退避序列 200/800/3200ms — 推进足够时间让三次尝试全部执行
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();

    expect(uploadImageToS3Mock).toHaveBeenCalledTimes(3);
    expect(uploadImageToS3Mock).toHaveBeenLastCalledWith(
      Buffer.from('data'),
      'test-retry.png',
      'image/png',
    );
  });

  it('never blocks or throws the caller when S3 is permanently down', async () => {
    uploadImageToS3Mock.mockResolvedValue(null);
    const { saveImageFile } = await import('@/lib/server-data-root');
    await primeS3Module();

    // 同步签名：即使 S3 持续失败也立即返回 url，本地文件已可用
    vi.useFakeTimers();
    const url = saveImageFile(Buffer.from('data'), 'test-down.png', 'uploads');
    expect(url).toBe('/api/serve-upload/uploads/test-down.png');

    await vi.advanceTimersByTimeAsync(10000);
    vi.useRealTimers();

    expect(uploadImageToS3Mock).toHaveBeenCalledTimes(4); // 1 + 3 retries
    expect(fs.existsSync(path.join(dataDir, 'uploads', 'test-down.png'))).toBe(true);
  });

  it('skips backup entirely when S3 is not configured', async () => {
    isS3AvailableMock.mockImplementation(() => false);
    const { saveImageFile } = await import('@/lib/server-data-root');
    await primeS3Module();

    const url = saveImageFile(Buffer.from('data'), 'test-nos3.png', 'uploads');
    expect(url).toBe('/api/serve-upload/uploads/test-nos3.png');

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
    expect(uploadImageToS3Mock).not.toHaveBeenCalled();
  });
});
