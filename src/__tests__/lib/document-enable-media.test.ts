import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const storage = vi.hoisted(() => ({ head: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/s3-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/s3-storage')>(),
  inspectS3ObjectExact: storage.head, readS3ObjectRangeExact: storage.read,
}));
import { assertDocumentEnableMediaUnchanged, inspectDocumentEnableMedia } from '@/lib/collaboration/document-enable-media';

let root: string;
let mp4: Buffer;
const input = { url: '/api/serve-upload/uploads/video.mp4', kind: 'video' as const };
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'wujie-enable-inspector-'));
});
beforeEach(async () => {
  await mkdir(path.join(root, 'uploads'), { recursive: true });
  vi.stubEnv('WUJIE_DATA_DIR', root);
  mp4 = Buffer.from((await readFile('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', 'utf8')).trim(), 'base64');
  storage.head.mockResolvedValue({ byteSize: mp4.length, contentType: 'video/mp4', eTag: 'original', versionId: null });
});
afterEach(async () => {
  vi.unstubAllEnvs(); storage.head.mockReset(); storage.read.mockReset();
  if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('wujie-enable-inspector-')) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('collaboration enable video source boundaries', () => {
  it('rejects a linked parent inserted after local byte validation', async () => {
    await writeFile(path.join(root, 'uploads/video.mp4'), mp4);
    const inspected = await inspectDocumentEnableMedia(input);
    expect(inspected).not.toBeNull();
    await rename(path.join(root, 'uploads'), path.join(root, 'original-uploads'));
    await symlink(path.join(root, 'original-uploads'), path.join(root, 'uploads'), 'junction');
    await expect(assertDocumentEnableMediaUnchanged({ video: inspected! })).rejects.toBeInstanceOf(Error);
    expect(await readFile(path.join(root, 'original-uploads/video.mp4'))).toEqual(mp4);
  });

  it('rejects a hard-linked file before any remote fallback', async () => {
    await writeFile(path.join(root, 'original.mp4'), mp4);
    await link(path.join(root, 'original.mp4'), path.join(root, 'uploads/video.mp4'));
    await expect(inspectDocumentEnableMedia(input)).rejects.toThrow('DOCUMENT_MEDIA_SOURCE_INVALID');
    expect(storage.head).not.toHaveBeenCalled();
  });

  it('releases the two-inspection budget after pending reads fail', async () => {
    let release!: () => void;
    let bothEntered!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const entered = new Promise<void>(done => { bothEntered = done; });
    let reads = 0;
    storage.read.mockImplementation(async () => {
      if (++reads === 2) bothEntered();
      await gate;
      return null;
    });
    const first = inspectDocumentEnableMedia(input).then(value => value, error => error);
    const second = inspectDocumentEnableMedia(input).then(value => value, error => error);
    try {
      await entered;
      await expect(inspectDocumentEnableMedia(input)).rejects.toThrow('ASSET_MEDIA_BUSY');
      expect(reads).toBe(2);
    } finally { release(); await Promise.all([first, second]); }
    storage.read.mockResolvedValue({ bytes: mp4, totalBytes: mp4.length,
      contentType: 'video/mp4', eTag: 'original', versionId: null });
    const recovered = await inspectDocumentEnableMedia(input);
    expect(recovered).toMatchObject({ url: input.url, byteSize: mp4.length, storageKey: 'images/uploads/video.mp4' });
  });
});
