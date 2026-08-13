import type { Page } from '@playwright/test';

export interface CanvasPerformanceRawSample {
  startedAt: number;
  endedAt: number;
  frameTimestamps: number[];
  inputDelaysMs: number[];
  longTasksMs: number[];
  saveTasksMs: number[];
  disappearedFrames: number;
  unclickableDurationMs: number;
}

export interface CanvasPerformanceSample {
  durationMs: number;
  averageFps: number;
  inputDelayP95Ms: number;
  longestTaskMs: number;
  longestSaveTaskMs: number;
  disappearedFrames: number;
  unclickableDurationMs: number;
}

interface CanvasPerformanceOptions {
  monitoredNodeIds?: string[];
}

type CanvasInteraction = (page: Page) => Promise<void>;

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export function summarizeCanvasPerformance(raw: CanvasPerformanceRawSample): CanvasPerformanceSample {
  const durationMs = Math.max(0, raw.endedAt - raw.startedAt);
  const frameIntervals = Math.max(0, raw.frameTimestamps.length - 1);
  return {
    durationMs,
    averageFps: durationMs > 0 ? Number(((frameIntervals * 1000) / durationMs).toFixed(2)) : 0,
    inputDelayP95Ms: Number(percentile95(raw.inputDelaysMs).toFixed(2)),
    longestTaskMs: Number(Math.max(0, ...raw.longTasksMs).toFixed(2)),
    longestSaveTaskMs: Number(Math.max(0, ...raw.saveTasksMs).toFixed(2)),
    disappearedFrames: raw.disappearedFrames,
    unclickableDurationMs: Number(raw.unclickableDurationMs.toFixed(2)),
  };
}

export async function assertCanvasNodeContinuity(page: Page, ids: string[]): Promise<void> {
  const failures = await page.evaluate(monitoredIds => {
    const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport]');
    const viewportRect = viewport?.getBoundingClientRect();
    const occupiedRight = Math.max(0, Number(viewport?.dataset.canvasOccupiedRight || 0));
    const interactiveRight = (viewportRect?.right ?? innerWidth) - occupiedRight - 2;

    return monitoredIds.flatMap(id => {
    const image = [...document.querySelectorAll<HTMLImageElement>('[data-canvas-viewport] img')]
      .find(candidate => candidate.alt === id);
    if (!image) return [`${id}:missing`];
    const card = image.closest<HTMLElement>('div.absolute.group');
    if (!card) return [`${id}:card-missing`];
    const style = getComputedStyle(card);
    const rect = card.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return [`${id}:hidden`];
    }
    if (!image.complete || image.naturalWidth === 0 || rect.width <= 0 || rect.height <= 0) {
      return [`${id}:not-rendered`];
    }
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (
      viewportRect
      && (centerX < viewportRect.left || centerX > interactiveRight || centerY < viewportRect.top || centerY > viewportRect.bottom)
    ) return [];
    const x = Math.min(window.innerWidth - 1, Math.max(0, centerX));
    const y = Math.min(window.innerHeight - 1, Math.max(0, centerY));
    const hit = document.elementFromPoint(x, y);
    if (hit instanceof Element && hit.closest('[data-toolbar], [data-floating-panel], [data-popup], [data-modal]')) return [];
    if (!hit || (!card.contains(hit) && hit !== card)) return [`${id}:not-hittable`];
    return [];
    });
  }, ids);
  if (failures.length > 0) throw new Error(`Canvas node continuity failed: ${failures.join(', ')}`);
}

