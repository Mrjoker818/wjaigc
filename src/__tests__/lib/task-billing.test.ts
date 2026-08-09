import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  createBillableCloudTask: vi.fn(),
  settleFailedCloudTask: vi.fn(),
}));
const registry = vi.hoisted(() => ({
  markTaskDurable: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

vi.mock('@/lib/cloud-task-storage', () => storage);
vi.mock('@/lib/task-registry', () => registry);

import {
  createBillableTask,
  settleFailedTask,
} from '@/lib/task-core/billing-service';
import {
  createIdempotencyLockKey,
  IdempotencyConflictError,
  validateIdempotencyIdentity,
} from '@/lib/task-core/idempotency';

const persistedTask = {
  id: 'task-owner',
  userId: 'user-a',
  type: 'generate',
  status: 'processing' as const,
  progress: 0,
  creditStatus: 'pending' as const,
  creditCost: 7,
  requestDigest: 'digest-a',
  chargedTransactionId: 'ctx_charge_task-owner',
  createdAt: 100,
  updatedAt: 100,
  idempotencyKey: 'request-key',
  revision: 0,
};

describe('task billing service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the durable winner and reports whether this call charged it', async () => {
    storage.createBillableCloudTask.mockResolvedValue({
      task: persistedTask,
      reused: false,
      charged: true,
    });

    await expect(createBillableTask({
      userId: 'user-a',
      idempotencyKey: 'request-key',
      requestDigest: 'digest-a',
      creditCost: 7,
      task: {
        id: 'task-owner',
        type: 'generate',
        status: 'processing',
        progress: 0,
        createdAt: 100,
        updatedAt: 100,
      },
    })).resolves.toEqual({
      task: persistedTask,
      reused: false,
      charged: true,
    });

    expect(storage.createBillableCloudTask).toHaveBeenCalledWith({
      userId: 'user-a',
      idempotencyKey: 'request-key',
      requestDigest: 'digest-a',
      creditCost: 7,
      task: expect.objectContaining({
        id: 'task-owner',
        userId: 'user-a',
        idempotencyKey: 'request-key',
        requestDigest: 'digest-a',
      }),
    });
    expect(registry.markTaskDurable).toHaveBeenCalledWith('task-owner');
  });

  it('exposes an idempotency conflict that API routes can map to HTTP 409', () => {
    const error = new IdempotencyConflictError({
      userId: 'user-a',
      idempotencyKey: 'request-key',
      existingDigest: 'digest-a',
      requestDigest: 'digest-b',
    });

    expect(error).toMatchObject({
      name: 'IdempotencyConflictError',
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
      statusCode: 409,
    });
  });

  it('rejects blank or oversized idempotency identities before database access', () => {
    expect(() => validateIdempotencyIdentity({
      userId: ' ',
      idempotencyKey: 'request-key',
      requestDigest: 'digest-a',
    })).toThrow('userId');
    expect(() => validateIdempotencyIdentity({
      userId: 'user-a',
      idempotencyKey: 'x'.repeat(257),
      requestDigest: 'digest-a',
    })).toThrow('idempotencyKey');
    expect(() => validateIdempotencyIdentity({
      userId: 'user-a',
      idempotencyKey: 'request-key',
      requestDigest: '',
    })).toThrow('requestDigest');
  });

  it('encodes advisory lock identities without PostgreSQL NUL bytes or tuple collisions', () => {
    const lockKey = createIdempotencyLockKey('user-a', 'request-key');

    expect(lockKey).not.toContain('\0');
    expect(createIdempotencyLockKey('ab', 'c')).not.toBe(
      createIdempotencyLockKey('a', 'bc'),
    );
  });

  it('publishes only the terminal transition that won the database race', async () => {
    storage.settleFailedCloudTask
      .mockResolvedValueOnce({
        task: {
          ...persistedTask,
          status: 'timeout',
          progress: 0,
          creditStatus: 'refunded',
          refundedTransactionId: 'ctx_refund_task-owner',
          error: 'Provider timed out',
          revision: 1,
        },
        transitioned: true,
        refunded: true,
      })
      .mockResolvedValueOnce({
        task: {
          ...persistedTask,
          status: 'timeout',
          progress: 0,
          creditStatus: 'refunded',
          refundedTransactionId: 'ctx_refund_task-owner',
          error: 'Provider timed out',
          revision: 1,
        },
        transitioned: false,
        refunded: false,
      });

    await expect(settleFailedTask({
      taskId: 'task-owner',
      status: 'timeout',
      error: { code: 'MODEL_TIMEOUT', message: 'Provider timed out' },
    })).resolves.toEqual({ transitioned: true, refunded: true });
    await expect(settleFailedTask({
      taskId: 'task-owner',
      status: 'failed',
      error: { code: 'MODEL_FAILED', message: 'Provider failed late' },
    })).resolves.toEqual({ transitioned: false, refunded: false });

    expect(registry.updateTaskProgress).toHaveBeenCalledTimes(1);
    expect(registry.updateTaskProgress).toHaveBeenCalledWith('task-owner', {
      status: 'timeout',
      progress: 0,
      error: 'Provider timed out',
    });
  });

  it('preserves cancellation when projecting the database winner', async () => {
    storage.settleFailedCloudTask.mockResolvedValue({
      task: {
        ...persistedTask,
        status: 'cancelled',
        progress: 0,
        creditStatus: 'refunded',
        refundedTransactionId: 'ctx_refund_task-owner',
        error: 'User cancelled',
        revision: 1,
      },
      transitioned: true,
      refunded: true,
    });

    await expect(settleFailedTask({
      taskId: 'task-owner',
      status: 'cancelled',
      error: { code: 'USER_CANCELLED', message: 'User cancelled' },
    })).resolves.toEqual({ transitioned: true, refunded: true });

    expect(registry.updateTaskProgress).toHaveBeenCalledWith('task-owner', {
      status: 'cancelled',
      progress: 0,
      error: 'User cancelled',
    });
  });

  it('keeps task creation, credit mutation, and ledger writes in explicit transactions', () => {
    const storageSource = readFileSync(
      resolve(process.cwd(), 'src/lib/cloud-task-storage.ts'),
      'utf8',
    );

    expect(storageSource).toContain("client.query('BEGIN')");
    expect(storageSource).toContain("client.query('COMMIT')");
    expect(storageSource).toContain("client.query('ROLLBACK')");
    expect(storageSource).toContain('pg_advisory_xact_lock');
    expect(storageSource).toContain('FOR UPDATE');
    expect(storageSource).toContain('request_digest');
    expect(storageSource).toContain('charged_transaction_id');
    expect(storageSource).toContain('refunded_transaction_id');
  });

  it('installs additive task billing columns and one-ledger-entry guards', () => {
    const cloudTaskSource = readFileSync(
      resolve(process.cwd(), 'src/lib/cloud-task-storage.ts'),
      'utf8',
    );
    const databaseSource = readFileSync(
      resolve(process.cwd(), 'src/lib/db-storage.ts'),
      'utf8',
    );

    expect(cloudTaskSource).toContain(
      "ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS request_digest",
    );
    expect(cloudTaskSource).toContain(
      "ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS charged_transaction_id",
    );
    expect(cloudTaskSource).toContain(
      "ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS refunded_transaction_id",
    );
    expect(databaseSource).toContain(
      "['wujie_credit_transactions', 'task_id', 'TEXT DEFAULT \\'\\'']",
    );
    expect(databaseSource).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_task_type_once',
    );
  });
});

