// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import ChatArea from '@/components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import type { User } from '@/lib/user-types';

const chatAreaSource = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/chat-area.tsx'),
  'utf8',
);

const INVALID_IMAGE = 'data:image/png;base64,not-valid';
const VALID_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr1sAAAAASUVORK5CYII=';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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

interface DeferredSseResponse {
  response: Response;
  emit: (event: Record<string, unknown>) => void;
  close: () => void;
}

function createDeferredSseResponse(): DeferredSseResponse {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const response = {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
      },
    }),
  } as Response;

  return {
    response,
    emit(event) {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    close() {
      controller?.close();
    },
  };
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
  nextProjectId,
  onUpdateTask,
}: {
  initialTask: SimpleChatTask;
  nextTask: SimpleChatTask;
  nextProjectId?: string;
  onUpdateTask: ReturnType<typeof vi.fn>;
}) {
  const [task, setTask] = useState(initialTask);
  const project = useMemo(() => ({
    ...createProject(task),
    id: task.id === nextTask.id ? (nextProjectId || 'project-1') : 'project-1',
    tasks: [initialTask, nextTask],
  }), [initialTask, nextProjectId, nextTask, task]);

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
  chatResponse: Response | Response[] = streamResponse(),
  models = [{ id: 'chat-model', name: 'Chat model', providerId: 'provider-1' }],
  deepResearchResponses: Response[] = [streamResponse()],
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
      if (Array.isArray(chatResponse)) {
        return Promise.resolve(chatResponse.shift() || streamResponse());
      }
      return Promise.resolve(chatResponse);
    }
    if (url === '/api/simple-chat/deep-research') {
      return Promise.resolve(deepResearchResponses.shift() || streamResponse());
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
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.restoreAllMocks();
  });

  it('captures a task model selection snapshot for all three request paths', () => {
    expect(chatAreaSource.match(/const requestModelSelection = readSimpleChatModelSelection\(task\);/g)).toHaveLength(3);
    expect(chatAreaSource.match(/modelId: requestModelSelection\.modelId/g)).toHaveLength(3);
    expect(chatAreaSource.match(/providerId: requestModelSelection\.providerId/g)).toHaveLength(3);
    expect(chatAreaSource).toContain('model: request.modelId');
    expect(chatAreaSource).toContain('providerId: request.providerId');
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

  it('repairs an incomplete historical model selection from the exact catalog', async () => {
    const onUpdateTask = vi.fn();
    const task = createTask();
    task.model = 'chat-model';
    task.providerId = '';
    mockStartupRequests(streamResponse(), [
      { id: 'chat-model', name: 'Chat model', providerId: 'provider-1' },
    ]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={task} onUpdateTask={onUpdateTask} />);

    await waitFor(() => expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      model: 'chat-model',
      providerId: 'provider-1',
    })));
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

  it('retries a failed assistant in place with its frozen model and web-search context', async () => {
    const onUpdateTask = vi.fn();
    const firstResponse = createDeferredSseResponse();
    const retryResponse = createDeferredSseResponse();
    mockStartupRequests([firstResponse.response, retryResponse.response], [
      { id: 'start-model', name: 'Start model', providerId: 'start-provider' },
      { id: 'next-model', name: 'Next model', providerId: 'next-provider' },
    ]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    const task = createTask();
    task.model = 'start-model';
    task.providerId = 'start-provider';
    render(<ChatAreaHarness initialTask={task} onUpdateTask={onUpdateTask} />);

    fireEvent.click(screen.getByTitle('联网搜索'));
    submitText('frozen request');
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(1));
    await act(async () => {
      firstResponse.emit({ type: 'error', error: 'supplier failed' });
      firstResponse.close();
    });

    const retryButton = await screen.findByRole('button', { name: '重试' });
    const failedTask = onUpdateTask.mock.calls
      .map(([updatedTask]) => updatedTask as SimpleChatTask)
      .findLast(updatedTask => updatedTask.messages.some(message => message.status === 'failed'));
    const originalIds = failedTask?.messages.map(message => message.id);

    fireEvent.click(screen.getByRole('button', { name: /Start model/u }));
    fireEvent.click(screen.getByRole('option', { name: /Next model/u }));
    fireEvent.click(screen.getByTitle('联网搜索'));
    fireEvent.click(retryButton);
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(2));

    const [firstPayload, retryPayload] = requestPayloads('/api/simple-chat/chat');
    expect(retryPayload).toMatchObject({
      model: firstPayload.model,
      providerId: firstPayload.providerId,
      webSearch: true,
      responseMessageId: firstPayload.responseMessageId,
      idempotencyKey: firstPayload.idempotencyKey,
    });
    expect(firstPayload.idempotencyKey).toEqual(expect.any(String));
    await waitFor(() => {
      const latestTask = onUpdateTask.mock.calls.at(-1)?.[0] as SimpleChatTask;
      expect(latestTask.messages.map(message => message.id)).toEqual(originalIds);
    });

    await act(async () => {
      retryResponse.emit({ type: 'text', content: 'recovered' });
      retryResponse.emit({ type: 'done' });
      retryResponse.close();
    });
    await waitFor(() => expect(document.body.textContent).toContain('recovered'));
  });

  it('reuses managed attachment references without registering them again during retry', async () => {
    const onUpdateTask = vi.fn();
    const firstResponse = createDeferredSseResponse();
    const retryResponse = createDeferredSseResponse();
    mockStartupRequests([firstResponse.response, retryResponse.response]);
    vi.stubGlobal('FileReader', class {
      result = VALID_IMAGE;
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
    fireEvent.change(upload!, { target: { files: [new File(['valid'], 'valid.png', { type: 'image/png' })] } });
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(1));
    submitText('describe this image');
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(2));

    await act(async () => {
      firstResponse.emit({ type: 'error', error: 'supplier failed' });
      firstResponse.close();
    });
    fireEvent.click(await screen.findByRole('button', { name: '重试' }));
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(3));

    const payloads = requestPayloads('/api/simple-chat/chat');
    expect(payloads.filter(payload => payload.assetAction === 'register')).toHaveLength(1);
    const requests = payloads.filter(payload => payload.assetAction !== 'register');
    expect((requests[1].messages as Array<{ images?: string[] }>).at(-1)?.images).toEqual(['/managed/current.png']);

    await act(async () => {
      retryResponse.emit({ type: 'text', content: 'image recovered' });
      retryResponse.emit({ type: 'done' });
      retryResponse.close();
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

  it('asks selected CanvasEditor edits to return only the replacement fragment', async () => {
    const onUpdateTask = vi.fn();
    const task = createTask();
    const canvasResponse = createDeferredSseResponse();
    mockStartupRequests(canvasResponse.response);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={task} onUpdateTask={onUpdateTask} />);
    fireEvent.click(screen.getByTitle('写作画布'));
    const editor = screen.getByPlaceholderText('在这里编辑文案...') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '前缀原文后缀' } });
    editor.setSelectionRange(2, 4);
    fireEvent.select(editor);
    fireEvent.change(screen.getByPlaceholderText('告诉 AI 如何修改选中部分...'), {
      target: { value: '替换选区' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }));

    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(1));
    const payload = requestPayloads('/api/simple-chat/chat')[0];
    const messages = payload.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain('只输出修改后的选中文本片段');
    expect(messages[0].content).not.toContain('输出修改后的完整文本');
    expect(messages[1].content).toContain('【待修改的选中文本】\n原文');
  });

  it('shows the exact CanvasEditor supplier stream error instead of reporting an empty result', async () => {
    const onUpdateTask = vi.fn();
    const task = createTask();
    const canvasResponse = createDeferredSseResponse();
    mockStartupRequests(canvasResponse.response);
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

    await act(async () => {
      canvasResponse.emit({ type: 'error', error: 'APIMart edit get_channel_failed' });
      canvasResponse.close();
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('APIMart edit get_channel_failed'));
  });

  it('retries CanvasEditor with its frozen model pair and idempotency key', async () => {
    const onUpdateTask = vi.fn();
    const task = createTask();
    task.model = 'canvas-start-model';
    task.providerId = 'canvas-start-provider';
    const firstResponse = createDeferredSseResponse();
    const retryResponse = createDeferredSseResponse();
    mockStartupRequests([firstResponse.response, retryResponse.response], [
      { id: 'canvas-start-model', name: 'Canvas start model', providerId: 'canvas-start-provider' },
      { id: 'canvas-next-model', name: 'Canvas next model', providerId: 'canvas-next-provider' },
    ]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={task} onUpdateTask={onUpdateTask} />);
    fireEvent.click(screen.getByTitle('写作画布'));
    fireEvent.change(screen.getByPlaceholderText('在这里编辑文案...'), { target: { value: 'frozen draft' } });
    fireEvent.change(screen.getByPlaceholderText('告诉 AI 如何修改全文...'), { target: { value: 'frozen instruction' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }));
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(1));

    await act(async () => {
      firstResponse.emit({ type: 'error', error: 'canvas supplier failed' });
      firstResponse.close();
    });
    expect(await screen.findByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Canvas start model/u }));
    fireEvent.click(screen.getByRole('option', { name: /Canvas next model/u }));
    fireEvent.click(screen.getByRole('button', { name: '重试修改' }));
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(2));

    const [firstPayload, retryPayload] = requestPayloads('/api/simple-chat/chat');
    expect(retryPayload).toMatchObject({
      model: firstPayload.model,
      providerId: firstPayload.providerId,
      idempotencyKey: firstPayload.idempotencyKey,
    });
    expect(firstPayload).toMatchObject({
      model: 'canvas-start-model',
      providerId: 'canvas-start-provider',
      idempotencyKey: expect.any(String),
    });

    await act(async () => {
      retryResponse.emit({ type: 'text', content: 'recovered draft' });
      retryResponse.emit({ type: 'done' });
      retryResponse.close();
    });
    await waitFor(() => expect(screen.getByDisplayValue('recovered draft')).toBeTruthy());
  });

  it('does not apply a late CanvasEditor response after switching tasks', async () => {
    const onUpdateTask = vi.fn();
    const taskA = createTask([{
      id: 'task-a-message',
      role: 'user',
      content: 'Task A persisted message',
      createdAt: 1,
    }]);
    taskA.model = 'task-a-model';
    taskA.providerId = 'task-a-provider';
    const taskB = createTask([{
      id: 'task-b-message',
      role: 'user',
      content: 'Task B persisted message',
      createdAt: 2,
    }]);
    taskB.id = 'task-2';
    taskB.name = 'Task B';
    taskB.model = 'task-b-model';
    taskB.providerId = 'task-b-provider';
    const canvasResponse = createDeferredSseResponse();
    mockStartupRequests(canvasResponse.response, [
      { id: 'task-a-model', name: 'Task A model', providerId: 'task-a-provider' },
      { id: 'task-b-model', name: 'Task B model', providerId: 'task-b-provider' },
    ]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<TaskSwitchingChatAreaHarness initialTask={taskA} nextTask={taskB} onUpdateTask={onUpdateTask} />);
    fireEvent.click(screen.getByTitle('写作画布'));
    const editor = screen.getByPlaceholderText('在这里编辑文案...');
    fireEvent.change(editor, { target: { value: 'Task A draft' } });
    fireEvent.change(screen.getByPlaceholderText('告诉 AI 如何修改全文...'), { target: { value: 'polish it' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }));
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '切换任务' }));
    await act(async () => {
      canvasResponse.emit({ type: 'text', content: 'late Task A result' });
      canvasResponse.close();
    });

    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('Task A draft'));
    expect((editor as HTMLTextAreaElement).value).not.toContain('late Task A result');
    const taskBUpdates = onUpdateTask.mock.calls
      .map(([updatedTask]) => updatedTask as SimpleChatTask)
      .filter(updatedTask => updatedTask.id === taskB.id);
    expect(taskBUpdates.length).toBeGreaterThan(0);
    expect(taskBUpdates.every(updatedTask => (
      updatedTask.messages.some(message => message.id === 'task-b-message')
      && updatedTask.messages.every(message => message.id !== 'task-a-message')
    ))).toBe(true);
  });

  it('does not apply a late CanvasEditor response after switching projects', async () => {
    const onUpdateTask = vi.fn();
    const taskA = createTask();
    taskA.model = 'task-a-model';
    taskA.providerId = 'task-a-provider';
    const taskB = createTask();
    taskB.id = 'task-2';
    taskB.projectId = 'project-2';
    taskB.name = 'Project B task';
    taskB.model = 'task-b-model';
    taskB.providerId = 'task-b-provider';
    const canvasResponse = createDeferredSseResponse();
    mockStartupRequests(canvasResponse.response, [
      { id: 'task-a-model', name: 'Task A model', providerId: 'task-a-provider' },
      { id: 'task-b-model', name: 'Task B model', providerId: 'task-b-provider' },
    ]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<TaskSwitchingChatAreaHarness
      initialTask={taskA}
      nextTask={taskB}
      nextProjectId="project-2"
      onUpdateTask={onUpdateTask}
    />);
    fireEvent.click(screen.getByTitle('写作画布'));
    const editor = screen.getByPlaceholderText('在这里编辑文案...');
    fireEvent.change(editor, { target: { value: 'Project A draft' } });
    fireEvent.change(screen.getByPlaceholderText('告诉 AI 如何修改全文...'), { target: { value: 'polish it' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }));
    await waitFor(() => expect(requestPayloads('/api/simple-chat/chat')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '切换任务' }));
    await act(async () => {
      canvasResponse.emit({ type: 'text', content: 'late Project A result' });
      canvasResponse.close();
    });

    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('Project A draft'));
    expect((editor as HTMLTextAreaElement).value).not.toContain('late Project A result');
  });

  it('persists successful Deep Research stream content and metadata on its exact assistant message', async () => {
    const onUpdateTask = vi.fn();
    const task = createTask();
    task.model = 'research-model';
    task.providerId = 'research-provider';
    const researchResponse = createDeferredSseResponse();
    mockStartupRequests(streamResponse(), [
      { id: 'research-model', name: 'Research model', providerId: 'research-provider' },
    ], [researchResponse.response]);
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
    const assistantId = await waitFor(() => {
      const updatedTask = onUpdateTask.mock.calls
        .map(([nextTask]) => nextTask as SimpleChatTask)
        .find(nextTask => nextTask.messages.some(message => message.role === 'assistant'));
      const assistant = updatedTask?.messages.find(message => message.role === 'assistant');
      expect(assistant).toMatchObject({
        model: 'research-model',
        providerId: 'research-provider',
      });
      return assistant?.id;
    });

    await act(async () => {
      researchResponse.emit({ type: 'phase', label: '检索中' });
      researchResponse.emit({ type: 'text', content: 'final research' });
      researchResponse.emit({ type: 'citations' });
      researchResponse.close();
    });
    await waitFor(() => expect(onUpdateTask.mock.calls.map(([updatedTask]) => updatedTask as SimpleChatTask).some(
      updatedTask => updatedTask.messages.some(message => (
        message.id === assistantId
        && message.content === 'final research'
        && message.model === 'research-model'
        && message.providerId === 'research-provider'
        && message.artifacts?.length === 1
        && message.artifacts[0]?.id === `${assistantId}-research`
        && message.artifacts[0]?.content === 'final research'
      )),
    )).toBe(true));

    fireEvent.click(screen.getByTitle('Artifacts 文档'));
    expect(await screen.findByText('研究: research this')).toBeTruthy();
    expect(screen.queryByText('暂无 Artifacts')).toBeNull();
  });

  it('persists the exact Deep Research supplier stream error as the terminal assistant message', async () => {
    const onUpdateTask = vi.fn();
    const researchResponse = createDeferredSseResponse();
    mockStartupRequests(streamResponse(), undefined, [researchResponse.response]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={createTask()} onUpdateTask={onUpdateTask} />);
    fireEvent.change(screen.getByPlaceholderText(/输入消息/u), { target: { value: 'research failure' } });
    fireEvent.click(screen.getByTitle('Deep Research - 深度研究'));
    await waitFor(() => expect(requestPayloads('/api/simple-chat/deep-research')).toHaveLength(1));

    await act(async () => {
      researchResponse.emit({ type: 'phase', label: '正在综合分析并撰写研究报告...' });
      researchResponse.emit({ type: 'error', error: 'APIMart research get_channel_failed' });
      researchResponse.close();
    });

    await waitFor(() => expect(onUpdateTask.mock.calls.map(([updatedTask]) => updatedTask as SimpleChatTask).some(
      updatedTask => updatedTask.messages.some(message => (
        message.role === 'assistant'
        && message.content === 'Deep Research 失败：APIMart research get_channel_failed'
      )),
    )).toBe(true));
  });

  it('retries Deep Research on the same messages with its frozen provider pair', async () => {
    const onUpdateTask = vi.fn();
    const firstResponse = createDeferredSseResponse();
    const retryResponse = createDeferredSseResponse();
    const task = createTask();
    task.model = 'research-model';
    task.providerId = 'research-provider';
    mockStartupRequests(streamResponse(), [
      { id: 'research-model', name: 'Research model', providerId: 'research-provider' },
      { id: 'next-model', name: 'Next model', providerId: 'next-provider' },
    ], [firstResponse.response, retryResponse.response]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={task} onUpdateTask={onUpdateTask} />);
    fireEvent.change(screen.getByPlaceholderText(/输入消息/u), { target: { value: 'research retry' } });
    fireEvent.click(screen.getByTitle('Deep Research - 深度研究'));
    await waitFor(() => expect(requestPayloads('/api/simple-chat/deep-research')).toHaveLength(1));
    await act(async () => {
      firstResponse.emit({ type: 'phase', label: '规划中' });
      firstResponse.emit({ type: 'error', error: 'research failed' });
      firstResponse.close();
    });

    const retryButton = await screen.findByRole('button', { name: '重试' });
    const failedTask = onUpdateTask.mock.calls
      .map(([updatedTask]) => updatedTask as SimpleChatTask)
      .findLast(updatedTask => updatedTask.messages.some(message => message.status === 'failed'));
    const originalIds = failedTask?.messages.map(message => message.id);

    fireEvent.click(screen.getByRole('button', { name: /Research model/u }));
    fireEvent.click(screen.getByRole('option', { name: /Next model/u }));
    fireEvent.click(retryButton);
    await waitFor(() => expect(requestPayloads('/api/simple-chat/deep-research')).toHaveLength(2));

    const [firstPayload, retryPayload] = requestPayloads('/api/simple-chat/deep-research');
    expect(retryPayload).toMatchObject({
      query: firstPayload.query,
      model: firstPayload.model,
      providerId: firstPayload.providerId,
      depth: firstPayload.depth,
      idempotencyKey: firstPayload.idempotencyKey,
    });
    expect(firstPayload.idempotencyKey).toEqual(expect.any(String));
    await waitFor(() => {
      const latestTask = onUpdateTask.mock.calls.at(-1)?.[0] as SimpleChatTask;
      expect(latestTask.messages.map(message => message.id)).toEqual(originalIds);
    });

    await act(async () => {
      retryResponse.emit({ type: 'phase', label: '写作中' });
      retryResponse.emit({ type: 'text', content: 'research recovered' });
      retryResponse.emit({ type: 'citations' });
      retryResponse.emit({ type: 'done' });
      retryResponse.close();
    });
    await waitFor(() => {
      expect(document.body.textContent).toContain('research recovered');
      const latestTask = onUpdateTask.mock.calls.at(-1)?.[0] as SimpleChatTask;
      const assistant = latestTask.messages.find(message => message.role === 'assistant');
      expect(assistant?.artifacts).toHaveLength(1);
      expect(assistant?.artifacts?.[0]).toMatchObject({
        id: `${assistant?.id}-research`,
        content: 'research recovered',
        projectId: task.projectId,
        taskId: task.id,
      });
    });
  });

  it('isolates a stale Deep Research stream from a newer task request', async () => {
    const onUpdateTask = vi.fn();
    const taskA = createTask();
    taskA.model = 'task-a-model';
    taskA.providerId = 'task-a-provider';
    const taskB = createTask([{
      id: 'task-b-existing-assistant',
      role: 'assistant',
      content: 'Task B preserved',
      model: 'task-b-model',
      providerId: 'task-b-provider',
      createdAt: 1,
    }]);
    taskB.id = 'task-2';
    taskB.name = 'Task B';
    taskB.model = 'task-b-model';
    taskB.providerId = 'task-b-provider';
    const taskAResponse = createDeferredSseResponse();
    const taskBResponse = createDeferredSseResponse();
    mockStartupRequests(streamResponse(), [
      { id: 'task-a-model', name: 'Task A model', providerId: 'task-a-provider' },
      { id: 'task-b-model', name: 'Task B model', providerId: 'task-b-provider' },
    ], [taskAResponse.response, taskBResponse.response]);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<TaskSwitchingChatAreaHarness initialTask={taskA} nextTask={taskB} onUpdateTask={onUpdateTask} />);
    fireEvent.change(screen.getByPlaceholderText(/输入消息/u), { target: { value: 'Task A research' } });
    fireEvent.click(screen.getByTitle('Deep Research - 深度研究'));
    await waitFor(() => expect(requestPayloads('/api/simple-chat/deep-research')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '切换任务' }));
    await waitFor(() => expect(document.body.textContent).toContain('Task B preserved'));
    fireEvent.change(screen.getByPlaceholderText(/输入消息/u), { target: { value: 'Task B research' } });
    fireEvent.click(screen.getByTitle('Deep Research - 深度研究'));
    await waitFor(() => expect(requestPayloads('/api/simple-chat/deep-research')).toHaveLength(2));
    fireEvent.change(screen.getByPlaceholderText(/输入消息/u), { target: { value: 'Task B follow-up' } });
    expect((screen.getByTitle('Deep Research - 深度研究') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      taskAResponse.emit({ type: 'phase', label: 'Task A phase' });
      taskAResponse.emit({ type: 'text', content: 'Task A result' });
      taskAResponse.emit({ type: 'citations' });
      taskAResponse.close();
    });
    await waitFor(() => expect((screen.getByTitle('Deep Research - 深度研究') as HTMLButtonElement).disabled).toBe(true));
    expect(document.body.textContent).toContain('Task B preserved');
    expect(document.body.textContent).not.toContain('Task A result');
    expect(onUpdateTask.mock.calls.map(([updatedTask]) => updatedTask as SimpleChatTask).filter(
      updatedTask => updatedTask.id === 'task-2',
    ).some(updatedTask => updatedTask.messages.some(message => message.content.includes('Task A result')))).toBe(false);

    await act(async () => {
      taskBResponse.close();
    });
  });
});
