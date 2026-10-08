import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryFn } from '../../../tests/helpers/postgres-test-database';

const migration = vi.hoisted(() => ({ status: 1 as number | null, stdout: 'controlled-output', stderr: 'controlled-failure' }));
// Only the external PostgreSQL process is replaced. Log creation and failure
// handling run against an actual empty checkout with no historical SDD notes.
vi.mock('node:child_process', () => ({ spawnSync: (): typeof migration => migration }));
vi.mock('server-only', () => ({}));
import { recoverRolesInFreshProcess, seedImageEditPublication } from '../../../tests/helpers/canvas-image-edit-publication-fixture';
import { saveFixtureMigrationLog } from '../../../tests/helpers/fixture-migration-log';

afterEach((): void => { vi.unstubAllEnvs(); });

describe('image-edit fixture diagnostic receipts', () => {
  // Writing to an ignored, missing directory must not mask the native child
  // failure; both migration and restart diagnostics must survive fresh CI.
  it.each([
    ['migration', 1], ['migration', null], ['restart', 1], ['restart', null],
  ] as const)('preserves %s failure with exit=%s in an empty checkout', async (phase, status) => {
    const temporary = mkdtempSync(join(tmpdir(), 'wujie-image-edit-receipt-'));
    const checkout = join(temporary, 'checkout'); mkdirSync(checkout);
    const previous = process.cwd();
    const schema = 'test_task_8cb3j4a_receipt';
    const databaseUrl = `postgresql://test@127.0.0.1:5432/wujie_bridge_test_ci?options=-csearch_path%3D${schema}`;
    let writes = 0;
    const query: QueryFn = async (): Promise<never> => { writes++; throw new Error('Unexpected database write'); };
    vi.stubEnv('POSTGRES_TEST_DATABASE_URL', databaseUrl);
    vi.stubEnv('WUJIE_DATA_DIR', join(temporary, 'task-8cb3j4a-media'));
    migration.status = status;
    try {
      process.chdir(checkout);
      const outcome = await Promise.resolve().then(async (): Promise<void> => {
        if (phase === 'migration') await seedImageEditPublication(query, databaseUrl, schema);
        else recoverRolesInFreshProcess(databaseUrl, schema);
      })
        .then(() => 'unexpected-success', (error: unknown) => error instanceof Error ? error.message : String(error));
      expect(outcome).not.toContain('ENOENT');
      expect(outcome).toContain(phase === 'migration' ? 'Migration failed:' : 'Fresh process recovery failed:');
      const receipt = resolve('test-results/fixture-migrations', `${schema}${phase === 'restart' ? '_restart' : ''}.log`);
      expect(existsSync(receipt)).toBe(true);
      expect(readFileSync(receipt, 'utf8')).toContain(`exit=${status}\ncontrolled-output\ncontrolled-failure`);
      expect(existsSync(resolve('.superpowers'))).toBe(false);
      expect(writes).toBe(0);
    } finally {
      process.chdir(previous);
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('never overwrites an existing isolated diagnostic receipt', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'wujie-receipt-collision-'));
    const previous = process.cwd();
    try {
      process.chdir(temporary);
      const receipt = saveFixtureMigrationLog('test_receipt_collision', { status: 1, stdout: 'first', stderr: 'failure' });
      expect(() => saveFixtureMigrationLog('test_receipt_collision', { status: 0, stdout: 'second', stderr: '' })).toThrow();
      expect(readFileSync(receipt, 'utf8')).toBe('exit=1\nfirst\nfailure');
    } finally {
      process.chdir(previous);
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
