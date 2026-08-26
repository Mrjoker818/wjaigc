import { describe, expect, it, vi } from 'vitest';

import {
  createSimpleChatSyncCoordinator,
  type SimpleChatSyncSnapshot,
} from '@/lib/simple-chat-sync-client';
import type { SimpleChatSyncEnvelopeV1 } from '@/lib/simple-chat-project-sync';
import type { SimpleChatEnvelopeStore } from '@/lib/simple-chat-sync-storage';
import {
  countPostRequests,
  createMemorySimpleChatEnvelopeStore,
  deferred,
  envelope,
  jsonResponse,
  project,
  sequenceFetch,
} from '@/__tests__/fixtures/simple-chat-sync';

function requestMethod(init?: RequestInit): string {
  return (init?.method ?? 'GET').toUpperCase();
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function offlineNavigator(): Navigator {
  return { onLine: false } as Navigator;
}

function sequentialUuid(): () => string {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
}

describe('simple chat sync coordinator', () => {
  it('initializes from the authoritative remote snapshot and persists it', async () => {
    const store = createMemorySimpleChatEnvelopeStore();
    const coordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [project('remote')], syncRevision: 4 }),
      ),
      now: () => 10,
    });

    const snapshot = await coordinator.initialize('user-a');

    expect(snapshot).toMatchObject({ status: 'synced', projects: [project('remote')] });
    expect(await store.get('user-a')).toMatchObject({
      userId: 'user-a',
      baseRevision: 4,
      baseProjects: [project('remote')],
      currentProjects: [project('remote')],
      pendingOperations: [],
      updatedAt: 10,
    });
  });

  it('allows only one active request and does not duplicate its POST', async () => {
    const pending = deferred<Response>();
    const fetchImpl = sequenceFetch(
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      pending.promise,
    );
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('p1')]);

    const first = coordinator.flush('manual');
    const second = coordinator.flush('debounce');
    await vi.waitFor(() => expect(countPostRequests(fetchImpl)).toBe(1));
    pending.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
    await Promise.all([first, second]);

    expect(countPostRequests(fetchImpl)).toBe(1);
  });

  it('does not clear operations created while a batch is in flight', async () => {
    const pending = deferred<Response>();
    const fetchImpl = sequenceFetch(
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      pending.promise,
    );
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
      createId: sequentialUuid(),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('p1')]);
    const batchIds = coordinator.snapshot().pendingOperations.map(operation => operation.operationId);
    const flush = coordinator.flush('debounce');
    coordinator.update([project('p1'), project('p2')]);
    pending.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
    await flush;

    const remainingIds = coordinator.snapshot().pendingOperations.map(operation => operation.operationId);
    expect(remainingIds).not.toHaveLength(0);
    expect(remainingIds).not.toEqual(expect.arrayContaining(batchIds));
    expect(coordinator.snapshot().projects).toEqual([project('p1'), project('p2')]);
  });

  it('acknowledges exactly the immutable successful batch', async () => {
    const pending = deferred<Response>();
    const store = createMemorySimpleChatEnvelopeStore();
    const coordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        pending.promise,
      ),
      createId: sequentialUuid(),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('first')]);
    const acknowledgedIds = coordinator.snapshot().pendingOperations.map(operation => operation.operationId);
    const flush = coordinator.flush('manual');
    coordinator.update([project('first'), project('second')]);
    const allIds = coordinator.snapshot().pendingOperations.map(operation => operation.operationId);
    pending.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
    await flush;

    const saved = await store.get('user-a');
    const remainingIds = saved?.pendingOperations.map(operation => operation.operationId) ?? [];
    expect(remainingIds).toEqual(allIds.filter(id => !acknowledgedIds.includes(id)));
    expect(saved?.baseProjects).toEqual([project('first')]);
    expect(saved?.currentProjects).toEqual([project('first'), project('second')]);
  });

  it('rebases an in-flight edit to the batch that just succeeded', async () => {
    const pending = deferred<Response>();
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        pending.promise,
      ),
      createId: sequentialUuid(),
    });
    await coordinator.initialize('user-a');
    const first = project('same');
    coordinator.update([first]);
    const flush = coordinator.flush('manual');
    const later = { ...project('same'), name: 'later edit' };
    coordinator.update([later]);
    pending.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
    await flush;

    const projectOperation = coordinator.snapshot().pendingOperations.find(
      operation => operation.entityType === 'project' && operation.entityId === 'same',
    );
    expect(projectOperation).toMatchObject({
      kind: 'upsert',
      baseValue: first,
      value: later,
    });
  });

  it('rebases remote changes and replays local operations after a 409', async () => {
    const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
    const responses = [
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      jsonResponse(409, { success: false, code: 'CHAT_SYNC_CONFLICT', currentRevision: 1 }),
      jsonResponse(200, { success: true, value: [project('remote')], syncRevision: 1 }),
      jsonResponse(200, { success: true, syncRevision: 2 }),
    ];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push({
        method: requestMethod(init),
        ...(init?.body === undefined ? {} : { body: requestBody(init) }),
      });
      const response = responses.shift();
      if (!response) throw new Error('Unexpected request');
      return response;
    };
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
      createId: sequentialUuid(),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('local')]);

    await coordinator.flush('manual');

    expect(calls.map(call => call.method)).toEqual(['GET', 'POST', 'GET', 'POST']);
    expect(calls.at(-1)?.body).toMatchObject({
      key: 'chat_simple_projects',
      expectedRevision: 1,
      value: [project('remote'), project('local')],
    });
    expect(coordinator.snapshot()).toMatchObject({
      status: 'synced',
      projects: [project('remote'), project('local')],
      pendingOperations: [],
    });
  });

  it('stops after replaying at most twice when conflicts continue', async () => {
    const fetchImpl = sequenceFetch(
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      jsonResponse(409, { code: 'CHAT_SYNC_CONFLICT', currentRevision: 1 }),
      jsonResponse(200, { success: true, value: [], syncRevision: 1 }),
      jsonResponse(409, { code: 'CHAT_SYNC_CONFLICT', currentRevision: 2 }),
      jsonResponse(200, { success: true, value: [], syncRevision: 2 }),
      jsonResponse(409, { code: 'CHAT_SYNC_CONFLICT', currentRevision: 3 }),
    );
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('local')]);
    await coordinator.flush('manual');

    expect(coordinator.snapshot().status).toBe('conflict');
    expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
    expect(countPostRequests(fetchImpl)).toBe(3);
  });

  it.each([429, 500, 502, 503, 504])(
    'backs off at most three times for retryable status %i',
    async status => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetchImpl = sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(status, { success: false, code: 'RETRYABLE' }),
        jsonResponse(status, { success: false, code: 'RETRYABLE' }),
        jsonResponse(status, { success: false, code: 'RETRYABLE' }),
        jsonResponse(200, { success: true, syncRevision: 1 }),
      );
      const coordinator = createSimpleChatSyncCoordinator({
        store: createMemorySimpleChatEnvelopeStore(),
        fetchImpl,
        sleep,
        jitter: () => 0,
      });
      await coordinator.initialize('user-a');
      coordinator.update([project('retryable')]);
      await coordinator.flush('manual');

      expect(sleep).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500, 1_000]);
      expect(countPostRequests(fetchImpl)).toBe(4);
      expect(coordinator.snapshot().status).toBe('synced');
    },
  );

  it('keeps pending data after bounded 503 failures and resumes through handleOnline', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(503, { success: false, code: 'SERVICE_UNAVAILABLE' }),
        jsonResponse(503, { success: false, code: 'SERVICE_UNAVAILABLE' }),
        jsonResponse(503, { success: false, code: 'SERVICE_UNAVAILABLE' }),
        jsonResponse(503, { success: false, code: 'SERVICE_UNAVAILABLE' }),
        jsonResponse(200, { success: true, syncRevision: 1 }),
      ),
      sleep,
      jitter: () => 0,
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('offline')]);
    await coordinator.flush('manual');

    expect(coordinator.snapshot()).toMatchObject({ status: 'failed', projects: [project('offline')] });
    expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
    await coordinator.handleOnline();
    expect(coordinator.snapshot()).toMatchObject({ status: 'synced', pendingOperations: [] });
  });

  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'FORBIDDEN'],
  ])('does not automatically retry %i and preserves the envelope', async (status, code) => {
    const store = createMemorySimpleChatEnvelopeStore();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = sequenceFetch(
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      jsonResponse(status, { success: false, code, message: code, retryable: false }),
    );
    const coordinator = createSimpleChatSyncCoordinator({ store, fetchImpl, sleep });
    await coordinator.initialize('user-a');
    coordinator.update([project('pending')]);
    await coordinator.flush('manual');

    expect(coordinator.snapshot()).toMatchObject({
      status: 'failed',
      error: { code, message: code, retryable: false },
    });
    expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
    expect(await store.get('user-a')).not.toBeNull();
    expect(countPostRequests(fetchImpl)).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not restart debounce sync after an authorization failure', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(401, { success: false, code: 'AUTH_REQUIRED', retryable: false }),
      );
      const coordinator = createSimpleChatSyncCoordinator({
        store: createMemorySimpleChatEnvelopeStore(),
        fetchImpl,
      });
      await coordinator.initialize('user-a');
      coordinator.update([project('before-auth-failure')]);
      await coordinator.flush('manual');
      coordinator.update([project('after-auth-failure')]);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(countPostRequests(fetchImpl)).toBe(1);
      expect(coordinator.snapshot()).toMatchObject({
        status: 'failed',
        projects: [project('after-auth-failure')],
        error: { code: 'AUTH_REQUIRED', retryable: false },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays offline without a request and flushes pending work in handleOnline', async () => {
    const originalNavigator = globalThis.navigator;
    try {
      const fetchImpl = sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(200, { success: true, syncRevision: 1 }),
      );
      const coordinator = createSimpleChatSyncCoordinator({
        store: createMemorySimpleChatEnvelopeStore(),
        fetchImpl,
      });
      await coordinator.initialize('user-a');
      vi.stubGlobal('navigator', offlineNavigator());
      coordinator.update([project('offline')]);
      await coordinator.flush('manual');

      expect(coordinator.snapshot().status).toBe('offline');
      expect(countPostRequests(fetchImpl)).toBe(0);
      vi.stubGlobal('navigator', { onLine: true } as Navigator);
      await coordinator.handleOnline();
      expect(coordinator.snapshot().status).toBe('synced');
      expect(countPostRequests(fetchImpl)).toBe(1);
    } finally {
      vi.stubGlobal('navigator', originalNavigator);
    }
  });

  it('uses keepalive for pagehide and only acknowledges a confirmed revision', async () => {
    const calls: RequestInit[] = [];
    const pending = deferred<Response>();
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push(init ?? {});
      if (requestMethod(init) === 'GET') {
        return jsonResponse(200, { success: true, value: [], syncRevision: 0 });
      }
      return await pending.promise;
    };
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('pagehide')]);
    const flush = coordinator.flush('pagehide');

    await vi.waitFor(() => expect(calls.at(-1)?.keepalive).toBe(true));
    expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
    pending.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
    await flush;
    expect(coordinator.snapshot().pendingOperations).toHaveLength(0);
  });

  it('keeps a pagehide batch when the response does not confirm a revision', async () => {
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(200, { success: true }),
      ),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('pagehide')]);
    await coordinator.flush('pagehide');

    expect(coordinator.snapshot().status).toBe('failed');
    expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
  });

  it('persists the old user and isolates state when initialize switches users', async () => {
    const store = createMemorySimpleChatEnvelopeStore();
    await store.put({ ...envelope('user-b'), baseRevision: 3, updatedAt: 3 });
    const coordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(200, { success: true, value: [project('remote-b')], syncRevision: 4 }),
      ),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('private-a')]);

    const userB = await coordinator.initialize('user-b');

    expect((await store.get('user-a'))?.currentProjects).toEqual([project('private-a')]);
    expect(userB.projects).toEqual([project('remote-b')]);
    expect(userB.projects).not.toContainEqual(project('private-a'));
    expect((await store.get('user-b'))?.userId).toBe('user-b');
  });

  it('dispose persists pending work and stops later mutations', async () => {
    const store = createMemorySimpleChatEnvelopeStore();
    const coordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      ),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('before-dispose')]);
    await coordinator.dispose();

    expect((await store.get('user-a'))?.currentProjects).toEqual([project('before-dispose')]);
    expect((await store.get('user-a'))?.pendingOperations).not.toHaveLength(0);
    expect(() => coordinator.update([project('after-dispose')])).toThrow('disposed');
  });

  it('notifies subscribers with snapshots and honors unsubscribe', async () => {
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      ),
    });
    const listener = vi.fn<(snapshot: SimpleChatSyncSnapshot) => void>();
    const unsubscribe = coordinator.subscribe(listener);
    await coordinator.initialize('user-a');
    coordinator.update([project('first')]);
    const callsBeforeUnsubscribe = listener.mock.calls.length;
    unsubscribe();
    coordinator.update([project('second')]);

    expect(callsBeforeUnsubscribe).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'synced' }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ projects: [project('first')] }));
    expect(listener).toHaveBeenCalledTimes(callsBeforeUnsubscribe);
  });

  it.each([
    [
      'non-JSON',
      new Response('<html>upstream failed</html>', {
        status: 502,
        headers: { 'x-request-id': 'req-non-json' },
      }),
      { code: 'CHAT_SYNC_INVALID_RESPONSE', requestId: 'req-non-json' },
    ],
    [
      'malformed success',
      jsonResponse(200, { success: true, syncRevision: 'one' }),
      { code: 'CHAT_SYNC_INVALID_RESPONSE' },
    ],
  ])('marks a %s response failed without losing data', async (_name, response, code) => {
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        response,
      ),
      sleep: vi.fn().mockResolvedValue(undefined),
      jitter: () => 0,
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('preserved')]);
    await coordinator.flush('manual');

    expect(coordinator.snapshot()).toMatchObject({
      status: 'failed',
      projects: [project('preserved')],
      error: code,
    });
    expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
  });

  it('preserves current projects and pending operations after a 413 compaction attempt', async () => {
    const store = createMemorySimpleChatEnvelopeStore();
    const coordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(413, {
          success: false,
          code: 'CHAT_SYNC_PAYLOAD_TOO_LARGE',
          message: 'Payload too large',
          retryable: false,
          requestId: 'req-large',
        }),
      ),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('large')]);
    await coordinator.flush('manual');

    expect(coordinator.snapshot()).toMatchObject({
      status: 'failed',
      projects: [project('large')],
      error: { code: 'CHAT_SYNC_PAYLOAD_TOO_LARGE', requestId: 'req-large' },
    });
    expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
    expect((await store.get('user-a'))?.currentProjects).toEqual([project('large')]);
  });

  it('does not claim synced when durable envelope persistence fails', async () => {
    let stored: SimpleChatSyncEnvelopeV1 | null = null;
    const store: SimpleChatEnvelopeStore = {
      get: async () => stored,
      put: async value => {
        stored = structuredClone(value);
        if (value.pendingOperations.length === 0 && value.baseRevision > 0) {
          throw Object.assign(new Error('quota exceeded'), {
            code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
          });
        }
      },
      delete: async () => undefined,
    };
    const coordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(200, { success: true, syncRevision: 1 }),
      ),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('not-durable')]);
    await coordinator.flush('manual');

    expect(coordinator.snapshot()).toMatchObject({
      status: 'failed',
      error: { code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED', retryable: false },
    });
  });
});
