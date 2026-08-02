import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('generate submitOnly idempotency contract', () => {
  it('looks up a child Idempotency-Key before registering its async task', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const lookup = source.indexOf('getCloudTaskForUserByIdempotencyKey', branch);
    const register = source.indexOf('registerTask(', lookup);

    expect(lookup).toBeGreaterThan(branch);
    expect(register).toBeGreaterThan(lookup);
    expect(source).toContain("request.headers.get('idempotency-key')");
  });

  it('binds child idempotency keys to a stable batch and slot index', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const batch = source.indexOf('const generationBatch = buildGenerationBatch', branch);
    const slotLoop = source.indexOf('for (const slot of generationBatch.slots)', batch);

    expect(batch).toBeGreaterThan(branch);
    expect(slotLoop).toBeGreaterThan(batch);
    expect(source).toContain('`${idempotencyKey}:${slot.index}`');
    expect(source).toContain('batchId: generationBatch.batchId');
  });

  it('creates billable child slots before using the atomic cloud-task charge', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const childPersistence = source.indexOf('deferCreditCharge: true', branch);
    const atomicCharge = source.indexOf('chargeCloudTaskCredits(', childPersistence);

    expect(childPersistence).toBeGreaterThan(branch);
    expect(atomicCharge).toBeGreaterThan(childPersistence);
  });

  it('only schedules a child for recovery after durable creation and atomic charging', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted', branch);
    const created = source.indexOf('if (taskCreated)', persisted);
    const atomicCharge = source.indexOf('const charge = await chargeCloudTaskCredits', created);
    const register = source.indexOf('registerTask(', atomicCharge);

    expect(persisted).toBeGreaterThan(branch);
    expect(created).toBeGreaterThan(persisted);
    expect(atomicCharge).toBeGreaterThan(created);
    expect(register).toBeGreaterThan(atomicCharge);
  });

  it('persists a sanitized submission payload so cloud polling can resume a worker that was interrupted after the response', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted', branch);

    expect(source.indexOf('submissionPayload,', persisted)).toBeGreaterThan(persisted);
  });

  it('stamps the submission payload with the worker mode so polling knows who owns provider submission', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const payload = source.indexOf('const submissionPayload');
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted', payload);
    const workerMode = source.indexOf('workerMode:', payload);

    expect(payload).toBeGreaterThan(-1);
    expect(persisted).toBeGreaterThan(payload);
    expect(workerMode).toBeGreaterThan(payload);
    expect(workerMode).toBeLessThan(persisted);
    // Default is the durable recovery path; the in-process worker is opt-in only.
    expect(source).toContain("workerMode: process.env.WUJIE_ENABLE_IN_PROCESS_ASYNC_WORKER === 'true' ? 'local' : 'recovery'");
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

  it('creates a child task before its atomic credit charge', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted', branch);
    const deduction = source.indexOf('const charge = await chargeCloudTaskCredits', persisted);

    expect(persisted).toBeGreaterThan(branch);
    expect(deduction).toBeGreaterThan(persisted);
  });
});
