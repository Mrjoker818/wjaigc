import 'server-only';

import type { Notification } from 'pg';

import { PresenceConnectionCleanupError, withPresenceConnection } from './presence-connection';

export interface PresenceListenerToken {
  readonly ready: Promise<void>;
  close(): Promise<void>;
}

export interface PresenceListenerOwner {
  retain(signal?: AbortSignal): PresenceListenerToken;
}

interface Gate {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(reason: unknown): void;
}

interface Epoch {
  readonly controller: AbortController;
  readonly ready: Gate;
  readonly stopped: Gate;
  completion: Promise<void>;
  retiring: boolean;
}

function gate(): Gate {
  let resolve: () => void = (): void => undefined;
  let reject: (reason: unknown) => void = (): void => undefined;
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
  // A gate may settle before its consumer reaches it (e.g. LISTEN fails).
  // Observe it without changing the promise returned to that consumer.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export function createPresenceListenerOwner(
  onProjectChange: (projectId: string) => void,
): PresenceListenerOwner {
  const tokens = new Set<symbol>();
  let current: Epoch | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupFailure: PresenceConnectionCleanupError | undefined;

  const clearRetry = (): void => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const scheduleReconnect = (): void => {
    if (tokens.size === 0 || cleanupFailure || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (tokens.size > 0 && !current && !cleanupFailure) startEpoch();
    }, 1_000);
    retryTimer.unref();
  };

  const startEpoch = (): Epoch => {
    clearRetry();
    const epoch: Epoch = {
      controller: new AbortController(), ready: gate(), stopped: gate(),
      completion: Promise.resolve(), retiring: false,
    };
    current = epoch;
    epoch.completion = withPresenceConnection(epoch.controller.signal, async client => {
      const onNotification = (message: Notification): void => {
        if (current !== epoch || epoch.retiring || tokens.size === 0
          || message.channel !== 'wujie_presence_changed' || !message.payload) return;
        onProjectChange(message.payload);
      };
      const onError = (error: Error): void => { epoch.stopped.reject(error); };
      const onEnd = (): void => { epoch.stopped.reject(new Error('Presence listener disconnected')); };
      client.on('notification', onNotification);
      client.on('error', onError);
      client.once('end', onEnd);
      try {
        await client.query('LISTEN wujie_presence_changed');
        epoch.ready.resolve();
        // Keep the real checkout owned for its whole listening lifetime.
        await epoch.stopped.promise;
      } finally {
        client.off('notification', onNotification);
        client.off('error', onError);
        client.off('end', onEnd);
      }
    }).catch((error: unknown): void => {
      if (error instanceof PresenceConnectionCleanupError) {
        cleanupFailure = error;
        epoch.ready.reject(error);
        throw error;
      }
      // Ordinary acquisition/LISTEN/disconnect failures retain the existing
      // reconcile fallback. Never downgrade uncertain connection retirement.
    }).finally(() => {
      epoch.ready.resolve();
      if (current === epoch) {
        current = undefined;
        scheduleReconnect();
      }
    });
    void epoch.completion.catch(() => undefined);
    return epoch;
  };

  const waitUntilReady = async (): Promise<void> => {
    while (current?.retiring) await current.completion;
    if (cleanupFailure) throw cleanupFailure;
    if (tokens.size === 0) return;
    const epoch = current ?? startEpoch();
    await epoch.ready.promise;
  };

  return {
    retain(signal?: AbortSignal): PresenceListenerToken {
      // A reported failure belongs to the completed epoch and its tokens, not
      // every future subscription. Never reset it while a producer or token
      // still owns that epoch; old close promises keep their original rejection.
      if (tokens.size === 0 && !current) cleanupFailure = undefined;
      const identity = Symbol('presence-listener-token');
      const ready = gate();
      let closing: Promise<void> | undefined;
      tokens.add(identity);

      const close = (): Promise<void> => {
        if (closing) return closing;
        // A new retain may clear the owner latch before this close's promise
        // continuation runs. Preserve this token's already reported failure;
        // any new failure during retirement rejects completion itself.
        const reportedFailure = cleanupFailure;
        tokens.delete(identity);
        signal?.removeEventListener('abort', onAbort);
        ready.reject(signal?.reason ?? new Error('Presence listener token closed'));
        let retirement: Promise<void> = Promise.resolve();
        if (tokens.size === 0) {
          clearRetry();
          const epoch = current;
          if (epoch) {
            epoch.retiring = true;
            // Abort before releasing the stop gate so cancellation is owned
            // before withPresenceConnection enters its actual cleanup.
            epoch.controller.abort();
            epoch.stopped.resolve();
            retirement = epoch.completion;
          }
        }
        closing = retirement.then((): void => {
          if (reportedFailure) throw reportedFailure;
        });
        void closing.catch(() => undefined);
        return closing;
      };
      const onAbort = (): void => { void close().catch(() => undefined); };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else void waitUntilReady().then(ready.resolve, ready.reject);
      return { ready: ready.promise, close };
    },
  };
}
