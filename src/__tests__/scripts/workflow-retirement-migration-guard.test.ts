import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ history: '', sql: [] as string[], ended: 0 }));
const destructiveSql = 'DELETE FROM wujie_user_data WHERE data_key LIKE \'workflow_%\'; DROP TABLE IF EXISTS wujie_workflow_edit_outputs;';
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(async () => [{ name: '20261118_wj_remove_node_workflows.sql', isFile: () => true }]),
  readFile: vi.fn(async () => Buffer.from(destructiveSql)),
}));
vi.mock('pg', () => ({ Client: class {
  async connect() {}
  async end() { state.ended++; }
  async query(sql: string) {
    state.sql.push(sql);
    if (sql.includes('pg_class')) return { rows: ['wujie_user_data', 'wujie_projects', 'wujie_workflow_edit_outputs', 'wujie_workflow_edit_publications']
      .map(table_name => ({ table_name, schema_name: 'public', relation_kind: 'r' })) };
    if (sql.includes('current_setting')) return { rows: [{ lock_timeout: '0' }] };
    if (sql.includes(' AS has_history')) return { rows: [{ has_history: Boolean(state.history && sql.includes(`"${state.history}"`)) }] };
    return { rows: [] };
  }
} }));

describe('workflow retirement migration preserves existing history', () => {
  beforeEach(() => {
    state.history = ''; state.sql = []; state.ended = 0;
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic:synthetic@127.0.0.1:60018/wujie_bridge_test_mock');
  });
  it.each(['wujie_user_data', 'wujie_projects', 'wujie_workflow_edit_outputs', 'wujie_workflow_edit_publications'])(
    'rolls back without running destructive SQL when %s contains retired workflow history', async table => {
      state.history = table;
      const runner = await import('../../../scripts/run-migrations.mjs');
      await expect(runner.applyMigrations()).rejects.toThrow('WORKFLOW_RETIREMENT_HISTORY_REQUIRES_REVIEW');
      expect(state.sql).not.toContain(destructiveSql);
      expect(state.sql).toContain('ROLLBACK');
      expect(state.sql).not.toContain('COMMIT');
      expect(state.sql.some(sql => sql.startsWith('INSERT INTO wujie_schema_migrations'))).toBe(false);
      expect(state.ended).toBe(1);
    },
  );
  it('retains checksum execution and commit for a fresh database with no historical data', async () => {
    const runner = await import('../../../scripts/run-migrations.mjs');
    await expect(runner.applyMigrations()).resolves.toBeUndefined();
    expect(state.sql).toContain(destructiveSql);
    expect(state.sql).toContain('COMMIT');
    expect(state.sql.some(sql => sql.startsWith('INSERT INTO wujie_schema_migrations'))).toBe(true);
  });
});
