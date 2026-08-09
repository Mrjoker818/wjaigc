import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/poll-3d-task/route.ts'),
  'utf8',
);

describe('3d polling task identity bridge', () => {
  it('resolves the supplier id while retaining the local persistence id', () => {
    expect(source).toContain('await getCloudTaskById(body.taskId)');
    expect(source).toContain('const persistenceTaskId = persistedTask?.id || body.taskId');
    expect(source).toContain('taskId: persistedTask.remoteTaskId');
    expect(source).toContain('recordThreeDTaskTerminal(persistenceTaskId');
    expect(source).toContain('taskId: persistenceTaskId');
  });

  it('persists terminal state before responding and atomically refunds failures', () => {
    expect(source).not.toMatch(/void\s+recordThreeDTaskTerminal/);
    expect(source).toContain('await recordThreeDTaskTerminal(persistenceTaskId');
    expect(source).toContain('await settleFailedTask({');
  });

  it('replays a persisted terminal task without polling the supplier again', () => {
    expect(source).toContain("persistedTask?.status === 'completed'");
    expect(source).toContain("persistedTask.status === 'failed'");
    expect(source).toContain('const persistedResult = persistedTask?.result || {}');
  });
});
