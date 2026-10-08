import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

interface WorkflowStep {
  name?: string;
  env?: Record<string, string>;
}

interface WorkflowJob {
  env?: Record<string, string>;
  steps: WorkflowStep[];
}

interface Workflow {
  env?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

interface HeapProbeResult {
  parent: number;
  worker: number;
}

const mib = 1024 * 1024;

function probeStepHeap(workflowPath: string, jobName: string, stepName: string): HeapProbeResult {
  const workflow = YAML.parse(readFileSync(resolve(process.cwd(), workflowPath), 'utf8')) as Workflow;
  const job = workflow.jobs[jobName];
  const step = job.steps.find(candidate => candidate.name === stepName);
  if (!step) throw new Error(`Missing workflow step: ${jobName}/${stepName}`);

  // Model the observed 2 GiB runner default, not this workstation's larger default.
  const nodeOptions = step.env?.NODE_OPTIONS ?? job.env?.NODE_OPTIONS
    ?? workflow.env?.NODE_OPTIONS ?? '--max-old-space-size=2048';
  const child = spawnSync(process.execPath, ['-e', `
    const { spawnSync } = require('node:child_process');
    const worker = spawnSync(process.execPath, ['-e',
      "process.stdout.write(String(require('node:v8').getHeapStatistics().heap_size_limit))"
    ], { encoding: 'utf8' });
    if (worker.status !== 0) process.exit(1);
    process.stdout.write(JSON.stringify({
      parent: require('node:v8').getHeapStatistics().heap_size_limit,
      worker: Number(worker.stdout)
    }));
  `], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      NODE_ENV: 'test',
      NODE_OPTIONS: nodeOptions,
    },
  });

  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout) as HeapProbeResult;
}

describe('CI Node heap budget at the compiler boundary', () => {
  // Removing a step's budget must reproduce the observed 2 GiB compiler limit.
  it.each([
    ['.github/workflows/quality.yml', 'static-and-build', 'TypeScript'],
    ['.github/workflows/quality.yml', 'static-and-build', 'Production build'],
    ['.github/workflows/quality.yml', 'stage-3-canvas-kernel', 'Build production application'],
    ['.github/workflows/quality.yml', 'stage-4-workspace-interoperability', 'Build production application'],
    ['.github/workflows/stage-0-quality.yml', 'stage-1-static-and-build', 'TypeScript'],
    ['.github/workflows/stage-0-quality.yml', 'stage-1-static-and-build', 'Production build'],
  ])('%s / %s / %s gives the compiler and its worker a bounded 4 GiB heap', (workflowPath, jobName, stepName) => {
    const result = probeStepHeap(workflowPath, jobName, stepName);
    for (const limit of [result.parent, result.worker]) {
      expect(limit).toBeGreaterThanOrEqual(4096 * mib);
      expect(limit).toBeLessThan(4608 * mib);
    }
  });

  it.each([
    ['.github/workflows/quality.yml', 'unit-and-integration-tests', 'Unit and integration tests'],
    ['.github/workflows/quality.yml', 'stage-3-canvas-kernel', 'Start production application'],
    ['.github/workflows/quality.yml', 'stage-4-workspace-interoperability', 'Start production application'],
    ['.github/workflows/stage-0-quality.yml', 'stage-1-automated-tests', 'Full automated test suite'],
  ])('%s / %s / %s does not inherit the compiler-only increase', (workflowPath, jobName, stepName) => {
    const result = probeStepHeap(workflowPath, jobName, stepName);
    for (const limit of [result.parent, result.worker]) {
      expect(limit).toBeGreaterThanOrEqual(2048 * mib);
      expect(limit).toBeLessThan(2560 * mib);
    }
  });
});
