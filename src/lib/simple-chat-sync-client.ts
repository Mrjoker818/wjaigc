import type { SimpleChatProject } from '@/components/simple-chat/simple-chat-types';
import { recoverInterruptedSimpleChatProjects } from '@/components/simple-chat/simple-chat-types';
import {
  acknowledgeSimpleChatOperations,
  compactSimpleChatOperations,
  diffSimpleChatProjects,
  replaySimpleChatOperations,
  type SimpleChatSyncEnvelopeV1,
  type SimpleChatSyncOperation,
  type SimpleChatSyncedProject,
} from '@/lib/simple-chat-project-sync';
import type { SimpleChatEnvelopeStore } from '@/lib/simple-chat-sync-storage';

const SIMPLE_CHAT_SYNC_URL = '/api/user-data/sync';
const SIMPLE_CHAT_SYNC_KEY = 'chat_simple_projects';
const DEBOUNCE_MILLISECONDS = 800;
const RETRY_BASE_MILLISECONDS = 250;
const MAX_TRANSIENT_RETRIES = 3;
const MAX_CONFLICT_REPLAYS = 2;
const LIFECYCLE_TIMEOUT_MILLISECONDS = 5_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export type SimpleChatSyncStatus =
  | 'loading'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'failed'
  | 'conflict';

export interface SimpleChatSyncError {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
}

export interface SimpleChatSyncSnapshot {
  status: SimpleChatSyncStatus;
  projects: SimpleChatProject[];
  pendingOperations: SimpleChatSyncOperation[];
  error: SimpleChatSyncError | null;
}

export interface SimpleChatSyncCoordinator {
  initialize(userId: string): Promise<SimpleChatSyncSnapshot>;
  update(projects: SimpleChatProject[]): void;
  flush(reason: SimpleChatSyncFlushReason): Promise<void>;
  handleOnline(): Promise<void>;
  snapshot(): SimpleChatSyncSnapshot;
  subscribe(listener: (snapshot: SimpleChatSyncSnapshot) => void): () => void;
  dispose(options?: { flush?: boolean }): Promise<void>;
}

export type SimpleChatSyncFlushReason =
  | 'debounce'
  | 'manual'
  | 'pagehide'
  | 'logout'
  | 'user-switch';

export interface SimpleChatSyncCoordinatorOptions {
  store: SimpleChatEnvelopeStore;
  fetchImpl?: typeof fetch;
  createId?: () => string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  jitter?: () => number;
  lifecycleTimeoutMs?: number;
}

interface SyncSuccessBody {
  success: true;
  syncRevision: number;
}

interface SyncReadBody extends SyncSuccessBody {
  value: SimpleChatProject[];
}

interface SyncErrorBody {
  success?: false;
  code?: string;
  message?: string;
  requestId?: string;
  retryable?: boolean;
  currentRevision?: number;
}

interface FrozenBatch {
  userId: string;
  operationIds: string[];
  projects: SimpleChatProject[];
  expectedRevision: number;
}

type InternalFlushReason = SimpleChatSyncFlushReason | 'dispose';

interface FlushCapabilities {
  keepalive: boolean;
  lifecycle: boolean;
}

interface UserNetworkLock {
  tail: Promise<void>;
  queued: number;
}

const userNetworkLocks = new Map<string, UserNetworkLock>();
const userPersistenceLocks = new Map<string, UserNetworkLock>();

async function withUserLock<T>(
  locks: Map<string, UserNetworkLock>,
  userId: string,
  signal: AbortSignal | undefined,
  request: () => Promise<T>,
): Promise<T> {
  const current = locks.get(userId);
  const previous = current?.tail ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const lock = current ?? { tail: Promise.resolve(), queued: 0 };
  lock.queued += 1;
  lock.tail = previous.catch(() => undefined).then(() => gate);
  locks.set(userId, lock);

  try {
    await waitWithSignal(previous.catch(() => undefined), signal);
    throwIfAborted(signal);
    return await request();
  } finally {
    release();
    lock.queued -= 1;
    if (lock.queued === 0 && locks.get(userId) === lock) {
      locks.delete(userId);
    }
  }
}

function withUserNetworkLock<T>(
  userId: string,
  signal: AbortSignal | undefined,
  request: () => Promise<T>,
): Promise<T> {
  return withUserLock(userNetworkLocks, userId, signal, request);
}

function withUserPersistenceLock<T>(
  userId: string,
  signal: AbortSignal | undefined,
  request: () => Promise<T>,
): Promise<T> {
  return withUserLock(userPersistenceLocks, userId, signal, request);
}

