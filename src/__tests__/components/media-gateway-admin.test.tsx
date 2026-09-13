// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MediaGatewayAdmin from '@/components/dashboard/media-gateway-admin';

const secret = `wmg_${'s'.repeat(43)}`;
const key = {
  id: 'gwkey_1',
  userId: 'user-1',
  keyPrefix: 'wmg_abcd1234',
  label: 'Production',
  requestsPerMinute: 60,
  dailyQuota: 1000,
  todayUsage: 12,
  enabled: true,
  createdBy: 'admin-1',
  createdAt: '2026-09-13T00:00:00.000Z',
  lastUsedAt: '2026-09-13T01:00:00.000Z',
  revokedAt: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockApi(initialKeys: Array<Record<string, unknown>> = [key]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/admin/gateway/keys' && method === 'GET') {
      return jsonResponse({ success: true, keys: initialKeys });
    }
    if (url === '/api/admin/gateway/keys' && method === 'POST') {
      return jsonResponse({ success: true, key, secret }, 201);
    }
    if (url === '/api/admin/gateway/keys/gwkey_1' && method === 'DELETE') {
      return jsonResponse({ success: true, key: { ...key, enabled: false, revokedAt: '2026-09-13T02:00:00.000Z' } });
    }
    if (url === '/api/admin/gateway/keys/gwkey_1' && method === 'PATCH') {
      return jsonResponse({ success: true, key });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('MediaGatewayAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading, error, and empty states', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    })));
    const loadingView = render(<MediaGatewayAdmin />);
    expect(screen.getByRole('status', { name: '正在加载媒体网关密钥' })).toBeTruthy();
    await act(async () => resolveRequest?.(jsonResponse({ success: true, keys: [] })));
    expect(await screen.findByText('尚未签发媒体网关密钥')).toBeTruthy();
    loadingView.unmount();

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, error: 'unavailable' }, 503)));
    render(<MediaGatewayAdmin />);
    expect((await screen.findByRole('alert')).textContent).toContain('加载媒体网关密钥失败');
  });

  it('never renders a full secret in the list and exposes a copy tooltip for the prefix', async () => {
    mockApi([{ ...key, secret }]);
    render(<MediaGatewayAdmin />);

    expect((await screen.findAllByText('Production')).length).toBeGreaterThan(0);
    expect(screen.queryByText(secret)).toBeNull();
    const copyButton = screen.getAllByRole('button', { name: '复制前缀' })[0];
    fireEvent.focus(copyButton);
    expect((await screen.findByRole('tooltip')).textContent).toContain('复制前缀');
  });

  it('shows the issued secret only in the one-time dialog and never persists it', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    mockApi([]);
    render(<MediaGatewayAdmin />);
    await screen.findByText('尚未签发媒体网关密钥');

    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));

    expect(await screen.findByText(secret)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByText(secret)).toBeNull());
    expect(setItem).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^wmg_/));
    setItem.mockRestore();
  });

  it('requires confirmation before revoking a key', async () => {
    const fetchMock = mockApi();
    render(<MediaGatewayAdmin />);
    await screen.findAllByText('Production');

    fireEvent.click(screen.getAllByRole('button', { name: '吊销 Production' })[0]);
    expect(screen.getByRole('alertdialog').textContent).toContain('吊销后无法恢复');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/admin/gateway/keys/gwkey_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '确认吊销' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/gateway/keys/gwkey_1',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('uses a bounded mobile layout at 375px without a horizontally scrolling root', async () => {
    vi.stubGlobal('innerWidth', 375);
    mockApi();
    render(<MediaGatewayAdmin />);
    await screen.findAllByText('Production');

    const root = screen.getByTestId('media-gateway-admin');
    expect(root.className).toContain('max-w-full');
    expect(root.className).toContain('overflow-x-hidden');
    expect(screen.getByTestId('media-gateway-mobile-list').className).toContain('md:hidden');
    expect(screen.getByTestId('media-gateway-table').className).toContain('hidden');
    expect(screen.getByTestId('media-gateway-table').className).toContain('md:table');
  });
});
