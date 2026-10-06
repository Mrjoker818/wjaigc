import { once } from 'node:events';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

function portOf(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback listener');
  return address.port;
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
  return value instanceof AggregateError && value.errors.some((error: unknown) => containsError(error, wanted));
}

interface Fixture {
  server: Server;
  close(): Promise<void>;
  worker: Server;
}
async function fixture(resources: Server[], rawSockets: Duplex[], nextFailure?: Error, prepareFailure?: Error): Promise<Fixture> {
  const worker = createServer((_request, response) => response.end('controlled-next-worker'));
  resources.push(worker);
  worker.listen(0, '127.0.0.1');
  await once(worker, 'listening');
  vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
  vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
  vi.doMock('@/lib/collaboration/presence-leases', async importOriginal => ({
    ...await importOriginal<typeof import('@/lib/collaboration/presence-leases')>(),
    startPresenceMaintenance: (): (() => Promise<void>) => async (): Promise<void> => {},
  }));
  const { startLivePresenceServer } = await import('../../../scripts/presence-server');
  const runtime = await startLivePresenceServer({
    port: 0, hostname: '127.0.0.1', dev: true,
    createNextApp: () => ({
      prepare: async (): Promise<void> => { if (prepareFailure) throw prepareFailure; },
      getRequestHandler: () => (_request: IncomingMessage, response: ServerResponse): void => { response.end('next-http'); },
      // Deliberately leave a legitimate upgraded TCP connection for the HTTP
      // owner's fallback; this stands in for Next's dev upgrade, not presence auth.
      getUpgradeHandler: () => (_request: IncomingMessage, socket: Duplex): void => {
        rawSockets.push(socket);
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      },
      close: async (): Promise<void> => {
        await closeListener(worker);
        if (nextFailure) throw nextFailure;
      },
    }),
  });
  resources.push(runtime.server);
  return { ...runtime, worker };
}

// Missing raw-socket ownership must fail even when Node's HTTP close callback
// succeeds; losing either HTTP/Next error must fail by original object identity.
describe('HTTP cleanup owns upgraded raw sockets and distinct failures', () => {
  it.each(['raw-upgrade', 'connect-failure', 'http-next-errors', 'http-native-error', 'prepare-next-errors'] as const)('%s boundary', async mode => {
    const resources: Server[] = [];
    const rawSockets: Duplex[] = [];
    let socket: Socket | undefined;
    let runtime: Fixture | undefined;
    let closing: Promise<void> | undefined;
    let safetyTimer: ReturnType<typeof setTimeout> | undefined;
    let operationFailed = false;
    let operationError: unknown;
    let expectedCloseFailure: unknown;
    const nextFailure = new Error('CONTROLLED_NEXT_CLEANUP');
    const httpFailure = new Error('CONTROLLED_HTTP_CLEANUP');
    const prepareFailure = new Error('CONTROLLED_PREPARE_FAILURE');
    try {
      if (mode === 'prepare-next-errors') {
        let observed: unknown;
        try { await fixture(resources, rawSockets, nextFailure, prepareFailure); }
        catch (error) { observed = error; }
        expect(containsError(observed, prepareFailure)).toBe(true);
        expect(containsError(observed, nextFailure)).toBe(true);
        expect(resources.every(server => !server.listening)).toBe(true);
        return;
      }
      const httpErrors = mode === 'http-next-errors' || mode === 'http-native-error';
      runtime = await fixture(resources, rawSockets, httpErrors ? nextFailure : undefined);
      if (httpErrors) {
        if (mode === 'http-native-error') await closeListener(runtime.server);
        const nativeClose = runtime.server.close.bind(runtime.server);
        const nativeCloseResults: (Error | undefined)[] = [];
        vi.spyOn(runtime.server, 'close').mockImplementation((callback?: (error?: Error) => void): Server =>
          nativeClose(error => {
            nativeCloseResults.push(error);
            callback?.(error ?? httpFailure);
          }));
        closing = runtime.close();
        expect(runtime.close()).toBe(closing);
        let observed: unknown;
        try { await closing; } catch (error) { observed = error; expectedCloseFailure = error; }
        if (mode === 'http-next-errors') expect(nativeCloseResults).toEqual([undefined]);
        else {
          expect(nativeCloseResults).toHaveLength(1);
          expect(nativeCloseResults[0]).toHaveProperty('code', 'ERR_SERVER_NOT_RUNNING');
        }
        expect(containsError(observed, httpFailure)).toBe(mode === 'http-next-errors');
        expect(containsError(observed, nextFailure)).toBe(true);
        expect(runtime.server.listening).toBe(false);
        expect(runtime.worker.listening).toBe(false);
        return;
      }
      const port = portOf(runtime.server);
      if (mode === 'connect-failure') await closeListener(runtime.server);
      socket = connect(port, '127.0.0.1');
      socket.on('error', (): void => {});
      const selected = socket;
      let wire = '';
      const upgraded = new Promise<void>((resolve, reject) => {
        selected.once('close', () => reject(new Error('RAW_UPGRADE_HANDSHAKE_NOT_OBSERVED')));
        selected.once('error', reject);
        selected.setTimeout(2_000, () => selected.destroy(new Error('RAW_UPGRADE_HANDSHAKE_TIMED_OUT')));
        selected.setEncoding('utf8');
        selected.on('data', (chunk: string): void => {
          wire += chunk;
          if (wire.includes('101 Switching Protocols')) resolve();
        });
      });
      // Observe immediately without replacing the original rejection asserted below.
      void upgraded.catch(() => {});
      const disconnected = new Promise<void>(resolve => selected.once('close', () => resolve()));
      if (mode === 'connect-failure') {
        const connectionFailure: unknown = await once(socket, 'connect').then(() => undefined, (error: unknown) => error);
        expect(connectionFailure).toHaveProperty('code', 'ECONNREFUSED');
        // Let rejection bookkeeping run before asserting the original promise.
        await new Promise<void>(resolve => setImmediate(resolve));
        await expect(upgraded).rejects.toBe(connectionFailure);
        return;
      }
      await once(socket, 'connect');
      socket.write('GET /_next/webpack-hmr HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      await upgraded;
      socket.setTimeout(0);
      const start = performance.now();
      closing = runtime.close();
      const safety = new Promise<never>((_resolve, reject) => {
        safetyTimer = setTimeout(() => reject(new Error('RAW_UPGRADE_DRAIN_NOT_FINISHED')), 8_000);
      });
      await Promise.race([closing, safety]);
      expect(performance.now() - start).toBeGreaterThanOrEqual(4_900);
      await Promise.race([disconnected, safety]);
      expect(socket.destroyed).toBe(true);
      expect(runtime.worker.listening).toBe(false);
    } catch (error) { operationFailed = true; operationError = error; }
    finally {
      clearTimeout(safetyTimer);
      socket?.destroy();
      for (const raw of rawSockets) raw.destroy();
      vi.restoreAllMocks();
      const results = await Promise.allSettled([
        ...resources.map(closeListener),
        ...(runtime ? [(closing ?? runtime.close()).catch((error: unknown) => {
          if (error !== expectedCloseFailure) throw error;
        })] : []),
      ]);
      vi.unstubAllEnvs();
      vi.doUnmock('@/lib/collaboration/presence-leases');
      vi.resetModules();
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown);
      if (errors.length) throw new AggregateError(operationFailed ? [operationError, ...errors] : errors, 'Boundary test cleanup failure');
      if (operationFailed) throw operationError;
    }
  }, 15_000);
});
