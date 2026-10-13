import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(), getCloudTaskById: vi.fn(), getCloudTaskForUser: vi.fn(),
  getTaskInfo: vi.fn(), normalizeModelForApi: vi.fn(), findProviderForModel: vi.fn(),
  findProviderById: vi.fn(), after: vi.fn(), recoverExpiredSketchTask: vi.fn(),
  readSketchDocument: vi.fn(), createBillableTask: vi.fn(), terminateCloudTaskAndRefund: vi.fn(),
}));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
vi.mock('@/lib/api-auth', () => ({
  getRequestUser: mocks.getRequestUser, getInternalRequestHeaders: vi.fn(),
  getTrustedRequestAgentExecutionFence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskById: mocks.getCloudTaskById, getCloudTaskForUser: mocks.getCloudTaskForUser,
  claimCloudTaskLease: vi.fn(), completeCloudTask: vi.fn(), refundCloudTaskCredits: vi.fn(),
  terminateCloudTaskAndRefund: mocks.terminateCloudTaskAndRefund, updateCloudTask: vi.fn(),
  releaseCloudTaskLease: vi.fn(), renewCloudTaskLease: vi.fn(), deferCloudTaskRecovery: vi.fn(),
}));
vi.mock('@/lib/task-registry', () => ({
  getTaskInfo: mocks.getTaskInfo, isTaskCancelled: vi.fn().mockReturnValue(false),
  registerTask: vi.fn(), updateTaskProgress: vi.fn(), abortTaskExecution: vi.fn(),
  registerTaskAbortController: vi.fn(), unregisterTaskAbortController: vi.fn(), releaseQueueSlot: vi.fn(),
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: mocks.findProviderForModel, findProviderById: mocks.findProviderById,
  normalizeApiBaseUrl: (value: string): string => value,
}));
vi.mock('@/lib/model-capabilities', () => ({ normalizeModelForApi: mocks.normalizeModelForApi }));
vi.mock('@/lib/cloud-task-persistence', () => ({
  buildRecoveredTaskContext: vi.fn(), recordImageTaskTerminal: vi.fn(), recordVideoTaskTerminal: vi.fn(),
  projectPersistedCompletedTask: vi.fn(),
}));
vi.mock('@/lib/sketch-to-code/execution', () => ({ recoverExpiredSketchTask: mocks.recoverExpiredSketchTask }));
vi.mock('@/lib/sketch-to-code/document', () => ({ readSketchDocument: mocks.readSketchDocument }));
vi.mock('@/lib/task-core/billing-service', () => ({ createBillableTask: mocks.createBillableTask }));

import { POST } from '@/app/api/poll-task/route';

function request(taskId: string): NextRequest {
  return new Request('http://localhost/api/poll-task', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId, model: 'spoofed-alias' }),
  }) as NextRequest;
}

