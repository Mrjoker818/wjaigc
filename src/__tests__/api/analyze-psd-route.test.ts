import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import { InsufficientCreditsError } from '@/lib/credits';
import { PsdAnalysisError } from '@/lib/psd-analysis/contracts';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  readPsdAnalysisRequest: vi.fn(),
  executePsdAnalysis: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: mocks.requireApiAuthOrReject,
}));
vi.mock('@/lib/psd-analysis/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/psd-analysis/contracts')>();
  return {
    ...actual,
    readPsdAnalysisRequest: mocks.readPsdAnalysisRequest,
  };
});
vi.mock('@/lib/psd-analysis/service', () => ({
  executePsdAnalysis: mocks.executePsdAnalysis,
}));
vi.mock('coze-coding-dev-sdk', () => ({
  LLMClient: class {},
  Config: class {},
  HeaderUtils: { extractForwardHeaders: vi.fn(() => ({})) },
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: vi.fn() }));
vi.mock('@/lib/api-validator', () => ({ validateApiInputs: vi.fn(() => null) }));

import { POST } from '@/app/api/analyze-psd/route';

const user = {
  id: 'user-a',
  name: 'User A',
  role: 'user' as const,
  createdAt: 1,
  updatedAt: 1,
};

function request(signal?: AbortSignal): NextRequest {
  return new NextRequest('http://localhost/api/analyze-psd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'psd-analysis-request-1',
    },
    body: JSON.stringify({ image: 'data:image/png;base64,aW1hZ2U=' }),
    signal,
  });
}

describe('POST /api/analyze-psd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: user.id,
      userRole: 'user',
      user,
      source: 'cookie',
    });
    mocks.readPsdAnalysisRequest.mockResolvedValue({
      image: 'data:image/png;base64,aW1hZ2U=',
      idempotencyKey: 'psd-analysis-request-1',
    });
    mocks.executePsdAnalysis.mockResolvedValue({
      taskId: 'task-1',
      requestId: 'req-1',
      providerId: 'pear',
      model: 'gpt-4o',
      analysis: {
        backgroundColor: [255, 255, 255],
        backgroundMode: 'white',
        layers: [{ name: 'Background', role: 'bg', description: 'White background' }],
      },
    });
  });

  it('authenticates before reading the request body or touching billing', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'AUTH_REQUIRED',
      requestId: expect.stringMatching(/^req_/),
      retryable: false,
    });
    expect(mocks.readPsdAnalysisRequest).not.toHaveBeenCalled();
    expect(mocks.executePsdAnalysis).not.toHaveBeenCalled();
  });

  it('returns the durable task id when execution fails after billing admission', async () => {
    mocks.executePsdAnalysis.mockRejectedValue(
      new PsdAnalysisError(
        'PSD_ANALYSIS_TIMEOUT',
        'PSD 分析超过 45 秒总截止时间',
        504,
        true,
        { taskId: 'task-admitted' },
      ),
    );

    const response = await POST(request());

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'PSD_ANALYSIS_TIMEOUT',
      taskId: 'task-admitted',
      requestId: expect.stringMatching(/^req_/),
    });
  });

  it('links caller disconnects into the same request-body and service signal', async () => {
    const caller = new AbortController();
    mocks.readPsdAnalysisRequest.mockImplementation((_request, signal?: AbortSignal) => (
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        setTimeout(() => reject(new Error('caller signal was not linked')), 10);
      })
    ));

    const incoming = request();
    Object.defineProperty(incoming, 'signal', { value: caller.signal });
    const pending = POST(incoming);
    caller.abort(new PsdAnalysisError(
      'PSD_ANALYSIS_CANCELLED',
      'PSD 分析请求已取消',
      499,
      false,
    ));
    const response = await pending;

    expect(response.status).toBe(499);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'PSD_ANALYSIS_CANCELLED',
    });
    expect(mocks.executePsdAnalysis).not.toHaveBeenCalled();
  });

  it('stops a delayed authentication lookup when the caller disconnects', async () => {
    const caller = new AbortController();
    const authenticated = {
      authenticated: true,
      userId: user.id,
      userRole: 'user',
      user,
      source: 'cookie',
    };
    mocks.requireApiAuthOrReject.mockImplementation(() => (
      new Promise(resolve => setTimeout(() => resolve(authenticated), 10))
    ));
    const incoming = request();
    Object.defineProperty(incoming, 'signal', { value: caller.signal });

    const pending = POST(incoming);
    caller.abort(new PsdAnalysisError(
      'PSD_ANALYSIS_CANCELLED',
      'PSD 分析请求已取消',
      499,
      false,
    ));
    const response = await pending;

    expect(response.status).toBe(499);
    expect(mocks.readPsdAnalysisRequest).not.toHaveBeenCalled();
    expect(mocks.executePsdAnalysis).not.toHaveBeenCalled();
  });

  it('rejects a user without VLM permission before reading the image body', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: user.id,
      userRole: 'user',
      user: { ...user, apiPermissions: { vlm: false } },
      source: 'cookie',
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'PSD_ANALYSIS_FORBIDDEN',
    });
    expect(mocks.readPsdAnalysisRequest).not.toHaveBeenCalled();
    expect(mocks.executePsdAnalysis).not.toHaveBeenCalled();
  });

  it('returns actual execution identities from the durable service', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      taskId: 'task-1',
      requestId: 'req-1',
      providerId: 'pear',
      model: 'gpt-4o',
    });
    expect(mocks.readPsdAnalysisRequest).toHaveBeenCalledTimes(1);
    const requestSignal = mocks.readPsdAnalysisRequest.mock.calls[0][1];
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(mocks.executePsdAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      user,
      requestId: expect.stringMatching(/^req_/),
      requestSignal,
      deadlineAt: expect.any(Number),
    }));
  });

  it.each([
    [new PsdAnalysisError('PSD_ANALYSIS_BODY_TOO_LARGE', 'too large', 413), 413, 'PSD_ANALYSIS_BODY_TOO_LARGE'],
    [new InsufficientCreditsError('user-a', 10, 2), 402, 'INSUFFICIENT_CREDITS'],
    [new IdempotencyConflictError({
      userId: 'user-a',
      idempotencyKey: 'psd-analysis-request-1',
      requestDigest: 'digest-b',
      existingDigest: 'digest-a',
    }), 409, 'IDEMPOTENCY_CONFLICT'],
  ] as const)(
    'maps a domain failure to its stable HTTP status and code',
    async (error, expectedStatus, expectedCode) => {
      mocks.executePsdAnalysis.mockRejectedValue(error);

      const response = await POST(request());

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        code: expectedCode,
        requestId: expect.stringMatching(/^req_/),
      });
    },
  );
});
