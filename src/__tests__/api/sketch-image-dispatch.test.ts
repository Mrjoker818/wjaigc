import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('server-only', () => ({}));
const ports = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), task: vi.fn(), poll: vi.fn(), cancel: vi.fn(), normalize: vi.fn(), provider: vi.fn(), registry: vi.fn(),
  genericCancel: vi.fn(), genericRefund: vi.fn(), fetch: vi.fn() }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: ports.auth, getRequestUser: ports.user, getInternalRequestHeaders: vi.fn(), getTrustedRequestAgentExecutionFence: vi.fn() }));
vi.mock('@/lib/cloud-task-storage', () => ({ getCloudTaskById: ports.task, getCloudTaskForUser: vi.fn(), claimCloudTaskLease: vi.fn(), completeCloudTask: vi.fn(),
  refundCloudTaskCredits: ports.genericRefund, terminateCloudTaskAndRefund: ports.genericCancel, updateCloudTask: vi.fn(), releaseCloudTaskLease: vi.fn(), renewCloudTaskLease: vi.fn(), deferCloudTaskRecovery: vi.fn() }));
vi.mock('@/lib/task-registry', () => ({ getTaskInfo: ports.registry, isTaskCancelled: vi.fn(), registerTask: vi.fn(), updateTaskProgress: vi.fn(),
  abortTaskExecution: vi.fn(), cancelTask: vi.fn(), registerTaskAbortController: vi.fn(), unregisterTaskAbortController: vi.fn(), releaseQueueSlot: vi.fn() }));
vi.mock('@/lib/server-api-config', () => ({ findProviderForModel: ports.provider, findProviderById: ports.provider, normalizeApiBaseUrl: (value: string): string => value }));
vi.mock('@/lib/model-capabilities', () => ({ normalizeModelForApi: ports.normalize }));
vi.mock('@/lib/cloud-task-persistence', () => ({ buildRecoveredTaskContext: vi.fn(), recordImageTaskTerminal: vi.fn(), recordVideoTaskTerminal: vi.fn(), projectPersistedCompletedTask: vi.fn(), recordCloudTaskCancelled: vi.fn() }));
vi.mock('@/lib/sketch-to-code/image-public-http', () => ({ pollSketchImageTask: ports.poll, cancelSketchImageTask: ports.cancel }));
vi.mock('@/lib/edit-task-store', async original => ({ ...await original<typeof import('@/lib/edit-task-store')>(), cancelEditTask: vi.fn() }));
import { POST as poll } from '@/app/api/poll-task/route';
import { POST as cancel } from '@/app/api/cancel-task/route';
function request(taskId = 'original-nonprefix'): NextRequest {
  return new NextRequest('http://localhost/api/task', { method: 'POST', body: JSON.stringify({ taskId }), headers: { 'content-type': 'application/json' } });
}
beforeEach(() => {
  Object.values(ports).forEach(mock => mock.mockReset());
  ports.auth.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } }); ports.user.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } });
  ports.task.mockResolvedValue({ id: 'original-nonprefix', type: 'sketch-to-image', userId: 'owner-a', result: { privatePng: 'private-source' } });
  ports.poll.mockResolvedValue(NextResponse.json({ success: true, type: 'sketch-to-image' }, { status: 202 }));
  ports.cancel.mockImplementation(async (_body: unknown, candidate: { userId?: string } | null, actor: string) =>
    NextResponse.json({ success: candidate?.userId === actor }, { status: candidate?.userId === actor ? 200 : 404 }));
  ports.normalize.mockImplementation((model: string) => ({ apiModelName: model, wasNormalized: false })); ports.provider.mockResolvedValue(null);
});
describe('persisted image type dispatch precedes old aliases/cache/provider/finance', () => {
  it.each(['poll', 'cancel'] as const)('routes nonprefix %s to only the guarded image helper', async kind => {
    const response = await (kind === 'poll' ? poll : cancel)(request()); expect(response.status).toBe(kind === 'poll' ? 202 : 200);
    expect(kind === 'poll' ? ports.poll : ports.cancel).toHaveBeenCalledExactlyOnceWith({ taskId: 'original-nonprefix' },
      expect.objectContaining({ type: 'sketch-to-image' }), 'owner-a', expect.any(String));
    expect(ports.normalize).not.toHaveBeenCalled(); expect(ports.provider).not.toHaveBeenCalled(); expect(ports.registry).not.toHaveBeenCalled();
    expect(ports.genericCancel).not.toHaveBeenCalled(); expect(ports.genericRefund).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('private-source');
  });
  it.each(['nonprefix', 'prefix'] as const)('rejects anonymous image %s before generic work', async kind => {
    ports.user.mockResolvedValue(null); const id = kind === 'prefix' ? 'skimg_unknown' : 'original-nonprefix';
    const response = await poll(request(id)); expect(response.status).toBe(401); expect(ports.poll).not.toHaveBeenCalled();
    expect(ports.normalize).not.toHaveBeenCalled(); expect(ports.provider).not.toHaveBeenCalled();
  });
  it('another admin cannot poll the original image task via generic alias/cache', async () => {
    ports.user.mockResolvedValue({ user: { id: 'admin-b', role: 'admin' } }); const response = await poll(request());
    expect(response.status).toBe(404); expect(ports.poll).not.toHaveBeenCalled(); expect(ports.registry).not.toHaveBeenCalled(); expect(ports.provider).not.toHaveBeenCalled();
  });
  it('another admin cancellation still enters owner-only helper, never generic admin bypass', async () => {
    ports.auth.mockResolvedValue({ user: { id: 'admin-b', role: 'admin' } }); const response = await cancel(request());
    expect(response.status).toBe(404); expect(ports.cancel).toHaveBeenCalledTimes(1); expect(ports.registry).not.toHaveBeenCalled(); expect(ports.genericCancel).not.toHaveBeenCalled();
  });
  it('unknown skimg prefix cannot fall into generic provider polling', async () => {
    ports.task.mockResolvedValue(null); const response = await poll(request('skimg_unknown'));
    expect(response.status).toBe(404); expect(ports.poll).not.toHaveBeenCalled(); expect(ports.normalize).not.toHaveBeenCalled(); expect(ports.provider).not.toHaveBeenCalled();
  });
  it.each(['poll', 'cancel'] as const)('lookup failure for %s never authorizes a cached task', async kind => {
    ports.task.mockRejectedValue(new Error('SQL-secret')); const response = await (kind === 'poll' ? poll : cancel)(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('SQL-secret'); expect(ports.registry).not.toHaveBeenCalled(); expect(ports.provider).not.toHaveBeenCalled();
  });
});
