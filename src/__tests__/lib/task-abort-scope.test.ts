import { describe, expect, it } from 'vitest';

import {
  abortTaskExecution,
  createTaskAbortScope,
} from '@/lib/task-core/task-abort';

describe('task abort scopes', () => {
  it('lets nested recovery inherit cancellation without replacing the active execution', () => {
    const taskId = `nested-abort-${Date.now()}-${Math.random()}`;
    const activeExecution = createTaskAbortScope(taskId);
    const nestedRecovery = createTaskAbortScope(taskId, { preserveExisting: true });

    expect(activeExecution.signal.aborted).toBe(false);
    expect(nestedRecovery.signal.aborted).toBe(false);

    expect(abortTaskExecution(taskId, 'cancelled')).toBe(true);
    expect(activeExecution.signal.aborted).toBe(true);
    expect(nestedRecovery.signal.aborted).toBe(true);

    nestedRecovery.dispose();
    activeExecution.dispose();
  });
});
