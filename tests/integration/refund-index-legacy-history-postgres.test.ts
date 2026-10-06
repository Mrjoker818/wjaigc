import { describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { refundCredits } from '@/lib/credits';
import { createCloudTask, refundCloudTaskCredits, terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';
import { ensureRefundIdentityClaims } from '@/lib/refund-identity-claim';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

await vi.hoisted(async (): Promise<void> => {
  const { requireOfflineBridgeTestDatabaseUrl } = await import('../helpers/offline-bridge-database-guard');
  requireOfflineBridgeTestDatabaseUrl(process.env);
});

import { ensureCoreTables } from '@/lib/db-storage';

describe('legacy duplicate refund history at core-table initialization', () => {
  it('preserves duplicate legacy refunds while denying a third refund of that identity', async () => {
    await withIsolatedPostgres('task-refund-legacy-history', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      expect(schemaName).toMatch(/^test_task_refund_legacy_history_/);
      expect(new URL(databaseUrl).searchParams.get('options')).toContain(`search_path=${schemaName}`);
      await query(`CREATE TABLE wujie_credit_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        balance_after INTEGER DEFAULT 0,
        description TEXT,
        task_id TEXT DEFAULT '',
        reference_id TEXT DEFAULT '',
        created_at BIGINT NOT NULL
      )`);
      await query(`INSERT INTO wujie_credit_transactions
        (id, user_id, type, amount, balance_after, description, reference_id, created_at)
        VALUES
        ('legacy_refund_a', 'legacy_user', 'refund', 8, 100, 'historical refund', 'same_task', 1),
        ('legacy_refund_b', 'legacy_user', 'refund', 8, 108, 'historical duplicate', 'same_task', 2)`);

      await ensureCoreTables();
      expect((await query(`SELECT indexname FROM pg_indexes
        WHERE schemaname=current_schema()
          AND tablename='wujie_credit_transactions'
          AND indexname IN ('idx_credit_refund_task_lookup', 'idx_credit_refund_reference_lookup')
        ORDER BY indexname`)).rows).toEqual([
        { indexname: 'idx_credit_refund_reference_lookup' },
        { indexname: 'idx_credit_refund_task_lookup' },
      ]);
      await query(`INSERT INTO wujie_credits
        (id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        VALUES ('legacy_credit','legacy_user',100,100,0,1,1)`);
      expect((await query(`SELECT id, amount, reference_id FROM wujie_credit_transactions ORDER BY id`)).rows)
        .toEqual([
          { id: 'legacy_refund_a', amount: 8, reference_id: 'same_task' },
          { id: 'legacy_refund_b', amount: 8, reference_id: 'same_task' },
        ]);
      expect((await query(`SELECT identity FROM wujie_refund_identity_claims`)).rows)
        .toEqual([{ identity: 'same_task' }]);
      expect(await refundCredits('legacy_user', 8, 'historical replay', 'same_task'))
        .toEqual({ success: false, balance: 0 });
      expect((await query(`SELECT balance,total_used FROM wujie_credits WHERE user_id='legacy_user'`)).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
      await expect(query(`INSERT INTO wujie_credit_transactions
        (id, user_id, type, amount, reference_id, created_at)
        VALUES ('new_refund_duplicate', 'legacy_user', 'refund', 8, 'same_task', 3)`))
        .rejects.toMatchObject({ code: '23505', constraint: 'wujie_refund_identity_claims_pkey' });
      await query(`INSERT INTO wujie_credit_transactions
        (id, user_id, type, amount, reference_id, created_at)
        VALUES ('new_refund_distinct', 'legacy_user', 'refund', 8, 'new_task', 4)`);
      expect((await query(`SELECT identity FROM wujie_refund_identity_claims ORDER BY identity`)).rows)
        .toEqual([{ identity: 'new_task' }, { identity: 'same_task' }]);
    });
  }, 60_000);

  it('starts with duplicate historical ctx_refund task rows that also conflict with the older composite index', async () => {
    await withIsolatedPostgres('task-refund-legacy-ctx-history', async ({ query }): Promise<void> => {
      await query(`CREATE TABLE wujie_credit_transactions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
        amount INTEGER NOT NULL, balance_after INTEGER DEFAULT 0,
        description TEXT, task_id TEXT DEFAULT '', reference_id TEXT DEFAULT '',
        created_at BIGINT NOT NULL
      )`);
      await query(`INSERT INTO wujie_credit_transactions
        (id, user_id, type, amount, task_id, reference_id, created_at)
        VALUES
        ('ctx_refund_old_a', 'legacy_user', 'refund', 8, 'same_task', 'same_task', 1),
        ('ctx_refund_old_b', 'legacy_user', 'refund', 8, 'same_task', 'same_task', 2)`);
      await ensureCoreTables();
      expect((await query(`SELECT id FROM wujie_credit_transactions ORDER BY id`)).rows)
        .toEqual([{ id: 'ctx_refund_old_a' }, { id: 'ctx_refund_old_b' }]);
      expect((await query(`SELECT identity FROM wujie_refund_identity_claims`)).rows)
        .toEqual([{ identity: 'same_task' }]);
    });
  }, 60_000);

  it('allows only one new refund identity across independent concurrent connections', async () => {
    await withIsolatedPostgres('task-refund-concurrent-claim', async ({ query, databaseUrl }): Promise<void> => {
      await ensureCoreTables();
      const first = new Client({ connectionString: databaseUrl });
      const second = new Client({ connectionString: databaseUrl });
      await Promise.all([first.connect(), second.connect()]);
      try {
        const insert = (client: Client, id: string): Promise<unknown> => client.query(
          `INSERT INTO wujie_credit_transactions
           (id,user_id,type,amount,task_id,reference_id,created_at)
           VALUES ($1,'legacy_user','refund',8,'concurrent_task','concurrent_task',1)`,
          [id],
        );
        const outcomes = await Promise.allSettled([
          insert(first, 'ctx_refund_concurrent_a'),
          insert(second, 'ctx_refund_concurrent_b'),
        ]);
        expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter(outcome => outcome.status === 'rejected')).toMatchObject([
          { reason: { code: '23505', constraint: 'wujie_refund_identity_claims_pkey' } },
        ]);
        expect((await query(`SELECT count(*)::integer AS count FROM wujie_credit_transactions
          WHERE type='refund' AND task_id='concurrent_task'`)).rows).toEqual([{ count: 1 }]);
        expect((await query(`SELECT identity FROM wujie_refund_identity_claims`)).rows)
          .toEqual([{ identity: 'concurrent_task' }]);
      } finally {
        await Promise.all([first.end(), second.end()]);
      }
    });
  }, 60_000);

  it('blocks identity-changing updates but leaves anonymous refunds and same-identity updates valid', async () => {
    await withIsolatedPostgres('task-refund-identity-update', async ({ query }): Promise<void> => {
      await ensureCoreTables();
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,type,amount,reference_id,created_at) VALUES
        ('refund_a','legacy_user','refund',8,'task_a',1),
        ('refund_b','legacy_user','refund',8,'task_b',2),
        ('refund_anonymous','legacy_user','refund',8,'',3)`);
      await expect(query(`UPDATE wujie_credit_transactions SET reference_id='task_a'
        WHERE id='refund_b'`)).rejects.toMatchObject({
        code: '23505', constraint: 'wujie_refund_identity_claims_pkey',
      });
      await query(`UPDATE wujie_credit_transactions SET reference_id='task_b'
        WHERE id='refund_b'`);
      expect((await query(`SELECT id,reference_id FROM wujie_credit_transactions ORDER BY id`)).rows)
        .toEqual([
          { id: 'refund_a', reference_id: 'task_a' },
          { id: 'refund_anonymous', reference_id: '' },
          { id: 'refund_b', reference_id: 'task_b' },
        ]);
      expect((await query(`SELECT identity FROM wujie_refund_identity_claims ORDER BY identity`)).rows)
        .toEqual([{ identity: 'task_a' }, { identity: 'task_b' }]);
    });
  }, 60_000);

  it('does not mark a cloud task refunded when the legacy ledger contains two matching rows', async () => {
    await withIsolatedPostgres('task-refund-legacy-cloud-ambiguity', async ({ query }): Promise<void> => {
      await query(`CREATE TABLE wujie_credit_transactions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
        amount INTEGER NOT NULL, balance_after INTEGER DEFAULT 0,
        description TEXT, task_id TEXT DEFAULT '', reference_id TEXT DEFAULT '',
        created_at BIGINT NOT NULL
      )`);
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,type,amount,reference_id,created_at) VALUES
        ('legacy_duplicate_a','legacy_user','refund',8,'ambiguous_task',1),
        ('legacy_duplicate_b','legacy_user','refund',8,'ambiguous_task',2)`);
      await ensureCoreTables();
      await query(`INSERT INTO wujie_credits
        (id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        VALUES ('ambiguous_credit','legacy_user',92,100,8,1,1)`);
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,type,amount,task_id,created_at)
        VALUES ('ctx_charge_ambiguous','legacy_user','consume',-8,'ambiguous_task',3)`);
      expect(await createCloudTask({
        id: 'ambiguous_task', userId: 'legacy_user', type: 'generate',
        status: 'processing', progress: 0, creditStatus: 'pending', creditCost: 8,
        chargedTransactionId: 'ctx_charge_ambiguous', createdAt: 3, updatedAt: 3,
      })).toBe(true);

      await expect(refundCloudTaskCredits('ambiguous_task', 'ambiguous refund'))
        .rejects.toMatchObject({ code: '23505', constraint: 'wujie_refund_identity_claims_pkey' });
      await expect(terminateCloudTaskAndRefund('ambiguous_task', 'failed', 'provider failed'))
        .rejects.toMatchObject({ code: '23505', constraint: 'wujie_refund_identity_claims_pkey' });
      expect((await query(`SELECT balance,total_used FROM wujie_credits WHERE user_id='legacy_user'`)).rows)
        .toEqual([{ balance: 92, total_used: 8 }]);
      expect((await query(`SELECT status,credit_status FROM cloud_tasks WHERE id='ambiguous_task'`)).rows)
        .toEqual([{ status: 'processing', credit_status: 'pending' }]);
      expect((await query(`SELECT id FROM wujie_credit_transactions WHERE type='refund' ORDER BY id`)).rows)
        .toEqual([{ id: 'legacy_duplicate_a' }, { id: 'legacy_duplicate_b' }]);
    });
  }, 60_000);

  it('does not lock and rescan the ledger after the refund claim trigger is already installed', async () => {
    await withIsolatedPostgres('task-refund-repeat-startup', async ({ databaseUrl }): Promise<void> => {
      await ensureCoreTables();
      const writer = new Client({ connectionString: databaseUrl });
      await writer.connect();
      await writer.query('BEGIN');
      await writer.query('LOCK TABLE wujie_credit_transactions IN ROW EXCLUSIVE MODE');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const repeat = ensureRefundIdentityClaims();
      let result: 'ready' | 'waiting';
      try {
        result = await Promise.race([
          repeat.then(() => 'ready' as const),
          new Promise<'waiting'>(resolve => {
            timer = setTimeout(() => resolve('waiting'), 1_200);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        await writer.query('ROLLBACK');
        await writer.end();
      }
      await repeat;
      expect(result).toBe('ready');
    });
  }, 60_000);

  it('retains the unique charge task guard on a fresh schema', async () => {
    await withIsolatedPostgres('task-refund-charge-guard', async ({ query }): Promise<void> => {
      await ensureCoreTables();
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,type,amount,task_id,created_at)
        VALUES ('ctx_charge_first','legacy_user','consume',-8,'charge_task',1)`);
      await expect(query(`INSERT INTO wujie_credit_transactions
        (id,user_id,type,amount,task_id,created_at)
        VALUES ('ctx_charge_second','legacy_user','consume',-8,'charge_task',2)`))
        .rejects.toMatchObject({ code: '23505', constraint: 'idx_credit_tx_charge_task_once' });
      expect((await query(`SELECT id FROM wujie_credit_transactions WHERE task_id='charge_task'`)).rows)
        .toEqual([{ id: 'ctx_charge_first' }]);
    });
  }, 60_000);

  it('does not reconcile one matching refund when another account also used that historical identity', async () => {
    await withIsolatedPostgres('task-refund-mixed-history', async ({ query }): Promise<void> => {
      await query(`CREATE TABLE wujie_credit_transactions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
        amount INTEGER NOT NULL, balance_after INTEGER DEFAULT 0,
        description TEXT, task_id TEXT DEFAULT '', reference_id TEXT DEFAULT '',
        created_at BIGINT NOT NULL
      )`);
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,type,amount,reference_id,created_at) VALUES
        ('legacy_matching','legacy_user','refund',8,'mixed_task',1),
        ('legacy_foreign','other_user','refund',9,'mixed_task',2)`);
      await ensureCoreTables();
      await query(`INSERT INTO wujie_credits
        (id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        VALUES ('mixed_credit','legacy_user',92,100,8,1,1)`);
      await query(`INSERT INTO wujie_credit_transactions
        (id,user_id,type,amount,task_id,created_at)
        VALUES ('ctx_charge_mixed','legacy_user','consume',-8,'mixed_task',3)`);
      expect(await createCloudTask({
        id: 'mixed_task', userId: 'legacy_user', type: 'generate',
        status: 'processing', progress: 0, creditStatus: 'pending', creditCost: 8,
        chargedTransactionId: 'ctx_charge_mixed', createdAt: 3, updatedAt: 3,
      })).toBe(true);

      await expect(terminateCloudTaskAndRefund('mixed_task', 'failed', 'provider failed'))
        .rejects.toMatchObject({ code: '23505', constraint: 'wujie_refund_identity_claims_pkey' });
      expect((await query(`SELECT status,credit_status FROM cloud_tasks WHERE id='mixed_task'`)).rows)
        .toEqual([{ status: 'processing', credit_status: 'pending' }]);
      expect((await query(`SELECT balance,total_used FROM wujie_credits WHERE user_id='legacy_user'`)).rows)
        .toEqual([{ balance: 92, total_used: 8 }]);
      expect((await query(`SELECT id FROM wujie_credit_transactions WHERE type='refund' ORDER BY id`)).rows)
        .toEqual([{ id: 'legacy_foreign' }, { id: 'legacy_matching' }]);
    });
  }, 60_000);

  it('refuses an enabled lookalike trigger that does not claim refund identities', async () => {
    await withIsolatedPostgres('task-refund-bogus-trigger', async ({ query }): Promise<void> => {
      await ensureCoreTables();
      await query(`CREATE FUNCTION bogus_refund_claim() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NEW; END $$`);
      await query('DROP TRIGGER trg_wujie_claim_refund_identity ON wujie_credit_transactions');
      await query(`CREATE TRIGGER trg_wujie_claim_refund_identity
        BEFORE INSERT OR UPDATE ON wujie_credit_transactions
        FOR EACH ROW EXECUTE FUNCTION bogus_refund_claim()`);
      await expect(ensureRefundIdentityClaims())
        .rejects.toThrow('Refund identity claim table, primary key, or trigger is not active');
    });
  }, 60_000);
});
