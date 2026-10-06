import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';

export interface PresenceHttpServerOptions {
  onRequest(request: IncomingMessage, response: ServerResponse): void;
  onPresenceUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  onDocumentUpgrade?(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  onOtherUpgrade?(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}

export function resolvePresenceEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function resolvePresenceLaunch(
  args: string[],
  environment: { NODE_ENV?: string; WUJIE_PRESENCE_ENABLED?: string; WUJIE_YJS_ENABLED?: string },
): { enabled: boolean; dev: boolean } {
  const dev = args.includes('--dev') || environment.NODE_ENV !== 'production';
  return {
    enabled: args.includes('--dev') || resolvePresenceEnabled(environment.WUJIE_PRESENCE_ENABLED)
      || environment.WUJIE_YJS_ENABLED === 'true',
    dev,
  };
}

export function isPresenceUpgradePath(pathname: string): boolean {
  return pathname === '/api/collaboration/presence';
}

export function isDocumentUpgradePath(pathname: string): boolean {
  return pathname === '/api/collaboration/document';
}

export function createPresenceHttpServer(options: PresenceHttpServerOptions): Server {
  const server = createServer(options.onRequest);
  server.on('upgrade', (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }

    if (isPresenceUpgradePath(pathname)) {
      options.onPresenceUpgrade(request, socket, head);
      return;
    }
    if (isDocumentUpgradePath(pathname)) {
      if (options.onDocumentUpgrade) options.onDocumentUpgrade(request, socket, head);
      else socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    if (options.onOtherUpgrade) {
      options.onOtherUpgrade(request, socket, head);
      return;
    }
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  });
  return server;
}

interface NextAppLike {
  prepare(): Promise<void>;
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => void;
  getUpgradeHandler(): (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  // Real Next owns workers/listeners; lightweight injected handlers may own none.
  close?(): Promise<void>;
}

const preparedServerClosers = new WeakMap<Server, () => Promise<void>>();

async function cleanupResources(actions: Array<() => Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(actions.map(action => Promise.resolve().then(action)));
  const errors: unknown[] = [];
  for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'PRESENCE_RESOURCE_CLEANUP_FAILED');
}

function drainHttpServer(server: Server, sockets: Set<Socket>): Promise<void> {
  return new Promise<void>((done, reject) => {
    // Stop admission first; allow short in-flight HTTP requests to finish.
    // Node's closeAllConnections excludes upgrades, so own the raw sockets too.
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
    }, 5_000);
    deadline.unref();
    server.close(error => {
      clearTimeout(deadline);
      if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')) reject(error);
      else done();
    });
  });
}

async function closePreparedPresenceServer(server: Server): Promise<void> {
  const close = preparedServerClosers.get(server);
  if (!close) throw new Error('PRESENCE_SERVER_LIFECYCLE_NOT_REGISTERED');
  await close();
}

