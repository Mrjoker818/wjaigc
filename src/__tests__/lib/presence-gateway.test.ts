import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';

import { createPresenceHttpServer } from '../../../scripts/presence-server';
import { createPresenceGateway } from '../../lib/collaboration/presence-gateway';

vi.mock('server-only', () => ({}));

async function rejectedStatus(client: WebSocket): Promise<number> {
  client.on('error', () => {});
  const [, response] = await once(client, 'unexpected-response');
  const status = (response as { statusCode?: number; destroy(): void }).statusCode;
  (response as { destroy(): void }).destroy();
  return status ?? 0;
}

describe('presence gateway pre-upgrade boundary', () => {
  it('rejects malformed, cross-origin, query-ticket, and disabled upgrades before database access', async () => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
    const gateway = createPresenceGateway({ instanceId: 'preflight-test' });
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
      const url = `ws://127.0.0.1:${port}/api/collaboration/presence`;
      const ticket = `wujie-ticket.${'a'.repeat(43)}`;
      expect(await rejectedStatus(new WebSocket(url, ['wujie-presence-v1'], { origin }))).toBe(401);
      expect(await rejectedStatus(new WebSocket(url, ['wrong-version', ticket], { origin }))).toBe(401);
      expect(await rejectedStatus(new WebSocket(url, ['wujie-presence-v1', ticket], {
        origin: 'https://attacker.example',
      }))).toBe(403);
      expect(await rejectedStatus(new WebSocket(`${url}?ticket=secret`, [
        'wujie-presence-v1', ticket,
      ], { origin }))).toBe(403);
      vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'false');
      expect(await rejectedStatus(new WebSocket(url, ['wujie-presence-v1', ticket], { origin })))
        .toBe(503);
      expect(await (await fetch(`${origin}/api/auth/me`)).text()).toBe('next-http');
    } finally {
      await gateway.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  });
});