export function createSimpleChatSyncCoordinator(
  options: SimpleChatSyncCoordinatorOptions,
): SimpleChatSyncCoordinator {
  const fetchImpl = options.fetchImpl ?? fetch;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const jitter = options.jitter ?? Math.random;
  const lifecycleTimeoutMs = options.lifecycleTimeoutMs ?? LIFECYCLE_TIMEOUT_MILLISECONDS;
  const listeners = new Set<(snapshot: SimpleChatSyncSnapshot) => void>();

  let status: SimpleChatSyncStatus = 'loading';
  let error: SimpleChatSyncError | null = null;
  let envelope: SimpleChatSyncEnvelopeV1 | null = null;
  let flushDrain: Promise<void> | null = null;
  let queuedFlush: FlushCapabilities | null = null;
  let persistenceQueue: Promise<boolean> = Promise.resolve(true);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let automaticSyncBlocked = false;
  let initializeGeneration = 0;
  let initializeTargetUserId: string | null = null;
  let initializeInProgressGeneration: number | null = null;
  let authoritativeReadPending = false;
  let initializeController: AbortController | null = null;
  const activeRequestControllers = new Set<AbortController>();
  let flushDrainController: AbortController | null = null;
  let lifecycleTimeout: ReturnType<typeof setTimeout> | null = null;
  let lifecycleTimedOut = false;
  let envelopeMutationVersion = 0;

  function snapshot(): SimpleChatSyncSnapshot {
    return cloneValue({
      status,
      projects: envelope?.currentProjects ?? [],
      pendingOperations: envelope?.pendingOperations ?? [],
      error,
    });
  }

  function emit(): void {
    for (const listener of listeners) listener(snapshot());
  }

  function setState(
    nextStatus: SimpleChatSyncStatus,
    nextError: SimpleChatSyncError | null = null,
    force = false,
  ): void {
    if (!force && initializeInProgressGeneration !== null && nextStatus !== 'loading') return;
    status = nextStatus;
    error = nextError;
    emit();
  }

  function clearDebounce(): void {
    if (debounceTimer === null) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  function scheduleDebounce(): void {
    clearDebounce();
    if (
      disposed
      || automaticSyncBlocked
      || envelope === null
      || envelope.pendingOperations.length === 0
    ) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void flush('debounce');
    }, DEBOUNCE_MILLISECONDS);
  }

  function enqueueEnvelopePersistence(): Promise<boolean> {
    return envelope === null ? Promise.resolve(true) : enqueuePersistence(envelope);
  }

  function enqueuePersistence(
    input: SimpleChatSyncEnvelopeV1,
    shouldReportFailure: () => boolean = () => true,
    isValid: () => boolean = () => true,
    restoreWhenInvalid?: () => SimpleChatSyncEnvelopeV1 | null,
  ): Promise<boolean> {
    const value = cloneValue(input);
    persistenceQueue = persistenceQueue
      .catch(() => false)
      .then(async () => {
        try {
          return await withUserPersistenceLock(value.userId, undefined, async () => {
            if (!isValid()) return false;
            await options.store.put(value);
            if (isValid()) return true;
            if (restoreWhenInvalid !== undefined) {
              const fallback = restoreWhenInvalid();
              if (fallback === null) await options.store.delete(value.userId);
              else await options.store.put(cloneValue(fallback));
            }
            return false;
          });
        } catch {
          if (shouldReportFailure()) setState('failed', localStorageError());
          return false;
        }
      });
    return persistenceQueue;
  }

  async function persistInitializationCandidate(
    input: SimpleChatSyncEnvelopeV1,
    fallback: SimpleChatSyncEnvelopeV1 | null,
    generation: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    const value = cloneValue(input);
    const persistence = withUserPersistenceLock(value.userId, signal, async () => {
      if (!isCurrentInitialization(generation, value.userId) || signal.aborted) return false;
      await options.store.put(value);
      if (isCurrentInitialization(generation, value.userId) && !signal.aborted) return true;
      if (fallback === null) await options.store.delete(value.userId);
      else await options.store.put(cloneValue(fallback));
      return false;
    }).catch(() => false);
    return await waitWithSignal(persistence, signal);
  }

  async function initialize(userId: string): Promise<SimpleChatSyncSnapshot> {
    assertUsable();
    if (userId.length === 0) throw new Error('Simple chat sync requires a user id');

    initializeController?.abort(createAbortError('Simple chat sync initialization was replaced'));
    const controller = new AbortController();
    initializeController = controller;
    const generation = ++initializeGeneration;
    initializeTargetUserId = userId;
    initializeInProgressGeneration = generation;
    authoritativeReadPending = true;
    clearDebounce();
    setState('loading', null, true);
    try {
      if (envelope !== null && envelope.pendingOperations.length > 0) {
        await waitWithSignal(queueFlush('user-switch'), controller.signal);
      } else if (flushDrain !== null) {
        await waitWithSignal(flushDrain, controller.signal);
      }
    } catch {
      if (controller.signal.aborted) return snapshot();
      throw new Error('Simple chat sync initialization wait failed');
    }
    if (!isCurrentInitialization(generation, userId)) return snapshot();
    if (envelope !== null) {
      try {
        if (!await waitWithSignal(enqueueEnvelopePersistence(), controller.signal)) {
          finishInitialization(generation, userId, 'failed', localStorageError());
          return snapshot();
        }
      } catch {
        if (controller.signal.aborted) return snapshot();
        finishInitialization(generation, userId, 'failed', localStorageError());
        return snapshot();
      }
    }
    if (!isCurrentInitialization(generation, userId)) return snapshot();

    let localEnvelope: SimpleChatSyncEnvelopeV1 | null;
    try {
      localEnvelope = await waitWithSignal(options.store.get(userId), controller.signal);
    } catch {
      if (controller.signal.aborted) return snapshot();
      finishInitialization(generation, userId, 'failed', localStorageError());
      return snapshot();
    }
    if (!isCurrentInitialization(generation, userId)) return snapshot();

    if (localEnvelope !== null && localEnvelope.userId !== userId) {
      finishInitialization(generation, userId, 'failed', {
        code: 'CHAT_SYNC_USER_MISMATCH',
        message: 'Stored simple chat data belongs to a different user',
        retryable: false,
      });
      return snapshot();
    }

    const remote = await readRemoteSnapshot(
      userId,
      () => isCurrentInitialization(generation, userId),
      controller.signal,
    );
    if (!isCurrentInitialization(generation, userId)) return snapshot();
    if (!remote.ok) {
      finishInitialization(generation, userId, remote.offline ? 'offline' : 'failed', remote.error);
      return snapshot();
    }

    const pendingOperations = cloneValue(localEnvelope?.pendingOperations ?? []);
    const replayed = pendingOperations.length === 0
      ? cloneValue(remote.body.value)
      : replaySimpleChatOperations(remote.body.value, pendingOperations, {
        createId,
        now,
        localProjects: localEnvelope?.currentProjects ?? [],
      }).projects;

    const candidate: SimpleChatSyncEnvelopeV1 = {
      schemaVersion: 1,
      userId,
      baseRevision: remote.body.syncRevision,
      baseProjects: cloneValue(remote.body.value) as SimpleChatSyncedProject[],
      currentProjects: recoverInterruptedSimpleChatProjects(replayed) as SimpleChatSyncedProject[],
      pendingOperations,
      updatedAt: now(),
    };

    try {
      if (!await persistInitializationCandidate(
        candidate,
        localEnvelope,
        generation,
        controller.signal,
      )) {
        if (controller.signal.aborted) return snapshot();
        finishInitialization(generation, userId, 'failed', localStorageError());
        return snapshot();
      }
    } catch {
      if (controller.signal.aborted) return snapshot();
      finishInitialization(generation, userId, 'failed', localStorageError());
      return snapshot();
    }
    if (!isCurrentInitialization(generation, userId)) return snapshot();
    envelope = candidate;
    envelopeMutationVersion += 1;
    automaticSyncBlocked = false;
    authoritativeReadPending = false;
    finishInitialization(generation, userId, pendingOperations.length === 0 ? 'synced' : 'syncing');
    if (pendingOperations.length > 0) scheduleDebounce();
    if (initializeController === controller) initializeController = null;
    return snapshot();
  }

  function isCurrentInitialization(generation: number, userId: string): boolean {
    return initializeGeneration === generation && initializeTargetUserId === userId && !disposed;
  }

  function finishInitialization(
    generation: number,
    userId: string,
    nextStatus: SimpleChatSyncStatus,
    nextError: SimpleChatSyncError | null = null,
  ): void {
    if (!isCurrentInitialization(generation, userId)) return;
    initializeInProgressGeneration = null;
    setState(nextStatus, nextError, true);
  }

  function update(projects: SimpleChatProject[]): void {
    assertUsable();
    if (envelope === null) throw new Error('Simple chat sync coordinator is not initialized');

    const sequenceStart = envelope.pendingOperations.reduce(
      (maximum, operation) => Math.max(maximum, operation.sequence + 1),
      0,
    );
    const operations = diffSimpleChatProjects(
      envelope.currentProjects,
      projects,
      sequenceStart,
      { createOperationId: createId },
    );
    envelope.currentProjects = cloneValue(projects) as SimpleChatSyncedProject[];
    envelope.pendingOperations = compactSimpleChatOperations([
      ...envelope.pendingOperations,
      ...operations,
    ]);
    envelope.updatedAt = now();
    envelopeMutationVersion += 1;
    if (!automaticSyncBlocked) {
      error = null;
      status = isOffline() ? 'offline' : envelope.pendingOperations.length === 0 ? 'synced' : 'syncing';
    }
    emit();
    void enqueueEnvelopePersistence();
    scheduleDebounce();
  }

  function flush(reason: SimpleChatSyncFlushReason): Promise<void> {
    return queueFlush(reason);
  }

  function queueFlush(reason: InternalFlushReason): Promise<void> {
    if (disposed) return Promise.resolve();
    clearDebounce();
    queuedFlush = mergeFlushCapabilities(queuedFlush, reason);
    if (queuedFlush.lifecycle) startLifecycleTimeout();
    if (flushDrain === null) {
      flushDrainController = new AbortController();
      const drainController = flushDrainController;
      flushDrain = drainFlushQueue(drainController.signal).finally(() => {
        flushDrain = null;
        if (flushDrainController === drainController) flushDrainController = null;
        stopLifecycleTimeout();
      });
    }
    return flushDrain;
  }

  async function drainFlushQueue(signal: AbortSignal): Promise<void> {
    while (queuedFlush !== null && !signal.aborted) {
      const capabilities = queuedFlush;
      queuedFlush = null;
      const batch = envelope === null || envelope.pendingOperations.length === 0
        ? null
        : freezeBatch(envelope);
      await performFlush(capabilities, batch, signal);
    }
    if (signal.aborted) queuedFlush = null;
  }

  async function performFlush(
    capabilities: FlushCapabilities,
    initialBatch: FrozenBatch | null,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      throwIfAborted(signal);
      if (
        !await waitWithSignal(persistenceQueue, signal)
        && !await waitWithSignal(enqueueEnvelopePersistence(), signal)
      ) return;
    } catch {
      if (signal.aborted) setState('failed', lifecycleTimeoutError());
      return;
    }
    if (envelope === null || initialBatch === null || envelope.userId !== initialBatch.userId) {
      if (envelope !== null && status !== 'failed') setState('synced');
      return;
    }
    if (isOffline()) {
      setState('offline', {
        code: 'CHAT_SYNC_OFFLINE',
        message: 'Simple chat sync is waiting for a network connection',
        retryable: true,
      });
      await awaitFlushPersistence(enqueueEnvelopePersistence(), signal);
      return;
    }

    if (lifecycleTimedOut || signal.aborted) {
      setState('failed', lifecycleTimeoutError());
      return;
    }

    setState('syncing');
    let batch = initialBatch;
    let transientRetries = 0;
    let conflictReplays = 0;
    let postAttempts = 0;
    let conflictSeen = false;

    while (true) {
      if (signal.aborted) {
        setState('failed', lifecycleTimeoutError());
        return;
      }
      let response: Response;
      const requestController = createLinkedAbortController([signal]);
      activeRequestControllers.add(requestController.controller);
      try {
        postAttempts += 1;
        response = await withUserNetworkLock(batch.userId, requestController.controller.signal, () => abortableFetch(
          fetchImpl(SIMPLE_CHAT_SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: SIMPLE_CHAT_SYNC_KEY,
              value: batch.projects,
              expectedRevision: batch.expectedRevision,
            }),
            credentials: 'include',
            signal: requestController.controller.signal,
            ...(capabilities.keepalive ? { keepalive: true } : {}),
          }),
          requestController.controller.signal,
        ));
      } catch {
        if (lifecycleTimedOut || signal.aborted) {
          setState('failed', lifecycleTimeoutError());
          return;
        }
        if (isOffline()) {
          setState('offline', {
            code: 'CHAT_SYNC_OFFLINE',
            message: 'Simple chat sync is waiting for a network connection',
            retryable: true,
          });
          await awaitFlushPersistence(enqueueEnvelopePersistence(), signal);
          return;
        }
        if (canRetryPost(postAttempts, conflictSeen, transientRetries)) {
          try {
            await waitForRetry(transientRetries++, signal);
          } catch {
            if (signal.aborted) setState('failed', lifecycleTimeoutError());
            return;
          }
          continue;
        }
        setState('failed', {
          code: 'CHAT_SYNC_NETWORK_FAILED',
          message: 'Simple chat sync network request failed',
          retryable: true,
        });
        await awaitFlushPersistence(enqueueEnvelopePersistence(), signal);
        return;
      } finally {
        activeRequestControllers.delete(requestController.controller);
        requestController.cleanup();
      }

      let parsed: Awaited<ReturnType<typeof parseJson>>;
      try {
        parsed = await waitWithSignal(parseJson(response), signal);
      } catch {
        if (signal.aborted) {
          void response.body?.cancel().catch(() => undefined);
          setState('failed', lifecycleTimeoutError());
        }
        return;
      }
      if (!parsed.ok) {
        setState('failed', invalidResponseError(response));
        await awaitFlushPersistence(enqueueEnvelopePersistence(), signal);
        return;
      }

      if (response.ok) {
        if (!isWriteSuccess(parsed.value, batch.expectedRevision)) {
          setState('failed', invalidResponseError(response, parsed.value));
          await awaitFlushPersistence(enqueueEnvelopePersistence(), signal);
          return;
        }
        if (envelope === null || envelope.userId !== batch.userId) return;
        const mutationVersion = envelopeMutationVersion;
        const pendingEnvelope = cloneValue(envelope);
        let acknowledged = acknowledgeEnvelope(envelope, batch, parsed.value.syncRevision, createId, now);
        const persisted = await awaitFlushPersistence(enqueuePersistence(
          acknowledged,
          () => true,
          () => !signal.aborted,
          () => envelope?.userId === batch.userId ? envelope : pendingEnvelope,
        ), signal);
        if (!persisted) return;
        if (envelope === null || envelope.userId !== batch.userId) return;
        if (envelopeMutationVersion !== mutationVersion) {
          acknowledged = acknowledgeEnvelope(envelope, batch, parsed.value.syncRevision, createId, now);
          if (!await awaitFlushPersistence(enqueuePersistence(
            acknowledged,
            () => true,
            () => !signal.aborted,
            () => envelope?.userId === batch.userId ? envelope : pendingEnvelope,
          ), signal)) return;
        }
        envelope = acknowledged;
        envelopeMutationVersion += 1;
        automaticSyncBlocked = false;
        setState(envelope.pendingOperations.length === 0 ? 'synced' : 'syncing');
        if (envelope.pendingOperations.length > 0) scheduleDebounce();
        return;
      }

      const responseError = normalizeResponseError(response, parsed.value);
      if (response.status === 409) {
        conflictSeen = true;
        if (conflictReplays >= MAX_CONFLICT_REPLAYS || postAttempts >= 3) {
          setState('conflict', responseError);
          await awaitFlushPersistence(enqueueEnvelopePersistence(), signal);
          return;
        }
        conflictReplays += 1;
        const rebased = await rebaseFromRemote(batch.userId, signal);
        if (!rebased) return;
        if (envelope === null || envelope.userId !== batch.userId) return;
        if (envelope.pendingOperations.length === 0) {
          automaticSyncBlocked = false;
          setState('synced');
          return;
        }
        batch = freezeBatch(envelope);
        continue;
      }

      if (RETRYABLE_STATUSES.has(response.status)) {
        if (canRetryPost(postAttempts, conflictSeen, transientRetries)) {
          try {
            await waitForRetry(transientRetries++, signal);
          } catch {
            if (signal.aborted) setState('failed', lifecycleTimeoutError());
            return;
          }
          continue;
        }
        setState('failed', { ...responseError, retryable: true });
        await awaitFlushPersistence(enqueueEnvelopePersistence(), signal);
        return;
      }

      if (response.status === 413 && envelope !== null) {
        envelope.pendingOperations = compactSimpleChatOperations(envelope.pendingOperations);
        envelope.updatedAt = now();
      }
      if (response.status === 401 || response.status === 403) automaticSyncBlocked = true;
      setState('failed', {
        ...responseError,
        retryable: response.status === 401 || response.status === 403 ? false : responseError.retryable,
      });
      await awaitFlushPersistence(enqueueEnvelopePersistence(), signal);
      return;
    }
  }

  async function awaitFlushPersistence(
    persistence: Promise<boolean>,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      return await waitWithSignal(persistence, signal);
    } catch {
      if (signal.aborted) setState('failed', lifecycleTimeoutError());
      return false;
    }
  }

  async function rebaseFromRemote(userId: string, signal: AbortSignal): Promise<boolean> {
    const remote = await readRemoteSnapshot(userId, () => !signal.aborted, signal);
    if (!remote.ok) {
      setState(remote.offline ? 'offline' : 'failed', remote.error);
      await awaitFlushPersistence(enqueueEnvelopePersistence(), signal);
      return false;
    }
    if (envelope === null || envelope.userId !== userId) return false;

    const mutationVersion = envelopeMutationVersion;
    let candidate = rebaseEnvelope(envelope, remote.body, createId, now);
    if (!await awaitFlushPersistence(enqueuePersistence(candidate), signal)) return false;
    if (envelope === null || envelope.userId !== userId) return false;
    if (envelopeMutationVersion !== mutationVersion) {
      candidate = rebaseEnvelope(envelope, remote.body, createId, now);
      if (!await awaitFlushPersistence(enqueuePersistence(candidate), signal)) return false;
    }
    envelope = candidate;
    envelopeMutationVersion += 1;
    return true;
  }

  async function readRemoteSnapshot(
    userId: string,
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal,
  ): Promise<
    | { ok: true; body: SyncReadBody }
    | { ok: false; offline: boolean; error: SimpleChatSyncError }
  > {
    if (isOffline()) {
      return {
        ok: false,
        offline: true,
        error: {
          code: 'CHAT_SYNC_OFFLINE',
          message: 'Simple chat sync is waiting for a network connection',
          retryable: true,
        },
      };
    }
    let transientRetries = 0;
    while (true) {
      if (!isCurrent() || signal?.aborted) return staleReadResult();
      const requestController = createLinkedAbortController(signal === undefined ? [] : [signal]);
      activeRequestControllers.add(requestController.controller);
      let response: Response;
      try {
        response = await withUserNetworkLock(userId, requestController.controller.signal, () => abortableFetch(
          fetchImpl(`${SIMPLE_CHAT_SYNC_URL}?key=${SIMPLE_CHAT_SYNC_KEY}`, {
            method: 'GET',
            credentials: 'include',
            signal: requestController.controller.signal,
          }),
          requestController.controller.signal,
        ));
      } catch {
        if (!isCurrent() || signal?.aborted) return staleReadResult();
        if (!isOffline() && !lifecycleTimedOut && transientRetries < MAX_TRANSIENT_RETRIES) {
          try {
            await waitForRetry(transientRetries++, signal);
          } catch {
            return staleReadResult();
          }
          continue;
        }
        return {
          ok: false,
          offline: isOffline(),
          error: lifecycleTimedOut ? lifecycleTimeoutError() : networkError(),
        };
      } finally {
        activeRequestControllers.delete(requestController.controller);
        requestController.cleanup();
      }
      if (!isCurrent() || signal?.aborted) return staleReadResult();
      let parsed: Awaited<ReturnType<typeof parseJson>>;
      try {
        parsed = await waitWithSignal(parseJson(response), signal);
      } catch {
        if (signal?.aborted) void response.body?.cancel().catch(() => undefined);
        return staleReadResult();
      }
      if (!isCurrent() || signal?.aborted) return staleReadResult();
      if (RETRYABLE_STATUSES.has(response.status) && transientRetries < MAX_TRANSIENT_RETRIES) {
        try {
          await waitForRetry(transientRetries++, signal);
        } catch {
          return staleReadResult();
        }
        continue;
      }
      if (!parsed.ok || !response.ok || !isReadSuccess(parsed.value)) {
        return {
          ok: false,
          offline: false,
          error: parsed.ok
            ? normalizeResponseError(response, parsed.value)
            : invalidResponseError(response),
        };
      }
      return { ok: true, body: parsed.value };
    }
  }

  async function waitForRetry(retryIndex: number, signal?: AbortSignal): Promise<void> {
    const jitterMilliseconds = Math.max(0, Math.floor(jitter() * RETRY_BASE_MILLISECONDS));
    await waitWithSignal(
      sleep(RETRY_BASE_MILLISECONDS * (2 ** retryIndex) + jitterMilliseconds),
      signal,
    );
  }

  async function handleOnline(): Promise<void> {
    assertUsable();
    if (isOffline()) {
      setState('offline', {
        code: 'CHAT_SYNC_OFFLINE',
        message: 'Simple chat sync is waiting for a network connection',
        retryable: true,
      });
      return;
    }
    if (error !== null && !error.retryable) return;
    if (
      initializeTargetUserId !== null
      && (authoritativeReadPending || envelope === null || envelope.userId !== initializeTargetUserId)
    ) {
      await initialize(initializeTargetUserId);
      return;
    }
    if (envelope === null || envelope.pendingOperations.length === 0) return;
    await flush('manual');
  }

  function subscribe(listener: (next: SimpleChatSyncSnapshot) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async function dispose(disposeOptions: { flush?: boolean } = {}): Promise<void> {
    if (disposed) return;
    clearDebounce();
    const reason = createAbortError('Simple chat sync coordinator was disposed');
    initializeController?.abort(reason);
    if (disposeOptions.flush === false) {
      disposed = true;
      queuedFlush = null;
      flushDrainController?.abort(reason);
      for (const controller of activeRequestControllers) controller.abort(reason);
      stopLifecycleTimeout();
      listeners.clear();
      if (envelope !== null) void enqueuePersistence(envelope, () => false);
      return;
    }
    await queueFlush('dispose');
    disposed = true;
    listeners.clear();
  }

  function startLifecycleTimeout(): void {
    if (lifecycleTimeout !== null) return;
    lifecycleTimedOut = false;
    lifecycleTimeout = setTimeout(() => {
      lifecycleTimedOut = true;
      const reason = createAbortError('Simple chat sync lifecycle flush timed out');
      flushDrainController?.abort(reason);
      for (const controller of activeRequestControllers) controller.abort(reason);
    }, lifecycleTimeoutMs);
  }

  function stopLifecycleTimeout(): void {
    if (lifecycleTimeout !== null) clearTimeout(lifecycleTimeout);
    lifecycleTimeout = null;
    lifecycleTimedOut = false;
  }

  function assertUsable(): void {
    if (disposed) throw new Error('Simple chat sync coordinator is disposed');
  }

  return {
    initialize,
    update,
    flush,
    handleOnline,
    snapshot,
    subscribe,
    dispose,
  };
}

