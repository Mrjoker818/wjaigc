import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

vi.mock('server-only', () => ({}));

const originalEnvironment = { ...process.env };
let temporaryDataDir: string | null = null;

beforeEach(() => {
  vi.resetModules();
  delete process.env.DATABASE_URL;
  delete process.env.PGDATABASE_URL;
});

afterEach(async () => {
  if (temporaryDataDir) {
    await rm(temporaryDataDir, { recursive: true, force: true });
    temporaryDataDir = null;
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  vi.resetModules();
});

describe.sequential('server authentication production security', () => {
  it('uses the baseline stable session secret when a production authentication secret is missing', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.PGDATABASE_URL;

    const systemDir = path.join(temporaryDataDir, 'system');
    const password = 'baseline-existing-admin-password';
    await mkdir(systemDir, { recursive: true });
    await writeFile(path.join(systemDir, 'users.json'), JSON.stringify({
      users: [{
        id: 'admin_mr_joker',
        name: 'Mr.joker',
        passwordHash: createHash('sha256').update(`wujie-ai-stable-auth-secret-fallback-2024:${password}`).digest('hex'),
        role: 'admin',
        status: 'active',
        productType: 'canvas,chat',
        apiPermissions: { image: true, chat: true },
        storageFolder: 'admin_mr_joker',
        createdAt: 1,
        updatedAt: 1,
      }],
      updatedAt: 1,
    }), 'utf8');

    const { authenticateUser, createSessionToken, getSessionUser, WUJIE_SESSION_COOKIE } = await import('@/lib/server-auth');
    const user = await authenticateUser({
      name: 'Mr.joker',
      password,
      productType: 'canvas',
    });
    expect(user).not.toBeNull();
    const token = await createSessionToken(user!);
    const request = {
      cookies: {
        get: (name: string): { value: string } | undefined => name === WUJIE_SESSION_COOKIE ? { value: token } : undefined,
      },
    };

    await expect(getSessionUser(request as never)).resolves.toMatchObject({
      id: 'admin_mr_joker',
      role: 'admin',
    });
    expect(user).toMatchObject({
      id: 'admin_mr_joker',
      role: 'admin',
    });
    expect(token).toContain('.');
  });

  it('uses the baseline administrator password when a production bootstrap password is missing', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = 'test-production-auth-secret-at-least-32-characters';
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.WUJIE_ADMIN_PASSWORD;
    process.env.WUJIE_ADMIN_USERNAME = 'bootstrap-admin';

    const { authenticateUser } = await import('@/lib/server-auth');

    await expect(authenticateUser({
      name: 'bootstrap-admin',
      password: 'dongdong851212',
      productType: 'canvas',
    })).resolves.toMatchObject({
      name: 'bootstrap-admin',
      role: 'admin',
      productType: 'canvas,chat',
    });
  });

  it('authenticates an existing administrator with the persisted production secret after redeploy', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    const systemDir = path.join(temporaryDataDir, 'system');
    const persistedSecret = 'persisted-production-auth-secret-at-least-32-characters';
    const password = 'existing-admin-password';

    await mkdir(systemDir, { recursive: true });
    await writeFile(path.join(systemDir, 'auth-secret'), persistedSecret, 'utf8');
    await writeFile(path.join(systemDir, 'users.json'), JSON.stringify({
      users: [{
        id: 'admin_mr_joker',
        name: 'Mr.joker',
        passwordHash: createHash('sha256').update(`${persistedSecret}:${password}`).digest('hex'),
        role: 'admin',
        status: 'active',
        productType: 'canvas,chat',
        apiPermissions: { image: true, chat: true },
        storageFolder: 'admin_mr_joker',
        createdAt: 1,
        updatedAt: 1,
      }],
      updatedAt: 1,
    }), 'utf8');

    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_ADMIN_USERNAME = 'Mr.joker';
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.WUJIE_ADMIN_PASSWORD;

    const { authenticateUser } = await import('@/lib/server-auth');

    await expect(authenticateUser({
      name: 'Mr.joker',
      password,
      productType: 'canvas',
    })).resolves.toMatchObject({
      id: 'admin_mr_joker',
      name: 'Mr.joker',
      role: 'admin',
    });
  });

  it('authorizes a newly bootstrapped administrator for the canvas product', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = 'test-production-auth-secret-at-least-32-characters';
    process.env.WUJIE_ADMIN_USERNAME = 'bootstrap-admin';
    process.env.WUJIE_ADMIN_PASSWORD = 'bootstrap-password';

    const { authenticateUser } = await import('@/lib/server-auth');

    await expect(authenticateUser({
      name: 'bootstrap-admin',
      password: 'bootstrap-password',
      productType: 'canvas',
    })).resolves.toMatchObject({
      name: 'bootstrap-admin',
      role: 'admin',
      productType: 'canvas,chat',
    });
  });

});
