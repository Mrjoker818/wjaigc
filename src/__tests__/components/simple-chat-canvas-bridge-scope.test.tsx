// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatArea from '@/components/simple-chat/chat-area';
import type { SimpleChatProject, SimpleChatTask } from '@/components/simple-chat/simple-chat-types';
import type { User } from '@/lib/user-types';
import { canvasBridgeStorageKey, readCanvasBridgeJournal } from '@/lib/simple-chat-canvas-bridge';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(complete => { resolve = complete; }), resolve: value => resolve(value) };
}
function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const user: User = { id: 'actor-a', name: 'A', createdAt: 1, updatedAt: 1 };
const task: SimpleChatTask = {
  id: 'task-a', projectId: 'chat-a', name: 'Task', model: 'model-a', providerId: 'provider-a',
  createdAt: 1, updatedAt: 1, messages: [{ id: 'message-a', role: 'assistant', content: 'Two images',
    model: 'model-a', providerId: 'provider-a', createdAt: 1,
    images: ['/a.png', '/b.png'], imageRefs: [
      { url: '/a.png', assetVersionId: 'version-a', placementId: 'chat-placement-a' },
      { url: '/b.png', assetVersionId: 'version-b', placementId: 'chat-placement-b' },
    ] }],
};
const project: SimpleChatProject = {
  id: 'chat-a', name: 'Chat', createdAt: 1, updatedAt: 1, tasks: [task], agents: [], knowledgeItems: [],
};
const scope = { actorId: 'actor-a', projectId: 'canvas-a' };
function view(actor: User = user, persist: (value: SimpleChatTask) => Promise<void> = async () => {},
  context: { project: SimpleChatProject; task: SimpleChatTask } = { project, task }): React.JSX.Element {
  return <ChatArea user={actor} project={context.project} task={context.task} onUpdateTask={() => {}}
    onPersistTask={persist} onUpdateProject={() => {}} onCreateTask={() => {}} onSelectTask={() => {}}
    onUpdateAgent={() => {}} onDeleteAgent={() => {}} onSkillToAgent={() => {}} onLogout={() => {}}
    onBackToWorkspace={() => {}} sidebarOpen onToggleSidebar={() => {}} />;
}
async function send(): Promise<void> {
  await waitFor(() => expect((screen.getByRole('combobox', { name: '目标画布项目' }) as HTMLSelectElement).value).toBe('canvas-a'));
  fireEvent.click(screen.getByTitle('添加到画布'));
}
function transferred(index: number): Response {
  return response({ transfers: [{ url: `/canonical-${index}.png`,
    assetVersionId: index === 0 ? 'version-a' : 'version-b', placementId: `canvas-placement-${index}` }] });
}

