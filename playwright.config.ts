import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
const chromiumLaunchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : undefined;
const stage3Run = process.env.npm_lifecycle_event === 'test:e2e:stage-3'
  || process.argv.some(argument => argument.includes('stage-3-canvas-kernel.spec.ts'));
const outputDir = stage3Run
  ? './test-results/stage-3-baseline/playwright-output'
  : './.playwright-output';
const htmlOutput = stage3Run
  ? 'test-results/stage-3-baseline/playwright-report'
  : 'playwright-report';
const junitOutput = stage3Run
  ? 'test-results/stage-3-baseline/junit.xml'
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
  retries: process.env.CI ? 1 : 0,
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
