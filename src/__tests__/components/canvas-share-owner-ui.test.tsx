// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Suspense,
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
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

function createdShare(shareId: string, shareUrl: string, title: string) {
  return {
    shareUrl,
    shareId,
    expiresAt: '2026-10-19T00:00:00.000Z',
    allowDownload: false,
    snapshot: {
      title,
      status: 'active' as const,
      projectRevision: 17,
      itemCount: 3,
      createdAt: '2026-09-19T08:00:00.000Z',
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  return { promise, resolve, reject };
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

interface SensitiveCommitSnapshot {
  text: string;
  fieldValues: string[];
  alerts: string[];
}

function readSensitiveCommit(): SensitiveCommitSnapshot {
  return {
    text: document.body.textContent ?? '',
    fieldValues: Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    )).map(field => field.value),
    alerts: Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]'))
      .map(alert => alert.textContent ?? ''),
  };
}

function CommitRecorder({
  children,
  commits,
}: {
  children: ReactNode;
  commits: SensitiveCommitSnapshot[];
}) {
  useEffect(() => {
    commits.push(readSensitiveCommit());
    const observer = new MutationObserver(() => commits.push(readSensitiveCommit()));
    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [commits]);
  return children;
}

function expectNoSensitiveCommit(
  commits: SensitiveCommitSnapshot[],
  forbiddenValues: string[],
): void {
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.flatMap(commit => commit.alerts)).toEqual([]);
  for (const forbiddenValue of forbiddenValues) {
    expect(commits.some(commit => (
      commit.text.includes(forbiddenValue)
      || commit.fieldValues.some(value => value.includes(forbiddenValue))
    ))).toBe(false);
  }
}

