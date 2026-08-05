/**
 * 本地推理全局并发闸门
 *
 * 6 vCPU 部署下，推理进程最多占用 4 线程，Web/DB 需保留 2 核。
 * 这里将擦除、去背景、放大三类本地推理串行化（默认并发 1），
 * 超出并发的调用进入 FIFO 队列，避免多用户同时触发推理导致卡顿或 OOM。
 */

const DEFAULT_MAX_CONCURRENT = 1;

export const LOCAL_INFERENCE_MAX_CONCURRENT = Math.max(
  1,
  Number.parseInt(process.env.LOCAL_INFERENCE_MAX_CONCURRENT || String(DEFAULT_MAX_CONCURRENT), 10) || DEFAULT_MAX_CONCURRENT,
);

interface Waiter {
  timer: NodeJS.Timeout;
  run: () => void;
}

let activeCount = 0;
const waiters: Waiter[] = [];

function pump(): void {
  while (activeCount < LOCAL_INFERENCE_MAX_CONCURRENT && waiters.length > 0) {
    const next = waiters.shift();
    if (!next) break;
    clearTimeout(next.timer);
    next.run();
  }
}

/**
 * 在本地推理锁内执行任务。
 * @param task 实际推理任务
 * @param waitTimeoutMs 排队等待超时，默认 5 分钟（与 IOPAINT_TIMEOUT_MS 同级）
 */
export async function withLocalInferenceLock<T>(
  task: () => Promise<T>,
  waitTimeoutMs: number = 5 * 60 * 1000,
): Promise<T> {
  if (activeCount < LOCAL_INFERENCE_MAX_CONCURRENT) {
    activeCount += 1;
    try {
      return await task();
    } finally {
      activeCount -= 1;
      pump();
    }
  }

  return new Promise<T>((resolve, reject) => {
    const run = (): void => {
      activeCount += 1;
      task().then(
        value => {
          activeCount -= 1;
          pump();
          resolve(value);
        },
        error => {
          activeCount -= 1;
          pump();
          reject(error);
        },
      );
    };

    const waiter: Waiter = {
      run,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(
          new Error(
            `本地推理排队等待超时（${Math.round(waitTimeoutMs / 1000)}s），请稍后重试`,
          ),
        );
      }, waitTimeoutMs),
    };
    waiters.push(waiter);
  });
}
