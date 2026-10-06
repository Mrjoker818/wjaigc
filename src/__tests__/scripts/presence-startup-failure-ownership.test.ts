import { once } from 'node:events';
import { createServer, Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type Stage = 'document-gateway' | 'presence-maintenance' | 'document-maintenance' | 'prepare';

async function listener(resources: Server[]): Promise<Server> {
  const server = createServer((_request, response) => response.end('controlled-resource'));
  resources.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
async function closeListener(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => {
    if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')) reject(error);
    else resolve();
  }));
}
function containsError(value: unknown, wanted: Error): boolean {
  if (value === wanted) return true;
  if (!(value instanceof Error)) return false;
  if (value instanceof AggregateError && value.errors.some((error: unknown) => containsError(error, wanted))) return true;
  return value.cause !== undefined && containsError(value.cause, wanted);
}

// Removing startup ownership must leave a real listener/timer alive; removing
// all-settled cleanup must lose a distinct error or skip another owned resource.
describe('live presence startup owns partial initialization', () => {
  it.each([
    ['document-gateway', false], ['document-gateway', true],
    ['presence-maintenance', false], ['presence-maintenance', true],
    ['document-maintenance', false], ['document-maintenance', true],
    ['prepare', false], ['prepare', true],
  ] as const)('reclaims acquired resources after %s throws (cleanup faults=%s)', async (stage: Stage, cleanupFaults: boolean) => {
    const resources: Server[] = [];
    const timers: Array<ReturnType<typeof setInterval>> = [];
    const startupFailure = new Error('controlled-startup-' + stage);
    const presenceFailure = new Error('controlled-presence-close');
    const documentFailure = new Error('controlled-document-close');
    const maintenanceFailure = new Error('controlled-maintenance-stop');
    let ticks = 0;
    let operationFailed = false;
    let operationError: unknown;
    try {
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
      vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
      const presence = await listener(resources);
      const document = await listener(resources);
      const nextWorker = await listener(resources);
      const observedListeners = vi.spyOn(Server.prototype, 'listen');
      vi.doMock('@/lib/collaboration/presence-gateway', () => ({
        createPresenceGateway: () => ({
          handlePresenceUpgrade: async (_request: IncomingMessage, _socket: Duplex, _head: Buffer): Promise<void> => {
            void _request; void _socket; void _head;
          },
          close: async (): Promise<void> => {
            await closeListener(presence);
            if (cleanupFaults) throw presenceFailure;
          },
        }),
      }));
      vi.doMock('@/lib/collaboration/document-gateway', () => ({
        createDocumentGateway: () => {
          if (stage === 'document-gateway') throw startupFailure;
          return {
            handleDocumentUpgrade: async (_request: IncomingMessage, _socket: Duplex, _head: Buffer): Promise<void> => {
              void _request; void _socket; void _head;
            },
            close: async (): Promise<void> => {
              await closeListener(document);
              if (cleanupFaults) throw documentFailure;
            },
          };
        },
      }));
      vi.doMock('@/lib/collaboration/presence-leases', () => ({
        startPresenceMaintenance: () => {
          if (stage === 'presence-maintenance') throw startupFailure;
          const timer = setInterval(() => { ticks += 1; }, 10);
          timers.push(timer);
          return async (): Promise<void> => {
            clearInterval(timer);
            if (cleanupFaults) throw maintenanceFailure;
          };
        },
      }));
      vi.doMock('@/lib/collaboration/document-tickets', () => ({
        startDocumentTicketMaintenance: () => {
          if (stage === 'document-maintenance') throw startupFailure;
          const timer = setInterval(() => { ticks += 1; }, 10);
          timers.push(timer);
          return async (): Promise<void> => { clearInterval(timer); };
        },
      }));
      const { startLivePresenceServer } = await import('../../../scripts/presence-server');
      let observed: unknown;
      try {
        await startLivePresenceServer({
          port: 0, hostname: '127.0.0.1', dev: false,
          createNextApp: () => ({
            prepare: async (): Promise<void> => { if (stage === 'prepare') throw startupFailure; },
            getRequestHandler: () => (_request: IncomingMessage, response: ServerResponse): void => { response.end('next-http'); },
            getUpgradeHandler: () => (_request: IncomingMessage, socket: Duplex): void => { socket.destroy(); },
            close: async (): Promise<void> => { await closeListener(nextWorker); },
          }),
        });
      } catch (error) { observed = error; }
      expect(containsError(observed, startupFailure)).toBe(true);
      const runtimeListeners = observedListeners.mock.contexts.filter((value: unknown): value is Server => value instanceof Server);
      expect(runtimeListeners).toHaveLength(stage === 'prepare' || stage === 'document-gateway' ? 0 : 1);
      expect({
        presence: presence.listening,
        document: stage === 'document-gateway' ? false : document.listening,
        next: stage === 'document-gateway' ? false : nextWorker.listening,
        http: runtimeListeners.some(server => server.listening),
      }).toEqual({ presence: false, document: false, next: false, http: false });
      if (cleanupFaults) {
        expect(containsError(observed, presenceFailure)).toBe(true);
        if (stage !== 'document-gateway') expect(containsError(observed, documentFailure)).toBe(true);
        if (stage === 'document-maintenance') expect(containsError(observed, maintenanceFailure)).toBe(true);
      } else expect(observed).toBe(startupFailure);
      const stoppedTicks = ticks;
      await new Promise<void>(resolve => setTimeout(resolve, 40));
      expect(ticks).toBe(stoppedTicks);
    } catch (error) { operationFailed = true; operationError = error; }
    finally {
      for (const timer of timers) clearInterval(timer);
      // Include leaked production HTTP listeners, even on the pre-fix RED path.
      for (const server of vi.mocked(Server.prototype.listen).mock?.contexts ?? []) {
        if (server instanceof Server && !resources.includes(server)) resources.push(server);
      }
      const results = await Promise.allSettled(resources.map(closeListener));
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      for (const path of ['presence-gateway', 'document-gateway', 'presence-leases', 'document-tickets']) {
        vi.doUnmock('@/lib/collaboration/' + path);
      }
      vi.resetModules();
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown);
      if (errors.length) throw new AggregateError(operationFailed ? [operationError, ...errors] : errors, 'Test operation/cleanup failed');
      if (operationFailed) throw operationError;
    }
  });
});
