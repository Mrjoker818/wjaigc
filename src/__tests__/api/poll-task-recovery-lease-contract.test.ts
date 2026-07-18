import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('poll-task recovery lease contract', () => {
  it('claims a durable task lease before rebuilding an in-memory task', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recoveryStart = source.indexOf('const recovery = buildRecoveredTaskContext');
    const leaseClaim = source.indexOf('claimCloudTaskLease(', recoveryStart);
    const register = source.indexOf('registerTask(recovery.taskId', recoveryStart);

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
    const providerFailure = source.indexOf("} else if (taskStatus?.toLowerCase() === 'failed')");

    expect(source.indexOf('refundTaskCredits(', providerFailure)).toBeGreaterThan(providerFailure);
  });

  it('marks a recovered task as charged before returning a successful image', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const directResult = source.indexOf('if (directImageUrls.length > 0)');
    const completed = source.indexOf("recordImageTaskTerminal(recovered.taskId, { status: 'completed'", directResult);

    expect(source.indexOf("creditStatus: persistedTask.creditCost && persistedTask.creditCost > 0 ? 'charged' : 'not-applicable'", completed)).toBeGreaterThan(completed);
  });
});
