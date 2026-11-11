import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), transport: vi.fn() }));
vi.mock('@/lib/server-auth', () => ({ requireAdminUser: async () => ({ id: 'test-admin', name: '测试管理员' }) }));
vi.mock('@/lib/db-storage', () => ({
  dbGetAuditLogs: mock.list,
  dbGetAuditLogById: mock.get,
  dbUpdateAuditLogResolution: mock.update,
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForFeature: async () => ({
    baseUrl: 'https://chat.example.invalid/v1', apiKey: 'test-only-token', selectedModels: ['synthetic-chat'],
  }),
}));

import { POST } from '@/app/api/admin/op-log/route';

const fixture = {
  id: 'test-audit', user_id: 'test-owner', user_name: '测试用户', created_at: 1,
  action: 'image_generate', level: 'error', response_status: 429, resolution_status: 'none',
  error_message: 'synthetic log-only detail', request_data: { prompt: 'synthetic request-only detail' },
};
const submit = () => POST(new NextRequest('http://localhost/api/admin/op-log', {
  method: 'POST', body: JSON.stringify({ action: 'analyze', logIds: [fixture.id] }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mock.list.mockResolvedValue({ logs: [fixture], total: 1 });
  mock.get.mockResolvedValue(fixture);
  mock.update.mockResolvedValue(true);
  vi.stubGlobal('fetch', mock.transport);
});
afterEach(() => vi.unstubAllGlobals());

describe('administrator operation log analysis', () => {
  it('loads the exact log and sends only diagnostic metadata in one request', async () => {
    mock.transport.mockResolvedValueOnce(Response.json({
      choices: [{ message: { content: JSON.stringify({ problemCategory: '限流' }) } }],
    }));
    const response = await submit();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, analysis: { problemCategory: '限流' } });
    expect(mock.get).toHaveBeenCalledExactlyOnceWith(fixture.id);
    expect(mock.list).not.toHaveBeenCalled();
    expect(mock.transport).toHaveBeenCalledExactlyOnceWith('https://chat.example.invalid/v1/chat/completions',
      expect.objectContaining({ method: 'POST', redirect: 'manual' }));
    const submitted = String(mock.transport.mock.calls[0][1].body);
    expect(submitted).toContain('429');
    for (const privateField of [fixture.user_id, fixture.error_message, fixture.request_data.prompt]) {
      expect(submitted).not.toContain(privateField);
    }
  });

  it('omits raw provider failures and does not submit again', async () => {
    mock.transport.mockResolvedValueOnce(new Response('synthetic provider-only detail', { status: 502 }));
    const response = await submit();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, error: 'AI分析请求失败 (HTTP 502)' });
    expect(mock.transport).toHaveBeenCalledOnce();
    expect(mock.update).not.toHaveBeenCalled();
  });
});
