import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Duplex } from 'node:stream';

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
  await app.prepare();
  const server = createPresenceHttpServer({
    onRequest: app.getRequestHandler(),
    onPresenceUpgrade: options.onPresenceUpgrade,
    onDocumentUpgrade: options.onDocumentUpgrade,
    ...(options.dev ? { onOtherUpgrade: app.getUpgradeHandler() } : {}),
  });
  try {
    await new Promise<void>((ready, reject) => {
      server.once('error', reject);
      server.listen(options.port, options.hostname, ready);
    });
  } catch (error) {
    server.close();
    throw error;
  }
  return server;
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
    { createDocumentGateway }, { startDocumentTicketMaintenance },
  ] = await Promise.all([
    import('../src/lib/collaboration/presence-gateway'),
    import('../src/lib/collaboration/presence-leases'),
    import('../src/lib/collaboration/document-gateway'),
    import('../src/lib/collaboration/document-tickets'),
  ]);
  const gateway = createPresenceGateway({ instanceId: randomUUID() });
  const documentGateway = process.env.WUJIE_YJS_ENABLED === 'true'
    ? createDocumentGateway() : null;
  let server: Server;
  try {
    server = await startPresenceServer({
      ...options,
      onPresenceUpgrade: (request, socket, head) => {
        void gateway.handlePresenceUpgrade(request, socket, head).catch(() => socket.destroy());
      },
      onDocumentUpgrade: (request, socket, head) => {
        if (!documentGateway) {
          socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
          return;
        }
        void documentGateway.handleDocumentUpgrade(request, socket, head).catch(() => socket.destroy());
      },
    });
  } catch (error) {
    await gateway.close();
    await documentGateway?.close();
    throw error;
  }
  const stopMaintenance = resolvePresenceEnabled(process.env.WUJIE_PRESENCE_ENABLED)
    ? startPresenceMaintenance() : async (): Promise<void> => {};
  const stopDocumentMaintenance = documentGateway
    ? startDocumentTicketMaintenance() : async (): Promise<void> => {};
  return {
    server,
    async close(): Promise<void> {
      await gateway.close();
      await documentGateway?.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await stopMaintenance();
      await stopDocumentMaintenance();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || process.env.DEPLOY_RUN_PORT || '5000');
  const launch = resolvePresenceLaunch(process.argv.slice(2), process.env);
  if (!launch.enabled) {
    throw new Error('WUJIE_PRESENCE_ENABLED or WUJIE_YJS_ENABLED must be true');
  }
  if (process.argv.slice(2).includes('--dev')) process.env.WUJIE_PRESENCE_ENABLED = 'true';
  void startLivePresenceServer({
    port,
    hostname: '0.0.0.0',
    dev: launch.dev,
  }).catch(() => {
    console.error({ code: 'PRESENCE_SERVER_START_FAILED' });
    process.exitCode = 1;
  });
}
