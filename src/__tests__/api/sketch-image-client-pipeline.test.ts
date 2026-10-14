import { createCanvas } from '@napi-rs/canvas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import type { SketchImageTaskAdmission } from '@/lib/sketch-to-code/image-admission';
import type { SketchImageInput } from '@/lib/sketch-to-code/image-contract';
import type { SketchImageAuthorizedResult } from '@/lib/sketch-to-code/image-result';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { normalizeDurableTaskStatus } from '@/lib/task-core/task-state';
import { SketchImageClient } from '@/lib/sketch-to-code/image-client';

// Real ingress/routes/public projection/client are composed here. Only durable
// database/worker/permission ports and managed bytes are controlled fixtures.
// This does not claim PostgreSQL, provider, browser or billing acceptance.
vi.mock('server-only', () => ({}));
const ports = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), after: vi.fn(), admit: vi.fn(), service: vi.fn(),
  execute: vi.fn(), task: vi.fn(), read: vi.fn(), transaction: vi.fn(), abort: vi.fn(), memoryCancel: vi.fn(), update: vi.fn(),
  genericRefund: vi.fn(), genericCancel: vi.fn(), normalize: vi.fn(), provider: vi.fn(), registry: vi.fn() }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: ports.after }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: ports.auth, getRequestUser: ports.user,
  getInternalRequestHeaders: vi.fn(), getTrustedRequestAgentExecutionFence: vi.fn() }));
vi.mock('@/lib/sketch-to-code/image-admission', async original => ({
  ...await original<typeof import('@/lib/sketch-to-code/image-admission')>(), admitSketchImageTask: ports.admit,
}));
vi.mock('@/lib/sketch-to-code/image-service', () => ({ createConfiguredSketchImageService: ports.service }));
vi.mock('@/lib/sketch-to-code/image-worker', () => ({ executeSketchImageTask: ports.execute }));
vi.mock('@/lib/cloud-task-storage', async original => ({ ...await original<typeof import('@/lib/cloud-task-storage')>(),
  getCloudTaskById: ports.task, refundCloudTaskCredits: ports.genericRefund, terminateCloudTaskAndRefund: ports.genericCancel }));
vi.mock('@/lib/sketch-to-code/image-result', () => ({ readSketchImageResult: ports.read }));
vi.mock('@/lib/sketch-to-code/image-task-http', () => ({ cancelSketchImageTransaction: ports.transaction }));
vi.mock('@/lib/task-registry', async original => ({ ...await original<typeof import('@/lib/task-registry')>(),
  getTaskInfo: ports.registry, abortTaskExecution: ports.abort, cancelTask: ports.memoryCancel, updateTaskProgress: ports.update }));
vi.mock('@/lib/server-api-config', () => ({ findProviderForModel: ports.provider, findProviderById: ports.provider,
  normalizeApiBaseUrl: (value: string): string => value }));
vi.mock('@/lib/model-capabilities', () => ({ normalizeModelForApi: ports.normalize }));
import { POST as startRoute } from '@/app/api/sketch-to-image/route';
import { POST as pollRoute } from '@/app/api/poll-task/route';
import { POST as cancelRoute } from '@/app/api/cancel-task/route';

const input: SketchImageInput = { projectId: 'pipeline-project', imageDataUrl: createCanvas(3, 2).toDataURL('image/png'),
  instruction: '水彩木屋', visionProviderId: 'vision-p', visionModelId: '视觉/模型', imageProviderId: 'image-p',
  imageModelId: '图像/模型', idempotencyKey: 'pipeline-nonce', aspectRatio: '4:3' };
const actor = 'pipeline-owner', taskId = 'original-pipeline-task';
const pricing = { version: 1 as const, vision: { providerId: input.visionProviderId, modelId: input.visionModelId,
  calls: 1 as const, mode: 'flat' as const, reserveCredits: 7 },
image: { providerId: input.imageProviderId, modelId: input.imageModelId, calls: 1 as const, credits: 11 }, totalReserveCredits: 18 };
const access = { kind: 'personal' as const, actorUserId: actor, projectId: input.projectId, ownerId: actor };
let row: PersistedCloudTask, authorized: SketchImageAuthorizedResult;
let current: boolean, admissionSeen: boolean, lostStartAck: boolean, unknownCancel: boolean;
let requests: Array<{ url: string; body: unknown; credentials: RequestCredentials | undefined }>;

