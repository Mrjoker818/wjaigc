import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const workflow = readFileSync(resolve(root, '.github/workflows/quality.yml'), 'utf8');
const stage0Workflow = readFileSync(resolve(root, '.github/workflows/stage-0-quality.yml'), 'utf8');
const playwrightConfig = readFileSync(resolve(root, 'playwright.config.ts'), 'utf8');
const evidenceHelper = readFileSync(resolve(root, 'tests/helpers/stage-3-e2e.ts'), 'utf8');
const allowlist = JSON.parse(
  readFileSync(resolve(root, 'docs/testing/baselines/stage-1-source-allowlist.json'), 'utf8'),
) as { stage?: string; paths?: string[]; infrastructurePaths?: string[] };

describe('Stage 3 release gate contract', () => {
  it('keeps the reviewed Stage 3 drift file-scoped', () => {
    expect(allowlist.stage).toBe('WJ-STABLE-001/S3');
    expect(allowlist.paths).toEqual(expect.arrayContaining([
      'src/app/api/user-data/sync/route.ts',
      'src/components/canvas/CanvasSurface.tsx',
      'src/components/canvas/use-canvas-viewport.ts',
      'src/lib/canvas-kernel/commands.ts',
      'src/lib/canvas-kernel/viewport.ts',
      'src/lib/layer-decomposition/source-image.ts',
      'src/lib/upscale-tile-executor.ts',
      'src/lib/user-data-record-client.ts',
    ]));
    expect(allowlist.paths).not.toContain('src/');
    expect(allowlist.paths?.every(path => path.startsWith('src/') && !path.endsWith('/'))).toBe(true);
    expect(allowlist.infrastructurePaths).toEqual(expect.arrayContaining([
      '.pnpmfile.cjs',
      '.github/workflows/quality.yml',
      'package.json',
      'pnpm-lock.yaml',
      'scripts/stage-3-e2e-fixtures.mjs',
      'tests/helpers/stage-3-source-state.ts',
    ]));
  });

  it('runs the controlled five-browser Canvas matrix in CI', () => {
    expect(workflow).toContain('stage-3-canvas-kernel:');
    expect(workflow).toContain('postgres:16-alpine');
    expect(workflow).toContain('pnpm seed:e2e:stage-3');
    expect(workflow).toContain('pnpm test:e2e:stage-3');
    expect(workflow).toContain('chromium firefox webkit');
    expect(workflow).toContain('test-results/stage-3-baseline/');
    expect(workflow).toContain('canvas-mode: [legacy, shadow, canvas-v2]');
    expect(workflow).toContain('WUJIE_CANVAS_KERNEL_MODE: ${{ matrix.canvas-mode }}');
    expect(workflow).toContain('E2E_STAGE3_EXPECTED_CANVAS_MODE: ${{ matrix.canvas-mode }}');
  });

  it('boots the production schema before seeding Stage 3 fixtures', () => {
    const stage3Job = workflow.slice(
      workflow.indexOf('  stage-3-canvas-kernel:'),
      workflow.indexOf('  real-p0-browser:'),
    );
    const build = stage3Job.indexOf('- name: Build production application');
    const start = stage3Job.indexOf('- name: Start production application');
    const seed = stage3Job.indexOf('- name: Seed controlled Canvas fixtures');

    expect(build).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(build);
    expect(seed).toBeGreaterThan(start);
  });

  it('waits for a public route instead of treating the protected auth probe as startup health', () => {
    expect(workflow).toContain('curl --fail --silent "$E2E_BASE_URL/"');
    expect(workflow).not.toContain('curl --fail --silent "$E2E_BASE_URL/api/auth/me"');
  });

  it('does not allow a passing retry to hide a first-attempt Stage 3 failure', () => {
    expect(playwrightConfig).toContain('retries: stage3Run ? 0');
  });

  it('separates repeated Stage 3 executions even when they reuse the same guarded fixtures', () => {
    expect(playwrightConfig).toContain('E2E_STAGE3_EVIDENCE_EXECUTION_ID');
    expect(evidenceHelper).toContain("process.env.E2E_STAGE3_EVIDENCE_EXECUTION_ID || 'unknown-execution'");
  });

  it('fails closed when mandatory Stage 3 evidence cannot be written or uploaded', () => {
    const stage3Job = workflow.slice(
      workflow.indexOf('  stage-3-canvas-kernel:'),
      workflow.indexOf('  real-p0-browser:'),
    );
    expect(stage3Job).toContain('if-no-files-found: error');
    expect(evidenceHelper).not.toContain("screenshot({ path: join(directory, 'final.png'), fullPage: true }).catch");
    expect(evidenceHelper).not.toContain("tracing.stop({ path: join(directory, 'trace.zip') }).catch");
    expect(evidenceHelper).toContain('const video = page.video()');
    expect(evidenceHelper).toContain("copyFile(await video.path(), join(directory, 'video.webm'))");
    expect(evidenceHelper).toContain("artifactErrors.push('video: Stage 3 evidence video was not created')");
  });

  it('closes the browser context before waiting for the recorded video', () => {
    const contextClose = evidenceHelper.indexOf('await page.context().close()');
    const videoPath = evidenceHelper.indexOf('await video.path()');

    expect(contextClose).toBeGreaterThan(-1);
    expect(videoPath).toBeGreaterThan(contextClose);
    expect(evidenceHelper).not.toContain('await page.close()');
  });

  it('uses the internal API secret name read by the application', () => {
    const stage3Job = workflow.slice(
      workflow.indexOf('  stage-3-canvas-kernel:'),
      workflow.indexOf('  real-p0-browser:'),
    );
    expect(stage3Job).toContain('INTERNAL_API_SECRET:');
    expect(stage3Job).not.toContain('WUJIE_INTERNAL_API_SECRET:');
  });

  it('compares push candidates with the pre-push SHA and reads allowlist data from that trusted base', () => {
    expect(stage0Workflow).toContain('${{ github.event.before }}');
    expect(stage0Workflow).not.toContain('--base origin/main --candidate HEAD');
    expect(stage0Workflow).toContain('git show "$protected_base:docs/testing/baselines/stage-1-source-allowlist.json"');
    expect(stage0Workflow).not.toContain("jq -r '.paths[], .infrastructurePaths[]' docs/testing/baselines/stage-1-source-allowlist.json");
  });

  it('runs an immutable stable integrity alarm on stable pushes', () => {
    expect(stage0Workflow).toMatch(/branches:[\s\S]*- stable/);
    expect(stage0Workflow).toContain('52f7c601ed150769e15d06fb435c6e360e28c9e7');
    expect(stage0Workflow).toContain('stable-integrity:');
  });
});
