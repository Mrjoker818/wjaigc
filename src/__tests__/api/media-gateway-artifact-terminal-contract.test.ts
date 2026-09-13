import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const generateSource = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
const pollSource = readFileSync(resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');

describe('media gateway artifact terminal contract', () => {
  it('never lets gateway requests use the legacy submit-only terminal wrapper', () => {
    const wrapper = generateSource.indexOf("process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER === 'true'");
    const legacyBranch = generateSource.lastIndexOf('if (', wrapper);
    expect(generateSource.slice(legacyBranch, wrapper)).toContain('!gatewayContext');
  });

  it('claims a database lease before gateway artifact stabilization', () => {
    const completion = pollSource.indexOf('let completedTaskResult = sanitizeCompletedTaskResult');
    const stabilization = pollSource.indexOf('await stabilizeGatewayImageResult({', completion);
    const leaseClaim = pollSource.indexOf('await claimCloudTaskLease(', completion);

    expect(completion).toBeGreaterThan(-1);
    expect(leaseClaim).toBeGreaterThan(completion);
    expect(leaseClaim).toBeLessThan(stabilization);
    expect(pollSource.slice(stabilization, stabilization + 5000)).toMatch(
      /completeCloudTask\(\s*taskId,\s*completedTaskResult,\s*gatewayArtifactLeaseOwner,?\s*\)/,
    );
  });

  it('does not publish a local failed state when another terminal state won', () => {
    const persistenceFailure = pollSource.indexOf("'[poll-task] gateway artifact persistence failed'");
    const failureBlock = pollSource.slice(persistenceFailure, persistenceFailure + 3000);

    expect(failureBlock).toContain("terminatedTask?.status === 'failed'");
    expect(failureBlock).toContain('getDurableGenerationSlotResponse(taskId, userId)');
  });

  it('releases a hydration lease before polling an already-submitted remote task', () => {
    const recoveryRegistration = pollSource.indexOf('const recovered = registerTask(');
    const submissionBranch = pollSource.indexOf('if (requiresSubmissionRecovery) {', recoveryRegistration);
    const hydrationBlock = pollSource.slice(recoveryRegistration, submissionBranch);

    expect(recoveryRegistration).toBeGreaterThan(-1);
    expect(submissionBranch).toBeGreaterThan(recoveryRegistration);
    expect(hydrationBlock).toContain(
      'await releaseCloudTaskLease(recovered.taskId, TASK_RECOVERY_WORKER_ID)',
    );
  });

  it('stabilizes synchronous gateway recovery images before committing completion', () => {
    const directResult = pollSource.indexOf('if (directImageUrls.length > 0)');
    const directBlock = pollSource.slice(directResult, directResult + 5000);
    const stabilization = directBlock.indexOf('await stabilizeGatewayImageResult({');
    const completion = directBlock.indexOf('await completeCloudTask(');

    expect(directResult).toBeGreaterThan(-1);
    expect(stabilization).toBeGreaterThan(-1);
    expect(completion).toBeGreaterThan(stabilization);
  });
});
