import { describe, expect, it } from 'vitest';
import {
  acknowledgeSimpleChatOperations,
  compactSimpleChatOperations,
  diffSimpleChatProjects,
  replaySimpleChatOperations,
  validateSimpleChatProjects,
} from '@/lib/simple-chat-project-sync';
import {
  op,
  project,
  task,
  taskWithMessages,
} from '@/__tests__/fixtures/simple-chat-sync';

describe('simple chat project synchronization', () => {
  it('does not resurrect a remote-deleted project without a pending operation', () => {
    const base = [project('p1', [task('t1')])];
    const operations = diffSimpleChatProjects(base, base, 1);
    expect(replaySimpleChatOperations([], operations).projects).toEqual([]);
  });

  it('creates a conflict copy when remote deleted an explicitly edited local task', () => {
    const before = [project('p1', [task('t1', '旧标题')])];
    const current = [project('p1', [task('t1', '本地标题')])];
    const operations = diffSimpleChatProjects(before, current, 1);
    const result = replaySimpleChatOperations([project('p1', [])], operations);
    expect(result.conflicts).toHaveLength(1);
    expect(result.projects[0].tasks[0].id).not.toBe('t1');
    expect(result.projects[0].tasks[0].name).toContain('冲突副本');
  });

  it('preserves the remote entity and creates a local conflict copy when both changed it', () => {
    const before = [project('p1', [task('t1', '基线')])];
    const current = [project('p1', [task('t1', '本地修改')])];
    const remote = [project('p1', [task('t1', '远端修改')])];
    const result = replaySimpleChatOperations(
      remote,
      diffSimpleChatProjects(before, current, 1),
      { createId: () => 'conflict-task', now: () => 100 },
    );
    expect(result.projects[0].tasks.map(item => item.name)).toEqual([
      '远端修改',
      '本地修改（冲突副本）',
    ]);
  });

  it('keeps operations created after the acknowledged batch', () => {
    const operations = [op('op-1', 1), op('op-2', 2)];
    expect(acknowledgeSimpleChatOperations(operations, ['op-1']))
      .toEqual([operations[1]]);
  });

  it('rejects payloads above the approved message limit', () => {
    const oversized = project('p1', [taskWithMessages('t1', 10_001)]);
    expect(validateSimpleChatProjects([oversized])).toMatchObject({
      success: false,
      code: 'CHAT_SYNC_LIMIT_EXCEEDED',
      field: 'messages',
    });
  });

  it('compacts consecutive upserts to the earliest base value and latest value', () => {
    const operations = compactSimpleChatOperations([
      {
        operationId: 'op-1',
        sequence: 1,
        kind: 'upsert',
        entityType: 'task',
        projectId: 'p1',
        taskId: 't1',
        entityId: 't1',
        baseValue: { name: 'before' },
        value: { name: 'middle' },
      },
      {
        operationId: 'op-2',
        sequence: 2,
        kind: 'upsert',
        entityType: 'task',
        projectId: 'p1',
        taskId: 't1',
        entityId: 't1',
        baseValue: { name: 'middle' },
        value: { name: 'after' },
      },
    ]);

    expect(operations).toEqual([{
      operationId: 'op-2',
      sequence: 2,
      kind: 'upsert',
      entityType: 'task',
      projectId: 'p1',
      taskId: 't1',
      entityId: 't1',
      baseValue: { name: 'before' },
      value: { name: 'after' },
    }]);
  });
});
