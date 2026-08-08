import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/poll-task/route.ts'),
  'utf8',
);

function indexOfCompletedProgress(start: number, taskExpression: string): number {
  const tail = source.slice(start);
  const match = new RegExp(
    `updateTaskProgress\\(${taskExpression},\\s*\\{\\s*status:\\s*'completed'`,
  ).exec(tail);
  return match ? start + match.index : -1;
}

describe('progressive generation recovery contract', () => {
  it('schedules provider submission after returning the recovery acknowledgement', () => {
    const recoveryStart = source.indexOf('if (requiresSubmissionRecovery)');
    const scheduledWork = source.indexOf('after(async () => {', recoveryStart);
    const resumedSubmission = source.indexOf('const resumed = await fetch', recoveryStart);
    const acknowledgement = source.indexOf('recoveryPending: true', scheduledWork);

    expect(recoveryStart).toBeGreaterThan(-1);
    expect(scheduledWork).toBeGreaterThan(recoveryStart);
    expect(resumedSubmission).toBeGreaterThan(scheduledWork);
    expect(acknowledgement).toBeGreaterThan(scheduledWork);
  });

  it('commits recovered direct results with a conditional database completion before memory state', () => {
    const directResult = source.indexOf('if (directImageUrls.length > 0)');
    const persistedCompletion = source.indexOf('const committed = await completeCloudTask(', directResult);
    const memoryCompletion = indexOfCompletedProgress(directResult, 'recovered\\.taskId');

    expect(directResult).toBeGreaterThan(-1);
    expect(persistedCompletion).toBeGreaterThan(directResult);
    expect(memoryCompletion).toBeGreaterThan(persistedCompletion);
  });

  it('returns durable generation slot metadata when a persisted child reaches a terminal state', () => {
    expect(source).toContain("projectCanonicalGenerationSlot");
    expect(source).toContain('const canonical = projectCanonicalGenerationSlot({');
    expect(source).toContain('taskId,');
    expect(source).toContain('taskId: canonical.taskId');
  });

  it('uses the durable provider id to correct stale provider display names before completing a slot', () => {
    const durableResponse = source.indexOf('async function getDurableGenerationSlotResponse');
    const terminalResult = source.indexOf('const completedTaskResult = {');

    expect(source).toContain("import { resolveTaskProviderDisplayName } from '@/lib/task-provider-display';");
    expect(source.indexOf('await findProviderById', durableResponse)).toBeGreaterThan(durableResponse);
    expect(source.indexOf('resolveTaskProviderDisplayName(', durableResponse)).toBeGreaterThan(durableResponse);
    const terminalProviderResolution = source.lastIndexOf(
      'await resolveCanonicalTaskProviderName(',
      terminalResult,
    );
    expect(terminalProviderResolution).toBeGreaterThan(durableResponse);
    expect(terminalProviderResolution).toBeLessThan(terminalResult);
  });

  it('binds recovery submission to task cancellation instead of letting a detached request continue', () => {
    const recoveryStart = source.indexOf('if (requiresSubmissionRecovery)');
    const controller = source.indexOf('const recoveryController = new AbortController()', recoveryStart);
    const registration = source.indexOf('registerTaskAbortController(recovered.taskId, recoveryController)', controller);
    const combinedSignal = source.indexOf(
      'AbortSignal.any([recoveryController.signal, AbortSignal.timeout(600000)])',
      registration,
    );
    const cleanup = source.indexOf('unregisterTaskAbortController(recovered.taskId, recoveryController)', combinedSignal);

    expect(controller).toBeGreaterThan(recoveryStart);
    expect(registration).toBeGreaterThan(controller);
    expect(combinedSignal).toBeGreaterThan(registration);
    expect(cleanup).toBeGreaterThan(combinedSignal);
  });

  it('settles durable generation slots atomically before exposing remote terminal results', () => {
    const genericTerminalStart = source.indexOf('const regInfo = getTaskInfo(taskId);');
    const completedBranch = source.indexOf('if (!pollResult.imageUrl)', genericTerminalStart);
    const durableFailure = source.indexOf(
      "terminateCloudTaskAndRefund(taskId, 'failed', terminalError)",
      completedBranch,
    );
    const durableCompletion = source.indexOf('const generationCompletion = await completeCloudTask(', completedBranch);
    const memoryCompletion = source.indexOf('updateTaskProgress(taskId, { status: \'completed\'', durableCompletion);
    const remoteFailure = source.indexOf("} else if (normalizedStatus === 'failed')", durableCompletion);
    const failureTermination = source.indexOf(
      "terminateCloudTaskAndRefund(taskId, 'failed', translatedError)",
      remoteFailure,
    );
    const cancelledBranch = source.indexOf("} else if (normalizedStatus === 'cancelled')", failureTermination);
    const cancelledTermination = source.indexOf(
      "terminateCloudTaskAndRefund(taskId, 'cancelled', '任务已被取消')",
      cancelledBranch,
    );

    expect(genericTerminalStart).toBeGreaterThan(-1);
    expect(durableFailure).toBeGreaterThan(completedBranch);
    expect(durableCompletion).toBeGreaterThan(completedBranch);
    expect(memoryCompletion).toBeGreaterThan(durableCompletion);
    expect(failureTermination).toBeGreaterThan(remoteFailure);
    expect(cancelledTermination).toBeGreaterThan(cancelledBranch);
  });
});
