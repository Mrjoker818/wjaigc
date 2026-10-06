import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  charge: vi.fn(), refund: vi.fn(), engine: vi.fn(), upstream: vi.fn(),
  providers: vi.fn(), findProvider: vi.fn(), log: vi.fn(), session: vi.fn(), imageEdit: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/app/api/image-edit/route', () => ({ POST: mocks.imageEdit }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.session }));
vi.mock('@/lib/credits', () => ({ consumeCredits: mocks.charge, refundCredits: mocks.refund }));
vi.mock('@/lib/image-tools/upscayl', () => ({ performOnnxUpscale: mocks.engine }));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mocks.providers, findProviderForModel: mocks.findProvider }));
vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: mocks.log }));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: mocks.upstream }));
import { POST as upscale } from '@/app/api/image/upscale/route';
import { POST as optimize } from '@/app/api/optimize-prompt/route';
import { buildNodeExecutionRequest, type WorkflowNode } from '@/lib/workflow-engine';

const provider = { id: 'pear-test', isEnabled: true, type: 'chat', apiKey: 'test-key', baseUrl: 'https://provider.example', selectedModels: ['gpt-4o'] };
const image = 'data:image/png;base64,iVBORw0KGgo=';
const optimizeBody = { prompt: 'A blue cup on a table', providerId: provider.id, model: 'gpt-4o' };
function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body) });
}
function noCharge(): void {
  expect(mocks.charge).not.toHaveBeenCalled();
  expect(mocks.refund).not.toHaveBeenCalled();
}
function refundedOnce(): void {
  expect(mocks.charge).toHaveBeenCalledTimes(1);
  expect(mocks.refund).toHaveBeenCalledTimes(1);
  expect(mocks.refund).toHaveBeenCalledWith('billing-test-user', 8, expect.any(String));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ id: 'billing-test-user' });
  mocks.charge.mockResolvedValue({ success: true, cost: 8 });
  mocks.refund.mockResolvedValue({ success: true, balance: 1000 });
  mocks.providers.mockResolvedValue([provider]);
  mocks.findProvider.mockResolvedValue(provider);
  mocks.engine.mockResolvedValue({ success: true, url: '/api/serve-upload/upscaled.png', width: 64, height: 64 });
  mocks.upstream.mockImplementation(async () => Response.json({ choices: [{ message: { content: 'Optimized cup' } }] }));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected external request'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('upscale preflight and synchronous compensation', () => {
  it.each([undefined, '2', '4'])('accepts the real workflow request for scale %s', async scale => {
    const node: WorkflowNode = { id: 'upscale-node', type: 'ai-upscale', label: 'Upscale', x: 0, y: 0, width: 200, height: 100, ports: [], config: { ...(scale ? { scale } : {}) } };
    const execution = buildNodeExecutionRequest(node, { imageUrl: image });
    expect(execution?.endpoint).toBe('/api/image/upscale');
    const response = await upscale(request(execution!.body));
    expect(response.status).toBe(200);
    expect(mocks.engine).toHaveBeenCalledWith(expect.objectContaining({ scale: scale === '4' ? 4 : 2 }));
    expect(mocks.charge).toHaveBeenCalledTimes(1);
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it.each([undefined, 2, 4, '2', '4'])('normalizes valid scale %s and preserves successful charge', async scale => {
    const response = await upscale(request({ imageUrl: image, scale }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, url: '/api/serve-upload/upscaled.png' });
    expect(mocks.engine).toHaveBeenCalledWith(expect.objectContaining({ scale: scale === undefined ? 2 : Number(scale), outputFormat: 'png' }));
    expect(mocks.charge).toHaveBeenCalledExactlyOnceWith('billing-test-user', 'image_upscale');
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it.each([0, 3, -2, '02', '2x', ' 2 ', '', true, [], {}])('rejects invalid scale %j before charging', async scale => {
    const response = await upscale(request({ imageUrl: image, scale }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: expect.any(String) });
    expect(mocks.engine).not.toHaveBeenCalled();
    noCharge();
  });
  it.each(['cpu', 'ai'])('checks invalid output format before charging in %s mode', async upscaleMode => {
    const response = await upscale(request({ imageUrl: image, outputFormat: 'gif', upscaleMode }));
    expect(response.status).toBe(400);
    noCharge();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not charge a missing image', async () => {
    expect((await upscale(request({ scale: 2 }))).status).toBe(400);
    noCharge();
  });
  it('refunds an engine business failure', async () => {
    mocks.engine.mockResolvedValue({ success: false, error: 'Engine unavailable' });
    const response = await upscale(request({ imageUrl: image, scale: 2 }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Engine unavailable' });
    refundedOnce();
  });
  it('refunds an engine exception once', async () => {
    mocks.engine.mockRejectedValue(new Error('Engine exception'));
    expect((await upscale(request({ imageUrl: image }))).status).toBe(500);
    refundedOnce();
  });
  it('returns AI admission rejection without an outer charge or refund', async () => {
    mocks.imageEdit.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const response = await upscale(request({ imageUrl: image, upscaleMode: 'ai', scale: '4' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(await (mocks.imageEdit.mock.calls[0][0] as NextRequest).json()).toMatchObject({ action: 'upscale', scale: 4 });
    noCharge();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains an accepted AI task without an outer charge or refund', async () => {
    const result = { success: true, taskId: 'delegate-task' };
    mocks.imageEdit.mockResolvedValue(NextResponse.json(result, { status: 202 }));
    const response = await upscale(new NextRequest('http://localhost/api/image/upscale', {
      method: 'POST', headers: { 'x-test-actor': 'billing-test-user' },
      body: JSON.stringify({ imageUrl: image, upscaleMode: 'ai', projectId: 'project-1',
        assetParentVersionIds: ['version-1'] }),
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(result);
    const delegated = mocks.imageEdit.mock.calls[0][0] as NextRequest;
    expect(delegated.headers.get('x-test-actor')).toBe('billing-test-user');
    expect(await delegated.json()).toMatchObject({ action: 'upscale', projectId: 'project-1',
      assetParentVersionIds: ['version-1'] });
    noCharge();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not run the engine or refund an unsuccessful debit', async () => {
    mocks.charge.mockResolvedValue({ success: false, cost: 8, message: 'Insufficient credits' });
    expect((await upscale(request({ imageUrl: image }))).status).toBe(402);
    expect(mocks.engine).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});

describe('prompt optimization preflight and synchronous compensation', () => {
  it.each(['', undefined])('rejects missing prompt %s without charging', async prompt => {
    expect((await optimize(request({ ...optimizeBody, prompt }))).status).toBe(400);
    noCharge();
  });
  it('runs the real safety checker before charging', async () => {
    const response = await optimize(request({ ...optimizeBody, prompt: 'child pornography' }));
    expect(response.status).toBe(400);
    noCharge();
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it.each([true, false])('rejects missing provider (explicit=%s) before charging', async explicit => {
    mocks.providers.mockResolvedValue([]);
    mocks.findProvider.mockResolvedValue(null);
    const response = await optimize(request({ prompt: optimizeBody.prompt, ...(explicit ? { providerId: 'missing', model: 'gpt-4o' } : {}) }));
    expect(response.status).toBe(400);
    noCharge();
  });
  it('refunds upstream rejection and preserves 429', async () => {
    mocks.upstream.mockResolvedValue(new Response('Busy', { status: 429 }));
    expect((await optimize(request(optimizeBody))).status).toBe(429);
    refundedOnce();
  });
  it.each([{}, { choices: [] }, { choices: [{ message: { content: '  ' } }] }])('refunds empty upstream result %j', async result => {
    mocks.upstream.mockResolvedValue(Response.json(result));
    expect((await optimize(request(optimizeBody))).status).toBe(500);
    refundedOnce();
  });
  it('refunds thrown upstream errors once', async () => {
    mocks.upstream.mockRejectedValue(new Error('Network failed'));
    expect((await optimize(request(optimizeBody))).status).toBe(500);
    refundedOnce();
  });
  it('refunds non-JSON upstream result once', async () => {
    mocks.upstream.mockResolvedValue(new Response('<html>failed</html>'));
    expect((await optimize(request(optimizeBody))).status).toBe(500);
    refundedOnce();
  });
  it('preserves success, logging identity and pricing arguments', async () => {
    const response = await optimize(request({ ...optimizeBody, userId: 'spoofed' }));
    expect(await response.json()).toEqual({ success: true, optimized: 'Optimized cup', model: 'gpt-4o', providerId: provider.id });
    expect(mocks.charge).toHaveBeenCalledExactlyOnceWith('billing-test-user', 'chat', undefined, undefined, 'gpt-4o');
    expect(mocks.log).toHaveBeenCalledWith('billing-test-user', 'chat', expect.any(Object));
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it('does not submit or refund when credits are insufficient', async () => {
    mocks.charge.mockResolvedValue({ success: false, cost: 8 });
    expect((await optimize(request(optimizeBody))).status).toBe(402);
    expect(mocks.upstream).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});

describe.each([
  ['upscale', upscale, { imageUrl: image }],
  ['optimize', optimize, optimizeBody],
] as const)('%s refund failure observability', (_name, handler, body) => {
  it('does not refund twice when constructing the failure response throws after refund', async () => {
    mocks.engine.mockResolvedValue({ success: false, error: 'Engine unavailable' });
    mocks.upstream.mockResolvedValue(new Response('Busy', { status: 429 }));
    vi.spyOn(NextResponse, 'json').mockImplementationOnce(() => { throw new Error('Response serialization failed'); });
    const response = await handler(request(body));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Response serialization failed') });
    refundedOnce();
  });
  it.each(['returns-false', 'throws'])('logs %s compensation failure without retrying an uncertain refund', async failure => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.engine.mockResolvedValue({ success: false, error: 'Engine unavailable' });
    mocks.upstream.mockResolvedValue(new Response('Busy', { status: 429 }));
    if (failure === 'throws') mocks.refund.mockRejectedValue(new Error('Refund database unavailable'));
    else mocks.refund.mockResolvedValue({ success: false, balance: 992 });
    const response = await handler(request(body));
    refundedOnce();
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/Engine unavailable|429/) });
    expect(errors.mock.calls.some(args => /Refund failed/.test(String(args[0])))).toBe(true);
  });
});
