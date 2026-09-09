import { describe, expect, it, vi } from 'vitest';

const order: string[] = [];

vi.mock('server-only', () => ({}));
vi.mock('@/lib/agent-runtime/service', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-runtime/service')>();
  return { ...actual, listAgentRunEvents: vi.fn(async () => []) };
});
vi.mock('@/lib/agent-runtime/event-storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-runtime/event-storage')>();
  return {
    ...actual,
    appendAdoptedAgentEvent: vi.fn(async (event: { type: string }) => {
      order.push(event.type);
      return { accepted: true } as never;
    }),
  };
});

import { executeSkillRun } from '@/lib/skill-runtime/service';
import { SkillPartialSuccessError } from '@/lib/multi-platform-export/executor';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

describe('multi-platform export partial terminal ordering', () => {
  it('publishes assets and structured completion before failed and never completes the run', async () => {
    order.length = 0;
    const definition: SkillDefinition = {
      id: 'preset-multi-platform-export', version: 1, name: 'Export', category: 'export',
      description: '', systemPrompt: '', allowedSurfaces: ['canvas'], inputs: [], enabled: true,
      builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
      steps: [{ id: 'export', label: 'Export', toolId: 'multi_platform_export', runtime: 'local', execution: 'sequential', promptTemplate: '', qualityGateIds: ['output-present'] }],
    };
    const signal = new AbortController().signal;
    await executeSkillRun({
      actor: { id: 'user-1', name: 'User', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 },
      request: {
        skillId: definition.id, skillVersion: 1, surface: 'canvas', projectId: 'project-1',
        workspaceId: 'canvas-1', inputValues: {}, sourceVersionIds: [], modelBindings: {}, idempotencyKey: 'run-key',
      },
      runId: 'run-1', definition,
      operationContext: {
        idempotencyKey: 'run-key', operationKey: 'run-operation', recovery: false,
        executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 }, signal,
        beginSubmission: vi.fn(), recordAccepted: vi.fn(),
        executeOperation: vi.fn(async (_step, execute) => execute({
          idempotencyKey: 'step-key', operationKey: 'step-operation', recovery: false,
          executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 }, signal,
          beginSubmission: vi.fn(), recordAccepted: vi.fn(), recordLocalAccepted: vi.fn(), executeOperation: vi.fn(),
        })),
      },
      stepAdapters: {
        multi_platform_export: vi.fn(async () => {
          throw new SkillPartialSuccessError({
            assetVersionIds: ['image-v1'], media: [{}], structured: {
              schemaId: 'multi-platform-export-result-v1', value: {
                schemaVersion: 1, runId: 'run-1', outcome: 'partial_success',
                imageAssetVersionIds: ['image-v1'], failures: [{
                  sourceAssetVersionId: 'source-v1', presetId: 'post', presetVersion: 1,
                  code: 'EXPORT_IMAGE_TRANSFORM_FAILED', retryable: true,
                }],
              },
            },
          });
        }),
      },
      appendRunEvent: vi.fn(async event => {
        order.push(event.type);
        return { accepted: true } as never;
      }),
    });

    expect(order).toEqual(['tool.started', 'quality.checked', 'asset.created', 'tool.completed', 'run.failed']);
    expect(order).not.toContain('run.completed');
  });
});
