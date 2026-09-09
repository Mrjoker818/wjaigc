import 'server-only';

import { drainPendingAssetCleanup } from './cleanup-outbox';

const WORKER_STATE = Symbol.for('wujie.assetCleanupWorker');
const DEFAULT_INTERVAL_MS = 60_000;

interface CleanupWorkerHandle {
  stop(): void;
}

interface CleanupWorkerState {
  handle: CleanupWorkerHandle;
  timer: ReturnType<typeof setInterval>;
  running: boolean;
  stopped: boolean;
}

type CleanupWorkerGlobal = typeof globalThis & { [WORKER_STATE]?: CleanupWorkerState };

export function startAssetCleanupWorker(input: {
  drain?: typeof drainPendingAssetCleanup;
  intervalMs?: number;
} = {}): CleanupWorkerHandle {
  const scope = globalThis as CleanupWorkerGlobal;
  const existing = scope[WORKER_STATE];
  if (existing && !existing.stopped) return existing.handle;

  const drain = input.drain ?? drainPendingAssetCleanup;
  const intervalMs = Math.max(1_000, Math.min(input.intervalMs ?? DEFAULT_INTERVAL_MS, 60 * 60_000));
  const run = () => {
    const state = scope[WORKER_STATE];
    if (!state || state.stopped || state.running) return;
    state.running = true;
    void drain({ limit: 10 }).catch(() => {
      console.warn({ code: 'ASSET_CLEANUP_WORKER_DRAIN_FAILED' });
    }).finally(() => {
      const current = scope[WORKER_STATE];
      if (current === state) current.running = false;
    });
  };

  const handle: CleanupWorkerHandle = {
    stop() {
      const state = scope[WORKER_STATE];
      if (!state || state.handle !== handle) return;
      state.stopped = true;
      clearInterval(state.timer);
      delete scope[WORKER_STATE];
    },
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  scope[WORKER_STATE] = { handle, timer, running: false, stopped: false };
  run();
  return handle;
}

export function stopAssetCleanupWorker(): void {
  (globalThis as CleanupWorkerGlobal)[WORKER_STATE]?.handle.stop();
}
