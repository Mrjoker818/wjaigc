import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('video task durability contract', () => {
  it('guards the generate entry with a single-path task-core migration', () => {
    const source = readSource('src/app/api/video/generate/route.ts');

    expect(source).toContain('executeTaskEntryMigration({');
    expect(source).toContain('createBillableTask({');
    expect(source).toContain("request.headers.get('idempotency-key')");
    expect(source.indexOf('executeTaskEntryMigration({')).toBeLessThan(
      source.indexOf('after(async () => {'),
    );
  });

  it('admits Skill video work as one prepaid child and guards the provider side effect', () => {
    const source = readSource('src/app/api/video/generate/route.ts');

    expect(source).toContain('parseSkillBillingContext(body.skillBillingContext)');
    expect(source).toContain('createSkillPrepaidGeneration(');
    expect(source).toContain("type: 'video'");
    expect(source).toContain("creditStatus: 'not-applicable'");
    expect(source).toContain('claimCloudTaskLease(');
    expect(source).toContain('await inspectSkillPrepaidPoll(child)');
    expect(source).toContain('startSkillPrepaidProviderRequest({');
    expect(source).toContain('skillBillingContext ? 0 : await calculateConfiguredCreditCost(');
    expect(source).toContain('if (!provider && !skillBillingContext)');
    expect(source).toContain("assetSourceEntityId !== `${skillBillingContext.runId}:${skillBillingContext.stepId}`");
    expect(source).toContain('assetParentVersionIds.some((value: unknown) => !isAssetVersionId(value))');
    expect(source).toContain('assetParentVersionIds,');
  });

  it('accepts authenticated internal Skill calls through the shared API auth boundary', () => {
    const source = readSource('src/app/api/video/generate/route.ts');

    expect(source).toContain('requireApiAuthOrReject(request)');
    expect(source).not.toContain('sessionUser = await getSessionUser(request)');
  });

  for (const routePath of [
    'src/app/api/video/generate/route.ts',
    'src/app/api/video/extend/route.ts',
  ]) {
    it(`${routePath} persists and atomically charges before scheduling provider work`, () => {
      const source = readSource(routePath);
      const persisted = source.indexOf('await recordVideoTaskSubmitted({');
      const deferredCharge = source.indexOf('deferCreditCharge: true', persisted);
      const atomicCharge = source.indexOf('await chargeCloudTaskCredits(', deferredCharge);
      const scheduledWork = source.indexOf('after(async () => {', atomicCharge);

      expect(persisted).toBeGreaterThan(-1);
      expect(deferredCharge).toBeGreaterThan(persisted);
      expect(atomicCharge).toBeGreaterThan(deferredCharge);
      expect(scheduledWork).toBeGreaterThan(atomicCharge);
    });

    it(`${routePath} settles provider failures and direct completions through conditional database transitions`, () => {
      const source = readSource(routePath);

      expect(source).toMatch(
        /await \(canvasPublication \? completeDocumentVideoTask : completeCloudTask\)\(taskId, completedResult\)/u,
      );
      expect(source).toContain('terminateCloudTaskAndRefund(');
      expect(source).toContain('registerTaskAbortController(taskId, submitController)');
      expect(source).toContain('unregisterTaskAbortController(taskId, submitController)');
    });

    it(`${routePath} handles a direct provider video result before requiring a remote task ID`, () => {
      const source = readSource(routePath);
      const directCompletion = source.indexOf(
        "if (submitResult.status === 'succeeded' && submitResult.videoUrl)",
      );
      const missingTaskId = source.indexOf('if (!submitResult.taskId)');

      expect(directCompletion).toBeGreaterThan(-1);
      expect(missingTaskId).toBeGreaterThan(directCompletion);
    });

    if (routePath === 'src/app/api/video/generate/route.ts') {
      it('stabilizes a direct gateway video before publishing its terminal state', () => {
        const source = readSource(routePath);
        const directCompletion = source.indexOf(
          "if (submitResult.status === 'succeeded' && submitResult.videoUrl)",
        );
        const directBlock = source.slice(directCompletion, directCompletion + 5000);
        const persistence = directBlock.indexOf('await persistDirectGatewayVideoResult({');
        const completion = directBlock.indexOf(
          'await (canvasPublication ? completeDocumentVideoTask : completeCloudTask)(',
        );

        expect(persistence).toBeGreaterThan(-1);
        expect(completion).toBeGreaterThan(persistence);
        expect(directBlock).toContain("terminateCloudTaskAndRefund(taskId, 'failed'");
        expect(directBlock).toMatch(
          /catch \(completionError\)[\s\S]*cleanupPersistedGatewayVideoResult\([\s\S]*throw completionError/u,
        );
      });
    }

    it(`${routePath} durably records the provider task ID before exposing it to the in-memory poller`, () => {
      const source = readSource(routePath);
      const providerTaskPersistence = source.indexOf('await recordVideoTaskRemotePolling(taskId,');
      const persistenceTail = source.slice(providerTaskPersistence);
      const memoryMatch = /updateTaskProgress\(taskId,\s*\{\s*progress:\s*10,/.exec(persistenceTail);
      const inMemoryPollState = memoryMatch ? providerTaskPersistence + memoryMatch.index : -1;

      expect(providerTaskPersistence).toBeGreaterThan(-1);
      expect(inMemoryPollState).toBeGreaterThan(providerTaskPersistence);
    });
  }
});
