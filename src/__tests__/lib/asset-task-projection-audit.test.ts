import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/db-client', () => ({
  getPool: () => ({ query }),
}));

import {
  recordTaskLateResultAudit,
  recordTaskProjectionCompleted,
  recordTaskProjectionPending,
} from '@/lib/asset-core/task-projector';

describe('task asset projection audit persistence', () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rowCount: 1, rows: [] });
  });

  it('increments projection_pending attempts and stores a complete retry target', async () => {
    await recordTaskProjectionPending({
      actorUserId: 'user-1',
      taskId: 'task-1',
      reason: 'asset database unavailable',
      retry: {
        targetProjectId: 'project-1',
        workspace: 'workflow',
        workspaceId: 'workflow:project-1',
        sourceEntityId: 'node-1',
        parentVersionIds: ['source-version-1'],
        projectionMode: 'derived',
      },
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("'attemptCount'");
    expect(sql).toContain("+ 1");
    expect(JSON.parse(params[2])).toMatchObject({
      lastError: 'asset database unavailable',
      retry: {
        targetProjectId: 'project-1',
        workspace: 'workflow',
        parentVersionIds: ['source-version-1'],
      },
    });
  });

  it('records completed version IDs and isolates late terminal results', async () => {
    await recordTaskProjectionCompleted({
      actorUserId: 'user-1',
      taskId: 'task-1',
      versionIds: ['version-1'],
    });
    await recordTaskLateResultAudit({
      actorUserId: 'user-1',
      taskId: 'task-1',
      terminalStatus: 'cancelled',
      urls: ['/uploads/late.png'],
    });

    expect(JSON.parse(query.mock.calls[0][1][2])).toMatchObject({
      status: 'completed',
      versionIds: ['version-1'],
    });
    expect(JSON.parse(query.mock.calls[1][1][2])).toMatchObject({
      status: 'isolated',
      terminalStatus: 'cancelled',
      urls: ['/uploads/late.png'],
    });
  });
});
