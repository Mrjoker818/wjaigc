import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/quality.yml'),
  'utf8',
);
const playwrightConfig = readFileSync(
  resolve(process.cwd(), 'playwright.config.ts'),
  'utf8',
);
const vitestConfig = readFileSync(
  resolve(process.cwd(), 'vitest.config.ts'),
  'utf8',
);
const httpVitestConfig = readFileSync(
  resolve(process.cwd(), 'vitest.http.config.ts'),
  'utf8',
);
const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as { scripts?: Record<string, string> };

describe('quality workflow contract', () => {
  it('runs the official production dependency audit before build acceptance', () => {
    expect(workflow).toContain('pnpm audit --prod --json --registry=https://registry.npmjs.org');
  });

  it('uses packageManager as the single pnpm version source', () => {
    expect(workflow).not.toMatch(/pnpm\/action-setup@v4\s+with:\s+version:/);
  });

  it('fails clearly before browser installation when real P0 credentials are absent', () => {
    const realP0Job = workflow.slice(workflow.indexOf('  real-p0-browser:'));
    const validation = realP0Job.indexOf('name: Validate real P0 E2E configuration');
    const browserInstall = realP0Job.indexOf('pnpm exec playwright install');

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

  it('runs the layer editing browser regression in CI', () => {
    expect(workflow).toContain('tests/e2e/layer-editing.spec.ts');
  });

  it('runs deployed HTTP API tests only in the credentialed real-environment gate', () => {
    expect(vitestConfig).not.toContain("'tests/api/**/*.test.ts'");
    expect(httpVitestConfig).toContain("include: ['tests/api/**/*.test.ts']");
    expect(packageJson.scripts?.['test:http-api']).toBe(
      'vitest run --config vitest.http.config.ts',
    );
    expect(workflow).toContain('pnpm test:http-api');
  });

  it('serializes native image integration tests instead of increasing timeouts', () => {
    expect(vitestConfig).toContain('fileParallelism: false');
    expect(vitestConfig).not.toContain('testTimeout:');
  });

  it('runs doctor in production-strict mode', () => {
    expect(workflow).toContain('pnpm doctor -- --production');
  });

  it('creates a writable doctor data directory on a clean runner', () => {
    expect(workflow).not.toContain('WUJIE_DATA_DIR: ${{ runner.temp }}');
    expect(workflow).toContain('WUJIE_DATA_DIR: .wujie-data');
    expect(workflow).toContain('mkdir -p "$WUJIE_DATA_DIR"');
  });

  it('runs database concurrency gates against an isolated PostgreSQL service', () => {
    expect(workflow).toContain('postgres:16-alpine');
    expect(workflow).toContain('TEST_POSTGRES_URL: postgresql://postgres:postgres@localhost:5432/wujie_test');
    expect(workflow).toContain('src/__tests__/api/layered-decompose-postgres-concurrency.test.ts');
    expect(workflow).toContain('src/__tests__/lib/annotation-postgres-concurrency.test.ts');
  });

  it('does not require paid browser secrets for untrusted pull requests', () => {
    expect(workflow).toContain("github.event_name != 'pull_request'");
    expect(workflow).toContain("github.actor != 'dependabot[bot]'");
    expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('keeps an environment doctor check available to untrusted pull requests', () => {
    expect(workflow).toContain('name: Environment doctor (untrusted pull request)');
    expect(workflow).toContain("github.event_name == 'pull_request'");
  });

  it('lets Playwright resolve its installed Chromium unless CHROMIUM_PATH is explicit', () => {
    expect(playwrightConfig).not.toContain('/root/.cache/ms-playwright');
    expect(playwrightConfig).toContain('process.env.CHROMIUM_PATH');
  });
});
