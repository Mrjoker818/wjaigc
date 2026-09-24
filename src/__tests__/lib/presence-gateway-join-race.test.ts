import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/collaboration/presence-tickets', () => ({
  consumePresenceTicket: async () => ({ userId: 'member-a', projectId: 'project-a' }),
}));
vi.mock('../../lib/collaboration/presence-members', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/collaboration/presence-members')>();
  return { ...actual, assertPresenceMember: async () => {} };
});
vi.mock('../../lib/collaboration/presence-leases', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/collaboration/presence-leases')>();
  const { PresenceMemberError } = await import('../../lib/collaboration/presence-members');
  return { ...actual, joinPresence: async () => { throw new PresenceMemberError(); } };
});

import { createPresenceHttpServer } from '../../../scripts/presence-server';
import { createPresenceGateway } from '../../lib/collaboration/presence-gateway';

describe('presence gateway join authorization race', () => {
  it('closes with policy violation when membership disappears during join', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
    const gateway = createPresenceGateway({ instanceId: 'join-race' });
    const server = createPresenceHttpServer({
      onRequest: (_request, response) => response.end('next-http'),
      onPresenceUpgrade: (request, socket, head) => {
        void gateway.handlePresenceUpgrade(request, socket, head);
      },
    });
    let client: WebSocket | undefined;
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      client = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/presence`, [
        'wujie-presence-v1', `wujie-ticket.${'a'.repeat(43)}`,
      ], { origin: `http://127.0.0.1:${port}` });
      client.on('error', () => {});
      const [code] = await once(client, 'close');
      expect(code).toBe(1008);
    } finally {
      client?.terminate();
      await gateway.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  });
});
