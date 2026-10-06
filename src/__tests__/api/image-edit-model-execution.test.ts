import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import fs, { writeFile, copyFile, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

const boundary = vi.hoisted(() => {
  const network = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async (): Promise<Response> => { throw new Error('Unmatched offline network'); });
  vi.stubGlobal('fetch', network);
  return { network, session: vi.fn(), desktop: vi.fn(), users: vi.fn(), config: vi.fn(),
    consume: vi.fn(), cost: vi.fn(), refund: vi.fn(), persist: vi.fn(), register: vi.fn(), update: vi.fn(),
    media: vi.fn(), save: vi.fn(), mediaWrite: vi.fn(), log: vi.fn(), unsafePersist: vi.fn(),
    s3Available: vi.fn(), uploadS3: vi.fn(), assetPersist: vi.fn(),
    getTask: vi.fn(), getByKey: vi.fn(), claim: vi.fn(), release: vi.fn(), phaseOpen: vi.fn(), phaseAccepted: vi.fn(),
    localRoot: '/offline',
    pricing: vi.fn(), localUpscale: vi.fn(), billable: vi.fn<typeof import('@/lib/task-core/billing-service').createBillableTask>() };
});
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: boundary.session, listManagedUsers: boundary.users,
  getAuthSecretForInternalRequests: async (): Promise<string> => 'offline-quote-signing-secret-at-least-32' }));
vi.mock('@/lib/desktop-cloud', async original => ({
  ...await original<typeof import('@/lib/desktop-cloud')>(), getDesktopAuth: boundary.desktop,
}));
vi.mock('@/lib/server-api-config', async original => ({
  ...await original<typeof import('@/lib/server-api-config')>(),
  getApiProviders: boundary.config,
  findProviderById: async (id: string): Promise<ApiProvider | null> =>
    (await boundary.config()).find((p: ApiProvider) => p.id === id && p.isEnabled) || null,
  findProviderForModel: async (model: string): Promise<ApiProvider | null> =>
    (await boundary.config()).find((p: ApiProvider) => p.isEnabled && p.selectedModels?.includes(model)) || null,
  findAllProvidersForType: async (type: string): Promise<unknown[]> =>
    (await boundary.config()).filter((p: ApiProvider) => p.isEnabled && p.modelType === type)
      .map((p: ApiProvider) => ({ provider: p, models: p.selectedModels || [] })),
}));
vi.mock('@/lib/credits', async original => ({ ...await original<typeof import('@/lib/credits')>(),
  consumeCredits: boundary.consume, refundCredits: boundary.refund,
  calculateConfiguredCreditCost: boundary.cost }));
vi.mock('@/lib/credit-pricing', async original => ({
  ...await original<typeof import('@/lib/credit-pricing')>(), loadCreditPricingConfig: boundary.pricing,
}));
vi.mock('@/lib/task-registry', () => ({ registerTask: boundary.register, updateTaskProgress: boundary.update,
  isTaskCancelled: (): boolean => false }));
vi.mock('@/lib/cloud-task-persistence', () => ({ recordImageTaskSubmitted: boundary.persist,
  recordImageTaskTerminal: boundary.persist, projectPersistedCompletedTask: boundary.persist }));
vi.mock('@/lib/cloud-task-storage', async original => ({
  ...await original<typeof import('@/lib/cloud-task-storage')>(),
  completeCloudTask: boundary.persist,
  terminateCloudTaskAndRefund: boundary.persist, getCloudTaskForUser: boundary.getTask,
  getCloudTaskForUserByIdempotencyKey: boundary.getByKey,
  claimCloudTaskLease: boundary.claim, releaseCloudTaskLease: boundary.release }));
vi.mock('@/lib/task-core/image-edit-provider-phase', () => ({ openImageEditProviderPhase: boundary.phaseOpen }));
vi.mock('@/lib/task-core/billing-service', () => ({ createBillableTask: boundary.billable,
  settleFailedTask: (): never => { throw new Error('Unexpected offline atomic settlement'); } }));
vi.mock('@/lib/fetch-image-buffer', async original => ({
  ...await original<typeof import('@/lib/fetch-image-buffer')>(), fetchImageBuffer: boundary.media,
}));
vi.mock('@/lib/asset-core/binary-persistence', async original => ({
  ...await original<typeof import('@/lib/asset-core/binary-persistence')>(),
  persistAssetBytes: boundary.assetPersist,
}));
vi.mock('fs/promises', async original => {
  const actual = await original<typeof import('fs/promises')>();
  const writes = { writeFile: boundary.mediaWrite, mkdir: boundary.mediaWrite, copyFile: boundary.mediaWrite };
  return { ...actual, ...writes, default: { ...actual, ...writes } };
});
vi.mock('@/lib/server-data-root', () => ({ saveImageFile: boundary.save, getServerDataRoot: (): string => boundary.localRoot,
  getServerSystemDir: (): string => '/offline/system' }));
vi.mock('@/lib/s3-storage', () => ({ isS3Available: boundary.s3Available,
  uploadImageToS3: boundary.uploadS3, persistRemoteImage: boundary.unsafePersist }));
vi.mock('@/lib/image-tools/config', () => ({ LOCAL_AI_ENABLED: false }));
vi.mock('@/lib/image-tools/upscayl', () => ({ performUpscaleAuto: boundary.localUpscale }));
vi.mock('@/lib/op-log', () => ({ logError: boundary.log, logOperation: boundary.log,
  OP_ACTIONS: { IMAGE_EDIT: 'image_edit' }, startTimer: (): { end: () => number } => ({ end: (): number => 0 }) }));

