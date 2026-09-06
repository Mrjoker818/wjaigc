import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const continuationMocks = vi.hoisted(() => ({
  listManagedUsers: vi.fn(),
  createRegistry: vi.fn(() => ({ stepAdapters: {}, stepRecoveries: {} })),
}));

vi.mock('@/lib/server-auth', () => ({ listManagedUsers: continuationMocks.listManagedUsers }));
vi.mock('@/lib/skill-runtime/step-registry', () => ({
  createProductionSkillStepRegistry: continuationMocks.createRegistry,
}));

import { agentRunRequestDigest } from '@/lib/agent-runtime/service';
import type { AgentEvent, AgentRunRequest } from '@/lib/agent-runtime/types';
import type { CloudTask } from '@/lib/cloud-task-storage';
import { frozenDefinition, loadPersistedSkillContinuation } from '@/lib/skill-runtime/continuation';

const actor = {
  id: 'user-1', name: 'User', role: 'user' as const, status: 'active' as const,
  productType: 'canvas,chat', createdAt: 1, updatedAt: 1,
};

const frozenSnapshot = {
  id: 'custom-continuation-bound', version: 1, name: 'Continuation bound',
  executionContextVersion: 1, systemPrompt: 'Frozen prompt',
  inputs: [
    { key: 'campaignName', label: 'Campaign', kind: 'text', required: true },
    { key: 'channels', label: 'Channels', kind: 'multi-select', required: true, options: ['Web', 'Email'], maximumItems: 2 },
    { key: 'sources', label: 'Sources', kind: 'images', required: true, maximumItems: 3, bindToSourceVersions: true },
  ],
  steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: 'Plan', modelRole: 'orchestrator', qualityGateIds: [] }],
};

function persistedFixture(
  inputValues: Record<string, unknown>,
  sourceVersionIds: string[],
): { task: CloudTask; events: AgentEvent[] } {
  const request: AgentRunRequest = {
    projectId: 'project-1', workspace: 'canvas', workspaceId: 'canvas-1', mode: 'agent',
    providerId: 'provider-1', modelId: 'model-1', prompt: 'Persisted prompt',
    sourceVersionIds, allowedToolIds: ['chat'], idempotencyKey: 'continuation-1',
    context: { selectedEntityIds: [], visibleVersionIds: sourceVersionIds, locale: 'zh-CN' },
    skill: {
      skillId: frozenSnapshot.id, skillVersion: frozenSnapshot.version, inputValues,
      modelBindings: { orchestrator: { providerId: 'provider-1', modelId: 'model-1' } },
    },
  };
  const requestDigest = agentRunRequestDigest(request);
  return {
    task: {
      id: 'run-1', userId: actor.id, projectId: request.projectId, type: 'agent-run',
      status: 'processing', progress: 40, creditStatus: 'charged', creditCost: 3,
      createdAt: 1, updatedAt: 2, idempotencyKey: request.idempotencyKey, requestDigest,
    },
    events: [{
      eventId: 'created', runId: 'run-1', sequence: 1, type: 'run.created', timestamp: 'now',
      payload: {
        workspace: request.workspace, workspaceId: request.workspaceId,
        providerId: request.providerId, modelId: request.modelId, prompt: request.prompt,
        sourceVersionIds, allowedToolIds: request.allowedToolIds, context: request.context,
        requestDigest, skill: request.skill, skillSnapshot: frozenSnapshot,
      },
    }],
  };
}

beforeEach(() => {
  continuationMocks.listManagedUsers.mockReset();
  continuationMocks.listManagedUsers.mockResolvedValue([actor]);
  continuationMocks.createRegistry.mockClear();
});

describe('Skill runtime frozen continuation', () => {
  it('restores the complete validated input contract from the frozen snapshot', () => {
    const definition = frozenDefinition({
      id: 'custom-source-bound', version: 4, name: 'Frozen source skill',
      executionContextVersion: 1, systemPrompt: 'Use frozen constraints',
      inputs: [{
        key: 'sources', label: 'Sources', kind: 'multi-select', required: true,
        defaultValue: ['version-a'], options: ['version-a', 'version-b'], maximumItems: 2,
        bindToSourceVersions: true,
      }],
      steps: [{
        id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential',
        promptTemplate: '{{sources}}', modelRole: 'orchestrator', qualityGateIds: [],
      }],
    }, 'canvas', 'custom-source-bound', 4);

    expect(definition.inputs).toEqual([{
      key: 'sources', label: 'Sources', kind: 'multi-select', required: true,
      defaultValue: ['version-a'], options: ['version-a', 'version-b'], maximumItems: 2,
      bindToSourceVersions: true,
    }]);
  });

  it.each([
    [{ defaultValue: ['version-a', 1] }],
    [{ options: ['version-a', 1] }],
    [{ maximumItems: 0 }],
    [{ bindToSourceVersions: 'true' }],
  ])('rejects malformed frozen input metadata %#', extra => {
    expect(() => frozenDefinition({
      id: 'bad', version: 1, name: 'Bad', executionContextVersion: 1, systemPrompt: 'Bad',
      inputs: [{ key: 'sources', label: 'Sources', kind: 'multi-select', required: true, ...extra }],
      steps: [{ id: 'plan', label: 'Plan', toolId: 'chat', execution: 'sequential', promptTemplate: '', modelRole: 'orchestrator', qualityGateIds: [] }],
    }, 'canvas', 'bad', 1)).toThrow('Frozen Skill input is invalid');
  });

  it.each([
    ['duplicate selection', { campaignName: 'Launch', channels: ['Web', 'Web'], sources: ['version-1'] }, ['version-1']],
    ['unknown selection', { campaignName: 'Launch', channels: ['Unknown'], sources: ['version-1'] }, ['version-1']],
    ['selection limit', { campaignName: 'Launch', channels: ['Web', 'Email', 'Social'], sources: ['version-1'] }, ['version-1']],
    ['missing required', { channels: ['Web'], sources: ['version-1'] }, ['version-1']],
    ['missing binding', { campaignName: 'Launch', channels: ['Web'], sources: ['version-1'] }, ['version-1', 'version-2']],
    ['extra binding', { campaignName: 'Launch', channels: ['Web'], sources: ['version-1', 'version-2'] }, ['version-1']],
    ['reordered binding', { campaignName: 'Launch', channels: ['Web'], sources: ['version-2', 'version-1'] }, ['version-1', 'version-2']],
  ])('rejects invalid persisted input on the real continuation load path: %s', async (_name, inputValues, sourceVersionIds) => {
    const fixture = persistedFixture(inputValues, sourceVersionIds);

    await expect(loadPersistedSkillContinuation({
      actorUserId: actor.id, projectId: 'project-1', runId: 'run-1', ...fixture,
    })).rejects.toMatchObject({ code: expect.stringMatching(/^SKILL_INPUT_/), field: expect.any(String) });
    expect(continuationMocks.createRegistry).not.toHaveBeenCalled();
  });
});
