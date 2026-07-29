import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execSql: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('@/lib/db-client', () => mocks);

import { ensureCoreTables } from '@/lib/db-storage';

describe('credit schema initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('creates and migrates the transaction reference used by atomic settlement', async () => {
    await ensureCoreTables();

    const statements = mocks.execSql.mock.calls.map(([sql]) => String(sql));
    const createTransactions = statements.find((sql) => (
      sql.includes('CREATE TABLE IF NOT EXISTS wujie_credit_transactions')
    ));

    expect(createTransactions).toContain("reference_id TEXT DEFAULT ''");
    expect(statements).toContain(
      "ALTER TABLE wujie_credit_transactions ADD COLUMN IF NOT EXISTS reference_id TEXT DEFAULT ''",
    );
  });
});
