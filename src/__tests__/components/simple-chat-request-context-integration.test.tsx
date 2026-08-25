// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';

import ChatArea from '@/components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import type { User } from '@/lib/user-types';

const INVALID_IMAGE = 'data:image/png;base64,not-valid';
const VALID_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr1sAAAAASUVORK5CYII=';

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

function mockStartupRequests(chatResponse = streamResponse()): void {
  installLocalStorage();
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url === '/api/models?type=chat') {
      return Promise.resolve(jsonResponse({
        models: [{ id: 'chat-model', name: 'Chat model', providerId: 'provider-1' }],
        providers: [{ id: 'provider-1', name: 'Provider' }],
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

describe('simple-chat request context integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
});
