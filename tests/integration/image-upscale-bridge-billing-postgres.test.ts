import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

await vi.hoisted(async (): Promise<void> => {
  const { requireOfflineBridgeTestDatabaseUrl } = await import('../helpers/offline-bridge-database-guard');
  requireOfflineBridgeTestDatabaseUrl(process.env);
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: async (request: Request): Promise<User | null> => request.headers.get('x-test-actor') === 'bridge-owner'
    ? { id: 'bridge-owner', name: 'Bridge owner', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 } as User
    : null,
  getAuthSecretForInternalRequests: (): string => 'offline-upscale-bridge-secret-at-least-32',
}));
vi.mock('@/lib/image-tools/upscayl', () => ({
  performOnnxUpscale: async (): Promise<never> => { throw new Error('Unexpected local upscale'); },
}));

import { POST as upscalePost } from '@/app/api/image/upscale/route';
import { POST as legacyUpscaylPost } from '@/app/api/upscayl/route';
import { ensureCoreTables } from '@/lib/db-storage';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { createCloudTask, refundCloudTaskCredits, terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';

async function seed(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  if (!schemaName.startsWith('test_task_image_upscale_bridge_')
    || !new URL(databaseUrl).searchParams.get('options')?.includes(`search_path=${schemaName}`)) {
    throw new Error('Expected isolated bridge schema');
  }
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', timeout: 45_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(migration.status, `${migration.stdout}\n${migration.stderr}\n${migration.error || ''}`).toBe(0);
  await ensureCoreTables();
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('bridge-owner','Bridge owner','test','active','user',1,1)`);
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    VALUES ('bridge-credit','bridge-owner',100,100,0,1,1)`);
}

