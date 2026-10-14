import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSketchStage } from '@/lib/sketch-to-code/stage';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function nextMicrotasks(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

describe('shared bounded sketch stage preserves the original code protection', () => {
  it('returns the exact successful value and removes its native listener and timer', async () => {
    let cleanup: ReturnType<typeof vi.spyOn> | undefined;
    const value = Object.freeze({ actual: true });
    expect(await runSketchStage(async signal => { cleanup = vi.spyOn(signal, 'removeEventListener'); return value; }, new AbortController().signal)).toBe(value);
    expect(cleanup).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves an adapter failure without a dangling deadline', async () => {
    const error = new Error('native-provider-failure');
    await expect(runSketchStage(async () => { throw error; }, new AbortController().signal)).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('pre-cancellation rejects before scheduling any operation', async () => {
    const controller = new AbortController(), reason = new Error('already-cancelled'); controller.abort(reason);
    const operation = vi.fn(async () => 42);
    await expect(runSketchStage(operation, controller.signal)).rejects.toBe(reason);
    expect(operation).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([60_000, 120_000])('times out an adapter that ignores cancellation at the exact %i ms budget', async timeoutMs => {
    let release!: (value: number) => void; let signal: AbortSignal | undefined;
    const operation = vi.fn(async (actual: AbortSignal) => { signal = actual; return new Promise<number>(resolve => { release = resolve; }); });
    const outcome = runSketchStage(operation, new AbortController().signal, timeoutMs).then(value => ({ value }), error => ({ error: error as Error }));
    await nextMicrotasks(); expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(timeoutMs - 1); expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await outcome).toEqual({ error: new Error('SKETCH_MODEL_TIMEOUT') });
    expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    release(42); await nextMicrotasks(); expect(await outcome).toEqual({ error: new Error('SKETCH_MODEL_TIMEOUT') });
  });
  it('the default remains the original sixty seconds', async () => {
    const operation = vi.fn(async () => new Promise<never>(() => undefined));
    const outcome = runSketchStage(operation, new AbortController().signal).catch(error => error as Error);
    await nextMicrotasks(); expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(await outcome).toEqual(new Error('SKETCH_MODEL_TIMEOUT'));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('parent cancellation wins over a late success from a signal-ignoring adapter', async () => {
    const controller = new AbortController(), reason = new Error('cancel-in-flight');
    let release!: (value: number) => void; let signal: AbortSignal | undefined; let cleanup: ReturnType<typeof vi.spyOn> | undefined;
    const operation = vi.fn(async (actual: AbortSignal) => { signal = actual; cleanup = vi.spyOn(actual, 'removeEventListener');
      return new Promise<number>(resolve => { release = resolve; }); });
    const outcome = runSketchStage(operation, controller.signal).then(value => ({ value }), error => ({ error: error as Error }));
    await nextMicrotasks(); expect(operation).toHaveBeenCalledTimes(1);
    controller.abort(reason); expect(await outcome).toEqual({ error: reason }); expect(signal?.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0);
    release(42); await nextMicrotasks(); expect(await outcome).toEqual({ error: reason });
  });
  it.each([0, -1, 0.5, NaN, Infinity, 120_001])('rejects invalid internal timeout %s with zero operation', async timeoutMs => {
    const operation = vi.fn(async () => 42);
    await expect(runSketchStage(operation, new AbortController().signal, timeoutMs)).rejects.toThrow('SKETCH_STAGE_TIMEOUT_INVALID');
    expect(operation).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
