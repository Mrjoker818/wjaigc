import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import { readSketchImageTaskIdentity } from '@/lib/sketch-to-code/image-task-state';
vi.mock('server-only', () => ({}));
const ports = vi.hoisted(() => ({ configured: vi.fn(), prepare: vi.fn(), recover: vi.fn(), publisher: vi.fn(), current: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/sketch-to-code/configured-image-dependencies', () => ({ createConfiguredSketchImageDependencies: ports.configured }));
vi.mock('@/lib/sketch-to-code/image-generation', async original => ({ ...await original<typeof import('@/lib/sketch-to-code/image-generation')>(), prepareSketchImage: ports.prepare }));
vi.mock('@/lib/sketch-to-code/image-worker', () => ({ recoverSketchImageTask: ports.recover }));
vi.mock('@/lib/sketch-to-code/image-publication', () => ({ publishSketchImageTask: ports.publisher }));
import { createConfiguredSketchImageService, recoverConfiguredSketchImageTask } from '@/lib/sketch-to-code/image-service';
const input = { projectId: 'project-a', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '木屋', visionProviderId: 'vision-p',
  visionModelId: 'vision-m', imageProviderId: 'image-p', imageModelId: 'image-m', idempotencyKey: 'nonce', aspectRatio: '4:3' };
const access = { kind: 'personal' as const, actorUserId: 'user-a', ownerId: 'user-a', projectId: 'project-a' };
const pricing = { version: 1, vision: { providerId: 'vision-p', modelId: 'vision-m', calls: 1, mode: 'flat', reserveCredits: 7 },
  image: { providerId: 'image-p', modelId: 'image-m', calls: 1, credits: 11 }, totalReserveCredits: 18 };
const routing = { vision: '1'.repeat(64), image: '2'.repeat(64) };
const generation = { authorizeProject: vi.fn(), resolveTaskModel: vi.fn(), analyze: vi.fn(), generate: vi.fn() };
const compute = vi.fn();
function task(): PersistedCloudTask {
  const requestDigest = sketchImageRequestDigest(input);
  return { id: 'skimg_original', type: 'sketch-to-image', userId: 'user-a', projectId: 'project-a', providerId: 'image-p', model: 'image-m',
    requestDigest, idempotencyKey: 'nonce', status: 'processing', progress: 70, creditStatus: 'pending', creditCost: 18, revision: 1,
    createdAt: 1, updatedAt: 1, attemptCount: 1, leaseOwner: '', leaseExpiresAt: 0,
    result: { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', requestDigest, input, access, pricing },
      sketchImageExecution: { version: 1, phase: 'accepted', routing, analysis: { summary: '木屋', composition: '左木屋', prompt: '海边', negativePrompt: '水印' },
        receipt: { taskIds: ['remote'], directImageUrls: [], usedModel: 'image-m', usedProviderId: 'image-p' } } } };
}
beforeEach(() => {
  Object.values(ports).forEach(mock => mock.mockReset()); Object.values(generation).forEach(mock => mock.mockReset()); compute.mockReset();
  ports.configured.mockReturnValue({ generation, routing: () => routing, checkCurrent: ports.current, query: ports.query });
  ports.prepare.mockResolvedValue({ input, access, visionBinding: { providerId: 'vision-p', modelId: 'vision-m' },
    imageBinding: { providerId: 'image-p', modelId: 'image-m' }, compute });
  ports.recover.mockResolvedValue({ status: 'completed' });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('configured durable image service wiring (controlled ports, no live SQL/provider)', () => {
  it('captures one per-task configured instance and the actual guarded worker ports', () => {
    const service = createConfiguredSketchImageService('request-a');
    expect(ports.configured).toHaveBeenCalledExactlyOnceWith({ requestId: 'request-a' });
    expect(service.generation).toBe(generation);
    expect(service.workerDependencies()).toEqual({ routing, checkCurrent: expect.any(Function), query: expect.any(Function), publisher: ports.publisher });
    expect(Object.isFrozen(service)).toBe(true); expect(Object.isFrozen(service.workerDependencies())).toBe(true);
  });
  it('current/query call the same captured configured instance, not a new model factory', async () => {
    const service = createConfiguredSketchImageService('request-a'), deps = service.workerDependencies();
    const identity = readSketchImageTaskIdentity(task()), signal = new AbortController().signal;
    await deps.checkCurrent!(identity, signal); await deps.query!('remote', identity, signal);
    expect(ports.current).toHaveBeenCalledWith(identity, signal); expect(ports.query).toHaveBeenCalledWith('remote', identity, signal);
    expect(ports.configured).toHaveBeenCalledTimes(1); expect(generation.generate).not.toHaveBeenCalled();
  });
  it('rebinds only the original accepted task and passes no compute closure into recovery', async () => {
    const original = task(); expect(await recoverConfiguredSketchImageTask(original, 'request-a')).toEqual({ status: 'completed' });
    expect(ports.prepare).toHaveBeenCalledWith(input, generation, { actorUserId: 'user-a', signal: expect.any(AbortSignal) });
    expect(ports.recover).toHaveBeenCalledExactlyOnceWith('skimg_original', readSketchImageTaskIdentity(original),
      { routing, checkCurrent: expect.any(Function), query: expect.any(Function), publisher: ports.publisher });
    expect(compute).not.toHaveBeenCalled(); expect(generation.analyze).not.toHaveBeenCalled(); expect(generation.generate).not.toHaveBeenCalled();
  });
  it.each(['absent', 'analysis', 'generation', 'malformed', 'completed', 'active-lease', 'wrong-actor'] as const)('does not bind or recover %s', async variant => {
    const original = task();
    if (variant === 'absent') delete original.result!.sketchImageExecution;
    if (variant === 'analysis') original.result!.sketchImageExecution = { version: 1, phase: 'analysis', routing };
    if (variant === 'generation') (original.result!.sketchImageExecution as Record<string, unknown>).phase = 'generation';
    if (variant === 'malformed') (original.result!.sketchImageExecution as Record<string, unknown>).routing = {};
    if (variant === 'completed') original.status = 'completed';
    if (variant === 'active-lease') { original.leaseOwner = 'other'; original.leaseExpiresAt = Date.now() + 600_000; }
    if (variant === 'wrong-actor') original.userId = 'other';
    expect((await recoverConfiguredSketchImageTask(original, 'request-a')).status).not.toBe('completed');
    expect(ports.prepare).not.toHaveBeenCalled(); expect(ports.configured).not.toHaveBeenCalled(); expect(ports.recover).not.toHaveBeenCalled();
  });
  it.each(['input', 'access', 'vision', 'image', 'routing'] as const)('does not recover changed prepared %s', async variant => {
    const prepared = await ports.prepare();
    if (variant === 'input') prepared.input = { ...input, instruction: 'other' };
    if (variant === 'access') prepared.access = { ...access, ownerId: 'other' };
    if (variant === 'vision') prepared.visionBinding = { providerId: 'other', modelId: 'vision-m' };
    if (variant === 'image') prepared.imageBinding = { providerId: 'image-p', modelId: 'other' };
    if (variant === 'routing') ports.configured.mockReturnValue({ generation, routing: () => ({ ...routing, image: '3'.repeat(64) }), checkCurrent: ports.current, query: ports.query });
    expect((await recoverConfiguredSketchImageTask(task(), 'request-a')).status).toBe('deferred'); expect(ports.recover).not.toHaveBeenCalled(); expect(compute).not.toHaveBeenCalled();
  });
  it('a prepare failure returns fixed deferred without retry or secret text', async () => {
    ports.prepare.mockRejectedValue(new Error('SQL-password-private-PNG'));
    const result = await recoverConfiguredSketchImageTask(task(), 'request-a');
    expect(result).toEqual({ status: 'deferred', reason: 'SKETCH_IMAGE_RECOVERY_UNCONFIRMED' }); expect(ports.prepare).toHaveBeenCalledTimes(1);
    expect(ports.recover).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toMatch(/SQL|private|password/);
  });
  it('caps an ignored-signal preparation and ignores its late success', async () => {
    vi.useFakeTimers(); let finish!: (value: unknown) => void;
    ports.prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const running = recoverConfiguredSketchImageTask(task(), 'request-a'); void running.catch(() => undefined); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000); expect((await running).status).toBe('deferred');
    finish({ input, access, compute }); await vi.advanceTimersByTimeAsync(0);
    expect(ports.recover).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
