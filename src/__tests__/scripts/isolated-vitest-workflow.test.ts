import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

interface WorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, string | number>;
  run?: string;
  env?: Record<string, string>;
}

interface WorkflowJob {
  if?: string;
  needs?: string[];
  strategy?: { 'fail-fast': boolean; matrix: { shard: number[] } };
  services?: Record<string, {
    image: string;
    env: Record<string, string>;
    ports: string[];
  }>;
  steps: WorkflowStep[];
}

interface Workflow {
  jobs: Record<string, WorkflowJob>;
}

const expectedUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/wujie_bridge_test_ci';
const aliases = ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL'];

function loadWorkflow(workflowPath: string): Workflow {
  const contents = readFileSync(path.resolve(process.cwd(), workflowPath), 'utf8');
  return YAML.parse(contents) as Workflow;
}

function loadJob(workflowPath: string, jobName: string): WorkflowJob {
  return loadWorkflow(workflowPath).jobs[jobName];
}

describe('full Vitest CI database boundary', () => {
  it('does not repeat included API tests outside the guarded full-suite step', () => {
    const jobs = Object.values(loadWorkflow('.github/workflows/quality.yml').jobs);
    expect(jobs.some(job => job.steps.some(step => step.run === 'pnpm test:api'))).toBe(false);
  });

  it.each([
    ['.github/workflows/quality.yml', 'unit-and-integration-tests', 'Unit and integration tests'],
    ['.github/workflows/stage-0-quality.yml', 'stage-1-automated-tests', 'Full automated test suite'],
  ])('%s runs the full suite only through its own dedicated PostgreSQL service', (workflowPath, jobName, stepName) => {
    const job = loadJob(workflowPath, jobName);
    const service = job.services?.postgres;
    const step = job.steps.find(candidate => candidate.name === stepName);

    expect(service).toMatchObject({
      image: 'postgres:16-alpine',
      env: { POSTGRES_DB: 'wujie_bridge_test_ci' },
      ports: ['5432:5432'],
    });
    expect(step?.run).toBe('pnpm test:ci --shard=${{ matrix.shard }}/4');
    for (const alias of aliases) expect(step?.env?.[alias]).toBe(expectedUrl);
    const mediaRoot = '${{ runner.temp }}/wujie-bridge-test-ci';
    expect(step?.env?.WUJIE_DATA_DIR).toBe(mediaRoot);
    const mediaPreparation = job.steps.find(candidate => candidate.name === 'Prepare isolated Vitest media root');
    expect(mediaPreparation?.env?.WUJIE_DATA_DIR).toBe(mediaRoot);
    expect(mediaPreparation?.run).toBe('mkdir -p "$WUJIE_DATA_DIR"');
    expect(job.steps.indexOf(mediaPreparation!)).toBeLessThan(job.steps.indexOf(step!));
  });
});

interface VitestReport {
  success: boolean;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: Array<{ name: string; status: string }>;
}

const shardWorkflows = [
  ['.github/workflows/quality.yml', 'static-and-tests', 'static-and-build', 'unit-and-integration-tests', 'Unit and integration tests'],
  ['.github/workflows/stage-0-quality.yml', 'stage-1-local-gates', 'stage-1-static-and-build', 'stage-1-automated-tests', 'Full automated test suite'],
] as const;

// Hand-checked file identities for the installed Vitest sequencer. These
// literal expectations catch a duplicated/wrong shard argument at our CI
// command boundary; they are not calculated by the command under test.
const fixtureShards = [
  [1, 'src/__tests__/scripts/stage-3-evidence-filter.test.ts'],
  [2, 'src/__tests__/scripts/stage-1-release-gate-contract.test.ts'],
  [3, 'src/__tests__/api/upscale-onnx-output-boundary.test.ts'],
  [4, 'src/__tests__/scripts/stage-4-runtime-failure-summary.test.ts'],
] as const;

