// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type ChatArea from '@/components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import type { SimpleChatSyncCoordinator, SimpleChatSyncSnapshot } from '@/lib/simple-chat-sync-client';
import type { User } from '@/lib/user-types';

const mocks = vi.hoisted(() => ({
  chatAreaProps: null as ComponentProps<typeof ChatArea> | null,
  sidebarProps: null as {
    projects: SimpleChatProject[];
    activeProjectId: string | null;
    activeTaskId: string | null;
  } | null,
  coordinatorFactory: vi.fn(),
  fetchSessionPayload: vi.fn(),
  globalFetch: vi.fn(),
  loginUser: { id: 'user-login', name: 'Login User', createdAt: 1, updatedAt: 1 } as User,
  loginHandler: null as ((user: User) => Promise<void>) | null,
  logoutSimpleChatSession: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock('@/lib/auth-session', () => ({ fetchSessionPayload: mocks.fetchSessionPayload }));

vi.mock('@/lib/simple-chat-sync-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/simple-chat-sync-client')>();
  return { ...actual, createSimpleChatSyncCoordinator: mocks.coordinatorFactory };
});

vi.mock('@/lib/simple-chat-sync-storage', () => ({
  createIndexedDbSimpleChatEnvelopeStore: vi.fn(() => ({ kind: 'mock-store' })),
}));

vi.mock('@/lib/simple-chat-logout', () => ({
  logoutSimpleChatSession: mocks.logoutSimpleChatSession,
}));

vi.mock('@/components/dashboard/login-panel', () => ({
  LoginPanel: ({ onLogin }: { onLogin: (user: User) => Promise<void> }) => {
    mocks.loginHandler = onLogin;
    return <button type="button" onClick={() => void onLogin(mocks.loginUser)}>登录测试用户</button>;
  },
}));

vi.mock('@/components/simple-chat/sidebar', () => ({
  default: (props: {
    projects: SimpleChatProject[];
    activeProjectId: string | null;
    activeTaskId: string | null;
    onCreateProject: () => void;
    onLogout: () => void;
  }) => {
    mocks.sidebarProps = props;
    return (
      <div>
        <div data-testid="sidebar-projects">{props.projects.map(project => project.id).join(',')}</div>
        <div data-testid="sidebar-active-project">{props.activeProjectId ?? ''}</div>
        <div data-testid="sidebar-active-task">{props.activeTaskId ?? ''}</div>
        <button type="button" onClick={props.onCreateProject}>创建测试项目</button>
        <button type="button" onClick={props.onLogout}>退出测试用户</button>
      </div>
    );
  },
}));

vi.mock('@/components/simple-chat/chat-area', () => ({
  default: (props: ComponentProps<typeof ChatArea>) => {
    mocks.chatAreaProps = props;
    return <div data-testid="chat-area">聊天区域</div>;
  },
}));

import SimpleChatPage from '@/app/simple-chat/page';

interface CoordinatorHarness {
  coordinator: SimpleChatSyncCoordinator;
  emit: (snapshot: SimpleChatSyncSnapshot) => void;
  initialize: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  stageLocalProjectsForRecovery: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  handleOnline: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function createTask(overrides: Partial<SimpleChatTask> = {}): SimpleChatTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: '保留的对话',
    messages: [{ id: 'message-1', role: 'user', content: '不要丢失', createdAt: 1 }],
    model: 'gpt-5.5',
    providerId: 'provider-openai',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createProject(overrides: Partial<SimpleChatProject> = {}): SimpleChatProject {
  return {
    id: 'project-1',
    name: '同步项目',
    emoji: 'C',
    description: '',
    tasks: [createTask()],
    agents: [],
    knowledgeItems: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createSnapshot(
  status: SimpleChatSyncSnapshot['status'],
  projects: SimpleChatProject[],
): SimpleChatSyncSnapshot {
  return {
    status,
    projects,
    pendingOperations: [],
    error: status === 'failed'
      ? { code: 'NETWORK_ERROR', message: '同步失败', retryable: true }
      : null,
  };
}

function createCoordinatorHarness(
  initializeResult: SimpleChatSyncSnapshot | Promise<SimpleChatSyncSnapshot>,
): CoordinatorHarness {
  const listeners = new Set<(snapshot: SimpleChatSyncSnapshot) => void>();
  const unsubscribe = vi.fn();
  const initialize = vi.fn(() => Promise.resolve(initializeResult));
  const update = vi.fn();
  const stageLocalProjectsForRecovery = vi.fn().mockResolvedValue(undefined);
  const flush = vi.fn().mockResolvedValue(undefined);
  const handleOnline = vi.fn().mockResolvedValue(undefined);
  const dispose = vi.fn().mockResolvedValue(undefined);
  const coordinator: SimpleChatSyncCoordinator = {
    initialize,
    update,
    stageLocalProjectsForRecovery,
    flush,
    handleOnline,
    snapshot: vi.fn(() => createSnapshot('loading', [])),
    subscribe: vi.fn(listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    }),
    dispose,
  };

  return {
    coordinator,
    initialize,
    update,
    stageLocalProjectsForRecovery,
    flush,
    handleOnline,
    unsubscribe,
    dispose,
    emit: snapshot => {
      for (const listener of listeners) listener(snapshot);
    },
  };
}

async function renderAuthenticatedPage(harness: CoordinatorHarness): Promise<void> {
  mocks.fetchSessionPayload.mockResolvedValue({
    success: true,
    user: { id: 'user-1', name: 'Test User', createdAt: 1, updatedAt: 1 },
  });
  mocks.coordinatorFactory.mockReturnValue(harness.coordinator);

  render(<SimpleChatPage />);

  await screen.findByTestId('chat-area');
  await waitFor(() => expect(harness.initialize).toHaveBeenCalledWith('user-1'));
}

describe('simple chat synchronization integration', () => {
  beforeEach(() => {
    mocks.coordinatorFactory.mockReset();
    mocks.fetchSessionPayload.mockReset();
    mocks.globalFetch.mockReset();
    mocks.logoutSimpleChatSession.mockReset();
    mocks.routerReplace.mockReset();
    mocks.chatAreaProps = null;
    mocks.sidebarProps = null;
    mocks.loginUser = { id: 'user-login', name: 'Login User', createdAt: 1, updatedAt: 1 };
    mocks.loginHandler = null;
    mocks.logoutSimpleChatSession.mockResolvedValue({ loggedOut: true });
    vi.stubGlobal('fetch', mocks.globalFetch);
    window.history.replaceState(null, '', '/simple-chat');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges a failed-state local project with the first successful online snapshot', async () => {
    const project = createProject();
    const harness = createCoordinatorHarness(createSnapshot('failed', []));
    harness.handleOnline.mockImplementation(async () => {
      harness.emit(createSnapshot('synced', [project]));
    });

    await renderAuthenticatedPage(harness);

    expect(screen.getByText('同步失败，点击重试')).toBeTruthy();
    expect(harness.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '创建测试项目' }));
    await act(async () => Promise.resolve());
    expect(harness.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试同步' }));

    await waitFor(() => expect(harness.handleOnline).toHaveBeenCalledOnce());
    await waitFor(() => expect(harness.update).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'project-1' }),
      expect.objectContaining({ name: '默认项目' }),
    ])));
    expect(mocks.sidebarProps?.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project-1' }),
      expect.objectContaining({ name: '默认项目' }),
    ]));
    expect(harness.flush).not.toHaveBeenCalled();
  });

  it('merges a loading-state local project before publishing the initialized snapshot', async () => {
    let resolveInitialize!: (snapshot: SimpleChatSyncSnapshot) => void;
    const deferred = new Promise<SimpleChatSyncSnapshot>(resolve => {
      resolveInitialize = resolve;
    });
    const harness = createCoordinatorHarness(deferred);
    await renderAuthenticatedPage(harness);

    fireEvent.click(screen.getByRole('button', { name: '创建测试项目' }));
    expect(harness.update).not.toHaveBeenCalled();
    const localProjectId = mocks.sidebarProps?.projects[0]?.id;
    expect(localProjectId).toBeTruthy();
    if (!localProjectId) throw new Error('Expected a pre-ready local project');
    const remoteSameId = createProject({ id: localProjectId, name: '远端旧名称' });
    const remoteOnly = createProject({
      id: 'remote-only',
      name: '远端唯一项目',
      tasks: [createTask({ id: 'remote-task', projectId: 'remote-only' })],
    });

    await act(async () => {
      resolveInitialize(createSnapshot('synced', [remoteSameId, remoteOnly]));
      await deferred;
    });

    expect(harness.update).toHaveBeenCalledWith([
      expect.objectContaining({ id: localProjectId, name: '默认项目' }),
      expect.objectContaining({ id: 'remote-only', name: '远端唯一项目' }),
    ]);
    expect(mocks.sidebarProps?.projects).toHaveLength(2);
  });

  it('initializes after in-page login and initializes again after logout and login', async () => {
    const first = createCoordinatorHarness(createSnapshot('synced', [createProject()]));
    const secondProject = createProject({
      id: 'project-2',
      tasks: [createTask({ id: 'task-2', projectId: 'project-2' })],
    });
    const second = createCoordinatorHarness(createSnapshot('synced', [secondProject]));
    mocks.fetchSessionPayload.mockResolvedValue({ success: false, user: null });
    mocks.coordinatorFactory
      .mockReturnValueOnce(first.coordinator)
      .mockReturnValueOnce(second.coordinator);

    render(<SimpleChatPage />);

    fireEvent.click(await screen.findByRole('button', { name: '登录测试用户' }));
    await waitFor(() => expect(first.initialize).toHaveBeenCalledWith('user-login'));
    expect(await screen.findByTestId('chat-area')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '登录测试用户' })).toBeTruthy());
    await waitFor(() => expect(first.dispose).toHaveBeenCalledWith({ flush: false }));

    mocks.loginUser = {
      id: 'user-login-again',
      name: 'Login User Again',
      createdAt: 1,
      updatedAt: 1,
    };
    fireEvent.click(screen.getByRole('button', { name: '登录测试用户' }));

    await waitFor(() => expect(second.initialize).toHaveBeenCalledWith('user-login-again'));
    await waitFor(() => expect(mocks.chatAreaProps?.project?.id).toBe('project-2'));
  });

  it('hides the previous account on the first next-user frame and ignores late old snapshots', async () => {
    const accountAProject = createProject({ id: 'account-a-project', name: 'A 私有项目' });
    const first = createCoordinatorHarness(createSnapshot('synced', [accountAProject]));
    let resolveSecond!: (snapshot: SimpleChatSyncSnapshot) => void;
    const secondInitialize = new Promise<SimpleChatSyncSnapshot>(resolve => {
      resolveSecond = resolve;
    });
    const second = createCoordinatorHarness(secondInitialize);
    mocks.fetchSessionPayload.mockResolvedValue({
      success: true,
      user: { id: 'account-a', name: 'Account A', createdAt: 1, updatedAt: 1 },
    });
    mocks.coordinatorFactory
      .mockReturnValueOnce(first.coordinator)
      .mockReturnValueOnce(second.coordinator);

    render(<SimpleChatPage />);
    await waitFor(() => expect(mocks.chatAreaProps?.project?.id).toBe('account-a-project'));
    fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));
    await screen.findByRole('button', { name: '登录测试用户' });

    mocks.loginUser = { id: 'account-b', name: 'Account B', createdAt: 1, updatedAt: 1 };
    fireEvent.click(screen.getByRole('button', { name: '登录测试用户' }));

    expect(await screen.findByTestId('chat-area')).toBeTruthy();
    expect(mocks.sidebarProps?.projects).toEqual([]);
    expect(mocks.sidebarProps?.activeProjectId).toBeNull();
    expect(mocks.sidebarProps?.activeTaskId).toBeNull();
    expect(mocks.chatAreaProps?.project).toBeNull();
    expect(mocks.chatAreaProps?.task).toBeNull();
    expect(first.dispose).toHaveBeenCalledWith({ flush: false });

    act(() => first.emit(createSnapshot('synced', [createProject({ id: 'late-a' })])));
    expect(mocks.sidebarProps?.projects).toEqual([]);
    expect(mocks.chatAreaProps?.project).toBeNull();

    await act(async () => {
      resolveSecond(createSnapshot('failed', []));
      await secondInitialize;
    });
    expect(mocks.sidebarProps?.projects).toEqual([]);
    expect(mocks.chatAreaProps?.project).toBeNull();
  });

  it('unsubscribes and ignores a late initialize result after unmount', async () => {
    let resolveInitialize!: (snapshot: SimpleChatSyncSnapshot) => void;
    const deferred = new Promise<SimpleChatSyncSnapshot>(resolve => {
      resolveInitialize = resolve;
    });
    const harness = createCoordinatorHarness(deferred);
    mocks.fetchSessionPayload.mockResolvedValue({
      success: true,
      user: { id: 'user-1', name: 'Test User', createdAt: 1, updatedAt: 1 },
    });
    mocks.coordinatorFactory.mockReturnValue(harness.coordinator);
    const { unmount } = render(<SimpleChatPage />);
    await waitFor(() => expect(harness.initialize).toHaveBeenCalledWith('user-1'));

    unmount();
    await act(async () => {
      resolveInitialize(createSnapshot('synced', []));
      await deferred;
    });

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.flush).toHaveBeenCalledWith('user-switch');
    expect(harness.dispose).toHaveBeenCalledWith();
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('commits a local project change immediately after a snapshot without losing it', async () => {
    const project = createProject();
    const harness = createCoordinatorHarness(createSnapshot('synced', [project]));
    await renderAuthenticatedPage(harness);

    const staleProject = { ...project, name: '远端旧名称', updatedAt: 2 };
    const localProject = { ...project, name: '本地新名称', updatedAt: 3 };
    act(() => {
      harness.emit(createSnapshot('syncing', [staleProject]));
      mocks.chatAreaProps?.onUpdateProject(localProject);
    });

    expect(harness.update).toHaveBeenCalledOnce();
    expect(harness.update).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'project-1', name: '本地新名称' }),
    ]);
    expect(mocks.chatAreaProps?.project?.name).toBe('本地新名称');
  });

  it('persists a task through update plus manual flush without an independent fetch', async () => {
    const project = createProject();
    const harness = createCoordinatorHarness(createSnapshot('synced', [project]));
    await renderAuthenticatedPage(harness);
    const editedTask = createTask({
      messages: [
        ...project.tasks[0].messages,
        { id: 'message-2', role: 'assistant', content: '已回复', createdAt: 2 },
      ],
    });

    await act(async () => {
      await mocks.chatAreaProps?.onPersistTask(editedTask);
    });

    expect(harness.update).toHaveBeenCalledWith([
      expect.objectContaining({
        tasks: [expect.objectContaining({ messages: expect.arrayContaining([
          expect.objectContaining({ id: 'message-2', content: '已回复' }),
        ]) })],
      }),
    ]);
    expect(harness.flush).toHaveBeenCalledWith('manual');
    expect(mocks.globalFetch).not.toHaveBeenCalled();
  });

  it('persists only the current account pre-ready candidate while initialization is pending', async () => {
    const accountAProject = createProject({ id: 'account-a-project', name: 'A private project' });
    const first = createCoordinatorHarness(createSnapshot('synced', [accountAProject]));
    let resolveSecond!: (snapshot: SimpleChatSyncSnapshot) => void;
    const secondInitialize = new Promise<SimpleChatSyncSnapshot>(resolve => {
      resolveSecond = resolve;
    });
    const second = createCoordinatorHarness(secondInitialize);
    mocks.fetchSessionPayload.mockResolvedValue({
      success: true,
      user: { id: 'account-a', name: 'Account A', createdAt: 1, updatedAt: 1 },
    });
    mocks.coordinatorFactory
      .mockReturnValueOnce(first.coordinator)
      .mockReturnValueOnce(second.coordinator);

    render(<SimpleChatPage />);
    await waitFor(() => expect(mocks.chatAreaProps?.project?.id).toBe('account-a-project'));
    fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));
    await screen.findByRole('button', { name: '登录测试用户' });

    mocks.loginUser = { id: 'account-b', name: 'Account B', createdAt: 1, updatedAt: 1 };
    fireEvent.click(screen.getByRole('button', { name: '登录测试用户' }));
    await screen.findByTestId('chat-area');
    fireEvent.click(screen.getByRole('button', { name: '创建测试项目' }));
    await waitFor(() => expect(mocks.chatAreaProps?.project?.name).toBe('默认项目'));
    const candidateProject = mocks.chatAreaProps?.project;
    const candidateTask = mocks.chatAreaProps?.task;
    if (!candidateProject || !candidateTask) throw new Error('Expected account B pre-ready candidate');

    await act(async () => {
      await mocks.chatAreaProps?.onPersistTask({ ...candidateTask, name: 'B persisted task' });
    });
    await act(async () => {
      resolveSecond(createSnapshot('synced', []));
      await secondInitialize;
    });

    expect(second.update).toHaveBeenCalledWith([
      expect.objectContaining({
        id: candidateProject.id,
        tasks: [expect.objectContaining({ id: candidateTask.id, name: 'B persisted task' })],
      }),
    ]);
    expect(second.update).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'account-a-project' }),
    ]));
    expect(second.flush).toHaveBeenCalledWith('manual');
  });

  it('logs out through only the current account coordinator after initialization fails', async () => {
    const accountAProject = createProject({ id: 'account-a-project', name: 'A private project' });
    const first = createCoordinatorHarness(createSnapshot('synced', [accountAProject]));
    const second = createCoordinatorHarness(createSnapshot('failed', []));
    mocks.fetchSessionPayload.mockResolvedValue({
      success: true,
      user: { id: 'account-a', name: 'Account A', createdAt: 1, updatedAt: 1 },
    });
    mocks.coordinatorFactory
      .mockReturnValueOnce(first.coordinator)
      .mockReturnValueOnce(second.coordinator);

    render(<SimpleChatPage />);
    await waitFor(() => expect(mocks.chatAreaProps?.project?.id).toBe('account-a-project'));
    fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));
    await screen.findByRole('button', { name: '登录测试用户' });

    mocks.loginUser = { id: 'account-b', name: 'Account B', createdAt: 1, updatedAt: 1 };
    fireEvent.click(screen.getByRole('button', { name: '登录测试用户' }));
    await screen.findByTestId('chat-area');
    await waitFor(() => expect(second.initialize).toHaveBeenCalledWith('account-b'));
    fireEvent.click(screen.getByRole('button', { name: '创建测试项目' }));
    await waitFor(() => expect(mocks.chatAreaProps?.project?.name).toBe('默认项目'));
    mocks.logoutSimpleChatSession.mockClear();
    mocks.logoutSimpleChatSession.mockImplementation(async (options: { flush: () => Promise<void> }) => {
      await options.flush();
      return { loggedOut: true, sync: 'completed' };
    });

    fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));
    await waitFor(() => expect(mocks.logoutSimpleChatSession).toHaveBeenCalledOnce());

    expect(mocks.logoutSimpleChatSession).toHaveBeenCalledWith({
      flush: expect.any(Function),
    });
    expect(second.flush).toHaveBeenCalledWith('logout');
    expect(first.flush).not.toHaveBeenCalledWith('logout');
    expect(mocks.globalFetch).not.toHaveBeenCalled();
  });

  it('stages a failed-initialize candidate before logout flush and recovers it on the next initialize', async () => {
    const first = createCoordinatorHarness(createSnapshot('failed', []));
    const recoveredProject = createProject({ id: 'recovered-project', name: '恢复项目' });
    const second = createCoordinatorHarness(createSnapshot('synced', [recoveredProject]));
    mocks.fetchSessionPayload.mockResolvedValue({
      success: true,
      user: { id: 'recover-user', name: 'Recover User', createdAt: 1, updatedAt: 1 },
    });
    mocks.coordinatorFactory
      .mockReturnValueOnce(first.coordinator)
      .mockReturnValueOnce(second.coordinator);
    mocks.logoutSimpleChatSession.mockImplementation(async (options: { flush: () => Promise<void> }) => {
      await options.flush();
      return { loggedOut: true, sync: 'completed' };
    });

    render(<SimpleChatPage />);
    await waitFor(() => expect(first.initialize).toHaveBeenCalledWith('recover-user'));
    fireEvent.click(screen.getByRole('button', { name: '创建测试项目' }));
    const candidate = mocks.sidebarProps?.projects ?? [];
    await waitFor(() => expect(first.stageLocalProjectsForRecovery).toHaveBeenCalledWith(candidate));
    first.stageLocalProjectsForRecovery.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));
    await screen.findByRole('button', { name: '登录测试用户' });

    expect(first.stageLocalProjectsForRecovery).toHaveBeenCalledWith(candidate);
    expect(first.stageLocalProjectsForRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      first.flush.mock.invocationCallOrder[0],
    );
    mocks.loginUser = { id: 'recover-user', name: 'Recover User', createdAt: 1, updatedAt: 1 };
    fireEvent.click(screen.getByRole('button', { name: '登录测试用户' }));
    await waitFor(() => expect(second.initialize).toHaveBeenCalledWith('recover-user'));
    expect((await screen.findByTestId('sidebar-projects')).textContent).toContain('recovered-project');
  });

  it.each(['failed', 'timed-out'] as const)(
    'shows a non-blocking recovery notice after logout sync is %s',
    async sync => {
      const harness = createCoordinatorHarness(createSnapshot('synced', [createProject()]));
      mocks.logoutSimpleChatSession.mockResolvedValue({ loggedOut: true, sync });
      await renderAuthenticatedPage(harness);

      fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));

      expect(await screen.findByText('同步未完成，将在下次登录继续同步')).toBeTruthy();
      expect(screen.getByRole('button', { name: '登录测试用户' })).toBeTruthy();
    },
  );

  it('still flushes and retains the candidate when logout staging fails', async () => {
    const first = createCoordinatorHarness(createSnapshot('failed', []));
    const second = createCoordinatorHarness(new Promise<SimpleChatSyncSnapshot>(() => undefined));
    mocks.coordinatorFactory
      .mockReturnValueOnce(first.coordinator)
      .mockReturnValueOnce(second.coordinator);
    await renderAuthenticatedPage(first);
    fireEvent.click(screen.getByRole('button', { name: '创建测试项目' }));
    const candidateId = mocks.sidebarProps?.projects[0]?.id;
    if (!candidateId) throw new Error('Expected a recovery candidate');
    await waitFor(() => expect(first.stageLocalProjectsForRecovery).toHaveBeenCalled());
    first.stageLocalProjectsForRecovery.mockRejectedValue(new Error('IDB unavailable'));
    first.flush.mockClear();
    mocks.logoutSimpleChatSession.mockImplementation(async (options: { flush: () => Promise<void> }) => {
      try {
        await options.flush();
        return { loggedOut: true, sync: 'completed' as const };
      } catch {
        return { loggedOut: true, sync: 'failed' as const };
      }
    });

    fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));
    expect(await screen.findByText('同步未完成，将在下次登录继续同步')).toBeTruthy();
    expect(first.flush).toHaveBeenCalledWith('logout');

    mocks.loginUser = { id: 'user-1', name: 'Test User', createdAt: 1, updatedAt: 1 };
    fireEvent.click(screen.getByRole('button', { name: '登录测试用户' }));
    await waitFor(() => expect(second.initialize).toHaveBeenCalledWith('user-1'));
    expect(mocks.sidebarProps?.projects.map(project => project.id)).toContain(candidateId);
  });

  it.each(['completed', 'skipped'] as const)(
    'does not show a recovery notice after logout sync is %s',
    async sync => {
      const harness = createCoordinatorHarness(createSnapshot('synced', [createProject()]));
      mocks.logoutSimpleChatSession.mockResolvedValue({ loggedOut: true, sync });
      await renderAuthenticatedPage(harness);

      fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));
      await screen.findByRole('button', { name: '登录测试用户' });

      expect(screen.queryByText('同步未完成，将在下次登录继续同步')).toBeNull();
    },
  );

  it('disposes the old coordinator without flush before directly initializing the next user', async () => {
    const order: string[] = [];
    let resolveDispose!: () => void;
    const disposeGate = new Promise<void>(resolve => { resolveDispose = resolve; });
    const first = createCoordinatorHarness(new Promise<SimpleChatSyncSnapshot>(() => undefined));
    first.dispose.mockImplementation(async options => {
      order.push(`dispose:${String(options?.flush)}`);
      await disposeGate;
    });
    const second = createCoordinatorHarness(createSnapshot('synced', [createProject({ id: 'project-b' })]));
    second.initialize.mockImplementation(async userId => {
      order.push(`initialize:${userId}`);
      return createSnapshot('synced', [createProject({ id: 'project-b' })]);
    });
    mocks.fetchSessionPayload.mockResolvedValue({ success: false, user: null });
    mocks.coordinatorFactory
      .mockReturnValueOnce(first.coordinator)
      .mockReturnValueOnce(second.coordinator);
    render(<SimpleChatPage />);
    await screen.findByRole('button', { name: '登录测试用户' });
    mocks.loginUser = { id: 'account-a', name: 'Account A', createdAt: 1, updatedAt: 1 };
    fireEvent.click(screen.getByRole('button', { name: '登录测试用户' }));
    await waitFor(() => expect(first.initialize).toHaveBeenCalledWith('account-a'));

    await act(async () => {
      await mocks.loginHandler?.({ id: 'account-b', name: 'Account B', createdAt: 1, updatedAt: 1 });
    });
    expect(first.dispose).toHaveBeenCalledWith({ flush: false });
    expect(first.flush).not.toHaveBeenCalled();
    expect(second.initialize).not.toHaveBeenCalled();

    resolveDispose();
    await waitFor(() => expect(second.initialize).toHaveBeenCalledWith('account-b'));
    expect(order).toEqual(['dispose:false', 'initialize:account-b']);
  });

  it('routes browser lifecycle events to the active coordinator and removes listeners on unmount', async () => {
    const project = createProject();
    const harness = createCoordinatorHarness(createSnapshot('synced', [project]));
    mocks.fetchSessionPayload.mockResolvedValue({
      success: true,
      user: { id: 'user-1', name: 'Test User', createdAt: 1, updatedAt: 1 },
    });
    mocks.coordinatorFactory.mockReturnValue(harness.coordinator);
    vi.mocked(harness.coordinator.snapshot).mockReturnValue(createSnapshot('synced', [project]));
    const rendered = render(<SimpleChatPage />);
    await waitFor(() => expect(harness.initialize).toHaveBeenCalledWith('user-1'));
    harness.flush.mockClear();
    harness.handleOnline.mockClear();
    harness.update.mockClear();

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('offline'));

    expect(harness.flush).toHaveBeenCalledWith('pagehide');
    expect(harness.handleOnline).toHaveBeenCalledOnce();
    expect(harness.update).toHaveBeenCalledWith([project]);

    rendered.unmount();
    harness.flush.mockClear();
    harness.handleOnline.mockClear();
    harness.update.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('offline'));
    expect(harness.flush).not.toHaveBeenCalled();
    expect(harness.handleOnline).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('does not user-switch flush again after logout changes the session cookie', async () => {
    const harness = createCoordinatorHarness(createSnapshot('synced', [createProject()]));
    mocks.logoutSimpleChatSession.mockImplementation(async (options: { flush: () => Promise<void> }) => {
      await options.flush();
      return { loggedOut: true, sync: 'completed' };
    });
    await renderAuthenticatedPage(harness);

    fireEvent.click(screen.getByRole('button', { name: '退出测试用户' }));
    await screen.findByRole('button', { name: '登录测试用户' });

    expect(harness.flush).toHaveBeenCalledTimes(1);
    expect(harness.flush).toHaveBeenCalledWith('logout');
    expect(harness.flush).not.toHaveBeenCalledWith('user-switch');
    expect(harness.dispose).toHaveBeenCalledWith({ flush: false });
  });

  it('keeps ChatArea mounted with the authenticated user and model-bearing chat task props', async () => {
    const project = createProject();
    const harness = createCoordinatorHarness(createSnapshot('synced', [project]));
    await renderAuthenticatedPage(harness);

    expect(screen.getByTestId('chat-area')).toBeTruthy();
    expect(mocks.chatAreaProps).toMatchObject({
      user: { id: 'user-1' },
      project: { id: 'project-1' },
      task: {
        id: 'task-1',
        model: 'gpt-5.5',
        providerId: 'provider-openai',
        messages: [expect.objectContaining({ content: '不要丢失' })],
      },
      sidebarOpen: true,
    });
    expect(mocks.chatAreaProps?.onUpdateTask).toEqual(expect.any(Function));
    expect(mocks.chatAreaProps?.onPersistTask).toEqual(expect.any(Function));
    expect(mocks.chatAreaProps?.onUpdateProject).toEqual(expect.any(Function));
  });
});
