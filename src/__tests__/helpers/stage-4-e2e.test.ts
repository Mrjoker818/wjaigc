import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureStage4Session,
  seedStage4Baseline,
  type Stage4AuthContext,
} from '../../../tests/helpers/stage-4-e2e';

function response(status: number, body: Record<string, unknown>) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    json: async () => body,
  };
}

describe('Stage 4 browser fixture auth isolation', () => {
  const fixture = {
    id: 'stage4-user-s4-run-chromium',
    browserProfile: 'chromium',
    username: 'stage4_chromium_s4_run',
    password: 'Stage4!s4-runchr',
  };

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed when E2E_TEST_USERNAME is not the run-scoped Stage 4 fixture user', async () => {
    vi.stubEnv('E2E_STAGE4_DATABASE_URL', 'postgresql://stage4_runner@127.0.0.1:5432/wujie_stage4_s4_run');
    vi.stubEnv('PGDATABASE_URL', 'postgresql://stage4_runner@127.0.0.1:5432/wujie_stage4_s4_run');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('E2E_STAGE4_RUN_ID', 's4-run');
    vi.stubEnv('E2E_TEST_USERNAME', 'Mr.joker');
    vi.stubEnv('E2E_TEST_PASSWORD', 'not-a-fixture');

    const clearCookies = vi.fn(async () => {});
    const get = vi.fn(async (url: string) => {
      if (url === '/api/auth/register') return response(200, { registrationEnabled: false });
      throw new Error(`Unexpected GET ${url}`);
    });
    const post = vi.fn(async () => {
      throw new Error('login should not be attempted for a non-disposable Stage 4 user');
    });

    await expect(ensureStage4Session({
      context: () => ({ clearCookies }),
      request: { get, post },
    } as never, fixture)).rejects.toThrow(/E2E_TEST_USERNAME must exactly match the run-scoped Stage 4 fixture user/i);

    expect(post).not.toHaveBeenCalled();
  });

  it('uses administrator credentials only to provision and then log into the disposable Stage 4 fixture user', async () => {
    vi.stubEnv('E2E_STAGE4_DATABASE_URL', 'postgresql://stage4_runner@127.0.0.1:5432/wujie_stage4_s4_run');
    vi.stubEnv('PGDATABASE_URL', 'postgresql://stage4_runner@127.0.0.1:5432/wujie_stage4_s4_run');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('E2E_STAGE4_RUN_ID', 's4-run');
    vi.stubEnv('WUJIE_ADMIN_USERNAME', 'Mr.joker');
    vi.stubEnv('WUJIE_ADMIN_PASSWORD', 'super-secret-admin-password');

    const clearCookies = vi.fn(async () => {});
    const get = vi.fn(async (url: string) => {
      if (url === '/api/auth/register') return response(200, { registrationEnabled: false });
      if (url === '/api/admin/users') return response(200, { success: true, users: [] });
      if (url === '/api/session') return response(200, { user: { id: 'fixture-user-1', name: fixture.username } });
      throw new Error(`Unexpected GET ${url}`);
    });
    const post = vi.fn(async (url: string, request: { data?: Record<string, unknown> }) => {
      if (url === '/api/auth/login' && request.data?.name === 'Mr.joker') {
        return response(200, { success: true });
      }
      if (url === '/api/admin/users') {
        expect(request.data).toMatchObject({
          action: 'create',
          name: fixture.username,
          password: fixture.password,
        });
        return response(200, { success: true, user: { id: 'fixture-user-1', name: fixture.username } });
      }
      if (url === '/api/auth/login' && request.data?.name === fixture.username) {
        return response(200, { success: true });
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    const auth = await ensureStage4Session({
      context: () => ({ clearCookies }),
      request: { get, post },
    } as never, fixture);

    expect(auth).toMatchObject({
      userId: 'fixture-user-1',
      username: fixture.username,
      strategy: 'admin-provisioned-login',
      disposable: true,
    });
    expect(clearCookies).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, '/api/auth/login', expect.objectContaining({
      data: expect.objectContaining({ name: 'Mr.joker' }),
    }));
    expect(post).toHaveBeenNthCalledWith(2, '/api/admin/users', expect.any(Object));
    expect(post).toHaveBeenNthCalledWith(3, '/api/auth/login', expect.objectContaining({
      data: expect.objectContaining({ name: fixture.username }),
    }));
    expect(post.mock.calls.some(([url]) => String(url).startsWith('/api/user-data/'))).toBe(false);
  });

  it('blocks before auth requests when the application database is absent or does not match the disposable fixture database', async () => {
    vi.stubEnv('E2E_STAGE4_DATABASE_URL', 'postgresql://stage4_runner@127.0.0.1:5432/wujie_stage4_s4_run');
    vi.stubEnv('E2E_STAGE4_RUN_ID', 's4-run');
    vi.stubEnv('PGDATABASE_URL', '');
    vi.stubEnv('DATABASE_URL', '');

    const clearCookies = vi.fn(async () => {});
    const get = vi.fn(async () => {
      throw new Error('auth reads must not run without an explicit isolated application database');
    });
    const post = vi.fn(async () => {
      throw new Error('auth writes must not run without an explicit isolated application database');
    });

    await expect(ensureStage4Session({
      context: () => ({ clearCookies }),
      request: { get, post },
    } as never, fixture)).rejects.toThrow(/application database URL .* required/i);

    expect(clearCookies).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses to seed persisted lists when the auth context is not a disposable Stage 4 fixture user', async () => {
    const get = vi.fn(async () => {
      throw new Error('user-data reads must not run for unsafe auth contexts');
    });
    const post = vi.fn(async () => {
      throw new Error('user-data writes must not run for unsafe auth contexts');
    });

    const unsafeAuth: Stage4AuthContext = {
      userId: 'admin-user',
      username: 'Mr.joker',
      strategy: 'admin-login',
      disposable: false,
    };

    await expect(seedStage4Baseline({
      request: { get, post },
    } as never, {
      browserProfile: 'chromium',
      username: fixture.username,
      canvasProject: { id: 'stage4-canvas-s4-run-chromium' },
      chatProject: { id: 'stage4-chat-s4-run-chromium' },
      nodeCount: 100,
    }, unsafeAuth)).rejects.toThrow(/requires a disposable, run-scoped Stage 4 fixture user/i);

    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('uses the server simple-chat revision when seeding the browser fixture', async () => {
    const get = vi.fn(async (url: string) => {
      if (url === '/api/user-data/sync?key=projects') {
        return response(200, { value: [], projectRevision: 4 });
      }
      if (url === '/api/user-data/sync?key=chat_simple_projects') {
        return response(200, { value: [], syncRevision: 7 });
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const post = vi.fn(async () => response(200, { success: true, projectRevision: 5 }));

    await seedStage4Baseline({
      request: { get, post },
    } as never, {
      browserProfile: 'chromium',
      username: fixture.username,
      canvasProject: { id: 'stage4-canvas-s4-run-chromium' },
      chatProject: {
        id: 'stage4-chat-s4-run-chromium',
        name: 'Stage 4 chat',
        tasks: [],
        agents: [],
        knowledgeItems: [],
      },
      nodeCount: 100,
    }, {
      userId: fixture.id,
      username: fixture.username,
      strategy: 'admin-provisioned-login',
      disposable: true,
    });

    expect(post).toHaveBeenNthCalledWith(2, '/api/user-data/sync', {
      data: expect.objectContaining({
        key: 'chat_simple_projects',
        expectedRevision: 7,
      }),
    });
  });
});
