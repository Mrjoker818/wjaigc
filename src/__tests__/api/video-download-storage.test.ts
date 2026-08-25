import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
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
});
