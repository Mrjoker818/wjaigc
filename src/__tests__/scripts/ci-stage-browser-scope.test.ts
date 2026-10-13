import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

interface Workflow {
  jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
}

interface DiscoverySuite {
  suites?: DiscoverySuite[];
  specs?: Array<{ title: string; tests: Array<{ projectName: string }> }>;
}

interface DiscoveryReport {
  errors: unknown[];
  suites: DiscoverySuite[];
}

const workflow = YAML.parse(readFileSync(
  resolve(process.cwd(), '.github/workflows/quality.yml'), 'utf8',
)) as Workflow;
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

function discoveredProfiles(suites: DiscoverySuite[]): string[] {
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => test.projectName)),
    ...discoveredProfiles(suite.suites ?? []),
  ]);
}

function discoveredCases(suites: DiscoverySuite[]): Array<{ title: string; projectName: string }> {
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => ({
      title: spec.title,
      projectName: test.projectName,
    }))),
    ...discoveredCases(suite.suites ?? []),
  ]);
}

describe('CI approved Stage 3/4 browser fixture boundary', () => {
  // Omitting selectors expands these fixed-fixture gates to unrelated global projects.
  // The real Playwright collector is exercised; no browser/server/database is started.
  it.each([
    ['stage-3-canvas-kernel', 'Run five-browser Canvas matrix', 60],
    // Four approved cases per browser, including the narrow-toolbar regression.
    ['stage-4-workspace-interoperability', 'Run five-browser Stage 4 workspace matrix', 20],
  ] as const)('%s discovers every approved case and no unseeded browser project', (jobName, stepName, caseCount) => {
    const command = workflow.jobs[jobName].steps.find(step => step.name === stepName)?.run;
    if (!command) throw new Error(`Missing workflow command: ${stepName}`);
    const [executor, scriptName, ...argumentsFromWorkflow] = command.trim().split(/\s+/);
    expect(executor).toBe('pnpm');
    const [program, ...scriptArguments] = packageJson.scripts[scriptName].split(/\s+/);
    expect(program).toBe('playwright');
    const child = spawnSync(process.execPath, [
      resolve(process.cwd(), 'node_modules/@playwright/test/cli.js'),
      ...scriptArguments, ...argumentsFromWorkflow, '--list', '--reporter=json',
    ], {
      cwd: process.cwd(),
      env: {
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        NODE_ENV: 'test',
        E2E_STAGE3_RUN_ID: 'ci-collector-only',
        E2E_STAGE3_PROJECT_IDS: JSON.stringify(Object.fromEntries([
          'chromium', 'chromium-1080p', 'firefox', 'webkit', 'mobile-chromium',
        ].map(profile => [profile, Object.fromEntries([1, 100, 300].map(count => [
          String(count), `ci-collector-only-${profile}-${count}`,
        ]))]))),
        E2E_STAGE3_EXPECTED_CANVAS_MODE: 'legacy',
        E2E_STAGE4_EXPECTED_AGENT_MODE: 'agent-v2',
        E2E_STAGE4_EXPECTED_WORKFLOW_RENDERER_MODE: 'react-flow-v2',
      },
      encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
    expect(child.error).toBeUndefined();
    const report = JSON.parse(child.stdout) as DiscoveryReport;
    expect(report.errors).toEqual([]);
    expect(child.status, child.stderr).toBe(0);
    const profiles = discoveredProfiles(report.suites);
    expect([...new Set(profiles)].sort()).toEqual([
      'chromium', 'chromium-1080p', 'firefox', 'mobile-chromium', 'webkit',
    ]);
    expect(profiles).toHaveLength(caseCount);
    if (jobName === 'stage-4-workspace-interoperability') {
      const cases = discoveredCases(report.suites);
      for (const profile of ['chromium', 'chromium-1080p', 'firefox', 'webkit', 'mobile-chromium']) {
        expect(cases.filter(test => test.projectName === profile).map(test => test.title).sort()).toEqual([
          'completes chat to canvas to workflow to chat with durable lineage and refresh recovery',
          'executes ordinary chat, vision stop, agent cancel, and refresh recovery',
          'keeps the annotation action fully inside the workflow toolbar on narrow screens',
          'keeps the selected workflow renderer server-authoritative at 100 nodes',
        ]);
      }
    }
  });
});
