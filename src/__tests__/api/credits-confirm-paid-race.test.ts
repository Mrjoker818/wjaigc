import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  execSql: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  dbGetCredits: vi.fn(),
  dbAdjustCredits: vi.fn(),
  dbGetCreditTransactions: vi.fn(),
  dbGetAllCredits: vi.fn(),
  dbInitCredits: vi.fn(),
  getPaymentStatus: vi.fn(),
  loadCreditPricingConfig: vi.fn(),
  resolveConfiguredCreditCost: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql, isDatabaseConfigured: mocks.isDatabaseConfigured }));
vi.mock('@/lib/db-storage', () => ({
  dbGetCredits: mocks.dbGetCredits,
  dbAdjustCredits: mocks.dbAdjustCredits,
  dbGetCreditTransactions: mocks.dbGetCreditTransactions,
  dbGetAllCredits: mocks.dbGetAllCredits,
  dbInitCredits: mocks.dbInitCredits,
}));
vi.mock('@/lib/payment-config', () => ({ getPaymentStatus: mocks.getPaymentStatus }));
vi.mock('@/lib/credit-pricing', () => ({
  loadCreditPricingConfig: mocks.loadCreditPricingConfig,
  resolveConfiguredCreditCost: mocks.resolveConfiguredCreditCost,
}));

import { POST } from '@/app/api/credits/route';

type OrderStatus = 'pending' | 'submitted' | 'paid' | 'rejected';
interface SyntheticOrder {
  id: string;
  user_id: string;
  payment_status: OrderStatus;
  submitted_at?: number;
  updated_at?: number;
}
interface SqlCall { kind: 'select' | 'update'; sql: string; params: unknown[] }

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function request(actor: string, extra: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://synthetic.invalid/api/credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-synthetic-actor': actor },
    body: JSON.stringify({ action: 'confirm-paid', orderId: 'synthetic-order', ...extra }),
  });
}

function installStorage(order: SyntheticOrder, afterSnapshot?: (snapshot: SyntheticOrder) => Promise<void>) {
  const calls: SqlCall[] = [];
  mocks.execSql.mockImplementation(async (sql: string, params: unknown[]) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('SELECT ')) {
      expect(normalized).toBe('SELECT * FROM wujie_recharge_orders WHERE id = $1 AND user_id = $2');
      calls.push({ kind: 'select', sql: normalized, params: [...params] });
      if (params[0] !== order.id || params[1] !== order.user_id) return { rows: [], rowCount: 0 };
      const snapshot = { ...order };
      if (afterSnapshot) await afterSnapshot(snapshot);
      return { rows: [snapshot], rowCount: 1 };
    }
    if (normalized.startsWith('UPDATE ')) {
      expect(normalized).toBe("UPDATE wujie_recharge_orders SET payment_status = 'submitted', submitted_at = $2, updated_at = $3 WHERE id = $1 AND user_id = $4 AND payment_status = 'pending' RETURNING id");
      calls.push({ kind: 'update', sql: normalized, params: [...params] });
      if (params[0] !== order.id || params[3] !== order.user_id || order.payment_status !== 'pending') return { rows: [], rowCount: 0 };
      expect(typeof params[1]).toBe('number');
      expect(params[2]).toBe(params[1]);
      order.payment_status = 'submitted';
      order.submitted_at = params[1] as number;
      order.updated_at = params[2] as number;
      return { rows: [{ id: order.id }], rowCount: 1 };
    }
    throw Error('UNEXPECTED_SQL');
  });
  return calls;
}