import { POST } from '@/app/api/image-edit/route';

const actor: User = { id: 'actor', name: 'Actor', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 };
function provider(id: string): ApiProvider {
  return { id, name: id, type: 'image', modelType: 'image', isEnabled: true,
    baseUrl: `https://${id}.invalid/v1`, apiKey: `offline-${id}`, selectedModels: ['gpt-image-1'],
    advancedParams: { compatProfile: 'openai' }, createdAt: 1, updatedAt: 1 };
}
let sourceDataUrl: string;
let maskDataUrl: string;
function editRequest(extra: Record<string, unknown>, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/image-edit', { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({
      action: 'mask', editMode: 'mask', imageUrl: sourceDataUrl, maskImage: maskDataUrl,
      prompt: 'restore background', ...extra,
    }) });
}
beforeEach(async (): Promise<void> => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', boundary.network);
  vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
  vi.stubEnv('INTERNAL_API_SECRET', 'offline-model-secret-at-least-32-characters');
  boundary.localRoot = '/offline';
  boundary.config.mockResolvedValue([provider('provider-a'), provider('provider-b')]);
  boundary.session.mockResolvedValue({ ...actor });
  boundary.users.mockResolvedValue([{ ...actor }]);
  boundary.desktop.mockResolvedValue(null);
  boundary.consume.mockResolvedValue({ success: false, cost: 0, message: 'offline-credit-stop' });
  boundary.cost.mockResolvedValue(1);
  boundary.pricing.mockResolvedValue({ modelCredits: { 'native::302-esrgan': 7, 'enhance::gpt-image-1': 4 } });
  boundary.persist.mockResolvedValue(true);
  boundary.billable.mockImplementation(async (input) => ({
    task: { ...input.task, userId: input.userId, creditCost: input.creditCost, creditStatus: 'charged',
      idempotencyKey: input.idempotencyKey, revision: 0 }, reused: false, charged: true,
  }));
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#456789' } }).png().toBuffer();
  sourceDataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const mask = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#000000' } })
    .composite([{ input: await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer(), left: 12, top: 12 }]).png().toBuffer();
  maskDataUrl = `data:image/png;base64,${mask.toString('base64')}`;
  boundary.media.mockResolvedValue(png);
  boundary.save.mockReturnValue('/api/serve-upload/offline-result.png');
  boundary.unsafePersist.mockResolvedValue('/api/serve-upload/unsafe.png');
  boundary.s3Available.mockReturnValue(false);
  boundary.uploadS3.mockResolvedValue('/images/multi_angle.png');
  boundary.assetPersist.mockResolvedValue({ url: '/api/serve-upload/uploads/enhanced.png' });
  boundary.localUpscale.mockResolvedValue({ success: true, imageUrl: '/api/serve-upload/local-upscale.png',
    model: 'local-realesrgan', outputSize: { width: 64, height: 64 } });
  boundary.getTask.mockResolvedValue({ status: 'processing', result: {} });
  boundary.getByKey.mockResolvedValue(null);
  boundary.claim.mockResolvedValue(true);
  boundary.release.mockResolvedValue(true);
  boundary.phaseOpen.mockResolvedValue({ status: 'ready', boundary: {
    transport: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => boundary.network(input, init),
    onAccepted: boundary.phaseAccepted,
  } });
  boundary.register.mockImplementation((taskId: string): { taskId: string } => ({ taskId }));
  boundary.network.mockImplementation(async (): Promise<Response> => { throw new Error('Unmatched offline network'); });
});
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('real image-edit model admission and execution', (): void => {
  it('uses the explicitly selected non-302 upscaler instead of local fidelity', async (): Promise<void> => {
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.config.mockResolvedValue([{ ...provider('up'), type: 'upscaler', modelType: 'upscaler',
      selectedModels: ['Real-ESRGAN'] }]);
    boundary.session.mockResolvedValue({ ...actor, imageModels: ['up::Real-ESRGAN'] });
    const providerCalls: string[] = [];
    boundary.network.mockImplementation(async (input): Promise<Response> => {
      const url = String(input);
      providerCalls.push(url);
      if (url.startsWith('https://up.invalid/')) {
        return Response.json({ data: [{ url: 'https://media.invalid/upscaled.png' }] });
      }
      throw new Error('Unmatched offline network');
    });

    const response = await POST(editRequest({ action: 'upscale', upscaleModel: 'Real-ESRGAN',
      engine: 'fidelity', scale: 2 }));
    expect(await response.json()).toMatchObject({ success: true, usedModel: 'Real-ESRGAN' });
    expect(providerCalls).toEqual(['https://up.invalid/v1/images/edits']);
    expect(boundary.localUpscale).not.toHaveBeenCalled();
  });
  it('rejects unverified SeedVR2 before charging or dispatching an upscaler', async (): Promise<void> => {
    boundary.config.mockResolvedValue([{ ...provider('up'), type: 'upscaler', modelType: 'upscaler',
      selectedModels: ['SeedVR2-Upscaler'] }]);
    boundary.session.mockResolvedValue({ ...actor, imageModels: ['up::SeedVR2-Upscaler'] });

    const response = await POST(editRequest({ action: 'upscale', providerId: 'up',
      upscaleModel: 'SeedVR2-Upscaler', scale: 2 }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_MODEL_UNVERIFIED' });
    expect(boundary.consume).not.toHaveBeenCalled();
    expect(boundary.billable).not.toHaveBeenCalled();
    expect(boundary.network).not.toHaveBeenCalled();
    expect(boundary.localUpscale).not.toHaveBeenCalled();
  });
  it('blocks both named and default filesystem write paths with the offline boundary', (): void => {
    for (const write of [fs.writeFile, fs.copyFile, fs.mkdir, writeFile, copyFile, mkdir]) {
      expect(write).toBe(boundary.mediaWrite);
    }
  });
  it.each(['../private.png', '%2e%2e/private.png'])(
    'rejects a multi-angle upload traversal %s before credit or provider submission', async (suffix): Promise<void> => {
    const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const root = await realFs.mkdtemp(path.join(tmpdir(), 'wujie-image-edit-media-'));
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())
      || !path.basename(root).startsWith('wujie-image-edit-media-')) {
      throw new Error('Unexpected image-edit test directory');
    }
    try {
      await realFs.mkdir(path.join(root, 'uploads'));
      const source = Buffer.from(sourceDataUrl.split(',')[1], 'base64');
      await realFs.writeFile(path.join(root, 'private.png'), source);
      expect(await realFs.readFile(path.join(root, 'private.png'))).toEqual(source);
      boundary.localRoot = root;
      boundary.consume.mockResolvedValue({ success: true, cost: 1 });

      const response = await POST(editRequest({ action: 'multi_angle', imageUrl: `/api/serve-upload/${suffix}`,
        model: 'gpt-image-1', rotation: 20 }));

      expect(response.status).toBe(400);
      expect(boundary.consume).not.toHaveBeenCalled();
      expect(boundary.network).not.toHaveBeenCalled();
    } finally {
      await realFs.rm(root, { recursive: true, force: true });
    }
    });
  it('does not use a hard-linked private image as a multi-angle reference', async (): Promise<void> => {
    const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const root = await realFs.mkdtemp(path.join(tmpdir(), 'wujie-image-edit-media-'));
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())
      || !path.basename(root).startsWith('wujie-image-edit-media-')) {
      throw new Error('Unexpected image-edit test directory');
    }
    try {
      await realFs.mkdir(path.join(root, 'uploads'));
      const privatePath = path.join(root, 'private.png');
      await realFs.writeFile(privatePath, Buffer.from(sourceDataUrl.split(',')[1], 'base64'));
      await realFs.link(privatePath, path.join(root, 'uploads', 'linked.png'));
      boundary.localRoot = root;
      boundary.consume.mockResolvedValue({ success: true, cost: 1 });

      const response = await POST(editRequest({ action: 'multi_angle', imageUrl: '/api/serve-upload/linked.png',
        model: 'gpt-image-1', rotation: 20 }));

      expect(response.status).toBe(400);
      expect(boundary.consume).not.toHaveBeenCalled();
      expect(boundary.network).not.toHaveBeenCalled();
    } finally {
      await realFs.rm(root, { recursive: true, force: true });
    }
  });
  it.each(['/api/serve-upload/safe.png', '/uploads/safe.png'])(
    'submits the original bytes from a valid managed multi-angle upload %s', async (imageUrl): Promise<void> => {
    const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const root = await realFs.mkdtemp(path.join(tmpdir(), 'wujie-image-edit-media-'));
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())
      || !path.basename(root).startsWith('wujie-image-edit-media-')) {
      throw new Error('Unexpected image-edit test directory');
    }
    try {
      await realFs.mkdir(path.join(root, 'uploads'));
      await realFs.writeFile(path.join(root, 'uploads', 'safe.png'),
        Buffer.from(sourceDataUrl.split(',')[1], 'base64'));
      boundary.localRoot = root;
      boundary.consume.mockResolvedValue({ success: true, cost: 1 });
      let submittedBody = '';
      boundary.network.mockImplementation(async (_input, init): Promise<Response> => {
        submittedBody = String(init?.body);
        return Response.json({ task_id: 'safe-angle-task' });
      });

      const response = await POST(editRequest({ action: 'multi_angle', imageUrl,
        model: 'provider-a::gpt-image-1', rotation: 20 }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, taskId: 'safe-angle-task' });
      expect(submittedBody).toContain(sourceDataUrl);
      expect(boundary.consume).toHaveBeenCalledTimes(1);
    } finally {
      await realFs.rm(root, { recursive: true, force: true });
    }
    });
  it('preserves a managed-media query when local bytes need the HTTP recovery path', async (): Promise<void> => {
    const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const root = await realFs.mkdtemp(path.join(tmpdir(), 'wujie-image-edit-media-'));
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())
      || !path.basename(root).startsWith('wujie-image-edit-media-')) {
      throw new Error('Unexpected image-edit test directory');
    }
    try {
      await realFs.mkdir(path.join(root, 'uploads'));
      boundary.localRoot = root;
      boundary.consume.mockResolvedValue({ success: true, cost: 1 });
      const requests: string[] = [];
      boundary.network.mockImplementation(async (input): Promise<Response> => {
        const url = String(input);
        requests.push(url);
        if (url.startsWith('http://localhost:5000/api/serve-upload/')) {
          return new Response(Buffer.from(sourceDataUrl.split(',')[1], 'base64'),
            { status: 200, headers: { 'content-type': 'image/png' } });
        }
        return Response.json({ task_id: 'recovered-angle-task' });
      });

      const response = await POST(editRequest({ action: 'multi_angle',
        imageUrl: '/api/serve-upload/missing.png?version=123',
        model: 'provider-a::gpt-image-1', rotation: 20 }));

      expect(response.status).toBe(200);
      expect(requests[0]).toBe('http://localhost:5000/api/serve-upload/missing.png?version=123');
      expect(await response.json()).toMatchObject({ success: true, taskId: 'recovered-angle-task' });
    } finally {
      await realFs.rm(root, { recursive: true, force: true });
    }
  });
  it('does not replace a missing managed upload with a same-named public file', async (): Promise<void> => {
    const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const root = await realFs.mkdtemp(path.join(tmpdir(), 'wujie-image-edit-media-'));
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())
      || !path.basename(root).startsWith('wujie-image-edit-media-')) {
      throw new Error('Unexpected image-edit test directory');
    }
    try {
      await realFs.mkdir(path.join(root, 'data', 'uploads'), { recursive: true });
      await realFs.mkdir(path.join(root, 'public'));
      await realFs.writeFile(path.join(root, 'public', 'missing.png'),
        Buffer.from(sourceDataUrl.split(',')[1], 'base64'));
      boundary.localRoot = path.join(root, 'data');
      vi.stubEnv('COZE_WORKSPACE_PATH', root);
      boundary.consume.mockResolvedValue({ success: true, cost: 1 });
      const requests: string[] = [];
      boundary.network.mockImplementation(async (input): Promise<Response> => {
        const url = String(input);
        requests.push(url);
        if (url.startsWith('http://localhost:5000/api/serve-upload/')) {
          return new Response(Buffer.from(sourceDataUrl.split(',')[1], 'base64'),
            { status: 200, headers: { 'content-type': 'image/png' } });
        }
        return Response.json({ task_id: 'recovered-only-task' });
      });

      const response = await POST(editRequest({ action: 'multi_angle',
        imageUrl: '/api/serve-upload/missing.png', model: 'provider-a::gpt-image-1', rotation: 20 }));

      expect(response.status).toBe(200);
      expect(requests[0]).toBe('http://localhost:5000/api/serve-upload/missing.png');
    } finally {
      await realFs.rm(root, { recursive: true, force: true });
    }
  });
  it('rejects conflicting exact provider before consuming credits or reaching a supplier', async (): Promise<void> => {
    const response = await POST(editRequest({ model: 'provider-a::gpt-image-1', providerId: 'provider-b' }));
    expect.soft(response.status).toBe(400);
    expect.soft(await response.json()).toMatchObject({ code: 'IMAGE_EDIT_MODEL_PROVIDER_MISMATCH' });
    expect.soft(boundary.consume).not.toHaveBeenCalled();
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('returns sanitized planning 503 before any credit, media, task or network side effect', async (): Promise<void> => {
    boundary.config.mockRejectedValue(new Error('do-not-expose-secret'));
    const response = await POST(editRequest({ model: 'gpt-image-1' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, code: 'IMAGE_EDIT_MODEL_PLAN_UNAVAILABLE', error: 'IMAGE_EDIT_MODEL_PLAN_UNAVAILABLE' });
    for (const spy of [boundary.consume, boundary.media, boundary.persist, boundary.register, boundary.network]) expect(spy).not.toHaveBeenCalled();
  });
  it('desktop authentication applies its own model grants', async (): Promise<void> => {
    boundary.session.mockResolvedValue(null);
    boundary.desktop.mockResolvedValue({ user: { ...actor, imageModels: ['provider-b::gpt-image-1'] }, token: 'offline' });
    const response = await POST(editRequest({ model: 'provider-a::gpt-image-1' }, { authorization: 'Bearer offline' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED' });
    expect(boundary.network).not.toHaveBeenCalled();
    expect(boundary.consume).not.toHaveBeenCalled();
  });
  it.each(['missing', 'disabled'])('rejects %s provider before credit/media/task/network boundaries', async (id): Promise<void> => {
    boundary.config.mockResolvedValue([{ ...provider('disabled'), isEnabled: false }]);
    const response = await POST(editRequest({ model: 'gpt-image-1', providerId: id }));
    expect.soft(response.status).toBe(400);
    expect.soft(await response.json()).toMatchObject({ code: 'IMAGE_EDIT_MODEL_UNAVAILABLE' });
    for (const spy of [boundary.consume, boundary.media, boundary.persist, boundary.register, boundary.network]) expect.soft(spy).not.toHaveBeenCalled();
  });
  it('internal model authorization uses managed actor despite claimed admin and conflicting cookie', async (): Promise<void> => {
    boundary.session.mockResolvedValue({ ...actor, id: 'cookie-admin', role: 'admin' });
    boundary.users.mockResolvedValue([{ ...actor, imageModels: ['provider-b::gpt-image-1'] }]);
    const response = await POST(editRequest({ model: 'gpt-image-1', providerId: 'provider-a' }, {
      'x-internal-request': 'true', 'x-internal-user-id': 'actor', 'x-internal-user-role': 'admin',
      'x-wujie-internal-secret': 'offline-model-secret-at-least-32-characters',
    }));
    expect.soft(response.status).toBe(403);
    expect.soft(await response.json()).toMatchObject({ code: 'IMAGE_EDIT_MODEL_NOT_AUTHORIZED' });
    expect.soft(boundary.consume).not.toHaveBeenCalled();
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('dedicated removebg sends the authorized second model despite unauthorized provider default', async (): Promise<void> => {
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.config.mockResolvedValue([{ ...provider('remove'), type: 'removebg', modelType: 'removebg',
      selectedModel: 'remove-denied', selectedModels: ['remove-denied', 'remove-allowed'],
      advancedParams: { removeBgRequestProfile: 'images-generations', removeBgEndpointPath: '/remove' } }]);
    boundary.session.mockResolvedValue({ ...actor, imageModels: ['remove::remove-allowed'] });
    const rgba = await sharp(Buffer.from(sourceDataUrl.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) rgba[(y * 32 + x) * 4 + 3] = x >= 8 && x < 24 && y >= 8 && y < 24 ? 255 : 0;
    const output = await sharp(rgba, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer();
    const models: string[] = [];
    boundary.network.mockImplementation(async (input, init): Promise<Response> => {
      if (String(input) !== 'https://remove.invalid/v1/remove') throw new Error('Unmatched offline network');
      models.push((JSON.parse(String(init?.body)) as { model: string }).model);
      expect(new Headers(init?.headers).get('X-Api-Key')).toBe('offline-remove');
      return new Response(new Uint8Array(output), { headers: { 'content-type': 'image/png' } });
    });
    const response = await POST(editRequest({ action: 'removebg', engine: 'ai' }));
    expect.soft(await response.json()).toMatchObject({ success: true, usedModel: 'remove-allowed', providerId: 'remove',
      engine: 'dedicated-removebg', imageUrl: '/api/serve-upload/offline-result.png', maskUrl: '/api/serve-upload/offline-result.png' });
    expect.soft(models).toEqual(['remove-allowed']);
    expect(boundary.config).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('upscale uses admitted enhancement target only when available (%s)', async (allowEnhance): Promise<void> => {
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.config.mockResolvedValue([
      { ...provider('up'), type: 'upscaler', modelType: 'upscaler', selectedModels: ['Real-ESRGAN'] },
      provider('enhance-denied'), provider('enhance-allowed'),
    ]);
    boundary.session.mockResolvedValue({ ...actor, imageModels: ['up::Real-ESRGAN', ...(allowEnhance ? ['enhance-allowed::gpt-image-1'] : [])] });
    const pairs: string[] = [];
    boundary.network.mockImplementation(async (input, init): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/serve-upload/')) return new Response(new Uint8Array(await boundary.media()));
      if (url.includes('/api/save-image')) return Response.json({ url: '/api/serve-upload/enhanced.png' });
      const body = JSON.parse(String(init?.body)) as { model: string };
      const host = new URL(url).hostname;
      pairs.push(`${host.split('.')[0]}::${body.model}`);
      if (host === 'up.invalid') return Response.json({ data: [{ url: 'https://media.invalid/upscaled.png' }] });
      if (host === 'enhance-allowed.invalid') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer offline-enhance-allowed');
        return Response.json({ imageUrl: sourceDataUrl });
      }
      throw new Error('Unmatched offline network');
    });
    const response = await POST(editRequest({ action: 'upscale', model: 'gpt-image-1', scale: 2, engine: 'ai',
      enableQualityEnhance: allowEnhance }));
    expect.soft(await response.json()).toMatchObject({ success: true, enhanced: allowEnhance, usedModel: 'Real-ESRGAN',
      engine: 'ai-upscale-hq', outputWidth: 64, outputHeight: 64 });
    expect.soft(pairs).toEqual(allowEnhance ? ['up::Real-ESRGAN', 'enhance-allowed::gpt-image-1'] : ['up::Real-ESRGAN']);
    expect(boundary.config).toHaveBeenCalledTimes(1);
  });
  it('does not submit a second enhancement model without the explicit quality option', async (): Promise<void> => {
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.config.mockResolvedValue([
      { ...provider('up'), type: 'upscaler', modelType: 'upscaler', selectedModels: ['Real-ESRGAN'] },
      provider('enhance-allowed'),
    ]);
    boundary.session.mockResolvedValue({ ...actor, imageModels: ['up::Real-ESRGAN', 'enhance-allowed::gpt-image-1'] });
    const providerCalls: string[] = [];
    boundary.network.mockImplementation(async (input): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/serve-upload/')) return new Response(new Uint8Array(await boundary.media()));
      const host = new URL(url).hostname;
      providerCalls.push(host);
      if (host === 'up.invalid') return Response.json({ data: [{ url: 'https://media.invalid/upscaled.png' }] });
      if (host === 'enhance-allowed.invalid') return Response.json({ imageUrl: sourceDataUrl });
      throw new Error('Unmatched offline network');
    });
    const response = await POST(editRequest({ action: 'upscale', model: 'gpt-image-1', scale: 2, engine: 'ai' }));
    expect(await response.json()).toMatchObject({ success: true, enhanced: false });
    expect(providerCalls).toEqual(['up.invalid']);
    expect(boundary.assetPersist).not.toHaveBeenCalled();
  });
  it.each(['multi_angle', 'display_decompose', 'removebg', 'remove_background'])
    ('%s async dispatch persists the successful exact pair', async (action): Promise<void> => {
      boundary.consume.mockResolvedValue({ success: true, cost: 1 });
      boundary.network.mockImplementation(async (input): Promise<Response> => {
        const host = new URL(String(input)).hostname;
        if (host === 'provider-a.invalid') return Response.json({ error: { message: 'image editing unavailable' } }, { status: 400 });
        if (host === 'provider-b.invalid') return Response.json({ task_id: 'branch-b-task' });
        throw new Error('Unmatched offline network');
      });
      const response = await POST(editRequest({ action, model: 'gpt-image-1', expandScale: 2, rotation: 30, engine: 'ai' }));
      expect.soft(await response.json()).toMatchObject({ success: true, taskId: 'branch-b-task' });
      expect.soft(boundary.persist).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'provider-b', model: 'gpt-image-1',
        taskEntryAudit: expect.objectContaining({ actualProviderId: 'provider-b', actualModelId: 'gpt-image-1' }) }));
      expect(boundary.update).toHaveBeenCalledWith('branch-b-task', expect.objectContaining({ result: expect.objectContaining({ providerId: 'provider-b', apiKey: 'offline-provider-b' }) }));
    });
  it('fails a synchronous multi-angle result when its image URL cannot pass safe media retrieval', async (): Promise<void> => {
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === 'http://127.0.0.1/private.png') throw new Error('private address blocked');
      return Buffer.from(sourceDataUrl.split(',')[1], 'base64');
    });
    boundary.network.mockImplementation(async (): Promise<Response> =>
      Response.json({ data: [{ url: 'http://127.0.0.1/private.png' }] }));
    const response = await POST(editRequest({ action: 'multi_angle', model: 'provider-a::gpt-image-1', rotation: 30 }));
    const payload = await response.json();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(payload.success).toBe(false);
    expect(payload.imageUrl).toBeUndefined();
    expect(boundary.unsafePersist).not.toHaveBeenCalled();
    expect(boundary.refund).toHaveBeenCalled();
  });
  it('returns persisted image bytes for a valid synchronous multi-angle result', async (): Promise<void> => {
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.network.mockImplementation(async (): Promise<Response> =>
      Response.json({ data: [{ url: 'https://media.invalid/validated.png' }] }));
    const response = await POST(editRequest({ action: 'multi_angle', model: 'provider-a::gpt-image-1', rotation: 30 }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true,
      imageUrl: expect.stringMatching(/^\/api\/serve-upload\/uploads\/multi_angle_\d+_[a-f0-9-]{36}\.png$/) });
    expect(boundary.media.mock.calls.some(([url]) => url === 'https://media.invalid/validated.png')).toBe(true);
    expect(boundary.unsafePersist).not.toHaveBeenCalled();
  });
  it('serves a synchronous multi-angle S3-backed image through its managed upload route', async (): Promise<void> => {
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.s3Available.mockReturnValue(true);
    boundary.network.mockImplementation(async (): Promise<Response> =>
      Response.json({ data: [{ url: 'https://media.invalid/validated.png' }] }));
    const response = await POST(editRequest({ action: 'multi_angle', model: 'provider-a::gpt-image-1', rotation: 30 }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true,
      imageUrl: expect.stringMatching(/^\/api\/serve-upload\/uploads\/multi_angle_\d+_[a-f0-9-]{36}\.png$/) });
    expect(boundary.uploadS3).toHaveBeenCalled();
    expect(boundary.unsafePersist).not.toHaveBeenCalled();
  });
  it('keeps simultaneous multi-angle results at distinct managed URLs', async (): Promise<void> => {
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.network.mockImplementation(async (): Promise<Response> =>
      Response.json({ data: [{ url: 'https://media.invalid/validated.png' }] }));
    const first = await (await POST(editRequest({ action: 'multi_angle', model: 'provider-a::gpt-image-1', rotation: 30 }))).json();
    const second = await (await POST(editRequest({ action: 'multi_angle', model: 'provider-a::gpt-image-1', rotation: 30 }))).json();
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.imageUrl).not.toBe(second.imageUrl);
  });
  it('previews a 302 upscale and enhancement quote without creating or charging a task', async (): Promise<void> => {
    boundary.config.mockResolvedValue([
      { ...provider('native'), type: 'upscaler', modelType: 'upscaler',
        baseUrl: 'https://api.302.ai', selectedModels: ['302-esrgan'] },
      provider('enhance'),
    ]);
    boundary.session.mockResolvedValue({ ...actor,
      imageModels: ['native::302-esrgan', 'enhance::gpt-image-1'] });
    boundary.cost.mockImplementation(async (operation: string): Promise<number> => operation === 'image_generate' ? 4 : 7);
    const response = await POST(editRequest({ action: 'upscale', upscaleModel: '302-esrgan',
      scale: 2, engine: 'ai-only', enableQualityEnhance: true,
      enhanceModel: 'enhance::gpt-image-1', quoteOnly: true }));
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ success: true, quote: {
      total: 11, components: { upscale: 7, enhance: 4 },
      targets: [{ phase: 'upscale', providerId: 'native', modelId: '302-esrgan' },
        { phase: 'enhance', providerId: 'enhance', modelId: 'gpt-image-1' }],
      token: expect.any(String),
    } });
    expect(boundary.consume).not.toHaveBeenCalled();
    expect(boundary.billable).not.toHaveBeenCalled();
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('never enters an existing task replay when previewing with its idempotency key', async (): Promise<void> => {
    boundary.config.mockResolvedValue([{ ...provider('native'), type: 'upscaler', modelType: 'upscaler',
      baseUrl: 'https://api.302.ai', selectedModels: ['302-esrgan'] }]);
    boundary.session.mockResolvedValue({ ...actor, imageModels: ['native::302-esrgan'] });
    boundary.cost.mockResolvedValue(7);
    boundary.getByKey.mockResolvedValue({ id: 'existing-task', type: 'other', status: 'processing',
      requestDigest: 'old-request', result: {} });
    const response = await POST(editRequest({ action: 'upscale', upscaleModel: '302-esrgan',
      engine: 'ai-only', scale: 2, quoteOnly: true }, { 'idempotency-key': 'existing-key' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, quote: { total: 7 } });
    expect(boundary.getByKey).not.toHaveBeenCalled();
    expect(boundary.billable).not.toHaveBeenCalled();
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('rejects a stale 302 quote after administrator repricing before task or provider dispatch', async (): Promise<void> => {
    boundary.config.mockResolvedValue([
      { ...provider('native'), type: 'upscaler', modelType: 'upscaler',
        baseUrl: 'https://api.302.ai', selectedModels: ['302-esrgan'] }, provider('enhance'),
    ]);
    boundary.session.mockResolvedValue({ ...actor,
      imageModels: ['native::302-esrgan', 'enhance::gpt-image-1'] });
    boundary.pricing.mockResolvedValueOnce({ modelCredits: { 'native::302-esrgan': 7,
      'enhance::gpt-image-1': 4 } }).mockResolvedValue({ modelCredits: {
      'native::302-esrgan': 70, 'enhance::gpt-image-1': 40,
    } });
    boundary.cost.mockImplementation(async (operation: string, _model: string,
      options: { pricingConfig: { modelCredits: Record<string, number> } }): Promise<number> =>
      options.pricingConfig.modelCredits[operation === 'image_generate'
        ? 'enhance::gpt-image-1' : 'native::302-esrgan']);
    const input = { action: 'upscale', upscaleModel: '302-esrgan', scale: 2,
      engine: 'ai-only', enableQualityEnhance: true, enhanceModel: 'enhance::gpt-image-1' };
    const preview = await (await POST(editRequest({ ...input, quoteOnly: true }))).json();
    expect(preview.quote.total).toBe(11);
    const response = await POST(editRequest({ ...input, quoteToken: preview.quote.token }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_QUOTE_CHANGED' });
    expect(boundary.billable).not.toHaveBeenCalled();
    expect(boundary.consume).not.toHaveBeenCalled();
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('accepts an unchanged confirmed 302 quote as the charge for one durable task', async (): Promise<void> => {
    boundary.config.mockResolvedValue([
      { ...provider('native'), type: 'upscaler', modelType: 'upscaler',
        baseUrl: 'https://api.302.ai', selectedModels: ['302-esrgan'] }, provider('enhance'),
    ]);
    boundary.session.mockResolvedValue({ ...actor,
      imageModels: ['native::302-esrgan', 'enhance::gpt-image-1'] });
    boundary.cost.mockImplementation(async (operation: string): Promise<number> => operation === 'image_generate' ? 4 : 7);
    const input = { action: 'upscale', upscaleModel: '302-esrgan', scale: 2,
      engine: 'ai-only', enableQualityEnhance: true, enhanceModel: 'enhance::gpt-image-1' };
    const preview = await (await POST(editRequest({ ...input, quoteOnly: true }))).json();
    boundary.phaseOpen.mockResolvedValue({ status: 'submission-unknown' });
    const response = await POST(editRequest({ ...input, quoteToken: preview.quote.token },
      { 'idempotency-key': 'confirmed-quote' }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ quote: { total: 11,
      components: { upscale: 7, enhance: 4 } } });
    expect(boundary.billable).toHaveBeenCalledWith(expect.objectContaining({ creditCost: 11,
      task: expect.objectContaining({ result: expect.objectContaining({
        imageEditQuote: expect.objectContaining({
          total: 11, upscale: 7, enhance: 4, confirmed: true,
          pricingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          catalogDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }) }),
    }));
    expect(boundary.consume).not.toHaveBeenCalled();
    expect(boundary.network).not.toHaveBeenCalled();
    const stored = boundary.billable.mock.calls[0]?.[0];
    boundary.getByKey.mockResolvedValue({ ...stored?.task, requestDigest: stored?.requestDigest,
      creditCost: 11, creditStatus: 'charged' });
    boundary.pricing.mockResolvedValue({ modelCredits: { 'native::302-esrgan': 70,
      'enhance::gpt-image-1': 40 } });
    const replay = await POST(editRequest(input, { 'idempotency-key': 'confirmed-quote' }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ taskId: stored?.task.id, reused: true,
      quote: { total: 11, components: { upscale: 7, enhance: 4 } } });
    expect(boundary.billable).toHaveBeenCalledTimes(1);
  });
  it('returns the persisted quote when atomic admission reuses a concurrent 302 task', async (): Promise<void> => {
    boundary.config.mockResolvedValue([{ ...provider('native'), type: 'upscaler', modelType: 'upscaler',
      baseUrl: 'https://api.302.ai', selectedModels: ['302-esrgan'] }]);
    boundary.session.mockResolvedValue({ ...actor, imageModels: ['native::302-esrgan'] });
    boundary.cost.mockResolvedValue(7);
    const input = { action: 'upscale', upscaleModel: '302-esrgan', engine: 'ai-only', scale: 2 };
    const preview = await (await POST(editRequest({ ...input, quoteOnly: true }))).json();
    boundary.billable.mockImplementation(async admission => ({
      task: { ...admission.task, userId: admission.userId,
        creditCost: 7, creditStatus: 'charged', revision: 1 },
      reused: true, charged: false,
    }));
    const response = await POST(editRequest({ ...input, quoteToken: preview.quote.token },
      { 'idempotency-key': 'concurrent-quote' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reused: true,
      quote: { total: 7, components: { upscale: 7, enhance: 0 } } });
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('passes one frozen pricing snapshot to both 302 upscale and enhancement quote components', async (): Promise<void> => {
    boundary.config.mockResolvedValue([
      { ...provider('native'), type: 'upscaler', modelType: 'upscaler',
        baseUrl: 'https://api.302.ai', selectedModels: ['302-esrgan'] },
      provider('enhance'),
    ]);
    boundary.session.mockResolvedValue({ ...actor, imageModels: ['native::302-esrgan', 'enhance::gpt-image-1'] });
    boundary.cost.mockImplementation(async (operation: string): Promise<number> => operation === 'image_generate' ? 4 : 7);
    boundary.phaseOpen.mockResolvedValue({ status: 'submission-unknown' });
    const response = await POST(editRequest({ action: 'upscale', upscaleModel: '302-esrgan', scale: 2,
      enableQualityEnhance: true }));
    expect(response.status).toBe(202);
    const snapshot = await boundary.pricing.mock.results[0]?.value;
    expect(boundary.pricing).toHaveBeenCalledTimes(1);
    expect(boundary.cost).toHaveBeenCalledTimes(2);
    const frozenSnapshot = boundary.cost.mock.calls[0]?.[2]?.pricingConfig;
    expect(frozenSnapshot).toStrictEqual(snapshot);
    expect(boundary.cost.mock.calls[1]?.[2]?.pricingConfig).toBe(frozenSnapshot);
    expect(boundary.billable).toHaveBeenCalledWith(expect.objectContaining({ creditCost: 11 }));
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it.each(['legacy', 'core-v2'])('native automatic model substitution persists the actual pair in %s', async (mode): Promise<void> => {
    vi.stubEnv('WUJIE_TASK_CORE_MODE', mode);
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.config.mockResolvedValue([{ ...provider('native'), type: 'upscaler', modelType: 'upscaler',
      baseUrl: 'https://api.302.ai', selectedModels: ['302-super-upscale-v2'] }]);
    boundary.session.mockResolvedValue({ ...actor, imageModels: ['native::302-super-upscale-v2'] });
    const output = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#456789' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => url === sourceDataUrl ? Buffer.from(sourceDataUrl.split(',')[1], 'base64') : output);
    const endpoints: string[] = [];
    boundary.network.mockImplementation(async (input, init): Promise<Response> => {
      const endpoint = String(input);
      if (endpoint !== 'https://api.302.ai/302/submit/super-upscale-v2') throw new Error('Unmatched offline network');
      endpoints.push(endpoint);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer offline-native');
      expect(JSON.parse(String(init?.body))).toMatchObject({ model_type: 'SDXL', image_url: sourceDataUrl, scale: 2 });
      return Response.json({ image: { url: 'https://media.invalid/super-output.png', width: 64, height: 64 } });
    });
    const response = await POST(editRequest({ action: 'upscale', upscaleModel: '302-esrgan', scale: 2 }));
    const result = await response.json();
    expect.soft(response.status).toBe(200);
    expect.soft(result).toMatchObject({ success: true, providerId: 'native', usedModel: '302-super-upscale-v2', outputWidth: 64, outputHeight: 64 });
    expect.soft(endpoints).toEqual(['https://api.302.ai/302/submit/super-upscale-v2']);
    const audit = expect.objectContaining({ mode, requestedModelId: '302-esrgan',
      actualProviderId: 'native', actualModelId: '302-super-upscale-v2' });
    const payload = expect.objectContaining({ requestedModel: '302-esrgan' });
    if (mode === 'legacy') {
      expect.soft(boundary.billable).not.toHaveBeenCalled();
      expect.soft(boundary.consume).toHaveBeenCalledTimes(1);
      expect.soft(boundary.persist).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'native', model: '302-super-upscale-v2',
        taskEntryAudit: audit, submissionPayload: payload }));
    } else {
      expect.soft(boundary.consume).not.toHaveBeenCalled();
      expect.soft(boundary.billable).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        creditCost: 1,
        requestDigest: createHash('sha256').update(JSON.stringify({ version: 1, entry: '/api/image-edit/302', actorUserId: 'actor',
          request: { action: 'upscale', editMode: 'mask', imageUrl: sourceDataUrl, maskImage: maskDataUrl,
            prompt: 'restore background', scale: 2, upscaleModel: '302-esrgan' },
          providerId: 'native', modelId: '302-super-upscale-v2', sourceWidth: 32, sourceHeight: 32, targetWidth: 64, targetHeight: 64 })).digest('hex'),
        task: expect.objectContaining({ providerId: 'native', model: '302-super-upscale-v2',
          result: expect.objectContaining({ taskEntryAudit: audit, submissionPayload: payload }) }),
      }));
    }
    expect(boundary.persist).toHaveBeenCalledWith(expect.stringMatching(/^upscale-302-/), expect.objectContaining({
      imageUrl: result.imageUrl, action: 'upscale', providerId: 'native', model: '302-super-upscale-v2',
      enhanced: false,
    }));
  });
  it.each([true, false])('native 302 uses exact provider identity for response and audit (explicit %s)', async (explicit): Promise<void> => {
    boundary.consume.mockResolvedValue({ success: true, cost: 1 });
    boundary.config.mockResolvedValue([{ ...provider('native'), type: 'upscaler', modelType: 'upscaler',
      baseUrl: 'https://api.302.ai', selectedModels: ['esrgan'] }]);
    const output = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#456789' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => url === sourceDataUrl ? Buffer.from(sourceDataUrl.split(',')[1], 'base64') : output);
    boundary.network.mockImplementation(async (input, init): Promise<Response> => {
      expect(String(input)).toBe('https://api.302.ai/302/submit/esrgan');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer offline-native');
      return Response.json({ image: { url: 'https://media.invalid/native-output.png', width: 64, height: 64 } });
    });
    const response = await POST(editRequest({ action: 'upscale', model: 'gpt-image-1', upscaleModel: 'esrgan', ...(explicit ? { providerId: 'native' } : {}), scale: 2 }));
    expect.soft(await response.json()).toMatchObject({ success: true, providerId: 'native', usedModel: '302-esrgan', outputWidth: 64, outputHeight: 64 });
    expect(boundary.persist).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'native', model: '302-esrgan',
      taskEntryAudit: expect.objectContaining({ actualProviderId: 'native', actualModelId: '302-esrgan' }) }));
  });
});
