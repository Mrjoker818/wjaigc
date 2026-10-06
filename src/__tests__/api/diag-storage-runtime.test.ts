import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAdminUser, getServerDataRoot } = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getServerDataRoot: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot }));

import { GET } from '@/app/api/diag/storage/route';

const directories: string[] = [];

afterEach(async () => {
  requireAdminUser.mockReset();
  getServerDataRoot.mockReset();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('storage diagnostic route', () => {
  it('does not inspect storage for a non-admin request', async () => {
    requireAdminUser.mockResolvedValue(null);
    const response = await GET(new NextRequest('http://localhost/api/diag/storage'));
    expect(response.status).toBe(403);
    expect(getServerDataRoot).not.toHaveBeenCalled();
  });

  it('reports real data-root files, subdirectories and sizes for an admin', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-storage-diagnostic-'));
    directories.push(root);
    await mkdir(path.join(root, 'uploads', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'uploads', 'sample.bin'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(root, 'uploads', 'nested', 'child.bin'), Buffer.from([4, 5]));
    requireAdminUser.mockResolvedValue({ id: 'admin' });
    getServerDataRoot.mockReturnValue(root);

    const response = await GET(new NextRequest('http://localhost/api/diag/storage'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dataRoot).toBe(root);
    expect(body.topLevel).toEqual([{ name: 'uploads', type: 'dir' }]);
    expect(body.directories.uploads).toMatchObject({
      exists: true,
      fileCount: 2,
      totalSizeMB: '0.00',
      sampleFiles: expect.arrayContaining(['nested', 'sample.bin']),
    });
    expect(body.directories['uploads/nested']).toMatchObject({
      exists: true,
      fileCount: 1,
      sampleFiles: ['child.bin'],
    });
    expect(body.directories.images).toEqual({ exists: false });
  });
});
