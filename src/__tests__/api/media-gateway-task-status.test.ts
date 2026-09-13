import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticateGatewayBearer: vi.fn(),
  recordGatewayAttempt: vi.fn(),
  getCloudTaskForUser: vi.fn(),
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
}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn(),
}));
vi.mock('@/lib/media-gateway/audit', () => ({
  auditGatewayEvent: mocks.auditGatewayEvent,
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
    mocks.auditGatewayEvent.mockResolvedValue(true);
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
    expect(mocks.auditGatewayEvent).not.toHaveBeenCalled();
    expect(mocks.recordGatewayAttempt).not.toHaveBeenCalled();
    expect(mocks.getCloudTaskForUser).not.toHaveBeenCalled();
  });

  it('requires Bearer key authentication', async () => {
    const response = await GET(gatewayTaskRequest('task-1', ''), context('task-1'));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'GATEWAY_AUTH_REQUIRED' });
    expect(mocks.getCloudTaskForUser).not.toHaveBeenCalled();
    expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
      action: 'gateway_task_query', outcome: 'failure', requestId: 'req_task_status_01',
      responseStatus: 401,
    });
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
    expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
      action: 'gateway_task_query', outcome: 'failure', requestId: 'req_task_status_01',
      responseStatus: 401,
    });
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
    expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
      action: 'gateway_task_query', outcome: 'failure', requestId: 'req_task_status_01',
      gatewayKeyId: 'gwkey_1', userId: 'user-a', responseStatus: 404,
    });
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
    expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
      action: 'gateway_task_query', outcome: 'success', requestId: 'req_task_status_01',
      gatewayKeyId: 'gwkey_1', userId: 'user-a', responseStatus: 200,
    });
  });

  it('keeps the authoritative 503 response when audit persistence also fails', async () => {
    mocks.getCloudTaskForUser.mockRejectedValue(new Error('postgres://private task lookup failed'));
    mocks.auditGatewayEvent.mockRejectedValue(new Error('audit database failed'));

    const response = await GET(gatewayTaskRequest('task-1'), context('task-1'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'GATEWAY_INTERNAL_UNAVAILABLE', retryable: true,
    });
    expect(mocks.auditGatewayEvent).toHaveBeenCalledWith({
      action: 'gateway_task_query', outcome: 'failure', requestId: 'req_task_status_01',
      gatewayKeyId: 'gwkey_1', userId: 'user-a', responseStatus: 503,
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

  it.each([
    ['data URL', 'data:image/png;base64,private-content'],
    ['blob URL', 'blob:https://app.example/private-id'],
    ['file URL', 'file:///etc/passwd.png'],
    ['javascript URL', 'javascript:alert(1)'],
    ['plain text', 'not a media URL'],
    ['insecure HTTP', 'http://cdn.openai.com/result.png'],
    ['userinfo', 'https://user:password@cdn.openai.com/result.png'],
    ['localhost', 'https://localhost/result.png'],
    ['trailing-dot localhost', 'https://localhost./result.png'],
    ['loopback literal', 'https://127.0.0.1/result.png'],
    ['trailing-dot loopback literal', 'https://127.0.0.1./result.png'],
    ['private literal', 'https://10.20.30.40/result.png'],
    ['link-local literal', 'https://169.254.169.254/result.png'],
    ['reserved literal', 'https://192.0.2.10/result.png'],
    ['IPv6 loopback', 'https://[::1]/result.png'],
    ['IPv6 benchmark literal', 'https://[2001:2::]/result.png'],
    ['IPv6 documentation literal', 'https://[3fff::]/result.png'],
    ['6to4 loopback literal', 'https://[2002:7f00:1::]/result.png'],
    ['non-media path', 'https://cdn.openai.com/account'],
    ['path traversal', '/api/serve-upload/%2e%2e/private.png'],
    ['literal dot segment', '/uploads/./safe.png'],
    ['literal dot-dot segment', '/uploads/public/../safe.png'],
    ['double-encoded traversal', '/uploads/%252e%252e/private.png'],
    ['triple-encoded traversal', '/uploads/%25252e%25252e/private.png'],
    ['double-encoded separator', '/uploads/safe%252fprivate.png'],
    ['double-encoded backslash', '/uploads/safe%255cprivate.png'],
  ])('omits an unsafe %s from media URL fields without fetching it', async (_, unsafeUrl) => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-unsafe-url', userId: 'user-a', type: 'generate-async',
      status: 'completed', progress: 100, creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      result: { imageUrl: unsafeUrl },
    });
    const networkFetch = vi.fn();
    vi.stubGlobal('fetch', networkFetch);

    const response = await GET(
      gatewayTaskRequest('task-unsafe-url'),
      context('task-unsafe-url'),
    );

    const body = await response.json();
    expect(body.result).toEqual({});
    expect(body).not.toHaveProperty('previewUrl');
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it.each([
    'https://cdn.openai.com/result.png?token=provider-secret',
    'https://cdn.openai.com/result.png?X-Amz-Signature=private-signature',
    'https://cdn.openai.com/result.png?credential=private-credential',
    'https://cdn.openai.com/result.png?apiKey=private-api-key',
    'https://cdn.openai.com/result.png?AWSAccessKeyId=private-access-key',
    'https://cdn.openai.com/result.png?key=private-key',
    'https://cdn.openai.com/result.png?subscription-key=private-key',
    'https://cdn.openai.com/result.png?ocp-apim-subscription-key=private-key',
    'https://cdn.openai.com/result.png?key-id=private-key-id',
    '/api/serve-upload/result.png?authorization=Bearer-private',
  ])('omits media URLs with sensitive credential or signature queries', async (unsafeUrl) => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-sensitive-query', userId: 'user-a', type: 'generate-async',
      status: 'completed', progress: 100, creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      result: { imageUrl: unsafeUrl },
    });

    const response = await GET(
      gatewayTaskRequest('task-sensitive-query'),
      context('task-sensitive-query'),
    );

    expect(JSON.stringify(await response.json())).not.toContain(unsafeUrl);
  });

  it('omits overlong URL and metadata string values', async () => {
    const longValue = 'a'.repeat(5_000);
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-long-result', userId: 'user-a', type: 'generate-async',
      status: 'completed', progress: 100, creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      result: {
        imageUrl: `https://cdn.openai.com/${longValue}.png`,
        mimeType: `image/${longValue}`,
        format: longValue,
        aspectRatio: longValue,
      },
    });

    const response = await GET(
      gatewayTaskRequest('task-long-result'),
      context('task-long-result'),
    );

    const body = await response.json();
    expect(body.result).toEqual({});
    expect(JSON.stringify(body)).not.toContain(longValue);
  });

  it('omits overlong provider and model identifiers', async () => {
    const longValue = 'provider-secret-'.repeat(300);
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-long-identifiers', userId: 'user-a', type: 'generate-async',
      status: 'completed', progress: 100, creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      providerId: longValue,
      model: longValue,
      result: { imageUrl: '/uploads/safe.png' },
    });

    const response = await GET(
      gatewayTaskRequest('task-long-identifiers'),
      context('task-long-identifiers'),
    );
    const body = await response.json();

    expect(body).not.toHaveProperty('providerId');
    expect(body).not.toHaveProperty('modelId');
    expect(JSON.stringify(body)).not.toContain(longValue);
  });

  it('omits an oversized media URL array', async () => {
    const imageUrls = Array.from(
      { length: 17 },
      (_, index) => `https://cdn.openai.com/result-${index}.png`,
    );
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-many-results', userId: 'user-a', type: 'generate-async',
      status: 'completed', progress: 100, creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      result: { imageUrls },
    });

    const response = await GET(
      gatewayTaskRequest('task-many-results'),
      context('task-many-results'),
    );

    expect((await response.json()).result).toEqual({});
  });

  it('omits a whole mixed media array instead of leaking only its valid members', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-mixed-results', userId: 'user-a', type: 'generate-async',
      status: 'completed', progress: 100, creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      result: {
        imageUrl: '/uploads/safe.png',
        imageUrls: ['/uploads/safe.png', 'https://127.0.0.1/private.png'],
      },
    });

    const response = await GET(
      gatewayTaskRequest('task-mixed-results'),
      context('task-mixed-results'),
    );
    const body = await response.json();

    expect(body.result).toEqual({ imageUrl: '/uploads/safe.png' });
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
  });

  it('fails closed when the aggregate projected result exceeds its byte budget', async () => {
    const largeButIndividuallyBounded = Array.from(
      { length: 10 },
      (_, index) => `https://cdn.openai.com/${index}-${'a'.repeat(1_800)}.png`,
    );
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-aggregate-result', userId: 'user-a', type: 'generate-async',
      status: 'completed', progress: 100, creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      result: { imageUrls: largeButIndividuallyBounded },
    });

    const response = await GET(
      gatewayTaskRequest('task-aggregate-result'),
      context('task-aggregate-result'),
    );

    expect((await response.json()).result).toEqual({});
  });

  it('keeps bounded controlled paths and public domain HTTPS media URLs without queries', async () => {
    mocks.getCloudTaskForUser.mockResolvedValue({
      id: 'task-safe-results', userId: 'user-a', type: 'generate-async',
      status: 'completed', progress: 100, creditStatus: 'charged', createdAt: 1, updatedAt: 2,
      result: {
        imageUrl: '/api/serve-upload/results/image.png',
        imageUrls: [
          '/uploads/result.webp',
          'https://cdn.openai.com/result.jpg',
        ],
        videoUrl: 'https://media.openai.com/result.mp4',
        mimeType: 'image/png',
        format: 'png',
        aspectRatio: '16:9',
      },
    });

    const response = await GET(
      gatewayTaskRequest('task-safe-results'),
      context('task-safe-results'),
    );

    expect(await response.json()).toMatchObject({
      result: {
        imageUrl: '/api/serve-upload/results/image.png',
        imageUrls: [
          '/uploads/result.webp',
          'https://cdn.openai.com/result.jpg',
        ],
        videoUrl: 'https://media.openai.com/result.mp4',
        mimeType: 'image/png',
        format: 'png',
        aspectRatio: '16:9',
      },
    });
  });
});
