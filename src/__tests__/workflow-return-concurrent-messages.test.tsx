// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatArea from '../components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import type { User } from '@/lib/user-types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const user: User = { id: 'synthetic-user', name: 'Synthetic', createdAt: 1, updatedAt: 1 };
const returnedId = 'workflow-return:synthetic-placement';
const added = '持久化期间新增的合成消息';
const makeTask = (alreadyReturned = false): SimpleChatTask => ({
  id: 'task-a', projectId: 'project-a', name: 'Synthetic A',
  messages: [
    { id: 'existing', role: 'user', content: '合成原消息', createdAt: 1 },
    ...(alreadyReturned ? [{ id: returnedId, role: 'assistant' as const, content: '已有工作流结果', createdAt: 1 }] : []),
  ],
  model: 'synthetic-model', providerId: 'synthetic-provider', createdAt: 1, updatedAt: 1,
});
const taskB: SimpleChatTask = {
  id: 'task-b', projectId: 'project-b', name: 'Synthetic B',
  messages: [{ id: 'b-only', role: 'user', content: '项目B原消息', createdAt: 1 }],
  model: 'synthetic-model', providerId: 'synthetic-provider', createdAt: 1, updatedAt: 1,
};
const response = (body: unknown): Response => ({ ok: true, json: async () => body }) as Response;

