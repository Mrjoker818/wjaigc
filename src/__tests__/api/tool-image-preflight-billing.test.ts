import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  charge: vi.fn(), refund: vi.fn(), provider: vi.fn(), providers: vi.fn(), register: vi.fn(),
  after: vi.fn(), submit: vi.fn(), session: vi.fn(),
}));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.session }));
vi.mock('@/lib/credits', () => ({ consumeCredits: mocks.charge, refundCredits: mocks.refund }));
vi.mock('@/lib/server-api-config', () => ({ findProviderById: mocks.provider, findProviderForModel: mocks.provider, getApiProviders: mocks.providers, getPublicModels: vi.fn(), getPublicApiProviders: vi.fn() }));
vi.mock('@/lib/task-registry', () => ({ registerTask: mocks.register, updateTaskProgress: vi.fn(), isTaskCancelled: vi.fn(() => false), getTaskInfo: vi.fn() }));
vi.mock('@/lib/db-storage', () => ({ dbGetEcomTemplate: vi.fn(async () => null) }));
vi.mock('@/lib/op-log', () => ({ logOperation: vi.fn(), logError: vi.fn(), OP_ACTIONS: {}, startTimer: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ getInternalRequestHeaders: vi.fn(async () => ({})) }));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: mocks.submit, getInternalApiUrl: (path: string) => path }));
vi.mock('@/lib/identify-subject', () => ({ identifyImageSubject: vi.fn() }));
vi.mock('@/lib/persist-result-image', () => ({ persistResultImage: vi.fn(async (url: string) => url) }));
vi.mock('@/lib/api-compatibility', () => ({
  resolveCompatProfile: () => ({}), resolveProfileForModel: () => ({ id: 'openai' }),
  adjustRequestForProfile: (body: unknown) => ({ body, endpoint: '/images/generations' }),
  parseResponseForProfile: (body: unknown) => body,
  isEditsEndpointRejected: () => false, isChannelUnavailableError: () => false,
}));
import { POST as brand } from '@/app/api/brand-ecommerce/route';
import { POST as refine } from '@/app/api/refine-engine/route';
import { POST as font } from '@/app/api/font-design/generate-image/route';

