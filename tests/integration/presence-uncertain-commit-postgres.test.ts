import { readFile } from 'node:fs/promises';

import { Client, type PoolClient, type QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

import { runPostgresCleanup, withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
type Fault = 'lost-ack-signal' | 'lost-ack-no-signal' | 'commit-rejected' | 'duplicate-id' | 'compensation-rejected';
interface BackendIdentity { pid: number; backend_start: string; datname: string; usename: string }

async function setupDatabase(query: QueryFn): Promise<void> {
  for (const path of [
    'migrations/20260809_wj_core_users.sql', 'migrations/20260810_wj_stable_s2_assets.sql',
    'migrations/20260924_project_presence.sql', 'migrations/20260924_project_presence_tickets.sql',
    'migrations/20260924_project_presence_ttl_leases.sql',
  ]) await query(await readFile(path, 'utf8'));
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','test','active',1,1), ('member','Member','test','active',1,1)`);
  await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('project','owner','Project')");
  await query(`INSERT INTO wujie_project_presence_members (project_id,owner_id,member_user_id)
    VALUES ('project','owner','member')`);
}

function allErrors(error: unknown): unknown[] {
  if (error instanceof AggregateError) return [error, ...error.errors.flatMap(allErrors)];
  if (error instanceof Error && error.cause !== undefined) return [error, ...allErrors(error.cause)];
  return [error];
}

async function verifyUncertainCommit(fault: Fault): Promise<void> {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  await withIsolatedPostgres(`presence-uncertain-${fault}`, async ({ query }) => {
    await setupDatabase(query);
    const { getPool } = await import('../../src/lib/db-client');
    const { joinPresence } = await import('../../src/lib/collaboration/presence-leases');
    const { PresenceConnectionCleanupError } = await import('../../src/lib/collaboration/presence-connection');
    const pool = getPool();
    const controller = new AbortController();
    let healthy: (Client & PoolClient) | undefined;
    let bodyError: unknown;
    let bodyFailed = false;
    const lostAck = new Error(`controlled delivery failure AFTER actual PostgreSQL COMMIT (${fault})`);
    let commitObserved = false;
    let commitAttempted = false;
    const joinClients = new Set<Client>();
    let joinIdentity: BackendIdentity | undefined;
    let visibleAtLostAck: string[] | undefined;
    try {
      // A real other connection's lease must survive every branch.
      await joinPresence({ connectionId: 'survivor', userId: 'member', projectId: 'project', instanceId: 'one' });
      const checkout = await pool.connect();
      if (!(checkout instanceof Client)) { checkout.release(true); throw new Error('Native healthy checkout required'); }
      healthy = checkout;
      const healthyIdentity = (await healthy.query<BackendIdentity>(
        'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
      )).rows[0];
      expect((await healthy.query<{ statement: string; lock: string }>(
        "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock",
      )).rows[0]).toEqual({ statement: '0', lock: '0' });

      if (fault === 'commit-rejected') {
        // The actual database rejects COMMIT via an initially deferred trigger.
        await query(`CREATE FUNCTION reject_target_commit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.connection_id='target' THEN
            RAISE EXCEPTION 'actual deferred presence COMMIT rejection' USING ERRCODE='23514';
          END IF; RETURN NEW; END $$`);
        await query(`CREATE CONSTRAINT TRIGGER reject_target_commit AFTER INSERT ON wujie_presence_leases
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_target_commit()`);
      }
      if (fault === 'compensation-rejected') {
        await query(`CREATE FUNCTION reject_target_delete() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF OLD.connection_id='target' THEN
            RAISE EXCEPTION 'actual presence compensation DELETE rejection' USING ERRCODE='22012';
          END IF; RETURN OLD; END $$`);
        await query(`CREATE TRIGGER reject_target_delete BEFORE DELETE ON wujie_presence_leases
          FOR EACH ROW EXECUTE FUNCTION reject_target_delete()`);
      }

      const nativeQuery: (this: Client, text: string, values?: unknown[]) => Promise<QueryResult> = Client.prototype.query;
      vi.spyOn(Client.prototype, 'query').mockImplementation(async function (
        this: Client, text: unknown, values?: unknown[],
      ): Promise<QueryResult> {
        if (typeof text !== 'string') throw new Error('Expected native uncertain-COMMIT SQL');
        if (text.includes('INSERT INTO wujie_presence_leases') && values?.[0] === 'target') {
          joinClients.add(this);
          joinIdentity = (await nativeQuery.call(this,
            'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
          )).rows[0] as BackendIdentity;
        }
        if (joinClients.has(this) && text === 'COMMIT' && !commitAttempted) {
          commitAttempted = true;
          const result = await nativeQuery.call(this, text, values);
          commitObserved = true;
          // Independent observer proves committed visibility BEFORE delivery
          // failure. No query result, backend cancellation or commit is faked.
          visibleAtLostAck = (await query<{ connection_id: string }>(
            'SELECT connection_id FROM wujie_presence_leases ORDER BY connection_id',
          )).rows.map(row => row.connection_id);
          if (fault === 'lost-ack-signal') controller.abort(lostAck);
          if (fault !== 'commit-rejected') throw lostAck;
          return result;
        }
        return nativeQuery.call(this, text, values);
      });

      let result: unknown;
      try {
        result = await joinPresence({ connectionId: fault === 'duplicate-id' ? 'survivor' : 'target',
          userId: 'member', projectId: 'project', instanceId: 'two' },
        fault === 'lost-ack-no-signal' ? undefined : controller.signal);
      } catch (error) { result = error; }
      expect(result).toBeInstanceOf(Error);
      if (fault === 'duplicate-id') {
        expect(commitAttempted).toBe(false);
        expect(result).toMatchObject({ code: '23505' });
      } else if (fault === 'commit-rejected') {
        expect(commitAttempted).toBe(true);
        expect(commitObserved).toBe(false);
        expect(result).toMatchObject({ code: '23514', message: 'actual deferred presence COMMIT rejection' });
      } else {
        expect(commitObserved).toBe(true);
        expect(visibleAtLostAck).toEqual(['survivor', 'target']);
        if (fault === 'compensation-rejected') {
          expect(result).toBeInstanceOf(PresenceConnectionCleanupError);
          expect(allErrors(result)).toContain(lostAck);
          expect(allErrors(result).some(error => error instanceof Error
            && error.message === 'actual presence compensation DELETE rejection'
            && 'code' in error && error.code === '22012')).toBe(true);
        } else { expect(result).toBe(lostAck); }
      }
      const leases = await query<{ connection_id: string; instance_id: string }>(
        'SELECT connection_id, instance_id FROM wujie_presence_leases ORDER BY connection_id',
      );
      expect(leases.rows).toEqual(fault === 'compensation-rejected'
        ? [{ connection_id: 'survivor', instance_id: 'one' }, { connection_id: 'target', instance_id: 'two' }]
        : [{ connection_id: 'survivor', instance_id: 'one' }]);
      const sequence = await query<{ sequence: number }>(
        'SELECT sequence::int AS sequence FROM wujie_presence_project_sequences WHERE project_id=$1', ['project'],
      );
      expect(sequence.rows[0].sequence).toBe(fault === 'compensation-rejected' ? 2
        : fault === 'commit-rejected' || fault === 'duplicate-id' ? 1 : 3);
      if (fault === 'lost-ack-signal') {
        expect(joinClients.size).toBe(1);
        for (const client of joinClients) expect(client.connection.stream.closed).toBe(true);
        expect((await query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename=$4`,
        [joinIdentity?.pid, joinIdentity?.backend_start, joinIdentity?.datname, joinIdentity?.usename])).rows[0].count).toBe(0);
      }
      expect((await healthy.query<{ value: number }>('SELECT 42 AS value')).rows[0].value).toBe(42);
      expect((await healthy.query<BackendIdentity>(
        'SELECT pid, backend_start::text AS backend_start, datname, usename FROM pg_stat_activity WHERE pid=pg_backend_pid()',
      )).rows[0]).toEqual(healthyIdentity);
      expect(healthy.connection.stream.closed).toBe(false);
      expect(pool.ended).toBe(false);
      expect(pool.waitingCount).toBe(0);
    } catch (error) { bodyFailed = true; bodyError = error; }
    let cleanupError: unknown;
    try {
      await runPostgresCleanup([
        { name: 'restore-uncertain-commit-delivery', run: (): void => { vi.restoreAllMocks(); } },
        { name: 'release-independent-healthy', run: (): void => { healthy?.release(); } },
      ]);
    } catch (error) { cleanupError = error; }
    if (bodyFailed && cleanupError) throw new AggregateError([bodyError, cleanupError], 'Uncertain COMMIT body and cleanup failed');
    if (bodyFailed) throw bodyError;
    if (cleanupError) throw cleanupError;
  });
}

describe('presence uncertain COMMIT keeps exact lease compensation ownership', () => {
  postgresIt.each<Fault>(['lost-ack-signal', 'lost-ack-no-signal', 'commit-rejected', 'duplicate-id', 'compensation-rejected'])(
    '%s preserves real commit, exact cleanup and original errors', verifyUncertainCommit, 15_000,
  );
});
