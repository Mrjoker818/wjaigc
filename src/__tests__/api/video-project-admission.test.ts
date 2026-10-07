import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ active: false, provider: vi.fn(), query: vi.fn(), task: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: async () => ({ videoGenerationEnabled: true, maxVideoDuration: 60 }) }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: async () => ({ user: { id: 'actor-a', status: 'active' }, source: 'session' }), getInternalRequestHeaders: () => ({}) }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => ({ id: 'actor-a', status: 'active' }) }));
vi.mock('@/lib/server-api-config', () => ({ findProviderById: state.provider, findProviderForModel: state.provider, findProviderForFeature: state.provider }));
vi.mock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true, getPool: () => ({ connect: async () => ({ query: state.query, release: vi.fn() }) }) }));
vi.mock('@/lib/cloud-task-storage', async original => ({ ...await original<typeof import('@/lib/cloud-task-storage')>(), getCloudTaskForUser: state.task }));
vi.mock('@/lib/collaboration/document-media-import', () => ({ publishDocumentTaskOutput: state.publish }));
vi.mock('@/lib/op-log', () => ({ startTimer: () => ({ end: () => 0 }), logError: vi.fn(), logOperation: vi.fn(), OP_ACTIONS: {} }));
import { POST as generate } from '@/app/api/video/generate/route';
import { POST as extend } from '@/app/api/video/extend/route';

beforeEach(() => {
  vi.clearAllMocks(); state.active = false;
  state.provider.mockResolvedValue(null);
  state.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT status FROM wujie_users')
    ? [{ status: state.active ? 'active' : 'disabled' }] : [], rowCount: 0 }));
});
describe('real video routes project authorization', () => {
  it.each([
    { userId: 'other-actor', projectId: 'project-a', type: 'video', status: 'completed' },
    { userId: 'actor-a', projectId: 'other-project', type: 'video', status: 'completed' },
    { userId: 'actor-a', projectId: 'project-a', type: 'generate', status: 'completed' },
    { userId: 'actor-a', projectId: 'project-a', type: 'video', status: 'processing' },
  ])('refuses a foreign/incomplete task without importing a URL', async identity => {
    state.task.mockResolvedValue({ id: 'video-task', ...identity });
    const response = await generate(new NextRequest('http://localhost/api/video/generate', { method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-wujie-expected-actor-id': 'actor-a' },
      body: JSON.stringify({ action: 'publish-canvas-task', taskId: 'video-task', projectId: 'project-a' }) }));
    expect(response.status).toBe(403);
    expect(state.publish).not.toHaveBeenCalled();
  });
  it('publishes the owned completed video through the existing canonical task importer', async () => {
    state.task.mockResolvedValue({ id: 'video-task', userId: 'actor-a', projectId: 'project-a', type: 'video', status: 'completed',
      result: { submissionPayload: { videoCanvasAdmission: { access: { kind: 'document' } } } } });
    state.publish.mockResolvedValue({ placementId: 'placement-result', assetVersionId: 'version-result', documentSequence: 7,
      assetReference: { entityId: 'result', assetId: 'asset-result', assetVersionId: 'version-result', placementId: 'placement-result', kind: 'video', url: '/result.mp4' } });
    const response = await generate(new NextRequest('http://localhost/api/video/generate', { method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-wujie-expected-actor-id': 'actor-a' },
      body: JSON.stringify({ action: 'publish-canvas-task', taskId: 'video-task', projectId: 'project-a' }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).documentSequence).toBe(7);
    expect(state.publish).toHaveBeenCalledWith('actor-a', 'video-task', 0, expect.any(AbortSignal));
  });
  it.each([['generate', generate], ['extend', extend]] as const)('%s refuses inactive actor/project before provider selection or task billing', async (route, post) => {
    const response = await post(new NextRequest('http://localhost/api/video/' + route, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'scene', model: 'video-model', projectId: 'project-a', videoUrl: '/api/serve-upload/source.mp4' }),
    }));
    expect(response.status).toBe(403);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it.each([['generate', generate], ['extend', extend]] as const)('%s preserves unscoped personal provider selection', async (route, post) => {
    const response = await post(new NextRequest('http://localhost/api/video/' + route, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'scene', model: 'video-model', videoUrl: '/api/serve-upload/source.mp4' }),
    }));
    expect(response.status).toBe(404);
    expect(state.provider).toHaveBeenCalled();
    expect(state.query).not.toHaveBeenCalled();
  });
});
