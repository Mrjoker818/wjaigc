import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { execSql, isDatabaseConfigured } from '@/lib/db-client';
import { getServerDataRoot } from '@/lib/server-data-root';

const SAFE_EXPORT_PATH = /^exports\/[a-f0-9]{16}-[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|json|zip)$/u;
const SAFE_EXPORT_TEMP_PATH = /^exports\/\.[A-Za-z0-9._-]+\.(?:tmp|recover\.tmp)$/u;

export interface AssetCleanupOutboxRecord {
  id: string;
  targetHash: string;
  rootId: 'server-data';
  localPath?: string;
  storageKey?: string;
  status: 'pending' | 'processing' | 'completed';
  attemptCount: number;
  nextAttemptAt: Date;
  lastError: string;
  leaseToken?: string;
}

export interface AssetCleanupOutboxStore {
  enqueue(record: AssetCleanupOutboxRecord): Promise<void>;
  claim(limit: number, now: Date): Promise<AssetCleanupOutboxRecord[]>;
  complete(id: string, leaseToken: string): Promise<boolean>;
  retry(id: string, leaseToken: string, input: { lastError: string; nextAttemptAt: Date }): Promise<boolean>;
  hasAssetReference(input: { storageKey?: string; fileUrl?: string }): Promise<boolean>;
}

interface CleanupServiceDependencies {
  store: AssetCleanupOutboxStore;
  deleteS3(storageKey: string): Promise<void>;
  removeLocal(localPath: string, rootId: 'server-data'): Promise<void>;
}

export interface RecordAssetCleanupFailureInput {
  storageKey?: string;
  localPath?: string;
  rootId: 'server-data';
  lastError: string;
  nextAttemptAt?: Date;
}

function assertSafeTarget(input: Pick<RecordAssetCleanupFailureInput, 'storageKey' | 'localPath' | 'rootId'>): void {
  if (input.rootId !== 'server-data' || (!input.storageKey && !input.localPath)) {
    throw new TypeError('ASSET_CLEANUP_TARGET_INVALID');
  }
  if (input.storageKey && !SAFE_EXPORT_PATH.test(input.storageKey)) {
    throw new TypeError('ASSET_CLEANUP_STORAGE_KEY_INVALID');
  }
  if (input.localPath && !SAFE_EXPORT_PATH.test(input.localPath) && !SAFE_EXPORT_TEMP_PATH.test(input.localPath)) {
    throw new TypeError('ASSET_CLEANUP_LOCAL_PATH_INVALID');
  }
}