const provider = { id: 'image-test', name: 'Test provider', baseUrl: 'https://provider.example', apiKey: 'test-key', isEnabled: true, modelType: 'image', selectedModels: ['gpt-image-2'] };
const brandBody = { action: 'generate', templateIds: ['white-bg'], productDesc: 'Blue cup', model: 'gpt-image-2', providerId: provider.id };
const refineBody = { action: 'refine', imageUrl: 'data:image/png;base64,iVBORw0KGgo=', model: 'gpt-image-2', providerId: provider.id };
const fontBody = { prompt: 'Blue typography', model: 'gpt-image-2', providerId: provider.id };
function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ id: 'billing-test-user' });
  mocks.charge.mockResolvedValue({ success: true, cost: 12 });
  mocks.refund.mockResolvedValue({ success: true, balance: 1000 });
  mocks.provider.mockResolvedValue(provider);
  mocks.providers.mockResolvedValue([provider]);
  mocks.submit.mockResolvedValue(Response.json({ directImageUrls: ['/api/serve-upload/refined.png'] }));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected external request'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('image tool preflight rejects without charging', () => {
  it.each(['returns-false', 'throws'])('logs refine inner refund failure %s and preserves the provider error', async failure => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.submit.mockRejectedValue(new Error('Provider connection failed'));
    if (failure === 'throws') mocks.refund.mockRejectedValue(new Error('Refund database unavailable'));
    else mocks.refund.mockResolvedValue({ success: false, balance: 988 });
    const response = await refine(request(refineBody));
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining('Provider connection failed') });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith('billing-test-user', 12, expect.any(String));
    expect(errors.mock.calls.some(args => /Refund failed/.test(String(args[0])))).toBe(true);
  });
  it('does not refund again when refine inner failure response enters the outer catch', async () => {
    mocks.submit.mockRejectedValue(new Error('Provider connection failed'));
    vi.spyOn(NextResponse, 'json').mockImplementationOnce(() => { throw new Error('Response serialization failed'); });
    const response = await refine(request(refineBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'Response serialization failed' });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith('billing-test-user', 12, expect.any(String));
  });
  it('refunds refine synchronous provider failure once without hiding the business error', async () => {
    mocks.submit.mockRejectedValue(new Error('Provider connection failed'));
    const response = await refine(request(refineBody));
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining('Provider connection failed') });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith('billing-test-user', 12, expect.any(String));
  });
  it.each([
    ['brand', brand, brandBody], ['refine', refine, refineBody], ['font', font, fontBody],
  ] as const)('%s has no configured provider', async (_name, handler, body) => {
    mocks.provider.mockResolvedValue(null);
    mocks.providers.mockResolvedValue([]);
    const response = await handler(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it.each([
    ['brand missing model', brand, { ...brandBody, model: undefined }],
    ['brand invalid template', brand, { ...brandBody, templateIds: ['nonexistent-template'] }],
    ['refine missing model', refine, { ...refineBody, model: undefined }],
    ['font missing input', font, { model: fontBody.model }],
  ] as const)('%s', async (_name, handler, body) => {
    mocks.provider.mockResolvedValue({ ...provider, selectedModels: [] });
    const response = await handler(request(body));
    expect(response.status).toBe(400);
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});

describe.each([
  ['brand', brand, brandBody, 'image_generate'],
  ['refine', refine, refineBody, 'image_retouch'],
  ['font', font, fontBody, 'image_generate'],
] as const)('%s billing controls', (_name, handler, body, operation) => {
  it.each(['image-test::gpt-image-2', 'gpt-image-2-4k'])('retains original pricing model %s rather than its normalized API name', async model => {
    const response = await handler(request({ ...body, model }));
    expect(response.status).toBe(200);
    expect((await response.json()).error).toBeUndefined();
    expect(mocks.charge).toHaveBeenCalledExactlyOnceWith('billing-test-user', operation, undefined, undefined, model, { providerId: provider.id });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it('preserves successful task creation and charge arguments', async () => {
    const response = await handler(request(body));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ taskId: expect.any(String) });
    expect(data.error).toBeUndefined();
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.charge).toHaveBeenCalledExactlyOnceWith('billing-test-user', operation, undefined, undefined, 'gpt-image-2', { providerId: provider.id });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it('does not create a task or refund an unsuccessful charge', async () => {
    mocks.charge.mockResolvedValue({ success: false, cost: 12 });
    expect((await handler(request(body))).status).toBe(402);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it('refunds a synchronous task registration exception once', async () => {
    mocks.register.mockImplementation(() => { throw new Error('Registration unavailable'); });
    expect((await handler(request(body))).status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith('billing-test-user', 12, expect.any(String));
  });
  it('logs a refund business failure rather than treating it as success', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.register.mockImplementation(() => { throw new Error('Registration unavailable'); });
    mocks.refund.mockResolvedValue({ success: false, balance: 988 });
    expect((await handler(request(body))).status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.some(args => /Refund failed/.test(String(args[0])))).toBe(true);
  });
});

describe.each([
  ['brand', brand, brandBody, undefined], ['font', font, fontBody, ''],
] as const)('%s omitted pricing model', (_name, handler, body, expectedModel) => {
  it('preserves the original omitted-model price input while selecting the provider default', async () => {
    const response = await handler(request({ ...body, model: undefined }));
    expect(response.status).toBe(200);
    expect((await response.json()).error).toBeUndefined();
    expect(mocks.charge).toHaveBeenCalledExactlyOnceWith('billing-test-user', 'image_generate', undefined, undefined, expectedModel, { providerId: provider.id });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});
