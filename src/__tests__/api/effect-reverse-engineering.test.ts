import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  ownedSource: vi.fn(),
  submit: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.auth }));
vi.mock('@/lib/annotation-project-source', () => ({ findOwnedAnnotationSource: mocks.ownedSource }));
vi.mock('@/lib/effect-reverse-engineering/service', () => ({
  submitEffectReverseTask: mocks.submit,
  getEffectReverseTask: mocks.get,
  cancelEffectReverseTask: mocks.cancel,
  EffectReverseServiceError: class EffectReverseServiceError extends Error {
    constructor(
      public code: string,
      message: string,
      public status = 500,
      public retryable = false,
    ) { super(message); }
  },
}));

const perspective = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
];

function body(overrides: Record<string, unknown> = {}) {
  return {
    action: 'correct',
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'version-1',
    imageUrl: '/api/serve-upload/uploads/source.png',
    perspective,
    regions: [],
    instruction: '',
    ...overrides,
  };
}

describe('/api/effect-reverse-engineering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ authenticated: true, userId: 'user-1', userRole: 'user' });
    mocks.ownedSource.mockResolvedValue({
      projectId: 'project-1', imageId: 'image-1',
      imageUrl: '/api/serve-upload/uploads/source.png', versionId: 'version-1',
    });
    mocks.submit.mockResolvedValue({ taskId: 'effect-reverse-123', status: 'queued' });
    mocks.get.mockResolvedValue({ taskId: 'effect-reverse-123', status: 'correcting' });
    mocks.cancel.mockResolvedValue({ taskId: 'effect-reverse-123', status: 'cancelled' });
  });

  it('rejects an unauthenticated request', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ success: false }, { status: 401 }));
    const { POST } = await import('@/app/api/effect-reverse-engineering/route');
    const response = await POST(new NextRequest('http://localhost/api/effect-reverse-engineering', {
      method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(401);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('rejects a source outside the owned project', async () => {
    mocks.ownedSource.mockResolvedValue(null);
    const { POST } = await import('@/app/api/effect-reverse-engineering/route');
    const response = await POST(new NextRequest('http://localhost/api/effect-reverse-engineering', {
      method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'EFFECT_REVERSE_SOURCE_NOT_FOUND' });
  });

  it.each([
    [{ sourceVersionId: 'stale' }, 'EFFECT_REVERSE_SOURCE_STALE'],
    [{ imageUrl: '/api/serve-upload/uploads/other.png' }, 'EFFECT_REVERSE_SOURCE_MISMATCH'],
  ])('rejects a stale or mismatched source', async (overrides, code) => {
    const { POST } = await import('@/app/api/effect-reverse-engineering/route');
    const response = await POST(new NextRequest('http://localhost/api/effect-reverse-engineering', {
      method: 'POST', body: JSON.stringify(body(overrides)), headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('returns an application task id before correction runs', async () => {
    const { POST } = await import('@/app/api/effect-reverse-engineering/route');
    const response = await POST(new NextRequest('http://localhost/api/effect-reverse-engineering', {
      method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      success: true, taskId: 'effect-reverse-123', status: 'queued',
    });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', action: 'correct', request: expect.objectContaining({ projectId: 'project-1' }),
    }));
  });

  it('rejects declared and streamed bodies above 256 KiB', async () => {
    const { POST } = await import('@/app/api/effect-reverse-engineering/route');
    for (const request of [
      new NextRequest('http://localhost/api/effect-reverse-engineering', {
        method: 'POST', body: JSON.stringify(body()),
        headers: { 'content-type': 'application/json', 'content-length': String(256 * 1024 + 1) },
      }),
      new NextRequest('http://localhost/api/effect-reverse-engineering', {
        method: 'POST', body: JSON.stringify(body({ padding: 'x'.repeat(256 * 1024) })),
        headers: { 'content-type': 'application/json' },
      }),
    ]) {
      const response = await POST(request);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({ code: 'EFFECT_REVERSE_BODY_TOO_LARGE' });
    }
  });

  it('gets and cancels tasks using the authenticated identity', async () => {
    const { GET, DELETE } = await import('@/app/api/effect-reverse-engineering/route');
    await GET(new NextRequest('http://localhost/api/effect-reverse-engineering?taskId=effect-reverse-123'));
    await DELETE(new NextRequest('http://localhost/api/effect-reverse-engineering?taskId=effect-reverse-123'));
    expect(mocks.get).toHaveBeenCalledWith({ taskId: 'effect-reverse-123', userId: 'user-1', userRole: 'user' });
    expect(mocks.cancel).toHaveBeenCalledWith({ taskId: 'effect-reverse-123', userId: 'user-1', userRole: 'user' });
  });
});
