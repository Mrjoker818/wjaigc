import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn().mockResolvedValue({
    'x-internal-request': 'true',
    'x-internal-user-id': 'user-1',
    'x-wujie-internal-secret': 'test-secret',
  }),
}));

import { executeToolCall } from '@/lib/chat-tools';

const toolContext = {
  chatApiKey: 'test-key',
  chatBaseUrl: 'https://example.com',
  origin: 'https://app.example.com',
  userId: 'user-1',
  imageModel: 'model-image',
  imageProviderId: 'provider-image',
};

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('chat tool awaits its own task result', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the finished image to the model instead of a bare task id', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/generate')) {
        return jsonResponse({
          success: true,
          taskId: 'task-1',
          model: 'model-image',
          providerId: 'provider-image',
        });
      }
      if (url.endsWith('/api/poll-task')) {
        return jsonResponse({
          success: true,
          status: 'completed',
          imageUrl: 'https://cdn.example.com/finished.png',
          imageUrls: ['https://cdn.example.com/finished.png'],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const pending = executeToolCall('generate_image', { prompt: 'a studio product photo' }, toolContext);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.imageUrls).toEqual(['https://cdn.example.com/finished.png']);
    expect(result.taskIds ?? []).toHaveLength(0);
    expect(result.resultText).toContain('https://cdn.example.com/finished.png');
    expect(fetcher.mock.calls.some(([called]) => String(called).endsWith('/api/poll-task'))).toBe(true);
  });
});
