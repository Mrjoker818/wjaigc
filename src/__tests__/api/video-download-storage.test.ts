import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  getServerDataRoot: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: mocks.getServerDataRoot }));

import { GET } from '@/app/api/video/download/route';

describe('video download managed storage', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), 'wujie-video-download-'));
    mocks.requireApiAuthOrReject.mockReset();
    mocks.requireApiAuthOrReject.mockResolvedValue({ id: 'user-1' });
    mocks.getServerDataRoot.mockReset();
    mocks.getServerDataRoot.mockReturnValue(dataRoot);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('downloads a managed video from the uploads directory used by video persistence', async () => {
    const relativePath = 'video/video-task-1/result.mp4';
    const filePath = path.join(dataRoot, 'uploads', relativePath);
    const expected = Buffer.from('managed-video-content');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, expected);

    const request = new NextRequest(
      `http://localhost/api/video/download?url=${encodeURIComponent(`/api/serve-upload/${relativePath}`)}`,
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
  });

  it.each([
    ['clip.mp4', 'video/mp4', 'mp4'],
    ['clip.webm', 'video/webm', 'webm'],
    ['clip.mov', 'video/quicktime', 'mov'],
    ['clip.m4v', 'video/x-m4v', 'm4v'],
    ['CLIP.MOV?token=not-an-extension.webm', 'video/quicktime', 'mov'],
    ['clip%2Emov#preview', 'video/quicktime', 'mov'],
  ])('preserves local %s bytes and exposes the matching download format', async (filename, mime, extension) => {
    const pathname = decodeURIComponent(filename.split(/[?#]/, 1)[0]);
    const directory = path.join(dataRoot, 'uploads', 'video');
    const expected = Buffer.from([0, 255, 9, 44, 88, 1]);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, pathname), expected);
    const response = await GET(new NextRequest(`http://localhost/api/video/download?url=${encodeURIComponent(`/api/serve-upload/video/${filename}`)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(mime);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="wujie-video.${extension}"`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
  });

  it.each([
    ['https://example.org/result.mp4', 'video/webm', 'webm'],
    ['https://example.org/download?id=clip.mp4', 'Video/QuickTime; codecs=avc1', 'mov'],
    ['https://example.org/result', 'video/x-m4v', 'm4v'],
    ['https://example.org/result.mov', 'video/mp4', 'mp4'],
    ['https://example.org/result.webm?token=clip.mp4', 'application/octet-stream', 'webm'],
    ['https://example.org/result%2Emov', null, 'mov'],
    ['https://example.org/result', null, 'mp4'],
  ])('uses remote MIME then pathname for %s (%s)', async (source, mime, extension) => {
    const expected = new Uint8Array([0, 7, 255, 31]);
    vi.stubGlobal('fetch', async (): Promise<Response> => new Response(expected, {
      headers: mime ? { 'Content-Type': mime } : {},
    }));
    const response = await GET(new NextRequest(`http://localhost/api/video/download?url=${encodeURIComponent(source)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="wujie-video.${extension}"`);
    expect(response.headers.get('content-type')).toBe(mime ?? (extension === 'mov' ? 'video/quicktime' : 'video/mp4'));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
  });

  it('rejects an unauthenticated download before any storage or upstream I/O', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
    mocks.getServerDataRoot.mockImplementation(() => { throw new Error('storage must not be read'); });
    vi.stubGlobal('fetch', async (): Promise<Response> => { throw new Error('upstream must not be read'); });
    const response = await GET(new NextRequest('http://localhost/api/video/download?url=https://example.org/clip.mov'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it.each([403, 503])('preserves upstream failure %s instead of sending a download', async (status) => {
    vi.stubGlobal('fetch', async (): Promise<Response> => new Response('failed', { status }));
    const response = await GET(new NextRequest('http://localhost/api/video/download?url=https://example.org/clip.mov'));
    expect(response.status).toBe(status);
    expect(response.headers.get('content-disposition')).toBeNull();
  });

  it('keeps the declared 150MiB download budget', async () => {
    vi.stubGlobal('fetch', async (): Promise<Response> => new Response('unused', { headers: { 'Content-Length': String(150 * 1024 * 1024 + 1) } }));
    const response = await GET(new NextRequest('http://localhost/api/video/download?url=https://example.org/clip.webm'));
    expect(response.status).toBe(413);
    expect(response.headers.get('content-disposition')).toBeNull();
  });
});
