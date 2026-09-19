// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  preflightCanvasShare: vi.fn(),
  createCanvasShare: vi.fn(),
  listCanvasShares: vi.fn(),
  patchCanvasSharePolicy: vi.fn(),
  revokeCanvasShare: vi.fn(),
}));

vi.mock('@/components/canvas-share/share-api-client', () => apiMocks);

import { CanvasShareCreateDialog } from '@/components/canvas-share/create-dialog';
import { CanvasShareManagePanel } from '@/components/canvas-share/manage-panel';

const readyPreflight = {
  projectName: '服务端项目名',
  projectRevision: 17,
  itemCount: 3,
  viewport: { offsetX: 10, offsetY: 20, zoom: 1.25 },
  readiness: { ready: true, failures: [] },
};

const olderShare = {
  shareId: 'share-old',
  title: '旧版审阅',
  status: 'revoked' as const,
  projectRevision: 8,
  itemCount: 1,
  expiresAt: '2026-10-01T00:00:00.000Z',
  allowDownload: false,
  viewCount: 2,
  lastViewedAt: null,
  createdAt: '2026-09-17T00:00:00.000Z',
  revokedAt: '2026-09-18T00:00:00.000Z',
};

const newerShare = {
  shareId: 'share-new',
  title: '新版审阅',
  status: 'active' as const,
  projectRevision: 17,
  itemCount: 3,
  expiresAt: '2026-10-19T00:00:00.000Z',
  allowDownload: true,
  viewCount: 9,
  lastViewedAt: '2026-09-19T08:30:00.000Z',
  createdAt: '2026-09-19T08:00:00.000Z',
  revokedAt: null,
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

function renderCreateDialog(overrides: Record<string, unknown> = {}) {
  return render(
    <CanvasShareCreateDialog
      open
      onOpenChange={vi.fn()}
      projectId="project-1"
      projectName="客户端旧名"
      requestedViewport={{ offsetX: 10, offsetY: 20, zoom: 1.25 }}
      onOpenManagement={vi.fn()}
      {...overrides}
    />,
  );
}

describe('canvas share owner UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
    apiMocks.preflightCanvasShare.mockResolvedValue(readyPreflight);
    apiMocks.listCanvasShares.mockResolvedValue([olderShare, newerShare]);
    apiMocks.patchCanvasSharePolicy.mockResolvedValue(newerShare);
    apiMocks.revokeCanvasShare.mockResolvedValue({
      ...newerShare,
      status: 'revoked',
      revokedAt: '2026-09-19T09:00:00.000Z',
    });
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

  it('keeps share entry points at project level only', () => {
    const canvasWorkspace = readFileSync(
      resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
      'utf8',
    );
    const dashboard = readFileSync(
      resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
      'utf8',
    );
    const forbiddenSurfaces = [
      'src/components/canvas/CanvasImageActionToolbar.tsx',
      'src/components/simple-chat/share-dialog.tsx',
      'src/components/node-editor.tsx',
    ].map(path => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

    expect(canvasWorkspace).toContain('<CanvasShareCreateDialog');
    expect(canvasWorkspace).toContain('分享画布');
    expect(dashboard).toContain('<CanvasShareManagePanel');
    expect(dashboard).toContain('管理分享');
    expect(forbiddenSurfaces).not.toContain('分享画布');
    expect(forbiddenSurfaces).not.toContain('管理分享');
  });

  it('renders authoritative preflight facts and safe defaults before creation', async () => {
    renderCreateDialog();

    expect(await screen.findByText('服务端项目名')).toBeTruthy();
    const dialog = screen.getByRole('dialog', { name: '分享画布' });
    expect(dialog.className).toContain('max-w-[calc(100%-1rem)]');
    expect(dialog.className).toContain('overflow-y-auto');
    expect(screen.queryByText('客户端旧名')).toBeNull();
    expect(screen.getByText('修订 17')).toBeTruthy();
    expect(screen.getByText('3 个素材')).toBeTruthy();
    expect(screen.getByText('媒体已就绪')).toBeTruthy();
    expect(screen.getByLabelText('有效期').getAttribute('value')).toBe('2026-10-19');
    expect(screen.getByRole('switch', { name: '允许访问者下载' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/创建后将绑定当前修订和素材快照，后续编辑不会改变此分享/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '管理已有分享' })).toBeTruthy();
    expect(apiMocks.preflightCanvasShare).toHaveBeenCalledWith({
      projectId: 'project-1',
      requestedViewport: { offsetX: 10, offsetY: 20, zoom: 1.25 },
      displayContext: { projectName: '客户端旧名' },
    });
  });

  it('keeps focus inside the dialog and closes through Escape', async () => {
    const onOpenChange = vi.fn();
    renderCreateDialog({ onOpenChange });

    const dialog = await screen.findByRole('dialog', { name: '分享画布' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('locks duplicate submission and keeps the raw URL only in one-time success UI', async () => {
    const pendingCreate = deferred<Record<string, unknown>>();
    const shareUrl = 'https://example.test/shared/canvas/raw-token-visible-once';
    apiMocks.createCanvasShare.mockReturnValue(pendingCreate.promise);
    const localSetItem = vi.spyOn(Storage.prototype, 'setItem');
    const onOpenManagement = vi.fn();
    renderCreateDialog({ onOpenManagement });

    await screen.findByText('媒体已就绪');
    fireEvent.change(screen.getByLabelText('分享标题'), { target: { value: '客户审阅版' } });
    const submit = screen.getByRole('button', { name: '创建分享' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(apiMocks.createCanvasShare).toHaveBeenCalledTimes(1);
    expect(submit).toHaveProperty('disabled', true);

    await act(async () => pendingCreate.resolve({
      shareUrl,
      shareId: 'share-new',
      expiresAt: '2026-10-19T00:00:00.000Z',
      allowDownload: false,
      snapshot: {
        title: '客户审阅版',
        status: 'active',
        projectRevision: 17,
        itemCount: 3,
        createdAt: '2026-09-19T08:00:00.000Z',
      },
    }));

    expect(await screen.findByRole('button', { name: '复制完整链接' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开查看器' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '前往管理' }));
    expect(onOpenManagement).toHaveBeenCalledWith({ shareId: 'share-new', shareUrl });
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it.each([
    ['CANVAS_SHARE_PROJECT_CONFLICT', '项目已更新，请重新检查后再创建'],
    ['CANVAS_SHARE_MEDIA_NOT_READY', '请等待媒体处理完成后重新检查'],
    ['CANVAS_SHARE_UNSUPPORTED_ELEMENT', '请移除暂不支持的元素后重试'],
  ])('maps %s to a safe Chinese next action', async (code, expected) => {
    apiMocks.createCanvasShare.mockRejectedValue({
      code,
      message: '{"provider":"private","detail":"raw upstream payload"}',
    });
    renderCreateDialog();

    await screen.findByText('媒体已就绪');
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(expected);
    expect(alert.textContent).not.toContain('provider');
    expect(alert.textContent).not.toContain('upstream');
  });

  it('sorts management rows newest-first and confines policy editing to mutable fields', async () => {
    render(
      <CanvasShareManagePanel
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        projectName="服务端项目名"
      />,
    );

    const dialog = await screen.findByRole('dialog', { name: '管理画布分享' });
    const rows = within(dialog).getAllByTestId('canvas-share-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('新版审阅');
    expect(rows[0].textContent).toContain('有效');
    expect(rows[0].textContent).toContain('修订 17');
    expect(rows[0].textContent).toContain('3 个素材');
    expect(rows[0].textContent).toContain('允许下载');
    expect(rows[0].textContent).toContain('9 次查看');
    expect(rows[0].textContent).toContain('最近访问');
    expect(rows[1].textContent).toContain('旧版审阅');
    expect(rows[1].textContent).toContain('已撤销');

    fireEvent.click(within(rows[0]).getByRole('button', { name: '编辑策略 新版审阅' }));
    const policy = screen.getByRole('dialog', { name: '编辑分享策略' });
    expect(within(policy).getByLabelText('有效期')).toBeTruthy();
    expect(within(policy).getByRole('switch', { name: '允许访问者下载' })).toBeTruthy();
    expect(within(policy).queryByLabelText(/修订|素材|标题|视口/)).toBeNull();
  });

  it('requires irreversible confirmation before revoking', async () => {
    render(
      <CanvasShareManagePanel
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        projectName="服务端项目名"
      />,
    );

    const row = (await screen.findAllByTestId('canvas-share-row'))[0];
    fireEvent.click(within(row).getByRole('button', { name: '撤销分享 新版审阅' }));
    const confirmation = screen.getByRole('alertdialog', { name: '确认撤销分享' });
    expect(confirmation.textContent).toContain('撤销后无法恢复');
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认撤销' }));

    await waitFor(() => expect(apiMocks.revokeCanvasShare).toHaveBeenCalledWith('share-new'));
  });

  it('offers selectable fallback text after clipboard failure without logging the URL', async () => {
    const shareUrl = 'https://example.test/shared/canvas/raw-token-visible-once';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <CanvasShareManagePanel
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        projectName="服务端项目名"
        createdShareAccess={{ shareId: 'share-new', shareUrl }}
      />,
    );

    const copy = await screen.findByRole('button', { name: '复制链接 新版审阅' });
    fireEvent.click(copy);

    const fallback = await screen.findByRole('textbox', { name: '手动复制完整链接' });
    expect(fallback).toHaveProperty('value', shareUrl);
    expect(JSON.stringify(consoleLog.mock.calls)).not.toContain(shareUrl);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(shareUrl);
  });

  it('keeps the API client response URL ephemeral and sanitizes server failures', async () => {
    const actualClient = await vi.importActual<typeof import(
      '@/components/canvas-share/share-api-client'
    )>('@/components/canvas-share/share-api-client');
    const shareUrl = 'https://example.test/shared/canvas/raw-token-visible-once';
    const localSetItem = vi.spyOn(Storage.prototype, 'setItem');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        shareUrl,
        shareId: 'share-new',
        expiresAt: '2026-10-19T00:00:00.000Z',
        allowDownload: false,
        snapshot: {
          title: '客户审阅版',
          status: 'active',
          projectRevision: 17,
          itemCount: 3,
          createdAt: '2026-09-19T08:00:00.000Z',
        },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        code: 'CANVAS_SHARE_PROJECT_CONFLICT',
        message: '{"provider":"private","url":"https://private.example"}',
        requestId: 'request-1',
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const created = await actualClient.createCanvasShare({
      projectId: 'project-1',
      title: '客户审阅版',
      allowDownload: false,
    });
    expect(created.shareUrl).toBe(shareUrl);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/canvas-shares', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
    await expect(actualClient.preflightCanvasShare({ projectId: 'project-1' })).rejects.toMatchObject({
      code: 'CANVAS_SHARE_PROJECT_CONFLICT',
      message: '画布分享请求失败',
      requestId: 'request-1',
    });
    expect(localSetItem).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleLog.mock.calls)).not.toContain(shareUrl);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(shareUrl);
    expect(JSON.stringify(consoleLog.mock.calls)).not.toContain('private.example');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private.example');
  });
});
