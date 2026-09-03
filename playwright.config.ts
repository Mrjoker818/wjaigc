import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
const chromiumLaunchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : undefined;
const stage3Run = process.env.npm_lifecycle_event === 'test:e2e:stage-3'
  || process.argv.some(argument => argument.includes('stage-3-canvas-kernel.spec.ts'))
  || Boolean(process.env.E2E_STAGE3_RUN_ID);
const scopedSkillRuntimeRun = process.env.E2E_SKILL_RUNTIME_RUN === '1'
  || process.argv.some(argument => (
  argument.includes('skill-runtime-canvas-workflow.spec.ts')
  || argument.includes('skill-runtime-simple-chat-isolation.spec.ts')
  ));
if (scopedSkillRuntimeRun) process.env.E2E_SKILL_RUNTIME_RUN = '1';
if (stage3Run && !process.env.E2E_STAGE3_EVIDENCE_EXECUTION_ID) {
  process.env.E2E_STAGE3_EVIDENCE_EXECUTION_ID = `${Date.now()}-${process.pid}`;
}
const stage3EvidenceScope = [
  process.env.E2E_STAGE3_EXPECTED_CANVAS_MODE || process.env.WUJIE_CANVAS_KERNEL_MODE || 'unknown-mode',
  process.env.E2E_STAGE3_RUN_ID || 'unknown-run',
  process.env.E2E_STAGE3_EVIDENCE_EXECUTION_ID || 'unknown-execution',
]
  .map(value => value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''))
  .join('/');
const outputDir = stage3Run
  ? `./test-results/stage-3-baseline/${stage3EvidenceScope}/playwright-output`
  : scopedSkillRuntimeRun
    ? './test-results/skill-runtime/playwright-output'
    : './.playwright-output';
const htmlOutput = stage3Run
  ? `test-results/stage-3-baseline/${stage3EvidenceScope}/playwright-report`
  : 'playwright-report';
const junitOutput = stage3Run
  ? `test-results/stage-3-baseline/${stage3EvidenceScope}/junit.xml`
  : 'test-results/junit.xml';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/helpers/warmup-server.ts',
  // Playwright clears outputDir before every run; immutable evidence belongs in test-results.
  outputDir,
  fullyParallel: false,
  // P0 uses one real account and one writable project. Run projects serially to avoid state pollution.
  workers: Number(process.env.PLAYWRIGHT_WORKERS || '1'),
  forbidOnly: Boolean(process.env.CI),
  retries: stage3Run ? 0 : process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: htmlOutput, open: 'never' }],
    ['junit', { outputFile: junitOutput }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: chromiumLaunchOptions } },
    { name: 'chromium-1080p', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1920, height: 1080 }, launchOptions: chromiumLaunchOptions } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], channel: 'chromium', launchOptions: chromiumLaunchOptions } },
  ],
});
