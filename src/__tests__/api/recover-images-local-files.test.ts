import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dataRoot: '',
  downloadImageFromS3: vi.fn(),
  execSql: vi.fn(),
  getImageSourceUrl: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  recordLegacyRecoveryOutcome: vi.fn(),
  requireApiAuthOrReject: vi.fn(),
  uploadImageToS3: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/asset-core/media-health', () => ({ recordLegacyRecoveryOutcome: mocks.recordLegacyRecoveryOutcome }));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql }));
vi.mock('@/lib/image-source-map', () => ({ getImageSourceUrl: mocks.getImageSourceUrl }));
vi.mock('@/lib/s3-storage', () => ({
  downloadImageFromS3: mocks.downloadImageFromS3,
  uploadImageToS3: mocks.uploadImageToS3,
}));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => mocks.dataRoot }));
vi.mock('coze-coding-dev-sdk', () => ({
  S3Storage: class {
    listFiles = mocks.listFiles;
    readFile = mocks.readFile;
  },
}));

import { POST } from '@/app/api/recover-images/route';

function request(action: string, filename?: string): NextRequest {
  const url = new URL('http://localhost/api/recover-images');
  url.searchParams.set('action', action);
  if (filename) url.searchParams.set('filename', filename);
  return new NextRequest(url, { method: 'POST' });
}

