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
const makeTask = (): SimpleChatTask => ({
  id: 'task-a', projectId: 'project-a', name: 'Synthetic A',
  messages: [
    { id: 'existing', role: 'user', content: '合成原消息', createdAt: 1 },
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
function createFixture(): FixtureState {
  const state: FixtureState = { gate: deferred<void>(), chatGate: deferred<Response>(), updates: [], persisted: [],
    parent: { 'project-a': makeTask(), 'project-b': structuredClone(taskB) }, requests: [],
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
    if (url === '/api/simple-chat/chat' && init?.method === 'POST') return state.chatGate.promise;
    if (url === '/api/models?type=chat') return response({ models: [{ id: 'synthetic-model', name: 'Synthetic', providerId: 'synthetic-provider' }], providers: [{ id: 'synthetic-provider', name: 'Synthetic' }] });
    if (url === '/api/models?type=image') return response({ models: [], providers: [] });
    if (url === '/api/user-data/sync?key=projects') return response({ success: false });
    if (url === '/api/simple-chat/memory') return response({ memories: [] });
    throw new Error(`Unexpected fetch blocked: ${url}`);
  }));
  window.history.replaceState(null, '', '/simple-chat');
  if (mutateSearch) window.history.replaceState(null, '', `/simple-chat${mutateSearch(window.location.search)}`);
  render(<Fixture state={state} />);
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('unexpected WebSocket'); } });
  vi.stubGlobal('XMLHttpRequest', class { constructor() { throw new Error('unexpected XMLHttpRequest'); } });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('chat account, draft and attachment isolation', () => {
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

});

// 20b4fd5e (2026-11-17) retired the inbound workflow URL consumer, including
// transfer, return-message persistence and URL acknowledgement. Keep the ten
// independent concurrency tests above; do not reinstate the deleted protocol.
// Per-case retirement and current bridge/send-scope coverage (including gaps):
// output/canvas-chat-audit/ci-20261121/f05/report.md
const retiredSearch = '?assetProjectId=synthetic-asset-project&workflowVersionId=synthetic-source&workflowId=synthetic-workflow&workflowExecutionId=synthetic-execution&workflowOutputNodeId=synthetic-output&workflowOutputLabel=synthetic-result&unrelated=keep';

describe('retired inbound workflow URLs have no import side effects', () => {
  it.each([
    ['former complete intent', retiredSearch],
    ['sourceVersionId alias', retiredSearch.replace('workflowVersionId=', 'sourceVersionId=')],
    ['conflicting version aliases', `${retiredSearch}&sourceVersionId=another-version`],
    ['another target task', `${retiredSearch}&projectId=project-a&taskId=task-other`],
  ])('does not transfer, persist or insert messages for %s', async (_label, search) => {
    const state = createFixture();
    const original = structuredClone(state.parent);
    setup(state, () => `${search}#retained`);
    const originalUrl = window.location.href;
    await screen.findByText('合成原消息');
    await waitFor(() => expect(state.requests).toContain('GET /api/models?type=chat'));
    await act(async () => {});

    expect(state.requests.filter(request => !request.startsWith('GET '))).toEqual([]);
    expect(state.persisted).toEqual([]);
    expect(state.parent['project-a'].messages).toEqual(original['project-a'].messages);
    expect(state.parent['project-b'].messages).toEqual(original['project-b'].messages);
    expect(document.querySelectorAll('[data-chat-message-id]')).toHaveLength(1);
    expect(window.location.href).toBe(originalUrl);
  });

  it('keeps the old URL inert across account and project changes without clearing a draft', async () => {
    const state = createFixture();
    setup(state, () => retiredSearch);
    const originalUrl = window.location.href;
    await screen.findByText('合成原消息');
    fireEvent.click(screen.getByRole('button', { name: '切换账号并载入消息' }));
    await screen.findByText('另一账号原消息');
    const placeholder = '输入消息，Enter 发送，支持 Ctrl+V 粘贴图片';
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: '当前账号草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '切换到合成项目B' }));
    await screen.findByText('项目B原消息');
    fireEvent.click(screen.getByRole('button', { name: '切回合成项目A' }));
    await screen.findByText('另一账号原消息');
    await act(async () => {});

    expect((screen.getByPlaceholderText(placeholder) as HTMLTextAreaElement).value).toBe('当前账号草稿');
    expect(state.parent['project-a'].messages.map(message => message.content)).toEqual(['另一账号原消息']);
    expect(state.parent['project-b'].messages).toEqual(taskB.messages);
    expect(state.requests.filter(request => !request.startsWith('GET '))).toEqual([]);
    expect(state.persisted).toEqual([]);
    expect(window.location.href).toBe(originalUrl);
  });

  it('allows ordinary sending and stopping while retaining the old URL and newer draft', async () => {
    const state = createFixture();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(value): void { controller = value; },
      cancel(): void { cancelled = true; },
    });
    const emit = (content: string): void => {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'text', content })}\n\n`));
    };
    state.chatGate.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    setup(state, () => retiredSearch);
    const originalUrl = window.location.href;
    const placeholder = '输入消息，Enter 发送，支持 Ctrl+V 粘贴图片';
    await screen.findByText('合成原消息');
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: '普通聊天请求' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(state.requests).toContain('POST /api/simple-chat/chat'));
    await act(async () => { emit('停止前的回答'); });
    await screen.findByText('停止前的回答');
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: '停止期间的新草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    const chatRequest = vi.mocked(fetch).mock.calls.find(([input]) => String(input) === '/api/simple-chat/chat');
    expect(chatRequest?.[1]?.signal?.aborted).toBe(true);
    // Release the pending read after abort; the real SSE consumer must discard it.
    await act(async () => { emit('停止后不应追加的回答'); });
    await screen.findByRole('button', { name: '发送消息' });
    await waitFor(() => expect(cancelled).toBe(true));

    expect(screen.queryByText('停止后不应追加的回答')).toBeNull();
    expect((screen.getByPlaceholderText(placeholder) as HTMLTextAreaElement).value).toBe('停止期间的新草稿');
    await waitFor(() => expect(state.parent['project-a'].messages.map(message => message.content))
      .toEqual(['合成原消息', '普通聊天请求', '停止前的回答']));
    expect(state.parent['project-a'].messages.at(-1)?.status).toBe('completed');
    expect(state.requests.filter(request => !request.startsWith('GET '))).toEqual(['POST /api/simple-chat/chat']);
    expect(state.persisted).toEqual([]);
    expect(window.location.href).toBe(originalUrl);
  });
});