function freezeBatch(envelope: SimpleChatSyncEnvelopeV1): FrozenBatch {
  return {
    userId: envelope.userId,
    operationIds: envelope.pendingOperations.map(operation => operation.operationId),
    projects: cloneValue(envelope.currentProjects),
    expectedRevision: envelope.baseRevision,
  };
}

function acknowledgeEnvelope(
  source: SimpleChatSyncEnvelopeV1,
  batch: FrozenBatch,
  syncRevision: number,
  createId: () => string,
  now: () => number,
): SimpleChatSyncEnvelopeV1 {
  return {
    ...cloneValue(source),
    baseRevision: syncRevision,
    baseProjects: cloneValue(batch.projects) as SimpleChatSyncedProject[],
    pendingOperations: rebasePendingOperations(
      batch.projects,
      source.currentProjects,
      source.pendingOperations,
      batch.operationIds,
      createId,
    ),
    updatedAt: now(),
  };
}

function rebaseEnvelope(
  source: SimpleChatSyncEnvelopeV1,
  remote: SyncReadBody,
  createId: () => string,
  now: () => number,
): SimpleChatSyncEnvelopeV1 {
  const replayed = replaySimpleChatOperations(
    remote.value,
    source.pendingOperations,
    { createId, now, localProjects: source.currentProjects },
  );
  return {
    ...cloneValue(source),
    baseRevision: remote.syncRevision,
    baseProjects: cloneValue(remote.value) as SimpleChatSyncedProject[],
    currentProjects: replayed.projects,
    pendingOperations: rebasePendingOperations(
      remote.value,
      replayed.projects,
      source.pendingOperations,
      [],
      createId,
    ),
    updatedAt: now(),
  };
}

