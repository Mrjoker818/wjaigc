import { link, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cacheServeUploadMediaLocal,
  readServeUploadExportLocal,
  readServeUploadMediaLocal,
} from '@/lib/serve-upload-local-storage';

describe('serve-upload local storage', () => {
  let dataRoot: string;
  let workspaceRoot: string;
  const extraRoots: string[] = [];

  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), 'wujie-serve-store-'));
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'wujie-serve-workspace-'));
    await mkdir(path.join(workspaceRoot, 'public', 'uploads'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
    for (const root of extraRoots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it('reads only a bounded regular export and treats a missing export as absent', async () => {
    const exportsRoot = path.join(dataRoot, 'exports');
    await mkdir(exportsRoot);
    await writeFile(path.join(exportsRoot, 'manifest.json'), '{}');

    await expect(readServeUploadExportLocal(dataRoot, 'manifest.json', 8))
      .resolves.toEqual(Buffer.from('{}'));
    await expect(readServeUploadExportLocal(dataRoot, 'missing.json', 8)).resolves.toBeNull();
    await expect(readServeUploadExportLocal(dataRoot, 'manifest.json', 1))
      .rejects.toThrow('Invalid export file');
  });

  it('rejects an exports junction that points outside the managed data root', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-serve-export-outside-'));
    extraRoots.push(outside);
    await writeFile(path.join(outside, 'manifest.json'), '{}');
    await symlink(outside, path.join(dataRoot, 'exports'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(readServeUploadExportLocal(dataRoot, 'manifest.json', 8))
      .rejects.toThrow('Unsafe local media path');
  });

  it('preserves uploads, data-root, then legacy-public read order and backfills legacy bytes', async () => {
    const first = path.join(dataRoot, 'uploads', 'generate', 'image.webp');
    const second = path.join(dataRoot, 'generate', 'image.webp');
    const legacy = path.join(workspaceRoot, 'public', 'uploads', 'image.webp');
    await mkdir(path.dirname(first), { recursive: true });
    await mkdir(path.dirname(second), { recursive: true });
    await writeFile(first, 'uploads');
    await writeFile(second, 'root');
    await writeFile(legacy, 'legacy');

    await expect(readServeUploadMediaLocal(dataRoot, workspaceRoot, 'generate/image.webp'))
      .resolves.toEqual(Buffer.from('uploads'));
    await unlink(first);
    await expect(readServeUploadMediaLocal(dataRoot, workspaceRoot, 'generate/image.webp'))
      .resolves.toEqual(Buffer.from('root'));
    await unlink(second);
    await expect(readServeUploadMediaLocal(dataRoot, workspaceRoot, 'generate/image.webp'))
      .resolves.toEqual(Buffer.from('legacy'));
    await expect(readFile(path.join(dataRoot, 'uploads', 'image.webp')))
      .resolves.toEqual(Buffer.from('legacy'));
  });

  it('does not read a private in-root file through a linked public alias', async () => {
    const privateDir = path.join(dataRoot, 'users');
    await mkdir(privateDir);
    await writeFile(path.join(privateDir, 'secret.webp'), 'private');
    await symlink(privateDir, path.join(dataRoot, 'uploads'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(readServeUploadMediaLocal(dataRoot, workspaceRoot, 'secret.webp'))
      .rejects.toThrow('Unsafe local media path');
  });

  it('does not read a legacy public/uploads junction outside the workspace', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-serve-legacy-outside-'));
    extraRoots.push(outside);
    await writeFile(path.join(outside, 'image.webp'), 'outside');
    await rm(path.join(workspaceRoot, 'public', 'uploads'), { recursive: true });
    await symlink(outside, path.join(workspaceRoot, 'public', 'uploads'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(readServeUploadMediaLocal(dataRoot, workspaceRoot, 'image.webp'))
      .rejects.toThrow('Unsafe local media path');
  });

  it('writes recovered bytes to the exact relative path', async () => {
    cacheServeUploadMediaLocal(dataRoot, 'generate/image.webp', Buffer.from('restored'));

    await expect(readFile(path.join(dataRoot, 'generate', 'image.webp')))
      .resolves.toEqual(Buffer.from('restored'));
  });

  it('does not cache through an outside junction or a final symlink', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-serve-cache-outside-'));
    extraRoots.push(outside);
    await symlink(outside, path.join(dataRoot, 'generate'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => cacheServeUploadMediaLocal(dataRoot, 'generate/image.webp', Buffer.from('unsafe')))
      .toThrow('Unsafe local media path');
    await expect(readFile(path.join(outside, 'image.webp'))).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(path.join(outside, 'target.webp'), 'original');
    await symlink(path.join(outside, 'target.webp'), path.join(dataRoot, 'linked.webp'), 'file');
    expect(() => cacheServeUploadMediaLocal(dataRoot, 'linked.webp', Buffer.from('unsafe')))
      .toThrow('Unsafe local media path');
    await expect(readFile(path.join(outside, 'target.webp'), 'utf8')).resolves.toBe('original');
  });

  it('does not overwrite a private file through a hardlink cache target', async () => {
    const privateDir = path.join(dataRoot, 'users');
    await mkdir(privateDir);
    const privateFile = path.join(privateDir, 'private.webp');
    await writeFile(privateFile, 'private-original');
    await link(privateFile, path.join(dataRoot, 'public.webp'));

    expect(() => cacheServeUploadMediaLocal(dataRoot, 'public.webp', Buffer.from('recovered')))
      .toThrow('Unsafe local media path');
    await expect(readFile(privateFile, 'utf8')).resolves.toBe('private-original');
  });

  it.each(['../secret.webp', '/absolute.webp', 'C:\\Windows\\secret.webp', 'nested\\image.webp', 'bad\0name.webp'])(
    'rejects an unsafe relative path %j before file access',
    async (relativePath) => {
      await expect(readServeUploadMediaLocal(dataRoot, workspaceRoot, relativePath))
        .rejects.toThrow('Unsafe local media path');
      expect(() => cacheServeUploadMediaLocal(dataRoot, relativePath, Buffer.from('unsafe')))
        .toThrow('Unsafe local media path');
    },
  );
});