describe('confirm-paid conditional update', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockImplementation(async (req: NextRequest) => ({ id: req.headers.get('x-synthetic-actor'), role: 'user' }));
    vi.stubGlobal('fetch', vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each(['paid', 'rejected'] as const)('does not overwrite an administrator %s terminal state after a pending snapshot', async terminal => {
    const order: SyntheticOrder = { id: 'synthetic-order', user_id: 'owner-a', payment_status: 'pending' };
    const read = deferred(), release = deferred();
    let captured = false;
    const calls = installStorage(order, async () => {
      if (!captured) { captured = true; read.resolve(); await release.promise; }
    });
    const operation = POST(request('owner-a'));
    try {
      await read.promise;
      // A separate synthetic actor commits the terminal state after the read snapshot.
      order.payment_status = terminal;
    } finally { release.resolve(); }
    const response = await operation;
    const json = await response.json();
    expect(order.payment_status).toBe(terminal);
    expect(order.submitted_at).toBeUndefined();
    expect(calls.map(call => call.kind)).toEqual(['select', 'update', 'select']);
    expect(calls[0].params).toEqual(['synthetic-order', 'owner-a']);
    expect(calls[1].params[3]).toBe('owner-a');
    expect(calls[2].params).toEqual(['synthetic-order', 'owner-a']);
    if (terminal === 'paid') {
      expect(response.status).toBe(200);
      expect(json).toMatchObject({ success: true, alreadyPaid: true });
      expect(json.submitted).toBeUndefined();
    } else {
      expect(response.status).toBe(400);
      expect(json).toMatchObject({ success: false, error: '订单状态不正确' });
    }
    expect(mocks.dbAdjustCredits).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('two concurrent confirmations transition once and the loser rereads the submitted state', async () => {
    const order: SyntheticOrder = { id: 'synthetic-order', user_id: 'owner-a', payment_status: 'pending' };
    const bothRead = deferred(), release = deferred();
    let snapshots = 0;
    const calls = installStorage(order, async snapshot => {
      if (snapshot.payment_status === 'pending' && snapshots < 2) {
        snapshots++;
        if (snapshots === 2) bothRead.resolve();
        await release.promise;
      }
    });
    const first = POST(request('owner-a')), second = POST(request('owner-a'));
    try { await bothRead.promise; } finally { release.resolve(); }
    const responses = await Promise.all([first, second]);
    const payloads = await Promise.all(responses.map(response => response.json()));
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(payloads.filter(data => data.submitted === true)).toHaveLength(1);
    expect(payloads.filter(data => data.alreadySubmitted === true)).toHaveLength(1);
    expect(order.payment_status).toBe('submitted');
    expect(order.submitted_at).toBeTypeOf('number');
    expect(calls.filter(call => call.kind === 'update')).toHaveLength(2);
    expect(calls.filter(call => call.kind === 'select')).toHaveLength(3);
    expect(mocks.dbAdjustCredits).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rereads an already submitted order when the conditional update affects zero rows', async () => {
    const order: SyntheticOrder = { id: 'synthetic-order', user_id: 'owner-a', payment_status: 'pending' };
    const read = deferred(), release = deferred();
    let captured = false;
    const calls = installStorage(order, async () => {
      if (!captured) { captured = true; read.resolve(); await release.promise; }
    });
    const operation = POST(request('owner-a'));
    try { await read.promise; order.payment_status = 'submitted'; } finally { release.resolve(); }
    const response = await operation;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, alreadySubmitted: true });
    expect(calls.map(call => call.kind)).toEqual(['select', 'update', 'select']);
    expect(order.payment_status).toBe('submitted');
    expect(order.submitted_at).toBeUndefined();
    expect(mocks.dbAdjustCredits).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not disclose or modify another user’s order even if the body names its owner', async () => {
    const order: SyntheticOrder = { id: 'synthetic-order', user_id: 'owner-a', payment_status: 'pending' };
    const calls = installStorage(order);
    const response = await POST(request('user-b', { userId: 'owner-a' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, error: '订单不存在' });
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('select');
    expect(calls[0].params).toEqual(['synthetic-order', 'user-b']);
    expect(order.payment_status).toBe('pending');
    expect(mocks.dbAdjustCredits).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('submits a normal pending order without adding credits', async () => {
    const order: SyntheticOrder = { id: 'synthetic-order', user_id: 'owner-a', payment_status: 'pending' };
    const calls = installStorage(order);
    const response = await POST(request('owner-a'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, submitted: true });
    expect(order.payment_status).toBe('submitted');
    expect(calls.map(call => call.kind)).toEqual(['select', 'update']);
    expect(mocks.dbAdjustCredits).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
