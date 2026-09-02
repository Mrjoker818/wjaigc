import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-catalog';
import type { User } from '@/lib/user-types';
import {
  buildSkillAgentRunRequest,
  createSkillRun,
  type SkillRunRequest,
} from '@/lib/skill-runtime/run-request';

function descriptor(
  providerId: string,
  modelId: string,
  kind: TaskModelDescriptor['kind'],
): TaskModelDescriptor {
  return {
    providerId,
    modelId,
    kind,
    sourceType: kind === 'chat' ? 'chat' : 'image',
    protocol: kind === 'chat' ? 'chat-completions' : 'images',
    executionMode: kind === 'chat' ? 'sync' : 'async',
    allowedRatios: [],
    allowedSizes: [],
    qualityOptions: [],
    maxOutputs: 1,
    supportsReferenceImages: false,
    supportsMask: kind === 'edit',
    outputKinds: kind === 'chat' ? ['text'] : ['png'],
    capabilitySources: {},
  };
}

const input: SkillRunRequest = {
  skillId: 'preset-ecommerce-listing',
  skillVersion: 1,
  surface: 'canvas',
  projectId: 'project-1',
  workspaceId: 'canvas-1',
  inputValues: {
    product: '耳机',
    features: '降噪，长续航',
  },
  sourceVersionIds: ['version-1'],
  modelBindings: {
    orchestrator: { providerId: 'pear-chat', modelId: 'gemini-3.1-flash' },
    image: { providerId: 'pear-image', modelId: 'gpt-image-2' },
  },
  idempotencyKey: 'skill-run-1',
};

const actor: User = {
  id: 'user-1',
  name: 'Skill user',
  role: 'user',
  status: 'active',
  productType: 'canvas,chat',
  createdAt: 1,
  updatedAt: 1,
};

function runtimeDependencies() {
  const resolveTaskModel = vi.fn(async (providerId: string, modelId: string) => {
    if (providerId === 'pear-chat' && modelId === 'gemini-3.1-flash') {
      return descriptor(providerId, modelId, 'chat');
    }
    if (providerId === 'pear-image' && modelId === 'gpt-image-2') {
      return descriptor(providerId, modelId, 'image');
    }
    throw new Error('provider/model is not authorized');
  });
  const authorizeContext = vi.fn(async ({ request }: { request: AgentRunRequest }) => ({
    snapshot: request.context,
    mediaByVersionId: {},
    selectedEntityVersionIds: {},
  }));
  return { resolveTaskModel, authorizeContext };
}

