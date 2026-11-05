import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  execSql: vi.fn(),
  requireApiAuthOrReject: vi.fn(),
  getSessionUser: vi.fn(),
  getPool: vi.fn(() => { throw new Error('Unexpected database connection'); }),
}));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql, getPool: mocks.getPool, isDatabaseConfigured: () => false }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/refund-identity-claim', () => ({ ensureRefundIdentityClaims: vi.fn() }));
vi.mock('@/lib/auth/auth-persistence', () => ({ refreshAuthJsonFileAtomic: vi.fn() }));
vi.mock('@/lib/auth/auth-repository', () => ({ withDatabaseAuthReplicaLock: vi.fn() }));
vi.mock('@/lib/api-provider-selected-models-storage', () => ({ encodeSelectedModelsForStorage: vi.fn(), resolveSelectedModelsStorageKind: vi.fn() }));
vi.mock('@/lib/credit-pricing', () => ({ loadCreditPricingConfig: vi.fn(), resolveConfiguredCreditCost: vi.fn() }));
vi.mock('@/lib/credits', () => ({ CREDITS_TO_CNY: 0.01, CNY_TO_CREDITS: 100, IMAGE_MODEL_CREDITS: {}, VIDEO_MODEL_CREDITS: {}, CHAT_MODEL_CREDITS: {}, RECHARGE_PACKAGES: [], getModelPricingInfo: vi.fn() }));
vi.mock('@/lib/payment-order-time', () => ({ normalizePaymentTimestamp: vi.fn() }));

import { GET } from '@/app/api/credits/payment-status/route';
import { POST } from '@/app/api/credits/route';
import { dbGetSystemSetting } from '@/lib/db-storage';
import { loadPaymentConfig } from '@/lib/payment-config';

const statusRequest = (): NextRequest => new NextRequest('http://synthetic.invalid/api/credits/payment-status');
const orderRequest = (): NextRequest => new NextRequest('http://synthetic.invalid/api/credits', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'create-order', amount: 100, paymentMethod: 'wechat' }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network access'); }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.requireApiAuthOrReject.mockResolvedValue({ userId: 'synthetic-user' });
  mocks.getSessionUser.mockResolvedValue({ id: 'synthetic-user', role: 'user' });
  mocks.execSql.mockImplementation(async (sql: string) => {
    if (!sql.includes('SELECT value FROM wujie_system_settings')) throw new Error('Unexpected SQL: ' + sql);
    return { rows: [], rowCount: 0 };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('payment configuration read failure', () => {
  it('reports storage failure without implying the payment configuration is empty', async () => {
    mocks.execSql.mockRejectedValue(new Error('synthetic-private-storage-failure'));
    const response = await GET(statusRequest());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.canRecharge).toBe(false);
    expect(JSON.stringify(body)).not.toContain('synthetic-private-storage-failure');
    expect(mocks.execSql).toHaveBeenCalledTimes(1);
    expect(mocks.getPool).not.toHaveBeenCalled();
  });
  it('treats a missing stored configuration as a successful unconfigured state', async () => {
    const response = await GET(statusRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, canRecharge: false, methods: [] });
  });
  it('preserves valid configured payment methods', async () => {
    mocks.execSql.mockResolvedValue({ rows: [{ value: JSON.stringify({ wechatEnabled: true, wechatPayLink: 'wxp://synthetic' }) }], rowCount: 1 });
    const response = await GET(statusRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, canRecharge: true, methods: ['wechat'], status: { wechat: true, alipay: false } });
  });
  it.each([401, 403])('preserves auth rejection %i without reading storage', async (status) => {
    mocks.requireApiAuthOrReject.mockResolvedValue(NextResponse.json({ error: 'synthetic denial' }, { status }));
    const response = await GET(statusRequest());
    expect(response.status).toBe(status);
    expect(mocks.execSql).not.toHaveBeenCalled();
  });
  it('preserves malformed legacy configuration default behavior', async () => {
    mocks.execSql.mockResolvedValue({ rows: [{ value: '{bad-json' }], rowCount: 1 });
    const response = await GET(statusRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, canRecharge: false, methods: [] });
  });
  it('preserves legacy callers fallback when not requesting strict reading', async () => {
    mocks.execSql.mockRejectedValue(new Error('synthetic-private-storage-failure'));
    expect(await dbGetSystemSetting('other-setting')).toBeNull();
    expect(await loadPaymentConfig()).toMatchObject({ wechatEnabled: false, alipayEnabled: false });
  });
  it('does not insert an order after a configuration read failure', async () => {
    mocks.execSql.mockRejectedValue(new Error('synthetic-private-storage-failure'));
    const response = await POST(orderRequest());
    expect((await response.json()).success).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.execSql).toHaveBeenCalledTimes(1);
    expect(String(mocks.execSql.mock.calls[0][0])).toContain('SELECT value FROM wujie_system_settings');
    expect(mocks.getPool).not.toHaveBeenCalled();
  });
});