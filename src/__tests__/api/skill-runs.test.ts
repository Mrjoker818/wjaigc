import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(), createSkillRun: vi.fn(), listSkillRuns: vi.fn(),
  getSkillRun: vi.fn(), pauseSkillRun: vi.fn(), resumeSkillRun: vi.fn(),
  cancelSkillRun: vi.fn(), retrySkillStep: vi.fn(), skillRuntimeHttpError: vi.fn(),
  startSkillRunExecution: vi.fn(),
  failSkillRunExecution: vi.fn(),
  parseSkillRunRequest: vi.fn((value: unknown) => value),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/skill-runtime/service', () => mocks);

const user = { id: 'user-1', name: 'User', role: 'user', status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 };

describe('Skill run API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue({ user, userId: user.id });
    mocks.skillRuntimeHttpError.mockImplementation((error: { status?: number; code?: string; message?: string }) => ({
      status: error.status || 500,
      body: { error: { code: error.code || 'SKILL_RUN_ERROR', message: error.message || 'Skill run request failed' } },
    }));
  });

  it('creates and lists only through the authenticated actor', async () => {
    mocks.createSkillRun.mockResolvedValue({ runId: 'run-1', reused: false });
    mocks.startSkillRunExecution.mockReturnValue({ started: true, completion: Promise.resolve() });
    mocks.listSkillRuns.mockResolvedValue([{ runId: 'run-1', skillId: 'preset-ecommerce-listing', skillVersion: 1 }]);
    const route = await import('@/app/api/skill-runs/route');
    const body = {
      skillId: 'preset-ecommerce-listing', skillVersion: 1, surface: 'canvas',
      projectId: 'project-1', workspaceId: 'canvas-1', inputValues: {}, sourceVersionIds: [],
      modelBindings: { orchestrator: { providerId: 'provider-1', modelId: 'chat-1' } },
      idempotencyKey: 'skill-request-1',
    };
    const created = await route.POST(new NextRequest('http://localhost/api/skill-runs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    const listed = await route.GET(new NextRequest('http://localhost/api/skill-runs?limit=20'));

    expect(created.status).toBe(201);
    expect(mocks.createSkillRun).toHaveBeenCalledWith({ actor: user, request: body });
    expect(mocks.startSkillRunExecution).toHaveBeenCalledWith({ actor: user, runId: 'run-1' });
    expect(mocks.listSkillRuns).toHaveBeenCalledWith({ actorUserId: user.id, limit: 20 });
    expect(await listed.json()).toEqual({ runs: [expect.objectContaining({ runId: 'run-1', skillVersion: 1 })] });
  });

  it('does not start provider work again for an idempotent create replay', async () => {
    mocks.createSkillRun.mockResolvedValue({ runId: 'run-1', reused: true });
    const route = await import('@/app/api/skill-runs/route');
    const body = {
      skillId: 'preset-ecommerce-listing', skillVersion: 1, surface: 'canvas',
      projectId: 'project-1', workspaceId: 'canvas-1', inputValues: {}, sourceVersionIds: [],
      modelBindings: { orchestrator: { providerId: 'provider-1', modelId: 'chat-1' } },
      idempotencyKey: 'skill-request-1',
    };

    const response = await route.POST(new NextRequest('http://localhost/api/skill-runs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));

    expect(response.status).toBe(200);
    expect(mocks.startSkillRunExecution).not.toHaveBeenCalled();
  });

  it('persists and settles a background kickoff failure instead of only logging it', async () => {
    const kickoffError = new Error('continuation failed to load');
    mocks.createSkillRun.mockResolvedValue({ runId: 'run-chat', reused: false, charged: true });
    mocks.startSkillRunExecution.mockReturnValue({
      started: true, completion: Promise.reject(kickoffError),
    });
    mocks.failSkillRunExecution.mockResolvedValue({ accepted: true });
    const route = await import('@/app/api/skill-runs/route');
    const body = {
      skillId: 'ppt-master', skillVersion: 1, surface: 'simple-chat',
      projectId: 'project-1', workspaceId: 'chat-1', inputValues: {}, sourceVersionIds: [],
      modelBindings: { orchestrator: { providerId: 'provider-1', modelId: 'chat-1' } },
      idempotencyKey: 'simple-chat-request-1',
    };

    const response = await route.POST(new NextRequest('http://localhost/api/skill-runs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));

    expect(response.status).toBe(201);
    await vi.waitFor(() => expect(mocks.failSkillRunExecution).toHaveBeenCalledWith({
      actorUserId: user.id, runId: 'run-chat', error: kickoffError,
    }));
    expect(mocks.startSkillRunExecution).toHaveBeenCalledTimes(1);
    expect(mocks.createSkillRun).toHaveBeenCalledTimes(1);
  });

  it.each(['pause', 'resume', 'cancel'] as const)('authorizes %s control by actor', async action => {
    const method = action === 'pause' ? mocks.pauseSkillRun : action === 'resume' ? mocks.resumeSkillRun : mocks.cancelSkillRun;
    method.mockResolvedValue({ accepted: true });
    const route = await import('@/app/api/skill-runs/[runId]/route');
    const response = await route.PATCH(new NextRequest('http://localhost/api/skill-runs/run-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }),
    }), { params: Promise.resolve({ runId: 'run-1' }) });
    expect(response.status).toBe(200);
    expect(method).toHaveBeenCalledWith({ actorUserId: user.id, runId: 'run-1' });
  });

  it('retries an owned failed step with the authenticated actor', async () => {
    mocks.retrySkillStep.mockResolvedValue({ accepted: true, startedStepIds: ['generate-3', 'quality-3'] });
    const route = await import('@/app/api/skill-runs/[runId]/retry/route');
    const response = await route.POST(new NextRequest('http://localhost/api/skill-runs/run-1/retry', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stepId: 'generate-3' }),
    }), { params: Promise.resolve({ runId: 'run-1' }) });
    expect(response.status).toBe(200);
    expect(mocks.retrySkillStep).toHaveBeenCalledWith({ actorUserId: user.id, runId: 'run-1', stepId: 'generate-3' });
  });

  it('maps cross-user not-found and idempotency conflicts without leaking details', async () => {
    mocks.getSkillRun.mockRejectedValue(Object.assign(new Error('hidden'), { code: 'SKILL_RUN_NOT_FOUND', status: 404 }));
    const route = await import('@/app/api/skill-runs/[runId]/route');
    const response = await route.GET(new NextRequest('http://localhost/api/skill-runs/other'), { params: Promise.resolve({ runId: 'other' }) });
    expect(response.status).toBe(404);
    expect(mocks.getSkillRun).toHaveBeenCalledWith({ actorUserId: user.id, runId: 'other' });
  });

  it('returns durable text outputs from owned run history', async () => {
    mocks.getSkillRun.mockResolvedValue({
      runId: 'run-chat', skillId: 'ppt-master', skillVersion: 1,
      outputs: [{ stepId: 'orchestrator', kind: 'text', content: '完成内容' }],
    });
    const route = await import('@/app/api/skill-runs/[runId]/route');
    const response = await route.GET(
      new NextRequest('http://localhost/api/skill-runs/run-chat'),
      { params: Promise.resolve({ runId: 'run-chat' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: expect.objectContaining({
        outputs: [{ stepId: 'orchestrator', kind: 'text', content: '完成内容' }],
      }),
    });
  });

  it('returns authentication responses without invoking services', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
    const route = await import('@/app/api/skill-runs/route');
    const response = await route.GET(new NextRequest('http://localhost/api/skill-runs'));
    expect(response.status).toBe(401);
    expect(mocks.listSkillRuns).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON as a request error', async () => {
    const route = await import('@/app/api/skill-runs/route');
    const response = await route.POST(new NextRequest('http://localhost/api/skill-runs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    }));
    expect(response.status).toBe(400);
    expect(mocks.createSkillRun).not.toHaveBeenCalled();
  });

  it('rejects non-JSON, unknown fields, and oversized create bodies before service admission', async () => {
    const route = await import('@/app/api/skill-runs/route');
    const nonJson = await route.POST(new NextRequest('http://localhost/api/skill-runs', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    }));
    expect(nonJson.status).toBe(415);

    const unknown = await route.POST(new NextRequest('http://localhost/api/skill-runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId: 'preset-ecommerce-listing', skillVersion: 1, surface: 'canvas',
        projectId: 'project-1', workspaceId: 'canvas-1', inputValues: {}, sourceVersionIds: [],
        modelBindings: { orchestrator: { providerId: 'provider-1', modelId: 'chat-1' } },
        idempotencyKey: 'skill-request-1', actorUserId: 'attacker',
      }),
    }));
    expect(unknown.status).toBe(400);

    const oversized = await route.POST(new NextRequest('http://localhost/api/skill-runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(600 * 1024) }),
    }));
    expect(oversized.status).toBe(400);
    expect(mocks.createSkillRun).not.toHaveBeenCalled();
  });

  it('rejects unknown control fields before mutating a run', async () => {
    const route = await import('@/app/api/skill-runs/[runId]/route');
    const response = await route.PATCH(new NextRequest('http://localhost/api/skill-runs/run-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pause', actorUserId: 'attacker' }),
    }), { params: Promise.resolve({ runId: 'run-1' }) });
    expect(response.status).toBe(400);
    expect(mocks.pauseSkillRun).not.toHaveBeenCalled();
  });
});
