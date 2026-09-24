import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { pathExistsSync } from '@/lib/runtime-path-exists';

it('recognizes real Unicode files and directories but not missing paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wujie-path-exists-'));
  try {
    const directory = path.join(root, '图片');
    const file = path.join(directory, '作品.json');
    await mkdir(directory);
    await writeFile(file, '{}');

    expect(pathExistsSync(directory)).toBe(true);
    expect(pathExistsSync(file)).toBe(true);
    expect(pathExistsSync(path.join(directory, '缺失.json'))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
