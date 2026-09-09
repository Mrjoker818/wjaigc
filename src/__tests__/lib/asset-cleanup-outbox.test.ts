import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createAssetCleanupOutboxService,
  type AssetCleanupOutboxRecord,
} from '@/lib/asset-core/cleanup-outbox';

describe('asset cleanup outbox', () => {
  it('persists a failed cleanup and a new service instance drains it after restart', async () => {
    const records = new Map<string, AssetCleanupOutboxRecord>();
    const store = {
      enqueue: vi.fn(async (record: AssetCleanupOutboxRecord) => { records.set(record.id, record); }),
      claim: vi.fn(async () => [...records.values()].filter(record => record.status !== 'completed')),
      complete: vi.fn(async (id: string) => { records.set(id, { ...records.get(id)!, status: 'completed' as const }); }),
      retry: vi.fn(async () => undefined),
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
    const sql = await readFile(resolve('migrations/20260909_mpe_export_cleanup_outbox.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS wujie_asset_cleanup_outbox');
    expect(sql).toContain('storage_key');
    expect(sql).toContain('local_path');
    expect(sql).toContain('root_id');
    expect(sql).toContain('attempt_count');
    expect(sql).toContain('next_attempt_at');
    expect(sql).toContain('last_error');
    expect(sql).toContain("status IN ('pending', 'processing', 'completed')");
  });

  it('does not delete a target that has become referenced by an AssetVersion', async () => {
    const record: AssetCleanupOutboxRecord = {
      id: '00000000-0000-4000-8000-000000000001', targetHash: 'a'.repeat(64),
      rootId: 'server-data', status: 'processing', attemptCount: 1,
      nextAttemptAt: new Date(), lastError: 'prior failure',
      storageKey: 'exports/0123456789abcdef-00000000-0000-4000-8000-000000000001-result.zip',
    };
    const store = {
      enqueue: vi.fn(), claim: vi.fn(async () => [record]), complete: vi.fn(async () => undefined),
      retry: vi.fn(), hasAssetReference: vi.fn(async () => true),
    };
    const deleteS3 = vi.fn();
    const service = createAssetCleanupOutboxService({ store, deleteS3, removeLocal: vi.fn() });
    await expect(service.drain()).resolves.toEqual({ completed: 1, failed: 0 });
    expect(deleteS3).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenCalledWith(record.id);
  });

  it('reschedules a failed drain with bounded backoff and preserves its error', async () => {
    const now = new Date('2026-09-09T00:00:00.000Z');
    const record: AssetCleanupOutboxRecord = {
      id: '00000000-0000-4000-8000-000000000002', targetHash: 'b'.repeat(64),
      rootId: 'server-data', status: 'processing', attemptCount: 2,
      nextAttemptAt: now, lastError: 'prior failure',
      storageKey: 'exports/0123456789abcdef-00000000-0000-4000-8000-000000000002-result.zip',
    };
    const store = {
      enqueue: vi.fn(), claim: vi.fn(async () => [record]), complete: vi.fn(),
      retry: vi.fn(async () => undefined), hasAssetReference: vi.fn(async () => false),
    };
    const service = createAssetCleanupOutboxService({
      store, deleteS3: vi.fn(async () => { throw new Error('storage still unavailable'); }), removeLocal: vi.fn(),
    });
    await expect(service.drain({ now })).resolves.toEqual({ completed: 0, failed: 1 });
    expect(store.retry).toHaveBeenCalledWith(record.id, {
      lastError: 'storage still unavailable',
      nextAttemptAt: new Date(now.getTime() + 4000),
    });
  });
});
