import { describe, expect, it } from 'vitest';
import { isPendingLocalAsyncGenerateTask } from '@/lib/async-generate-task';

describe('isPendingLocalAsyncGenerateTask', () => {
  it('keeps an outer submitOnly generation task on its local progress path', () => {
    expect(isPendingLocalAsyncGenerateTask({
      type: 'generate-async',
      status: 'processing',
    })).toBe(true);
  });

  it('does not classify completed outer tasks or ordinary provider tasks as local pending tasks', () => {
    expect(isPendingLocalAsyncGenerateTask({
      type: 'generate-async',
      status: 'completed',
    })).toBe(false);
    expect(isPendingLocalAsyncGenerateTask({
      type: 'generate',
      status: 'processing',
    })).toBe(false);
  });

  it('switches to provider polling after the durable outer task receives a remote task id', () => {
    expect(isPendingLocalAsyncGenerateTask({
      taskId: 'async-local-1',
      type: 'generate-async',
      status: 'processing',
      result: { remoteTaskId: 'provider-task-1' },
    })).toBe(false);
  });
});
