import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { SketchImageTaskAdmission } from '@/lib/sketch-to-code/image-admission';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import { SketchAdmissionError } from '@/lib/sketch-to-code/admission';
import { InsufficientCreditsError } from '@/lib/credits';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import { GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-data-root', () => {
  const root = `${process.cwd()}/.superpowers/sdd/2026-10-09-sketch-to-code/runtime-observation-owned`;
  const denied = (): never => { throw new Error('OBSERVATION_DEFAULT_FILE_PORT_FORBIDDEN'); };
  return { getServerDataRoot: (): string => root, getServerSystemDir: (): string => `${root}/system`,
    getServerUsersDir: (): string => `${root}/users`, isServerDataRootDurable: (): boolean => false,
    migrateLocalDataIfNeeded: denied, saveImageFile: denied, deleteImageFile: denied,
    getImageWriteDir: denied, filePathToPublicUrl: denied };
});
const mocks = vi.hoisted(() => ({ auth: vi.fn(), after: vi.fn(), admit: vi.fn(), service: vi.fn(), worker: vi.fn(), execute: vi.fn() }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.auth }));
vi.mock('@/lib/sketch-to-code/image-admission', async original => ({ ...await original<typeof import('@/lib/sketch-to-code/image-admission')>(), admitSketchImageTask: mocks.admit }));
vi.mock('@/lib/sketch-to-code/image-service', () => ({ createConfiguredSketchImageService: mocks.service }));
vi.mock('@/lib/sketch-to-code/image-worker', () => ({ executeSketchImageTask: mocks.execute }));
import { POST, runtime, dynamic, maxDuration } from '@/app/api/sketch-to-image/route';
const input = { projectId: 'project-a', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '木屋', visionProviderId: 'vision-p',
  visionModelId: 'vision-m', imageProviderId: 'image-p', imageModelId: 'image-m', idempotencyKey: 'nonce', aspectRatio: '4:3' };
const access = { kind: 'personal' as const, actorUserId: 'user-a', projectId: 'project-a', ownerId: 'user-a' };
const pricing = { version: 1 as const, vision: { providerId: 'vision-p', modelId: 'vision-m', calls: 1 as const, mode: 'flat' as const, reserveCredits: 7 },
  image: { providerId: 'image-p', modelId: 'image-m', calls: 1 as const, credits: 11 }, totalReserveCredits: 18 };
