import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

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
    const settlementHelper = source.indexOf('const settleDurableEditFailure = async');
    const atomicSettlement = source.indexOf('terminateCloudTaskAndRefund(taskId, status, error)', settlementHelper);
    const noImageFailure = source.indexOf("const terminalResponse = await settleDurableEditFailure(\n                  'failed'");
    const providerFailure = source.indexOf("taskStatus === 'failed'");
    const providerSettlement = source.indexOf(
      'const terminalResponse = await settleDurableEditFailure(',
      providerFailure,
    );

    expect(settlementHelper).toBeGreaterThan(-1);
    expect(atomicSettlement).toBeGreaterThan(settlementHelper);
    expect(noImageFailure).toBeGreaterThan(-1);
    expect(providerFailure).toBeGreaterThan(-1);
    expect(providerSettlement).toBeGreaterThan(providerFailure);
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

  it('never swaps providers by model name while recovering a remote edit task', () => {
    const remoteEditStart = source.indexOf("if (taskId.startsWith('edit_'))");
    const remoteEditEnd = source.indexOf('// ★ Layer decomposition tasks', remoteEditStart);
    const remoteEdit = source.slice(remoteEditStart, remoteEditEnd);

    expect(remoteEdit).not.toContain('findProviderForModel(');
    expect(remoteEdit).toContain('if (!remotePollInfo.providerId)');
    expect(remoteEdit).toContain('编辑任务缺少原始供应商标识');
  });

  it('preserves cancelled and timeout as exact memory terminal states', () => {
    expect(source).toContain("remoteTerminalStatus === 'cancelled'");
    expect(source).toContain("remoteTerminalStatus === 'timeout'");
    expect(source).toContain("remoteTerminalStatus === 'timeout' ? 'timeout' : 'failed'");
    expect(source).toContain('cancelEditTask(taskId)');
    expect(source).toContain("task.status === 'cancelled' || task.status === 'timeout'");
    expect(source).toContain('status: task.status');
  });
});