export interface StartPresenceServerOptions {
  port: number;
  hostname: string;
  dev: boolean;
  onPresenceUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  onDocumentUpgrade?(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  createNextApp?(): NextAppLike;
}

export async function startPresenceServer(options: StartPresenceServerOptions): Promise<Server> {
  const app = options.createNextApp?.()
    ?? (await import('next')).default({
      dev: options.dev,
      hostname: options.hostname,
      port: options.port,
    });
  let appClosing: Promise<void> | undefined;
  const closeApp = (): Promise<void> => {
    appClosing ??= Promise.resolve().then(() => app.close?.());
    return appClosing;
  };
  let server: Server | undefined;
  let acceptingRequests = true;
  const sockets = new Set<Socket>();
  try {
    await app.prepare();
    const nextRequestHandler = app.getRequestHandler();
    server = createPresenceHttpServer({
      onRequest: (request, response): void => {
        // close() stops new TCP connections, but a live connection may still
        // pipeline another request. Do not admit new work while draining.
        if (!acceptingRequests) {
          response.writeHead(503, { Connection: 'close' });
          response.end();
          return;
        }
        nextRequestHandler(request, response);
      },
      onPresenceUpgrade: options.onPresenceUpgrade,
      onDocumentUpgrade: options.onDocumentUpgrade,
      ...(options.dev ? { onOtherUpgrade: app.getUpgradeHandler() } : {}),
    });
    const httpServer = server;
    server.on('connection', socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    let closing: Promise<void> | undefined;
    preparedServerClosers.set(server, (): Promise<void> => {
      acceptingRequests = false;
      closing ??= (async (): Promise<void> => {
        // Requests may register Next after()/waitUntil work while finishing.
        // Close Next only after HTTP has drained (or sockets were reclaimed),
        // but still run it and retain both failures if HTTP cleanup rejects.
        const [httpResult] = await Promise.allSettled([drainHttpServer(httpServer, sockets)]);
        await cleanupResources([closeApp, async (): Promise<void> => {
          if (httpResult.status === 'rejected') throw httpResult.reason;
        }]);
      })();
      return closing;
    });
    await new Promise<void>((ready, reject) => {
      const failed = (error: Error): void => { reject(error); };
      httpServer.once('error', failed);
      httpServer.listen(options.port, options.hostname, () => {
        httpServer.off('error', failed);
        ready();
      });
    });
    return server;
  } catch (error) {
    try {
      if (server) await closePreparedPresenceServer(server);
      else await closeApp();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'PRESENCE_START_AND_CLEANUP_FAILED', { cause: error });
    }
    throw error;
  }
}

export async function startLivePresenceServer(
  options: Omit<StartPresenceServerOptions, 'onPresenceUpgrade'>,
): Promise<{ server: Server; close(): Promise<void> }> {
  if (!resolvePresenceEnabled(process.env.WUJIE_PRESENCE_ENABLED)
      && process.env.WUJIE_YJS_ENABLED !== 'true') {
    throw new Error('WUJIE_PRESENCE_ENABLED or WUJIE_YJS_ENABLED must be true');
  }
  const [
    { createPresenceGateway }, { startPresenceMaintenance },
  ] = await Promise.all([
    import('../src/lib/collaboration/presence-gateway'),
    import('../src/lib/collaboration/presence-leases'),
  ]);
  const documentModules = process.env.WUJIE_YJS_ENABLED === 'true'
    ? await Promise.all([
      import('../src/lib/collaboration/document-gateway'),
      import('../src/lib/collaboration/document-tickets'),
    ]) : null;
  let gateway: ReturnType<typeof createPresenceGateway> | undefined;
  let documentGateway: ReturnType<typeof import('../src/lib/collaboration/document-gateway').createDocumentGateway> | null = null;
  let server: Server | undefined;
  let stopMaintenance: (() => Promise<void>) | undefined;
  let stopDocumentMaintenance: (() => Promise<void>) | undefined;
  let closing: Promise<void> | undefined;
  const closeOwnedResources = (): Promise<void> => {
    closing ??= cleanupResources([
      async (): Promise<void> => { if (server) await closePreparedPresenceServer(server); },
      async (): Promise<void> => { await stopMaintenance?.(); },
      async (): Promise<void> => { await stopDocumentMaintenance?.(); },
      async (): Promise<void> => { await gateway?.close(); },
      async (): Promise<void> => { await documentGateway?.close(); },
    ]);
    return closing;
  };
  try {
    // Acquire under the same cleanup owner from the first successful factory.
    // A later synchronous factory/maintenance failure must not strand it.
    const presenceGateway = createPresenceGateway({ instanceId: randomUUID() });
    gateway = presenceGateway;
    documentGateway = documentModules?.[0].createDocumentGateway() ?? null;
    const preparedServer = await startPresenceServer({
      ...options,
      onPresenceUpgrade: (request, socket, head) => {
        void presenceGateway.handlePresenceUpgrade(request, socket, head).catch(() => socket.destroy());
      },
      onDocumentUpgrade: (request, socket, head) => {
        if (!documentGateway) {
          socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
          return;
        }
        void documentGateway.handleDocumentUpgrade(request, socket, head).catch(() => socket.destroy());
      },
    });
    server = preparedServer;
    stopMaintenance = resolvePresenceEnabled(process.env.WUJIE_PRESENCE_ENABLED)
      ? startPresenceMaintenance() : undefined;
    stopDocumentMaintenance = documentGateway && documentModules
      ? documentModules[1].startDocumentTicketMaintenance() : undefined;
    return { server: preparedServer, close: closeOwnedResources };
  } catch (error) {
    try {
      await closeOwnedResources();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'PRESENCE_START_AND_CLEANUP_FAILED', { cause: error });
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || process.env.DEPLOY_RUN_PORT || '5000');
  const launch = resolvePresenceLaunch(process.argv.slice(2), process.env);
  if (!launch.enabled) {
    throw new Error('WUJIE_PRESENCE_ENABLED or WUJIE_YJS_ENABLED must be true');
  }
  if (process.argv.slice(2).includes('--dev')) process.env.WUJIE_PRESENCE_ENABLED = 'true';
  let shutdown: Promise<void> | undefined;
  const removeSignalHandlers = (): void => {
    process.off('SIGTERM', onTerminate);
    process.off('SIGINT', onInterrupt);
  };
  const requestShutdown = (exitCode: 130 | 143): void => {
    // The first signal owns shutdown, including a still-pending startup. Keep
    // both handlers installed while closing so repeated signals cannot force
    // an early exit or trigger duplicate cleanup.
    shutdown ??= (async (): Promise<void> => {
      try {
        const runtime = await startup;
        await runtime.close();
      } catch {
        console.error({ code: 'PRESENCE_SERVER_SHUTDOWN_FAILED' });
        removeSignalHandlers();
        process.exit(1);
      }
      removeSignalHandlers();
      process.exit(exitCode);
    })();
  };
  const onTerminate = (): void => requestShutdown(143);
  const onInterrupt = (): void => requestShutdown(130);
  process.on('SIGTERM', onTerminate);
  process.on('SIGINT', onInterrupt);
  const startup = startLivePresenceServer({
    port,
    hostname: '0.0.0.0',
    dev: launch.dev,
  });
  void startup.catch(() => {
    if (shutdown) return;
    removeSignalHandlers();
    console.error({ code: 'PRESENCE_SERVER_START_FAILED' });
    process.exitCode = 1;
  });
}
