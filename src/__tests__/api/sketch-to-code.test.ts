import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { SketchInputError } from '@/lib/sketch-to-code/generation';
import type { SketchTaskAdmission } from '@/lib/sketch-to-code/admission';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-data-root', () => {
  const root = `${process.cwd()}/.superpowers/sdd/2026-10-09-sketch-to-code/runtime-observation-owned`;
  const denied = (): never => { throw new Error('OBSERVATION_DEFAULT_FILE_PORT_FORBIDDEN'); };
  return { getServerDataRoot: (): string => root, getServerSystemDir: (): string => `${root}/system`,
    getServerUsersDir: (): string => `${root}/users`, isServerDataRootDurable: (): boolean => false,
    migrateLocalDataIfNeeded: denied, saveImageFile: denied, deleteImageFile: denied,
    getImageWriteDir: denied, filePathToPublicUrl: denied };
});
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admit: vi.fn(), after: vi.fn(), execute: vi.fn(), publish: vi.fn(), resolve: vi.fn(), authorize: vi.fn(), provider: vi.fn() }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.auth }));
vi.mock('@/lib/sketch-to-code/admission', async original => ({ ...await original<typeof import('@/lib/sketch-to-code/admission')>(), admitSketchTask: mocks.admit }));
vi.mock('@/lib/sketch-to-code/execution', () => ({ executeSketchTask: mocks.execute }));
vi.mock('@/lib/sketch-to-code/publication', () => ({ publishSketchTask: mocks.publish }));
vi.mock('@/lib/task-core/model-catalog', () => ({ resolveTaskModel: mocks.resolve }));
vi.mock('@/lib/server-api-config', () => ({ findProviderById: mocks.provider }));
vi.mock('@/lib/collaboration/generation-project-access', async original => ({ ...await original<typeof import('@/lib/collaboration/generation-project-access')>(), authorizeGenerationProject: mocks.authorize }));
import { POST, runtime, dynamic, maxDuration } from '@/app/api/sketch-to-code/route';
import { SketchAdmissionError } from '@/lib/sketch-to-code/admission';
import { GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import { InsufficientCreditsError } from '@/lib/credits';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
const input = { projectId: 'project-a', imageDataUrl: 'private-PNG', instruction: 'private-instruction', providerId: 'p1', modelId: 'm1', idempotencyKey: 'nonce' };
function admission(reused = false): SketchTaskAdmission {
  return { reused, charged: !reused, task: { id: 'sketch_original', userId: 'u1', projectId: 'project-a', type: 'sketch-to-code', status: 'processing', progress: 0,
    providerId: 'p1', model: 'm1', requestDigest: 'a'.repeat(64), idempotencyKey: 'nonce', creditCost: 14, creditStatus: 'pending', revision: 0, createdAt: 1, updatedAt: 1,
    result: { sketchAdmission: { version: 1, route: '/api/sketch-to-code', requestDigest: 'a'.repeat(64), access: { kind: 'personal', actorUserId: 'u1', ownerId: 'u1', projectId: 'project-a' }, pricing: { calls: 2, perCallCredits: 7, totalCredits: 14 } }, html: 'RAW_SECRET_HTML' } } as SketchTaskAdmission['task'] & { requestDigest: string },
    ...(!reused ? { prepared: { input, access: { kind: 'personal' as const, actorUserId: 'u1', ownerId: 'u1', projectId: 'project-a' }, binding: { providerId: 'p1', modelId: 'm1' }, compute: async () => { throw new Error('not here'); } } } : {}) };
}
function request(signal?: AbortSignal, body: unknown = input): NextRequest {
  return new NextRequest('http://localhost/api/sketch-to-code', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, signal });
}
beforeEach(() => { Object.values(mocks).forEach(m => m.mockReset()); mocks.auth.mockResolvedValue({ user: { id: 'u1', role: 'user' } }); mocks.admit.mockResolvedValue(admission()); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('real preparation through the HTTP start route', () => {
  it.each(['model', 'png', 'project', 'nonce', 'decodePNG'] as const)('rejects %s without dispatch or provider HTTP', async variant => {
    const original = await vi.importActual<typeof import('@/lib/sketch-to-code/admission')>('@/lib/sketch-to-code/admission');
    mocks.admit.mockImplementation(original.admitSketchTask);
    mocks.authorize.mockResolvedValue({ kind: 'personal', actorUserId: 'u1', ownerId: 'u1', projectId: 'project-a' });
    mocks.resolve.mockResolvedValue({ providerId: 'p1', modelId: 'm1', kind: variant === 'model' ? 'image' : 'chat', supportsVision: true, protocol: 'chat-completions', executionMode: 'sync' });
    mocks.provider.mockResolvedValue({ id: 'p1', apiKey: 'server-secret', baseUrl: 'https://fixture.invalid', isEnabled: true });
    if (variant === 'project') mocks.authorize.mockRejectedValue(new GenerationProjectAccessError('GENERATION_PROJECT_FORBIDDEN'));
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_PROVIDER_HTTP'));
    try {
      const response = await POST(request(undefined, { ...input, ...(variant === 'nonce' ? { idempotencyKey: '' } : {}), ...(variant === 'decodePNG' ? { imageDataUrl: 'data:image/png;base64,bm90IGEgcG5n' } : {}) }));
      expect(response.status).toBe(variant === 'project' ? 403 : variant === 'nonce' ? 400 : 422);
      expect(fetch).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
describe('formal sketch start HTTP ports (not live SQL/provider)', () => {
  it.each(['completed', 'deferred', 'timeout'] as const)('records the actual %s worker return without exposing admission material', async status => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.execute.mockResolvedValue({ status, reason: status === 'deferred' ? 'SKETCH_TASK_UNAVAILABLE' : undefined,
      privateField: 'worker-private-field' });
    const response = await POST(request()); await mocks.after.mock.calls[0][0]();
    expect(response.status).toBe(202); expect(mocks.execute).toHaveBeenCalledTimes(1); expect(mocks.admit).toHaveBeenCalledTimes(1);
    const rows = log.mock.calls.filter(call => call[0] === '[SketchRuntime]').map(call => JSON.parse(String(call[1])));
    expect(rows).toEqual([
      expect.objectContaining({ event: 'worker-start', phase: 'code-worker', taskId: 'sketch_original' }),
      expect.objectContaining({ event: 'worker-return', phase: 'code-worker', taskId: 'sketch_original', status }),
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/worker-private-field|private-PNG|private-instruction|RAW_SECRET_HTML|nonce|access|lease|digest/);
  });
  it('links task and request before awaiting a worker that has not returned', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    let release!: () => void;
    mocks.execute.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    await POST(request()); const running = mocks.after.mock.calls[0][0]();
    try {
      const rows = log.mock.calls.filter(call => call[0] === '[SketchRuntime]').map(call => JSON.parse(String(call[1])));
      expect(rows).toEqual([expect.objectContaining({ event: 'worker-start', taskId: 'sketch_original', requestId: expect.any(String) })]);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
    } finally { release(); await running; }
  });
  it('Token response uses original frozen rates/reserve, never an unverified actual cost', async () => {
    const accepted = admission(); (accepted.task.result!.sketchAdmission as Record<string, unknown>).pricing = { mode: 'token', calls: 2, perCallCredits: 7, totalCredits: 14, tokenPricing: { input: 1, output: 2 } };
    mocks.admit.mockResolvedValue(accepted); const response = await POST(request()); const json = await response.json();
    expect(json).toMatchObject({ reserveCredits: 14, pricing: { mode: 'token', tokenPricing: { input: 1, output: 2 } } }); expect(json).not.toHaveProperty('actualCredits');
  });
  it.each(['abort', 'deadline'] as const)('a late stream after %s never enters admission', async variant => {
    vi.useFakeTimers(); const controller = new AbortController(); let finish!: (chunk: ReadableStreamReadResult<Uint8Array>) => void;
    const incoming = request(controller.signal); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const reader = { read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(resolve => { finish = resolve; }), cancel, releaseLock: vi.fn() };
    vi.spyOn(incoming.body!, 'getReader').mockReturnValue(reader as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    const running = POST(incoming); await vi.advanceTimersByTimeAsync(0);
    if (variant === 'abort') controller.abort(); else await vi.advanceTimersByTimeAsync(10_000);
    const response = await running; expect(response.status).toBe(variant === 'abort' ? 400 : 408);
    finish({ done: false, value: Buffer.from(JSON.stringify(input)) }); await Promise.resolve();
    expect(mocks.admit).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('declares the original bounded Node/after runtime', () => { expect(runtime).toBe('nodejs'); expect(dynamic).toBe('force-dynamic'); expect(maxDuration).toBeGreaterThanOrEqual(150); });
  it('auth rejection occurs before body, admission, or after', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'authentication required' }, { status: 401 }));
    const incoming = request(); const reader = vi.spyOn(incoming.body!, 'getReader');
    const response = await POST(incoming); expect(response.status).toBe(401); expect(reader).not.toHaveBeenCalled();
    expect(mocks.admit).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled(); expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('returns only the frozen admission whitelist and schedules the same admission once', async () => {
    const accepted = admission(); mocks.admit.mockResolvedValue(accepted); const controller = new AbortController();
    const response = await POST(request(controller.signal)); const json = await response.json();
    expect(response.status).toBe(202); expect(json).toMatchObject({ success: true, taskId: 'sketch_original', type: 'sketch-to-code', projectId: 'project-a', providerId: 'p1', modelId: 'm1', reserveCredits: 14, reused: false, charged: true, pricing: { calls: 2, perCallCredits: 7, totalCredits: 14 } });
    expect(JSON.stringify(json)).not.toMatch(/private-PNG|private-instruction|RAW_SECRET_HTML|access|nonce|lease|digest|compute/);
    expect(mocks.after).toHaveBeenCalledTimes(1); controller.abort(); await mocks.after.mock.calls[0][0]();
    expect(mocks.execute).toHaveBeenCalledWith(accepted, { actorUserId: 'u1', projectId: 'project-a' }, { publisher: mocks.publish });
  });
  it('completed replay is 200 without dispatch or raw HTML', async () => {
    const accepted = admission(true); accepted.task.status = 'completed'; mocks.admit.mockResolvedValue(accepted);
    const response = await POST(request()); expect(response.status).toBe(200); expect(JSON.stringify(await response.json())).not.toContain('RAW_SECRET_HTML'); expect(mocks.after).not.toHaveBeenCalled();
  });
  it.each(['throw', 'no-prepared'] as const)('known new admission with %s dispatch is pending, never re-admitted', async variant => {
    if (variant === 'throw') mocks.after.mockImplementation(() => { throw new Error('dispatch lost secret'); });
    else { const accepted = admission(); delete accepted.prepared; mocks.admit.mockResolvedValue(accepted); }
    const response = await POST(request()); expect(response.status).toBe(202); expect(await response.json()).toHaveProperty('dispatchPending', true); expect(mocks.admit).toHaveBeenCalledTimes(1); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('worker unknown does not retry or refund', async () => {
    mocks.execute.mockRejectedValue(new Error('unknown publication')); await POST(request()); await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined(); expect(mocks.execute).toHaveBeenCalledTimes(1); expect(mocks.admit).toHaveBeenCalledTimes(1);
  });
  it.each(['userId', 'apiKey', 'price', 'result', 'usage'])('rejects browser %s before original admission', async field => {
    expect((await POST(request(undefined, { ...input, [field]: 'spoof' }))).status).toBe(400); expect(mocks.admit).not.toHaveBeenCalled();
  });
  it.each([
    [new SketchInputError('SKETCH_INPUT_INVALID'), 400], [new SketchInputError('SKETCH_IMAGE_INVALID'), 422], [new SketchInputError('SKETCH_MODEL_UNAVAILABLE'), 422],
    [new GenerationProjectAccessError('GENERATION_PROJECT_FORBIDDEN'), 403], [new SketchAdmissionError('SKETCH_PRICING_UNAVAILABLE', 503), 503],
    [new IdempotencyConflictError({ userId: 'u1', idempotencyKey: 'nonce', requestDigest: 'a'.repeat(64), existingDigest: 'b'.repeat(64) }), 409], [new InsufficientCreditsError('u1', 14, 2), 402],
    [Object.assign(new Error('SQL password=secret'), { code: 'SKETCH_IMAGE_INVALID', status: 422 }), 503],
  ])('maps trusted failures without reflecting raw messages: %s', async (error, status) => {
    mocks.admit.mockRejectedValue(error); const response = await POST(request()); expect(response.status).toBe(status); const text = await response.text(); expect(text).not.toMatch(/SQL|password|secret|charged/); expect(mocks.after).not.toHaveBeenCalled();
  });
});
