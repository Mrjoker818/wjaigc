import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticateGatewayBearer: vi.fn(),
  recordGatewayAttempt: vi.fn(),
  getCloudTaskForUser: vi.fn(),
}));

vi.mock('@/lib/media-gateway/key-service', () => ({
  authenticateGatewayBearer: mocks.authenticateGatewayBearer,
}));
vi.mock('@/lib/media-gateway/admission', () => ({
  recordGatewayAttempt: mocks.recordGatewayAttempt,
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn(),
}));

import { GET } from '@/app/api/gateway/v1/tasks/[taskId]/route';
import { GatewayError } from '@/lib/media-gateway/types';

const principal = {
  keyId: 'gwkey_1',
  userId: 'user-a',
  requestsPerMinute: 60,
  dailyQuota: 100,
};
const originalGatewayEnabled = process.env.GATEWAY_ENABLED;

function gatewayTaskRequest(taskId: string, authorization = 'Bearer wmg_valid-key'): NextRequest {
  return new NextRequest(`http://localhost/api/gateway/v1/tasks/${taskId}`, {
    headers: {
      ...(authorization ? { authorization } : {}),
      'x-request-id': 'req_task_status_01',
    },
  });
}

function context(taskId: string): { params: Promise<{ taskId: string }> } {
  return { params: Promise.resolve({ taskId }) };
}

describe('GET /api/gateway/v1/tasks/[taskId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GATEWAY_ENABLED = 'true';
    mocks.authenticateGatewayBearer.mockResolvedValue(principal);
    mocks.recordGatewayAttempt.mockResolvedValue({ permitId: 'permit-1' });
  });

  afterEach(() => {
    if (originalGatewayEnabled === undefined) delete process.env.GATEWAY_ENABLED;
    else process.env.GATEWAY_ENABLED = originalGatewayEnabled;
  });

  it('is disabled by default before attempting authentication', async () => {
    delete process.env.GATEWAY_ENABLED;

    const response = await GET(gatewayTaskRequest('task-1'), context('task-1'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_DISABLED' });
    expect(mocks.authenticateGatewayBearer).not.toHaveBeenCalled();
  });

  it('requires Bearer key authentication', async () => {
    const response = await GET(gatewayTaskRequest('task-1', ''), context('task-1'));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_AUTH_REQUIRED' });
    expect(mocks.getCloudTaskForUser).not.toHaveBeenCalled();
  });

  it('does not allow a revoked or disabled key to query', async () => {
    mocks.authenticateGatewayBearer.mockRejectedValue(
      new GatewayError('GATEWAY_KEY_INVALID', 401, 'revoked key details'),
    );

    const response = await GET(gatewayTaskRequest('task-1'), context('task-1'));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'GATEWAY_KEY_INVALID',
      message: 'Gateway key is invalid',
    });
    expect(mocks.recordGatewayAttempt).not.toHaveBeenCalled();
    expect(mocks.getCloudTaskForUser).not.toHaveBeenCalled();
  });

  it('returns 404 for another user task without revealing existence', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue(null);

    const response = await GET(
      gatewayTaskRequest('task-user-b'),
      context('task-user-b'),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_TASK_NOT_FOUND' });
    expect(mocks.getCloudTaskForUser).toHaveBeenCalledWith('task-user-b', 'user-a');
  });

  it('returns the same 404 contract for an unknown task', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue(null);

    const foreign = await GET(gatewayTaskRequest('task-user-b'), context('task-user-b'));
    const unknown = await GET(gatewayTaskRequest('task-unknown'), context('task-unknown'));

    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(await foreign.json());
  });

  it('uses persistent ownership when the in-memory registry is empty', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-persisted',
      userId: 'user-a',
      type: 'generate-async',
      status: 'processing',
      progress: 37,
      providerId: 'provider-1',
      model: 'model-1',
      creditStatus: 'pending',
      createdAt: 1,
      updatedAt: 2,
    });

    const response = await GET(
      gatewayTaskRequest('task-persisted'),
      context('task-persisted'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      taskId: 'task-persisted',
      status: 'processing',
      progress: 37,
      providerId: 'provider-1',
      modelId: 'model-1',
    });
  });

  it('returns only allowlisted task and media-result fields', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-completed',
      userId: 'user-a',
      projectId: 'private-project',
      type: 'generate-async',
      status: 'completed',
      progress: 100,
      providerId: 'provider-1',
      model: 'model-1',
      remoteTaskId: 'provider-task-secret',
      error: 'postgres://db-secret providerApiKey=secret',
      creditStatus: 'charged',
      creditCost: 42,
      refundedTransactionId: 'refund-secret',
      createdAt: 1,
      updatedAt: 2,
      result: {
        imageUrl: '/uploads/result.png',
        imageUrls: ['/uploads/result.png'],
        width: 1024,
        height: 1024,
        prompt: 'private prompt',
        referenceImages: ['data:image/png;base64,private-reference'],
        apiKey: 'provider-secret',
        submissionPayload: { apiBaseUrl: 'https://private-provider.example' },
        billing: { userId: 'other-user', cost: 42 },
      },
    });

    const response = await GET(
      gatewayTaskRequest('task-completed'),
      context('task-completed'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      requestId: expect.any(String),
      taskId: 'task-completed',
      status: 'completed',
      progress: 100,
      providerId: 'provider-1',
      modelId: 'model-1',
      result: {
        imageUrl: '/uploads/result.png',
        imageUrls: ['/uploads/result.png'],
        width: 1024,
        height: 1024,
      },
      previewUrl: '/uploads/result.png',
      thumbnailUrls: {},
    });
    const serialized = JSON.stringify(body);
    for (const secret of [
      'private-project', 'provider-task-secret', 'db-secret', 'private prompt',
      'private-reference', 'provider-secret', 'private-provider', 'other-user',
      'refund-secret', 'creditCost', 'creditStatus',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('maps raw internal task errors to a stable public error', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-failed',
      userId: 'user-a',
      type: 'video',
      status: 'failed',
      progress: 65,
      error: 'Authorization: Bearer provider-secret postgres://private',
      creditStatus: 'refunded',
      createdAt: 1,
      updatedAt: 2,
    });

    const response = await GET(
      gatewayTaskRequest('task-failed'),
      context('task-failed'),
    );

    expect(await response.json()).toMatchObject({
      status: 'failed',
      error: 'Task failed',
    });
  });
});
