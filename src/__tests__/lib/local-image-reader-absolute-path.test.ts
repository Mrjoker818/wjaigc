import { link, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readImageToolsLocalFile } from '@/lib/image-tools/local-image-reader';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let parent: string;
let root: string;
let dataRoot: string;
let publicRoot: string;
beforeEach(async () => {
  if (!process.env.WUJIE_DATA_DIR) throw new Error('A private fixture root is required');
  parent = path.resolve(process.env.WUJIE_DATA_DIR);
  root = await mkdtemp(path.join(parent, 'stage7-local-absolute-'));
  dataRoot = path.join(root, 'managed');
  publicRoot = path.join(root, 'public');
  for (const directory of ['uploads', 'exports', 'thumbnails', 'users', 'system']) {
    await mkdir(path.join(dataRoot, directory), { recursive: true });
  }
  await mkdir(publicRoot);
});
afterEach(async () => {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('stage7-local-absolute-')) {
    throw new Error('Refusing to remove unexpected absolute-path fixture');
  }
  await rm(resolved, { recursive: true, force: true });
});

// POSIX leading-slash references are URL paths; drive-qualified paths are Windows-only.
describe.runIf(process.platform === 'win32')('drive-qualified local media references', () => {
  it.each(['image-tools', 'refine', 'image-edit', 'ordinary'] as const)('reads actual authorized media bytes in %s mode', async mode => {
    for (const directory of [path.join(dataRoot, 'uploads'), path.join(dataRoot, 'exports'), path.join(dataRoot, 'thumbnails'), publicRoot]) {
      const filename = path.join(directory, 'safe.png');
      await writeFile(filename, PNG);
      expect(await readImageToolsLocalFile(dataRoot, publicRoot, filename, 1024, mode)).toEqual(PNG);
    }
  });

  it.each(['users/private.png', 'system/private.png', 'private.png', '../outside.png'])('rejects a non-public absolute reference %s', async relative => {
    const filename = path.resolve(dataRoot, relative);
    await writeFile(filename, PNG);
    await expect(readImageToolsLocalFile(dataRoot, publicRoot, filename, 1024)).rejects.toThrow('Unsafe local media path');
  });

  it('rejects an authorized path that links to a private file', async () => {
    const privateFile = path.join(dataRoot, 'users', 'private.png');
    const filename = path.join(dataRoot, 'uploads', 'linked.png');
    await writeFile(privateFile, PNG);
    await symlink(privateFile, filename, 'file');
    await expect(readImageToolsLocalFile(dataRoot, publicRoot, filename, 1024)).rejects.toThrow('Unsafe local media path');
  });

  it('rejects a hardlinked private file through an authorized absolute path', async () => {
    const privateFile = path.join(dataRoot, 'users', 'private.png');
    const filename = path.join(dataRoot, 'exports', 'linked.png');
    await writeFile(privateFile, PNG);
    await link(privateFile, filename);
    await expect(readImageToolsLocalFile(dataRoot, publicRoot, filename, 1024)).rejects.toThrow('Unsafe local media path');
  });

  it('keeps authorized missing files nullable and actual byte limits enforced', async () => {
    expect(await readImageToolsLocalFile(dataRoot, publicRoot, path.join(dataRoot, 'uploads', 'missing.png'), 1024)).toBeNull();
    const filename = path.join(dataRoot, 'uploads', 'large.png');
    await writeFile(filename, PNG);
    await expect(readImageToolsLocalFile(dataRoot, publicRoot, filename, 8)).rejects.toThrow('Invalid local image file');
  });
});