describe('task billing initialization and legacy safety', () => {
  it('serializes concurrent core table initialization and retries after failure', async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/db-storage');

    let rejectInitialization: ((error: Error) => void) | undefined;
    const failedInitialization = new Promise<never>((_, reject) => {
      rejectInitialization = reject;
    });
    let coreCreateCalls = 0;
    const execSql = vi.fn((sql: string) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS wujie_users')) {
        coreCreateCalls += 1;
        if (coreCreateCalls === 1) return failedInitialization;
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    vi.doMock('@/lib/db-client', () => ({
      execSql,
      getPool: vi.fn(),
    }));

    const { ensureCoreTables } = await import('@/lib/db-storage');
    const attempts = Array.from({ length: 20 }, () => ensureCoreTables());

    await vi.waitFor(() => {
      expect(coreCreateCalls).toBe(1);
    });
    rejectInitialization?.(new Error('core ddl failed'));
    const failures = await Promise.allSettled(attempts);

    expect(failures.every(({ status }) => status === 'rejected')).toBe(true);
    await expect(ensureCoreTables()).resolves.toBeUndefined();
    expect(coreCreateCalls).toBe(2);
  });

  it('serializes concurrent cloud task initialization and retries after failure', async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/cloud-task-storage');

    let rejectInitialization: ((error: Error) => void) | undefined;
    const failedInitialization = new Promise<never>((_, reject) => {
      rejectInitialization = reject;
    });
    let cloudCreateCalls = 0;
    const execSql = vi.fn((sql: string) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS cloud_tasks')) {
        cloudCreateCalls += 1;
        if (cloudCreateCalls === 1) return failedInitialization;
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    vi.doMock('@/lib/db-client', () => ({
      execSql,
      getPool: vi.fn(),
    }));

    const { ensureCloudTaskTables } = await import(
      '@/lib/cloud-task-storage'
    );
    const attempts = Array.from(
      { length: 20 },
      () => ensureCloudTaskTables(),
    );

    await vi.waitFor(() => {
      expect(cloudCreateCalls).toBe(1);
    });
    rejectInitialization?.(new Error('cloud ddl failed'));
    const failures = await Promise.allSettled(attempts);

    expect(failures.every(({ status }) => status === 'rejected')).toBe(true);
    await expect(ensureCloudTaskTables()).resolves.toBeUndefined();
    expect(cloudCreateCalls).toBe(2);
  });

  it('rejects reuse when a legacy task has no verifiable request digest', async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/cloud-task-storage');

    const execSql = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rows: [{}], rowCount: 1 };
      }
      if (
        sql.includes('SELECT * FROM cloud_tasks')
        && sql.includes('idempotency_key')
      ) {
        return {
          rows: [{
            id: 'legacy-task',
            user_id: 'user-a',
            type: 'generate',
            status: 'processing',
            progress: 0,
            result: {},
            credit_status: 'pending',
            credit_cost: 7,
            idempotency_key: 'legacy-key',
            request_digest: '',
            revision: 0,
            created_at: 100,
            updated_at: 100,
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    });
    const release = vi.fn();
    vi.doMock('@/lib/db-client', () => ({
      execSql,
      getPool: () => ({
        connect: async () => ({ query, release }),
      }),
    }));

    const { createBillableCloudTask } = await import(
      '@/lib/cloud-task-storage'
    );
    await expect(createBillableCloudTask({
      userId: 'user-a',
      idempotencyKey: 'legacy-key',
      requestDigest: 'new-digest',
      creditCost: 7,
      task: {
        id: 'new-task',
        userId: 'user-a',
        type: 'generate',
        status: 'processing',
        progress: 0,
        createdAt: 200,
        updatedAt: 200,
      },
    })).rejects.toMatchObject({
      name: 'IdempotencyConflictError',
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
      details: {
        existingDigest: 'legacy-unknown',
        requestDigest: 'new-digest',
      },
    });

    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('SET request_digest')
      ),
    ).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
});
