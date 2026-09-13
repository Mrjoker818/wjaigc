import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createAssetCleanupOutboxService,
  type AssetCleanupOutboxRecord,
} from '@/lib/asset-core/cleanup-outbox';

describe('asset cleanup outbox', () => {
  it('accepts tightly scoped gateway image paths for durable cleanup retry', async () => {
    const store = {
      enqueue: vi.fn(async () => undefined), claim: vi.fn(async () => []),
      complete: vi.fn(async () => true), retry: vi.fn(async () => true),
      hasAssetReference: vi.fn(async () => false),
    };
    const service = createAssetCleanupOutboxService({
      store,
      deleteS3: vi.fn(),
      removeLocal: vi.fn(),
    });

    await expect(service.recordFailure({
      storageKey: 'images/gateway/task-1-0-0123456789ab.png',
      localPath: 'gateway/task-1-0-0123456789ab.png',
      rootId: 'server-data',
      lastError: 'delete unavailable',
    })).resolves.toBeUndefined();
    expect(store.enqueue).toHaveBeenCalledOnce();
  });

  it('persists a failed cleanup and a new service instance drains it after restart', async () => {
    const records = new Map<string, AssetCleanupOutboxRecord>();
    const store = {
      enqueue: vi.fn(async (record: AssetCleanupOutboxRecord) => { records.set(record.id, record); }),
      claim: vi.fn(async () => [...records.values()].filter(record => record.status !== 'completed').map(record => ({
        ...record, status: 'processing' as const, leaseToken: '00000000-0000-4000-8000-000000000099',
      }))),
      complete: vi.fn(async (id: string) => { records.set(id, { ...records.get(id)!, status: 'completed' as const }); return true; }),
      retry: vi.fn(async () => true),
      hasAssetReference: vi.fn(async () => false),
    };
    const first = createAssetCleanupOutboxService({ store, deleteS3: vi.fn(), removeLocal: vi.fn() });
    await first.recordFailure({
      storageKey: 'exports/0123456789abcdef-00000000-0000-4000-8000-000000000000-result.zip',
      localPath: 'exports/0123456789abcdef-00000000-0000-4000-8000-000000000000-result.zip',
      rootId: 'server-data',
      lastError: 'delete unavailable',
    });
    const deleteS3 = vi.fn(async () => undefined);
    const removeLocal = vi.fn(async () => undefined);
    const restarted = createAssetCleanupOutboxService({ store, deleteS3, removeLocal });
    await expect(restarted.drain({ limit: 10 })).resolves.toEqual({ completed: 1, failed: 0 });
    expect(deleteS3).toHaveBeenCalledOnce();
    expect(removeLocal).toHaveBeenCalledOnce();
    expect(store.complete).toHaveBeenCalledOnce();
  });

  it('defines a durable SQL table with retry state and safe target identity', async () => {
    const sql = [
      await readFile(resolve('migrations/20260909_mpe_export_cleanup_outbox.sql'), 'utf8'),
      await readFile(resolve('migrations/20260910_mpe_export_cleanup_leases.sql'), 'utf8'),
    ].join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS wujie_asset_cleanup_outbox');
    expect(sql).toContain('storage_key');
    expect(sql).toContain('local_path');
    expect(sql).toContain('root_id');
    expect(sql).toContain('attempt_count');
    expect(sql).toContain('next_attempt_at');
    expect(sql).toContain('last_error');
    expect(sql).toContain('lease_token');
    expect(sql).toContain("status IN ('pending', 'processing', 'completed')");
  });

  it('fences PostgreSQL completion and retry updates with the unpredictable lease token', async () => {
    const source = await readFile(resolve('src/lib/asset-core/cleanup-outbox.ts'), 'utf8');
    expect(source).toContain('lease_token = gen_random_uuid()');
    expect(source.match(/WHERE id = \$1 AND status = 'processing' AND lease_token = \$2/gu)).toHaveLength(2);
    expect(source).toContain('return result.rowCount === 1');
  });

  it('requeues the same artifact when cleanup fails again after an earlier completion', async () => {
    const source = await readFile(resolve('src/lib/asset-core/cleanup-outbox.ts'), 'utf8');
    const upsert = source.slice(
      source.indexOf('ON CONFLICT (target_hash) DO UPDATE SET'),
      source.indexOf('async claim(', source.indexOf('ON CONFLICT (target_hash) DO UPDATE SET')),
    );

    expect(upsert).toContain("status = 'pending'");
    expect(upsert).toContain('lease_token = NULL');
    expect(upsert).toContain('completed_at = NULL');
    expect(upsert).not.toContain("status = CASE WHEN wujie_asset_cleanup_outbox.status = 'completed'");
  });

  it('does not delete a target that has become referenced by an AssetVersion', async () => {
    const record: AssetCleanupOutboxRecord = {
      id: '00000000-0000-4000-8000-000000000001', targetHash: 'a'.repeat(64),
      rootId: 'server-data', status: 'processing', attemptCount: 1,
      nextAttemptAt: new Date(), lastError: 'prior failure',
      leaseToken: '00000000-0000-4000-8000-000000000001',
      storageKey: 'exports/0123456789abcdef-00000000-0000-4000-8000-000000000001-result.zip',
    };
    const store = {
      enqueue: vi.fn(), claim: vi.fn(async () => [record]), complete: vi.fn(async () => true),
      retry: vi.fn(), hasAssetReference: vi.fn(async () => true),
    };
    const deleteS3 = vi.fn();
    const service = createAssetCleanupOutboxService({ store, deleteS3, removeLocal: vi.fn() });
    await expect(service.drain()).resolves.toEqual({ completed: 1, failed: 0 });
    expect(deleteS3).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenCalledWith(record.id, record.leaseToken);
  });

  it('reschedules a failed drain with bounded backoff and preserves its error', async () => {
    const now = new Date('2026-09-09T00:00:00.000Z');
    const record: AssetCleanupOutboxRecord = {
      id: '00000000-0000-4000-8000-000000000002', targetHash: 'b'.repeat(64),
      rootId: 'server-data', status: 'processing', attemptCount: 2,
      nextAttemptAt: now, lastError: 'prior failure',
      leaseToken: '00000000-0000-4000-8000-000000000002',
      storageKey: 'exports/0123456789abcdef-00000000-0000-4000-8000-000000000002-result.zip',
    };
    const store = {
      enqueue: vi.fn(), claim: vi.fn(async () => [record]), complete: vi.fn(),
      retry: vi.fn(async () => true), hasAssetReference: vi.fn(async () => false),
    };
    const service = createAssetCleanupOutboxService({
      store, deleteS3: vi.fn(async () => { throw new Error('storage still unavailable'); }), removeLocal: vi.fn(),
    });
    await expect(service.drain({ now })).resolves.toEqual({ completed: 0, failed: 1 });
    expect(store.retry).toHaveBeenCalledWith(record.id, record.leaseToken, {
      lastError: 'storage still unavailable',
      nextAttemptAt: new Date(now.getTime() + 4000),
    });
  });

  it('does not let an expired old lease complete or retry work reclaimed by a new worker', async () => {
    const oldRecord: AssetCleanupOutboxRecord = {
      id: '00000000-0000-4000-8000-000000000003', targetHash: 'c'.repeat(64),
      rootId: 'server-data', status: 'processing', attemptCount: 1,
      nextAttemptAt: new Date('2026-09-09T00:00:00.000Z'), lastError: 'old',
      leaseToken: '00000000-0000-4000-8000-000000000010',
      storageKey: 'exports/0123456789abcdef-00000000-0000-4000-8000-000000000003-result.zip',
    };
    const currentLease = '00000000-0000-4000-8000-000000000011';
    const store = {
      enqueue: vi.fn(), claim: vi.fn(async () => [{ ...oldRecord, leaseToken: currentLease }]),
      complete: vi.fn(async (_id: string, leaseToken: string) => leaseToken === currentLease),
      retry: vi.fn(async (_id: string, leaseToken: string) => leaseToken === currentLease),
      hasAssetReference: vi.fn(async () => false),
    };
    const oldWorker = createAssetCleanupOutboxService({
      store: { ...store, claim: vi.fn(async () => [oldRecord]) },
      deleteS3: vi.fn(async () => undefined), removeLocal: vi.fn(),
    });
    await expect(oldWorker.drain()).resolves.toEqual({ completed: 0, failed: 1 });
    expect(store.complete).toHaveBeenCalledWith(oldRecord.id, oldRecord.leaseToken);
    expect(store.retry).not.toHaveBeenCalled();

    const newWorker = createAssetCleanupOutboxService({ store, deleteS3: vi.fn(), removeLocal: vi.fn() });
    await expect(newWorker.drain()).resolves.toEqual({ completed: 1, failed: 0 });
    expect(store.complete).toHaveBeenCalledWith(oldRecord.id, currentLease);
  });

  it('does not let an expired old lease retry over a newly claimed generation', async () => {
    const oldToken = '00000000-0000-4000-8000-000000000020';
    const currentToken = '00000000-0000-4000-8000-000000000021';
    const record: AssetCleanupOutboxRecord = {
      id: '00000000-0000-4000-8000-000000000004', targetHash: 'd'.repeat(64),
      rootId: 'server-data', status: 'processing', attemptCount: 2, nextAttemptAt: new Date(),
      lastError: 'old', leaseToken: oldToken,
      storageKey: 'exports/0123456789abcdef-00000000-0000-4000-8000-000000000004-result.zip',
    };
    const retry = vi.fn(async (_id: string, token: string) => token === currentToken);
    const store = {
      enqueue: vi.fn(), claim: vi.fn(async () => [record]), complete: vi.fn(), retry,
      hasAssetReference: vi.fn(async () => false),
    };
    const service = createAssetCleanupOutboxService({
      store, deleteS3: vi.fn(async () => { throw new Error('late failure'); }), removeLocal: vi.fn(),
    });
    await expect(service.drain()).resolves.toEqual({ completed: 0, failed: 1 });
    expect(retry).toHaveBeenCalledWith(record.id, oldToken, expect.any(Object));
  });
});
