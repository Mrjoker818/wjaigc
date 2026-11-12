import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbGetApiProviders: vi.fn(),
  dbUpsertApiProvider: vi.fn(),
  dbDeleteApiProvider: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-storage', () => mocks);

import { discoverModelsForCredentials } from '@/lib/server-api-config';

describe('model list denial explanation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbGetApiProviders.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('explains an insufficient-balance rejection with balances instead of raw English text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                '[token_id=34296] insufficient balance (current: 0.048426 USD, required: 0.050000 USD). Please top up to continue',
            },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const result = await discoverModelsForCredentials('https://apimart.ai/v1', 'sk-new-key', 'universal');

    expect(result.models).toEqual([]);
    expect(result.message).toContain('账户余额不足');
    expect(result.message).toContain('0.048426');
    expect(result.message).toContain('0.050000');
    expect(result.message).toContain('生成功能可能仍然正常');
    expect(result.message).not.toContain('insufficient balance');
  });

  it('keeps the generic reachable message for non-quota rejections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const result = await discoverModelsForCredentials('https://apimart.ai/v1', 'sk-bad-key', 'universal');

    expect(result.success).toBe(true);
    expect(result.message).toContain('API 可达但模型列表不可用');
    expect(result.message).toContain('invalid api key');
    expect(result.message).not.toContain('账户余额不足');
  });
});
