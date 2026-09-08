import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(), createSkillRun: vi.fn(), listSkillRuns: vi.fn(),
  getSkillRun: vi.fn(), pauseSkillRun: vi.fn(), resumeSkillRun: vi.fn(),
  cancelSkillRun: vi.fn(), retrySkillStep: vi.fn(), skillRuntimeHttpError: vi.fn(),
  dispatchSkillRunExecution: vi.fn(),
  recoverLiveSkillRunExecution: vi.fn(),
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
    mocks.dispatchSkillRunExecution.mockResolvedValue({ started: false });
    mocks.recoverLiveSkillRunExecution.mockResolvedValue({ started: false });
    mocks.skillRuntimeHttpError.mockImplementation((error: { status?: number; code?: string; message?: string }) => ({
      status: error.status || 500,
      body: { error: { code: error.code || 'SKILL_RUN_ERROR', message: error.message || 'Skill run request failed' } },
    }));
  });

  it('creates and lists only through the authenticated actor', async () => {
    mocks.createSkillRun.mockResolvedValue({ runId: 'run-1', reused: false });
    mocks.dispatchSkillRunExecution.mockResolvedValue({ started: true, completion: Promise.resolve() });
    mocks.recoverLiveSkillRunExecution.mockResolvedValue({ started: false });
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
    expect(mocks.dispatchSkillRunExecution).toHaveBeenCalledWith({
      actorUserId: user.id, runId: 'run-1', recoveryOnly: false,
    });
    expect(mocks.listSkillRuns).toHaveBeenCalledWith({ actorUserId: user.id, limit: 20 });
    expect(await listed.json()).toEqual({ runs: [expect.objectContaining({ runId: 'run-1', skillVersion: 1 })] });
  });

  it('lists scoped history without dispatching recovery when observing', async () => {
    mocks.listSkillRuns.mockResolvedValue([{ runId: 'run-1' }]);
    const route = await import('@/app/api/skill-runs/route');
    const response = await route.GET(new NextRequest('http://localhost/api/skill-runs?projectId=p1&surface=canvas&workspaceId=w1&skillId=s1&observeOnly=true'));
    expect(response.status).toBe(200);
    expect(mocks.listSkillRuns).toHaveBeenCalledWith({ actorUserId: user.id, limit: 20,
      projectId: 'p1', surface: 'canvas', workspaceId: 'w1', skillId: 's1' });
    expect(mocks.recoverLiveSkillRunExecution).not.toHaveBeenCalled();
  });

  it.each(['surface=unknown', 'projectId=', `skillId=${'x'.repeat(257)}`, 'workspaceId=%00'])('rejects invalid history scope %s', async query => {
    const route = await import('@/app/api/skill-runs/route');
    const response = await route.GET(new NextRequest(`http://localhost/api/skill-runs?${query}`));
    expect(response.status).toBe(400);
    expect(mocks.listSkillRuns).not.toHaveBeenCalled();
    expect(mocks.recoverLiveSkillRunExecution).not.toHaveBeenCalled();
  });

  it('uses the durable recovery claim for an idempotent create replay', async () => {
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
    expect(mocks.dispatchSkillRunExecution).toHaveBeenCalledWith({
      actorUserId: user.id, runId: 'run-1', recoveryOnly: true,
    });
  });

  it('controls a rejected dispatch completion without writing a second terminal state', async () => {
    const kickoffError = new Error('continuation failed to load');
    mocks.createSkillRun.mockResolvedValue({ runId: 'run-chat', reused: false, charged: true });
    mocks.dispatchSkillRunExecution.mockResolvedValue({
      started: true, completion: Promise.reject(kickoffError),
    });
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
    await vi.waitFor(() => expect(mocks.dispatchSkillRunExecution).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.createSkillRun).toHaveBeenCalledTimes(1);
  });

  it('bounds list recovery to the first 20 owned runs', async () => {
    mocks.listSkillRuns.mockResolvedValue(Array.from({ length: 25 }, (_, index) => ({
      runId: `run-${index + 1}`, skillId: 'preset-ecommerce-listing', skillVersion: 1,
    })));
    const route = await import('@/app/api/skill-runs/route');

    const response = await route.GET(new NextRequest('http://localhost/api/skill-runs?limit=25'));

    expect(response.status).toBe(200);
    expect(mocks.recoverLiveSkillRunExecution).toHaveBeenCalledTimes(20);
    expect(mocks.recoverLiveSkillRunExecution).toHaveBeenNthCalledWith(1, {
      actorUserId: user.id, runId: 'run-1', recoveryOnly: true,
    });
    expect(mocks.recoverLiveSkillRunExecution).toHaveBeenLastCalledWith({
      actorUserId: user.id, runId: 'run-20', recoveryOnly: true,
    });
  });

  it('attempts one bounded recovery for an owned single-run GET', async () => {
    mocks.getSkillRun.mockResolvedValue({ runId: 'run-1', skillId: 'preset-ecommerce-listing', skillVersion: 1 });
    const route = await import('@/app/api/skill-runs/[runId]/route');

    const response = await route.GET(
      new NextRequest('http://localhost/api/skill-runs/run-1'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.recoverLiveSkillRunExecution).toHaveBeenCalledOnce();
    expect(mocks.recoverLiveSkillRunExecution).toHaveBeenCalledWith({
      actorUserId: user.id, runId: 'run-1', recoveryOnly: true,
    });
  });

  it('observes an owned run without starting recovery work', async () => {
    mocks.getSkillRun.mockResolvedValue({ runId: 'run-1', skillId: 'preset-food-photography' });
    const route = await import('@/app/api/skill-runs/[runId]/route');
    const response = await route.GET(
      new NextRequest('http://localhost/api/skill-runs/run-1?observeOnly=true'),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run: { runId: 'run-1', skillId: 'preset-food-photography' } });
    expect(mocks.getSkillRun).toHaveBeenCalledWith({ actorUserId: user.id, runId: 'run-1' });
    expect(mocks.recoverLiveSkillRunExecution).not.toHaveBeenCalled();
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
    mocks.retrySkillStep.mockResolvedValue({
      accepted: true,
      startedStepIds: ['generate-3'],
      scheduledStepIds: ['generate-3', 'quality-3'],
    });
    const route = await import('@/app/api/skill-runs/[runId]/retry/route');
    const response = await route.POST(new NextRequest('http://localhost/api/skill-runs/run-1/retry', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stepId: 'generate-3' }),
    }), { params: Promise.resolve({ runId: 'run-1' }) });
    expect(response.status).toBe(200);
    expect(mocks.retrySkillStep).toHaveBeenCalledWith({ actorUserId: user.id, runId: 'run-1', stepId: 'generate-3' });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      startedStepIds: ['generate-3'],
      scheduledStepIds: ['generate-3', 'quality-3'],
    });
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

  it('returns preserved partial compliance reports while a failed image awaits retry', async () => {
    mocks.getSkillRun.mockResolvedValue({
      runId: 'run-compliance', skillId: 'preset-platform-compliance-audit', skillVersion: 1,
      status: 'paused', resumeFromStepId: 'audit-image:failed',
      assetVersionIds: ['report-complete-a', 'report-technical-b', 'report-complete-c'],
      outputs: [
        { stepId: 'audit-image:a', kind: 'json', schemaId: 'platform-compliance-report-v1', content: '{"verdict":"passed"}' },
        { stepId: 'audit-image:c', kind: 'json', schemaId: 'platform-compliance-report-v1', content: '{"verdict":"warning"}' },
      ],
    });
    const route = await import('@/app/api/skill-runs/[runId]/route');
    const response = await route.GET(
      new NextRequest('http://localhost/api/skill-runs/run-compliance?observeOnly=true'),
      { params: Promise.resolve({ runId: 'run-compliance' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: expect.objectContaining({
        status: 'paused', resumeFromStepId: 'audit-image:failed',
        assetVersionIds: ['report-complete-a', 'report-technical-b', 'report-complete-c'],
      }),
    });
    expect(mocks.recoverLiveSkillRunExecution).not.toHaveBeenCalled();
  });

  it('retries only the selected failed compliance image step', async () => {
    mocks.retrySkillStep.mockResolvedValue({
      accepted: true,
      startedStepIds: ['audit-image:failed'],
      scheduledStepIds: ['audit-image:failed'],
    });
    const route = await import('@/app/api/skill-runs/[runId]/retry/route');
    const response = await route.POST(new NextRequest('http://localhost/api/skill-runs/run-compliance/retry', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stepId: 'audit-image:failed' }),
    }), { params: Promise.resolve({ runId: 'run-compliance' }) });

    expect(response.status).toBe(200);
    expect(mocks.retrySkillStep).toHaveBeenCalledWith({
      actorUserId: user.id, runId: 'run-compliance', stepId: 'audit-image:failed',
    });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      startedStepIds: ['audit-image:failed'],
      scheduledStepIds: ['audit-image:failed'],
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
