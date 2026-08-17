import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as Array<{ value?: unknown; deps?: readonly unknown[] }>,
  pendingEffects: [] as Array<() => void>,
}));
const observedRunIds = vi.hoisted(() => vi.fn());
let isRendering = false;

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
    useCallback(callback: unknown) {
      hooks.cursor++;
      return callback;
    },
    useEffect(effect: () => void, deps?: readonly unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index]?.deps;
      const changed = !deps
        || !previous
        || deps.length !== previous.length
        || deps.some((value, dependencyIndex) => !Object.is(value, previous[dependencyIndex]));
      hooks.slots[index] = { deps: deps ? [...deps] : undefined };
      if (changed) hooks.pendingEffects.push(effect);
    },
  };
});
vi.mock('@/hooks/useProgressTimer', () => ({
  useProgressTimer: () => ({
    elapsed: 0,
    totalTime: null,
    formatTime: () => '0s',
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    resetTimer: vi.fn(),
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
      AgentEditor({
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

describe('AgentEditor selected-image run scope', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.dirty = false;
    hooks.slots = [];
    hooks.pendingEffects = [];
    observedRunIds.mockReset();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
  });

  afterEach(() => {
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
});
