// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRechargeOrders } from '@/components/dashboard/admin-recharge-orders';
import UserCreditsTab from '@/components/dashboard/user-credits-tab';

interface PendingRequest {
  action: string;
  body?: Record<string, unknown>;
  resolve: (response: Response) => void;
}

let requests: PendingRequest[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!['/api/credits', '/api/credits?action=transactions', '/api/credits/payment-status'].includes(url)) {
      throw new Error('Unexpected request');
    }
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    return new Promise<Response>(resolve => requests.push({ action: String(body?.action ?? url), body, resolve }));
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function takeRequest(action: string, orderId?: string): PendingRequest {
  const index = requests.findIndex(request => request.action === action && (orderId === undefined || request.body?.orderId === orderId));
  expect(index, `pending request for ${action}`).toBeGreaterThanOrEqual(0);
  return requests.splice(index, 1)[0];
}

async function reply(request: PendingRequest, body: object, status = 200) {
  await act(async () => { request.resolve(Response.json(body, { status })); });
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function row(id: string) {
  return within(screen.getByText(id, { exact: true }).closest('tr')!);
}

describe('administrator order decisions', () => {
  it('keeps each row busy for its own action through a competing decision and refresh', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('合成驳回原因');
    const a = { orderId: 'order-a', username: '用户甲', amount: 1, credits: 100, paymentMethod: 'wechat', status: 'submitted' };
    const b = { ...a, orderId: 'order-b', username: '用户乙' };
    render(<AdminRechargeOrders />);
    await reply(takeRequest('admin-all-orders'), { success: true, orders: [a, b] });

    fireEvent.click(row('order-a').getByRole('button', { name: '确认到账' }));
    fireEvent.click(row('order-b').getByRole('button', { name: '驳回' }));
    const approval = takeRequest('admin-confirm-paid', 'order-a');
    const rejection = takeRequest('admin-reject', 'order-b');
    for (const id of ['order-a', 'order-b']) {
      expect((row(id).getByRole('button', { name: '确认到账' }) as HTMLButtonElement).disabled).toBe(true);
      expect((row(id).getByRole('button', { name: '驳回' }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(row('order-a').getByRole('button', { name: '确认到账' }).getAttribute('aria-busy')).toBe('true');
    expect(row('order-b').getByRole('button', { name: '驳回' }).getAttribute('aria-busy')).toBe('true');
    fireEvent.click(row('order-b').getByRole('button', { name: '确认到账' }));
    expect(requests).toHaveLength(0);

    await reply(approval, { success: true });
    await reply(takeRequest('admin-all-orders'), { success: true, orders: [{ ...a, status: 'paid' }, b] });
    expect(screen.queryByText('order-a')).toBeNull();
    expect((row('order-b').getByRole('button', { name: '确认到账' }) as HTMLButtonElement).disabled).toBe(true);
    expect((row('order-b').getByRole('button', { name: '驳回' }) as HTMLButtonElement).disabled).toBe(true);

    await reply(rejection, { success: false, error: '合成写入失败' }, 500);
    expect((row('order-b').getByRole('button', { name: '驳回' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

const paymentStatus = {
  success: true, canRecharge: true, methods: ['wechat'],
  qrUrls: { wechat: '/synthetic/qr', alipay: '' }, status: { wechat: true, alipay: false },
};
const balance = (value: number) => ({ success: true, credits: { balance: value, totalRecharged: 0, totalUsed: 0 } });
const history = (description?: string) => ({
  success: true,
  transactions: description ? [{ id: description, amount: 10, description, balanceAfter: 40, createdAt: '2026-11-11T00:00:00Z' }] : [],
});
const created = (id: string) => ({
  success: true, orderId: id, amount: 100, priceCny: 1, bonusCredits: 0,
  paymentMethod: 'wechat', note: '', paymentQrUrl: '/synthetic/qr',
});
const creditRead = '/api/credits';
const historyRead = '/api/credits?action=transactions';
const paymentRead = '/api/credits/payment-status';

function openAndCreate() {
  click('充值');
  fireEvent.click(screen.getByText('100', { exact: true }).closest('button')!);
  const submit = screen.getByRole<HTMLButtonElement>('button', { name: /^(立即充值|创建订单中)/ });
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  return takeRequest('create-order');
}

async function mountUser() {
  const onToast = vi.fn();
  const view = render(<UserCreditsTab userId="account-a" isDark={false} onToast={onToast} />);
  await reply(takeRequest(creditRead), balance(40));
  await reply(takeRequest(historyRead), history());
  await reply(takeRequest(paymentRead), paymentStatus);
  return { ...view, onToast };
}

describe('dashboard recharge dialog', () => {
  it('ignores a closed dialog’s late creation while a new order is being created', async () => {
    const { onToast } = await mountUser();
    const first = openAndCreate();
    click('关闭充值');
    const second = openAndCreate();

    await reply(first, created('old-order'));
    expect(screen.queryByText('扫码完成支付')).toBeNull();
    expect(onToast).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '创建订单中...' }) as HTMLButtonElement).disabled).toBe(true);

    await reply(second, created('new-order'));
    click('查询订单状态');
    await reply(takeRequest('query-order', 'new-order'), { success: true, order: { paymentStatus: 'submitted' } });
    expect(onToast).toHaveBeenCalledWith('订单正在等待管理员审核，请耐心等待', 'info');
  });

  it('ignores a late confirmation from an order in a closed dialog', async () => {
    const { onToast } = await mountUser();
    await reply(openAndCreate(), created('old-order'));
    click('我已完成付款');
    const oldConfirmation = takeRequest('confirm-paid', 'old-order');
    click('关闭充值');
    await reply(openAndCreate(), created('new-order'));
    onToast.mockClear();

    await reply(oldConfirmation, { success: true, alreadyPaid: true });
    expect(onToast).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
    expect(screen.getByText('扫码完成支付')).toBeTruthy();
    expect((screen.getByRole('button', { name: '我已完成付款' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ['我已完成付款', 'confirm-paid', { success: true, alreadyPaid: true }],
    ['查询订单状态', 'query-order', { success: true, order: { paymentStatus: 'paid' } }],
  ] as const)('shows the paid receipt after %s and refreshes the current balance', async (label, action, data) => {
    const { onToast } = await mountUser();
    await reply(openAndCreate(), created('paid-order'));
    onToast.mockClear();
    click(label);
    await reply(takeRequest(action, 'paid-order'), data);

    expect(screen.getByRole('heading', { name: '积分已到账' })).toBeTruthy();
    expect(screen.getByText('100 积分', { exact: true })).toBeTruthy();
    expect(screen.getByText('paid-order', { exact: true })).toBeTruthy();
    expect(screen.queryByAltText('支付二维码')).toBeNull();
    expect(screen.queryByRole('button', { name: '我已完成付款' })).toBeNull();
    expect(onToast.mock.calls).toEqual([['订单已确认，积分已到账', 'success']]);
    await reply(takeRequest(creditRead), balance(140));
    await reply(takeRequest(historyRead), history('合成充值记录'));
    expect(screen.getByText('140', { exact: true })).toBeTruthy();
    expect(screen.getByText('合成充值记录')).toBeTruthy();
    click('关闭充值');
    click('充值');
    expect(screen.queryByText('paid-order', { exact: true })).toBeNull();
    expect(screen.getByRole('heading', { name: '选择充值套餐' })).toBeTruthy();
  });

  it('discards the old account’s history and paid query on account change', async () => {
    const onToast = vi.fn();
    const { rerender } = render(<UserCreditsTab userId="account-a" isDark={false} onToast={onToast} />);
    await reply(takeRequest(creditRead), balance(40));
    const oldHistory = takeRequest(historyRead);
    await reply(takeRequest(paymentRead), paymentStatus);
    await reply(openAndCreate(), created('old-order'));
    click('查询订单状态');
    const oldQuery = takeRequest('query-order', 'old-order');
    onToast.mockClear();

    rerender(<UserCreditsTab userId="account-b" isDark={false} onToast={onToast} />);
    expect(screen.queryByText('40', { exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭充值' })).toBeNull();
    await reply(takeRequest(creditRead), balance(73));
    await reply(takeRequest(historyRead), history('当前账号记录'));
    await reply(takeRequest(paymentRead), paymentStatus);
    await reply(oldHistory, history('旧账号记录'));
    await reply(oldQuery, { success: true, order: { paymentStatus: 'paid' } });

    expect(screen.getByText('73', { exact: true })).toBeTruthy();
    expect(screen.getByText('当前账号记录')).toBeTruthy();
    expect(screen.queryByText('旧账号记录')).toBeNull();
    expect(onToast).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it('keeps the latest balance when an older mount read finishes last', async () => {
    render(<StrictMode><UserCreditsTab userId="account-a" isDark={false} /></StrictMode>);
    const older = takeRequest(creditRead);
    await reply(takeRequest(creditRead), balance(73));
    await reply(takeRequest(historyRead), history('当前积分记录'));
    await reply(older, balance(40));

    expect(screen.getByText('73', { exact: true })).toBeTruthy();
    expect(screen.queryByText('40', { exact: true })).toBeNull();
    expect(screen.getByText('当前积分记录')).toBeTruthy();
    expect(requests.map(request => request.action)).toEqual([paymentRead, paymentRead]);
  });
});
