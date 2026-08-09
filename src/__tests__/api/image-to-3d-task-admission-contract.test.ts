import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-to-3d/route.ts'),
  'utf8',
);

describe('image-to-3d task admission contract', () => {
  it('validates the request before charging credits', () => {
    const validation = source.indexOf("const mode = body.mode || 'single-image'");
    const charge = source.indexOf("consumeCredits(sessionUser.id, '3d_model')");

    expect(validation).toBeGreaterThan(0);
    expect(charge).toBeGreaterThan(validation);
  });

  it('does not return a remote task before durable persistence finishes', () => {
    expect(source).not.toMatch(/void\s+recordThreeDTaskSubmitted\s*\(/);
    expect(source).toContain('await recordThreeDTaskSubmitted({');
    expect(source).toContain('creditCost: deductedCredits');
    expect(source).toContain("creditStatus: deductedCredits > 0 ? 'pending' : 'not-applicable'");
  });

  it('uses atomic local admission and persists the supplier task identity', () => {
    expect(source).toMatch(/executeTaskEntryMigration(?:<[^>]+>)?\(\{/);
    expect(source).toContain('createBillableTask({');
    expect(source).toContain('remoteTaskId: external.taskId');
    expect(source).toContain('await settleFailedTask({');
  });

  it('fails closed when the remote identity or direct result cannot be persisted', () => {
    expect(source).toContain('if (!remoteIdentityPersisted)');
    expect(source).toContain('if (!completionPersisted)');
  });

  it('replays a completed direct task from its durable result', () => {
    expect(source).toContain('result: result.task.result');
    expect(source).toContain("admission.value.status === 'completed'");
    expect(source).toContain('assetUrl: replayResult.assetUrl');
  });

  it('does not resubmit a reused failure terminal task', () => {
    expect(source).toContain("admission.value.status === 'failed'");
    expect(source).toContain("admission.value.status === 'cancelled'");
    expect(source).toContain("admission.value.status === 'timeout'");
    expect(source).toContain("code: 'THREE_D_TASK_TERMINAL'");
  });
});
