import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ root: '' }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: (): string => state.root }));
vi.mock('@/lib/asset-core/cleanup-outbox', () => ({ drainPendingAssetCleanup: async () => ({ completed: 0, failed: 0 }), recordAssetCleanupFailure: async () => undefined }));
vi.mock('@/lib/image-source-map', () => ({ saveImageDataMapping: async () => undefined }));
import { uploadBinaryToS3, readBinaryFromS3Exact, deleteBinaryFromS3Exact } from '@/lib/s3-storage';
import { persistAssetBytes } from '@/lib/asset-core/binary-persistence';
import { GET } from '@/app/api/serve-upload/[...path]/route';

describe('exact export media controlled AWS transport', () => {
  let objects: Map<string, { bytes: Buffer; type: string }>;
  let fault: string;
  let requests: string[];
  let bodies: Readable[];
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'task8b2a-s3-'));
    vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'http://127.0.0.1:1');
    vi.stubEnv('COZE_BUCKET_NAME', 'isolated-test');
    objects = new Map(); fault = ''; requests = []; bodies = [];
    vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown): Promise<unknown> => {
      const input = (command as { input: { Key: string; Body?: Buffer; ContentType?: string; Range?: string; IfMatch?: string } }).input;
      requests.push(input.Key);
      if (command instanceof PutObjectCommand) {
        if (objects.has(input.Key)) throw Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
        objects.set(input.Key, { bytes: Buffer.from(input.Body!), type: input.ContentType! });
        return {};
      }
      if (command instanceof DeleteObjectCommand) { objects.delete(input.Key); return {}; }
      const object = objects.get(input.Key);
      if (!object) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      if (command instanceof HeadObjectCommand) return { ContentLength: object.bytes.length, ContentType: object.type, ETag: '"first"', VersionId: 'v1' };
      if (!(command instanceof GetObjectCommand)) throw new Error('unexpected transport command');
      const [start, end] = input.Range ? input.Range.slice(6).split('-').map(Number) : [0, object.bytes.length - 1];
      const bytes = object.bytes.subarray(start, end + 1);
      const body = fault === 'stall' ? new Readable({ read(): void {} }) : Readable.from([
        bytes.subarray(0, Math.floor(bytes.length / 2)),
        fault === 'truncated' ? Buffer.alloc(0) : bytes.subarray(Math.floor(bytes.length / 2)),
        ...(fault === 'overlong' ? [Buffer.from('extra')] : []),
      ]);
      bodies.push(body);
      return { ContentLength: bytes.length, ContentType: fault === 'mime' ? 'text/html' : object.type,
        ContentRange: `bytes ${start}-${end}/${object.bytes.length + (fault === 'total' ? 1 : 0)}`,
        ETag: fault === 'no-identity' ? undefined : fault === 'version' ? '"second"' : '"first"', VersionId: fault === 'no-identity' ? undefined : fault === 'version' ? 'v2' : 'v1', Body: body };
    }) as never);
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(state.root, { recursive: true, force: true }); });

  it.each(['mp4', 'webm'] as const)('restores real %s through S3 and serves a verified small Range without changing the hash', async extension => {
    const fixture = extension === 'mp4' ? 'yjs-task8b1-tiny-valid.mp4.base64' : 'yjs-task8b2-tiny-valid.webm.base64';
    const bytes = Buffer.from(await readFile(resolve('tests/fixtures', fixture), 'utf8'), 'base64');
    const file = await persistAssetBytes({ bytes, filename: `tiny.${extension}`, mimeType: `video/${extension}` });
    const filename = file.url.split('/').at(-1)!;
    await rm(join(state.root, 'exports', filename));
    const response = await GET(new NextRequest(`http://localhost${file.url}`, { headers: { Range: 'bytes=0-7' } }), { params: Promise.resolve({ path: ['exports', filename] }) });
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(0, 8));
    const restored = await readFile(join(state.root, 'exports', filename));
    expect(createHash('sha256').update(restored).digest('hex')).toBe(file.checksum);
    expect(restored).toEqual(bytes);
    expect(await readdir(join(state.root, 'exports'))).toEqual([filename]);
  });

  it('rejects S3 bytes with a valid transport length but a wrong content digest without publishing', async () => {
    const fixture = Buffer.from(await readFile(resolve('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64'), 'utf8'), 'base64');
    const key = 'exports/0000000000000000-tiny.mp4';
    objects.set(key, { bytes: fixture, type: 'video/mp4' });
    const response = await GET(new NextRequest(`http://localhost/api/serve-upload/${key}`), { params: Promise.resolve({ path: key.split('/') }) });
    expect(response.status).toBe(404);
    expect(await readdir(state.root)).toEqual([]);
  });

  it.each([
    ['gif', 'image/gif'], ['avif', 'image/avif'], ['bmp', 'image/bmp'], ['mp4', 'video/mp4'],
    ['webm', 'video/webm'], ['mov', 'video/quicktime'], ['m4v', 'video/x-m4v'],
  ])('uses the same exact %s object for write/read/delete', async (extension, type) => {
    const filename = `0123456789abcdef-tiny.${extension}`;
    const bytes = Buffer.from('already validated at persistence boundary');
    const uploaded = await uploadBinaryToS3(bytes, filename, type);
    expect(await readBinaryFromS3Exact(`exports/${filename}`)).toEqual(bytes);
    await uploaded!.cleanup();
    expect(objects.size).toBe(0);
    expect(new Set(requests)).toEqual(new Set([`exports/${filename}`]));
  });

  it.each(['overlong', 'truncated', 'version', 'total', 'mime', 'no-identity'])('rejects %s exact S3 response', async mode => {
    const key = 'exports/0123456789abcdef-a.zip';
    objects.set(key, { bytes: Buffer.from('12345678'), type: 'application/zip' }); fault = mode;
    await expect(readBinaryFromS3Exact(key)).rejects.toThrow();
    expect(bodies.every(body => body.destroyed)).toBe(true);
  });

  it('bounds caller capacity, times out stalled streams, and honours abort', async () => {
    const key = 'exports/0123456789abcdef-a.mp4';
    objects.set(key, { bytes: Buffer.from('12345678'), type: 'video/mp4' });
    await expect(readBinaryFromS3Exact(key, { maxBytes: 4 })).rejects.toThrow();
    fault = 'stall';
    await expect(readBinaryFromS3Exact(key, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'S3_READ_TIMEOUT' });
    const controller = new AbortController();
    const pending = readBinaryFromS3Exact(key, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'S3_READ_ABORTED' });
  });

  it('does not delete a pre-existing object on cleanup', async () => {
    const key = 'exports/0123456789abcdef-a.mp4';
    objects.set(key, { bytes: Buffer.from('existing'), type: 'video/mp4' });
    const upload = await uploadBinaryToS3(Buffer.from('new'), key.slice(8), 'video/mp4');
    expect(upload!.createdThisCall).toBe(false);
    await upload!.cleanup();
    expect(objects.get(key)?.bytes.toString()).toBe('existing');
  });

  it('rejects arbitrary namespace, nested names and MIME mismatch before transmission', async () => {
    await expect(deleteBinaryFromS3Exact('images/0123456789abcdef-a.mp4')).rejects.toThrow();
    await expect(uploadBinaryToS3(Buffer.from('x'), 'a.mp4', 'video/mp4')).rejects.toThrow();
    await expect(uploadBinaryToS3(Buffer.from('x'), '0123456789abcdef-a.mp4', 'image/png')).rejects.toThrow();
    expect(requests).toEqual([]);
  });
});
