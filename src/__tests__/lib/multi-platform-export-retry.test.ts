import { describe, expect, it, vi } from 'vitest';

import {
  createSkillRuntimeService,
  deriveMultiPlatformExportRetryIdempotencyKey,
  parseSkillRunRequest,
} from '@/lib/skill-runtime/service';
import type { AgentEvent, AgentRunProjection } from '@/lib/agent-runtime/types';
import type { CloudTask } from '@/lib/cloud-task-storage';
import { agentRunRequestDigest } from '@/lib/agent-runtime/service';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';

vi.mock('server-only', () => ({}));

const failedResult = {
  schemaVersion: 1, runId: 'run-old', outcome: 'partial_success',
  imageAssetVersionIds: ['version-reused-aaaaaaaa'],
  manifestAssetVersionId: 'version-manifest-aaaaaaaa',
  zipAssetVersionId: 'version-zip-aaaaaaaa',
  failures: [{
    sourceAssetVersionId: 'version-source-aaaaaaaa', presetId: 'instagram-story',
    presetVersion: 1, outputFilename: 'source-instagram-story-1.png',
    code: 'EXPORT_IMAGE_TRANSFORM_FAILED', retryable: true,
  }],
};

function oldRun() {
  const task: CloudTask = {
    id: 'run-old', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
    status: 'failed', progress: 100, creditStatus: 'not-applicable', creditCost: 0,
    idempotencyKey: 'request-old', requestDigest: 'a'.repeat(64), createdAt: 1, updatedAt: 2,
  };
  const events: AgentEvent[] = [{
    eventId: 'created', runId: 'run-old', sequence: 1, type: 'run.created', timestamp: 'now',
    payload: {
      workspace: 'canvas', workspaceId: 'canvas-1', sourceVersionIds: ['version-source-aaaaaaaa'],
      skill: {
        skillId: 'preset-multi-platform-export', skillVersion: 1,
        inputValues: {
          sourceAssetVersionIds: ['version-source-aaaaaaaa'],
          targetPresetIds: ['instagram-post-v1', 'instagram-story-v1'], fit: 'cover',
          background: '#ffffffff', namingTemplate: '{asset}-{platform}-{size}-{index}',
        }, modelBindings: {},
      },
      skillSnapshot: { id: 'preset-multi-platform-export', version: 1, name: 'Export', steps: [{
        id: 'export', label: 'Export', toolId: 'multi_platform_export', runtime: 'local',
        execution: 'sequential', promptTemplate: '', qualityGateIds: ['output-present'],
      }] },
    },
  }, {
    eventId: 'asset', runId: 'run-old', sequence: 2, type: 'asset.created', timestamp: 'now',
    payload: { stepId: 'export', assetVersionId: 'version-reused-aaaaaaaa' },
  }, {
    eventId: 'tool', runId: 'run-old', sequence: 3, type: 'tool.completed', timestamp: 'now',
    payload: { stepId: 'export', outputs: [{
      stepId: 'export', kind: 'json', schemaId: 'multi-platform-export-result-v1',
      content: JSON.stringify(failedResult),
    }] },
  }, {
    eventId: 'failed', runId: 'run-old', sequence: 4, type: 'run.failed', timestamp: 'now',
    payload: { stepId: 'export', error: { code: 'SKILL_PARTIAL_SUCCESS', message: 'partial', retryable: true } },
  }];
  const projection: AgentRunProjection = {
    runId: 'run-old', status: 'failed', lastSequence: 4, plan: [], assetVersionIds: ['version-reused-aaaaaaaa'],
    result: { outputs: events[2]!.payload.outputs }, error: { code: 'SKILL_PARTIAL_SUCCESS', message: 'partial', retryable: true },
    ignoredEventIds: [], missingSequences: [], qualityChecks: [],
  };
  return { task, events, projection };
}

