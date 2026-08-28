import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  completeCloudTask,
  ensureCloudTaskTables,
  getCloudTaskForUser,
} from '@/lib/cloud-task-storage';
import { execSql } from '@/lib/db-client';
import { dbInitCredits, ensureCoreTables } from '@/lib/db-storage';
import type { PsdAnalysisRequest, PsdAnalysisResult } from '@/lib/psd-analysis/contracts';
import { executePsdAnalysis } from '@/lib/psd-analysis/service';
import {
  createBillableTask,
  settleFailedTask,
} from '@/lib/task-core/billing-service';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import type { User } from '@/lib/user-types';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim()
  || process.env.TEST_POSTGRES_URL?.trim();
const suite = databaseUrl ? describe : describe.skip;

const analysis: PsdAnalysisResult = {
  backgroundColor: [255, 255, 255],
  backgroundMode: 'white',
  layers: [{ name: 'Background', role: 'bg', description: 'White background' }],
};

const candidate = {
  key: 'pear::gpt-4o',
  kind: 'provider' as const,
  providerId: 'pear',
  providerName: 'PearAPI',
  model: 'gpt-4o',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-only',
};

suite('PSD analysis PostgreSQL concurrency', () => {
  const userIds = new Set<string>();
  const taskIds = new Set<string>();

  beforeAll(async () => {
    process.env.PGDATABASE_URL = databaseUrl;
    await ensureCoreTables();
    await ensureCloudTaskTables();
  });

  afterAll(async () => {
    for (const taskId of taskIds) {
      await execSql('DELETE FROM wujie_credit_transactions WHERE reference_id = $1', [taskId]);
      await execSql('DELETE FROM cloud_tasks WHERE id = $1', [taskId]);
    }
    for (const userId of userIds) {
      await execSql('DELETE FROM wujie_credits WHERE user_id = $1', [userId]);
    }
  });

  function createUser(): User {
    const id = `psd-pg-${randomUUID()}`;
    userIds.add(id);
    return {
      id,
      name: 'PSD PostgreSQL Test',
      role: 'user',
      chatModels: ['pear::gpt-4o'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function request(idempotencyKey: string, image = 'data:image/png;base64,aW1hZ2U='): PsdAnalysisRequest {
    return { image, idempotencyKey };
  }

  function serviceDependencies(input: {
    sha256: string;
    invokeVision: () => Promise<{
      content: string;
      providerId: string;
      providerName: string;
      model: string;
    }>;
  }) {
    return {
      resolveMedia: vi.fn().mockResolvedValue({
        buffer: Buffer.from('image'),
        mimeType: 'image/png',
        width: 16,
        height: 16,
        sha256: input.sha256,
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
      }),
      loadProviders: vi.fn().mockResolvedValue([]),
      buildCandidates: vi.fn().mockReturnValue([candidate]),
      invokeVision: vi.fn(input.invokeVision),
      creditCost: 15,
      createTaskId: () => {
        const taskId = `psd-pg-task-${randomUUID()}`;
        taskIds.add(taskId);
        return taskId;
      },
      createLeaseOwner: () => `psd-pg-worker-${randomUUID()}`,
      now: Date.now,
      wait: (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, Math.min(milliseconds, 20));
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      }),
    };
  }

  it('reuses one task and one charge for concurrent identical PSD requests', async () => {
    const user = createUser();
    await dbInitCredits(user.id, 100);
    const idempotencyKey = `psd-analysis-${randomUUID()}`;
    let invocationCount = 0;
    const dependencies = serviceDependencies({
      sha256: 'a'.repeat(64),
      invokeVision: async () => {
        invocationCount += 1;
        await new Promise(resolve => setTimeout(resolve, 80));
        return {
          content: JSON.stringify(analysis),
          providerId: 'pear',
          providerName: 'PearAPI',
          model: 'gpt-4o',
        };
      },
    });

    const [first, second] = await Promise.all([
      executePsdAnalysis({
        request: request(idempotencyKey),
        user,
        requestId: `req-${randomUUID()}`,
        scheduleBackground: work => { void work(); },
        dependencies,
      }),
      executePsdAnalysis({
        request: request(idempotencyKey),
        user,
        requestId: `req-${randomUUID()}`,
        scheduleBackground: work => { void work(); },
        dependencies,
      }),
    ]);

    expect(first.taskId).toBe(second.taskId);
    expect(invocationCount).toBe(1);
    expect(first.analysis).toEqual(analysis);
    expect(second.analysis).toEqual(analysis);

    const persisted = await execSql(
      `SELECT
         (SELECT COUNT(*) FROM cloud_tasks WHERE user_id = $1 AND idempotency_key = $2) AS task_count,
         (SELECT COUNT(*) FROM wujie_credit_transactions WHERE reference_id = $3 AND type = 'consume') AS consume_count,
         (SELECT balance FROM wujie_credits WHERE user_id = $1) AS balance,
         (SELECT total_used FROM wujie_credits WHERE user_id = $1) AS total_used`,
      [user.id, idempotencyKey, first.taskId],
    );
    expect(persisted.rows[0]).toMatchObject({
      task_count: '1',
      consume_count: '1',
    });
    expect(Number(persisted.rows[0].balance)).toBe(85);
    expect(Number(persisted.rows[0].total_used)).toBe(15);

    const task = await getCloudTaskForUser(first.taskId, user.id);
    expect(task).toMatchObject({ status: 'completed', creditStatus: 'charged' });
  });

  it('rejects the same idempotency key with a different PSD request digest', async () => {
    const user = createUser();
    await dbInitCredits(user.id, 100);
    const idempotencyKey = `psd-analysis-${randomUUID()}`;
    const invocation = vi.fn().mockResolvedValue({
      content: JSON.stringify(analysis),
      providerId: 'pear',
      providerName: 'PearAPI',
      model: 'gpt-4o',
    });

    const first = await executePsdAnalysis({
      request: request(idempotencyKey),
      user,
      requestId: `req-${randomUUID()}`,
      scheduleBackground: work => { void work(); },
      dependencies: serviceDependencies({ sha256: 'b'.repeat(64), invokeVision: invocation }),
    });

    await expect(executePsdAnalysis({
      request: request(idempotencyKey, 'data:image/png;base64,ZGlmZmVyZW50'),
      user,
      requestId: `req-${randomUUID()}`,
      scheduleBackground: work => { void work(); },
      dependencies: serviceDependencies({ sha256: 'c'.repeat(64), invokeVision: invocation }),
    })).rejects.toBeInstanceOf(IdempotencyConflictError);

    expect(invocation).toHaveBeenCalledTimes(1);
    const persisted = await execSql(
      `SELECT
         (SELECT COUNT(*) FROM cloud_tasks WHERE user_id = $1 AND idempotency_key = $2) AS task_count,
         (SELECT COUNT(*) FROM wujie_credit_transactions WHERE reference_id = $3 AND type = 'consume') AS consume_count,
         (SELECT balance FROM wujie_credits WHERE user_id = $1) AS balance`,
      [user.id, idempotencyKey, first.taskId],
    );
    expect(persisted.rows[0]).toMatchObject({
      task_count: '1',
      consume_count: '1',
    });
    expect(Number(persisted.rows[0].balance)).toBe(85);
  });

  it('allows only one terminal winner and at most one refund when all PSD terminals race', async () => {
    const user = createUser();
    await dbInitCredits(user.id, 100);
    const taskId = `psd-pg-race-${randomUUID()}`;
    const leaseOwner = `psd-pg-race-worker-${randomUUID()}`;
    taskIds.add(taskId);
    const claim = await createBillableTask({
      userId: user.id,
      idempotencyKey: `psd-analysis-${randomUUID()}`,
      requestDigest: 'd'.repeat(64),
      creditCost: 15,
      task: {
        id: taskId,
        type: 'psd-analysis',
        status: 'processing',
        progress: 5,
        leaseOwner,
        leaseExpiresAt: Date.now() + 60_000,
        attemptCount: 1,
        result: { schema: 'psd-analysis-task.v1' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    expect(claim).toMatchObject({ reused: false, charged: true });

    const [completed, failed, timeout, cancelled] = await Promise.all([
      completeCloudTask(taskId, {
        schema: 'psd-analysis-result.v1',
        requestId: 'req-race',
        imageSha256: 'd'.repeat(64),
        providerId: 'pear',
        model: 'gpt-4o',
        analysis,
      }, { leaseOwner, deadlineAt: Date.now() + 30_000 }),
      settleFailedTask({
        taskId,
        status: 'failed',
        leaseOwner,
        error: { code: 'PSD_ANALYSIS_FAILED', message: 'race failure', retryable: true },
      }),
      settleFailedTask({
        taskId,
        status: 'timeout',
        leaseOwner,
        error: { code: 'PSD_ANALYSIS_TIMEOUT', message: 'race timeout', retryable: true },
      }),
      settleFailedTask({
        taskId,
        status: 'cancelled',
        leaseOwner,
        error: { code: 'PSD_ANALYSIS_CANCELLED', message: 'race cancellation', retryable: false },
      }),
    ]);

    const terminalWinners = Number(completed)
      + [failed, timeout, cancelled].filter(result => result.transitioned).length;
    const refunds = [failed, timeout, cancelled].filter(result => result.refunded).length;
    expect(terminalWinners).toBe(1);
    expect(refunds).toBeLessThanOrEqual(1);

    const winner = await getCloudTaskForUser(taskId, user.id);
    expect(['completed', 'failed', 'timeout', 'cancelled']).toContain(winner?.status);
    const lateCompletion = await completeCloudTask(taskId, { late: true }, { leaseOwner });
    const lateFailure = await settleFailedTask({
      taskId,
      status: 'failed',
      leaseOwner,
      error: { code: 'PSD_ANALYSIS_LATE', message: 'late failure', retryable: false },
    });
    expect(lateCompletion).toBe(false);
    expect(lateFailure).toEqual({ transitioned: false, refunded: false });

    const finalTask = await getCloudTaskForUser(taskId, user.id);
    expect(finalTask?.status).toBe(winner?.status);
    const persisted = await execSql(
      `SELECT
         (SELECT COUNT(*) FROM wujie_credit_transactions WHERE reference_id = $1 AND type = 'consume') AS consume_count,
         (SELECT COUNT(*) FROM wujie_credit_transactions WHERE reference_id = $1 AND type = 'refund') AS refund_count,
         (SELECT balance FROM wujie_credits WHERE user_id = $2) AS balance`,
      [taskId, user.id],
    );
    expect(persisted.rows[0].consume_count).toBe('1');
    expect(Number(persisted.rows[0].refund_count)).toBe(refunds);
    expect(Number(persisted.rows[0].balance)).toBe(refunds === 1 ? 100 : 85);
  });
});
