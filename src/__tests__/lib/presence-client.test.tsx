// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectPresence } from '@/lib/collaboration/presence-client';

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readonly url: string;
  readonly protocols: string[];
  readyState = 0;
  protocol = 'wujie-presence-v1';
  close = vi.fn(() => { this.readyState = 3; });
  send = vi.fn();
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  snapshot(projectId: string, connectionId: string, sequence: number, participants: unknown[]): void {
    this.onmessage?.({ data: JSON.stringify({ type: 'snapshot', projectId, connectionId, sequence, participants }) } as MessageEvent);
  }

  drop(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

const ticketResponse = (ticket = 'a'.repeat(43)): Response => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, ticket }),
} as Response);

const availabilityResponse = (enabled: boolean): Response => ({
  ok: true, status: 200, json: async () => ({ success: true, enabled }),
} as Response);
const ticketFetch = vi.fn<() => Promise<Response>>();
const availabilityFetch = vi.fn<() => Promise<Response>>();

describe('useProjectPresence', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    ticketFetch.mockReset().mockResolvedValue(ticketResponse());
    availabilityFetch.mockReset().mockResolvedValue(availabilityResponse(true));
    vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => (
      init?.method === 'POST' ? ticketFetch() : availabilityFetch()
    )));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('checks availability before requesting a ticket and makes no failing POST while disabled', async () => {
    availabilityFetch.mockResolvedValue(availabilityResponse(false));
    const { result } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(availabilityFetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith('/api/collaboration/presence-ticket', expect.objectContaining({
      method: 'GET', credentials: 'include', cache: 'no-store', signal: expect.any(AbortSignal),
    }));
    expect(result.current.status).toBe('disabled');
    expect(ticketFetch).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('a signed-out availability response stops ticket issuance and retries', async () => {
    availabilityFetch.mockResolvedValue({ ok: false, status: 401,
      json: async () => ({ success: false, code: 'AUTHENTICATION_REQUIRED' }) } as Response);
    const { result } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(availabilityFetch).toHaveBeenCalledTimes(1);
    expect(ticketFetch).not.toHaveBeenCalled();
  });

  it('does not interpret a malformed availability body as permission to request a ticket', async () => {
    availabilityFetch.mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ success: true, enabled: 'true' }) } as Response);
    const { result } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(ticketFetch).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('rechecks disabled availability when visible again, then follows the original ticket authorization', async () => {
    availabilityFetch.mockResolvedValueOnce(availabilityResponse(false));
    const { result } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(availabilityFetch).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe('disabled');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(ticketFetch).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances[0].protocols).toEqual(['wujie-presence-v1', `wujie-ticket.${'a'.repeat(43)}`]);
  });

  it('ignores an old project availability result after switching projects', async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    availabilityFetch.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }));
    const { rerender } = renderHook(({ id }) => useProjectPresence(id), { initialProps: { id: 'project-a' } });
    await waitFor(() => expect(availabilityFetch).toHaveBeenCalledTimes(1));
    rerender({ id: 'project-b' });
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await act(async () => resolveOld?.(availabilityResponse(true)));
    expect(ticketFetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalledWith('/api/collaboration/presence-ticket', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ projectId: 'project-a' }),
    }));
  });

  it('仅用内存票据连接同源 socket，去重用户并拒绝旧快照', async () => {
    const { result, unmount } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    expect(fetch).toHaveBeenCalledWith('/api/collaboration/presence-ticket', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ projectId: 'project-a' }),
    }));
    expect(socket.url).toBe('ws://localhost:3000/api/collaboration/presence');
    expect(socket.protocols).toEqual(['wujie-presence-v1', `wujie-ticket.${'a'.repeat(43)}`]);
    act(() => {
      socket.open();
      socket.snapshot('project-a', 'connection-1', 3, [
        { userId: 'u1', displayName: '一号', lastSeenAt: '2026-09-24T00:00:00Z' },
        { userId: 'u1', displayName: '一号', lastSeenAt: '2026-09-24T00:00:00Z' },
      ]);
    });
    expect(result.current.status).toBe('online');
    expect(result.current.participants).toHaveLength(1);
    act(() => {
      socket.snapshot('project-b', 'connection-1', 9, []);
      socket.snapshot('project-a', 'other-connection', 9, []);
      socket.snapshot('project-a', 'connection-1', 2, []);
    });
    expect(result.current.participants).toHaveLength(1);
    unmount();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('等待功能票据时不闪现在线 UI，成功取票后才进入连接中', async () => {
    let resolveTicket: ((response: Response) => void) | undefined;
    ticketFetch.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveTicket = resolve; }));
    const { result } = renderHook(() => useProjectPresence('project-a'));
    expect(result.current.status).toBe('disabled');
    await waitFor(() => expect(ticketFetch).toHaveBeenCalledTimes(1));
    act(() => resolveTicket?.(ticketResponse()));
    await waitFor(() => expect(result.current.status).toBe('connecting'));
  });

  it('项目切换立即关闭旧连接，旧项目异步结果不能回填新项目', async () => {
    const { result, rerender } = renderHook(({ projectId }) => useProjectPresence(projectId), {
      initialProps: { projectId: 'project-a' },
    });
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const oldSocket = FakeSocket.instances[0];
    rerender({ projectId: 'project-b' });
    expect(oldSocket.close).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    act(() => oldSocket.snapshot('project-a', 'old', 10, [
      { userId: 'old', displayName: '旧用户', lastSeenAt: '2026-09-24T00:00:00Z' },
    ]));
    expect(result.current.participants).toEqual([]);
  });

  it('关闭标志不伪造在线人数；服务故障显示不可用', async () => {
    ticketFetch.mockResolvedValueOnce({ status: 503, ok: false, json: async () => ({ code: 'PRESENCE_DISABLED' }) } as Response);
    const { result, rerender } = renderHook(({ projectId }) => useProjectPresence(projectId), {
      initialProps: { projectId: 'project-a' as string | null },
    });
    await waitFor(() => expect(result.current.status).toBe('disabled'));
    expect(FakeSocket.instances).toHaveLength(0);
    rerender({ projectId: null });
    expect(result.current.participants).toEqual([]);
  });

  it('新项目同步尚未投影时的 403 可有界退避后重新取票', async () => {
    ticketFetch
      .mockResolvedValueOnce({ status: 403, ok: false, json: async () => ({ code: 'PRESENCE_FORBIDDEN' }) } as Response)
      .mockResolvedValueOnce(ticketResponse());
    const { result } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1), { timeout: 5000 });
    expect(ticketFetch).toHaveBeenCalledTimes(2);
  });

  it('页面隐藏期间切换项目也必须立即清除旧项目在线名单', async () => {
    const { result, rerender } = renderHook(({ projectId }) => useProjectPresence(projectId), {
      initialProps: { projectId: 'project-a' },
    });
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const first = FakeSocket.instances[0];
    act(() => {
      first.open();
      first.snapshot('project-a', 'connection-a', 1, [
        { userId: 'u1', displayName: '旧用户', lastSeenAt: '2026-09-24T00:00:00Z' },
      ]);
    });
    expect(result.current.participants).toHaveLength(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    try {
      rerender({ projectId: 'project-b' });
      expect(result.current.participants).toEqual([]);
      expect(first.close).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    }
  });

  it('断线重新取一次性票据；卸载后不重连', async () => {
    const { unmount } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const first = FakeSocket.instances[0];
    act(() => first.drop());
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 5000 });
    expect(ticketFetch).toHaveBeenCalledTimes(2);
    unmount();
    const count = FakeSocket.instances.length;
    act(() => FakeSocket.instances.at(-1)?.drop());
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(FakeSocket.instances).toHaveLength(count);
  });

  it.each(['disabled', 'signed-out'] as const)('rechecks availability after a disconnect and stops new tickets when %s', async mode => {
    const { result, unmount } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const first = FakeSocket.instances[0];
    act(() => {
      first.open();
      first.snapshot('project-a', 'connection-a', 1, [
        { userId: 'u1', displayName: '一号', lastSeenAt: '2026-09-24T00:00:00Z' },
      ]);
    });
    expect(result.current.status).toBe('online');
    expect(result.current.participants).toHaveLength(1);
    availabilityFetch.mockResolvedValue(mode === 'disabled'
      ? availabilityResponse(false) : new Response('not JSON', { status: 401 }));
    act(() => first.drop());
    await waitFor(() => expect(availabilityFetch).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await waitFor(() => expect(result.current.status).toBe(mode === 'disabled' ? 'disabled' : 'unavailable'));
    expect(result.current.participants).toEqual([]);
    expect(ticketFetch).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(1);
    if (mode === 'signed-out') {
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await new Promise(resolve => setTimeout(resolve, 700));
      expect(availabilityFetch).toHaveBeenCalledTimes(2);
      expect(ticketFetch).toHaveBeenCalledTimes(1);
    }
    unmount();
  });

  it('可见页面心跳超时后重新取票，权限拒绝仍停止重连', async () => {
    const { unmount } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    act(() => FakeSocket.instances[0].drop(1008, 'heartbeat timeout'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 2000 });
    act(() => FakeSocket.instances[1].drop(1008, 'presence unavailable'));
    const count = FakeSocket.instances.length;
    await new Promise(resolve => setTimeout(resolve, 900));
    expect(FakeSocket.instances).toHaveLength(count);
    unmount();
  }, 10_000);

  it('跨标签切换至另一个非空用户 ID 时立即清除原账号在线名单', async () => {
    const { result } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const first = FakeSocket.instances[0];
    act(() => {
      first.open();
      first.snapshot('project-a', 'connection-a', 1, [
        { userId: 'old-user', displayName: '旧用户', lastSeenAt: '2026-09-24T00:00:00Z' },
      ]);
    });
    expect(result.current.participants).toHaveLength(1);
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'unbounded_ai_current_user', newValue: 'new-user',
    })));
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(result.current.participants).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 900));
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('页面隐藏或跨标签登出立即关闭；重新可见时只取新票据', async () => {
    const { result } = renderHook(() => useProjectPresence('project-a'));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const first = FakeSocket.instances[0];
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(result.current.participants).toEqual([]);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    expect(ticketFetch).toHaveBeenCalledTimes(2);
    const second = FakeSocket.instances[1];
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'unbounded_ai_current_user', newValue: null,
    })));
    expect(second.close).toHaveBeenCalledTimes(1);
    act(() => second.drop());
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