function fetcher(): typeof fetch {
  return async (url, init): Promise<Response> => {
    const pathname = String(url), body: unknown = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
    requests.push({ url: pathname, body, credentials: init?.credentials });
    if (pathname.startsWith('/api/serve-upload/')) {
      expect(pathname).toBe(authorized.imageUrl);
      const bytes = Buffer.from(input.imageDataUrl.split(',')[1], 'base64');
      return new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
    }
    const request = new NextRequest(`http://localhost${pathname}`, { ...init, signal: init?.signal ?? undefined });
    const route = pathname === '/api/sketch-to-image' ? startRoute : pathname === '/api/poll-task' ? pollRoute
      : pathname === '/api/cancel-task' ? cancelRoute : undefined;
    if (!route) throw new Error('Unexpected fixture endpoint');
    const response = await route(request);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const publicBody = await response.clone().text();
    expect(publicBody).not.toMatch(/imageDataUrl|requestDigest|idempotencyKey|grantGeneration|private-secret|remoteTaskId|sketchImageAdmission/);
    if (pathname === '/api/sketch-to-image' && lostStartAck) { lostStartAck = false; throw new Error('lost admission ACK'); }
    return response;
  };
}
function client(): SketchImageClient {
  return new SketchImageClient({ actorId: actor, projectId: input.projectId, key: 'pipeline-scope', authority: 'legacy',
    assertCurrent: (): void => { if (!current) throw new Error('scope withdrawn'); } }, fetcher());
}
function complete(actualCredits = 18): void {
  row.status = 'completed'; row.progress = 100; row.creditStatus = 'charged'; authorized = { ...authorized, actualCredits };
}
beforeEach(() => {
  Object.values(ports).forEach(port => port.mockReset());
  current = true; admissionSeen = false; lostStartAck = false; unknownCancel = false; requests = [];
  const digest = sketchImageRequestDigest(input);
  row = { id: taskId, type: 'sketch-to-image', userId: actor, projectId: input.projectId,
    providerId: input.imageProviderId, model: input.imageModelId, status: 'processing', progress: 0,
    creditCost: 18, creditStatus: 'pending', chargedTransactionId: createTaskBillingTransactionId('charge', taskId),
    idempotencyKey: input.idempotencyKey, requestDigest: digest, revision: 1, createdAt: 1, updatedAt: 1,
    result: { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', requestDigest: digest, input, access, pricing },
      privateExtra: 'private-secret' } };
  authorized = { taskId, projectId: input.projectId, visionProviderId: input.visionProviderId, visionModelId: input.visionModelId,
    imageProviderId: input.imageProviderId, imageModelId: input.imageModelId, pricing, reserveCredits: 18, actualCredits: 18,
    previewAssetId: 'source-asset', previewAssetVersionId: 'source-version', imageAssetId: 'generated-asset', imageAssetVersionId: 'generated-version',
    previewUrl: '/api/serve-upload/pipeline-source.png', imageUrl: '/api/serve-upload/pipeline-generated.png',
    analysis: { summary: '木屋', composition: '左侧', prompt: '水彩木屋', negativePrompt: '水印' } };
  ports.auth.mockResolvedValue({ user: { id: actor, role: 'user' } }); ports.user.mockResolvedValue({ user: { id: actor, role: 'user' } });
  ports.task.mockImplementation(async (): Promise<PersistedCloudTask> => structuredClone(row));
  ports.read.mockImplementation(async (): Promise<SketchImageAuthorizedResult> => structuredClone(authorized));
  ports.service.mockReturnValue({ generation: {}, workerDependencies: (): object => ({}) });
  ports.execute.mockResolvedValue({ status: 'deferred' });
  ports.admit.mockImplementation(async (value: SketchImageInput): Promise<SketchImageTaskAdmission> => {
    expect(value).toEqual(input); const reused = admissionSeen; admissionSeen = true;
    return { task: { ...structuredClone(row), status: normalizeDurableTaskStatus(row.status), revision: 1 }, reused, charged: !reused,
      ...(!reused ? { prepared: { input, access, visionBinding: { providerId: input.visionProviderId, modelId: input.visionModelId },
        imageBinding: { providerId: input.imageProviderId, modelId: input.imageModelId }, compute: vi.fn() } } : {}) };
  });
  ports.transaction.mockImplementation(async (): Promise<{ cancelled: boolean; refunded: boolean }> => {
    if (unknownCancel) throw new Error('unknown transaction ACK');
    row.status = 'cancelled'; row.progress = 0; row.creditStatus = 'refunded';
    row.refundedTransactionId = createTaskBillingTransactionId('refund', taskId);
    return { cancelled: true, refunded: true };
  });
});

