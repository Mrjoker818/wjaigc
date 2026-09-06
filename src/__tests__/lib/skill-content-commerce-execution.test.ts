import { describe, expect, it, vi } from 'vitest';

import type { AgentDownstreamExecutionContext } from '@/lib/agent-runtime/downstream-operations';
import { LOVART_CONTENT_COMMERCE_SKILLS } from '@/lib/skill-runtime/content-commerce-presets';
import { skillExecutionSteps } from '@/lib/skill-runtime/cost-estimator';
import {
  createSkillExecutor,
  type ExecuteSkillStepInput,
  type SkillExecutorEventInput,
} from '@/lib/skill-runtime/executor';
import { resolveSkillInputs } from '@/lib/skill-runtime/input-resolver';

const batchSku = LOVART_CONTENT_COMMERCE_SKILLS.find(
  skill => skill.id === 'preset-batch-sku-assets',
)!;

function operationContext(): AgentDownstreamExecutionContext {
  return {
    idempotencyKey: 'batch-root', operationKey: 'batch-operation', recovery: false,
    executionFence: { runId: 'run-batch', leaseOwner: 'lease-1', generation: 1 },
    signal: new AbortController().signal,
    beginSubmission: vi.fn(), recordAccepted: vi.fn(),
    executeOperation: vi.fn(async (step, execute) => execute({
      idempotencyKey: `provider:${step.stepId}`,
      operationKey: `operation:${step.stepId}`,
      recovery: false,
      executionFence: { runId: 'run-batch', leaseOwner: 'lease-1', generation: 1 },
      signal: new AbortController().signal,
      beginSubmission: vi.fn(), recordAccepted: vi.fn(), executeOperation: vi.fn(),
    })),
  };
}

function waitForCompletion(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 10);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

describe('Lovart content-commerce execution', () => {
  it('keeps successful SKU siblings and retries only the failed concrete step', async () => {
    const inputValues = resolveSkillInputs(batchSku, {
      sourceImages: ['version-source-1'],
      rows: [
        { sku: 'A-1', name: '黑色耳机' },
        { sku: 'B-2', name: '白色耳机' },
        { sku: 'C-3', name: '蓝色耳机' },
      ],
    });
    const definition = { ...batchSku, steps: skillExecutionSteps(batchSku, inputValues) };
    const skuSteps = definition.steps.slice(1);
    const calls = new Map<string, number>();
    const events: SkillExecutorEventInput[] = [];
    const pauseForRetry = vi.fn(async () => true);
    const executeStep = vi.fn(async ({ step, signal }: ExecuteSkillStepInput) => {
      calls.set(step.id, (calls.get(step.id) || 0) + 1);
      if (step.id === 'sku-plan') return { assetVersionIds: [], media: [], text: '规则有效' };
      if (step.id === skuSteps[1]?.id && calls.get(step.id) === 1) {
        throw new Error('provider temporarily unavailable');
      }
      if (step.id === skuSteps[2]?.id) await waitForCompletion(signal);
      return {
        assetVersionIds: [`version:${step.id}`],
        media: [{ width: 1000, height: 1000 }],
      };
    });
    const executor = createSkillExecutor({
      executeStep,
      appendEvent: vi.fn(async event => { events.push(event); }),
      pauseForRetry,
      qualityContext: () => ({ expectedAspectRatio: '1:1' }),
    });
    const base = {
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-batch',
      workspace: 'canvas' as const, definition, inputValues,
      modelBindings: {
        orchestrator: { providerId: 'pear-chat', modelId: 'chat-model' },
        image: { providerId: 'pear-image', modelId: 'image-model' },
      },
    };

    await expect(executor.execute({ ...base, operationContext: operationContext() }))
      .rejects.toThrow('provider temporarily unavailable');

    const completedAfterFirstAttempt = events
      .filter(event => event.type === 'tool.completed')
      .map(event => String(event.payload.stepId));
    expect(events.filter(event => event.type === 'asset.created')).toHaveLength(2);
    expect(completedAfterFirstAttempt).toEqual([
      'sku-plan', skuSteps[0]?.id, skuSteps[2]?.id,
    ]);
    expect(pauseForRetry).toHaveBeenCalledWith(expect.objectContaining({
      stepId: skuSteps[1]?.id,
    }));

    await executor.execute({
      ...base,
      operationContext: operationContext(),
      completedStepIds: completedAfterFirstAttempt,
      resumeFromStepId: skuSteps[1]?.id,
      existingAssetVersionIds: events
        .filter(event => event.type === 'asset.created')
        .map(event => String(event.payload.assetVersionId)),
    });

    expect(calls.get(skuSteps[0]!.id)).toBe(1);
    expect(calls.get(skuSteps[1]!.id)).toBe(2);
    expect(calls.get(skuSteps[2]!.id)).toBe(1);
    expect(new Set(events.filter(event => event.type === 'asset.created')
      .map(event => event.payload.assetVersionId))).toHaveProperty('size', 3);
  });
});
