import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const entry = path.resolve(process.cwd(), 'scripts/run-isolated-vitest.mjs');
const dedicatedUrl = 'postgresql://postgres:offline-test-password@127.0.0.1:5432/wujie_bridge_test_ci';
const businessUrl = 'postgresql://postgres:do-not-print-this@database.example.invalid:5432/business';
const aliasKeys = ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL'] as const;

function runWithDatabaseAliases(
  overrides: Partial<Record<(typeof aliasKeys)[number], string | undefined>>,
  argumentsToVitest: string[] = ['--version'],
) {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of aliasKeys) environment[key] = dedicatedUrl;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return spawnSync(process.execPath, [entry, ...argumentsToVitest], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('isolated Vitest launcher', () => {
  it.each([
    ['missing dedicated URL', { POSTGRES_TEST_DATABASE_URL: undefined, DATABASE_URL: businessUrl, PGDATABASE_URL: businessUrl, TEST_POSTGRES_URL: businessUrl }],
    ['mismatched inherited business URL', { PGDATABASE_URL: businessUrl }],
    ['remote database', Object.fromEntries(aliasKeys.map(key => [key, businessUrl]))],
    ['ordinary local database', Object.fromEntries(aliasKeys.map(key => [key, 'postgresql://postgres@127.0.0.1:5432/postgres']))],
    ['implicit default port', Object.fromEntries(aliasKeys.map(key => [key, 'postgresql://postgres@127.0.0.1/wujie_bridge_test_ci']))],
    ['search-path query', Object.fromEntries(aliasKeys.map(key => [key, `${dedicatedUrl}?options=-csearch_path%3Dpublic`]))],
  ] as const)('rejects %s before loading Vitest without disclosing credentials', (_label, overrides) => {
    const result = runWithDatabaseAliases(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Isolated Vitest database boundary rejected');
    expect(`${result.stdout}${result.stderr}`).not.toContain('do-not-print-this');
    expect(`${result.stdout}${result.stderr}`).not.toContain('offline-test-password');
    expect(result.stdout).not.toContain('vitest/');
  });

  it('runs the project Vitest CLI after accepting four identical dedicated loopback aliases', () => {
    const expectedFile = 'src/__tests__/api/upscale-onnx-output-boundary.test.ts';
    const result = runWithDatabaseAliases({}, [expectedFile, '--reporter=json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      success: boolean;
      numTotalTests: number;
      numPassedTests: number;
      numFailedTests: number;
      numPendingTests: number;
      numTodoTests: number;
      testResults: Array<{
        name: string;
        status: string;
        assertionResults: Array<{ status: string; failureMessages: string[] }>;
      }>;
    };
    expect(report.success).toBe(true);
    expect(report.numTotalTests).toBe(2);
    expect(report.numPassedTests).toBe(2);
    expect(report.numFailedTests).toBe(0);
    expect(report.numPendingTests).toBe(0);
    expect(report.numTodoTests).toBe(0);
    expect(report.testResults.map(row => path.relative(process.cwd(), row.name).split(path.sep).join('/')))
      .toEqual([expectedFile]);
    expect(report.testResults[0].status).toBe('passed');
    expect(report.testResults[0].assertionResults).toHaveLength(2);
    for (const assertion of report.testResults[0].assertionResults) {
      expect(assertion.status).toBe('passed');
      expect(assertion.failureMessages).toEqual([]);
    }
    expect(result.stderr).not.toContain('Isolated Vitest database boundary rejected');
  });
});
