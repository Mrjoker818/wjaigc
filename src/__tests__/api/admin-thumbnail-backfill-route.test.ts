import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  preview: vi.fn(),
  run: vi.fn(),
  status: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/asset-core/thumbnail-backfill', () => ({
  previewAssetThumbnailBackfill: mocks.preview,
  runAssetThumbnailBackfill: mocks.run,
  getAssetThumbnailBackfillStatus: mocks.status,
}));

import { GET, POST } from '@/app/api/admin/backfill-thumbnails/route';

const request = (body?: unknown) => new NextRequest(
  'http://localhost/api/admin/backfill-thumbnails',
  body === undefined
    ? undefined
    : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
);

describe('administrator thumbnail backfill route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-a', role: 'admin' });
    mocks.preview.mockResolvedValue({ dryRun: true, discovered: 2 });
    mocks.run.mockResolvedValue({ dryRun: false, discovered: 2, completed: 2 });
    mocks.status.mockResolvedValue({ pending: 0, processing: 0, ready: 2, failed: 0 });
  });

  it('rejects unauthenticated status reads before querying the repository', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated mutations before starting work', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);
    const response = await POST(request({ dryRun: false }));
    expect(response.status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('returns durable state counts to an administrator', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, ready: 2 });
  });

  it('runs a dry preview with the requested bounded limit', async () => {
    const response = await POST(request({ dryRun: true, limit: 25 }));
    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith({ limit: 25 });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('runs a leased batch with the requested bounded limit', async () => {
    const response = await POST(request({ limit: 10 }));
    expect(response.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith({ limit: 10, leaseMs: 300_000 });
  });

  it('rejects a real execution batch above ten while retaining larger dry-run previews', async () => {
    const response = await POST(request({ limit: 11 }));
    expect(response.status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it.each([0, 101, 1.5, '20'])('rejects an invalid limit without invoking work: %s', async (limit) => {
    const response = await POST(request({ limit }));
    expect(response.status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('returns a generic server error without exposing the internal exception', async () => {
    mocks.run.mockRejectedValue(new Error('database password leaked'));
    const response = await POST(request({ limit: 5 }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Thumbnail backfill failed');
    expect(JSON.stringify(body)).not.toContain('database password');
  });
});
