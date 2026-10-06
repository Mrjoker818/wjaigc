import { once } from 'node:events';
import { createServer, get, type Server, type ServerResponse } from 'node:http';
import { connect } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startPresenceServer } from '../../../scripts/presence-server';

vi.mock('server-only', () => ({}));

const resources: Server[] = [];
const timers: Array<ReturnType<typeof setInterval>> = [];

async function workerResource(): Promise<Server> {
  const server = createServer((_request, response) => response.end('controlled-next-worker'));
  resources.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function portOf(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback listener');
  return address.port;
}

async function closeResource(server: Server): Promise<void> {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
}

afterEach(async () => {
  for (const timer of timers.splice(0)) clearInterval(timer);
  await Promise.all(resources.splice(0).map(closeResource));
  vi.unstubAllEnvs();
  vi.doUnmock('@/lib/collaboration/presence-leases');
  vi.resetModules();
});

describe('presence entry owns Next and HTTP resource cleanup', () => {
  it.each(['prepare', 'handler', 'listen'] as const)('closes a prepared Next resource after %s failure without hiding the startup error', async stage => {
    const worker = await workerResource();
    const failure = new Error('CONTROLLED_NEXT_START_FAILURE');
    // The occupied port causes a real EADDRINUSE, not a listen mock.
    const start = startPresenceServer({
      port: stage === 'listen' ? portOf(worker) : 0,
      hostname: '127.0.0.1', dev: false,
      onPresenceUpgrade: (_request, socket): void => { socket.destroy(); },
      createNextApp: () => ({
        prepare: async (): Promise<void> => { if (stage === 'prepare') throw failure; },
        getRequestHandler: () => {
          if (stage === 'handler') throw failure;
          return (_request, response): void => { response.end('next-http'); };
        },
        getUpgradeHandler: () => (_request, socket): void => { socket.destroy(); },
        close: async (): Promise<void> => { await closeResource(worker); },
      }),
    });
    if (stage === 'listen') await expect(start).rejects.toMatchObject({ code: 'EADDRINUSE' });
    else await expect(start).rejects.toBe(failure);
    expect(worker.listening).toBe(false);
  });

  it('closes the Next worker exactly once when live runtime close is repeated', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    vi.doMock('@/lib/collaboration/presence-leases', async importOriginal => ({
      ...await importOriginal<typeof import('@/lib/collaboration/presence-leases')>(),
      startPresenceMaintenance: (): (() => Promise<void>) => async (): Promise<void> => {},
    }));
    const worker = await workerResource();
    let closes = 0;
    const { startLivePresenceServer } = await import('../../../scripts/presence-server');
    const runtime = await startLivePresenceServer({
      port: 0, hostname: '127.0.0.1', dev: false,
      createNextApp: () => ({
        prepare: async (): Promise<void> => {},
        getRequestHandler: () => (_request, response): void => { response.end('next-http'); },
        getUpgradeHandler: () => (_request, socket): void => { socket.destroy(); },
        close: async (): Promise<void> => { closes += 1; await closeResource(worker); },
      }),
    });
    try {
      await Promise.all([runtime.close(), runtime.close()]);
      expect(worker.listening).toBe(false);
      expect(closes).toBe(1);
      expect(runtime.server.listening).toBe(false);
    } finally { await closeResource(runtime.server); await runtime.close(); }
  });

  it('stops maintenance before an unfinished HTTP request can delay shutdown', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    let stopMaintenance: (() => void) | undefined;
    const stopped = new Promise<void>(resolve => { stopMaintenance = resolve; });
    vi.doMock('@/lib/collaboration/presence-leases', async importOriginal => ({
      ...await importOriginal<typeof import('@/lib/collaboration/presence-leases')>(),
      startPresenceMaintenance: (): (() => Promise<void>) => {
        const timer = setInterval(() => {}, 50);
        timers.push(timer);
        return async (): Promise<void> => { clearInterval(timer); stopMaintenance?.(); };
      },
    }));
    let pendingResponse: ServerResponse | undefined;
    let markRequest: (() => void) | undefined;
    const requestReached = new Promise<void>(resolve => { markRequest = resolve; });
    const worker = await workerResource();
    const { startLivePresenceServer } = await import('../../../scripts/presence-server');
    const runtime = await startLivePresenceServer({
      port: 0, hostname: '127.0.0.1', dev: false,
      createNextApp: () => ({
        prepare: async (): Promise<void> => {},
        getRequestHandler: () => (_request, response): void => { pendingResponse = response; markRequest?.(); },
        getUpgradeHandler: () => (_request, socket): void => { socket.destroy(); },
        close: async (): Promise<void> => { await closeResource(worker); },
      }),
    });
    const request = get(`http://127.0.0.1:${portOf(runtime.server)}/in-flight`);
    const completedResponse = new Promise<{ status: number; body: string }>((resolve, reject) => {
      request.once('error', reject);
      request.once('response', response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string): void => { body += chunk; });
        response.once('error', reject);
        response.once('end', (): void => { resolve({ status: response.statusCode ?? 0, body }); });
      });
    });
    // Keep a late transport rejection handled during failure cleanup, but still
    // await the original promise below: it cannot turn a broken response green.
    void completedResponse.catch(() => {});
    let closing: Promise<void> | undefined;
    try {
      await requestReached;
      closing = runtime.close();
      const observed = await Promise.race([
        stopped.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 250)),
      ]);
      expect(observed).toBe(true);
      expect(worker.listening).toBe(true);
      // A short in-flight request is allowed to finish rather than force-dropped.
      pendingResponse?.end('completed-before-drain-deadline');
      expect(await completedResponse).toEqual({ status: 200, body: 'completed-before-drain-deadline' });
      await closing;
      expect(worker.listening).toBe(false);
    } finally {
      pendingResponse?.end();
      request.destroy();
      await closeResource(runtime.server);
      await (closing ?? runtime.close());
    }
  });

  it('rejects a later pipelined HTTP request on an already active connection while draining the first', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    let markStopped: (() => void) | undefined;
    const stopped = new Promise<void>(resolve => { markStopped = resolve; });
    vi.doMock('@/lib/collaboration/presence-leases', async importOriginal => ({
      ...await importOriginal<typeof import('@/lib/collaboration/presence-leases')>(),
      startPresenceMaintenance: (): (() => Promise<void>) => async (): Promise<void> => { markStopped?.(); },
    }));
    let pendingResponse: ServerResponse | undefined;
    let markArrived: (() => void) | undefined;
    const arrived = new Promise<void>(resolve => { markArrived = resolve; });
    const handledPaths: string[] = [];
    const worker = await workerResource();
    const { startLivePresenceServer } = await import('../../../scripts/presence-server');
    const runtime = await startLivePresenceServer({
      port: 0, hostname: '127.0.0.1', dev: false,
      createNextApp: () => ({
        prepare: async (): Promise<void> => {},
        getRequestHandler: () => (request, response): void => {
          handledPaths.push(request.url ?? '');
          if (request.url === '/first') { pendingResponse = response; markArrived?.(); }
          else response.end('UNEXPECTED_SECOND_ADMISSION');
        },
        getUpgradeHandler: () => (_request, socket): void => { socket.destroy(); },
        close: async (): Promise<void> => { await closeResource(worker); },
      }),
    });
    const socket = connect(portOf(runtime.server), '127.0.0.1');
    let wire = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string): void => { wire += chunk; });
    const ended = once(socket, 'close');
    socket.on('error', (): void => {});
    socket.setTimeout(3_000, () => socket.destroy(new Error('PIPELINE_DRAIN_TIMED_OUT')));
    let closing: Promise<void> | undefined;
    try {
      await once(socket, 'connect');
      socket.write('GET /first HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
      await arrived;
      closing = runtime.close();
      await stopped;
      socket.write('GET /late HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
      pendingResponse?.end('FIRST_REQUEST_COMPLETED');
      await ended;
      await closing;
      expect(handledPaths).toEqual(['/first']);
      expect(wire).toContain('FIRST_REQUEST_COMPLETED');
      expect(wire).toContain('HTTP/1.1 503 Service Unavailable');
      expect(wire).not.toContain('UNEXPECTED_SECOND_ADMISSION');
    } finally {
      pendingResponse?.end();
      socket.destroy();
      await closeResource(runtime.server);
      await (closing ?? runtime.close());
    }
  });

  it('force-releases an unfinished HTTP socket after the drain deadline', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    vi.doMock('@/lib/collaboration/presence-leases', async importOriginal => ({
      ...await importOriginal<typeof import('@/lib/collaboration/presence-leases')>(),
      startPresenceMaintenance: (): (() => Promise<void>) => async (): Promise<void> => {},
    }));
    let requestArrived: (() => void) | undefined;
    const arrived = new Promise<void>(resolve => { requestArrived = resolve; });
    const worker = await workerResource();
    const { startLivePresenceServer } = await import('../../../scripts/presence-server');
    const runtime = await startLivePresenceServer({
      port: 0, hostname: '127.0.0.1', dev: false,
      createNextApp: () => ({
        prepare: async (): Promise<void> => {},
        getRequestHandler: () => (): void => { requestArrived?.(); },
        getUpgradeHandler: () => (_request, socket): void => { socket.destroy(); },
        close: async (): Promise<void> => { await closeResource(worker); },
      }),
    });
    const request = get(`http://127.0.0.1:${portOf(runtime.server)}/never-finishes`);
    const disconnected = new Promise<void>(resolve => { request.once('error', (): void => { resolve(); }); });
    request.setTimeout(10_000, () => request.destroy());
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const safety = new Promise<never>((_resolve, reject) => {
      watchdog = setTimeout(() => reject(new Error('HTTP_DRAIN_DEADLINE_NOT_ENFORCED')), 8_000);
    });
    try {
      await arrived;
      const drainStarted = performance.now();
      await Promise.race([runtime.close(), safety]);
      await disconnected;
      expect(performance.now() - drainStarted).toBeGreaterThanOrEqual(4_900);
      expect(worker.listening).toBe(false);
      expect(runtime.server.listening).toBe(false);
    } finally {
      clearTimeout(watchdog);
      request.destroy();
      await closeResource(runtime.server);
      await runtime.close();
    }
  }, 15_000);

  it('does not skip HTTP and maintenance cleanup when Next cleanup rejects', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    let maintenanceStopped = false;
    vi.doMock('@/lib/collaboration/presence-leases', async importOriginal => ({
      ...await importOriginal<typeof import('@/lib/collaboration/presence-leases')>(),
      startPresenceMaintenance: (): (() => Promise<void>) => async (): Promise<void> => { maintenanceStopped = true; },
    }));
    const worker = await workerResource();
    const failure = new Error('CONTROLLED_NEXT_CLOSE_FAILURE');
    const { startLivePresenceServer } = await import('../../../scripts/presence-server');
    const runtime = await startLivePresenceServer({
      port: 0, hostname: '127.0.0.1', dev: false,
      createNextApp: () => ({
        prepare: async (): Promise<void> => {},
        getRequestHandler: () => (_request, response): void => { response.end('next-http'); },
        getUpgradeHandler: () => (_request, socket): void => { socket.destroy(); },
        close: async (): Promise<void> => { await closeResource(worker); throw failure; },
      }),
    });
    try {
      await expect(runtime.close()).rejects.toBe(failure);
      expect(worker.listening).toBe(false);
      expect(runtime.server.listening).toBe(false);
      expect(maintenanceStopped).toBe(true);
    } finally {
      await closeResource(runtime.server);
      await runtime.close().catch(() => {});
    }
  });
});
