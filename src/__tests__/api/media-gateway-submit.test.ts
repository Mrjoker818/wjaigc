import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateGatewayBearer: vi.fn(),
  recordGatewayAttempt: vi.fn(),
  reserveGatewayRequest: vi.fn(),
  markGatewayAdmitted: vi.fn(),
  markGatewayRejected: vi.fn(),
  submitGatewayImage: vi.fn(),
  submitGatewayVideo: vi.fn(),
  assertGatewayProjectAccess: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/media-gateway/key-service', () => ({
  authenticateGatewayBearer: mocks.authenticateGatewayBearer,
}));
vi.mock('@/lib/media-gateway/admission', () => ({
  recordGatewayAttempt: mocks.recordGatewayAttempt,
  reserveGatewayRequest: mocks.reserveGatewayRequest,
  markGatewayAdmitted: mocks.markGatewayAdmitted,
  markGatewayRejected: mocks.markGatewayRejected,
}));
vi.mock('@/lib/media-gateway/internal-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/media-gateway/internal-client')>()),
  submitGatewayImage: mocks.submitGatewayImage,
  submitGatewayVideo: mocks.submitGatewayVideo,
}));
vi.mock('@/lib/media-gateway/project-access', () => ({
  assertGatewayProjectAccess: mocks.assertGatewayProjectAccess,
}));

import { POST as submitImage } from '@/app/api/gateway/v1/images/route';
import { POST as submitVideo } from '@/app/api/gateway/v1/videos/route';
import { GatewayError } from '@/lib/media-gateway/types';

const principal = {
  keyId: 'gwkey_1', userId: 'user-1', requestsPerMinute: 10, dailyQuota: 100,
};
const attemptPermit = Object.freeze({ permit: 'opaque-test-value' });
const reserved = {
  id: 'gwreq_1', gatewayKeyId: 'gwkey_1', userId: 'user-1',
  idempotencyKey: 'idem-1', requestDigest: 'a'.repeat(64), mediaType: 'image' as const,
  admissionStatus: 'reserved' as const, taskIds: [], rejectionCode: null,
  createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z',
};

function request(path: 'images' | 'videos', body: unknown, headers: Record<string, string> = {}): NextRequest {
  const normalizedBody = body && typeof body === 'object' && !Array.isArray(body)
    ? { projectId: 'project-1', ...body as Record<string, unknown> }
    : body;
  return new NextRequest(`http://localhost/api/gateway/v1/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer wmg_${'a'.repeat(43)}`,
      'idempotency-key': 'idem-1',
      'content-type': 'application/json',
      'x-request-id': 'req_12345678',
      ...headers,
    },
    body: JSON.stringify(normalizedBody),
  });
}

const forbiddenFields = [
  ['_skipCredits', true],
  ['_skipCloudTaskPersistence', true],
  ['sourceChannel', 'gateway'],
  ['apiKey', 'provider-secret'],
  ['provider_api_key', 'provider-secret'],
  ['authorization', 'Bearer provider-secret'],
  ['secret', 'provider-secret'],
  ['keyHash', 'provider-hash'],
] as const;

const forbiddenCases = (['images', 'videos'] as const).flatMap(path => (
  forbiddenFields.map(([field, value]) => [path, field, value] as const)
));

