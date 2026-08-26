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
        jsonResponse(200, { success: true, syncRevision: 1 }),
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

  it('dispose flushes pending work and stops later mutations', async () => {
    const store = createMemorySimpleChatEnvelopeStore();
    const coordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(200, { success: true, syncRevision: 1 }),
      ),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('before-dispose')]);
    await coordinator.dispose();

    expect((await store.get('user-a'))?.currentProjects).toEqual([project('before-dispose')]);
    expect((await store.get('user-a'))?.pendingOperations).toHaveLength(0);
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

  it('does not let an older initialize completion replace the latest user', async () => {
    const userAResponse = deferred<Response>();
    let getCount = 0;
    const fetchImpl: typeof fetch = vi.fn(async () => {
      getCount += 1;
      return getCount === 1
        ? await userAResponse.promise
        : jsonResponse(200, { success: true, value: [project('remote-b')], syncRevision: 2 });
    });
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
    });

    const initializeA = coordinator.initialize('user-a');
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const initializeB = coordinator.initialize('user-b');
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await initializeB;
    coordinator.update([project('private-b')]);
    userAResponse.resolve(
      jsonResponse(200, { success: true, value: [project('remote-a')], syncRevision: 1 }),
    );
    await initializeA;

    expect(coordinator.snapshot()).toMatchObject({
      status: 'syncing',
      projects: [project('private-b')],
    });
  });

  it('serializes network requests across coordinators for the same user', async () => {
    const firstPost = deferred<Response>();
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let postCount = 0;
    const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      try {
        if (requestMethod(init) === 'GET') {
          return jsonResponse(200, { success: true, value: [], syncRevision: 0 });
        }
        postCount += 1;
        return postCount === 1
          ? await firstPost.promise
          : jsonResponse(200, { success: true, syncRevision: 1 });
      } finally {
        activeRequests -= 1;
      }
    });
    const first = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
    });
    const second = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
    });
    await Promise.all([first.initialize('shared-user'), second.initialize('shared-user')]);
    first.update([project('first')]);
    second.update([project('second')]);

    const firstFlush = first.flush('manual');
    const secondFlush = second.flush('manual');
    await vi.waitFor(() => expect(postCount).toBe(1));
    expect(maximumActiveRequests).toBe(1);
    firstPost.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
    await Promise.all([firstFlush, secondFlush]);

    expect(postCount).toBe(2);
    expect(maximumActiveRequests).toBe(1);
  });

  it('limits a mixed conflict recovery flow to three total POST requests', async () => {
    const fetchImpl = sequenceFetch(
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      jsonResponse(409, { code: 'CHAT_SYNC_CONFLICT', currentRevision: 1 }),
      jsonResponse(200, { success: true, value: [], syncRevision: 1 }),
      jsonResponse(503, { code: 'SERVICE_UNAVAILABLE' }),
      jsonResponse(503, { code: 'SERVICE_UNAVAILABLE' }),
      jsonResponse(200, { success: true, syncRevision: 2 }),
    );
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
      sleep: vi.fn().mockResolvedValue(undefined),
      jitter: () => 0,
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('local')]);

    await coordinator.flush('manual');

    expect(countPostRequests(fetchImpl)).toBe(3);
    expect(coordinator.snapshot()).toMatchObject({ status: 'failed' });
    expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
  });

  it.each([429, 500, 502, 503, 504, 'network'])(
    'retries initialize GET failures for %s up to three times',
    async failure => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const failedRead = failure === 'network'
        ? () => Promise.reject(new Error('network unavailable'))
        : () => Promise.resolve(jsonResponse(Number(failure), { code: 'RETRYABLE' }));
      let attempts = 0;
      const fetchImpl: typeof fetch = vi.fn(async () => {
        attempts += 1;
        if (attempts <= 3) return await failedRead();
        return jsonResponse(200, { success: true, value: [project('remote')], syncRevision: 1 });
      });
      const coordinator = createSimpleChatSyncCoordinator({
        store: createMemorySimpleChatEnvelopeStore(),
        fetchImpl,
        sleep,
        jitter: () => 0,
      });

      await coordinator.initialize('user-a');

      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500, 1_000]);
      expect(coordinator.snapshot()).toMatchObject({ status: 'synced', projects: [project('remote')] });
    },
  );

  it('retries a conflict rebase GET before replaying the pending batch', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = sequenceFetch(
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      jsonResponse(409, { code: 'CHAT_SYNC_CONFLICT', currentRevision: 1 }),
      jsonResponse(503, { code: 'SERVICE_UNAVAILABLE' }),
      jsonResponse(502, { code: 'BAD_GATEWAY' }),
      jsonResponse(200, { success: true, value: [], syncRevision: 1 }),
      jsonResponse(200, { success: true, syncRevision: 2 }),
    );
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
      sleep,
      jitter: () => 0,
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('local')]);

    await coordinator.flush('manual');

    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 500]);
    expect(coordinator.snapshot()).toMatchObject({ status: 'synced', pendingOperations: [] });
  });

  it('retries a failed authoritative initialize read through handleOnline without pending work', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let attempts = 0;
    const fetchImpl: typeof fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts <= 4) return jsonResponse(503, { code: 'SERVICE_UNAVAILABLE' });
      return jsonResponse(200, { success: true, value: [project('recovered')], syncRevision: 3 });
    });
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
      sleep,
      jitter: () => 0,
    });
    await coordinator.initialize('user-a');
    expect(coordinator.snapshot()).toMatchObject({ status: 'failed', projects: [] });

    await coordinator.handleOnline();

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(coordinator.snapshot()).toMatchObject({
      status: 'synced',
      projects: [project('recovered')],
    });
  });

  it('restores the acknowledged in-memory envelope when the atomic store write fails', async () => {
    let stored: SimpleChatSyncEnvelopeV1 | null = null;
    let rejectAcknowledgement = true;
    const store: SimpleChatEnvelopeStore = {
      get: async () => structuredClone(stored),
      put: async value => {
        if (
          rejectAcknowledgement
          && value.baseRevision === 1
          && value.pendingOperations.length === 0
        ) {
          rejectAcknowledgement = false;
          throw new Error('atomic transaction rejected');
        }
        stored = structuredClone(value);
      },
      delete: async () => undefined,
    };
    const fetchImpl = sequenceFetch(
      jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      jsonResponse(200, { success: true, syncRevision: 1 }),
      jsonResponse(409, { code: 'CHAT_SYNC_CONFLICT', currentRevision: 1 }),
      jsonResponse(200, { success: true, value: [project('local')], syncRevision: 1 }),
    );
    const coordinator = createSimpleChatSyncCoordinator({ store, fetchImpl });
    await coordinator.initialize('user-a');
    coordinator.update([project('local')]);

    await coordinator.flush('manual');

    expect(coordinator.snapshot()).toMatchObject({
      status: 'failed',
      projects: [project('local')],
    });
    expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
    expect((stored as SimpleChatSyncEnvelopeV1 | null)?.pendingOperations).not.toHaveLength(0);

    await coordinator.flush('manual');
    expect(coordinator.snapshot()).toMatchObject({ status: 'synced', pendingOperations: [] });
  });

  it('keeps the active envelope when the next user store read fails', async () => {
    const memoryStore = createMemorySimpleChatEnvelopeStore();
    const store: SimpleChatEnvelopeStore = {
      get: async userId => {
        if (userId === 'user-b') throw new Error('indexeddb unavailable');
        return await memoryStore.get(userId);
      },
      put: value => memoryStore.put(value),
      delete: userId => memoryStore.delete(userId),
    };
    const coordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      ),
      sleep: vi.fn().mockResolvedValue(undefined),
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('private-a')]);

    const failedSwitch = await coordinator.initialize('user-b');

    expect(failedSwitch).toMatchObject({
      status: 'failed',
      projects: [project('private-a')],
    });
    expect(failedSwitch.pendingOperations).not.toHaveLength(0);
    expect(await memoryStore.get('user-b')).toBeNull();
  });

  it('queues pagehide work added during an active flush and preserves keepalive', async () => {
    const firstPost = deferred<Response>();
    const postCalls: RequestInit[] = [];
    const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
      if (requestMethod(init) === 'GET') {
        return jsonResponse(200, { success: true, value: [], syncRevision: 0 });
      }
      postCalls.push(init ?? {});
      return postCalls.length === 1
        ? await firstPost.promise
        : jsonResponse(200, { success: true, syncRevision: 2 });
    });
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
    });
    await coordinator.initialize('user-a');
    coordinator.update([project('first')]);
    const manualFlush = coordinator.flush('manual');
    await vi.waitFor(() => expect(postCalls).toHaveLength(1));
    coordinator.update([project('first'), project('second')]);
    const pagehideFlush = coordinator.flush('pagehide');

    firstPost.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
    await Promise.all([manualFlush, pagehideFlush]);

    expect(postCalls).toHaveLength(2);
    expect(postCalls[1]?.keepalive).toBe(true);
    expect(coordinator.snapshot().pendingOperations).toHaveLength(0);
  });

  it.each(['logout', 'dispose'] as const)(
    'bounds %s network waiting, aborts fetch, and keeps pending operations',
    async lifecycle => {
      vi.useFakeTimers();
      try {
        let requestSignal: AbortSignal | undefined;
        const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
          if (requestMethod(init) === 'GET') {
            return jsonResponse(200, { success: true, value: [], syncRevision: 0 });
          }
          requestSignal = init?.signal ?? undefined;
          return await new Promise<Response>((_resolve, reject) => {
            requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
          });
        });
        const coordinator = createSimpleChatSyncCoordinator({
          store: createMemorySimpleChatEnvelopeStore(),
          fetchImpl,
        });
        await coordinator.initialize('user-a');
        coordinator.update([project('pending')]);

        const lifecyclePromise = lifecycle === 'logout'
          ? coordinator.flush('logout')
          : coordinator.dispose();
        await vi.waitFor(() => expect(requestSignal).toBeDefined());
        await vi.advanceTimersByTimeAsync(5_000);
        await lifecyclePromise;

        expect(requestSignal?.aborted).toBe(true);
        expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('bounds lifecycle waiting behind another coordinator mutex without posting', async () => {
    vi.useFakeTimers();
    const firstPost = deferred<Response>();
    let firstFlush: Promise<void> | undefined;
    let lifecycleFlush: Promise<void> | undefined;
    try {
      let postCount = 0;
      const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
        if (requestMethod(init) === 'GET') {
          return jsonResponse(200, { success: true, value: [], syncRevision: 0 });
        }
        postCount += 1;
        return postCount === 1
          ? await firstPost.promise
          : jsonResponse(200, { success: true, syncRevision: 1 });
      });
      const first = createSimpleChatSyncCoordinator({
        store: createMemorySimpleChatEnvelopeStore(),
        fetchImpl,
        lifecycleTimeoutMs: 50,
      });
      const second = createSimpleChatSyncCoordinator({
        store: createMemorySimpleChatEnvelopeStore(),
        fetchImpl,
        lifecycleTimeoutMs: 50,
      });
      await Promise.all([first.initialize('shared-user'), second.initialize('shared-user')]);
      first.update([project('first')]);
      second.update([project('second')]);
      firstFlush = first.flush('manual');
      await vi.waitFor(() => expect(postCount).toBe(1));

      let lifecycleSettled = false;
      lifecycleFlush = second.flush('logout').then(() => {
        lifecycleSettled = true;
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(lifecycleSettled).toBe(true);
      expect(postCount).toBe(1);
      expect(second.snapshot().pendingOperations).not.toHaveLength(0);

      firstPost.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
      await Promise.all([firstFlush, lifecycleFlush]);
    } finally {
      firstPost.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
      await Promise.all([firstFlush, lifecycleFlush].filter(
        (promise): promise is Promise<void> => promise !== undefined,
      ));
      vi.useRealTimers();
    }
  });

  it('bounds lifecycle persistence waiting without acknowledging or posting', async () => {
    vi.useFakeTimers();
    const pendingPut = deferred<void>();
    let lifecycleFlush: Promise<void> | undefined;
    try {
      const memoryStore = createMemorySimpleChatEnvelopeStore();
      const store: SimpleChatEnvelopeStore = {
        get: userId => memoryStore.get(userId),
        put: async value => {
          if (value.pendingOperations.length > 0) await pendingPut.promise;
          await memoryStore.put(value);
        },
        delete: userId => memoryStore.delete(userId),
      };
      const fetchImpl = sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      );
      const coordinator = createSimpleChatSyncCoordinator({
        store,
        fetchImpl,
        lifecycleTimeoutMs: 50,
      });
      await coordinator.initialize('user-a');
      coordinator.update([project('pending')]);

      let lifecycleSettled = false;
      lifecycleFlush = coordinator.flush('logout').then(() => {
        lifecycleSettled = true;
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(lifecycleSettled).toBe(true);
      expect(countPostRequests(fetchImpl)).toBe(0);
      expect(coordinator.snapshot()).toMatchObject({
        status: 'failed',
        error: { code: 'CHAT_SYNC_LIFECYCLE_TIMEOUT' },
      });
      expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);

      pendingPut.resolve();
      await lifecycleFlush;
    } finally {
      pendingPut.resolve();
      await lifecycleFlush;
      vi.useRealTimers();
    }
  });

  it('restores durable pending operations when an acknowledgement put finishes after timeout', async () => {
    vi.useFakeTimers();
    const acknowledgementPut = deferred<void>();
    const acknowledgementFinished = deferred<void>();
    try {
      let stored: SimpleChatSyncEnvelopeV1 | null = null;
      const store: SimpleChatEnvelopeStore = {
        get: async () => structuredClone(stored),
        put: async value => {
          if (value.baseRevision === 1 && value.pendingOperations.length === 0) {
            await acknowledgementPut.promise;
            stored = structuredClone(value);
            acknowledgementFinished.resolve();
            return;
          }
          stored = structuredClone(value);
        },
        delete: async () => {
          stored = null;
        },
      };
      const coordinator = createSimpleChatSyncCoordinator({
        store,
        fetchImpl: sequenceFetch(
          jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
          jsonResponse(200, { success: true, syncRevision: 1 }),
        ),
        lifecycleTimeoutMs: 50,
      });
      await coordinator.initialize('user-a');
      coordinator.update([project('pending')]);
      const lifecycleFlush = coordinator.flush('logout');
      await vi.advanceTimersByTimeAsync(50);
      await lifecycleFlush;

      expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);
      acknowledgementPut.resolve();
      await acknowledgementFinished.promise;
      await vi.waitFor(() => {
        expect((stored as SimpleChatSyncEnvelopeV1 | null)?.pendingOperations).not.toHaveLength(0);
      });
      expect(coordinator.snapshot().status).toBe('failed');
    } finally {
      acknowledgementPut.resolve();
      vi.useRealTimers();
    }
  });

  it('cancels lifecycle backoff and never starts a later POST', async () => {
    vi.useFakeTimers();
    const pendingSleep = deferred<void>();
    let lifecycleFlush: Promise<void> | undefined;
    try {
      const fetchImpl = sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
        jsonResponse(503, { success: false, code: 'SERVICE_UNAVAILABLE' }),
        jsonResponse(200, { success: true, syncRevision: 1 }),
      );
      const sleep = vi.fn(() => pendingSleep.promise);
      const coordinator = createSimpleChatSyncCoordinator({
        store: createMemorySimpleChatEnvelopeStore(),
        fetchImpl,
        sleep,
        jitter: () => 0,
        lifecycleTimeoutMs: 50,
      });
      await coordinator.initialize('user-a');
      coordinator.update([project('pending')]);

      let lifecycleSettled = false;
      lifecycleFlush = coordinator.flush('logout').then(() => {
        lifecycleSettled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(sleep).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(50);

      expect(lifecycleSettled).toBe(true);
      expect(countPostRequests(fetchImpl)).toBe(1);
      expect(coordinator.snapshot().pendingOperations).not.toHaveLength(0);

      pendingSleep.resolve();
      await lifecycleFlush;
      expect(countPostRequests(fetchImpl)).toBe(1);
    } finally {
      pendingSleep.resolve();
      await lifecycleFlush;
      vi.useRealTimers();
    }
  });

  it('aborts a replaced initialize GET and releases its user mutex', async () => {
    const staleRead = deferred<Response>();
    let staleSignal: AbortSignal | undefined;
    let requestCount = 0;
    const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        staleSignal = init?.signal ?? undefined;
        return await staleRead.promise;
      }
      return jsonResponse(200, {
        success: true,
        value: [project(requestCount === 2 ? 'remote-b' : 'fresh-a')],
        syncRevision: 1,
      });
    });
    const staleCoordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
    });
    const nextCoordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl,
    });

    const initializeA = staleCoordinator.initialize('user-a');
    let initializeB: Promise<SimpleChatSyncSnapshot> | undefined;
    let nextA: Promise<SimpleChatSyncSnapshot> | undefined;
    try {
      await vi.waitFor(() => expect(staleSignal).toBeDefined());
      initializeB = staleCoordinator.initialize('user-b');
      await initializeB;
      nextA = nextCoordinator.initialize('user-a');
      await Promise.resolve();
      await Promise.resolve();

      expect(staleSignal?.aborted).toBe(true);
      expect(await nextA).toMatchObject({ status: 'synced', projects: [project('fresh-a')] });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      await initializeA;
    } finally {
      staleRead.resolve(jsonResponse(200, { success: true, value: [], syncRevision: 0 }));
      await Promise.all([initializeA, initializeB, nextA].filter(
        (promise): promise is Promise<SimpleChatSyncSnapshot> => promise !== undefined,
      ));
    }
  });

  it('does not let an invalidated candidate put overwrite newer same-user data', async () => {
    const stalePut = deferred<void>();
    const stored = new Map<string, SimpleChatSyncEnvelopeV1>();
    let blockStaleCandidate = true;
    const store: SimpleChatEnvelopeStore = {
      get: async userId => structuredClone(stored.get(userId) ?? null),
      put: async value => {
        if (blockStaleCandidate && value.userId === 'user-a') {
          blockStaleCandidate = false;
          await stalePut.promise;
        }
        stored.set(value.userId, structuredClone(value));
      },
      delete: async userId => {
        stored.delete(userId);
      },
    };
    const staleCoordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [project('stale-a')], syncRevision: 1 }),
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      ),
    });
    const freshSequence = sequenceFetch(
      jsonResponse(200, { success: true, value: [project('fresh-a')], syncRevision: 2 }),
    );
    const freshFetch: typeof fetch = vi.fn((input, init) => freshSequence(input, init));
    const freshCoordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: freshFetch,
    });

    const staleInitialize = staleCoordinator.initialize('user-a');
    let switchInitialize: Promise<SimpleChatSyncSnapshot> | undefined;
    let freshInitialize: Promise<SimpleChatSyncSnapshot> | undefined;
    try {
      await vi.waitFor(() => expect(blockStaleCandidate).toBe(false));
      switchInitialize = staleCoordinator.initialize('user-b');
      freshInitialize = freshCoordinator.initialize('user-a');
      await vi.waitFor(() => expect(freshFetch).toHaveBeenCalledTimes(1));
      await new Promise(resolve => setTimeout(resolve, 0));
      stalePut.resolve();
      await Promise.all([staleInitialize, switchInitialize, freshInitialize]);

      expect((await store.get('user-a'))?.currentProjects).toEqual([project('fresh-a')]);
    } finally {
      stalePut.resolve();
      await Promise.all([staleInitialize, switchInitialize, freshInitialize].filter(
        (promise): promise is Promise<SimpleChatSyncSnapshot> => promise !== undefined,
      ));
    }
  });

  it('restores the prior same-user envelope when a started candidate put becomes stale', async () => {
    const stalePut = deferred<void>();
    const prior = { ...envelope('user-a'), currentProjects: [project('prior-a')] };
    const stored = new Map<string, SimpleChatSyncEnvelopeV1>([['user-a', structuredClone(prior)]]);
    let candidateStarted = false;
    const store: SimpleChatEnvelopeStore = {
      get: async userId => structuredClone(stored.get(userId) ?? null),
      put: async value => {
        if (!candidateStarted && value.userId === 'user-a') {
          candidateStarted = true;
          await stalePut.promise;
        }
        stored.set(value.userId, structuredClone(value));
      },
      delete: async userId => {
        stored.delete(userId);
      },
    };
    const coordinator = createSimpleChatSyncCoordinator({
      store,
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [project('stale-a')], syncRevision: 1 }),
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      ),
    });

    const staleInitialize = coordinator.initialize('user-a');
    await vi.waitFor(() => expect(candidateStarted).toBe(true));
    const switchInitialize = coordinator.initialize('user-b');
    stalePut.resolve();
    await Promise.all([staleInitialize, switchInitialize]);

    expect((await store.get('user-a'))?.currentProjects).toEqual([project('prior-a')]);
  });

  it.each(['logout', 'dispose', 'user-switch'] as const)(
    'preserves pagehide keepalive when a queued batch also receives %s',
    async lifecycle => {
      const firstPost = deferred<Response>();
      const postCalls: RequestInit[] = [];
      const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
        if (requestMethod(init) === 'GET') {
          return jsonResponse(200, { success: true, value: [], syncRevision: 0 });
        }
        postCalls.push(init ?? {});
        return postCalls.length === 1
          ? await firstPost.promise
          : jsonResponse(200, { success: true, syncRevision: 2 });
      });
      const coordinator = createSimpleChatSyncCoordinator({
        store: createMemorySimpleChatEnvelopeStore(),
        fetchImpl,
      });
      await coordinator.initialize('user-a');
      coordinator.update([project('first')]);
      const firstFlush = coordinator.flush('manual');
      await vi.waitFor(() => expect(postCalls).toHaveLength(1));
      coordinator.update([project('first'), project('second')]);

      const pagehideFlush = coordinator.flush('pagehide');
      const lifecycleFlush = lifecycle === 'dispose'
        ? coordinator.dispose()
        : lifecycle === 'user-switch'
          ? coordinator.initialize('user-b').then(() => undefined)
          : coordinator.flush('logout');
      firstPost.resolve(jsonResponse(200, { success: true, syncRevision: 1 }));
      await Promise.all([firstFlush, pagehideFlush, lifecycleFlush]);

      expect(postCalls).toHaveLength(2);
      expect(postCalls[1]?.keepalive).toBe(true);
      expect(postCalls[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(coordinator.snapshot().pendingOperations).toHaveLength(0);
    },
  );

  it('isolates mutable snapshots between subscribers', async () => {
    const coordinator = createSimpleChatSyncCoordinator({
      store: createMemorySimpleChatEnvelopeStore(),
      fetchImpl: sequenceFetch(
        jsonResponse(200, { success: true, value: [], syncRevision: 0 }),
      ),
    });
    coordinator.subscribe(next => {
      next.projects.push(project('listener-mutation'));
    });
    const secondListener = vi.fn<(snapshot: SimpleChatSyncSnapshot) => void>();
    coordinator.subscribe(secondListener);

    await coordinator.initialize('user-a');

    expect(secondListener).toHaveBeenLastCalledWith(expect.objectContaining({ projects: [] }));
  });
});
