import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  available: false,
  resolveS3Key: vi.fn(),
  getS3PresignedUrl: vi.fn(),
  uploadImageToS3: vi.fn(),
}));
const fetchImage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/s3-storage', () => ({
  isS3Available: () => storage.available,
  deriveS3Key: (p: string) => `images/${p.replace(/^\/+/, '')}`,
  resolveS3Key: storage.resolveS3Key,
  getS3PresignedUrl: storage.getS3PresignedUrl,
  uploadImageToS3: storage.uploadImageToS3,
}));
vi.mock('@/lib/fetch-image-buffer', async original => ({
  ...await original<typeof import('@/lib/fetch-image-buffer')>(),
  fetchImageBuffer: fetchImage,
}));

import { signPublicMediaPath, verifyPublicMediaParts, publicMediaOrigin } from '@/lib/public-media-link';
import { managedMediaPath, publicProjectDomain, toProviderMediaUrl } from '@/lib/provider-media-url';

const SECRET = 'x'.repeat(40);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const NOW = 1_800_000_000_000;

function parts(link: string): string[] {
  return link.replace('/api/public/media/', '').split('/');
}

beforeEach(() => {
  vi.stubEnv('WUJIE_PUBLIC_MEDIA_SECRET', SECRET);
  vi.stubEnv('WUJIE_PUBLIC_MEDIA_ORIGIN', '');
  vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
  storage.available = false;
  storage.resolveS3Key.mockReset();
  storage.getS3PresignedUrl.mockReset();
  storage.uploadImageToS3.mockReset();
  fetchImage.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('signed public media links', () => {
  it('round-trips a media path until it expires', () => {
    const link = signPublicMediaPath('uploads/gen-1.png', { now: NOW, ttlSec: 60 })!;
    expect(link).toMatch(/^\/api\/public\/media\/\d+\/[\w-]+\/uploads\/gen-1\.png$/);
    expect(verifyPublicMediaParts(parts(link), NOW + 30_000)).toBe('uploads/gen-1.png');
    expect(verifyPublicMediaParts(parts(link), NOW + 61_000)).toBeNull();
  });

  it('rejects a tampered path, signature or expiry', () => {
    const [expires, sig] = parts(signPublicMediaPath('uploads/gen-1.png', { now: NOW })!);
    expect(verifyPublicMediaParts([expires, sig, 'uploads', 'gen-2.png'], NOW)).toBeNull();
    expect(verifyPublicMediaParts([expires, `${sig.slice(0, -1)}A`, 'uploads', 'gen-1.png'], NOW)).toBeNull();
    expect(verifyPublicMediaParts([String(Number(expires) + 10), sig, 'uploads', 'gen-1.png'], NOW)).toBeNull();
  });

  it('refuses private, non-media and over-long links', () => {
    for (const p of ['users/u1/a.png', 'system/a.png', 'exports/a.png', 'generated-audio/a.mp3', 'uploads/a.svg', 'uploads/../a.png']) {
      expect(signPublicMediaPath(p, { now: NOW })).toBeNull();
    }
    const farFuture = String(Math.floor(NOW / 1000) + 3 * 24 * 3600);
    expect(verifyPublicMediaParts([farFuture, 'sig', 'uploads', 'gen-1.png'], NOW)).toBeNull();
  });

  it('is disabled without a long secret and ignores a loopback origin', () => {
    vi.stubEnv('WUJIE_PUBLIC_MEDIA_SECRET', 'short');
    expect(signPublicMediaPath('uploads/gen-1.png')).toBeNull();
    vi.stubEnv('WUJIE_PUBLIC_MEDIA_ORIGIN', 'http://127.0.0.1:15179');
    expect(publicMediaOrigin()).toBeNull();
    vi.stubEnv('WUJIE_PUBLIC_MEDIA_ORIGIN', 'https://206-119-173-178.sslip.io/');
    expect(publicMediaOrigin()).toBe('https://206-119-173-178.sslip.io');
  });
});

describe('toProviderMediaUrl', () => {
  it('maps loopback URLs to managed paths and leaves foreign URLs alone', () => {
    expect(managedMediaPath('http://127.0.0.1:15179/api/serve-upload/uploads/a.png?x=1')).toBe('/api/serve-upload/uploads/a.png');
    expect(managedMediaPath('https://cdn.example.com/api/serve-upload/a.png')).toBeNull();
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'http://127.0.0.1:15179');
    expect(publicProjectDomain()).toBe('');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'app.example.com/');
    expect(publicProjectDomain()).toBe('https://app.example.com');
  });

  it('prefers an S3 presigned URL when storage is configured', async () => {
    storage.available = true;
    storage.resolveS3Key.mockResolvedValue('images/uploads/a.png');
    storage.getS3PresignedUrl.mockResolvedValue('https://bucket.example/a.png?sig');
    vi.stubEnv('WUJIE_PUBLIC_MEDIA_ORIGIN', 'https://media.example.com');
    await expect(toProviderMediaUrl('/api/serve-upload/uploads/a.png')).resolves.toBe('https://bucket.example/a.png?sig');
  });

  it('uploads a missing object before presigning it', async () => {
    storage.available = true;
    storage.resolveS3Key.mockResolvedValue(null);
    fetchImage.mockResolvedValue(PNG);
    storage.uploadImageToS3.mockResolvedValue('/images/uploads/a.png');
    storage.getS3PresignedUrl.mockResolvedValue('https://bucket.example/new.png?sig');
    await expect(toProviderMediaUrl('/api/serve-upload/uploads/a.png')).resolves.toBe('https://bucket.example/new.png?sig');
    expect(storage.uploadImageToS3).toHaveBeenCalledWith(PNG, 'uploads/a.png', 'image/png');
    expect(storage.getS3PresignedUrl).toHaveBeenCalledWith('images/uploads/a.png', 7200);
  });

  it('uses a signed public link on a self-hosted origin, then the project domain, then base64', async () => {
    vi.stubEnv('WUJIE_PUBLIC_MEDIA_ORIGIN', 'https://media.example.com');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'https://app.example.com');
    expect(await toProviderMediaUrl('http://127.0.0.1:15179/api/serve-upload/uploads/a.png'))
      .toMatch(/^https:\/\/media\.example\.com\/api\/public\/media\/\d+\/[\w-]+\/uploads\/a\.png$/);

    vi.stubEnv('WUJIE_PUBLIC_MEDIA_ORIGIN', '');
    await expect(toProviderMediaUrl('/api/serve-upload/uploads/a.png')).resolves.toBe('https://app.example.com/api/serve-upload/uploads/a.png');

    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'http://127.0.0.1:15179');
    fetchImage.mockResolvedValue(PNG);
    await expect(toProviderMediaUrl('/api/serve-upload/uploads/a.png')).resolves.toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });

  it('passes public and data URLs through and drops unreadable local files', async () => {
    await expect(toProviderMediaUrl('https://cdn.example.com/a.png')).resolves.toBe('https://cdn.example.com/a.png');
    await expect(toProviderMediaUrl('data:image/png;base64,AAAA')).resolves.toBe('data:image/png;base64,AAAA');
    fetchImage.mockRejectedValue(new Error('missing'));
    await expect(toProviderMediaUrl('/api/serve-upload/uploads/missing.png')).resolves.toBeUndefined();
    await expect(toProviderMediaUrl('/api/serve-upload/users/u1/a.png')).resolves.toBeUndefined();
  });
});
