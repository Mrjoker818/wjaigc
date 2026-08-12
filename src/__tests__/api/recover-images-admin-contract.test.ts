import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadImageFromS3: vi.fn(),
  getImageSourceUrl: vi.fn(),
  recordLegacyRecoveryOutcome: vi.fn(),
  requireApiAuthOrReject: vi.fn(),
  uploadImageToS3: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/asset-core/media-health', () => ({
  recordLegacyRecoveryOutcome: mocks.recordLegacyRecoveryOutcome,
}));
vi.mock('@/lib/db-client', () => ({ execSql: vi.fn() }));
vi.mock('@/lib/image-source-map', () => ({ getImageSourceUrl: mocks.getImageSourceUrl }));
vi.mock('@/lib/s3-storage', () => ({
  downloadImageFromS3: mocks.downloadImageFromS3,
  uploadImageToS3: mocks.uploadImageToS3,
}));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => 'C:/wujie-data' }));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mocks.existsSync,
      mkdirSync: mocks.mkdirSync,
      writeFileSync: mocks.writeFileSync,
    },
  };
});

import { POST } from '@/app/api/recover-images/route';

const routeFile = path.resolve(process.cwd(), 'src/app/api/recover-images/route.ts');

describe('recover-images authorization contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue({ userRole: 'admin' });
    mocks.existsSync.mockReturnValue(false);
    mocks.recordLegacyRecoveryOutcome.mockResolvedValue({ matchedVersions: 1 });
  });

  it('requires an authenticated administrator for both recovery handlers', () => {
    expect(source.match(/authResult\.userRole !== 'admin'/g)).toHaveLength(2);
    expect(source).toContain("status: 403");
  });

  it('does not retain the public legacy recovery key or trust a body key', () => {
    expect(source).not.toContain('wujie-recovery-2024');
    expect(source).not.toContain('adminKey');
  });

  it('rejects traversal-like single-file recovery paths before file access', () => {
    expect(source).toContain('isSafeRecoveryPath(targetFilename)');
    expect(source).toContain("return NextResponse.json({ error: 'Invalid recovery filename' }, { status: 400 });");
  });

  it('records a successful external recovery before preserving the single-file response shape', async () => {
    mocks.downloadImageFromS3.mockResolvedValue(Buffer.from('restored'));

    const response = await POST(new NextRequest(
      'http://localhost/api/recover-images?action=recover&filename=uploads%2Fimage-a.png',
      { method: 'POST' },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      filename: 'uploads/image-a.png',
      success: true,
      method: 's3',
    });
    expect(mocks.recordLegacyRecoveryOutcome).toHaveBeenCalledWith({
      localPath: 'uploads/image-a.png',
      success: true,
      method: 's3',
    });
    expect(mocks.downloadImageFromS3.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordLegacyRecoveryOutcome.mock.invocationCallOrder[0],
    );
  });

  it('records a proven no-source failure without changing the legacy error response', async () => {
    mocks.downloadImageFromS3.mockResolvedValue(null);
    mocks.getImageSourceUrl.mockResolvedValue(null);

    const response = await POST(new NextRequest(
      'http://localhost/api/recover-images?action=recover&filename=uploads%2Fmissing.png',
      { method: 'POST' },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      filename: 'uploads/missing.png',
      success: false,
      method: 'none',
      error: 'No S3 or sourceUrl available',
    });
    expect(mocks.recordLegacyRecoveryOutcome).toHaveBeenCalledWith({
      localPath: 'uploads/missing.png',
      success: false,
      method: 'none',
      error: 'No S3 or sourceUrl available',
    });
  });
});
