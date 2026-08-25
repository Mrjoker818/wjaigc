// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';

import ChatArea from '@/components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import type { User } from '@/lib/user-types';

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

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

const initialTask: SimpleChatTask = {
  id: 'task-1',
  projectId: 'project-1',
  name: 'Workflow return',
  messages: [],
  model: 'initial-model',
  providerId: 'initial-provider',
  createdAt: 1,
  updatedAt: 1,
};

const user: User = {
  id: 'user-1',
  name: 'Test user',
  createdAt: 1,
  updatedAt: 1,
};

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

function ChatAreaHarness({ onPersistTask }: { onPersistTask: (task: SimpleChatTask) => Promise<void> }) {
  const [task, setTask] = useState(initialTask);
  const project = useMemo(() => createProject(task), [task]);

  return (
    <ChatArea
      user={user}
      project={project}
      task={task}
      onUpdateTask={setTask}
      onPersistTask={onPersistTask}
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

describe('simple-chat workflow return persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('merges a delayed workflow return into the latest selected task state', async () => {
    const transfer = createDeferred<Response>();
    const onPersistTask = vi.fn(async () => {});
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/assets/transfer') return transfer.promise;
      if (url === '/api/models?type=chat') {
        return Promise.resolve(jsonResponse({
          models: [{ id: 'new-model', name: 'New model', providerId: 'new-provider' }],
          providers: [{ id: 'new-provider', name: 'New provider' }],
        }));
      }
      if (url === '/api/models?type=image') return Promise.resolve(jsonResponse({ models: [], providers: [] }));
      if (url === '/api/user-data/sync?key=projects') return Promise.resolve(jsonResponse({ success: false }));
      if (url === '/api/simple-chat/memory') return Promise.resolve(jsonResponse({ memories: [] }));
      return Promise.resolve(jsonResponse({}));
    }));
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    window.history.replaceState(null, '', '/simple-chat?assetProjectId=asset-project&workflowVersionId=source-version&workflowId=workflow-1&workflowExecutionId=execution-1&workflowOutputNodeId=output-1&workflowOutputLabel=Returned%20image');

    const { container } = render(<ChatAreaHarness onPersistTask={onPersistTask} />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/assets/transfer', expect.any(Object)));
    const header = container.querySelector('header.relative.z-50');
    expect(header?.querySelectorAll('[role="listbox"]')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /initial-model/u }));
    fireEvent.click(await screen.findByRole('option', { name: /New model/u }));

    await waitFor(() => expect(screen.getByRole('button', { name: /New model/u })).toBeTruthy());

    await act(async () => {
      transfer.resolve(jsonResponse({
        url: '/returned.png',
        assetId: 'asset-returned',
        assetVersionId: 'version-returned',
        placementId: 'placement-returned',
        entityId: 'workflow-return:execution-1:output-1',
      }));
    });

    await waitFor(() => expect(onPersistTask).toHaveBeenCalledTimes(1));
    expect(onPersistTask).toHaveBeenCalledWith(expect.objectContaining({
      model: 'new-model',
      providerId: 'new-provider',
      messages: [expect.objectContaining({ id: 'workflow-return:placement-returned' })],
    }));
  });
});
