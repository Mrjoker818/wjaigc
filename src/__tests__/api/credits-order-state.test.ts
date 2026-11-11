import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  execSql: vi.fn(),
  getPool: vi.fn(),
  dbGetCredits: vi.fn(),
  dbAdjustCredits: vi.fn(),
  dbGetCreditTransactions: vi.fn(),
  dbGetAllCredits: vi.fn(),
  dbInitCredits: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql, getPool: mocks.getPool }));
vi.mock('@/lib/db-storage', () => ({
  dbGetCredits: mocks.dbGetCredits,
  dbAdjustCredits: mocks.dbAdjustCredits,
  dbGetCreditTransactions: mocks.dbGetCreditTransactions,
  dbGetAllCredits: mocks.dbGetAllCredits,
  dbInitCredits: mocks.dbInitCredits,
}));

import { POST } from '@/app/api/credits/route';

const ORDER_ID = 'synthetic-order';
const USER_ID = 'synthetic-user';
const REVIEW_STATES = ['pending', 'submitted', 'pending_paid'];
const ACTIONS = [
  { action: 'admin-confirm', initial: 'submitted', terminal: 'paid', delta: 100, balance: 250, recharged: 300, used: 50, type: 'recharge' },
  { action: 'reverse-order', initial: 'paid', terminal: 'reversed', delta: -100, balance: 50, recharged: 200, used: 150, type: 'admin_adjust' },
] as const;