function targetHash(input: Pick<RecordAssetCleanupFailureInput, 'storageKey' | 'localPath' | 'rootId'>): string {
  return createHash('sha256').update(JSON.stringify({
    rootId: input.rootId,
    localPath: input.localPath ?? null,
    storageKey: input.storageKey ?? null,
  })).digest('hex');
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

export function createAssetCleanupOutboxService(dependencies: CleanupServiceDependencies) {
  return {
    async recordFailure(input: RecordAssetCleanupFailureInput): Promise<void> {
      assertSafeTarget(input);
      await dependencies.store.enqueue({
        id: randomUUID(),
        targetHash: targetHash(input),
        rootId: input.rootId,
        ...(input.localPath ? { localPath: input.localPath } : {}),
        ...(input.storageKey ? { storageKey: input.storageKey } : {}),
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: input.nextAttemptAt ?? new Date(),
        lastError: input.lastError.slice(0, 1000),
      });
    },

    async drain(input: { limit?: number; now?: Date } = {}): Promise<{ completed: number; failed: number }> {
      const now = input.now ?? new Date();
      const records = await dependencies.store.claim(Math.max(1, Math.min(input.limit ?? 10, 50)), now);
      let completed = 0;
      let failed = 0;
      for (const record of records) {
        if (!record.leaseToken) {
          failed += 1;
          continue;
        }
        try {
          assertSafeTarget(record);
          const referenced = await dependencies.store.hasAssetReference({
            storageKey: record.storageKey,
            fileUrl: record.localPath ? `/api/serve-upload/${record.localPath}` : undefined,
          });
          if (!referenced) {
            if (record.localPath) await dependencies.removeLocal(record.localPath, record.rootId);
            if (record.storageKey) await dependencies.deleteS3(record.storageKey);
          }
          if (await dependencies.store.complete(record.id, record.leaseToken)) completed += 1;
          else failed += 1;
        } catch (error) {
          const retained = await dependencies.store.retry(record.id, record.leaseToken, {
            lastError: safeError(error),
            nextAttemptAt: new Date(now.getTime() + Math.min(60 * 60_000, 1000 * (2 ** Math.min(record.attemptCount, 10)))),
          });
          if (!retained) {
            failed += 1;
            continue;
          }
          failed += 1;
        }
      }
      return { completed, failed };
    },
  };
}

const postgresStore: AssetCleanupOutboxStore = {
  async enqueue(record) {
    await execSql(
      `INSERT INTO wujie_asset_cleanup_outbox(
         id, target_hash, root_id, local_path, storage_key, status,
         attempt_count, next_attempt_at, last_error, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'pending', 0, $7, $6, NOW(), NOW())
       ON CONFLICT (target_hash) DO UPDATE SET
         status = CASE WHEN wujie_asset_cleanup_outbox.status = 'completed' THEN 'completed' ELSE 'pending' END,
         next_attempt_at = CASE WHEN wujie_asset_cleanup_outbox.status = 'completed' THEN wujie_asset_cleanup_outbox.next_attempt_at ELSE EXCLUDED.next_attempt_at END,
         last_error = EXCLUDED.last_error,
         updated_at = NOW()`,
      [record.id, record.targetHash, record.rootId, record.localPath ?? null, record.storageKey ?? null, record.lastError, record.nextAttemptAt],
    );
  },
  async claim(limit, now) {
    const result = await execSql(
      `WITH candidates AS (
         SELECT id FROM wujie_asset_cleanup_outbox
         WHERE status IN ('pending', 'processing') AND next_attempt_at <= $1
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE wujie_asset_cleanup_outbox item
       SET status = 'processing', attempt_count = item.attempt_count + 1,
           lease_token = gen_random_uuid(),
           next_attempt_at = $1::timestamptz + INTERVAL '5 minutes', updated_at = NOW()
       FROM candidates WHERE item.id = candidates.id
       RETURNING item.id, item.target_hash, item.root_id, item.local_path, item.storage_key,
                 item.status, item.attempt_count, item.next_attempt_at, item.last_error, item.lease_token`,
      [now, limit],
    );
    return result.rows.map(row => ({
      id: String(row.id), targetHash: String(row.target_hash), rootId: 'server-data' as const,
      ...(row.local_path ? { localPath: String(row.local_path) } : {}),
      ...(row.storage_key ? { storageKey: String(row.storage_key) } : {}),
      status: 'processing' as const, attemptCount: Number(row.attempt_count),
      nextAttemptAt: new Date(String(row.next_attempt_at)), lastError: String(row.last_error),
      leaseToken: String(row.lease_token),
    }));
  },
  async complete(id, leaseToken) {
    const result = await execSql(
      `UPDATE wujie_asset_cleanup_outbox
       SET status = 'completed', lease_token = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND lease_token = $2`,
      [id, leaseToken],
    );
    return result.rowCount === 1;
  },
  async retry(id, leaseToken, input) {
    const result = await execSql(
      `UPDATE wujie_asset_cleanup_outbox
       SET status = 'pending', lease_token = NULL, next_attempt_at = $3, last_error = $4, updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND lease_token = $2`,
      [id, leaseToken, input.nextAttemptAt, input.lastError],
    );
    return result.rowCount === 1;
  },
  async hasAssetReference(input) {
    const result = await execSql(
      `SELECT 1 FROM wujie_asset_versions
       WHERE ($1::text IS NOT NULL AND storage_key = $1)
          OR ($2::text IS NOT NULL AND file_url = $2)
       LIMIT 1`,
      [input.storageKey ?? null, input.fileUrl ?? null],
    );
    return result.rowCount > 0;
  },
};

async function removeLocalExport(localPath: string): Promise<void> {
  assertSafeTarget({ rootId: 'server-data', localPath });
  const root = path.resolve(getServerDataRoot());
  const exportsRoot = path.resolve(root, 'exports');
  const target = path.resolve(root, localPath);
  if (!target.startsWith(`${exportsRoot}${path.sep}`)) throw new TypeError('ASSET_CLEANUP_LOCAL_PATH_INVALID');
  await rm(target, { force: true });
}

function defaultService() {
  return createAssetCleanupOutboxService({
    store: postgresStore,
    deleteS3: async storageKey => {
      const { deleteBinaryFromS3Exact } = await import('@/lib/s3-storage');
      await deleteBinaryFromS3Exact(storageKey);
    },
    removeLocal: removeLocalExport,
  });
}

export async function recordAssetCleanupFailure(input: RecordAssetCleanupFailureInput): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error('ASSET_CLEANUP_OUTBOX_DATABASE_UNAVAILABLE');
  await defaultService().recordFailure(input);
}

export async function drainPendingAssetCleanup(input: { limit?: number; now?: Date } = {}): Promise<{ completed: number; failed: number }> {
  if (!isDatabaseConfigured()) return { completed: 0, failed: 0 };
  return defaultService().drain(input);
}
