import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({
  baseUrl: 'https://venue.invalid',
  update: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: async () => [{
  id: 'venue-provider', name: 'Synthetic venue', baseUrl: fixture.baseUrl, apiKey: 'fixture-secret',
  type: 'chat', modelType: 'chat', isEnabled: true, selectedModels: ['fixture-vision'],
}] }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => ({ id: 'venue-user', role: 'admin', status: 'active' }) }));
vi.mock('@/lib/task-registry', () => ({ registerTask: vi.fn(), updateTaskProgress: fixture.update }));

import { POST as analyze } from '@/app/api/activity-venue/analyze/route';
import { POST as proposals } from '@/app/api/activity-venue/proposals/route';

describe.each([
  ['analyze', analyze, { venueImageUrl: 'https://source.invalid/venue.png' }],
  ['proposals', proposals, { venueAnalysis: { regions: [] }, activityBrief: { eventName: 'Synthetic' } }],
] as const)('venue %s one-shot submission', (path, post, input) => {
  const request = () => new NextRequest(`https://app.invalid/api/activity-venue/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, providerId: 'venue-provider', model: 'fixture-vision' }),
  });

  beforeEach(() => {
    fixture.baseUrl = 'https://venue.invalid';
    fixture.update.mockClear();
    fixture.fetch.mockReset().mockRejectedValue(new Error('unexpected provider request'));
    vi.stubGlobal('fetch', fixture.fetch);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    [503, 'fixture-secret upstream failure'],
    [200, '<html>fixture-secret</html>'],
    [200, '{"id":"fixture-secret"}'],
    [307, 'fixture-secret redirect'],
  ])('records an unconfirmed receipt after a single HTTP %s', async (status, body) => {
    fixture.fetch.mockResolvedValueOnce(new Response(body, { status, headers: { location: 'https://other.invalid' } }));
    const response = await post(request());
    expect(response.status).toBe(200);
    const { taskId } = await response.json();
    await vi.waitFor(() => expect(fixture.update).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'failed', result: { venueSubmissionUnconfirmed: true }, error: expect.stringContaining(taskId),
    })));
    expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith('https://venue.invalid/chat/completions', expect.objectContaining({
      method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(fixture.update.mock.calls)).not.toContain('fixture-secret');
  });

  it('preserves the configured version and maps a definite denial to a safe failure', async () => {
    fixture.baseUrl = 'https://venue.invalid/v1/';
    fixture.fetch.mockResolvedValueOnce(new Response('fixture-secret unauthorized', { status: 401 }));
    const { taskId } = await (await post(request())).json();
    await vi.waitFor(() => expect(fixture.update).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'failed', error: expect.stringContaining('401'),
    })));
    expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith('https://venue.invalid/v1/chat/completions', expect.anything());
    expect(JSON.stringify(fixture.update.mock.calls)).not.toMatch(/fixture-secret|venueSubmissionUnconfirmed/);
  });

  it('bounds the dispatch and records an aborted response as unconfirmed', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    fixture.fetch.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('fixture-secret timeout')), { once: true });
    }));
    const { taskId } = await (await post(request())).json();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledTimes(1));
    expect(timeout).toHaveBeenCalledWith(60_000);
    controller.abort();
    await vi.waitFor(() => expect(fixture.update).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'failed', result: { venueSubmissionUnconfirmed: true },
    })));
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fixture.update.mock.calls)).not.toContain('fixture-secret');
  });
});
