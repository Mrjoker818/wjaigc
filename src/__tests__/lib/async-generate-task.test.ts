import { describe, expect, it } from 'vitest';
import * as asyncGenerateTask from '@/lib/async-generate-task';

const { isPendingLocalAsyncGenerateTask } = asyncGenerateTask;

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

  it('marks a recovered async task with a provider task id for remote polling', () => {
    const shouldPollRemote = (asyncGenerateTask as typeof asyncGenerateTask & {
      shouldPollRemoteAsyncGenerateTask?: (task: unknown) => boolean;
    }).shouldPollRemoteAsyncGenerateTask;

    expect(shouldPollRemote).toBeTypeOf('function');
    expect(shouldPollRemote?.({
      taskId: 'async-local-1',
      type: 'generate-async',
      status: 'processing',
      result: { remoteTaskId: 'provider-task-1' },
    })).toBe(true);
  });

  it('recovers a legacy outer task from its persisted submission payload before provider polling', () => {
    const recover = (asyncGenerateTask as typeof asyncGenerateTask & {
      isRecoverableSubmitOnlySubmission?: (task: unknown) => boolean;
    }).isRecoverableSubmitOnlySubmission;

    expect(recover).toBeTypeOf('function');
    expect(recover?.({
      taskId: 'async-legacy-1',
      type: 'generate',
      status: 'processing',
      remoteTaskId: 'async-legacy-1',
      result: { submissionPayload: { prompt: 'recover this task' } },
    })).toBe(true);
  });
});
