import { describe, expect, it, vi } from 'vitest';

import {
  executeAgentEditContinuation,
  loadAgentEditContinuation,
} from '@/lib/agent-runtime/agent-edit-continuation';
import {
  AgentEditExecutionDescriptorError,
  createAgentEditExecutionDescriptorV1,
  digestAgentEditExecutionDescriptor,
} from '@/lib/agent-runtime/agent-edit-execution-descriptor';
import type { AgentEvent } from '@/lib/agent-runtime/types';

function fixture() {
  const descriptor = createAgentEditExecutionDescriptorV1({
    sourceVersionId: 'version-source-1', prompt: 'Retouch the portrait',
    providerId: 'provider-chat', modelId: 'model-chat',
    imageProviderId: 'provider-image', imageModelId: 'model-image', maxRounds: 3,
  });
  const descriptorDigest = digestAgentEditExecutionDescriptor(descriptor);
  const events: AgentEvent[] = [{
    eventId: 'created', runId: 'run-1', sequence: 1, type: 'run.created',
    timestamp: new Date(0).toISOString(),
    payload: {
      adopted: true, workspace: 'canvas', rootToolId: 'agent_edit',
      continuation: { kind: 'agent-edit', version: 1, descriptorDigest },
    },
  }];
  return { descriptor, descriptorDigest, events };
}

describe('Agent edit adopted continuation', () => {
  it('loads the private descriptor only for the canonical agent_edit root step', async () => {
    const { descriptor, events } = fixture();
    const loaded = await loadAgentEditContinuation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      nextStepId: 'agent_edit',
    }, {
      getDescriptor: vi.fn(async () => descriptor),
      listEvents: vi.fn(async () => events),
    });
    expect(loaded).toEqual(descriptor);

    await expect(loadAgentEditContinuation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      nextStepId: 'image_edit:0',
    }, {
      getDescriptor: vi.fn(async () => descriptor),
      listEvents: vi.fn(async () => events),
    })).rejects.toBeInstanceOf(AgentEditExecutionDescriptorError);
  });

  it.each([
    ['missing descriptor', null, undefined],
    ['unknown version', undefined, 2],
    ['digest mismatch', undefined, 1, '0'.repeat(64)],
  ])('fails closed on %s', async (
    _label,
    descriptorOverride: ReturnType<typeof fixture>['descriptor'] | null | undefined,
    version?: number,
    digestOverride?: string,
  ) => {
    const { descriptor, descriptorDigest, events } = fixture();
    events[0].payload.continuation = {
      kind: 'agent-edit', version: version ?? 1,
      descriptorDigest: digestOverride ?? descriptorDigest,
    };
    await expect(loadAgentEditContinuation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      nextStepId: 'agent_edit',
    }, {
      getDescriptor: vi.fn(async () => descriptorOverride === null ? null : descriptor),
      listEvents: vi.fn(async () => events),
    })).rejects.toBeInstanceOf(AgentEditExecutionDescriptorError);
  });

  it('executes after process-local state is cleared and forwards the fresh durable context', async () => {
    const { descriptor } = fixture();
    const localTaskStore = new Map([['run-1', { status: 'processing' }]]);
    localTaskStore.clear();
    const signal = new AbortController().signal;
    const executeDescriptor = vi.fn(async () => undefined);

    await executeAgentEditContinuation({
      actorUserId: 'user-1', projectId: 'project-1', runId: 'run-1',
      descriptor, nextStepId: 'agent_edit', generation: 7,
      leaseOwner: 'lease-7', signal,
    }, { executeDescriptor });

    expect(localTaskStore.size).toBe(0);
    expect(executeDescriptor).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', descriptor, nextStepId: 'agent_edit', generation: 7,
      leaseOwner: 'lease-7', signal,
    }));
  });
});