describe('Skill runtime run requests', () => {
  it('freezes the authorized provider and model for every model role', async () => {
    const dependencies = runtimeDependencies();

    const request = await buildSkillAgentRunRequest(input, {
      actorUserId: actor.id,
      ...dependencies,
    });

    expect(request.skill?.modelBindings).toEqual({
      orchestrator: { providerId: 'pear-chat', modelId: 'gemini-3.1-flash' },
      image: { providerId: 'pear-image', modelId: 'gpt-image-2' },
    });
    expect(dependencies.resolveTaskModel.mock.calls).toEqual([
      ['pear-chat', 'gemini-3.1-flash', actor.id],
      ['pear-image', 'gpt-image-2', actor.id],
    ]);
    expect(request).toMatchObject({
      workspace: 'canvas',
      mode: 'agent',
      providerId: 'pear-chat',
      modelId: 'gemini-3.1-flash',
      sourceVersionIds: ['version-1'],
      allowedToolIds: ['generate_image'],
      context: {
        selectedEntityIds: [],
        visibleVersionIds: ['version-1'],
        locale: 'zh-CN',
      },
    });
  });

  it('rejects a canvas Skill forged onto simple-chat before model authorization or costing', async () => {
    const dependencies = runtimeDependencies();
    const calculateCreditCost = vi.fn();

    await expect(buildSkillAgentRunRequest({ ...input, surface: 'simple-chat' }, {
      actorUserId: actor.id,
      ...dependencies,
    })).rejects.toMatchObject({ code: 'SKILL_SURFACE_FORBIDDEN', status: 403 });

    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
    expect(calculateCreditCost).not.toHaveBeenCalled();
  });

  it('supports simple-chat Skills only in the chat workspace', async () => {
    const dependencies = runtimeDependencies();
    const request = await buildSkillAgentRunRequest({
      ...input,
      skillId: 'ppt-master',
      surface: 'simple-chat',
      inputValues: {},
      sourceVersionIds: [],
      modelBindings: {
        orchestrator: input.modelBindings.orchestrator,
      },
    }, { actorUserId: actor.id, ...dependencies });

    expect(request.workspace).toBe('chat');
    expect(request.skill?.skillId).toBe('ppt-master');
    expect(request.skill?.modelBindings).toEqual({
      orchestrator: { providerId: 'pear-chat', modelId: 'gemini-3.1-flash' },
    });
  });

  it('fails closed for a stale Skill version before model authorization', async () => {
    const dependencies = runtimeDependencies();

    await expect(buildSkillAgentRunRequest({ ...input, skillVersion: 2 }, {
      actorUserId: actor.id,
      ...dependencies,
    })).rejects.toMatchObject({ code: 'SKILL_VERSION_CONFLICT', status: 409 });
    expect(dependencies.resolveTaskModel).not.toHaveBeenCalled();
  });

  it('fails closed when a required role is missing before costing', async () => {
    const dependencies = runtimeDependencies();
    const calculateCreditCost = vi.fn();

    await expect(buildSkillAgentRunRequest({
      ...input,
      modelBindings: { orchestrator: input.modelBindings.orchestrator },
    }, { actorUserId: actor.id, ...dependencies })).rejects.toMatchObject({
      code: 'SKILL_MODEL_BINDING_REQUIRED',
      status: 400,
    });
    expect(calculateCreditCost).not.toHaveBeenCalled();
  });

  it('fails closed on provider/model rejection or insufficient role capability', async () => {
    const rejected = runtimeDependencies();
    rejected.resolveTaskModel.mockRejectedValueOnce(new Error('not authorized'));
    await expect(buildSkillAgentRunRequest(input, {
      actorUserId: actor.id,
      ...rejected,
    })).rejects.toThrow('not authorized');

    const incapable = runtimeDependencies();
    incapable.resolveTaskModel.mockResolvedValueOnce(
      descriptor('pear-chat', 'gemini-3.1-flash', 'image'),
    );
    await expect(buildSkillAgentRunRequest(input, {
      actorUserId: actor.id,
      ...incapable,
    })).rejects.toMatchObject({
      code: 'SKILL_MODEL_CAPABILITY_REQUIRED',
      status: 422,
    });
  });

  it('recalculates the quote on create and passes it through the Agent Runtime billing boundary', async () => {
    const dependencies = runtimeDependencies();
    const calculateCreditCost = vi.fn(async (operation: string) => (
      operation === 'image_generate' ? 4 : 0
    ));
    const createAgentRun = vi.fn(async (value: {
      actor: User;
      request: AgentRunRequest;
      billingQuote?: { creditCost: number; label: string };
    }) => ({
      runId: 'run-1',
      reused: false,
      charged: true,
      event: {} as never,
      projection: {} as never,
      tools: [],
      quote: value.billingQuote!,
    }));

    const result = await createSkillRun({ actor, request: input }, {
      ...dependencies,
      calculateCreditCost,
      createAgentRun,
    });

    expect(calculateCreditCost).toHaveBeenCalledTimes(2);
    expect(dependencies.authorizeContext).toHaveBeenCalledOnce();
    expect(dependencies.authorizeContext.mock.invocationCallOrder[0]).toBeLessThan(
      calculateCreditCost.mock.invocationCallOrder[0],
    );
    expect(createAgentRun).toHaveBeenCalledOnce();
    expect(createAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      billingQuote: { creditCost: 8, label: '电商商品套图' },
      request: expect.objectContaining({ idempotencyKey: 'skill-run-1' }),
    }));
    expect(result).toMatchObject({ runId: 'run-1' });
  });
});
