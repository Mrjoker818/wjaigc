import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dataRoot: '',
  requireApiAuthOrReject: vi.fn(),
  saveImageDataMapping: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => mocks.dataRoot }));
vi.mock('@/lib/s3-storage', () => ({
  isS3Available: () => false,
  uploadImageToS3: vi.fn(),
}));
vi.mock('@/lib/image-source-map', () => ({ saveImageDataMapping: mocks.saveImageDataMapping }));

import { POST } from '@/app/api/cache-image/route';

const imageBytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function imageRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cache-image', {
    method: 'POST',
    body: JSON.stringify({ imageUrl: 'https://assets.example/remote.png' }),
  });
}

describe('cache-image real local directories', () => {
  let root: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(path.join(tmpdir(), 'wujie-cache-image-'));
    mocks.dataRoot = path.join(root, 'persistent');
    await mkdir(mocks.dataRoot);
    mocks.requireApiAuthOrReject.mockResolvedValue({ userRole: 'admin' });
    mocks.saveImageDataMapping.mockResolvedValue(undefined);
    vi.stubEnv('COZE_PROJECT_ENV', 'PROD');
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(imageBytes, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('creates missing persistent and public upload directories before saving both copies', async () => {
    const response = await POST(imageRequest());
    const body = await response.json() as { filename: string; imageUrl: string };

    expect(response.status).toBe(200);
    expect(body.imageUrl).toBe(`/api/serve-upload/${body.filename}`);
    expect(await readFile(path.join(mocks.dataRoot, 'uploads', body.filename)))
      .toEqual(Buffer.from(imageBytes));
    expect(await readFile(path.join(root, 'public', 'uploads', body.filename)))
      .toEqual(Buffer.from(imageBytes));
  });

  it('preserves existing upload directories and their files while adding the cached image', async () => {
    const persistentUploads = path.join(mocks.dataRoot, 'uploads');
    const publicUploads = path.join(root, 'public', 'uploads');
    await mkdir(persistentUploads, { recursive: true });
    await mkdir(publicUploads, { recursive: true });
    await writeFile(path.join(persistentUploads, 'keep.txt'), 'persisted');
    await writeFile(path.join(publicUploads, 'keep.txt'), 'published');

    const response = await POST(imageRequest());
    const body = await response.json() as { filename: string };

    expect(response.status).toBe(200);
    expect(await readFile(path.join(persistentUploads, 'keep.txt'), 'utf8')).toBe('persisted');
    expect(await readFile(path.join(publicUploads, 'keep.txt'), 'utf8')).toBe('published');
    expect(await readFile(path.join(persistentUploads, body.filename)))
      .toEqual(Buffer.from(imageBytes));
    expect(await readFile(path.join(publicUploads, body.filename)))
      .toEqual(Buffer.from(imageBytes));
  });
});
