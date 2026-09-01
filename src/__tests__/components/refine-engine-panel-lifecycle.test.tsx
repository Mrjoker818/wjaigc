// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useProgressTimer', () => ({
  useProgressTimer: () => ({
    elapsed: 0,
    totalTime: null,
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    resetTimer: vi.fn(),
    formatTime: (value: number) => `${value}ms`,
  }),
}));

import RefineEnginePanel from '@/components/refine-engine-panel';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const modelCatalog = {
  success: true,
  providers: [{ id: 'apimart-test', displayName: 'APImart Test' }],
  models: [{ id: 'gpt-image-2', name: 'Gpt Image 2', providerId: 'apimart-test' }],
};

describe('RefineEnginePanel lifecycle', () => {
  const cancelBodies: Array<Record<string, unknown>> = [];
  const pollBodies: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    cancelBodies.length = 0;
    pollBodies.length = 0;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 2048 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 935 });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function parseBody(init?: RequestInit): Record<string, unknown> {
    return JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  }

  async function renderReadyPanel(): Promise<void> {
    render(
      <RefineEnginePanel
        initialImageUrl="/api/serve-upload/uploads/refine-source.png"
        onClose={vi.fn()}
        onAddImage={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '开始精修' }) as HTMLButtonElement).disabled).toBe(false);
    });
  }

  it('queues cancellation until the submit response provides the task id', async () => {
    const submit = deferred<Response>();
    const cancel = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/refine-engine' && !init?.method) {
        return Response.json({ success: true, categories: [], lightings: [], viewAngles: [] });
      }
      if (url === '/api/refine-engine' && parseBody(init).action === 'models') {
        return Response.json(modelCatalog);
      }
      if (url === '/api/refine-engine' && parseBody(init).action === 'refine') {
        return submit.promise;
      }
      if (url === '/api/cancel-task') {
        cancelBodies.push(parseBody(init));
        return cancel.promise;
      }
      if (url === '/api/poll-task') {
        pollBodies.push(parseBody(init));
        return Response.json({ success: true, status: 'processing', progress: 10 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await renderReadyPanel();
    fireEvent.click(screen.getByRole('button', { name: '开始精修' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(cancelBodies).toEqual([]);
    expect(screen.queryByText('任务已取消')).toBeNull();

    await act(async () => {
      submit.resolve(Response.json({ success: true, taskId: 'task-race' }));
      await submit.promise;
    });

    await waitFor(() => expect(cancelBodies).toEqual([{ taskId: 'task-race' }]));
    expect(pollBodies).toEqual([]);
    expect(screen.getByText('正在确认任务并取消...')).toBeTruthy();
    expect(screen.queryByText('任务已取消')).toBeNull();

    await act(async () => {
      cancel.resolve(Response.json({ success: true, status: 'cancelled', taskId: 'task-race' }));
      await cancel.promise;
    });

    await waitFor(() => expect(screen.getByText('任务已取消')).toBeTruthy());
  });

  it('shows a cancellation rejection and continues to the real completed state', async () => {
    const submit = deferred<Response>();
    const poll = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/refine-engine' && !init?.method) {
        return Response.json({ success: true, categories: [], lightings: [], viewAngles: [] });
      }
      if (url === '/api/refine-engine' && parseBody(init).action === 'models') return Response.json(modelCatalog);
      if (url === '/api/refine-engine' && parseBody(init).action === 'refine') return submit.promise;
      if (url === '/api/cancel-task') {
        cancelBodies.push(parseBody(init));
        return Response.json({ success: false, error: '任务已完成，无法取消' }, { status: 409 });
      }
      if (url === '/api/poll-task') {
        pollBodies.push(parseBody(init));
        return poll.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await renderReadyPanel();
    fireEvent.click(screen.getByRole('button', { name: '开始精修' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    await act(async () => {
      submit.resolve(Response.json({ success: true, taskId: 'task-cancel-rejected' }));
      await submit.promise;
    });

    await waitFor(() => expect(pollBodies).toEqual([{ taskId: 'task-cancel-rejected', model: 'gpt-image-2', providerId: 'apimart-test' }]));
    expect(cancelBodies).toEqual([{ taskId: 'task-cancel-rejected' }]);
    expect(screen.getByText('取消失败：任务已完成，无法取消，正在确认任务状态')).toBeTruthy();

    await act(async () => {
      poll.resolve(Response.json({ success: true, status: 'completed', imageUrl: '/refined.png' }));
      await poll.promise;
    });

    await waitFor(() => expect(screen.getByAltText('标准精修').getAttribute('src')).toBe('/refined.png'));
  });

  it('ignores a completed poll response that arrives after confirmed cancellation', async () => {
    const poll = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/refine-engine' && !init?.method) {
        return Response.json({ success: true, categories: [], lightings: [], viewAngles: [] });
      }
      if (url === '/api/refine-engine' && parseBody(init).action === 'models') return Response.json(modelCatalog);
      if (url === '/api/refine-engine' && parseBody(init).action === 'refine') {
        return Response.json({ success: true, taskId: 'task-late-result' });
      }
      if (url === '/api/poll-task') {
        pollBodies.push(parseBody(init));
        return poll.promise;
      }
      if (url === '/api/cancel-task') {
        cancelBodies.push(parseBody(init));
        return Response.json({ success: true, status: 'cancelled', taskId: 'task-late-result' });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await renderReadyPanel();
    fireEvent.click(screen.getByRole('button', { name: '开始精修' }));
    await waitFor(() => expect(pollBodies).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.getByText('任务已取消')).toBeTruthy());

    await act(async () => {
      poll.resolve(Response.json({ success: true, status: 'completed', imageUrl: '/late.png' }));
      await poll.promise;
    });

    expect(cancelBodies).toEqual([{ taskId: 'task-late-result' }]);
    expect(screen.queryByAltText('标准精修')).toBeNull();
    expect(screen.getByText('任务已取消')).toBeTruthy();
  });

  it('shows a nested platform error instead of an empty result state', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/refine-engine' && !init?.method) {
        return Response.json({ success: true, categories: [], lightings: [], viewAngles: [] });
      }
      if (url === '/api/refine-engine' && parseBody(init).action === 'models') return Response.json(modelCatalog);
      if (url === '/api/refine-engine' && parseBody(init).action === 'refine') {
        return Response.json({ BaseResp: { StatusMessage: 'no sandbox ID found for taskID' } }, { status: 500 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await renderReadyPanel();
    fireEvent.click(screen.getByRole('button', { name: '开始精修' }));

    await waitFor(() => expect(screen.getByText('no sandbox ID found for taskID')).toBeTruthy());
    expect(screen.getByRole('button', { name: '返回精修设置' })).toBeTruthy();
    expect(screen.queryByText('暂无精修结果')).toBeNull();
  });

  it('keeps the measured panel inside the viewport and re-clamps after resize', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: HTMLElement) {
      if (this.hasAttribute('data-floating-panel')) {
        return {
          x: 794,
          y: 177.5,
          left: 794,
          top: 177.5,
          right: 1254,
          bottom: 972.5,
          width: 460,
          height: 795,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      };
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/refine-engine' && !init?.method) {
        return Response.json({ success: true, categories: [], lightings: [], viewAngles: [] });
      }
      if (url === '/api/refine-engine' && parseBody(init).action === 'models') return Response.json(modelCatalog);
      throw new Error(`Unexpected request: ${url}`);
    }));

    await renderReadyPanel();
    const panel = document.querySelector<HTMLElement>('[data-floating-panel]');
    expect(panel).not.toBeNull();
    await waitFor(() => expect(panel?.style.top).toBe('70px'));
    expect(panel?.style.left).toBe('794px');
    expect(panel?.style.width).toBe('460px');
    expect(panel?.style.maxHeight).toBe('903px');

    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 568 });
    fireEvent(window, new Event('resize'));

    await waitFor(() => expect(panel?.style.left).toBe('16px'));
    expect(panel?.style.top).toBe('16px');
    expect(panel?.style.width).toBe('288px');
    expect(panel?.style.maxHeight).toBe('536px');
  });

  it('clears the simulated progress interval after submit transport failure', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/refine-engine' && !init?.method) {
        return Response.json({ success: true, categories: [], lightings: [], viewAngles: [] });
      }
      if (url === '/api/refine-engine' && parseBody(init).action === 'models') return Response.json(modelCatalog);
      if (url === '/api/refine-engine' && parseBody(init).action === 'refine') throw new TypeError('Network interrupted');
      throw new Error(`Unexpected request: ${url}`);
    }));

    await renderReadyPanel();
    fireEvent.click(screen.getByRole('button', { name: '开始精修' }));
    await waitFor(() => expect(screen.getByText('Network interrupted')).toBeTruthy());

    const activeIntervals = intervals.mock.results
      .map((result) => result.value)
      .filter((id) => !cleared.mock.calls.some(([clearedId]) => clearedId === id));
    expect(activeIntervals).toEqual([]);
  });

  it('renders non-numeric aspect-ratio options without invalid CSS dimensions', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/refine-engine' && !init?.method) {
        return Response.json({ success: true, categories: [], lightings: [], viewAngles: [] });
      }
      if (url === '/api/refine-engine' && parseBody(init).action === 'models') {
        return Response.json(modelCatalog);
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await renderReadyPanel();

    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('NaN');
  });
});
