import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dataRoot: '',
  downloadImageFromS3: vi.fn(),
  readBinaryFromS3Exact: vi.fn(),
  readExactRecoveryMedia: vi.fn(),
  getImageSourceUrl: vi.fn(),
}));

vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => mocks.dataRoot }));
vi.mock('@/lib/s3-storage', () => ({
  deriveS3Key: vi.fn((value: string) => `images/${value}`),
  downloadImageFromS3: mocks.downloadImageFromS3,
  getS3PresignedUrl: vi.fn(),
  readBinaryFromS3Exact: mocks.readBinaryFromS3Exact,
  resolveS3Key: vi.fn(),
}));
vi.mock('@/lib/image-source-map', () => ({ getImageSourceUrl: mocks.getImageSourceUrl }));
vi.mock('@/lib/asset-core/recovery-media', () => ({ readExactRecoveryMedia: mocks.readExactRecoveryMedia }));
vi.mock('@/lib/asset-core/binary-persistence', () => ({
  MAX_ASSET_BINARY_BYTES: 256 * 1024 * 1024,
  recoverExportAssetBytes: vi.fn(),
  validateExportAssetBytes: vi.fn(),
}));

import { GET } from '@/app/api/serve-upload/[...path]/route';

function request(...parts: string[]): ReturnType<typeof GET> {
  const pathname = parts.map(encodeURIComponent).join('/');
  return GET(
    new NextRequest(`http://localhost/api/serve-upload/${pathname}`),
    { params: Promise.resolve({ path: parts }) },
  );
}

describe('serve-upload real local media boundaries', () => {
  const extraRoots: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.dataRoot = await mkdtemp(path.join(tmpdir(), 'wujie-serve-route-'));
    mocks.downloadImageFromS3.mockResolvedValue(null);
    mocks.readBinaryFromS3Exact.mockResolvedValue(null);
    mocks.readExactRecoveryMedia.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue(null);
  });

  afterEach(async () => {
    await rm(mocks.dataRoot, { recursive: true, force: true });
    for (const root of extraRoots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it('serves a normal upload from the managed data root', async () => {
    const uploads = path.join(mocks.dataRoot, 'uploads');
    await mkdir(uploads);
    await writeFile(path.join(uploads, 'safe.webp'), 'safe-image');

    const response = await request('safe.webp');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('safe-image');
    await expect(readFile(path.join(uploads, 'safe.webp'), 'utf8')).resolves.toBe('safe-image');
  });

  it('serves an existing export from local bytes without falling back to S3', async () => {
    const bytes = Buffer.from('{}');
    const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-manifest.json`;
    const exportsRoot = path.join(mocks.dataRoot, 'exports');
    await mkdir(exportsRoot);
    await writeFile(path.join(exportsRoot, filename), bytes);

    const response = await request('exports', filename);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${filename}"`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.readBinaryFromS3Exact).not.toHaveBeenCalled();
  });

  it('caches a missing nested S3 media file under its exact relative path', async () => {
    mocks.downloadImageFromS3.mockResolvedValue(Buffer.from('s3-image'));

    const response = await request('thumbnails', 'version-a', '512.webp');

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('s3-image');
    await expect(readFile(path.join(mocks.dataRoot, 'thumbnails', 'version-a', '512.webp'), 'utf8'))
      .resolves.toBe('s3-image');
  });

  it('does not fall through a missing exact recovery record into legacy local media', async () => {
    const legacy = path.join(mocks.dataRoot, 'uploads', 'recovery');
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, 'private.webp'), 'stale-local');

    const response = await request('recovery', 'private.webp');

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('stale-local');
    expect(mocks.downloadImageFromS3).not.toHaveBeenCalled();
  });

  it('does not serve an outside file through a linked uploads directory', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-serve-outside-'));
    extraRoots.push(outside);
    await writeFile(path.join(outside, 'outside.webp'), 'outside-secret');
    await symlink(outside, path.join(mocks.dataRoot, 'uploads'), process.platform === 'win32' ? 'junction' : 'dir');

    const response = await request('outside.webp');

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('outside-secret');
    expect(mocks.downloadImageFromS3).not.toHaveBeenCalled();
  });

  it('does not expose the private users directory through an in-root linked alias', async () => {
    const privateDir = path.join(mocks.dataRoot, 'users');
    await mkdir(privateDir);
    await writeFile(path.join(privateDir, 'private.webp'), 'private-secret');
    await symlink(privateDir, path.join(mocks.dataRoot, 'uploads'), process.platform === 'win32' ? 'junction' : 'dir');

    const response = await request('private.webp');

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('private-secret');
    expect(mocks.downloadImageFromS3).not.toHaveBeenCalled();
  });

  it('does not serve private bytes through a hardlink in uploads', async () => {
    const privateDir = path.join(mocks.dataRoot, 'users');
    const uploads = path.join(mocks.dataRoot, 'uploads');
    await mkdir(privateDir);
    await mkdir(uploads);
    const privateFile = path.join(privateDir, 'private.webp');
    await writeFile(privateFile, 'private-hardlink-secret');
    await link(privateFile, path.join(uploads, 'public.webp'));

    const response = await request('public.webp');

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('private-hardlink-secret');
    expect(mocks.downloadImageFromS3).not.toHaveBeenCalled();
  });
});
