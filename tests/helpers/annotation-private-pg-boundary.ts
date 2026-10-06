import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { expect, vi } from 'vitest';
import * as database from '@/lib/db-client';

/** Unit-only SQL boundary. Source authorization and revalidation remain real.
 * This models an active actor with legacy projects in PostgreSQL, not a file store.
 * Real PostgreSQL behavior is separately covered by annotation-source-postgres.
 */
export function installAnnotationPrivatePgBoundary(
  readProjects: () => Promise<unknown>,
): { assertDrained: () => void } {
  const clients = new Set<object>();
  const pool = {
    async connect(): Promise<PoolClient> {
      let transaction = false;
      const client = {
        async query(sql: string, params?: unknown[]): Promise<QueryResult<QueryResultRow>> {
          let rows: QueryResultRow[] = [];
          let command = 'SELECT';
          if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') {
            expect(transaction).toBe(false);
            transaction = true;
            command = 'BEGIN';
          } else if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            expect(transaction).toBe(true);
            transaction = false;
            command = sql;
          } else {
            expect(transaction).toBe(true);
            if (sql === 'SELECT status FROM wujie_users WHERE id = $1') {
              expect(params).toEqual(['user-1']);
              rows = [{ status: 'active' }];
            } else if (sql.includes('FROM wujie_projects p') && sql.includes('WHERE p.id = $1')) {
              expect(params).toHaveLength(1);
              expect(typeof params?.[0]).toBe('string');
              // No canonical project row: real authorization must inspect the
              // legacy projects payload, including ownership and status.
            } else if (sql === "SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = 'projects'"
              || sql === "SELECT data_value FROM wujie_user_data WHERE user_id=$1 AND data_key='projects'") {
              expect(params).toEqual(['user-1']);
              rows = [{ data_value: await readProjects() }];
            } else {
              throw new Error(`Unexpected annotation unit SQL: ${sql}`);
            }
          }
          return { rows, rowCount: rows.length, command, oid: 0, fields: [] };
        },
        release(): void {
          expect(transaction).toBe(false);
          expect(clients.delete(client)).toBe(true);
        },
      };
      clients.add(client);
      return client as unknown as PoolClient;
    },
  } as unknown as Pool;
  // Placeholder cannot reach a real DB: the acquisition boundary is intercepted.
  vi.spyOn(database, 'getPool').mockReturnValue(pool);
  vi.stubEnv('DATABASE_URL', 'postgresql://annotation-unit.invalid/fixture');
  vi.stubEnv('PGDATABASE_URL', undefined);
  return { assertDrained: (): void => { expect(clients.size).toBe(0); } };
}
