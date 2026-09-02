export async function runWithAbortSignalTimeout<T>(
  executionSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const forwardExecutionAbort = () => controller.abort(executionSignal?.reason);

  if (executionSignal?.aborted) {
    forwardExecutionAbort();
  } else {
    executionSignal?.addEventListener('abort', forwardExecutionAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError'));
  }, timeoutMs);

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
    executionSignal?.removeEventListener('abort', forwardExecutionAbort);
  }
}
