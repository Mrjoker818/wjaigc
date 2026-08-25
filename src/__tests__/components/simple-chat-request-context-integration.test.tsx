// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';

import ChatArea from '@/components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import type { User } from '@/lib/user-types';

const chatAreaSource = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/chat-area.tsx'),
  'utf8',
);

const INVALID_IMAGE = 'data:image/png;base64,not-valid';
const VALID_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr1sAAAAASUVORK5CYII=';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const user: User = {
  id: 'user-1',
  name: 'Test user',
  createdAt: 1,
  updatedAt: 1,
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function streamResponse(): Response {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"text","content":"reply"}\n\n'));
        controller.close();
      },
    }),
  } as Response;
}

function createProject(task: SimpleChatTask): SimpleChatProject {
  return {
    id: 'project-1',
    name: 'Project',
    createdAt: 1,
    updatedAt: 1,
    tasks: [task],
    agents: [],
    knowledgeItems: [],
  };
}

function ChatAreaHarness({
  initialTask,
  onUpdateTask,
}: {
  initialTask: SimpleChatTask;
  onUpdateTask: ReturnType<typeof vi.fn>;
}) {
  const [task, setTask] = useState(initialTask);
  const project = useMemo(() => createProject(task), [task]);

  return (
    <ChatArea
      user={user}
      project={project}
      task={task}
      onUpdateTask={(nextTask) => {
        onUpdateTask(nextTask);
        setTask(nextTask);
      }}
      onPersistTask={async () => {}}
      onUpdateProject={vi.fn()}
      onCreateTask={vi.fn()}
      onSelectTask={vi.fn()}
      onUpdateAgent={vi.fn()}
      onDeleteAgent={vi.fn()}
      onSkillToAgent={vi.fn()}
      onLogout={vi.fn()}
      onBackToWorkspace={vi.fn()}
      sidebarOpen={true}
      onToggleSidebar={vi.fn()}
    />
  );
}

function TaskSwitchingChatAreaHarness({
  initialTask,
  nextTask,
  onUpdateTask,
}: {
  initialTask: SimpleChatTask;
  nextTask: SimpleChatTask;
  onUpdateTask: ReturnType<typeof vi.fn>;
}) {
  const [task, setTask] = useState(initialTask);
  const project = useMemo(() => ({
    ...createProject(task),
    tasks: [initialTask, nextTask],
  }), [initialTask, nextTask, task]);

  return (
    <>
      <button type="button" onClick={() => setTask(nextTask)}>切换任务</button>
      <ChatArea
        user={user}
        project={project}
        task={task}
        onUpdateTask={(updatedTask) => {
          onUpdateTask(updatedTask);
          setTask(updatedTask);
        }}
        onPersistTask={async () => {}}
        onUpdateProject={vi.fn()}
        onCreateTask={vi.fn()}
        onSelectTask={vi.fn()}
        onUpdateAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
        onSkillToAgent={vi.fn()}
        onLogout={vi.fn()}
        onBackToWorkspace={vi.fn()}
        sidebarOpen={true}
        onToggleSidebar={vi.fn()}
      />
    </>
  );
}

function createTask(messages: SimpleChatTask['messages'] = []): SimpleChatTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Request context',
    messages,
    model: 'chat-model',
    providerId: 'provider-1',
    createdAt: 1,
    updatedAt: 1,
  };
}

function installLocalStorage(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
}

function mockStartupRequests(
  chatResponse = streamResponse(),
  models = [{ id: 'chat-model', name: 'Chat model', providerId: 'provider-1' }],
): void {
  installLocalStorage();
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url === '/api/models?type=chat') {
      return Promise.resolve(jsonResponse({
        models,
        providers: models.map(model => ({ id: model.providerId, name: model.providerId })),
      }));
    }
    if (url === '/api/models?type=image') return Promise.resolve(jsonResponse({ models: [], providers: [] }));
    if (url === '/api/user-data/sync?key=projects') {
      return Promise.resolve(jsonResponse({
        success: true,
        value: [{ id: 'canvas-project-1', name: 'Canvas project' }],
      }));
    }
    if (url === '/api/simple-chat/memory') return Promise.resolve(jsonResponse({ memories: [] }));
    if (url === '/api/simple-chat/chat') {
      const payload = options && typeof options === 'object' && 'body' in options
        ? JSON.parse(String(options.body))
        : null;
      if (payload?.assetAction === 'register') {
        return Promise.resolve(jsonResponse({
          url: '/managed/current.png',
          assetId: 'asset-current',
          assetVersionId: 'version-current',
          placementId: 'placement-current',
          entityId: payload.entityId,
        }));
      }
      return Promise.resolve(chatResponse);
    }
    return Promise.resolve(jsonResponse({}));
  }));
}

