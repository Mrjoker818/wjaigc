import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const e2ePath = resolve(root, 'tests/e2e/stage-1-task-billing.spec.ts');
const workflowPath = resolve(root, '.github/workflows/stage-0-quality.yml');
const allowlistPath = resolve(root, 'docs/testing/baselines/stage-1-source-allowlist.json');

describe('Stage 1 release gate contract', () => {
  it('provides a real-browser task and billing evidence suite', () => {
    expect(existsSync(e2ePath)).toBe(true);
    const source = readFileSync(e2ePath, 'utf8');

    expect(source).toContain('E2E_DEPLOYMENT_COMMIT');
    expect(source).toContain('E2E_TEST_USERNAME');
    expect(source).toContain('E2E_TEST_PASSWORD');
    expect(source).toContain('requestId');
    expect(source).toContain('taskId');
    expect(source).toContain('credit');
    expect(source).not.toContain("page.route('");
    expect(source).not.toContain('route.fulfill(');
  });

  it('keeps external evidence explicit in CI instead of silently mocking it', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('stage-1-local-gates:');
    expect(workflow).toContain('stage-1-external-evidence:');
    expect(workflow).toContain('POSTGRES_TEST_DATABASE_URL');
    expect(workflow).toContain('E2E_DEPLOYMENT_COMMIT');
    expect(workflow).toContain('tests/e2e/stage-1-task-billing.spec.ts');
  });

  it('uses a reviewed per-file source allowlist instead of allowing all src drift', () => {
    expect(existsSync(allowlistPath)).toBe(true);
    const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8')) as { paths?: string[] };
    expect(allowlist.paths?.length).toBeGreaterThan(0);
    expect(allowlist.paths).not.toContain('src/');
    expect(allowlist.paths?.every((path) => path.startsWith('src/') && !path.endsWith('/'))).toBe(true);

    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('stage-1-source-allowlist.json');
    expect(workflow).toContain('--allow-path');
    expect(workflow.match(/stage-1-source-allowlist\.json/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
