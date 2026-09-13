import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GatewayError } from '@/lib/media-gateway/types';

const mocks = vi.hoisted(() => ({
  issueGatewayKey: vi.fn(),
  listGatewayKeys: vi.fn(),
  requireAdminUser: vi.fn(),
  revokeGatewayKey: vi.fn(),
  updateGatewayKey: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/media-gateway/key-service', () => ({
  issueGatewayKey: mocks.issueGatewayKey,
  listGatewayKeys: mocks.listGatewayKeys,
  revokeGatewayKey: mocks.revokeGatewayKey,
  updateGatewayKey: mocks.updateGatewayKey,
}));

import { GET, POST } from '@/app/api/admin/gateway/keys/route';
import { DELETE, PATCH } from '@/app/api/admin/gateway/keys/[keyId]/route';

const key = {
  id: 'gwkey_1',
  userId: 'user-1',
  keyPrefix: 'wmg_abcd1234',
  label: 'Production',
  requestsPerMinute: 60,
  dailyQuota: 1000,
  enabled: true,
  createdBy: 'admin-1',
  createdAt: '2026-09-13T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/gateway/keys/gwkey_1', {
    method,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

const context = { params: Promise.resolve({ keyId: 'gwkey_1' }) };

describe('admin media gateway key routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.listGatewayKeys.mockResolvedValue([key]);
    mocks.issueGatewayKey.mockResolvedValue({ key, secret: `wmg_${'a'.repeat(43)}` });
    mocks.updateGatewayKey.mockResolvedValue(key);
    mocks.revokeGatewayKey.mockResolvedValue({ ...key, enabled: false, revokedAt: '2026-09-13T01:00:00Z' });
  });

  it('rejects non-administrators before every service operation', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);

    const responses = await Promise.all([
      GET(request('GET')),
      POST(request('POST', { userId: 'user-1', label: 'Production', requestsPerMinute: 60, dailyQuota: 1000 })),
      PATCH(request('PATCH', { enabled: false }), context),
      DELETE(request('DELETE'), context),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ success: false, code: 'ADMIN_REQUIRED' });
    }
    expect(mocks.listGatewayKeys).not.toHaveBeenCalled();
    expect(mocks.issueGatewayKey).not.toHaveBeenCalled();
    expect(mocks.updateGatewayKey).not.toHaveBeenCalled();
    expect(mocks.revokeGatewayKey).not.toHaveBeenCalled();
  });

  it('lists only secret-free key views', async () => {
    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, keys: [key] });
    expect(JSON.stringify(body)).not.toContain('keyHash');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('returns the raw secret only in the 201 issuance response', async () => {
    const body = { userId: 'user-1', label: 'Production', requestsPerMinute: 60, dailyQuota: 1000 };
    const response = await POST(request('POST', body));

    expect(response.status).toBe(201);
    expect(mocks.issueGatewayKey).toHaveBeenCalledWith({ ...body, createdBy: 'admin-1' });
    expect(await response.json()).toEqual({
      success: true,
      key,
      secret: `wmg_${'a'.repeat(43)}`,
    });
  });

  it.each([
    [{ userId: 'user-1', label: '', requestsPerMinute: 60, dailyQuota: 1000 }],
    [{ userId: 'user-1', label: 'Production', requestsPerMinute: 0, dailyQuota: 1000 }],
    [{ userId: 'user-1', label: 'Production', requestsPerMinute: 60, dailyQuota: 100001 }],
    [{ userId: 'user-1', label: 'Production', requestsPerMinute: 60, dailyQuota: 1000, secret: 'chosen' }],
  ])('rejects invalid issuance input', async body => {
    const response = await POST(request('POST', body));
    expect(response.status).toBe(400);
    expect(mocks.issueGatewayKey).not.toHaveBeenCalled();
  });

  it('patches only mutable fields', async () => {
    const body = { label: 'Renamed', requestsPerMinute: 30, dailyQuota: 500, enabled: false };
    const response = await PATCH(request('PATCH', body), context);

    expect(response.status).toBe(200);
    expect(mocks.updateGatewayKey).toHaveBeenCalledWith('gwkey_1', body);
  });

  it.each([
    [{ userId: 'other' }],
    [{ keyPrefix: 'changed' }],
    [{ createdBy: 'other-admin' }],
    [{ label: 'Valid', unexpected: true }],
    [{}],
  ])('rejects immutable, undeclared, or empty patch input', async body => {
    const response = await PATCH(request('PATCH', body), context);
    expect(response.status).toBe(400);
    expect(mocks.updateGatewayKey).not.toHaveBeenCalled();
  });

  it('revokes a key idempotently without returning secret material', async () => {
    const first = await DELETE(request('DELETE'), context);
    const second = await DELETE(request('DELETE'), context);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.revokeGatewayKey).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await first.json())).not.toContain('secret');
  });

  it('maps domain errors without leaking internal error messages', async () => {
    mocks.updateGatewayKey.mockRejectedValue(new GatewayError(
      'GATEWAY_INVALID_REQUEST',
      404,
      'postgres host secret',
    ));

    const response = await PATCH(request('PATCH', { enabled: false }), context);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'GATEWAY_INVALID_REQUEST' });
    expect(JSON.stringify(body)).not.toContain('postgres host secret');
  });
});