function submitText(value: string): void {
  const textarea = screen.getByPlaceholderText(/输入消息/u);
  fireEvent.change(textarea, { target: { value } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
}

function requestPayloads(endpoint: string): Record<string, unknown>[] {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    .filter(([url]) => url === endpoint)
    .map(([, options]) => JSON.parse(String(options?.body)) as Record<string, unknown>);
}

describe('simple-chat request context integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/brand-dna');
    vi.restoreAllMocks();
  });

  it('captures a task model selection snapshot for all three request paths', () => {
    expect(chatAreaSource.match(/const requestModelSelection = readSimpleChatModelSelection\(task\);/g)).toHaveLength(3);
    expect(chatAreaSource).toContain('model: requestModelSelection.modelId');
    expect(chatAreaSource).toContain('providerId: requestModelSelection.providerId');
  });

  it('blocks an invalid current upload before asset registration or chat submission', async () => {
    const onUpdateTask = vi.fn();
    mockStartupRequests();
    let uploadedImage = INVALID_IMAGE;
    vi.stubGlobal('FileReader', class {
      result = uploadedImage;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL(): void {
        this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    const { container } = render(<ChatAreaHarness initialTask={createTask()} onUpdateTask={onUpdateTask} />);
    const upload = container.querySelector<HTMLInputElement>('#chat-file-upload');
    expect(upload).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('目标画布项目') as HTMLSelectElement).value).toBe('canvas-project-1'));
    fireEvent.change(upload!, { target: { files: [new File(['invalid'], 'invalid.png', { type: 'image/png' })] } });

    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(1));
    submitText('describe this');

    expect(await screen.findByText('当前上传图片无效，请重新选择图片后发送。')).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/simple-chat/chat', expect.anything());
    expect((screen.getByTitle('Deep Research - 深度研究') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(container.querySelector<HTMLButtonElement>('.relative.group button')!);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(0));
    uploadedImage = VALID_IMAGE;
    fireEvent.change(upload!, { target: { files: [new File(['valid'], 'valid.png', { type: 'image/png' })] } });
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(1));
    submitText('describe this');

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/simple-chat/chat', expect.any(Object)));
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => url === '/api/simple-chat/chat');
    const registration = calls.find(([, options]) => JSON.parse(String(options.body)).assetAction === 'register');
    const request = calls.find(([, options]) => !JSON.parse(String(options.body)).assetAction);
    expect(registration).toBeTruthy();
    expect(request).toBeTruthy();
    const requestPayload = JSON.parse(String(request![1].body));
    expect(requestPayload.messages.at(-1).images).toEqual(['/managed/current.png']);
    expect(requestPayload.sourceVersionIds).toEqual(['version-current']);
    expect(requestPayload.selectedEntityIds).toEqual([expect.stringContaining(':0')]);
  });

  it('omits invalid historical images from the request while preserving persisted history', async () => {
    const historicalMessage = {
      id: 'history-user',
      role: 'user' as const,
      content: 'historical question',
      images: [INVALID_IMAGE, VALID_IMAGE],
      createdAt: 1,
    };
    const onUpdateTask = vi.fn();
    mockStartupRequests();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    const nextTask = createTask();
    nextTask.id = 'task-2';
    nextTask.name = 'Task two';
    render(<TaskSwitchingChatAreaHarness
      initialTask={createTask([historicalMessage])}
      nextTask={nextTask}
      onUpdateTask={onUpdateTask}
    />);
    await waitFor(() => expect(onUpdateTask).toHaveBeenCalled());
    onUpdateTask.mockClear();
    submitText('continue the discussion');

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/simple-chat/chat', expect.any(Object)));
    const request = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, options]) => url === '/api/simple-chat/chat' && !JSON.parse(String(options.body)).assetAction,
    );
    expect(request).toBeTruthy();
    const payload = JSON.parse(String(request![1].body));
    expect(payload.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'historical question' }),
      expect.objectContaining({ role: 'user', content: 'continue the discussion' }),
    ]));
    expect(payload.messages.find((message: { content: string }) => message.content === 'historical question').images).toEqual([VALID_IMAGE]);
    await waitFor(() => expect(document.body.textContent).toContain('已忽略 1 张失效历史图片，本次请求继续发送。'));
    expect(document.body.textContent?.match(/已忽略 1 张失效历史图片，本次请求继续发送。/gu)).toHaveLength(1);
    expect(await screen.findByText('将携带最近对话中的 1 张图片作为上下文')).toBeTruthy();

    await waitFor(() => expect(onUpdateTask).toHaveBeenCalled());
    const updatedTask = onUpdateTask.mock.calls.at(-1)![0] as SimpleChatTask;
    expect(updatedTask.messages.find(message => message.id === historicalMessage.id)?.images).toEqual([INVALID_IMAGE, VALID_IMAGE]);

    fireEvent.click(screen.getByRole('button', { name: '切换任务' }));
    await waitFor(() => expect(document.body.textContent).not.toContain('已忽略 1 张失效历史图片，本次请求继续发送。'));
    expect(document.body.textContent).not.toContain('将携带最近对话中的 1 张图片作为上下文');
  });

  it('abandons a stale Brand DNA continuation before it rebuilds history or sends chat', async () => {
    const brandDna = createDeferred<{
      loadBrandDNARegistry: () => unknown[];
      generateBrandSystemPrompt: () => string;
    }>();
    const importStarted = vi.fn();
    const loadRegistry = vi.fn(() => []);
    vi.doMock('@/lib/brand-dna', () => {
      importStarted();
      return brandDna.promise;
    });
    const onUpdateTask = vi.fn();
    mockStartupRequests();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    const taskA = createTask([{
      id: 'history-user',
      role: 'user',
      content: 'Task A historical question',
      images: [INVALID_IMAGE, VALID_IMAGE],
      createdAt: 1,
    }]);
    const taskB = createTask();
    taskB.id = 'task-2';
    taskB.name = 'Task B';

    render(<TaskSwitchingChatAreaHarness initialTask={taskA} nextTask={taskB} onUpdateTask={onUpdateTask} />);
    await waitFor(() => expect(onUpdateTask).toHaveBeenCalled());
    onUpdateTask.mockClear();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByTitle('品牌DNA注入 - 将品牌规范注入对话上下文'));
    submitText('start brand race');
    await waitFor(() => expect(importStarted).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '切换任务' }));
    await waitFor(() => expect(document.body.textContent).not.toContain('Task A historical question'));
    await act(async () => {
      brandDna.resolve({
        loadBrandDNARegistry: loadRegistry,
        generateBrandSystemPrompt: () => '',
      });
    });
    await waitFor(() => expect(loadRegistry).toHaveBeenCalledTimes(1));

    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/simple-chat/chat', expect.any(Object));
    expect(document.body.textContent).not.toContain('已忽略 1 张失效历史图片，本次请求继续发送。');
    expect(document.body.textContent).not.toContain('将携带最近对话中的 1 张图片作为上下文');
  });

  it('rejects a normal chat request without a complete task model selection', async () => {
    const onUpdateTask = vi.fn();
    const task = createTask();
    task.model = '';
    task.providerId = '';
    mockStartupRequests(streamResponse(), []);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={task} onUpdateTask={onUpdateTask} />);
    submitText('missing model');

    expect(await screen.findByText('请先选择可用的对话模型。')).toBeTruthy();
    expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(0);
  });

  it('keeps the ordinary chat start selection while Brand DNA is pending and uses a later selection for the next request', async () => {
    const brandDna = createDeferred<{
      loadBrandDNARegistry: () => unknown[];
      generateBrandSystemPrompt: () => string;
    }>();
    const importStarted = vi.fn();
    vi.doMock('@/lib/brand-dna', () => {
      importStarted();
      return brandDna.promise;
    });
    const onUpdateTask = vi.fn();
    const task = createTask();
    task.model = 'start-model';
    task.providerId = 'start-provider';
    mockStartupRequests(streamResponse(), [
      { id: 'start-model', name: 'Start model', providerId: 'start-provider' },
      { id: 'next-model', name: 'Next model', providerId: 'next-provider' },
    ]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={task} onUpdateTask={onUpdateTask} />);
    fireEvent.click(screen.getByTitle('品牌DNA注入 - 将品牌规范注入对话上下文'));
    submitText('start selection');
    await waitFor(() => expect(importStarted).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Start model/u }));
    fireEvent.click(screen.getByRole('option', { name: /Next model/u }));
    await waitFor(() => expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      model: 'next-model',
      providerId: 'next-provider',
    })));

    await act(async () => {
      brandDna.resolve({
        loadBrandDNARegistry: () => [],
        generateBrandSystemPrompt: () => '',
      });
    });
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(1));
    expect(requestPayloads('/api/simple-chat/chat')[0]).toMatchObject({
      model: 'start-model',
      providerId: 'start-provider',
    });
    await waitFor(() => expect(onUpdateTask.mock.calls.map(([updatedTask]) => updatedTask as SimpleChatTask).some(
      updatedTask => updatedTask.messages.some(message => (
        message.role === 'assistant'
        && message.model === 'start-model'
        && message.providerId === 'start-provider'
      )),
    )).toBe(true));

    submitText('next selection');
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(2));
    expect(requestPayloads('/api/simple-chat/chat')[1]).toMatchObject({
      model: 'next-model',
      providerId: 'next-provider',
    });
  });

  it('sends CanvasEditor edits with the selected task model pair', async () => {
    const onUpdateTask = vi.fn();
    const task = createTask();
    task.model = 'canvas-model';
    task.providerId = 'canvas-provider';
    mockStartupRequests(streamResponse(), [
      { id: 'canvas-model', name: 'Canvas model', providerId: 'canvas-provider' },
    ]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={task} onUpdateTask={onUpdateTask} />);
    fireEvent.click(screen.getByTitle('写作画布'));
    fireEvent.change(screen.getByPlaceholderText('在这里编辑文案...'), { target: { value: 'draft' } });
    fireEvent.change(screen.getByPlaceholderText('告诉 AI 如何修改全文...'), { target: { value: 'polish it' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }));

    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(1));
    expect(requestPayloads('/api/simple-chat/chat')[0]).toMatchObject({
      model: 'canvas-model',
      providerId: 'canvas-provider',
    });
  });

  it('sends Deep Research with the selected task model pair and persists that pair on its assistant message', async () => {
    const onUpdateTask = vi.fn();
    const task = createTask();
    task.model = 'research-model';
    task.providerId = 'research-provider';
    mockStartupRequests(streamResponse(), [
      { id: 'research-model', name: 'Research model', providerId: 'research-provider' },
    ]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={task} onUpdateTask={onUpdateTask} />);
    const textarea = screen.getByPlaceholderText(/输入消息/u);
    fireEvent.change(textarea, { target: { value: 'research this' } });
    fireEvent.click(screen.getByTitle('Deep Research - 深度研究'));

    await waitFor(() => expect(requestPayloads('/api/simple-chat/deep-research')).toHaveLength(1));
    expect(requestPayloads('/api/simple-chat/deep-research')[0]).toMatchObject({
      query: 'research this',
      model: 'research-model',
      providerId: 'research-provider',
    });
    await waitFor(() => expect(onUpdateTask.mock.calls.map(([updatedTask]) => updatedTask as SimpleChatTask).some(
      updatedTask => updatedTask.messages.some(message => (
        message.role === 'assistant'
        && message.model === 'research-model'
        && message.providerId === 'research-provider'
      )),
    )).toBe(true));
  });
});