function sketchTask(status = 'processing'): Record<string, unknown> {
  return { id: 'nonprefix-original', type: 'sketch-to-code', userId: 'owner-a', projectId: 'project-a', providerId: 'p1', model: 'm1',
    requestDigest: 'a'.repeat(64), idempotencyKey: 'nonce', status, progress: 10, label: '草图转代码：分析中', creditCost: 14, creditStatus: status === 'completed' ? 'charged' : 'pending', createdAt: Date.now(),
    result: { sketchAdmission: { version: 1, route: '/api/sketch-to-code', requestDigest: 'a'.repeat(64), access: { kind: 'personal', actorUserId: 'owner-a', ownerId: 'owner-a', projectId: 'project-a' }, pricing: { calls: 2, perCallCredits: 7, totalCredits: 14 } }, html: 'RAW_UNAUTHORIZED_HTML', previewAssetId: 'RAW_REF' } };
}
function ownRequest(body: Record<string, unknown> = { taskId: 'nonprefix-original' }): NextRequest {
  return new Request('http://localhost/api/poll-task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as NextRequest;
}

describe('original poll sketch HTTP identity boundary', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getRequestUser.mockResolvedValue(null);
    mocks.getCloudTaskById.mockResolvedValue(null);
    mocks.getCloudTaskForUser.mockResolvedValue(null);
    mocks.findProviderForModel.mockResolvedValue(null);
    mocks.findProviderById.mockResolvedValue(null);
    mocks.normalizeModelForApi.mockImplementation((model: string) => ({ apiModelName: model, wasNormalized: false }));
    mocks.recoverExpiredSketchTask.mockResolvedValue({ status: 'skipped' });
  });

  // Removing the sketch short circuit must allow this request into the old
  // provider/model path; the real route's HTTP response catches that regression.
  it('rejects an anonymous sketch_ candidate before generic model or provider work', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_HTTP'));
    try {
      const response = await POST(request('sketch_unknown'));
      expect(response.status).toBe(401);
      expect(mocks.normalizeModelForApi).not.toHaveBeenCalled();
      expect(mocks.findProviderForModel).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mocks.createBillableTask).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it('identifies a nonprefix persisted sketch and rejects an anonymous caller before generic work', async () => {
    mocks.getCloudTaskById.mockResolvedValue({ id: 'original-nonprefix-id', type: 'sketch-to-code', userId: 'owner-a' });
    const response = await POST(request('original-nonprefix-id'));
    expect(response.status).toBe(401);
    expect(mocks.normalizeModelForApi).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
    expect(mocks.recoverExpiredSketchTask).not.toHaveBeenCalled();
  });

  it('rejects another actor including admin for a nonprefix persisted sketch', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'admin-b', role: 'admin' }, source: 'cookie' });
    mocks.getCloudTaskById.mockResolvedValue({ id: 'original-nonprefix-id', type: 'sketch-to-code', userId: 'owner-a' });
    const response = await POST(request('original-nonprefix-id'));
    expect(response.status).toBe(404);
    expect(mocks.normalizeModelForApi).not.toHaveBeenCalled();
    expect(mocks.getTaskInfo).not.toHaveBeenCalled();
    expect(mocks.recoverExpiredSketchTask).not.toHaveBeenCalled();
    expect(mocks.readSketchDocument).not.toHaveBeenCalled();
  });

  it('active original task exposes only phase/reserve and gives recovery only frozen original identity', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockResolvedValue(sketchTask());
    const response = await POST(ownRequest()); expect(response.status).toBe(202); const json = await response.json();
    expect(json).toMatchObject({ taskId: 'nonprefix-original', phase: 'analysis', reserveCredits: 14, providerId: 'p1', modelId: 'm1' });
    expect(JSON.stringify(json)).not.toMatch(/RAW_|access|nonce|Digest|lease/);
    expect(mocks.recoverExpiredSketchTask).toHaveBeenCalledWith('nonprefix-original', expect.objectContaining({ actorUserId: 'owner-a', projectId: 'project-a', providerId: 'p1', modelId: 'm1', requestDigest: 'a'.repeat(64), idempotencyKey: 'nonce' }));
    expect(mocks.normalizeModelForApi).not.toHaveBeenCalled(); expect(mocks.createBillableTask).not.toHaveBeenCalled();
  });
  it.each(['version', 'route', 'digest', 'nonce', 'access', 'pricing', 'creditCost'] as const)('invalid persisted %s stops before recovery', async field => {
    const t = sketchTask(); const meta = (t.result as Record<string, unknown>).sketchAdmission as Record<string, unknown>;
    if (field === 'version') meta.version = 2; if (field === 'route') meta.route = '/api/generate'; if (field === 'digest') t.requestDigest = 'b'.repeat(64);
    if (field === 'nonce') t.idempotencyKey = ''; if (field === 'access') meta.access = { kind: 'unscoped' }; if (field === 'pricing') meta.pricing = { calls: 2 }; if (field === 'creditCost') t.creditCost = 15;
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockResolvedValue(t);
    expect((await POST(ownRequest())).status).toBe(404); expect(mocks.recoverExpiredSketchTask).not.toHaveBeenCalled();
  });
  it.each(['userId', 'apiKey', 'apiBaseUrl', 'engine', 'result', 'lease', 'credits'])('client %s cannot join a sketch identity', async field => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockResolvedValue(sketchTask());
    expect((await POST(ownRequest({ taskId: 'nonprefix-original', [field]: 'spoof' }))).status).toBe(400); expect(mocks.recoverExpiredSketchTask).not.toHaveBeenCalled();
  });
  it.each(['m1', 'p1::m1'])('accepts only exact model spelling %s without alias work', async model => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockResolvedValue(sketchTask());
    expect((await POST(ownRequest({ taskId: 'nonprefix-original', model, providerId: 'p1' }))).status).toBe(202); expect(mocks.normalizeModelForApi).not.toHaveBeenCalled();
  });
  it.each([{ model: 'alias' }, { model: 'p1::x::m1' }, { providerId: 'other' }, { projectId: 'other' }])('rejects mismatched optional binding %j', async extra => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockResolvedValue(sketchTask());
    expect((await POST(ownRequest({ taskId: 'nonprefix-original', ...extra }))).status).toBe(400); expect(mocks.recoverExpiredSketchTask).not.toHaveBeenCalled();
  });
  it('unknown recovery remains active needsReconcile rather than failed/refunded', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockResolvedValue(sketchTask()); mocks.recoverExpiredSketchTask.mockResolvedValue({ status: 'deferred' });
    const response = await POST(ownRequest()); expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ status: 'processing', needsReconcile: true }); expect(mocks.getCloudTaskById).toHaveBeenCalledTimes(1);
  });
  it('DB uncertainty is safe503 and never reaches a generic provider', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockRejectedValue(new Error('SQL key secret'));
    const response = await POST(ownRequest()); expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/SQL|secret/); expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });
  it('completed projection uses current authorized refs and verified Token actual, not raw result', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockResolvedValue(sketchTask('completed'));
    const task = sketchTask('completed');
    const pricing = { mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14, tokenPricing: { input: 1, output: 1 } };
    ((task.result as Record<string, unknown>).sketchAdmission as Record<string, unknown>).pricing = pricing;
    mocks.getCloudTaskById.mockResolvedValue(task);
    mocks.readSketchDocument.mockResolvedValue({ taskId: 'nonprefix-original', projectId: 'project-a', html: 'AUTHORIZED_HTML', analysis: { summary: 'safe' }, previewAssetId: 'verified-preview', htmlAssetId: 'verified-html', previewAssetVersionId: 'pv', htmlAssetVersionId: 'hv', actualCredits: 1, reserveCredits: 14, providerId: 'p1', modelId: 'm1', pricing, documentUrl: '/api/sketch-to-code/nonprefix-original/document' });
    const response = await POST(ownRequest()); expect(response.status).toBe(200); const json = await response.json();
    expect(json).toMatchObject({ html: 'AUTHORIZED_HTML', previewAssetId: 'verified-preview', actualCredits: 1, reserveCredits: 14, refunded: false }); expect(JSON.stringify(json)).not.toContain('RAW_');
  });
  it('owner task identity does not give revoked document rights or leak refs', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockResolvedValue(sketchTask('completed')); mocks.readSketchDocument.mockRejectedValue(new Error('revoked'));
    const response = await POST(ownRequest()); expect(response.status).toBe(404); expect(await response.text()).not.toMatch(/RAW_|AssetId|html/);
  });
  it('recovery reread cannot silently rebind the original project/model/digest', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } });
    const changed = sketchTask(); changed.providerId = 'other';
    mocks.getCloudTaskById.mockResolvedValueOnce(sketchTask()).mockResolvedValue(changed);
    expect((await POST(ownRequest())).status).toBe(404); expect(mocks.readSketchDocument).not.toHaveBeenCalled(); expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });
  it.each(['trusted', 'wrong-binding', 'raw-sql', 'oversize'] as const)('terminal safe provider projection %s', async variant => {
    const t = sketchTask('failed'); t.creditStatus = 'refunded';
    const error = { code: 'SKETCH_PROVIDER_REJECTED', phase: 'analysis', requestId: 'req-safe', providerId: variant === 'wrong-binding' ? 'other' : 'p1', modelId: 'm1', providerStatus: 429, providerCode: 'quota', message: variant === 'oversize' ? 'x'.repeat(8193) : 'safe message' };
    t.error = variant === 'raw-sql' ? 'SQL password=secret' : JSON.stringify(error);
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.getCloudTaskById.mockResolvedValue(t);
    const response = await POST(ownRequest()); expect(response.status).toBe(200); const json = await response.json(); expect(json.refunded).toBe(true);
    expect(json.error).toEqual(variant === 'trusted' ? error : { code: 'SKETCH_EXECUTION_FAILED' }); expect(mocks.recoverExpiredSketchTask).not.toHaveBeenCalled();
  });
});
