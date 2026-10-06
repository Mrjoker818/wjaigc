import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  ensureCoreTables: vi.fn(),
  execSql: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('@/lib/db-storage', () => ({
  ensureCoreTables: dependencies.ensureCoreTables,
  dbGetCredits: vi.fn(),
  dbInitCredits: vi.fn(),
}));
vi.mock('@/lib/db-client', () => ({
  execSql: dependencies.execSql,
  getPool: dependencies.getPool,
}));

import { refundCredits } from '@/lib/credits';
import {
  refundCloudTaskCredits,
  terminateCloudTaskAndRefund,
  transitionCloudTaskToLocalFallbackAndRefund,
} from '@/lib/cloud-task-storage';

describe('refund admission while the core refund barrier is unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.ensureCoreTables.mockRejectedValue(new Error('refund barrier installation failed'));
    dependencies.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('does not update credits or write a ledger row through the generic refund path', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation((): void => {});
    try {
      expect(await refundCredits('user-a', 8, 'provider failed', 'task-a'))
        .toEqual({ success: false, balance: 0 });
      expect(dependencies.ensureCoreTables).toHaveBeenCalledOnce();
      expect(dependencies.execSql).not.toHaveBeenCalled();
      expect(dependencies.getPool).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('blocks direct, terminal, and fallback cloud refunds before any SQL write', async () => {
    await expect(refundCloudTaskCredits('task-a', 'provider failed'))
      .rejects.toThrow('refund barrier installation failed');
    await expect(terminateCloudTaskAndRefund('task-a', 'failed', 'provider failed'))
      .rejects.toThrow('refund barrier installation failed');
    await expect(transitionCloudTaskToLocalFallbackAndRefund(
      'task-a', { phase: 'fallback' }, 'provider failed', 'worker-a',
    )).rejects.toThrow('refund barrier installation failed');
    expect(dependencies.ensureCoreTables).toHaveBeenCalledTimes(3);
    expect(dependencies.execSql).not.toHaveBeenCalled();
    expect(dependencies.getPool).not.toHaveBeenCalled();
  });
});
