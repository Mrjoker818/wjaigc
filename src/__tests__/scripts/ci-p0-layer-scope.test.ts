import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

interface WorkflowStep {
  name?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Workflow {
  jobs: Record<string, { steps: WorkflowStep[] }>;
}

const workflow = YAML.parse(readFileSync(
  resolve(process.cwd(), '.github/workflows/quality.yml'), 'utf8',
)) as Workflow;
const steps = workflow.jobs['real-p0-browser'].steps;
const required = [
  'E2E_BASE_URL', 'E2E_TEST_USERNAME', 'E2E_TEST_PASSWORD',
  'E2E_GENERATION_MODEL', 'E2E_ENABLE_PAID_GENERATION',
] as const;
const configured: Record<string, string> = {
  E2E_BASE_URL: 'https://p0-fixture.invalid',
  E2E_TEST_USERNAME: 'scope-fixture-user',
  E2E_TEST_PASSWORD: 'scope-fixture-not-a-real-password',
  E2E_GENERATION_MODEL: 'scope-fixture-model',
  E2E_ENABLE_PAID_GENERATION: '1',
};

function runStep(
  step: WorkflowStep | undefined,
  environment: Record<string, string>,
  captureCommand: boolean = false,
): SpawnSyncReturns<string> {
  if (!step?.run) throw new Error('Missing real P0 workflow command');
  // Only the external browser executor is replaced; Bash and the shipped run/env are real.
  const boundary = captureCommand
    ? 'pnpm() { printf "%s\\n" "guard=${LAYER_E2E_SKIP_PROVIDER_CALL:-}" "$@"; };\n'
    : '';
  return spawnSync(process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash', [
    '--noprofile', '--norc', '-e', '-c', boundary + step.run,
  ], {
    cwd: process.cwd(),
    env: {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      NODE_ENV: 'test',
      ...environment,
      ...step.env,
    },
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
}

function validation(environment: Record<string, string>): SpawnSyncReturns<string> {
  const result = runStep(steps.find(step => step.name === 'Validate real P0 E2E configuration'), environment);
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
}

describe('CI P0 and canceled Pear acceptance scope', () => {
  // Reintroducing a Pear prerequisite rejects these otherwise fully authorized P0 inputs.
  it.each(['1', 'true'])('accepts paid generation=%s without canceled Pear configuration', (value) => {
    const result = validation({ ...configured, E2E_ENABLE_PAID_GENERATION: value });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toBe('');
  });

  it.each(required)('still rejects missing %s before browser execution', (name) => {
    const result = validation({ ...configured, [name]: '' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${name} is required`);
    expect(result.stdout).not.toContain(configured.E2E_TEST_PASSWORD);
  });

  it.each(['0', 'false', 'yes'])('still rejects unauthorized paid generation=%s', (value) => {
    const result = validation({ ...configured, E2E_ENABLE_PAID_GENERATION: value });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('E2E_ENABLE_PAID_GENERATION must be 1 or true');
  });

  it('routes mandatory paid P0 to its own Chromium journey, not Pear', () => {
    const result = runStep(steps.find(step => step.run?.includes('tests/e2e/p0-core.spec.ts')), configured, true);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'guard=', 'exec', 'playwright', 'test', 'tests/e2e/p0-core.spec.ts', '--project=chromium',
    ]);
  });

  it('keeps all three PSD browser regressions non-billable even with inherited Pear opt-in', () => {
    const result = runStep(steps.find(step => (
      step.run?.includes('tests/e2e/layer-editing.spec.ts')
      && !step.run.includes('tests/e2e/p0-core.spec.ts')
    )), {
      ...configured,
      E2E_ENABLE_PAID_LAYERING: '1',
      E2E_LAYER_PROVIDER_ID: 'scope-fixture-provider',
      E2E_LAYER_MODEL_ID: 'scope-fixture-layer-model',
      LAYER_E2E_SKIP_PROVIDER_CALL: '0',
    }, true);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'guard=1', 'exec', 'playwright', 'test', 'tests/e2e/layer-editing.spec.ts',
      '--project=chromium', '--project=firefox', '--project=webkit',
    ]);
  });
});
