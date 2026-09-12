import { describe, expect, it, vi } from 'vitest';

import { assertSkillBillingAuthorization } from '@/lib/skill-runtime/billing-authorization';
import { estimateSkillRunCost, toolCostType } from '@/lib/skill-runtime/cost-estimator';
import { createBriefToVideoSkill } from '@/lib/skill-runtime/brief-to-video-preset';

function videoAuthorizationFixture() {
  return {
    source: 'internal', actorUserId: 'user-1', projectId: 'project-1',
    providerId: 'pear-video', modelId: 'video-model', outputCount: 1,
    idempotencyKey: 'skill-provider:video',
    context: {
      runId: 'run-1', stepId: 'generate-film', requestDigest: 'video-digest',
      operationKey: 'skill-operation:video',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    },
    task: {
      id: 'run-1', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', creditStatus: 'charged', creditCost: 41,
      chargedTransactionId: 'charge-1', refundedTransactionId: '',
    },
    charge: { id: 'charge-1', userId: 'user-1', taskId: 'run-1', type: 'consume', amount: -41 },
    lease: { runId: 'run-1', actorUserId: 'user-1', projectId: 'project-1',
      leaseOwner: 'lease-1', generation: 1, pausedAt: 0, completedAt: 0 },
    operation: { operationKey: 'skill-operation:video', actorUserId: 'user-1',
      projectId: 'project-1', runId: 'run-1', stepId: 'generate-film', toolId: 'video_generate',
      requestDigest: 'video-digest', idempotencyKey: 'skill-provider:video', status: 'submitted' },
    frozen: {
      skill: { modelBindings: { video: { providerId: 'pear-video', modelId: 'video-model' } } },
      skillSnapshot: { steps: [{ id: 'generate-film', toolId: 'video_generate', modelRole: 'video' }] },
    },
  };
}

describe('Brief to video billing', () => {
  it('maps the frozen video step to the existing video credit operation', () => {
    expect(toolCostType('video_generate')).toBe('video_generate');
    expect(assertSkillBillingAuthorization(videoAuthorizationFixture())).toMatchObject({
      runId: 'run-1', stepId: 'generate-film', operationKey: 'skill-operation:video',
      chargedTransactionId: 'charge-1',
    });
  });

  it('estimates the video step with its selected duration and exact provider', async () => {
    const calculateCreditCost = vi.fn(async () => 20);
    const skill = createBriefToVideoSkill(true);
    const estimate = await estimateSkillRunCost(skill, {
      orchestrator: { providerId: 'llm-provider', modelId: 'llm-model' },
      video: { providerId: 'pear-video', modelId: 'video-model' },
    }, { calculateCreditCost }, { durationSeconds: 10, aspectRatio: '16:9' });

    expect(estimate.maximum).toBe(40);
    expect(calculateCreditCost).toHaveBeenCalledWith('video_generate', 'video-model', {
      providerId: 'pear-video', durationSeconds: 10,
    });
  });
});
