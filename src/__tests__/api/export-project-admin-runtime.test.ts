import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: mocks.requireAdminUser,
}));

import { GET, POST } from '@/app/api/export-project/route';

describe('project source export administrator boundary', () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockReset();
    mocks.requireAdminUser.mockResolvedValue(null);
  });

  it('rejects anonymous archive downloads before creating a full project export', async () => {
    const response = await GET(new NextRequest('http://localhost/api/export-project?scope=full'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'Admin access required' });
    expect(mocks.requireAdminUser).toHaveBeenCalledTimes(1);
  });

  it('rejects anonymous POST export requests before reading scope', async () => {
    const response = await POST(new NextRequest('http://localhost/api/export-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'full' }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'Admin access required' });
    expect(mocks.requireAdminUser).toHaveBeenCalledTimes(1);
  });

  it('archives present root config files and omits missing optional files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-export-'));
    const originalWorkspace = process.env.COZE_WORKSPACE_PATH;
    try {
      await mkdir(path.join(root, 'src'));
      await mkdir(path.join(root, 'scripts'));
      await writeFile(path.join(root, 'src', 'entry.ts'), 'export {}');
      await writeFile(path.join(root, 'scripts', 'tool.sh'), 'true');
      await writeFile(path.join(root, 'package.json'), '{}');
      await writeFile(path.join(root, 'AGENTS.md'), 'fixture');
      process.env.COZE_WORKSPACE_PATH = root;
      vi.resetModules();
      mocks.requireAdminUser.mockResolvedValue({ id: 'admin' });
      const { GET: getWithWorkspace } = await import('@/app/api/export-project/route');

      const response = await getWithWorkspace(new NextRequest('http://localhost/api/export-project?scope=source-config'));
      expect(response.status).toBe(200);
      const archive = Buffer.from(await response.arrayBuffer());
      const listing = spawnSync('tar', ['-tzf', '-'], { input: archive, encoding: 'utf8' });
      expect(listing.status).toBe(0);
      const entries = listing.stdout.split(/\r?\n/).map((entry) => entry.replace(/^\.\//, ''));
      expect(entries).toContain('src/entry.ts');
      expect(entries).toContain('scripts/tool.sh');
      expect(entries).toContain('package.json');
      expect(entries).toContain('AGENTS.md');
      expect(entries).not.toContain('next.config.ts');
    } finally {
      if (originalWorkspace === undefined) delete process.env.COZE_WORKSPACE_PATH;
      else process.env.COZE_WORKSPACE_PATH = originalWorkspace;
      vi.resetModules();
      await rm(root, { recursive: true, force: true });
    }
  });
});
