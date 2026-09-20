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
    const scheduledWork = source.indexOf(
      'afterWithAgentExecutionFence(async recoveryExecutionFence => {',
      recoveryStart,
    );
    const resumedSubmission = source.indexOf('const resumed = await fetch', recoveryStart);
    const acknowledgement = source.indexOf('recoveryPending: true', scheduledWork);

    expect(recoveryStart).toBeGreaterThan(-1);
    expect(scheduledWork).toBeGreaterThan(recoveryStart);
    expect(resumedSubmission).toBeGreaterThan(scheduledWork);
    expect(acknowledgement).toBeGreaterThan(scheduledWork);
  });

  it('preserves durable slot submission metadata after cold-start recovery with a remote task id', () => {
    const recoveryUpdate = source.indexOf('updateTaskProgress(recovered.taskId, {');
    const resultStart = source.indexOf('result: {', recoveryUpdate);
    const remoteTaskId = source.indexOf('remoteTaskId: recovery.remoteTaskId', resultStart);
    const submissionPayload = source.indexOf('submissionPayload,', resultStart);

    expect(recoveryUpdate).toBeGreaterThan(-1);
    expect(resultStart).toBeGreaterThan(recoveryUpdate);
    expect(submissionPayload).toBeGreaterThan(resultStart);
    expect(submissionPayload).toBeLessThan(remoteTaskId);
    expect(source.slice(resultStart, remoteTaskId)).not.toContain(
      'requiresSubmissionRecovery ? submissionPayload : undefined',
    );
  });

  it('rejects registry and terminal cache reads owned by another authenticated user', () => {
    const registryLookup = source.indexOf('let registryTask = getTaskInfo(taskId)');
    const registryBranch = source.indexOf('if (registryTask) {', registryLookup);
    const ownershipGuard = source.indexOf(
      'registryTask.userId !== sessionUser.id',
      registryLookup,
    );

    expect(registryLookup).toBeGreaterThan(-1);
    expect(ownershipGuard).toBeGreaterThan(registryLookup);
    expect(ownershipGuard).toBeLessThan(registryBranch);
    expect(source).toContain('cachedCompleted.userId');
    expect(source).toContain('cachedFailed.userId');
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

  it('projects canonical slot metadata on every registry-backed image status branch', () => {
    const registryStart = source.indexOf('if (registryTask) {');
    const videoStart = source.indexOf("if (registryTask.type === 'video')", registryStart);
    const registryImageBranches = source.slice(registryStart, videoStart);

    expect(registryImageBranches).toContain('withGenerationSlotMetadata({');
    expect(registryImageBranches.match(/withGenerationSlotMetadata\(\{/g)).toHaveLength(5);
    expect(registryImageBranches).toContain("status: 'completed'");
    expect(registryImageBranches).toContain("status: 'failed'");
    expect(registryImageBranches).toContain("status: 'cancelled'");
    expect(registryImageBranches).toContain("status: 'processing'");
  });

  it('preserves canonical slot metadata in completed and failed terminal caches', () => {
    const completedCacheType = source.slice(
      source.indexOf('const completedTaskCache'),
      source.indexOf('const FAILED_CACHE'),
    );
    const failedCacheType = source.slice(
      source.indexOf('const failedTaskCache'),
      source.indexOf('const TASK_RECOVERY_LEASE_MS'),
    );
    const completedCacheRead = source.slice(
      source.indexOf('const cachedCompleted = completedTaskCache.get(taskId)'),
      source.indexOf('const cachedFailed = failedTaskCache.get(taskId)'),
    );
    const failedCacheRead = source.slice(
      source.indexOf('const cachedFailed = failedTaskCache.get(taskId)'),
      source.indexOf('// 鈽?妫€鏌?task-registry', source.indexOf('const cachedFailed')),
    );

    expect(completedCacheType).toContain('taskResult?: Record<string, unknown>');
    expect(failedCacheType).toContain('taskResult?: Record<string, unknown>');
    expect(completedCacheRead).toContain('withGenerationSlotMetadata({');
    expect(completedCacheRead).toContain('cachedCompleted.taskResult');
    expect(failedCacheRead).toContain('withGenerationSlotMetadata({');
    expect(failedCacheRead).toContain('cachedFailed.taskResult');
  });

  it('keeps durable slot identity when a cold-start recovery submission fails', () => {
    const recoveryCatch = source.indexOf(
      'failedTaskCache.set(recovered.taskId',
      source.indexOf('if (requiresSubmissionRecovery)'),
    );
    const recoveryCacheWrite = source.slice(recoveryCatch, recoveryCatch + 260);

    expect(recoveryCatch).toBeGreaterThan(-1);
    expect(recoveryCacheWrite).toContain('...persistedResult');
    expect(recoveryCacheWrite).toContain('taskError');
  });

  it('projects canonical slot metadata on the first remote provider response', () => {
    const terminalLog = source.indexOf(
      'console.log(`[poll-task] taskId=${taskId} returning:',
    );
    const finalReturn = source.indexOf('return NextResponse.json(', terminalLog);
    const finalReturnTail = source.slice(terminalLog, finalReturn + 300);

    expect(terminalLog).toBeGreaterThan(-1);
    expect(finalReturn).toBeGreaterThan(terminalLog);
    expect(finalReturnTail).toContain('withGenerationSlotMetadata(');
    expect(finalReturnTail).toContain('getTaskInfo(taskId)?.result');
  });

  it('uses the durable provider id to correct stale provider display names before completing a slot', () => {
    const durableResponse = source.indexOf('async function getDurableGenerationSlotResponse');
    const terminalResult = source.indexOf('let completedTaskResult = sanitizeCompletedTaskResult({');

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
    const scope = source.indexOf('const recoveryAbort = createTaskAbortScope(', recoveryStart);
    const timeout = source.indexOf('timeoutMs: 600_000', scope);
    const preserveExisting = source.indexOf('preserveExisting: true', timeout);
    const fetchSignal = source.indexOf('signal: recoveryAbort.signal', timeout);
    const cleanup = source.indexOf('recoveryAbort.dispose()', fetchSignal);

    expect(scope).toBeGreaterThan(recoveryStart);
    expect(timeout).toBeGreaterThan(scope);
    expect(preserveExisting).toBeGreaterThan(timeout);
    expect(preserveExisting).toBeLessThan(fetchSignal);
    expect(fetchSignal).toBeGreaterThan(timeout);
    expect(cleanup).toBeGreaterThan(fetchSignal);
    expect(source.slice(scope, fetchSignal)).not.toContain('request.signal');
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

  it('stabilizes gateway image artifacts before the authoritative completed transition', () => {
    const completedBranch = source.indexOf('let completedTaskResult = sanitizeCompletedTaskResult({');
    const stabilization = source.indexOf('await stabilizeGatewayImageResult({', completedBranch);
    const durableCompletion = source.indexOf(
      'const generationCompletion = await completeCloudTask(',
      completedBranch,
    );

    expect(source).toMatch(
      /import \{[\s\S]*?stabilizeGatewayImageResult,[\s\S]*?\} from '@\/lib\/media-gateway\/artifact-persistence';/,
    );
    expect(stabilization).toBeGreaterThan(completedBranch);
    expect(durableCompletion).toBeGreaterThan(stabilization);
    expect(source.slice(completedBranch, durableCompletion)).toContain(
      'completedTaskResult = await stabilizeGatewayImageResult({',
    );
    expect(source.slice(stabilization, durableCompletion)).toMatch(
      /terminateCloudTaskAndRefund\(\s*taskId,\s*'failed',\s*gatewayPersistenceError,\s*gatewayArtifactLeaseOwner,?\s*\)/,
    );
  });
});
