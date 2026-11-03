import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

const state = vi.hoisted(() => ({ pools: [] as Array<{ on: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> }));
vi.mock('pg', () => ({ Pool: class {
  on = vi.fn(); end = vi.fn(async () => {});
  constructor() { state.pools.push(this); }
} }));
const resolverKey = Symbol.for('wujie.documentRequestPoolScope.v1');
type ScopeGlobal = typeof globalThis & { [resolverKey]?: (pool: Pool) => Pool };
const scopeGlobal = globalThis as ScopeGlobal;
let original: ScopeGlobal[typeof resolverKey];
beforeEach(() => {
  vi.resetModules(); original = scopeGlobal[resolverKey]; delete scopeGlobal[resolverKey]; state.pools.length = 0;
  vi.stubEnv('DATABASE_URL', 'postgresql://synthetic@127.0.0.1:1/stage7_not_connected'); vi.stubEnv('PGDATABASE_URL', '');
});
afterEach(async () => {
  delete scopeGlobal[resolverKey]; await (await import('@/lib/db-client')).closePool();
  if (original) scopeGlobal[resolverKey] = original;
  vi.unstubAllEnvs(); vi.restoreAllMocks();
});
describe('db-client optional document execution scope', () => {
  it('preserves raw pool identity and cache when no scope provider is installed', async () => {
    const db = await import('@/lib/db-client'); const first = db.getPool();
    expect(first).toBe(state.pools[0]); expect(db.getPool()).toBe(first); expect(state.pools).toHaveLength(1);
  });
  it('uses the provider only for the current business pool view', async () => {
    const db = await import('@/lib/db-client'), raw = db.getPool(), view = Object.create(raw) as Pool;
    const resolve = vi.fn(() => view); scopeGlobal[resolverKey] = resolve;
    expect(db.getPool()).toBe(view); expect(resolve).toHaveBeenCalledWith(raw);
    expect(state.pools).toHaveLength(1);
    delete scopeGlobal[resolverKey]; expect(db.getPool()).toBe(raw);
  });
  it('never bypasses a provider rejection by returning an unguarded pool', async () => {
    const db = await import('@/lib/db-client'); scopeGlobal[resolverKey] = () => { throw Error('controlled expired scope'); };
    expect(() => db.getPool()).toThrow('controlled expired scope');
  });
  it('shares the optional provider and original registry across evaluated source copies', async () => {
    const first = await import('@/lib/db-client'), raw = first.getPool(), view = Object.create(raw) as Pool;
    scopeGlobal[resolverKey] = (pool: Pool): Pool => { expect(pool).toBe(raw); return view; };
    vi.resetModules(); const second = await import('@/lib/db-client');
    expect(first.getPool()).toBe(view); expect(second.getPool()).toBe(view); expect(state.pools).toHaveLength(1);
  });
  it('keeps the lifecycle registry owner and advisory pool outside the business view', async () => {
    const db = await import('@/lib/db-client'), raw = db.getPool(); const projectedEnd = vi.fn();
    const view = new Proxy(raw, { get(target, key, receiver): unknown { return key === 'end' ? projectedEnd : Reflect.get(target, key, receiver); } });
    const resolve = vi.fn(() => view); scopeGlobal[resolverKey] = resolve;
    const advisory = db.getAdvisoryLockPool(); expect(resolve).not.toHaveBeenCalled(); expect(advisory).not.toBe(raw);
    expect(db.getPool()).toBe(view); await db.closePool();
    expect(projectedEnd).not.toHaveBeenCalled(); expect(state.pools[0].end).toHaveBeenCalledOnce(); expect(state.pools[1].end).toHaveBeenCalledOnce();
  });
});
