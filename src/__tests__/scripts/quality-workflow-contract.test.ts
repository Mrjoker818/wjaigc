import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/quality.yml'),
  'utf8',
);

describe('quality workflow contract', () => {
  it('runs the official production dependency audit before build acceptance', () => {
    expect(workflow).toContain('pnpm audit --prod --json --registry=https://registry.npmjs.org');
  });

  it('uses packageManager as the single pnpm version source', () => {
    expect(workflow).not.toMatch(/pnpm\/action-setup@v4\s+with:\s+version:/);
  });

  it('fails clearly before browser installation when real P0 credentials are absent', () => {
    const validation = workflow.indexOf('name: Validate real P0 E2E configuration');
    const browserInstall = workflow.indexOf('pnpm exec playwright install');

    expect(validation).toBeGreaterThan(-1);
    expect(browserInstall).toBeGreaterThan(validation);
    for (const variable of [
      'E2E_BASE_URL',
      'E2E_TEST_USERNAME',
      'E2E_TEST_PASSWORD',
      'E2E_GENERATION_MODEL',
      'E2E_ENABLE_PAID_GENERATION',
    ]) {
      expect(workflow).toContain(variable);
    }
  });
});
