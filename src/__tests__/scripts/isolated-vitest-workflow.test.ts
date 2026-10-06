import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

interface WorkflowStep {
  name?: string;
  run?: string;
  env?: Record<string, string>;
}

interface WorkflowJob {
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

function loadJob(workflowPath: string, jobName: string): WorkflowJob {
  const contents = readFileSync(path.resolve(process.cwd(), workflowPath), 'utf8');
  const workflow = YAML.parse(contents) as Workflow;
  return workflow.jobs[jobName];
}

describe('full Vitest CI database boundary', () => {
  it('does not repeat included API tests outside the guarded full-suite step', () => {
    const job = loadJob('.github/workflows/quality.yml', 'static-and-tests');
    expect(job.steps.some(step => step.run === 'pnpm test:api')).toBe(false);
  });

  it.each([
    ['.github/workflows/quality.yml', 'static-and-tests', 'Unit and integration tests'],
    ['.github/workflows/stage-0-quality.yml', 'stage-1-local-gates', 'Full automated test suite'],
  ])('%s runs the full suite only through its own dedicated PostgreSQL service', (workflowPath, jobName, stepName) => {
    const job = loadJob(workflowPath, jobName);
    const service = job.services?.postgres;
    const step = job.steps.find(candidate => candidate.name === stepName);

    expect(service).toMatchObject({
      image: 'postgres:16-alpine',
      env: { POSTGRES_DB: 'wujie_bridge_test_ci' },
      ports: ['5432:5432'],
    });
    expect(step?.run).toBe('pnpm test:ci');
    for (const alias of aliases) expect(step?.env?.[alias]).toBe(expectedUrl);
    const mediaRoot = '${{ runner.temp }}/wujie-bridge-test-ci';
    expect(step?.env?.WUJIE_DATA_DIR).toBe(mediaRoot);
    const mediaPreparation = job.steps.find(candidate => candidate.name === 'Prepare isolated Vitest media root');
    expect(mediaPreparation?.env?.WUJIE_DATA_DIR).toBe(mediaRoot);
    expect(mediaPreparation?.run).toBe('mkdir -p "$WUJIE_DATA_DIR"');
    expect(job.steps.indexOf(mediaPreparation!)).toBeLessThan(job.steps.indexOf(step!));
  });
});