describe.each(shardWorkflows)('%s full-suite shard execution', (workflowPath, gateName, staticName, shardName, stepName) => {
  it('makes historical baseline objects and ancestry available on a clean shard checkout', () => {
    const checkout = loadJob(workflowPath, shardName).steps.find(step => step.uses === 'actions/checkout@v4');
    const depth = Number(checkout?.with?.['fetch-depth'] ?? 1);
    const fixtureRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'wujie-ci-history-')));
    expect(path.dirname(fixtureRoot)).toBe(realpathSync(tmpdir()));
    expect(path.basename(fixtureRoot)).toMatch(/^wujie-ci-history-/);
    const repository = path.join(fixtureRoot, 'source');
    const candidate = path.join(fixtureRoot, 'checkout');
    const git = (args: string[], cwd: string = fixtureRoot): string => execFileSync('git', args, {
      cwd, encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    try {
      git(['init', '--quiet', repository]);
      const commit = (message: string): string => git([
        '-c', 'user.name=Offline CI fixture', '-c', 'user.email=ci-fixture@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(fixtureRoot, 'no-hooks')}`,
        'commit', '--quiet', '--allow-empty', '-m', message,
      ], repository);
      commit('baseline');
      const baseline = git(['rev-parse', 'HEAD'], repository);
      commit('reviewed source');
      commit('candidate');
      // file:// makes Git honor --depth even for this tiny, offline fixture.
      git(['clone', '--quiet', '--no-checkout', ...(depth > 0 ? [`--depth=${depth}`] : []),
        pathToFileURL(repository).href, candidate]);
      const options = { cwd: candidate, encoding: 'utf8' as const, timeout: 10_000, windowsHide: true };
      expect(spawnSync('git', ['cat-file', '-e', `${baseline}^{commit}`], options).status).toBe(0);
      expect(spawnSync('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], options).status).toBe(0);
      expect(depth).toBe(0);
    } finally {
      // Only the absolute, newly created and verified fixture directory is removed.
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each(fixtureShards)('executes shard %i with exactly its expected real test file', (shard, expectedFile) => {
    const workflow = loadWorkflow(workflowPath);
    const job = workflow.jobs[shardName];
    const step = job.steps.find(candidate => candidate.name === stepName);
    expect(step).toBeDefined();
    const command = step!.run!.replace(/\$\{\{\s*matrix\.shard\s*\}\}/g, String(shard)).trim().split(/\s+/);
    expect(command.slice(0, 2)).toEqual(['pnpm', 'test:ci']);
    const result = spawnSync(process.execPath,
      ['scripts/run-isolated-vitest.mjs', ...command.slice(2), ...fixtureShards.map(row => row[1]), '--reporter=json'], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 20_000, windowsHide: true,
        env: { ...process.env, ...step!.env, NODE_OPTIONS: '', WUJIE_DATA_DIR: process.env.WUJIE_DATA_DIR },
      });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as VitestReport;
    expect(report.success).toBe(true);
    expect(report.numFailedTests).toBe(0);
    expect(report.numPendingTests).toBe(0);
    expect(report.numTodoTests).toBe(0);
    expect(report.testResults.map(row => path.relative(process.cwd(), row.name).split(path.sep).join('/')))
      .toEqual([expectedFile]);
    for (const row of report.testResults) {
      expect(row.status).toBe('passed');
    }
    expect(job.strategy?.['fail-fast']).toBe(false);
    expect(job.strategy?.matrix.shard).toEqual([1, 2, 3, 4]);
  });

  it.each([
    ['success', 'success', 0],
    ['failure', 'success', 1],
    ['success', 'failure', 1],
    ['cancelled', 'success', 1],
    ['success', 'cancelled', 1],
    ['skipped', 'success', 1],
    ['success', 'skipped', 1],
  ] as const)('keeps the original gate closed for static=%s tests=%s', (staticResult, testResult, status) => {
    const gate = loadJob(workflowPath, gateName);
    expect(gate.needs).toEqual([staticName, shardName]);
    expect(gate.if).toContain('always()');
    const step = gate.steps.find(candidate => candidate.name === 'Require all quality checks');
    expect(step).toBeDefined();
    const results: Record<string, string> = { [staticName]: staticResult, [shardName]: testResult };
    const environment = Object.fromEntries(Object.entries(step!.env!).map(([key, value]) => {
      const match = /^\$\{\{\s*needs\.([\w-]+)\.result\s*\}\}$/.exec(value);
      if (!match || !(match[1] in results)) throw new Error('Unknown aggregate gate result binding');
      return [key, results[match[1]]];
    }));
    const result = spawnSync(process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash',
      ['--noprofile', '--norc', '-e', '-c', step!.run!], {
        encoding: 'utf8', timeout: 10_000, windowsHide: true,
        env: { NODE_ENV: 'test', ...environment, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
      });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(status);
  });
});
