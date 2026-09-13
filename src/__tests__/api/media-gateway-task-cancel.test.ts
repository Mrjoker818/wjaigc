import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GatewayError } from '@/lib/media-gateway/types';

const mocks = vi.hoisted(() => ({
  authenticateGatewayBearer: vi.fn(),
  recordGatewayAttempt: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  getInternalRequestHeaders: vi.fn(),
  auditGatewayEvent: vi.fn(),
}));

vi.mock('@/lib/media-gateway/key-service', () => ({
  authenticateGatewayBearer: mocks.authenticateGatewayBearer,
}));
vi.mock('@/lib/media-gateway/admission', () => ({
  recordGatewayAttempt: mocks.recordGatewayAttempt,
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUser: mocks.getCloudTaskForUser,
  terminateCloudTaskAndRefund: mocks.terminateCloudTaskAndRefund,
}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: mocks.getInternalRequestHeaders,
}));
vi.mock('@/lib/media-gateway/audit', () => ({
  auditGatewayEvent: mocks.auditGatewayEvent,
}));

import { POST } from '@/app/api/gateway/v1/tasks/[taskId]/cancel/route';

const principal = {
  keyId: 'gwkey_1',
  userId: 'user-a',
  requestsPerMinute: 60,
  dailyQuota: 100,
};
const originalGatewayEnabled = process.env.GATEWAY_ENABLED;

function gatewayCancelRequest(taskId: string, authorization = 'Bearer wmg_valid-key'): NextRequest {
  return new NextRequest(`http://localhost/api/gateway/v1/tasks/${taskId}/cancel`, {
    method: 'POST',
    headers: {
      ...(authorization ? { authorization } : {}),
      'x-internal-request': 'true',
      'x-internal-user-id': 'attacker',
      'x-wujie-internal-secret': 'forged',
      'x-request-id': 'req_task_cancel_01',
    },
  });
}

function context(taskId: string): { params: Promise<{ taskId: string }> } {
  return { params: Promise.resolve({ taskId }) };
}

