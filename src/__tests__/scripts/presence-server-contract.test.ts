import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPresenceHttpServer,
  isPresenceUpgradePath,
  resolvePresenceEnabled,
  resolvePresenceLaunch,
  startPresenceServer,
} from '../../../scripts/presence-server';

const servers: Array<ReturnType<typeof createPresenceHttpServer>> = [];
const webSocketServers: WebSocketServer[] = [];

async function listen(server: ReturnType<typeof createPresenceHttpServer>): Promise<number> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return address.port;
}

async function connectAndRead(url: string): Promise<string> {
  const client = new WebSocket(url);
  try {
    const [message] = await once(client, 'message');
    return String(message);
  } finally {
    client.close();
    await once(client, 'close');
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
  await Promise.all(webSocketServers.splice(0).map(async (server) => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe('presence server entry boundary', () => {
  it('enables presence only for the exact true flag', () => {
    expect(resolvePresenceEnabled(undefined)).toBe(false);
    expect(resolvePresenceEnabled('false')).toBe(false);
    expect(resolvePresenceEnabled('TRUE')).toBe(false);
    expect(resolvePresenceEnabled('true')).toBe(true);
  });

  it('matches only the exact collaboration upgrade path', () => {
    expect(isPresenceUpgradePath('/api/collaboration/presence')).toBe(true);
    expect(isPresenceUpgradePath('/api/collaboration/presence/other')).toBe(false);
    expect(isPresenceUpgradePath('/api/collaboration/presence-ticket')).toBe(false);
  });

  it('enables the explicit development entry without shell-specific environment syntax', () => {
    expect(resolvePresenceLaunch(['--dev'], { NODE_ENV: 'development' })).toEqual({
      enabled: true,
      dev: true,
    });
    expect(resolvePresenceLaunch([], { NODE_ENV: 'production' })).toEqual({
      enabled: false,
      dev: false,
    });
  });

  it('keeps HTTP and development upgrades separate from presence upgrades', async () => {
    const presence = new WebSocketServer({ noServer: true });
    const nextDev = new WebSocketServer({ noServer: true });
    webSocketServers.push(presence, nextDev);
    presence.on('connection', socket => socket.send('presence'));
    nextDev.on('connection', socket => socket.send('next-dev'));

    const upgrade = (
      server: WebSocketServer,
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ): void => {
      server.handleUpgrade(request, socket, head, client => server.emit('connection', client, request));
    };
    const server = createPresenceHttpServer({
      onRequest: (_request: IncomingMessage, response: ServerResponse) => response.end('next-http'),
      onPresenceUpgrade: (request, socket, head) => upgrade(presence, request, socket, head),
      onOtherUpgrade: (request, socket, head) => upgrade(nextDev, request, socket, head),
    });
    const port = await listen(server);

    expect(await (await fetch(`http://127.0.0.1:${port}/api/auth/me`)).text()).toBe('next-http');
    expect(await connectAndRead(`ws://127.0.0.1:${port}/api/collaboration/presence`)).toBe('presence');
    expect(await connectAndRead(`ws://127.0.0.1:${port}/_next/webpack-hmr`)).toBe('next-dev');
  });

  it('rejects unknown production upgrades instead of accepting another path', async () => {
    const server = createPresenceHttpServer({
      onRequest: (_request: IncomingMessage, response: ServerResponse) => response.end('next-http'),
      onPresenceUpgrade: (_request, socket) => socket.destroy(),
    });
    const port = await listen(server);
    const client = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/presence/other`);
    client.on('error', () => {});
    const [, response] = await once(client, 'unexpected-response');
    expect((response as IncomingMessage).statusCode).toBe(404);
    (response as IncomingMessage).destroy();
  });

  it('starts a prepared Next handler and retains its development upgrade handler', async () => {
    const server = await startPresenceServer({
      port: 0,
      hostname: '127.0.0.1',
      dev: true,
      onPresenceUpgrade: (_request, socket) => {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      },
      createNextApp: () => ({
        prepare: async () => {},
        getRequestHandler: () => (_request, response) => response.end('next-ready'),
        getUpgradeHandler: () => (_request, socket) => {
          socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n');
        },
      }),
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    expect(await (await fetch(`http://127.0.0.1:${address.port}/`)).text()).toBe('next-ready');

    const client = new WebSocket(`ws://127.0.0.1:${address.port}/_next/webpack-hmr`);
    client.on('error', () => {});
    const [, response] = await once(client, 'unexpected-response');
    expect((response as IncomingMessage).statusCode).toBe(426);
    (response as IncomingMessage).destroy();
  });
});
