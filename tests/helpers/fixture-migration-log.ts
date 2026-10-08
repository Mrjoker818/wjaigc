import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface MigrationResult { status: number | null; stdout: string; stderr: string }

/** Keep per-schema diagnostics in CI's collected reports, not ignored SDD notes. */
export function saveFixtureMigrationLog(schemaName: string, migration: MigrationResult, start?: string): string {
  if (!/^test_[a-z0-9_]{1,58}$/.test(schemaName)) throw new Error('Isolated fixture schema required');
  const directory = resolve('test-results/fixture-migrations');
  mkdirSync(directory, { recursive: true });
  const log = resolve(directory, `${schemaName}.log`);
  writeFileSync(log, `${start ? `start=${start}\nend=${new Date().toISOString()}\n` : ''}exit=${migration.status}\n${migration.stdout}\n${migration.stderr}`, { flag: 'wx' });
  return log;
}
