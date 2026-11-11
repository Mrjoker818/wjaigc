import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'fs/promises';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({ userId: 'video-tools-test', userRole: 'user' }),
}));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => fixture.root }));
vi.mock('fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('fs/promises')>();
  return { ...fs, readFile: vi.fn(fs.readFile) };
});

const runMediaTool = promisify(execFile);
const CLIP_LIMIT = 150 * 1024 * 1024;
const TOO_LARGE = { success: false, error: '视频片段过大，无法合成' };
const sparseSource = '/uploads/sparse.mp4';
const remoteSource = 'https://media-fixture.invalid/clip.mp4';
const fetchFixture = vi.fn<typeof fetch>();
let post: typeof import('@/app/api/video/tools/route').POST;
let duration: number;

beforeAll(async () => {
  fixture.root = await mkdtemp(path.join(path.resolve(tmpdir()), 'wujie-video-tools-bounds-'));
  await mkdir(path.join(fixture.root, 'uploads'));
  await mkdir(path.join(fixture.root, 'generated-videos'));
  const input = path.join(fixture.root, sparseSource.slice(1));
  // A single video frame at zero, followed by audio through the end of the container.
  await runMediaTool('ffmpeg', [
    '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=1:d=1',
    '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono',
    '-c:v', 'mpeg4', '-c:a', 'aac', '-t', '3', input,
  ], { timeout: 15_000, windowsHide: true });
  const { stdout } = await runMediaTool('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', input,
  ], { timeout: 10_000, windowsHide: true });
  const probe = JSON.parse(stdout);
  duration = Number(probe.format.duration);
  expect(duration).toBeGreaterThan(2);
  expect(Number(probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')?.duration)).toBeLessThan(2);
  ({ POST: post } = await import('@/app/api/video/tools/route'));
}, 30_000);

beforeEach(() => {
  fetchFixture.mockReset().mockRejectedValue(new Error('Unexpected fetch in offline video tool test'));
  vi.stubGlobal('fetch', fetchFixture);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(readFile).mockReset();
});

afterAll(async () => {
  if (path.dirname(fixture.root) === path.resolve(tmpdir())
    && path.basename(fixture.root).startsWith('wujie-video-tools-bounds-')) {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function extract(timestamp: unknown, videoUrl = sparseSource): Promise<Response> {
  return post(new NextRequest('http://video-tools.invalid/api/video/tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'extract-frames', mode: 'single', timestamp, videoUrl }),
  }));
}

describe('specified-time video extraction', () => {
  it.each([
    ['missing', undefined], ['negative', -0.25], ['string', '0.25'], ['null', null],
  ])('rejects a %s timestamp before publishing a frame', async (_kind, timestamp) => {
    const outputDir = path.join(fixture.root, 'generated-videos');
    const before = await readdir(outputDir);
    const response = await extract(timestamp);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: expect.any(String) });
    expect(await readdir(outputDir)).toEqual(before);
  });

  it.each([0, 1])('rejects a timestamp %i second(s) after the duration boundary', async offset => {
    const response = await extract(duration + offset);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: expect.any(String) });
  });

  it('reports a missing frame within a sparse video instead of returning the last frame', async () => {
    const outputDir = path.join(fixture.root, 'generated-videos');
    const before = await readdir(outputDir);
    const response = await extract(2);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'FFmpeg did not produce a video frame' });
    expect(await readdir(outputDir)).toEqual(before);
  });
});

describe('video tools source read limit', () => {
  it('cancels a declared oversized response without reading its body', async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    fetchFixture.mockResolvedValueOnce(new Response(body, { headers: { 'Content-Length': String(CLIP_LIMIT + 1) } }));
    const response = await extract(0, remoteSource);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(TOO_LARGE);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('stops an oversized chunked response at the first chunk above the limit', async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++pulls <= 19) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    }, { highWaterMark: 0 });
    const upstream = new Response(body);
    const readAll = vi.spyOn(upstream, 'arrayBuffer').mockRejectedValue(new Error('Unbounded response read'));
    fetchFixture.mockResolvedValueOnce(upstream);
    const response = await extract(0, remoteSource);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(TOO_LARGE);
    expect(readAll).not.toHaveBeenCalled();
    expect(pulls).toBe(19);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('rejects an oversized local file before a whole-file read or a network fallback', async () => {
    const oversizedPath = path.join(fixture.root, 'uploads', 'oversized.mp4');
    await writeFile(oversizedPath, '');
    await truncate(oversizedPath, CLIP_LIMIT + 1);
    vi.mocked(readFile).mockRejectedValueOnce(new Error('Unbounded local file read'));
    const response = await extract(0, '/uploads/oversized.mp4');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(TOO_LARGE);
    expect(readFile).not.toHaveBeenCalled();
    expect(fetchFixture).not.toHaveBeenCalled();
  });
});
