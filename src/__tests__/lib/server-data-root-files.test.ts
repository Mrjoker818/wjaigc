import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, it, vi } from 'vitest';

import { migrateLocalDataIfNeeded } from '@/lib/server-data-root';

it('migrates legacy system and users files into an empty persistent directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wujie-data-migrate-'));
  try {
    const local = path.join(root, 'local');
    const persistent = path.join(root, 'persistent');
    await mkdir(path.join(local, 'system'), { recursive: true });
    await mkdir(path.join(local, 'users'), { recursive: true });
    await writeFile(path.join(local, 'system', 'settings.json'), 'local-system');
    await writeFile(path.join(local, 'users', 'one.json'), 'local-user');

    migrateLocalDataIfNeeded(local, persistent);

    expect(await readFile(path.join(persistent, 'system', 'settings.json'), 'utf8')).toBe('local-system');
    expect(await readFile(path.join(persistent, 'users', 'one.json'), 'utf8')).toBe('local-user');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('does not overwrite or augment a persistent directory containing system data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wujie-data-migrate-'));
  try {
    const local = path.join(root, 'local');
    const persistent = path.join(root, 'persistent');
    await mkdir(path.join(local, 'users'), { recursive: true });
    await mkdir(path.join(persistent, 'system'), { recursive: true });
    await writeFile(path.join(local, 'users', 'one.json'), 'local-user');
    await writeFile(path.join(persistent, 'system', 'existing.json'), 'keep');

    migrateLocalDataIfNeeded(local, persistent);

    expect(await readFile(path.join(persistent, 'system', 'existing.json'), 'utf8')).toBe('keep');
    await expect(readFile(path.join(persistent, 'users', 'one.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps synchronous image save, write-directory, and safe deletion in the configured root', async () => {
  const previousDataDir = process.env.WUJIE_DATA_DIR;
  const root = await mkdtemp(path.join(tmpdir(), 'wujie-data-files-'));
  try {
    process.env.WUJIE_DATA_DIR = root;
    vi.resetModules();
    const dataRoot = await import('@/lib/server-data-root');

    expect(dataRoot.getServerDataRoot()).toBe(root);
    expect(dataRoot.getImageWriteDir('generated')).toBe(path.join(root, 'generated'));
    expect(dataRoot.saveImageFile(Buffer.from('image-bytes'), 'one.png', 'generated'))
      .toBe('/api/serve-upload/generated/one.png');
    expect(await readFile(path.join(root, 'generated', 'one.png'), 'utf8')).toBe('image-bytes');
    expect(dataRoot.deleteImageFile('../one.png', 'generated')).toBe(false);
    expect(dataRoot.deleteImageFile('one.png', 'generated')).toBe(true);
    await expect(readFile(path.join(root, 'generated', 'one.png')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    if (previousDataDir === undefined) delete process.env.WUJIE_DATA_DIR;
    else process.env.WUJIE_DATA_DIR = previousDataDir;
    vi.resetModules();
    await rm(root, { recursive: true, force: true });
  }
});
