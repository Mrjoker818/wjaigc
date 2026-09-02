import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  resolveTaskModel: vi.fn(),
  calculateConfiguredCreditCost: vi.fn(),
  authorizeAgentContext: vi.fn(),
  createAgentRun: vi.fn(),
  createBillableTask: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/task-core/model-catalog', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/task-core/model-catalog')>(),
  resolveTaskModel: mocks.resolveTaskModel,
}));
vi.mock('@/lib/credits', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/credits')>(),
  calculateConfiguredCreditCost: mocks.calculateConfiguredCreditCost,
}));
vi.mock('@/lib/agent-runtime/context-adapters', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/agent-runtime/context-adapters')>(),
  authorizeAgentContext: mocks.authorizeAgentContext,
}));
vi.mock('@/lib/agent-runtime/service', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/agent-runtime/service')>(),
  createAgentRun: mocks.createAgentRun,
}));
vi.mock('@/lib/task-core/billing-service', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/task-core/billing-service')>(),
  createBillableTask: mocks.createBillableTask,
}));

import { POST } from '@/app/api/skill-runs/estimate/route';

const auth = {
  authenticated: true as const,
  userId: 'user-1',
  userRole: 'user',
  user: { id: 'user-1' },
  source: 'cookie' as const,
};

function descriptor(providerId: string, modelId: string, kind: 'chat' | 'image') {
  return {
    providerId,
    modelId,
    kind,
    sourceType: kind,
    protocol: kind === 'chat' ? 'chat-completions' : 'images',
    executionMode: kind === 'chat' ? 'sync' : 'async',
    allowedRatios: [],
    allowedSizes: [],
    qualityOptions: [],
    maxOutputs: 1,
    supportsReferenceImages: false,
    supportsMask: false,
    outputKinds: kind === 'chat' ? ['text'] : ['png'],
    capabilitySources: {},
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    skillId: 'preset-ecommerce-listing',
    skillVersion: 1,
    surface: 'canvas',
    projectId: 'project-1',
    workspaceId: 'canvas-1',
    inputValues: { product: '耳机', features: '降噪，长续航' },
    sourceVersionIds: ['version-1'],
    modelBindings: {
      orchestrator: { providerId: 'pear-chat', modelId: 'gemini-3.1-flash' },
      image: { providerId: 'pear-image', modelId: 'gpt-image-2' },
    },
    idempotencyKey: 'estimate-1',
    creditCost: 1,
    billingQuote: { creditCost: 1 },
    ...overrides,
  };
}

function request(payload = body()): NextRequest {
  return new NextRequest('http://localhost/api/skill-runs/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('POST /api/skill-runs/estimate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue(auth);
    mocks.resolveTaskModel.mockImplementation(async (
      providerId: string,
      modelId: string,
    ) => descriptor(providerId, modelId, providerId === 'pear-chat' ? 'chat' : 'image'));
    mocks.calculateConfiguredCreditCost.mockResolvedValue(4);
    mocks.authorizeAgentContext.mockResolvedValue({
      snapshot: {},
      mediaByVersionId: { 'version-1': '/uploads/version-1.png' },
      selectedEntityVersionIds: {},
    });
  });

  it('authorizes assets and returns a server-calculated, read-only step estimate', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      minimum: 8,
      maximum: 8,
      steps: [
        { stepId: 'conversation-1', cost: 4 },
        { stepId: 'conversation-2', cost: 4 },
      ],
      modelBindings: {
        orchestrator: { providerId: 'pear-chat', modelId: 'gemini-3.1-flash' },
        image: { providerId: 'pear-image', modelId: 'gpt-image-2' },
      },
    });
    expect(mocks.authorizeAgentContext).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      request: expect.objectContaining({
        projectId: 'project-1',
        workspace: 'canvas',
        workspaceId: 'canvas-1',
        sourceVersionIds: ['version-1'],
      }),
    }));
    expect(mocks.createAgentRun).not.toHaveBeenCalled();
    expect(mocks.createBillableTask).not.toHaveBeenCalled();
  });

  it('ignores client supplied cost fields', async () => {
    mocks.calculateConfiguredCreditCost.mockResolvedValue(6);

    const response = await POST(request(body({
      creditCost: 0,
      billingQuote: { creditCost: 0, maximum: 0 },
    })));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ minimum: 12, maximum: 12 });
  });

  it('rejects a forged surface before asset authorization, costing, or task creation', async () => {
    const response = await POST(request(body({ surface: 'simple-chat' })));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'SKILL_SURFACE_FORBIDDEN' });
    expect(mocks.authorizeAgentContext).not.toHaveBeenCalled();
    expect(mocks.calculateConfiguredCreditCost).not.toHaveBeenCalled();
    expect(mocks.createBillableTask).not.toHaveBeenCalled();
  });

  it('fails closed before costing when an asset version is not authorized', async () => {
    mocks.authorizeAgentContext.mockRejectedValue(Object.assign(new Error('missing'), {
      code: 'AGENT_CONTEXT_NOT_FOUND',
      status: 404,
    }));

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND' });
    expect(mocks.calculateConfiguredCreditCost).not.toHaveBeenCalled();
    expect(mocks.createBillableTask).not.toHaveBeenCalled();
  });

  it('requires authentication before model authorization', async () => {
    const rejection = NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    mocks.requireApiAuthOrReject.mockResolvedValue(rejection);

    const response = await POST(request());

    expect(response).toBe(rejection);
    expect(mocks.resolveTaskModel).not.toHaveBeenCalled();
  });
});