function mergeFlushCapabilities(
  current: FlushCapabilities | null,
  next: InternalFlushReason,
): FlushCapabilities {
  const nextCapabilities: FlushCapabilities = {
    keepalive: next === 'pagehide',
    lifecycle: next === 'logout' || next === 'dispose',
  };
  return current === null
    ? nextCapabilities
    : {
      keepalive: current.keepalive || nextCapabilities.keepalive,
      lifecycle: current.lifecycle || nextCapabilities.lifecycle,
    };
}

function canRetryPost(
  postAttempts: number,
  conflictSeen: boolean,
  transientRetries: number,
): boolean {
  if (transientRetries >= MAX_TRANSIENT_RETRIES) return false;
  return postAttempts < (conflictSeen ? 3 : MAX_TRANSIENT_RETRIES + 1);
}

async function abortableFetch(request: Promise<Response>, signal: AbortSignal): Promise<Response> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<Response>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    void request.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (signal === undefined) return await promise;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? createAbortError('Operation aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? createAbortError('Operation aborted');
}

function createLinkedAbortController(signals: AbortSignal[]): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const listener = (): void => controller.abort(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    listeners.push({ signal, listener });
  }
  return {
    controller,
    cleanup: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

function createAbortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function staleReadResult(): { ok: false; offline: false; error: SimpleChatSyncError } {
  return {
    ok: false,
    offline: false,
    error: {
      code: 'CHAT_SYNC_INITIALIZE_REPLACED',
      message: 'Simple chat sync initialization was replaced by a newer user',
      retryable: false,
    },
  };
}

function networkError(): SimpleChatSyncError {
  return {
    code: 'CHAT_SYNC_NETWORK_FAILED',
    message: 'Simple chat sync network request failed',
    retryable: true,
  };
}

function lifecycleTimeoutError(): SimpleChatSyncError {
  return {
    code: 'CHAT_SYNC_LIFECYCLE_TIMEOUT',
    message: 'Simple chat sync lifecycle flush timed out',
    retryable: true,
  };
}

function rebasePendingOperations(
  acceptedProjects: SimpleChatProject[],
  currentProjects: SimpleChatProject[],
  pendingOperations: SimpleChatSyncOperation[],
  acknowledgedIds: string[],
  createId: () => string,
): SimpleChatSyncOperation[] {
  const remaining = acknowledgeSimpleChatOperations(pendingOperations, acknowledgedIds);
  const remainingByEntity = new Map(
    remaining.map(operation => [operationIdentity(operation), operation]),
  );
  const canonical = diffSimpleChatProjects(
    acceptedProjects,
    currentProjects,
    0,
    { createOperationId: createId },
  );

  return canonical.map(operation => {
    const existing = remainingByEntity.get(operationIdentity(operation));
    return existing === undefined
      ? operation
      : {
        ...operation,
        operationId: existing.operationId,
        sequence: existing.sequence,
      };
  });
}

function operationIdentity(operation: SimpleChatSyncOperation): string {
  return [
    operation.entityType,
    operation.projectId,
    operation.taskId ?? '',
    operation.messageId ?? '',
    operation.entityId,
  ].join('\u0000');
}

async function parseJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
  }
}

