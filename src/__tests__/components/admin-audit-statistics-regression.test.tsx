// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import tls from 'node:tls';

const boundary = vi.hoisted(() => ({ violations: [] as string[] }));
vi.mock('pg', () => {
  boundary.violations.push('pg');
  throw new Error('AUDIT_TEST_DATABASE_FORBIDDEN');
});

let AdminTabs: typeof import('@/components/dashboard/admin-tabs').default;
type Props = React.ComponentProps<typeof import('@/components/dashboard/admin-tabs').default>;
let dataRoot: string | undefined;
let dataIdentity: fs.Stats | undefined;
let previousData: string | undefined;
let previousFetch: typeof globalThis.fetch;
let previousSocket: typeof net.Socket.prototype.connect;
let previousTls: typeof tls.connect;
let installed = false;
const deniedSocket = function (): never { boundary.violations.push('socket'); throw new Error('AUDIT_TEST_NETWORK_FORBIDDEN'); };
const deniedTls = function (): never { boundary.violations.push('tls'); throw new Error('AUDIT_TEST_NETWORK_FORBIDDEN'); };
const deniedFetch = (input: RequestInfo | URL): Promise<Response> => {
  boundary.violations.push('request:' + String(input));
  return Promise.reject(new Error('AUDIT_TEST_UNEXPECTED_REQUEST'));
};

function restoreBoundary(): void {
  if (!installed) return;
  const replaced = net.Socket.prototype.connect !== deniedSocket || tls.connect !== deniedTls || globalThis.fetch !== deniedFetch;
  const lateViolations = [...boundary.violations];
  let error: unknown;
  try {
    if (!dataRoot || !dataIdentity) throw new Error('AUDIT_TEST_DATA_IDENTITY_MISSING');
    const current = fs.lstatSync(dataRoot);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== dataIdentity.dev || current.ino !== dataIdentity.ino) {
      throw new Error('AUDIT_TEST_DATA_IDENTITY_CHANGED');
    }
    // Only removes this test's still-empty directory; any contents are preserved and fail the test.
    fs.rmdirSync(dataRoot);
  } catch (cause) { error = cause; }
  finally {
    if (previousData === undefined) delete process.env.WUJIE_DATA_DIR;
    else process.env.WUJIE_DATA_DIR = previousData;
    globalThis.fetch = previousFetch;
    if (net.Socket.prototype.connect === deniedSocket) net.Socket.prototype.connect = previousSocket;
    if (tls.connect === deniedTls) tls.connect = previousTls;
    installed = false;
  }
  if (error) throw error;
  if (replaced) throw new Error('AUDIT_TEST_NETWORK_GUARD_REPLACED');
  if (lateViolations.length) throw new Error('AUDIT_TEST_LATE_VIOLATIONS: ' + lateViolations.join(','));
}

beforeAll(async () => {
  const root = fs.realpathSync(os.tmpdir());
  const cwd = fs.realpathSync(process.cwd());
  const relative = path.relative(cwd, root);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('AUDIT_TEST_TEMP_MUST_BE_OUTSIDE_PROJECT');
  }
  dataRoot = fs.mkdtempSync(path.join(root, 'wujie-audit-ui-'));
  dataIdentity = fs.lstatSync(dataRoot);
  previousData = process.env.WUJIE_DATA_DIR;
  previousFetch = globalThis.fetch;
  previousSocket = net.Socket.prototype.connect;
  previousTls = tls.connect;
  process.env.WUJIE_DATA_DIR = dataRoot;
  globalThis.fetch = deniedFetch;
  net.Socket.prototype.connect = deniedSocket as typeof net.Socket.prototype.connect;
  tls.connect = deniedTls as typeof tls.connect;
  installed = true;
  try {
    AdminTabs = (await import('@/components/dashboard/admin-tabs')).default;
    if (boundary.violations.length) throw new Error('AUDIT_TEST_IMPORT_VIOLATIONS: ' + boundary.violations.join(','));
  } catch (error) { restoreBoundary(); throw error; }
});

