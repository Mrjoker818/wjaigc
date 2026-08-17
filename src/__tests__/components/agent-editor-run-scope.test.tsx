import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as Array<{ value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }>,
  pendingEffects: [] as Array<() => void>,
}));
const observedRunIds = vi.hoisted(() => vi.fn());
const progressTimer = vi.hoisted(() => ({
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  resetTimer: vi.fn(),
  formatTime: vi.fn(() => '0s'),
}));
let isRendering = false;
let lastTree: unknown;

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState(initial: unknown) {
      const index = hooks.cursor++;
      if (!hooks.slots[index]) {
        hooks.slots[index] = {
          value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        };
      }
      const setValue = (next: unknown) => {
        const previous = hooks.slots[index].value;
        const value = typeof next === 'function'
          ? (next as (current: unknown) => unknown)(previous)
          : next;
        hooks.slots[index].value = value;
        if (!Object.is(previous, value)) hooks.dirty = true;
      };
      return [hooks.slots[index].value, setValue];
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++;
      if (!hooks.slots[index]) hooks.slots[index] = { value: { current: initial } };
      return hooks.slots[index].value;
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index]?.deps;
      const changed = !previous
        || deps.length !== previous.length
        || deps.some((value, dependencyIndex) => !Object.is(value, previous[dependencyIndex]));
      if (changed) hooks.slots[index] = { value: callback, deps: [...deps] };
      return hooks.slots[index].value;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const index = hooks.cursor++;
      const previousSlot = hooks.slots[index];
      const previous = previousSlot?.deps;
      const changed = !deps
        || !previous
        || deps.length !== previous.length
        || deps.some((value, dependencyIndex) => !Object.is(value, previous[dependencyIndex]));
      if (!changed) return;
      previousSlot?.cleanup?.();
      hooks.slots[index] = { deps: deps ? [...deps] : undefined };
      hooks.pendingEffects.push(() => {
        const cleanup = effect();
        if (typeof cleanup === 'function') hooks.slots[index].cleanup = cleanup;
      });
    },
  };
});
vi.mock('@/hooks/useProgressTimer', () => ({
  useProgressTimer: () => ({
    elapsed: 0,
    totalTime: null,
    ...progressTimer,
  }),
}));
vi.mock('@/lib/prompt-templates', () => ({
  getPromptTemplates: () => [],
  searchTemplates: () => [],
}));
vi.mock('@/components/agent-runtime/use-agent-run-events', () => ({
  useAgentRunEvents: (runId: string | null) => {
    observedRunIds(runId);
    return { projection: undefined, stale: false, cancel: vi.fn() };
  },
}));
vi.mock('@/components/agent-runtime/AgentProgressTimeline', () => ({
  AgentProgressTimeline: () => null,
}));

import { AgentEditor } from '@/components/agent-editor';

interface StorageHarness extends Storage {
  writes: Array<[string, string]>;
}

function storageHarness(entries: Array<[string, string]>): StorageHarness {
  const values = new Map(entries);
  const writes: Array<[string, string]> = [];
  return {
    writes,
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) {
      if (isRendering) throw new Error('localStorage must not be read during render');
      return values.get(key) ?? null;
    },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
}

function failingStorage(entries: Array<[string, string]> = []): StorageHarness {
  const storage = storageHarness(entries);
  storage.setItem = () => { throw new DOMException('quota exceeded', 'QuotaExceededError'); };
  return storage;
}

function storedAttemptKey(storage: Storage, scope: string): string | null {
  const storedAttempt = storage.getItem(`wujie_agent_attempt:${scope}`);
  if (!storedAttempt) return null;
  return (JSON.parse(storedAttempt) as { key?: string }).key || null;
}

