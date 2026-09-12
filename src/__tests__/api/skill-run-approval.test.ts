import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(), approveSkillRunPlan: vi.fn(), reviseSkillRunPlan: vi.fn(),
  pauseSkillRun: vi.fn(), resumeSkillRun: vi.fn(), cancelSkillRun: vi.fn(), getSkillRun: vi.fn(),
  recoverLiveSkillRunExecution: vi.fn(), skillRuntimeHttpError: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/skill-runtime/service', () => mocks);

describe('Skill run approval API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue({ user: { id: 'user-1' }, userId: 'user-1' });
    mocks.skillRuntimeHttpError.mockImplementation((error: { status?: number; code?: string; message?: string }) => ({
      status: error.status || 500,
      body: { error: { code: error.code || 'SKILL_RUN_ERROR', message: error.message || 'failed' } },
    }));
  });

  it('forwards an exact approval identity for the authenticated user', async () => {
    mocks.approveSkillRunPlan.mockResolvedValue({ accepted: true, dispatched: true });
    const route = await import('@/app/api/skill-runs/[runId]/route');
    const body = { action: 'approve', revision: 8, generation: 3, planChecksum: 'a'.repeat(64) };
    const response = await route.PATCH(new NextRequest('http://localhost/api/skill-runs/run-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ runId: 'run-1' }) });
    expect(response.status).toBe(200);
    expect(mocks.approveSkillRunPlan).toHaveBeenCalledWith({ actorUserId: 'user-1', runId: 'run-1',
      revision: 8, generation: 3, planChecksum: 'a'.repeat(64) });
  });

  it('forwards a bounded revision request and rejects forged fields', async () => {
    mocks.reviseSkillRunPlan.mockResolvedValue({ accepted: true, dispatched: true });
    const route = await import('@/app/api/skill-runs/[runId]/route');
    const valid = { action: 'revise', revision: 8, generation: 3, planChecksum: 'a'.repeat(64),
      revisionInstruction: '将节奏调整得更紧凑' };
    const response = await route.PATCH(new NextRequest('http://localhost/api/skill-runs/run-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(valid),
    }), { params: Promise.resolve({ runId: 'run-1' }) });
    expect(response.status).toBe(200);
    expect(mocks.reviseSkillRunPlan).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1', runId: 'run-1', revisionInstruction: '将节奏调整得更紧凑',
    }));

    const forged = await route.PATCH(new NextRequest('http://localhost/api/skill-runs/run-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...valid, providerId: 'forged' }),
    }), { params: Promise.resolve({ runId: 'run-1' }) });
    expect(forged.status).toBe(400);
  });
});