describe('recover-images real local files', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.dataRoot = await mkdtemp(path.join(tmpdir(), 'wujie-recover-'));
    mocks.requireApiAuthOrReject.mockResolvedValue({ userRole: 'admin' });
    mocks.getImageSourceUrl.mockResolvedValue(null);
    mocks.recordLegacyRecoveryOutcome.mockResolvedValue({ matchedVersions: 0 });
    mocks.uploadImageToS3.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(mocks.dataRoot, { recursive: true, force: true });
  });

  it('scans real uploads and reports only the missing file', async () => {
    const uploads = path.join(mocks.dataRoot, 'uploads');
    await mkdir(uploads);
    await writeFile(path.join(uploads, '原图.png'), 'original');
    mocks.execSql.mockResolvedValue({ rows: [
      { local_path: '原图.png', user_name: 'Owner' },
      { local_path: '缺失.png', user_name: 'Owner' },
    ] });

    const response = await POST(request('scan'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totalImages: 2,
      existingImages: 1,
      missingImages: 1,
      details: [{ localPath: '缺失.png', filename: '缺失.png' }],
    });
    await expect(readFile(path.join(uploads, '原图.png'), 'utf8')).resolves.toBe('original');
  });

  it('creates a missing nested directory and writes the S3 recovery bytes there', async () => {
    mocks.downloadImageFromS3.mockResolvedValue(Buffer.from('s3-image'));

    const response = await POST(request('recover', 'uploads/nested/image.png'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      filename: 'uploads/nested/image.png', success: true, method: 's3',
    });
    await expect(readFile(path.join(mocks.dataRoot, 'uploads', 'nested', 'image.png'), 'utf8'))
      .resolves.toBe('s3-image');
  });

  it('creates a missing nested directory for source-URL recovery', async () => {
    mocks.downloadImageFromS3.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue('https://source.test/image.png');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('source-image', { status: 200 })));

    const response = await POST(request('recover', 'uploads/from-source/image.png'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      filename: 'uploads/from-source/image.png', success: true, method: 'sourceUrl',
    });
    await expect(readFile(path.join(mocks.dataRoot, 'uploads', 'from-source', 'image.png'), 'utf8'))
      .resolves.toBe('source-image');
  });

  it('skips existing S3-sync files and writes only the new image', async () => {
    vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'https://s3.test');
    vi.stubEnv('COZE_BUCKET_NAME', 'images');
    const uploads = path.join(mocks.dataRoot, 'uploads');
    await mkdir(uploads);
    await writeFile(path.join(uploads, 'gen-existing.png'), 'keep-me');
    mocks.listFiles.mockResolvedValue({
      keys: ['images/gen-existing_deadbeef.png', 'images/gen-new_deadbeef.png'],
      nextContinuationToken: undefined,
    });
    mocks.readFile.mockResolvedValue(Buffer.from('new-image'));

    const response = await POST(request('sync-s3'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totalS3Images: 2, downloaded: 1, skipped: 1, failed: 0,
    });
    await expect(readFile(path.join(uploads, 'gen-existing.png'), 'utf8')).resolves.toBe('keep-me');
    await expect(readFile(path.join(uploads, 'gen-new.png'), 'utf8')).resolves.toBe('new-image');
  });

  it('creates the uploads directory when S3 sync has no local files yet', async () => {
    vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'https://s3.test');
    vi.stubEnv('COZE_BUCKET_NAME', 'images');
    mocks.listFiles.mockResolvedValue({
      keys: ['images/gen-fresh_deadbeef.png'],
      nextContinuationToken: undefined,
    });
    mocks.readFile.mockResolvedValue(Buffer.from('fresh-image'));

    const response = await POST(request('sync-s3'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totalS3Images: 1, downloaded: 1, skipped: 0, failed: 0,
    });
    await expect(readFile(path.join(mocks.dataRoot, 'uploads', 'gen-fresh.png'), 'utf8'))
      .resolves.toBe('fresh-image');
  });

  it('rejects a recovery path through a symlink before reading S3 or writing outside the managed root', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-recover-outside-'));
    try {
      await symlink(outside, path.join(mocks.dataRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      mocks.downloadImageFromS3.mockResolvedValue(Buffer.from('must-not-write'));

      const response = await POST(request('recover', 'escape/image.png'));

      expect(response.status).toBe(400);
      await expect(readFile(path.join(outside, 'image.png')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(mocks.downloadImageFromS3).not.toHaveBeenCalled();
      expect(mocks.recordLegacyRecoveryOutcome).not.toHaveBeenCalled();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('does not write S3-sync images through a linked uploads directory outside the managed root', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-sync-outside-'));
    try {
      await symlink(outside, path.join(mocks.dataRoot, 'uploads'), process.platform === 'win32' ? 'junction' : 'dir');
      vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'https://s3.test');
      vi.stubEnv('COZE_BUCKET_NAME', 'images');
      mocks.listFiles.mockResolvedValue({ keys: ['images/gen-escape_deadbeef.png'] });
      mocks.readFile.mockResolvedValue(Buffer.from('must-not-write'));

      const response = await POST(request('sync-s3'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ downloaded: 0, failed: 1 });
      await expect(readFile(path.join(outside, 'gen-escape.png')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('does not count a file outside the managed root through a linked uploads directory during scan', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-scan-outside-'));
    try {
      await writeFile(path.join(outside, 'image.png'), 'outside');
      await symlink(outside, path.join(mocks.dataRoot, 'uploads'), process.platform === 'win32' ? 'junction' : 'dir');
      mocks.execSql.mockResolvedValue({ rows: [{ local_path: 'image.png', user_name: 'Owner' }] });

      const response = await POST(request('scan'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        totalImages: 1, existingImages: 0, missingImages: 1,
        details: [{ localPath: 'image.png' }],
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects an uploads junction installed during the S3 download before writing recovery bytes', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-recover-swap-'));
    try {
      const uploads = path.join(mocks.dataRoot, 'uploads');
      await mkdir(uploads);
      mocks.downloadImageFromS3.mockImplementation(async () => {
        await rm(uploads, { recursive: true });
        await symlink(outside, uploads, process.platform === 'win32' ? 'junction' : 'dir');
        return Buffer.from('must-not-write');
      });

      const response = await POST(request('recover', 'uploads/image.png'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ success: false, method: 's3' });
      await expect(readFile(path.join(outside, 'image.png')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects an uploads junction installed during source-URL fetch before writing recovery bytes', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-source-swap-'));
    try {
      const uploads = path.join(mocks.dataRoot, 'uploads');
      await mkdir(uploads);
      mocks.downloadImageFromS3.mockResolvedValue(null);
      mocks.getImageSourceUrl.mockResolvedValue('https://source.test/image.png');
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
        await rm(uploads, { recursive: true });
        await symlink(outside, uploads, process.platform === 'win32' ? 'junction' : 'dir');
        return new Response('must-not-write', { status: 200 });
      }));

      const response = await POST(request('recover', 'uploads/image.png'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ success: false, method: 'sourceUrl' });
      await expect(readFile(path.join(outside, 'image.png')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects an uploads junction installed during S3 sync read before writing bytes', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wujie-sync-swap-'));
    try {
      const uploads = path.join(mocks.dataRoot, 'uploads');
      await mkdir(uploads);
      vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'https://s3.test');
      vi.stubEnv('COZE_BUCKET_NAME', 'images');
      mocks.listFiles.mockResolvedValue({ keys: ['images/gen-swap_deadbeef.png'] });
      mocks.readFile.mockImplementation(async () => {
        await rm(uploads, { recursive: true });
        await symlink(outside, uploads, process.platform === 'win32' ? 'junction' : 'dir');
        return Buffer.from('must-not-write');
      });

      const response = await POST(request('sync-s3'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ downloaded: 0, failed: 1 });
      await expect(readFile(path.join(outside, 'gen-swap.png')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
