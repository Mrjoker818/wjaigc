import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  dbGetSystemSetting: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/db-storage', () => ({ dbGetSystemSetting: mocks.dbGetSystemSetting }));
vi.mock('qrcode', () => ({ default: { toBuffer: mocks.toBuffer } }));

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  vi.resetModules();
});

beforeEach(() => {
  mocks.requireApiAuthOrReject.mockReset();
  mocks.dbGetSystemSetting.mockReset();
  mocks.toBuffer.mockReset();
  mocks.requireApiAuthOrReject.mockResolvedValue({
    authenticated: true,
    userId: 'user-1',
    userRole: 'user',
  });
});

describe.sequential('payment route security', () => {
  it('rejects anonymous QR creation before reading payment configuration', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );

    const { GET } = await import('@/app/api/credits/payment-qr/route');
    const response = await GET(new NextRequest('http://localhost/api/credits/payment-qr?method=wechat'));

    expect(response.status).toBe(401);
    expect(mocks.dbGetSystemSetting).not.toHaveBeenCalled();
  });

  it('rejects anonymous payment-status reads before exposing payment links', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );

    const { GET } = await import('@/app/api/credits/payment-status/route');
    const response = await GET(new NextRequest('http://localhost/api/credits/payment-status'));

    expect(response.status).toBe(401);
    expect(mocks.dbGetSystemSetting).not.toHaveBeenCalled();
  });

  it('refuses to generate payment tokens in production without a configured signing secret', async () => {
    process.env.COZE_PROJECT_ENV = 'PROD';
    delete process.env.PAYMENT_TOKEN_SECRET;

    const { GET } = await import('@/app/api/credits/payment-qr/route');
    const response = await GET(new NextRequest('http://localhost/api/credits/payment-qr?method=wechat'));

    expect(response.status).toBe(503);
    expect(mocks.dbGetSystemSetting).not.toHaveBeenCalled();
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });
});