const dependencies = { routing: { vision: '1'.repeat(64), image: '2'.repeat(64) }, checkCurrent: vi.fn(), query: vi.fn(), publisher: vi.fn() };
const generation = { authorizeProject: vi.fn(), resolveTaskModel: vi.fn(), analyze: vi.fn(), generate: vi.fn() };
function admission(reused = false): SketchImageTaskAdmission {
  const requestDigest = sketchImageRequestDigest(input);
  return { reused, charged: !reused, task: { id: 'skimg_original', type: 'sketch-to-image', userId: 'user-a', projectId: 'project-a', providerId: 'image-p', model: 'image-m',
    requestDigest, idempotencyKey: 'nonce', status: 'processing', progress: 0, creditCost: 18, creditStatus: 'pending', revision: 1, createdAt: 1, updatedAt: 1,
    result: { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', requestDigest, input, access, pricing }, internalSecret: 'private-secret' } } as SketchImageTaskAdmission['task'] & { requestDigest: string },
    ...(!reused ? { prepared: { input, access, visionBinding: { providerId: 'vision-p', modelId: 'vision-m' }, imageBinding: { providerId: 'image-p', modelId: 'image-m' }, compute: vi.fn() } } : {}) };
}
function request(body: unknown = input, signal?: AbortSignal): NextRequest {
  return new NextRequest('http://localhost/api/sketch-to-image', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, signal });
}
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset()); mocks.auth.mockResolvedValue({ user: { id: 'user-a', role: 'user' } });
  mocks.service.mockReturnValue({ generation, workerDependencies: mocks.worker }); mocks.worker.mockReturnValue(dependencies); mocks.admit.mockResolvedValue(admission());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('image start API with original bounded ingress and controlled durable ports', () => {
  it('records an actual deferred image worker return without serializing its private admission', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.execute.mockResolvedValue({ status: 'deferred', reason: 'SKETCH_IMAGE_TASK_UNAVAILABLE', privateField: 'worker-private-field' });
    await POST(request()); await mocks.after.mock.calls[0][0]();
    expect(mocks.execute).toHaveBeenCalledTimes(1); expect(mocks.admit).toHaveBeenCalledTimes(1);
    const rows = log.mock.calls.filter(call => call[0] === '[SketchRuntime]').map(call => JSON.parse(String(call[1])));
    expect(rows).toEqual([
      expect.objectContaining({ event: 'worker-start', phase: 'image-worker', taskId: 'skimg_original' }),
      expect.objectContaining({ event: 'worker-return', phase: 'image-worker', taskId: 'skimg_original', status: 'deferred' }),
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/worker-private-field|private-secret|imageDataUrl|instruction|nonce|access|lease|digest/);
  });
  it('runs on bounded Node/after without changing the old code route', () => {
    expect(runtime).toBe('nodejs'); expect(dynamic).toBe('force-dynamic'); expect(maxDuration).toBeGreaterThanOrEqual(600);
  });
  it('rejects auth before reading or configuring models and returns no-store', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'secret' }, { status: 401 })); const incoming = request(), read = vi.spyOn(incoming.body!, 'getReader');
    const response = await POST(incoming); expect(response.status).toBe(401); expect(read).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.admit).not.toHaveBeenCalled(); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(await response.text()).not.toContain('secret');
  });
  it('admits only the real dual bindings and schedules the same original parent once', async () => {
    const accepted = admission(), controller = new AbortController(); mocks.admit.mockResolvedValue(accepted);
    const response = await POST(request(input, controller.signal)), json = await response.json();
    expect(response.status).toBe(202); expect(json).toMatchObject({ success: true, taskId: 'skimg_original', type: 'sketch-to-image', projectId: 'project-a',
      visionProviderId: 'vision-p', visionModelId: 'vision-m', imageProviderId: 'image-p', imageModelId: 'image-m', reserveCredits: 18, pricing, charged: true, reused: false });
    expect(JSON.stringify(json)).not.toMatch(/private-secret|imageDataUrl|instruction|grantGeneration|requestDigest|idempotencyKey|lease|usage|actualCredits/);
    expect(mocks.admit).toHaveBeenCalledWith(input, { actorUserId: 'user-a', signal: expect.any(AbortSignal) }, { generation });
    expect(mocks.after).toHaveBeenCalledTimes(1); controller.abort(); await mocks.after.mock.calls[0][0]();
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(accepted, { actorUserId: 'user-a', projectId: 'project-a' }, dependencies);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('completed replay does not request routing or dispatch a new paid attempt', async () => {
    const accepted = admission(true); accepted.task.status = 'completed'; accepted.task.creditStatus = 'charged'; mocks.admit.mockResolvedValue(accepted);
    const response = await POST(request()); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ reused: true, charged: false });
    expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(['after', 'prepared', 'routing'] as const)('dispatch %s uncertainty returns original parent pending, without re-admission', async variant => {
    if (variant === 'after') mocks.after.mockImplementation(() => { throw new Error('secret-dispatch'); });
    if (variant === 'routing') mocks.worker.mockImplementation(() => { throw new Error('secret-routing'); });
    if (variant === 'prepared') { const accepted = admission(); delete accepted.prepared; mocks.admit.mockResolvedValue(accepted); }
    const response = await POST(request()); expect(response.status).toBe(202); expect(await response.json()).toHaveProperty('dispatchPending', true);
    expect(mocks.admit).toHaveBeenCalledTimes(1); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('an unknown worker result is consumed without rePOST or refund', async () => {
    mocks.execute.mockRejectedValue(new Error('private unknown outcome')); await POST(request());
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined(); expect(mocks.execute).toHaveBeenCalledTimes(1); expect(mocks.admit).toHaveBeenCalledTimes(1);
  });
  it.each(['apiKey', 'userId', 'price', 'result', 'providerId', 'modelId', 'usage'])('rejects browser %s before admission', async field => {
    const response = await POST(request({ ...input, [field]: 'spoof' })); expect(response.status).toBe(400); expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.admit).not.toHaveBeenCalled();
  });
  it.each(['png', 'nonce', 'keyword-control'] as const)('rejects invalid source %s before configuration or charge', async variant => {
    const body = { ...input, ...(variant === 'png' ? { imageDataUrl: 'data:image/png;base64,bm90IGEgcG5n' } : variant === 'nonce' ? { idempotencyKey: '' } : { instruction: 'bad\u0000text' }) };
    const response = await POST(request(body)); expect(response.status).toBe(400); expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.admit).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it.each(['abort', 'deadline'] as const)('late ingress after %s never enters admission', async variant => {
    vi.useFakeTimers(); const controller = new AbortController(), incoming = request(input, controller.signal); let finish!: (value: ReadableStreamReadResult<Uint8Array>) => void;
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    vi.spyOn(incoming.body!, 'getReader').mockReturnValue({ read: () => new Promise(resolve => { finish = resolve; }), cancel, releaseLock: vi.fn() } as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    const running = POST(incoming); await vi.advanceTimersByTimeAsync(0);
    if (variant === 'abort') controller.abort(); else await vi.advanceTimersByTimeAsync(10_000);
    const response = await running; expect(response.status).toBe(variant === 'abort' ? 400 : 408);
    finish({ done: false, value: Buffer.from(JSON.stringify(input)) }); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.service).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    [new InsufficientCreditsError('user-a', 18, 2), 402],
    [new IdempotencyConflictError({ userId: 'user-a', idempotencyKey: 'nonce', requestDigest: 'a'.repeat(64), existingDigest: 'b'.repeat(64) }), 409],
    [new GenerationProjectAccessError('GENERATION_PROJECT_FORBIDDEN'), 403],
    [new SketchAdmissionError('SKETCH_IMAGE_PRICING_INVALID', 503), 503],
    [new SketchAdmissionError('SKETCH_PROJECT_CHANGED', 403), 403],
    [Object.assign(new Error('SQL password=secret'), { status: 422, code: 'MODEL_NOT_AUTHORIZED' }), 503],
  ])('maps only trusted error classes without raw text: %s', async (error, status) => {
    mocks.admit.mockRejectedValue(error); const response = await POST(request()); expect(response.status).toBe(status);
    expect(await response.text()).not.toMatch(/password|SQL|secret/); expect(mocks.after).not.toHaveBeenCalled();
  });
});
