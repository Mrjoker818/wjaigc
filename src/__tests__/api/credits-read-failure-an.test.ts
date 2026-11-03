// @vitest-environment node
// AN: actual GET + actual db-storage. Only the SQL/session/pricing boundaries
// are synthetic. No real Pool, business DB, payment or account is accessed.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  execSql: vi.fn(),
  getPool: vi.fn(),
  getAdvisoryLockPool: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  getSessionUser: vi.fn(),
  loadCreditPricingConfig: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({
  execSql: mocks.execSql,
  getPool: mocks.getPool,
  getAdvisoryLockPool: mocks.getAdvisoryLockPool,
  isDatabaseConfigured: mocks.isDatabaseConfigured,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/credit-pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/credit-pricing')>();
  return { ...actual, loadCreditPricingConfig: mocks.loadCreditPricingConfig };
});

// Deliberately NOT mocking db-storage, credits, or GET.
import { GET } from '@/app/api/credits/route';
import { dbGetCredits, dbInitCredits, dbGetCreditTransactions, dbGetAllCredits } from '@/lib/db-storage';

interface Query { sql: string; params: unknown[] }
type Reply = { rows: Record<string, unknown>[] } | { error: string };
interface ReadBody {
  success: boolean;
  error?: string;
  credits?: { userId: string; balance: number; totalRecharged: number; totalUsed: number };
  transactions?: Array<{ id: string; amount: number; balanceAfter: number; description: string }>;
  users?: Array<{ userId: string; balance: number }>;
}
const ZERO = {
  id: 'an-credit', user_id: 'an-user', balance: 0, total_recharged: 0, total_used: 0,
  created_at: 1792368000000, updated_at: 1792368000000,
};
const RECOVERED = { ...ZERO, balance: 42, total_recharged: 42 };
const TRANSACTION = {
  id: 'an-transaction', user_id: 'an-user', type: 'recharge', amount: 42,
  balance_after: 42, description: 'AN合成恢复后记录', reference_id: 'an-ref',
  created_at: 1792368000000,
};
const state = {
  balance: [] as Reply[],
  history: [] as Reply[],
  all: [] as Reply[],
  users: [] as Reply[],
  initialization: { rows: [] } as Reply,
  allowInitialization: false,
  queries: [] as Query[],
  writes: [] as Query[],
  unexpected: [] as string[],
  poolAttempts: 0,
};
function result(replies: Reply[], kind: string): { rows: Record<string, unknown>[]; rowCount: number } {
  const reply = replies.shift();
  if (!reply) {
    state.unexpected.push('UNPLANNED_' + kind);
    throw Error('AN_UNPLANNED_' + kind);
  }
  if ('error' in reply) throw Error(reply.error);
  return { rows: reply.rows, rowCount: reply.rows.length };
}
function req(search = ''): NextRequest {
  return new NextRequest('http://credits-an.invalid/api/credits' + search);
}
async function read(search = ''): Promise<{ response: Response; body: ReadBody }> {
  const response = await GET(req(search));
  const body = await response.json() as ReadBody;
  return { response, body };
}
function failed(value: { response: Response; body: ReadBody }): void {
  console.log('AN_READ_OBSERVATION', JSON.stringify({
    status: value.response.status, success: value.body.success,
    hasCredits: Object.hasOwn(value.body, 'credits'),
    hasTransactions: Object.hasOwn(value.body, 'transactions'),
    writeAttempts: state.writes.length,
  }));
  expect(value.response.status, 'storage failure is not a successful financial read').toBe(500);
  expect(value.body.success).toBe(false);
  expect(value.body).not.toHaveProperty('credits');
  expect(value.body).not.toHaveProperty('transactions');
  expect(value.body).not.toHaveProperty('users');
}

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  state.balance = []; state.history = []; state.all = [];
  state.users = [{ rows: [{ id: 'an-user', name: 'AN合成用户' }] }];
  state.initialization = { rows: [] }; state.allowInitialization = false;
  state.queries = []; state.writes = []; state.unexpected = []; state.poolAttempts = 0;
  mocks.getSessionUser.mockResolvedValue({ id: 'an-user', role: 'user', status: 'active' });
  mocks.isDatabaseConfigured.mockReturnValue(true);
  mocks.loadCreditPricingConfig.mockResolvedValue({ modelCredits: {} });
  const forbiddenPool = (): never => { state.poolAttempts++; throw Error('AN_REAL_POOL_FORBIDDEN'); };
  mocks.getPool.mockImplementation(forbiddenPool);
  mocks.getAdvisoryLockPool.mockImplementation(forbiddenPool);
  mocks.execSql.mockImplementation(async (raw: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    const sql = raw.replace(/\s+/g, ' ').trim(), query = { sql, params: [...params] };
    state.queries.push(query);
    if (sql === 'SELECT * FROM wujie_credits WHERE user_id = $1') return result(state.balance, 'BALANCE');
    if (sql.startsWith('SELECT * FROM wujie_credit_transactions WHERE user_id = $1')) return result(state.history, 'HISTORY');
    if (sql === 'SELECT c.*, u.name as user_name FROM wujie_credits c LEFT JOIN wujie_users u ON c.user_id = u.id ORDER BY c.updated_at DESC') {
      return result(state.all, 'ALL');
    }
    if (sql === 'SELECT id, name FROM wujie_users') {
      return result(state.users, 'USERS');
    }
    if (/^(INSERT|UPDATE|DELETE)\b/.test(sql)) {
      state.writes.push(query);
      if (!state.allowInitialization || !sql.startsWith('INSERT INTO wujie_credits ')) throw Error('AN_WRITE_FORBIDDEN');
      return result([state.initialization], 'INITIALIZATION');
    }
    state.unexpected.push(sql); throw Error('AN_SQL_NOT_OWNED');
  });
});
afterEach(() => {
  expect(state.poolAttempts, 'even expected failure must never enter a real Pool').toBe(0);
  expect(mocks.getPool).not.toHaveBeenCalled();
  expect(mocks.getAdvisoryLockPool).not.toHaveBeenCalled();
  expect(state.unexpected, 'unexpected queries cannot masquerade as an expected 500').toEqual([]);
});

