// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Toaster, toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';
import { installJsdomMediaQueries } from '../helpers/jsdom-browser-apis';

const manager = vi.hoisted(() => ({
  getProjects: vi.fn(() => []), getUsageStats: vi.fn(() => []), getCurrentUserId: vi.fn(() => 'credits-test-user'),
}));
vi.mock('@/lib/user-manager', () => ({ UserManager: { getInstance: () => manager } }));
import DashboardView from '@/components/dashboard/dashboard-view';

const user: User = { id: 'credits-test-user', name: '测试用户', password: '', role: 'user', status: 'active', createdAt: 1, updatedAt: 1, productType: 'canvas' };
const order = { success: true, orderId: 'synthetic-order', amount: 100, priceCny: 1, bonusCredits: 0, paymentMethod: 'wechat', note: '' };
const status = { success: true, canRecharge: true, methods: ['wechat'], qrUrls: { wechat: '', alipay: '' }, payLinks: { wechat: '', alipay: '' }, note: '', status: { wechat: true, alipay: false } };
type Scenario = 'failure' | 'network' | 'submitted' | 'rejected';
let scenario: Scenario;
let release: ((response: Response) => void) | undefined;
let restoreMedia: (() => void) | undefined;
let unexpected: string[];
let posts: Array<Record<string, unknown>>;

beforeEach(() => {
  unexpected = []; posts = []; release = undefined;
  restoreMedia = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? 'GET';
    if (method === 'GET' && url === '/api/credits/payment-status') return Response.json(status);
    if (method === 'GET' && url === '/api/credits') return Response.json({ success: true, credits: { balance: 40, totalRecharged: 40, totalUsed: 0 } });
    if (method === 'GET' && (url === '/api/credits?action=transactions' || url === '/api/credits?transactions=true&limit=30')) return Response.json({ success: true, transactions: [] });
    if (method === 'POST' && url === '/api/credits') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      posts.push(body);
      if (body.action === 'create-order' && body.amount === 100 && body.paymentMethod === 'wechat') {
        if (scenario === 'network') throw Error('synthetic offline');
        if (scenario === 'failure') return new Promise<Response>(resolve => { release = resolve; });
        return Response.json(order);
      }
      if (body.action === 'query-order' && body.orderId === 'synthetic-order' && (scenario === 'submitted' || scenario === 'rejected')) {
        return Response.json({ success: true, order: { status: scenario, rejectReason: '合成驳回原因' } });
      }
    }
    unexpected.push(`${method} ${url}`);
    throw Error('blocked unexpected request');
  }));
});

afterEach(() => {
  release?.(Response.json({ success: false }));
  toast.dismiss(); cleanup(); restoreMedia?.(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  expect(unexpected).toEqual([]);
});

async function start(): Promise<void> {
  render(<><DashboardView user={user} onOpenProject={() => undefined} onNewProject={() => undefined} /><Toaster duration={60000} /></>);
  fireEvent.click(within(screen.getByRole('navigation', { hidden: true })).getByRole('button', { name: /^积分/ }));
  fireEvent.click(await screen.findByRole('button', { name: /^充值$/ }));
  const tile = screen.getByText('100', { exact: true }).closest('button');
  expect(tile).not.toBeNull(); fireEvent.click(tile!);
  fireEvent.click(screen.getByRole('button', { name: '立即充值 ¥1.00' }));
}

async function expectToast(message: string, type: string): Promise<void> {
  const text = await screen.findByText(message, {}, { timeout: 3000 });
  expect(text.closest('[data-sonner-toast]')?.getAttribute('data-type')).toBe(type);
}

describe('ordinary-user credits notifications through DashboardView', () => {
  it('keeps the selection and disables the pending request before showing a server error', async () => {
    scenario = 'failure'; await start();
    await waitFor(() => expect(release).toBeDefined());
    expect((screen.getByRole('button', { name: '创建订单中...' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-sonner-toast]')).toBeNull();
    expect(screen.getByText('100', { exact: true }).closest('button')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { release!(Response.json({ success: false, error: '合成订单拒绝' })); });
    await expectToast('合成订单拒绝', 'error');
    expect((screen.getByRole('button', { name: '立即充值 ¥1.00' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('100', { exact: true }).closest('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(posts).toEqual([{ action: 'create-order', amount: 100, paymentMethod: 'wechat' }]);
  });

  it('reports a rejected network request as an error without discarding selection', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    scenario = 'network'; await start();
    await expectToast('创建订单失败，请稍后重试', 'error');
    await waitFor(() => expect((screen.getByRole('button', { name: '立即充值 ¥1.00' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('100', { exact: true }).closest('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(logged).toHaveBeenCalled();
  });

  it.each([
    ['submitted', '订单正在等待管理员审核，请耐心等待', 'info'],
    ['rejected', '订单已被驳回：合成驳回原因', 'error'],
  ] as const)('keeps the order and shows %s as %s', async (next, message, type) => {
    scenario = next; await start();
    await expectToast('订单创建成功，请点击立即支付', 'success');
    expect(screen.getByText('扫码完成支付')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查询订单状态' }));
    await expectToast(message, type);
    await waitFor(() => expect((screen.getByRole('button', { name: '查询订单状态' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('扫码完成支付')).toBeTruthy();
    expect(posts).toEqual([{ action: 'create-order', amount: 100, paymentMethod: 'wechat' }, { action: 'query-order', orderId: 'synthetic-order' }]);
  });
});