afterAll(async () => {
  // Drain the immediately queued teardown work while the network boundary is still active.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  restoreBoundary();
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const ok = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const row = { id: 'audit-1', user_name: '合成旧记录', action: 'image_generate', level: 'info', created_at: 1 };
const stats = { totalActions: '34', todayActions: '12', uniqueUsers: '4', actionBreakdown: {},
  levelBreakdown: { warn: '6', error: '8' }, errorCount: '9', unresolvedErrorCount: '2', avgDurationMs: 13 };
const logResponse = (logs: unknown[] = [row]): Response => ok({ success: true, logs, total: logs.length, page: 1, pageSize: 20 });
const props: Props = {
  activeTab: 'audit', adminUsers: [], adminGroups: [], providers: [], onRefreshAdmin: () => undefined,
  onCreateUser: async () => undefined, onRenameUser: async () => undefined,
  onResetPassword: async () => undefined, onToggleUser: async () => undefined,
  onDeleteUser: () => undefined, onBatchDeleteUsers: async () => false,
  onToggleUserPermission: async () => undefined, onRechargeCredits: async () => undefined,
};
let logs: Array<Promise<Response>>;
let statistics: Array<Promise<Response>>;
let requests: string[];

beforeEach(() => {
  expect(boundary.violations, 'unexpected work between tests remains visible').toEqual([]);
  logs = []; statistics = []; requests = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (init?.method && init.method !== 'GET') {
      boundary.violations.push('method:' + init.method);
      return Promise.reject(new Error('AUDIT_TEST_UNEXPECTED_METHOD'));
    }
    const queue = url === '/api/admin/op-log?page=1&limit=20' ? logs
      : url === '/api/admin/audit?stats=true' ? statistics : null;
    if (!queue || queue.length === 0) {
      boundary.violations.push('request:' + url);
      return Promise.reject(new Error('AUDIT_TEST_UNEXPECTED_REQUEST'));
    }
    requests.push(url);
    return queue.shift()!;
  };
});

afterEach(() => {
  globalThis.fetch = deniedFetch;
  cleanup();
  try {
    expect(boundary.violations, 'even caught unexpected network or database attempts fail the test').toEqual([]);
    expect(logs, 'all planned list responses were requested').toHaveLength(0);
    expect(statistics, 'all planned statistics responses were requested').toHaveLength(0);
  } finally {
    boundary.violations.length = 0;
    globalThis.fetch = deniedFetch;
  }
});


function card(label: string): HTMLElement {
  const element = screen.getByText(label, { exact: true }).parentElement;
  if (!element) throw new Error('AUDIT_TEST_CARD_MISSING');
  return element;
}

describe('audit statistics UI with the real read contract', () => {
  it('denies unexpected fetch, direct sockets and the database module', async () => {
    await expect(fetch('https://outside.invalid/')).rejects.toThrow('AUDIT_TEST_UNEXPECTED_REQUEST');
    expect(boundary.violations).toEqual(['request:https://outside.invalid/']);
    boundary.violations.length = 0;
    const socket = new net.Socket();
    expect(() => socket.connect(5432, '127.0.0.1')).toThrow('AUDIT_TEST_NETWORK_FORBIDDEN');
    socket.destroy();
    expect(boundary.violations).toEqual(['socket']);
    boundary.violations.length = 0;
    const databaseRejected = await import('pg').then(() => false, () => true);
    expect(databaseRejected).toBe(true);
    expect(boundary.violations).toEqual(['pg']);
    boundary.violations.length = 0;
  });

  it('shows real aggregate fields and distinguishes missing metrics from zero', async () => {
    logs.push(Promise.resolve(logResponse()));
    statistics.push(Promise.resolve(ok({ success: true, stats })));
    render(<AdminTabs {...props} />);
    await waitFor(() => expect(within(card('今日操作')).getByText('12')).toBeTruthy());
    expect(within(card('总记录')).getByText('34')).toBeTruthy();
    expect(within(card('累计错误')).getByText('9')).toBeTruthy();
    expect(within(card('累计警告')).getByText('6')).toBeTruthy();
    expect(within(card('未处理错误')).getByText('2')).toBeTruthy();
    expect(within(card('本周操作')).getByText('-')).toBeTruthy();
    expect(screen.getByText('合成旧记录')).toBeTruthy();
    expect(requests).toEqual(['/api/admin/op-log?page=1&limit=20', '/api/admin/audit?stats=true']);
  });

  it('accepts real empty aggregates and rejects malformed statistics', async () => {
    logs.push(Promise.resolve(logResponse()), Promise.resolve(logResponse()));
    const zero = { ...stats, todayActions: '0', totalActions: '0', errorCount: '0', unresolvedErrorCount: '0', levelBreakdown: {} };
    statistics.push(Promise.resolve(ok({ success: true, stats: zero })), Promise.resolve(ok({ success: true, stats: { ...stats, levelBreakdown: { warn: null } } })));
    render(<AdminTabs {...props} />);
    await waitFor(() => expect(within(card('今日操作')).getByText('0')).toBeTruthy());
    expect(within(card('累计警告')).getByText('0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect((await screen.findByRole('alert')).textContent).toContain('日志统计加载失败');
    expect(within(card('累计警告')).getByText('-')).toBeTruthy();
  });

  it('shows an empty list and an independent retry while statistics remain pending', async () => {
    const pending = deferred<Response>();
    logs.push(Promise.resolve(logResponse([])));
    statistics.push(pending.promise, Promise.resolve(ok({ success: true, stats })));
    render(<AdminTabs {...props} />);
    try {
      await screen.findByText('暂无操作日志');
      expect(screen.getByRole('status').textContent).toContain('日志统计加载中');
      expect(screen.getByRole('button', { name: '刷新' }).querySelector('.animate-spin')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '重试日志统计' }));
      await waitFor(() => expect(within(card('今日操作')).getByText('12')).toBeTruthy());
      expect(requests.filter(url => url.includes('/op-log?'))).toHaveLength(1);
      await act(async () => { pending.resolve(ok({ success: false }, 503)); await pending.promise; });
      expect(within(card('今日操作')).getByText('12')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      await act(async () => { pending.resolve(ok({ success: false }, 503)); await pending.promise; });
    }
  });

  it('shows a statistics failure without replacing it with zeros and retries statistics only', async () => {
    logs.push(Promise.resolve(logResponse()));
    statistics.push(Promise.resolve(ok({ success: false }, 500)), Promise.resolve(ok({ success: true, stats })));
    render(<AdminTabs {...props} />);
    expect((await screen.findByRole('alert')).textContent).toContain('日志统计加载失败');
    expect(within(card('今日操作')).getByText('-')).toBeTruthy();
    expect(screen.getByText('合成旧记录')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试日志统计' }));
    await waitFor(() => expect(within(card('今日操作')).getByText('12')).toBeTruthy());
    expect(requests.filter(url => url.includes('/op-log?'))).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([401, 403])('a statistics %i hides logs until a later successful list read', async status => {
    logs.push(Promise.resolve(logResponse()), Promise.resolve(logResponse()));
    statistics.push(Promise.resolve(ok({ success: false }, status)), Promise.resolve(ok({ success: true, stats })));
    render(<AdminTabs {...props} />);
    expect((await screen.findByRole('alert')).textContent).toContain('没有权限');
    expect(screen.queryByText('合成旧记录')).toBeNull();
    expect(within(card('今日操作')).getByText('-')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试读取日志' }));
    await screen.findByText('合成旧记录');
    await waitFor(() => expect(within(card('今日操作')).getByText('12')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a current list denial is not overridden by a newer statistics success', async () => {
    const pendingStats = deferred<Response>();
    const pendingList = deferred<Response>();
    logs.push(Promise.resolve(logResponse()), pendingList.promise);
    statistics.push(pendingStats.promise, Promise.resolve(ok({ success: true, stats })));
    render(<AdminTabs {...props} />);
    try {
      await screen.findByText('合成旧记录');
      fireEvent.click(screen.getByRole('button', { name: '刷新' }));
      fireEvent.click(screen.getByRole('button', { name: '重试日志统计' }));
      await waitFor(() => expect(within(card('今日操作')).getByText('12')).toBeTruthy());
      await act(async () => { pendingList.resolve(ok({ success: false }, 403)); await pendingList.promise; });
      expect((await screen.findByRole('alert')).textContent).toContain('没有权限');
      expect(screen.queryByText('合成旧记录')).toBeNull();
      expect(within(card('今日操作')).getByText('-')).toBeTruthy();
    } finally {
      await act(async () => { pendingStats.resolve(ok({ success: false }, 503)); await pendingStats.promise; });
    }
  });

  it('keeps the denial when a previously started statistics retry succeeds later', async () => {
    const old = deferred<Response>();
    const later = deferred<Response>();
    logs.push(Promise.resolve(logResponse()), Promise.resolve(logResponse()));
    statistics.push(old.promise, later.promise, Promise.resolve(ok({ success: true, stats })));
    render(<AdminTabs {...props} />);
    try {
      await screen.findByText('合成旧记录');
      fireEvent.click(screen.getByRole('button', { name: '重试日志统计' }));
      await act(async () => { old.resolve(ok({ success: false }, 403)); await old.promise; });
      expect((await screen.findByRole('alert')).textContent).toContain('没有权限');
      expect(screen.queryByText('合成旧记录')).toBeNull();
      await act(async () => { later.resolve(ok({ success: true, stats })); await later.promise; });
      expect(screen.queryByText('合成旧记录')).toBeNull();
      expect(screen.getByRole('alert').textContent).toContain('没有权限');
      fireEvent.click(screen.getByRole('button', { name: '重试读取日志' }));
      await screen.findByText('合成旧记录');
      await waitFor(() => expect(within(card('今日操作')).getByText('12')).toBeTruthy());
    } finally {
      await act(async () => { old.resolve(ok({ success: false }, 403)); later.resolve(ok({ success: true, stats })); await Promise.all([old.promise, later.promise]); });
    }
  });
});
