import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireDocumentBrowserLease } from '@/lib/collaboration/document-browser-lease';

type Callback = (lock: Lock | null) => Promise<void>;
function platform() {
  const held = new Map<string, symbol>();
  const request = vi.fn((name: string, options: LockOptions, callback: Callback): Promise<void> => {
    if (options.mode !== 'exclusive' || options.ifAvailable !== true || options.signal || options.steal) {
      return Promise.reject(new Error('invalid platform options'));
    }
    if (held.has(name)) return Promise.resolve().then(() => callback(null));
    const identity = Symbol(name); held.set(name, identity);
    return Promise.resolve().then(() => callback({ name, mode: 'exclusive' } as Lock)).finally(() => {
      if (held.get(name) === identity) held.delete(name);
    });
  });
  return { held, request };
}
let current: ReturnType<typeof platform>;
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => {
  current = platform(); vi.stubGlobal('navigator', { locks: current });
  vi.stubGlobal('isSecureContext', true);
});
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
async function acquire(actorId = 'actor-a', projectId = 'project-a', signal?: AbortSignal) {
  const lease = await acquireDocumentBrowserLease({ actorId, projectId, signal });
  cleanup.push(() => lease.release()); return lease;
}
describe('document browser writer lease with controlled LockManager', () => {
  it('excludes the same scope until actual release and then admits a new holder', async () => {
    const first = await acquire(); expect(first.active).toBe(true); first.assertOwned();
    await expect(acquire()).rejects.toThrow('DOCUMENT_BROWSER_LEASE_BUSY');
    expect(current.held.size).toBe(1); await first.release();
    const second = await acquire(); second.assertOwned(); expect(current.held.size).toBe(1);
  });
  it('allows different actors and projects without colliding', async () => {
    const a = await acquire(), b = await acquire('actor-b'), c = await acquire('actor-a', 'project-b');
    expect([a.active, b.active, c.active]).toEqual([true, true, true]);
    expect(current.held.size).toBe(3);
  });
  it('invalidates storage access synchronously before awaiting native release', async () => {
    const lease = await acquire(); const released = lease.release();
    expect(lease.active).toBe(false); expect(lease.signal.aborted).toBe(true);
    expect(() => lease.assertOwned()).toThrow('DOCUMENT_BROWSER_LEASE_LOST');
    await released; expect(current.held.size).toBe(0); await lease.release();
    expect(current.request).toHaveBeenCalledTimes(1);
  });
  it('rejects an already aborted owner without asking the browser for a lock', async () => {
    const owner = new AbortController(); owner.abort();
    await expect(acquire('actor-a', 'project-a', owner.signal)).rejects.toThrow('DOCUMENT_BROWSER_LEASE_CANCELLED');
    expect(current.request).not.toHaveBeenCalled();
  });
  it('releases and invalidates a held lease on owner abort', async () => {
    const owner = new AbortController(), lease = await acquire('actor-a', 'project-a', owner.signal);
    owner.abort(); expect(lease.active).toBe(false); expect(lease.signal.aborted).toBe(true);
    expect(() => lease.assertOwned()).toThrow(); await lease.release(); expect(current.held.size).toBe(0);
  });
  it.each(['abort', 'timeout'] as const)('does not adopt a lock delivered after %s during acquisition', async mode => {
    vi.useFakeTimers(); const owner = new AbortController(); let callback!: Callback;
    current.request.mockImplementation((_name, _options, handler) => {
      callback = handler; return new Promise<void>(() => undefined);
    });
    const result = acquireDocumentBrowserLease({ actorId: 'actor-a', projectId: 'project-a', signal: owner.signal })
      .then(() => 'acquired', error => error.message as string);
    if (mode === 'abort') owner.abort(); else await vi.advanceTimersByTimeAsync(2_001);
    expect(await result).toBe(mode === 'abort' ? 'DOCUMENT_BROWSER_LEASE_CANCELLED' : 'DOCUMENT_BROWSER_LEASE_TIMEOUT');
    let callbackFinished = false;
    const late = callback({ name: 'late', mode: 'exclusive' } as Lock).then(() => { callbackFinished = true; });
    await vi.advanceTimersByTimeAsync(0); expect(callbackFinished).toBe(true); await late;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('marks a held lease lost if the native request promise rejects', async () => {
    let rejectNative!: (error: Error) => void;
    current.request.mockImplementation((name, _options, callback) => {
      void callback({ name, mode: 'exclusive' } as Lock);
      return new Promise<void>((_resolve, reject) => { rejectNative = reject; });
    });
    const lease = await acquire(); rejectNative(new Error('native lock lost'));
    await vi.waitFor(() => expect(lease.active).toBe(false)); expect(lease.signal.aborted).toBe(true);
    expect(() => lease.assertOwned()).toThrow('DOCUMENT_BROWSER_LEASE_LOST');
  });
  it('does not expire a held lock when the acquisition budget elapses', async () => {
    vi.useFakeTimers(); const lease = await acquire();
    expect(vi.getTimerCount()).toBe(0); await vi.advanceTimersByTimeAsync(30_000);
    expect(lease.active).toBe(true); expect(current.held.size).toBe(1);
  });
  it.each([false, undefined])('fails closed without secure context (%s)', async secure => {
    vi.stubGlobal('isSecureContext', secure);
    await expect(acquire()).rejects.toThrow('DOCUMENT_BROWSER_LEASE_UNAVAILABLE'); expect(current.request).not.toHaveBeenCalled();
  });
  it('does not substitute an in-memory lease when the platform is unavailable or denies access', async () => {
    vi.stubGlobal('navigator', {});
    await expect(acquire()).rejects.toThrow('DOCUMENT_BROWSER_LEASE_UNAVAILABLE');
    vi.stubGlobal('navigator', { locks: current }); current.request.mockRejectedValueOnce(new Error('denied'));
    await expect(acquire()).rejects.toThrow('DOCUMENT_BROWSER_LEASE_UNAVAILABLE');
  });
  it.each([['', 'project-a'], [' actor-a', 'project-a'], ['actor-a', 'x\u0000y'], ['actor-a', 'x'.repeat(257)]])(
    'rejects an invalid scope before any lock request: %j', async (actorId, projectId) => {
      await expect(acquire(actorId, projectId)).rejects.toThrow('DOCUMENT_BROWSER_LEASE_INVALID');
      expect(current.request).not.toHaveBeenCalled();
    });
});
