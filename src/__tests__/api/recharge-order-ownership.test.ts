import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  execSql: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  dbGetSystemSetting: vi.fn(),
  dbSetSystemSetting: vi.fn(),
  decodeQrFromUrl: vi.fn(),
  isPaymentLink: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/db-client', () => ({
  execSql: mocks.execSql,
  isDatabaseConfigured: mocks.isDatabaseConfigured,
}));
vi.mock('@/lib/db-storage', () => ({
  dbGetSystemSetting: mocks.dbGetSystemSetting,
  dbSetSystemSetting: mocks.dbSetSystemSetting,
}));
vi.mock('@/lib/qr-decode', () => ({
  decodeQrFromUrl: mocks.decodeQrFromUrl,
  isPaymentLink: mocks.isPaymentLink,
}));

import { GET } from '@/app/api/recharge/[orderId]/route';

const orderContext = { params: Promise.resolve({ orderId: 'order-other-user' }) };

describe('recharge order access control', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.isDatabaseConfigured.mockReturnValue(true);
    mocks.execSql.mockResolvedValue({ rows: [] });
    mocks.dbGetSystemSetting.mockResolvedValue(null);
    mocks.isPaymentLink.mockReturnValue(true);
  });

  it('rejects anonymous order reads before querying the database', async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('http://localhost/api/recharge/order-other-user'),
      orderContext,
    );

    expect(response.status).toBe(401);
    expect(mocks.isDatabaseConfigured).not.toHaveBeenCalled();
    expect(mocks.execSql).not.toHaveBeenCalled();
  });

  it('scopes a non-admin order read to the authenticated owner', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-current', role: 'user' });

    const response = await GET(
      new NextRequest('http://localhost/api/recharge/order-other-user'),
      orderContext,
    );

    expect(response.status).toBe(404);
    expect(mocks.execSql).toHaveBeenCalledWith(
      'SELECT * FROM wujie_recharge_orders WHERE id = $1 AND user_id = $2',
      ['order-other-user', 'user-current'],
    );
  });

  it('does not mutate payment configuration while reading an owned order', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-current', role: 'user' });
    mocks.execSql.mockResolvedValue({
      rows: [{
        id: 'order-other-user',
        user_id: 'user-current',
        amount: 100,
        price_cny: 10,
        bonus: 0,
        payment_method: 'wechat',
        payment_status: 'pending',
        created_at: Date.now(),
        expires_at: Date.now() + 60_000,
      }],
    });
    mocks.dbGetSystemSetting.mockResolvedValue(JSON.stringify({
      wechatEnabled: true,
      wechatQrUrl: 'https://example.test/payment-qr.png',
    }));
    mocks.decodeQrFromUrl.mockResolvedValue('https://example.test/pay');

    const response = await GET(
      new NextRequest('http://localhost/api/recharge/order-other-user'),
      orderContext,
    );

    expect(response.status).toBe(200);
    expect(mocks.dbSetSystemSetting).not.toHaveBeenCalled();
  });
});