describe('AN real credits GET storage-failure truth', () => {
  it('does not initialize or fabricate zero after a balance SELECT failure; retry reads new real-module data', async () => {
    state.balance = [{ error: 'AN_BALANCE_READ_FAILED' }, { rows: [RECOVERED] }];
    failed(await read());
    expect(state.writes, 'failed read is not evidence of an absent account').toEqual([]);
    const recovered = await read();
    expect(recovered.response.status).toBe(200);
    expect(recovered.body).toMatchObject({
      success: true, credits: { userId: 'an-user', balance: 42, totalRecharged: 42, totalUsed: 0 },
    });
    expect(state.writes).toEqual([]);
  });
  it('does not fabricate empty history after a transaction SELECT failure; retry exposes changed records', async () => {
    state.history = [{ error: 'AN_HISTORY_READ_FAILED' }, { rows: [TRANSACTION] }];
    failed(await read('?action=transactions'));
    const recovered = await read('?action=transactions');
    expect(recovered.response.status).toBe(200);
    expect(recovered.body).toMatchObject({
      success: true, transactions: [{ id: 'an-transaction', amount: 42, balanceAfter: 42, description: 'AN合成恢复后记录' }],
    });
    expect(state.writes).toEqual([]);
  });
  it('does not fabricate zero when a genuinely absent account initialization fails', async () => {
    state.balance = [{ rows: [] }];
    state.allowInitialization = true;
    state.initialization = { error: 'AN_INITIALIZATION_FAILED' };
    failed(await read());
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].params.slice(1, 3)).toEqual(['an-user', 0]);
  });
  it('does not fabricate zero if initialization succeeds without returning an account', async () => {
    state.balance = [{ rows: [] }];
    state.allowInitialization = true;
    state.initialization = { rows: [] };
    failed(await read());
    expect(state.writes).toHaveLength(1);
  });
  it('keeps a genuinely known zero account successful and never initializes it', async () => {
    state.balance = [{ rows: [ZERO] }];
    const value = await read();
    expect(value.response.status).toBe(200);
    expect(value.body).toMatchObject({
      success: true, credits: { userId: 'an-user', balance: 0, totalRecharged: 0, totalUsed: 0 },
    });
    expect(state.writes).toEqual([]);
  });
  it('keeps genuinely empty transaction history successful without inventing an error', async () => {
    state.history = [{ rows: [] }];
    const value = await read('?transactions=true');
    expect(value.response.status).toBe(200);
    expect(value.body).toEqual({ success: true, transactions: [] });
    expect(state.writes).toEqual([]);
  });
  it('preserves initialization only after a successful SELECT proves the account is absent', async () => {
    state.balance = [{ rows: [] }];
    state.allowInitialization = true;
    state.initialization = { rows: [ZERO] };
    const value = await read();
    expect(value.response.status).toBe(200);
    expect(value.body).toMatchObject({ success: true, credits: { userId: 'an-user', balance: 0 } });
    expect(state.queries).toHaveLength(2);
    expect(state.queries[0].sql).toBe('SELECT * FROM wujie_credits WHERE user_id = $1');
    expect(state.writes).toHaveLength(1);
  });
  it('ignores a non-admin requested identity for balance and transaction reads', async () => {
    state.balance = [{ rows: [ZERO] }]; state.history = [{ rows: [] }];
    const balance = await read('?userId=someone-else&all=true');
    const history = await read('?action=transactions&userId=someone-else');
    expect(balance.body).toMatchObject({ success: true, credits: { userId: 'an-user', balance: 0 } });
    expect(history.body).toEqual({ success: true, transactions: [] });
    expect(state.queries.map(q => q.params)).toEqual([['an-user'], ['an-user', 50, 0]]);
    expect(state.writes).toEqual([]);
  });
  it('preserves the administrator selected identity for both read types', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'an-admin', role: 'admin', status: 'active' });
    state.balance = [{ rows: [{ ...ZERO, user_id: 'an-target' }] }]; state.history = [{ rows: [] }];
    const balance = await read('?userId=an-target');
    const history = await read('?action=transactions&userId=an-target');
    expect(balance.body).toMatchObject({ success: true, credits: { userId: 'an-target', balance: 0 } });
    expect(history.body).toEqual({ success: true, transactions: [] });
    expect(state.queries.map(q => q.params)).toEqual([['an-target'], ['an-target', 50, 0]]);
  });
  it('rejects an unauthenticated read before any database action', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const value = await read('?action=transactions&userId=an-target');
    expect(value.response.status).toBe(401);
    expect(value.body).toEqual({ success: false, error: '未登录' });
    expect(state.queries).toEqual([]);
  });
  it('does not present an administrator all-credits read failure as an empty successful list', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'an-admin', role: 'admin', status: 'active' });
    state.all = [{ error: 'AN_ALL_READ_FAILED' }];
    failed(await read('?all=true'));
    expect(state.writes).toEqual([]);
  });
  it('does not turn a failed administrator overview credit read into users with zero balances', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'an-admin', role: 'admin', status: 'active' });
    state.all = [{ error: 'AN_OVERVIEW_READ_FAILED' }];
    failed(await read('?action=admin-overview'));
    expect(state.writes).toEqual([]);
  });
  it('preserves user-scoped transaction filtering and bound pagination parameters', async () => {
    state.history = [{ rows: [{ ...TRANSACTION, type: 'consume', amount: -5, balance_after: 37, description: 'AN合成消费记录' }] }];
    const value = await read('?action=transactions&type=consume&limit=3&offset=2&userId=someone-else');
    expect(value.response.status).toBe(200);
    expect(value.body.transactions).toHaveLength(1);
    expect(value.body.transactions).toMatchObject([{ type: 'consume', amount: -5, balanceAfter: 37, description: 'AN合成消费记录' }]);
    expect(state.queries).toEqual([{
      sql: 'SELECT * FROM wujie_credit_transactions WHERE user_id = $1 AND type = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
      params: ['an-user', 'consume', 3, 2],
    }]);
    expect(state.writes).toEqual([]);
  });
  it('does not hide an overview user-list read failure; retry retains genuinely zero users without credit accounts', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'an-admin', role: 'admin', status: 'active' });
    state.all = [{ rows: [] }, { rows: [] }];
    state.users = [{ error: 'AN_OVERVIEW_USERS_READ_FAILED' }, { rows: [{ id: 'an-user', name: 'AN合成用户' }] }];
    failed(await read('?action=admin-overview'));
    const recovered = await read('?action=admin-overview');
    expect(recovered.response.status).toBe(200);
    expect(recovered.body).toEqual({
      success: true, users: [{ userId: 'an-user', userName: 'AN合成用户', balance: 0, totalRecharged: 0, totalUsed: 0 }],
    });
    expect(state.writes).toEqual([]);
  });
});

