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
  dispose(): Promise<void>;
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
  operationIds: string[];
  projects: SimpleChatProject[];
  expectedRevision: number;
}

export function createSimpleChatSyncCoordinator(
  options: SimpleChatSyncCoordinatorOptions,
): SimpleChatSyncCoordinator {
  const fetchImpl = options.fetchImpl ?? fetch;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const jitter = options.jitter ?? Math.random;
  const listeners = new Set<(snapshot: SimpleChatSyncSnapshot) => void>();

  let status: SimpleChatSyncStatus = 'loading';
  let error: SimpleChatSyncError | null = null;
  let envelope: SimpleChatSyncEnvelopeV1 | null = null;
  let activeFlush: Promise<void> | null = null;
  let persistenceQueue: Promise<boolean> = Promise.resolve(true);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let automaticSyncBlocked = false;

  function snapshot(): SimpleChatSyncSnapshot {
    return cloneValue({
      status,
      projects: envelope?.currentProjects ?? [],
      pendingOperations: envelope?.pendingOperations ?? [],
      error,
    });
  }

  function emit(): void {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  function setState(nextStatus: SimpleChatSyncStatus, nextError: SimpleChatSyncError | null = null): void {
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

  function enqueuePersistence(): Promise<boolean> {
    if (envelope === null) return Promise.resolve(true);
    const value = cloneValue(envelope);
    persistenceQueue = persistenceQueue
      .catch(() => false)
      .then(async () => {
        try {
          await options.store.put(value);
          return true;
        } catch {
          setState('failed', localStorageError());
          return false;
        }
      });
    return persistenceQueue;
  }

  async function initialize(userId: string): Promise<SimpleChatSyncSnapshot> {
    assertUsable();
    if (userId.length === 0) throw new Error('Simple chat sync requires a user id');

    clearDebounce();
    if (activeFlush !== null) await activeFlush;
    if (envelope !== null) await enqueuePersistence();

    envelope = null;
    automaticSyncBlocked = false;
    setState('loading');

    let localEnvelope: SimpleChatSyncEnvelopeV1 | null;
    try {
      localEnvelope = await options.store.get(userId);
    } catch {
      setState('failed', localStorageError());
      return snapshot();
    }

    if (localEnvelope !== null && localEnvelope.userId !== userId) {
      setState('failed', {
        code: 'CHAT_SYNC_USER_MISMATCH',
        message: 'Stored simple chat data belongs to a different user',
        retryable: false,
      });
      return snapshot();
    }

    const remote = await readRemoteSnapshot();
    if (!remote.ok) {
      if (localEnvelope !== null) envelope = cloneValue(localEnvelope);
      setState(remote.offline ? 'offline' : 'failed', remote.error);
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

    envelope = {
      schemaVersion: 1,
      userId,
      baseRevision: remote.body.syncRevision,
      baseProjects: cloneValue(remote.body.value) as SimpleChatSyncedProject[],
      currentProjects: recoverInterruptedSimpleChatProjects(replayed) as SimpleChatSyncedProject[],
      pendingOperations,
      updatedAt: now(),
    };

    if (!await enqueuePersistence()) return snapshot();
    setState(pendingOperations.length === 0 ? 'synced' : 'syncing');
    if (pendingOperations.length > 0) scheduleDebounce();
    return snapshot();
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
    if (!automaticSyncBlocked) {
      error = null;
      status = isOffline() ? 'offline' : envelope.pendingOperations.length === 0 ? 'synced' : 'syncing';
    }
    emit();
    void enqueuePersistence();
    scheduleDebounce();
  }

  function flush(reason: SimpleChatSyncFlushReason): Promise<void> {
    if (disposed) return Promise.resolve();
    clearDebounce();
    if (activeFlush !== null) return activeFlush;

    const initialBatch = envelope === null || envelope.pendingOperations.length === 0
      ? null
      : freezeBatch(envelope);
    activeFlush = performFlush(reason, initialBatch).finally(() => {
      activeFlush = null;
    });
    return activeFlush;
  }

  async function performFlush(
    reason: SimpleChatSyncFlushReason,
    initialBatch: FrozenBatch | null,
  ): Promise<void> {
    if (!await persistenceQueue) return;
    if (envelope === null || initialBatch === null) {
      if (envelope !== null && status !== 'failed') setState('synced');
      return;
    }
    if (isOffline()) {
      setState('offline', {
        code: 'CHAT_SYNC_OFFLINE',
        message: 'Simple chat sync is waiting for a network connection',
        retryable: true,
      });
      await enqueuePersistence();
      return;
    }

    setState('syncing');
    let batch = initialBatch;
    let transientRetries = 0;
    let conflictReplays = 0;

    while (true) {
      let response: Response;
      try {
        response = await fetchImpl(SIMPLE_CHAT_SYNC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: SIMPLE_CHAT_SYNC_KEY,
            value: batch.projects,
            expectedRevision: batch.expectedRevision,
          }),
          credentials: 'include',
          ...(reason === 'pagehide' ? { keepalive: true } : {}),
        });
      } catch {
        if (isOffline()) {
          setState('offline', {
            code: 'CHAT_SYNC_OFFLINE',
            message: 'Simple chat sync is waiting for a network connection',
            retryable: true,
          });
          await enqueuePersistence();
          return;
        }
        if (transientRetries < MAX_TRANSIENT_RETRIES) {
          await waitForRetry(transientRetries++);
          continue;
        }
        setState('failed', {
          code: 'CHAT_SYNC_NETWORK_FAILED',
          message: 'Simple chat sync network request failed',
          retryable: true,
        });
        await enqueuePersistence();
        return;
      }

      const parsed = await parseJson(response);
      if (!parsed.ok) {
        setState('failed', invalidResponseError(response));
        await enqueuePersistence();
        return;
      }

      if (response.ok) {
        if (!isWriteSuccess(parsed.value, batch.expectedRevision)) {
          setState('failed', invalidResponseError(response, parsed.value));
          await enqueuePersistence();
          return;
        }
        if (envelope === null) return;
        envelope.baseRevision = parsed.value.syncRevision;
        envelope.baseProjects = cloneValue(batch.projects) as SimpleChatSyncedProject[];
        envelope.pendingOperations = rebasePendingOperations(
          batch.projects,
          envelope.currentProjects,
          envelope.pendingOperations,
          batch.operationIds,
          createId,
        );
        envelope.updatedAt = now();
        const persisted = await enqueuePersistence();
        if (!persisted) return;
        automaticSyncBlocked = false;
        setState(envelope.pendingOperations.length === 0 ? 'synced' : 'syncing');
        if (envelope.pendingOperations.length > 0) scheduleDebounce();
        return;
      }

      const responseError = normalizeResponseError(response, parsed.value);
      if (response.status === 409) {
        if (conflictReplays >= MAX_CONFLICT_REPLAYS) {
          setState('conflict', responseError);
          await enqueuePersistence();
          return;
        }
        conflictReplays += 1;
        const rebased = await rebaseFromRemote();
        if (!rebased) return;
        if (envelope === null || envelope.pendingOperations.length === 0) return;
        batch = freezeBatch(envelope);
        transientRetries = 0;
        continue;
      }

      if (RETRYABLE_STATUSES.has(response.status)) {
        if (transientRetries < MAX_TRANSIENT_RETRIES) {
          await waitForRetry(transientRetries++);
          continue;
        }
        setState('failed', { ...responseError, retryable: true });
        await enqueuePersistence();
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
      await enqueuePersistence();
      return;
    }
  }

  async function rebaseFromRemote(): Promise<boolean> {
    const remote = await readRemoteSnapshot();
    if (!remote.ok) {
      setState(remote.offline ? 'offline' : 'failed', remote.error);
      await enqueuePersistence();
      return false;
    }
    if (envelope === null) return false;

    const replayed = replaySimpleChatOperations(
      remote.body.value,
      envelope.pendingOperations,
      { createId, now, localProjects: envelope.currentProjects },
    );
    envelope.baseRevision = remote.body.syncRevision;
    envelope.baseProjects = cloneValue(remote.body.value) as SimpleChatSyncedProject[];
    envelope.currentProjects = replayed.projects;
    envelope.updatedAt = now();
    return await enqueuePersistence();
  }

  async function readRemoteSnapshot(): Promise<
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
    let response: Response;
    try {
      response = await fetchImpl(`${SIMPLE_CHAT_SYNC_URL}?key=${SIMPLE_CHAT_SYNC_KEY}`, {
        method: 'GET',
        credentials: 'include',
      });
    } catch {
      return {
        ok: false,
        offline: isOffline(),
        error: {
          code: 'CHAT_SYNC_NETWORK_FAILED',
          message: 'Simple chat sync network request failed',
          retryable: true,
        },
      };
    }
    const parsed = await parseJson(response);
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

  async function waitForRetry(retryIndex: number): Promise<void> {
    const jitterMilliseconds = Math.max(0, Math.floor(jitter() * RETRY_BASE_MILLISECONDS));
    await sleep(RETRY_BASE_MILLISECONDS * (2 ** retryIndex) + jitterMilliseconds);
  }

  async function handleOnline(): Promise<void> {
    assertUsable();
    if (envelope === null || envelope.pendingOperations.length === 0) return;
    if (isOffline()) {
      setState('offline', {
        code: 'CHAT_SYNC_OFFLINE',
        message: 'Simple chat sync is waiting for a network connection',
        retryable: true,
      });
      return;
    }
    if (error !== null && !error.retryable) return;
    await flush('manual');
  }

  function subscribe(listener: (next: SimpleChatSyncSnapshot) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    clearDebounce();
    if (activeFlush !== null) await activeFlush;
    await enqueuePersistence();
    disposed = true;
    listeners.clear();
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
    operationIds: envelope.pendingOperations.map(operation => operation.operationId),
    projects: cloneValue(envelope.currentProjects),
    expectedRevision: envelope.baseRevision,
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
