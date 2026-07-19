import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('generate submitOnly idempotency contract', () => {
  it('looks up an Idempotency-Key before registering a new async task', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const lookup = source.indexOf('getCloudTaskForUserByIdempotencyKey', branch);
    const register = source.indexOf('registerTask(asyncTaskId', branch);

    expect(lookup).toBeGreaterThan(branch);
    expect(register).toBeGreaterThan(lookup);
    expect(source).toContain("request.headers.get('idempotency-key')");
  });

  it('starts submitOnly background work only after an atomic persistent task insert succeeds', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted', branch);
    const collision = source.indexOf('if (!taskCreated)', persisted);
    const reusedLookup = source.indexOf('getCloudTaskForUserByIdempotencyKey', collision);
    const register = source.indexOf('registerTask(asyncTaskId', branch);

    expect(persisted).toBeGreaterThan(branch);
    expect(collision).toBeGreaterThan(persisted);
    expect(reusedLookup).toBeGreaterThan(collision);
    expect(register).toBeGreaterThan(collision);
  });

  it('persists a sanitized submission payload so cloud polling can resume a worker that was interrupted after the response', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted', branch);

    expect(source.indexOf('submissionPayload,', persisted)).toBeGreaterThan(persisted);
  });

  it('routes an in-memory outer task without a provider id through the same durable recovery path', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');

    expect(source).toContain('shouldResumeExistingAsync');
    expect(source).toContain('(!registryTask || shouldResumeExistingAsync) && sessionUser');
  });

  it('recovers legacy persisted submitOnly work from its payload even when an earlier release stored the wrong task type', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recovery = source.indexOf('const requiresSubmissionRecovery =');
    const lease = source.indexOf('const lease = await claimCloudTaskLease', recovery);
    const legacyTypeGate = source.indexOf("persistedTask.type === 'generate-async'", recovery);

    expect(recovery).toBeGreaterThan(0);
    expect(lease).toBeGreaterThan(recovery);
    expect(legacyTypeGate === -1 || legacyTypeGate > lease).toBe(true);
  });

  it('does not start an untracked in-process worker unless an operator explicitly enables local compatibility mode', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');

    expect(source).toContain("process.env.WUJIE_ENABLE_IN_PROCESS_ASYNC_WORKER === 'true'");
  });

  it('schedules an enabled in-process worker with Next after so its response can return first', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const workerGate = source.indexOf("process.env.WUJIE_ENABLE_IN_PROCESS_ASYNC_WORKER === 'true'");
    const response = source.indexOf("mode: 'polling'", workerGate);
    const afterSchedule = source.indexOf('after(async () =>', workerGate);

    expect(source).toContain("import { NextRequest, NextResponse, after } from 'next/server';");
    expect(afterSchedule).toBeGreaterThan(workerGate);
    expect(afterSchedule).toBeLessThan(response);
  });

  it('persists the deducted credit cost with a resumable submitOnly task', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted');

    expect(source.indexOf('creditCost: deductedCredits,', persisted)).toBeGreaterThan(persisted);
  });

  it('persists submitOnly work as generate-async so recovery never polls the local wrapper id at the provider', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted', branch);
    const taskType = source.indexOf("type: 'generate-async',", persisted);

    expect(taskType).toBeGreaterThan(persisted);
  });

  it('deducts credits before a submitOnly task is persisted and returned', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const deduction = source.indexOf("const creditResult = await consumeCredits");
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted', branch);

    expect(deduction).toBeGreaterThan(0);
    expect(deduction).toBeGreaterThan(branch);
    expect(persisted).toBeGreaterThan(deduction);
  });
});
