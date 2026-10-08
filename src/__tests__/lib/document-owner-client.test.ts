import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOwnerProjectStatus, requestOwnerDocument, saveAndEnableOwnerProject, saveOwnerProject,
  type OwnerClientScope, type OwnerProjectSync } from '@/lib/collaboration/document-owner-client';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const scope: OwnerClientScope = { userId: 'owner-a', projectId: 'temp', generation: 1 };
function sync(): OwnerProjectSync {
  return { flushProjectsToServerWithConflictRecovery: async () => ({ projectIdMap: { temp: 'stored' } }),
    getProjectSyncRevision: () => 8 };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('owner status read deadline and cancellation', () => {
  it.each(['transport', 'body'] as const)('bounds an unresponsive %s even when abort is ignored', async phase => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const body = deferred<unknown>();
    const reply = Response.json({});
    vi.spyOn(reply, 'json').mockImplementation(() => body.promise);
    const fetcher = vi.fn<typeof fetch>(() => phase === 'transport' ? pending.promise : Promise.resolve(reply));
    vi.stubGlobal('fetch', fetcher);
    let settled = false;
    const outcome = readOwnerProjectStatus('stored').then(
      value => { settled = true; return { value }; },
      (error: unknown) => { settled = true; return { error }; },
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    if (!settled) return; // RED must fail rather than wait forever on the old reader.
    expect(await outcome).toMatchObject({ error: { code: 'DOCUMENT_REQUEST_TIMEOUT', status: 0, uncertain: false } });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start an already cancelled status read', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, projectId: 'stored',
      featureEnabled: true, enabled: false, currentRevision: 0 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(readOwnerProjectStatus('stored', controller.signal))
      .rejects.toMatchObject({ code: 'DOCUMENT_REQUEST_CANCELLED', status: 0, uncertain: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('settles cancellation without waiting for an abort-ignoring response body', async () => {
    vi.useFakeTimers();
    const body = deferred<unknown>();
    const reply = Response.json({});
    vi.spyOn(reply, 'json').mockImplementation(() => body.promise);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply);
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    let settled = false;
    const outcome = readOwnerProjectStatus('stored', controller.signal).catch((error: unknown) => {
      settled = true; return error;
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    if (!settled) return;
    expect(await outcome).toMatchObject({ code: 'DOCUMENT_REQUEST_CANCELLED', status: 0, uncertain: false });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its deadline after a successful status read', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, projectId: 'stored',
      featureEnabled: false, enabled: true, currentRevision: 3 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await readOwnerProjectStatus('stored')).toEqual({ projectId: 'stored',
      featureEnabled: false, enabled: true, currentRevision: 3 });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
  });
});

describe('owner project save and enable scope', () => {
  it('returns the persisted project identity and post-save revision', async () => {
    expect(await saveOwnerProject('temp', sync())).toEqual({ projectId: 'stored', expectedRevision: 8 });
  });

  it('does not submit enable before saving finishes', async () => {
    const pending = deferred<{ projectIdMap: Record<string, string> }>();
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, projectId: 'stored' }));
    vi.stubGlobal('fetch', fetcher);
    const manager = sync();
    manager.flushProjectsToServerWithConflictRecovery = () => pending.promise;
    const result = saveAndEnableOwnerProject(scope, manager, () => scope);
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
    pending.resolve({ projectIdMap: { temp: 'stored' } });
    expect(await result).toEqual({ projectId: 'stored', expectedRevision: 8 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/collaboration/document-enable');
    expect(JSON.parse(init.body as string)).toEqual({ projectId: 'stored', expectedRevision: 8 });
    expect(init.credentials).toBe('include');
  });

  it('never enables after a failed save', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const manager = sync();
    manager.flushProjectsToServerWithConflictRecovery = async () => { throw new Error('save failed'); };
    await expect(saveAndEnableOwnerProject(scope, manager, () => scope)).rejects.toThrow('save failed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['userId', 'projectId', 'generation'] as const)('discards delayed save after %s changes', async key => {
    const pending = deferred<{ projectIdMap: Record<string, string> }>();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const manager = sync(); manager.flushProjectsToServerWithConflictRecovery = () => pending.promise;
    let current = { ...scope };
    const operation = saveAndEnableOwnerProject(scope, manager, () => current);
    const outcome = operation.then(value => ({ value }), (error: unknown) => ({ error }));
    current = key === 'generation' ? { ...scope, generation: 2 } : { ...scope, [key]: 'changed' };
    pending.resolve({ projectIdMap: { temp: 'stored' } });
    expect(await outcome).toMatchObject({ error: { code: 'DOCUMENT_SCOPE_CHANGED' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('discards a delayed enable response after the dialog scope expires', async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetcher);
    let current: OwnerClientScope | null = scope;
    const operation = saveAndEnableOwnerProject(scope, sync(), () => current);
    const outcome = operation.then(value => ({ value }), (error: unknown) => ({ error }));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    current = null;
    pending.resolve(Response.json({ success: true, projectId: 'stored' }));
    expect(await outcome).toMatchObject({ error: { code: 'DOCUMENT_SCOPE_CHANGED' } });
  });
});

describe('owner document HTTP uncertainty', () => {
  it('reads back the persisted identity after an uncertain enable without replaying the mutation', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(Response.json({ success: true, projectId: 'stored',
        featureEnabled: true, enabled: true, currentRevision: 9 }));
    vi.stubGlobal('fetch', fetcher);
    const error = await saveAndEnableOwnerProject(scope, sync(), () => scope).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ uncertain: true, projectId: 'stored' });
    expect(await readOwnerProjectStatus('stored')).toEqual({ projectId: 'stored',
      featureEnabled: true, enabled: true, currentRevision: 9 });
    expect(fetcher.mock.calls.map(call => (call[1] as RequestInit).method ?? 'GET')).toEqual(['POST', 'GET']);
    expect(fetcher.mock.calls[1][0]).toBe('/api/collaboration/document-enable?projectId=stored');
  });
  it.each([401, 409])('preserves server failure %s without resubmitting', async status => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: false, code: 'SERVER_CODE' }, { status }));
    vi.stubGlobal('fetch', fetcher);
    await expect(requestOwnerDocument('/api/collaboration/editors', { method: 'POST' }))
      .rejects.toMatchObject({ status, code: 'SERVER_CODE', uncertain: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['html', 'missing-success', 'network'])('does not report %s mutation as successful', async scenario => {
    const fetcher = vi.fn();
    if (scenario === 'network') fetcher.mockRejectedValue(new Error('offline'));
    else fetcher.mockResolvedValue(scenario === 'html' ? new Response('<html>error</html>') : Response.json({}));
    vi.stubGlobal('fetch', fetcher);
    await expect(requestOwnerDocument('/api/collaboration/editors', { method: 'POST' }))
      .rejects.toMatchObject({ uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
