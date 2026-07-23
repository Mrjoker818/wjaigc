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
  });

  it('restores a persisted credit cost and refunds it when resumed submission fails', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recoveryStart = source.indexOf('const recovery = buildRecoveredTaskContext');
    const resumedFailure = source.indexOf("const message = error instanceof Error ? error.message : '任务恢复提交失败'", recoveryStart);

    expect(source.indexOf('creditCost: persistedTask.creditCost', recoveryStart)).toBeGreaterThan(recoveryStart);
    expect(source.indexOf('refundCloudTaskCredits(', resumedFailure)).toBeGreaterThan(resumedFailure);
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
    expect(source).toContain("'fail_reason'");
    expect(source).toContain("'failReason'");
    expect(source).toContain('extractTaskFailureDetail(taskData || {})');
    expect(source).toContain('grid_image_url');
    expect(source).toContain('taskResult?.buttons');
    expect(source).toContain('gridImageUrl,');
    expect(source).toContain('buttons,');
  });

  it('extracts nested provider failure reasons and keeps the upstream detail in the terminal response', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');

    expect(source).toContain('function extractTaskFailureDetail');
    for (const key of ['error_message', 'errorMessage', 'message', 'detail', 'reason']) {
      expect(source).toContain(`'${key}'`);
    }
    expect(source).toContain('formatTaskFailureMessage(rawError)');
    expect(source).toContain('上游任务失败 taskId=');
  });

  it('does not let best-effort image activity storage change a completed provider task response', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const appendStart = source.indexOf("void appendUserJsonl(userId, 'images'");

    expect(appendStart).toBeGreaterThan(-1);
    expect(source.slice(appendStart, appendStart + 600)).toContain('.catch(error =>');
    expect(source.slice(appendStart, appendStart + 600)).toContain('用户图片记录写入失败');
  });

  it('cleans up cancelled provider tasks through the normalized terminal state', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const cancelled = source.indexOf("} else if (normalizedStatus === 'cancelled')");

    expect(cancelled).toBeGreaterThan(-1);
    expect(source.indexOf('releaseQueueSlot(taskId)', cancelled)).toBeGreaterThan(cancelled);
  });

  it('marks a recovered task as charged before returning a successful image', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const directResult = source.indexOf('if (directImageUrls.length > 0)');
    const completed = source.indexOf("recordImageTaskTerminal(recovered.taskId, { status: 'completed'", directResult);

    expect(source.indexOf("creditStatus: persistedTask.creditCost && persistedTask.creditCost > 0 ? 'charged' : 'not-applicable'", completed)).toBeGreaterThan(completed);
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
});
