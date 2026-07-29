import { AsyncLocalStorage } from 'node:async_hooks';

const MAX_CONCURRENT_PSD_MEMORY_TASKS = 1;

interface MemoryWaiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const memorySlotContext = new AsyncLocalStorage<boolean>();
const memoryWaiters: MemoryWaiter[] = [];
let activeMemoryTasks = 0;

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('PSD processing was cancelled');
  error.name = 'AbortError';
  return error;
}

function createRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeMemoryTasks = Math.max(0, activeMemoryTasks - 1);
    while (
      activeMemoryTasks < MAX_CONCURRENT_PSD_MEMORY_TASKS
      && memoryWaiters.length > 0
    ) {
      const waiter = memoryWaiters.shift()!;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      if (waiter.signal?.aborted) {
        waiter.reject(abortError(waiter.signal));
        continue;
      }
      activeMemoryTasks += 1;
      waiter.resolve(createRelease());
    }
  };
}

function acquireMemorySlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (activeMemoryTasks < MAX_CONCURRENT_PSD_MEMORY_TASKS) {
    activeMemoryTasks += 1;
    return Promise.resolve(createRelease());
  }
  return new Promise((resolve, reject) => {
    const waiter: MemoryWaiter = { resolve, reject, signal };
    if (signal) {
      waiter.onAbort = () => {
        const index = memoryWaiters.indexOf(waiter);
        if (index >= 0) memoryWaiters.splice(index, 1);
        reject(abortError(signal));
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
    }
    memoryWaiters.push(waiter);
  });
}

export async function withLayerPsdMemorySlot<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (memorySlotContext.getStore()) {
    signal?.throwIfAborted();
    return operation();
  }
  const release = await acquireMemorySlot(signal);
  try {
    return await memorySlotContext.run(true, operation);
  } finally {
    release();
  }
}
