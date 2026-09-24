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
  return {
    ...actual,
    assertPresenceMember: async () => { throw new actual.PresenceMemberError(); },
  };
});

import { createPresenceHttpServer } from '../../../scripts/presence-server';
import { createPresenceGateway } from '../../lib/collaboration/presence-gateway';

describe('presence gateway membership race', () => {
  it('rejects with unauthorized when membership is lost after ticket consumption', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
    const gateway = createPresenceGateway({ instanceId: 'membership-race' });
    const server = createPresenceHttpServer({
      onRequest: (_request, response) => response.end('next-http'),
      onPresenceUpgrade: (request, socket, head) => {
        void gateway.handlePresenceUpgrade(request, socket, head);
      },
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const origin = `http://127.0.0.1:${port}`;
      const client = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration/presence`, [
        'wujie-presence-v1', `wujie-ticket.${'a'.repeat(43)}`,
      ], { origin });
      client.on('error', () => {});
      const [, response] = await once(client, 'unexpected-response');
      expect((response as { statusCode?: number }).statusCode).toBe(401);
      (response as { destroy(): void }).destroy();
    } finally {
      await gateway.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  });
});