function renderEditor(selectedEntityId: string): void {
  for (let renderCount = 0; renderCount < 10; renderCount++) {
    hooks.cursor = 0;
    hooks.dirty = false;
    hooks.pendingEffects = [];
    isRendering = true;
    try {
      lastTree = AgentEditor({
        projectId: 'project-1',
        selectedEntityId,
        imageUrl: `/images/${selectedEntityId}.png`,
        imageWidth: 100,
        imageHeight: 100,
        onClose: vi.fn(),
        onApply: vi.fn(),
      });
    } finally {
      isRendering = false;
    }
    const effects = hooks.pendingEffects.splice(0);
    effects.forEach(effect => effect());
    if (!hooks.dirty) return;
  }
  throw new Error('AgentEditor hook harness did not settle');
}

function resetRenderHarness(): void {
  hooks.slots.forEach(slot => slot.cleanup?.());
  hooks.cursor = 0;
  hooks.dirty = false;
  hooks.slots = [];
  hooks.pendingEffects = [];
}

function elementText(node: unknown, visited = new Set<object>()): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(child => elementText(child, visited)).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  if (visited.has(node)) return '';
  visited.add(node);
  const props = (node as { props?: { children?: unknown } }).props;
  return elementText(props?.children, visited);
}

function elementHasText(node: unknown, text: string): boolean {
  return elementText(node).includes(text);
}

function elementHasProp(node: unknown, prop: string, value: unknown, visited = new Set<object>()): boolean {
  if (Array.isArray(node)) return node.some(child => elementHasProp(child, prop, value, visited));
  if (!node || typeof node !== 'object' || !('props' in node)) return false;
  if (visited.has(node)) return false;
  visited.add(node);
  const props = (node as { props: Record<string, unknown> }).props;
  return props[prop] === value || elementHasProp(props.children, prop, value, visited);
}

function findButton(
  text: string,
  node: unknown = lastTree,
  visited = new Set<object>(),
): { props: { onClick?: (event: { stopPropagation(): void }) => unknown } } {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return findButton(text, child, visited);
      } catch { /* continue */ }
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    if (visited.has(node)) throw new Error(`Button not found: ${text}`);
    visited.add(node);
    const element = node as { type?: unknown; props: { children?: unknown; onClick?: (event: { stopPropagation(): void }) => unknown } };
    if (element.type === 'button' && elementHasText(element.props.children, text)) return element;
    try {
      return findButton(text, element.props.children, visited);
    } catch { /* continue */ }
  }
  throw new Error(`Button not found: ${text}`);
}

function findTextarea(
  node: unknown = lastTree,
  visited = new Set<object>(),
): { props: { onChange?: (event: { target: { value: string } }) => void } } {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return findTextarea(child, visited);
      } catch { /* continue */ }
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    if (visited.has(node)) throw new Error('Textarea not found');
    visited.add(node);
    const element = node as { type?: unknown; props: { children?: unknown; onChange?: (event: { target: { value: string } }) => void } };
    if (element.type === 'textarea') return element;
    try {
      return findTextarea(element.props.children, visited);
    } catch { /* continue */ }
  }
  throw new Error('Textarea not found');
}

