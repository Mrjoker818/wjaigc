import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync, type ChildProcess } from 'node:child_process';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  spawnArchive: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: mocks.requireAdminUser,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => mocks.spawnArchive(...args) ?? actual.spawn(...args),
  };
});

import { GET, POST } from '@/app/api/export-project/route';

async function withSlowArchive(firstChunk: boolean, check: (archive: Promise<ChildProcess>) => Promise<void>) {
  const { spawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const root = await mkdtemp(path.join(tmpdir(), 'wujie-export-interrupted-'));
  await mkdir(path.join(root, 'src'));
  vi.stubEnv('COZE_WORKSPACE_PATH', root);
  mocks.requireAdminUser.mockResolvedValue({ id: 'admin' });
  let child: ChildProcess | undefined;
  const archive = new Promise<ChildProcess>(resolve => {
    mocks.spawnArchive.mockImplementationOnce((_program, _args, options) => {
      const script = (firstChunk ? 'process.stdout.write("first chunk");' : '') + 'setInterval(() => {}, 1000);';
      child = spawn(process.execPath, ['-e', script], options);
      resolve(child);
      return child;
    });
  });
  try {
    await check(archive);
  } finally {
    child?.kill();
    mocks.spawnArchive.mockReset();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}

function hasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

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

  it('exports real source files from the application directory with no Coze workspace override', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-export-app-directory-'));
    vi.stubEnv('COZE_WORKSPACE_PATH', '');
    vi.resetModules();
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin' });
    const cwd = vi.spyOn(process, 'cwd');
    try {
      const { POST: postFromApplicationDirectory } = await import('@/app/api/export-project/route');
      await mkdir(path.join(root, 'src'));
      await writeFile(path.join(root, 'src', 'entry.ts'), 'export {}');
      cwd.mockReturnValue(root);
      const response = await postFromApplicationDirectory(new NextRequest('http://localhost/api/export-project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'source' }),
      }));
      expect(response.status).toBe(200);
      const archive = Buffer.from(await response.arrayBuffer());
      const listing = spawnSync('tar', ['-tzf', '-'], { input: archive, encoding: 'utf8' });
      expect(listing.status).toBe(0);
      expect(listing.stdout).toContain('src/entry.ts');
    } finally {
      cwd.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns an error for an unavailable export workspace before opening a download', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-export-unavailable-'));
    vi.stubEnv('COZE_WORKSPACE_PATH', path.join(root, 'missing'));
    vi.resetModules();
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin' });
    try {
      const { GET: getExport } = await import('@/app/api/export-project/route');
      const response = await getExport(new NextRequest('http://localhost/api/export-project?scope=source'));
      expect(response.status).toBe(500);
      expect(response.headers.get('content-disposition')).toBeNull();
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('workspace is unavailable') });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await rm(root, { recursive: true, force: true });
    }
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

  it('exports source and ordinary data with no runtime configuration files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-export-runtime-env-'));
    vi.stubEnv('COZE_WORKSPACE_PATH', root);
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin' });
    try {
      await mkdir(path.join(root, 'src'));
      await mkdir(path.join(root, 'data', 'system'), { recursive: true });
      await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
      await writeFile(path.join(root, 'src', 'entry.ts'), 'export {}');
      await writeFile(path.join(root, 'package.json'), '{}');
      await writeFile(path.join(root, 'data', 'ordinary.txt'), 'fixture');
      await writeFile(path.join(root, 'data', 'system', 'config.txt'), 'fixture');
      await writeFile(path.join(root, '.env.local'), 'QA_FIXTURE=placeholder');
      await writeFile(path.join(root, '.env.example'), 'QA_FIXTURE=');
      await writeFile(path.join(root, '.env.example.local'), 'QA_FIXTURE=placeholder');
      await writeFile(path.join(root, 'src', '.env'), 'QA_FIXTURE=placeholder');
      await writeFile(path.join(root, 'src', '.env.example'), 'QA_FIXTURE=placeholder');
      await writeFile(path.join(root, 'src', 'nested', '.env.example'), 'QA_FIXTURE=placeholder');
      const response = await GET(new NextRequest('http://localhost/api/export-project?scope=full'));
      expect(response.status).toBe(200);
      const listing = spawnSync('tar', ['-tzf', '-'], {
        input: Buffer.from(await response.arrayBuffer()), encoding: 'utf8',
      });
      expect(listing.status).toBe(0);
      const entries = listing.stdout.split(/\r?\n/u).map(entry => entry.replace(/^\.\//u, ''));
      expect(entries).toContain('src/entry.ts');
      expect(entries).toContain('package.json');
      expect(entries).toContain('data/ordinary.txt');
      expect(entries).toContain('.env.example');
      expect(entries).not.toContain('data/system/config.txt');
      expect(entries).not.toContain('.env.local');
      expect(entries).not.toContain('.env.example.local');
      expect(entries).not.toContain('src/.env');
      expect(entries).not.toContain('src/.env.example');
      expect(entries).not.toContain('src/nested/.env.example');
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('terminates the archive child when the request aborts before the first chunk', async () => {
    await withSlowArchive(false, async archive => {
      const abort = new AbortController();
      const response = GET(new NextRequest('http://localhost/api/export-project?scope=full', { signal: abort.signal }));
      const child = await archive;
      abort.abort();
      await expect.poll(() => hasExited(child), { timeout: 1500 }).toBe(true);
      expect((await response).status).toBe(499);
    });
  });

  it('terminates the archive child when a body reader cancels a pending read', async () => {
    await withSlowArchive(true, async archive => {
      const response = await GET(new NextRequest('http://localhost/api/export-project?scope=full'));
      expect(response.status).toBe(200);
      const child = await archive;
      const reader = response.body!.getReader();
      expect((await reader.read()).done).toBe(false);
      const next = reader.read();
      const cancelled = reader.cancel();
      await expect.poll(() => hasExited(child), { timeout: 1500 }).toBe(true);
      await cancelled;
      expect((await next).done).toBe(true);
    });
  });
});
