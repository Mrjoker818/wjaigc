import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('poll-task recovery lease contract', () => {
  it('claims a durable task lease before rebuilding an in-memory task', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recoveryStart = source.indexOf('const recovery = buildRecoveredTaskContext');
    const leaseClaim = source.indexOf('claimCloudTaskLease(', recoveryStart);
    const register = source.indexOf('const recovered = registerTask(', recoveryStart);

    expect(recoveryStart).toBeGreaterThan(-1);
    expect(leaseClaim).toBeGreaterThan(recoveryStart);
    expect(register).toBeGreaterThan(leaseClaim);
    expect(source.slice(register, register + 420)).toContain("'durable'");
  });

  it('restores a persisted credit cost and atomically settles it when resumed submission fails', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recoveryStart = source.indexOf('const recovery = buildRecoveredTaskContext');
    const resumedFailure = source.indexOf("const message = error instanceof Error ? error.message : '任务恢复提交失败'", recoveryStart);

    expect(source.indexOf('creditCost: persistedTask.creditCost', recoveryStart)).toBeGreaterThan(recoveryStart);
    expect(source.indexOf('terminateCloudTaskAndRefund(', resumedFailure)).toBeGreaterThan(resumedFailure);
  });

  it('refunds a recovered task when provider polling reaches a terminal failure', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const providerFailure = source.indexOf("} else if (normalizedStatus === 'failed')");

    expect(providerFailure).toBeGreaterThan(-1);
    expect(source.indexOf('refundTaskCredits(', providerFailure)).toBeGreaterThan(providerFailure);
  });

  it('normalizes Midjourney async statuses and preserves its terminal metadata', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');

    for (const status of ['NOT_START', 'SUBMITTED', 'IN_PROGRESS', 'MODAL', 'SUCCESS', 'FAILURE']) {
      expect(source).toContain(`'${status}'`);
    }
    expect(source).toContain('taskData?.fail_reason');
    expect(source).toContain('taskData?.failReason');
    expect(source).toContain('grid_image_url');
    expect(source).toContain('taskResult?.buttons');
    expect(source).toContain('gridImageUrl,');
    expect(source).toContain('buttons,');
  });

  it('cleans up cancelled provider tasks through the normalized terminal state', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const cancelled = source.indexOf("} else if (normalizedStatus === 'cancelled')");

    expect(cancelled).toBeGreaterThan(-1);
    expect(source.indexOf('releaseQueueSlot(taskId)', cancelled)).toBeGreaterThan(cancelled);
  });

  it('uses an atomic success transition before exposing a recovered image in memory', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const directResult = source.indexOf('if (directImageUrls.length > 0)');
    const completed = source.indexOf('const committed = await completeCloudTask(', directResult);
    const completionTail = source.slice(completed);
    const memoryMatch = /updateTaskProgress\(recovered\.taskId,\s*\{\s*status:\s*'completed'/.exec(completionTail);
    const memoryUpdate = memoryMatch ? completed + memoryMatch.index : -1;

    expect(completed).toBeGreaterThan(directResult);
    expect(memoryUpdate).toBeGreaterThan(completed);
  });

  it('classifies recovery aborts before settling the database terminal state', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recoveryStart = source.indexOf('if (requiresSubmissionRecovery)');
    const catchStart = source.indexOf('} catch (error) {', recoveryStart);
    const normalized = source.indexOf('normalizeTaskError(', catchStart);
    const timeoutStatus = source.indexOf("'TASK_TIMEOUT'", normalized);
    const terminalSettlement = source.indexOf('terminateCloudTaskAndRefund(', timeoutStatus);

    expect(catchStart).toBeGreaterThan(recoveryStart);
    expect(normalized).toBeGreaterThan(catchStart);
    expect(timeoutStatus).toBeGreaterThan(normalized);
    expect(terminalSettlement).toBeGreaterThan(timeoutStatus);
  });

  it('does not treat a recovered generate-async task with a remote task id as local-only work', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const localTaskGate = source.indexOf('if (LOCAL_TASK_TYPES.includes(registryTask.type)');

    expect(localTaskGate).toBeGreaterThan(-1);
    expect(source.slice(localTaskGate, localTaskGate + 220)).toContain('!shouldPollRemoteAsyncGenerateTask(registryTask)');
  });

  it('resumes recovery-mode tasks immediately but never re-submits a live local-worker task', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const gateStart = source.indexOf('const shouldResumeExistingAsync');

    expect(gateStart).toBeGreaterThan(-1);
    const gateBody = source.slice(gateStart, gateStart + 400);
    // The gate must branch on the payload workerMode: recovery-mode tasks resume
    // immediately (poll-task is their only submitter), while a live local worker
    // blocks recovery until it goes stale. Without this, every poll tick during
    // the provider submission window re-posts /api/generate and bills again.
    expect(gateBody).toContain('!isLocalWorkerMode || Date.now() - registryTask.updatedAt > SUBMISSION_STALE_MS');
    expect(source).toContain("workerMode === 'local'");
    // The stale threshold must exceed the 600s background submission timeout.
    expect(source).toContain('const SUBMISSION_STALE_MS = 12 * 60_000');
  });

  it('does not let the same worker re-claim an unexpired recovery lease', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/lib/cloud-task-storage.ts'), 'utf8');
    const claimStart = source.indexOf('export async function claimCloudTaskLease');
    const claimEnd = source.indexOf('RETURNING id, lease_owner, lease_expires_at, attempt_count', claimStart);

    expect(claimStart).toBeGreaterThan(-1);
    expect(claimEnd).toBeGreaterThan(claimStart);
    // A same-owner bypass (`lease_owner = $2`) lets every poll re-claim the lease
    // and re-submit the provider task. It must not exist.
    expect(source.slice(claimStart, claimEnd)).not.toContain('lease_owner = $2 OR');
  });

  it('defers retryable submission failures before any terminal refund', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recoveryStart = source.indexOf('if (requiresSubmissionRecovery)');
    const catchStart = source.indexOf('} catch (error) {', recoveryStart);
    const decision = source.indexOf('classifyRecoverySubmissionFailure(', catchStart);
    const deferBranch = source.indexOf('if (recoveryFailure?.defer)', decision);
    const deferCall = source.indexOf('deferCloudTaskRecovery(', deferBranch);
    const terminalSettlement = source.indexOf('terminateCloudTaskAndRefund(', deferCall);

    expect(decision).toBeGreaterThan(catchStart);
    expect(deferBranch).toBeGreaterThan(decision);
    expect(deferCall).toBeGreaterThan(deferBranch);
    expect(terminalSettlement).toBeGreaterThan(deferCall);
  });

  it('honours persisted recovery backoff before claiming another lease', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recoveryStart = source.indexOf('const recovery = buildRecoveredTaskContext');
    const backoff = source.indexOf('getTaskRecoveryBackoff(persistedTask)', recoveryStart);
    const leaseClaim = source.indexOf('claimCloudTaskLease(', recoveryStart);

    expect(backoff).toBeGreaterThan(recoveryStart);
    expect(leaseClaim).toBeGreaterThan(backoff);
  });

  it('expires recovery against the original task deadline before retry backoff', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recoveryStart = source.indexOf('const recovery = buildRecoveredTaskContext');
    const deadline = source.indexOf('getRecoverySubmissionDeadline(', recoveryStart);
    const abort = source.indexOf("abortTaskExecution(recovery.taskId, 'timeout')", deadline);
    const settlement = source.indexOf(
      "terminateCloudTaskAndRefund(\n            recovery.taskId,\n            'timeout'",
      abort,
    );
    const backoff = source.indexOf('getTaskRecoveryBackoff(persistedTask)', recoveryStart);

    expect(deadline).toBeGreaterThan(recoveryStart);
    expect(abort).toBeGreaterThan(deadline);
    expect(settlement).toBeGreaterThan(abort);
    expect(backoff).toBeGreaterThan(settlement);
  });
});
