import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAuthSecretForInternalRequests: vi.fn(),
  getDesktopAuth: vi.fn(),
  tokenFromHeader: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
  getAuthSecretForInternalRequests: mocks.getAuthSecretForInternalRequests,
}));
vi.mock('@/lib/desktop-cloud', () => ({
  getDesktopAuth: mocks.getDesktopAuth,
  tokenFromHeader: mocks.tokenFromHeader,
}));

import {
  getInternalRequestHeaders,
  getRequestUser,
  getTrustedRequestAgentExecutionFence,
  requireApiAuthOrReject,
} from '@/lib/api-auth';
import {
  parseAgentExecutionFenceHeaders,
  withAgentExecutionFence,
} from '@/lib/agent-runtime/execution-fence';

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe('internal request authentication', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.getAuthSecretForInternalRequests.mockResolvedValue('a'.repeat(32));
    mocks.tokenFromHeader.mockReturnValue(null);
    delete process.env.INTERNAL_API_SECRET;
    process.env.WUJIE_AUTH_SECRET = 'a'.repeat(32);
  });

  it('does not trust forgeable internal identity headers without the shared secret', async () => {
    const request = new NextRequest('http://localhost/api/generate', {
      headers: {
        'x-internal-request': 'true',
        'x-internal-user-id': 'admin-1',
        'x-internal-user-role': 'admin',
      },
    });

    await expect(getRequestUser(request)).resolves.toBeNull();
  });

  it('accepts an internal request only when its shared secret matches', async () => {
    const request = new NextRequest('http://localhost/api/generate', {
      headers: {
        'x-internal-request': 'true',
        'x-internal-user-id': 'worker-1',
        'x-internal-user-role': 'admin',
        'x-wujie-internal-secret': 'a'.repeat(32),
      },
    });

    await expect(getRequestUser(request)).resolves.toMatchObject({
      source: 'internal',
      user: { id: 'worker-1', role: 'admin' },
    });
  });

  it('preserves the signed product scope for an internal user request', async () => {
    const request = new NextRequest('http://localhost/api/skill-runs', {
      headers: {
        'x-internal-request': 'true',
        'x-internal-user-id': 'canvas-user-1',
        'x-internal-user-role': 'user',
        'x-internal-user-product-type': 'canvas,chat',
        'x-wujie-internal-secret': 'a'.repeat(32),
      },
    });

    await expect(getRequestUser(request)).resolves.toMatchObject({
      source: 'internal',
      user: { id: 'canvas-user-1', role: 'user', productType: 'canvas,chat' },
    });
  });

  it('uses the persisted session-auth secret for asynchronous internal requests', async () => {
    delete process.env.INTERNAL_API_SECRET;
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    mocks.getAuthSecretForInternalRequests.mockResolvedValue('p'.repeat(32));

    await expect(getInternalRequestHeaders('worker-2', 'admin')).resolves.toMatchObject({
      'x-internal-request': 'true',
      'x-internal-user-id': 'worker-2',
      'x-wujie-internal-secret': 'p'.repeat(32),
    });

    const request = new NextRequest('http://localhost/api/generate', {
      headers: await getInternalRequestHeaders('worker-2', 'admin'),
    });
    await expect(getRequestUser(request)).resolves.toMatchObject({
      source: 'internal',
      user: { id: 'worker-2', role: 'admin' },
    });
  });

  it('propagates the active Agent execution fence only through authenticated internal headers', async () => {
    const fence = {
      runId: 'agent-run-1',
      leaseOwner: 'lease-owner-1',
      generation: 2,
    };
    const headers = await withAgentExecutionFence(fence, () => (
      getInternalRequestHeaders('worker-2', 'admin')
    ));

    expect(headers).toMatchObject({
      'x-wujie-agent-run-id': fence.runId,
      'x-wujie-agent-lease-owner': fence.leaseOwner,
      'x-wujie-agent-generation': '2',
    });
    expect(parseAgentExecutionFenceHeaders(new Headers(headers))).toEqual(fence);
    const internalRequest = new NextRequest('http://localhost/api/poll-task', { headers });
    await expect(getTrustedRequestAgentExecutionFence(internalRequest)).resolves.toEqual(fence);

    mocks.getSessionUser.mockResolvedValueOnce({ id: 'cookie-user', role: 'admin' });
    const forgedCookieRequest = new NextRequest('http://localhost/api/poll-task', {
      headers: {
        'x-wujie-agent-run-id': fence.runId,
        'x-wujie-agent-lease-owner': fence.leaseOwner,
        'x-wujie-agent-generation': '2',
      },
    });
    await expect(getTrustedRequestAgentExecutionFence(forgedCookieRequest)).resolves.toBeUndefined();
    expect(parseAgentExecutionFenceHeaders(new Headers({
      'x-wujie-agent-run-id': fence.runId,
      'x-wujie-agent-lease-owner': fence.leaseOwner,
      'x-wujie-agent-generation': '-1',
    }))).toBeUndefined();
  });

  it('rejects an anonymous request when the internal auth secret is unavailable', async () => {
    delete process.env.INTERNAL_API_SECRET;
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    mocks.getAuthSecretForInternalRequests.mockRejectedValue(new Error('auth secret unavailable'));

    const request = new NextRequest('http://localhost/api/generate');

    await expect(requireApiAuthOrReject(request)).resolves.toMatchObject({ status: 401 });
  });

  it('does not trust an internal identity request when its secret cannot be loaded', async () => {
    delete process.env.INTERNAL_API_SECRET;
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    mocks.getAuthSecretForInternalRequests.mockRejectedValue(new Error('auth secret unavailable'));

    const request = new NextRequest('http://localhost/api/generate', {
      headers: {
        'x-internal-request': 'true',
        'x-internal-user-id': 'worker-3',
        'x-wujie-internal-secret': 'forged',
      },
    });

    await expect(requireApiAuthOrReject(request)).resolves.toMatchObject({ status: 401 });
  });
});