describe('multi-platform export terminal retry', () => {
  it('uses a fixed-length digest key across consecutive retry attempts', () => {
    const second = deriveMultiPlatformExportRetryIdempotencyKey({
      rootRunId: 'r'.repeat(256), sourceRunId: 's'.repeat(256), attempt: 2,
    });
    const third = deriveMultiPlatformExportRetryIdempotencyKey({
      rootRunId: 'r'.repeat(256), sourceRunId: 't'.repeat(256), attempt: 3,
    });
    expect(second).toMatch(/^mpe-retry:[a-f0-9]{64}$/u);
    expect(third).toMatch(/^mpe-retry:[a-f0-9]{64}$/u);
    expect(second.length).toBeLessThanOrEqual(256);
    expect(third.length).toBeLessThanOrEqual(256);
    expect(third).not.toBe(second);
  });
  it('binds frozen retry lineage into the canonical Agent request digest', () => {
    const request = {
      projectId: 'project-1', workspace: 'canvas', workspaceId: 'canvas-1', mode: 'agent',
      prompt: 'export', sourceVersionIds: ['version-source-aaaaaaaa'],
      allowedToolIds: ['multi_platform_export'], idempotencyKey: 'retry',
      context: { selectedEntityIds: [], visibleVersionIds: ['version-source-aaaaaaaa'], locale: 'zh-CN' },
      skill: { skillId: 'preset-multi-platform-export', skillVersion: 1, inputValues: {}, modelBindings: {} },
      executionRuntime: 'local',
      retryLineage: {
        kind: 'multi-platform-export-retry-v1', rootRunId: 'run-old', retryOfRunId: 'run-old', attempt: 2,
        failedItems: failedResult.failures, reusedImageAssetVersionIds: ['version-reused-aaaaaaaa'],
      },
    } satisfies AgentRunRequest;
    expect(agentRunRequestDigest(request)).not.toBe(agentRunRequestDigest({
      ...request, retryLineage: { ...request.retryLineage, attempt: 3 },
    }));
  });

  it('rejects client-supplied retry lineage and reused snapshots', () => {
    expect(() => parseSkillRunRequest({
      skillId: 'preset-multi-platform-export', skillVersion: 1, surface: 'canvas',
      projectId: 'project-1', workspaceId: 'canvas-1', inputValues: {}, sourceVersionIds: [],
      modelBindings: {}, idempotencyKey: 'request', retryOfRunId: 'forged',
      reusedImageAssetVersionIds: ['forged-version'],
    })).toThrow('request is invalid');
  });

  it('creates one idempotent new attempt from the authoritative failed result without mutating the old run', async () => {
    const old = oldRun();
    const createAuthorizedSkillRun = vi.fn()
      .mockResolvedValueOnce({ runId: 'run-retry', reused: false, charged: false });
    const resumeRun = vi.fn();
    const retryLineage = {
      kind: 'multi-platform-export-retry-v1', rootRunId: 'run-old', retryOfRunId: 'run-old', attempt: 2,
      failedItems: failedResult.failures, reusedImageAssetVersionIds: ['version-reused-aaaaaaaa'],
    };
    const listEvents = vi.fn(async ({ runId }: { runId: string }) => runId === 'run-old'
      ? structuredClone(old.events)
      : [{
        eventId: 'retry-created', runId: 'run-retry', sequence: 1, type: 'run.created' as const, timestamp: 'now',
        payload: { requestDigest: 'c'.repeat(64), retryLineage, skill: { skillId: 'preset-multi-platform-export' } },
      }]);
    const validatePartialRetry = vi.fn(async () => undefined);
    const service = createSkillRuntimeService({
      createAuthorizedSkillRun: createAuthorizedSkillRun as never,
      getTaskForUser: vi.fn(async () => structuredClone(old.task)),
      getTaskByIdempotencyKey: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...old.task, id: 'run-retry', requestDigest: 'c'.repeat(64), idempotencyKey: 'request-old:partial-retry' }),
      listTasks: vi.fn(async () => [old.task]),
      listEvents, getProjection: vi.fn(async () => structuredClone(old.projection)), pauseRun: vi.fn(),
      resumeRun, cancelRun: vi.fn(), getActor: vi.fn(async () => ({
        id: 'user-1', name: 'User', role: 'user' as const, status: 'active' as const, createdAt: 1, updatedAt: 1,
      })), validatePartialRetry,
    });

    await expect(service.retry({ actorUserId: 'user-1', runId: 'run-old', stepId: 'export' }))
      .resolves.toMatchObject({
        runId: 'run-retry', reused: false, newAttempt: true, rootRunId: 'run-old', attempt: 2,
      });
    await expect(service.retry({ actorUserId: 'user-1', runId: 'run-old', stepId: 'export' }))
      .resolves.toMatchObject({ runId: 'run-retry', reused: true, newAttempt: true });

    expect(resumeRun).not.toHaveBeenCalled();
    expect(createAuthorizedSkillRun).toHaveBeenCalledTimes(1);
    expect(validatePartialRetry).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1', projectId: 'project-1',
      sourceAssetVersionIds: ['version-source-aaaaaaaa'],
      targetPresetIds: ['instagram-post-v1', 'instagram-story-v1'],
    }));
    const request = createAuthorizedSkillRun.mock.calls[0]![0].request;
    expect(request.idempotencyKey).toMatch(/^mpe-retry:[a-f0-9]{64}$/u);
    expect(request.retryLineage).toEqual({
      kind: 'multi-platform-export-retry-v1', rootRunId: 'run-old', retryOfRunId: 'run-old', attempt: 2,
      failedItems: failedResult.failures,
      reusedImageAssetVersionIds: ['version-reused-aaaaaaaa'],
    });
    expect(request.inputValues).toEqual(old.events[0]!.payload.skill && (old.events[0]!.payload.skill as { inputValues: unknown }).inputValues);
    expect(await listEvents.mock.results[0]!.value).toEqual(old.events);
  });
});
