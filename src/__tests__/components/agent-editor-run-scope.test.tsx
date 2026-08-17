import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('AgentEditor selected-image run scope', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.dirty = false;
    hooks.slots = [];
    hooks.pendingEffects = [];
    observedRunIds.mockReset();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ models: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))));
  });

  afterEach(() => {
    hooks.slots.forEach(slot => slot.cleanup?.());
    vi.unstubAllGlobals();
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
});