function task(status: 'queued' | 'pending' | 'processing' | 'cancelled' | 'completed' | 'failed' | 'timeout') {
  return {
    id: 'task-1',
    userId: 'user-a',
    type: 'video',
    status,
    progress: status === 'completed' ? 100 : 50,
    providerId: 'provider-1',
    model: 'model-1',
    creditStatus: status === 'cancelled' ? 'refunded' : 'pending',
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('POST /api/gateway/v1/tasks/[taskId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GATEWAY_ENABLED = 'true';
    mocks.authenticateGatewayBearer.mockResolvedValue(principal);
    mocks.recordGatewayAttempt.mockResolvedValue({ permitId: 'permit-1' });
    mocks.getInternalRequestHeaders.mockResolvedValue({
      'x-internal-request': 'true',
      'x-internal-user-id': 'user-a',
      'x-internal-user-role': 'user',
      'x-wujie-internal-secret': 'trusted-secret',
    });
    mocks.auditGatewayEvent.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalGatewayEnabled === undefined) delete process.env.GATEWAY_ENABLED;
    else process.env.GATEWAY_ENABLED = originalGatewayEnabled;
  });

  it('is disabled by default before attempting authentication', async () => {
    delete process.env.GATEWAY_ENABLED;
    const internalFetch = vi.fn();
    vi.stubGlobal('fetch', internalFetch);

    const response = await POST(gatewayCancelRequest('task-1'), context('task-1'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_DISABLED' });
    expect(mocks.authenticateGatewayBearer).not.toHaveBeenCalled();
    expect(mocks.auditGatewayEvent).not.toHaveBeenCalled();
    expect(mocks.recordGatewayAttempt).not.toHaveBeenCalled();
    expect(mocks.getCloudTaskForUser).not.toHaveBeenCalled();
    expect(internalFetch).not.toHaveBeenCalled();
  });

  it('does not allow a revoked or disabled key to cancel', async () => {
    mocks.authenticateGatewayBearer.mockRejectedValue(
      new GatewayError('GATEWAY_KEY_INVALID', 401, 'revoked key details'),
    );
    const internalFetch = vi.fn();
    vi.stubGlobal('fetch', internalFetch);

    const response = await POST(gatewayCancelRequest('task-1'), context('task-1'));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_KEY_INVALID' });
    expect(internalFetch).not.toHaveBeenCalled();
    expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
      action: 'gateway_task_cancel', outcome: 'failure', requestId: 'req_task_cancel_01',
      responseStatus: 401,
    });
  });

  it('returns 404 for an unknown or non-owned task without delegating cancellation', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue(null);
    const internalFetch = vi.fn();
    vi.stubGlobal('fetch', internalFetch);

    const response = await POST(gatewayCancelRequest('task-user-b'), context('task-user-b'));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_TASK_NOT_FOUND' });
    expect(mocks.getCloudTaskForUser).toHaveBeenCalledWith('task-user-b', 'user-a');
    expect(internalFetch).not.toHaveBeenCalled();
    expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
      action: 'gateway_task_cancel', outcome: 'failure', requestId: 'req_task_cancel_01',
      gatewayKeyId: 'gwkey_1', userId: 'user-a', responseStatus: 404,
    });
  });

  it('delegates through trusted internal user auth and ignores forged external headers', async () => {
    mocks.getCloudTaskForUser
      .mockResolvedValueOnce(task('processing'))
      .mockResolvedValueOnce(task('cancelled'));
    const internalFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      task: { result: { apiKey: 'must-not-leak' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', internalFetch);

    const response = await POST(gatewayCancelRequest('task-1'), context('task-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      taskId: 'task-1',
      status: 'cancelled',
      error: 'Task was cancelled',
    });
    expect(mocks.getInternalRequestHeaders).toHaveBeenCalledWith('user-a', 'user');
    expect(internalFetch).toHaveBeenCalledOnce();
    const [, init] = internalFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'x-internal-request': 'true',
      'x-internal-user-id': 'user-a',
      'x-internal-user-role': 'user',
      'x-wujie-internal-secret': 'trusted-secret',
    });
    expect(init.headers).not.toMatchObject({ 'x-internal-user-id': 'attacker' });
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
    expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
    expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
      action: 'gateway_task_cancel', outcome: 'success', requestId: 'req_task_cancel_01',
      gatewayKeyId: 'gwkey_1', userId: 'user-a', responseStatus: 200,
    });
  });

  it('delegates repeated cancellation and leaves exactly-once settlement to the cancel route', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue(task('cancelled'));
    const internalFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', internalFetch);

    const first = await POST(gatewayCancelRequest('task-1'), context('task-1'));
    const second = await POST(gatewayCancelRequest('task-1'), context('task-1'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(internalFetch).toHaveBeenCalledTimes(2);
    expect(mocks.terminateCloudTaskAndRefund).not.toHaveBeenCalled();
  });

  it.each([
    ['queued', ''],
    ['pending', JSON.stringify({ success: true, status: 'cancelled' })],
    ['processing', '{malformed-json'],
  ] as const)(
    'returns retryable 503 when a 2xx cancellation leaves durable state %s',
    async (status, responseBody) => {
      mocks.getCloudTaskForUser
        .mockResolvedValueOnce(task('processing'))
        .mockResolvedValueOnce(task(status));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(responseBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })));

      const response = await POST(gatewayCancelRequest('task-1'), context('task-1'));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        code: 'GATEWAY_INTERNAL_UNAVAILABLE',
        retryable: true,
      });
      expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
        action: 'gateway_task_cancel', outcome: 'failure', requestId: 'req_task_cancel_01',
        gatewayKeyId: 'gwkey_1', userId: 'user-a', responseStatus: 503,
      });
    },
  );

  it.each(['completed', 'failed', 'timeout'] as const)(
    'returns stable 409 when a 2xx cancellation rereads durable status %s',
    async (status) => {
      mocks.getCloudTaskForUser
        .mockResolvedValueOnce(task('processing'))
        .mockResolvedValueOnce(task(status));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        success: true,
        status: 'cancelled',
        result: { apiKey: 'untrusted-internal-body' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })));

      const response = await POST(gatewayCancelRequest('task-1'), context('task-1'));
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body).toMatchObject({
        success: false,
        code: 'GATEWAY_INVALID_REQUEST',
        message: 'Task cannot be cancelled',
        status,
      });
      expect(JSON.stringify(body)).not.toContain('untrusted-internal-body');
      expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
        action: 'gateway_task_cancel', outcome: 'failure', requestId: 'req_task_cancel_01',
        gatewayKeyId: 'gwkey_1', userId: 'user-a', responseStatus: 409,
      });
    },
  );

  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
  ] as const)('maps an authoritative 409 with %s status to the stable gateway contract', async (_, status) => {
    mocks.getCloudTaskForUser.mockResolvedValue(task(status));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: 'raw internal race detail',
      status,
    }), { status: 409, headers: { 'content-type': 'application/json' } })));

    const response = await POST(gatewayCancelRequest('task-1'), context('task-1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      success: false,
      code: 'GATEWAY_INVALID_REQUEST',
      message: 'Task cannot be cancelled',
      retryable: false,
      status,
    });
    expect(JSON.stringify(body)).not.toContain('raw internal race detail');
  });

  it('redacts internal cancellation failures', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue(task('processing'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'postgres://secret providerApiKey=private',
    }), { status: 500, headers: { 'content-type': 'application/json' } })));

    const response = await POST(gatewayCancelRequest('task-1'), context('task-1'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      code: 'GATEWAY_INTERNAL_UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('providerApiKey');
  });

  it('keeps a confirmed cancellation response when audit persistence fails', async () => {
    mocks.getCloudTaskForUser
      .mockResolvedValueOnce(task('processing'))
      .mockResolvedValueOnce(task('cancelled'));
    mocks.auditGatewayEvent.mockRejectedValue(new Error('audit database failed'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const response = await POST(gatewayCancelRequest('task-1'), context('task-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status: 'cancelled' });
  });
});