function post(action: string, orderId = ORDER_ID) {
  return POST(new NextRequest('http://synthetic.invalid/api/credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, orderId }),
  }));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function result<T>(rows: T[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

interface Store {
  order: { user_id: string; amount: number; payment_status: string; paid_at: number | null };
  account: { balance: number; totalRecharged: number; totalUsed: number } | null;
  ledger: Array<{ type: unknown; amount: unknown; balanceAfter: unknown; description: unknown }>;
}

// Model one order row and transaction-local writes. A competing connection
// waits on that row, then reads the committed status. No database is opened.
function installSql(initial: string) {
  const initialState: Store = {
    order: { user_id: USER_ID, amount: 100, payment_status: initial, paid_at: initial === 'paid' ? 123 : null },
    account: { balance: 150, totalRecharged: 200, totalUsed: 50 },
    ledger: [],
  };
  const db = {
    state: initialState,
    lockAttempts: 0,
    beforeCommit: undefined as (() => Promise<void>) | undefined,
    failAt: undefined as 'ledger' | 'order' | undefined,
  };
  let orderLock = Promise.resolve();
  async function lockOrder() {
    db.lockAttempts += 1;
    const previous = orderLock;
    const unlock = deferred();
    orderLock = unlock.promise;
    await previous;
    return unlock.resolve;
  }

  mocks.execSql.mockImplementation(async (statement: string, params: unknown[]) => {
    expect(statement).toContain("payment_status IN ('pending', 'submitted', 'pending_paid')");
    expect(statement).toContain("SET payment_status = 'rejected'");
    const unlock = await lockOrder();
    try {
      if (params[0] !== ORDER_ID || !REVIEW_STATES.includes(db.state.order.payment_status)) return result();
      db.state.order.payment_status = 'rejected';
      return result([], 1);
    } finally {
      unlock();
    }
  });

  mocks.getPool.mockReturnValue({
    connect: async () => {
      let begun = false;
      let unlock: (() => void) | undefined;
      let draft: Store | undefined;
      return {
        async query(statement: string, params: unknown[] = []) {
          const sql = statement.replace(/\s+/g, ' ').trim();
          if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED') {
            begun = true;
            return result();
          }
          expect(begun).toBe(true);
          if (sql === 'ROLLBACK' || sql === 'COMMIT') {
            if (sql === 'COMMIT' && draft) {
              const beforeCommit = db.beforeCommit;
              db.beforeCommit = undefined;
              await beforeCommit?.();
              db.state = draft;
            }
            begun = false;
            unlock?.();
            return result();
          }
          if (sql.startsWith('SELECT ') && sql.includes('FROM wujie_recharge_orders')) {
            expect(sql).toContain('WHERE id = $1 FOR UPDATE');
            if (params[0] !== ORDER_ID) return result();
            unlock = await lockOrder();
            draft = structuredClone(db.state);
            return result([draft.order]);
          }
          if (!draft) throw new Error('Expected an order lock before settlement');
          if (sql.startsWith('INSERT INTO wujie_credits ')) {
            expect(sql).toContain('ON CONFLICT (user_id) DO NOTHING');
            expect(params[1]).toBe(USER_ID);
            draft.account ??= { balance: 0, totalRecharged: 0, totalUsed: 0 };
            return result([], 1);
          }
          if (sql.startsWith('UPDATE wujie_credits ')) {
            expect(sql).toContain('balance = balance + $2');
            expect(sql).toContain('total_recharged = total_recharged + $3');
            expect(sql).toContain('total_used = total_used + $4');
            expect(sql).toContain('WHERE user_id = $1 AND ($2 >= 0 OR balance + $2 >= 0) RETURNING balance');
            const [userId, delta, recharged, used] = params as [string, number, number, number];
            expect(userId).toBe(USER_ID);
            if (!draft.account || (delta < 0 && draft.account.balance + delta < 0)) return result();
            draft.account.balance += delta;
            draft.account.totalRecharged += recharged;
            draft.account.totalUsed += used;
            return result([{ balance: draft.account.balance }]);
          }
          if (sql.startsWith('INSERT INTO wujie_credit_transactions ')) {
            if (db.failAt === 'ledger') throw new Error('Synthetic ledger insert failure');
            const [, userId, type, amount, balanceAfter, description] = params;
            expect(userId).toBe(USER_ID);
            draft.ledger.push({ type, amount, balanceAfter, description });
            return result([], 1);
          }
          if (sql.startsWith('UPDATE wujie_recharge_orders ')) {
            expect(sql).toContain('WHERE id = $1 AND payment_status = $4');
            expect(sql).toContain("paid_at = CASE WHEN $2 = 'paid' THEN $3 ELSE paid_at END");
            const [orderId, nextState, timestamp, expectedState] = params as [string, string, number, string];
            if (db.failAt === 'order' || orderId !== ORDER_ID || draft.order.payment_status !== expectedState) return result();
            draft.order.payment_status = nextState;
            if (nextState === 'paid') draft.order.paid_at = timestamp;
            return result([], 1);
          }
          throw new Error('Unexpected settlement SQL');
        },
        release() {
          expect(begun).toBe(false);
        },
      };
    },
  });

  return db;
}

describe('POST /api/credits order state protection', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('does not reject an order unless it is waiting for manual review', async () => {
    const db = installSql('paid');
    const response = await post('admin-reject');
    expect(response.status).toBe(409);
    expect(db.state.order.payment_status).toBe('paid');
  });

  it('leaves an order in the legacy reversing state for reconciliation', async () => {
    const db = installSql('reversing');
    const before = structuredClone(db.state);
    const response = await post('reverse-order');
    expect(response.status).toBe(409);
    expect(db.state).toEqual(before);
  });

  it.each(['reversed', 'rejected'])('does not confirm an order that is already %s', async (state) => {
    const db = installSql(state);
    const before = structuredClone(db.state);
    const response = await post('admin-confirm');
    expect(response.status).toBe(409);
    expect(db.state).toEqual(before);
  });

  it.each([
    ['admin-confirm', 404],
    ['reverse-order', 409],
  ] as const)('keeps the missing order response for %s', async (action, status) => {
    installSql('submitted');
    expect((await post(action, 'unknown-order')).status).toBe(status);
  });

  it.each(['pending', 'pending_paid'])('approves a legacy %s order and initializes missing credits', async (state) => {
    const db = installSql(state);
    db.state.account = null;
    expect((await post('admin-confirm-paid')).status).toBe(200);
    expect(db.state.order.payment_status).toBe('paid');
    expect(db.state.account).toEqual({ balance: 100, totalRecharged: 100, totalUsed: 0 });
    expect(db.state.ledger).toHaveLength(1);
  });

  it.each(ACTIONS)('serializes competing $action requests and settles once', async (expected) => {
    const db = installSql(expected.initial);
    const before = structuredClone(db.state);
    const reachedCommit = deferred();
    const commit = deferred();
    db.beforeCommit = async () => { reachedCommit.resolve(); await commit.promise; };

    const first = post(expected.action);
    let second: Promise<Response> | undefined;
    try {
      expect(await Promise.race([reachedCommit.promise.then(() => 'staged'), first.then(r => r.status)])).toBe('staged');
      second = post(expected.action === 'admin-confirm' ? 'admin-confirm-paid' : expected.action);
      await vi.waitFor(() => expect(db.lockAttempts).toBe(2));
      expect(db.state).toEqual(before);
    } finally {
      commit.resolve();
      await Promise.all([first, second]);
    }

    const success = await first;
    expect(success.status).toBe(200);
    const replay = await second!;
    if (expected.action === 'admin-confirm') {
      expect(replay.status).toBe(400);
      expect(await replay.json()).toEqual({ success: false, error: '订单已处理' });
      expect(db.state.order.paid_at).toBeGreaterThan(0);
    } else {
      expect(await success.json()).toMatchObject({ success: true, balance: 50 });
      expect(replay.status).toBe(409);
      expect(await replay.json()).toEqual({ success: false, error: '订单不是可撤销的已到账状态，或正在被其他管理员处理' });
      expect(db.state.order.paid_at).toBe(123);
    }
    expect(db.state.order.payment_status).toBe(expected.terminal);
    expect(db.state.account).toEqual({ balance: expected.balance, totalRecharged: expected.recharged, totalUsed: expected.used });
    expect(db.state.ledger).toEqual([{
      type: expected.type, amount: expected.delta, balanceAfter: expected.balance,
      description: expect.stringContaining(ORDER_ID),
    }]);
  });

  it('a competing rejection rechecks status after the approval commits', async () => {
    const db = installSql('submitted');
    const reachedCommit = deferred();
    const commit = deferred();
    db.beforeCommit = async () => { reachedCommit.resolve(); await commit.promise; };
    const approval = post('admin-confirm');
    let rejection: Promise<Response> | undefined;
    try {
      expect(await Promise.race([reachedCommit.promise.then(() => 'staged'), approval.then(r => r.status)])).toBe('staged');
      rejection = post('admin-reject');
      await vi.waitFor(() => expect(db.lockAttempts).toBe(2));
    } finally {
      commit.resolve();
      await Promise.all([approval, rejection]);
    }
    expect((await approval).status).toBe(200);
    expect((await rejection!).status).toBe(409);
    expect(db.state.order.payment_status).toBe('paid');
    expect(db.state.ledger).toHaveLength(1);
  });

  describe.each(ACTIONS)('$action rollback', ({ action, initial, terminal, balance }) => {
    it.each(['ledger', 'order'] as const)('keeps all writes uncommitted if %s cannot be written, then allows retry', async (failAt) => {
      const db = installSql(initial);
      // Approval also has to roll back the newly created account.
      if (action === 'admin-confirm') db.state.account = null;
      const before = structuredClone(db.state);
      db.failAt = failAt;
      expect((await post(action)).status).toBe(500);
      expect(db.state).toEqual(before);

      db.failAt = undefined;
      expect((await post(action)).status).toBe(200);
      expect(db.state.order.payment_status).toBe(terminal);
      expect(db.state.account?.balance).toBe(action === 'admin-confirm' ? 100 : balance);
      expect(db.state.ledger).toHaveLength(1);
    });
  });

  it('leaves a paid order intact when its credits have been spent', async () => {
    const db = installSql('paid');
    db.state.account!.balance = 99;
    const before = structuredClone(db.state);
    const response = await post('reverse-order');
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: '扣除积分失败: Insufficient credits' });
    expect(db.state).toEqual(before);
  });
});
