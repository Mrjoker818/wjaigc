import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getRequestUser: vi.fn(),
  recoverAssetMedia: vi.fn(),
  getAssetMediaRecoveryStatus: vi.fn(),
  executeAssetMediaRecovery: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/server')>();
  return { ...original, after: mocks.after };
});

vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/asset-core/media-health', () => ({
  MediaHealthError: class MediaHealthError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  recoverAssetMedia: mocks.recoverAssetMedia,
  getAssetMediaRecoveryStatus: mocks.getAssetMediaRecoveryStatus,
}));
vi.mock('@/lib/asset-core/media-recovery-worker', () => ({
  executeAssetMediaRecovery: mocks.executeAssetMediaRecovery,
}));

import { GET, POST } from '@/app/api/assets/media/recover/route';
import { MediaHealthError } from '@/lib/asset-core/media-health';

function recoveryRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/assets/media/recover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const body = {
  projectId: 'project-a',
  assetId: 'asset-a',
  assetVersionId: 'version-a',
  placementId: 'placement-a',
};

describe('asset media recovery API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires a session before starting the recovery worker', async () => {
    mocks.getRequestUser.mockResolvedValue(null);
    const response = await POST(recoveryRequest(body));
    expect(response.status).toBe(401);
    expect(mocks.recoverAssetMedia).not.toHaveBeenCalled();
    expect(mocks.executeAssetMediaRecovery).not.toHaveBeenCalled();
  });

  it('injects the authenticated owner and schedules the managed worker after the response', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } });
    mocks.recoverAssetMedia.mockResolvedValue({
      recovered: false,
      availability: 'recovering',
      deferred: true,
    });
    const response = await POST(recoveryRequest({ ...body, actorUserId: 'foreign-owner' }));
    expect(response.status).toBe(200);
    expect(mocks.recoverAssetMedia).toHaveBeenCalledWith({ actorUserId: 'owner-a', ...body }, {
      executeRecovery: mocks.executeAssetMediaRecovery,
      scheduleRecovery: expect.any(Function),
    });
    const dependencies = mocks.recoverAssetMedia.mock.calls[0][1];
    const work = vi.fn(async () => undefined);
    dependencies.scheduleRecovery(work);
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    await mocks.after.mock.calls[0][0]();
    expect(work).toHaveBeenCalledOnce();
  });

  it('polls recovery status without scheduling another worker', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } });
    mocks.getAssetMediaRecoveryStatus.mockResolvedValue({
      recovered: true,
      availability: 'ready',
      deferred: false,
      url: '/api/assets/media/content/version-a',
    });
    const request = new NextRequest(`http://localhost/api/assets/media/recover?${new URLSearchParams(body)}`);

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.getAssetMediaRecoveryStatus).toHaveBeenCalledWith({ actorUserId: 'owner-a', ...body });
    expect(mocks.recoverAssetMedia).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('masks foreign project or asset identifiers behind ASSET_NOT_FOUND', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } });
    mocks.recoverAssetMedia.mockRejectedValue(new MediaHealthError('ASSET_NOT_FOUND'));
    const response = await POST(recoveryRequest({ ...body, projectId: 'foreign-project' }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'ASSET_NOT_FOUND' });
  });
});