describe('media gateway submission routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GATEWAY_ENABLED = 'true';
    mocks.authenticateGatewayBearer.mockResolvedValue(principal);
    mocks.recordGatewayAttempt.mockResolvedValue(attemptPermit);
    mocks.reserveGatewayRequest.mockResolvedValue({ kind: 'execute', request: reserved });
    mocks.markGatewayAdmitted.mockResolvedValue({ ...reserved, admissionStatus: 'admitted' });
    mocks.markGatewayRejected.mockResolvedValue({ ...reserved, admissionStatus: 'rejected' });
    mocks.submitGatewayImage.mockResolvedValue({
      kind: 'accepted', taskIds: ['task-1'], status: 'queued',
    });
    mocks.submitGatewayVideo.mockResolvedValue({
      kind: 'accepted', taskIds: ['video-task-1'], status: 'queued',
    });
    mocks.assertGatewayProjectAccess.mockResolvedValue(undefined);
  });

  it.each(['images', 'videos'] as const)(
    'defaults disabled for %s and returns a stable 503 before authentication or body work',
    async (path) => {
    delete process.env.GATEWAY_ENABLED;

    const response = await (path === 'images' ? submitImage : submitVideo)(
      request(path, { malformed: true }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false, code: 'GATEWAY_DISABLED', requestId: 'req_12345678', retryable: false,
    });
    expect(mocks.authenticateGatewayBearer).not.toHaveBeenCalled();
    expect(mocks.recordGatewayAttempt).not.toHaveBeenCalled();
    expect(mocks.reserveGatewayRequest).not.toHaveBeenCalled();
    expect(mocks.submitGatewayImage).not.toHaveBeenCalled();
    expect(mocks.submitGatewayVideo).not.toHaveBeenCalled();
  });

  it('requires a bearer credential before reading or admitting a request', async () => {
    const response = await submitImage(request('images', {
      prompt: 'draw', providerId: 'p', modelId: 'm',
    }, { authorization: '' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_AUTH_REQUIRED' });
    expect(mocks.authenticateGatewayBearer).not.toHaveBeenCalled();
    expect(mocks.recordGatewayAttempt).not.toHaveBeenCalled();
    expect(mocks.reserveGatewayRequest).not.toHaveBeenCalled();
  });

  it('requires an idempotency key before admission or authoritative submission', async () => {
    const response = await submitImage(request('images', {
      prompt: 'draw', providerId: 'p', modelId: 'm',
    }, { 'idempotency-key': '' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_IDEMPOTENCY_REQUIRED' });
    expect(mocks.authenticateGatewayBearer).toHaveBeenCalledTimes(1);
    expect(mocks.recordGatewayAttempt).toHaveBeenCalledOnce();
    expect(mocks.recordGatewayAttempt).toHaveBeenCalledWith(principal);
    expect(mocks.reserveGatewayRequest).not.toHaveBeenCalled();
  });

  it('authenticates, reserves, delegates explicit image selection, and saves every task id', async () => {
    const taskIds = ['task-1', 'task-2', 'task-3', 'task-4'];
    mocks.submitGatewayImage.mockResolvedValue({ kind: 'accepted', taskIds, status: 'queued' });

    const response = await submitImage(request('images', {
      prompt: 'draw', providerId: 'provider-1', modelId: 'model-1', projectId: 'project-1', n: 4,
    }));

    expect(mocks.authenticateGatewayBearer).toHaveBeenCalledWith(expect.stringMatching(/^Bearer wmg_/));
    expect(mocks.reserveGatewayRequest).toHaveBeenCalledWith(expect.objectContaining({
      principal, attemptPermit, idempotencyKey: 'idem-1', mediaType: 'image',
    }));
    expect(mocks.submitGatewayImage).toHaveBeenCalledWith(expect.objectContaining({
      principal,
      gatewayRequestId: 'gwreq_1',
      input: expect.objectContaining({ providerId: 'provider-1', modelId: 'model-1', n: 4 }),
    }));
    expect(mocks.markGatewayAdmitted).toHaveBeenCalledWith({ gatewayRequestId: 'gwreq_1', taskIds });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true,
      requestId: 'req_12345678',
      gatewayRequestId: 'gwreq_1',
      taskId: 'task-1',
      taskIds,
      status: 'queued',
    });
  });

  it('rejects a project not owned by the gateway principal before reservation or submission', async () => {
    mocks.assertGatewayProjectAccess.mockRejectedValueOnce(new GatewayError(
      'GATEWAY_INVALID_REQUEST', 400, 'Project is unavailable',
    ));

    const response = await submitImage(request('images', {
      prompt: 'draw', providerId: 'provider-1', modelId: 'model-1', projectId: 'foreign-project',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_INVALID_REQUEST' });
    expect(mocks.assertGatewayProjectAccess).toHaveBeenCalledWith(principal, 'foreign-project');
    expect(mocks.reserveGatewayRequest).not.toHaveBeenCalled();
    expect(mocks.submitGatewayImage).not.toHaveBeenCalled();
  });

  it('delegates video to the authoritative route and returns its task id', async () => {
    mocks.reserveGatewayRequest.mockResolvedValue({
      kind: 'execute', request: { ...reserved, id: 'gwreq_2', mediaType: 'video' },
    });

    const response = await submitVideo(request('videos', {
      prompt: 'animate', providerId: 'provider-v', modelId: 'model-v', duration: 8,
    }));

    expect(mocks.submitGatewayVideo).toHaveBeenCalledWith(expect.objectContaining({
      gatewayRequestId: 'gwreq_2',
      input: expect.objectContaining({ providerId: 'provider-v', modelId: 'model-v' }),
    }));
    expect(await response.json()).toMatchObject({
      success: true, gatewayRequestId: 'gwreq_2', taskId: 'video-task-1',
      taskIds: ['video-task-1'], status: 'queued',
    });
  });

  it('reuses admitted task ids without a second authoritative submission', async () => {
    mocks.reserveGatewayRequest.mockResolvedValue({
      kind: 'reuse',
      request: { ...reserved, admissionStatus: 'admitted', taskIds: ['task-1', 'task-2'] },
    });

    const response = await submitImage(request('images', {
      prompt: 'draw', providerId: 'provider-1', modelId: 'model-1', n: 2,
    }));

    expect(mocks.submitGatewayImage).not.toHaveBeenCalled();
    expect(mocks.markGatewayAdmitted).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ taskId: 'task-1', taskIds: ['task-1', 'task-2'] });
  });

  it('marks rejected only after an explicit authoritative response with zero task ids', async () => {
    mocks.submitGatewayImage.mockResolvedValue({
      kind: 'rejected', taskIds: [], code: 'GATEWAY_INVALID_REQUEST', status: 400,
      retryable: false, rejectionCode: 'GATEWAY_INVALID_REQUEST',
    });

    const response = await submitImage(request('images', {
      prompt: 'draw', providerId: 'provider-1', modelId: 'model-1',
    }));

    expect(mocks.markGatewayRejected).toHaveBeenCalledWith({
      gatewayRequestId: 'gwreq_1', rejectionCode: 'GATEWAY_INVALID_REQUEST', outcome: 'explicit',
    });
    expect(mocks.markGatewayAdmitted).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it('keeps the reservation on an ambiguous internal failure and redacts internal details', async () => {
    mocks.submitGatewayImage.mockRejectedValue(new GatewayError(
      'GATEWAY_INTERNAL_UNAVAILABLE',
      503,
      'postgres://secret@internal providerApiKey=abc',
      true,
    ));

    const response = await submitImage(request('images', {
      prompt: 'draw', providerId: 'provider-1', modelId: 'model-1',
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ success: false, code: 'GATEWAY_INTERNAL_UNAVAILABLE', retryable: true });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('providerApiKey');
    expect(mocks.markGatewayRejected).not.toHaveBeenCalled();
    expect(mocks.markGatewayAdmitted).not.toHaveBeenCalled();
  });

  it.each(forbiddenCases)(
    'rejects forbidden external %s field %s instead of silently stripping it',
    async (path, field, value) => {
    const response = await (path === 'images' ? submitImage : submitVideo)(request(path, {
      prompt: 'draw', providerId: 'provider-1', modelId: 'model-1', [field]: value,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: 'GATEWAY_INVALID_REQUEST' });
    expect(mocks.reserveGatewayRequest).not.toHaveBeenCalled();
    expect(mocks.recordGatewayAttempt).toHaveBeenCalledOnce();
    expect(mocks.markGatewayAdmitted).not.toHaveBeenCalled();
    expect(mocks.submitGatewayImage).not.toHaveBeenCalled();
    expect(mocks.submitGatewayVideo).not.toHaveBeenCalled();
  });

  it('rejects invalid parameters without consuming admitted daily quota', async () => {
    const response = await submitVideo(request('videos', {
      prompt: 'animate', providerId: 'provider-v', modelId: 'model-v', duration: 0,
    }));

    expect(response.status).toBe(400);
    expect(mocks.recordGatewayAttempt).toHaveBeenCalledOnce();
    expect(mocks.markGatewayAdmitted).not.toHaveBeenCalled();
    expect(mocks.reserveGatewayRequest).not.toHaveBeenCalled();
    expect(mocks.submitGatewayVideo).not.toHaveBeenCalled();
  });

  it.each(['images', 'videos'] as const)(
    'counts malformed and oversized authenticated %s bodies exactly once before parsing',
    async (path) => {
      const submit = path === 'images' ? submitImage : submitVideo;
      const invalidJson = new NextRequest(`http://localhost/api/gateway/v1/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer wmg_${'a'.repeat(43)}`,
          'idempotency-key': 'idem-1',
          'content-type': 'application/json',
        },
        body: '{bad json',
      });
      const malformedResponse = await submit(invalidJson);
      expect(malformedResponse.status).toBe(400);
      expect(mocks.recordGatewayAttempt).toHaveBeenCalledTimes(1);
      expect(mocks.reserveGatewayRequest).not.toHaveBeenCalled();

      vi.clearAllMocks();
      mocks.authenticateGatewayBearer.mockResolvedValue(principal);
      mocks.recordGatewayAttempt.mockResolvedValue(attemptPermit);
      const oversized = new NextRequest(`http://localhost/api/gateway/v1/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer wmg_${'a'.repeat(43)}`,
          'idempotency-key': 'idem-2',
          'content-type': 'application/json',
          'content-length': '1048577',
        },
        body: '{}',
      });
      const oversizedResponse = await submit(oversized);
      expect(oversizedResponse.status).toBe(413);
      expect(mocks.recordGatewayAttempt).toHaveBeenCalledTimes(1);
      expect(mocks.reserveGatewayRequest).not.toHaveBeenCalled();
    },
  );

  it.each(['images', 'videos'] as const)(
    'rejects nested forbidden fields for %s after counting one RPM attempt',
    async (path) => {
      const response = await (path === 'images' ? submitImage : submitVideo)(request(path, {
        prompt: 'draw', providerId: 'provider-1', modelId: 'model-1',
        options: { transport: { apiKey: 'nested-provider-secret' } },
      }));

      expect(response.status).toBe(400);
      expect(mocks.recordGatewayAttempt).toHaveBeenCalledOnce();
      expect(mocks.reserveGatewayRequest).not.toHaveBeenCalled();
      expect(mocks.submitGatewayImage).not.toHaveBeenCalled();
      expect(mocks.submitGatewayVideo).not.toHaveBeenCalled();
    },
  );

  it('returns the same stable explicit rejection on first response and replay', async () => {
    mocks.submitGatewayImage.mockResolvedValue({
      kind: 'rejected', taskIds: [], code: 'GATEWAY_INVALID_REQUEST', status: 400,
      retryable: false, rejectionCode: 'GATEWAY_INVALID_REQUEST',
    });
    const first = await submitImage(request('images', {
      prompt: 'draw', providerId: 'provider-1', modelId: 'missing-model',
    }));
    const firstBody = await first.json();

    mocks.reserveGatewayRequest.mockResolvedValueOnce({
      kind: 'reuse',
      request: {
        ...reserved,
        admissionStatus: 'rejected',
        rejectionCode: 'GATEWAY_INVALID_REQUEST',
      },
    });
    const replay = await submitImage(request('images', {
      prompt: 'draw', providerId: 'provider-1', modelId: 'missing-model',
    }));

    expect(replay.status).toBe(first.status);
    expect(await replay.json()).toEqual(firstBody);
    expect(mocks.submitGatewayImage).toHaveBeenCalledTimes(1);
  });

  it('maps authentication and admission domain errors to stable gateway responses', async () => {
    mocks.authenticateGatewayBearer.mockRejectedValueOnce(new GatewayError(
      'GATEWAY_KEY_INVALID', 401, 'hash lookup postgres detail',
    ));
    const authResponse = await submitImage(request('images', {
      prompt: 'draw', providerId: 'p', modelId: 'm',
    }));
    expect(await authResponse.json()).toMatchObject({ code: 'GATEWAY_KEY_INVALID' });

    mocks.authenticateGatewayBearer.mockResolvedValueOnce(principal);
    mocks.reserveGatewayRequest.mockRejectedValueOnce(new GatewayError(
      'GATEWAY_RATE_LIMITED', 429, 'private rate table detail', true,
    ));
    const admissionResponse = await submitImage(request('images', {
      prompt: 'draw', providerId: 'p', modelId: 'm',
    }));
    const body = await admissionResponse.json();
    expect(body).toMatchObject({ code: 'GATEWAY_RATE_LIMITED', retryable: true });
    expect(JSON.stringify(body)).not.toContain('private rate table detail');
  });
});
