import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: async (request: NextRequest): Promise<User | null> => {
    const role = request.headers.get('x-test-role');
    return role === 'admin' || role === 'user'
      ? { id: 'payment-fixture', name: 'Payment fixture', role, status: 'active', createdAt: 1, updatedAt: 1 }
      : null;
  },
}));
// External image storage and decoding are not the persistence boundary under test.
vi.mock('@/lib/s3-storage', () => ({ isS3Available: (): boolean => false, uploadImageToS3: vi.fn() }));
vi.mock('@/lib/qr-decode', () => ({ decodeQrFromUrl: vi.fn(), isPaymentLink: (): boolean => false }));

import { POST } from '@/app/api/credits/payment-config/route';
import { dbSetSystemSetting, ensureCoreTables } from '@/lib/db-storage';
import { loadPaymentConfig, PAYMENT_CONFIG_KEY } from '@/lib/payment-config';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

function request(role: string = 'admin'): NextRequest {
  return new NextRequest('http://localhost/api/credits/payment-config', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-role': role },
    body: JSON.stringify({ note: 'new fixture note', wechatPayLink: 'wxp://offline-fixture' }),
  });
}

async function seed(query: QueryFn): Promise<unknown[]> {
  await ensureCoreTables();
  expect(await dbSetSystemSetting(PAYMENT_CONFIG_KEY, JSON.stringify({ note: 'original fixture note' }))).toBe(true);
  return (await query('SELECT key,value,updated_at FROM wujie_system_settings ORDER BY key')).rows;
}

describe('payment configuration real PostgreSQL persistence', () => {
  it.each(['', 'user'])('rejects a caller with role %s without changing persisted settings', async (role) => {
    await withIsolatedPostgres('payment-config-admission', async ({ query }): Promise<void> => {
      const before = await seed(query);
      expect((await POST(request(role))).status).toBe(role ? 403 : 401);
      expect((await query('SELECT key,value,updated_at FROM wujie_system_settings ORDER BY key')).rows).toEqual(before);
    });
  }, 60_000);

  it('reports success only after the new configuration is actually readable from PostgreSQL', async () => {
    await withIsolatedPostgres('payment-config-success', async ({ query }): Promise<void> => {
      await seed(query);
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, status: { canAcceptPayments: true, wechatReady: true } });
      expect(await loadPaymentConfig()).toMatchObject({ note: 'new fixture note', wechatPayLink: 'wxp://offline-fixture', wechatEnabled: true });
      expect((await query('SELECT count(*)::int AS count FROM wujie_system_settings')).rows).toEqual([{ count: 1 }]);
    });
  }, 60_000);

  it('returns failure on an actual rejected database write and preserves the prior configuration', async () => {
    await withIsolatedPostgres('payment-config-rejected-write', async ({ query }): Promise<void> => {
      const before = await seed(query);
      await query('CREATE SEQUENCE payment_save_attempts');
      await query(`CREATE FUNCTION reject_payment_save() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM nextval('payment_save_attempts');
          RAISE EXCEPTION 'isolated payment setting rejection' USING ERRCODE='22012';
        END $$`);
      await query('CREATE TRIGGER reject_payment_save BEFORE INSERT OR UPDATE ON wujie_system_settings FOR EACH ROW EXECUTE FUNCTION reject_payment_save()');
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ success: false });
      expect((await query('SELECT key,value,updated_at FROM wujie_system_settings ORDER BY key')).rows).toEqual(before);
      expect(await loadPaymentConfig()).toMatchObject({ note: 'original fixture note', wechatEnabled: false });
      expect((await query('SELECT last_value,is_called FROM payment_save_attempts')).rows).toEqual([{ last_value: '1', is_called: true }]);
    });
  }, 60_000);
});
