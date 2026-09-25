import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startPresenceMaintenance: vi.fn(),
  stopPresenceMaintenance: vi.fn(async () => {}),
  startDocumentTicketMaintenance: vi.fn(),
  stopDocumentTicketMaintenance: vi.fn(async () => {}),
  closePresence: vi.fn(async () => {}),
  closeDocument: vi.fn(async () => {}),
}));

vi.mock('@/lib/collaboration/presence-gateway', () => ({
  createPresenceGateway: () => ({
    handlePresenceUpgrade: vi.fn(async () => {}), close: mocks.closePresence,
  }),
}));
vi.mock('@/lib/collaboration/presence-leases', () => ({
  startPresenceMaintenance: mocks.startPresenceMaintenance,
}));
vi.mock('@/lib/collaboration/document-gateway', () => ({
  createDocumentGateway: () => ({
    handleDocumentUpgrade: vi.fn(async () => {}), close: mocks.closeDocument,
  }),
}));
vi.mock('@/lib/collaboration/document-tickets', () => ({
  startDocumentTicketMaintenance: mocks.startDocumentTicketMaintenance,
}));

afterEach(() => vi.unstubAllEnvs());

describe('Yjs-only production server lifecycle', () => {
  it('starts document ticket pruning but not presence maintenance', async () => {
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    vi.stubEnv('WUJIE_PRESENCE_ENABLED', 'false');
    mocks.startDocumentTicketMaintenance.mockReturnValue(mocks.stopDocumentTicketMaintenance);
    mocks.startPresenceMaintenance.mockReturnValue(mocks.stopPresenceMaintenance);
    const { startLivePresenceServer } = await import('../../../scripts/presence-server');
    const running = await startLivePresenceServer({
      port: 0, hostname: '127.0.0.1', dev: false,
      createNextApp: () => ({
        prepare: async () => {},
        getRequestHandler: () => (_request, response) => response.end('next-http'),
        getUpgradeHandler: () => (_request, socket) => socket.destroy(),
      }),
    });
    try {
      expect(mocks.startDocumentTicketMaintenance).toHaveBeenCalledTimes(1);
      expect(mocks.startPresenceMaintenance).not.toHaveBeenCalled();
    } finally {
      await running.close();
    }
    expect(mocks.stopDocumentTicketMaintenance).toHaveBeenCalledTimes(1);
    expect(mocks.stopPresenceMaintenance).not.toHaveBeenCalled();
  });
});
