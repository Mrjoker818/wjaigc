// Abort even an adapter that ignores its signal; late fulfillment cannot start the next phase.
export async function runSketchStage<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal,
  timeoutMs = 60_000, timeoutError = new Error('SKETCH_MODEL_TIMEOUT')): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('SKETCH_STAGE_TIMEOUT_INVALID');
  parent.throwIfAborted();
  const deadline = new AbortController();
  const signal = AbortSignal.any([parent, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(timeoutError), timeoutMs);
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = (): void => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(signal); }).then(
      result => { cleanup(); if (signal.aborted) reject(signal.reason); else resolve(result); },
      error => { cleanup(); reject(error); },
    );
  });
}
