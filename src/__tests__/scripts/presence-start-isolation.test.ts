import { get } from 'node:http';
import type { Server } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const disabledDocumentModules = [
  ['gateway', '@/lib/collaboration/document-gateway'],
  ['tickets', '@/lib/collaboration/document-tickets'],
] as const;

function serverPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback TCP address');
  return address.port;
}

async function documentUpgradeStatus(port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = get({
      hostname: '127.0.0.1', port, path: '/api/collaboration/document',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
    });
    request.once('response', response => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.once('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 0);
    });
    request.once('error', reject);
    request.setTimeout(2_000, () => request.destroy(new Error('Document upgrade response timed out')));
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@/lib/collaboration/document-gateway');
  vi.doUnmock('@/lib/collaboration/document-tickets');
  vi.doUnmock('@/lib/collaboration/presence-leases');
  vi.resetModules();
});

describe('presence-only startup isolation from disabled document modules', () => {
  it.each(disabledDocumentModules)('keeps HTTP available when the disabled document %s cannot load', async (_label, modulePath) => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
    vi.doMock(modulePath, () => { throw new Error('CONTROLLED_DOCUMENT_MODULE_LOAD_FAILURE'); });
    // Real gateway and HTTP/upgrade routing remain intact. Only maintenance is
    // disabled here: its timer would query PostgreSQL outside this loading test.
    vi.doMock('@/lib/collaboration/presence-leases', async importOriginal => ({
      ...await importOriginal<typeof import('@/lib/collaboration/presence-leases')>(),
      startPresenceMaintenance: (): (() => Promise<void>) => async (): Promise<void> => {},
    }));
    const { startLivePresenceServer } = await import('../../../scripts/presence-server');
    const runtime = await startLivePresenceServer({
      port: 0, hostname: '127.0.0.1', dev: false,
      createNextApp: () => ({
        prepare: async (): Promise<void> => {},
        getRequestHandler: () => (_request, response): void => { response.end('controlled-next-handler'); },
        getUpgradeHandler: () => (_request, socket): void => { socket.destroy(); },
      }),
    });
    try {
      const port = serverPort(runtime.server);
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
        signal: AbortSignal.timeout(2_000),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('controlled-next-handler');
      expect(await documentUpgradeStatus(port)).toBe(503);
    } finally {
      runtime.server.closeAllConnections();
      await runtime.close();
    }
  });

  it.each(disabledDocumentModules)('does not hide an enabled document %s loading failure', async (_label, modulePath) => {
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'true');
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    vi.doMock(modulePath, () => { throw new Error('CONTROLLED_DOCUMENT_MODULE_LOAD_FAILURE'); });
    const { startLivePresenceServer } = await import('../../../scripts/presence-server');
    await expect(startLivePresenceServer({ port: 0, hostname: '127.0.0.1', dev: false }))
      .rejects.toMatchObject({ cause: { message: 'CONTROLLED_DOCUMENT_MODULE_LOAD_FAILURE' } });
  });
});
