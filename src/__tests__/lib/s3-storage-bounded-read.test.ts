import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  awsSend: vi.fn(),
  chunkUploadFile: vi.fn(),
  deleteFile: vi.fn(),
  generatePresignedUrl: vi.fn(),
  readFile: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = mocks.awsSend; },
  PutObjectCommand: class { constructor(readonly input: unknown) {} },
  DeleteObjectCommand: class { constructor(readonly input: unknown) {} },
  GetObjectCommand: class { constructor(readonly input: unknown) {} },
}));

vi.mock('coze-coding-dev-sdk', () => ({
  S3Storage: class {
    chunkUploadFile = mocks.chunkUploadFile;
    deleteFile = mocks.deleteFile;
    generatePresignedUrl = mocks.generatePresignedUrl;
    readFile = mocks.readFile;
    uploadFile = mocks.uploadFile;
  },
}));

describe('readImageFromS3Bounded cancellation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mocks.generatePresignedUrl.mockReset().mockResolvedValue('https://objects.test/exact.png');
    mocks.chunkUploadFile.mockReset().mockResolvedValue('exports/0123456789abcdef-result.zip');
    mocks.deleteFile.mockReset().mockResolvedValue(true);
    mocks.readFile.mockReset().mockResolvedValue(Buffer.from('exact'));
    mocks.uploadFile.mockReset().mockResolvedValue('exports/result.zip');
    mocks.awsSend.mockReset().mockResolvedValue({});
    process.env.COZE_BUCKET_ENDPOINT_URL = 'https://bucket.test';
    process.env.COZE_BUCKET_NAME = 'test-bucket';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('propagates caller cancellation distinctly and aborts the underlying fetch', async () => {
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      fetchSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        fetchSignal?.addEventListener('abort', () => reject(fetchSignal?.reason), { once: true });
      });
    }));
    const controller = new AbortController();
    const { readImageFromS3Bounded } = await import('@/lib/s3-storage');
    const pending = readImageFromS3Bounded('images/exact.png', 1024, 10_000, {
      signal: controller.signal,
      strict: true,
    });

    await vi.waitFor(() => expect(fetchSignal).toBeDefined());
    controller.abort(new DOMException('caller cancelled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({
      name: 'S3BoundedReadError',
      code: 'S3_READ_ABORTED',
    });
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('reports the internal deadline as timeout rather than caller cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }));
    const { readImageFromS3Bounded } = await import('@/lib/s3-storage');

    await expect(readImageFromS3Bounded(
      'images/exact.png',
      1024,
      5,
      { strict: true },
    )).rejects.toMatchObject({
      name: 'S3BoundedReadError',
      code: 'S3_READ_TIMEOUT',
    });
  });

  it('does not swallow a presigned URL storage failure as a missing object', async () => {
    mocks.generatePresignedUrl.mockRejectedValue(new Error('storage unavailable'));
    const { readImageFromS3Bounded } = await import('@/lib/s3-storage');

    await expect(readImageFromS3Bounded(
      'images/exact.png',
      1024,
      1000,
      { strict: true },
    )).rejects.toMatchObject({
      name: 'S3BoundedReadError',
      code: 'S3_READ_FAILED',
    });
  });

  it('removes the caller abort listener after a successful bounded read', async () => {
    const signal = new AbortController().signal;
    const add = vi.spyOn(signal, 'addEventListener');
    const remove = vi.spyOn(signal, 'removeEventListener');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new Uint8Array([1, 2, 3]),
      { status: 200, headers: { 'content-length': '3' } },
    )));
    const { readImageFromS3Bounded } = await import('@/lib/s3-storage');

    await expect(readImageFromS3Bounded(
      'images/exact.png',
      1024,
      1000,
      { signal, strict: true },
    )).resolves.toEqual(Buffer.from([1, 2, 3]));

    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('preserves legacy three-argument failure-as-null behavior', async () => {
    mocks.generatePresignedUrl.mockRejectedValue(new Error('legacy storage failure'));
    const { readImageFromS3Bounded } = await import('@/lib/s3-storage');

    await expect(readImageFromS3Bounded(
      'images/exact.png',
      1024,
      1000,
    )).resolves.toBeNull();
  });

  it('classifies a strict byte overflow without changing legacy null behavior', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new Uint8Array([1, 2, 3]),
      { status: 200, headers: { 'content-length': '3' } },
    )));
    const { readImageFromS3Bounded } = await import('@/lib/s3-storage');

    await expect(readImageFromS3Bounded('images/exact.png', 2, 1000, {
      strict: true,
    })).rejects.toMatchObject({ code: 'S3_READ_SIZE_LIMIT' });
    await expect(readImageFromS3Bounded('images/exact.png', 2, 1000))
      .resolves.toBeNull();
  });

  it('cancels promptly while presigned URL generation is still pending', async () => {
    mocks.generatePresignedUrl.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const { readImageFromS3Bounded } = await import('@/lib/s3-storage');
    const pending = readImageFromS3Bounded('images/exact.png', 1024, 10_000, {
      signal: controller.signal,
      strict: true,
    });

    controller.abort(new DOMException('caller cancelled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ code: 'S3_READ_ABORTED' });
  });

  it('times out while presigned URL generation is still pending', async () => {
    mocks.generatePresignedUrl.mockImplementation(() => new Promise(() => undefined));
    const { readImageFromS3Bounded } = await import('@/lib/s3-storage');

    await expect(readImageFromS3Bounded('images/exact.png', 1024, 5, {
      strict: true,
    })).rejects.toMatchObject({ code: 'S3_READ_TIMEOUT' });
  });

  it('uploads an allowed binary artifact through the non-image path', async () => {
    const { uploadBinaryToS3 } = await import('@/lib/s3-storage');
    await expect(uploadBinaryToS3(
      Buffer.from('PK\u0003\u0004zip'), '0123456789abcdef-result.zip', 'application/zip', new AbortController().signal,
    )).resolves.toMatchObject({ storageKey: 'exports/0123456789abcdef-result.zip', createdThisCall: true });
    expect(mocks.awsSend).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ Key: 'exports/0123456789abcdef-result.zip', IfNoneMatch: '*' }) }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
    expect(mocks.chunkUploadFile).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it('cleans a late uploaded object when cancellation wins the SDK race', async () => {
    let resolveUpload!: () => void;
    mocks.awsSend.mockImplementationOnce(() => new Promise<void>(resolve => { resolveUpload = resolve; }));
    const controller = new AbortController();
    const { uploadBinaryToS3 } = await import('@/lib/s3-storage');
    const pending = uploadBinaryToS3(Buffer.from('{}'), '0123456789abcdef-manifest.json', 'application/json', controller.signal);
    await vi.waitFor(() => expect(resolveUpload).toBeTypeOf('function'));
    controller.abort(new DOMException('cancelled', 'AbortError'));
    let settled = false;
    void pending.finally(() => { settled = true; }).catch(() => undefined);
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveUpload();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.awsSend).toHaveBeenCalledTimes(2);
  });

  it('reports cancellation cleanup failure instead of hiding the last delete error', async () => {
    const controller = new AbortController();
    mocks.awsSend
      .mockImplementationOnce(async () => {
        controller.abort(new DOMException('cancelled', 'AbortError'));
        return {};
      })
      .mockRejectedValueOnce(new Error('delete 1'))
      .mockRejectedValueOnce(new Error('delete 2'))
      .mockRejectedValueOnce(new Error('delete 3'));
    const { uploadBinaryToS3 } = await import('@/lib/s3-storage');
    await expect(uploadBinaryToS3(
      Buffer.from('{}'), '0123456789abcdef-manifest.json', 'application/json', controller.signal,
    )).rejects.toThrow('S3_BINARY_DELETE_FAILED');
    expect(mocks.awsSend).toHaveBeenCalledTimes(4);
  });

  it('reads an export artifact by its exact key without deriving the images namespace', async () => {
    mocks.awsSend.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('exact')) },
    });
    const { readBinaryFromS3Exact } = await import('@/lib/s3-storage');
    await expect(readBinaryFromS3Exact('exports/0123456789abcdef-report.zip')).resolves.toEqual(Buffer.from('exact'));
    expect(mocks.awsSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ Key: 'exports/0123456789abcdef-report.zip' }) }));
  });

  it('retries cleanup after a transient delete failure and only marks it clean after success', async () => {
    mocks.awsSend
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('delete unavailable'))
      .mockResolvedValueOnce({});
    const { uploadBinaryToS3 } = await import('@/lib/s3-storage');
    const uploaded = await uploadBinaryToS3(Buffer.from('{}'), '0123456789abcdef-manifest.json', 'application/json');
    await expect(uploaded?.cleanup()).resolves.toBeUndefined();
    expect(mocks.awsSend).toHaveBeenCalledTimes(3);
  });

  it('keeps cleanup retryable after the bounded delete attempts are exhausted', async () => {
    mocks.awsSend
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('delete unavailable 1'))
      .mockRejectedValueOnce(new Error('delete unavailable 2'))
      .mockRejectedValueOnce(new Error('delete unavailable 3'))
      .mockResolvedValueOnce({});
    const { uploadBinaryToS3 } = await import('@/lib/s3-storage');
    const uploaded = await uploadBinaryToS3(Buffer.from('{}'), '0123456789abcdef-manifest.json', 'application/json');
    await expect(uploaded?.cleanup()).rejects.toThrow('S3_BINARY_DELETE_FAILED');
    await expect(uploaded?.cleanup()).resolves.toBeUndefined();
    expect(mocks.awsSend).toHaveBeenCalledTimes(5);
  });
});
