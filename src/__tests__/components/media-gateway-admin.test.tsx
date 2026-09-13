// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MediaGatewayAdmin from '@/components/dashboard/media-gateway-admin';

const secret = `wmg_abcd1234${'s'.repeat(35)}`;
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
const issuedKey = { ...key, todayUsage: 0, lastUsedAt: null };

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
      return jsonResponse({ success: true, key: issuedKey, secret }, 201);
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
    vi.useRealTimers();
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

  it.each([
    ['missing usage', { todayUsage: undefined }],
    ['invalid id', { id: 'key_2' }],
    ['invalid prefix', { keyPrefix: secret }],
    ['secret in user', { userId: `user-${secret}` }],
    ['secret in label', { label: `Production ${secret}` }],
    ['secret in creator', { createdBy: `admin-${secret}` }],
    ['invalid rpm', { requestsPerMinute: 601 }],
    ['invalid quota', { dailyQuota: 100_001 }],
    ['invalid usage', { todayUsage: -1 }],
    ['invalid enabled', { enabled: 'yes' }],
    ['invalid created timestamp', { createdAt: 'not-a-date' }],
    ['invalid last-used timestamp', { lastUsedAt: 'not-a-date' }],
    ['invalid revoked timestamp', { revokedAt: 'not-a-date' }],
  ])('fails the entire list closed for %s', async (_label, malformedFields) => {
    mockApi([key, { ...key, id: 'gwkey_2', ...malformedFields }]);
    render(<MediaGatewayAdmin />);

    expect((await screen.findByRole('alert')).textContent).toContain('响应不可信');
    expect(screen.queryByText('Production')).toBeNull();
  });

  it('shows the issued secret only in the one-time dialog and never persists it', async () => {
    const localSetItem = vi.fn();
    const sessionSetItem = vi.fn();
    const storage = (setItem: ReturnType<typeof vi.fn>): Storage => ({
      length: 0,
      clear: vi.fn(),
      getItem: vi.fn(() => null),
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem,
    });
    vi.stubGlobal('localStorage', storage(localSetItem));
    vi.stubGlobal('sessionStorage', storage(sessionSetItem));
    const indexedDbOpen = vi.fn();
    vi.stubGlobal('indexedDB', { open: indexedDbOpen, deleteDatabase: vi.fn(), cmp: vi.fn() });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    mockApi([]);
    render(<MediaGatewayAdmin />);
    await screen.findByText('尚未签发媒体网关密钥');

    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));

    expect(await screen.findByText(secret)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制 Secret' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(secret));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByText(secret)).toBeNull());
    expect(JSON.stringify(localSetItem.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(sessionSetItem.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(indexedDbOpen.mock.calls)).not.toContain(secret);
    expect(indexedDbOpen).not.toHaveBeenCalled();
  });

  it('keeps validation and save errors inside the active sheet', async () => {
    mockApi([]);
    render(<MediaGatewayAdmin />);
    await screen.findByText('尚未签发媒体网关密钥');
    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));

    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
    fireEvent.click(within(sheet).getByRole('button', { name: '确认签发' }));
    expect(within(sheet).getByRole('alert').textContent).toContain('请填写有效');
  });

  it('keeps copy errors inside the one-time secret dialog', async () => {
    mockApi([]);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<MediaGatewayAdmin />);
    await screen.findByText('尚未签发媒体网关密钥');
    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));

    const dialog = await screen.findByRole('dialog', { name: '密钥签发成功' });
    fireEvent.click(within(dialog).getByRole('button', { name: '复制 Secret' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('复制失败');
  });

  it('locks duplicate issuance and reloads the authoritative list after an untrusted success response', async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/admin/gateway/keys' && (init?.method ?? 'GET') === 'GET') {
        getCount += 1;
        return jsonResponse({ success: true, keys: getCount === 1 ? [] : [key] });
      }
      if (String(input) === '/api/admin/gateway/keys' && init?.method === 'POST') {
        return jsonResponse({ success: true, key, secret: 'wmg_too-short' }, 201);
      }
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MediaGatewayAdmin />);
    await screen.findByText('尚未签发媒体网关密钥');
    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));

    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
    expect((await within(sheet).findByRole('alert')).textContent).toContain('签发结果无法确认');
    await waitFor(() => expect(
      (within(sheet).getByRole('button', { name: '确认签发' }) as HTMLButtonElement).disabled,
    ).toBe(false));
    expect(getCount).toBe(2);
  });

  it('treats a rejected issue fetch as ambiguous and reconciles before allowing another issue', async () => {
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        getCount += 1;
        return jsonResponse({ success: true, keys: [] });
      }
      throw new TypeError('connection reset after send');
    }));
    render(<MediaGatewayAdmin />);
    await screen.findByText('尚未签发媒体网关密钥');
    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));

    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
    const alert = await within(sheet).findByRole('alert');
    expect(alert.textContent).toContain('签发结果无法确认');
    expect(alert.textContent).not.toContain('请重试');
    await waitFor(() => expect(getCount).toBe(2));
    expect((within(sheet).getByRole('button', { name: '确认签发' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('times out a pending issue request into ambiguity and performs an authoritative refresh', async () => {
    vi.useFakeTimers();
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        getCount += 1;
        return Promise.resolve(jsonResponse({ success: true, keys: [] }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
      });
    }));
    render(<MediaGatewayAdmin />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('尚未签发媒体网关密钥')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    vi.useRealTimers();
    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
    expect((await within(sheet).findByRole('alert')).textContent).toContain('签发结果无法确认');
    expect(getCount).toBe(2);
  });

  it('rejects a structurally valid secret that does not match the returned prefix', async () => {
    const fetchMock = mockApi([]);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse({ success: true, keys: [] });
      return jsonResponse({ success: true, key: issuedKey, secret: `wmg_zzzzzzzz${'s'.repeat(35)}` }, 201);
    });
    render(<MediaGatewayAdmin />);
    await screen.findByText('尚未签发媒体网关密钥');
    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));

    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
    expect((await within(sheet).findByRole('alert')).textContent).toContain('签发结果无法确认');
  });

  it('treats an untrusted patch response as ambiguous before changing local state', async () => {
    const fetchMock = mockApi();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse({ success: true, keys: [key] });
      return jsonResponse({ success: true, key: { ...key, todayUsage: undefined } });
    });
    render(<MediaGatewayAdmin />);
    await screen.findAllByText('Production');
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 Production' })[0]);
    const sheet = screen.getByRole('dialog', { name: '编辑媒体网关密钥' });
    fireEvent.change(within(sheet).getByLabelText('标签'), { target: { value: 'Renamed' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '保存修改' }));

    expect((await within(sheet).findByRole('alert')).textContent).toContain('保存结果无法确认');
    await waitFor(() => expect(
      (within(sheet).getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled,
    ).toBe(false));
    expect(screen.queryByText('Renamed')).toBeNull();
  });

  it('treats a patch response read failure as ambiguous and refreshes authority', async () => {
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        getCount += 1;
        return jsonResponse({ success: true, keys: [key] });
      }
      return {
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new TypeError('body stream failed')),
      } as unknown as Response;
    }));
    render(<MediaGatewayAdmin />);
    await screen.findAllByText('Production');
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 Production' })[0]);
    const sheet = screen.getByRole('dialog', { name: '编辑媒体网关密钥' });
    fireEvent.change(within(sheet).getByLabelText('标签'), { target: { value: 'Renamed' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '保存修改' }));

    expect((await within(sheet).findByRole('alert')).textContent).toContain('保存结果无法确认');
    await waitFor(() => expect(getCount).toBe(2));
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

  it('keeps revoke failures inside the alert dialog', async () => {
    const fetchMock = mockApi();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse({ success: true, keys: [key] });
      return jsonResponse({ success: false, error: 'unavailable' }, 503);
    });
    render(<MediaGatewayAdmin />);
    await screen.findAllByText('Production');
    fireEvent.click(screen.getAllByRole('button', { name: '吊销 Production' })[0]);
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认吊销' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('吊销结果无法确认');
    expect(alert.textContent).not.toContain('请重试');
  });

  it('locks duplicate revoke attempts after an untrusted success response', async () => {
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        getCount += 1;
        return jsonResponse({ success: true, keys: [key] });
      }
      return jsonResponse({ success: true, key: { ...key, enabled: false, revokedAt: null } });
    }));
    render(<MediaGatewayAdmin />);
    await screen.findAllByText('Production');
    fireEvent.click(screen.getAllByRole('button', { name: '吊销 Production' })[0]);
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认吊销' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain('吊销结果无法确认');
    await waitFor(() => expect(
      (within(dialog).getByRole('button', { name: '确认吊销' }) as HTMLButtonElement).disabled,
    ).toBe(false));
    expect(getCount).toBe(2);
  });

  it('keeps an ambiguous issue lock local and lets the sheet exit while authority is pending', async () => {
    let getCount = 0;
    let authoritySignal: AbortSignal | null = null;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        getCount += 1;
        if (getCount === 1) return Promise.resolve(jsonResponse({ success: true, keys: [key] }));
        authoritySignal = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
        });
      }
      return Promise.resolve(jsonResponse({ success: true, key, secret: 'wmg_too-short' }, 201));
    }));
    render(<MediaGatewayAdmin />);
    await screen.findAllByText('Production');
    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));

    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
    expect((await within(sheet).findByRole('alert')).textContent).toContain('签发结果无法确认');
    expect((within(sheet).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false);
    const unrelatedEdit = document.querySelector<HTMLButtonElement>('[aria-label="编辑 Production"]');
    expect(unrelatedEdit?.disabled).toBe(false);
    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '签发媒体网关密钥' })).toBeNull());
    expect((authoritySignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it('bounds an unavailable authority refresh and releases its local lock on exit', async () => {
    vi.useFakeTimers();
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        getCount += 1;
        if (getCount === 1) return Promise.resolve(jsonResponse({ success: true, keys: [] }));
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
        });
      }
      return Promise.resolve(jsonResponse({ success: true, key, secret: 'wmg_too-short' }, 201));
    }));
    render(<MediaGatewayAdmin />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: '签发密钥' }));
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    vi.useRealTimers();
    const sheet = screen.getByRole('dialog', { name: '签发媒体网关密钥' });
    expect((await within(sheet).findByRole('alert')).textContent).toContain('权威列表暂时无法确认');
    expect((within(sheet).getByRole('button', { name: '确认签发' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '签发媒体网关密钥' })).toBeNull());
    expect((screen.getByRole('button', { name: '签发密钥' }) as HTMLButtonElement).disabled).toBe(false);
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
