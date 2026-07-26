import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'),
  'utf8',
);

describe('annotation remote poll terminal wiring', () => {
  it('commits remote edit success through the database before memory state', () => {
    const remoteEditStart = source.indexOf("if (taskId.startsWith('edit_'))");
    const imageSuccess = source.indexOf('if (images.length > 0)', remoteEditStart);
    const databaseCommit = source.indexOf('completeCloudTask(taskId,', imageSuccess);
    const memoryCommit = source.indexOf("updateTaskProgress(taskId, { status: 'completed'", imageSuccess);

    expect(remoteEditStart).toBeGreaterThan(-1);
    expect(imageSuccess).toBeGreaterThan(remoteEditStart);
    expect(databaseCommit).toBeGreaterThan(imageSuccess);
    expect(memoryCommit).toBeGreaterThan(databaseCommit);
  });

  it('does not allow the deep-result fallback to bypass the database terminal transition', () => {
    const deepResult = source.indexOf('if (deepUrl)');
    const databaseCommit = source.indexOf('completeCloudTask(taskId,', deepResult);
    const memoryCommit = source.indexOf("status: 'completed'", databaseCommit);

    expect(deepResult).toBeGreaterThan(-1);
    expect(databaseCommit).toBeGreaterThan(deepResult);
    expect(memoryCommit).toBeGreaterThan(databaseCommit);
  });

  it('settles both remote failure variants from the persisted database state', () => {
    const noImageFailure = source.indexOf('远程任务成功但未找到图片结果');
    const providerFailure = source.indexOf("taskStatus === 'failed' || taskStatus === 'error'");

    expect(noImageFailure).toBeGreaterThan(-1);
    expect(source.indexOf('terminateCloudTaskAndRefund(', noImageFailure)).toBeGreaterThan(noImageFailure);
    expect(providerFailure).toBeGreaterThan(-1);
    expect(source.indexOf('terminateCloudTaskAndRefund(', providerFailure)).toBeGreaterThan(providerFailure);
  });

  it('actively aborts the in-flight provider poll on request cancellation or task cancellation', () => {
    const remotePoll = source.indexOf('const remotePollInfo = task.remotePollInfo');
    const controller = source.indexOf('const remotePollController = new AbortController()', remotePoll);
    const registration = source.indexOf(
      'registerTaskAbortController(taskId, remotePollController)',
      controller,
    );
    const combinedSignal = source.indexOf(
      'AbortSignal.any([request.signal, remotePollController.signal, AbortSignal.timeout(30000)])',
      registration,
    );
    const cleanup = source.indexOf(
      'unregisterTaskAbortController(taskId, remotePollController)',
      combinedSignal,
    );

    expect(controller).toBeGreaterThan(remotePoll);
    expect(registration).toBeGreaterThan(controller);
    expect(combinedSignal).toBeGreaterThan(registration);
    expect(cleanup).toBeGreaterThan(combinedSignal);
  });
});
