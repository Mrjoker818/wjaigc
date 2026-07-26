import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execSql } = vi.hoisted(() => ({ execSql: vi.fn() }));

vi.mock('@/lib/db-client', () => ({ execSql }));

import {
  completeCloudTask,
  terminateCloudTaskAndRefund,
} from '@/lib/cloud-task-storage';

describe('annotation database terminal state machine', () => {
  beforeEach(() => {
    execSql.mockReset();
    execSql.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('allows completed only through a processing conditional update', async () => {
    execSql.mockImplementation(async (statement: string) => (
      statement.includes("status = 'completed'")
        ? { rows: [{ id: 'task-1' }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    ));

    await expect(completeCloudTask('task-1', { image: { url: '/done.png' } }))
      .resolves.toBe(true);

    const statement = execSql.mock.calls
      .map((call) => call[0] as string)
      .find((sql) => sql.includes("status = 'completed'")) || '';
    expect(statement).toContain("status = 'completed'");
    expect(statement).toContain("WHERE id = $1 AND status = 'processing'");
  });

  it('refuses a late completion after another terminal state won', async () => {
    execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(completeCloudTask('task-cancelled', {})).resolves.toBe(false);
  });

  it.each(['failed', 'timeout', 'cancelled'] as const)(
    'settles %s and its refund from the persisted terminal state atomically',
    async (status) => {
      execSql.mockResolvedValueOnce({
        rows: [{
          status,
          refunded: true,
          credit_cost: 8,
          balance: 100,
          user_id: 'user-1',
        }],
        rowCount: 1,
      });

      const result = await terminateCloudTaskAndRefund('task-1', status, 'terminal reason');
      const statement = execSql.mock.calls[0][0] as string;

      expect(statement).toContain("status IN ('pending', 'processing')");
      expect(statement).toContain("status IN ('failed', 'timeout', 'cancelled')");
      expect(statement).toContain("credit_status = 'pending'");
      expect(statement).not.toContain("status = 'completed'");
      expect(result).toMatchObject({ status, refunded: true, creditCost: 8 });
    },
  );
});
