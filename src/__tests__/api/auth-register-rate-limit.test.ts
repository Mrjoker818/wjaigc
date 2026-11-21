import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(), create: vi.fn(), token: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: mocks.settings }));
vi.mock('@/lib/server-auth', () => ({
  createManagedUser: mocks.create, createSessionToken: mocks.token,
  WUJIE_SESSION_COOKIE: 'wujie_session', WUJIE_SESSION_TTL_SECONDS: 3600,
}));
vi.mock('@/lib/db-storage', () => ({ dbAddAuditLog: mocks.audit }));

describe('registration failure budget', () => {
  let post: typeof import('@/app/api/auth/register/route').POST;
  const input = { name: 'acceptance_user', password: 'synthetic-password', confirmPassword: 'synthetic-password' };
  const request = (ip: string, body = input): NextRequest => new NextRequest('https://register.invalid/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
  });
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-21T06:00:00Z'));
    mocks.settings.mockResolvedValue({ registrationEnabled: true });
    mocks.create.mockRejectedValue(new Error('user already exists'));
    mocks.token.mockResolvedValue('synthetic-session'); mocks.audit.mockResolvedValue(undefined);
    post = (await import('@/app/api/auth/register/route')).POST;
  });
  afterEach(() => { vi.useRealTimers(); });

  it('locks one IP after five creation failures without creating a sixth user', async () => {
    for (let i = 0; i < 5; i++) expect((await post(request('192.0.2.10'))).status).toBe(409);
    const blocked = await post(request('192.0.2.10'));
    expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBe('60');
    expect(blocked.headers.get('x-ratelimit-limit')).toBe('5');
    expect(mocks.create).toHaveBeenCalledTimes(5); expect(mocks.token).not.toHaveBeenCalled();
    expect((await post(request('192.0.2.11'))).status).toBe(409);
    expect(mocks.create).toHaveBeenCalledTimes(6);
  });

  it('retains validation failures across requests and expires only an actual lock', async () => {
    for (let i = 0; i < 5; i++) expect((await post(request('192.0.2.12', { ...input, name: 'root' }))).status).toBe(400);
    vi.setSystemTime(Date.now() + 59999);
    const blocked = await post(request('192.0.2.12'));
    expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBe('1');
    expect(mocks.create).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 1);
    expect((await post(request('192.0.2.12'))).status).toBe(409);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('clears the failure budget after a successful registration and preserves secure login', async () => {
    for (let i = 0; i < 4; i++) expect((await post(request('192.0.2.13'))).status).toBe(409);
    const user = { id: 'synthetic-user', name: input.name, role: 'user' };
    mocks.create.mockResolvedValueOnce(user);
    const success = await post(request('192.0.2.13'));
    expect(success.status).toBe(200); expect((await success.json()).user).toEqual(user);
    expect(success.headers.get('set-cookie')).toContain('HttpOnly');
    expect(success.headers.get('set-cookie')).toContain('Secure');
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) expect((await post(request('192.0.2.13'))).status).toBe(409);
    expect((await post(request('192.0.2.13'))).status).toBe(429);
    expect(mocks.create).toHaveBeenCalledTimes(10);
  });
});
