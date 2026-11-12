import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

interface Step {
  name?: string;
  run?: string;
  shell?: string;
  if?: string;
  'continue-on-error'?: boolean | string;
}
interface Workflow { jobs: Record<string, { steps: Step[] }> }

function runBrowserPreparation(
  workflowPath: string,
  jobName: string,
  testStepName: string,
  browserExit: '0' | '1',
  mutateSteps?: (steps: Step[]) => Step[],
): SpawnSyncReturns<string> {
  const workflow = YAML.parse(readFileSync(workflowPath, 'utf8')) as Workflow;
  const originalSteps = workflow.jobs[jobName].steps;
  const steps = mutateSteps ? mutateSteps(originalSteps) : originalSteps;
  const dependencyIndex = steps.findIndex(step => step.run?.trim() === 'pnpm install --frozen-lockfile');
  const browserIndex = steps.findIndex(step => step.name === 'Install Chromium for Vitest');
  const testIndex = steps.findIndex(step => step.name === testStepName);
  const selected = steps.filter(step =>
    step.name === 'Install Chromium for Vitest' || step.name === testStepName);
  if (selected.length !== 2 || dependencyIndex < 0
    || browserIndex <= dependencyIndex || testIndex <= browserIndex) {
    throw new Error('CI_BROWSER_STEP_ORDER');
  }
  for (const step of selected) {
    const expected = step.name === 'Install Chromium for Vitest'
      ? 'pnpm exec playwright install --with-deps chromium'
      : 'pnpm test:ci --shard=${{ matrix.shard }}/12';
    if (step.run?.trim() !== expected) throw new Error('CI_BROWSER_RUN_BOUNDARY');
    expect(step.if).toBeUndefined();
    expect(step.shell).toBeUndefined();
    expect(step['continue-on-error']).toBeUndefined();
    expect(step.run).toBeTypeOf('string');
  }
  // Only the external installer and real suite entrypoint are replaced.
  // Workflow shell commands, order and fail-fast semantics remain real.
  // The fake boundary rejects unknown arguments; no install, browser or DB runs.
  const boundary = `
    pnpm() {
      if [ "$#" -eq 5 ] && [ "$1" = exec ] && [ "$2" = playwright ] \
        && [ "$3" = install ] && [ "$4" = --with-deps ] && [ "$5" = chromium ]; then
        printf 'browser:%s\\n' "$*"
        return "$BROWSER_EXIT"
      elif [ "$#" -eq 2 ] && [ "$1" = test:ci ] && [ "$2" = --shard=1/12 ]; then
        printf 'tests:%s\\n' "$*"
        return 0
      fi
      printf 'unexpected pnpm command:%s\\n' "$*" >&2
      return 97
    }
  `;
  const command = selected.map(step => step.run!
    .replace(/\$\{\{\s*matrix\.shard\s*\}\}/g, '1')).join('\n');
  return spawnSync(
    process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', boundary + command],
    {
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
      env: {
        NODE_ENV: 'test', BROWSER_EXIT: browserExit,
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
    },
  );
}

describe.each([
  ['.github/workflows/quality.yml', 'unit-and-integration-tests', 'Unit and integration tests'],
  ['.github/workflows/stage-0-quality.yml', 'stage-1-automated-tests', 'Full automated test suite'],
])('CI Vitest browser prerequisites: %s', (workflowPath, jobName, testStepName) => {
  // Removing/misordering Chromium or --with-deps, switching to a global/unpinned
  // installer, or swallowing an installation failure must prevent this passing.
  it('prepares pinned Chromium and host dependencies before the full test command', (): void => {
    const result = runBrowserPreparation(workflowPath, jobName, testStepName, '0');
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'browser:exec playwright install --with-deps chromium',
      'tests:test:ci --shard=1/12',
    ]);
  });

  it('stops before tests when browser preparation fails', (): void => {
    const result = runBrowserPreparation(workflowPath, jobName, testStepName, '1');
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'browser:exec playwright install --with-deps chromium',
    ]);
    expect(result.stdout).not.toContain('tests:');
  });

  it('rejects preparation moved before dependency installation', (): void => {
    expect(() => runBrowserPreparation(workflowPath, jobName, testStepName, '0', steps => {
      const browser = steps.find(step => step.name === 'Install Chromium for Vitest')!;
      return [browser, ...steps.filter(step => step !== browser)];
    })).toThrow('CI_BROWSER_STEP_ORDER');
  });

  it.each([
    'pnpm exec "playwright install --with-deps chromium"',
    ':; pnpm exec playwright install --with-deps chromium',
  ])('rejects non-whitelisted shell command before execution: %s', (command): void => {
    expect(() => runBrowserPreparation(workflowPath, jobName, testStepName, '0', steps =>
      steps.map(step => step.name === 'Install Chromium for Vitest'
        ? { ...step, run: command } : step))).toThrow('CI_BROWSER_RUN_BOUNDARY');
  });
});
