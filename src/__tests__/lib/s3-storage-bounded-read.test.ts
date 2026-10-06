import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  awsSend: vi.fn(),
  middlewareAdd: vi.fn(),
  s3ClientConfig: vi.fn(),
  recordAssetCleanupFailure: vi.fn(),
  chunkUploadFile: vi.fn(),
  deleteFile: vi.fn(),
  generatePresignedUrl: vi.fn(),
  fileExists: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mocks.awsSend;
    middlewareStack = { add: mocks.middlewareAdd };
    constructor(config: unknown) { mocks.s3ClientConfig(config); }
  },
  PutObjectCommand: class { constructor(readonly input: unknown) {} },
  DeleteObjectCommand: class { constructor(readonly input: unknown) {} },
  GetObjectCommand: class { constructor(readonly input: unknown) {} },
  HeadObjectCommand: class { constructor(readonly input: unknown) {} },
}));

vi.mock('coze-coding-dev-sdk', () => ({
  S3Storage: class {
    chunkUploadFile = mocks.chunkUploadFile;
    deleteFile = mocks.deleteFile;
    generatePresignedUrl = mocks.generatePresignedUrl;
    fileExists = mocks.fileExists;
    listFiles = mocks.listFiles;
    readFile = mocks.readFile;
    uploadFile = mocks.uploadFile;
  },
}));
vi.mock('@/lib/asset-core/cleanup-outbox', () => ({
  recordAssetCleanupFailure: mocks.recordAssetCleanupFailure,
}));