function isReadSuccess(value: unknown): value is SyncReadBody {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.value)) return false;
  return isSafeRevision(value.syncRevision);
}

function isWriteSuccess(value: unknown, expectedRevision: number): value is SyncSuccessBody {
  if (!isRecord(value) || value.success !== true || !isSafeRevision(value.syncRevision)) return false;
  return value.syncRevision === expectedRevision + 1;
}

function normalizeResponseError(response: Response, value: unknown): SimpleChatSyncError {
  const body: SyncErrorBody = isRecord(value) ? value : {};
  const headerRequestId = response.headers.get('x-request-id') ?? undefined;
  return {
    code: typeof body.code === 'string' ? body.code : `CHAT_SYNC_HTTP_${response.status}`,
    message: typeof body.message === 'string' ? body.message : `Simple chat sync failed (${response.status})`,
    retryable: typeof body.retryable === 'boolean'
      ? body.retryable
      : RETRYABLE_STATUSES.has(response.status) || response.status === 409,
    ...(typeof body.requestId === 'string'
      ? { requestId: body.requestId }
      : headerRequestId === undefined ? {} : { requestId: headerRequestId }),
  };
}

function invalidResponseError(response: Response, value?: unknown): SimpleChatSyncError {
  const body = isRecord(value) ? value : {};
  const requestId = typeof body.requestId === 'string'
    ? body.requestId
    : response.headers.get('x-request-id') ?? undefined;
  return {
    code: 'CHAT_SYNC_INVALID_RESPONSE',
    message: 'Simple chat sync received an invalid response',
    retryable: false,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function localStorageError(): SimpleChatSyncError {
  return {
    code: 'CHAT_SYNC_LOCAL_STORAGE_FAILED',
    message: 'Simple chat data could not be saved locally',
    retryable: false,
  };
}

function isSafeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}
