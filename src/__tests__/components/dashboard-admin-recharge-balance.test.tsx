// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DashboardView from '@/components/dashboard/dashboard-view';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dashboard = (id: string) => (
  <DashboardView
    user={{ id, name: id, role: 'admin', productType: 'canvas', createdAt: 1, updatedAt: 1 }}
    onOpenProject={() => {}}
    onNewProject={() => {}}
  />
);

const balanceResponse = (balance: number) => Response.json({ success: true, credits: { balance } });
const badge = () => screen.getByText('积分', { exact: true }).closest('button')?.textContent;

function setup() {
  const balances: Record<string, number> = { admin: 9002, other: 4100 };
  let actor = 'admin';
  let completeRecharge: ((response: Response) => void) | undefined;
  let holdBalance = false;
  let completeBalance: ((response: Response) => void) | undefined;
  const alert = vi.fn();
  vi.stubGlobal('alert', alert);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    switch (String(input)) {
      case '/api/credits':
        if (holdBalance) {
          holdBalance = false;
          return new Promise<Response>(resolve => { completeBalance = resolve; });
        }
        return balanceResponse(balances[actor]);
      case '/api/admin/credits/overview':
        return Response.json({
          success: true,
          distribution: [],
          topUsers: Object.entries(balances).map(([userId, balance]) => ({
            userId, name: `余额表-${userId}`, balance, totalRecharged: 0, consumed: 0,
          })),
          recentTransactions: [],
        });
      case '/api/admin/credits/recharge': {
        const { userId, amount } = JSON.parse(String(init?.body));
        expect(init?.method).toBe('POST');
        expect(amount).toBe(10000);
        return new Promise<Response>(resolve => {
          completeRecharge = response => {
            if (response.ok) balances[userId] += amount;
            resolve(response);
          };
        });
      }
      default:
        return Response.json({ success: false });
    }
  });
  vi.stubGlobal('fetch', fetchMock);

  const view = render(dashboard(actor));
  fireEvent.click(screen.getByRole('button', { name: '积分管理' }));
  return {
    alert,
    async start(target: string) {
      await waitFor(() => expect(badge()).toBe('积分9002'));
      fireEvent.click(screen.getByRole('button', { name: '用户积分' }));
      const row = (await screen.findByText(`余额表-${target}`, { exact: true })).parentElement?.parentElement?.parentElement;
      fireEvent.click(Array.from(row!.querySelectorAll('button')).find(button => button.textContent === '充值')!);
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '10000' } });
      fireEvent.click(screen.getByRole('button', { name: '确认充值' }));
      expect(completeRecharge).toBeDefined();
    },
    async finish(response: Response) {
      await act(async () => { completeRecharge!(response); });
    },
    switchAccount() {
      actor = 'other';
      view.rerender(dashboard(actor));
    },
    holdNextBalance() { holdBalance = true; },
    async finishBalance(value: number) {
      expect(completeBalance).toBeDefined();
      await act(async () => { completeBalance!(balanceResponse(value)); });
    },
  };
}

it('updates the sidebar after the admin recharges their own account', async () => {
  const view = setup();
  await view.start('admin');
  await view.finish(Response.json({ success: true, newBalance: 19002 }));
  expect(await screen.findByText('19,002')).toBeTruthy();
  expect(badge()).toBe('积分19002');
});

it('keeps the active account balance after recharging another account', async () => {
  const view = setup();
  await view.start('other');
  await view.finish(Response.json({ success: true, newBalance: 14100 }));
  expect(await screen.findByText('14,100')).toBeTruthy();
  expect(badge()).toBe('积分9002');
});

it('keeps the previous balance after a rejected recharge', async () => {
  const view = setup();
  await view.start('admin');
  await view.finish(Response.json({ success: false, error: '充值失败' }, { status: 403 }));
  expect(view.alert).toHaveBeenCalledWith('充值失败');
  expect(badge()).toBe('积分9002');
});

it('ignores a recharge that completes after switching accounts', async () => {
  const view = setup();
  await view.start('admin');
  view.switchAccount();
  await waitFor(() => expect(badge()).toBe('积分4100'));
  await view.finish(Response.json({ success: true, newBalance: 19002 }));
  expect(badge()).toBe('积分4100');
});

it('ignores a balance refresh that completes after switching accounts', async () => {
  const view = setup();
  await view.start('admin');
  view.holdNextBalance();
  await view.finish(Response.json({ success: true, newBalance: 19002 }));
  view.switchAccount();
  await waitFor(() => expect(badge()).toBe('积分4100'));
  await view.finishBalance(19002);
  expect(badge()).toBe('积分4100');
});
