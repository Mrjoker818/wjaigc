import { link, mkdtemp, mkdir, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockData = vi.hoisted(() => ({ root: '' }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => mockData.root }));

import { readImageToBuffer } from '@/lib/image-tools/file';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('image-tools local image read boundary', () => {
  beforeEach(async () => {
    mockData.root = await mkdtemp(path.join(tmpdir(), 'wujie-image-tools-read-'));
    await mkdir(path.join(mockData.root, 'uploads'));
  });

  afterEach(async () => {
    const resolved = path.resolve(mockData.root);
    if (path.dirname(resolved) !== path.resolve(tmpdir())
      || !path.basename(resolved).startsWith('wujie-image-tools-read-')) {
      throw new Error('Refusing to remove an unexpected test directory');
    }
    await rm(resolved, { recursive: true, force: true });
  });

  it('reads a valid managed upload without a network round trip', async () => {
    await writeFile(path.join(mockData.root, 'uploads', 'safe.png'), PNG);

    const result = await readImageToBuffer('/api/serve-upload/safe.png');

    expect(result.buffer).toEqual(PNG);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.format).toBe('png');
  });

  it('preserves the legacy managed data-root and outputs locations', async () => {
    const thumbnails = path.join(mockData.root, 'thumbnails', 'version-a');
    await mkdir(thumbnails, { recursive: true });
    await writeFile(path.join(thumbnails, '512.png'), PNG);
    await writeFile(path.join(mockData.root, 'uploads', 'output.png'), PNG);

    const legacy = await readImageToBuffer('/api/serve-upload/thumbnails/version-a/512.png');
    const output = await readImageToBuffer('/outputs/output.png');

    expect(legacy.buffer).toEqual(PNG);
    expect(output.buffer).toEqual(PNG);
  });

  it('rejects a traversal into a private file beside uploads', async () => {
    await writeFile(path.join(mockData.root, 'private.png'), PNG);

    await expect(readImageToBuffer('/api/serve-upload/../private.png'))
      .rejects.toThrow(/Unsafe local media path/);
  });

  it('rejects an outputs URL that climbs into a private data-root file', async () => {
    await writeFile(path.join(mockData.root, 'private.png'), PNG);

    await expect(readImageToBuffer('/outputs/../../private.png'))
      .rejects.toThrow(/Unsafe local media path/);
  });

  it('rejects a linked upload that points to a private in-root file', async () => {
    await writeFile(path.join(mockData.root, 'private.png'), PNG);
    await symlink(
      path.join(mockData.root, 'private.png'),
      path.join(mockData.root, 'uploads', 'linked.png'),
      'file',
    );

    await expect(readImageToBuffer('/api/serve-upload/linked.png'))
      .rejects.toThrow(/Unsafe local media path/);
  });

  it('rejects an uploads directory link into the private users namespace', async () => {
    const users = path.join(mockData.root, 'users');
    await mkdir(users);
    await writeFile(path.join(users, 'private.png'), PNG);
    await rmdir(path.join(mockData.root, 'uploads'));
    await symlink(users, path.join(mockData.root, 'uploads'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(readImageToBuffer('/api/serve-upload/private.png'))
      .rejects.toThrow(/Unsafe local media path/);
  });

  it('rejects a hard-linked upload that aliases a private file', async () => {
    const privatePath = path.join(mockData.root, 'private.png');
    await writeFile(privatePath, PNG);
    await link(privatePath, path.join(mockData.root, 'uploads', 'linked.png'));

    await expect(readImageToBuffer('/api/serve-upload/linked.png'))
      .rejects.toThrow(/Unsafe local media path/);
  });

  it('does not let an upscale input bypass the public media route private namespace', async () => {
    const users = path.join(mockData.root, 'users');
    await mkdir(users);
    await writeFile(path.join(users, 'private.png'), PNG);

    await expect(readImageToBuffer('/api/serve-upload/users/private.png'))
      .rejects.toThrow(/Unsafe local media path/);
  });

  it('rejects an image larger than the configured local limit', async () => {
    const { readImageToolsLocalFile } = await import('@/lib/image-tools/local-image-reader');
    await writeFile(path.join(mockData.root, 'uploads', 'large.png'), PNG);

    await expect(readImageToolsLocalFile(mockData.root, path.join(mockData.root, 'public'),
      '/api/serve-upload/large.png', 8)).rejects.toThrow(/Invalid local image file/);
  });
});