describe('AI upscale compatibility billing bridge', () => {
  it('does not deduct credits when the consume ledger insert fails', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-consume-rollback', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query(`CREATE FUNCTION block_consume_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.type = 'consume' THEN RAISE EXCEPTION 'isolated consume insert fault'; END IF;
        RETURN NEW; END $$`);
      await query(`CREATE TRIGGER block_consume_insert BEFORE INSERT ON wujie_credit_transactions
        FOR EACH ROW EXECUTE FUNCTION block_consume_insert()`);
      const consume = await consumeCredits('bridge-owner', 'image_upscale', 8, 'offline bridge consume');
      expect(consume.success).toBe(false);
      const credits = await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'");
      expect(credits.rows).toEqual([{ balance: 100, total_used: 0 }]);
      const transactions = await query('SELECT type,amount FROM wujie_credit_transactions');
      expect(transactions.rows).toEqual([]);
    });
  }, 60_000);

  it('atomically restores balance and records one refund with real PostgreSQL', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query("UPDATE wujie_credits SET balance=92,total_used=8 WHERE user_id='bridge-owner'");
      const refund = await refundCredits('bridge-owner', 8, 'offline bridge refund', 'bridge-request');
      expect(refund).toEqual({ success: true, balance: 100 });
      const credits = await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'");
      expect(credits.rows).toEqual([{ balance: 100, total_used: 0 }]);
      const transactions = await query('SELECT type,amount,balance_after,reference_id FROM wujie_credit_transactions');
      expect(transactions.rows).toEqual([{ type: 'refund', amount: 8, balance_after: 100, reference_id: 'bridge-request' }]);
    });
  }, 60_000);

  it('refunds a charged task only once when the same task is retried concurrently', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-once', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      expect(await consumeCredits('bridge-owner', 'image_upscale', 8, 'offline task charge'))
        .toMatchObject({ success: true, balance: 92, cost: 8 });
      const refunds = await Promise.all([
        refundCredits('bridge-owner', 8, 'offline task refund', 'bridge-task-once'),
        refundCredits('bridge-owner', 8, 'offline task refund', 'bridge-task-once'),
      ]);
      expect(refunds).toEqual([{ success: true, balance: 100 }, { success: true, balance: 100 }]);
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'")).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
      expect((await query("SELECT amount,task_id,reference_id FROM wujie_credit_transactions WHERE type='refund'")).rows)
        .toEqual([{ amount: 8, task_id: 'bridge-task-once', reference_id: 'bridge-task-once' }]);
    });
  }, 60_000);

  it('rejects a replay that changes the refund amount for the same task', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-conflict', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      expect(await consumeCredits('bridge-owner', 'image_upscale', 8, 'offline task charge'))
        .toMatchObject({ success: true, balance: 92, cost: 8 });
      expect(await refundCredits('bridge-owner', 8, 'offline task refund', 'bridge-task-conflict'))
        .toEqual({ success: true, balance: 100 });
      expect(await refundCredits('bridge-owner', 7, 'changed task refund', 'bridge-task-conflict'))
        .toEqual({ success: false, balance: 0 });
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'")).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
      expect((await query("SELECT amount FROM wujie_credit_transactions WHERE type='refund'")).rows)
        .toEqual([{ amount: 8 }]);
    });
  }, 60_000);

  it('rejects a zero-amount replay of an already refunded task', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-zero-replay', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query("UPDATE wujie_credits SET balance=92,total_used=8 WHERE user_id='bridge-owner'");
      expect(await refundCredits('bridge-owner', 8, 'offline task refund', 'bridge-task-zero'))
        .toEqual({ success: true, balance: 100 });
      expect(await refundCredits('bridge-owner', 0, 'changed task refund', 'bridge-task-zero'))
        .toEqual({ success: false, balance: 0 });
      expect((await query("SELECT amount FROM wujie_credit_transactions WHERE type='refund'")).rows)
        .toEqual([{ amount: 8 }]);
    });
  }, 60_000);

  it('rejects another account reusing an existing refund task reference', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-foreign-owner', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
        VALUES ('bridge-other','Other','test','active','user',1,1)`);
      await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        VALUES ('bridge-other-credit','bridge-other',100,100,0,1,1)`);
      await query("UPDATE wujie_credits SET balance=92,total_used=8 WHERE user_id='bridge-owner'");
      expect(await refundCredits('bridge-owner', 8, 'owner refund', 'bridge-task-owned'))
        .toEqual({ success: true, balance: 100 });
      expect(await refundCredits('bridge-other', 8, 'foreign replay', 'bridge-task-owned'))
        .toEqual({ success: false, balance: 0 });
      expect((await query("SELECT balance FROM wujie_credits WHERE user_id='bridge-other'")).rows)
        .toEqual([{ balance: 100 }]);
    });
  }, 60_000);

  it('enforces a shared refund ledger key across generic and cloud task writers', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-shared-key', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,amount,type,balance_after,description,task_id,reference_id,created_at)
        VALUES ('ctx_refund_generic','bridge-owner',8,'refund',100,'generic refund','bridge-task-shared','bridge-task-shared',1)`);
      await expect(query(`INSERT INTO wujie_credit_transactions
        (id,user_id,amount,type,balance_after,description,task_id,reference_id,created_at)
        VALUES ('ctx_cloud_refund','bridge-owner',8,'refund',108,'cloud refund','bridge-task-shared','bridge-task-shared',2)`))
        .rejects.toMatchObject({ code: '23505' });
      expect((await query("SELECT id FROM wujie_credit_transactions WHERE type='refund'")).rows)
        .toEqual([{ id: 'ctx_refund_generic' }]);
    });
  }, 60_000);

  it('enforces the refund key when an earlier writer only stored reference_id', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-legacy-key', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,amount,type,balance_after,description,reference_id,created_at)
        VALUES ('ctx_legacy_shared','bridge-owner',8,'refund',100,'legacy refund','bridge-task-legacy-key',1)`);
      await expect(query(`INSERT INTO wujie_credit_transactions
        (id,user_id,amount,type,balance_after,description,task_id,reference_id,created_at)
        VALUES ('ctx_cloud_shared','bridge-owner',8,'refund',108,'cloud refund','bridge-task-legacy-key','bridge-task-legacy-key',2)`))
        .rejects.toMatchObject({ code: '23505' });
      expect((await query("SELECT id FROM wujie_credit_transactions WHERE type='refund'")).rows)
        .toEqual([{ id: 'ctx_legacy_shared' }]);
    });
  }, 60_000);

  it('reconciles a cloud task after its generic refund already committed', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-cloud-reconcile', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      expect(await consumeCredits('bridge-owner', 'image_upscale', 8, 'offline task charge'))
        .toMatchObject({ success: true, balance: 92, cost: 8 });
      const charge = await query("SELECT id FROM wujie_credit_transactions WHERE type='consume'");
      expect(await createCloudTask({
        id: 'bridge-task-cloud-reconcile', userId: 'bridge-owner', type: 'generate',
        status: 'processing', progress: 0, creditStatus: 'pending', creditCost: 8,
        chargedTransactionId: String(charge.rows[0]?.id),
        createdAt: 1, updatedAt: 1,
      })).toBe(true);
      expect(await refundCredits('bridge-owner', 8, 'generic refund', 'bridge-task-cloud-reconcile'))
        .toEqual({ success: true, balance: 100 });

      expect(await refundCloudTaskCredits('bridge-task-cloud-reconcile', 'cloud refund'))
        .toMatchObject({ refunded: true, creditCost: 8, balance: 100, userId: 'bridge-owner' });
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'")).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
      expect((await query("SELECT credit_status,refunded_transaction_id FROM cloud_tasks WHERE id='bridge-task-cloud-reconcile'")).rows)
        .toEqual([{ credit_status: 'refunded', refunded_transaction_id: expect.stringMatching(/^ctx_refund_/) }]);
      expect((await query("SELECT amount FROM wujie_credit_transactions WHERE task_id='bridge-task-cloud-reconcile' AND type='refund'")).rows)
        .toEqual([{ amount: 8 }]);
    });
  }, 60_000);

  it('terminates a cloud task after its generic refund already committed without paying twice', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-terminal-refund-reconcile', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      expect(await consumeCredits('bridge-owner', 'image_upscale', 8, 'offline task charge'))
        .toMatchObject({ success: true, balance: 92, cost: 8 });
      const charge = await query("SELECT id FROM wujie_credit_transactions WHERE type='consume'");
      expect(await createCloudTask({
        id: 'bridge-task-terminal-reconcile', userId: 'bridge-owner', type: 'generate',
        status: 'processing', progress: 0, creditStatus: 'pending', creditCost: 8,
        chargedTransactionId: String(charge.rows[0]?.id), createdAt: 1, updatedAt: 1,
      })).toBe(true);
      expect(await refundCredits('bridge-owner', 8, 'generic refund', 'bridge-task-terminal-reconcile'))
        .toEqual({ success: true, balance: 100 });

      expect(await terminateCloudTaskAndRefund('bridge-task-terminal-reconcile', 'failed', 'provider failed'))
        .toMatchObject({ status: 'failed', transitioned: true, refunded: true, creditCost: 8, balance: 100 });
      expect((await query("SELECT status,credit_status,refunded_transaction_id FROM cloud_tasks WHERE id='bridge-task-terminal-reconcile'")).rows)
        .toEqual([{ status: 'failed', credit_status: 'refunded', refunded_transaction_id: expect.stringMatching(/^ctx_refund_/) }]);
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'")).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
      expect((await query("SELECT amount FROM wujie_credit_transactions WHERE type='refund' AND task_id='bridge-task-terminal-reconcile'")).rows)
        .toEqual([{ amount: 8 }]);
    });
  }, 60_000);

  it('reconciles a generic refund that commits after cloud termination began waiting on the task', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-race', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      expect(await consumeCredits('bridge-owner', 'image_upscale', 8, 'offline task charge'))
        .toMatchObject({ success: true, balance: 92, cost: 8 });
      const charge = await query("SELECT id FROM wujie_credit_transactions WHERE type='consume'");
      const taskId = 'bridge-task-refund-race';
      expect(await createCloudTask({
        id: taskId, userId: 'bridge-owner', type: 'generate', status: 'processing',
        progress: 0, creditStatus: 'pending', creditCost: 8,
        chargedTransactionId: String(charge.rows[0]?.id), createdAt: 1, updatedAt: 1,
      })).toBe(true);

      const locker = new Client({ connectionString: databaseUrl });
      await locker.connect();
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE', [taskId]);
      const terminal = terminateCloudTaskAndRefund(taskId, 'failed', 'provider failed')
        .then(value => ({ kind: 'success' as const, value }), error => ({ kind: 'error' as const, error }));
      try {
        let observedBlocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const blocked = await query(`SELECT count(*)::integer AS count FROM pg_stat_activity
            WHERE datname=current_database() AND wait_event_type='Lock'
              AND query LIKE '%WITH candidate AS (%'`);
          if (Number(blocked.rows[0]?.count) > 0) { observedBlocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        expect(observedBlocked).toBe(true);
        expect(await refundCredits('bridge-owner', 8, 'generic refund', taskId))
          .toEqual({ success: true, balance: 100 });
      } finally {
        await locker.query('ROLLBACK');
        await locker.end();
      }
      const settled = await terminal;
      if (settled.kind === 'error') throw settled.error;
      expect(settled.value).toMatchObject({ status: 'failed', refunded: true, balance: 100 });
      expect((await query(`SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'`)).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
      expect((await query(`SELECT id FROM wujie_credit_transactions WHERE type='refund' AND task_id=$1`, [taskId])).rows)
        .toHaveLength(1);
    });
  }, 60_000);

  it('reconciles an earlier reference-only refund without paying a cloud task twice', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-cloud-legacy', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      expect(await consumeCredits('bridge-owner', 'image_upscale', 8, 'offline task charge'))
        .toMatchObject({ success: true, balance: 92, cost: 8 });
      const charge = await query("SELECT id FROM wujie_credit_transactions WHERE type='consume'");
      expect(await createCloudTask({
        id: 'bridge-task-cloud-legacy', userId: 'bridge-owner', type: 'generate',
        status: 'processing', progress: 0, creditStatus: 'pending', creditCost: 8,
        chargedTransactionId: String(charge.rows[0]?.id),
        createdAt: 1, updatedAt: 1,
      })).toBe(true);
      await query("UPDATE wujie_credits SET balance=100,total_used=0 WHERE user_id='bridge-owner'");
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,amount,type,balance_after,description,reference_id,created_at)
        VALUES ('ctx_legacy_cloud_refund','bridge-owner',8,'refund',100,'legacy refund','bridge-task-cloud-legacy',1)`);

      expect(await refundCloudTaskCredits('bridge-task-cloud-legacy', 'cloud refund'))
        .toMatchObject({ refunded: true, creditCost: 8, balance: 100, userId: 'bridge-owner' });
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'")).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
      expect((await query("SELECT credit_status,refunded_transaction_id FROM cloud_tasks WHERE id='bridge-task-cloud-legacy'")).rows)
        .toEqual([{ credit_status: 'refunded', refunded_transaction_id: 'ctx_legacy_cloud_refund' }]);
      expect((await query("SELECT id FROM wujie_credit_transactions WHERE type='refund'")).rows)
        .toEqual([{ id: 'ctx_legacy_cloud_refund' }]);
    });
  }, 60_000);

  it('does not refund a completed cloud task whose charge is still pending settlement', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-completed-refund-barrier', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      expect(await consumeCredits('bridge-owner', 'image_upscale', 8, 'offline task charge'))
        .toMatchObject({ success: true, balance: 92, cost: 8 });
      const charge = await query("SELECT id FROM wujie_credit_transactions WHERE type='consume'");
      expect(await createCloudTask({
        id: 'bridge-task-completed', userId: 'bridge-owner', type: 'generate',
        status: 'completed', progress: 100, creditStatus: 'pending', creditCost: 8,
        chargedTransactionId: String(charge.rows[0]?.id), createdAt: 1, updatedAt: 1,
      })).toBe(true);

      expect(await refundCloudTaskCredits('bridge-task-completed', 'late cloud refund'))
        .toEqual({ refunded: false, creditCost: 0 });
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'")).rows)
        .toEqual([{ balance: 92, total_used: 8 }]);
      expect((await query("SELECT credit_status FROM cloud_tasks WHERE id='bridge-task-completed'")).rows)
        .toEqual([{ credit_status: 'pending' }]);
      expect((await query("SELECT id FROM wujie_credit_transactions WHERE type='refund'")).rows)
        .toEqual([]);
    });
  }, 60_000);

  it('does not reconcile a refund against a cloud task with no linked charge', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-without-charge', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      expect(await createCloudTask({
        id: 'bridge-task-no-charge', userId: 'bridge-owner', type: 'generate',
        status: 'processing', progress: 0, creditStatus: 'pending', creditCost: 8,
        createdAt: 1, updatedAt: 1,
      })).toBe(true);
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,amount,type,balance_after,description,task_id,reference_id,created_at)
        VALUES ('ctx_refund_unlinked','bridge-owner',8,'refund',100,'unlinked refund','bridge-task-no-charge','bridge-task-no-charge',2)`);

      await expect(refundCloudTaskCredits('bridge-task-no-charge', 'cloud refund'))
        .rejects.toThrow();
      expect((await query("SELECT credit_status,refunded_transaction_id FROM cloud_tasks WHERE id='bridge-task-no-charge'")).rows)
        .toEqual([{ credit_status: 'pending', refunded_transaction_id: '' }]);
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'")).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
    });
  }, 60_000);

  it('does not repay a task already refunded by the earlier reference-only ledger format', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-legacy-refund', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,amount,type,balance_after,description,reference_id,created_at)
        VALUES ('ctx_legacy_refund','bridge-owner',8,'refund',100,'legacy refund','bridge-task-legacy',1)`);
      const replay = await refundCredits('bridge-owner', 8, 'retry legacy refund', 'bridge-task-legacy');
      expect(replay).toEqual({ success: true, balance: 100 });
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'")).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
      expect((await query("SELECT id FROM wujie_credit_transactions WHERE type='refund'")).rows)
        .toEqual([{ id: 'ctx_legacy_refund' }]);
    });
  }, 60_000);

  it('rolls back the balance when the refund ledger insert fails', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-refund-rollback', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query("UPDATE wujie_credits SET balance=92,total_used=8 WHERE user_id='bridge-owner'");
      await query(`CREATE FUNCTION block_refund_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.type = 'refund' THEN RAISE EXCEPTION 'isolated refund insert fault'; END IF;
        RETURN NEW; END $$`);
      await query(`CREATE TRIGGER block_refund_insert BEFORE INSERT ON wujie_credit_transactions
        FOR EACH ROW EXECUTE FUNCTION block_refund_insert()`);
      const refund = await refundCredits('bridge-owner', 8, 'offline bridge refund', 'bridge-request');
      expect(refund.success).toBe(false);
      const credits = await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'");
      expect(credits.rows).toEqual([{ balance: 92, total_used: 8 }]);
      const transactions = await query('SELECT type,amount FROM wujie_credit_transactions');
      expect(transactions.rows).toEqual([]);
    });
  }, 60_000);

  it('does not precharge AI upscale and preserves its authenticated caller', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
      try {
        const response = await upscalePost(new NextRequest('http://localhost/api/image/upscale', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'bridge-owner' },
          body: JSON.stringify({ imageUrl: 'https://media.invalid/source.png', upscaleMode: 'ai', scale: 2 }),
        }));
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(500);
        expect(await response.json()).toMatchObject({ code: 'IMAGE_EDIT_MODEL_UNAVAILABLE' });
        const credits = await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'");
        expect(credits.rows).toEqual([{ balance: 100, total_used: 0 }]);
        const transactions = await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY created_at,id');
        expect(transactions.rows).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  }, 60_000);

  it('does not lose the authenticated actor when the legacy upscayl alias delegates AI mode', async () => {
    await withIsolatedPostgres('task-image-upscale-bridge-legacy-alias', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
      try {
        const response = await legacyUpscaylPost(new NextRequest('http://localhost/api/upscayl', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'bridge-owner' },
          body: JSON.stringify({ imageUrl: 'https://media.invalid/source.png', upscaleMode: 'ai', scale: 2 }),
        }));
        const credits = await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='bridge-owner'");
        expect(credits.rows).toEqual([{ balance: 100, total_used: 0 }]);
        const transactions = await query('SELECT type,amount FROM wujie_credit_transactions');
        expect(transactions.rows).toEqual([]);
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(500);
        expect(await response.json()).toMatchObject({ code: 'IMAGE_EDIT_MODEL_UNAVAILABLE' });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  }, 60_000);

});
