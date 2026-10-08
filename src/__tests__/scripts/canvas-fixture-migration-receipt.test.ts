import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { QueryFn } from '../../../tests/helpers/postgres-test-database';

const migration = vi.hoisted(() => ({ status: 1 as number | null, stdout: 'migration-output', stderr: 'migration-failure' }));
// Migration execution is the external DB boundary. Receipt files, fresh-checkout
// directories and seed failure handling remain real; no business DB is opened.
vi.mock('node:child_process', () => ({ spawnSync: (): typeof migration => migration }));
vi.mock('server-only', () => ({}));
import { seedCanvasGeneration } from '../../../tests/helpers/canvas-generation-fixture';

describe('fresh-checkout canvas migration failure receipts', () => {
  // Requiring an ignored historical SDD directory must not mask the original
  // migration failure or lose its diagnostic receipt on a fresh CI checkout.
  it.each([1, null])('retains the actual migration failure when exit=%s without historical SDD files', async (status) => {
    const temporary = mkdtempSync(join(tmpdir(), 'wujie-fixture-receipt-'));
    const checkout = join(temporary, 'checkout');
    mkdirSync(checkout);
    const previous = process.cwd();
    const schema = 'test_receipt_portable';
    let queryCount = 0;
    const query: QueryFn = async (): Promise<never> => { queryCount++; throw new Error('Unexpected database write'); };
    migration.status = status;
    try {
      process.chdir(checkout);
      const outcome = await seedCanvasGeneration(query, 'postgresql://test@127.0.0.1:5432/wujie_bridge_test_ci', schema)
        .then(() => 'unexpected-success', (error: unknown) => error instanceof Error ? error.message : String(error));
      expect(outcome).not.toContain('ENOENT');
      expect(outcome).toContain('migration-failure');
      const receipt = resolve('test-results/fixture-migrations', `${schema}.log`);
      expect(existsSync(receipt)).toBe(true);
      expect(readFileSync(receipt, 'utf8')).toContain(`exit=${status}\nmigration-output\nmigration-failure`);
      expect(queryCount).toBe(0);
    } finally {
      process.chdir(previous);
      // This directory is allocated here, never a shared fixture or workspace.
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