describe('real image client composed with ingress, persisted-type dispatch and public HTTP projection', () => {
  it('consumes explicit dual bindings and protects generated bytes with a fresh completed read', async () => {
    const c = client(); const pending = await c.start(input);
    expect(pending).toMatchObject({ taskId, status: 'processing', reserveCredits: 18, visionModelId: '视觉/模型', imageModelId: '图像/模型' });
    expect(ports.after).toHaveBeenCalledTimes(1); await ports.after.mock.calls[0][0](); expect(ports.execute).toHaveBeenCalledTimes(1);
    complete(); const result = await c.poll(taskId); expect(result.imageAssetVersionId).toBe('generated-version');
    const blob = await c.image(taskId); expect(blob.type).toBe('image/png'); expect(blob.size).toBeGreaterThan(8);
    expect(ports.read).toHaveBeenCalledTimes(2); expect(ports.read).toHaveBeenLastCalledWith({ actorUserId: actor, projectId: input.projectId, taskId });
    expect(requests.map(r => r.url)).toEqual(['/api/sketch-to-image', '/api/poll-task', '/api/poll-task', authorized.imageUrl]);
    expect(ports.normalize).not.toHaveBeenCalled(); expect(ports.provider).not.toHaveBeenCalled(); expect(ports.genericRefund).not.toHaveBeenCalled();
  });
  it.each([12, 27])('accepts real public completed projection with legal actual fee %i', async actual => {
    const c = client(); await c.start(input); complete(actual);
    expect(await c.poll(taskId)).toMatchObject({ actualCredits: actual, reserveCredits: 18, status: 'completed' });
  });
  it('completed nonce replay exposes no cached result until the original protected reader confirms it', async () => {
    complete(); admissionSeen = true; const c = client(); const result = await c.start(input);
    expect(result).toMatchObject({ status: 'completed', imageAssetVersionId: 'generated-version' });
    expect(requests.map(r => r.url)).toEqual(['/api/sketch-to-image', '/api/poll-task']);
    expect(ports.after).not.toHaveBeenCalled(); expect(ports.execute).not.toHaveBeenCalled(); expect(ports.read).toHaveBeenCalledTimes(1);
  });
  it('lost admission ACK permits only the unchanged original nonce and then resumes through polling', async () => {
    lostStartAck = true; const c = client(); await expect(c.start(input)).rejects.toThrow(); expect(c.admissionUnknown).toBe(true);
    await expect(c.start({ ...input, instruction: 'changed' }, true)).rejects.toThrow(); expect(ports.admit).toHaveBeenCalledTimes(1);
    expect(await c.start(input, true)).toMatchObject({ taskId, status: 'processing' });
    expect(ports.admit).toHaveBeenCalledTimes(2); expect(ports.after).toHaveBeenCalledTimes(1);
    complete(); expect(await c.start(input, true)).toMatchObject({ status: 'completed' });
    expect(ports.admit).toHaveBeenCalledTimes(2); expect(requests.at(-1)?.url).toBe('/api/poll-task');
  });
  it('real cancellation ACK precedes memory projection and client terminal state', async () => {
    const c = client(); await c.start(input); expect(await c.cancel(taskId)).toMatchObject({ status: 'cancelled', refunded: true });
    expect(ports.transaction).toHaveBeenCalledTimes(1); expect(ports.abort).toHaveBeenCalledExactlyOnceWith(taskId);
    expect(ports.memoryCancel).toHaveBeenCalledExactlyOnceWith(taskId); expect(ports.genericCancel).not.toHaveBeenCalled();
  });
  it('unknown cancellation cannot publish cancelled or refund or change the original task binding', async () => {
    const c = client(); await c.start(input); unknownCancel = true; await expect(c.cancel(taskId)).rejects.toThrow();
    expect(c.task).toMatchObject({ taskId, status: 'processing' }); expect(c.task?.refunded).toBeUndefined();
    expect(ports.abort).not.toHaveBeenCalled(); expect(ports.memoryCancel).not.toHaveBeenCalled(); expect(ports.genericRefund).not.toHaveBeenCalled();
    expect(ports.transaction).toHaveBeenCalledTimes(1);
  });
  it('completed cancellation conflict consumes only the protected original winner', async () => {
    const c = client(); await c.start(input); complete(); expect(await c.cancel(taskId)).toMatchObject({ status: 'completed', imageAssetVersionId: 'generated-version' });
    expect(requests.slice(-2).map(r => r.url)).toEqual(['/api/cancel-task', '/api/poll-task']); expect(ports.transaction).not.toHaveBeenCalled();
    expect(ports.read).toHaveBeenCalledTimes(1); expect(ports.abort).not.toHaveBeenCalled();
  });
  it('withdrawn scope prevents a protected result or byte request despite a prior completed result', async () => {
    const c = client(); await c.start(input); complete(); await c.poll(taskId); current = false;
    await expect(c.image(taskId)).rejects.toThrow(); expect(requests).toHaveLength(2); expect(ports.read).toHaveBeenCalledTimes(1);
  });
  it('another administrator cannot recover an original image result via old provider/cache paths', async () => {
    const c = client(); await c.start(input); complete(); ports.user.mockResolvedValue({ user: { id: 'another-admin', role: 'admin' } });
    await expect(c.poll(taskId)).rejects.toThrow(); expect(c.task?.status).toBe('processing'); expect(ports.read).not.toHaveBeenCalled();
    expect(ports.registry).not.toHaveBeenCalled(); expect(ports.provider).not.toHaveBeenCalled();
  });
});
