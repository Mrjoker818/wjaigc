import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const { getServerDataRoot } = vi.hoisted(() => ({ getServerDataRoot: vi.fn<() => string>() }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: vi.fn().mockResolvedValue({ userId: 'synthetic-local-media-user' }),
}));

import { GET as getGalleryImage } from '@/app/api/font-design/gallery-image/route';
import { POST as extractText } from '@/app/api/knowledge/extract-text/route';
import { POST as extractFrames } from '@/app/api/video/extract-frames/route';

function jsonRequest(route: string, body: object): NextRequest {
  return new NextRequest(`http://localhost/api/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('packaged media acceptance regressions', () => {
  it('serves an original JPEG using the site-relative gallery path stored in the index', async () => {
    const expected = await readFile('public/gallery/cat-0/g1.jpg');
    const response = await getGalleryImage(new NextRequest('http://localhost/api/font-design/gallery-image?id=g1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
  });

  it('reads only the selected UTF-8 document bytes when extracting a short note', async () => {
    const text = '无界知识库\n第二行。\n';
    const response = await extractText(jsonRequest('knowledge/extract-text', {
      fileUrl: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`,
      fileType: 'txt',
    }));

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.text === text).toBe(true);
  });

  it('extracts six JPEGs from a one-second source when asked to sample uniformly', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'wujie-batch-frames-test-'));
    getServerDataRoot.mockReturnValue(dataRoot);
    try {
      const uploads = path.join(dataRoot, 'uploads');
      await mkdir(uploads);
      await writeFile(path.join(uploads, 'owned-one-second.mp4'), await readFile('tests/fixtures/owned-one-second.mp4'));

      const response = await extractFrames(jsonRequest('video/extract-frames', {
        videoUrl: '/api/serve-upload/owned-one-second.mp4',
        mode: 'uniform',
        count: 6,
      }));

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.frameCount).toBe(6);
      expect(result.frames).toHaveLength(6);
      expect(result.videoInfo).toEqual({ duration: 1, width: 160, height: 90 });
      for (const url of result.frames) {
        const frame = await readFile(path.join(uploads, 'video-frames', path.basename(url)));
        expect([...frame.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      }
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
