import 'server-only';

import type { AddressInfo } from 'node:net';

import { createPresenceHttpServer } from '../../scripts/presence-server';
import { createPresenceGateway } from '../../src/lib/collaboration/presence-gateway';
import { closePool } from '../../src/lib/db-client';

const gateway = createPresenceGateway({ instanceId: 'independent-child-process' });
const server = createPresenceHttpServer({
  onRequest: (_request, response) => response.end('child-http'),
  onPresenceUpgrade: (request, socket, head) => {
    void gateway.handlePresenceUpgrade(request, socket, head);
  },
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${(server.address() as AddressInfo).port}\n`);
});

process.once('SIGTERM', () => {
  void (async () => {
    await gateway.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closePool();
    process.exit(0);
  })().catch(() => process.exit(1));
});