describe('real ChatArea durable Canvas delivery', () => {
  let transfers: number[];
  let transfer: (index: number) => Promise<Response>;
  let navigate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    transfers = [];
    transfer = async index => transferred(index);
    navigate = vi.fn();
    const browserWindow = window;
    // jsdom cannot navigate. Replace only that external boundary, preserving
    // the real DOM and ChatArea click handler (which uses location.assign).
    vi.stubGlobal('window', new Proxy(browserWindow, { get: (target, key) => key === 'location'
      ? { ...browserWindow.location, assign: navigate } : Reflect.get(target, key, target) }));
    const values = new Map<string, string>();
    const storage: Storage = { get length(): number { return values.size; },
      key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); },
      clear: () => { values.clear(); } };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('crypto', webcrypto);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async <T,>(name: string, callback: (lock: Lock) => T | Promise<T>): Promise<T> => callback({ name, mode: 'exclusive' }),
    } });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === '/api/assets/batch-transfer') {
        const payload = JSON.parse(String(init?.body)) as { transfers: Array<{ metadata: { imageIndex: number } }> };
        const index = payload.transfers[0].metadata.imageIndex;
        transfers.push(index);
        return transfer(index);
      }
      if (url === '/api/user-data/sync?key=projects') return response({ success: true, value: [{ id: 'canvas-a', name: 'Canvas A' }, { id: 'canvas-b', name: 'Canvas B' }] });
      if (url.startsWith('/api/models')) return response({ models: [], providers: [] });
      if (url === '/api/simple-chat/memory') return response({ memories: [] });
      return response({});
    });
  });
  afterEach(() => {
    cleanup();
    document.querySelectorAll('[data-canvas-bridge-notice], .fixed.bottom-20.right-6').forEach(node => node.remove());
    Reflect.deleteProperty(navigator, 'locks');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('persists each successful transfer even when the second fails', async () => {
    transfer = async index => index === 1 ? response({}, 403) : transferred(index);
    render(view());
    await send();
    await screen.findByTitle('图片无法发送到所选画布');
    expect(transfers).toEqual([0, 1]);
    expect(readCanvasBridgeJournal(localStorage, scope)?.items.map(item => [item.assetVersionId, item.placementId, item.state]))
      .toEqual([['version-a', 'canvas-placement-0', 'pending']]);
    expect(localStorage.getItem('wujie_canvas_bridge')).toBeNull();
  });
  it('reports waiting for Canvas reception rather than claiming images are already added', async () => {
    render(view());
    await send();
    await screen.findByText(/已发送.*等待画布接收/u);
    expect(screen.queryByText(/已添加.*张图片/u)).toBeNull();
    expect(readCanvasBridgeJournal(localStorage, scope)?.items.map(item => item.state)).toEqual(['pending', 'pending']);
    const raw = localStorage.getItem(canvasBridgeStorageKey(scope))!;
    expect(raw).not.toMatch(/https?:|data:|blob:|prompt|name|url|sourceTrace/u);
    expect(localStorage.getItem('wujie_canvas_bridge')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/已发送.*等待画布接收/u));
    expect(navigate.mock.calls).toEqual([['/?projectId=canvas-a']]);
  });
  it('does not transfer after the actor changes during task persistence', async () => {
    const pending = deferred<void>();
    const persist = vi.fn(() => pending.promise);
    const ui = render(view(user, persist));
    await send();
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    ui.rerender(view({ ...user, id: 'actor-b' }, persist));
    await act(async () => { pending.resolve(); });
    expect(transfers).toEqual([]);
    expect(localStorage.getItem(canvasBridgeStorageKey(scope))).toBeNull();
    expect(localStorage.getItem('wujie_canvas_bridge')).toBeNull();
    expect(screen.queryByText(/已添加|已发送.*等待画布接收/u)).toBeNull();
  });
  it.each(['actor', 'target', 'roundtrip', 'project', 'task', 'project-roundtrip', 'task-roundtrip', 'unmount'] as const)('does not deliver a late response after %s scope changes', async change => {
    const pending = deferred<Response>();
    transfer = () => pending.promise;
    const currentView = (actor: User = user, context: { project: SimpleChatProject; task: SimpleChatTask } = { project, task }): React.JSX.Element => view(actor, undefined, context);
    const ui = render(currentView());
    await send();
    await waitFor(() => expect(transfers).toEqual([0]));
    if (change === 'target') fireEvent.change(screen.getByRole('combobox', { name: '目标画布项目' }), { target: { value: 'canvas-b' } });
    else if (change === 'unmount') ui.unmount();
    else if (change === 'project' || change === 'project-roundtrip') {
      ui.rerender(currentView(user, { project: { ...project, id: 'chat-b' }, task }));
      if (change === 'project-roundtrip') ui.rerender(currentView());
    } else if (change === 'task' || change === 'task-roundtrip') {
      ui.rerender(currentView(user, { project, task: { ...task, id: 'task-b' } }));
      if (change === 'task-roundtrip') ui.rerender(currentView());
    } else {
      ui.rerender(currentView({ ...user, id: 'actor-b' }));
      if (change === 'roundtrip') ui.rerender(currentView());
    }
    await act(async () => { pending.resolve(transferred(0)); });
    expect(transfers).toEqual([0]);
    expect(localStorage.getItem(canvasBridgeStorageKey(scope))).toBeNull();
    expect(localStorage.getItem('wujie_canvas_bridge')).toBeNull();
    expect(screen.queryByText(/已添加|已发送.*等待画布接收/u)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
