import type { Page } from '@playwright/test';

export interface WorkflowInputDelaySample {
  source: 'pointer' | 'event-timing';
  name: string;
  delayMs: number;
  startTime: number;
  observedAt: number;
}

export interface WorkflowLongTaskSample {
  startTime: number;
  durationMs: number;
  name: string;
}

export interface WorkflowUnclickableSample {
  id: string;
  hitTag: string | null;
  hitClass: string | null;
}

export interface WorkflowPerformanceRawSample {
  startedAt: number;
  endedAt: number;
  frameTimestamps: number[];
  inputDelaysMs: number[];
  inputDelaySamples?: WorkflowInputDelaySample[];
  longTasksMs: number[];
  longTaskSamples?: WorkflowLongTaskSample[];
  monitoredNodeCount: number;
  lostNodeCount: number;
  unclickableDurationMs: number;
  unclickableSamples?: WorkflowUnclickableSample[];
}

export interface WorkflowPerformanceSample {
  durationMs: number;
  averageFps: number;
  inputDelayP95Ms: number;
  inputDelaySamples: WorkflowInputDelaySample[];
  longestTaskMs: number;
  longTaskSamples: WorkflowLongTaskSample[];
  monitoredNodeCount: number;
  lostNodeCount: number;
  unclickableDurationMs: number;
  unclickableSamples: WorkflowUnclickableSample[];
}

type WorkflowInteraction = (page: Page) => Promise<void>;

export function selectWorkflowMonitorIds(
  rawIds: ReadonlyArray<string | null | undefined>,
): string[] {
  return rawIds
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter(value => value.length > 0);
}

export function assertWorkflowMonitorCoverage(
  monitoredIds: ReadonlyArray<string>,
  expectedNodeIds: ReadonlyArray<string>,
): void {
  const monitoredSet = new Set(monitoredIds);
  if (monitoredSet.size !== monitoredIds.length) {
    throw new Error('BLOCKED: Stage 4 workflow performance gate found duplicate monitored node IDs');
  }
  const expectedSet = new Set(expectedNodeIds);
  if (expectedSet.size !== expectedNodeIds.length) {
    throw new Error('BLOCKED: Stage 4 workflow fixture contains duplicate expected node IDs');
  }
  const missingIds = expectedNodeIds.filter(id => !monitoredSet.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `BLOCKED: Stage 4 workflow performance gate is missing expected node IDs (${missingIds.length})`,
    );
  }
  const unexpectedIds = monitoredIds.filter(id => !expectedSet.has(id));
  if (unexpectedIds.length > 0) {
    throw new Error(`BLOCKED: Stage 4 workflow performance gate found unexpected node IDs (${unexpectedIds.length})`);
  }
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export function summarizeWorkflowPerformance(
  raw: WorkflowPerformanceRawSample,
): WorkflowPerformanceSample {
  const durationMs = Math.max(0, raw.endedAt - raw.startedAt);
  const frameIntervals = Math.max(0, raw.frameTimestamps.length - 1);
  const frameSpanMs = frameIntervals > 0
    ? Math.max(0, raw.frameTimestamps.at(-1)! - raw.frameTimestamps[0]!)
    : 0;

  return {
    durationMs,
    averageFps: frameSpanMs > 0 ? Number(((frameIntervals * 1000) / frameSpanMs).toFixed(2)) : 0,
    inputDelayP95Ms: Number(percentile95(raw.inputDelaysMs).toFixed(2)),
    inputDelaySamples: raw.inputDelaySamples ?? [],
    longestTaskMs: Number(Math.max(0, ...raw.longTasksMs).toFixed(2)),
    longTaskSamples: raw.longTaskSamples ?? [],
    monitoredNodeCount: raw.monitoredNodeCount,
    lostNodeCount: raw.lostNodeCount,
    unclickableDurationMs: Number(raw.unclickableDurationMs.toFixed(2)),
    unclickableSamples: raw.unclickableSamples ?? [],
  };
}