function renderCreateDialog(
  overrides: Partial<ComponentProps<typeof CanvasShareCreateDialog>> = {},
) {
  return render(
    <CanvasShareCreateDialog
      open
      onOpenChange={vi.fn()}
      projectId="project-1"
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
    vi.unstubAllEnvs();
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
    const dashboardProjectMenu = readFileSync(
      resolve(process.cwd(), 'src/components/dashboard/project-actions-menu.tsx'),
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
    expect(dashboard).toContain('<DashboardProjectActionsMenu');
    expect(dashboardProjectMenu).toContain('管理分享');
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
    expect(apiMocks.preflightCanvasShare).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        requestedViewport: { offsetX: 10, offsetY: 20, zoom: 1.25 },
      },
      expect.any(AbortSignal),
    );
  });

  it('derives date defaults from the local calendar instead of UTC', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z'));
    renderCreateDialog();

    await screen.findByText('媒体已就绪');
    const expiry = screen.getByLabelText('有效期');
    expect(expiry.getAttribute('min')).toBe('2025-12-31');
    expect(expiry.getAttribute('value')).toBe('2026-01-30');
  });

  it('keeps focus inside the dialog and closes through Escape', async () => {
    const onOpenChange = vi.fn();
    renderCreateDialog({ onOpenChange });

    const dialog = await screen.findByRole('dialog', { name: '分享画布' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render project A create state during the first project B commit', async () => {
    const layoutSnapshots: string[] = [];
    const commits: SensitiveCommitSnapshot[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    apiMocks.createCanvasShare.mockResolvedValue(createdShare(
      'share-a',
      'https://example.test/shared/canvas/raw-project-a',
      '项目 A 分享',
    ));
    apiMocks.preflightCanvasShare.mockImplementation(async (input: { projectId: string }) => ({
      ...readyPreflight,
      projectName: input.projectId === 'project-b' ? '项目 B' : '项目 A',
    }));

    function LayoutProbe({ projectId }: { projectId: string }) {
      useLayoutEffect(() => {
        if (projectId === 'project-b') layoutSnapshots.push(document.body.textContent ?? '');
      }, [projectId]);
      return (
        <CanvasShareCreateDialog
          open
          onOpenChange={vi.fn()}
          projectId={projectId}
          onOpenManagement={vi.fn()}
        />
      );
    }

    const { rerender } = render(
      <CommitRecorder commits={commits}>
        <LayoutProbe projectId="project-a" />
      </CommitRecorder>,
    );
    await screen.findByText('项目 A');
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }));
    expect(await screen.findByText('分享已创建')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制完整链接' }));
    expect(await screen.findByRole('textbox', { name: '手动复制完整链接' }))
      .toHaveProperty('value', 'https://example.test/shared/canvas/raw-project-a');
    await waitFor(() => expect(commits.some(commit => commit.fieldValues.includes(
      'https://example.test/shared/canvas/raw-project-a',
    ))).toBe(true));
    const projectBCommitStart = commits.length;

    await act(async () => rerender(
      <CommitRecorder commits={commits}>
        <LayoutProbe projectId="project-b" />
      </CommitRecorder>,
    ));

    expect(layoutSnapshots).toHaveLength(1);
    expect(layoutSnapshots[0]).not.toContain('分享已创建');
    expect(layoutSnapshots[0]).not.toContain('项目 A 分享');
    expect(layoutSnapshots[0]).not.toContain('raw-project-a');
    expect(await screen.findByText('项目 B')).toBeTruthy();
    expectNoSensitiveCommit(commits.slice(projectBCommitStart), [
      '分享已创建',
      '项目 A 分享',
      'raw-project-a',
    ]);
  });

  it('ignores a late preflight result after project change without flashing project A state', async () => {
    const pendingPreflight = deferred<typeof readyPreflight>();
    const layoutAbortStates: boolean[] = [];
    const commits: SensitiveCommitSnapshot[] = [];
    let preflightSignal: AbortSignal | undefined;
    apiMocks.preflightCanvasShare
      .mockImplementationOnce((_input: unknown, signal: AbortSignal) => {
        preflightSignal = signal;
        return pendingPreflight.promise;
      })
      .mockResolvedValueOnce({ ...readyPreflight, projectName: '项目 B' });

    function LayoutProbe({ projectId }: { projectId: string }) {
      useLayoutEffect(() => {
        if (projectId !== 'project-b') return;
        layoutAbortStates.push(preflightSignal?.aborted ?? true);
        pendingPreflight.resolve({
          ...readyPreflight,
          projectName: '项目 A 迟到预检',
        });
      }, [projectId]);
      return (
        <CanvasShareCreateDialog
          open
          onOpenChange={vi.fn()}
          projectId={projectId}
          onOpenManagement={vi.fn()}
        />
      );
    }

    const { rerender } = render(
      <CommitRecorder commits={commits}>
        <LayoutProbe projectId="project-a" />
      </CommitRecorder>,
    );
    await waitFor(() => expect(apiMocks.preflightCanvasShare).toHaveBeenCalledTimes(1));
    const projectBCommitStart = commits.length;

    await act(async () => rerender(
      <CommitRecorder commits={commits}>
        <LayoutProbe projectId="project-b" />
      </CommitRecorder>,
    ));

    expect(layoutAbortStates).toEqual([false]);
    expect(await screen.findByText('项目 B')).toBeTruthy();
    expect(screen.queryByText('项目 A 迟到预检')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expectNoSensitiveCommit(commits.slice(projectBCommitStart), [
      '项目 A 迟到预检',
      'raw-project-a',
    ]);
  });

  it('treats an AbortError from preflight as cancellation without an error flash', async () => {
    const commits: SensitiveCommitSnapshot[] = [];
    apiMocks.preflightCanvasShare.mockRejectedValueOnce(abortError());
    render(
      <CommitRecorder commits={commits}>
        <CanvasShareCreateDialog
          open
          onOpenChange={vi.fn()}
          projectId="project-1"
          onOpenManagement={vi.fn()}
        />
      </CommitRecorder>,
    );

    await waitFor(() => expect(screen.queryByRole('status', {
      name: '正在检查画布分享条件',
    })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expectNoSensitiveCommit(commits, ['操作未完成，请稍后重试。']);
  });

  it('keeps the committed project scope when a different project render is discarded', async () => {
    const pendingPreflight = deferred<typeof readyPreflight>();
    const neverCommit = new Promise<never>(() => undefined);
    apiMocks.preflightCanvasShare.mockReturnValueOnce(pendingPreflight.promise);

    function SuspendProject({ projectId }: { projectId: string }) {
      if (projectId === 'project-b') throw neverCommit;
      return null;
    }

    function Harness({ projectId }: { projectId: string }) {
      return (
        <Suspense fallback={<div>discarded project render</div>}>
          <CanvasShareCreateDialog
            open
            onOpenChange={vi.fn()}
            projectId={projectId}
            onOpenManagement={vi.fn()}
          />
          <SuspendProject projectId={projectId} />
        </Suspense>
      );
    }

    const { rerender } = render(<Harness projectId="project-a" />);
    await waitFor(() => expect(apiMocks.preflightCanvasShare).toHaveBeenCalledTimes(1));

    act(() => {
      startTransition(() => rerender(<Harness projectId="project-b" />));
    });
    expect(screen.queryByText('discarded project render')).toBeNull();

    await act(async () => pendingPreflight.resolve({
      ...readyPreflight,
      projectName: '项目 A 已提交作用域',
    }));

    expect(await screen.findByText('项目 A 已提交作用域')).toBeTruthy();
    expect(apiMocks.preflightCanvasShare).toHaveBeenCalledTimes(1);
  });

  it('aborts and ignores a late create result after switching projects', async () => {
    const pendingCreate = deferred<ReturnType<typeof createdShare>>();
    apiMocks.createCanvasShare.mockReturnValueOnce(pendingCreate.promise);
    apiMocks.preflightCanvasShare.mockImplementation(async (input: { projectId: string }) => ({
      ...readyPreflight,
      projectName: input.projectId === 'project-b' ? '项目 B' : '项目 A',
    }));
    const { rerender } = renderCreateDialog({ projectId: 'project-a' });

    await screen.findByText('项目 A');
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }));
    const createSignal = apiMocks.createCanvasShare.mock.calls[0]?.[1] as AbortSignal | undefined;

    rerender(
      <CanvasShareCreateDialog
        open
        onOpenChange={vi.fn()}
        projectId="project-b"
        onOpenManagement={vi.fn()}
      />,
    );
    expect(await screen.findByText('项目 B')).toBeTruthy();
    expect(createSignal?.aborted).toBe(true);

    await act(async () => pendingCreate.resolve(createdShare(
      'share-a',
      'https://example.test/shared/canvas/raw-project-a',
      '项目 A 分享',
    )));
    expect(screen.queryByText('分享已创建')).toBeNull();
    expect(document.body.textContent).not.toContain('raw-project-a');
  });

  it('aborts and ignores a late create result after closing', async () => {
    const pendingCreate = deferred<ReturnType<typeof createdShare>>();
    apiMocks.createCanvasShare.mockReturnValueOnce(pendingCreate.promise);
    const { rerender } = renderCreateDialog();

    await screen.findByText('媒体已就绪');
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }));
    const createSignal = apiMocks.createCanvasShare.mock.calls[0]?.[1] as AbortSignal | undefined;
    rerender(
      <CanvasShareCreateDialog
        open={false}
        onOpenChange={vi.fn()}
        projectId="project-1"
        onOpenManagement={vi.fn()}
      />,
    );
    expect(createSignal?.aborted).toBe(true);

    await act(async () => pendingCreate.resolve(createdShare(
      'share-closed',
      'https://example.test/shared/canvas/raw-closed',
      '已关闭分享',
    )));
    expect(document.body.textContent).not.toContain('raw-closed');
  });

  it('ignores a late clipboard rejection from the previous project', async () => {
    const clipboardWrite = deferred<void>();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockReturnValue(clipboardWrite.promise) },
    });
    apiMocks.createCanvasShare
      .mockResolvedValueOnce(createdShare(
        'share-a',
        'https://example.test/shared/canvas/raw-project-a',
        '项目 A 分享',
      ))
      .mockResolvedValueOnce(createdShare(
        'share-b',
        'https://example.test/shared/canvas/raw-project-b',
        '项目 B 分享',
      ));
    apiMocks.preflightCanvasShare.mockImplementation(async (input: { projectId: string }) => ({
      ...readyPreflight,
      projectName: input.projectId === 'project-b' ? '项目 B' : '项目 A',
    }));
    const { rerender } = renderCreateDialog({ projectId: 'project-a' });

    await screen.findByText('项目 A');
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }));
    fireEvent.click(await screen.findByRole('button', { name: '复制完整链接' }));

    rerender(
      <CanvasShareCreateDialog
        open
        onOpenChange={vi.fn()}
        projectId="project-b"
        onOpenManagement={vi.fn()}
      />,
    );
    await screen.findByText('项目 B');
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }));
    expect(await screen.findByText('项目 B 分享')).toBeTruthy();

    await act(async () => clipboardWrite.reject(new Error('late clipboard rejection')));
    expect(screen.queryByRole('textbox', { name: '手动复制完整链接' })).toBeNull();
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

  it('aborts and ignores a late list result after switching projects', async () => {
    const pendingList = deferred<typeof olderShare[]>();
    apiMocks.listCanvasShares
      .mockReturnValueOnce(pendingList.promise)
      .mockResolvedValueOnce([{ ...newerShare, shareId: 'share-b', title: '项目 B 分享' }]);
    const { rerender } = render(
      <CanvasShareManagePanel
        open
        onOpenChange={vi.fn()}
        projectId="project-a"
        projectName="项目 A"
      />,
    );

    rerender(
      <CanvasShareManagePanel
        open
        onOpenChange={vi.fn()}
        projectId="project-b"
        projectName="项目 B"
      />,
    );
    expect(await screen.findByText('项目 B 分享')).toBeTruthy();
    const firstListSignal = apiMocks.listCanvasShares.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(firstListSignal?.aborted).toBe(true);

    await act(async () => pendingList.resolve([{ ...olderShare, title: '项目 A 旧分享' }]));
    expect(screen.queryByText('项目 A 旧分享')).toBeNull();
  });

  it('aborts and ignores a late list result after closing management', async () => {
    const pendingList = deferred<typeof olderShare[]>();
    apiMocks.listCanvasShares.mockReturnValueOnce(pendingList.promise);
    const { rerender } = render(
      <CanvasShareManagePanel
        open
        onOpenChange={vi.fn()}
        projectId="project-a"
        projectName="项目 A"
      />,
    );
    const listSignal = apiMocks.listCanvasShares.mock.calls[0]?.[1] as AbortSignal | undefined;

    rerender(
      <CanvasShareManagePanel
        open={false}
        onOpenChange={vi.fn()}
        projectId="project-a"
        projectName="项目 A"
      />,
    );
    expect(listSignal?.aborted).toBe(true);
    await act(async () => pendingList.resolve([{ ...olderShare, title: '关闭后返回的分享' }]));
    expect(screen.queryByText('关闭后返回的分享')).toBeNull();
  });

  it('ignores a late clipboard rejection from the previous managed project', async () => {
    const clipboardWrite = deferred<void>();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockReturnValue(clipboardWrite.promise) },
    });
    apiMocks.listCanvasShares
      .mockResolvedValueOnce([{ ...newerShare, shareId: 'share-a', title: '项目 A 分享' }])
      .mockResolvedValueOnce([{ ...newerShare, shareId: 'share-b', title: '项目 B 分享' }]);
    const { rerender } = render(
      <CanvasShareManagePanel
        open
        onOpenChange={vi.fn()}
        projectId="project-a"
        projectName="项目 A"
        createdShareAccess={{
          shareId: 'share-a',
          shareUrl: 'https://example.test/shared/canvas/raw-project-a',
        }}
      />,
    );

    const projectARow = (await screen.findByText('项目 A 分享')).closest('article') as HTMLElement;
    fireEvent.click(within(projectARow).getByRole('button', { name: '复制链接 项目 A 分享' }));
    rerender(
      <CanvasShareManagePanel
        open
        onOpenChange={vi.fn()}
        projectId="project-b"
        projectName="项目 B"
      />,
    );
    expect(await screen.findByText('项目 B 分享')).toBeTruthy();

    await act(async () => clipboardWrite.reject(new Error('late clipboard rejection')));
    expect(screen.queryByRole('textbox', { name: '手动复制完整链接' })).toBeNull();
    expect(document.body.textContent).not.toContain('raw-project-a');
  });

  it('renders policy failures inside the active policy dialog', async () => {
    const commits: SensitiveCommitSnapshot[] = [];
    apiMocks.patchCanvasSharePolicy.mockRejectedValue({ code: 'CANVAS_SHARE_POLICY_CONFLICT' });
    render(
      <CommitRecorder commits={commits}>
        <CanvasShareManagePanel
          open
          onOpenChange={vi.fn()}
          projectId="project-1"
          projectName="服务端项目名"
        />
      </CommitRecorder>,
    );

    const row = (await screen.findAllByTestId('canvas-share-row'))[0];
    fireEvent.click(within(row).getByRole('button', { name: '编辑策略 新版审阅' }));
    const policy = screen.getByRole('dialog', { name: '编辑分享策略' });
    fireEvent.click(within(policy).getByRole('button', { name: '保存策略' }));

    const alert = await within(policy).findByRole('alert');
    expect(alert.textContent).toContain('取消后刷新列表');
    await waitFor(() => expect(commits.some(commit => commit.alerts.some(
      text => text.includes('取消后刷新列表'),
    ))).toBe(true));
  });

  it('hides project A policy state on the first project B commit and ignores its late failure', async () => {
    const pendingPolicy = deferred<typeof newerShare>();
    const layoutSnapshots: string[] = [];
    const layoutAbortStates: boolean[] = [];
    const commits: SensitiveCommitSnapshot[] = [];
    apiMocks.patchCanvasSharePolicy.mockReturnValueOnce(pendingPolicy.promise);
    apiMocks.listCanvasShares
      .mockResolvedValueOnce([newerShare])
      .mockResolvedValueOnce([{ ...newerShare, shareId: 'share-b', title: '项目 B 分享' }]);

    function LayoutProbe({ projectId }: { projectId: string }) {
      useLayoutEffect(() => {
        if (projectId !== 'project-b') return;
        layoutSnapshots.push(document.body.textContent ?? '');
        layoutAbortStates.push(policySignal?.aborted ?? true);
        pendingPolicy.reject({ code: 'CANVAS_SHARE_POLICY_CONFLICT' });
      }, [projectId]);
      return (
        <CanvasShareManagePanel
          open
          onOpenChange={vi.fn()}
          projectId={projectId}
          projectName={projectId === 'project-b' ? '项目 B' : '项目 A'}
        />
      );
    }

    const { rerender } = render(
      <CommitRecorder commits={commits}>
        <LayoutProbe projectId="project-a" />
      </CommitRecorder>,
    );
    const row = (await screen.findAllByTestId('canvas-share-row'))[0];
    fireEvent.click(within(row).getByRole('button', { name: '编辑策略 新版审阅' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '编辑分享策略' }))
      .getByRole('button', { name: '保存策略' }));
    await waitFor(() => expect(commits.some(commit => commit.text.includes('编辑分享策略')))
      .toBe(true));
    const policySignal = apiMocks.patchCanvasSharePolicy.mock.calls[0]?.[2] as AbortSignal | undefined;
    const projectBCommitStart = commits.length;

    await act(async () => rerender(
      <CommitRecorder commits={commits}>
        <LayoutProbe projectId="project-b" />
      </CommitRecorder>,
    ));
    expect(layoutSnapshots).toHaveLength(1);
    expect(layoutAbortStates).toEqual([false]);
    expect(layoutSnapshots[0]).not.toContain('编辑分享策略');
    expect(layoutSnapshots[0]).not.toContain('新版审阅');

    expect(await screen.findByText('项目 B 分享')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expectNoSensitiveCommit(commits.slice(projectBCommitStart), [
      '新版审阅',
      '编辑分享策略',
      '分享策略已更新，请取消后刷新列表，再重新编辑。',
      'raw-project-a',
    ]);
  });

  it('treats an AbortError from policy update as cancellation without a nested error', async () => {
    const commits: SensitiveCommitSnapshot[] = [];
    apiMocks.patchCanvasSharePolicy.mockRejectedValueOnce(abortError());
    render(
      <CommitRecorder commits={commits}>
        <CanvasShareManagePanel
          open
          onOpenChange={vi.fn()}
          projectId="project-1"
          projectName="服务端项目名"
        />
      </CommitRecorder>,
    );
    const row = (await screen.findAllByTestId('canvas-share-row'))[0];
    fireEvent.click(within(row).getByRole('button', { name: '编辑策略 新版审阅' }));
    const policy = screen.getByRole('dialog', { name: '编辑分享策略' });
    const mutationStart = commits.length;
    fireEvent.click(within(policy).getByRole('button', { name: '保存策略' }));

    await waitFor(() => expect(within(policy).getByRole('button', { name: '保存策略' }))
      .toHaveProperty('disabled', false));
    expect(within(policy).queryByRole('alert')).toBeNull();
    expectNoSensitiveCommit(commits.slice(mutationStart), [
      '操作未完成，请稍后重试。',
      '分享策略已更新，请取消后刷新列表，再重新编辑。',
    ]);
  });

  it('renders revoke failures inside the active confirmation alert', async () => {
    apiMocks.revokeCanvasShare.mockRejectedValue({ code: 'CANVAS_SHARE_NOT_FOUND' });
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
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认撤销' }));

    const alert = await within(confirmation).findByRole('alert');
    expect(alert.textContent).toContain('取消后刷新列表');
  });

  it('hides project A revoke state on the first project B commit and ignores its late failure', async () => {
    const pendingRevoke = deferred<typeof newerShare>();
    const layoutSnapshots: string[] = [];
    const layoutAbortStates: boolean[] = [];
    const commits: SensitiveCommitSnapshot[] = [];
    apiMocks.revokeCanvasShare.mockReturnValueOnce(pendingRevoke.promise);
    apiMocks.listCanvasShares
      .mockResolvedValueOnce([newerShare])
      .mockResolvedValueOnce([{ ...newerShare, shareId: 'share-b', title: '项目 B 分享' }]);

    function LayoutProbe({ projectId }: { projectId: string }) {
      useLayoutEffect(() => {
        if (projectId !== 'project-b') return;
        layoutSnapshots.push(document.body.textContent ?? '');
        layoutAbortStates.push(revokeSignal?.aborted ?? true);
        pendingRevoke.reject({ code: 'CANVAS_SHARE_NOT_FOUND' });
      }, [projectId]);
      return (
        <CanvasShareManagePanel
          open
          onOpenChange={vi.fn()}
          projectId={projectId}
          projectName={projectId === 'project-b' ? '项目 B' : '项目 A'}
        />
      );
    }

    const { rerender } = render(
      <CommitRecorder commits={commits}>
        <LayoutProbe projectId="project-a" />
      </CommitRecorder>,
    );
    const row = (await screen.findAllByTestId('canvas-share-row'))[0];
    fireEvent.click(within(row).getByRole('button', { name: '撤销分享 新版审阅' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: '确认撤销分享' }))
      .getByRole('button', { name: '确认撤销' }));
    await waitFor(() => expect(commits.some(commit => commit.text.includes('确认撤销分享')))
      .toBe(true));
    const revokeSignal = apiMocks.revokeCanvasShare.mock.calls[0]?.[1] as AbortSignal | undefined;
    const projectBCommitStart = commits.length;

    await act(async () => rerender(
      <CommitRecorder commits={commits}>
        <LayoutProbe projectId="project-b" />
      </CommitRecorder>,
    ));
    expect(layoutSnapshots).toHaveLength(1);
    expect(layoutAbortStates).toEqual([false]);
    expect(layoutSnapshots[0]).not.toContain('确认撤销分享');
    expect(layoutSnapshots[0]).not.toContain('新版审阅');

    expect(await screen.findByText('项目 B 分享')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expectNoSensitiveCommit(commits.slice(projectBCommitStart), [
      '新版审阅',
      '确认撤销分享',
      '分享不存在或已失效，请取消后刷新列表。',
      'raw-project-a',
    ]);
  });

  it('treats an AbortError from revoke as cancellation without a nested error', async () => {
    const commits: SensitiveCommitSnapshot[] = [];
    apiMocks.revokeCanvasShare.mockRejectedValueOnce(abortError());
    render(
      <CommitRecorder commits={commits}>
        <CanvasShareManagePanel
          open
          onOpenChange={vi.fn()}
          projectId="project-1"
          projectName="服务端项目名"
        />
      </CommitRecorder>,
    );
    const row = (await screen.findAllByTestId('canvas-share-row'))[0];
    fireEvent.click(within(row).getByRole('button', { name: '撤销分享 新版审阅' }));
    const confirmation = screen.getByRole('alertdialog', { name: '确认撤销分享' });
    const mutationStart = commits.length;
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认撤销' }));

    await waitFor(() => expect(within(confirmation).getByRole('button', { name: '确认撤销' }))
      .toHaveProperty('disabled', false));
    expect(within(confirmation).queryByRole('alert')).toBeNull();
    expectNoSensitiveCommit(commits.slice(mutationStart), [
      '操作未完成，请稍后重试。',
      '分享不存在或已失效，请取消后刷新列表。',
    ]);
  });

  it('restores focus to a persistent project-menu trigger after management closes', async () => {
    function FocusHarness() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef} type="button">项目菜单</button>
          {!open && <button type="button" onClick={() => setOpen(true)}>临时管理菜单项</button>}
          <CanvasShareManagePanel
            open={open}
            onOpenChange={setOpen}
            projectId="project-1"
            projectName="服务端项目名"
            returnFocusRef={triggerRef}
          />
        </>
      );
    }
    render(<FocusHarness />);
    fireEvent.click(screen.getByRole('button', { name: '临时管理菜单项' }));
    await screen.findByRole('dialog', { name: '管理画布分享' });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '管理画布分享' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '项目菜单' }));
  });

  it('shows popup-blocked feedback and a selectable link', async () => {
    apiMocks.createCanvasShare.mockResolvedValue(createdShare(
      'share-popup',
      'https://example.test/shared/canvas/raw-popup',
      '弹窗测试',
    ));
    vi.stubGlobal('open', vi.fn().mockReturnValue(null));
    renderCreateDialog();

    await screen.findByText('媒体已就绪');
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开查看器' }));

    expect((await screen.findByRole('alert')).textContent).toContain('浏览器阻止了新窗口');
    expect(screen.getByRole('textbox', { name: '手动复制完整链接' })).toHaveProperty(
      'value',
      'https://example.test/shared/canvas/raw-popup',
    );
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

    await waitFor(() => expect(apiMocks.revokeCanvasShare).toHaveBeenCalledWith(
      'share-new',
      expect.any(AbortSignal),
    ));
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

  it('passes one AbortSignal through every owner API client method', async () => {
    const actualClient = await vi.importActual<typeof import(
      '@/components/canvas-share/share-api-client'
    )>('@/components/canvas-share/share-api-client');
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      code: 'CANVAS_SHARE_REQUEST_FAILED',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const calls = [
      actualClient.preflightCanvasShare({ projectId: 'project-1' }, controller.signal),
      actualClient.createCanvasShare({
        projectId: 'project-1',
        title: '测试分享',
        allowDownload: false,
      }, controller.signal),
      actualClient.listCanvasShares('project-1', controller.signal),
      actualClient.patchCanvasSharePolicy('share-1', { allowDownload: true }, controller.signal),
      actualClient.revokeCanvasShare('share-1', controller.signal),
    ];
    await Promise.all(calls.map(call => call.catch(() => undefined)));

    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBe(controller.signal);
    }
  });
});
