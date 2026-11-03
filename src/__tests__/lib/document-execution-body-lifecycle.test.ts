import type { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// Keep database-bearing authorization imports outside this reader-only fixture.
vi.mock('@/lib/collaboration/document-exchange-access', () => ({
  DocumentExchangeError: class extends Error {
    constructor(readonly code: string, readonly cause?: unknown) { super(code); }
  },
}));

import { readDocumentExchangeBytes } from '@/lib/collaboration/document-exchange-request';
import { getDocumentExecutionStats, runDocumentExecution } from '@/lib/collaboration/document-execution-scope';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('body reader ownership through root abort', () => {
  it.each(['read-first', 'cancel-first'] as const)(
    'retains root and actor admissions until both settle: %s',
    async order => {
      const controller = new AbortController();
      const read = deferred<ReadableStreamReadResult<Uint8Array>>();
      const cancel = deferred<void>();
      const peerGate = deferred<void>();
      const peerStarted = deferred<void>();
      const lateSql = vi.fn();
      const reader = {
        read: vi.fn(() => { controller.abort(); return read.promise; }),
        cancel: vi.fn(() => cancel.promise),
        releaseLock: vi.fn(),
      };
      const request = {
        headers: new Headers(), signal: new AbortController().signal,
        body: { getReader: () => reader },
      } as unknown as NextRequest;

      const pending = runDocumentExecution({ signal: controller.signal, timeoutMs: 3_000 }, async scope => {
        scope.admitActor('synthetic-actor');
        await readDocumentExchangeBytes(request, 1_024);
        scope.assertActive();
        lateSql();
      });
      const outcome = pending.then(() => 'success', (cause: { code?: string }) => cause.code);
      let peer: Promise<void> | undefined;
      try {
        expect(await outcome).toBe('CANCELLED');
        await vi.waitFor(() => expect(getDocumentExecutionStats()).toMatchObject({
          activeScopes: 1, drainingScopes: 1, activeObserved: 2, actorAdmissions: 1,
        }));
        expect(reader.read).toHaveBeenCalledTimes(1);
        expect(reader.cancel).toHaveBeenCalledTimes(1);

        peer = runDocumentExecution({ timeoutMs: 3_000 }, async scope => {
          scope.admitActor('synthetic-actor'); peerStarted.resolve(); await peerGate.promise;
        });
        await peerStarted.promise;
        const assertActorLimit = async (): Promise<void> => {
          await expect(runDocumentExecution({}, scope => scope.admitActor('synthetic-actor')))
            .rejects.toMatchObject({ code: 'BUSY' });
        };
        await assertActorLimit();

        if (order === 'read-first') read.resolve({ done: true, value: undefined });
        else cancel.resolve();
        await vi.waitFor(() => expect(getDocumentExecutionStats()).toMatchObject({
          activeScopes: 2, drainingScopes: 1, activeObserved: 1, actorAdmissions: 2,
        }));
        await assertActorLimit();
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(lateSql).not.toHaveBeenCalled();

        if (order === 'read-first') cancel.resolve();
        else read.resolve({ done: true, value: undefined });
        await vi.waitFor(() => expect(getDocumentExecutionStats()).toMatchObject({
          activeScopes: 1, drainingScopes: 0, activeObserved: 0, actorAdmissions: 1,
        }));
        await expect(runDocumentExecution({}, scope => scope.admitActor('synthetic-actor'))).resolves.toBeUndefined();
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(lateSql).not.toHaveBeenCalled();
      } finally {
        read.resolve({ done: true, value: undefined }); cancel.resolve(); peerGate.resolve();
        if (peer) await peer;
      }
      await vi.waitFor(() => expect(getDocumentExecutionStats().activeScopes).toBe(0));
      expect(getDocumentExecutionStats().actorAdmissions).toBe(0);
      expect(lateSql).not.toHaveBeenCalled();
    },
  );
});
