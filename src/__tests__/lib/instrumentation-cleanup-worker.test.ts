import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ startAssetCleanupWorker: vi.fn(),
  startCpuRemoveBgPublicationWorker: vi.fn(), startCpuRemoveBgTimeoutWorker: vi.fn() }));

vi.mock('@/lib/asset-core/cleanup-worker', () => ({
  startAssetCleanupWorker: mocks.startAssetCleanupWorker,
}));
vi.mock('@/lib/collaboration/cpu-removebg-publication-worker', () => ({
  startCpuRemoveBgPublicationWorker: mocks.startCpuRemoveBgPublicationWorker,
}));
vi.mock('@/lib/collaboration/cpu-removebg-timeout-recovery', () => ({
  startCpuRemoveBgTimeoutWorker: mocks.startCpuRemoveBgTimeoutWorker,
}));
vi.mock('@/lib/db-storage', () => ({
  ensureCoreTables: vi.fn(async () => undefined), migrateFileDataToDb: vi.fn(async () => undefined),
  dbEnsureSortOrderColumn: vi.fn(async () => undefined), dbEnsureBalanceColumns: vi.fn(async () => undefined),
  detectAndRecoverOrphanedUsers: vi.fn(async () => []),
}));
vi.mock('@/lib/image-source-map', () => ({ ensureImageSourceMapTable: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai-psd/storage', () => ({ ensureAiPsdTables: vi.fn(async () => undefined) }));
vi.mock('@/lib/check-local-models', () => ({ checkLocalModels: vi.fn(async () => undefined) }));
vi.mock('child_process', () => ({ exec: vi.fn() }));

describe('Next instrumentation cleanup worker', () => {
  const originalRuntime = process.env.NEXT_RUNTIME;
  const originalPhase = process.env.NEXT_PHASE;

  afterEach(() => {
    process.env.NEXT_RUNTIME = originalRuntime;
    process.env.NEXT_PHASE = originalPhase;
    vi.resetModules();
  });

  it('starts cleanup only in the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('@/instrumentation');
    await register();
    await vi.waitFor(() => expect(mocks.startAssetCleanupWorker).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mocks.startCpuRemoveBgPublicationWorker).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mocks.startCpuRemoveBgTimeoutWorker).toHaveBeenCalledOnce());
  });

  it('does not import or start cleanup in the Edge runtime', async () => {
    mocks.startAssetCleanupWorker.mockClear();
    mocks.startCpuRemoveBgPublicationWorker.mockClear();
    mocks.startCpuRemoveBgTimeoutWorker.mockClear();
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = await import('@/instrumentation');
    await register();
    expect(mocks.startAssetCleanupWorker).not.toHaveBeenCalled();
    expect(mocks.startCpuRemoveBgPublicationWorker).not.toHaveBeenCalled();
    expect(mocks.startCpuRemoveBgTimeoutWorker).not.toHaveBeenCalled();
  });

  it('does not start cleanup during the production build phase', async () => {
    mocks.startAssetCleanupWorker.mockClear();
    mocks.startCpuRemoveBgPublicationWorker.mockClear();
    mocks.startCpuRemoveBgTimeoutWorker.mockClear();
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NEXT_PHASE = 'phase-production-build';
    const { register } = await import('@/instrumentation');
    await register();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.startAssetCleanupWorker).not.toHaveBeenCalled();
    expect(mocks.startCpuRemoveBgPublicationWorker).not.toHaveBeenCalled();
    expect(mocks.startCpuRemoveBgTimeoutWorker).not.toHaveBeenCalled();
  });
});
