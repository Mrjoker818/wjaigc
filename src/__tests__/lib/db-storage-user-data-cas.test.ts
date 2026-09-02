import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execSql: vi.fn(),
}));

vi.mock('@/lib/db-client', () => ({
  execSql: mocks.execSql,
  getPool: vi.fn(),
}));

import { dbCompareAndSetUserDataRevision } from '@/lib/db-storage';

describe('wujie_user_data revision CAS SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execSql.mockResolvedValue({ rows: [{ saved: false }], rowCount: 1 });
  });

  it('accepts only non-negative safe integer JSON numbers and never text-coerces revisions', async () => {
    await expect(dbCompareAndSetUserDataRevision(
      'user-1',
      'skill_catalog_v1',
      0,
      { revision: 1 },
    )).resolves.toBe(false);

    const sql = String(mocks.execSql.mock.calls[0]?.[0]);
    expect(sql).toContain("jsonb_typeof(data_value -> 'revision') = 'number'");
    expect(sql).toContain('trunc(');
    expect(sql).toContain('9007199254740991');
    expect(sql).not.toContain('~');
    expect(sql).not.toContain("data_value ->> 'revision', ''");
  });

  it('inserts revision zero only when the row truly does not exist', async () => {
    await dbCompareAndSetUserDataRevision('user-1', 'skill_catalog_v1', 0, { revision: 1 });

    const sql = String(mocks.execSql.mock.calls[0]?.[0]);
    expect(sql).toContain('WHERE $5 = 0');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('ON CONFLICT (user_id, data_key) DO NOTHING');
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid expected revision %s before querying',
    async expectedRevision => {
      await expect(dbCompareAndSetUserDataRevision(
        'user-1',
        'skill_catalog_v1',
        expectedRevision,
        { revision: 1 },
      )).rejects.toThrow('Invalid expected revision');
      expect(mocks.execSql).not.toHaveBeenCalled();
    },
  );
});