async function startMeasurement(page: Page, monitoredNodeIds: string[]): Promise<void> {
  await page.evaluate(ids => {
    const windowWithState = window as typeof window & { __wujieStage3Performance?: Record<string, unknown> };
    if (windowWithState.__wujieStage3Performance) throw new Error('Stage 3 measurement is already active');
    const state = {
      startedAt: performance.now(),
      frameTimestamps: [] as number[],
      inputDelaysMs: [] as number[],
      longTasksMs: [] as number[],
      saveTasksMs: [] as number[],
      disappearedFrames: 0,
      unclickableDurationMs: 0,
      lastFrameAt: performance.now(),
      saveInFlight: 0,
      active: true,
      rafId: 0,
      observers: [] as PerformanceObserver[],
      originalFetch: window.fetch,
      inputHandler: null as ((event: Event) => void) | null,
    };

    const inputHandler = (event: Event) => {
      const timestamp = Number(event.timeStamp);
      if (Number.isFinite(timestamp)) state.inputDelaysMs.push(Math.max(0, performance.now() - timestamp));
    };
    state.inputHandler = inputHandler;
    const viewport = document.querySelector('[data-canvas-viewport]');
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) {
      viewport?.addEventListener(type, inputHandler, { capture: true, passive: true });
    }

    try {
      const longTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          state.longTasksMs.push(entry.duration);
          if (state.saveInFlight > 0) state.saveTasksMs.push(entry.duration);
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
      state.observers.push(longTaskObserver);
    } catch {}

    try {
      const eventObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const timing = entry as PerformanceEntry & { processingStart?: number };
          if (typeof timing.processingStart === 'number') {
            state.inputDelaysMs.push(Math.max(0, timing.processingStart - timing.startTime));
          }
        }
      });
      eventObserver.observe({ type: 'event', buffered: true, durationThreshold: 0 } as PerformanceObserverInit);
      state.observers.push(eventObserver);
    } catch {}

    window.fetch = async (...args) => {
      const request = args[0];
      const init = args[1];
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
      const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
      const isProjectSave = method === 'POST' && url.includes('/api/user-data/sync');
      if (isProjectSave) state.saveInFlight += 1;
      try {
        return await state.originalFetch(...args);
      } finally {
        if (isProjectSave) state.saveInFlight = Math.max(0, state.saveInFlight - 1);
      }
    };

    const sampleContinuity = (timestamp: number) => {
      const delta = Math.max(0, timestamp - state.lastFrameAt);
      state.lastFrameAt = timestamp;
      let disappeared = false;
      let unclickable = false;
      const viewportRect = viewport?.getBoundingClientRect();
      const workspacePanel = document.querySelector<HTMLElement>('[data-workspace-right-panel]');
      const workspacePanelRect = workspacePanel?.getBoundingClientRect();
      const occupiedRight = Math.max(
        0,
        Number(viewport instanceof HTMLElement ? viewport.dataset.canvasOccupiedRight || 0 : 0),
      );
      const interactiveRight = Math.min(
        (viewportRect?.right ?? innerWidth) - occupiedRight - 2,
        workspacePanelRect?.left ?? innerWidth,
      );
      for (const id of ids) {
        const image = [...document.querySelectorAll<HTMLImageElement>('[data-canvas-viewport] img')]
          .find(candidate => candidate.alt === id);
        const card = image?.closest<HTMLElement>('div.absolute.group') ?? null;
        if (!image || !card || !image.complete || image.naturalWidth === 0) {
          disappeared = true;
          continue;
        }
        const style = getComputedStyle(card);
        const rect = card.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) {
          disappeared = true;
          continue;
        }
        if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) continue;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (
          viewportRect
          && (centerX < viewportRect.left || centerX > interactiveRight || centerY < viewportRect.top || centerY > viewportRect.bottom)
        ) continue;
        const x = Math.min(innerWidth - 1, Math.max(0, centerX));
        const y = Math.min(innerHeight - 1, Math.max(0, centerY));
        const hit = document.elementFromPoint(x, y);
        if (
          hit
          && workspacePanel
          && (workspacePanel === hit || workspacePanel.contains(hit))
        ) continue;
        if (hit instanceof Element && hit.closest('[data-toolbar], [data-floating-panel], [data-popup], [data-modal]')) continue;
        if (!hit || (!card.contains(hit) && hit !== card)) unclickable = true;
      }
      if (disappeared) state.disappearedFrames += 1;
      if (unclickable) state.unclickableDurationMs += delta;
    };

    const tick = (timestamp: number) => {
      if (!state.active) return;
      state.frameTimestamps.push(timestamp);
      sampleContinuity(timestamp);
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
    windowWithState.__wujieStage3Performance = state as unknown as Record<string, unknown>;
  }, monitoredNodeIds);
}

async function stopMeasurement(page: Page): Promise<CanvasPerformanceRawSample> {
  return page.evaluate(() => {
    const windowWithState = window as typeof window & { __wujieStage3Performance?: Record<string, unknown> };
    const state = windowWithState.__wujieStage3Performance as unknown as {
      startedAt: number;
      frameTimestamps: number[];
      inputDelaysMs: number[];
      longTasksMs: number[];
      saveTasksMs: number[];
      disappearedFrames: number;
      unclickableDurationMs: number;
      active: boolean;
      rafId: number;
      observers: PerformanceObserver[];
      originalFetch: typeof window.fetch;
      inputHandler: ((event: Event) => void) | null;
    } | undefined;
    if (!state) throw new Error('Stage 3 measurement is not active');
    state.active = false;
    cancelAnimationFrame(state.rafId);
    state.observers.forEach(observer => observer.disconnect());
    window.fetch = state.originalFetch;
    const viewport = document.querySelector('[data-canvas-viewport]');
    if (state.inputHandler) {
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) {
        viewport?.removeEventListener(type, state.inputHandler, { capture: true });
      }
    }
    delete windowWithState.__wujieStage3Performance;
    return {
      startedAt: state.startedAt,
      endedAt: performance.now(),
      frameTimestamps: state.frameTimestamps,
      inputDelaysMs: state.inputDelaysMs,
      longTasksMs: state.longTasksMs,
      saveTasksMs: state.saveTasksMs,
      disappearedFrames: state.disappearedFrames,
      unclickableDurationMs: state.unclickableDurationMs,
    };
  });
}

export async function measureCanvasInteraction(
  page: Page,
  action: CanvasInteraction,
  options: CanvasPerformanceOptions = {},
): Promise<CanvasPerformanceSample> {
  await startMeasurement(page, options.monitoredNodeIds ?? []);
  let actionError: unknown;
  try {
    await action(page);
  } catch (error) {
    actionError = error;
  }
  const sample = summarizeCanvasPerformance(await stopMeasurement(page));
  if (actionError) throw actionError;
  return sample;
}

export async function nextAnimationFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => resolveFrame())));
}

export async function dragPointerAcrossFrames(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  frames = 60,
): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let index = 1; index <= frames; index += 1) {
    const progress = index / frames;
    await page.mouse.move(
      start.x + (end.x - start.x) * progress,
      start.y + (end.y - start.y) * progress,
    );
    await nextAnimationFrame(page);
  }
  await page.mouse.up();
  await nextAnimationFrame(page);
}