async function startMeasurement(page: Page, expectedNodeIds: ReadonlyArray<string>): Promise<void> {
  const monitoredIds = selectWorkflowMonitorIds(await page.locator('[data-node-id]').evaluateAll(nodes => (
    nodes.map(node => (node as HTMLElement).dataset.nodeId ?? null)
  )));
  assertWorkflowMonitorCoverage(monitoredIds, expectedNodeIds);

  await page.evaluate((nodeIds: string[]) => {
    const windowWithState = window as typeof window & {
      __wujieStage4WorkflowPerformance?: Record<string, unknown>;
    };
    if (windowWithState.__wujieStage4WorkflowPerformance) {
      throw new Error('Stage 4 workflow measurement is already active');
    }

    const monitoredIds = new Set(nodeIds);

    const state = {
      startedAt: performance.now(),
      frameTimestamps: [] as number[],
      inputDelaysMs: [] as number[],
      inputDelaySamples: [] as WorkflowInputDelaySample[],
      longTasksMs: [] as number[],
      longTaskSamples: [] as WorkflowLongTaskSample[],
      monitoredNodeCount: monitoredIds.size,
      lostNodeCount: 0,
      unclickableDurationMs: 0,
      unclickableSamples: [] as WorkflowUnclickableSample[],
      lastFrameAt: performance.now(),
      active: true,
      rafId: 0,
      observers: [] as PerformanceObserver[],
      inputHandler: null as ((event: Event) => void) | null,
    };

    const inputHandler = (event: Event) => {
      const timestamp = Number(event.timeStamp);
      if (!Number.isFinite(timestamp)) return;
      const observedAt = performance.now();
      const delayMs = Math.max(0, observedAt - timestamp);
      state.inputDelaysMs.push(delayMs);
      state.inputDelaySamples.push({
        source: 'pointer',
        name: event.type,
        delayMs,
        startTime: timestamp,
        observedAt,
      });
    };

    state.inputHandler = inputHandler;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) {
      document.addEventListener(type, inputHandler, { capture: true, passive: true });
    }

    try {
      const longTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          state.longTasksMs.push(entry.duration);
          state.longTaskSamples.push({
            startTime: entry.startTime,
            durationMs: entry.duration,
            name: entry.name,
          });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
      state.observers.push(longTaskObserver);
    } catch {}

    try {
      const eventObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const timing = entry as PerformanceEntry & { processingStart?: number };
          if (typeof timing.processingStart !== 'number' || timing.startTime < state.startedAt) {
            continue;
          }
          const delayMs = Math.max(0, timing.processingStart - timing.startTime);
          state.inputDelaysMs.push(delayMs);
          state.inputDelaySamples.push({
            source: 'event-timing',
            name: timing.name,
            delayMs,
            startTime: timing.startTime,
            observedAt: performance.now(),
          });
        }
      });
      eventObserver.observe({ type: 'event', durationThreshold: 0 } as PerformanceObserverInit);
      state.observers.push(eventObserver);
    } catch {}

    const sampleNodes = (deltaMs: number) => {
      for (const id of monitoredIds) {
        const node = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
        if (!node) {
          state.lostNodeCount += 1;
          continue;
        }

        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || Number(style.opacity) === 0
          || rect.width <= 0
          || rect.height <= 0
        ) {
          state.lostNodeCount += 1;
          continue;
        }

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (
          centerX < 0
          || centerY < 0
          || centerX > window.innerWidth
          || centerY > window.innerHeight
        ) {
          continue;
        }

        const hit = document.elementFromPoint(centerX, centerY);
        if (hit instanceof Element && hit.closest('[data-popup], [data-modal], [data-floating-panel]')) {
          continue;
        }
        if (!hit || (!node.contains(hit) && hit !== node)) {
          state.unclickableDurationMs += deltaMs;
          if (state.unclickableSamples.length < 20) {
            state.unclickableSamples.push({
              id,
              hitTag: hit?.tagName ?? null,
              hitClass: hit instanceof HTMLElement ? hit.className || null : null,
            });
          }
        }
      }
    };

    const tick = (timestamp: number) => {
      if (!state.active) return;
      const deltaMs = Math.max(0, timestamp - state.lastFrameAt);
      state.lastFrameAt = timestamp;
      state.frameTimestamps.push(timestamp);
      state.rafId = requestAnimationFrame(tick);
      sampleNodes(deltaMs);
    };

    state.rafId = requestAnimationFrame(tick);
    windowWithState.__wujieStage4WorkflowPerformance = state as unknown as Record<string, unknown>;
  }, [...expectedNodeIds]);
}

async function stopMeasurement(page: Page): Promise<WorkflowPerformanceRawSample> {
  return page.evaluate(() => {
    const windowWithState = window as typeof window & {
      __wujieStage4WorkflowPerformance?: Record<string, unknown>;
    };
    const state = windowWithState.__wujieStage4WorkflowPerformance as unknown as {
      startedAt: number;
      frameTimestamps: number[];
      inputDelaysMs: number[];
      inputDelaySamples: WorkflowInputDelaySample[];
      longTasksMs: number[];
      longTaskSamples: WorkflowLongTaskSample[];
      monitoredNodeCount: number;
      lostNodeCount: number;
      unclickableDurationMs: number;
      unclickableSamples: WorkflowUnclickableSample[];
      active: boolean;
      rafId: number;
      observers: PerformanceObserver[];
      inputHandler: ((event: Event) => void) | null;
    } | undefined;

    if (!state) {
      throw new Error('Stage 4 workflow measurement is not active');
    }

    state.active = false;
    cancelAnimationFrame(state.rafId);
    state.observers.forEach(observer => observer.disconnect());
    if (state.inputHandler) {
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) {
        document.removeEventListener(type, state.inputHandler, { capture: true });
      }
    }
    delete windowWithState.__wujieStage4WorkflowPerformance;

    return {
      startedAt: state.startedAt,
      endedAt: performance.now(),
      frameTimestamps: state.frameTimestamps,
      inputDelaysMs: state.inputDelaysMs,
      inputDelaySamples: state.inputDelaySamples,
      longTasksMs: state.longTasksMs,
      longTaskSamples: state.longTaskSamples,
      monitoredNodeCount: state.monitoredNodeCount,
      lostNodeCount: state.lostNodeCount,
      unclickableDurationMs: state.unclickableDurationMs,
      unclickableSamples: state.unclickableSamples,
    };
  });
}

export async function measureWorkflowInteraction(
  page: Page,
  expectedNodeIds: ReadonlyArray<string>,
  action: WorkflowInteraction,
): Promise<WorkflowPerformanceSample> {
  await startMeasurement(page, expectedNodeIds);
  let actionError: unknown;
  try {
    await action(page);
  } catch (error) {
    actionError = error;
  }
  const sample = summarizeWorkflowPerformance(await stopMeasurement(page));
  if (actionError) throw actionError;
  return sample;
}