describe('readImageFromS3Bounded cancellation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mocks.generatePresignedUrl.mockReset().mockResolvedValue('https://objects.test/exact.png');
    mocks.fileExists.mockReset().mockResolvedValue(true);
    mocks.listFiles.mockReset().mockResolvedValue({ keys: [] });
    mocks.chunkUploadFile.mockReset().mockResolvedValue('exports/0123456789abcdef-result.zip');
    mocks.deleteFile.mockReset().mockResolvedValue(true);
    mocks.readFile.mockReset().mockResolvedValue(Buffer.from('exact'));
    mocks.uploadFile.mockReset().mockResolvedValue('exports/result.zip');
    mocks.awsSend.mockReset().mockResolvedValue({});
    mocks.middlewareAdd.mockReset();
    mocks.s3ClientConfig.mockReset();
    mocks.recordAssetCleanupFailure.mockReset().mockResolvedValue(undefined);
    delete process.env.COZE_WORKLOAD_IDENTITY_API_KEY;
    delete process.env.COZE_BUCKET_ACCESS_KEY;
    delete process.env.COZE_BUCKET_SECRET_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    process.env.COZE_BUCKET_ENDPOINT_URL = 'https://bucket.test';
    process.env.COZE_BUCKET_NAME = 'test-bucket';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('treats an empty legacy object as unavailable', async () => {
    mocks.readFile.mockResolvedValue(Buffer.alloc(0));
    const { downloadImageFromS3 } = await import('@/lib/s3-storage');

    await expect(downloadImageFromS3('video/missing.mp4')).resolves.toBeNull();
    expect(mocks.readFile).toHaveBeenNthCalledWith(1, { fileKey: 'images/video/missing.mp4' });
    expect(mocks.readFile).toHaveBeenNthCalledWith(2, { fileKey: 'images/missing.mp4' });
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

  it('reads a managed upload through its exact images namespace with byte limits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new Uint8Array([1, 2, 3]),
      { status: 200, headers: { 'content-length': '3' } },
    )));
    const { readManagedImageFromS3Bounded } = await import('@/lib/s3-storage');

    await expect(readManagedImageFromS3Bounded(
      'uploads/source.png',
      1024,
      1000,
      { strict: true },
    )).resolves.toEqual(Buffer.from([1, 2, 3]));

    expect(mocks.fileExists).toHaveBeenCalledWith({ fileKey: 'images/uploads/source.png' });
    expect(mocks.generatePresignedUrl).toHaveBeenCalledWith(expect.objectContaining({
      key: 'images/uploads/source.png',
    }));
  });

  it('rejects traversal before consulting object storage', async () => {
    const { readManagedImageFromS3Bounded } = await import('@/lib/s3-storage');

    await expect(readManagedImageFromS3Bounded(
      'uploads/../private.png',
      1024,
      1000,
      { strict: true },
    )).resolves.toBeNull();

    expect(mocks.fileExists).not.toHaveBeenCalled();
    expect(mocks.generatePresignedUrl).not.toHaveBeenCalled();
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

  it('inspects one exact object without listing or fetching a URL', async () => {
    mocks.awsSend.mockResolvedValueOnce({
      ContentLength: 123,
      ContentType: 'image/png',
      ETag: '"etag-1"',
      VersionId: 'version-1',
    });
    const storageModule = await import('@/lib/s3-storage');
    const inspect = (storageModule as unknown as {
      inspectS3ObjectExact: (
        key: string,
        timeoutMs: number,
        signal?: AbortSignal,
      ) => Promise<unknown>;
    }).inspectS3ObjectExact;

    expect(typeof inspect).toBe('function');
    await expect(inspect('images/gateway/exact.png', 1000)).resolves.toEqual({
      byteSize: 123,
      contentType: 'image/png',
      eTag: '"etag-1"',
      versionId: 'version-1',
    });
    expect(mocks.awsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Bucket: 'test-bucket', Key: 'images/gateway/exact.png' },
      }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
    expect(mocks.generatePresignedUrl).not.toHaveBeenCalled();
    expect(mocks.listFiles).not.toHaveBeenCalled();
  });

  it('rejects HEAD metadata without a usable ETag or VersionId', async () => {
    mocks.awsSend.mockResolvedValueOnce({
      ContentLength: 123,
      ContentType: 'image/png',
      ETag: '   ',
      VersionId: '',
    });
    const { inspectS3ObjectExact } = await import('@/lib/s3-storage');

    await expect(inspectS3ObjectExact(
      'images/gateway/unidentified.png',
      1000,
    )).rejects.toMatchObject({ code: 'S3_READ_FAILED' });
  });

  it('rejects an exact range before GetObject when no identity condition is available', async () => {
    const { readS3ObjectRangeExact } = await import('@/lib/s3-storage');

    await expect(readS3ObjectRangeExact(
      'images/gateway/unidentified.png',
      { start: 0, end: 0 },
      {
        expectedTotalBytes: 1,
        maxBytes: 1,
        timeoutMs: 1000,
        eTag: null,
        versionId: null,
      },
    )).rejects.toMatchObject({ code: 'S3_READ_FAILED' });
    expect(mocks.awsSend).not.toHaveBeenCalled();
  });

  it('streams only the requested exact-key byte range and validates object identity', async () => {
    async function* body(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array([2, 3]);
      yield new Uint8Array([4]);
    }
    mocks.awsSend.mockResolvedValueOnce({
      Body: body(),
      ContentLength: 3,
      ContentRange: 'bytes 2-4/10',
    });
    const storageModule = await import('@/lib/s3-storage');
    const readRange = (storageModule as unknown as {
      readS3ObjectRangeExact: (
        key: string,
        range: { start: number; end: number },
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    }).readS3ObjectRangeExact;

    expect(typeof readRange).toBe('function');
    await expect(readRange(
      'images/video/task/exact.mp4',
      { start: 2, end: 4 },
      {
        expectedTotalBytes: 10,
        maxBytes: 3,
        timeoutMs: 1000,
        eTag: '"etag-2"',
        versionId: 'version-2',
      },
    )).resolves.toEqual({ bytes: Buffer.from([2, 3, 4]), totalBytes: 10 });
    expect(mocks.awsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          Bucket: 'test-bucket',
          Key: 'images/video/task/exact.mp4',
          Range: 'bytes=2-4',
          IfMatch: '"etag-2"',
          VersionId: 'version-2',
        },
      }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
    expect(mocks.generatePresignedUrl).not.toHaveBeenCalled();
  });

  it('keeps the exact-range deadline active while the response body is streaming', async () => {
    mocks.awsSend.mockImplementationOnce(async (
      _command: unknown,
      options: { abortSignal: AbortSignal },
    ) => ({
      ContentLength: 1,
      ContentRange: 'bytes 0-0/1',
      Body: {
        async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
          await new Promise<void>((_resolve, reject) => {
            options.abortSignal.addEventListener(
              'abort',
              () => reject(options.abortSignal.reason),
              { once: true },
            );
          });
        },
      },
    }));
    const { readS3ObjectRangeExact } = await import('@/lib/s3-storage');
    const hung = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('range body deadline was cleared too early')), 100);
    });

    await expect(Promise.race([
      readS3ObjectRangeExact('images/gateway/exact.png', { start: 0, end: 0 }, {
        expectedTotalBytes: 1,
        maxBytes: 1,
        timeoutMs: 5,
        eTag: '"etag-1"',
      }),
      hung,
    ])).rejects.toMatchObject({ code: 'S3_READ_TIMEOUT' });
  });

  it('times out and closes a stalled response iterator that ignores SDK abort', async () => {
    const closeIterator = vi.fn(async () => ({ done: true, value: undefined }));
    mocks.awsSend.mockResolvedValueOnce({
      ContentLength: 1,
      ContentRange: 'bytes 0-0/1',
      Body: {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
            return: closeIterator,
          };
        },
      },
    });
    const { readS3ObjectRangeExact } = await import('@/lib/s3-storage');
    const hung = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('non-cooperative range body escaped deadline')), 100);
    });

    await expect(Promise.race([
      readS3ObjectRangeExact('images/gateway/exact.png', { start: 0, end: 0 }, {
        expectedTotalBytes: 1,
        maxBytes: 1,
        timeoutMs: 5,
        eTag: '"etag-1"',
      }),
      hung,
    ])).rejects.toMatchObject({ code: 'S3_READ_TIMEOUT' });
    await vi.waitFor(() => expect(closeIterator).toHaveBeenCalledOnce());
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

  it('matches the installed Coze SDK workload identity storage middleware without logging the token', async () => {
    process.env.COZE_WORKLOAD_IDENTITY_API_KEY = 'secret-workload-token';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { uploadBinaryToS3 } = await import('@/lib/s3-storage');
    await uploadBinaryToS3(Buffer.from('{}'), '0123456789abcdef-manifest.json', 'application/json');
    expect(mocks.middlewareAdd).toHaveBeenCalledWith(expect.any(Function), {
      step: 'build', name: 'injectStorageToken',
    });
    const middleware = mocks.middlewareAdd.mock.calls[0][0];
    const next = vi.fn(async (args: unknown) => args);
    const request = { request: { headers: {} as Record<string, string> } };
    await middleware(next)(request);
    expect(request.request.headers['x-storage-token']).toBe('secret-workload-token');
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain('secret-workload-token');
  });

  it('preserves static access-key credentials while installing the same middleware', async () => {
    process.env.COZE_BUCKET_ACCESS_KEY = 'static-access';
    process.env.COZE_BUCKET_SECRET_KEY = 'static-secret';
    const { uploadBinaryToS3 } = await import('@/lib/s3-storage');
    await uploadBinaryToS3(Buffer.from('{}'), '0123456789abcdef-manifest.json', 'application/json');
    expect(mocks.s3ClientConfig).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://bucket.test',
      region: expect.any(String),
      forcePathStyle: true,
      credentials: { accessKeyId: 'static-access', secretAccessKey: 'static-secret' },
    }));
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
      ContentLength: 5, ContentType: 'application/zip', ETag: '"exact"',
    }).mockResolvedValueOnce({
      ContentLength: 5, ContentRange: 'bytes 0-4/5', ContentType: 'application/zip', ETag: '"exact"',
      Body: { async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> { yield Buffer.from('ex'); yield Buffer.from('act'); } },
    });
    const { readBinaryFromS3Exact } = await import('@/lib/s3-storage');
    await expect(readBinaryFromS3Exact('exports/0123456789abcdef-report.zip')).resolves.toEqual(Buffer.from('exact'));
    expect(mocks.awsSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ Key: 'exports/0123456789abcdef-report.zip' }) }), expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
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