// Compatibility only: legacy callers have not opted into strict propagation.
// This is not a claim that their fallback behavior is fully audited or final.
const COMPATIBILITY_READS = [
  {
    name: 'balance', fallback: null,
    prepare(): void { state.balance = [{ error: 'AN_COMPAT_BALANCE_FAILURE' }]; },
    run(flag?: boolean): Promise<unknown> { return flag === undefined ? dbGetCredits('an-user') : dbGetCredits('an-user', { throwOnError: flag }); },
  },
  {
    name: 'initialization', fallback: null,
    prepare(): void { state.allowInitialization = true; state.initialization = { error: 'AN_COMPAT_INIT_FAILURE' }; },
    run(flag?: boolean): Promise<unknown> { return flag === undefined ? dbInitCredits('an-user') : dbInitCredits('an-user', 0, { throwOnError: flag }); },
  },
  {
    name: 'history', fallback: [],
    prepare(): void { state.history = [{ error: 'AN_COMPAT_HISTORY_FAILURE' }]; },
    run(flag?: boolean): Promise<unknown> { return flag === undefined ? dbGetCreditTransactions('an-user') : dbGetCreditTransactions('an-user', { throwOnError: flag }); },
  },
  {
    name: 'all-credits', fallback: [],
    prepare(): void { state.all = [{ error: 'AN_COMPAT_ALL_FAILURE' }]; },
    run(flag?: boolean): Promise<unknown> { return flag === undefined ? dbGetAllCredits() : dbGetAllCredits({ throwOnError: flag }); },
  },
];
describe.each(COMPATIBILITY_READS)('AN strict opt-in compatibility $name', (entry): void => {
  it.each([
    { name: 'omitted option', flag: undefined },
    { name: 'explicit false', flag: false },
  ])('preserves the legacy sentinel with $name', async ({ flag }): Promise<void> => {
    entry.prepare();
    await expect(entry.run(flag)).resolves.toEqual(entry.fallback);
  });
  it('propagates the actual storage error only with explicit true', async (): Promise<void> => {
    entry.prepare();
    await expect(entry.run(true)).rejects.toThrow(/^AN_COMPAT_/);
  });
});
