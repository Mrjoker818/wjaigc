import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execSql: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql, isDatabaseConfigured: () => true }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.session }));

import { DELETE } from '@/app/api/simple-chat/share/[shareId]/route';

const shareId = '0123456789abcdef';
const revoke = () => DELETE(new NextRequest('http://localhost/', { method: 'DELETE' }), {
  params: Promise.resolve({ shareId }),
});

beforeEach(() => {
  mocks.execSql.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  mocks.session.mockReset();
});

it('requires an authenticated owner before touching share storage', async () => {
  mocks.session.mockResolvedValue(null);
  expect((await revoke()).status).toBe(401);
  expect(mocks.execSql).not.toHaveBeenCalled();
});

it('uses the authenticated owner in the update and reports when no share was changed', async () => {
  mocks.session.mockResolvedValue({ id: 'fixture-owner' });
  mocks.execSql.mockImplementation(async (sql: string, args?: string[]) => {
    if (sql.includes('UPDATE') && args?.[1] === 'fixture-owner' && /user_id\s*=\s*\$2/u.test(sql)) {
      return { rows: [{ id: shareId }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const response = await revoke();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(mocks.execSql).toHaveBeenCalledWith(expect.stringMatching(/user_id\s*=\s*\$2/u), [shareId, 'fixture-owner']);

  mocks.execSql.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  expect((await revoke()).status).toBe(404);
});
