// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';

import ChatArea from '@/components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import type { User } from '@/lib/user-types';

const INVALID_IMAGE = 'data:image/png;base64,not-valid';

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
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
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
    if (url === '/api/simple-chat/chat') return Promise.resolve(chatResponse);
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
    vi.stubGlobal('FileReader', class {
      result = INVALID_IMAGE;
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
  });

  it('omits invalid historical images from the request while preserving persisted history', async () => {
    const historicalMessage = {
      id: 'history-user',
      role: 'user' as const,
      content: 'historical question',
      images: [INVALID_IMAGE],
      createdAt: 1,
    };
    const onUpdateTask = vi.fn();
    mockStartupRequests();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    render(<ChatAreaHarness initialTask={createTask([historicalMessage])} onUpdateTask={onUpdateTask} />);
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
    expect(payload.messages.find((message: { content: string }) => message.content === 'historical question').images).toBeUndefined();
    await waitFor(() => expect(document.body.textContent).toContain('已忽略 1 张失效历史图片，本次请求继续发送。'));

    await waitFor(() => expect(onUpdateTask).toHaveBeenCalled());
    const updatedTask = onUpdateTask.mock.calls.at(-1)![0] as SimpleChatTask;
    expect(updatedTask.messages.find(message => message.id === historicalMessage.id)?.images).toEqual([INVALID_IMAGE]);
  });
});
