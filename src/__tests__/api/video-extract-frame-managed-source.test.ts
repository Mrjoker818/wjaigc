import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const auth = vi.hoisted(() => ({
  require: vi.fn(), root: vi.fn(), temp: '', tempId: null as string | null,
  failWritePath: '', openedHandle: null as import('node:fs/promises').FileHandle | null,
}));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, tmpdir: (): string => auth.temp };
});
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: (): string => auth.tempId ?? actual.randomUUID() };
});
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>): Promise<import('node:fs/promises').FileHandle> => {
    const handle = await actual.open(...args);
    if (String(args[0]) === auth.failWritePath) {
      auth.openedHandle = handle;
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async (): Promise<void> => {
        await handle.write(Buffer.from('partial write'));
        throw new Error('fixture write failure');
      });
    }
    return handle;
  } };
});
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: auth.require }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: auth.root }));

describe('video last frame uses real CPU and managed private storage', () => {
  let directory: string;
  let temporaryRoot: string;
  let workspace: string;
  let dataRoot: string;
  let post: typeof import('@/app/api/video/extract-frame/route').POST;
  const fixture = fileURLToPath(new URL('../../../tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', import.meta.url));

  beforeEach(async () => {
    temporaryRoot = (await vi.importActual<typeof import('node:os')>('node:os')).tmpdir();
    directory = await mkdtemp(path.join(temporaryRoot, 'wujie-video-extract-frame-'));
    workspace = path.join(directory, 'workspace');
    dataRoot = path.join(directory, 'data');
    await mkdir(workspace);
    await mkdir(dataRoot);
    auth.temp = path.join(directory, 'temp');
    auth.tempId = null;
    auth.failWritePath = '';
    auth.openedHandle = null;
    await mkdir(auth.temp);
    vi.spyOn(process, 'cwd').mockReturnValue(workspace);
    auth.require.mockReset().mockResolvedValue({ id: 'cpu-fixture-actor' });
    auth.root.mockReset().mockReturnValue(dataRoot);
    vi.resetModules();
    post = (await import('@/app/api/video/extract-frame/route')).POST;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (directory && path.basename(directory).startsWith('wujie-video-extract-frame-')
      && path.dirname(path.resolve(directory)) === path.resolve(temporaryRoot)) await rm(directory, { recursive: true, force: true });
  });

  it('decodes last JPEG from private nested managed MP4 without remote fetch or public output', async () => {
    const bytes = Buffer.from(await readFile(fixture, 'utf8'), 'base64');
    const { cacheServeUploadMediaLocal, readServeUploadMediaLocal } = await import('@/lib/serve-upload-local-storage');
    cacheServeUploadMediaLocal(dataRoot, 'uploads/video/cpu-task/valid.mp4', bytes);
    const fetchSpy = vi.fn(async (): Promise<Response> => { throw new Error('Managed source must not use remote fetch'); });
    vi.stubGlobal('fetch', fetchSpy);
    const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: '/api/serve-upload/video/cpu-task/valid.mp4', mode: 'last' }) }));
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as { success: boolean; mode: string; imageUrl: string };
    expect(body).toMatchObject({ success: true, mode: 'last' });
    expect(body.imageUrl).toMatch(/^\/api\/serve-upload\/uploads\/frame-[a-f0-9-]+\.jpg$/);
    const output = await readServeUploadMediaLocal(dataRoot, workspace, body.imageUrl.slice('/api/serve-upload/'.length));
    expect(output).not.toBeNull();
    const decoded = await sharp(output!).metadata();
    expect(decoded.format).toBe('jpeg');
    expect(decoded.width).toBeGreaterThan(0);
    expect(decoded.height).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await readFile(path.join(dataRoot, 'uploads/video/cpu-task/valid.mp4'))).toEqual(bytes);
    expect(existsSync(path.join(workspace, 'public/uploads'))).toBe(false);
  }, 30_000);

  it('does not fetch a missing managed path', async () => {
    const fetchSpy = vi.fn(async (): Promise<Response> => { throw new Error('No network for managed paths'); });
    vi.stubGlobal('fetch', fetchSpy);
    const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: '/api/serve-upload/video/missing.mp4', mode: 'last' }) }));
    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before storage and upstream I/O', async () => {
    auth.require.mockResolvedValue(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
      body: JSON.stringify({ videoUrl: '/api/serve-upload/video/missing.mp4' }) }));
    expect(response.status).toBe(401);
    expect(auth.root).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(path.join(workspace, 'public/uploads'))).toBe(false);
  });

  it.each(['managed', 'remote', 'missing'] as const)('preserves a colliding temporary file for %s requests', async (source) => {
    const bytes = Buffer.from(await readFile(fixture, 'utf8'), 'base64');
    const { cacheServeUploadMediaLocal } = await import('@/lib/serve-upload-local-storage');
    cacheServeUploadMediaLocal(dataRoot, 'uploads/video/collision.mp4', bytes);
    auth.tempId = '11111111-1111-4111-8111-111111111111';
    const collision = path.join(auth.temp, `v-${auth.tempId}.mp4`);
    const existing = Buffer.from('not owned by this request');
    await writeFile(collision, existing, { flag: 'wx' });
    const fetchSpy = vi.fn(async (): Promise<Response> => new Response(new Uint8Array(bytes), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const videoUrl = source === 'remote' ? 'https://media.example.org/collision.mp4'
      : source === 'missing' ? '/api/serve-upload/video/absent.mp4' : '/api/serve-upload/video/collision.mp4';
    const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl }) }));
    expect(response.status).toBe(source === 'missing' ? 404 : 500);
    expect(await readFile(collision)).toEqual(existing);
    expect(await readdir(auth.temp)).toEqual([path.basename(collision)]);
    expect(fetchSpy).toHaveBeenCalledTimes(source === 'remote' ? 1 : 0);
  });

  it('closes an exclusively opened descriptor and removes only its own partial failed write', async () => {
    const bytes = Buffer.from(await readFile(fixture, 'utf8'), 'base64');
    const { cacheServeUploadMediaLocal } = await import('@/lib/serve-upload-local-storage');
    cacheServeUploadMediaLocal(dataRoot, 'uploads/video/write-failure.mp4', bytes);
    auth.tempId = '22222222-2222-4222-8222-222222222222';
    auth.failWritePath = path.join(auth.temp, `v-${auth.tempId}.mp4`);
    const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: '/api/serve-upload/video/write-failure.mp4' }) }));
    expect(response.status).toBe(500);
    expect(auth.openedHandle).not.toBeNull();
    await expect(auth.openedHandle!.stat()).rejects.toMatchObject({ code: 'EBADF' });
    expect(await readdir(auth.temp)).toEqual([]);
    expect(await readFile(path.join(dataRoot, 'uploads/video/write-failure.mp4'))).toEqual(bytes);
  });

  it.each(['/api/serve-upload/video/task-a/missing.mp4', '/api/serve-upload/uploads/video/task-a/missing.mp4'])(
    'does not substitute public basename for missing nested managed URL %s', async (videoUrl) => {
      const bytes = Buffer.from(await readFile(fixture, 'utf8'), 'base64');
      await mkdir(path.join(workspace, 'public/uploads'), { recursive: true });
      const publicFile = path.join(workspace, 'public/uploads/missing.mp4');
      await writeFile(publicFile, bytes);
      const fetchSpy = vi.fn(async (): Promise<Response> => { throw new Error('No network for managed paths'); });
      vi.stubGlobal('fetch', fetchSpy);
      const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl, mode: 'last' }) }));
      expect(response.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await readFile(publicFile)).toEqual(bytes);
      expect(existsSync(path.join(dataRoot, 'uploads/missing.mp4'))).toBe(false);
      expect(await readdir(auth.temp)).toEqual([]);
    },
  );

  it('keeps both exact private roots and default legacy reads compatible', async () => {
    const { cacheServeUploadMediaLocal, readServeUploadMediaLocal } = await import('@/lib/serve-upload-local-storage');
    const uploadBytes = Buffer.from('upload root identity');
    const rootBytes = Buffer.from('data root identity');
    cacheServeUploadMediaLocal(dataRoot, 'uploads/video/upload-root.mp4', uploadBytes);
    cacheServeUploadMediaLocal(dataRoot, 'video/data-root.mp4', rootBytes);
    expect(await readServeUploadMediaLocal(dataRoot, workspace, 'video/upload-root.mp4', false)).toEqual(uploadBytes);
    expect(await readServeUploadMediaLocal(dataRoot, workspace, 'uploads/video/upload-root.mp4', false)).toEqual(uploadBytes);
    expect(await readServeUploadMediaLocal(dataRoot, workspace, 'video/data-root.mp4', false)).toEqual(rootBytes);
    await mkdir(path.join(workspace, 'public/uploads'), { recursive: true });
    const legacyBytes = Buffer.from('legacy consumer identity');
    await writeFile(path.join(workspace, 'public/uploads/legacy.mp4'), legacyBytes);
    expect(await readServeUploadMediaLocal(dataRoot, workspace, 'legacy.mp4', false)).toBeNull();
    expect(await readServeUploadMediaLocal(dataRoot, workspace, 'legacy.mp4')).toEqual(legacyBytes);
  });

  it.each(['/uploads/legacy-flat.mp4', '/api/serve-upload/legacy-flat.mp4'])(
    'explicitly keeps legacy flat URL %s readable', async (videoUrl) => {
      const bytes = Buffer.from(await readFile(fixture, 'utf8'), 'base64');
      await mkdir(path.join(workspace, 'public/uploads'), { recursive: true });
      await writeFile(path.join(workspace, 'public/uploads/legacy-flat.mp4'), bytes);
      const fetchSpy = vi.fn(async (): Promise<Response> => { throw new Error('No network for legacy local paths'); });
      vi.stubGlobal('fetch', fetchSpy);
      const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl, mode: 'last' }) }));
      expect(response.status, await response.clone().text()).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await readdir(auth.temp)).toEqual([]);
    },
    30_000,
  );

  it('decodes the actual blue last frame rather than the red first frame using real ffmpeg', async () => {
    const clip = path.join(dataRoot, 'uploads/video/two-colors.mp4');
    await mkdir(path.dirname(clip), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=10:d=1',
        '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=10:d=1',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[out]', '-map', '[out]',
        '-c:v', 'mpeg4', '-q:v', '2', '-pix_fmt', 'yuv420p', '-threads', '1', clip],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 10_000, windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 && signal === null ? resolve()
        : reject(new Error(`fixture ffmpeg failed (${code}/${signal}): ${stderr.slice(-500)}`)));
    });
    const { readServeUploadMediaLocal } = await import('@/lib/serve-upload-local-storage');
    const fetchSpy = vi.fn(async (): Promise<Response> => { throw new Error('No network for private clip'); });
    vi.stubGlobal('fetch', fetchSpy);
    for (const mode of ['first', 'last'] as const) {
      const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/api/serve-upload/video/two-colors.mp4', mode }) }));
      expect(response.status, await response.clone().text()).toBe(200);
      const body = await response.json() as { success: boolean; mode: string; imageUrl: string };
      expect(body).toMatchObject({ success: true, mode });
      expect(body.imageUrl).toMatch(/^\/api\/serve-upload\/uploads\/frame-[a-f0-9-]+\.jpg$/);
      const jpeg = await readServeUploadMediaLocal(dataRoot, workspace, body.imageUrl.slice('/api/serve-upload/'.length), false);
      expect(jpeg).not.toBeNull();
      const { data, info } = await sharp(jpeg!).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
      expect(info.channels).toBe(3);
      expect(data[center + (mode === 'last' ? 2 : 0)]).toBeGreaterThan(200);
      expect(data[center + (mode === 'last' ? 0 : 2)]).toBeLessThan(40);
      expect(data[center + 1]).toBeLessThan(40);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await readdir(auth.temp)).toEqual([]);
  }, 30_000);

  it('reads canonical exports MP4 instead of a different valid uploads/exports shadow using real CPU', async () => {
    const canonicalClip = path.join(directory, 'canonical-red.mp4');
    const shadowClip = path.join(directory, 'shadow-blue.mp4');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=10:d=1',
        '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=10:d=1',
        '-map', '0:v', '-c:v', 'mpeg4', '-q:v', '2', '-pix_fmt', 'yuv420p', '-threads', '1', canonicalClip,
        '-map', '1:v', '-c:v', 'mpeg4', '-q:v', '2', '-pix_fmt', 'yuv420p', '-threads', '1', shadowClip],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 10_000, windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 && signal === null ? resolve()
        : reject(new Error(`fixture ffmpeg failed (${code}/${signal}): ${stderr.slice(-500)}`)));
    });
    const canonicalBytes = await readFile(canonicalClip);
    const shadowBytes = await readFile(shadowClip);
    expect(canonicalBytes).not.toEqual(shadowBytes);
    const { createHash } = await vi.importActual<typeof import('node:crypto')>('node:crypto');
    const filename = `${createHash('sha256').update(canonicalBytes).digest('hex').slice(0, 16)}-canonical.mp4`;
    const canonicalPath = path.join(dataRoot, 'exports', filename);
    const shadowPath = path.join(dataRoot, 'uploads/exports', filename);
    await mkdir(path.dirname(canonicalPath), { recursive: true });
    await mkdir(path.dirname(shadowPath), { recursive: true });
    await writeFile(canonicalPath, canonicalBytes, { flag: 'wx' });
    await writeFile(shadowPath, shadowBytes, { flag: 'wx' });
    const fetchSpy = vi.fn(async (): Promise<Response> => { throw new Error('No fetch for canonical exports'); });
    vi.stubGlobal('fetch', fetchSpy);
    const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: `/api/serve-upload/exports/${filename}`, mode: 'last' }) }));
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as { success: boolean; mode: string; imageUrl: string };
    expect(body).toMatchObject({ success: true, mode: 'last' });
    expect(body.imageUrl).toMatch(/^\/api\/serve-upload\/uploads\/frame-[a-f0-9-]+\.jpg$/u);
    const { readServeUploadMediaLocal } = await import('@/lib/serve-upload-local-storage');
    const jpeg = await readServeUploadMediaLocal(dataRoot, workspace, body.imageUrl.slice('/api/serve-upload/'.length), false);
    expect(jpeg).not.toBeNull();
    const { data, info } = await sharp(jpeg!).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(info.channels).toBe(3);
    expect(data[center]).toBeGreaterThan(200); // red canonical, not the blue shadow
    expect(data[center + 2]).toBeLessThan(40);
    expect(data[center + 1]).toBeLessThan(40);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await readFile(canonicalPath)).toEqual(canonicalBytes);
    expect(await readFile(shadowPath)).toEqual(shadowBytes);
    expect(await readdir(auth.temp)).toEqual([]);
    expect(existsSync(path.join(workspace, 'public/uploads'))).toBe(false);
  }, 30_000);

  it('returns 404 without fetch when canonical export is missing despite a valid uploads/exports shadow', async () => {
    const bytes = Buffer.from(await readFile(fixture, 'utf8'), 'base64');
    const { createHash } = await vi.importActual<typeof import('node:crypto')>('node:crypto');
    const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-missing.mp4`;
    const shadowPath = path.join(dataRoot, 'uploads/exports', filename);
    await mkdir(path.dirname(shadowPath), { recursive: true });
    await writeFile(shadowPath, bytes, { flag: 'wx' });
    const fetchSpy = vi.fn(async (): Promise<Response> => { throw new Error('No fetch for missing canonical exports'); });
    vi.stubGlobal('fetch', fetchSpy);
    const response = await post(new Request('http://localhost/api/video/extract-frame', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: `/api/serve-upload/exports/${filename}`, mode: 'last' }) }));
    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(path.join(dataRoot, 'exports', filename))).toBe(false);
    expect(await readFile(shadowPath)).toEqual(bytes);
    expect(await readdir(auth.temp)).toEqual([]);
    expect(await readdir(path.join(dataRoot, 'uploads'))).toEqual(['exports']);
    expect(existsSync(path.join(workspace, 'public/uploads'))).toBe(false);
  });
});