describe('AgentEditor selected-image run scope', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.dirty = false;
    hooks.slots = [];
    hooks.pendingEffects = [];
    observedRunIds.mockReset();
    vi.stubGlobal('crypto', {
      randomUUID: () => webcrypto.randomUUID(),
      subtle: {
        digest: async (_algorithm: string, data: ArrayBuffer) => {
          const seed = new Uint8Array(data).reduce((sum, byte) => (sum + byte) % 256, 0);
          return new Uint8Array(32).fill(seed).buffer;
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ models: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))));
  });

  afterEach(() => {
    hooks.slots.forEach(slot => slot.cleanup?.());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('exposes no previous run and never persists it when switching to an empty image scope', () => {
    const storage = storageHarness([
      ['wujie_agent_run:project-1:image-a', 'run-a'],
    ]);
    vi.stubGlobal('localStorage', storage);
    renderEditor('image-a');
    expect(observedRunIds).toHaveBeenLastCalledWith('run-a');

    observedRunIds.mockClear();
    storage.writes.length = 0;
    renderEditor('image-b');

    expect(observedRunIds).toHaveBeenLastCalledWith(null);
    expect(storage.getItem('wujie_agent_run:project-1:image-b')).toBeNull();
    expect(storage.writes).not.toContainEqual(['wujie_agent_run:project-1:image-b', 'run-a']);
  });

  it('recovers only the destination image run without exposing or persisting the previous run', () => {
    const storage = storageHarness([
      ['wujie_agent_run:project-1:image-a', 'run-a'],
      ['wujie_agent_run:project-1:image-b', 'run-b'],
    ]);
    vi.stubGlobal('localStorage', storage);
    renderEditor('image-a');

    observedRunIds.mockClear();
    storage.writes.length = 0;
    renderEditor('image-b');

    expect(observedRunIds).toHaveBeenCalled();
    expect(observedRunIds.mock.calls.map(([runId]) => runId)).not.toContain('run-a');
    expect(observedRunIds).toHaveBeenLastCalledWith('run-b');
    expect(storage.getItem('wujie_agent_run:project-1:image-b')).toBe('run-b');
    expect(storage.writes).not.toContainEqual(['wujie_agent_run:project-1:image-b', 'run-a']);
  });

  it('detaches an active image A task so its polling, progress, cancellation, and result cannot leak into image B', async () => {
    const storage = storageHarness([]);
    vi.stubGlobal('localStorage', storage);
    const pollResolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/models?type=chat') {
        return Promise.resolve(new Response(JSON.stringify({ models: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (url === '/api/agent-edit' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ taskId: 'task-a' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (url.includes('/api/agent-edit?taskId=task-a')) {
        return new Promise<Response>(resolve => { pollResolvers.push(resolve); });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-edit', expect.objectContaining({ method: 'POST' }));
    renderEditor('image-a');
    expect(() => findButton('取消')).not.toThrow();
    expect(elementHasText(lastTree, '10%')).toBe(true);
    expect(pollResolvers).toHaveLength(1);

    renderEditor('image-b');
    expect(elementHasText(lastTree, '取消')).toBe(false);
    expect(elementHasText(lastTree, '10%')).toBe(false);
    expect(elementHasText(lastTree, '任务已提交，等待处理...')).toBe(false);

    pollResolvers[0]?.(new Response(JSON.stringify({
      status: 'completed', progress: 100, label: '完成',
      result: { imageUrl: '/results/image-a.png', prompt: 'A result' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await Promise.resolve();
    await Promise.resolve();
    renderEditor('image-b');

    expect(elementHasText(lastTree, '取消')).toBe(false);
    expect(elementHasText(lastTree, '完成')).toBe(false);
    expect(elementHasProp(lastTree, 'src', '/results/image-a.png')).toBe(false);
    expect(fetchMock.mock.calls.map(([input]) => String(input)))
      .not.toContain('/api/agent-edit?taskId=task-a&action=cancel');

    renderEditor('image-a');
    expect(() => findButton('取消')).not.toThrow();
    expect(elementHasText(lastTree, '10%')).toBe(true);
    expect(pollResolvers).toHaveLength(2);

    pollResolvers[1]?.(new Response(JSON.stringify({
      status: 'completed', progress: 100, label: '完成',
      result: { imageUrl: '/results/image-a.png', prompt: 'A result' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await new Promise(resolve => setTimeout(resolve, 0));
    renderEditor('image-a');

    expect(elementHasText(lastTree, '取消')).toBe(false);
    expect(elementHasProp(lastTree, 'src', '/results/image-a.png')).toBe(true);
  });

  it('uses one stable idempotency key for repeated submits of the same pending image attempt', async () => {
    vi.stubGlobal('localStorage', storageHarness([]));
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/models?type=chat') {
        return Promise.resolve(new Response(JSON.stringify({ models: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (String(input) === '/api/agent-edit' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ taskId: 'task-a' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    const execute = findButton('执行').props.onClick;
    execute?.({ stopPropagation: vi.fn() });
    execute?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));

    const submits = fetchMock.mock.calls.filter(([input, init]) =>
      String(input) === '/api/agent-edit' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(submits).toHaveLength(2);
    const keys = submits.map(([, init]) => new Headers((init as RequestInit).headers).get('idempotency-key'));
    expect(keys[0]).toMatch(/^agent-editor:project-1:image-a:/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('persists a delayed A acceptance only to A, then resumes its task and elapsed time after returning from B', async () => {
    const storage = storageHarness([]);
    vi.stubGlobal('localStorage', storage);
    const postResolvers: Array<(response: Response) => void> = [];
    const pollResolvers: Array<(response: Response) => void> = [];
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/models?type=chat') {
        return Promise.resolve(new Response(JSON.stringify({ models: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (url === '/api/agent-edit' && init?.method === 'POST') {
        return new Promise<Response>(resolve => { postResolvers.push(resolve); });
      }
      if (url === '/api/agent-edit?taskId=task-a') {
        return new Promise<Response>(resolve => { pollResolvers.push(resolve); });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(postResolvers).toHaveLength(1);

    renderEditor('image-b');
    postResolvers[0]?.(new Response(JSON.stringify({ taskId: 'task-a', runId: 'run-a' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    await new Promise(resolve => setTimeout(resolve, 0));
    now.mockReturnValue(5_000);
    renderEditor('image-b');

    expect(elementHasText(lastTree, '取消')).toBe(false);
    expect(elementHasText(lastTree, '4s')).toBe(false);
    expect(observedRunIds.mock.calls.map(([runId]) => runId)).not.toContain('run-a');
    expect(storage.getItem('wujie_agent_run:project-1:image-b')).toBeNull();
    expect(pollResolvers).toHaveLength(0);

    renderEditor('image-a');

    expect(() => findButton('取消')).not.toThrow();
    expect(elementHasText(lastTree, '4s')).toBe(true);
    expect(observedRunIds).toHaveBeenLastCalledWith('run-a');
    expect(storage.getItem('wujie_agent_run:project-1:image-a')).toBe('run-a');
    expect(pollResolvers).toHaveLength(1);
  });

  it('reuses a persisted pending key after a response-lost refresh retry', async () => {
    const storage = storageHarness([]);
    vi.stubGlobal('localStorage', storage);
    let submitCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/models?type=chat') {
        return Promise.resolve(new Response(JSON.stringify({ models: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (url === '/api/agent-edit' && init?.method === 'POST') {
        submitCount++;
        if (submitCount === 1) return Promise.reject(new TypeError('response lost after acceptance'));
        return Promise.resolve(new Response(JSON.stringify({ taskId: 'task-a', runId: 'run-a' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    const firstSubmit = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === '/api/agent-edit' && (init as RequestInit | undefined)?.method === 'POST',
    );
    const firstKey = new Headers((firstSubmit?.[1] as RequestInit).headers).get('idempotency-key');
    expect(storedAttemptKey(storage, 'project-1:image-a')).toBe(firstKey);

    resetRenderHarness();
    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    const submits = fetchMock.mock.calls.filter(([input, init]) =>
      String(input) === '/api/agent-edit' && (init as RequestInit | undefined)?.method === 'POST',
    );
    const retryKey = new Headers((submits[1]?.[1] as RequestInit).headers).get('idempotency-key');

    expect(retryKey).toBe(firstKey);
  });

  it('keeps a key after a client rejection until a durable terminal status confirms it', async () => {
    const storage = storageHarness([]);
    vi.stubGlobal('localStorage', storage);
    let submitCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/models?type=chat') {
        return Promise.resolve(new Response(JSON.stringify({ models: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (url === '/api/agent-edit' && init?.method === 'POST') {
        submitCount++;
        return Promise.resolve(new Response(submitCount === 1 ? null : JSON.stringify({ error: 'invalid request' }), {
          status: submitCount === 1 ? 422 : 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    const firstSubmit = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/agent-edit' && (init as RequestInit | undefined)?.method === 'POST'
    ));
    const firstKey = new Headers((firstSubmit?.[1] as RequestInit).headers).get('idempotency-key');
    expect(storedAttemptKey(storage, 'project-1:image-a')).toBe(firstKey);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    const retrySubmit = fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === '/api/agent-edit' && (init as RequestInit | undefined)?.method === 'POST'
    ))[1];
    const retryKey = new Headers((retrySubmit?.[1] as RequestInit).headers).get('idempotency-key');

    expect(retryKey).toBe(firstKey);
  });

  it('starts a new key when a retry changes an unconfirmed request payload', async () => {
    vi.stubGlobal('localStorage', storageHarness([]));
    let submitCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/models?type=chat') {
        return Promise.resolve(new Response(JSON.stringify({ models: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (url === '/api/agent-edit' && init?.method === 'POST') {
        submitCount++;
        if (submitCount === 1) return Promise.reject(new TypeError('response lost after acceptance'));
        return Promise.resolve(new Response(JSON.stringify({ taskId: 'task-a' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    renderEditor('image-a');
    const firstSubmit = fetchMock.mock.calls.find(([input, init]) => (
      String(input) === '/api/agent-edit' && (init as RequestInit | undefined)?.method === 'POST'
    ));
    const firstKey = new Headers((firstSubmit?.[1] as RequestInit).headers).get('idempotency-key');

    findTextarea().props.onChange?.({ target: { value: 'a different request' } });
    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    const retrySubmit = fetchMock.mock.calls.filter(([input, init]) => (
      String(input) === '/api/agent-edit' && (init as RequestInit | undefined)?.method === 'POST'
    ))[1];
    const retryKey = new Headers((retrySubmit?.[1] as RequestInit).headers).get('idempotency-key');

    expect(retryKey).not.toBe(firstKey);
  });

  it('keeps the pending key and active task after the client poll limit expires', async () => {
    vi.useFakeTimers();
    const storage = storageHarness([]);
    vi.stubGlobal('localStorage', storage);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/models?type=chat') return Promise.resolve(Response.json({ models: [] }));
      if (url === '/api/agent-edit' && init?.method === 'POST') return Promise.resolve(Response.json({ taskId: 'task-a' }));
      if (url === '/api/agent-edit?taskId=task-a') return Promise.resolve(Response.json({
        status: 'processing', progress: 10, label: '仍在处理',
      }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await vi.advanceTimersByTimeAsync(1);
    renderEditor('image-a');
    for (let index = 0; index < 310; index++) {
      await vi.advanceTimersByTimeAsync(2_000);
    }
    await vi.advanceTimersByTimeAsync(2_000);
    renderEditor('image-a');

    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/agent-edit?taskId=task-a')).toHaveLength(300);
    expect(storedAttemptKey(storage, 'project-1:image-a')).toMatch(/^agent-editor:/);
    expect(() => findButton('取消')).not.toThrow();
    expect(elementHasText(lastTree, '本地已停止等待，可稍后重试查询')).toBe(true);
  });

  it.each([
    ['transport failure', () => Promise.reject(new TypeError('network lost'))],
    ['not found', () => Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))],
    ['server failure', () => Promise.resolve(new Response(JSON.stringify({ error: 'retry later' }), { status: 500 }))],
  ])('keeps the pending key when cancellation has a %s', async (_name, cancelResponse) => {
    const storage = storageHarness([]);
    vi.stubGlobal('localStorage', storage);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/models?type=chat') return Promise.resolve(Response.json({ models: [] }));
      if (url === '/api/agent-edit' && init?.method === 'POST') return Promise.resolve(Response.json({ taskId: 'task-a' }));
      if (url === '/api/agent-edit?taskId=task-a&action=cancel') return cancelResponse();
      if (url === '/api/agent-edit?taskId=task-a') return Promise.resolve(Response.json({
        status: 'processing', progress: 10, label: '仍在处理',
      }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    renderEditor('image-a');
    findButton('取消').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    renderEditor('image-a');

    expect(storedAttemptKey(storage, 'project-1:image-a')).toMatch(/^agent-editor:/);
    expect(() => findButton('取消')).not.toThrow();
    expect(elementHasText(lastTree, '任务已取消')).toBe(false);
  });

  it('clears the key only for a structured terminal replay and shows its terminal state', async () => {
    const storage = storageHarness([]);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/models?type=chat') return Promise.resolve(Response.json({ models: [] }));
      if (String(input) === '/api/agent-edit' && init?.method === 'POST') {
        return Promise.resolve(Response.json({
          success: false, code: 'AGENT_TASK_TERMINAL', taskId: 'task-a', status: 'cancelled', replayed: true,
        }, { status: 409 }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }));

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    renderEditor('image-a');

    expect(storedAttemptKey(storage, 'project-1:image-a')).toBeNull();
    expect(elementHasText(lastTree, '任务已取消')).toBe(true);
  });

  it('keeps the key for an ordinary conflict response', async () => {
    const storage = storageHarness([]);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/models?type=chat') return Promise.resolve(Response.json({ models: [] }));
      if (String(input) === '/api/agent-edit' && init?.method === 'POST') {
        return Promise.resolve(Response.json({ error: 'request is already processing' }, { status: 409 }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }));

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    renderEditor('image-a');

    expect(storedAttemptKey(storage, 'project-1:image-a')).toMatch(/^agent-editor:/);
    expect(elementHasText(lastTree, 'request is already processing')).toBe(true);
  });

  it('fails closed before POST when protected pending-attempt storage is unavailable', async () => {
    vi.stubGlobal('localStorage', failingStorage());
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/models?type=chat') return Promise.resolve(Response.json({ models: [] }));
      if (String(input) === '/api/agent-edit' && init?.method === 'POST') return Promise.resolve(Response.json({ taskId: 'task-a' }));
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    renderEditor('image-a');

    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/agent-edit')).toHaveLength(0);
    expect(elementHasText(lastTree, '无法安全保存')).toBe(true);
  });

  it('fails closed before POST when browser storage is disabled', async () => {
    vi.stubGlobal('localStorage', undefined);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/models?type=chat') return Promise.resolve(Response.json({ models: [] }));
      if (String(input) === '/api/agent-edit' && init?.method === 'POST') return Promise.resolve(Response.json({ taskId: 'unexpected' }));
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    renderEditor('image-a');

    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/agent-edit')).toHaveLength(0);
    expect(elementHasText(lastTree, '无法安全保存')).toBe(true);
  });

  it('removes malformed, expired, and unbounded pending-attempt records without exposing request content', async () => {
    const expired = JSON.stringify({ version: 1, key: 'old-key', digest: 'a'.repeat(64), expiresAt: 1 });
    const unbounded = JSON.stringify({
      version: 1,
      key: 'agent-editor:project-1:image-c:future-key',
      digest: 'b'.repeat(64),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    const storage = storageHarness([
      ['wujie_agent_attempt:project-1:image-a', '{not json'],
      ['wujie_agent_attempt:project-1:image-b', expired],
      ['wujie_agent_attempt:project-1:image-c', unbounded],
    ]);
    vi.stubGlobal('localStorage', storage);

    renderEditor('image-a');
    expect(storage.getItem('wujie_agent_attempt:project-1:image-a')).toBeNull();
    renderEditor('image-b');
    expect(storage.getItem('wujie_agent_attempt:project-1:image-b')).toBeNull();
    renderEditor('image-c');
    expect(storage.getItem('wujie_agent_attempt:project-1:image-c')).toBeNull();

    renderEditor('image-a');
    findButton('执行').props.onClick?.({ stopPropagation: vi.fn() });
    await new Promise(resolve => setTimeout(resolve, 0));
    const persisted = storage.getItem('wujie_agent_attempt:project-1:image-a') || '';
    expect(persisted).toMatch(/"version":1/);
    expect(persisted).toMatch(/"digest":"[a-f0-9]{64}"/);
    expect(persisted).toMatch(/"expiresAt":\d+/);
    expect(persisted).not.toContain('/images/image-a.png');
    expect(persisted).not.toContain('a different request');
  });
});
