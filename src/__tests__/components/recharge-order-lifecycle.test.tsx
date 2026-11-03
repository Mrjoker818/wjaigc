// @vitest-environment jsdom

import { Suspense, type ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import RechargePage from '@/app/recharge/[orderId]/page';

// Actual page, React.use(params), Next Link, controls and rendering. No module mocks.
// Eleven cases use empty payLink. Only the two QR races defer toDataURL; img DOM is real.
// The transport models replies already queued beyond cancellation: it retains any
// original AbortSignal, but deliberately permits those replies to finish after abort.
type OwnedOrderId = 'ab2-order-a-20261019' | 'ab2-order-b-20261019';
type PaymentStatus = 'pending' | 'submitted' | 'paid' | 'rejected';

interface OrderReply {
  success: true;
  order: {
    id: OwnedOrderId;
    amount: number;
    priceCny: number;
    bonus: number;
    paymentMethod: 'wechat' | 'alipay';
    paymentStatus: PaymentStatus;
    createdAt: number;
    expiresAt: number;
    isExpired: boolean;
    rejectReason: string | null;
  };
  payLink: string;
  note: string;
  balance: number | null;
}

interface ReplyGate {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
}

interface QrGate {
  promise: Promise<string>;
  resolve: (dataUrl: string) => void;
  reject: (error: Error) => void;
}

interface PlannedRequest {
  url: string;
  method: 'GET' | 'POST';
  gate: ReplyGate;
  started: boolean;
}

interface ObservedRequest {
  url: string;
  method: string;
  init: RequestInit | undefined;
  signal: AbortSignal | null | undefined;
}

interface RouteProps {
  params: Promise<{ orderId: string }>;
}

interface MountedRoute {
  switchTo: (orderId: OwnedOrderId) => Promise<void>;
}

const A: OwnedOrderId = 'ab2-order-a-20261019';
const B: OwnedOrderId = 'ab2-order-b-20261019';
const plans: PlannedRequest[] = [];
const requests: ObservedRequest[] = [];
const pending = new Set<ReplyGate>();
const pendingQr = new Set<QrGate>();
const extraGetReplies = new Map<string, OrderReply>();
const transportFaults: string[] = [];
const savedMarkers = new Map<string, string | null>();
let pollingClock = false;

function orderA(paymentStatus: PaymentStatus = 'pending'): OrderReply {
  return {
    success: true,
    order: {
      id: 'ab2-order-a-20261019', amount: 173, priceCny: 1.73, bonus: 0,
      paymentMethod: 'wechat', paymentStatus, createdAt: 1792339200000,
      expiresAt: 2000000000000, isExpired: false, rejectReason: null,
    },
    payLink: '', note: 'AB2 甲订单说明', balance: 901,
  };
}

function orderB(): OrderReply {
  return {
    success: true,
    order: {
      id: 'ab2-order-b-20261019', amount: 421, priceCny: 4.21, bonus: 0,
      paymentMethod: 'alipay', paymentStatus: 'pending', createdAt: 1792339260000,
      expiresAt: 2000000000000, isExpired: false, rejectReason: null,
    },
    payLink: '', note: 'AB2 乙订单说明', balance: null,
  };
}

function planReply(url: string, method: 'GET' | 'POST' = 'GET'): ReplyGate {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const gate: ReplyGate = {
    promise,
    resolve: (response: Response): void => { pending.delete(gate); resolve(response); },
    reject: (error: Error): void => { pending.delete(gate); reject(error); },
  };
  pending.add(gate);
  plans.push({ url, method, gate, started: false });
  return gate;
}

function planOrder(orderId: OwnedOrderId): ReplyGate {
  return planReply(`/api/recharge/${orderId}`);
}

function deferQr(): QrGate {
  let resolve!: (dataUrl: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const gate: QrGate = {
    promise,
    resolve: (dataUrl: string): void => { pendingQr.delete(gate); resolve(dataUrl); },
    reject: (error: Error): void => { pendingQr.delete(gate); reject(error); },
  };
  pendingQr.add(gate);
  return gate;
}

function fetchOwnedReply(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
  const url = request ? request.url : String(input);
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  requests.push({ url, method, init, signal: init?.signal ?? request?.signal });
  const planned = plans.find(plan => !plan.started && plan.url === url && plan.method === method);
  if (planned) {
    planned.started = true;
    return planned.gate.promise;
  }
  // Poll cases explicitly allow complete inert replies for extra owned GETs so
  // a leaked interval fails the request-count assertion, not fixture teardown.
  const extra = method === 'GET' ? extraGetReplies.get(url) : undefined;
  if (extra) return Promise.resolve(Response.json(extra));
  transportFaults.push(`${method} ${url}`);
  return Promise.resolve(Response.json({ success: false, error: 'AB2 未计划的请求' }, { status: 500 }));
}

function RouteView({ params }: RouteProps): ReactElement {
  return (
    <Suspense fallback={<p>路由参数加载中...</p>}>
      <RechargePage params={params} />
    </Suspense>
  );
}

async function mountOrder(orderId: OwnedOrderId): Promise<MountedRoute> {
  const params = Promise.resolve({ orderId });
  let view!: ReturnType<typeof render>;
  await act(async (): Promise<void> => {
    view = render(<RouteView params={params} />);
    await params;
  });
  return {
    switchTo: async (nextOrderId: OwnedOrderId): Promise<void> => {
      const nextParams = Promise.resolve({ orderId: nextOrderId });
      // Same mounted wrapper/page identity; no key or unmount supplied by the test.
      await act(async (): Promise<void> => {
        view.rerender(<RouteView params={nextParams} />);
        await nextParams;
      });
    },
  };
}

async function deliver(gate: ReplyGate, body: unknown, status = 200): Promise<void> {
  await act(async (): Promise<void> => {
    gate.resolve(Response.json(body, { status }));
    await gate.promise;
  });
}

async function failTransport(gate: ReplyGate): Promise<void> {
  await act(async (): Promise<void> => {
    gate.reject(new TypeError('AB2 甲订单已排队的网络失败'));
    await Promise.allSettled([gate.promise]);
  });
}

function startPollingClock(): void {
  // Only intervals are faked. React scheduling, Date and other timers stay real.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  pollingClock = true;
}

async function advancePoll(milliseconds: number): Promise<void> {
  await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

function requestedOrderUrls(): string[] {
  return requests.filter(request => request.method === 'GET').map(request => request.url);
}

function expectBMetadataEntered(): void {
  // Call only before deliver(b, ...). The real page must have started B's GET,
  // whose queued response is still withheld; Suspense fallback alone is no oracle.
  expect(
    requests.filter(request => request.method === 'GET' && request.url === '/api/recharge/ab2-order-b-20261019').length,
    'B metadata GET must have entered before checking order isolation',
  ).toBe(1);
  expect(screen.queryByText('路由参数加载中...')).toBeNull();
}

describe('recharge ab lifecycle', () => {
  beforeEach((): void => {
    plans.length = 0;
    requests.length = 0;
    transportFaults.length = 0;
    pending.clear();
    pendingQr.clear();
    extraGetReplies.clear();
    savedMarkers.clear();
    pollingClock = false;
    for (const key of ['recharge_pay_ab2-order-a-20261019', 'recharge_pay_ab2-order-b-20261019']) {
      savedMarkers.set(key, sessionStorage.getItem(key));
      sessionStorage.removeItem(key);
    }
    vi.stubGlobal('fetch', fetchOwnedReply);
  });

  afterEach(async (): Promise<void> => {
    // Always unmount first and settle every outstanding gate, including when a
    // behavioral assertion fails before a deferred response can be delivered.
    try {
      cleanup();
    } finally {
      try {
        await act(async (): Promise<void> => {
          const remaining = [...pending];
          const remainingQr = [...pendingQr];
          for (const gate of remaining) {
            gate.resolve(Response.json({ success: false, error: 'AB2 fixture disposed' }, { status: 410 }));
          }
          for (const gate of remainingQr) gate.resolve('');
          await Promise.allSettled([
            ...remaining.map(gate => gate.promise),
            ...remainingQr.map(gate => gate.promise),
          ]);
        });
      } finally {
        try {
          for (const [key, value] of savedMarkers) {
            if (value === null) sessionStorage.removeItem(key);
            else sessionStorage.setItem(key, value);
          }
        } finally {
          if (pollingClock) { vi.clearAllTimers(); vi.useRealTimers(); }
          vi.unstubAllGlobals();
          vi.restoreAllMocks();
        }
      }
    }
    expect(transportFaults, 'unexpected transport calls are fixture faults, not qualified RED').toEqual([]);
  });

  it('hides A metadata and returned-payment controls immediately while B metadata is pending', async (): Promise<void> => {
    sessionStorage.setItem('recharge_pay_ab2-order-a-20261019', '1');
    const a = planOrder(A);
    const b = planOrder(B);
    const route = await mountOrder(A);
    await deliver(a, orderA());
    expect(screen.getAllByText('¥1.73')).toHaveLength(2);
    expect(screen.getByText('💡 AB2 甲订单说明')).toBeTruthy();
    expect(screen.getByRole('link', { name: '重新支付 ¥1.73' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '我已完成付款' })).toBeTruthy();

    await route.switchTo(B);
    expectBMetadataEntered();
    // Assert before resolving B's metadata: no old controls/data during the gap.
    expect(screen.queryAllByText('¥1.73')).toHaveLength(0);
    expect(screen.queryByText('💡 AB2 甲订单说明')).toBeNull();
    expect(screen.queryByText('173')).toBeNull();
    expect(screen.queryByRole('heading', { name: '无界AI 积分充值' })).toBeNull();
    expect(screen.queryByRole('link', { name: '重新支付 ¥1.73' })).toBeNull();
    expect(screen.queryByRole('button', { name: '我已完成付款' })).toBeNull();
    expect(screen.getByText('加载中...')).toBeTruthy();

    await deliver(b, orderB());
    expect(screen.getAllByText('¥4.21')).toHaveLength(2);
    expect(screen.getByText('421')).toBeTruthy();
    expect(screen.getByText('订单号：ab2-order-b-20261019...')).toBeTruthy();
    expect(screen.getByText('支付链接未配置')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '我已完成付款' })).toBeNull();
    expect(sessionStorage.getItem('recharge_pay_ab2-order-a-20261019')).toBe('1');
    expect(sessionStorage.getItem('recharge_pay_ab2-order-b-20261019')).toBeNull();
  });

  it('hides A success, awarded amount and balance immediately while B metadata is pending', async (): Promise<void> => {
    const a = planOrder(A);
    const b = planOrder(B);
    const route = await mountOrder(A);
    await deliver(a, orderA('paid'));
    expect(screen.getByRole('heading', { name: '充值成功！' })).toBeTruthy();
    expect(screen.getByText('173 积分')).toBeTruthy();
    expect(screen.getByText('901 积分')).toBeTruthy();

    await route.switchTo(B);
    expectBMetadataEntered();
    expect(screen.queryByRole('heading', { name: '充值成功！' })).toBeNull();
    expect(screen.queryByText('173 积分')).toBeNull();
    expect(screen.queryByText('901 积分')).toBeNull();
    expect(screen.queryByText('当前余额')).toBeNull();
    expect(screen.getByText('加载中...')).toBeTruthy();

    await deliver(b, orderB());
    expect(screen.getByRole('heading', { name: '无界AI 积分充值' })).toBeTruthy();
    expect(screen.getByText('💡 AB2 乙订单说明')).toBeTruthy();
    expect(screen.getAllByText('¥4.21')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: '充值成功！' })).toBeNull();
  });

  it('keeps ready B data when the initial A GET completes late with a paid order', async (): Promise<void> => {
    const a = planOrder(A);
    const b = planOrder(B);
    const route = await mountOrder(A);
    await route.switchTo(B);
    expectBMetadataEntered();
    await deliver(b, orderB());
    expect(screen.getByText('💡 AB2 乙订单说明')).toBeTruthy();
    expect(screen.getAllByText('¥4.21')).toHaveLength(2);

    await deliver(a, orderA('paid'));
    expect(screen.queryByRole('heading', { name: '充值成功！' })).toBeNull();
    expect(screen.queryByText('173 积分')).toBeNull();
    expect(screen.queryByText('901 积分')).toBeNull();
    expect(screen.getByRole('heading', { name: '无界AI 积分充值' })).toBeTruthy();
    expect(screen.getAllByText('¥4.21')).toHaveLength(2);
    expect(screen.getByText('💡 AB2 乙订单说明')).toBeTruthy();
    expect(screen.getByText('订单号：ab2-order-b-20261019...')).toBeTruthy();
    expect(requestedOrderUrls()).toEqual(['/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-b-20261019']);
  });

  it('keeps the actual B error when the initial A GET fails late', async (): Promise<void> => {
    const a = planOrder(A);
    const b = planOrder(B);
    const route = await mountOrder(A);
    await route.switchTo(B);
    expectBMetadataEntered();
    await deliver(b, { success: false, error: 'AB2 乙订单不可访问' }, 403);
    expect(screen.getByRole('heading', { name: '加载失败' })).toBeTruthy();
    expect(screen.getByText('AB2 乙订单不可访问')).toBeTruthy();

    await failTransport(a);
    expect(screen.queryByText('网络错误，请刷新重试')).toBeNull();
    expect(screen.getByText('AB2 乙订单不可访问')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '加载失败' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '充值成功！' })).toBeNull();
    expect(screen.queryByText('¥1.73')).toBeNull();
  });

  it('keeps B usable across a delayed A confirm-paid reply and sends the original A orderId', async (): Promise<void> => {
    sessionStorage.setItem('recharge_pay_ab2-order-a-20261019', '1');
    sessionStorage.setItem('recharge_pay_ab2-order-b-20261019', '1');
    const a = planOrder(A);
    const confirm = planReply('/api/credits', 'POST');
    const b = planOrder(B);
    const route = await mountOrder(A);
    await deliver(a, orderA());
    fireEvent.click(screen.getByRole('button', { name: '我已完成付款' }));
    expect((screen.getByRole('button', { name: '提交中...' }) as HTMLButtonElement).disabled).toBe(true);
    const posts = requests.filter(request => request.method === 'POST');
    expect(posts.map(request => ({ url: request.url, body: JSON.parse(String(request.init?.body)) as unknown }))).toEqual([
      { url: '/api/credits', body: { action: 'confirm-paid', orderId: 'ab2-order-a-20261019' } },
    ]);
    expect(new Headers(posts[0].init?.headers).get('Content-Type')).toBe('application/json');

    await route.switchTo(B);
    expectBMetadataEntered();
    await deliver(b, orderB());
    expect(screen.getAllByText('¥4.21')).toHaveLength(2);
    // Soft checks let the same trace also deliver A's response after observing
    // whether B inherited A's busy flag, rather than ending before the race.
    expect.soft(screen.queryByRole('button', { name: '提交中...' })).toBeNull();
    expect.soft((screen.queryByRole('button', { name: '我已完成付款' }) as HTMLButtonElement | null)?.disabled).toBe(false);
    await deliver(confirm, {
      success: true,
      message: '付款确认已提交，管理员审核通过后积分将自动到账，通常1-10分钟内处理完成',
      submitted: true,
    });
    expect(screen.queryByRole('heading', { name: '等待审核' })).toBeNull();
    expect(screen.getByRole('heading', { name: '无界AI 积分充值' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '我已完成付款' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('link', { name: '重新支付 ¥4.21' })).toBeTruthy();
    expect(screen.getByText('💡 AB2 乙订单说明')).toBeTruthy();
  });

  it('refreshes authoritative paid metadata promptly on alreadyPaid and shows an unknown balance', async (): Promise<void> => {
    sessionStorage.setItem('recharge_pay_ab2-order-a-20261019', '1');
    const initial = planOrder(A);
    const confirm = planReply('/api/credits', 'POST');
    const authoritative = planOrder(A);
    await mountOrder(A);
    await deliver(initial, orderA());
    expect(screen.getAllByText('¥1.73')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '我已完成付款' }));
    // Exact existing credits-route response: it supplies no amount or balance.
    await deliver(confirm, { success: true, message: '订单已到账', alreadyPaid: true });

    // No clock advancement or sleep: authoritative revalidation must already
    // have started when notification handling and its microtasks finish.
    expect(requests.map(request => ({ method: request.method, url: request.url }))).toEqual([
      { method: 'GET', url: '/api/recharge/ab2-order-a-20261019' },
      { method: 'POST', url: '/api/credits' },
      { method: 'GET', url: '/api/recharge/ab2-order-a-20261019' },
    ]);
    const post = requests.find(request => request.method === 'POST');
    expect(JSON.parse(String(post?.init?.body)) as unknown).toEqual({ action: 'confirm-paid', orderId: 'ab2-order-a-20261019' });
    await deliver(authoritative, { ...orderA('paid'), balance: null });
    expect(screen.queryByRole('heading', { name: '等待审核' })).toBeNull();
    expect(screen.getByRole('heading', { name: '充值成功！' })).toBeTruthy();
    expect(screen.getByText('173 积分')).toBeTruthy();
    expect(screen.getByText('当前余额')).toBeTruthy();
    expect(screen.getByText('-- 积分')).toBeTruthy();
    expect(screen.queryByText('0 积分')).toBeNull();
    expect(screen.queryByText('901 积分')).toBeNull();
    expect(screen.queryByRole('button', { name: '我已完成付款' })).toBeNull();
  });

  it.each(['paid', 'rejected'] as const)('ignores a late %s A poll after switching to B and stops polling A', async (status: 'paid' | 'rejected'): Promise<void> => {
    startPollingClock();
    const a = planOrder(A);
    const oldPoll = planOrder(A);
    const b = planOrder(B);
    extraGetReplies.set('/api/recharge/ab2-order-a-20261019', orderA());
    extraGetReplies.set('/api/recharge/ab2-order-b-20261019', orderB());
    const route = await mountOrder(A);
    await deliver(a, orderA('submitted'));
    expect(screen.getByRole('heading', { name: '等待审核' })).toBeTruthy();
    expect(screen.getByText('¥1.73')).toBeTruthy();
    await advancePoll(4999);
    expect(requestedOrderUrls()).toEqual(['/api/recharge/ab2-order-a-20261019']);
    await advancePoll(1);
    expect(requestedOrderUrls()).toEqual(['/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019']);

    await route.switchTo(B);
    expectBMetadataEntered();
    await deliver(b, orderB());
    expect(screen.getAllByText('¥4.21').length).toBeGreaterThan(0);
    const lateOrder = orderA(status);
    lateOrder.order.rejectReason = status === 'rejected' ? 'AB2 甲订单旧轮询驳回' : null;
    await deliver(oldPoll, lateOrder);
    await advancePoll(5000);
    expect(requestedOrderUrls()).toEqual([
      '/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-b-20261019',
    ]);
    expect(screen.queryByRole('heading', { name: '充值成功！' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '审核未通过' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '等待审核' })).toBeNull();
    expect(screen.queryByText('AB2 甲订单旧轮询驳回')).toBeNull();
    expect(screen.queryByText('¥1.73')).toBeNull();
    expect(screen.queryByText('173 积分')).toBeNull();
    expect(screen.queryByText('901 积分')).toBeNull();
    expect(screen.getByRole('heading', { name: '无界AI 积分充值' })).toBeTruthy();
    expect(screen.getAllByText('¥4.21')).toHaveLength(2);
    expect(screen.getByText('💡 AB2 乙订单说明')).toBeTruthy();
  });

  it('shows the actual rejection immediately on manual refresh without waiting for another poll', async (): Promise<void> => {
    const initial = planOrder(A);
    const refresh = planOrder(A);
    await mountOrder(A);
    await deliver(initial, orderA('submitted'));
    expect(screen.getByRole('heading', { name: '等待审核' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    const rejected = orderA('rejected');
    rejected.order.rejectReason = 'AB2 转账金额与甲订单不符';
    await deliver(refresh, rejected);

    expect(screen.queryByRole('heading', { name: '等待审核' })).toBeNull();
    expect(screen.getByRole('heading', { name: '审核未通过' })).toBeTruthy();
    expect(screen.getByText('AB2 转账金额与甲订单不符')).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回工作台重新充值' }).getAttribute('href')).toBe('/?view=dashboard');
    expect(screen.queryByRole('button', { name: '刷新状态' })).toBeNull();
    expect(requestedOrderUrls()).toEqual(['/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019']);
  });

  it.each([
    { label: 'zero', balance: 0, shown: '0 积分', absent: '-- 积分' },
    { label: 'unknown', balance: null, shown: '-- 积分', absent: '0 积分' },
  ])('preserves a $label balance when manual refresh moves submitted to paid', async ({ balance, shown, absent }: { balance: number | null; shown: string; absent: string }): Promise<void> => {
    const initial = planOrder(A);
    const refresh = planOrder(A);
    await mountOrder(A);
    await deliver(initial, orderA('submitted'));
    expect(screen.getByRole('heading', { name: '等待审核' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    await deliver(refresh, { ...orderA('paid'), balance });

    expect(screen.queryByRole('heading', { name: '等待审核' })).toBeNull();
    expect(screen.getByRole('heading', { name: '充值成功！' })).toBeTruthy();
    expect(screen.getByText('173 积分')).toBeTruthy();
    expect(screen.getByText('当前余额')).toBeTruthy();
    expect(screen.getByText(shown)).toBeTruthy();
    expect(screen.queryByText(absent)).toBeNull();
    expect(screen.queryByRole('button', { name: '刷新状态' })).toBeNull();
    expect(requestedOrderUrls()).toEqual(['/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019']);
  });

  it.each(['success', 'failure'] as const)('keeps the real B QR image after delayed A QR %s', async (outcome: 'success' | 'failure'): Promise<void> => {
    const oldQr = deferQr();
    const currentQr = deferQr();
    const encoderInputs: unknown[] = [];
    // The only QR boundary: bypass QR matrix/raster encoding and its canvas/PNG
    // work, retaining the page's actual effects, promise handlers and img element.
    // The two literal PNGs are synthetic completion values, not scannable QR tests.
    vi.spyOn(QRCode, 'toDataURL').mockImplementation((text: unknown): Promise<string> => {
      encoderInputs.push(text);
      if (text === 'https://recharge-ab2.invalid/pay/a') return oldQr.promise;
      if (text === 'https://recharge-ab2.invalid/pay/b') return currentQr.promise;
      transportFaults.push(`Unexpected QR input: ${String(text)}`);
      return Promise.reject(new Error('AB2 未计划的二维码编码'));
    });
    const a = planOrder(A);
    const b = planOrder(B);
    const route = await mountOrder(A);
    await deliver(a, { ...orderA(), payLink: 'https://recharge-ab2.invalid/pay/a' });
    expect(screen.getByRole('link', { name: '立即支付 ¥1.73' }).getAttribute('href')).toBe('https://recharge-ab2.invalid/pay/a');
    expect(encoderInputs, 'the old A encoding must actually have started').toEqual(['https://recharge-ab2.invalid/pay/a']);
    expect(screen.queryByRole('img', { name: '支付二维码' })).toBeNull();

    await route.switchTo(B);
    expectBMetadataEntered();
    await deliver(b, { ...orderB(), payLink: 'https://recharge-ab2.invalid/pay/b' });
    expect(encoderInputs).toEqual(['https://recharge-ab2.invalid/pay/a', 'https://recharge-ab2.invalid/pay/b']);
    await act(async (): Promise<void> => {
      currentQr.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=');
      await currentQr.promise;
    });
    expect(screen.getByRole('img', { name: '支付二维码' }).getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=');
    expect(screen.getByRole('link', { name: '立即支付 ¥4.21' }).getAttribute('href')).toBe('https://recharge-ab2.invalid/pay/b');
    expect(screen.getByText('订单号：ab2-order-b-20261019...')).toBeTruthy();

    await act(async (): Promise<void> => {
      if (outcome === 'success') {
        oldQr.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=');
      } else {
        oldQr.reject(new Error('AB2 甲订单旧二维码编码失败'));
      }
      await Promise.allSettled([oldQr.promise]);
    });
    // Query, rather than get, makes an incorrectly cleared image fail on the
    // observed src value instead of a missing-selector/fixture exception.
    expect(screen.queryByRole('img', { name: '支付二维码' })?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=');
    expect(screen.getAllByRole('img', { name: '支付二维码' })).toHaveLength(1);
    expect(screen.getAllByText('¥4.21')).toHaveLength(2);
    expect(screen.getByText('💡 AB2 乙订单说明')).toBeTruthy();
    expect(screen.getByRole('link', { name: '立即支付 ¥4.21' }).getAttribute('href')).toBe('https://recharge-ab2.invalid/pay/b');
    expect(screen.queryByRole('link', { name: '立即支付 ¥1.73' })).toBeNull();
  });

  it('overlap slow background poll can finish paid after another 5000 ms tick', async (): Promise<void> => {
    startPollingClock();
    const initial = planOrder(A);
    const firstPoll = planOrder(A);
    // A mistaken extra background read receives complete submitted metadata;
    // terminal UI, rather than an unplanned transport error, is the RED oracle.
    extraGetReplies.set('/api/recharge/ab2-order-a-20261019', orderA('submitted'));
    await mountOrder(A);
    await deliver(initial, orderA('submitted'));
    expect(screen.getByRole('heading', { name: '等待审核' })).toBeTruthy();

    await advancePoll(5000);
    expect(requestedOrderUrls()).toEqual(['/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019']);
    await advancePoll(5000);
    await deliver(firstPoll, orderA('paid'));

    expect(screen.queryByRole('heading', { name: '充值成功！' })?.textContent).toBe('充值成功！');
    expect(screen.queryByText('173 积分')?.textContent).toBe('173 积分');
    expect(screen.queryByText('901 积分')?.textContent).toBe('901 积分');
    expect(screen.queryByRole('heading', { name: '等待审核' })).toBeNull();
    expect(requestedOrderUrls()).toEqual(['/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019']);
  });

  it('overlap manual rejection just before a tick survives a newer background failure', async (): Promise<void> => {
    startPollingClock();
    const initial = planOrder(A);
    const manual = planOrder(A);
    const background = planOrder(A);
    extraGetReplies.set('/api/recharge/ab2-order-a-20261019', orderA('submitted'));
    await mountOrder(A);
    await deliver(initial, orderA('submitted'));
    await advancePoll(4999);
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    expect(requestedOrderUrls()).toEqual(['/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019']);
    await advancePoll(1);
    const backgroundStarted = requestedOrderUrls().length > 2;
    const rejected = orderA('rejected');
    rejected.order.rejectReason = 'AB2 临近轮询的手动刷新驳回';
    await deliver(manual, rejected);

    // Continue the trace after an immediate-state failure, so any background
    // request that did start is also observed failing before the final oracle.
    expect.soft(screen.queryByRole('heading', { name: '审核未通过' })?.textContent).toBe('审核未通过');
    expect.soft(screen.queryByText('AB2 临近轮询的手动刷新驳回')?.textContent).toBe('AB2 临近轮询的手动刷新驳回');
    if (backgroundStarted) await failTransport(background);
    expect(screen.queryByRole('heading', { name: '审核未通过' })?.textContent).toBe('审核未通过');
    expect(screen.queryByText('AB2 临近轮询的手动刷新驳回')?.textContent).toBe('AB2 临近轮询的手动刷新驳回');
    expect(screen.queryByRole('heading', { name: '等待审核' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '充值成功！' })).toBeNull();
  });

  it('overlap manual refresh starts ahead of an older poll and fences its late paid result', async (): Promise<void> => {
    startPollingClock();
    const initial = planOrder(A);
    const oldPoll = planOrder(A);
    const manual = planOrder(A);
    extraGetReplies.set('/api/recharge/ab2-order-a-20261019', orderA('submitted'));
    await mountOrder(A);
    await deliver(initial, orderA('submitted'));
    await advancePoll(5000);
    expect(requestedOrderUrls()).toEqual(['/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019']);
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    // The manual GET must enter while the old poll remains unresolved.
    expect(requestedOrderUrls()).toEqual([
      '/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019', '/api/recharge/ab2-order-a-20261019',
    ]);
    const rejected = orderA('rejected');
    rejected.order.rejectReason = 'AB2 手动审核驳回优先';
    await deliver(manual, rejected);
    expect(screen.queryByRole('heading', { name: '审核未通过' })?.textContent).toBe('审核未通过');
    expect(screen.queryByText('AB2 手动审核驳回优先')?.textContent).toBe('AB2 手动审核驳回优先');

    await deliver(oldPoll, orderA('paid'));
    expect(screen.queryByRole('heading', { name: '审核未通过' })?.textContent).toBe('审核未通过');
    expect(screen.queryByText('AB2 手动审核驳回优先')?.textContent).toBe('AB2 手动审核驳回优先');
    expect(screen.queryByRole('heading', { name: '充值成功！' })).toBeNull();
    expect(screen.queryByText('901 积分')).toBeNull();
    expect(screen.queryByRole('heading', { name: '等待审核' })).toBeNull();
  });
});