type FixtureState = {
  gate: ReturnType<typeof deferred<void>>;
  chatGate: ReturnType<typeof deferred<Response>>;
  updates: SimpleChatTask[];
  persisted: SimpleChatTask[];
  parent: Record<string, SimpleChatTask>;
  requests: string[];
  captureParent: (tasks: Record<string, SimpleChatTask>) => void;
};
function createFixture(alreadyReturned = false): FixtureState {
  const state: FixtureState = { gate: deferred<void>(), chatGate: deferred<Response>(), updates: [], persisted: [],
    parent: { 'project-a': makeTask(alreadyReturned), 'project-b': structuredClone(taskB) }, requests: [],
    captureParent: tasks => { state.parent = tasks; } };
  return state;
}
function Fixture({ state }: { state: FixtureState }) {
  const [projectId, setProjectId] = useState('project-a');
  const [activeUser, setActiveUser] = useState(user);
  const [tasks, setTasks] = useState(state.parent);
  const [taskPresent, setTaskPresent] = useState(true);
  const task = taskPresent ? tasks[projectId] : null;
  useLayoutEffect(() => { state.captureParent(tasks); }, [state, tasks]);
  const project = useMemo<SimpleChatProject>(() => ({
    id: projectId, name: 'Synthetic ' + projectId, tasks: task ? [task] : [], agents: [], knowledgeItems: [], createdAt: 1, updatedAt: 1,
  }), [projectId, task]);
  const update = useCallback((value: SimpleChatTask) => {
    state.updates.push(structuredClone(value));
    setTasks(current => ({ ...current, [value.projectId]: value }));
  }, [state]);
  const persist = useCallback(async (value: SimpleChatTask) => {
    state.persisted.push(structuredClone(value));
    setTasks(current => ({ ...current, [value.projectId]: value }));
    await state.gate.promise;
  }, [state]);
  return <>
    <div data-testid="fixture-project">{projectId}</div>
    <button type="button" onClick={() => setProjectId('project-b')}>切换到合成项目B</button>
    <button type="button" onClick={() => setProjectId('project-a')}>切回合成项目A</button>
    <button type="button" onClick={() => setTaskPresent(false)}>暂时隐藏会话</button>
    <button type="button" onClick={() => {
      setTasks(current => ({ ...current, [projectId]: { ...current[projectId], messages: [
        { id: 'restored', role: 'user', content: '恢复后的新消息', createdAt: 2 },
      ] } }));
      setTaskPresent(true);
    }}>恢复更新后的会话</button>
    <button type="button" onClick={() => setActiveUser({ ...user, id: 'other-user' })}>切换合成账号</button>
    <button type="button" onClick={() => setActiveUser(user)}>切回合成账号</button>
    <button type="button" onClick={() => {
      setActiveUser({ ...user, id: 'other-user' });
      setTasks(current => ({ ...current, 'project-a': { ...current['project-a'], messages: [
        { id: 'other-only', role: 'user', content: '另一账号原消息', createdAt: 1 },
      ] } }));
    }}>切换账号并载入消息</button>
    <ChatArea user={activeUser} project={project} task={task} onUpdateTask={update} onPersistTask={persist}
      onUpdateProject={() => {}} onCreateTask={() => {}} onSelectTask={() => {}} onUpdateAgent={() => {}}
      onDeleteAgent={() => {}} onSkillToAgent={() => {}} onLogout={() => {}} onBackToWorkspace={() => {}}
      sidebarOpen={true} onToggleSidebar={() => {}} />
  </>;
}
function setup(state: FixtureState, mutateSearch?: (search: string) => string): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); state.requests.push(`${init?.method || 'GET'} ${url}`);
    if (url === '/api/assets/transfer' && init?.method === 'POST') return response({
      url: '/synthetic-image.png', assetId: 'synthetic-asset', assetVersionId: 'synthetic-version-result',
      placementId: 'synthetic-placement', entityId: 'workflow-return:synthetic-execution:synthetic-output',
    });
    if (url === '/api/simple-chat/chat' && init?.method === 'POST') return state.chatGate.promise;
    if (url === '/api/models?type=chat') return response({ models: [{ id: 'synthetic-model', name: 'Synthetic', providerId: 'synthetic-provider' }], providers: [{ id: 'synthetic-provider', name: 'Synthetic' }] });
    if (url === '/api/models?type=image') return response({ models: [], providers: [] });
    if (url === '/api/user-data/sync?key=projects') return response({ success: false });
    if (url === '/api/simple-chat/memory') return response({ memories: [] });
    throw new Error(`Unexpected fetch blocked: ${url}`);
  }));
  window.history.replaceState(null, '', '/simple-chat?assetProjectId=synthetic-asset-project&workflowVersionId=synthetic-source&workflowId=synthetic-workflow&workflowExecutionId=synthetic-execution&workflowOutputNodeId=synthetic-output&workflowOutputLabel=synthetic-result');
  if (mutateSearch) window.history.replaceState(null, '', `/simple-chat${mutateSearch(window.location.search)}`);
  render(<Fixture state={state} />);
}
async function sendWhilePending(state: FixtureState): Promise<void> {
  await waitFor(() => expect(state.persisted).toHaveLength(1));
  expect(state.persisted[0].messages.filter(message => message.id === returnedId)).toHaveLength(1);
  fireEvent.change(screen.getByPlaceholderText('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片'), { target: { value: added } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await screen.findByText(added);
  await waitFor(() => expect(state.requests).toContain('POST /api/simple-chat/chat'));
  expect(state.updates.some(value => value.messages.some(message => message.content === added))).toBe(false);
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('unexpected WebSocket'); } });
  vi.stubGlobal('XMLHttpRequest', class { constructor() { throw new Error('unexpected XMLHttpRequest'); } });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('workflow return while persistence is pending', () => {
  it('shows the current project messages when projects use the same task id', async () => {
    const state = createFixture();
    state.parent['project-b'] = { ...state.parent['project-b'], id: 'task-a' };
    const originalB = structuredClone(state.parent['project-b']);
    setup(state, () => '');
    await screen.findByText('合成原消息');
    fireEvent.click(screen.getByRole('button', { name: '切换到合成项目B' }));
    expect(await screen.findByText('项目B原消息')).not.toBeNull();
    expect(screen.queryByText('合成原消息')).toBeNull();
    expect(state.parent['project-b'].messages).toEqual(originalB.messages);
  });

  it('shows the new account messages when project and task ids are unchanged', async () => {
    const state = createFixture(); setup(state, () => '');
    await screen.findByText('合成原消息');
    fireEvent.click(screen.getByRole('button', { name: '切换账号并载入消息' }));
    expect(await screen.findByText('另一账号原消息')).not.toBeNull();
    expect(screen.queryByText('合成原消息')).toBeNull();
    expect(state.parent['project-a'].messages.map(message => message.content)).toEqual(['另一账号原消息']);
  });

  it('does not overwrite newly restored messages when the same task was temporarily absent', async () => {
    const state = createFixture(); setup(state, () => '');
    await screen.findByText('合成原消息');
    fireEvent.click(screen.getByRole('button', { name: '暂时隐藏会话' }));
    const beforeRestore = state.updates.length;
    fireEvent.click(screen.getByRole('button', { name: '恢复更新后的会话' }));
    expect(await screen.findByText('恢复后的新消息')).not.toBeNull();
    expect(state.updates.slice(beforeRestore).every(value =>
      value.messages.every(message => message.content !== '合成原消息'))).toBe(true);
    await waitFor(() => expect(state.parent['project-a'].messages.map(message => message.content)).toEqual(['恢复后的新消息']));
  });

  it('keeps unsent drafts separate when switching projects with the same task id', async () => {
    const state = createFixture();
    state.parent['project-b'] = { ...state.parent['project-b'], id: 'task-a' };
    setup(state, () => '');
    const placeholder = '输入消息，Enter 发送，支持 Ctrl+V 粘贴图片';
    const inputA = await screen.findByPlaceholderText(placeholder);
    fireEvent.change(inputA, { target: { value: '项目A未发送草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '切换到合成项目B' }));
    const inputB = await screen.findByPlaceholderText(placeholder) as HTMLTextAreaElement;
    expect(inputB.value).toBe('');
    fireEvent.change(inputB, { target: { value: '项目B未发送草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '切回合成项目A' }));
    expect((await screen.findByPlaceholderText(placeholder) as HTMLTextAreaElement).value).toBe('项目A未发送草稿');
  });

  it('keeps unsent drafts separate across account switches with matching ids', async () => {
    const state = createFixture(); setup(state, () => '');
    const placeholder = '输入消息，Enter 发送，支持 Ctrl+V 粘贴图片';
    const inputA = await screen.findByPlaceholderText(placeholder);
    fireEvent.change(inputA, { target: { value: '账号A未发送草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '切换合成账号' }));
    const inputB = await screen.findByPlaceholderText(placeholder) as HTMLTextAreaElement;
    expect(inputB.value).toBe('');
    fireEvent.change(inputB, { target: { value: '账号B未发送草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '切回合成账号' }));
    expect((await screen.findByPlaceholderText(placeholder) as HTMLTextAreaElement).value).toBe('账号A未发送草稿');
  });

  it('keeps unsent images in the project where they were selected', async () => {
    const state = createFixture();
    state.parent['project-b'] = { ...state.parent['project-b'], id: 'task-a' };
    setup(state, () => '');
    await screen.findByText('合成原消息');
    const upload = document.querySelector<HTMLInputElement>('#chat-file-upload');
    expect(upload).not.toBeNull();
    fireEvent.change(upload!, { target: { files: [new File(['synthetic'], 'synthetic-a.png', { type: 'image/png' })] } });
    expect(await screen.findByAltText('synthetic-a.png')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切换到合成项目B' }));
    await screen.findByText('项目B原消息');
    expect(screen.queryByAltText('synthetic-a.png')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切回合成项目A' }));
    expect(await screen.findByAltText('synthetic-a.png')).not.toBeNull();
  });

  it('keeps a late file read out of another project and restores it to its source', async () => {
    let finishRead: (() => void) | undefined;
    class DelayedReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      readAsDataURL(): void {
        finishRead = () => { this.result = 'data:image/png;base64,c3ludGhldGlj'; this.onload?.(); };
      }
    }
    vi.stubGlobal('FileReader', DelayedReader);
    const state = createFixture();
    state.parent['project-b'] = { ...state.parent['project-b'], id: 'task-a' };
    setup(state, () => '');
    await screen.findByText('合成原消息');
    fireEvent.change(document.querySelector<HTMLInputElement>('#chat-file-upload')!, {
      target: { files: [new File(['synthetic'], 'late-a.png', { type: 'image/png' })] },
    });
    expect(finishRead).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '切换到合成项目B' }));
    await screen.findByText('项目B原消息');
    act(() => { finishRead?.(); });
    expect(screen.queryByAltText('late-a.png')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切回合成项目A' }));
    expect(await screen.findByAltText('late-a.png')).not.toBeNull();
  });

  it('keeps unsent images separate across account switches with matching ids', async () => {
    const state = createFixture(); setup(state, () => '');
    await screen.findByText('合成原消息');
    fireEvent.change(document.querySelector<HTMLInputElement>('#chat-file-upload')!, {
      target: { files: [new File(['synthetic'], 'account-a.png', { type: 'image/png' })] },
    });
    expect(await screen.findByAltText('account-a.png')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切换合成账号' }));
    await screen.findByPlaceholderText('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片');
    expect(screen.queryByAltText('account-a.png')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切回合成账号' }));
    expect(await screen.findByAltText('account-a.png')).not.toBeNull();
  });

  it('keeps temporary-chat drafts separate from the saved conversation', async () => {
    const state = createFixture(); setup(state, () => '');
    const placeholder = '输入消息，Enter 发送，支持 Ctrl+V 粘贴图片';
    const input = await screen.findByPlaceholderText(placeholder);
    fireEvent.change(input, { target: { value: '普通会话草稿' } });
    fireEvent.change(document.querySelector<HTMLInputElement>('#chat-file-upload')!, {
      target: { files: [new File(['synthetic'], 'normal.png', { type: 'image/png' })] },
    });
    await screen.findByAltText('normal.png');
    fireEvent.click(screen.getByTitle('开启临时聊天'));
    const temporary = await screen.findByPlaceholderText(placeholder) as HTMLTextAreaElement;
    expect(temporary.value).toBe('');
    expect(screen.queryByAltText('normal.png')).toBeNull();
    fireEvent.change(temporary, { target: { value: '临时会话草稿' } });
    fireEvent.click(screen.getByTitle('临时聊天中（不保存）'));
    expect((await screen.findByPlaceholderText(placeholder) as HTMLTextAreaElement).value).toBe('普通会话草稿');
    expect(await screen.findByAltText('normal.png')).not.toBeNull();
  });

  it('keeps a late file read in its original chat mode', async () => {
    let finishRead: (() => void) | undefined;
    class DelayedReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      readAsDataURL(): void {
        finishRead = () => { this.result = 'data:image/png;base64,c3ludGhldGlj'; this.onload?.(); };
      }
    }
    vi.stubGlobal('FileReader', DelayedReader);
    const state = createFixture(); setup(state, () => '');
    await screen.findByText('合成原消息');
    fireEvent.change(document.querySelector<HTMLInputElement>('#chat-file-upload')!, {
      target: { files: [new File(['synthetic'], 'normal-late.png', { type: 'image/png' })] },
    });
    expect(finishRead).toBeDefined();
    fireEvent.click(screen.getByTitle('开启临时聊天'));
    await screen.findByTitle('临时聊天中（不保存）');
    act(() => { finishRead?.(); });
    expect(screen.queryByAltText('normal-late.png')).toBeNull();
    fireEvent.click(screen.getByTitle('临时聊天中（不保存）'));
    expect(await screen.findByAltText('normal-late.png')).not.toBeNull();
  });

  it('binds workflow asset transfer to the active account', async () => {
    const state = createFixture(); setup(state);
    try {
      await waitFor(() => expect(state.persisted).toHaveLength(1));
      const transfer = vi.mocked(fetch).mock.calls.find(([input]) => String(input) === '/api/assets/transfer');
      expect(transfer).toBeDefined();
      expect(new Headers(transfer?.[1]?.headers).get('x-wujie-expected-actor-id')).toBe(user.id);
    } finally {
      await act(async () => { state.gate.resolve(); await state.gate.promise; });
    }
  });

  it('does not apply an old workflow return after the active account changes', async () => {
    const state = createFixture(); setup(state);
    await waitFor(() => expect(state.persisted).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '切换合成账号' }));
    await act(async () => { state.gate.resolve(); await state.gate.promise; });
    expect(screen.queryByText('工作流结果已返回：synthetic-result')).toBeNull();
    expect(window.location.search).toContain('workflowExecutionId=synthetic-execution');
  });

  it.each([false, true])('keeps the new message and one return in UI and parent (already present: %s)', async alreadyReturned => {
    const state = createFixture(alreadyReturned); setup(state);
    await sendWhilePending(state);
    await act(async () => { state.gate.resolve(); await state.gate.promise; });
    await waitFor(() => {
      expect(screen.queryByText(added)).not.toBeNull();
      expect(state.parent['project-a'].messages.some(message => message.content === added)).toBe(true);
      expect(state.parent['project-a'].messages.filter(message => message.id === returnedId)).toHaveLength(1);
    });
    expect(document.querySelectorAll(`[data-chat-message-id="${returnedId}"]`)).toHaveLength(1);
  });

  it('keeps the persistence guard until an existing return is acknowledged', async () => {
    const state = createFixture(true); setup(state);
    try {
      await sendWhilePending(state);
      fireEvent.click(screen.getByRole('button', { name: '深度' }));
      expect(state.updates.some(value => value.messages.some(message => message.content === added))).toBe(false);
    } finally {
      await act(async () => { state.gate.resolve(); await state.gate.promise; });
    }
    await waitFor(() => expect(state.parent['project-a'].messages.some(message => message.content === added)).toBe(true));
    expect(state.parent['project-a'].reasoningEffort).toBe('high');
  });

  it('does not replace the active messages or clear return parameters when persistence rejects', async () => {
    const state = createFixture(); setup(state);
    await sendWhilePending(state);
    await act(async () => { state.gate.reject(new Error('synthetic flush failure')); await state.gate.promise.catch(() => undefined); });
    expect(screen.queryByText(added)).not.toBeNull();
    expect(screen.queryByText('工作流结果已返回：synthetic-result')).toBeNull();
    expect(window.location.search).toContain('workflowExecutionId=synthetic-execution');
    expect(state.persisted).toHaveLength(1);
  });

  it('preserves a newer workflow return URL when the previous save completes', async () => {
    const state = createFixture(); setup(state);
    await waitFor(() => expect(state.persisted).toHaveLength(1));
    const newer = window.location.search.replace('workflowExecutionId=synthetic-execution', 'workflowExecutionId=synthetic-new-execution');
    window.history.replaceState(null, '', `/simple-chat${newer}&unrelated=keep`);
    await act(async () => { state.gate.resolve(); await state.gate.promise; });
    expect(window.location.search).toContain('workflowExecutionId=synthetic-new-execution');
    expect(window.location.search).toContain('unrelated=keep');
  });

  it('clears only the completed return parameters when the intent is unchanged', async () => {
    const state = createFixture(); setup(state);
    await waitFor(() => expect(state.persisted).toHaveLength(1));
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}&unrelated=keep`);
    await act(async () => { state.gate.resolve(); await state.gate.promise; });
    expect(window.location.search).not.toContain('workflowExecutionId=');
    expect(window.location.search).toContain('unrelated=keep');
  });

  it('clears a completed sourceVersionId alias without touching unrelated parameters', async () => {
    const state = createFixture();
    setup(state, search => search.replace('workflowVersionId=', 'sourceVersionId=') + '&unrelated=keep');
    await waitFor(() => expect(state.persisted).toHaveLength(1));
    await act(async () => { state.gate.resolve(); await state.gate.promise; });
    expect(window.location.search).not.toContain('sourceVersionId=');
    expect(window.location.search).not.toContain('workflowExecutionId=');
    expect(window.location.search).toContain('unrelated=keep');
  });

  it('keeps the return when the target task changes during persistence', async () => {
    const state = createFixture(); setup(state, search => `${search}&projectId=project-a&taskId=task-a`);
    await waitFor(() => expect(state.persisted).toHaveLength(1));
    window.history.replaceState(null, '', `/simple-chat${window.location.search.replace('taskId=task-a', 'taskId=task-new')}`);
    await act(async () => { state.gate.resolve(); await state.gate.promise; });
    expect(window.location.search).toContain('workflowExecutionId=synthetic-execution');
    expect(window.location.search).toContain('taskId=task-new');
  });

  it('clears the return when the page only fills in the current project and task', async () => {
    const state = createFixture(); setup(state);
    await waitFor(() => expect(state.persisted).toHaveLength(1));
    window.history.replaceState(null, '', `/simple-chat${window.location.search}&projectId=project-a&taskId=task-a`);
    await act(async () => { state.gate.resolve(); await state.gate.promise; });
    expect(window.location.search).not.toContain('workflowExecutionId=');
    expect(window.location.search).toContain('projectId=project-a');
    expect(window.location.search).toContain('taskId=task-a');
  });

  it('rejects conflicting version aliases before transferring or saving a result', async () => {
    const state = createFixture(); setup(state, search => `${search}&sourceVersionId=another-version`);
    await screen.findByText('工作流返回参数存在冲突，未处理。请返回工作流重新发送。');
    expect(state.requests).not.toContain('POST /api/assets/transfer');
    expect(state.persisted).toHaveLength(0);
    expect(window.location.search).toContain('sourceVersionId=another-version');
    expect(window.location.search).toContain('workflowExecutionId=synthetic-execution');
  });

  it('does not transfer a return addressed to a different task', async () => {
    const state = createFixture();
    setup(state, search => `${search}&projectId=project-a&taskId=task-other`);
    await screen.findByText('合成原消息');
    expect(state.requests).not.toContain('POST /api/assets/transfer');
    expect(state.persisted).toHaveLength(0);
    expect(window.location.search).toContain('workflowExecutionId=synthetic-execution');
  });

  it('does not persist an old return to another project with the same task ID', async () => {
    const state = createFixture();
    state.parent['project-b'] = { ...structuredClone(taskB), id: 'task-a' };
    const bBefore = structuredClone(state.parent['project-b']);
    setup(state);
    await sendWhilePending(state);
    window.history.replaceState(null, '', '/simple-chat');
    fireEvent.click(screen.getByRole('button', { name: '切换到合成项目B' }));
    expect(screen.getByTestId('fixture-project').textContent).toBe('project-b');
    await act(async () => { state.gate.resolve(); await state.gate.promise; });
    expect(state.persisted).toHaveLength(1);
    expect(state.persisted[0].projectId).toBe('project-a');
    expect(state.parent['project-b']).toEqual(bBefore);
    expect(screen.queryByText('工作流结果已返回：synthetic-result')).toBeNull();
  });

  it('does not apply an old completion after the user switches projects', async () => {
    const state = createFixture(); setup(state);
    await sendWhilePending(state);
    // Isolate the already-started receipt; do not create a second intent for project B.
    window.history.replaceState(null, '', '/simple-chat');
    fireEvent.click(screen.getByRole('button', { name: '切换到合成项目B' }));
    await screen.findByText('项目B原消息');
    await act(async () => { state.gate.resolve(); await state.gate.promise; });
    expect(screen.queryByText('项目B原消息')).not.toBeNull();
    expect(state.parent['project-b'].messages).toEqual(taskB.messages);
    expect(state.parent['project-b'].messages.some(message => message.id === returnedId || message.content === added)).toBe(false);
  });
});
